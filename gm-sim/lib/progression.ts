import { Rng, clamp } from './rng';
import { AGE_CURVE, DEV_TRAIT_MULT, Position } from './tuning';
import { AttrMap, attrsForPosition, computeOverall } from './ratings';

/**
 * Offseason player development (design doc section 13). Every rostered and
 * drafted player gets one progression roll per offseason:
 *   1. Look up the age-based growth mean from AGE_CURVE.
 *   2. Scale it by the player's dev trait multiplier.
 *   3. Scale by league progressionSpeed setting.
 *   4. Roll a per-attribute delta, capped by remaining room to potential.
 * Retirement is a separate roll for players past a certain age (section 13).
 */
export function growthMean(age: number): number {
  for (const b of AGE_CURVE) if (age <= b.maxAge) return b.growth;
  return AGE_CURVE[AGE_CURVE.length - 1].growth;
}

export function progressPlayer(
  rng: Rng,
  position: Position,
  attrs: AttrMap,
  age: number,
  potential: number,
  devTrait: string,
  speedMult: number,
): { attrs: AttrMap; ovr: number } {
  const mean = growthMean(age) * (DEV_TRAIT_MULT[devTrait] ?? 1) * speedMult;
  const out: AttrMap = { ...attrs };
  const keys = attrsForPosition(position);

  for (const key of keys) {
    const current = out[key] ?? 50;
    // Room shrinks as the attribute approaches the player's ceiling.
    const roomFactor = clamp((potential - current) / 30, -1, 1.2);
    const delta = rng.normal(mean * (mean >= 0 ? Math.max(0.1, roomFactor) : 1), 2.4);
    out[key] = clamp(Math.round(current + delta), 20, 99);
  }

  return { attrs: out, ovr: computeOverall(position, out) };
}

/** [TUNE] Retirement odds by age — nobody plays forever. */
export function retirementChance(age: number, trueOvr: number): number {
  if (age < 32) return 0;
  const ageFactor = clamp((age - 32) / 8, 0, 1);
  // Bad old players retire faster than great old players.
  const skillFactor = clamp((70 - trueOvr) / 40, 0, 0.5);
  return clamp(ageFactor * 0.35 + skillFactor, 0, 0.9);
}
