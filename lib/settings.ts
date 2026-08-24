import { CapMode, Difficulty, LeagueStart } from './types';
import { CAP } from './tuning';
import { readJson, writeJson } from './json';

/**
 * The full settings surface (design doc section 4). Every option is persisted
 * on the League row and read by the system that owns it. A few are recorded
 * but not yet consumed by a system — those are marked STORED-ONLY and the UI
 * says so rather than pretending they do something.
 */
export interface LeagueSettings {
  // --- Core rules -----------------------------------------------------------
  capMode: CapMode;                 // REALISTIC | SIMPLIFIED | OFF  (section 8)
  difficulty: Difficulty;           // scales AI sharpness + user sim luck
  leagueStart: LeagueStart;         // fantasy draft vs randomized rosters
  seasonLength: number;             // regular season games
  playoffTeamsPerConf: number;
  rosterMax: number;
  draftRounds: number;
  capGrowth: CapGrowth;             // how fast the ceiling climbs (CAP_GROWTH_MODES)

  // --- Fog of war -----------------------------------------------------------
  scoutingEnabled: boolean;         // false => true ratings shown everywhere
  revealTrueRatings: boolean;       // debug/casual toggle, overrides scouting
  fogOnOwnRoster: boolean;          // do you fully know your own players?
  scoutingBudgetPerWeek: number;    // scouting points/week before scout speed

  // --- Progression ----------------------------------------------------------
  progressionSpeed: number;         // multiplier on in-season development rolls
  injuriesEnabled: boolean;
  injurySeverity: number;           // multiplier on injury duration
  retirementEnabled: boolean;

  // --- Transactions ---------------------------------------------------------
  tradesEnabled: boolean;
  aiTradeFrequency: number;         // 0..1, how often AI teams propose trades
  tradeDeadlineEnabled: boolean;    // when on, no trades from tradeDeadlineWeek+1 through the rest of the league year
  tradeDeadlineWeek: number;        // last REGULAR week trades are allowed; default 9 matches the real NFL's Tuesday-after-week-9 deadline
  franchiseTagEnabled: boolean;
  aiAcceptsLopsided: boolean;       // off => AI enforces strict value ratios

  // --- Sim ------------------------------------------------------------------
  simVariance: number;              // multiplier on RNG spread (section 9)
  homeFieldAdvantage: boolean;
  simSeed: string;                  // fixed seed => reproducible seasons

  // --- Presentation ---------------------------------------------------------
  recapVerbosity: 'SHORT' | 'NORMAL' | 'DETAILED';
  showAdvancedStats: boolean;       // STORED-ONLY in v1
  autoAdvanceWeeks: boolean;        // STORED-ONLY in v1
  confirmRiskyMoves: boolean;
}

export const DEFAULT_SETTINGS: LeagueSettings = {
  capMode: 'REALISTIC',
  difficulty: 'NORMAL',
  leagueStart: 'RANDOM_ROSTERS',
  seasonLength: 17,
  playoffTeamsPerConf: 6,
  rosterMax: 53,
  draftRounds: 7,
  capGrowth: 'FLAT',

  scoutingEnabled: true,
  revealTrueRatings: false,
  fogOnOwnRoster: false,
  scoutingBudgetPerWeek: 100,

  progressionSpeed: 1.0,
  injuriesEnabled: true,
  injurySeverity: 1.0,
  retirementEnabled: true,

  tradesEnabled: true,
  aiTradeFrequency: 0.35,
  tradeDeadlineEnabled: true,
  tradeDeadlineWeek: 9,
  franchiseTagEnabled: true,
  aiAcceptsLopsided: false,

  simVariance: 1.0,
  homeFieldAdvantage: true,
  simSeed: '',

  recapVerbosity: 'NORMAL',
  showAdvancedStats: true,
  autoAdvanceWeeks: false,
  confirmRiskyMoves: true,
};

/**
 * ===========================================================================
 * HOW FAST THE CEILING CLIMBS
 * ===========================================================================
 * The cap used to rise 7% every year, unconditionally, and the player who
 * asked for this named the problem exactly: it got out of hand. Compounded
 * over a dynasty that is not a slow drift, it is a different game — 1.07^10
 * is 1.97, so a league in its eleventh season plays under nearly double the
 * ceiling it opened with while every price in `lib/cap.ts` still answers in
 * year-one dollars (marketValue() and askingPrice() take no season at all).
 * The squeeze the whole front office is built around quietly stops binding.
 *
 * So it is a choice made at the table, not a constant. Three rungs, because
 * a raw percentage box asks someone who has never played a season to have an
 * opinion about compounding, and because the interesting difference is not
 * 2% versus 3% — it is whether the ceiling moves AT ALL:
 *
 *   FLAT  the default. A fixed ceiling: nothing inflates away, and a bad
 *         deal is bad forever.
 *   SLOW  a television deal's drift, slow enough to stay survivable.
 *   FAST  the old behaviour, kept so an existing dynasty plays as it did.
 *
 * MEASURED, over 20 league years, against 32 real generated clubs with every
 * man on them priced through marketValue() (scripts/_cg_capgrowth.ts; the
 * median club costs 88% of BASE_CAP, against the ~92% MARKET.SCALE is
 * calibrated to). What that club costs as a share of its own ceiling:
 *
 *          year 1   year 10   year 20   the squeeze is over in
 *   FLAT    87.9%     87.9%     87.9%   never
 *   SLOW    87.9%     76.9%     66.2%   year 10
 *   FAST    87.9%     47.8%     24.3%   year 3
 *
 * "The squeeze is over" is the first league year a club can carry that whole
 * roster at market AND still sign the best quarterback in football (a 99 OVR
 * at 27, $64.0M/yr) — the year keeping everyone good stops being a choice.
 * At the old 7% that is the THIRD season of a dynasty.
 *
 * WHY FLAT IS THE DEFAULT, and why SLOW is 1.5% rather than 2%. Even a slow
 * ceiling ends the squeeze eventually, and a front-office game whose central
 * tension expires on a timer is a game that gets less interesting the longer
 * you play it — exactly backwards for a dynasty. FLAT is the only rung where
 * the decision you make in season one is the same decision in season twenty,
 * so it is what a new league is created on and what a player has to opt OUT
 * of to get inflation. SLOW moved 2% -> 1.5% for the same reason: it pushes
 * the year the tension lapses from 8 to 10, past where most dynasties run.
 *
 * None of this rewrites an existing league. parseSettings pins a save with no
 * capGrowth key to FAST (it was played at 7%), and a save that already chose
 * a rung keeps it — a league that chose SLOW simply drifts at 1.5% from here.
 * ===========================================================================
 */
export type CapGrowth = 'FLAT' | 'SLOW' | 'FAST';

export const CAP_GROWTH_MODES: Record<CapGrowth, {
  /** Compounded per league year since the founding season. */
  rate: number;
  /** Rung name as the player sees it. */
  label: string;
  /**
   * What it means from the GM's chair. Deliberately says no percentage: the
   * screen renders the real `rate` beside it, so the sentence can never come
   * to disagree with the number the game actually uses.
   */
  blurb: string;
}> = {
  FLAT: {
    rate: 0,
    label: 'Flat',
    blurb: 'The ceiling never moves. What a roster costs this year is what it costs in twenty, and no contract you regret ever inflates its way off the books.',
  },
  SLOW: {
    // This rung IS the tuning constant, not a second copy of it, so the
    // fallback curve capForYear() uses when no league is passed and the rung
    // a player picks on the Settings screen cannot drift apart.
    rate: CAP.CAP_GROWTH_PER_YEAR,
    label: 'Slow',
    blurb: 'The ceiling drifts up the way a television deal does — real money across a decade, never enough to bail you out of a deal you should not have signed.',
  },
  FAST: {
    rate: 0.07,
    label: 'Fast',
    blurb: 'A boom league. Money floods in, the ceiling nearly doubles inside a decade, and yesterday\u2019s ruinous contract becomes next year\u2019s bargain.',
  },
};

/**
 * The rate a league is played under. Every ceiling in the game should come
 * from here rather than from CAP.CAP_GROWTH_PER_YEAR directly.
 *
 * Defensive on the way out because settings blobs reach this from three
 * places — parseSettings, a raw JSON.parse in a server action, and an
 * imported league file — and an unrecognised rung must play at the default,
 * not compound at NaN and put every ceiling in the league at NaN with it.
 */
/**
 * A rung's rate the way a screen should print it. `toFixed(0)` was fine while
 * every rung was a whole percent and turned into a lying label the moment
 * SLOW moved to 1.5%: it rendered "2% a year" beside a ceiling the league
 * grows at 1.5%. Rounded to a tenth first, because 0.07 * 100 is
 * 7.000000000000001 in binary floating point and a bare integer check on that
 * prints "7.0%".
 */
export function formatCapGrowthRate(rate: number): string {
  const pct = Math.round(rate * 1000) / 10;
  return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

export function capGrowthRate(s: Pick<LeagueSettings, 'capGrowth'>): number {
  return CAP_GROWTH_MODES[s.capGrowth]?.rate ?? CAP_GROWTH_MODES[DEFAULT_SETTINGS.capGrowth].rate;
}

/**
 * Difficulty used to be a four-rung ladder borrowed from the console games
 * (Rookie / Pro / All-Pro / Legend). It is three rungs now, because four
 * asked a new player to place themselves on a scale before they had any idea
 * what the middle felt like, and the two hardest rungs were separated by
 * less than the noise in a season.
 *
 * Saves created under the old names carry them in their settings JSON, and
 * nothing rewrites that blob on read, so the old value would survive forever
 * and index DIFFICULTY_MODS as undefined — every difficulty knob silently
 * NaN. Map them on the way in instead.
 */
const LEGACY_DIFFICULTY: Record<string, Difficulty> = {
  ROOKIE: 'EASY',
  PRO: 'NORMAL',
  ALL_PRO: 'HARD',
  LEGEND: 'HARD',
};

export function parseSettings(raw: string | null | undefined): LeagueSettings {
  const stored = readJson<Partial<LeagueSettings>>(raw, {});
  const merged = { ...DEFAULT_SETTINGS, ...stored };

  // Same shape of problem as LEGACY_DIFFICULTY, opposite direction: the old
  // blob does not carry a WRONG capGrowth, it carries none at all, and the
  // spread above would hand it the new default. Every save written before
  // this setting existed was played at 7%, and a dynasty five years deep that
  // silently drops onto the 2% curve loses 21% of its ceiling overnight —
  // clubs that were legal on the morning's cap sheet wake up over it, which
  // is a rule the player never broke and never agreed to. An absent key means
  // "created under the old constant", so it is pinned there and the Settings
  // screen offers the move as the player's own decision to make.
  //
  // The pin only reaches a ceiling that was computed through capGrowthRate().
  // The call sites listed in capForYear()'s comment still read the default
  // curve, so until each passes the league's own rate, an old save's cap sheet
  // is drawn on the 2% curve whatever this says. That is one patch, not a
  // second design.
  if (stored.capGrowth === undefined) merged.capGrowth = 'FAST';

  const mapped = LEGACY_DIFFICULTY[merged.difficulty as string];
  if (mapped) merged.difficulty = mapped;
  // A settings blob hand-edited to something unrecognised should play, not
  // crash with NaN modifiers three screens later.
  if (!(merged.difficulty in DIFFICULTY_MODS)) merged.difficulty = DEFAULT_SETTINGS.difficulty;
  if (!(merged.capGrowth in CAP_GROWTH_MODES)) merged.capGrowth = DEFAULT_SETTINGS.capGrowth;
  return merged;
}

export function serializeSettings(s: LeagueSettings): string {
  return writeJson(s);
}

/** Difficulty knobs — how the setting actually bites. [TUNE] */
export const DIFFICULTY_MODS: Record<Difficulty, {
  /** Points added to every AI team's unit scores. */
  aiUnitBonus: number;
  /** Multiplier on how sharply AI GMs value players (1 = perfect). */
  aiSharpness: number;
  /** Extra scouting error the user suffers. */
  userScoutPenalty: number;
}> = {
  // EASY keeps the old Rookie numbers and NORMAL the old Pro numbers, so an
  // existing save plays exactly as it did. HARD sits between the old All-Pro
  // and Legend rather than at either: Legend's 3.0 unit bonus was a bigger
  // edge than the gap between a playoff team and a bad one, which read as
  // unfair rather than hard.
  EASY:   { aiUnitBonus: -1.5, aiSharpness: 0.75, userScoutPenalty: -3 },
  NORMAL: { aiUnitBonus: 0,    aiSharpness: 0.9,  userScoutPenalty: 0 },
  HARD:   { aiUnitBonus: 2.25, aiSharpness: 1.05, userScoutPenalty: 3 },
};
