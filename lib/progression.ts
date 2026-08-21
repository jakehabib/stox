import { Rng, clamp } from './rng';
import { AGE_CURVE, DEV_TRAIT_MULT, POSITION_AGE_PROFILE, DEFAULT_AGE_PROFILE, Position } from './tuning';
import { AttrMap, attrsForPosition, computeOverall, POSITION_WEIGHTS } from './ratings';

/**
 * Player development (design doc section 13). Growth is applied in scaled
 * rolls — a full offseason roll (scale 1) or a fraction of one at an
 * in-season checkpoint (see lib/development.ts) — each of which:
 *   1. Looks up the position-adjusted, age-based growth mean from AGE_CURVE.
 *   2. Scales it by the player's dev trait multiplier, the roll's own scale,
 *      and the league progressionSpeed setting.
 *   3. Rolls a per-attribute delta, capped by remaining room to potential.
 * Retirement is a separate roll for players past a certain age (section 13).
 */
export function growthMean(age: number, position?: Position): number {
  const profile = (position && POSITION_AGE_PROFILE[position]) || DEFAULT_AGE_PROFILE;
  const effectiveAge = age - profile.peakShift;
  let growth = AGE_CURVE[AGE_CURVE.length - 1].growth;
  for (const b of AGE_CURVE) {
    if (effectiveAge <= b.maxAge) { growth = b.growth; break; }
  }
  return growth < 0 ? growth * profile.declineMult : growth;
}

export function progressPlayer(
  rng: Rng,
  position: Position,
  attrs: AttrMap,
  age: number,
  potential: number,
  devTrait: string,
  speedMult: number,
  /** Fraction of a full roll to apply — 1 for a full offseason roll, less for an in-season checkpoint. */
  scale: number = 1,
): { attrs: AttrMap; ovr: number } {
  const mean = growthMean(age, position) * (DEV_TRAIT_MULT[devTrait] ?? 1) * speedMult * scale;
  const out: AttrMap = { ...attrs };
  const keys = attrsForPosition(position);
  const noiseSd = 2.4 * Math.sqrt(Math.max(0.05, scale));

  for (const key of keys) {
    const current = out[key] ?? 50;
    // Room shrinks as the attribute approaches the player's ceiling, goes to
    // zero AT the ceiling, and turns into a pull back down above it.
    //
    // This used to floor the factor at 0.1, which meant a growing player kept
    // a POSITIVE expected gain no matter how far past his ceiling he already
    // was — `potential` (documented in the schema as "0..99 ceiling") capped
    // nothing at all. On its own the drift is small; combined with the roll's
    // own per-attribute noise and with rosters that keep whoever drifted UP
    // and release whoever drifted down, it is a ratchet with no counterweight,
    // and it was the main engine behind measured league-wide rating inflation
    // (mean ACTIVE trueOvr 65 -> 81 across 13 simulated seasons, with 27% of
    // active players sitting at or above their own stated ceiling). Removing
    // the floor makes potential a real attractor: noise still moves a player
    // either way, but overshooting it now pulls him back instead of paying him
    // a bonus for having overshot.
    const roomFactor = clamp((potential - current) / 30, -1, 1.2);
    const delta = rng.normal(mean * (mean >= 0 ? roomFactor : 1), noiseSd);
    out[key] = clamp(Math.round(current + delta), 20, 99);
  }

  return { attrs: out, ovr: computeOverall(position, out) };
}

/**
 * Flat, deliberate bump for a milestone (stat-leader checkpoint, season
 * award) rather than a random roll — these are meant to read as a clear
 * jump, not blend into the normal noisy progression. Raising every
 * overall-weighted attribute by `ovrDelta` raises the computed overall by
 * almost exactly that amount, since computeOverall is a weighted average
 * over those same keys. Potential rises first so the new attributes always
 * have room to actually land there.
 */
export function bumpForMilestone(
  position: Position,
  attrs: AttrMap,
  potential: number,
  ovrDelta: number,
  potentialDelta: number,
): { attrs: AttrMap; ovr: number; potential: number } {
  const newPotential = clamp(potential + potentialDelta, potential, 99);
  const weights = POSITION_WEIGHTS[position];
  const out: AttrMap = { ...attrs };
  for (const key of Object.keys(weights)) {
    out[key] = clamp(Math.round((out[key] ?? 50) + ovrDelta), 20, 99);
  }
  return { attrs: out, ovr: computeOverall(position, out), potential: newPotential };
}

/** [TUNE] Retirement odds by age — nobody plays forever, and not evenly. */
export function retirementChance(age: number, trueOvr: number, position?: Position): number {
  const profile = (position && POSITION_AGE_PROFILE[position]) || DEFAULT_AGE_PROFILE;
  const effectiveAge = age - profile.peakShift;
  if (effectiveAge < 32) return 0;
  const ageFactor = clamp((effectiveAge - 32) / 8, 0, 1);
  // Bad old players retire faster than great old players.
  const skillFactor = clamp((70 - trueOvr) / 40, 0, 0.5);
  return clamp(ageFactor * 0.35 + skillFactor, 0, 0.9);
}
