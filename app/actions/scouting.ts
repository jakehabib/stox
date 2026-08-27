'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertLeagueOwner, userTeamId } from '@/lib/owner';
import { buildConsensusBoard, type ConsensusRead } from '@/lib/consensus';
import { loadWorkoutSlots, runWorkout, type WorkoutResult, type WorkoutSlots } from '@/lib/workouts';

/**
 * ===========================================================================
 * SCOUTING ACTIONS
 * ===========================================================================
 * ONE mutation lives here, because there is only one thing left in scouting a
 * GM can spend: a private workout.
 *
 * Everything else is free and needs no action at all. The consensus board
 * (lib/consensus.ts) is public from the day the class is generated and is
 * computed straight in the server components that render it. Shortlisted
 * prospects are worked every week at no cost by lib/shortlistAttention.ts,
 * off the season tick rather than off a button.
 *
 * The focus-point economy that used to live here — getScoutPanelAction,
 * scoutPlayerAction, getScoutingBudgetAction — is gone with its pages. A
 * per-player click that cost a currency was the clunk, and charging the GM to
 * find out what the whole league already knew was the design error under it.
 * ===========================================================================
 */

// ---------------------------------------------------------------------------
// PRIVATE WORKOUTS — the current system
// ---------------------------------------------------------------------------

/**
 * Workouts are the only scarce scouting decision left, so the slot ledger is
 * re-derived from the database inside lib/workouts.ts on every call. Nothing
 * a client sends can widen it.
 */

export interface WorkoutPanel extends WorkoutSlots {
  /** Prospects already worked out against this class, so the UI never offers a wasted slot. */
  workedOutPlayerIds: string[];
}

/** Slot count + window state for the workout UI. Safe to call in any phase. */
export async function getWorkoutPanelAction(leagueId: string, _teamId: string): Promise<WorkoutPanel> {
  await assertLeagueOwner(leagueId);
  // WHOSE PANEL IT IS is a fact about the save, not an argument. Handed a club
  // id from another league this listed that club's worked-out prospects, which
  // is a read straight out of somebody else's scouting book. Derived, and the
  // parameter kept so the widget does not change.
  const teamId = await userTeamId(leagueId);
  const slots = await loadWorkoutSlots(leagueId);
  const done = await prisma.scoutingReport.findMany({
    where: { teamId, workoutYear: slots.classYear },
    select: { playerId: true },
  });
  return { ...slots, workedOutPlayerIds: done.map((d) => d.playerId) };
}

/** Spend one workout slot on one prospect. */
export async function runWorkoutAction(leagueId: string, _teamId: string, playerId: string): Promise<WorkoutResult> {
  await assertLeagueOwner(leagueId);
  // The slot ledger is the SAVE's (DynastyProfile is keyed on leagueId), so a
  // request naming an AI club spent the GM's own workout writing a report into
  // a rival's file. `runWorkout` refused a club from another league; it had no
  // opinion about a club from this one. Derived here instead.
  const teamId = await userTeamId(leagueId);
  const result = await runWorkout(leagueId, teamId, playerId);
  if (result.ok) {
    // Same guard the Dynasty actions use: a maintenance script or a balance
    // harness calls this with no request in flight, and a missing cache tag
    // must not turn a write that already committed into an error.
    try { revalidatePath(`/league/${leagueId}`, 'layout'); } catch { /* not in a request context */ }
  }
  return result;
}

// ---------------------------------------------------------------------------
// THE CONSENSUS BOARD — free, public, no action needed to "unlock" anything
// ---------------------------------------------------------------------------

/**
 * The whole class's public grades and ranks. Exposed as an action only for
 * client components; a server component should call buildConsensusBoard
 * directly rather than paying for a round trip.
 *
 * `draftYear` picks the class. Ranks are taken over every prospect in it,
 * INCLUDING any already drafted, so a rank never changes because somebody
 * else came off the board.
 */
export async function getConsensusBoardAction(leagueId: string, draftYear: number): Promise<ConsensusRead[]> {
  await assertLeagueOwner(leagueId);
  // A non-integer year is not a class. Passed NaN, the `draftYear` filter
  // stopped selecting anything in particular and the board came back built
  // over rows that are not a draft class at all.
  if (!Number.isInteger(draftYear)) return [];
  const prospects = await prisma.player.findMany({
    where: { leagueId, draftYear },
    select: {
      id: true, position: true, trueOvr: true, potential: true,
      trueAttrs: true, collegeStats: true, combineTesting: true, injuryWeeks: true,
    },
  });
  return buildConsensusBoard(prospects);
}
