import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { Rng } from './rng';
import { LEAGUE, Position, PROGRESSION } from './tuning';
import { parseSettings, LeagueSettings } from './settings';
import { readJson, writeJson } from './json';
import { simulateGame, SimTeamInput } from './sim/engine';
import { generateRecap } from './sim/recap';
import { SimPlayer, SimStaff } from './sim/units';
import { retirementChance, bumpForMilestone } from './progression';
import { AttrMap } from './ratings';
import { applyInSeasonProgression } from './development';
import { runAiFreeAgencyWave } from './freeagency';
import { maybeGenerateAiTradeOffer } from './trade';
import { mergeStats } from './stats';
import { SeasonStats } from './types';
import { gameHeadlines } from './news';
import { COACH_FIRST, COACH_LAST } from './gen/names';
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
    case 'PRESEASON': {
      // Next draft class goes in at week 1, not buried in the offseason —
      // so there's a full season to scout it before it's actually drafted.
      // League creation already seeds year 1's class; guard so a re-run of
      // this step (or that initial seed) never doubles it up.
      const alreadySeeded = await prisma.player.count({ where: { leagueId, isDraftee: true, draftYear: league.seasonYear } });
      if (alreadySeeded === 0) await addDraftClass(leagueId, league.seasonYear, rng);
      await prisma.league.update({ where: { id: leagueId }, data: { phase: 'REGULAR', week: 1 } });
      return { summary: 'Preseason complete. Week 1 is set — next year\'s draft class is on the board.' };
    }

    case 'REGULAR':
      return simulateWeek(leagueId, league.week, settings, rng);

    case 'PLAYOFFS':
      return simulatePlayoffRound(leagueId, settings, rng);

    case 'OFFSEASON':
      return runOffseasonStep(leagueId, rng);

    case 'RESIGN': {
      // Whoever the user (or an AI team) didn't extend by now walks.
      const releasedBefore = await prisma.contract.count({ where: { yearsRemaining: 0, player: { leagueId, status: 'ACTIVE' } } });
      await releaseUnresignedExpiringContracts(leagueId);
      await prisma.league.update({ where: { id: leagueId }, data: { phase: 'FREE_AGENCY', week: 1 } });
      return { summary: releasedBefore > 0 ? `${releasedBefore} unsigned player(s) hit free agency. Free agency is open.` : 'Free agency is open.' };
    }

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

    case 'DRAFT': {
      // Nothing else in the app ever moved the league out of DRAFT once the
      // last pick was made — draftPlayer()/advancePick() mark DraftState
      // complete, but no code path read that flag to advance League.phase,
      // so every league dead-ended here permanently after its first draft.
      const state = await prisma.draftState.findUnique({ where: { leagueId } });
      if (!state?.complete) return { summary: 'Draft is in progress — make your picks, then advance.' };

      // Whoever this class's draft left undrafted was never converted back
      // into an ordinary free agent — isDraftee only ever got cleared inside
      // draftPlayer() for players actually selected. Left unfixed, a stale
      // prospect stays isDraftee:true forever: permanently excluded from
      // normal free agency (which explicitly filters isDraftee out), never
      // aged (progression only runs on status: 'ACTIVE'), and kept
      // resurfacing in every future year's draft pool mixed in with the
      // real new class, since the pool query has no year filter of its own.
      const undrafted = await prisma.player.updateMany({
        where: { leagueId, isDraftee: true, draftYear: { lt: league.seasonYear } },
        data: { isDraftee: false },
      });

      await prisma.league.update({ where: { id: leagueId }, data: { phase: 'PRESEASON', week: 1 } });
      return {
        summary: undrafted.count > 0
          ? `The draft is complete — ${undrafted.count} undrafted prospect(s) entered free agency. On to the new league year.`
          : 'The draft is complete. On to the new league year.',
      };
    }

    case 'FANTASY_DRAFT': {
      const state = await prisma.draftState.findUnique({ where: { leagueId } });
      if (!state?.complete) return { summary: 'Fantasy draft is in progress — make your picks, then advance.' };
      await prisma.league.update({ where: { id: leagueId }, data: { phase: 'PRESEASON', week: 1 } });
      return { summary: 'Fantasy draft complete. Setting up your inaugural season.' };
    }

    default:
      return { summary: `Unhandled phase: ${league.phase}` };
  }
}

async function simulateWeek(leagueId: string, week: number, settings: ReturnType<typeof parseSettings>, rng: Rng) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const games = await prisma.game.findMany({
    where: { leagueId, week, seasonYear: league.seasonYear, played: false, kind: 'REGULAR' },
  });

  // Every game in a week touches disjoint teams/players, so they're safe to
  // run concurrently — this was previously a sequential `for` loop awaiting
  // one game at a time, which serialized 16 games' worth of DB round trips
  // for no reason and was the single biggest contributor to slow sim speed.
  const gameRngs = games.map((game) => new Rng(`${rng.next()}-${game.id}`));
  await Promise.all(games.map((game, i) => simulateAndSaveGame(leagueId, game.id, settings, gameRngs[i])));
  const played = games.length;

  // Recover fatigue league-wide between weeks.
  await recoverFatigueAndInjuries(leagueId);
  await applyInSeasonProgression(leagueId, league.seasonYear, week, settings.seasonLength, rng, settings.progressionSpeed);
  await maybeMakeAiTradeOffer(leagueId, league.seasonYear, week, settings, rng);

  const nextWeek = week + 1;
  if (nextWeek > settings.seasonLength) {
    await seedPlayoffs(leagueId);
    return { summary: `Week ${week} complete (${played} games). Regular season is over — playoffs are set.` };
  }
  await prisma.league.update({ where: { id: leagueId }, data: { week: nextWeek } });
  return { summary: `Week ${week} complete: ${played} games played.` };
}

const MAX_PENDING_OFFERS = 3;

/**
 * Unsolicited AI trade offers — the CPU approaching the user, not just the
 * reverse. Capped so the user's inbox doesn't flood; expires stale ones so
 * the list stays current.
 */
async function maybeMakeAiTradeOffer(leagueId: string, seasonYear: number, week: number, settings: ReturnType<typeof parseSettings>, rng: Rng) {
  if (!settings.tradesEnabled) return;
  const userTeam = await prisma.team.findFirst({ where: { leagueId, isUser: true } });
  if (!userTeam) return;

  // Offers expire after 1 week unanswered — visible the week they arrive
  // and the week after, then gone.
  await prisma.tradeOffer.updateMany({
    where: { leagueId, toTeamId: userTeam.id, status: 'PENDING', week: { lt: week - 1 } },
    data: { status: 'EXPIRED' },
  });

  const pendingCount = await prisma.tradeOffer.count({ where: { leagueId, toTeamId: userTeam.id, status: 'PENDING' } });
  if (pendingCount >= MAX_PENDING_OFFERS) return;

  const offer = await maybeGenerateAiTradeOffer(leagueId, userTeam.id, rng, settings.aiTradeFrequency);
  if (!offer) return;

  await prisma.tradeOffer.create({
    data: {
      leagueId, fromTeamId: offer.fromTeamId, toTeamId: userTeam.id,
      give: writeJson(offer.offer.give), request: writeJson(offer.offer.get),
      blurb: offer.blurb, seasonYear, week,
    },
  });
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

    // Every per-player effect below used to be one awaited UPDATE per row —
    // for a 53-man-ish box score that's a hundred-plus sequential round
    // trips per game, times 16 games a week. Collapse each into a single
    // bulk statement instead.
    await bulkSetInt(tx, 'injuryWeeks', Object.entries(fatigueMapToInjuries(result)));
    await bulkSetText(tx, 'injuryType', result.injuries.map((i): [string, string] => [i.playerId, i.type]));
    await bulkIncrementInt(tx, 'fatigue', Object.entries(result.fatigue));

    const newsRows: { leagueId: string; seasonYear: number; week: number; type: string; teamId?: string; headline: string; detail: string }[] = [];
    if (result.injuries.length > 0) {
      newsRows.push({
        leagueId, seasonYear: game.seasonYear, week: game.week, type: 'INJURY',
        headline: `${result.injuries.length} injury report(s) from ${home.abbr} @ ${away.abbr}`,
        detail: result.boxScore.injuries.map((i) => `${i.name} (${i.weeks}w)`).join(', '),
      });
    }
    for (const item of gameHeadlines(result.boxScore, game.homeTeamId, game.awayTeamId)) {
      newsRows.push({ leagueId, seasonYear: game.seasonYear, week: game.week, type: 'NEWS', teamId: item.teamId, headline: item.headline, detail: item.detail });
    }
    if (newsRows.length > 0) await tx.transaction.createMany({ data: newsRows });

    const allLines = [...result.boxScore.lines.home, ...result.boxScore.lines.away];
    const existing = await tx.player.findMany({ where: { id: { in: allLines.map((l) => l.playerId) } }, select: { id: true, seasonStats: true } });
    const existingById = new Map(existing.map((p) => [p.id, p.seasonStats]));
    const statUpdates: [string, string][] = allLines.map((line) => {
      const current = readJson<SeasonStats>(existingById.get(line.playerId), {});
      return [line.playerId, writeJson(mergeStats(current, line.stats))];
    });
    await bulkSetText(tx, 'seasonStats', statUpdates);
  });

  return result;
}

/**
 * Bulk per-row writes via `UPDATE ... FROM (VALUES ...)`. Postgres can do
 * hundreds of independent row updates in one round trip this way — the
 * naive alternative (one `prisma.player.update` per player, awaited in a
 * loop) was the dominant cost of simulating a week, especially against a
 * hosted DB where every round trip pays real network latency.
 */
async function bulkSetInt(tx: Prisma.TransactionClient, column: 'injuryWeeks', entries: [string, number][]) {
  if (entries.length === 0) return;
  const values = Prisma.join(entries.map(([id, v]) => Prisma.sql`(${id}::text, ${v}::int)`));
  await tx.$executeRaw`UPDATE "Player" AS p SET "${Prisma.raw(column)}" = v.val FROM (VALUES ${values}) AS v(id, val) WHERE p.id = v.id`;
}

async function bulkIncrementInt(tx: Prisma.TransactionClient, column: 'fatigue', entries: [string, number][]) {
  if (entries.length === 0) return;
  const values = Prisma.join(entries.map(([id, v]) => Prisma.sql`(${id}::text, ${v}::int)`));
  await tx.$executeRaw`UPDATE "Player" AS p SET "${Prisma.raw(column)}" = p."${Prisma.raw(column)}" + v.val FROM (VALUES ${values}) AS v(id, val) WHERE p.id = v.id`;
}

async function bulkSetText(tx: Prisma.TransactionClient, column: 'seasonStats' | 'careerStats' | 'injuryType', entries: [string, string][]) {
  if (entries.length === 0) return;
  const values = Prisma.join(entries.map(([id, v]) => Prisma.sql`(${id}::text, ${v}::text)`));
  await tx.$executeRaw`UPDATE "Player" AS p SET "${Prisma.raw(column)}" = v.val FROM (VALUES ${values}) AS v(id, val) WHERE p.id = v.id`;
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
  // Was one findMany + one sequential awaited UPDATE per active player in the
  // whole league (~1,700 round trips for a 32-team league) every single
  // week. A single bulk statement does the same work in one round trip.
  await prisma.$executeRaw`
    UPDATE "Player"
    SET "fatigue" = GREATEST("fatigue" - ${SIM.FATIGUE_RECOVERY}, 0),
        "injuryWeeks" = GREATEST("injuryWeeks" - 1, 0),
        "injuryType" = CASE WHEN GREATEST("injuryWeeks" - 1, 0) = 0 THEN NULL ELSE "injuryType" END
    WHERE "leagueId" = ${leagueId} AND "status" = 'ACTIVE' AND ("fatigue" > 0 OR "injuryWeeks" > 0)
  `;
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
    await snapshotSeasonHistory(leagueId, league.seasonYear);
    await recordSeasonAwards(leagueId, league.seasonYear, league.week);
    await fireStrugglingCoordinators(leagueId, league.seasonYear, rng);
    await prisma.league.update({ where: { id: leagueId }, data: { phase: 'OFFSEASON', week: 1 } });
    return { summary: 'The championship game is complete! Welcome to the offseason.' };
  }
  return { summary: 'Playoffs advanced.' };
}

/**
 * Freeze this year's final standings + playoff result into TeamSeasonRecord.
 * Team.wins/losses/etc. get wiped by RESET_STANDINGS a few offseason steps
 * from now — this snapshot is the only place that history survives.
 */
async function snapshotSeasonHistory(leagueId: string, seasonYear: number) {
  const teams = await prisma.team.findMany({ where: { leagueId } });
  const playoffGames = await prisma.game.findMany({ where: { leagueId, seasonYear, kind: { not: 'REGULAR' }, played: true } });

  const ROUND_EXIT: Record<string, string> = { WILDCARD: 'WILDCARD', DIVISIONAL: 'DIVISIONAL', CONFERENCE: 'CONFERENCE', FINAL: 'RUNNER_UP' };
  const resultByTeam = new Map<string, string>();
  for (const g of playoffGames) {
    const loserId = g.homeScore >= g.awayScore ? g.awayTeamId : g.homeTeamId;
    resultByTeam.set(loserId, ROUND_EXIT[g.kind] ?? g.kind);
    if (g.kind === 'FINAL') {
      const winnerId = g.homeScore >= g.awayScore ? g.homeTeamId : g.awayTeamId;
      resultByTeam.set(winnerId, 'CHAMPION');
    }
  }

  for (const t of teams) {
    const playoffResult = resultByTeam.get(t.id) ?? 'MISSED';
    await prisma.teamSeasonRecord.upsert({
      where: { teamId_year: { teamId: t.id, year: seasonYear } },
      create: { leagueId, teamId: t.id, year: seasonYear, wins: t.wins, losses: t.losses, ties: t.ties, pointsFor: t.pointsFor, pointsAgnst: t.pointsAgnst, playoffResult },
      update: { wins: t.wins, losses: t.losses, ties: t.ties, pointsFor: t.pointsFor, pointsAgnst: t.pointsAgnst, playoffResult },
    });
  }

  const championId = [...resultByTeam.entries()].find(([, r]) => r === 'CHAMPION')?.[0];
  const champ = teams.find((t) => t.id === championId);
  if (champ) {
    await prisma.transaction.create({
      data: {
        leagueId, seasonYear, week: 4, type: 'CHAMPION', teamId: champ.id,
        headline: `The ${champ.city} ${champ.nickname} are your ${seasonYear} champions!`,
        detail: `Finished ${champ.wins}-${champ.losses}${champ.ties ? `-${champ.ties}` : ''}, ${champ.pointsFor} points for.`,
      },
    });
  }
}

/**
 * League awards, computed from this season's final stat lines and recorded
 * as Transaction rows (type AWARD) so they persist in the news feed and can
 * drive the end-of-season dashboard announcement — same durability pattern
 * as the CHAMPION transaction right above this call.
 */
async function recordSeasonAwards(leagueId: string, seasonYear: number, week: number) {
  const { computeSeasonAwards } = await import('./awards');
  const awards = await computeSeasonAwards(leagueId, seasonYear);
  const entries: [string, typeof awards.mvp][] = [
    ['AWARD_MVP', awards.mvp],
    ['AWARD_OPOY', awards.opoy],
    ['AWARD_DPOY', awards.dpoy],
    ['AWARD_ROTY', awards.roty],
    ['AWARD_SBMVP', awards.sbmvp],
  ];
  for (const [type, winner] of entries) {
    if (!winner) continue;
    // headline/detail carry only the player's own info (not the award name —
    // that's derived from `type` by every reader) so nothing here needs
    // parsing back apart later.
    await prisma.transaction.create({
      data: {
        leagueId, seasonYear, week, type, teamId: winner.teamId,
        headline: `${winner.name} (${winner.position})`,
        detail: winner.statLine,
      },
    });
    await applyAwardDevelopmentBump(winner.playerId);
  }
}

/**
 * A season award is a real, deliberate jump to both current rating and
 * potential ceiling — bigger than an in-season stat-leader milestone (see
 * lib/development.ts), since it's earned across a full year of production
 * (or, for Super Bowl MVP, a defining performance on the biggest stage)
 * rather than a mid-season snapshot.
 */
async function applyAwardDevelopmentBump(playerId: string) {
  const player = await prisma.player.findUnique({ where: { id: playerId }, select: { trueAttrs: true, position: true, potential: true } });
  if (!player) return;
  const attrs = readJson<AttrMap>(player.trueAttrs, {});
  const bumped = bumpForMilestone(player.position as Position, attrs, player.potential, PROGRESSION.AWARD_OVR_BUMP, PROGRESSION.AWARD_POTENTIAL_BUMP);
  await prisma.player.update({
    where: { id: playerId },
    data: { trueAttrs: writeJson(bumped.attrs), trueOvr: bumped.ovr, potential: bumped.potential },
  });
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
      await progressAllPlayers(leagueId, rng, settings.retirementEnabled);
      await prisma.league.update({ where: { id: leagueId }, data: { week: league.week + 1 } });
      return { summary: 'Rosters have aged a year — some careers are over, the rest are a year further along.' };
    }
    case 'RESET_STANDINGS': {
      await rollSeasonStatsIntoCareer(leagueId);
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
      return { summary: 'Contracts advanced a year — expiring deals are up for renegotiation.' };
    }
    case 'ADD_DRAFT_CLASS': {
      // This year's class was already added back at week 1 of the season
      // that just ended, so it could be scouted all year — this step now
      // only extends the rolling future-picks horizon for pick trading.
      await addFutureDraftPicks(leagueId, league.seasonYear);
      await prisma.league.update({ where: { id: leagueId }, data: { week: league.week + 1 } });
      return { summary: 'Future draft pick slots extended.' };
    }
    case 'RESIGN':
    default: {
      // AI teams make their own keep-or-let-walk calls before the user
      // lands on the re-sign screen, same as a real front office already
      // having a plan by the time the window opens.
      await runAiResignWave(leagueId, league.seasonYear, league.week, settings.capMode, rng);
      await prisma.league.update({ where: { id: leagueId }, data: { phase: 'RESIGN', week: 1 } });
      return { summary: 'Re-sign your own expiring players, then advance to open free agency.' };
    }
  }
}

const FIRE_WIN_PCT_THRESHOLD = 0.3; // [TUNE] roughly 5 wins or fewer in a 17-game season

/**
 * AI-only: a bad enough season gets a coordinator fired, replaced with a
 * freshly generated coach — the same generation used at league creation.
 * User teams are never auto-fired; coaching is the user's call.
 */
async function fireStrugglingCoordinators(leagueId: string, seasonYear: number, rng: Rng) {
  const teams = await prisma.team.findMany({ where: { leagueId, isUser: false } });
  for (const t of teams) {
    const gp = t.wins + t.losses + t.ties;
    if (gp === 0 || t.wins / gp >= FIRE_WIN_PCT_THRESHOLD) continue;

    const coords = await prisma.staff.findMany({ where: { teamId: t.id, role: { in: ['OC', 'DC'] } } });
    if (coords.length === 0) continue;
    const fired = coords.sort((a, b) => a.rating - b.rating)[0];

    const rating = rng.normalClamped(55, 12, 25, 95);
    await prisma.staff.update({
      where: { id: fired.id },
      data: {
        name: `${rng.pick(COACH_FIRST)} ${rng.pick(COACH_LAST)}`,
        rating,
        playCalling: rng.normalClamped(rating, 8, 20, 99),
        development: rng.normalClamped(rating, 10, 20, 99),
        contractYears: rng.int(2, 5),
      },
    });
    await prisma.transaction.create({
      data: {
        leagueId, seasonYear, week: 4, type: 'FIRE', teamId: t.id,
        headline: `${t.city} fires ${fired.role} after a ${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''} season`,
        detail: `${fired.name} is out. The team has promoted a replacement from within.`,
      },
    });
  }
}

/**
 * Fold this year's accumulated seasonStats into careerStats, then clear
 * seasonStats for the new year. Runs for every player who's ever had a stat
 * line, active or not, so a player cut mid-season still keeps what he earned.
 */
async function rollSeasonStatsIntoCareer(leagueId: string) {
  const players = await prisma.player.findMany({
    where: { leagueId, NOT: { seasonStats: '{}' } },
    select: { id: true, seasonStats: true, careerStats: true },
  });
  for (const p of players) {
    const season = readJson<SeasonStats>(p.seasonStats, {});
    if (Object.keys(season).length === 0) continue;
    const career = mergeStats(readJson<SeasonStats>(p.careerStats, {}), season);
    await prisma.player.update({ where: { id: p.id }, data: { careerStats: writeJson(career), seasonStats: '{}' } });
  }
}

/**
 * Yearly aging: age +1, a completed season of experience, and (past 32) a
 * retirement roll. Attribute growth itself no longer happens here — it's
 * spread across in-season checkpoints all year (see lib/development.ts) so
 * it's visible well before the offseason, not delivered as one lump. Batched
 * into two updateMany calls instead of one round trip per player, matching
 * the bulk-write pattern used everywhere else a whole league gets touched.
 */
async function progressAllPlayers(leagueId: string, rng: Rng, retirementEnabled: boolean) {
  const players = await prisma.player.findMany({
    where: { leagueId, status: 'ACTIVE' },
    select: { id: true, age: true, trueOvr: true, position: true },
  });
  if (players.length === 0) return;

  const retiringIds: string[] = [];
  const survivorIds: string[] = [];
  for (const p of players) {
    if (retirementEnabled && p.age >= 32 && rng.bool(retirementChance(p.age, p.trueOvr, p.position as any))) {
      retiringIds.push(p.id);
    } else {
      survivorIds.push(p.id);
    }
  }

  if (retiringIds.length > 0) {
    // Retirement never deleted the player's Contract row (a longstanding
    // bug — every other path off an active roster does), leaving a stale
    // contract attached to a player nobody could ever cut or extend again.
    await prisma.contract.deleteMany({ where: { playerId: { in: retiringIds } } });
    await prisma.player.updateMany({ where: { id: { in: retiringIds } }, data: { status: 'RETIRED', teamId: null } });
  }
  if (survivorIds.length > 0) {
    await prisma.player.updateMany({
      where: { id: { in: survivorIds } },
      data: { age: { increment: 1 }, experience: { increment: 1 }, fatigue: 0, injuryWeeks: 0 },
    });
  }
}

/**
 * Decrement every contract a year. A deal that hits 0 remaining years is
 * NOT released here — that used to happen automatically, which meant
 * every "expiring" player vanished to free agency before the RESIGN phase
 * (where the user is supposed to get a chance to extend them) ever ran.
 * They now sit at 0 years remaining — still rostered, flagged as pending
 * free agents — until releaseUnresignedExpiringContracts() actually lets
 * whichever ones weren't re-signed go, once RESIGN is over.
 */
async function agePlayersAndContracts(leagueId: string) {
  const contracts = await prisma.contract.findMany({ where: { player: { leagueId, status: 'ACTIVE' } } });
  for (const c of contracts) {
    const remaining = Math.max(0, c.yearsRemaining - 1);
    await prisma.contract.update({ where: { id: c.id }, data: { yearsRemaining: remaining } });
  }
  // Dead money charges only apply to the year they were incurred.
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  await prisma.capCharge.deleteMany({ where: { year: { lt: league.seasonYear }, teamId: { in: (await prisma.team.findMany({ where: { leagueId }, select: { id: true } })).map((t) => t.id) } } });
}

/** Free agents that walk: anyone still sitting at 0 years remaining once RESIGN is over — the user (or AI) had their chance to extend and didn't. */
async function releaseUnresignedExpiringContracts(leagueId: string) {
  const expired = await prisma.contract.findMany({ where: { yearsRemaining: 0, player: { leagueId, status: 'ACTIVE' } } });
  for (const c of expired) {
    await prisma.contract.delete({ where: { id: c.id } });
    await prisma.player.update({ where: { id: c.playerId }, data: { status: 'FREE_AGENT', teamId: null } });
  }
}

/**
 * AI-only pass: each AI team decides whether to extend its own expiring
 * (0-years-remaining) players before they'd otherwise walk — the same
 * need/profile-driven logic the rest of the AI GM uses, just applied to
 * "keep your own guy" instead of "sign someone else's."
 */
async function runAiResignWave(leagueId: string, seasonYear: number, week: number, capMode: LeagueSettings['capMode'], rng: Rng) {
  const { parseGmProfile, teamNeeds } = await import('./ai/gm');
  const { marketValue, suggestedYears } = await import('./cap');
  const { extendContract } = await import('./freeagency');

  const teams = await prisma.team.findMany({ where: { leagueId, isUser: false } });
  for (const team of teams) {
    const roster = await prisma.player.findMany({ where: { teamId: team.id, status: 'ACTIVE' }, include: { contract: true } });
    const expiring = roster.filter((p) => p.contract && p.contract.yearsRemaining === 0);
    if (expiring.length === 0) continue;

    const needs = teamNeeds(roster.map((p) => ({ id: p.id, position: p.position, trueOvr: p.trueOvr, age: p.age, potential: p.potential })));
    const profile = parseGmProfile(team.gmProfile, rng);
    const { teamCapSummary } = await import('./cap-summary');

    for (const p of expiring) {
      const summary = await teamCapSummary(team.id, seasonYear, capMode);
      // [TUNE] Keep him if he's still good enough to matter and the team
      // has real room; better players and needier positions get priority.
      const worthKeeping = p.trueOvr >= 62 && (p.trueOvr >= 74 || (needs[p.position] ?? 0) > 0.3);
      const willingness = 0.35 + profile.winNow * 0.3 + (needs[p.position] ?? 0) * 0.35;
      if (!worthKeeping || !rng.bool(willingness)) continue;

      const apy = Math.round(marketValue({ ovr: p.trueOvr, position: p.position as Position, age: p.age, potential: p.potential }) * (0.95 + rng.float(0, 0.15)));
      const years = suggestedYears(p.trueOvr, p.age);
      const usable = summary.capSpace - 3_000_000;
      if (usable < apy) continue;
      await extendContract({ leagueId, playerId: p.id, apy, years, seasonYear, capMode, week }).catch(() => { /* cap edge case — let him walk */ });
    }
  }
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
