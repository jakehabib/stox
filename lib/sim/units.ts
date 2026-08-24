import {
  SIM, OFFENSE_UNIT_WEIGHTS, DEFENSE_UNIT_WEIGHTS, UNIT_DEPTH_WEIGHTS, Position,
} from '../tuning';

export interface SimPlayer {
  id: string;
  firstName: string;
  lastName: string;
  position: string;
  trueOvr: number;
  trueAttrs: string;
  status: string;
  injuryWeeks: number;
  fatigue: number;
}

export interface SimStaff {
  role: string;
  playCalling: number;
  rating: number;
}

export interface UnitRatings {
  off: number;
  def: number;
  special: number;
  byPosition: Record<string, number>;
  /** Who is actually on the field, in depth order, per position. */
  depth: Record<string, SimPlayer[]>;
}

export function isAvailable(p: SimPlayer): boolean {
  return p.status !== 'RETIRED' && p.injuryWeeks <= 0;
}

/** Effective rating after fatigue. [TUNE] fatigue costs up to ~4 rating points. */
export function effectiveRating(p: SimPlayer): number {
  const fatiguePenalty = (p.fatigue / 100) * 4;
  return Math.max(20, p.trueOvr - fatiguePenalty);
}

/**
 * [TUNE] Rating of the "guy off the street" who fills an empty slot.
 *
 * EXPORTED because the AI has to answer the same question when it values a
 * player — "what happens at right tackle if nobody is behind him" — and the
 * honest answer is whatever the sim would actually field there. `rosterFit`
 * in lib/ai/gm.ts scores an empty depth-chart slot at exactly this. A second
 * constant would let the AI price a league the engine does not play.
 */
export const REPLACEMENT_LEVEL = 48;

/**
 * Weighted positional unit rating: the starter carries most of the weight, but
 * depth matters (see UNIT_DEPTH_WEIGHTS). If a team is short-handed at a
 * position, the missing slots are filled with a replacement-level value so a
 * roster hole actually hurts.
 */
export function positionUnitRating(players: SimPlayer[], position: Position): number {
  const weights = UNIT_DEPTH_WEIGHTS[position] ?? [1];
  const sorted = [...players].sort((a, b) => effectiveRating(b) - effectiveRating(a));
  let sum = 0;
  let wTotal = 0;
  for (let i = 0; i < weights.length; i++) {
    const rating = sorted[i] ? effectiveRating(sorted[i]) : REPLACEMENT_LEVEL;
    sum += rating * weights[i];
    wTotal += weights[i];
  }
  return wTotal > 0 ? sum / wTotal : REPLACEMENT_LEVEL;
}

/*
 * ---------------------------------------------------------------------------
 * THERE IS NO SCHEME FIT ANY MORE, AND THE COMMENT THAT USED TO SIT HERE WAS
 * WRONG ON ITS OWN ARITHMETIC
 * ---------------------------------------------------------------------------
 * `schemeFit` returned 0..1 for how well a roster matched one of five named
 * schemes, and `computeUnits` paid it out as `(fit - 0.5) * 2 * SCHEME_FIT_MAX`
 * on BOTH sides of the ball. Its docstring read "Balanced schemes are never a
 * bad fit", justifying the hard-coded 0.5 it returned for an empty emphasis
 * list. That claim was false in the only sense that mattered. Measured over 96
 * clubs, the rating points the term actually added:
 *
 *     Air Raid +1.04   West Coast +1.34   Balanced 0.00
 *     Spread Option +1.13   Power Run +1.28
 *
 * A Balanced club was not "never a bad fit" — it was 1.2 rating points behind
 * the field, every week, because 0.5 is only neutral on the 0..1 scale and a
 * typical 75-rated starter scores about 0.7. Four fifths of the league drew an
 * unconditional bonus and the other fifth paid for it.
 *
 * The app owner's ruling was to delete rather than repair: *"I don't like the
 * bonus points for scheme fits."* So the term, the five scheme names and
 * SCHEME_EMPHASIS are all gone. How often a club throws it now lives in
 * lib/sim/tendency.ts, where it is a play-call rate and not a rating bonus.
 *
 * WHAT THAT COST, AND WHY OFFENSE_BASELINE EXISTS. The term was on both sides
 * of a subtraction — the drive loop only ever reads `off - def` — so most of it
 * cancelled. What did not cancel is that the OFFENSIVE emphasis lists happened
 * to score higher than the DEFENSIVE ones: +1.01 mean against +0.64, a net
 * +0.37 rating points of offensive edge that the 137a1e2 calibration was
 * performed with. Deleting the term without replacing that constant moved
 * league scoring by -0.34 points and total yards by -2.31 a game, consistently
 * on all three seed-sets. See SIM.OFFENSE_BASELINE.
 */

/**
 * Order one position group against a depth chart that may not mention
 * everybody in it.
 *
 * THE RULE FOR A PLAYER THE CHART DOES NOT NAME: he goes immediately behind
 * the last named player who out-rates him, and ahead of everyone he out-rates.
 *
 * This used to be "behind all of them", via a rank of `1000 + (99 - rating)`,
 * and that was a silent failure mode rather than a policy. A depth chart is
 * written by exactly two things — league creation and an explicit auto-sort —
 * and for a long time nothing wrote one when a player ARRIVED. So a player
 * acquired by trade was on the roster, absent from the chart, and therefore
 * ranked behind every man at his position: a 97-overall receiver lined up
 * behind a 57 and recorded nothing at all for his new club, with no error and
 * nothing in the UI to show for it. The arrival paths are fixed at source now
 * (see reconcileDepthChart in lib/gen/league.ts, called from every one of
 * them), but "unlisted means worst on the roster" is not a safe default to
 * leave lying under a sim that plays every game in the league. An omission is
 * an absence of information, not a demotion, and the only information actually
 * available about an unlisted player is his rating.
 *
 * What it deliberately does NOT do is re-sort the named players, or let an
 * unlisted player leapfrog one. A GM who ranks a 74-overall rookie ahead of a
 * 78-overall veteran means it, and an unlisted 76 arriving does not overrule
 * him: that 76 lands behind the veteran, because the veteran is the last named
 * man who out-rates him. Explicit intent still beats rating every time; rating
 * only decides what intent never spoke to.
 *
 * `reconcileDepthChart` writes charts using this same rule, so repairing the
 * data can never change who the sim was already going to play.
 */
export function mergeUnnamed(players: SimPlayer[], override: string[]): SimPlayer[] {
  const rank = new Map(override.map((id, i) => [id, i]));
  const named = players.filter((p) => rank.has(p.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  // Best first, so several unnamed players also come out in rating order
  // relative to each other.
  const unnamed = players.filter((p) => !rank.has(p.id)).sort((a, b) => effectiveRating(b) - effectiveRating(a));
  if (unnamed.length === 0) return named;

  const order = named;
  for (const p of unnamed) {
    let at = 0;
    for (let i = 0; i < order.length; i++) if (effectiveRating(order[i]) > effectiveRating(p)) at = i + 1;
    order.splice(at, 0, p);
  }
  return order;
}

export function computeUnits(
  players: SimPlayer[],
  staff: SimStaff[],
  /**
   * User-set depth chart: position -> ordered player ids. A player the chart
   * does not name is slotted in ON MERIT rather than dumped at the bottom —
   * see the sort below. Injured players are skipped regardless of where the
   * chart puts them.
   */
  depthOrder?: Record<string, string[]>,
): UnitRatings {
  const available = players.filter(isAvailable);
  const depth: Record<string, SimPlayer[]> = {};
  for (const p of available) {
    (depth[p.position] ??= []).push(p);
  }
  for (const key of Object.keys(depth)) {
    const override = depthOrder?.[key];
    if (override && override.length > 0) {
      depth[key] = mergeUnnamed(depth[key], override);
    } else {
      depth[key].sort((a, b) => effectiveRating(b) - effectiveRating(a));
    }
  }

  const byPosition: Record<string, number> = {};
  for (const pos of Object.keys({ ...OFFENSE_UNIT_WEIGHTS, ...DEFENSE_UNIT_WEIGHTS, K: 1, P: 1 })) {
    byPosition[pos] = positionUnitRating(depth[pos] ?? [], pos as Position);
  }

  const weightedSum = (weights: Partial<Record<Position, number>>) => {
    let sum = 0;
    let wTotal = 0;
    for (const [pos, w] of Object.entries(weights)) {
      sum += (byPosition[pos] ?? REPLACEMENT_LEVEL) * (w as number);
      wTotal += w as number;
    }
    return wTotal > 0 ? sum / wTotal : REPLACEMENT_LEVEL;
  };

  const oc = staff.find((s) => s.role === 'OC');
  const dc = staff.find((s) => s.role === 'DC');
  const hc = staff.find((s) => s.role === 'HC');

  // Coordinator contribution: play-calling above/below the 50 baseline, plus a
  // smaller head-coach term applied to both sides of the ball. [TUNE]
  const coordBonus = (s?: SimStaff) => (s ? ((s.playCalling - 50) / 10) * SIM.COORD_WEIGHT : 0);
  const hcBonus = hc ? ((hc.rating - 50) / 10) * SIM.COORD_WEIGHT * 0.5 : 0;

  return {
    // OFFENSE_BASELINE replaces the net offensive edge the deleted scheme-fit
    // term used to carry. It is calibration residue made explicit, not a new
    // mechanic: it is the same number for every club in every game.
    off: weightedSum(OFFENSE_UNIT_WEIGHTS) + coordBonus(oc) + hcBonus + SIM.OFFENSE_BASELINE,
    def: weightedSum(DEFENSE_UNIT_WEIGHTS) + coordBonus(dc) + hcBonus,
    special: (byPosition.K ?? REPLACEMENT_LEVEL) * 0.6 + (byPosition.P ?? REPLACEMENT_LEVEL) * 0.4,
    byPosition,
    depth,
  };
}
