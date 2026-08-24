import { ONE_MAN_JOB, ROSTER_SATURATION, ROSTER_TARGETS, canonicalPosition, type Position } from './tuning';

/**
 * ===========================================================================
 * ROSTER CONSTRUCTION — HOW MANY OF HIM YOU ALREADY HAVE
 * ===========================================================================
 * `ROSTER_TARGETS` has always had a `max` column and, until this file, nothing
 * in the game read it as a ceiling. Measured across every club in every league
 * in the dev database, EVERY position was over its own stated max somewhere —
 * QB on 9.9% of clubs, the five offensive line spots on 7.8-9.4%, and one
 * roster carrying twelve quarterbacks. The app owner's report was six
 * quarterbacks coming off the board in a row, every one of them to a club that
 * already had a full room.
 *
 * The draft was the biggest single contributor and it is measurable on its
 * own: replaying 200 whole drafts off twenty blind-sampled real leagues
 * (scripts/_rc_probe.ts), 33.2% of all 224 picks were spent at a position the
 * drafting club was ALREADY at or over max in, and 2.5 picks a draft sat
 * inside a run of three-or-more consecutive same-position selections made by
 * clubs that were ALREADY full there — which is the exact thing the owner
 * watched happen. That figure is 0.14 a draft now.
 *
 * THE OTHER CONTRIBUTOR IS EVERY OTHER WAY A CLUB ACQUIRES A PLAYER, and it
 * has the same root: `teamNeeds` in lib/ai/gm.ts could only see holes, never a
 * full room, so a club with five quarterbacks behind a 78 still scored 0.25 at
 * quarterback and cleared free agency's 0.15 bid gate. That is fixed in the
 * same place and by the same function — see the block above `teamNeeds`.
 *
 * WHAT IS *NOT* A CONTRIBUTOR, checked rather than assumed: league generation.
 * `topUpRoster` (lib/gen/league.ts) already refuses to add a body at a position
 * where `held >= spec.max`, and the database agrees — brand-new leagues sit at
 * 0.4% of club-positions over max, against 44.8% at quarterback by a league's
 * fifth season. The drift is entirely in the yearly churn.
 *
 * WHY `max` COULD NOT SIMPLY BECOME A HARD CAP, and this is settled rather
 * than assumed — two earlier findings, both recorded at ROSTER_TARGETS:
 *
 *   1. It is not the number that binds. `topUpRoster` fills a roster by
 *      largest `ideal - held` deficit, so a club holding its one kicker is
 *      never selected again whatever `max` says; replayed over 400 clubs with
 *      max at 1 and then at 2 the composition was identical to two decimals.
 *   2. `max > 1` was ALSO being read as "is this a one-man job" in lib/ai/gm.ts
 *      — so touching the column silently changed a second, unrelated question.
 *      That reading is gone (see `carriesDepth` below); `max` now means the
 *      roster ceiling and only that.
 *
 * AND A CAP IS THE WRONG SHAPE ANYWAY. The house rule on outliers here is to
 * *"make it less likely that those really crazy outliers occur, and they get
 * increasingly less and less likely as they go on"* — shape the distribution,
 * never draw a cliff. A club with a 92 at a position must still be ABLE to
 * take a falling elite prospect there, because lib/ai/gm.ts is explicit that
 * "a perfectly rational AI is unbeatable and boring". So this is a penalty
 * that compounds per body, not a rule that refuses one.
 *
 * IT IS COUNTED, NOT GRADED, and that is deliberate. The obvious refinement —
 * only count the bodies who are actually any good — is a rating threshold on a
 * drifting scale, and this codebase has been bitten by exactly that twice
 * (UNSIGNED_ATTRITION_SHIELD_ABOVE_MEAN and FREE_AGENCY.MIN_UPGRADE_DELTA both
 * carry the scar). Quality is already priced, separately and properly, by
 * `teamNeeds` — a club with three bad quarterbacks scores a big quality need
 * and a club with three good ones scores zero, and that multiplier is applied
 * alongside this one. This function answers only "how many of him do you
 * already have".
 * ===========================================================================
 */

/**
 * Does this position carry a bench that actually plays?
 *
 * This is the question lib/ai/gm.ts used to ask by testing
 * `ROSTER_TARGETS[pos].max > 1`, which happened to give the right answer only
 * because K and P are the two rows where "rosters one body" and "rosters one
 * man who plays" coincide. Asking it off `ONE_MAN_JOB` instead is what frees
 * `max` to mean the roster ceiling and nothing else. Behaviour is unchanged
 * today by construction — every position except K and P has `max >= 2` — and
 * scripts/_rc_probe.ts asserts that equivalence position by position.
 */
export function carriesDepth(pos: string): boolean {
  return !ONE_MAN_JOB.has(canonicalPosition(pos));
}

/**
 * How many bodies a roster holds at each position, retired positions folded in
 * (a stored "FB" counts against RB — see RETIRED_POSITIONS in lib/tuning.ts,
 * and the reason it exists: an unmapped position string silently becomes NaN
 * inside a multiply rather than throwing).
 */
export function positionCounts(roster: { position: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of roster) {
    const pos = canonicalPosition(p.position);
    counts[pos] = (counts[pos] ?? 0) + 1;
  }
  return counts;
}

/**
 * The multiplier a club puts on ADDING ONE MORE body at a position it already
 * holds `held` of. 1 while the room is not yet full; shrinking, and shrinking
 * faster, once it is.
 *
 * Three bands, and the middle one is not padding:
 *
 *   below `ideal`   1.0 — the club is still building the room. Nothing here.
 *   `ideal`..`max`  a mild per-body haircut. `max` exists precisely so a club
 *                   MAY carry one or two past its ideal, so this band is a
 *                   thumb on the scale, not a refusal — at 0.90 a body the
 *                   club is one past ideal on has to be about 11% better than
 *                   the alternative, which a genuinely better player is.
 *   past `max`      the mild decay keeps compounding AND a much steeper one
 *                   starts, so each further body is dramatically harder than
 *                   the last rather than the same step repeated.
 *
 * For a quarterback (ideal 3, max 3, so the mild band is empty) that is: 4th
 * QB 0.315, 5th 0.099, 6th 0.031, 7th 0.0098 — a fourth is a hard sell needing
 * a 3.2x value gap, a seventh needs 102x and effectively cannot happen. That is
 * the shape the brief asked for. It never reaches zero, so a truly generational
 * prospect falling to a stacked club can still be taken; it just has to be
 * worth it.
 */
export function positionSaturation(pos: string, held: number): number {
  const target = ROSTER_TARGETS[canonicalPosition(pos) as Position];
  // An unknown position string cannot be reasoned about; charge it nothing
  // rather than silently returning NaN into a valuation. (Same failure mode
  // the RETIRED_POSITIONS alias in lib/tuning.ts exists to prevent.)
  if (!target) return 1;
  const arriving = held + 1;
  const pastIdeal = arriving - target.ideal;
  if (pastIdeal <= 0) return 1;
  const pastMax = arriving - target.max;
  const mild = Math.pow(ROSTER_SATURATION.PAST_IDEAL_DECAY, pastIdeal);
  return pastMax > 0 ? mild * Math.pow(ROSTER_SATURATION.PAST_MAX_DECAY, pastMax) : mild;
}

/** Bodies held at `pos` in a `positionCounts` map, read through the same alias. */
export function heldAt(counts: Record<string, number>, pos: string): number {
  return counts[canonicalPosition(pos)] ?? 0;
}
