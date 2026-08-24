import { Rng, clamp } from '../rng';
import { GENERATION, Position, POSITIONS, ROSTER_TARGETS } from '../tuning';
import { attrsForPosition, computeOverall, AttrMap, POSITION_WEIGHTS } from '../ratings';
import { COLLEGES, NameRegistry, pickUniqueName } from './names';
import { writeJson } from '../json';
import { generateCollegeProfile, generateCombineTesting, generateClassStrength, CollegeProfile, CombineTesting } from './prospectProfile';
import { positionGroup, PositionGroup } from '../positionGroups';

export interface GeneratedPlayer {
  firstName: string;
  lastName: string;
  position: Position;
  age: number;
  experience: number;
  heightIn: number;
  weightLb: number;
  college: string;
  trueAttrs: AttrMap;
  trueOvr: number;
  potential: number;
  devTrait: string;
  /** Only ever set for the rookie draft class — see generateDraftClass. */
  collegeProfile?: CollegeProfile;
  combineTesting?: CombineTesting;
}

/**
 * [PLACEHOLDER] Physical templates by position — mean height (in) / weight (lb)
 * and how much of a position's rating skews toward athleticism. Realistic-ish
 * but not fitted to combine data.
 */
const BODY: Record<Position, { h: number; hSd: number; w: number; wSd: number }> = {
  QB:  { h: 75, hSd: 1.6, w: 220, wSd: 12 },
  RB:  { h: 70, hSd: 1.6, w: 214, wSd: 14 },
  WR:  { h: 73, hSd: 2.1, w: 200, wSd: 15 },
  TE:  { h: 77, hSd: 1.4, w: 250, wSd: 13 },
  LT:  { h: 78, hSd: 1.3, w: 313, wSd: 14 },
  LG:  { h: 77, hSd: 1.3, w: 315, wSd: 14 },
  C:   { h: 76, hSd: 1.2, w: 305, wSd: 13 },
  RG:  { h: 77, hSd: 1.3, w: 315, wSd: 14 },
  RT:  { h: 78, hSd: 1.3, w: 315, wSd: 14 },
  EDGE:{ h: 76, hSd: 1.5, w: 262, wSd: 15 },
  DT:  { h: 75, hSd: 1.5, w: 305, wSd: 18 },
  LB:  { h: 74, hSd: 1.4, w: 238, wSd: 12 },
  CB:  { h: 71, hSd: 1.7, w: 192, wSd: 11 },
  S:   { h: 73, hSd: 1.4, w: 205, wSd: 11 },
  K:   { h: 72, hSd: 1.8, w: 195, wSd: 14 },
  P:   { h: 74, hSd: 1.8, w: 205, wSd: 14 },
};

/**
 * [PLACEHOLDER] Positional scarcity used when filling a random roster — how
 * many players of each position exist in the world relative to each other.
 */
const POSITION_FREQUENCY: Record<Position, number> = {
  // The fullback's share went to receiver, not back to the pool. A roster
  // built for 11 personnel starts three wideouts and needs enough of them to
  // field three plus depth; carrying a blocking back it can never start was
  // the old shape.
  QB: 5, RB: 7, WR: 14.5, TE: 6,
  LT: 4, LG: 4, C: 4, RG: 4, RT: 4,
  EDGE: 9, DT: 9, LB: 10, CB: 11, S: 8,
  K: 2, P: 2,
};

/**
 * Attribute generation. A player's overall target is rolled first, then each
 * attribute is sampled around a value that would produce that overall, with
 * heavier noise on attributes the position doesn't weight (a CB's strength can
 * be anything without changing his rating).
 *
 * [TUNE] ATTR_SD controls how "spiky" players are. Higher = more players who
 * are elite at one thing and bad at another.
 */
function generateAttributes(rng: Rng, pos: Position, targetOvr: number): AttrMap {
  const keys = attrsForPosition(pos);
  const weights = POSITION_WEIGHTS[pos];
  const attrs: AttrMap = {};

  // First pass: sample around the target.
  for (const key of keys) {
    const isWeighted = weights[key] != null;
    const sd = isWeighted ? GENERATION.ATTR_SD : GENERATION.ATTR_SD * 2.2;
    const mean = isWeighted ? targetOvr : targetOvr * 0.85 + rng.float(-6, 6);
    attrs[key] = rng.normalClamped(mean, sd, 25, 99);
  }

  // Second pass: nudge weighted attributes so the computed overall lands on
  // target. Without this, averaging pulls everyone toward the middle.
  for (let i = 0; i < 12; i++) {
    const current = computeOverall(pos, attrs);
    const delta = targetOvr - current;
    if (Math.abs(delta) <= 0) break;
    for (const key of Object.keys(weights)) {
      if (attrs[key] == null) continue;
      attrs[key] = clamp(Math.round(attrs[key] + delta * 0.8), 25, 99);
    }
  }

  return attrs;
}

/**
 * The ceiling on potential, bent rather than chopped.
 *
 * Below GENERATION.POTENTIAL_SOFT_KNEE this is the identity: a man rated 70
 * who rolls +8 has a potential of 78, exactly as he always did. Above the knee
 * the sum is compressed toward GENERATION.POTENTIAL_CEILING along a decaying
 * exponential whose scale is the remaining span, so the curve leaves the knee
 * with slope exactly 1 — no kink — and approaches the ceiling without ever
 * reaching it. 99 stays reachable at any roll size; it just costs an
 * ever-larger one, which is the point.
 *
 * WHY: `clamp(trueOvr + bonus, trueOvr, 99)` used to sit here. A prospect's
 * true overall already runs to DRAFT_OVR_MAX (88) and the rookie bonus used to
 * average 14, so a large share of the sums landed past 99 — and every one of
 * them stacked onto exactly 99, the value lib/ratings.ts labels
 * "Generational". The whole right tail collapsed onto one number, which made
 * the single most extreme rating in the game the most COMMON one at the top of
 * the scale. Measured over 2,000 generated classes: 6.49% of prospects sat at
 * 99 against 0.95% at 98 — a 6.8x wall — and the median 224-pick draft held 21
 * generational prospects. It now holds one.
 *
 * The knee is deliberately high (97.5) and the bonus roll deliberately small
 * (see ROOKIE_POTENTIAL_BONUS_MEAN). That split matters: a LOW knee does not
 * fix this, it relocates the pile. Compressing everything above 91 moved the
 * mass that used to sit on 99 onto 95-98 instead and made "Franchise Prospect"
 * fatter than the tier above it was tall. The overflow has to be prevented,
 * not redistributed, and that is the roll's job; the knee only files off the
 * corner that is left.
 */
export function softCeiling(base: number, bonus: number): number {
  const raw = base + bonus;
  const knee = GENERATION.POTENTIAL_SOFT_KNEE;
  const span = GENERATION.POTENTIAL_CEILING - knee;
  if (raw <= knee || span <= 0) return raw;
  return GENERATION.POTENTIAL_CEILING - span * Math.exp(-(raw - knee) / span);
}

export function generatePlayer(
  rng: Rng,
  opts: {
    position?: Position;
    rookie?: boolean;
    /** Force an overall target — used for draft classes and star seeding. */
    ovrTarget?: number;
    ageOverride?: number;
    /**
     * League-wide name ledger. Pass one and every player generated against it
     * is guaranteed a name nobody else in the league has. Omit it and names
     * are drawn independently, which is fine for a one-off player but will
     * produce collisions across any batch — see NameRegistry in ./names.
     */
    names?: NameRegistry;
  } = {},
): GeneratedPlayer {
  const position = opts.position ?? weightedPosition(rng);
  const rookie = opts.rookie ?? false;

  const mean = rookie ? GENERATION.ROOKIE_OVR_MEAN : GENERATION.VETERAN_OVR_MEAN;
  const sd = rookie ? GENERATION.ROOKIE_OVR_SD : GENERATION.VETERAN_OVR_SD;
  const trueOvr = opts.ovrTarget ?? rng.normalClamped(mean, sd, 38, 99);

  const age = opts.ageOverride ?? (rookie
    ? rng.normalClamped(GENERATION.ROOKIE_AGE_MEAN, 1.0, 20, 25)
    : rng.normalClamped(26.5, 3.2, GENERATION.AGE_MIN, GENERATION.AGE_MAX));

  const devTrait = rng.weighted(GENERATION.DEV_TRAIT_WEIGHTS as Record<string, number>);

  const potBonusMean = rookie ? GENERATION.ROOKIE_POTENTIAL_BONUS_MEAN : GENERATION.POTENTIAL_BONUS_MEAN;
  const potBonusSd = rookie ? GENERATION.ROOKIE_POTENTIAL_BONUS_SD : GENERATION.POTENTIAL_BONUS_SD;
  // Older players have almost no runway left.
  const ageDamp = clamp((30 - age) / 8, 0, 1);
  const potBonus = Math.max(0, rng.normal(potBonusMean, potBonusSd)) * ageDamp;
  // softCeiling(), not a hard cap — see GENERATION.POTENTIAL_SOFT_KNEE. The
  // lower bound stays: a ceiling below the man's own current rating is not a
  // ceiling, and trueOvr here is the TARGET, which computeOverall can land a
  // point or two above. The upper 99 can no longer bind (the curve's asymptote
  // IS 99); it is left in as a guard so this never rests on the arithmetic.
  const potential = clamp(Math.round(softCeiling(trueOvr, potBonus)), trueOvr, 99);

  const body = BODY[position];
  const attrs = generateAttributes(rng, position, trueOvr);

  const { firstName, lastName } = pickUniqueName(rng, opts.names ?? new NameRegistry());

  return {
    firstName,
    lastName,
    position,
    age,
    experience: rookie ? 0 : clamp(age - 22, 0, 15),
    heightIn: rng.normalClamped(body.h, body.hSd, 64, 82),
    weightLb: rng.normalClamped(body.w, body.wSd, 160, 360),
    college: rng.pick(COLLEGES),
    trueAttrs: attrs,
    trueOvr: computeOverall(position, attrs),
    potential,
    devTrait,
  };
}

export function weightedPosition(rng: Rng): Position {
  return rng.weighted(POSITION_FREQUENCY as unknown as Record<string, number>) as Position;
}

/** Prisma-ready payload. */
export function toPlayerCreate(p: GeneratedPlayer, leagueId: string, extra: Record<string, unknown> = {}) {
  return {
    leagueId,
    firstName: p.firstName,
    lastName: p.lastName,
    position: p.position,
    age: p.age,
    experience: p.experience,
    heightIn: p.heightIn,
    weightLb: p.weightLb,
    college: p.college,
    trueAttrs: writeJson(p.trueAttrs),
    trueOvr: p.trueOvr,
    potential: p.potential,
    devTrait: p.devTrait,
    ...(p.collegeProfile ? { collegeStats: writeJson(p.collegeProfile) } : {}),
    ...(p.combineTesting ? { combineTesting: writeJson(p.combineTesting) } : {}),
    ...extra,
  };
}

/**
 * Positions that field exactly one man, so a second good one is a luxury
 * nobody buys rather than depth. Used by the star seeding below, and it is
 * why ROSTER_TARGETS lets a club carry three quarterbacks without wanting
 * three good ones.
 */
const ONE_JOB: Position[] = ['QB', 'K', 'P'];

/**
 * Build a full 53-man roster's worth of players for one team, respecting the
 * roster targets and giving each team a couple of genuinely good players so no
 * team is uniformly gray.
 */
export function generateRoster(rng: Rng, teamStrength: number, names?: NameRegistry): GeneratedPlayer[] {
  const out: GeneratedPlayer[] = [];

  for (const pos of POSITIONS) {
    const target = ROSTER_TARGETS[pos];
    const count = rng.int(target.min, target.ideal);
    for (let i = 0; i < count; i++) {
      // Starters are better than backups — depth decays down the chart,
      // asymptotically rather than linearly so it is front-loaded like a real
      // one and bounded. See GENERATION.DEPTH_DECAY_MAX for why.
      const jitter = GENERATION.DEPTH_DECAY_JITTER;
      const depthPenalty = GENERATION.DEPTH_DECAY_MAX
        * (1 - Math.exp(-i / GENERATION.DEPTH_DECAY_TAU))
        * rng.float(1 - jitter, 1 + jitter);
      // Kickers and punters carry one roster slot, so they never take a depth
      // penalty and would otherwise outrank the whole league on average.
      const specialist = (pos === 'K' || pos === 'P') ? GENERATION.SPECIALIST_OVR_PENALTY : 0;
      const ovrTarget = clamp(
        Math.round(rng.normal(GENERATION.VETERAN_OVR_MEAN + teamStrength - depthPenalty - specialist, GENERATION.VETERAN_OVR_SD * 0.8)),
        GENERATION.ROSTER_OVR_FLOOR, 99,
      );
      out.push(generatePlayer(rng, { position: pos, ovrTarget, names }));
    }
  }

  // Seed a few legitimate stars per team so rosters have identity. [TUNE]
  const starCount = rng.int(GENERATION.STAR_COUNT_MIN, GENERATION.STAR_COUNT_MAX);
  for (let i = 0; i < starCount; i++) {
    // Weighted, not a flat pick: see GENERATION.STAR_POSITION_WEIGHTS. An
    // unweighted pick gave a 79-man tight-end pool as many stars as a 193-man
    // receiver pool.
    const pos = rng.weighted(GENERATION.STAR_POSITION_WEIGHTS) as Position;
    // Age band: a star used to be capped at 29, which meant a brand-new
    // league contained no elite veterans at all — nobody old enough to have
    // a decade of production, an MVP and a couple of rings behind him, which
    // is exactly the kind of player a league needs for its past to feel
    // inherited rather than invented (see lib/gen/leagueHistory.ts, which
    // builds these men's careers). Roughly a quarter of them are now
    // 30-to-34-year-olds on the back nine. [TUNE]
    const era = rng.weighted({ RISING: 0.28, PRIME: 0.46, VETERAN: 0.26 });
    const ageOverride = era === 'RISING' ? rng.int(23, 25) : era === 'PRIME' ? rng.int(26, 29) : rng.int(30, 34);
    const star = generatePlayer(rng, {
      position: pos,
      ovrTarget: clamp(Math.round(rng.normal(GENERATION.STAR_OVR_MEAN + teamStrength * 0.3, GENERATION.STAR_OVR_SD)), GENERATION.STAR_OVR_MIN, 99),
      ageOverride,
      names,
    });
    // WHO THE STAR DISPLACES DEPENDS ON HOW MANY MEN THE POSITION PLAYS.
    //
    // At a position that rotates — receiver, corner, edge — a star joins the
    // rotation and the man he costs a roster spot is the WEAKEST one there.
    // (This was findIndex(), which, because `out` is built depth-slot-0 first,
    // returned the team's BEST player at the position: measured over 660 star
    // seeds, 8% of them overwrote someone already as good or better, and the
    // mean net gain was +12.5 rather than the ~+20 it should have been.)
    //
    // At a ONE_JOB position he displaces the INCUMBENT instead, because there
    // is nothing else for him to do — a franchise quarterback does not hold a
    // clipboard. Seeding him against the weakest arm was how 27% of clubs came
    // out of generation with a second quarterback grading 80 or better, and it
    // is where the $32M backup the owner reported came from: the displaced
    // starter stayed on the roster and kept his starter's price. If the club's
    // incumbent is already the better man the seed is spent and nothing
    // changes — it already has its franchise quarterback.
    const oneJob = ONE_JOB.includes(pos);
    let replaceIdx = -1;
    let incumbent = oneJob ? -Infinity : Infinity;
    for (let j = 0; j < out.length; j++) {
      if (out[j].position !== pos) continue;
      if (oneJob ? out[j].trueOvr > incumbent : out[j].trueOvr < incumbent) {
        incumbent = out[j].trueOvr;
        replaceIdx = j;
      }
    }
    if (replaceIdx >= 0) {
      if (incumbent < star.trueOvr) out[replaceIdx] = star;
      else if (!oneJob) out.push(star);
    } else {
      out.push(star);
    }
  }

  return out;
}

/**
 * A rookie draft class — wide talent spread, that's what makes scouting
 * matter. Also gives the class a "personality": a per-position-group
 * strength bias (loaded at one spot, thin at another) that real draft
 * classes always have, rather than every year being an identical flat
 * random sample at every position.
 */
export function generateDraftClass(rng: Rng, size: number, names?: NameRegistry): { players: GeneratedPlayer[]; strengthByGroup: Record<PositionGroup, number> } {
  const strengthByGroup = generateClassStrength(rng);
  const out: GeneratedPlayer[] = [];
  for (let i = 0; i < size; i++) {
    // Top of the class is meaningfully better than the back half. [TUNE]
    // The class is longer than the draft (DRAFT_CLASS_EXTRA_UDFA), so cap the
    // ramp at the last pick: otherwise it only traverses 56% of its range
    // across all seven rounds and the undrafted eat the rest, which is why a
    // seventh-rounder used to grade the same as a first-rounder.
    const pct = Math.min(1, i / GENERATION.DRAFT_CLASS_SIZE);
    const position = weightedPosition(rng);
    const bias = strengthByGroup[positionGroup(position)] ?? 0;
    const tierMean = GENERATION.ROOKIE_OVR_MEAN + (1 - pct) * GENERATION.DRAFT_TIER_SPREAD - GENERATION.DRAFT_TIER_OFFSET + bias;
    const player = generatePlayer(rng, {
      position,
      rookie: true,
      ovrTarget: clamp(Math.round(rng.normal(tierMean, GENERATION.ROOKIE_OVR_SD)), GENERATION.DRAFT_OVR_MIN, GENERATION.DRAFT_OVR_MAX),
      names,
    });
    player.collegeProfile = generateCollegeProfile(rng, player.position, player.trueAttrs, player.trueOvr);
    out.push(player);
  }

  // Combine testing is a SEPARATE pass: it needs each prospect's trueOvr
  // percentile within his own position group, and that doesn't exist until
  // the whole class above has been rolled — a single prospect generated in
  // isolation has no peers yet to rank against.
  const byPosition = new Map<Position, GeneratedPlayer[]>();
  for (const p of out) {
    if (!byPosition.has(p.position)) byPosition.set(p.position, []);
    byPosition.get(p.position)!.push(p);
  }
  for (const group of byPosition.values()) {
    const sorted = [...group].sort((a, b) => a.trueOvr - b.trueOvr); // ascending: worst first
    const n = sorted.length;
    sorted.forEach((p, idx) => {
      const truePercentile = n > 1 ? idx / (n - 1) : 0.5; // 0 = worst in the group, 1 = best
      p.combineTesting = generateCombineTesting(rng, p.position, p.trueAttrs, p.trueOvr, truePercentile);
    });
  }

  return { players: out, strengthByGroup };
}
