import { prisma } from './db';
import { readJson } from './json';
import { mergeStats } from './stats';
import { Rng } from './rng';
import { canonicalPosition } from './tuning';
import { gradeLine, playedEnough, statLine } from './coachRoom';
import { positionRelativeScore } from './performanceScore';
import type { BoxScore, SeasonStats } from './types';

/**
 * ===========================================================================
 * THE SEASON IN REVIEW — what actually happened to your players this year
 * ===========================================================================
 * "at the end of every season after the championship... it could be cool to
 * have storylines. we would need a LOT of different ones but something like
 * 'Your QB started off horrible with XYZ statline but rebounded in the second
 * half of the season'."
 *
 * ---------------------------------------------------------------------------
 * 1. IT DOES NOT RANK PLAYERS. lib/performanceScore.ts DOES.
 * ---------------------------------------------------------------------------
 * Same rule lib/coachRoom.ts opens with, and for the same reason: All-Star
 * selection, the Week Report's Coach's Comments and this file are not allowed
 * to disagree about who played well. Every grade here comes out of
 * `gradeLine()` in lib/coachRoom.ts — the shared ranker, calibrated through
 * each position's own measured percentile ladder — so a 78 means the same of
 * a corner as of a quarterback here as it does there. Nothing below invents a
 * second opinion about quality. What it adds is the question a WEEK cannot
 * ask: what shape did the year have?
 *
 * ---------------------------------------------------------------------------
 * 2. THREE YARDSTICKS, EACH MEASURED, EACH USED FOR ONE THING
 * ---------------------------------------------------------------------------
 * Every population below was measured over this Postgres: 53,045 played games
 * replayed into 203,615 (player, club, season) rows. Nothing here is a number
 * that sounded about right.
 *
 *   a) SEASON_LADDER — a season's worth of weekly grades, averaged, then run
 *      through its position's own ladder of REAL SEASONS (n=6,130 to 25,407 a
 *      position, gated to men with at least eight graded weeks). The single
 *      game ladder in lib/coachRoom.ts cannot do this job: averaging seventeen
 *      percentiles is a much quieter number than any one of them, and a
 *      position's season distribution is not the same shape as its afternoon
 *      distribution. Measured, the median RUNNING BACK season averages 48.8
 *      and the median LINEBACKER season 42.0, but the linebacker's 90th
 *      percentile is 50.2 where the back's is 82.6 — a linebacker's whole
 *      season lives inside eight points of grade, because the engine deals his
 *      afternoon as a flat tackle roll. A flat "he had a top-15% year" bar
 *      across that would be a receivers-and-backs feature wearing a league-wide
 *      coat. Through each position's own ladder, "top 15% of seasons at his
 *      position" means one thing everywhere.
 *
 *   b) SPLIT_T — the first-half/second-half test, and the one place a naive
 *      threshold would have been badly wrong. The raw swing in average grade
 *      is NOT comparable across positions: measured, the 90th-percentile
 *      second-half improvement is +10.0 points for a receiver and +23.5 for a
 *      corner, because a corner's grade turns on interceptions and forced
 *      fumbles, which are coin flips, and a receiver's turns on yardage, which
 *      is not. A flat swing bar would have printed "he turned his season
 *      around" for half the secondary every year and almost never for a
 *      receiver who actually did. So the test is the swing divided by HIS OWN
 *      week-to-week noise — a two-sample t, the textbook answer — and that
 *      statistic comes out almost position-flat (98th percentile: 1.80 at
 *      linebacker, 2.23 at running back). The remaining spread is small enough
 *      to bake per position rather than paper over.
 *
 *   c) CAREER_MARGIN — how much better (or worse) than his own previous best
 *      (or worst) a year has to be before it is a career year. Measured over
 *      every season with at least two prior seasons behind it: a BARE new
 *      career best happens 24.6% of the time, which is not a story, it is
 *      arithmetic. The bars below are the 95th percentile of the margin, per
 *      position, and land the claim near one season in twenty.
 *
 * Cross-year comparison deliberately uses the shared ranker's RAW z, not the
 * ladder percentile. The ladder is built from single-game outings, and a
 * season's per-game average line falls between its rungs — for a linebacker
 * the ladder is one long flat run, so percentile is nearly binary and could
 * not order his own eight seasons at all. z is continuous and monotone, which
 * is all an ordering needs, and it is the same ranker's own output.
 *
 * ---------------------------------------------------------------------------
 * 3. ONE MAN, ONE STORY
 * ---------------------------------------------------------------------------
 * Coach's Comments had to fix a receiver appearing under "who showed up" and
 * "didn't help us" on one sheet. The same rule is structural here: candidates
 * are generated freely, then collapsed to the single strongest per player
 * before anything is printed. A kind can appear at most twice and a family at
 * most three times in one recap, so no single verdict can own a year.
 *
 * ---------------------------------------------------------------------------
 * 4. WHAT IS NOT SAID
 * ---------------------------------------------------------------------------
 *  - Offensive linemen and punters never appear. The engine writes no box line
 *    for an OL at all, and a punter's yards are `punts * rng.int(40,50)` with
 *    no input from his rating. Praising either would be praising nothing.
 *  - Regular season and postseason are never added together. Every line says
 *    which one it is about, because a nineteen-game total is not a season.
 *  - Ratings are only used when the save actually shows them (see
 *    `ratingsVisible`). Reading `trueOvr` into prose on a fogged roster would
 *    hand the player a number the whole scouting system exists to hide.
 *  - Nothing claims a man's last good year, a lost step, a rift or a system
 *    change. The simulation records none of those, so neither does this.
 * ===========================================================================
 */

// ---------------------------------------------------------------------------
// The measured yardsticks
// ---------------------------------------------------------------------------

/** The percentile each rung of SEASON_LADDER stands for. Mirrors lib/coachRoom.ts. */
const LEVELS = [1, 2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 98, 99] as const;

/**
 * A season's average weekly grade, by position, over every real season in this
 * database with at least eight graded weeks. Regenerate with
 * `scripts/_rev_an4.ts` if the engine's stat allocation changes.
 */
const SEASON_LADDER: Record<string, number[]> = {
  QB:   [22.7, 25.1, 29.7, 33.8, 36.6, 39.2, 41.4, 43.5, 45.3, 47.2, 48.9, 50.6, 52.3, 54.0, 55.8, 57.9, 60.0, 62.0, 64.4, 67.8, 72.3, 76.9, 79.4], // n=6263
  RB:   [12.8, 14.3, 16.8, 19.7, 22.4, 25.4, 29.1, 33.9, 38.9, 43.0, 46.0, 48.8, 52.0, 56.5, 66.1, 72.7, 75.7, 78.1, 80.3, 82.6, 85.6, 89.3, 91.9], // n=17669
  WR:   [12.4, 14.4, 18.1, 22.4, 25.9, 29.1, 32.6, 36.6, 40.5, 44.0, 47.8, 51.8, 56.3, 60.2, 63.6, 67.0, 70.8, 74.6, 78.0, 81.4, 85.8, 89.8, 91.7], // n=25407
  TE:   [14.6, 16.5, 19.9, 23.8, 26.8, 29.5, 32.0, 34.6, 37.6, 41.0, 45.3, 50.4, 55.4, 60.6, 64.4, 67.4, 69.9, 72.6, 75.3, 78.6, 82.6, 86.2, 88.0], // n=12580
  EDGE: [22.8, 25.6, 29.4, 32.8, 35.2, 37.1, 38.6, 40.1, 41.4, 42.7, 44.0, 45.3, 46.5, 47.8, 49.1, 50.5, 51.9, 53.7, 55.7, 58.3, 62.5, 67.9, 72.4], // n=18731
  DT:   [30.7, 32.7, 35.7, 38.4, 40.2, 41.7, 43.1, 44.3, 45.4, 46.5, 47.5, 48.6, 49.6, 50.7, 51.9, 53.1, 54.3, 55.7, 57.5, 59.8, 63.7, 68.8, 72.4], // n=18830
  LB:   [34.8, 35.4, 36.9, 37.5, 37.9, 38.3, 38.8, 40.3, 40.8, 41.2, 41.6, 42.0, 42.8, 43.8, 44.3, 44.8, 45.6, 47.1, 48.2, 50.2, 54.0, 61.6, 71.8], // n=18906
  CB:   [23.5, 26.1, 30.3, 33.4, 35.7, 37.5, 39.0, 40.4, 41.7, 42.9, 44.0, 45.2, 46.4, 47.7, 48.9, 50.2, 51.6, 53.2, 55.1, 57.3, 61.0, 65.4, 68.8], // n=18907
  S:    [27.1, 29.3, 33.0, 36.0, 38.2, 40.0, 41.4, 42.7, 44.0, 45.2, 46.3, 47.5, 48.7, 49.9, 51.2, 52.7, 54.3, 55.9, 58.1, 61.0, 66.4, 73.8, 80.7], // n=12622
  K:    [22.1, 24.3, 27.4, 30.1, 31.9, 33.3, 34.7, 36.0, 37.1, 38.1, 39.3, 40.3, 41.4, 42.5, 43.5, 44.8, 46.0, 47.5, 49.1, 51.2, 54.6, 58.1, 60.6], // n=6130
};

/**
 * [TUNE] The two-sample t at which a first-half/second-half difference stops
 * being ordinary week-to-week noise. The 95th percentile of the measured
 * statistic, per position (n=5,590 to 23,315 real half-splits each).
 */
const SPLIT_T: Record<string, number> = {
  QB: 1.68, RB: 1.87, WR: 1.82, TE: 1.78, EDGE: 1.70, DT: 1.70, LB: 1.56, CB: 1.70, S: 1.74, K: 1.68,
};

/**
 * [TUNE] How far past his own previous best (or previous worst) a year has to
 * land, in the shared ranker's z, before it earns the word "career". The 95th
 * percentile of the measured margin, per position, over every season that had
 * at least two seasons behind it.
 *
 * The spread across positions is the whole reason this is a table: a running
 * back has to beat his best by 0.73 and a quarterback by 0.18, because a
 * back's year swings on a workload that can be handed to somebody else and a
 * quarterback's does not.
 */
const CAREER_BEST_MARGIN: Record<string, number> = {
  QB: 0.18, RB: 0.73, WR: 0.36, TE: 0.28, EDGE: 0.24, DT: 0.26, LB: 0.33, CB: 0.21, S: 0.28, K: 0.19,
};
const CAREER_WORST_MARGIN: Record<string, number> = {
  QB: 0.20, RB: 0.51, WR: 0.55, TE: 0.62, EDGE: 0.18, DT: 0.19, LB: 0.19, CB: 0.16, S: 0.18, K: 0.17,
};

/**
 * [TUNE] Bars on the pay/rating gap — "paid at the Nth percentile among the
 * league's players at his position, produced at the Mth". Measured over every
 * club's last completed season, conditioned the same way the rules are: among
 * the well-paid (pay percentile 70+) the gap's 90th percentile is 66 and its
 * 95th is 75, so 70 lands the loudest version of this near one well-paid man
 * in fourteen. Unconditioned bars would have fired on any bench player whose
 * pay was merely median.
 */
const PAY_HIGH = 70;          // he is genuinely well paid for his position
const PAY_LOW = 45;           // he is genuinely cheap
const PAY_GAP_UNDER = 70;     // paid that far above what he produced
const PAY_GAP_OVER = -72;     // produced that far above what he is paid
const RATE_HIGH = 70;
const RATE_LOW = 45;
const RATE_GAP_UNDER = 70;
const RATE_GAP_OVER = -60;

/**
 * [TUNE] Missing this many games puts a man in the bottom 8% of availability
 * among players with a real role — measured, 69.9% of them miss none at all,
 * and only 8.0% miss four or more.
 */
const MISSED_GAMES_BAR = 4;

/** [TUNE] Season-production percentile bars, on the SEASON_LADDER scale. */
const GOOD_SEASON = 85;       // top 15% of seasons at his position
const SOLID_SEASON = 60;
const ORDINARY_CEILING = 45;
const POOR_SEASON = 25;

/** [TUNE] Enough graded weeks for a season-shaped claim at all. */
const MIN_SEASON_WEEKS = 8;
/** [TUNE] Enough graded weeks in EACH half for a trajectory claim. */
const MIN_HALF_WEEKS = 3;

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/**
 * Where a season's average weekly grade sits among real seasons at his
 * position, 0-100. Same flat-run rule as lib/coachRoom.ts's ladder: landing on
 * a repeated rung returns the middle of the run rather than whichever end the
 * sampling happened to put first.
 */
export function seasonPercentile(position: string, avgGrade: number): number | null {
  const ladder = SEASON_LADDER[canonicalPosition(position)];
  if (!ladder) return null;
  if (avgGrade <= ladder[0]) return avgGrade < ladder[0] ? 0 : LEVELS[0];
  const last = ladder.length - 1;
  if (avgGrade >= ladder[last]) return avgGrade > ladder[last] ? 100 : LEVELS[last];
  let first = -1, end = -1;
  for (let i = 0; i < ladder.length; i++) {
    if (ladder[i] === avgGrade) { if (first < 0) first = i; end = i; }
  }
  if (first >= 0) return (LEVELS[first] + LEVELS[end]) / 2;
  for (let i = 0; i < last; i++) {
    if (avgGrade > ladder[i] && avgGrade < ladder[i + 1]) {
      const t = (avgGrade - ladder[i]) / (ladder[i + 1] - ladder[i]);
      return LEVELS[i] + t * (LEVELS[i + 1] - LEVELS[i]);
    }
  }
  return 50;
}

/** Season totals reduced to the average afternoon inside them. */
export function perGameLine(stats: SeasonStats, gp: number): SeasonStats {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(stats as Record<string, number>)) {
    if (typeof v === 'number') out[k] = v / Math.max(1, gp);
  }
  out.gp = 1;
  return out as SeasonStats;
}

/**
 * The shared ranker's z for a whole season, via the average afternoon in it.
 * The one number that orders a man's own years against each other — see the
 * header on why the ladder percentile cannot do that job.
 */
export function seasonZ(position: string, stats: SeasonStats, gp: number): number | null {
  if (gp <= 0) return null;
  const g = gradeLine(position, perGameLine(stats, gp));
  return g ? g.z : null;
}

// ---------------------------------------------------------------------------
// Input model — everything a read needs, and nothing from the database
// ---------------------------------------------------------------------------

export interface ReviewWeek {
  week: number;
  stats: SeasonStats;
  /** Null when he did not clear lib/coachRoom.ts's workload gate that week. */
  grade: number | null;
}

export interface PriorSeason {
  seasonYear: number;
  teamAbbr: string;
  gp: number;
  z: number;
  stats: SeasonStats;
}

export interface ReviewPlayer {
  playerId: string;
  name: string;
  position: string;
  age: number;
  experience: number;
  /** Null for an undrafted man — the copy says so rather than guessing a round. */
  draftRound: number | null;
  heightIn: number;
  weightLb: number;
  /** Regular-season appearances FOR THIS CLUB, in week order. */
  weeks: ReviewWeek[];
  stats: SeasonStats;
  gp: number;
  /** Postseason appearances for this club — never merged with the above. */
  playoffWeeks: ReviewWeek[];
  playoffStats: SeasonStats;
  playoffGp: number;
  /** Completed prior seasons with a real workload, oldest first. */
  prior: PriorSeason[];
  /** Percentile of his contract's annual value among this league's players at his position. */
  payPct: number | null;
  apy: number | null;
  /** Percentile of his overall among the same population — null when the save fogs ratings. */
  ratingPct: number | null;
  rating: number | null;
  /** Injuries the box scores recorded for him this season, in week order. */
  injuries: { week: number; weeks: number; type: string }[];
}

export interface ReviewTeamYear {
  seasonYear: number;
  teamAbbr: string;
  wins: number; losses: number; ties: number;
  pointsFor: number; pointsAgnst: number;
  playoffResult: string;
  /** Regular-season games the club actually played. */
  teamGames: number;
  /** The last regular-season week the club played — where the halves divide. */
  lastWeek: number;
}

export interface ReviewInput {
  team: ReviewTeamYear;
  players: ReviewPlayer[];
  /** Seed for phrasing. Stable across renders by construction. */
  seed: string;
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

export type StoryKind =
  | 'SLOW_START' | 'SURGED' | 'FADED'
  | 'OVERPAID' | 'BARGAIN' | 'BELOW_RATING' | 'ABOVE_RATING'
  | 'CAREER_YEAR' | 'CAREER_WORST' | 'AGE_DECLINE'
  | 'ROOKIE_ARRIVAL' | 'SECOND_YEAR_LEAP'
  | 'MISSED_TIME' | 'NEVER_A_BAD_WEEK'
  | 'ONE_BIG_DAY'
  | 'ROSE_IN_JANUARY' | 'VANISHED_IN_JANUARY';

export type StoryFamily = 'TRAJECTORY' | 'VALUE' | 'CAREER' | 'ARRIVAL' | 'AVAILABILITY' | 'MOMENT' | 'POSTSEASON';

export const FAMILY_OF: Record<StoryKind, StoryFamily> = {
  SLOW_START: 'TRAJECTORY', SURGED: 'TRAJECTORY', FADED: 'TRAJECTORY',
  OVERPAID: 'VALUE', BARGAIN: 'VALUE', BELOW_RATING: 'VALUE', ABOVE_RATING: 'VALUE',
  CAREER_YEAR: 'CAREER', CAREER_WORST: 'CAREER', AGE_DECLINE: 'CAREER',
  ROOKIE_ARRIVAL: 'ARRIVAL', SECOND_YEAR_LEAP: 'ARRIVAL',
  MISSED_TIME: 'AVAILABILITY', NEVER_A_BAD_WEEK: 'AVAILABILITY',
  ONE_BIG_DAY: 'MOMENT',
  ROSE_IN_JANUARY: 'POSTSEASON', VANISHED_IN_JANUARY: 'POSTSEASON',
};

/** Whether a read is a good thing to have happened, for the ink it gets. */
export const TONE_OF: Record<StoryKind, 'good' | 'bad' | 'flat'> = {
  SLOW_START: 'good', SURGED: 'good', FADED: 'bad',
  OVERPAID: 'bad', BARGAIN: 'good', BELOW_RATING: 'bad', ABOVE_RATING: 'good',
  CAREER_YEAR: 'good', CAREER_WORST: 'bad', AGE_DECLINE: 'bad',
  ROOKIE_ARRIVAL: 'good', SECOND_YEAR_LEAP: 'good',
  MISSED_TIME: 'flat', NEVER_A_BAD_WEEK: 'good',
  ONE_BIG_DAY: 'flat',
  ROSE_IN_JANUARY: 'good', VANISHED_IN_JANUARY: 'bad',
};

export interface Story {
  kind: StoryKind;
  family: StoryFamily;
  tone: 'good' | 'bad' | 'flat';
  playerId: string;
  name: string;
  position: string;
  age: number;
  heightIn: number;
  weightLb: number;
  rookie: boolean;
  /** The prose. Two sentences at most, every claim carrying its own figure. */
  text: string;
  /** The season line underneath it, as lib/coachRoom.ts reads one aloud. */
  line: string;
  /** Which half of the year `line` is — the copy never leaves this implicit. */
  scope: 'REGULAR' | 'PLAYOFFS';
  /** Games the `line` covers, in the half of the year `scope` names. */
  games: number;
  /**
   * Where his year sits among real seasons at his position, 0-100 — the badge.
   * Null for a read whose subject is not the season's overall level.
   */
  pct: number | null;
  /** How far past its bar this instance ran, 0 upward. Orders the recap. */
  strength: number;
}

export interface SeasonReview {
  seasonYear: number;
  /** The club's own year, in a sentence. */
  opener: string;
  stories: Story[];
  /** Said instead of stories when nothing cleared a bar. A quiet year is allowed. */
  quiet: string | null;
}

// ---------------------------------------------------------------------------
// Reading numbers out loud
// ---------------------------------------------------------------------------

const WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** Small counts as words, the rest as figures — how a person says them. */
function count(n: number, singular: string, plural = `${singular}s`): string {
  const rounded = Math.round(n);
  const word = rounded <= 12 ? WORD[rounded] : rounded.toLocaleString();
  return `${word} ${rounded === 1 ? singular : plural}`;
}
function num(n: number): string { return Math.round(n).toLocaleString(); }
function capitalise(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
function join(bits: string[]): string {
  if (bits.length <= 1) return bits[0] ?? '';
  return `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}`;
}

/**
 * His numbers as a sentence fragment rather than a column — the two or three
 * figures that define the position, in the order lib/statLabels.ts already
 * ranks them. The mono line under every row carries the full set; this is what
 * the prose can say without turning into a table read aloud.
 */
export function spoken(position: string, s: SeasonStats): string {
  const pos = canonicalPosition(position);
  const bits: string[] = [];
  if (pos === 'QB') {
    bits.push(`${num(s.passYds ?? 0)} yards`);
    if ((s.passTd ?? 0) > 0) bits.push(count(s.passTd ?? 0, 'touchdown'));
    const ints = s.int ?? 0;
    const head = join(bits);
    return ints > 0 ? `${head} against ${count(ints, 'interception')}` : `${head} and nothing thrown away`;
  }
  if (pos === 'RB') {
    bits.push(`${num(s.rushYds ?? 0)} on ${count(s.rushAtt ?? 0, 'carry', 'carries')}`);
    if ((s.rushTd ?? 0) > 0) bits.push(count(s.rushTd ?? 0, 'score'));
    if ((s.rec ?? 0) >= 20) bits.push(count(s.rec ?? 0, 'catch', 'catches'));
    return join(bits);
  }
  if (pos === 'WR' || pos === 'TE') {
    bits.push(`${count(s.rec ?? 0, 'catch', 'catches')} for ${num(s.recYds ?? 0)}`);
    if ((s.recTd ?? 0) > 0) bits.push(count(s.recTd ?? 0, 'score'));
    return join(bits);
  }
  if (pos === 'EDGE' || pos === 'DT') {
    if ((s.sacks ?? 0) > 0) bits.push(count(s.sacks ?? 0, 'sack'));
    bits.push(count(s.tackles ?? 0, 'tackle'));
    if ((s.ff ?? 0) > 0) bits.push(count(s.ff ?? 0, 'forced fumble'));
    return join(bits.slice(0, 3));
  }
  if (pos === 'LB' || pos === 'CB' || pos === 'S') {
    if ((s.defInt ?? 0) > 0) bits.push(count(s.defInt ?? 0, 'interception'));
    if ((s.pd ?? 0) > 0) bits.push(`${count(s.pd ?? 0, 'ball', 'balls')} broken up`);
    bits.push(count(s.tackles ?? 0, 'tackle'));
    if ((s.ff ?? 0) > 0 && bits.length < 3) bits.push(count(s.ff ?? 0, 'forced fumble'));
    return join(bits.slice(0, 3));
  }
  if (pos === 'K') {
    const fg = `${s.fgm ?? 0} of ${s.fga ?? 0} from the field`;
    return (s.xpa ?? 0) > 0 ? `${fg} and ${s.xpm ?? 0} of ${s.xpa} on extra points` : fg;
  }
  return statLine(pos, s);
}

/** The one number that is HIS number — used where a sentence wants a single figure. */
function headlineNumber(position: string, s: SeasonStats): string {
  const pos = canonicalPosition(position);
  switch (pos) {
    case 'QB': return `${num(s.passYds ?? 0)} passing yards`;
    case 'RB': return `${num(s.rushYds ?? 0)} rushing yards`;
    case 'WR': case 'TE': return `${num(s.recYds ?? 0)} receiving yards`;
    case 'EDGE': case 'DT': return count(s.sacks ?? 0, 'sack');
    case 'LB': return count(s.tackles ?? 0, 'tackle');
    case 'CB': case 'S': return (s.defInt ?? 0) > 0 ? count(s.defInt ?? 0, 'interception') : count(s.pd ?? 0, 'pass broken up', 'passes broken up');
    case 'K': return `${s.fgm ?? 0} field goals`;
    default: return statLine(pos, s);
  }
}

/**
 * Draws phrasing without repeating a shape inside one recap, and without
 * handing the same club the same sentence every single year. Same device as
 * the Week Report's Voice class, and it exists for the same reason: two rows
 * built on one template is the tell that ends the illusion.
 */
class Voice {
  private queues = new Map<unknown[], unknown[]>();
  constructor(private rng: Rng) {}
  pick<T>(pool: T[]): T {
    let q = this.queues.get(pool) as T[] | undefined;
    if (!q || q.length === 0) { q = this.rng.shuffle(pool); this.queues.set(pool, q); }
    return q.pop()!;
  }
}

// ---------------------------------------------------------------------------
// The shape of one man's year
// ---------------------------------------------------------------------------

interface Shape {
  p: ReviewPlayer;
  graded: ReviewWeek[];
  avg: number;
  pct: number;
  z: number | null;
  /** Weeks up to and including the halfway point of the club's schedule. */
  first: ReviewWeek[];
  second: ReviewWeek[];
  firstAvg: number; secondAvg: number;
  firstPct: number; secondPct: number;
  firstStats: SeasonStats; secondStats: SeasonStats;
  /** Two-sample t on the two halves, using his own week-to-week spread. */
  t: number | null;
  best: ReviewWeek; bestGrade: number;
  missed: number;
  playoffGraded: ReviewWeek[];
  playoffAvg: number | null;
  playoffPct: number | null;
}

function sum(weeks: ReviewWeek[]): SeasonStats {
  let out: SeasonStats = {};
  for (const w of weeks) out = mergeStats(out, w.stats);
  return out;
}
function mean(xs: number[]): number { return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length); }

/**
 * The floor on the standard deviation in the t below.
 *
 * Defensive grades come off a ladder full of flat runs — a linebacker's whole
 * season can be three distinct values — so an honest sample deviation can come
 * out near zero and turn a two-point difference into an eight-sigma result.
 * Four points of grade is roughly the width of one rung, and it is the smallest
 * spread this ladder can actually resolve.
 */
const T_SD_FLOOR = 4;

function shapeOf(p: ReviewPlayer, team: ReviewTeamYear): Shape | null {
  const graded = p.weeks.filter((w) => w.grade !== null);
  if (graded.length === 0) return null;
  const avg = mean(graded.map((w) => w.grade!));
  const pct = seasonPercentile(p.position, avg);
  if (pct === null) return null;

  const mid = Math.ceil(team.lastWeek / 2);
  const first = graded.filter((w) => w.week <= mid);
  const second = graded.filter((w) => w.week > mid);
  const firstAvg = mean(first.map((w) => w.grade!));
  const secondAvg = mean(second.map((w) => w.grade!));

  let t: number | null = null;
  if (first.length >= MIN_HALF_WEEKS && second.length >= MIN_HALF_WEEKS) {
    const all = graded.map((w) => w.grade!);
    const m = mean(all);
    const sd = Math.sqrt(all.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, all.length - 1));
    const se = Math.max(sd, T_SD_FLOOR) * Math.sqrt(1 / first.length + 1 / second.length);
    t = (secondAvg - firstAvg) / se;
  }

  const best = graded.reduce((a, b) => (b.grade! > a.grade! ? b : a));
  const playoffGraded = p.playoffWeeks.filter((w) => w.grade !== null);
  const playoffAvg = playoffGraded.length > 0 ? mean(playoffGraded.map((w) => w.grade!)) : null;

  return {
    p, graded, avg, pct, z: seasonZ(p.position, p.stats, p.gp),
    first, second, firstAvg, secondAvg,
    firstPct: seasonPercentile(p.position, firstAvg) ?? 50,
    secondPct: seasonPercentile(p.position, secondAvg) ?? 50,
    firstStats: sum(first), secondStats: sum(second),
    t, best, bestGrade: best.grade!,
    missed: Math.max(0, team.teamGames - p.gp),
    playoffGraded, playoffAvg,
    playoffPct: playoffAvg === null ? null : seasonPercentile(p.position, playoffAvg),
  };
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

interface Candidate {
  kind: StoryKind;
  shape: Shape;
  /** How far past the bar, in the bar's own units. Scaled into `strength` below. */
  margin: number;
  /** Everything the sentence pool needs, already computed. */
  write: (v: Voice) => string;
  line: SeasonStats;
  scope: 'REGULAR' | 'PLAYOFFS';
  games: number;
  pct: number | null;
}

/**
 * [EDITORIAL] Which true thing gets told first when several are true of the
 * same club. Unlike every bar above this is a judgement about what a GM wants
 * to hear, not a measurement, and it is written down here rather than
 * scattered so it can be argued with in one place. A story's place in the
 * recap is this number plus how far past its own measured bar it ran.
 */
const KIND_PRIORITY: Record<StoryKind, number> = {
  OVERPAID: 64, CAREER_YEAR: 62, SLOW_START: 60, CAREER_WORST: 59, FADED: 58,
  ROOKIE_ARRIVAL: 57, BELOW_RATING: 56, AGE_DECLINE: 54, SURGED: 53,
  BARGAIN: 52, SECOND_YEAR_LEAP: 51, MISSED_TIME: 50, VANISHED_IN_JANUARY: 49,
  ROSE_IN_JANUARY: 48, ABOVE_RATING: 46, NEVER_A_BAD_WEEK: 43, ONE_BIG_DAY: 38,
};

const MONEY = (n: number): string => {
  const m = n / 1_000_000;
  return m >= 10 ? `$${m.toFixed(0)}M` : `$${m.toFixed(1)}M`;
};

/** "receivers", "corners" — how a coach names the group, not the column header. */
const POS_PLURAL: Record<string, string> = {
  QB: 'quarterbacks', RB: 'running backs', WR: 'receivers', TE: 'tight ends',
  EDGE: 'edge rushers', DT: 'interior linemen', LB: 'linebackers',
  CB: 'corners', S: 'safeties', K: 'kickers',
};
const POS_SINGULAR: Record<string, string> = {
  QB: 'quarterback', RB: 'back', WR: 'receiver', TE: 'tight end',
  EDGE: 'edge rusher', DT: 'interior lineman', LB: 'linebacker',
  CB: 'corner', S: 'safety', K: 'kicker',
};
const plural = (pos: string) => POS_PLURAL[canonicalPosition(pos)] ?? 'players';
const singular = (pos: string) => POS_SINGULAR[canonicalPosition(pos)] ?? 'player';

/** Stats A minus stats B, floored at zero. Used to say what the OTHER games came to. */
function subtract(a: SeasonStats, b: SeasonStats): SeasonStats {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(a as Record<string, number>)) {
    if (typeof v !== 'number') continue;
    out[k] = Math.max(0, v - ((b as Record<string, number>)[k] ?? 0));
  }
  return out as SeasonStats;
}

/**
 * "68 receiving yards a game", "0.6 sacks a game" — the one figure that
 * defines the position, expressed as a rate so a seventeen-game half of the
 * year and a three-game one can be read against each other. Never rounded to
 * a whole number below ten, because 0.6 sacks a game and "one sack a game" are
 * not the same claim.
 */
function rateHeadline(position: string, s: SeasonStats, gp: number): string {
  const g = Math.max(1, gp);
  const r = (v: number) => {
    const x = (v ?? 0) / g;
    return x >= 10 ? Math.round(x).toLocaleString() : (Math.round(x * 10) / 10).toString();
  };
  const pos = canonicalPosition(position);
  switch (pos) {
    case 'QB': return `${r(s.passYds ?? 0)} passing yards a game`;
    case 'RB': return `${r(s.rushYds ?? 0)} rushing yards a game`;
    case 'WR': case 'TE': return `${r(s.recYds ?? 0)} receiving yards a game`;
    case 'EDGE': case 'DT': return `${r(s.sacks ?? 0)} sacks a game`;
    case 'LB': return `${r(s.tackles ?? 0)} tackles a game`;
    case 'CB': case 'S': return `${r((s.defInt ?? 0) + (s.pd ?? 0))} takeaways and breakups a game`;
    case 'K': return `${r(s.fgm ?? 0)} field goals a game`;
    default: return statLine(pos, s);
  }
}
