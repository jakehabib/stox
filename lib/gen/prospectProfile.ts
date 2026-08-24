import { Rng, clamp } from '../rng';
import { COMBINE, GENERATION, Position } from '../tuning';
import { AttrMap, POSITION_WEIGHTS } from '../ratings';
import { POSITION_GROUPS, PositionGroup } from '../positionGroups';

/**
 * ===========================================================================
 * COLLEGE PROFILE (draft scouting depth)
 * ===========================================================================
 * There's no simulated college season underneath this — these are procedural
 * college-style box scores and combine/pro-day testing numbers, generated
 * once at class creation and revealed progressively as the NFL season
 * plays out (see collegeWeeksElapsed). Deliberately tuned to COLLEGE norms,
 * not NFL ones: a 13-game season, the real NCAA passer efficiency formula
 * (different weights than the NFL's), and — the one axis where college
 * genuinely runs hotter — a much higher yards-per-attempt off the explosive
 * plays spread/RPO systems give up.
 *
 * WHAT THIS PARAGRAPH USED TO CLAIM, AND WHY IT NO LONGER DOES. It said
 * college was tuned above the pros on "pass-volume/completion%/yards-per-
 * attempt". Measured over 1,550 generated college quarterbacks against 3,591
 * simulated pro seasons of 100+ attempts, only the last of those three is
 * true, and the other two are backwards:
 *
 *   completion %   college 60.5% median  vs  pros 64.1%
 *   attempts/game  college 30.1          vs  pros 43.0
 *   yards/attempt  college  7.99         vs  pros  5.48
 *
 * The NUMBERS are the ones worth keeping — real FBS runs about 61-62% on
 * roughly 31-33 throws a game, so a college passer completing fewer at lower
 * volume than a pro is exactly right, and it was the sentence describing them
 * that had drifted. A comment stating a policy the code abandoned misleads
 * the next person tuning this file just as badly as a wrong constant would,
 * so it is corrected here rather than the generator being bent to match it.
 *
 * [TUNE] throughout — these are plausible ranges, not fitted to real CFB data.
 * ===========================================================================
 */

export const COLLEGE_WEEKS = 13;

export const COMPETITION_GRADES = ['A', 'B', 'C', 'D', 'F'] as const;
export type CompetitionGrade = (typeof COMPETITION_GRADES)[number];

export interface CollegeGameLine {
  passAtt?: number; passCmp?: number; passYds?: number; passTd?: number; passInt?: number;
  rushAtt?: number; rushYds?: number; rushTd?: number;
  targets?: number; rec?: number; recYds?: number; recTd?: number;
  tkl?: number; sacks?: number; tfl?: number; ints?: number; pd?: number; ff?: number;
  sacksAllowed?: number; pancakes?: number;
  fgMade?: number; fgAtt?: number; xpMade?: number;
  punts?: number; puntYds?: number;
}

export interface CollegeProfile {
  games: CollegeGameLine[]; // COLLEGE_WEEKS entries, one per game
  competitionGrade: CompetitionGrade;
}

export interface CombineTesting {
  venue: 'COMBINE' | 'PRO_DAY';
  fortyYard: number;   // seconds
  vertical: number;    // inches
  broadJump: number;   // inches
  threeCone: number;   // seconds
  shuttle: number;     // seconds
  benchReps: number | null;
}

/** Real NCAA passer efficiency rating — very different weighting from the NFL's formula. */
export function ncaaPasserRating(cmp: number, att: number, yds: number, td: number, int: number): number {
  if (att < 1) return 0;
  return Math.max(0, ((8.4 * yds) + (330 * td) + (100 * cmp) - (200 * int)) / att);
}

/** Sum every game's stat line up to (and including) `throughWeek` games. */
export function aggregateCollegeGames(games: CollegeGameLine[], throughWeek: number): CollegeGameLine {
  const slice = games.slice(0, clamp(throughWeek, 0, games.length));
  const totals: CollegeGameLine = {};
  for (const g of slice) {
    for (const key of Object.keys(g) as (keyof CollegeGameLine)[]) {
      totals[key] = (totals[key] ?? 0) + (g[key] ?? 0);
    }
  }
  return totals;
}

/**
 * How much of a prospect's college season you are allowed to see yet.
 *
 * IT TAKES THE PHASE, NOT JUST THE WEEK, AND THAT IS THE WHOLE FIX. This used
 * to be `clamp(round(week * 13 / 17), 1, 13)` on `League.week` alone — which
 * is only a regular-season week number in ONE phase. Every other phase counts
 * its own weeks from 1, so the arithmetic silently ran on the wrong calendar
 * the moment the season ended.
 *
 * The damage landed exactly where it hurt most. During DRAFT, `League.week` is
 * 1, so this returned `round(13/17) = 1`: at the moment a GM is on the clock
 * deciding who to take, he could see ONE college game out of thirteen. The app
 * owner: *"During the draft the college players seem to not have a full
 * season's stats. At the end of the season they should have a full college
 * stat season to look at."*
 *
 * The intended design is unchanged and is worth keeping — a class arrives at
 * the top of the NFL season and its college tape comes in through the autumn,
 * so a GM who scouts early is reading an incomplete file. That progression
 * belongs to the REGULAR season and nowhere else. Once the last whistle has
 * gone, college football is over too and the file is closed: playoffs,
 * offseason, re-sign, free agency and the draft all read the full thirteen.
 *
 * PRESEASON is the one deliberate zero-ish case: the class has just been put
 * on the board and nobody has played a game. It returns 1 rather than 0
 * because a scouting screen with no line at all reads as missing data, and one
 * game is the truthful floor.
 */
export function collegeWeeksElapsed(league: { phase: string; week: number }): number {
  if (league.phase === 'REGULAR') {
    return clamp(Math.round((league.week * COLLEGE_WEEKS) / 17), 1, COLLEGE_WEEKS);
  }
  if (league.phase === 'PRESEASON') return 1;
  // Playoffs and every offseason phase: the college season is in the books.
  return COLLEGE_WEEKS;
}

function normGame(rng: Rng, mean: number, sd: number, min = 0): number {
  return Math.max(min, Math.round(rng.normal(mean, sd)));
}

/**
 * 0..1 quality dial for a draft prospect, spanning the range a draft class is
 * actually generated across rather than a pair of hardcoded numbers.
 *
 * This used to be `(trueOvr - 40) / 55` — endpoints that matched the old
 * class range of 38..95. The rating recalibration (docs/rating-distribution.md)
 * moved that range to DRAFT_OVR_MIN..DRAFT_OVR_MAX, and the literals did not
 * follow, so the dial only ever traversed 0.25..0.87 and every college stat
 * line below it compressed toward the middle: measured over 1,200 prospects,
 * the dial's 1st-to-99th-percentile span fell from 0.96 to 0.62 and receiving
 * production spread narrowed 15%. Reading the constants means it cannot go
 * stale again the next time the curve moves.
 */
export function prospectQuality(trueOvr: number): number {
  const lo = GENERATION.DRAFT_OVR_MIN;
  const hi = GENERATION.DRAFT_OVR_MAX;
  return clamp((trueOvr - lo) / (hi - lo), 0, 1);
}

/** Generates one full college season's worth of per-game stat lines, shaped by position and true attributes. [TUNE] */
export function generateCollegeProfile(rng: Rng, position: Position, trueAttrs: AttrMap, trueOvr: number): CollegeProfile {
  // 0..1 quality dial from true overall — drives every stat mean below.
  const q = prospectQuality(trueOvr);
  const games: CollegeGameLine[] = [];

  for (let w = 0; w < COLLEGE_WEEKS; w++) {
    const g: CollegeGameLine = {};
    switch (position) {
      case 'QB': {
        const att = normGame(rng, 30, 5);
        const cmpPct = clamp(0.55 + q * 0.15 + rng.float(-0.05, 0.05), 0.45, 0.78);
        const cmp = Math.min(att, Math.round(att * cmpPct));
        const ypa = clamp(6.8 + q * 3.2 + rng.float(-0.8, 0.8), 4.5, 12);
        g.passAtt = att; g.passCmp = cmp; g.passYds = Math.round(att * ypa);
        g.passTd = normGame(rng, 1.3 + q * 1.4, 1.1);
        g.passInt = normGame(rng, Math.max(0.15, 1.1 - q * 0.8), 0.7);
        g.rushYds = normGame(rng, 10 + (trueAttrs.speed ?? 50) / 4, 15, -10);
        g.rushTd = rng.bool(0.15 + q * 0.1) ? 1 : 0;
        break;
      }
      case 'RB': {
        const att = normGame(rng, 14, 5);
        const ypc = clamp(4.4 + q * 2.0 + rng.float(-0.6, 0.6), 2.5, 8);
        g.rushAtt = att; g.rushYds = Math.round(att * ypc);
        g.rushTd = normGame(rng, 0.4 + q * 0.6, 0.6);
        g.targets = normGame(rng, 2 + q * 2, 1.5);
        g.rec = Math.min(g.targets, normGame(rng, (g.targets ?? 0) * 0.7, 1));
        g.recYds = Math.round((g.rec ?? 0) * clamp(7 + q * 3, 5, 13));
        break;
      }
      case 'WR': {
        const targets = normGame(rng, 5 + q * 4, 2.5);
        g.targets = targets;
        g.rec = Math.min(targets, normGame(rng, targets * (0.55 + q * 0.1), 1.5));
        g.recYds = Math.round((g.rec ?? 0) * clamp(11 + q * 6, 8, 20));
        g.recTd = rng.bool(0.12 + q * 0.18) ? 1 : 0;
        break;
      }
      case 'TE': {
        const targets = normGame(rng, 3 + q * 2.5, 2);
        g.targets = targets;
        g.rec = Math.min(targets, normGame(rng, targets * 0.6, 1));
        g.recYds = Math.round((g.rec ?? 0) * clamp(9 + q * 4, 6, 15));
        g.recTd = rng.bool(0.1 + q * 0.12) ? 1 : 0;
        break;
      }
      case 'LT': case 'LG': case 'C': case 'RG': case 'RT': {
        g.sacksAllowed = rng.bool(clamp(0.18 - q * 0.13, 0.01, 0.2)) ? 1 : 0;
        g.pancakes = normGame(rng, 1.5 + q * 2.5, 1.3);
        break;
      }
      case 'EDGE': case 'DT': {
        g.tkl = normGame(rng, 2.5 + q * 2, 1.3);
        g.sacks = Math.max(0, Number((rng.normal(0.2 + q * 0.5, 0.35)).toFixed(1)));
        g.tfl = normGame(rng, 0.6 + q * 0.8, 0.6);
        g.ff = rng.bool(0.04 + q * 0.05) ? 1 : 0;
        break;
      }
      case 'LB': {
        g.tkl = normGame(rng, 4 + q * 3, 1.8);
        g.sacks = Math.max(0, Number((rng.normal(0.1 + q * 0.2, 0.2)).toFixed(1)));
        g.tfl = normGame(rng, 0.5 + q * 0.6, 0.5);
        g.ints = rng.bool(0.03 + q * 0.05) ? 1 : 0;
        break;
      }
      case 'CB': case 'S': {
        g.tkl = normGame(rng, 3 + q * 1.5, 1.3);
        g.ints = rng.bool(0.06 + q * 0.08) ? 1 : 0;
        g.pd = normGame(rng, 0.4 + q * 0.7, 0.6);
        g.ff = rng.bool(0.02 + q * 0.03) ? 1 : 0;
        break;
      }
      case 'K': {
        g.fgAtt = normGame(rng, 1.3, 0.9);
        const pct = clamp(0.65 + q * 0.3 + rng.float(-0.1, 0.1), 0.4, 1);
        g.fgMade = Math.min(g.fgAtt, Math.round((g.fgAtt ?? 0) * pct));
        g.xpMade = normGame(rng, 3, 1.2);
        break;
      }
      case 'P': {
        g.punts = normGame(rng, 4.5, 1.5);
        const avg = clamp(38 + q * 8 + rng.float(-3, 3), 32, 52);
        g.puntYds = Math.round((g.punts ?? 0) * avg);
        break;
      }
    }
    games.push(g);
  }

  // Competition strength loosely tracks talent (better prospects tend to play
  // at bigger programs) but overlaps heavily on purpose — a chunk of A-tier
  // talent tests against F-tier competition (small-school hidden gems) and
  // vice versa (system products at big programs whose stats don't hold up).
  const gradeRoll = clamp(q + rng.float(-0.45, 0.45), 0, 1);
  const competitionGrade = COMPETITION_GRADES[clamp(Math.floor((1 - gradeRoll) * COMPETITION_GRADES.length), 0, COMPETITION_GRADES.length - 1)];

  return { games, competitionGrade };
}

const SKIPS_BENCH: Position[] = ['QB', 'WR', 'CB', 'S', 'K', 'P'];

/**
 * ===========================================================================
 * COMBINE TESTING — SIX DRILLS, NOT ONE NUMBER SIX TIMES
 * ===========================================================================
 * WHAT THIS USED TO BE, MEASURED. Every drill was a linear function of a
 * single scalar `proxy`, so all six were the same draw wearing different
 * units. Over 16,000 blindly-walked prospects (40 classes of 400):
 *
 *   forty vs trueOvr  -0.543      vertical vs trueOvr  +0.548
 *   bench vs trueOvr  +0.527      forty vs weight      -0.005
 *
 * Three identical magnitudes, because there was one variable. And only the
 * 40 was anchored per position, so the other five were the SAME number for
 * everybody in football:
 *
 *   vertical   every position 30.7-31.7in   real: CB 35.5, LG 27.0
 *   broad      every position 103.7-105.1   real: CB 122,  LG 102
 *   three-cone every position 6.82-6.87s    real: CB 6.90, LG 7.90
 *   shuttle    every position 4.17-4.22s    real: CB 4.18, LG 4.80
 *   bench      every position 16.4-17.3     real: DT 27,   TE 19
 *
 * A guard who runs the three-cone in 6.30 and the shuttle in 3.80 is not a
 * guard, and those were not rare: the hard clamps at the bottom of both
 * drills were the single most common value in the game — 29.4% of ALL
 * prospects tested at exactly the 3.80 shuttle floor (44.7x the count one
 * hundredth above it) and 17.3% at the 6.30 three-cone floor (24.5x). That
 * is the clamp-pile bug this codebase has shipped repeatedly, in a place
 * nobody had measured.
 *
 * WHAT IT IS NOW. Each drill is an anchored, position-real distribution
 * whose z-score is a NOISY READ OF THE ATTRIBUTES IT MEASURES:
 *
 *   z = ABILITY_WEIGHT * (how good he is)
 *     + ATTR_WEIGHT    * (how he carries the relevant attributes FOR his
 *                         position and grade)
 *     + NOISE_WEIGHT   * (day-of noise)
 *
 * then bent through softTail so the extremes thin out instead of piling up
 * against a wall, then placed as `anchor.mean + anchor.sd * z`. The weights
 * are squared-summed to 1 so z stays unit-variance and the printed sd is the
 * one in the table rather than an accident.
 *
 * The three outlier archetypes still override the ability term outright —
 * that gap between the stopwatch and the player is the content the scouting
 * layer trades on, and it is the whole reason testing is public while
 * ratings are fogged.
 * ===========================================================================
 */

/** The six drills, and what each one is a measurement OF. */
export interface DrillAnchor {
  /** Position mean and sd, in the drill's own units. */
  forty: [number, number];
  vertical: [number, number];
  broad: [number, number];
  cone: [number, number];
  shuttle: [number, number];
  bench: [number, number];
}

/**
 * Per-position testing anchors, set to the published NFL combine per-position
 * means and spreads. [TUNE — these ARE fitted to real combine data, unlike
 * most of this file; move them only against the same source.]
 *
 * Timed drills (forty, cone, shuttle) are LOWER-is-better and carry a
 * negative slope below; the jumps and the bench are higher-is-better.
 *
 * THE SD COLUMN IS THE COMPOSITE'S SD, NOT QUITE THE PRINTED ONE. The three
 * weights below square to 1, so a NORMAL tester's spread is exactly this
 * column — but the outlier archetypes sit outside that unit variance by
 * design, and about one prospect in nine is one. Measured over 16,000
 * prospects the realised spread runs ~1.1x the table (WR 40: 0.10 against
 * 0.09; LT 40: 0.15 against 0.13; DT bench: 5.1 against 4.7), which lands ON
 * the real per-position spread rather than under it — published combine sds
 * include their own workout warriors too.
 */
export const COMBINE_ANCHOR: Record<Position, DrillAnchor> = {
  QB:   { forty: [4.80, 0.11], vertical: [31.0, 3.2], broad: [111, 5.5], cone: [7.05, 0.20], shuttle: [4.30, 0.14], bench: [0, 0] },
  RB:   { forty: [4.52, 0.09], vertical: [34.5, 3.3], broad: [119, 5.5], cone: [7.02, 0.20], shuttle: [4.28, 0.14], bench: [20, 4.5] },
  WR:   { forty: [4.48, 0.09], vertical: [35.5, 3.3], broad: [121, 5.5], cone: [6.95, 0.20], shuttle: [4.22, 0.13], bench: [0, 0] },
  TE:   { forty: [4.70, 0.10], vertical: [33.0, 3.2], broad: [114, 5.5], cone: [7.10, 0.21], shuttle: [4.35, 0.15], bench: [19, 4.5] },
  LT:   { forty: [5.20, 0.13], vertical: [27.5, 2.9], broad: [103, 5.0], cone: [7.85, 0.28], shuttle: [4.75, 0.19], bench: [25, 4.5] },
  LG:   { forty: [5.25, 0.13], vertical: [27.0, 2.9], broad: [102, 5.0], cone: [7.90, 0.28], shuttle: [4.80, 0.19], bench: [26, 4.5] },
  C:    { forty: [5.22, 0.13], vertical: [27.5, 2.9], broad: [102, 5.0], cone: [7.80, 0.27], shuttle: [4.72, 0.18], bench: [26, 4.5] },
  RG:   { forty: [5.25, 0.13], vertical: [27.0, 2.9], broad: [102, 5.0], cone: [7.90, 0.28], shuttle: [4.80, 0.19], bench: [26, 4.5] },
  RT:   { forty: [5.20, 0.13], vertical: [27.5, 2.9], broad: [103, 5.0], cone: [7.85, 0.28], shuttle: [4.75, 0.19], bench: [25, 4.5] },
  EDGE: { forty: [4.75, 0.10], vertical: [33.0, 3.2], broad: [116, 5.5], cone: [7.25, 0.22], shuttle: [4.40, 0.15], bench: [22, 4.5] },
  DT:   { forty: [5.06, 0.12], vertical: [29.0, 3.0], broad: [105, 5.2], cone: [7.70, 0.26], shuttle: [4.65, 0.18], bench: [27, 4.7] },
  LB:   { forty: [4.65, 0.09], vertical: [33.5, 3.2], broad: [117, 5.5], cone: [7.08, 0.20], shuttle: [4.32, 0.14], bench: [21, 4.5] },
  CB:   { forty: [4.47, 0.08], vertical: [35.5, 3.3], broad: [122, 5.5], cone: [6.90, 0.19], shuttle: [4.18, 0.13], bench: [0, 0] },
  S:    { forty: [4.54, 0.09], vertical: [34.5, 3.3], broad: [120, 5.5], cone: [6.95, 0.19], shuttle: [4.22, 0.13], bench: [0, 0] },
  K:    { forty: [4.95, 0.13], vertical: [28.0, 3.4], broad: [105, 6.0], cone: [7.30, 0.24], shuttle: [4.50, 0.17], bench: [0, 0] },
  P:    { forty: [4.95, 0.13], vertical: [28.0, 3.4], broad: [105, 6.0], cone: [7.30, 0.24], shuttle: [4.50, 0.17], bench: [0, 0] },
};

/**
 * Positional 40 baselines. EXPORTED because lib/consensus.ts inverts this
 * exact anchor to recover the public testing read from the published time —
 * it used to keep its own copy of the table, and two copies drifting apart
 * would silently make the consensus board misread testing. Derived from
 * COMBINE_ANCHOR rather than restated, for the same reason.
 */
export const BASE_40: Partial<Record<Position, number>> = Object.fromEntries(
  (Object.keys(COMBINE_ANCHOR) as Position[]).map((p) => [p, COMBINE_ANCHOR[p].forty[0]]),
) as Partial<Record<Position, number>>;

/**
 * Reference playing weight per position — the body a drill's anchor already
 * assumes. Only used to price the DIFFERENCE between this man and that
 * reference, so it never moves the position mean.
 * Mirrors the BODY table in lib/gen/players.ts.
 */
const REF_WEIGHT: Record<Position, number> = {
  QB: 220, RB: 214, WR: 200, TE: 250, LT: 313, LG: 315, C: 305, RG: 315, RT: 315,
  EDGE: 262, DT: 305, LB: 238, CB: 192, S: 205, K: 195, P: 205,
};
/** Spread of playing weight within a position, same source. */
const REF_WEIGHT_SD = 14;

/**
 * Testing-day outlier archetypes (design doc: "combine numbers should
 * correlate with ability, imperfectly"). Rolled off `truePercentile` — this
 * prospect's trueOvr rank within his OWN position group in the class, 0 =
 * worst, 1 = best, supplied by generateDraftClass once the whole class
 * exists (a single prospect's own generation has no way to know that on its
 * own). Bottom-third guys can only roll WARRIOR (great testing, bad
 * football player — the trap); top-third guys can only roll SLEEPER (great
 * testing, genuinely good — the guy testing plus tape finds) or BAD_TESTER
 * (poor testing, genuinely good — the guy testing alone would bury). A
 * prospect in the middle third never gets an outlier roll at all — the
 * whole design point is that both traps are draft-capital-relevant misses,
 * not "anyone can randomly test weird."
 */
type TestingArchetype = 'WARRIOR' | 'SLEEPER' | 'BAD_TESTER' | 'NORMAL';

function rollTestingArchetype(rng: Rng, truePercentile: number): TestingArchetype {
  if (truePercentile < COMBINE.OUTLIER_TIER) {
    return rng.bool(COMBINE.OUTLIER_RATE) ? 'WARRIOR' : 'NORMAL';
  }
  if (truePercentile >= 1 - COMBINE.OUTLIER_TIER) {
    if (rng.bool(COMBINE.OUTLIER_RATE)) return 'SLEEPER';
    // Second independent roll off the same top-third pool (SLEEPER guys
    // already consumed by the branch above), not a fresh third population.
    if (rng.bool(COMBINE.OUTLIER_RATE)) return 'BAD_TESTER';
  }
  return 'NORMAL';
}

/**
 * NO HARD CLAMP AT EITHER END OF ANY DRILL.
 *
 * Below `knee` this is the identity; past it the magnitude is compressed
 * toward `limit` along a decaying exponential whose scale is the remaining
 * span, so the curve leaves the knee with slope exactly 1 and never reaches
 * the limit. Same shape as lib/gen/players.ts bendToCeiling, applied to |z|
 * so it guards both tails of a symmetric distribution at once — which is why
 * it is a separate function rather than a second caller of that one (and why
 * importing it here would close an import cycle: players.ts imports this
 * module).
 *
 * The point is the one the owner has had to make five times: `Math.min(x,
 * CEILING)` makes the most extreme outcome the most COMMON value at that end
 * of the scale. The 3.80 shuttle floor held 29.4% of every draft class.
 */
function softTail(z: number, knee: number, limit: number): number {
  const a = Math.abs(z);
  if (a <= knee) return z;
  const span = limit - knee;
  if (span <= 0) return z;
  return Math.sign(z) * (limit - span * Math.exp(-(a - knee) / span));
}

/**
 * How far above or below his own grade this man carries one attribute, in
 * standard deviations — the "for a left tackle rated 78, is he a fast one?"
 * question, which is the only version of the question a combine number can
 * honestly answer here.
 *
 * lib/gen/players.ts generateAttributes samples a weighted attribute around
 * the target overall and an unweighted one around 0.85 of it (with a much
 * wider sd, since it does not move his rating). Reading those shapes from
 * GENERATION.ATTR_SD rather than restating the residual spread means this
 * does not go stale the next time attribute generation is retuned. Measured
 * over 12,000 prospects at HEAD: residual mean 0.0 both ways, residual sd
 * 6.0-7.4 weighted and 14.6-16.5 unweighted, against the 6.6 and 15.2 the
 * multipliers below predict.
 *
 * Returns 0 for an attribute the position does not carry at all (no
 * acceleration on an offensive lineman) — neutral, never a fabricated read.
 */
function attrZ(position: Position, attrs: AttrMap, key: string, trueOvr: number): number {
  const value = attrs[key];
  if (value == null) return 0;
  const weighted = POSITION_WEIGHTS[position][key] != null;
  const expected = weighted ? trueOvr : trueOvr * COMBINE.UNWEIGHTED_ATTR_LEVEL;
  const sd = GENERATION.ATTR_SD * (weighted ? COMBINE.RESID_SD_MULT_WEIGHTED : COMBINE.RESID_SD_MULT_UNWEIGHTED);
  return sd > 0 ? (value - expected) / sd : 0;
}

/**
 * The blended physical read behind one drill. Weights are the attributes the
 * drill actually measures; the divisor is sqrt(sum of squares) over the
 * attributes this position HAS, which keeps the blend unit-variance whether
 * a position carries two of them or four.
 */
function blendZ(position: Position, attrs: AttrMap, trueOvr: number, weights: Record<string, number>): number {
  let sum = 0;
  let sq = 0;
  for (const [key, w] of Object.entries(weights)) {
    if (attrs[key] == null) continue;
    sum += w * attrZ(position, attrs, key, trueOvr);
    sq += w * w;
  }
  return sq > 0 ? sum / Math.sqrt(sq) : 0;
}

/** What each drill is a measurement of. [TUNE] */
const DRILL_ATTRS = {
  forty:    { speed: 0.65, acceleration: 0.35 },
  vertical: { speed: 0.40, strength: 0.30, acceleration: 0.30 },
  broad:    { speed: 0.45, strength: 0.25, acceleration: 0.30 },
  cone:     { agility: 0.60, acceleration: 0.20, speed: 0.20 },
  shuttle:  { agility: 0.60, acceleration: 0.25, speed: 0.15 },
  bench:    { strength: 1.00 },
} as const;

/** Standard-normal quantile (Acklam's rational approximation, |err| < 1.2e-9). */
function probit(p: number): number {
  const q = clamp(p, 1e-6, 1 - 1e-6);
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (q < lo) {
    const s = Math.sqrt(-2 * Math.log(q));
    return (((((c[0] * s + c[1]) * s + c[2]) * s + c[3]) * s + c[4]) * s + c[5]) / ((((d[0] * s + d[1]) * s + d[2]) * s + d[3]) * s + 1);
  }
  if (q > 1 - lo) {
    const s = Math.sqrt(-2 * Math.log(1 - q));
    return -(((((c[0] * s + c[1]) * s + c[2]) * s + c[3]) * s + c[4]) * s + c[5]) / ((((d[0] * s + d[1]) * s + d[2]) * s + d[3]) * s + 1);
  }
  const s = q - 0.5;
  const r = s * s;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * s / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** A prospect's measured body, when the caller has it. See generateCombineTesting. */
export interface CombineBody {
  heightIn: number;
  weightLb: number;
}

/**
 * Combine or pro-day testing numbers — always public knowledge, unlike
 * scouted attribute ranges.
 *
 * `truePercentile` (0=worst, 1=best within this prospect's OWN position
 * group in the class) drives the correlation between true ability and how
 * he tests; defaults to 0.5 (neutral) for any caller that doesn't have a
 * whole class to rank against, e.g. a single ad-hoc generated player.
 *
 * `body` is OPTIONAL AND NO CALLER PASSES IT AT HEAD. Playing weight is what
 * separates two tackles who scout the same, and the only site that generates
 * a class (lib/gen/players.ts generateDraftClass, the combine pass at the
 * bottom) hands over `p.trueAttrs` and nothing else — so within a position
 * the stopwatch is body-blind here, exactly as it was before. Passing
 * `{ heightIn: p.heightIn, weightLb: p.weightLb }` at that one call site is
 * the whole fix and this function is already written for it; it is left
 * undone only because that file belongs to another change in flight.
 */
export function generateCombineTesting(rng: Rng, position: Position, trueAttrs: AttrMap, trueOvr: number, truePercentile = 0.5, body?: CombineBody): CombineTesting {
  const anchor = COMBINE_ANCHOR[position] ?? COMBINE_ANCHOR.LB;
  const archetype = rollTestingArchetype(rng, truePercentile);

  /*
   * How good he is, as a z. truePercentile is a RANK inside his position
   * group, so it is uniform by construction and its probit is standard normal
   * — no calibration constant needed and none to go stale.
   *
   * THE TWO ENDPOINTS NEED A GUARD AND THE MIDDLE DOES NOT. generateDraftClass
   * builds the percentile as idx/(n-1), so the best and the worst man at every
   * position in every class come in at EXACTLY 1 and 0, whose probits are the
   * tails of the normal — measured, that alone pushed the printed 40 spread
   * for a tackle from the 0.13 in the anchor table to 0.19, because two men in
   * fifteen were being handed a +/-4.75 z. Pinching the ends to
   * ABILITY_PCT_CLAMP leaves every interior rank untouched and puts the best
   * of a fifteen-man position group at about 1.9 sd, which is what being the
   * best of fifteen is worth.
   */
  const abilityZ = probit(clamp(truePercentile, COMBINE.ABILITY_PCT_CLAMP, 1 - COMBINE.ABILITY_PCT_CLAMP));

  // Playing weight relative to what this position's anchors already assume.
  // Positive = heavier than the reference, which costs time in everything
  // that involves moving the body and pays in the one drill that involves
  // moving a bar.
  const weightZ = body ? (body.weightLb - (REF_WEIGHT[position] ?? 240)) / REF_WEIGHT_SD : 0;

  /**
   * One drill's z. The three weights are squared-summed to 1 so the printed
   * spread is the anchor's sd and not an accident of how many terms happen
   * to be in the blend.
   */
  const drillZ = (attrs: Record<string, number>, weightPull: number): number => {
    const attr = blendZ(position, trueAttrs, trueOvr, attrs);
    const noise = rng.normal(0, 1);
    const z = archetype === 'NORMAL'
      ? COMBINE.ABILITY_WEIGHT * abilityZ + COMBINE.ATTR_WEIGHT * attr + COMBINE.NOISE_WEIGHT * noise
      // The outlier archetypes ignore ability outright. That is the point:
      // testing alone cannot tell a workout warrior from a real one, and only
      // the tape can. They still carry a little of his physical profile and a
      // little day-of noise so the six numbers are not identical.
      : (archetype === 'BAD_TESTER' ? -COMBINE.OUTLIER_Z : COMBINE.OUTLIER_Z)
        + COMBINE.OUTLIER_ATTR_WEIGHT * attr
        + COMBINE.OUTLIER_NOISE_WEIGHT * noise;
    return softTail(z + weightPull * weightZ, COMBINE.SOFT_KNEE_Z, COMBINE.SOFT_LIMIT_Z);
  };

  // Timed drills: a HIGHER z is a BETTER athlete, so it subtracts seconds.
  const fortyYard = anchor.forty[0] - anchor.forty[1] * drillZ(DRILL_ATTRS.forty, -COMBINE.WEIGHT_PULL);
  const threeCone = anchor.cone[0] - anchor.cone[1] * drillZ(DRILL_ATTRS.cone, -COMBINE.WEIGHT_PULL);
  const shuttle = anchor.shuttle[0] - anchor.shuttle[1] * drillZ(DRILL_ATTRS.shuttle, -COMBINE.WEIGHT_PULL);
  // Jumps and the bench: a higher z adds inches / reps.
  const vertical = anchor.vertical[0] + anchor.vertical[1] * drillZ(DRILL_ATTRS.vertical, -COMBINE.WEIGHT_PULL);
  const broadJump = anchor.broad[0] + anchor.broad[1] * drillZ(DRILL_ATTRS.broad, -COMBINE.WEIGHT_PULL);
  const benchReps = SKIPS_BENCH.includes(position) || anchor.bench[1] <= 0
    ? null
    // A rep count cannot go negative, and Math.max() there would be the very
    // pile this file just removed. softTail's limit is instead pulled in so
    // the asymptote itself sits above zero: the floor is unreachable rather
    // than crowded.
    : Math.max(1, Math.round(anchor.bench[0] + anchor.bench[1] * softTail(
        drillZ(DRILL_ATTRS.bench, COMBINE.WEIGHT_PULL),
        COMBINE.SOFT_KNEE_Z,
        Math.min(COMBINE.SOFT_LIMIT_Z, (anchor.bench[0] - 1) / anchor.bench[1]),
      )));

  // Higher-rated prospects test at the combine more consistently; the rest
  // more often only get a pro day. Expressed through prospectQuality for the
  // same reason the college dial is: this was `0.35 + (trueOvr - 50) / 90`,
  // which spanned 0.22..0.85 across the OLD class range and 0.39..0.77 across
  // the new one — the invitation had quietly stopped discriminating. The
  // endpoints below are the old formula's real endpoints.
  const combineOdds = clamp(0.22 + prospectQuality(trueOvr) * 0.63, 0.15, 0.92);
  const venue: CombineTesting['venue'] = rng.bool(combineOdds) ? 'COMBINE' : 'PRO_DAY';

  return { venue, fortyYard: Number(fortyYard.toFixed(2)), vertical: Math.round(vertical), broadJump: Math.round(broadJump), threeCone: Number(threeCone.toFixed(2)), shuttle: Number(shuttle.toFixed(2)), benchReps };
}

/**
 * Position-weighted "public perception" score for ranking the board —
 * distinct from the raw scouted grade, the same way real big boards value
 * a QB or edge rusher over a similarly-graded guard. A small deterministic
 * wobble (reseeded every couple weeks, not every render) gives risers and
 * fallers across the season without touching anyone's true rating.
 *
 * `testingPercentile` (0-100, from lib/combineRank's overallTestingPercentile,
 * null/omitted if nobody has recorded numbers) is the public's OTHER input
 * besides scoutedOvr — it's what makes the two combine outlier archetypes
 * actually matter instead of being cosmetic: a workout warrior's testing is
 * public and genuinely lifts him here even though scoutedOvr never saw it
 * coming, and a good player who tests poorly gets actively marked down by
 * evaluators who over-index on the stopwatch, same as real draft media does.
 * Weighted modestly relative to scoutedOvr's own spread — a strong workout
 * nudges the board, it doesn't rewrite the grade.
 */
export function bigBoardScore(scoutedOvr: number, position: Position, playerId: string, leagueWeek: number, posValue: number, testingPercentile?: number | null): number {
  const buzzRng = new Rng(`${playerId}-buzz-${Math.floor(leagueWeek / 2)}`);
  const buzz = buzzRng.float(-3, 3);
  const testingSwing = testingPercentile != null ? ((testingPercentile - 50) / 50) * 8 * posValue : 0;
  return scoutedOvr * posValue + buzz + testingSwing;
}

/**
 * Scouting-note flavor text hinting at hidden-gem / bust-risk archetypes —
 * never states the true rating, just teases the gap between it and the
 * scouted number once there's enough confidence to notice a pattern at all.
 */
export function prospectBuzzNote(trueOvr: number, potential: number, scoutedOvr: number, confidence: number, grade: CompetitionGrade): string | null {
  if (confidence < 25) return null;
  const gap = trueOvr - scoutedOvr;
  if (gap >= 10 && (grade === 'A' || grade === 'B')) return 'Produced against real competition — some evaluators think this grade is light.';
  if (gap >= 10) return 'A few scouts are quietly higher on him than the consensus grade suggests.';
  if (gap <= -10 && (grade === 'D' || grade === 'F')) return 'Gaudy numbers, soft competition — buyer beware translating this to Sundays.';
  if (gap <= -10) return 'Tape doesn\'t match the box score for some evaluators.';
  if (potential >= 92 && confidence < 55) return 'Ceiling nobody has fully seen yet.';
  return null;
}

/**
 * Per-position-group OVR bias for one draft class — the difference between
 * "every class is a flat random sample" and a class having a personality
 * (loaded at one spot, thin at another, the way real classes are talked
 * about). Applied as an offset to every prospect's target overall in
 * generateDraftClass, at that player's own position group.
 */
export function generateClassStrength(rng: Rng): Record<PositionGroup, number> {
  const out = {} as Record<PositionGroup, number>;
  for (const g of POSITION_GROUPS) out[g] = Math.round(rng.normal(0, 6));
  return out;
}

/** Plain-language "loaded here, thin there" summary for the strength map above — the class outlook the user actually reads. */
export function classStrengthSummary(strength: Record<PositionGroup, number>): string {
  const entries = Object.entries(strength) as [PositionGroup, number][];
  const loaded = entries.filter(([, v]) => v >= 5).sort((a, b) => b[1] - a[1]).map(([g]) => g);
  const thin = entries.filter(([, v]) => v <= -5).sort((a, b) => a[1] - b[1]).map(([g]) => g);
  const parts: string[] = [];
  if (loaded.length > 0) parts.push(`Loaded at ${loaded.join(', ')}`);
  if (thin.length > 0) parts.push(`thin at ${thin.join(', ')}`);
  if (parts.length === 0) return 'An even class, no real strength or weakness at any one position.';
  return parts.join(' — ') + '.';
}
