import { Rng, clamp } from './rng';
import { AGE_CURVE, DEV_TRAIT_MULT, POSITION_AGE_PROFILE, DEFAULT_AGE_PROFILE, PROGRESSION, Position } from './tuning';
import { AttrMap, attrsForPosition, computeOverall, POSITION_WEIGHTS, RATING_BANDS } from './ratings';

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

/**
 * HOW MUCH FASTER A MAN WITH THIS CEILING CLIMBS.
 *
 * Keyed on his POTENTIAL, and on the same `RATING_BANDS` the player's own card
 * is labelled from — so the tier the game calls him is the tier that develops
 * him, and the two cannot drift apart. See POTENTIAL_TIER_GROWTH in
 * lib/tuning.ts for the design and for why this exists at all.
 *
 * A bonus, never a tax: everybody below the Star band develops at exactly the
 * rate they always did, so this can only ever speed the game's best prospects
 * up. And it is applied to GROWTH ONLY — see the guard in progressPlayer.
 */
export function potentialTierGrowthMult(potential: number): number {
  const t = PROGRESSION.POTENTIAL_TIER_GROWTH;
  if (potential >= RATING_BANDS.GENERATIONAL) return t.GENERATIONAL;
  if (potential >= RATING_BANDS.SUPERSTAR) return t.FRANCHISE;
  if (potential >= RATING_BANDS.ELITE) return t.ALL_STAR;
  if (potential >= RATING_BANDS.STAR) return t.STAR;
  return t.BASE;
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
  const ageMean = growthMean(age, position);
  // THE TIER LADDER, AND THE SIGN GUARD THAT MAKES IT SAFE. A high ceiling buys
  // a man FASTER GROWTH, never faster decline: `ageMean` turns negative past his
  // peak, and applying a 1.45x there would have the best players in the league
  // falling apart quickest — the same sign error, in a fourth costume, that this
  // codebase has now fixed at four separate cap gates. Past the peak the tier
  // multiplier is exactly 1 and a generational man ages like anybody else.
  const tierMult = ageMean > 0 ? potentialTierGrowthMult(potential) : 1;
  const mean = ageMean * (DEV_TRAIT_MULT[devTrait] ?? 1) * speedMult * scale * tierMult;
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
    //
    // A SOFT KNEE REPLACED THE CLAMP, and the divisor came down with it. See
    // PROGRESSION.GROWTH_ROOM_SCALE in lib/tuning.ts for the arithmetic: at
    // `/ 30` the age curve's whole 12.2-unit growth budget could not carry a
    // 74-rated first-rounder to an 88 ceiling — he peaked nine points short on
    // the mean — and the hard clamp piled every wide-gap player onto one
    // growth rate. tanh is still zero AT the ceiling and still negative above
    // it, so nothing about the attractor changed except how fast it pulls.
    const roomFactor = PROGRESSION.GROWTH_ROOM_MAX * Math.tanh((potential - current) / PROGRESSION.GROWTH_ROOM_SCALE);
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

/**
 * ===========================================================================
 * THE CEILING IS THE FRONT OFFICE'S PROJECTION, AND A PROJECTION MOVES
 * ===========================================================================
 * `Player.potential` used to be write-once-upward. The generator set it, a
 * stat-leader or award bump could raise it, and there was no line of code
 * anywhere that could lower it. A 99-ceiling prospect who played four full
 * seasons and produced nothing was still a 99-ceiling prospect — behind
 * schedule, never re-projected. That is the mechanical reason this game had
 * no busts, and it is what this function exists to end.
 *
 * ---------------------------------------------------------------------------
 * HE IS JUDGED AGAINST WHAT HE IS, NEVER AGAINST HIS CEILING
 * ---------------------------------------------------------------------------
 * This is the whole design and it is easy to get backwards. A generational
 * prospect enters the league rated 77. He produces like a 77, because he IS a
 * 77. Measure that against his 99 ceiling and he fails every week of his
 * rookie contract and erodes his own projection for the crime of being young —
 * which would make a high ceiling a HANDICAP and hand better careers to the
 * players nobody projected. So the yardstick is his CURRENT overall:
 * `deliveryZ` is how far his production sits from what men of his rating at
 * his position actually produced this year. Producing like a 77 while rated 77
 * is exactly neutral. Nothing moves.
 *
 * ---------------------------------------------------------------------------
 * ONE FUNCTION WITH A SIGN
 * ---------------------------------------------------------------------------
 * Up and down are the same mechanism read in opposite directions, so they
 * cannot drift apart:
 *
 *   drive  odd, dead-banded, saturating in the evidence — an ordinary season
 *          moves nothing, and a four-sigma season is not four times a
 *          one-sigma one. The standing outlier rule, applied to evidence.
 *   pace   ONE age logistic, read from both ends. Young: the projection is
 *          still credible and a big year raises it. Old: the projection is no
 *          longer credible and a bad year lowers it. "especially with age."
 *   room   what is left in the direction being moved. Down, that is the
 *          UNREALISED part of the projection (potential - trueOvr) plus
 *          CEILING_RESIDUAL_ROOM, the points a club never counts as banked;
 *          up, it is the space below 99. Both shrink as the ceiling moves, so
 *          a revision decays toward the player rather than stopping at a wall,
 *          and nothing piles up at a floor because there is no floor.
 *   sample how much of a real look he got. Zero for a man who did not play,
 *          which makes not playing worth exactly nothing in both directions.
 *          Absence of evidence is not evidence of failure.
 *
 * ---------------------------------------------------------------------------
 * WHY A GENERATIONAL PROSPECT DOES NOT COLLAPSE
 * ---------------------------------------------------------------------------
 * NOT because a floor stops him. It is the feedback loop, and it closes
 * itself. Erosion lowers the ceiling; progressPlayer's room factor then pulls
 * his RATING down after it; a man rated lower is expected to produce less; his
 * `deliveryZ` climbs back toward zero, and the erosion stops. A club revises
 * until the projection matches the player and then stops revising.
 *
 * The residual room was not always there — erosion used to be strictly
 * proportional to (potential - trueOvr), which made the ceiling unreachable
 * from below by construction. That was a clean guarantee and it stopped being
 * available the moment growth was made to actually converge (see
 * GROWTH_ROOM_SCALE): with most players now catching their own ceiling, the
 * old room term went to nothing and switched the whole mechanism off for
 * exactly the population it was written for.
 *
 * The pathological bound, from scripts/_bust_cohort.ts: a 99-ceiling man in a
 * full-time role producing a season and a half light EVERY year from 22 to 32,
 * with his rating pinned so the feedback above cannot act, ends on a ceiling of
 * 82. That is eleven consecutive disasters and a starter's ceiling at the end
 * of them; the live measurement is in the commit message.
 *
 * The result is a FLOAT, deliberately: one season is meant to be worth a
 * fraction of a point, so the ceiling is an average of a career's evidence
 * rather than a verdict on one year. The caller quantises it (see
 * lib/development.ts) — a single bad season is noise and barely moves it, and
 * a pattern moves it steadily, because the pass runs every year.
 *
 * NO DISCRETE BUST EVENT EXISTS. Nothing here fires once, flags a player, or
 * takes a step. There is no threshold to be on the wrong side of.
 */
export function ceilingAgePace(effectiveAge: number): number {
  return 1 / (1 + Math.exp(-(effectiveAge - PROGRESSION.CEILING_AGE_MIDPOINT) / PROGRESSION.CEILING_AGE_WIDTH));
}

/**
 * The evidence, shaped: odd in `deliveryZ`, flat inside the deadband, and
 * saturating toward ±1 outside it.
 */
export function deliveryDrive(deliveryZ: number): number {
  const past = Math.abs(deliveryZ) - PROGRESSION.CEILING_DELIVERY_DEADBAND;
  if (past <= 0) return 0;
  return Math.sign(deliveryZ) * Math.tanh(past / PROGRESSION.CEILING_DELIVERY_SPREAD);
}

export function ceilingRevision(args: {
  /** Production against what men of his CURRENT rating produced, in SDs. Never against his ceiling. */
  deliveryZ: number;
  age: number;
  position: Position;
  potential: number;
  ovr: number;
  /** 0..1 — how much of a real look he got this year. 0 revises nothing. */
  sample: number;
}): number {
  const { deliveryZ, age, position, potential, ovr, sample } = args;
  if (sample <= 0) return 0;
  const drive = deliveryDrive(deliveryZ);
  if (drive === 0) return 0;

  const profile = POSITION_AGE_PROFILE[position] || DEFAULT_AGE_PROFILE;
  const pace = ceilingAgePace(age - profile.peakShift);

  if (drive < 0) {
    // The unproven part of the projection, plus the points a club never counts
    // as banked at all (CEILING_RESIDUAL_ROOM). Without that residual the
    // mechanism switches itself off for every player who has caught up to his
    // own ceiling, which — now that growth actually converges — is most of
    // them. See the constant's note for where "no collapse" comes from instead.
    const room = Math.max(0, potential - ovr) + PROGRESSION.CEILING_RESIDUAL_ROOM;
    return drive * pace * room * PROGRESSION.CEILING_EROSION_RATE * sample;
  }
  const room = Math.max(0, 99 - potential);
  return drive * (1 - pace) * room * PROGRESSION.CEILING_RISE_RATE * sample;
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
