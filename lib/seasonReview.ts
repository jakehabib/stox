import { prisma } from './db';
import { readJson } from './json';
import { mergeStats } from './stats';
import { Rng } from './rng';
import { canonicalPosition } from './tuning';
import { gradeLine, playedEnough, statLine, UNIT_OF } from './coachRoom';
import { leadColumnKey } from './statLabels';
import { offensiveScore, defensiveScore, DEFENSIVE_POSITIONS } from './awards';
import { ageBasisYear, ageInSeason } from './playerSeasons';
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
 *
 * ---------------------------------------------------------------------------
 * 5. DEVELOPMENT — WHAT THE DATABASE CAN AND CANNOT PROVE
 * ---------------------------------------------------------------------------
 * "maybe we can include some of the development progress in the end of year
 * storylines." Growth is real (lib/progression.ts, lib/development.ts) and it
 * is invisible: players quietly get better between seasons and nothing ever
 * says so. Three of the four things worth saying about it are provable from
 * rows that already exist. The fourth is not, and is therefore not said.
 *
 *   PROVABLE — WHERE HE STANDS AGAINST HIS CEILING. `Player.potential` and
 *   `Player.trueOvr` are both current and both exact for the user's own
 *   roster. "Twenty-three, rated 78, with 88 in him" and "thirty, rated 84,
 *   and 84 is all of it" are statements of fact about today, not inferences
 *   about the past. This is the distinction the owner named as invisible and
 *   it needs no history at all.
 *
 *   PROVABLE — THE STAT-LEADER MILESTONE. lib/development.ts writes a
 *   `DEV_MILESTONE` Transaction, with the player and the week on it, every
 *   time a checkpoint finds a man leading the league in a marquee category —
 *   and that bump raises his CEILING as well as his rating. The row is the
 *   receipt. It is read, never re-derived.
 *
 *   PROVABLE, WITH A MARGIN — THE BREAKOUT BAND. The growth model multiplies a
 *   man's roll by PROGRESSION.BREAKOUT_GROWTH_MULT when he is inside the top
 *   15% at his position by `offensiveScore`/`defensiveScore` per week. The
 *   final checkpoint of the year runs on the completed season, against exactly
 *   the roster this panel is looking at, so that one checkpoint's verdict is
 *   reconstructable — using the model's own metric, not a second one. Two
 *   guards keep it honest: the claim is only made inside 12% rather than 15%,
 *   so a retirement or a release moving the population cannot flip it, and it
 *   is not made at all once the rollover has cleared `Player.seasonStats`,
 *   because then the input is genuinely gone. Nothing here claims the EARLIER
 *   checkpoints fired; only the last one is provable.
 *
 *   NOT PROVABLE — THE RATING HE STARTED THE YEAR AT. This is the one the
 *   owner most wants ("a 22-year-old going 74 to 81"), and this schema cannot
 *   answer it. `trueOvr` is overwritten in place by every checkpoint and by
 *   the offseason roll; `PlayerSeason` carries stats and no rating;
 *   `ScoutingReport.scoutedOvr` is a fogged observation taken at an arbitrary
 *   week, not a true rating at a known one. There is nowhere in the database
 *   that a rating is stored with a year attached. So no line here says a
 *   number went up, and none approximates one. See the handoff note in the
 *   report: one nullable column pair on `PlayerSeason`, written by the sweep
 *   that already runs once a year, makes it exact from the following season on.
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
  QB: 0.18, RB: 0.74, WR: 0.37, TE: 0.28, EDGE: 0.24, DT: 0.25, LB: 0.33, CB: 0.21, S: 0.29, K: 0.19,
};
const CAREER_WORST_MARGIN: Record<string, number> = {
  QB: 0.20, RB: 0.52, WR: 0.55, TE: 0.61, EDGE: 0.18, DT: 0.19, LB: 0.19, CB: 0.16, S: 0.18, K: 0.18,
};

/**
 * [TUNE] Bars on the pay/rating gap — "paid at the Nth percentile among the
 * league's active players at his position, produced at the Mth". Measured over
 * every club's last completed season, and conditioned EXACTLY the way the rules
 * below are, which is the only way these numbers mean anything: the gap's
 * distribution among the well-paid is nothing like its distribution overall,
 * and an unconditioned bar fired on any bench player whose pay was merely
 * median. Among the well paid (pay percentile 70+) the gap runs 66 at the 90th
 * percentile and 75 at the 95th; among the well rated, 65 and 74; among the
 * cheap and the low-rated the mirror figures are -72 and -66.
 *
 * These were re-measured once already, and the reason is worth recording: the
 * population changed under them. Restricting the pay and rating ladders to
 * ACTIVE players — retired men and draft-pool prospects are not part of the
 * market a club competes in — lifted the rating ladder, which pushed players
 * DOWN it, which quietly turned "he outplayed his rating" from 2.3% of all
 * reads into 13.5% without a single threshold being touched. A bar on a
 * shifting population is not a bar.
 */
const PAY_HIGH = 70;          // he is genuinely well paid for his position
const PAY_LOW = 45;           // he is genuinely cheap
const PAY_GAP_UNDER = 70;     // paid that far above what he produced
const PAY_GAP_OVER = -72;     // produced that far above what he is paid
const RATE_HIGH = 70;
const RATE_LOW = 45;
const RATE_GAP_UNDER = 66;
const RATE_GAP_OVER = -70;

/**
 * [TUNE] Missing this many games puts a man in the bottom 8% of availability
 * among players with a real role — measured, 69.9% of them miss none at all,
 * and only 8.0% miss four or more.
 */
const MISSED_GAMES_BAR = 4;

/**
 * [TUNE] The worst single week a man may have had and still be called
 * unfailing. Measured: among men with twelve graded weeks and a top-40% season,
 * the worst-week grade runs 24.5 at the median and 58.7 at the 90th percentile,
 * and the first bar tried — "his worst week still beat half the league" — fired
 * on 18.2% of them and took a fifth of every recap in the database. At 65 it is
 * 5.2% and at 70 it is 2.5%: his QUIETEST afternoon of the year was still a
 * top-third one. 70 is the bar, because even at 65 it was still the loudest
 * single verdict in the narrative list.
 *
 * It is not reachable everywhere, and that is a fact about the simulation
 * rather than a hole in the bar. A corner's weekly grade turns on whether a
 * ball came his way, so the most consistent corner in this database still has
 * a week at the 40th percentile; a running back carries the ball every Sunday.
 * The claim is only true where weekly production is continuous, so that is
 * where it is made.
 */
const UNFAILING_WORST_WEEK = 70;

/** [TUNE] Season-production percentile bars, on the SEASON_LADDER scale. */
const GOOD_SEASON = 85;       // top 15% of seasons at his position
const SOLID_SEASON = 60;
const ORDINARY_CEILING = 45;
const POOR_SEASON = 25;

/**
 * A verdict about how WELL a man played may not be printed at linebacker.
 *
 * Not a ranking decision — the shared ranker's ordering is untouched, and a
 * linebacker is still selected as an All-Star by it. It is a truthfulness
 * decision about THIS SIMULATION, in exactly the terms lib/coachRoom.ts sets
 * out. `allocateStats()` draws a flat `normal(62, 6)` tackles for the whole
 * defence and splits them by DEPTH-CHART SHARE, and it writes a forced fumble
 * on roughly six per cent of a defender's games as a coin flip. Those two
 * quantities are 55% and 36% of a linebacker's weight in the ranker
 * (lib/statLabels.ts gives him `tackles` lead 1 and `ff` lead 2, and nothing
 * else). So a sentence calling a linebacker's season good or bad would be a
 * sentence about the size of his club's defensive depth chart and about a
 * lottery, dressed as a judgement of a man.
 *
 * Every other position carries something the engine only writes when something
 * happened — sacks at the front, takeaways and break-ups in the secondary,
 * yardage everywhere on offence — and tackles are at most 46% of any of their
 * cases.
 *
 * A linebacker is NOT silenced. He stays eligible for the reads that compare
 * him to himself inside one season and one depth chart, where his share is a
 * constant that cancels: the trajectory reads, availability, and the
 * postseason ones. He is only kept out of the verdicts whose subject is the
 * standard of his football.
 */
const NO_LEVEL_VERDICT = new Set(['LB']);

/**
 * A defender may not be PRAISED on tackle volume.
 *
 * The narrower half of the same rule, and it is needed because the linebacker
 * exclusion above does not reach far enough. `allocateStats` splits a defence's
 * tackles by depth-chart share, and a season's worth of that share is a large,
 * low-variance number: measured, a club running a thin defensive rotation hands
 * each of its front seven around 6.6 tackles a game against a league mean of
 * 4.5 with a standard deviation of 0.59, which is nearly four standard
 * deviations of pure roster construction. On a winless team in this database it
 * put three men on one sheet badged "top 1% at his position", two of whom had
 * four sacks and none between them.
 *
 * So a praise-side verdict at a defensive position additionally asks for
 * PLAYS — sacks, takeaways, forced fumbles, break-ups; the things the engine
 * only writes when something actually happened — at a rate at least the MEDIAN
 * for his position. Measured over every defensive season in this database with
 * eight or more graded weeks, and per position because the rates are not
 * comparable: a safety's median is 0.60 a game and an interior lineman's is
 * 0.25, which is a fact about what the engine gives each job rather than about
 * the men doing it.
 *
 * The criticism side is deliberately NOT gated this way. Tackle share inflates
 * a grade upward, so a verdict that a man fell short of his pay or his rating
 * is if anything conservative under it, and demanding he made plays before he
 * may be criticised would be exactly backwards.
 */
const PLAY_RATE_BAR: Record<string, number> = { EDGE: 0.41, DT: 0.25, LB: 0.06, CB: 0.47, S: 0.60 };

function madePlays(position: string, stats: SeasonStats, gp: number): boolean {
  const bar = PLAY_RATE_BAR[canonicalPosition(position)];
  if (bar === undefined) return true; // offence and kicking carry no tackle term
  const plays = (stats.sacks ?? 0) + (stats.defInt ?? 0) + (stats.ff ?? 0) + Math.floor((stats.pd ?? 0) / 2);
  return plays / Math.max(1, gp) >= bar;
}

/**
 * [TUNE] Development bars, measured over the 240,567 active players in this
 * database rather than picked.
 *
 * ROOM: `potential - trueOvr` collapses with age — its 90th percentile is 17
 * points at 20-23, 12 at 24-25 and 9 at 26-27 — so one flat bar would have
 * called every young player a prospect and no older one. The bar is the 95th
 * percentile of that gap, by band (20 / 15 / 11), plus a ceiling worth having:
 * a 55 with an 80 in him is a story, a 48 with a 58 in him is a roster spot.
 *
 * DONE: the reverse, and the pairing the owner asked for. Half of all players
 * over 27 are within two points of their ceiling, so "he is finished growing"
 * alone says nothing; it is only worth saying about a man who is actually good,
 * which the rating bar is.
 */
const ROOM_BAR: { maxAge: number; gap: number }[] = [
  { maxAge: 23, gap: 20 },
  { maxAge: 25, gap: 15 },
  { maxAge: 27, gap: 11 },
];
const ROOM_MIN_CEILING = 80;
const DONE_MIN_AGE = 28;
const DONE_MIN_RATING = 78;
/**
 * [TUNE] Inside the top 12% at his position by the growth model's own metric.
 * The model's band is 15% (lib/development.ts); the three-point margin is
 * there so a player retiring or being released between the last checkpoint and
 * this panel cannot move somebody across the line the sentence rests on.
 */
const BREAKOUT_BAND = 0.12;
/** [TUNE] Young enough for the accelerated roll to be the point of the sentence. */
const BREAKOUT_MAX_AGE = 25;

/** [TUNE] Enough graded weeks for a season-shaped claim at all. */
const MIN_SEASON_WEEKS = 8;
/** [TUNE] Enough graded weeks in EACH half for a trajectory claim. */
const MIN_HALF_WEEKS = 3;
/**
 * [TUNE] Both sides of a career comparison must be a real season. The z it
 * compares is a per-game figure so a short year is not mathematically unfair —
 * but the SENTENCE prints season totals, and "the best year of his career" over
 * a nine-game total that reads lower than the year it beats is a sentence that
 * argues with its own numbers. Twelve games of seventeen, both sides.
 */
const CAREER_MIN_GP = 12;

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
  /** His ceiling. Same visibility rule as `rating` — null when the save fogs it. */
  potential: number | null;
  /**
   * Where he finished among his position group on the growth model's OWN
   * metric (0 = top of the league, 1 = bottom), or null when the season totals
   * that metric reads have already been rolled away. See the header, section 5.
   */
  growthRank: number | null;
  /** Weeks he was found leading the league in a marquee category, from the rows that recorded it. */
  milestones: { week: number; categories: string }[];
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
  | 'ROSE_IN_JANUARY' | 'VANISHED_IN_JANUARY'
  | 'BREAKOUT' | 'LED_THE_LEAGUE'
  | 'ROOM_TO_GROW' | 'AT_CEILING';

export type StoryFamily = 'TRAJECTORY' | 'VALUE' | 'CAREER' | 'ARRIVAL' | 'AVAILABILITY' | 'MOMENT' | 'POSTSEASON' | 'DEVELOPMENT' | 'OUTLOOK';

export const FAMILY_OF: Record<StoryKind, StoryFamily> = {
  SLOW_START: 'TRAJECTORY', SURGED: 'TRAJECTORY', FADED: 'TRAJECTORY',
  OVERPAID: 'VALUE', BARGAIN: 'VALUE', BELOW_RATING: 'VALUE', ABOVE_RATING: 'VALUE',
  CAREER_YEAR: 'CAREER', CAREER_WORST: 'CAREER', AGE_DECLINE: 'CAREER',
  ROOKIE_ARRIVAL: 'ARRIVAL', SECOND_YEAR_LEAP: 'ARRIVAL',
  MISSED_TIME: 'AVAILABILITY', NEVER_A_BAD_WEEK: 'AVAILABILITY',
  ONE_BIG_DAY: 'MOMENT',
  ROSE_IN_JANUARY: 'POSTSEASON', VANISHED_IN_JANUARY: 'POSTSEASON',
  BREAKOUT: 'DEVELOPMENT', LED_THE_LEAGUE: 'DEVELOPMENT',
  ROOM_TO_GROW: 'OUTLOOK', AT_CEILING: 'OUTLOOK',
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
  BREAKOUT: 'good', LED_THE_LEAGUE: 'good',
  ROOM_TO_GROW: 'good', AT_CEILING: 'flat',
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
  /**
   * Where the roster is HEADED rather than where it has been — the ceiling
   * reads. Kept as its own short section because it is a different tense: the
   * list above is what the year did, and this is what the men in it still are.
   * Nobody appears in both.
   */
  outlook: Story[];
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
/** "an 88", "a 74" — the rating is read aloud, so the article follows the sound. */
function aNumber(n: number): string {
  const t = String(n);
  const an = t.startsWith('8') || t === '11' || t.startsWith('18');
  return `${an ? 'an' : 'a'} ${t}`;
}
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
  // Defenders get two figures, not three, and the things that only happen when
  // something happened come before the tackle count. The engine deals a
  // defence's tackles by depth-chart share, so a club carrying eight listed
  // defenders hands each of them half again as many as a club carrying
  // fourteen — which is how a recap ended up printing "112 tackles" beside
  // three different names on one sheet. Leading with sacks and takeaways is
  // both the more interesting sentence and the more honest one.
  if (pos === 'EDGE' || pos === 'DT') {
    if ((s.sacks ?? 0) > 0) bits.push(count(s.sacks ?? 0, 'sack'));
    if ((s.ff ?? 0) > 0) bits.push(count(s.ff ?? 0, 'forced fumble'));
    if (bits.length < 2) bits.push(count(s.tackles ?? 0, 'tackle'));
    return join(bits.slice(0, 2));
  }
  if (pos === 'CB' || pos === 'S') {
    if ((s.defInt ?? 0) > 0) bits.push(count(s.defInt ?? 0, 'interception'));
    if ((s.pd ?? 0) > 0) bits.push(`${count(s.pd ?? 0, 'ball', 'balls')} broken up`);
    if ((s.ff ?? 0) > 0 && bits.length < 2) bits.push(count(s.ff ?? 0, 'forced fumble'));
    if (bits.length < 2) bits.push(count(s.tackles ?? 0, 'tackle'));
    return join(bits.slice(0, 2));
  }
  if (pos === 'LB') {
    bits.push(count(s.tackles ?? 0, 'tackle'));
    if ((s.ff ?? 0) > 0) bits.push(count(s.ff ?? 0, 'forced fumble'));
    return join(bits);
  }
  if (pos === 'K') {
    const fg = `${s.fgm ?? 0} of ${s.fga ?? 0} from the field`;
    return (s.xpa ?? 0) > 0 ? `${fg} and ${s.xpm ?? 0} of ${s.xpa} on extra points` : fg;
  }
  return statLine(pos, s);
}

/**
 * "Hamstring strain" mid-sentence, without shouting. The first word drops to
 * lower case unless it is an acronym the engine writes in capitals (MCL, ACL)
 * or a proper noun (Achilles) — "the torn ACL", "the MCL sprain", "the
 * Achilles rupture", "the hamstring strain".
 */
function softenInjury(type: string): string {
  const [head, ...rest] = type.split(' ');
  const keep = head === head.toUpperCase() || head === 'Achilles';
  return [keep ? head : head.toLowerCase(), ...rest].join(' ');
}

/**
 * The two halves of a season, phrased with THE SAME NUMBERS on both sides.
 *
 * `spoken` picks whichever figures a line happens to lead with, which is right
 * for one man's season and wrong for a comparison: it printed "13 balls broken
 * up and one forced fumble through week 9, and then four balls broken up and
 * 38 tackles the rest of the way", where the halves are not measured on the
 * same thing at all and the reader cannot see the fall he is being told about.
 * Here the columns are chosen once, from whichever of them either half
 * actually used, and both sides are read off the same ones.
 */
type SplitPart = { of: (s: SeasonStats) => number; say: (s: SeasonStats) => string };

function splitParts(pos: string): { parts: SplitPart[]; max: number } {
  const n = (k: keyof SeasonStats) => (s: SeasonStats) => (s[k] as number | undefined) ?? 0;
  switch (pos) {
    case 'QB': return { max: 3, parts: [
      { of: n('passYds'), say: (s) => `${num(s.passYds ?? 0)} yards` },
      { of: n('passTd'), say: (s) => count(s.passTd ?? 0, 'touchdown') },
      { of: n('int'), say: (s) => count(s.int ?? 0, 'interception') },
    ] };
    case 'RB': return { max: 2, parts: [
      { of: n('rushYds'), say: (s) => `${num(s.rushYds ?? 0)} on ${count(s.rushAtt ?? 0, 'carry', 'carries')}` },
      { of: n('rushTd'), say: (s) => count(s.rushTd ?? 0, 'score') },
      { of: n('rec'), say: (s) => count(s.rec ?? 0, 'catch', 'catches') },
    ] };
    case 'WR': case 'TE': return { max: 2, parts: [
      { of: n('recYds'), say: (s) => `${count(s.rec ?? 0, 'catch', 'catches')} for ${num(s.recYds ?? 0)}` },
      { of: n('recTd'), say: (s) => count(s.recTd ?? 0, 'score') },
    ] };
    case 'EDGE': case 'DT': return { max: 2, parts: [
      { of: n('sacks'), say: (s) => count(s.sacks ?? 0, 'sack') },
      { of: n('ff'), say: (s) => count(s.ff ?? 0, 'forced fumble') },
      { of: n('tackles'), say: (s) => count(s.tackles ?? 0, 'tackle') },
    ] };
    case 'CB': case 'S': return { max: 2, parts: [
      { of: n('defInt'), say: (s) => count(s.defInt ?? 0, 'interception') },
      { of: n('pd'), say: (s) => `${count(s.pd ?? 0, 'ball', 'balls')} broken up` },
      { of: n('tackles'), say: (s) => count(s.tackles ?? 0, 'tackle') },
    ] };
    case 'LB': return { max: 2, parts: [
      { of: n('tackles'), say: (s) => count(s.tackles ?? 0, 'tackle') },
      { of: n('ff'), say: (s) => count(s.ff ?? 0, 'forced fumble') },
    ] };
    case 'K': return { max: 2, parts: [
      { of: n('fga'), say: (s) => `${s.fgm ?? 0} of ${s.fga ?? 0} from the field` },
      { of: n('xpa'), say: (s) => `${s.xpm ?? 0} of ${s.xpa ?? 0} on extra points` },
    ] };
    default: return { max: 1, parts: [{ of: n('gp'), say: (s) => statLine(pos, s) }] };
  }
}

export function spokenSplit(position: string, a: SeasonStats, b: SeasonStats): [string, string] {
  const pos = canonicalPosition(position);
  const { parts, max } = splitParts(pos);
  let chosen = parts.filter((pt) => pt.of(a) > 0 || pt.of(b) > 0).slice(0, max);
  if (chosen.length === 0) chosen = parts.slice(0, 1);
  return [join(chosen.map((pt) => pt.say(a))), join(chosen.map((pt) => pt.say(b)))];
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
export interface Picker { pick<T>(pool: T[]): T }

class Voice {
  private queues = new Map<string, number[]>();
  constructor(private rng: Rng) {}
  /**
   * A picker bound to one kind of read. Keying the rotation on the KIND rather
   * than on the array is what makes it work at all here: the sentence pools are
   * built fresh inside each candidate, so an identity-keyed queue would hand
   * every instance the same shuffled first draw and the anti-repeat would do
   * nothing. Bound this way, two men earning the same verdict in one recap are
   * guaranteed different sentences, and the seed moves the whole rotation from
   * one season to the next.
   *
   * The queue holds INDICES rather than the drawn items, and that is not a
   * detail. Holding the items themselves is what the first version did, and
   * because each candidate builds its own closures over its own player, the
   * second man to earn a verdict popped the FIRST man's sentence and the recap
   * printed a receiver's paragraph about tackles and pass break-ups. Caught by
   * reading real output, which is the only way that class of bug ever is.
   */
  scoped(key: string): Picker {
    return { pick: <T,>(pool: T[]): T => {
      let q = this.queues.get(key);
      if (!q || q.length === 0) { q = this.rng.shuffle(pool.map((_, i) => i)); this.queues.set(key, q); }
      return pool[q.pop()! % pool.length];
    } };
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
  /**
   * Regular-season games he was on this roster for and did NOT play. Counted
   * inside his TENURE, never across the whole schedule: a man traded in at
   * week 12 did not "miss" the first eleven, he was somewhere else, and the
   * first version of this said he missed them. Tenure runs from his first
   * appearance to his last, extended to cover an injury that ran past it —
   * which is how a torn ACL in week 4 that ended his season still counts as
   * the thirteen games it actually cost us.
   */
  missed: number;
  /** True when he was here from week one — the only case that may say "of our 17". */
  fullYear: boolean;
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

  const appearances = p.weeks.map((w) => w.week);
  const firstSeen = appearances.length > 0 ? Math.min(...appearances) : 1;
  let lastSeen = appearances.length > 0 ? Math.max(...appearances) : 0;
  for (const inj of p.injuries) lastSeen = Math.max(lastSeen, Math.min(team.lastWeek, inj.week + inj.weeks));
  // No bye weeks (lib/tuning.ts REGULAR_SEASON_WEEKS), so the club played one
  // game in every week of that span.
  const tenureGames = Math.max(0, lastSeen - firstSeen + 1);
  const playoffGraded = p.playoffWeeks.filter((w) => w.grade !== null);
  const playoffAvg = playoffGraded.length > 0 ? mean(playoffGraded.map((w) => w.grade!)) : null;

  return {
    p, graded, avg, pct, z: seasonZ(p.position, p.stats, p.gp),
    first, second, firstAvg, secondAvg,
    firstPct: seasonPercentile(p.position, firstAvg) ?? 50,
    secondPct: seasonPercentile(p.position, secondAvg) ?? 50,
    firstStats: sum(first), secondStats: sum(second),
    t, best, bestGrade: best.grade!,
    missed: Math.max(0, tenureGames - p.gp),
    fullYear: firstSeen === 1,
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
  write: (v: Picker) => string;
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
  // Development was invisible before this panel existed, so it leads where it
  // is earned: a man whose year actually moved his ceiling is the single thing
  // a dynasty player most wants told and never was.
  BREAKOUT: 61, LED_THE_LEAGUE: 52,
  // The outlook pair is selected separately (see buildReview) and these only
  // order them against each other.
  ROOM_TO_GROW: 40, AT_CEILING: 36,
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

// ---------------------------------------------------------------------------
// The reads
// ---------------------------------------------------------------------------
//
// Every pool below holds sentences of DIFFERENT SHAPE, not one sentence with a
// swappable tail. The Week Report had to fix four rows ending in the same four
// words; the failure mode here is subtler and worse, because a recap is read
// once a year and a reader who sees the same frame in 2029 that he read in
// 2028 has caught the whole thing out at once. So the figures move around the
// sentence: sometimes they open it, sometimes they land after a colon,
// sometimes they arrive as the second half of a contrast.
//
// Nothing in any pool asserts anything the box scores did not record. There is
// no "he was pressing", no "the coaching staff lost him", no "the leg is
// gone" — the simulation models none of that.

function candidates(sh: Shape, team: ReviewTeamYear): Candidate[] {
  const out: Candidate[] = [];
  const p = sh.p;
  const pos = canonicalPosition(p.position);
  const mid = Math.ceil(team.lastWeek / 2);
  const enoughSeason = sh.graded.length >= MIN_SEASON_WEEKS;
  const bothHalves = sh.first.length >= MIN_HALF_WEEKS && sh.second.length >= MIN_HALF_WEEKS && sh.t !== null;
  const tBar = SPLIT_T[pos] ?? 1.8;
  // See NO_LEVEL_VERDICT: at linebacker the ranker's case is a depth-chart
  // share and a coin flip, so nothing here may grade the standard of his year.
  const levelOk = !NO_LEVEL_VERDICT.has(pos);
  // See madePlays(): praise at a defensive position needs plays, not tackles.
  const praiseOk = levelOk && madePlays(pos, p.stats, p.gp);

  // --- Trajectory ----------------------------------------------------------
  if (bothHalves) {
    const t = sh.t!;
    const fG = sh.first.length, sG = sh.second.length;
    // Same columns on both sides — see spokenSplit().
    const [fS, sS] = spokenSplit(pos, sh.firstStats, sh.secondStats);
    /**
     * The number the position leads with may not contradict the sentence.
     *
     * The grade is a weighted blend, so a quarterback can slide on touchdowns
     * and interceptions while his YARDAGE goes up — and then the recap prints
     * "from there it fell away" over two figures where the second is larger
     * than the first. Found by reading real output: 1,513 yards before week 9
     * and 1,579 after, filed as a fade. The test is non-strict, so a lead stat
     * that simply did not move (a corner with no interceptions in either half)
     * leaves the verdict to the rest of the line; it only ever rejects an
     * outright contradiction.
     */
    const tKey = leadColumnKey(pos);
    const half = (st: SeasonStats, g: number) =>
      tKey ? ((st as Record<string, number | undefined>)[tKey] ?? 0) / Math.max(1, g) : null;
    const leadFirst = half(sh.firstStats, fG);
    const leadSecond = half(sh.secondStats, sG);
    const leadRose = leadFirst === null || leadSecond === null || leadSecond >= leadFirst;
    const leadFell = leadFirst === null || leadSecond === null || leadSecond <= leadFirst;

    if (t >= tBar && sh.firstPct <= 30 && sh.secondPct >= 55 && leadRose) {
      out.push({
        kind: 'SLOW_START', shape: sh, margin: (t - tBar) / tBar,
        line: p.stats, scope: 'REGULAR', games: p.gp, pct: sh.pct,
        write: (v) => v.pick([
          () => `Through his first ${fG} games it was ${fS}, and the year looked gone. Over the last ${sG}: ${sS}.`,
          () => `${capitalise(fS)} in his first ${fG} games — then ${sS} in the ${sG} that followed.`,
          () => `The opening half of his year was a genuine problem: ${fS}, in ${count(fG, 'game')} up to week ${mid}. He closed it out with ${sS} in the ${sG} after it.`,
          () => `He opened the season with ${fS} across ${fG} games and finished it with ${sS} across ${sG}. By December nobody was talking about the start.`,
        ])(),
      });
    } else if (t >= tBar && sh.secondPct >= 75 && sh.firstPct > 30 && leadRose) {
      out.push({
        kind: 'SURGED', shape: sh, margin: (t - tBar) / tBar,
        line: p.stats, scope: 'REGULAR', games: p.gp, pct: sh.pct,
        write: (v) => v.pick([
          () => `He was fine and no more than fine for ${fG} games — ${fS} — and then went and put up ${sS} over the last ${sG}.`,
          () => `${capitalise(fS)} through the first ${fG}. Over the last ${sG}: ${sS}.`,
          () => `Something turned around the halfway mark. ${capitalise(fS)} in the ${fG} games before it, ${sS} in the ${sG} after.`,
        ])(),
      });
    } else if (t <= -tBar && sh.firstPct >= 60 && sh.secondPct <= 40 && leadFell) {
      out.push({
        kind: 'FADED', shape: sh, margin: (-t - tBar) / tBar,
        line: p.stats, scope: 'REGULAR', games: p.gp, pct: sh.pct,
        write: (v) => v.pick([
          () => `${capitalise(fS)} in his first ${fG} games, and then ${sS} across the ${sG} that followed.`,
          () => `For half a season he was one of the best things about us: ${fS} in ${count(fG, 'game')}. The other ${sG} came to ${sS}.`,
          () => `${capitalise(fS)}, in ${count(fG, 'game')} up to week ${mid}. From there it fell away to ${sS} in the ${sG} that followed.`,
          () => `He gave us ${fS} over ${fG} games early. Whatever that was, it was not there for the run-in: ${sS} in the last ${sG}.`,
        ])(),
      });
    }
  }

  // --- Paid for it / not paid for it ---------------------------------------
  if (levelOk && enoughSeason && p.payPct !== null && p.apy !== null) {
    const gap = p.payPct - sh.pct;
    if (p.payPct >= PAY_HIGH && gap >= PAY_GAP_UNDER) {
      const money = MONEY(p.apy);
      out.push({
        kind: 'OVERPAID', shape: sh, margin: (gap - PAY_GAP_UNDER) / 30,
        line: p.stats, scope: 'REGULAR', games: p.gp, pct: sh.pct,
        write: (v) => v.pick([
          () => `${money} a year buys a ${singular(pos)} near the top of the league. ${capitalise(spoken(pos, p.stats))} across ${p.gp} games is a long way from it.`,
          () => `We are paying him like a top-${Math.max(1, Math.round(100 - p.payPct!))}% ${singular(pos)} and he played the year like a spare part — ${spoken(pos, p.stats)}.`,
          () => `${capitalise(spoken(pos, p.stats))} in ${p.gp} games, at ${money} a year. That is not what that money is for.`,
          () => `Only ${Math.max(1, Math.round(100 - p.payPct!))}% of ${plural(pos)} in this league cost more than his ${money}. Very few of them produced less than ${spoken(pos, p.stats)}.`,
        ])(),
      });
    } else if (praiseOk && p.payPct <= PAY_LOW && gap <= PAY_GAP_OVER) {
      const money = MONEY(p.apy);
      out.push({
        kind: 'BARGAIN', shape: sh, margin: (PAY_GAP_OVER - gap) / 30,
        line: p.stats, scope: 'REGULAR', games: p.gp, pct: sh.pct,
        write: (v) => v.pick([
          () => `${capitalise(spoken(pos, p.stats))}, on ${money} a year. There is not a cheaper way to get that.`,
          () => `${money} a year puts him in the cheapest ${Math.max(1, Math.round(p.payPct!))}% of ${plural(pos)} in this league, and he played nothing like it: ${spoken(pos, p.stats)}.`,
          () => `${money} a year. ${capitalise(spoken(pos, p.stats))}. Somebody is going to notice that before we want them to.`,
        ])(),
      });
    }
  }

  // --- Against what we think he is -----------------------------------------
  if (levelOk && enoughSeason && p.ratingPct !== null && p.rating !== null) {
    const gap = p.ratingPct - sh.pct;
    if (p.ratingPct >= RATE_HIGH && gap >= RATE_GAP_UNDER) {
      out.push({
        kind: 'BELOW_RATING', shape: sh, margin: (gap - RATE_GAP_UNDER) / 30,
        line: p.stats, scope: 'REGULAR', games: p.gp, pct: sh.pct,
        write: (v) => v.pick([
          () => `${capitalise(aNumber(p.rating!))} on our own board, and a year that came out ${spoken(pos, p.stats)}. One of those two numbers is lying.`,
          () => `On paper he is one of the better ${plural(pos)} we have. On the field this year we got ${spoken(pos, p.stats)} out of ${p.gp} games.`,
          () => `We rate him ${p.rating}. The season says ${spoken(pos, p.stats)}, and the season is the part that counted.`,
        ])(),
      });
    } else if (praiseOk && p.ratingPct <= RATE_LOW && gap <= RATE_GAP_OVER) {
      out.push({
        kind: 'ABOVE_RATING', shape: sh, margin: (RATE_GAP_OVER - gap) / 30,
        line: p.stats, scope: 'REGULAR', games: p.gp, pct: sh.pct,
        write: (v) => v.pick([
          () => `Nothing on his file says he should have done this: ${spoken(pos, p.stats)} from ${aNumber(p.rating!)}.`,
          () => `He is ${aNumber(p.rating!)} in our own building and he outplayed every bit of it — ${spoken(pos, p.stats)} in ${p.gp} games.`,
          () => `${capitalise(spoken(pos, p.stats))}, out of a man we have graded at ${p.rating}. We should ask ourselves why we have him that low.`,
        ])(),
      });
    }
  }

  // --- His own career ------------------------------------------------------
  const solidPrior = p.prior.filter((s) => s.gp >= CAREER_MIN_GP);
  if (levelOk && p.gp >= CAREER_MIN_GP && sh.z !== null && solidPrior.length >= 2) {
    const bestPrior = solidPrior.reduce((a, b) => (b.z > a.z ? b : a));
    const worstPrior = solidPrior.reduce((a, b) => (b.z < a.z ? b : a));
    const bestBar = CAREER_BEST_MARGIN[pos] ?? 0.3;
    const worstBar = CAREER_WORST_MARGIN[pos] ?? 0.3;
    const overBest = sh.z - bestPrior.z;
    const underWorst = worstPrior.z - sh.z;

    /**
     * The sentence has to agree with its own figures.
     *
     * The z that decides a career year is a weighted blend, so it can move on
     * a stat the sentence does not lead with — and then the recap prints "the
     * best year of his career: two sacks, past the four he had in 2033". That
     * is not a subtle failure, it is the paragraph arguing with itself in
     * public, and it happened on the first real read of a defensive tackle.
     * lib/statLabels.ts already answers "which number does this position lead
     * with"; the claim is only made when THAT number moved the right way too,
     * per game so a short season cannot fake it.
     */
    const leadKey = leadColumnKey(pos);
    const leadRate = (st: SeasonStats, gp: number): number | null =>
      leadKey ? ((st as Record<string, number | undefined>)[leadKey] ?? 0) / Math.max(1, gp) : null;
    const mineLead = leadRate(p.stats, p.gp);
    const agrees = (other: PriorSeason, better: boolean): boolean => {
      const theirs = leadRate(other.stats, other.gp);
      if (mineLead === null || theirs === null) return true;
      return better ? mineLead >= theirs : mineLead <= theirs;
    };

    if (praiseOk && overBest >= bestBar && sh.pct >= SOLID_SEASON && agrees(bestPrior, true)) {
      const years = solidPrior.length + 1;
      out.push({
        kind: 'CAREER_YEAR', shape: sh, margin: (overBest - bestBar) / Math.max(0.1, bestBar),
        line: p.stats, scope: 'REGULAR', games: p.gp, pct: sh.pct,
        write: (v) => v.pick([
          () => `Nothing on his record touches this. ${capitalise(spoken(pos, p.stats))} in ${p.gp} games, past the ${bestPrior.seasonYear} he had been measured by — ${headlineNumber(pos, bestPrior.stats)} in ${bestPrior.gp}.`,
          () => `${capitalise(spoken(pos, p.stats))}: the best football of his career, and not by a small margin. His ${bestPrior.seasonYear} came to ${headlineNumber(pos, bestPrior.stats)}.`,
          () => `Career year, at ${p.age}, in year ${solidPrior.length + 1} of it. ${capitalise(spoken(pos, p.stats))} — his ${bestPrior.seasonYear} was ${headlineNumber(pos, bestPrior.stats)} and that had been the ceiling.`,
          () => `${capitalise(count(years, 'season'))} on the books now and this is the one. ${capitalise(spoken(pos, p.stats))}, against ${headlineNumber(pos, bestPrior.stats)} in ${bestPrior.seasonYear}.`,
          () => `He is ${p.age} and he has never played like this — ${spoken(pos, p.stats)}, clear of the ${bestPrior.seasonYear} that used to be his best.`,
        ])(),
      });
    }
    if (underWorst >= worstBar && sh.pct <= ORDINARY_CEILING && agrees(worstPrior, false)) {
      const declineByAge = p.age >= 30;
      out.push({
        kind: declineByAge ? 'AGE_DECLINE' : 'CAREER_WORST',
        shape: sh, margin: (underWorst - worstBar) / Math.max(0.1, worstBar),
        line: p.stats, scope: 'REGULAR', games: p.gp, pct: sh.pct,
        write: (v) => (declineByAge
          ? v.pick([
            () => `At ${p.age} the numbers have moved and they have not moved back: ${spoken(pos, p.stats)}, under a floor he set in ${worstPrior.seasonYear} with ${headlineNumber(pos, worstPrior.stats)}.`,
            () => `${capitalise(spoken(pos, p.stats))} at ${p.age}. Even his ${worstPrior.seasonYear} — ${headlineNumber(pos, worstPrior.stats)} — was better than that.`,
            () => `This is the thinnest year of his career and he is ${p.age}, which is the part that decides what we do next. ${capitalise(spoken(pos, p.stats))} in ${p.gp} games.`,
          ])
          : v.pick([
            () => `The leanest season on his record: ${spoken(pos, p.stats)}, below the ${worstPrior.seasonYear} that had been his worst (${headlineNumber(pos, worstPrior.stats)}).`,
            () => `${capitalise(spoken(pos, p.stats))} in ${p.gp} games. There is no leaner year in his file — the closest was ${worstPrior.seasonYear}, ${headlineNumber(pos, worstPrior.stats)}.`,
            () => `Every year he has played beats this one. ${capitalise(spoken(pos, p.stats))}, against ${headlineNumber(pos, worstPrior.stats)} in ${worstPrior.seasonYear}.`,
          ]))(),
      });
    }
  }

  // --- Arriving ------------------------------------------------------------
  if (praiseOk && enoughSeason && p.experience === 0 && sh.pct >= GOOD_SEASON) {
    const origin = p.draftRound === null ? 'Undrafted' : `A round ${p.draftRound} pick`;
    out.push({
      kind: 'ROOKIE_ARRIVAL', shape: sh, margin: (sh.pct - GOOD_SEASON) / 15,
      line: p.stats, scope: 'REGULAR', games: p.gp, pct: sh.pct,
      write: (v) => v.pick([
        () => `${origin}, and already one of the better ${plural(pos)} in the league by what he actually did: ${spoken(pos, p.stats)} across ${p.gp} games.`,
        () => `${capitalise(spoken(pos, p.stats))} in his first season. ${origin === 'Undrafted' ? 'Nobody drafted him.' : `${origin}.`}`,
        () => `He did not spend the year learning. ${capitalise(spoken(pos, p.stats))} as a rookie, in ${p.gp} games.`,
      ])(),
    });
  }
  if (praiseOk && p.gp >= CAREER_MIN_GP && p.experience === 1 && sh.z !== null && sh.pct >= 70 && solidPrior.length === 1) {
    const rookieYear = solidPrior[0];
    const jump = sh.z - rookieYear.z;
    const bar = CAREER_BEST_MARGIN[pos] ?? 0.3;
    const lk = leadColumnKey(pos);
    const rate = (st: SeasonStats, gp: number) => (lk ? ((st as Record<string, number | undefined>)[lk] ?? 0) / Math.max(1, gp) : null);
    const mineLead2 = rate(p.stats, p.gp);
    const rookieLead = rate(rookieYear.stats, rookieYear.gp);
    // Same rule as the career reads: the number the position leads with has to
    // have moved the way the sentence says it did.
    if (jump >= bar && (mineLead2 === null || rookieLead === null || mineLead2 >= rookieLead)) {
      out.push({
        kind: 'SECOND_YEAR_LEAP', shape: sh, margin: (jump - bar) / Math.max(0.1, bar),
        line: p.stats, scope: 'REGULAR', games: p.gp, pct: sh.pct,
        write: (v) => v.pick([
          () => `Second year, different player: ${spoken(pos, p.stats)}, against ${spoken(pos, rookieYear.stats)} as a rookie.`,
          () => `He went from ${headlineNumber(pos, rookieYear.stats)} in ${rookieYear.seasonYear} to ${spoken(pos, p.stats)}. That is the jump you hope for and rarely get.`,
          () => `${capitalise(spoken(pos, p.stats))} in year two, off a rookie year that came to ${spoken(pos, rookieYear.stats)}.`,
        ])(),
      });
    }
  }

  // --- Available, or not ---------------------------------------------------
  // Gated with the praise reads: its premise is that losing him cost us
  // something, which at a defensive position may not rest on tackle volume.
  if (praiseOk && sh.missed >= MISSED_GAMES_BAR && sh.graded.length >= 6 && sh.pct >= 50) {
    const hurt = p.injuries.slice().sort((a, b) => b.weeks - a.weeks)[0];
    // Always "the hamstring strain", never "a" — the engine's injury names run
    // from "Hamstring strain" to "MCL sprain" to "Torn ACL", and no indefinite
    // article is right for all three. The definite one is right for all three.
    const cause = hurt ? `the ${softenInjury(hurt.type)} in week ${hurt.week}` : null;
    // "and that took the rest of it" is a claim about WHY he was missing, and
    // it is only true when this injury actually ran to the end of the schedule
    // and he never came back. An earlier draft attached it to a week-15 tear on
    // a man who had already missed two games in October, which the box scores
    // flatly contradict. Where it is not true the injury is still named — it is
    // simply named as one of the reasons rather than as the reason.
    const ranOut = hurt != null
      && hurt.week + hurt.weeks > team.lastWeek
      && !p.weeks.some((w) => w.week > hurt.week);
    const whole: (() => string)[] = sh.fullYear && ranOut && cause ? [
      () => `${p.gp} of our ${team.teamGames} — ${cause} took the rest of it. In the ones he played: ${spoken(pos, p.stats)}.`,
      () => `${capitalise(cause)} ended his year in ${p.gp} games. What we had until then was ${spoken(pos, p.stats)}.`,
    ] : sh.fullYear ? [
      () => `${p.gp} of our ${team.teamGames}${cause ? ` — ${cause} among the reasons` : ''}. In the ones he played: ${spoken(pos, p.stats)}.`,
    ] : [];
    out.push({
      kind: 'MISSED_TIME', shape: sh, margin: (sh.missed - MISSED_GAMES_BAR) / 4,
      line: p.stats, scope: 'REGULAR', games: p.gp, pct: sh.pct,
      write: (v) => v.pick([
        ...whole,
        () => `${capitalise(count(sh.missed, 'game'))} on the sideline${cause ? `, ${cause} the worst of it` : ''}. He was good when he was out there — ${spoken(pos, p.stats)} — which is the frustrating half.`,
        () => `We had him for ${count(p.gp, 'game')} and lost him for ${count(sh.missed, 'other', 'others')}${cause ? ` (${softenInjury(hurt!.type)}, week ${hurt!.week})` : ''}. Those ${p.gp} came to ${spoken(pos, p.stats)}.`,
      ])(),
    });
  }

  if (praiseOk && sh.graded.length >= 12 && sh.pct >= SOLID_SEASON) {
    const worst = sh.graded.reduce((a, b) => (b.grade! < a.grade! ? b : a));
    if (worst.grade! >= 50) {
      out.push({
        kind: 'NEVER_A_BAD_WEEK', shape: sh, margin: (worst.grade! - 50) / 20,
        line: p.stats, scope: 'REGULAR', games: p.gp, pct: sh.pct,
        write: (v) => v.pick([
          () => `${p.gp} games and not one of them a write-off. His quietest afternoon of the year was week ${worst.week} — ${spoken(pos, worst.stats)} — and that still beat seven ${plural(pos)} in ten.`,
          () => `You could set your watch by him. ${capitalise(spoken(pos, p.stats))} on the year, and his worst single game — week ${worst.week}, ${spoken(pos, worst.stats)} — was still better than most ${plural(pos)} manage on a good one.`,
          () => `Nothing spectacular and nothing wasted: ${spoken(pos, p.stats)}, and no week all season where he was below what the job asks.`,
        ])(),
      });
    }
  }

  // --- One afternoon -------------------------------------------------------
  if (levelOk && enoughSeason && sh.bestGrade >= 99 && sh.pct <= 40) {
    const rest = subtract(p.stats, sh.best.stats);
    const restGames = p.gp - 1;
    out.push({
      kind: 'ONE_BIG_DAY', shape: sh, margin: (sh.bestGrade - 98) / 2,
      line: sh.best.stats, scope: 'REGULAR', games: 1, pct: null,
      write: (v) => v.pick([
        () => `Week ${sh.best.week} was most of his season: ${spoken(pos, sh.best.stats)}. The other ${restGames} games came to ${spoken(pos, rest)}.`,
        () => `One afternoon carried the whole year. ${capitalise(spoken(pos, sh.best.stats))} in week ${sh.best.week}, and ${spoken(pos, rest)} across the ${restGames} either side of it.`,
        () => `He had a week ${sh.best.week} — ${spoken(pos, sh.best.stats)} — and then he had ${restGames} other games that came to ${spoken(pos, rest)}.`,
      ])(),
    });
  }

  // --- How he grew ---------------------------------------------------------
  out.push(...developmentCandidates(sh));

  // --- January -------------------------------------------------------------
  if (enoughSeason && sh.playoffGraded.length >= 3 && sh.playoffPct !== null) {
    const delta = sh.playoffPct - sh.pct;
    const pg = sh.playoffGraded.length;
    if (delta >= 60 && sh.playoffPct >= 75) {
      out.push({
        kind: 'ROSE_IN_JANUARY', shape: sh, margin: (delta - 60) / 25,
        line: p.playoffStats, scope: 'PLAYOFFS', games: p.playoffGp, pct: sh.playoffPct,
        write: (v) => v.pick([
          () => `${rateHeadline(pos, p.stats, p.gp)} over the regular season. In the ${count(pg, 'postseason game')}: ${spoken(pos, p.playoffStats)}.`,
          () => `He saved it for January. ${capitalise(spoken(pos, p.playoffStats))} in ${count(pg, 'playoff game')}, off a regular season that read ${rateHeadline(pos, p.stats, p.gp)}.`,
          () => `Whatever the regular season was, the postseason was ${spoken(pos, p.playoffStats)} in ${count(pg, 'game')}.`,
        ])(),
      });
    } else if (delta <= -60 && sh.playoffPct <= 30) {
      out.push({
        kind: 'VANISHED_IN_JANUARY', shape: sh, margin: (-delta - 60) / 25,
        line: p.playoffStats, scope: 'PLAYOFFS', games: p.playoffGp, pct: sh.playoffPct,
        write: (v) => v.pick([
          () => `${rateHeadline(pos, p.stats, p.gp)} for four months, and then ${spoken(pos, p.playoffStats)} across ${count(pg, 'postseason game')}.`,
          () => `The postseason got none of it. ${capitalise(count(pg, 'game'))}, ${spoken(pos, p.playoffStats)}, off a regular season worth ${rateHeadline(pos, p.stats, p.gp)}.`,
          () => `He was there all year and gone in January — ${spoken(pos, p.playoffStats)} in ${count(pg, 'playoff game')}.`,
        ])(),
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** [TUNE] Nobody reads twelve of these. Six is a page, not a wall. */
const MAX_STORIES = 6;
/** [TUNE] No single verdict owns a season. */
const MAX_PER_KIND = 2;
const MAX_PER_FAMILY = 3;
/** [TUNE] The forward-looking section is a footnote to the year, not a scouting report. */
const MAX_OUTLOOK = 3;
/**
 * [TUNE] At most this many from one UNIT — lib/coachRoom.ts's own grouping,
 * reused rather than reinvented. Without it a recap could be six defenders, and
 * measurably was: the engine splits a defence's tackles by depth-chart share,
 * so a club carrying a thin defensive rotation inflates four men at once and
 * they arrive on the sheet together. Coach's Comments solved the same problem
 * by taking one man per unit before a second from any; a season has fewer
 * slots and more candidates, so this is the softer version of the same rule.
 */
const MAX_PER_UNIT = 2;

/** How the year ended, as a noun phrase. The templates supply the connector. */
const RESULT_PHRASE: Record<string, string> = {
  CHAMPION: 'a championship at the end of it',
  RUNNER_UP: 'a defeat in the final',
  CONFERENCE: 'a conference championship game we could not win',
  DIVISIONAL: 'an exit in the divisional round',
  WILDCARD: 'a wild card weekend that ended early',
  MISSED: 'no January football',
};

function buildOpener(t: ReviewTeamYear, v: Voice): string {
  const rec = `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`;
  const tail = RESULT_PHRASE[t.playoffResult] ?? 'the end of the year';
  const diff = t.pointsFor - t.pointsAgnst;
  const p = v.scoped('opener');
  return p.pick([
    () => `${rec}, ${t.pointsFor} points scored and ${t.pointsAgnst} given up, and ${tail}. Here is what the year did to the people in it.`,
    () => `We finished ${rec}, with ${tail}. ${diff >= 0 ? `We outscored the schedule by ${diff}` : `The schedule outscored us by ${-diff}`}. What follows is the part that was about individuals.`,
    () => `${t.seasonYear}: ${rec} and ${tail}. ${t.pointsFor} for, ${t.pointsAgnst} against. These are the men the season happened to.`,
    () => `The books close at ${rec} — ${tail}. ${diff >= 0 ? `Plus ${diff}` : `Minus ${-diff}`} on the scoreboard across ${t.teamGames} games, and the following worth saying out loud.`,
  ])();
}

function buildQuiet(t: ReviewTeamYear, v: Voice): string {
  const p = v.scoped('quiet');
  return p.pick([
    () => `Nobody's year needs explaining this time. It was ${t.wins}-${t.losses}, everyone was roughly what they have been, and that is the whole report.`,
    () => `A season without a single individual story worth telling. Some years are like that, and a ${t.wins}-${t.losses} one is allowed to be.`,
    () => `No breakouts, no collapses, nobody who played a level away from himself. ${t.wins}-${t.losses}, and the roster is exactly where we left it.`,
  ])();
}

/**
 * The whole recap, from data that is already in hand. Pure — no database, no
 * clock, no randomness that is not seeded — so the calibration harness can run
 * it over thousands of club-seasons and get the same sentences the screen gets.
 */
export function buildReview(input: ReviewInput): SeasonReview {
  const voice = new Voice(new Rng(`review:${input.seed}`));
  const team = input.team;

  const shapes: Shape[] = [];
  for (const p of input.players) {
    const sh = shapeOf(p, team);
    if (sh) shapes.push(sh);
  }

  const pool: { c: Candidate; score: number }[] = [];
  for (const sh of shapes) {
    let best: { c: Candidate; score: number } | null = null;
    for (const c of candidates(sh, team)) {
      // One man, one story, and the strongest one. `margin` is already in
      // units of "how far past its own measured bar", so the bonus is
      // comparable across kinds that are measured on entirely different scales.
      const score = KIND_PRIORITY[c.kind] + Math.min(1.5, Math.max(0, c.margin)) * 14;
      if (!best || score > best.score) best = { c, score };
    }
    if (best) pool.push(best);
  }

  pool.sort((a, b) => b.score - a.score || a.c.shape.p.playerId.localeCompare(b.c.shape.p.playerId));

  const perKind = new Map<StoryKind, number>();
  const perFamily = new Map<StoryFamily, number>();
  const perUnit = new Map<string, number>();
  const chosen: Candidate[] = [];
  for (const { c } of pool) {
    if (chosen.length >= MAX_STORIES) break;
    const family = FAMILY_OF[c.kind];
    const unit = UNIT_OF[canonicalPosition(c.shape.p.position)] ?? 'OTHER';
    if ((perKind.get(c.kind) ?? 0) >= MAX_PER_KIND) continue;
    if ((perFamily.get(family) ?? 0) >= MAX_PER_FAMILY) continue;
    if ((perUnit.get(unit) ?? 0) >= MAX_PER_UNIT) continue;
    perKind.set(c.kind, (perKind.get(c.kind) ?? 0) + 1);
    perFamily.set(family, (perFamily.get(family) ?? 0) + 1);
    perUnit.set(unit, (perUnit.get(unit) ?? 0) + 1);
    chosen.push(c);
  }

  // The outlook section, chosen AFTER the narrative list and from the men it
  // did not use. One man appears at most once on the whole panel: seeing the
  // same name under "his year" and again under "where he is headed" is the
  // duplication the Week Report had to fix, wearing a longer coat.
  const used = new Set(chosen.map((c) => c.shape.p.playerId));
  const outlookPool: { c: Candidate; score: number }[] = [];
  for (const sh of shapes) {
    if (used.has(sh.p.playerId)) continue;
    let best: { c: Candidate; score: number } | null = null;
    for (const c of outlookCandidates(sh)) {
      const score = KIND_PRIORITY[c.kind] + Math.min(1.5, Math.max(0, c.margin)) * 14;
      if (!best || score > best.score) best = { c, score };
    }
    if (best) outlookPool.push(best);
  }
  outlookPool.sort((a, b) => b.score - a.score || a.c.shape.p.playerId.localeCompare(b.c.shape.p.playerId));
  const outlookChosen: Candidate[] = [];
  const outlookKinds = new Map<StoryKind, number>();
  for (const { c } of outlookPool) {
    if (outlookChosen.length >= MAX_OUTLOOK) break;
    if ((outlookKinds.get(c.kind) ?? 0) >= MAX_PER_KIND) continue;
    outlookKinds.set(c.kind, (outlookKinds.get(c.kind) ?? 0) + 1);
    outlookChosen.push(c);
  }

  const toStory = (c: Candidate): Story => {
    const p = c.shape.p;
    return {
      kind: c.kind,
      family: FAMILY_OF[c.kind],
      tone: TONE_OF[c.kind],
      playerId: p.playerId,
      name: p.name,
      position: canonicalPosition(p.position),
      age: p.age,
      heightIn: p.heightIn,
      weightLb: p.weightLb,
      rookie: p.experience === 0,
      text: c.write(voice.scoped(c.kind)),
      // No standing badge where the file refuses to grade the standing. A
      // percentile beside a linebacker's name is a level claim however
      // carefully the paragraph next to it avoids making one.
      // (assigned below)
      line: statLine(p.position, c.line),
      scope: c.scope,
      games: c.games,
      pct: NO_LEVEL_VERDICT.has(canonicalPosition(p.position)) ? null : c.pct,
      strength: c.margin,
    };
  };

  /**
   * Nothing that reads the same twice in a row.
   *
   * Two career-best reads landed adjacent on a real sheet — "Four seasons on
   * the books now and this is the one" directly above "Nothing on his record
   * touches this" — and although the sentences are different frames, the two
   * verdicts rhyme, which is the exact moment a reader notices a machine. The
   * cap allows a kind twice; this only stops the pair being neighbours. It is a
   * stable reordering, so the strongest read still opens the recap.
   */
  const spread = (list: Candidate[]): Candidate[] => {
    const out: Candidate[] = [];
    const rest = [...list];
    while (rest.length > 0) {
      const last = out[out.length - 1];
      let i = last ? rest.findIndex((c) => c.kind !== last.kind) : 0;
      if (i < 0) i = 0;
      out.push(rest.splice(i, 1)[0]);
    }
    return out;
  };

  const stories = spread(chosen).map(toStory);
  const outlook = spread(outlookChosen).map(toStory);

  return {
    seasonYear: team.seasonYear,
    opener: buildOpener(team, voice),
    stories,
    outlook,
    // Quiet is about the YEAR, not about the roster. Every club has a young
    // player with room left in him, so letting the outlook section suppress
    // this line meant a season with nothing to say about it never got to say
    // so — measured, exactly one club-season in 2,944.
    quiet: stories.length === 0 ? buildQuiet(team, voice) : null,
  };
}

// ---------------------------------------------------------------------------
// Loading it out of the database
// ---------------------------------------------------------------------------

/** How far a club got, in the order the rounds are played. */
const ROUND_ORDER = ['WILDCARD', 'DIVISIONAL', 'CONFERENCE', 'FINAL'];

/**
 * Record, points and ending, summed off the club's own games. Self-consistent
 * by construction: the sentence the recap opens with is built from the same
 * rows every other number in it comes from.
 */
function seasonShape(
  games: { kind: string; homeTeamId: string; homeScore: number; awayScore: number }[],
  teamId: string,
): Pick<ReviewTeamYear, 'wins' | 'losses' | 'ties' | 'pointsFor' | 'pointsAgnst' | 'playoffResult'> {
  let wins = 0, losses = 0, ties = 0, pointsFor = 0, pointsAgnst = 0;
  let deepest = -1, wonFinal = false;
  for (const g of games) {
    const home = g.homeTeamId === teamId;
    const mine = home ? g.homeScore : g.awayScore;
    const theirs = home ? g.awayScore : g.homeScore;
    if (g.kind === 'REGULAR') {
      pointsFor += mine; pointsAgnst += theirs;
      if (mine > theirs) wins++; else if (mine < theirs) losses++; else ties++;
      continue;
    }
    const round = ROUND_ORDER.indexOf(g.kind);
    if (round > deepest) { deepest = round; wonFinal = g.kind === 'FINAL' && mine > theirs; }
  }
  const playoffResult = deepest < 0 ? 'MISSED'
    : deepest === 3 ? (wonFinal ? 'CHAMPION' : 'RUNNER_UP')
    : ROUND_ORDER[deepest];
  return { wins, losses, ties, pointsFor, pointsAgnst, playoffResult };
}

/** Percentile of `v` within `pool`, or null when the pool is too small to mean anything. */
function percentileIn(pool: number[], v: number): number | null {
  if (pool.length < 12) return null;
  return (100 * pool.filter((x) => x < v).length) / pool.length;
}

/**
 * Read time, not write time. Nothing here is persisted and nothing in
 * lib/season.ts has to run for it to work, which means the recap is available
 * on saves that already exist — every number it rests on was written into a
 * Game row the day the game was played.
 *
 * Cost is one club's season of box scores (about twenty games, ~90KB), one
 * roster-wide pass over the league for the pay and rating yardsticks, and an
 * indexed read of the players' completed seasons. Measured on a five-season
 * save: see docs — it is in the same class as the dashboard's other panels.
 */
export async function buildSeasonReview(
  leagueId: string,
  teamId: string,
  seasonYear: number,
): Promise<SeasonReview | null> {
  const [team, games, leagueRow] = await Promise.all([
    prisma.team.findUnique({ where: { id: teamId }, select: { abbr: true } }),
    prisma.game.findMany({
      where: { leagueId, seasonYear, played: true, OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] },
      select: { week: true, kind: true, homeTeamId: true, homeScore: true, awayScore: true, boxScore: true },
      orderBy: { week: 'asc' },
    }),
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, seasonYear: true, phase: true, week: true } }),
  ]);
  if (!team || games.length === 0) return null;

  const settings = readJson<{ scoutingEnabled?: boolean; fogOnOwnRoster?: boolean }>(leagueRow?.settings ?? null, {});
  // How old he was IN THE SEASON BEING REVIEWED. Player.age is a bare number
  // whose meaning depends on which league year it was last incremented for,
  // and the offseason PROGRESS step bumps it before this panel is ever seen —
  // so a man who played the year at 30 is already 31 in the column. The
  // arithmetic is exact rather than an estimate; see ageInSeason().
  const basis = leagueRow ? ageBasisYear(leagueRow) : seasonYear;
  // A rating may only be spoken about when the save already shows it on the
  // roster page. On a fogged save the whole scouting system exists to keep that
  // number away from the player, and a recap is not a hole to leak it through.
  const ratingsVisible = !(settings.scoutingEnabled !== false && settings.fogOnOwnRoster === true);

  interface Acc {
    position: string;
    weeks: ReviewWeek[]; playoffWeeks: ReviewWeek[];
    stats: SeasonStats; playoffStats: SeasonStats;
    gp: number; playoffGp: number;
    injuries: { week: number; weeks: number; type: string }[];
    name: string;
  }
  const acc = new Map<string, Acc>();
  let teamGames = 0;
  let lastWeek = 0;

  for (const g of games) {
    const box = readJson<BoxScore | null>(g.boxScore, null);
    if (!box?.lines) continue;
    const side = g.homeTeamId === teamId ? 'home' : 'away';
    const regular = g.kind === 'REGULAR';
    if (regular) { teamGames += 1; lastWeek = Math.max(lastWeek, g.week); }
    for (const l of box.lines[side] ?? []) {
      let a = acc.get(l.playerId);
      if (!a) {
        a = {
          position: String(l.position), name: l.name,
          weeks: [], playoffWeeks: [], stats: {}, playoffStats: {},
          gp: 0, playoffGp: 0, injuries: [],
        };
        acc.set(l.playerId, a);
      }
      const graded = playedEnough(a.position, l.stats) ? gradeLine(a.position, l.stats) : null;
      const entry: ReviewWeek = { week: g.week, stats: l.stats, grade: graded ? graded.score : null };
      if (regular) { a.weeks.push(entry); a.stats = mergeStats(a.stats, l.stats); a.gp += 1; }
      else { a.playoffWeeks.push(entry); a.playoffStats = mergeStats(a.playoffStats, l.stats); a.playoffGp += 1; }
    }
    for (const inj of box.injuries ?? []) {
      const a = acc.get(inj.playerId);
      if (a && inj.teamId === teamId) a.injuries.push({ week: g.week, weeks: inj.weeks, type: inj.type });
    }
  }
  if (teamGames === 0) return null;

  const ids = [...acc.keys()];
  const [roster, leaguePlayers, leagueContracts, priorRows, milestoneRows] = await Promise.all([
    prisma.player.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, firstName: true, lastName: true, age: true, experience: true,
        heightIn: true, weightLb: true, draftRound: true, trueOvr: true, potential: true, position: true,
        contract: { select: { years: true, baseSalaries: true, signingBonus: true, signedYear: true } },
      },
    }),
    // The league-wide yardsticks for pay, rating and the growth model's band.
    // ACTIVE only: a retired man's rating and a draft-pool prospect's are not
    // part of the market this club competes in, and including them dragged the
    // rating ladder down with two thousand players nobody can sign.
    //
    // Split into two queries ON PURPOSE. Asking Prisma for the contract as a
    // RELATION on 3,540 player rows measured 98ms — most of the whole panel.
    // The same data as two parallel queries over the ~1,700 active players is
    // 21ms, and this is the only expensive thing the panel does.
    prisma.player.findMany({
      where: { leagueId, status: 'ACTIVE' },
      select: { id: true, position: true, trueOvr: true, seasonStats: true },
    }),
    prisma.contract.findMany({
      where: { player: { leagueId, status: 'ACTIVE' } },
      select: { playerId: true, years: true, baseSalaries: true, signingBonus: true },
    }),
    prisma.playerSeason.findMany({
      where: { playerId: { in: ids }, seasonYear: { lt: seasonYear } },
      select: { playerId: true, seasonYear: true, teamAbbr: true, gp: true, stats: true },
    }),
    // The receipts for the stat-leader milestone. Read, never re-derived — the
    // row is what lib/development.ts wrote at the moment the bump was applied.
    prisma.transaction.findMany({
      where: { leagueId, seasonYear, type: 'DEV_MILESTONE', playerId: { in: ids } },
      select: { playerId: true, week: true, headline: true },
      orderBy: { week: 'asc' },
    }),
  ]);

  // The yardsticks for pay and rating: every player at the same position in
  // this league. Annual value rather than this year's cap hit, because the
  // ledger has already been stepped onto the NEXT league year by the time this
  // panel is on screen (see ageContractsForYear in lib/season.ts) and annual
  // value does not move when it does.
  const apyOf = (c: { years: number; baseSalaries: string; signingBonus: number } | null): number | null => {
    if (!c) return null;
    const bases = readJson<number[]>(c.baseSalaries, []);
    if (bases.length === 0 && c.signingBonus === 0) return null;
    return (bases.reduce((a, b) => a + b, 0) + c.signingBonus) / Math.max(1, c.years);
  };
  const contractByPlayer = new Map(leagueContracts.map((c) => [c.playerId, c]));
  const payPool = new Map<string, number[]>();
  const ratePool = new Map<string, number[]>();
  for (const lp of leaguePlayers) {
    const pos = canonicalPosition(lp.position);
    (ratePool.get(pos) ?? ratePool.set(pos, []).get(pos)!).push(lp.trueOvr);
    const apy = apyOf(contractByPlayer.get(lp.id) ?? null);
    if (apy !== null) (payPool.get(pos) ?? payPool.set(pos, []).get(pos)!).push(apy);
  }

  // The growth model's own band, reconstructed from the growth model's own
  // metric. lib/development.ts ranks ACTIVE players at a position by
  // offensiveScore/defensiveScore per week and hands the top 15% an
  // accelerated roll; the last checkpoint of the year runs on the completed
  // season, so this is that checkpoint's ranking and not a second opinion
  // about it. `Player.seasonStats` is the input, and it is cleared by the
  // offseason rollover — once it is gone every rank below is null and the
  // read simply does not fire, which is the right answer rather than a guess.
  const growthRank = new Map<string, number>();
  {
    const byPos = new Map<string, { id: string; rate: number }[]>();
    for (const lp of leaguePlayers) {
      const st = readJson<SeasonStats>(lp.seasonStats, {});
      const rate = DEFENSIVE_POSITIONS.has(lp.position) ? defensiveScore(st) : offensiveScore(st);
      if (rate === 0) continue;
      (byPos.get(lp.position) ?? byPos.set(lp.position, []).get(lp.position)!).push({ id: lp.id, rate });
    }
    for (const group of byPos.values()) {
      if (group.length < 4) continue; // lib/development.ts's own minimum
      group.sort((a, b) => b.rate - a.rate);
      group.forEach((g, i) => growthRank.set(g.id, i / group.length));
    }
  }

  // Deduplicated BY WEEK. One checkpoint can only find a man leading the league
  // once, but a save that re-simmed a week has the row written again — this
  // database holds 595 copies of one league's week 4 — and counting the rows
  // instead of the occasions printed "he led the league at 88 points of the
  // season". The event is the week, not the row.
  const milestonesByPlayer = new Map<string, { week: number; categories: string }[]>();
  const milestoneSeen = new Set<string>();
  for (const m of milestoneRows) {
    if (!m.playerId) continue;
    const key = `${m.playerId}|${m.week}`;
    if (milestoneSeen.has(key)) continue;
    milestoneSeen.add(key);
    // "<name> is pacing the league in receiving yards and rushing yards".
    // The categories are recoverable off the tail; if that ever stops being
    // the shape, the fallback is a phrase that still says something true.
    const cats = /pacing the league in (.+)$/.exec(m.headline)?.[1] ?? 'a marquee category';
    (milestonesByPlayer.get(m.playerId) ?? milestonesByPlayer.set(m.playerId, []).get(m.playerId)!)
      .push({ week: m.week, categories: cats });
  }

  const priorByPlayer = new Map<string, typeof priorRows>();
  for (const r of priorRows) (priorByPlayer.get(r.playerId) ?? priorByPlayer.set(r.playerId, []).get(r.playerId)!).push(r);

  const rosterById = new Map(roster.map((r) => [r.id, r]));
  const players: ReviewPlayer[] = [];
  for (const [playerId, a] of acc) {
    const r = rosterById.get(playerId);
    if (!r) continue; // a box score can name a player the table no longer has
    const pos = canonicalPosition(a.position);
    const apy = apyOf(r.contract);
    // Only a deal that actually covered the season under review may be talked
    // about as this season's pay. Anything signed afterwards is next year's
    // problem and says nothing about the year that just finished.
    const coversYear = r.contract != null && r.contract.signedYear <= seasonYear;
    const prior = (priorByPlayer.get(playerId) ?? [])
      .map((row) => {
        const stats = readJson<SeasonStats>(row.stats, {});
        const z = seasonZ(pos, stats, row.gp);
        return z === null ? null : { seasonYear: row.seasonYear, teamAbbr: row.teamAbbr, gp: row.gp, z, stats };
      })
      .filter((x): x is PriorSeason => x !== null)
      .sort((x, y) => x.seasonYear - y.seasonYear);

    players.push({
      playerId,
      name: `${r.firstName} ${r.lastName}`,
      position: pos,
      age: ageInSeason(r.age, basis, seasonYear) ?? r.age,
      experience: r.experience,
      draftRound: r.draftRound,
      heightIn: r.heightIn,
      weightLb: r.weightLb,
      weeks: a.weeks.sort((x, y) => x.week - y.week),
      stats: a.stats,
      gp: a.gp,
      playoffWeeks: a.playoffWeeks.sort((x, y) => x.week - y.week),
      playoffStats: a.playoffStats,
      playoffGp: a.playoffGp,
      prior,
      payPct: apy !== null && coversYear ? percentileIn(payPool.get(pos) ?? [], apy) : null,
      apy: coversYear ? apy : null,
      ratingPct: ratingsVisible ? percentileIn(ratePool.get(pos) ?? [], r.trueOvr) : null,
      rating: ratingsVisible ? r.trueOvr : null,
      // The ceiling is exact for the user's own roster and is never read for
      // anybody else's — this panel only ever looks at one club. It follows the
      // same visibility rule as the rating: a save that fogs its own roster
      // does not get either number back through a paragraph.
      potential: ratingsVisible ? r.potential : null,
      growthRank: growthRank.get(playerId) ?? null,
      milestones: milestonesByPlayer.get(playerId) ?? [],
      injuries: a.injuries.sort((x, y) => x.week - y.week),
    });
  }

  // The club's own year, counted off its own games rather than read out of
  // TeamSeasonRecord. Two reasons, and the second one is the real one: the
  // record row can be absent for a season a save simmed through, and it can
  // disagree with the schedule (this database holds 15-2 clubs filed as having
  // missed the postseason). A recap whose opening sentence argues with the
  // games underneath it is worse than no opening sentence.
  return buildReview({
    team: {
      seasonYear,
      teamAbbr: team.abbr,
      ...seasonShape(games, teamId),
      teamGames,
      lastWeek: lastWeek || 17,
    },
    players,
    // Seeded on the club and the year alone: the same season re-renders to the
    // same recap forever, including after a reload or a redeploy.
    seed: `${leagueId}|${teamId}|${seasonYear}`,
  });
}

// ---------------------------------------------------------------------------
// Development — see the header, section 5, for what each of these can prove
// ---------------------------------------------------------------------------

/** Which age band's room bar he falls in, or null once there is no band left. */
function roomBarFor(age: number): number | null {
  for (const b of ROOM_BAR) if (age <= b.maxAge) return b.gap;
  return null;
}

/**
 * The two reads that need no history at all: how much is left in him, and
 * whether there is any. Both come straight off `Player.potential` and
 * `Player.trueOvr`, which are exact for the user's own roster and are simply
 * absent when the save fogs them.
 */
function outlookCandidates(sh: Shape): Candidate[] {
  const p = sh.p;
  if (p.rating === null || p.potential === null) return [];
  const gap = p.potential - p.rating;
  const out: Candidate[] = [];

  const bar = roomBarFor(p.age);
  if (bar !== null && gap >= bar && p.potential >= ROOM_MIN_CEILING) {
    out.push({
      // Ranked on the gap AND on the ceiling behind it: fourteen points left in
      // a kicker and thirteen left in a receiver who tops out at 98 are not the
      // same news, and the first version led with the kicker.
      kind: 'ROOM_TO_GROW', shape: sh, margin: (gap - bar) / 6 + (p.potential - ROOM_MIN_CEILING) / 20,
      line: p.stats, scope: 'REGULAR', games: p.gp, pct: null,
      write: (v) => v.pick([
        () => `${p.age}, and ${p.rating} of a possible ${p.potential}. That is ${count(gap, 'point')} of headroom, and we are the club that gets to use it.`,
        () => `We have him at ${p.rating}. Our own people put his ceiling nearer ${p.potential}, and he is ${p.age} — this is not the player we will end up with.`,
        () => `${capitalise(aNumber(p.rating!))} at ${p.age} with ${p.potential} in front of him. Whatever he is worth today he will be worth more, and we hold the deal.`,
        () => `The distance between what he is (${p.rating}) and what he could be (${p.potential}) is the whole reason to be patient with him.`,
      ])(),
    });
  }

  if (p.age >= DONE_MIN_AGE && gap <= 0 && p.rating >= DONE_MIN_RATING) {
    out.push({
      kind: 'AT_CEILING', shape: sh, margin: (p.rating - DONE_MIN_RATING) / 8,
      line: p.stats, scope: 'REGULAR', games: p.gp, pct: null,
      write: (v) => v.pick([
        () => `${p.age} years old, rated ${p.rating}, and ${p.rating} is the whole of it. He is not getting better and there is nothing wrong with that — it just means what we have is what we will have.`,
        () => `He has reached the top of himself. ${p.rating} at ${p.age}, with nothing left between him and his ceiling, so every year from here is a year of holding on to it.`,
        () => `Still a ${p.rating} at ${p.age}, and finished growing. Price him for the player he is now rather than the one we signed.`,
      ])(),
    });
  }
  return out;
}

/**
 * The two development reads that belong to the YEAR: the band the growth model
 * accelerated him in, and the weeks he led the league and it moved his ceiling.
 */
function developmentCandidates(sh: Shape): Candidate[] {
  const p = sh.p;
  const pos = canonicalPosition(p.position);
  const out: Candidate[] = [];

  // Barred at linebacker for the same reason every other level verdict is —
  // the growth model ranks him on a metric that is 55% depth-chart share (see
  // NO_LEVEL_VERDICT). The model really did give him the accelerated roll; what
  // this file will not do is print "one of the best linebackers in the league"
  // as the reason.
  if (!NO_LEVEL_VERDICT.has(pos) && madePlays(pos, p.stats, p.gp)
    && p.growthRank !== null && p.growthRank <= BREAKOUT_BAND
    && p.age <= BREAKOUT_MAX_AGE && sh.graded.length >= MIN_SEASON_WEEKS) {
    const band = Math.max(1, Math.round(p.growthRank * 100));
    // Only worth appending when there is a real distance to report — "he is at
    // 80 with 82 in him" reads as headroom and is two points of noise.
    //
    // Drawn per PLAYER rather than from the section's rotation, because two
    // breakouts in one recap both ended "He is at 91 with 99 in him" / "He is
    // at 90 with 99 in him" — different templates above, identical tails, and
    // the tail is the part a reader's eye lands on. Seeded on his id, so it is
    // stable forever and different from the man beside him.
    const ceiling = p.potential !== null && p.rating !== null && p.potential - p.rating >= 5
      ? new Rng(`ceil:${p.playerId}`).pick([
        ` He is at ${p.rating} with ${p.potential} in him.`,
        ` Our people have him at ${p.rating} and think he finishes nearer ${p.potential}.`,
        ` ${p.rating} today, and ${p.potential} on his file as the ceiling.`,
      ])
      : '';
    out.push({
      // No standing badge: the sentence already carries a position standing,
      // on the growth model's scale rather than this file's, and two different
      // percentages of the same man on one row read as a contradiction.
      kind: 'BREAKOUT', shape: sh, margin: (BREAKOUT_BAND - p.growthRank) / BREAKOUT_BAND,
      line: p.stats, scope: 'REGULAR', games: p.gp, pct: null,
      write: (v) => v.pick([
        () => `${p.age} years old and he finished the season in the top ${band}% of ${plural(pos)} in this league — ${spoken(pos, p.stats)}. A year in that company at his age does not just sit on the page; it pulls a player forward.${ceiling}`,
        () => `${capitalise(spoken(pos, p.stats))} at ${p.age}, which put him among the top ${band}% at his position league-wide. Players come on fastest in exactly that company.${ceiling}`,
        () => `He spent the whole year inside the top ${band}% of ${plural(pos)} — ${spoken(pos, p.stats)} — and he is ${p.age}. That is the sort of season a career turns on.${ceiling}`,
      ])(),
    });
  }

  if (p.milestones.length > 0) {
    const first = p.milestones[0];
    const weeks = p.milestones.map((m) => m.week);
    // "weeks 4 and 17" for four separate occasions is a sentence that quietly
    // undercounts itself. Three or more get counted out loud.
    const span = weeks.length === 1 ? `in week ${weeks[0]}`
      : weeks.length === 2 ? `in weeks ${weeks[0]} and ${weeks[1]}`
      : `at ${count(weeks.length, 'point')} of the season, from week ${weeks[0]} to week ${weeks[weeks.length - 1]}`;
    const cat = first.categories;
    out.push({
      kind: 'LED_THE_LEAGUE', shape: sh, margin: (p.milestones.length - 1) / 2,
      line: p.stats, scope: 'REGULAR', games: p.gp, pct: sh.pct,
      write: (v) => v.pick([
        () => `He was out in front of the whole league in ${cat} ${span}, and that is not just a line in the paper — a run like that raises what a player believes he can be, and what we think he can become.`,
        () => `He led the league in ${cat} ${span}. Being the best there is at something, even for a month, leaves a mark on a player; his ceiling moved with it.`,
        () => `Nobody in the league had more ${cat} than him ${span}. He finished the year with ${spoken(pos, p.stats)}, and he came out of it a better player than he went in.`,
      ])(),
    });
  }
  return out;
}
