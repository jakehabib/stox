import { prisma } from './db';
import { Rng } from './rng';
import { LEAGUE } from './tuning';
import { parseSettings } from './settings';
import { readJson, writeJson } from './json';
import { simulateGame, SimTeamInput } from './sim/engine';
import { generateRecap } from './sim/recap';
import { SimPlayer, SimStaff } from './sim/units';
import { progressPlayer, retirementChance, growthMean } from './progression';
import { AttrMap, computeOverall } from './ratings';
import { runAiFreeAgencyWave } from './freeagency';
import { generateDraftClass, toPlayerCreate } from './gen/players';
import { GENERATION } from './tuning';
import { reseedDraftOrder, startRookieDraft } from './draft';
import { autoDepthChartAll } from './gen/league';

/**
 * ===========================================================================
 * SEASON / OFFSEASON FLOW (design doc section 13)
 * ===========================================================================
 * Phase machine: PRESEASON -> REGULAR -> PLAYOFFS -> OFFSEASON -> RESIGN ->
 * FREE_AGENCY -> DRAFT -> back to PRESEASON.
 * (FANTASY_DRAFT is a one-time pre-PRESEASON phase used only at league start.)
 *
 * `advanceWeek` is the single entrypoint the UI calls to move time forward.
 * It does exactly one week's worth of work and returns a summary of what
 * happened, so the UI can show "what changed" rather than a wall of silence.
 * ===========================================================================
 */

export async function advanceWeek(leagueId: string) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const rng = new Rng(`${settings.simSeed || league.id}-${league.phase}-${league.week}`);

  switch (league.phase) {
    case 'PRESEASON':
      await prisma.league.update({ where: { id: leagueId }, data: { phase: 'REGULAR', week: 1 } });
      return { summary: 'Preseason complete. Week 1 is set.' };

    case 'REGULAR':
      return simulateWeek(leagueId, league.week, settings, rng);

    case 'PLAYOFFS':
      return simulatePlayoffRound(leagueId, settings, rng);

    case 'OFFSEASON':
      return runOffseasonStep(leagueId, rng);

    case 'RESIGN':
      // User handles re-signs via the UI; advancing just moves to FA.
      await prisma.league.update({ where: { id: leagueId }, data: { phase: 'FREE_AGENCY', week: 1 } });
      return { summary: 'Free agency is open.' };

    case 'FREE_AGENCY': {
      const { signings } = await runAiFreeAgencyWave(leagueId, league.seasonYear, league.week, settings, rng);
      const nextWeek = league.week + 1;
      if (nextWeek > 4) {
        await reseedDraftOrder(leagueId, league.seasonYear);
        await startRookieDraft(leagueId, league.seasonYear, rng);
        return { summary: `Free agency closed. ${signings} signing(s) this week. The draft is on the clock.` };
      }
      await prisma.league.update({ where: { id: leagueId }, data: { week: nextWeek } });
      return { summary: `Free agency, week ${league.week}: ${signings} AI signing(s) league-wide.` };
    }

    case 'DRAFT':
      return { summary: 'Draft is in progress — make your picks, then advance.' };

    case 'FANTASY_DRAFT':
      return { summary: 'Fantasy draft is in progress — make your picks, then advance.' };

    default:
      return { summary: `Unhandled phase: ${league.phase}` };
  }
}

async function simulateWeek(leagueId: string, week: number, settings: ReturnType<typeof parseSettings>, rng: Rng) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const games = await prisma.game.findMany({
    where: { leagueId, week, seasonYear: league.seasonYear, played: false, kind: 'REGULAR' },
  });

  let played = 0;
  for (const game of games) {
    await simulateAndSaveGame(leagueId, game.id, settings, new Rng(`${rng.next()}-${game.id}`));
    played += 1;
  }

  // Recover fatigue league-wide between weeks.
  await prisma.player.updateMany({ where: { leagueId }, data: {} }); // no-op placeholder for future batch tuning hooks
  await recoverFatigueAndInjuries(leagueId);

  const nextWeek = week + 1;
  if (nextWeek > settings.seasonLength) {
    await seedPlayoffs(leagueId);
    return { summary: `Week ${week} complete (${played} games). Regular season is over — playoffs are set.` };
  }
  await prisma.league.update({ where: { id: leagueId }, data: { week: nextWeek } });
  return { summary: `Week ${week} complete: ${played} games played.` };
}

export async function simulateAndSaveGame(leagueId: string, gameId: string, settings: ReturnType<typeof parseSettings>, rng: Rng) {
  const game = await prisma.game.findUniqueOrThrow({ where: { id: gameId } });
  const [home, away] = await Promise.all([loadSimTeam(game.homeTeamId), loadSimTeam(game.awayTeamId)]);

  const result = simulateGame(home, away, settings, rng, { allowTie: true });
  const recap = generateRecap(result.boxScore, settings, rng);

  await prisma.$transaction(async (tx) => {
    await tx.game.update({
      where: { id: gameId },
      data: {
        played: true, homeScore: result.homeScore, awayScore: result.awayScore,
        boxScore: writeJson(result.boxScore), recap,
      },
    });

    await updateStandings(tx as any, game.homeTeamId, game.awayTeamId, result.homeScore, result.awayScore);

    for (const [playerId, weeks] of Object.entries(fatigueMapToInjuries(result))) {
      await tx.player.update({ where: { id: playerId }, data: { injuryWeeks: weeks } }).catch(() => {});
    }
    for (const [playerId, fatigue] of Object.entries(result.fatigue)) {
      await tx.player.update({ where: { id: playerId }, data: { fatigue: { increment: fatigue } } }).catch(() => {});
    }
    if (result.injuries.length > 0) {
      await tx.transaction.create({
        data: {
          leagueId, seasonYear: game.seasonYear, week: game.week, type: 'INJURY',
          headline: `${result.injuries.length} injury report(s) from ${home.abbr} @ ${away.abbr}`,
          detail: result.boxScore.injuries.map((i) => `${i.name} (${i.weeks}w)`).join(', '),
        },
      });
    }
  });

  return result;
}

function fatigueMapToInjuries(result: Awaited<ReturnType<typeof simulateGame>>) {
  const map: Record<string, number> = {};
  for (const i of result.injuries) map[i.playerId] = i.weeks;
  return map;
}

async function loadSimTeam(teamId: string): Promise<SimTeamInput> {
  const [team, players, staff, depthSlots] = await Promise.all([
    prisma.team.findUniqueOrThrow({ where: { id: teamId } }),
    prisma.player.findMany({ where: { teamId, status: 'ACTIVE' } }),
    prisma.staff.findMany({ where: { teamId } }),
    prisma.depthChartSlot.findMany({ where: { teamId }, orderBy: { rank: 'asc' } }),
  ]);

  const depthOrder: Record<string, string[]> = {};
  for (const slot of depthSlots) (depthOrder[slot.position] ??= []).push(slot.playerId);

  return {
    id: team.id, abbr: team.abbr, name: `${team.city} ${team.nickname}`, isUser: team.isUser,
    offScheme: team.offScheme, defScheme: team.defScheme,
    players: players.map((p): SimPlayer => ({
      id: p.id, firstName: p.firstName, lastName: p.lastName, position: p.position,
      trueOvr: p.trueOvr, trueAttrs: p.trueAttrs, status: p.status, injuryWeeks: p.injuryWeeks, fatigue: p.fatigue,
    })),
    staff: staff.map((s): SimStaff => ({ role: s.role, playCalling: s.playCalling, rating: s.rating, scheme: s.scheme })),
    depthOrder,
  };
}

async function updateStandings(tx: typeof prisma, homeId: string, awayId: string, homeScore: number, awayScore: number) {
  const [home, away] = await Promise.all([
    tx.team.findUniqueOrThrow({ where: { id: homeId } }),
    tx.team.findUniqueOrThrow({ where: { id: awayId } }),
  ]);
  const sameDiv = home.division === away.division && home.conference === away.conference;
  const sameConf = home.conference === away.conference;

  const apply = async (teamId: string, pf: number, pa: number, won: boolean, tied: boolean, divRelevant: boolean, confRelevant: boolean) => {
    await tx.team.update({
      where: { id: teamId },
      data: {
        pointsFor: { increment: pf },
        pointsAgnst: { increment: pa },
        wins: { increment: won && !tied ? 1 : 0 },
        losses: { increment: !won && !tied ? 1 : 0 },
        ties: { increment: tied ? 1 : 0 },
        divWins: { increment: divRelevant && won && !tied ? 1 : 0 },
        divLosses: { increment: divRelevant && !won && !tied ? 1 : 0 },
        confWins: { increment: confRelevant && won && !tied ? 1 : 0 },
        confLosses: { increment: confRelevant && !won && !tied ? 1 : 0 },
      },
    });
  };

  const tied = homeScore === awayScore;
  await apply(homeId, homeScore, awayScore, homeScore > awayScore, tied, sameDiv, sameConf);
  await apply(awayId, awayScore, homeScore, awayScore > homeScore, tied, sameDiv, sameConf);
}

async function recoverFatigueAndInjuries(leagueId: string) {
  const { SIM } = await import('./tuning');
  const players = await prisma.player.findMany({ where: { leagueId, status: 'ACTIVE' } });
  for (const p of players) {
    const data: any = {};
    if (p.fatigue > 0) data.fatigue = Math.max(0, p.fatigue - SIM.FATIGUE_RECOVERY);
    if (p.injuryWeeks > 0) data.injuryWeeks = p.injuryWeeks - 1;
    if (Object.keys(data).length) await prisma.player.update({ where: { id: p.id }, data });
  }
}

// ---------------------------------------------------------------------------
// Playoffs
// ---------------------------------------------------------------------------

async function seedPlayoffs(leagueId: string) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const teams = await prisma.team.findMany({ where: { leagueId } });

  for (const conf of ['AFC', 'NFC'] as const) {
    const confTeams = teams.filter((t) => t.conference === conf);
    const divisions = Array.from(new Set(confTeams.map((t) => t.division)));
    const divWinners = divisions
      .map((div) => confTeams.filter((t) => t.division === div).sort(byStanding)[0])
      .sort(byStanding);
    const others = confTeams.filter((t) => !divWinners.includes(t)).sort(byStanding);
    const wildcards = others.slice(0, Math.max(0, LEAGUE.PLAYOFF_TEAMS_PER_CONF - divWinners.length));
    const seeded = [...divWinners, ...wildcards].slice(0, LEAGUE.PLAYOFF_TEAMS_PER_CONF);
    for (let i = 0; i < seeded.length; i++) {
      await prisma.team.update({ where: { id: seeded[i].id }, data: { playoffSeed: i + 1 } });
    }
    for (const t of confTeams) {
      if (!seeded.find((s) => s.id === t.id)) await prisma.team.update({ where: { id: t.id }, data: { eliminated: true } });
    }
  }

  await createWildcardRound(leagueId, league.seasonYear);
  await prisma.league.update({ where: { id: leagueId }, data: { phase: 'PLAYOFFS', week: 1 } });
}

function byStanding(a: { wins: number; losses: number; ties: number; pointsFor: number; pointsAgnst: number }, b: typeof a) {
  const pctA = (a.wins + a.ties * 0.5) / Math.max(1, a.wins + a.losses + a.ties);
  const pctB = (b.wins + b.ties * 0.5) / Math.max(1, b.wins + b.losses + b.ties);
  if (pctB !== pctA) return pctB - pctA;
  return (b.pointsFor - b.pointsAgnst) - (a.pointsFor - a.pointsAgnst);
}

async function createWildcardRound(leagueId: string, seasonYear: number) {
  for (const conf of ['AFC', 'NFC'] as const) {
    const seeded = await prisma.team.findMany({ where: { leagueId, conference: conf, playoffSeed: { not: null } }, orderBy: { playoffSeed: 'asc' } });
    // [TUNE] 6-seed bracket: 1 & 2 bye. 3v6, 4v5.
    const pairs: [number, number][] = [[3, 6], [4, 5]];
    for (const [hi, lo] of pairs) {
      const home = seeded.find((t) => t.playoffSeed === hi);
      const away = seeded.find((t) => t.playoffSeed === lo);
      if (home && away) {
        await prisma.game.create({
          data: { leagueId, seasonYear, week: 1, kind: 'WILDCARD', homeTeamId: home.id, awayTeamId: away.id },
        });
      }
    }
  }
}

async function simulatePlayoffRound(leagueId: string, settings: ReturnType<typeof parseSettings>, rng: Rng) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const pending = await prisma.game.findMany({ where: { leagueId, played: false, kind: { not: 'REGULAR' } } });

  for (const game of pending) {
    await simulateAndSaveGame(leagueId, game.id, settings, new Rng(`${rng.next()}-${game.id}`));
  }

  const kindsPlayed = new Set((await prisma.game.findMany({ where: { leagueId, kind: { not: 'REGULAR' } } })).map((g) => g.kind));

  if (kindsPlayed.has('WILDCARD') && !kindsPlayed.has('DIVISIONAL')) {
    await createNextPlayoffRound(leagueId, league.seasonYear, 'WILDCARD', 'DIVISIONAL');
    return { summary: 'Wild card round complete. Divisional round is set.' };
  }
  if (kindsPlayed.has('DIVISIONAL') && !kindsPlayed.has('CONFERENCE')) {
    await createNextPlayoffRound(leagueId, league.seasonYear, 'DIVISIONAL', 'CONFERENCE');
    return { summary: 'Divisional round complete. Conference championships are set.' };
  }
  if (kindsPlayed.has('CONFERENCE') && !kindsPlayed.has('FINAL')) {
    await createFinal(leagueId, league.seasonYear);
    return { summary: 'Conference championships complete. The final is set.' };
  }
  if (kindsPlayed.has('FINAL')) {
    await prisma.league.update({ where: { id: leagueId }, data: { phase: 'OFFSEASON', week: 1 } });
    return { summary: 'The championship game is complete! Welcome to the offseason.' };
  }
  return { summary: 'Playoffs advanced.' };
}

async function createNextPlayoffRound(leagueId: string, seasonYear: number, fromKind: string, toKind: string) {
  const games = await prisma.game.findMany({ where: { leagueId, kind: fromKind, played: true } });
  const winners: { id: string; conference: string; seed: number }[] = [];
  for (const g of games) {
    const winnerId = g.homeScore >= g.awayScore ? g.homeTeamId : g.awayTeamId;
    const t = await prisma.team.findUniqueOrThrow({ where: { id: winnerId } });
    winners.push({ id: t.id, conference: t.conference, seed: t.playoffSeed ?? 99 });
  }
  // Byes advance automatically into the divisional round.
  if (fromKind === 'WILDCARD') {
    const byes = await prisma.team.findMany({ where: { leagueId, playoffSeed: { in: [1, 2] } } });
    winners.push(...byes.map((t) => ({ id: t.id, conference: t.conference, seed: t.playoffSeed! })));
  }
  for (const conf of ['AFC', 'NFC'] as const) {
    const confWinners = winners.filter((w) => w.conference === conf).sort((a, b) => a.seed - b.seed);
    for (let i = 0; i < confWinners.length; i += 2) {
      if (confWinners[i + 1]) {
        await prisma.game.create({
          data: { leagueId, seasonYear, week: 2, kind: toKind, homeTeamId: confWinners[i].id, awayTeamId: confWinners[i + 1].id },
        });
      }
    }
  }
}

async function createFinal(leagueId: string, seasonYear: number) {
  const games = await prisma.game.findMany({ where: { leagueId, kind: 'CONFERENCE', played: true } });
  const winners = games.map((g) => (g.homeScore >= g.awayScore ? g.homeTeamId : g.awayTeamId));
  if (winners.length === 2) {
    await prisma.game.create({
      data: { leagueId, seasonYear, week: 4, kind: 'FINAL', homeTeamId: winners[0], awayTeamId: winners[1] },
    });
  }
}

// ---------------------------------------------------------------------------
// Offseason
// ---------------------------------------------------------------------------

const OFFSEASON_STEPS = ['PROGRESS', 'RESET_STANDINGS', 'AGE_CONTRACTS', 'ADD_DRAFT_CLASS', 'RESIGN'] as const;

async function runOffseasonStep(leagueId: string, rng: Rng) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const step = OFFSEASON_STEPS[Math.min(league.week - 1, OFFSEASON_STEPS.length - 1)];

  switch (step) {
    case 'PROGRESS': {
      await progressAllPlayers(leagueId, rng, settings.progressionSpeed, settings.retirementEnabled);
      await prisma.league.update({ where: { id: leagueId }, data: { week: league.week + 1 } });
      return { summary: 'Offseason development complete — players have progressed or declined.' };
    }
    case 'RESET_STANDINGS': {
      await prisma.team.updateMany({
        where: { leagueId },
        data: { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgnst: 0, divWins: 0, divLosses: 0, confWins: 0, confLosses: 0, playoffSeed: null, eliminated: false },
      });
      await prisma.league.update({ where: { id: leagueId }, data: { week: league.week + 1, seasonYear: league.seasonYear + 1 } });
      return { summary: 'Standings reset for the new league year.' };
    }
    case 'AGE_CONTRACTS': {
      await agePlayersAndContracts(leagueId);
      await prisma.league.update({ where: { id: leagueId }, data: { week: league.week + 1 } });
      return { summary: 'Contracts advanced a year; expired deals hit free agency.' };
    }
    case 'ADD_DRAFT_CLASS': {
      await addDraftClass(leagueId, league.seasonYear, rng);
      await addFutureDraftPicks(leagueId, league.seasonYear);
      await prisma.league.update({ where: { id: leagueId }, data: { week: league.week + 1 } });
      return { summary: 'This year\'s rookie draft class has entered the pool.' };
    }
    case 'RESIGN':
    default: {
      await prisma.league.update({ where: { id: leagueId }, data: { phase: 'RESIGN', week: 1 } });
      return { summary: 'Re-sign your own free agents, then advance to open free agency.' };
    }
  }
}

async function progressAllPlayers(leagueId: string, rng: Rng, speed: number, retirementEnabled: boolean) {
  const players = await prisma.player.findMany({ where: { leagueId, status: 'ACTIVE' } });
  for (const p of players) {
    if (retirementEnabled && p.age >= 32) {
      const chance = retirementChance(p.age, p.trueOvr);
      if (rng.bool(chance)) {
        await prisma.player.update({ where: { id: p.id }, data: { status: 'RETIRED', teamId: null } });
        continue;
      }
    }
    const attrs = readJson<AttrMap>(p.trueAttrs, {});
    const { attrs: newAttrs, ovr } = progressPlayer(rng, p.position as any, attrs, p.age, p.potential, p.devTrait, speed);
    await prisma.player.update({
      where: { id: p.id },
      data: { trueAttrs: writeJson(newAttrs), trueOvr: ovr, age: p.age + 1, experience: p.experience + 1, fatigue: 0, injuryWeeks: 0 },
    });
  }
}

async function agePlayersAndContracts(leagueId: string) {
  const contracts = await prisma.contract.findMany({ where: { player: { leagueId, status: 'ACTIVE' } } });
  for (const c of contracts) {
    const remaining = c.yearsRemaining - 1;
    if (remaining <= 0) {
      await prisma.contract.delete({ where: { id: c.id } });
      await prisma.player.update({ where: { id: c.playerId }, data: { status: 'FREE_AGENT', teamId: null } });
    } else {
      await prisma.contract.update({ where: { id: c.id }, data: { yearsRemaining: remaining } });
    }
  }
  // Dead money charges only apply to the year they were incurred.
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  await prisma.capCharge.deleteMany({ where: { year: { lt: league.seasonYear }, teamId: { in: (await prisma.team.findMany({ where: { leagueId }, select: { id: true } })).map((t) => t.id) } } });
}

async function addDraftClass(leagueId: string, seasonYear: number, rng: Rng) {
  const size = GENERATION.DRAFT_CLASS_SIZE;
  const players = generateDraftClass(rng, size);
  const rows = players.map((p) => toPlayerCreate(p, leagueId, { status: 'FREE_AGENT', isDraftee: true, draftYear: seasonYear }));
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) await prisma.player.createMany({ data: rows.slice(i, i + CHUNK) });
}

async function addFutureDraftPicks(leagueId: string, seasonYear: number) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const teams = await prisma.team.findMany({ where: { leagueId } });
  const targetYear = seasonYear + 2; // keep a rolling 3-year pick horizon
  const existing = await prisma.draftPick.count({ where: { leagueId, year: targetYear } });
  if (existing > 0) return;
  const rows: any[] = [];
  for (let round = 1; round <= settings.draftRounds; round++) {
    teams.forEach((team, i) => {
      rows.push({ leagueId, year: targetYear, round, slot: i + 1, originalTeamId: team.id, ownerTeamId: team.id });
    });
  }
  await prisma.draftPick.createMany({ data: rows });
}

export const PHASE_LABELS: Record<string, string> = {
  PRESEASON: 'Preseason',
  REGULAR: 'Regular Season',
  PLAYOFFS: 'Playoffs',
  OFFSEASON: 'Offseason',
  RESIGN: 'Re-sign Window',
  FREE_AGENCY: 'Free Agency',
  DRAFT: 'Rookie Draft',
  FANTASY_DRAFT: 'Fantasy Draft',
};
