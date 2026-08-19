import { prisma } from './db';
import { Rng } from './rng';
import { readJson, writeJson } from './json';
import { buildContract, rookieScaleApy } from './cap';
import { parseGmProfile, playerValue, teamNeeds, RosterPlayer, defaultGmProfile } from './ai/gm';
import { AI, Position } from './tuning';
import { autoDepthChart } from './gen/league';

/**
 * ===========================================================================
 * DRAFT SYSTEM (design doc section 12)
 * ===========================================================================
 * Works for both the annual rookie draft and the league-start fantasy draft
 * off the same DraftState row + a snake/linear pick order. The AI GM picks by
 * blending best-player-available (scaled by the true rating it can see — the
 * league office doesn't have fog of war) with positional need, using the same
 * profile-driven bias as free agency and trades, plus a small "reach" chance
 * for variance.
 * ===========================================================================
 */

export async function currentPick(leagueId: string) {
  const state = await prisma.draftState.findUnique({ where: { leagueId } });
  if (!state || state.complete) return null;
  const order = readJson<string[]>(state.order, []);
  if (order.length === 0) return null;
  // `order` only ever holds ONE round's worth of teams (the standings-based
  // turn order, reseeded identically every round — see reseedDraftOrder) but
  // pickIndex climbs across the WHOLE multi-round draft. Indexing it
  // directly instead of modulo meant every draft broke the instant round 2
  // started: order[32] is undefined, so nobody was ever "on the clock" past
  // round 1. Whichever pick a team actually owns in the current round is
  // still resolved separately in draftPlayer(), so this only decides turn
  // order, not which specific pick gets consumed.
  const teamId = order[state.pickIndex % order.length];
  if (!teamId) return null;
  return { state, teamId, order };
}

export async function draftPlayer(opts: {
  leagueId: string; playerId: string; teamId: string; seasonYear: number;
}) {
  const pickInfo = await currentPick(opts.leagueId);
  if (!pickInfo) throw new Error('Draft is not active.');
  if (pickInfo.teamId !== opts.teamId) throw new Error('It is not this team\'s pick.');

  const isFantasy = pickInfo.state.kind === 'FANTASY';

  await prisma.$transaction(async (tx) => {
    await tx.player.update({
      where: { id: opts.playerId },
      data: { teamId: opts.teamId, status: 'ACTIVE', isDraftee: false },
    });

    if (!isFantasy) {
      // Find & consume this team's earliest unused pick in the current round.
      const pick = await tx.draftPick.findFirst({
        where: { leagueId: opts.leagueId, ownerTeamId: opts.teamId, round: pickInfo.state.round, used: false },
        orderBy: { slot: 'asc' },
      });
      if (pick) {
        const player = await tx.player.findUniqueOrThrow({ where: { id: opts.playerId } });
        const overall = (pick.round - 1) * pickInfo.order.length + pick.slot;
        const apy = rookieScaleApy(overall, pickInfo.order.length * 7);
        const contract = buildContract({ apy, years: 4, signedYear: opts.seasonYear, isRookieDeal: true, bonusPct: 0.4 });
        await tx.draftPick.update({ where: { id: pick.id }, data: { used: true, playerId: opts.playerId } });
        await tx.contract.deleteMany({ where: { playerId: opts.playerId } });
        await tx.contract.create({
          data: {
            playerId: opts.playerId, teamId: opts.teamId, years: contract.years, yearsRemaining: contract.years,
            signedYear: contract.signedYear, baseSalaries: writeJson(contract.baseSalaries),
            signingBonus: contract.signingBonus, guaranteed: contract.guaranteed, isRookieDeal: true,
          },
        });
        await tx.player.update({ where: { id: opts.playerId }, data: { draftYear: opts.seasonYear, draftRound: pick.round, draftPickNo: overall } });
        await tx.transaction.create({
          data: { leagueId: opts.leagueId, seasonYear: opts.seasonYear, week: 0, type: 'DRAFT', teamId: opts.teamId,
            headline: `Round ${pick.round}, Pick ${pick.slot}: ${player.firstName} ${player.lastName} (${player.position})` },
        });
      }
    } else {
      const player = await tx.player.findUniqueOrThrow({ where: { id: opts.playerId } });
      await tx.transaction.create({
        data: { leagueId: opts.leagueId, seasonYear: opts.seasonYear, week: 0, type: 'DRAFT', teamId: opts.teamId,
          headline: `Fantasy draft: ${player.firstName} ${player.lastName} (${player.position})` },
      });
    }

    const league = await tx.league.findUniqueOrThrow({ where: { id: opts.leagueId } });
    const { parseSettings } = await import('./settings');
    const rounds = parseSettings(league.settings).draftRounds;
    await advancePick(tx as any, opts.leagueId, pickInfo.state, isFantasy, rounds);
  });

  await autoDepthChart(opts.teamId);
}

async function advancePick(tx: typeof prisma, leagueId: string, state: { pickIndex: number; round: number; order: string }, isFantasy: boolean, rounds: number) {
  const order = readJson<string[]>(state.order, []);
  const nextIndex = state.pickIndex + 1;

  if (isFantasy) {
    const done = nextIndex >= order.length;
    await tx.draftState.update({
      where: { leagueId },
      data: { pickIndex: nextIndex, complete: done },
    });
    return;
  }

  const roundSize = order.length;
  const nextRound = Math.floor(nextIndex / roundSize) + 1;
  const done = nextRound > rounds;
  await tx.draftState.update({
    where: { leagueId },
    data: { pickIndex: nextIndex, round: Math.min(nextRound, rounds), complete: done },
  });
}

/**
 * Run every consecutive AI pick until it's the user's turn again (or the
 * draft ends). Safe to call repeatedly — it's a no-op once it hits the user.
 */
export async function runAiPicksUntilUser(leagueId: string, userTeamId: string, rng: Rng, seasonYear: number) {
  let picksMade = 0;
  for (let i = 0; i < 500; i++) {
    const pickInfo = await currentPick(leagueId);
    if (!pickInfo) break;
    if (pickInfo.teamId === userTeamId) break;

    const player = await pickBestAvailable(leagueId, pickInfo.teamId, rng);
    if (!player) break;
    await draftPlayer({ leagueId, playerId: player.id, teamId: pickInfo.teamId, seasonYear });
    picksMade += 1;
  }
  return picksMade;
}

async function pickBestAvailable(leagueId: string, teamId: string, rng: Rng) {
  const pool = await prisma.player.findMany({
    where: { leagueId, teamId: null, status: { in: ['FREE_AGENT'] }, OR: [{ isDraftee: true }] },
    orderBy: { trueOvr: 'desc' },
    take: 60,
  });
  const usable = pool.length > 0 ? pool : await prisma.player.findMany({
    where: { leagueId, teamId: null, status: 'FREE_AGENT' }, orderBy: { trueOvr: 'desc' }, take: 60,
  });
  if (usable.length === 0) return null;

  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
  const roster = await prisma.player.findMany({ where: { teamId }, select: { id: true, position: true, trueOvr: true, age: true, potential: true } });
  const profile = parseGmProfile(team.gmProfile, rng);
  const needs = teamNeeds(roster as RosterPlayer[]);

  let board = usable
    .map((p) => {
      const posValue = AI.DRAFT_POSITION_VALUE[p.position as Position] ?? 1;
      const base = playerValue(p as unknown as RosterPlayer, { profile, needs, rng }) * (1 - profile.bpaBias * 0.15) + p.trueOvr * profile.bpaBias * 0.6;
      return { p, value: base * posValue };
    })
    .sort((a, b) => b.value - a.value);

  // Occasionally reach into the board rather than always taking BPA-by-value.
  if (rng.bool(AI.DRAFT_REACH_CHANCE) && board.length > AI.DRAFT_REACH_DEPTH) {
    const idx = rng.int(1, Math.min(AI.DRAFT_REACH_DEPTH, board.length - 1));
    return board[idx].p;
  }
  return board[0].p;
}

/** Reseed round-1 pick slots (and every round) from final standings, worst first. */
export async function reseedDraftOrder(leagueId: string, seasonYear: number) {
  const teams = await prisma.team.findMany({ where: { leagueId } });
  const order = [...teams].sort((a, b) => {
    const pctA = a.wins / Math.max(1, a.wins + a.losses + a.ties);
    const pctB = b.wins / Math.max(1, b.wins + b.losses + b.ties);
    if (pctA !== pctB) return pctA - pctB;
    return a.pointsFor - a.pointsAgnst - (b.pointsFor - b.pointsAgnst);
  });
  const picks = await prisma.draftPick.findMany({ where: { leagueId, year: seasonYear } });
  for (const pick of picks) {
    const slot = order.findIndex((t) => t.id === pick.originalTeamId) + 1;
    if (slot > 0) await prisma.draftPick.update({ where: { id: pick.id }, data: { slot } });
  }
}

export async function startRookieDraft(leagueId: string, seasonYear: number, rng: Rng) {
  const teams = await prisma.team.findMany({ where: { leagueId }, orderBy: { id: 'asc' } });
  const round1Picks = await prisma.draftPick.findMany({ where: { leagueId, year: seasonYear, round: 1 }, orderBy: { slot: 'asc' } });
  const order = round1Picks.length ? round1Picks.map((p) => p.ownerTeamId) : teams.map((t) => t.id);

  await prisma.draftState.deleteMany({ where: { leagueId } });
  await prisma.draftState.create({
    data: { leagueId, kind: 'ROOKIE', round: 1, pickIndex: 0, order: writeJson(order), complete: false },
  });
  await prisma.league.update({ where: { id: leagueId }, data: { phase: 'DRAFT' } });
}
