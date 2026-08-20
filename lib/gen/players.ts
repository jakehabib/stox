import { Rng, clamp } from '../rng';
import { GENERATION, Position, POSITIONS, ROSTER_TARGETS } from '../tuning';
import { attrsForPosition, computeOverall, AttrMap, POSITION_WEIGHTS } from '../ratings';
import { FIRST_NAMES, LAST_NAMES, COLLEGES } from './names';
import { writeJson } from '../json';
import { generateCollegeProfile, generateCombineTesting, CollegeProfile, CombineTesting } from './prospectProfile';

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
  FB:  { h: 72, hSd: 1.3, w: 245, wSd: 12 },
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
  QB: 5, RB: 7, FB: 1.5, WR: 13, TE: 6,
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

export function generatePlayer(
  rng: Rng,
  opts: {
    position?: Position;
    rookie?: boolean;
    /** Force an overall target — used for draft classes and star seeding. */
    ovrTarget?: number;
    ageOverride?: number;
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
  const potential = clamp(
    Math.round(trueOvr + Math.max(0, rng.normal(potBonusMean, potBonusSd)) * ageDamp),
    trueOvr,
    99,
  );

  const body = BODY[position];
  const attrs = generateAttributes(rng, position, trueOvr);

  return {
    firstName: rng.pick(FIRST_NAMES),
    lastName: rng.pick(LAST_NAMES),
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
 * Build a full 53-man roster's worth of players for one team, respecting the
 * roster targets and giving each team a couple of genuinely good players so no
 * team is uniformly gray.
 */
export function generateRoster(rng: Rng, teamStrength: number): GeneratedPlayer[] {
  const out: GeneratedPlayer[] = [];

  for (const pos of POSITIONS) {
    const target = ROSTER_TARGETS[pos];
    const count = rng.int(target.min, target.ideal);
    for (let i = 0; i < count; i++) {
      // Starters are better than backups — depth decays down the chart.
      const depthPenalty = i * rng.float(4, 8); // [TUNE]
      const ovrTarget = clamp(
        Math.round(rng.normal(GENERATION.VETERAN_OVR_MEAN + teamStrength - depthPenalty, GENERATION.VETERAN_OVR_SD * 0.8)),
        40, 99,
      );
      out.push(generatePlayer(rng, { position: pos, ovrTarget }));
    }
  }

  // Seed 1-3 legitimate stars per team so rosters have identity. [TUNE]
  const starCount = rng.int(1, 3);
  const premiumPositions: Position[] = ['QB', 'WR', 'EDGE', 'CB', 'LT', 'DT', 'TE', 'RB', 'S', 'LB'];
  for (let i = 0; i < starCount; i++) {
    const pos = rng.pick(premiumPositions);
    const star = generatePlayer(rng, {
      position: pos,
      ovrTarget: clamp(Math.round(rng.normal(85 + teamStrength * 0.3, 4)), 78, 99),
      ageOverride: rng.int(23, 29),
    });
    const replaceIdx = out.findIndex((p) => p.position === pos);
    if (replaceIdx >= 0) out[replaceIdx] = star;
    else out.push(star);
  }

  return out;
}

/** A rookie draft class — wide talent spread, that's what makes scouting matter. */
export function generateDraftClass(rng: Rng, size: number): GeneratedPlayer[] {
  const out: GeneratedPlayer[] = [];
  for (let i = 0; i < size; i++) {
    // Top of the class is meaningfully better than the back half. [TUNE]
    const pct = i / size;
    const tierMean = GENERATION.ROOKIE_OVR_MEAN + (1 - pct) * 14 - 6;
    const player = generatePlayer(rng, {
      rookie: true,
      ovrTarget: clamp(Math.round(rng.normal(tierMean, GENERATION.ROOKIE_OVR_SD)), 38, 95),
    });
    player.collegeProfile = generateCollegeProfile(rng, player.position, player.trueAttrs, player.trueOvr);
    player.combineTesting = generateCombineTesting(rng, player.position, player.trueAttrs, player.trueOvr);
    out.push(player);
  }
  return out;
}
