import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { Rng, clamp } from '../rng';
import { LEAGUE, Position } from '../tuning';
import { NameRegistry, pickUniqueName } from './names';
import { SeasonStats } from '../types';
import { offensiveScore, defensiveScore, DEFENSIVE_POSITIONS } from '../awards';
import { RECORD_CATEGORIES, RecordCategory } from '../records';
import { mergeStats } from '../stats';
import { writeJson } from '../json';

/**
 * ===========================================================================
 * SEEDED LEAGUE HISTORY
 * ===========================================================================
 * A brand-new league used to begin with no past at all: every franchise 0-0
 * with an empty history table, an empty Ring of Honor, no award ever won and
 * no record on the books, and every 34-year-old on the roster carrying a
 * blank career stat line. Every long-arc screen in the app pointed at an
 * empty room on day one.
 *
 * This module synthesises the missing decades, once, at league creation:
 *
 *   - 16-24 prior seasons of TeamSeasonRecord for all 32 clubs, with win
 *     totals that sum exactly against the schedule and a playoff bracket
 *     actually played out round by round (so exactly one CHAMPION and one
 *     RUNNER_UP per year, and the labels below them match a real bracket).
 *   - Persistent franchise identities across those years, so some clubs read
 *     as perennial contenders and others as long-suffering. A league where
 *     all 32 teams have exactly one title in twenty years is as fake as a
 *     league with none.
 *   - A cast of historical players — part synthetic legends, part the actual
 *     old, highly-rated veterans sitting on today's rosters — who accumulate
 *     season-by-season stat lines, win the awards, and hold the records.
 *   - Career stat lines for EVERY veteran on a roster, shaped by his depth
 *     rank exactly the way lib/sim/engine.ts's allocateStats would have —
 *     written out SEASON BY SEASON, with the year, the club, the games and
 *     the line each one actually produced.
 *
 * THE SEASONS ARE THE HISTORY; THE CAREER TOTAL IS THEIR SUM. This module
 * always walked a veteran's career one season at a time and then threw the
 * walk away, keeping only the merged blob — which left the player card able
 * to say nothing about those years but "Before 2026", and killed the illusion
 * that the league had been around. Every one of those seasons is now
 * persisted as a PlayerSeason row. Nothing is reconstructed from the total:
 * the total is `mergeStats` over the rows, and lib/playerSeasons.ts's
 * residual "Before" row is therefore empty for any league this code created.
 * The one thing that genuinely was not decided anywhere is WHICH CLUB he was
 * on in a given year — the generator knows only where he is today — so that
 * is decided here too, deterministically from the same Rng (clubHistory()),
 * which is what makes it generated history rather than a guess bolted on at
 * read time.
 *
 * A save created before this landed cannot be repaired and is not pretended
 * otherwise: its per-season walk is gone and the Rng stream was never stored,
 * so those veterans keep the single honest "Before" row they have always had.
 *
 * INTERNAL CONSISTENCY IS THE POINT. Everything below is generated from one
 * seeded Rng, and everything cross-references: the record holder is a player
 * who appears in the award tables, his record season is a season he actually
 * had, the team he set it for is the team he played for that year, and no
 * champion ever has a losing record. assertHistoryConsistency at the bottom
 * of this file audits every one of those claims against the output before it
 * is handed back, and anything it returns is a bug, not a warning.
 *
 * SHAPE COMPATIBILITY. Generated stat lines use exactly the keys that
 * lib/sim/engine.ts's allocateStats emits for that position and nothing else
 * — an offensive lineman gets no career stats at all (the sim never writes
 * him a box line), a linebacker never gets a sack (only EDGE/DT do), only
 * CB/S get interceptions and passes defended. A seeded past that claims
 * things the live sim can't produce would be immediately obvious.
 * ===========================================================================
 */

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

export const HISTORY = {
  /**
   * [TUNE] How many prior seasons to invent. The minimum stays at or above 15
   * deliberately: Player.experience caps at 15 (lib/gen/players.ts), so a
   * shorter era would leave the league's oldest veterans with careers that
   * began before the history does — a player whose first six seasons happened
   * in a period the league has no record of.
   */
  MIN_SEASONS: 16,
  MAX_SEASONS: 24,

  /**
   * [TUNE] Franchise identity. `IDENTITY_SD` is the spread of long-run team
   * quality (in logit-ish units); `PERSISTENCE` is how much of last year's
   * form carries into the next. High persistence + wide identity spread is
   * what produces dynasties and doormats instead of 32 interchangeable clubs.
   */
  IDENTITY_SD: 0.42,
  IDENTITY_TAIL_BOOST: 0.3,
  PERSISTENCE: 0.7,
  ERA_NOISE_SD: 0.5,
  /**
   * Franchises have ERAS, not fixed personalities. Holding each club's mean
   * quality still for twenty-four years produced a club that made the
   * playoffs sixteen times and three clubs that never made them once — no
   * real league stays sorted that way for a quarter century. The mean itself
   * drifts (pulled gently back toward the club's identity), so a dynasty
   * decays into a rebuild and a doormat eventually has its decade.
   */
  ERA_DRIFT_SD: 0.21,
  ERA_DRIFT_PULL: 0.07,
  /**
   * Parity. A reverse-order draft and a hard cap are the two things that stop
   * a real league producing a ten-title club in twenty-four years, and this
   * generator has neither — so the effect is modelled directly: winning it all
   * costs a franchise a little of its standing next year, and the clubs
   * picking at the top of the draft get a little of it back. Without this the
   * era drift alone still left seeds where one club won ten of twenty-four.
   */
  TITLE_REGRESSION: 0.3,
  BOTTOM_FEEDER_BOOST: 0.12,
  BOTTOM_FEEDER_COUNT: 6,
  /**
   * Quality -> win percentage steepness. Deliberately gentle: at 0.63 the
   * generator produced a franchise that went 61-278 across twenty straight
   * seasons and another that won nine titles, which is not history, it's a
   * different sport. At 0.5 the extremes settle around 11.5 and 5.5 wins a
   * year, which is what a genuinely great and a genuinely bad franchise
   * average over a long era.
   */
  WIN_PCT_SLOPE: 0.5,
  SEASON_LUCK_SD: 0.055,
  /** Chance a given season contains one tied game (two clubs finish x-y-1). */
  TIE_SEASON_CHANCE: 0.3,

  /** Scoring: league-average points per game, and how far records move it. */
  PPG_MEAN: 24.5,
  PPG_SPREAD: 26,
  PPG_NOISE_SD: 1.8,

  /**
   * [TUNE] Role movement across a seeded career. A veteran's snap share is not
   * a constant — the 31-year-old backup was somebody's starter at 27, and the
   * 27-year-old starter was buried at 23. `ROLE_PERSISTENCE` is how much of
   * last year's role carries into the next (high on purpose: a job lasts three
   * or four seasons rather than flickering year to year), and `ROLE_SD` is the
   * size of one offseason's swing, in log space so the walk is multiplicative
   * and can never produce a negative share.
   */
  ROLE_PERSISTENCE: 0.7,
  ROLE_SD: 0.34,
  /**
   * [TUNE] A year he barely dressed — inactive most weeks, buried on the chart,
   * or hurt in September. Deliberately common for a man below the sim's
   * box-score cutoff, because that is what a journeyman's career looks like,
   * and the row it produces (three games, two catches) says "he was on a
   * roster" where a missing row would say "he did not exist".
   */
  BURIED_YEAR: 0.09,
  BURIED_YEAR_DEEP: 0.22,
  /** How much of a season a buried year is, at most. */
  BURIED_GAMES_SHARE: 0.5,

  /**
   * [TUNE] Below the sim's box-score cutoff the depth ladder runs out, so each
   * further rung is `DEEP_RUNG` of the one above it — thinner, never absent.
   * `DEEP_MAX_SHARE` is the hard ceiling on anyone below the cutoff, as a
   * fraction of a starter's workload, whatever his ladder says: it is what
   * stops a backup kicker (whose ladder has exactly one rung, worth every kick
   * in the season) inheriting half a starter's season, and it is what keeps a
   * journeyman's career small enough that he can never surface on a
   * leaderboard he has no business on.
   */
  DEEP_RUNG: 0.5,
  DEEP_MAX_SHARE: 0.14,

  /**
   * [TUNE] Club movement. `MOVE_BASE` is the per-offseason chance a
   * replacement-level veteran changes clubs; `MOVE_PER_OVR` walks that down as
   * he gets better, because a 90-overall gets re-signed and franchise-tagged
   * while a 62-overall is somebody's cheap August depth every year.
   * `ROOKIE_DEAL` is how many opening seasons are exempt — that is his rookie
   * contract, and it is why almost nobody's card shows two clubs by 24.
   */
  MOVE_BASE: 0.21,
  MOVE_PER_OVR: 0.0045,
  MOVE_FLOOR: 0.05,
  ROOKIE_DEAL: 3,
} as const;

/**
 * Target bands for the seeded records — the whole reason this file cares
 * about calibration at all. Measured against real completed seasons already
 * in this codebase's own database: across nine finished league-seasons the
 * BEST single season anyone posted averaged 5,791 passing yards (max 6,639),
 * 2,609 rushing (max 2,863), 1,614 receiving (max 1,856), 96 tackles (max
 * 99), 12 sacks (max 14) and 9 interceptions (max 10).
 *
 * A record has to be beatable but not trivially so. These bands sit just
 * above the best season the sim has ever actually produced, which is exactly
 * what a twenty-year-old record should be: a strong year gets within ~10% of
 * it, an all-time year on a team that goes deep into the playoffs (playoff
 * box scores accumulate into the same season line) takes it down.
 */
export const SEASON_RECORD_BAND: Record<RecordCategory, { lo: number; hi: number }> = {
  passYds: { lo: 6450, hi: 6900 },
  passTd:  { lo: 58,   hi: 63 },
  rushYds: { lo: 2850, hi: 3050 },
  recYds:  { lo: 1860, hi: 1980 },
  tackles: { lo: 103,  hi: 108 },
  sacks:   { lo: 13,   hi: 15 },
  defInt:  { lo: 10,   hi: 12 },
};

/**
 * Career bands. A player entering the league today plays at most ~14 seasons
 * before the retirement rolls in lib/season.ts get him, so these are set at
 * roughly "twelve to fourteen years of near-elite production" — reachable by
 * a franchise cornerstone late in his career, out of reach for anybody else.
 */
export const CAREER_RECORD_BAND: Record<RecordCategory, { lo: number; hi: number }> = {
  passYds: { lo: 51000, hi: 62000 },
  passTd:  { lo: 400,   hi: 520 },
  rushYds: { lo: 14500, hi: 18500 },
  recYds:  { lo: 12500, hi: 16500 },
  tackles: { lo: 950,   hi: 1200 },
  sacks:   { lo: 84,    hi: 110 },
  defInt:  { lo: 36,    hi: 50 },
};

/**
 * How deep the sim's box score actually goes at each position — copied from
 * lib/sim/engine.ts allocateStats. A player buried below this line never
 * records a single stat in a real season, so he gets no invented career
 * either. Positions absent from this map (the entire offensive line, FB)
 * never appear in a box score at all.
 */
const SIM_DEPTH_CUTOFF: Partial<Record<Position, number>> = {
  QB: 1, RB: 3, WR: 4, TE: 2, LB: 3, S: 2, CB: 3, EDGE: 3, DT: 3, K: 1, P: 1,
};

/** Snap share by depth rank, mirroring allocateStats' depth-weight priors. */
const DEPTH_SHARE: Partial<Record<Position, number[]>> = {
  QB: [1, 0.10, 0.03],
  RB: [0.62, 0.28, 0.10],
  WR: [0.32, 0.25, 0.16, 0.09],
  TE: [0.64, 0.26],
  LB: [1, 0.85, 0.66],
  S: [1, 0.86],
  CB: [1, 0.88, 0.64],
  EDGE: [1, 0.82, 0.6],
  DT: [1, 0.8, 0.58],
  K: [1],
  P: [1],
};

/** Positions a historical star can play — nobody's MVP is a punter. */
const STAR_POSITION_WEIGHTS: Record<string, number> = {
  QB: 15, RB: 11, WR: 19, TE: 6, EDGE: 12, DT: 6, LB: 10, CB: 12, S: 9,
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface HistoryTeam {
  id: string; abbr: string; city: string; nickname: string;
  conference: string; division: string;
}

export interface HistoryRosterPlayer {
  id: string; firstName: string; lastName: string; position: string;
  age: number; experience: number; trueOvr: number; teamId: string | null;
}

export interface HistorySummary {
  years: number[];
  seasons: SeasonHistory[];
  franchises: { abbr: string; name: string; titles: number; runnerUps: number; playoffs: number; wins: number; losses: number }[];
  awards: AwardRow[];
  records: RecordRow[];
  legends: number;
  livingStars: number;
  veteransWithCareers: number;
  problems: string[];
}

export interface AwardRow {
  year: number; type: string; name: string; position: string;
  teamAbbr: string; teamId: string; statLine: string;
  /**
   * The winner, when he is a man the database actually holds — see the doc on
   * Transaction.playerId in prisma/schema.prisma. A seeded award is written in
   * exactly the shape lib/season.ts writes a real one, and that shape carries
   * the id, so a veteran on somebody's roster today is linkable from the
   * trophy he won five years before the user was hired.
   *
   * Null for a LEGEND. Backstory players are names and stat lines, not Player
   * rows (`HistPlayer.recordId` is a synthetic `hist:` key for them), and a
   * foreign key pointed at a man who does not exist is not a link, it is a
   * failed insert. Null here means "not known / not applicable", which is what
   * the column's own doc says it means.
   */
  playerId: string | null;
}

export interface RecordRow {
  scope: 'SEASON' | 'CAREER'; category: RecordCategory; value: number;
  playerId: string; playerName: string; teamAbbr: string; seasonYear: number;
}

export interface SeasonHistory {
  year: number;
  rows: TeamSeasonRow[];
  championId: string;
  runnerUpId: string;
}

export interface TeamSeasonRow {
  teamId: string;
  /** Regular-season only — the playoff record is added into wins/losses. */
  regWins: number; regLosses: number; ties: number;
  wins: number; losses: number;
  pointsFor: number; pointsAgnst: number;
  playoffResult: string;
  seed: number | null;
  playoffGames: number;
}

// ---------------------------------------------------------------------------
// Historical player model
// ---------------------------------------------------------------------------

type CoreLine = Partial<Record<keyof SeasonStats, number>>;

interface HistSeason {
  year: number;
  teamId: string;
  games: number;
  line: CoreLine;
}

interface HistPlayer {
  key: string;
  /** Real Player.id for a living veteran; a synthetic `hist:` id for a legend. */
  recordId: string;
  firstName: string;
  lastName: string;
  position: Position;
  teamId: string;
  debut: number;
  lastYear: number;
  peak: number;
  living: boolean;
  seasons: HistSeason[];
  career: SeasonStats;
}

const name = (p: HistPlayer) => `${p.firstName} ${p.lastName}`;

/**
 * One seeded season for a man who is on a roster today — the row that ends up
 * in PlayerSeason.
 *
 * The per-season walk behind a veteran's career total always existed; it was
 * simply merged into a blob and thrown away, which left the player card able
 * to say only "Before 2026" for the whole thing. Nothing here is reconstructed
 * from that total — it IS the walk, kept.
 */
interface VeteranSeason {
  year: number;
  /** The club he played for THAT year. Decided here, at generation, from the same seeded Rng. */
  teamId: string;
  /** Exact: Player.age is stated in `seasonYear`, so his age then is a subtraction. */
  age: number;
  /** Regular-season games he dressed for. Never more than the season is long. */
  gp: number;
  line: CoreLine;
}

interface VeteranCareer {
  position: Position;
  seasons: VeteranSeason[];
  /** Exactly the sum of `seasons` — Player.careerStats and the rows must reconcile. */
  career: SeasonStats;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function generateLeagueHistory(opts: {
  leagueId: string;
  seasonYear: number;
  seasonLength: number;
  teams: HistoryTeam[];
  roster: HistoryRosterPlayer[];
  rng: Rng;
  names: NameRegistry;
}): Promise<HistorySummary> {
  const { leagueId, seasonYear, teams, rng, names } = opts;
  // Postgres makes no promise about the order findMany hands rows back in, and
  // createLeague reads the roster back without an orderBy — so consuming it in
  // arrival order made every draw below depend on the storage engine's mood
  // rather than the seed. Names are unique league-wide (NameRegistry), so this
  // is a total order, and it is the same one for any two leagues built from
  // the same seed.
  const roster = [...opts.roster].sort((a, b) =>
    a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  const seasonLength = opts.seasonLength || LEAGUE.REGULAR_SEASON_WEEKS;
  const nSeasons = rng.int(HISTORY.MIN_SEASONS, HISTORY.MAX_SEASONS);
  const years: number[] = [];
  for (let y = seasonYear - nSeasons; y <= seasonYear - 1; y++) years.push(y);

  // --- 1. Franchise identities and season results --------------------------
  const seasons = buildSeasons(rng, teams, years, seasonLength);

  // --- 2. The cast ---------------------------------------------------------
  const stars = buildStars(rng, names, teams, roster, years, seasonYear);

  // --- 3. Their seasons ----------------------------------------------------
  for (const p of stars) {
    for (let y = p.debut; y <= p.lastYear; y++) {
      // REGULAR SEASON ONLY. These lines are what a living star's careerStats
      // and PlayerSeason rows are made of, and both of those are the
      // regular-season bucket (see persistHistory) — so a run to the final
      // must not quietly add four games of production to a column headed by
      // a seventeen-game season. The seeded past has no postseason share and
      // the player card says so out loud rather than inventing one.
      const games = seasonLength;
      const idx = y - p.debut;
      const len = p.lastYear - p.debut + 1;
      const q = seasonQuality(rng, p.peak, idx, len);
      p.seasons.push({ year: y, teamId: p.teamId, games, line: coreSeason(rng, p.position, q, games, seasonLength) });
    }
  }

  // --- 4. Calibrate so the records land where they should -------------------
  const abbrOf = (teamId: string) => teams.find((t) => t.id === teamId)?.abbr ?? '';
  calibrateCareers(rng, stars);
  const seasonRecords = calibrateSeasonRecords(rng, stars, abbrOf);
  trimCareersIntoBand(stars, seasonRecords);
  for (const p of stars) p.career = sumCareer(p);

  // --- 5. Awards, computed from the final numbers with the live formulas ----
  const awards = pickAwards(rng, stars, seasons, teams);
  // A record holder nobody has ever heard of is exactly the kind of dangling
  // reference this whole file exists to avoid, so any holder who never won
  // anything is written into the award table in his best year.
  ensureRecordHoldersAppear(stars, seasonRecords, awards, teams, years);

  const careerRecords = collectCareerRecords(stars, seasonYear, abbrOf);
  const records: RecordRow[] = [...seasonRecords, ...careerRecords];

  // --- 6. Career lines for every other veteran on a roster ------------------
  const veteranCareers = buildVeteranCareers(rng, roster, teams, seasonYear, seasonLength);

  // A living star's history was already walked season by season in step 3 —
  // his club, his year, his line — so it needs converting, not rebuilding. He
  // stays a one-club man on purpose: the whole star model is anchored to a
  // franchise (his club's title year decides the championship-game MVP, his
  // award and record rows name that club, and the era-coverage chain in
  // buildStars is built per club), and moving him would mean re-attributing
  // the cast. An elite player spending his career with the team that drafted
  // him is also the ordinary case, not the exception.
  const ageById = new Map(roster.map((p) => [p.id, p.age]));
  for (const p of stars) {
    if (!p.living) continue;
    const nowAge = ageById.get(p.recordId);
    if (nowAge == null) continue;
    veteranCareers.set(p.recordId, {
      position: p.position,
      career: p.career,
      seasons: p.seasons.map((s) => ({
        year: s.year, teamId: s.teamId, age: nowAge - (seasonYear - s.year),
        gp: s.line.gp ?? 0, line: s.line,
      })),
    });
  }

  // The record book is written first and the careers are fitted under it — a
  // man on a roster today must not already hold a mark the league says
  // somebody else does. See capSeededCareers.
  capSeededCareers(rng, veteranCareers, records);

  // --- 7. Persist ----------------------------------------------------------
  await persistHistory({ leagueId, teams, seasons, awards, records, veteranCareers });

  const problems = assertHistoryConsistency({ seasons, stars, awards, records, teams, seasonLength });

  const byTeam = new Map<string, { titles: number; runnerUps: number; playoffs: number; wins: number; losses: number }>();
  for (const t of teams) byTeam.set(t.id, { titles: 0, runnerUps: 0, playoffs: 0, wins: 0, losses: 0 });
  for (const s of seasons) {
    for (const r of s.rows) {
      const agg = byTeam.get(r.teamId)!;
      agg.wins += r.wins; agg.losses += r.losses;
      if (r.playoffResult === 'CHAMPION') agg.titles++;
      if (r.playoffResult === 'RUNNER_UP') agg.runnerUps++;
      if (r.playoffResult !== 'MISSED') agg.playoffs++;
    }
  }

  return {
    years,
    seasons,
    franchises: teams.map((t) => ({ abbr: t.abbr, name: `${t.city} ${t.nickname}`, ...byTeam.get(t.id)! }))
      .sort((a, b) => b.titles - a.titles || b.wins - a.wins),
    awards,
    records,
    legends: stars.filter((s) => !s.living).length,
    livingStars: stars.filter((s) => s.living).length,
    veteransWithCareers: veteranCareers.size,
    problems,
  };
}

// ---------------------------------------------------------------------------
// Season generation
// ---------------------------------------------------------------------------

function buildSeasons(rng: Rng, teams: HistoryTeam[], years: number[], G: number): SeasonHistory[] {
  const n = teams.length;

  // Long-run franchise quality. The tails get pushed out deliberately: a
  // plain normal draw across 32 clubs produces a title spread that's too
  // flat to read as history.
  const means = teams.map(() => rng.normal(0, HISTORY.IDENTITY_SD));
  const order = means.map((m, i) => ({ m, i })).sort((a, b) => b.m - a.m);
  for (let k = 0; k < 4; k++) {
    means[order[k].i] += HISTORY.IDENTITY_TAIL_BOOST;
    means[order[n - 1 - k].i] -= HISTORY.IDENTITY_TAIL_BOOST;
  }
  const anchor = means.slice();
  const form = means.slice();

  const out: SeasonHistory[] = [];
  for (const year of years) {
    for (let i = 0; i < n; i++) {
      means[i] += HISTORY.ERA_DRIFT_PULL * (anchor[i] - means[i]) + rng.normal(0, HISTORY.ERA_DRIFT_SD);
      form[i] = means[i] + HISTORY.PERSISTENCE * (form[i] - means[i]) + rng.normal(0, HISTORY.ERA_NOISE_SD);
    }
    const season = buildOneSeason(rng, teams, year, G, form);
    out.push(season);

    // Parity feedback — see HISTORY.TITLE_REGRESSION.
    const byWins = season.rows.map((r, i) => ({ i, w: r.regWins })).sort((a, b) => a.w - b.w);
    for (let k = 0; k < HISTORY.BOTTOM_FEEDER_COUNT && k < byWins.length; k++) {
      means[byWins[k].i] += HISTORY.BOTTOM_FEEDER_BOOST;
      form[byWins[k].i] += HISTORY.BOTTOM_FEEDER_BOOST;
    }
    const champIdx = teams.findIndex((t) => t.id === season.championId);
    if (champIdx >= 0) {
      means[champIdx] -= HISTORY.TITLE_REGRESSION;
      form[champIdx] -= HISTORY.TITLE_REGRESSION;
    }
  }
  return out;
}

function buildOneSeason(rng: Rng, teams: HistoryTeam[], year: number, G: number, form: number[]): SeasonHistory {
  const n = teams.length;

  // One tied game in some seasons: the two clubs involved play G games but
  // only decide G-1 of them, so the league-wide win total drops by exactly 1.
  const tied = new Set<number>();
  if (rng.bool(HISTORY.TIE_SEASON_CHANCE)) {
    const a = rng.int(0, n - 1);
    let b = rng.int(0, n - 1);
    if (b === a) b = (a + 1) % n;
    tied.add(a); tied.add(b);
  }
  const gamesFor = (i: number) => G - (tied.has(i) ? 1 : 0);
  const targetWins = (G * n) / 2 - (tied.size ? 1 : 0);

  const pct = form.map((q) => clamp(1 / (1 + Math.exp(-q * HISTORY.WIN_PCT_SLOPE)) + rng.normal(0, HISTORY.SEASON_LUCK_SD), 0.1, 0.9));
  const raw = pct.map((p, i) => p * gamesFor(i));
  const scale = targetWins / raw.reduce((a, b) => a + b, 0);
  const scaled = raw.map((r) => r * scale);
  const wins = largestRemainder(scaled, targetWins, (i) => [1, gamesFor(i) - 1]);

  const rows: TeamSeasonRow[] = teams.map((t, i) => ({
    teamId: t.id,
    regWins: wins[i], regLosses: gamesFor(i) - wins[i], ties: tied.has(i) ? 1 : 0,
    wins: wins[i], losses: gamesFor(i) - wins[i],
    pointsFor: 0, pointsAgnst: 0, playoffResult: 'MISSED', seed: null, playoffGames: 0,
  }));

  // --- Seeding: division winners first, then wildcards, exactly as
  // lib/season.ts seedPlayoffs orders them.
  const idxByTeam = new Map(teams.map((t, i) => [t.id, i]));
  const better = (a: number, b: number) => rows[b].regWins - rows[a].regWins || form[b] - form[a] || a - b;
  const seedsByConf = new Map<string, number[]>();
  for (const conf of new Set(teams.map((t) => t.conference))) {
    const confIdx = teams.map((t, i) => ({ t, i })).filter((x) => x.t.conference === conf).map((x) => x.i);
    const divWinners: number[] = [];
    for (const div of new Set(confIdx.map((i) => teams[i].division))) {
      const pool = confIdx.filter((i) => teams[i].division === div).sort(better);
      if (pool.length) divWinners.push(pool[0]);
    }
    divWinners.sort(better);
    const rest = confIdx.filter((i) => !divWinners.includes(i)).sort(better);
    const seeded = [...divWinners, ...rest].slice(0, LEAGUE.PLAYOFF_TEAMS_PER_CONF);
    seedsByConf.set(conf, seeded);
    seeded.forEach((i, k) => { rows[i].seed = k + 1; });
  }

  // --- Bracket. Re-run until the champion has a winning regular season; if
  // the seeded field somehow refuses to produce one, the best regular-season
  // record in the field is forced through instead (with 12 playoff teams and
  // a fixed league-wide win total, that team always has a winning record).
  const strength = (i: number) => form[i] + (rows[i].regWins - G / 2) * 0.14;
  let bracket = playBracket(rng, seedsByConf, strength, null);
  let guard = 0;
  while (rows[bracket.championIdx].regWins <= rows[bracket.championIdx].regLosses && guard++ < 12) {
    bracket = playBracket(rng, seedsByConf, strength, null);
  }
  if (rows[bracket.championIdx].regWins <= rows[bracket.championIdx].regLosses) {
    const field = [...seedsByConf.values()].flat().sort(better);
    bracket = playBracket(rng, seedsByConf, strength, field[0]);
  }

  for (const [i, result] of bracket.results) rows[i].playoffResult = result;
  for (const [i, g] of bracket.gamesPlayed) {
    rows[i].playoffGames = g;
    rows[i].wins += bracket.playoffWins.get(i) ?? 0;
    rows[i].losses += g - (bracket.playoffWins.get(i) ?? 0);
  }

  // --- Points. Margin tracks the record that was actually produced, so a
  // 13-4 team never shows up with a negative point differential.
  for (let i = 0; i < n; i++) {
    const g = gamesFor(i) + rows[i].playoffGames;
    const winPct = (rows[i].regWins + rows[i].ties * 0.5) / gamesFor(i);
    const diff = (winPct - 0.5) * HISTORY.PPG_SPREAD;
    const ppg = clamp(HISTORY.PPG_MEAN + diff / 2 + rng.normal(0, HISTORY.PPG_NOISE_SD), 12, 42);
    const papg = clamp(HISTORY.PPG_MEAN - diff / 2 + rng.normal(0, HISTORY.PPG_NOISE_SD), 12, 42);
    rows[i].pointsFor = Math.round(ppg * g);
    rows[i].pointsAgnst = Math.round(papg * g);
  }

  return {
    year, rows,
    championId: teams[bracket.championIdx].id,
    runnerUpId: teams[bracket.runnerUpIdx].id,
  };
}

interface BracketOutcome {
  championIdx: number;
  runnerUpIdx: number;
  results: Map<number, string>;
  gamesPlayed: Map<number, number>;
  playoffWins: Map<number, number>;
}

/**
 * Plays the real bracket this app uses: six per conference, top two on a bye,
 * 3v6 and 4v5 in the wild card round, reseeded divisional, conference final,
 * then the championship game. Every exit label is therefore the round a club
 * actually lost in, not a label sprinkled on afterwards.
 */
function playBracket(
  rng: Rng,
  seedsByConf: Map<string, number[]>,
  strength: (i: number) => number,
  forceWinner: number | null,
): BracketOutcome {
  const results = new Map<number, string>();
  const gamesPlayed = new Map<number, number>();
  const playoffWins = new Map<number, number>();
  const bump = (m: Map<number, number>, i: number, by = 1) => m.set(i, (m.get(i) ?? 0) + by);

  const game = (a: number, b: number): [number, number] => {
    bump(gamesPlayed, a); bump(gamesPlayed, b);
    if (forceWinner === a) { bump(playoffWins, a); return [a, b]; }
    if (forceWinner === b) { bump(playoffWins, b); return [b, a]; }
    // `a` is the higher seed and gets home field.
    // [TUNE] Wide noise on purpose. The postseason is where the title spread
    // is actually decided, and a bracket that just ranks the field by regular
    // -season strength gives the best franchise of the era nine rings.
    const sa = strength(a) + 0.3 + rng.normal(0, 1.25);
    const sb = strength(b) + rng.normal(0, 1.25);
    const [w, l] = sa >= sb ? [a, b] : [b, a];
    bump(playoffWins, w);
    return [w, l];
  };

  const confChamps: number[] = [];
  for (const seeded of seedsByConf.values()) {
    const [s1, s2, s3, s4, s5, s6] = seeded;
    const [w36, l36] = game(s3, s6);
    const [w45, l45] = game(s4, s5);
    results.set(l36, 'WILDCARD'); results.set(l45, 'WILDCARD');
    // Reseed: the top seed draws the lowest surviving seed.
    const survivors = [w36, w45].sort((x, y) => seeded.indexOf(y) - seeded.indexOf(x));
    const [wA, lA] = game(s1, survivors[0]);
    const [wB, lB] = game(s2, survivors[1]);
    results.set(lA, 'DIVISIONAL'); results.set(lB, 'DIVISIONAL');
    const higher = seeded.indexOf(wA) <= seeded.indexOf(wB) ? wA : wB;
    const lower = higher === wA ? wB : wA;
    const [wC, lC] = game(higher, lower);
    results.set(lC, 'CONFERENCE');
    confChamps.push(wC);
  }

  const [a, b] = confChamps;
  const [champ, runnerUp] = game(a, b);
  results.set(runnerUp, 'RUNNER_UP');
  results.set(champ, 'CHAMPION');

  return { championIdx: champ, runnerUpIdx: runnerUp, results, gamesPlayed, playoffWins };
}

/**
 * Round a vector of real numbers to integers that sum to EXACTLY `target`,
 * respecting per-entry bounds. The league-wide win total is a hard identity
 * (every game produces exactly one win), so "close enough" isn't an option:
 * a history whose seasons don't add up is a history that can be caught out
 * by adding a column.
 */
function largestRemainder(values: number[], target: number, bounds: (i: number) => [number, number]): number[] {
  const out = values.map((v, i) => {
    const [lo, hi] = bounds(i);
    return clamp(Math.floor(v), lo, hi);
  });
  const rem = values.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((a, b) => b.r - a.r);
  let sum = out.reduce((a, b) => a + b, 0);
  for (const { i } of rem) {
    if (sum >= target) break;
    const [, hi] = bounds(i);
    if (out[i] < hi) { out[i]++; sum++; }
  }
  // Repair passes: keep nudging whoever has the most room until the identity
  // holds. Bounds are wide enough that this terminates in one or two sweeps.
  let guard = 0;
  while (sum !== target && guard++ < 200) {
    for (let k = 0; k < out.length && sum !== target; k++) {
      const i = rem[k % rem.length].i;
      const [lo, hi] = bounds(i);
      if (sum < target && out[i] < hi) { out[i]++; sum++; }
      else if (sum > target && out[i] > lo) { out[i]--; sum--; }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The cast
// ---------------------------------------------------------------------------

/**
 * Builds the historical player pool. Every franchise gets an unbroken chain
 * of headline players covering the entire era — that guarantee is what lets
 * the championship-game MVP each year be a real, named player on the team
 * that actually won it, rather than a name invented on the spot.
 *
 * The most recent link in each chain is, where one exists, an ACTUAL old
 * veteran on today's roster. That's the difference between a 34-year-old
 * 92-overall quarterback who has an MVP and three deep playoff runs behind
 * him and one who arrived this morning with a blank page.
 */
function buildStars(
  rng: Rng,
  names: NameRegistry,
  teams: HistoryTeam[],
  roster: HistoryRosterPlayer[],
  years: number[],
  seasonYear: number,
): HistPlayer[] {
  const eraStart = years[0];
  const eraEnd = years[years.length - 1];
  const stars: HistPlayer[] = [];
  let keyN = 0;

  const byTeam = new Map<string, HistoryRosterPlayer[]>();
  for (const p of roster) {
    if (!p.teamId) continue;
    if (!STAR_POSITION_WEIGHTS[p.position]) continue;
    (byTeam.get(p.teamId) ?? byTeam.set(p.teamId, []).get(p.teamId)!).push(p);
  }

  const legend = (teamId: string, position: Position, debut: number, lastYear: number, peak: number): HistPlayer => {
    const { firstName, lastName } = pickUniqueName(rng, names);
    return {
      key: `L${keyN++}`, recordId: `hist:${teamId}:${keyN}`, firstName, lastName, position,
      teamId, debut, lastYear, peak, living: false, seasons: [], career: {},
    };
  };

  for (const team of teams) {
    // --- the living anchor, if this roster has one worth building on
    const candidates = (byTeam.get(team.id) ?? [])
      .filter((p) => p.experience >= 3 && p.trueOvr >= 83)
      .sort((a, b) => b.trueOvr - a.trueOvr);

    let coveredFrom = eraEnd + 1;
    for (const cand of candidates.slice(0, rng.int(1, 2))) {
      const debut = Math.max(eraStart, seasonYear - cand.experience);
      if (debut > eraEnd) continue;
      stars.push({
        key: `A${keyN++}`, recordId: cand.id, firstName: cand.firstName, lastName: cand.lastName,
        position: cand.position as Position, teamId: team.id, debut, lastYear: eraEnd,
        peak: clamp((cand.trueOvr - 72) / 24, 0.2, 1), living: true, seasons: [], career: {},
      });
      coveredFrom = Math.min(coveredFrom, debut);
    }

    // --- legends walking the chain backwards until the era is covered
    let cursor = coveredFrom - 1;
    while (cursor >= eraStart) {
      const len = rng.int(6, 15);
      const debut = Math.max(eraStart, cursor - len + 1);
      stars.push(legend(team.id, rng.weighted(STAR_POSITION_WEIGHTS) as Position, debut, cursor,
        clamp(rng.normal(0.66, 0.2), 0.15, 1)));
      cursor = debut - 1;
    }

    // --- a second, overlapping thread per club so the award races have more
    // than one plausible candidate per team in any given year
    let side = eraEnd;
    while (side >= eraStart && rng.bool(0.75)) {
      const len = rng.int(5, 13);
      const debut = Math.max(eraStart, side - len + 1);
      stars.push(legend(team.id, rng.weighted(STAR_POSITION_WEIGHTS) as Position, debut, side,
        clamp(rng.normal(0.58, 0.2), 0.1, 1)));
      side = debut - 1;
    }
  }

  // --- Rookie of the Year needs a debutant every single year.
  const debutsByYear = new Map<number, number>();
  for (const s of stars) debutsByYear.set(s.debut, (debutsByYear.get(s.debut) ?? 0) + 1);
  for (const y of years) {
    if ((debutsByYear.get(y) ?? 0) >= 1) continue;
    const team = rng.pick(teams);
    stars.push(legend(team.id, rng.weighted(STAR_POSITION_WEIGHTS) as Position, y,
      Math.min(eraEnd, y + rng.int(4, 13)), clamp(rng.normal(0.6, 0.2), 0.15, 1)));
  }

  return stars;
}

/** Career arc: rises to a peak a little before the midpoint, then declines. */
function seasonQuality(rng: Rng, peak: number, idx: number, len: number): number {
  const peakIdx = Math.floor(len * 0.42);
  const spread = Math.max(2.5, len * 0.62);
  const form = clamp(1 - Math.pow((idx - peakIdx) / spread, 2) * 0.7, 0.22, 1);
  return clamp(peak * form + rng.normal(0, 0.07), 0.04, 1.05);
}

// ---------------------------------------------------------------------------
// Stat lines
// ---------------------------------------------------------------------------

/**
 * One season's production for a player of quality `q` (0..1) at `position`,
 * over `games` games. Calibrated against real completed seasons from this
 * codebase's own sim — see SEASON_RECORD_BAND's note — and emitting exactly
 * the key set lib/sim/engine.ts writes for that position, no more.
 *
 * AVAILABILITY AND WORKLOAD ARE TWO DIFFERENT THINGS, and `gp` only ever
 * measures the first. A third receiver dresses for all seventeen games and
 * sees a quarter of the targets; a starter who tore something in September
 * played four games and got the whole offence in them. Both end up with a
 * thin line and they are not the same season, so `games` says how many he was
 * available for and `snapShare` says how much of the offence was his while he
 * was. Folding the second into the first — which is what the first version of
 * the veteran walk did — printed a career of four-game seasons for every
 * WR3 in the league, which is exactly the kind of number a stat page must
 * never state.
 */
function coreSeason(
  rng: Rng, position: Position, q: number, games: number, seasonLength: number, snapShare = 1,
): CoreLine {
  // A season interrupted by injury is what stops every star's best year from
  // being his healthiest year, and it is why records live on playoff teams.
  const healthy = !rng.bool(0.12);
  // Capped at `games`: a year he only dressed for three cannot be shortened
  // into five by the injury branch, and `gp` on a season row that outruns the
  // season itself is the same defect as a stat line that outruns its games.
  const gp = healthy ? games
    : Math.min(games, rng.int(Math.max(5, Math.round(games * 0.4)), Math.max(6, games - 3)));
  const vol = (gp / seasonLength) * snapShare;
  const n = (mean: number, sd: number) => Math.max(0, rng.normal(mean, sd));
  const cap = (cat: RecordCategory, v: number) => Math.min(SEASON_RECORD_BAND[cat].hi, Math.round(v));

  switch (position) {
    case 'QB': {
      const passYds = cap('passYds', n(2500 + q * 3000, 380) * vol);
      const passAtt = Math.round(passYds / rng.float(5.5, 6.5));
      return {
        gp, passAtt, passCmp: Math.round(passAtt * clamp(0.56 + q * 0.10 + rng.normal(0, 0.02), 0.5, 0.72)),
        passYds, passTd: cap('passTd', passYds / rng.float(105, 145)),
        int: Math.round(clamp(rng.normal(16 - q * 7, 4), 2, 28) * vol),
        rushAtt: Math.round(rng.int(28, 62) * vol), rushYds: Math.round(rng.int(20, 260) * vol),
      };
    }
    case 'RB': {
      const rushYds = cap('rushYds', n(560 + q * 1560, 220) * vol);
      const rec = Math.round(rng.int(8, 55) * vol);
      return {
        gp, rushAtt: Math.round(rushYds / rng.float(4.6, 6.1)), rushYds,
        rushTd: Math.round(rushYds / rng.float(85, 155)),
        rec, recYds: Math.round(rec * rng.float(2.4, 5.6)),
      };
    }
    case 'WR': case 'TE': {
      const base = position === 'WR' ? 470 + q * 1200 : 290 + q * 660;
      const recYds = cap('recYds', n(base, 150) * vol);
      const rec = Math.round(recYds / rng.float(8.2, 10.8));
      return {
        gp, targets: Math.round(rec / rng.float(0.58, 0.68)), rec, recYds,
        recTd: Math.round(recYds / rng.float(115, 210)),
      };
    }
    case 'EDGE': case 'DT': {
      const sackBase = position === 'EDGE' ? 2 + q * 10 : 1 + q * 6.5;
      return {
        gp, tackles: cap('tackles', n(52 + q * 36, 6) * vol),
        sacks: cap('sacks', Math.max(0, rng.normal(sackBase, 1.4)) * vol),
        defInt: 0, pd: 0, ff: Math.round(rng.int(0, 3) * vol),
      };
    }
    case 'LB': {
      return {
        gp, tackles: cap('tackles', n(60 + q * 38, 6) * vol),
        sacks: 0, defInt: 0, pd: 0, ff: Math.round(rng.int(0, 3) * vol),
      };
    }
    case 'CB': case 'S': {
      const intBase = position === 'CB' ? 1 + q * 4 : 1 + q * 3.6;
      return {
        gp, tackles: cap('tackles', n(position === 'CB' ? 54 + q * 36 : 58 + q * 36, 6) * vol),
        sacks: 0,
        defInt: cap('defInt', Math.max(0, rng.normal(intBase, 1.1)) * vol),
        pd: Math.round(Math.max(0, rng.normal(6 + q * 12, 2.4)) * vol),
        ff: rng.bool(0.35 * vol) ? 1 : 0,
      };
    }
    case 'K': {
      const fga = Math.round(rng.int(22, 42) * vol);
      const xpa = Math.round(rng.int(35, 80) * vol);
      return { gp, fgm: Math.round(fga * clamp(0.72 + q * 0.2, 0.6, 0.96)), fga, xpm: Math.round(xpa * 0.96), xpa };
    }
    case 'P': {
      const punts = Math.round(rng.int(50, 100) * vol);
      return { gp, punts, puntYds: Math.round(punts * rng.float(41, 48)) };
    }
    default:
      // Offensive line and fullbacks never appear in a box score, so they
      // never accumulate a career line either. Returning {} here is what
      // keeps their cards honest instead of inventing production the sim
      // could never have produced.
      return {};
  }
}

function sumCareer(p: HistPlayer): SeasonStats {
  let out: SeasonStats = {};
  for (const s of p.seasons) out = mergeStats(out, s.line as SeasonStats);
  return out;
}

// ---------------------------------------------------------------------------
// Record calibration
// ---------------------------------------------------------------------------

/**
 * Nudge the career leader in each category onto the target band. Only ever
 * touches the one player who already leads that category and only that
 * category's numbers, with every season still clamped below the single-season
 * ceiling, so the adjustment can't manufacture a season that outruns the
 * season record set immediately afterwards.
 */
function calibrateCareers(rng: Rng, stars: HistPlayer[]) {
  for (const cat of RECORD_CATEGORIES) {
    const totalOf = (p: HistPlayer) => p.seasons.reduce((a, s) => a + (s.line[cat] ?? 0), 0);
    const leader = stars.reduce<HistPlayer | null>((best, p) => (!best || totalOf(p) > totalOf(best) ? p : best), null);
    if (!leader) continue;
    const current = totalOf(leader);
    if (current <= 0) continue;
    const band = CAREER_RECORD_BAND[cat];
    const f = rng.int(band.lo, band.hi) / current;
    // Scaled across the WHOLE cast, not just the leader. Moving one man alone
    // just parks the record on whatever the runner-up happened to total, which
    // is how the first pass ended up with an 18,000-yard rushing record it had
    // been asked to hold under 14,500. Scaling the era preserves every
    // ordering — who led what, and by how much — while putting the all-time
    // number where a beatable record belongs.
    for (const p of stars) {
      for (const s of p.seasons) {
        const cur = s.line[cat] ?? 0;
        if (cur > 0) s.line[cat] = Math.min(SEASON_RECORD_BAND[cat].hi, Math.max(0, Math.round(cur * f)));
      }
    }
  }
  for (const p of stars) redriveDerived(rng, p);
}

/**
 * Set each single-season record to a value inside its band by promoting the
 * best season anybody actually had. Every other season was already clamped
 * below the band ceiling at generation time, so the promoted season is the
 * unique league high — no ties to break, no second holder.
 */
function calibrateSeasonRecords(rng: Rng, stars: HistPlayer[], abbrOf: (teamId: string) => string): RecordRow[] {
  const out: RecordRow[] = [];
  for (const cat of RECORD_CATEGORIES) {
    let best: { p: HistPlayer; s: HistSeason; v: number } | null = null;
    for (const p of stars) {
      for (const s of p.seasons) {
        const v = s.line[cat] ?? 0;
        if (!best || v > best.v) best = { p, s, v };
      }
    }
    if (!best || best.v <= 0) continue;
    const band = SEASON_RECORD_BAND[cat];
    const value = clamp(Math.max(best.v, rng.int(band.lo, band.hi)), band.lo, band.hi);
    best.s.line[cat] = value;
    redriveDerived(rng, best.p);
    out.push({
      scope: 'SEASON', category: cat, value: best.s.line[cat]!,
      playerId: best.p.recordId, playerName: name(best.p),
      teamAbbr: abbrOf(best.s.teamId), seasonYear: best.s.year,
    });
  }
  return out;
}

/**
 * Re-derive the companion numbers after a headline stat was moved. Attempts
 * follow yards, not the other way round, so a 6,900-yard season still reads
 * like a quarterback's season and not a spreadsheet artefact.
 */
function redriveLines(rng: Rng, position: Position, lines: CoreLine[]) {
  for (const l of lines) {
    if (position === 'QB' && l.passYds != null) {
      l.passAtt = Math.round(l.passYds / rng.float(5.5, 6.5));
      l.passCmp = Math.round(l.passAtt * rng.float(0.58, 0.68));
    }
    if (position === 'RB' && l.rushYds != null) {
      l.rushAtt = Math.round(l.rushYds / rng.float(4.6, 6.1));
      l.rushTd = Math.round(l.rushYds / rng.float(85, 155));
    }
    if ((position === 'WR' || position === 'TE') && l.recYds != null) {
      l.rec = Math.round(l.recYds / rng.float(8.2, 10.8));
      l.targets = Math.round(l.rec / rng.float(0.58, 0.68));
      l.recTd = Math.round(l.recYds / rng.float(115, 210));
    }
  }
}

function redriveDerived(rng: Rng, p: HistPlayer) {
  redriveLines(rng, p.position, p.seasons.map((s) => s.line));
}

/**
 * Final pass, once the single-season records are locked in. Two things push a
 * career total off the band it was scaled onto: rounding a fifteen-season run
 * of single-digit interception totals, and the season-record promotion adding
 * its own delta to that man's career. Both are trimmed out of his ordinary
 * years — never the record season itself, which would undo the record that was
 * just set.
 */
function trimCareersIntoBand(stars: HistPlayer[], seasonRecords: RecordRow[]) {
  const untouchable = new Set(seasonRecords.map((r) => `${r.playerName}:${r.category}:${r.seasonYear}`));
  for (const cat of RECORD_CATEGORIES) {
    const totalOf = (p: HistPlayer) => p.seasons.reduce((a, s) => a + (s.line[cat] ?? 0), 0);
    const leader = stars.reduce<HistPlayer | null>((best, p) => (!best || totalOf(p) > totalOf(best) ? p : best), null);
    if (!leader) continue;
    const band = CAREER_RECORD_BAND[cat];
    let total = totalOf(leader);
    let guard = 0;
    while (total > band.hi && guard++ < 500) {
      const target = [...leader.seasons]
        .filter((s) => (s.line[cat] ?? 0) > 0 && !untouchable.has(`${name(leader)}:${cat}:${s.year}`))
        .sort((a, b) => (b.line[cat] ?? 0) - (a.line[cat] ?? 0))[0];
      if (!target) break;
      target.line[cat] = (target.line[cat] ?? 0) - 1;
      total--;
    }
  }
}

function collectCareerRecords(stars: HistPlayer[], seasonYear: number, abbrOf: (teamId: string) => string): RecordRow[] {
  const out: RecordRow[] = [];
  for (const cat of RECORD_CATEGORIES) {
    let best: { p: HistPlayer; v: number } | null = null;
    for (const p of stars) {
      const v = p.career[cat] ?? 0;
      if (!best || v > best.v) best = { p, v };
    }
    if (!best || best.v <= 0) continue;
    out.push({
      scope: 'CAREER', category: cat, value: best.v,
      playerId: best.p.recordId, playerName: name(best.p),
      teamAbbr: abbrOf(best.p.teamId), seasonYear: best.p.living ? seasonYear - 1 : best.p.lastYear,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Awards
// ---------------------------------------------------------------------------

const AWARD_ORDER = ['AWARD_MVP', 'AWARD_OPOY', 'AWARD_DPOY', 'AWARD_ROTY', 'AWARD_SBMVP'] as const;

/** Same wording as lib/awards.ts statLineFor, so seeded and live rows read identically. */
function statLineFor(s: CoreLine, isDefensive: boolean): string {
  if (isDefensive) return `${s.tackles ?? 0} tkl, ${s.sacks ?? 0} sacks, ${s.defInt ?? 0} INT`;
  if ((s.passAtt ?? 0) > 0) return `${s.passYds ?? 0} pass yds, ${s.passTd ?? 0} TD, ${s.int ?? 0} INT`;
  if ((s.rushAtt ?? 0) > (s.targets ?? 0)) return `${s.rushYds ?? 0} rush yds, ${s.rushTd ?? 0} TD`;
  return `${s.recYds ?? 0} rec yds, ${s.recTd ?? 0} TD`;
}

/**
 * Award winners for every seeded year, scored with the LIVE formulas
 * (lib/awards.ts offensiveScore/defensiveScore) rather than a second opinion
 * invented here — the seeded past is judged by the same standard the user's
 * own seasons will be. Five distinct players per year, so nothing in the
 * table ever reads as a duplicate.
 */
function pickAwards(rng: Rng, stars: HistPlayer[], seasons: SeasonHistory[], teams: HistoryTeam[]): AwardRow[] {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const out: AwardRow[] = [];

  for (const season of seasons) {
    const field = stars
      .map((p) => {
        const s = p.seasons.find((x) => x.year === season.year);
        if (!s) return null;
        const isDef = DEFENSIVE_POSITIONS.has(p.position);
        const score = isDef ? defensiveScore(s.line as SeasonStats) : offensiveScore(s.line as SeasonStats);
        return { p, s, isDef, score, rookie: p.debut === season.year };
      })
      .filter((x): x is NonNullable<typeof x> => !!x && x.score > 0);
    if (field.length === 0) continue;

    const taken = new Set<string>();
    const take = (pool: typeof field): (typeof field)[number] | null => {
      const pick = pool.filter((c) => !taken.has(c.p.key)).sort((a, b) => b.score - a.score)[0];
      if (pick) taken.add(pick.p.key);
      return pick ?? null;
    };

    // Settle the narrow trophies first. Championship-game MVP can only come
    // from one roster and Rookie of the Year from one draft class, so picking
    // the open-field awards first strands them: the first version of this left
    // two seasons with no championship MVP at all because a dominant club's
    // whole cast had already been spent on the league-wide awards.
    const winners: Record<string, (typeof field)[number] | null> = {
      AWARD_SBMVP: take(field.filter((c) => c.p.teamId === season.championId)),
      AWARD_ROTY: take(field.filter((c) => c.rookie)),
      AWARD_MVP: take(field),
      AWARD_OPOY: take(field.filter((c) => !c.isDef)),
      AWARD_DPOY: take(field.filter((c) => c.isDef)),
    };

    for (const type of AWARD_ORDER) {
      const w = winners[type];
      if (!w) continue;
      const team = teamById.get(w.p.teamId)!;
      out.push({
        year: season.year, type, name: name(w.p), position: w.p.position,
        teamAbbr: team.abbr, teamId: team.id, statLine: statLineFor(w.s.line, w.isDef),
        playerId: w.p.living ? w.p.recordId : null,
      });
    }
  }
  return out;
}

/**
 * Any record holder who never won anything is written into the award table in
 * his single best year, displacing whoever held that award. A career passing
 * record belonging to a name that appears nowhere else in the league's
 * history is precisely the dangling reference this file exists to prevent.
 */
function ensureRecordHoldersAppear(
  stars: HistPlayer[], seasonRecords: RecordRow[], awards: AwardRow[],
  teams: HistoryTeam[], years: number[],
) {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const named = new Set(awards.map((a) => a.name));
  const holders = new Set<string>();
  for (const r of seasonRecords) holders.add(r.playerName);
  for (const cat of RECORD_CATEGORIES) {
    let best: HistPlayer | null = null;
    for (const p of stars) if (!best || (p.career[cat] ?? 0) > (best.career[cat] ?? 0)) best = p;
    if (best && (best.career[cat] ?? 0) > 0) holders.add(name(best));
  }

  // Two holders wanting the same year's trophy would otherwise evict each
  // other — the second write dropped the first straight back out of the
  // history it was being added to. Slots already held by a record holder are
  // off-limits for the same reason: overwriting one erases the only mention
  // that man had.
  const claimed = new Set<string>(
    awards.filter((a) => holders.has(a.name)).map((a) => `${a.year}:${a.type}`),
  );
  for (const p of stars) {
    const n = name(p);
    if (!holders.has(n) || named.has(n) || p.seasons.length === 0) continue;
    const isDef = DEFENSIVE_POSITIONS.has(p.position);
    const score = (s: HistSeason) => (isDef ? defensiveScore(s.line as SeasonStats) : offensiveScore(s.line as SeasonStats));
    const type = isDef ? 'AWARD_DPOY' : 'AWARD_OPOY';
    const ranked = [...p.seasons].sort((a, b) => score(b) - score(a));
    const target = ranked.find((s) => years.includes(s.year) && !claimed.has(`${s.year}:${type}`));
    if (!target) continue;
    claimed.add(`${target.year}:${type}`);
    const idx = awards.findIndex((a) => a.year === target.year && a.type === type);
    const team = teamById.get(p.teamId)!;
    const row: AwardRow = {
      year: target.year, type, name: n, position: p.position,
      teamAbbr: team.abbr, teamId: team.id, statLine: statLineFor(target.line, isDef),
      playerId: p.living ? p.recordId : null,
    };
    if (idx >= 0) awards[idx] = row; else awards.push(row);
    named.add(n);
  }
}

// ---------------------------------------------------------------------------
// Club history
// ---------------------------------------------------------------------------

/**
 * Where a veteran was, year by year, before this league started keeping
 * records — one club id per season, oldest first.
 *
 * This is the one thing about a seeded career that genuinely was not decided
 * anywhere: the generator knows only where he is TODAY. So it is decided
 * here, at generation, from the same seeded Rng as his stat lines, which is
 * what makes it generated history rather than a plausible-looking guess bolted
 * on at read time. If his card says 2019 and BUF, this function said 2019 and
 * BUF.
 *
 * The shape is the one a real career has:
 *   - He is on his PRESENT club for the most recent stretch. That is the only
 *     fact we actually have, so the walk is anchored on it and runs backwards.
 *   - A move is a per-offseason coin flip, so stints come out geometric and
 *     therefore long: most men get one club, a minority two, a well-travelled
 *     journeyman three.
 *   - The flip is weighted by how good he is. A 90-overall gets re-signed and
 *     franchise-tagged; a 62-overall is somebody's cheap August depth every
 *     year. Nobody moves during his first three seasons, because that is a
 *     rookie contract.
 *   - Prior clubs are drawn without replacement, so a two-club career never
 *     names the same club twice, and from the era's real franchises — every
 *     one of the 32 has TeamSeasonRecord rows for every seeded year, so there
 *     is no year in which a club he is said to have played for did not exist.
 */
function clubHistory(rng: Rng, opts: {
  count: number; currentTeamId: string; trueOvr: number; teams: HistoryTeam[];
}): string[] {
  const { count, currentTeamId, trueOvr, teams } = opts;
  const out = new Array<string>(count).fill(currentTeamId);

  const move = clamp(
    HISTORY.MOVE_BASE - (trueOvr - 58) * HISTORY.MOVE_PER_OVR,
    HISTORY.MOVE_FLOOR, HISTORY.MOVE_BASE,
  );
  // Index i means "he arrived somewhere new before season i". Every roll is
  // taken whatever the outcome, so the stream does not depend on the answers.
  const arrivals: number[] = [];
  for (let i = HISTORY.ROOKIE_DEAL; i < count; i++) if (rng.bool(move)) arrivals.push(i);
  if (arrivals.length === 0) return out;

  const pool = teams.filter((t) => t.id !== currentTeamId);
  const priors = rng.shuffle(pool).slice(0, arrivals.length).map((t) => t.id);
  let from = 0;
  arrivals.forEach((to, k) => {
    for (let i = from; i < to; i++) out[i] = priors[k];
    from = to;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Career lines for ordinary veterans
// ---------------------------------------------------------------------------

/**
 * Every veteran on a roster gets the career he would have had, SEASON BY
 * SEASON — the walk below is the history, and the merged career total is
 * nothing more than its sum.
 *
 * Volume is driven by his depth rank at his own position on his own team —
 * the same thing that drives it in a live game (lib/sim/engine.ts
 * allocateStats only writes box lines for the top of each depth group) — so
 * the starter has a decade of real production while the man behind him has
 * the thin, patchy line a backup should have.
 *
 * WHY EVERYONE WHO CAN RECORD A STAT GETS A CAREER. The first version stopped
 * at the sim's box-score cutoff, which left a 30-year-old fifth receiver with
 * no catch in his life. That reads as broken data, not as a backup: he has
 * been somebody's third receiver at some point in eight years. Below the
 * cutoff the ladder simply keeps going, thinner each rung and hard-capped by
 * HISTORY.DEEP_MAX_SHARE, so a journeyman's career is real and small rather
 * than absent — small enough that he can never appear on a leaderboard he
 * has no business on. The offensive line and fullbacks still get nothing,
 * because the live sim records nothing they do either; a blank table is the
 * honest answer there, not a gap.
 *
 * WHY IT IS LUMPY. A career is not a smooth line scaled to today's depth
 * chart. His snap share is a persistent random walk ANCHORED ON ITS LAST
 * SEASON — where he is on the chart now is where his career ended up, not the
 * average of it — so a man who has slid to the bench still has his starting
 * years behind him and a man who broke through late still has his buried
 * ones. On top of that, any year can be one he barely dressed for, and
 * coreSeason's own injury branch takes games off him independently. Games
 * played and snap share are kept strictly separate (see coreSeason): a year
 * cut short in September has few games and a full share of the offence while
 * he was up, and a year as the third receiver has all seventeen games and a
 * quarter of the targets. They are different seasons and the table shows them
 * as different seasons.
 */
function buildVeteranCareers(
  rng: Rng, roster: HistoryRosterPlayer[], teams: HistoryTeam[],
  seasonYear: number, seasonLength: number,
): Map<string, VeteranCareer> {
  const out = new Map<string, VeteranCareer>();

  const byTeamPos = new Map<string, HistoryRosterPlayer[]>();
  for (const p of roster) {
    if (!p.teamId) continue;
    const k = `${p.teamId}:${p.position}`;
    (byTeamPos.get(k) ?? byTeamPos.set(k, []).get(k)!).push(p);
  }
  for (const group of byTeamPos.values()) group.sort((a, b) => b.trueOvr - a.trueOvr);

  for (const group of byTeamPos.values()) {
    group.forEach((p, rank) => {
      const pos = p.position as Position;
      const cutoff = SIM_DEPTH_CUTOFF[pos];
      const ladder = DEPTH_SHARE[pos];
      if (!cutoff || !ladder) return;             // never appears in a box score at all
      if (p.experience < 1) return;               // rookies have no past yet

      // The rung he is on today, AS A FRACTION OF THE STARTER'S WORKLOAD.
      //
      // The normalisation is the whole point. DEPTH_SHARE is written in two
      // different currencies: the defensive ladders start at 1 (a share of a
      // starter's snaps) but the skill ladders start at 0.32 (a share of the
      // team's targets), and coreSeason already emits a full STARTER's season.
      // Multiplying a starter's season by 0.32 to get the WR1's therefore
      // charged him for his depth rank twice, and the league it produced had
      // receivers going 12 years without a 400-yard season while the sim, the
      // moment it took over, handed the same man 900. Dividing by the top rung
      // puts both ladders in the same currency: 1 for the man taking every
      // snap, and a real fraction of him for everyone behind.
      const rung = (r: number) => (r < ladder.length
        ? ladder[r]
        : ladder[ladder.length - 1] * Math.pow(HISTORY.DEEP_RUNG, r - ladder.length + 1));
      const rel = (r: number) => rung(r) / ladder[0];
      const deep = rank >= cutoff;
      const baseShare = deep ? Math.min(rel(rank), HISTORY.DEEP_MAX_SHARE) : rel(rank);

      // Which league years he was actually in the league for. `experience`
      // counts seasons, so the year of the season `back` years ago is
      // seasonYear - back; anything that lands before he turned 20 never
      // happened.
      const years: number[] = [];
      for (let back = p.experience; back >= 1; back--) {
        if (p.age - back < 20) continue;
        years.push(seasonYear - back);
      }
      if (years.length === 0) return;

      const clubs = clubHistory(rng, { count: years.length, currentTeamId: p.teamId!, trueOvr: p.trueOvr, teams });

      // The role walk, in log space, drawn in full before it is used so it can
      // be re-anchored on its final season (see the header).
      const logRole: number[] = [];
      let l = 0;
      for (let i = 0; i < years.length; i++) {
        l = HISTORY.ROLE_PERSISTENCE * l + rng.normal(0, HISTORY.ROLE_SD);
        logRole.push(l);
      }
      const anchor = logRole[logRole.length - 1];

      const seasons: VeteranSeason[] = [];
      let career: SeasonStats = {};
      years.forEach((year, i) => {
        const ageThen = p.age - (seasonYear - year);
        // He wasn't this good at 22. Walk the rating back toward a rookie
        // version of himself, which is what makes early seasons look like
        // early seasons instead of prime ones.
        const ovrThen = p.trueOvr - clamp(27 - ageThen, 0, 7) * 1.7 - clamp(ageThen - 31, 0, 5) * -0.6;
        const q = clamp((ovrThen - 62) / 28, 0.03, 1);
        // Snap share ramps in over the first two years, the way a real depth
        // chart hands a job over.
        const ramp = i < 2 && years.length > 2 ? 0.5 : 1;
        const buried = rng.bool(deep ? HISTORY.BURIED_YEAR_DEEP : HISTORY.BURIED_YEAR);
        const role = Math.exp(logRole[i] - anchor);
        // Never more than the top rung: no one plays more of the offence than
        // the man taking every snap of it.
        const share = clamp(baseShare * role * ramp * (buried ? 0.2 : 1), 0.003, 1);
        const games = buried
          ? rng.int(1, Math.max(2, Math.round(seasonLength * HISTORY.BURIED_GAMES_SHARE)))
          : seasonLength;
        // `q` goes in undiminished. How good he is and how much of the offence
        // is his are two separate things, and coreSeason multiplies the second
        // in itself — discounting `q` by his share as well was the other half
        // of the double charge described above.
        const line = coreSeason(rng, pos, q, games, seasonLength, share);
        seasons.push({ year, teamId: clubs[i], age: ageThen, gp: line.gp ?? 0, line });
        career = mergeStats(career, line as SeasonStats);
      });
      if (seasons.length > 0) out.set(p.id, { position: pos, seasons, career });
    });
  }
  return out;
}

/**
 * Nothing on a roster may already have beaten the record book.
 *
 * The marks are calibrated off the STARS (calibrateCareers, then
 * calibrateSeasonRecords), which is fine for the men those passes can see —
 * but an ordinary starter with fifteen years behind him out-totals a legend
 * without ever having been one. The generator was shipping leagues whose
 * all-time passing record was 54,993 and whose starting quarterback arrived
 * with 56,934, and whose sack record was 89 held by a man sitting behind
 * somebody with 103. A record page contradicted by a player page is precisely
 * the failure this file exists to prevent; it was simply invisible while a
 * veteran's career was one undecomposable blob nobody could read.
 *
 * So every seeded career is scaled to sit UNDER the mark it would otherwise
 * have broken on day one — under rather than level with it, and by a random
 * amount, so a league doesn't read as thirty men who all stopped one yard
 * short. Scaling keeps the shape of his career (every season moves by the same
 * factor, his best year is still his best year) and the companion numbers are
 * re-derived afterwards so the attempts still match the yards.
 *
 * The record holders themselves are exempt, since by construction they ARE the
 * mark.
 */
function capSeededCareers(rng: Rng, careers: Map<string, VeteranCareer>, records: RecordRow[]) {
  const seasonMark = new Map<RecordCategory, number>();
  const careerMark = new Map<RecordCategory, number>();
  for (const r of records) (r.scope === 'SEASON' ? seasonMark : careerMark).set(r.category, r.value);
  const holders = new Set(records.map((r) => r.playerId));

  for (const [id, c] of careers) {
    if (holders.has(id)) continue;
    let touched = false;
    for (const cat of RECORD_CATEGORIES) {
      const sm = seasonMark.get(cat);
      if (sm != null) {
        for (const s of c.seasons) {
          if ((s.line[cat] ?? 0) < sm) continue;
          s.line[cat] = Math.floor(sm * rng.float(0.80, 0.97));
          touched = true;
        }
      }
      const cm = careerMark.get(cat);
      if (cm == null) continue;
      const total = c.seasons.reduce((a, s) => a + (s.line[cat] ?? 0), 0);
      if (total < cm || total <= 0) continue;
      const f = Math.floor(cm * rng.float(0.82, 0.97)) / total;
      for (const s of c.seasons) {
        if (s.line[cat] == null) continue;
        s.line[cat] = Math.round(s.line[cat]! * f);
      }
      touched = true;
    }
    if (!touched) continue;
    redriveLines(rng, c.position, c.seasons.map((s) => s.line));
    // careerStats is the sum of the rows and nothing else — recomputed here so
    // the two cannot drift apart when the rows underneath them move.
    c.career = c.seasons.reduce((a, s) => mergeStats(a, s.line as SeasonStats), {} as SeasonStats);
  }
}

// ---------------------------------------------------------------------------
// Championship rings
// ---------------------------------------------------------------------------

/**
 * Which of his club's titles a player was actually around for. Nothing in the
 * schema records where a generated veteran was in 2019, so this derives it —
 * deterministically from his own id, so it never changes between page loads —
 * from the only two things that are knowable: his club won the title that
 * year, and a player of his calibre is more likely to have been on that
 * roster (and more likely the closer to the present it was) than a journeyman
 * backup who has bounced around the league. A 92-overall veteran collects the
 * rings his franchise won during his career; a 62-overall backup almost
 * never does.
 */
export function ringYearsFor(opts: {
  playerId: string; trueOvr: number; careerStartYear: number;
  currentYear: number; titleYears: number[];
}): number[] {
  const out: number[] = [];
  for (const year of opts.titleYears) {
    if (year < opts.careerStartYear || year >= opts.currentYear) continue;
    const base = clamp((opts.trueOvr - 58) / 42, 0.04, 0.9);
    const recency = clamp(1 - (opts.currentYear - year) * 0.045, 0.35, 1);
    if (new Rng(`${opts.playerId}:ring:${year}`).bool(base * recency)) out.push(year);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function persistHistory(args: {
  leagueId: string;
  teams: HistoryTeam[];
  seasons: SeasonHistory[];
  awards: AwardRow[];
  records: RecordRow[];
  veteranCareers: Map<string, VeteranCareer>;
}) {
  const { leagueId, teams, seasons, awards, records, veteranCareers } = args;
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const seasonRows = seasons.flatMap((s) => s.rows.map((r) => ({
    leagueId, teamId: r.teamId, year: s.year,
    wins: r.wins, losses: r.losses, ties: r.ties,
    pointsFor: r.pointsFor, pointsAgnst: r.pointsAgnst, playoffResult: r.playoffResult,
  })));
  await chunked(seasonRows, 500, (batch) => prisma.teamSeasonRecord.createMany({ data: batch }));

  // Champion + award rows, in the exact shape lib/season.ts writes them so
  // every reader (Ring of Honor, dynasty score, the wire ticker) treats a
  // seeded title identically to one the user wins.
  const txRows: any[] = [];
  for (const s of seasons) {
    const champ = teamById.get(s.championId)!;
    const row = s.rows.find((r) => r.teamId === s.championId)!;
    txRows.push({
      leagueId, seasonYear: s.year, week: 4, type: 'CHAMPION', teamId: champ.id,
      headline: `The ${champ.city} ${champ.nickname} are your ${s.year} champions!`,
      detail: `Finished ${row.wins}-${row.losses}${row.ties ? `-${row.ties}` : ''}, ${row.pointsFor} points for.`,
    });
  }
  for (const a of awards) {
    txRows.push({
      leagueId, seasonYear: a.year, week: 4, type: a.type, teamId: a.teamId,
      // Null for a legend, on purpose — see AwardRow.playerId.
      playerId: a.playerId,
      headline: `${a.name} (${a.position})`, detail: a.statLine,
    });
  }
  await chunked(txRows, 500, (batch) => prisma.transaction.createMany({ data: batch }));

  await prisma.leagueRecord.createMany({
    data: records.map((r) => ({
      leagueId, scope: r.scope, category: r.category, value: r.value,
      playerId: r.playerId, playerName: r.playerName, teamAbbr: r.teamAbbr, seasonYear: r.seasonYear,
    })),
  });

  // One UPDATE ... FROM (VALUES ...) per chunk rather than 1,200 awaited
  // round trips — same bulk-write pattern lib/season.ts uses for stat rollup.
  //
  // It writes careerStats and nothing else, deliberately. careerStats is the
  // REGULAR-SEASON bucket now, and a seeded career has no box scores behind
  // it, so there is no postseason share to derive — inventing one would be
  // fabricating a split, and careerPlayoffStats stays empty instead. The
  // player card says so out loud on the Playoffs view rather than showing a
  // silently short career. See docs/player-seasons.md §6.
  const careerEntries = [...veteranCareers.entries()].map(([id, c]) => [id, writeJson(c.career)] as [string, string]);
  await chunked(careerEntries, 400, async (batch) => {
    const values = Prisma.join(batch.map(([id, v]) => Prisma.sql`(${id}::text, ${v}::text)`));
    await prisma.$executeRaw`UPDATE "Player" AS p SET "careerStats" = v.val FROM (VALUES ${values}) AS v(id, val) WHERE p.id = v.id`;
  });

  // One PlayerSeason row per generated season — the year, the club, the games
  // and the line the walk in buildVeteranCareers actually produced. Nothing
  // here is derived from the merged total above; the total is derived from
  // these. That is the whole difference between a year-by-year table and a
  // split invented to sum to a number, and it is why lib/playerSeasons.ts's
  // "Before <year>" row is empty for a league created by this code: there is
  // no remainder left for it to carry.
  //
  // The postseason columns stay empty on purpose. A seeded season has no box
  // scores, so it has no derivable postseason half, and inventing one would be
  // fabricating exactly the split the residual rule exists to refuse.
  //
  // `firstSeen` is 0 on every row: it only ever orders the two halves of a
  // season a man was traded in, and a seeded career gives him one club a year.
  // `skipDuplicates` against @@unique([playerId, seasonYear, teamAbbr]) makes a
  // regeneration a no-op rather than a doubling.
  const psRows: {
    leagueId: string; playerId: string; seasonYear: number; teamId: string | null;
    teamAbbr: string; age: number | null; gp: number; firstSeen: number;
    stats: string; playoffStats: string; playoffGp: number;
  }[] = [];
  for (const [playerId, c] of veteranCareers) {
    for (const s of c.seasons) {
      const club = teamById.get(s.teamId);
      if (!club) continue;
      psRows.push({
        leagueId, playerId, seasonYear: s.year, teamId: club.id, teamAbbr: club.abbr,
        // Null rather than a wrong number outside anything a football player
        // can be — the same rule ageInSeason() applies. See lib/playerSeasons.ts.
        age: s.age >= 18 && s.age <= 50 ? s.age : null,
        gp: s.gp, firstSeen: 0,
        stats: writeJson(s.line as SeasonStats), playoffStats: '{}', playoffGp: 0,
      });
    }
  }
  await chunked(psRows, 500, (batch) => prisma.playerSeason.createMany({ data: batch, skipDuplicates: true }));
}

async function chunked<T>(rows: T[], size: number, fn: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

// ---------------------------------------------------------------------------
// Self-check
// ---------------------------------------------------------------------------

/**
 * A generated past that contradicts itself is worse than no past at all, so
 * the generator audits its own output before anything is reported as done.
 * Anything returned here is a genuine bug, not a warning.
 */
function assertHistoryConsistency(args: {
  seasons: SeasonHistory[]; stars: HistPlayer[]; awards: AwardRow[];
  records: RecordRow[]; teams: HistoryTeam[]; seasonLength: number;
}): string[] {
  const problems: string[] = [];
  const { seasons, stars, awards, records, teams, seasonLength } = args;
  const expectedWins = (seasonLength * teams.length) / 2;

  for (const s of seasons) {
    const champs = s.rows.filter((r) => r.playoffResult === 'CHAMPION');
    const runners = s.rows.filter((r) => r.playoffResult === 'RUNNER_UP');
    if (champs.length !== 1) problems.push(`${s.year}: ${champs.length} champions`);
    if (runners.length !== 1) problems.push(`${s.year}: ${runners.length} runners-up`);
    if (champs[0] && champs[0].regWins <= champs[0].regLosses) {
      problems.push(`${s.year}: champion finished ${champs[0].regWins}-${champs[0].regLosses}`);
    }
    const regWins = s.rows.reduce((a, r) => a + r.regWins, 0);
    const ties = s.rows.reduce((a, r) => a + r.ties, 0);
    if (regWins + ties / 2 !== expectedWins) {
      problems.push(`${s.year}: regular-season wins sum to ${regWins} (+${ties} ties), expected ${expectedWins}`);
    }
    for (const r of s.rows) {
      if (r.regWins + r.regLosses + r.ties !== seasonLength) {
        problems.push(`${s.year}: a club played ${r.regWins + r.regLosses + r.ties} games`);
      }
      if (r.playoffResult === 'MISSED' && r.seed != null) problems.push(`${s.year}: seeded club marked MISSED`);
      if (r.playoffResult !== 'MISSED' && r.seed == null) problems.push(`${s.year}: unseeded club with a playoff result`);
    }
    const perAward = new Map<string, number>();
    for (const a of awards.filter((a) => a.year === s.year)) {
      perAward.set(a.type, (perAward.get(a.type) ?? 0) + 1);
    }
    for (const [type, count] of perAward) if (count > 1) problems.push(`${s.year}: ${count}x ${type}`);
  }

  const knownNames = new Set(stars.map(name));
  for (const r of records) {
    if (!knownNames.has(r.playerName)) problems.push(`record holder ${r.playerName} is not in the generated history`);
    const holder = stars.find((p) => name(p) === r.playerName);
    if (holder && DEFENSIVE_POSITIONS.has(holder.position) !== ['tackles', 'sacks', 'defInt'].includes(r.category)) {
      problems.push(`${r.playerName} (${holder.position}) holds the ${r.category} record`);
    }
    if (r.scope === 'SEASON' && holder && !holder.seasons.some((s) => s.year === r.seasonYear && (s.line[r.category] ?? 0) === r.value)) {
      problems.push(`${r.playerName}'s ${r.category} record season is not in his own history`);
    }
  }
  const awardNames = new Set(awards.map((a) => a.name));
  for (const r of records) {
    if (!awardNames.has(r.playerName) && !stars.find((p) => name(p) === r.playerName)?.living) {
      problems.push(`${r.playerName} holds a record but appears nowhere in the award history`);
    }
  }
  return problems;
}
