import { prisma } from '../db';
import { readJson, writeJson } from '../json';
import { AttrMap, positionMove } from '../ratings';
import { reconcileDepthChart } from '../gen/league';
import { planPositionConversions } from './positionPlan';

/**
 * ===========================================================================
 * THE AI ACTUALLY MAKES THE MOVE
 * ===========================================================================
 * The DECISION lives in lib/ai/positionPlan.ts and is pure — no database, no
 * RNG, testable from a script. The WRITES live here. They are split for one
 * hard reason: anything reachable from a `use client` component
 * (components/TradeBuilder.tsx imports lib/ai/gm.ts) cannot import `prisma`,
 * and keeping the planner free of it means the AI's reasoning can be checked
 * without a league in the database.
 * ===========================================================================
 */

/**
 * Run the sweep for real, for every club except one.
 *
 * `skipTeamId` is the user's: his roster is his to shape, and a CPU quietly
 * moving his left tackle inside between weeks would be the single most
 * infuriating thing this game could do. Pass nothing (sim:health does) and
 * every club is managed, which is exactly what that harness wants.
 *
 * Each move writes a POSITION transaction linked to the man, so a club
 * reshaping its line is legible afterwards on the wire and on his own card
 * rather than being a rating that silently changed overnight (principle 0 —
 * the world's past has to be readable).
 */
export async function runAiPositionConversions(
  leagueId: string,
  opts: { seasonYear: number; week: number; skipTeamId?: string | null },
): Promise<number> {
  const teams = await prisma.team.findMany({
    where: { leagueId, ...(opts.skipTeamId ? { id: { not: opts.skipTeamId } } : {}) },
    select: { id: true, city: true, nickname: true },
  });
  let moves = 0;

  for (const team of teams) {
    const roster = await prisma.player.findMany({
      where: { teamId: team.id, status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, position: true, trueOvr: true, trueAttrs: true, potential: true },
    });
    const plans = planPositionConversions(
      roster.map((p) => ({ id: p.id, position: p.position, trueOvr: p.trueOvr, trueAttrs: readJson<AttrMap>(p.trueAttrs, {}) })),
    );
    if (plans.length === 0) continue;

    const byId = new Map(roster.map((p) => [p.id, p]));
    for (const plan of plans) {
      const p = byId.get(plan.playerId);
      if (!p) continue;
      // `potential` goes in so it comes back out moved by the same delta the
      // rating moved — see THE CEILING MOVES WITH THE FLOOR in lib/ratings.ts.
      // A CPU club sliding a man along its line has to pay what a user pays.
      const mv = positionMove(
        { position: plan.from, trueOvr: p.trueOvr, trueAttrs: readJson<AttrMap>(p.trueAttrs, {}), potential: p.potential },
        plan.to,
      );
      // `updateMany`, not `update`, and matched on the TEAM as well as the id.
      //
      // This sweep runs over every club in the league from inside the draft,
      // and a roster read at the top of a club's turn is a snapshot: by the
      // time the write lands the man could have been released, retired or
      // traded. `update` throws P2025 on a row that is no longer there, which
      // would abort the draft mid-round over a player nobody minded losing.
      // `updateMany` reports zero rows instead, and zero rows means the move
      // did not happen — so the wire row must not be written either, or the
      // league's history would record a change the roster never made.
      const { count } = await prisma.player.updateMany({
        where: { id: p.id, teamId: team.id },
        data: { position: plan.to, trueAttrs: writeJson(mv.attrs), trueOvr: mv.ovr, potential: mv.potential },
      });
      if (count === 0) continue;
      await prisma.transaction.create({
        data: {
          leagueId,
          seasonYear: opts.seasonYear,
          week: opts.week,
          type: 'POSITION',
          teamId: team.id,
          playerId: p.id,
          headline: `${p.firstName} ${p.lastName} moves from ${plan.from} to ${plan.to}`,
          detail: `${team.city} ${team.nickname} — ${plan.fromOvr} OVR at ${plan.from}, ${mv.ovr} at ${plan.to}.`,
        },
      });
      moves++;
    }
    // Once per club, after its moves: the stale slots go and the converted men
    // are placed at their new positions on merit, by the same rule everything
    // else in this app uses.
    await reconcileDepthChart(team.id);
  }

  return moves;
}
