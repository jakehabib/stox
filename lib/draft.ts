import { prisma } from './db';
import { Rng } from './rng';
import { readJson, writeJson } from './json';
import { buildContract, rookieScaleApy } from './cap';
import { parseGmProfile, playerValue, teamNeeds, RosterPlayer, defaultGmProfile } from './ai/gm';
import { AI, LEAGUE, Position } from './tuning';
import { reconcileDepthChart } from './gen/league';

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

  if (state.kind === 'FANTASY') {
    // The fantasy draft has no DraftPick rows to consult — it's a plain
    // snake of team turns, so the stored order is the whole story.
    const order = readJson<string[]>(state.order, []);
    if (order.length === 0) return null;
    const teamId = order[state.pickIndex % order.length];
    if (!teamId) return null;
    return { state, teamId, pick: null as null };
  }

  // Rookie draft: resolve the pick on the clock from LIVE DraftPick
  // ownership every time, instead of a turn-order array computed once at
  // draft start. That array was always built from round 1's pick ownership
  // and then reused verbatim for every later round (see reseedDraftOrder),
  // so it silently ignored any trade involving a round-2+ pick: the team
  // that traded that pick away still got a turn (and, since it owned no
  // unused pick that round, drafted the player for free — no contract, no
  // pick consumed), while the team that acquired it never got an extra turn
  // to use it. Querying the actual DraftPick row for this exact
  // (round, slot) is both simpler and correct for every round, since
  // reseedDraftOrder already reseeds every round's slot from standings, not
  // just round 1's.
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const roundSize = LEAGUE.TEAM_COUNT;
  const round = Math.floor(state.pickIndex / roundSize) + 1;
  const slot = (state.pickIndex % roundSize) + 1;
  const pick = await prisma.draftPick.findFirst({ where: { leagueId, year: league.seasonYear, round, slot } });
  if (!pick) return null;
  return { state, teamId: pick.ownerTeamId, pick };
}

export async function draftPlayer(opts: {
  leagueId: string; playerId: string; teamId: string; seasonYear: number;
}) {
  const pickInfo = await currentPick(opts.leagueId);
  if (!pickInfo) throw new Error('Draft is not active.');
  if (pickInfo.teamId !== opts.teamId) throw new Error('It is not this team\'s pick.');

  const isFantasy = pickInfo.state.kind === 'FANTASY';

  /**
   * A rookie deal is real cap money and was the one acquisition path with no
   * check at all. It's also the one transaction a team can't decline, so the
   * two sides are handled differently WITHOUT giving either an exemption:
   *   - the user is blocked, with the same specific CapViolationError every
   *     other move throws, and has to clear room before picking;
   *   - an AI team clears its own room first (autoClearCapRoom releases the
   *     fewest positive-savings veterans that cover the bill) — the same
   *     price a real front office pays to fit its rookie pool — rather than
   *     stalling the draft for everyone.
   */
  if (!isFantasy && pickInfo.pick) {
    const { parseSettings } = await import('./settings');
    const leagueRow = await prisma.league.findUniqueOrThrow({ where: { id: opts.leagueId } });
    const capMode = parseSettings(leagueRow.settings).capMode;
    if (capMode !== 'OFF') {
      const { assertCapRoom, autoClearCapRoom } = await import('./capEnforcement');
      const { capHit } = await import('./cap');
      const { teamCapSummary } = await import('./cap-summary');
      const overall = (pickInfo.pick.round - 1) * LEAGUE.TEAM_COUNT + pickInfo.pick.slot;
      const rookie = buildContract({
        apy: rookieScaleApy(overall, LEAGUE.TEAM_COUNT * 7),
        years: 4, signedYear: opts.seasonYear, isRookieDeal: true, bonusPct: 0.4,
      });
      const hit = capHit({ ...rookie, baseSalaries: writeJson(rookie.baseSalaries) }, capMode);
      const team = await prisma.team.findUniqueOrThrow({ where: { id: opts.teamId }, select: { isUser: true } });

      if (team.isUser) {
        // The draft is the one transaction a team cannot decline, and DRAFT is
        // the one phase where "advance the week" is not an action the user can
        // take (advanceWeek answers "make your picks, then advance" and moves
        // nothing). So a user whose dead money alone exceeds the ceiling used
        // to be deadlocked on the clock with no exit at all: the pick was
        // blocked, the week would not move, and there is no pass/forfeit
        // action. The same escape valve lib/season.ts's compliance block
        // already uses applies here — block only while a way out still
        // exists; if no combination of cuts can cover the bill, the pick goes
        // through and the standing over-cap warning carries it, exactly like
        // the AI's autoClearCapRoom fallback below.
        const { capComplianceReport } = await import('./capEnforcement');
        const summary = await teamCapSummary(opts.teamId, opts.seasonYear, capMode);
        const shortfall = hit - summary.capSpace;
        if (shortfall > 0) {
          const report = await capComplianceReport(opts.teamId, opts.seasonYear, capMode, { alwaysRelief: true });
          if (report.maxCutRelief >= shortfall) {
            await assertCapRoom({ action: 'Rookie deal', seasonYear: opts.seasonYear, capMode, charges: [{ teamId: opts.teamId, delta: hit }] });
          }
        }
      } else {
        const summary = await teamCapSummary(opts.teamId, opts.seasonYear, capMode);
        const shortfall = hit - summary.capSpace;
        // Still short after cutting everyone who frees anything? Then no
        // legal roster exists and blocking would deadlock the draft — the
        // pick goes through, exactly like the user's escape valve in
        // lib/season.ts's compliance block.
        if (shortfall > 0) {
          await autoClearCapRoom({
            leagueId: opts.leagueId, teamId: opts.teamId, needed: shortfall,
            seasonYear: opts.seasonYear, capMode, week: leagueRow.week,
          });
        }
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.player.update({
      where: { id: opts.playerId },
      data: { teamId: opts.teamId, status: 'ACTIVE', isDraftee: false },
    });

    if (!isFantasy && pickInfo.pick) {
      // Consume the exact pick currentPick() resolved as on the clock —
      // there's only ever one candidate now, not "any unused pick this team
      // happens to own this round" (which could silently be a different
      // pick than the one actually on the clock once trades are involved).
      const pick = pickInfo.pick;
      const player = await tx.player.findUniqueOrThrow({ where: { id: opts.playerId } });
      const overall = (pick.round - 1) * LEAGUE.TEAM_COUNT + pick.slot;
      const apy = rookieScaleApy(overall, LEAGUE.TEAM_COUNT * 7);
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
          playerId: opts.playerId,
          headline: `Round ${pick.round}, Pick ${pick.slot}: ${player.firstName} ${player.lastName} (${player.position})` },
      });
    } else if (isFantasy) {
      const player = await tx.player.findUniqueOrThrow({ where: { id: opts.playerId } });
      await tx.transaction.create({
        data: { leagueId: opts.leagueId, seasonYear: opts.seasonYear, week: 0, type: 'DRAFT', teamId: opts.teamId,
          playerId: opts.playerId,
          headline: `Fantasy draft: ${player.firstName} ${player.lastName} (${player.position})` },
      });
    }

    const league = await tx.league.findUniqueOrThrow({ where: { id: opts.leagueId } });
    const { parseSettings } = await import('./settings');
    const rounds = parseSettings(league.settings).draftRounds;
    await advancePick(tx as any, opts.leagueId, pickInfo.state, isFantasy, rounds);
  });

  /**
   * The rookie takes a slot on merit — behind the last man on the chart who
   * out-rates him — instead of the whole chart being rebuilt by rating, which
   * is what `autoDepthChart` did here and which threw away the user's hand-set
   * order on every single pick they made.
   */
  await reconcileDepthChart(opts.teamId);
}

async function advancePick(tx: typeof prisma, leagueId: string, state: { pickIndex: number; round: number; order: string }, isFantasy: boolean, rounds: number) {
  const nextIndex = state.pickIndex + 1;

  if (isFantasy) {
    const order = readJson<string[]>(state.order, []);
    const done = nextIndex >= order.length;
    await tx.draftState.update({
      where: { leagueId },
      data: { pickIndex: nextIndex, complete: done },
    });
    return;
  }

  const roundSize = LEAGUE.TEAM_COUNT;
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

/**
 * Make exactly ONE AI pick (a no-op if the user is already on the clock),
 * for a live, paced draft-day feed — one visible pick at a time instead of
 * a single opaque batch — rather than fast-forwarding an entire batch of
 * turns silently. Returns null when there's nothing to do right now.
 */
export async function draftOneAiPick(leagueId: string, userTeamId: string, rng: Rng, seasonYear: number) {
  const pickInfo = await currentPick(leagueId);
  if (!pickInfo || pickInfo.teamId === userTeamId) return null;

  const player = await pickBestAvailable(leagueId, pickInfo.teamId, rng);
  if (!player) return null;

  const team = await prisma.team.findUniqueOrThrow({ where: { id: pickInfo.teamId } });
  await draftPlayer({ leagueId, playerId: player.id, teamId: pickInfo.teamId, seasonYear });
  return {
    teamName: `${team.city} ${team.nickname}`,
    playerName: `${player.firstName} ${player.lastName}`,
    position: player.position,
    round: pickInfo.pick?.round ?? pickInfo.state.round,
  };
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

/** Worst record first, tie-broken by point differential — the real draft-order rule, used both to actually reseed and to project it live mid-season. */
function standingsOrder<T extends { id: string; wins: number; losses: number; ties: number; pointsFor: number; pointsAgnst: number }>(teams: T[]): T[] {
  return [...teams].sort((a, b) => {
    const pctA = a.wins / Math.max(1, a.wins + a.losses + a.ties);
    const pctB = b.wins / Math.max(1, b.wins + b.losses + b.ties);
    if (pctA !== pctB) return pctA - pctB;
    return a.pointsFor - a.pointsAgnst - (b.pointsFor - b.pointsAgnst);
  });
}

/** Reseed round-1 pick slots (and every round) from final standings, worst first. */
export async function reseedDraftOrder(leagueId: string, seasonYear: number) {
  const teams = await prisma.team.findMany({ where: { leagueId } });
  const order = standingsOrder(teams);
  const picks = await prisma.draftPick.findMany({ where: { leagueId, year: seasonYear } });
  for (const pick of picks) {
    const slot = order.findIndex((t) => t.id === pick.originalTeamId) + 1;
    if (slot > 0) await prisma.draftPick.update({ where: { id: pick.id }, data: { slot } });
  }
}

/**
 * "If the season ended right now" draft order, by originalTeamId — the same
 * worst-first rule reseedDraftOrder applies at year's end, computed live
 * from whatever wins/losses/points exist at this exact moment. Lets the
 * trade screen show (and price) a current-year pick's likely slot well
 * before the real reseed happens, instead of the meaningless placeholder
 * DraftPick.slot carries until then (it's only ever set once, right before
 * that year's draft).
 */
export async function projectedDraftOrder(leagueId: string): Promise<Map<string, number>> {
  const teams = await prisma.team.findMany({ where: { leagueId } });
  const order = standingsOrder(teams);
  return new Map(order.map((t, i) => [t.id, i + 1]));
}

/**
 * The next draft that hasn't happened yet — the smallest DraftPick.year
 * with any unused pick. Deliberately NOT "league.seasonYear" or
 * "seasonYear + 1": which one actually matches depends on where in the
 * phase machine the league currently sits (DraftPick.year for the upcoming
 * draft is pre-generated as seasonYear + 1 and stays that way all the way
 * through the season, but RESET_STANDINGS bumps seasonYear to match it
 * partway through the offseason, before that draft actually runs) — so
 * comparing against seasonYear directly is only right some of the time.
 * "Smallest unused year" is well-defined everywhere in between.
 */
export async function imminentDraftYear(leagueId: string): Promise<number | null> {
  const next = await prisma.draftPick.findFirst({ where: { leagueId, used: false }, orderBy: { year: 'asc' }, select: { year: true } });
  return next?.year ?? null;
}

export async function startRookieDraft(leagueId: string, seasonYear: number, rng: Rng) {
  // `order` is unused for ROOKIE drafts — currentPick() resolves the team on
  // the clock from live DraftPick ownership every round instead (see there
  // for why a fixed turn-order array doesn't work once picks get traded).
  await prisma.draftState.deleteMany({ where: { leagueId } });
  await prisma.draftState.create({
    data: { leagueId, kind: 'ROOKIE', round: 1, pickIndex: 0, order: writeJson([]), complete: false },
  });
  await prisma.league.update({ where: { id: leagueId }, data: { phase: 'DRAFT' } });
}
