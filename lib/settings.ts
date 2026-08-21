import { CapMode, Difficulty, LeagueStart } from './types';
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
  const merged = { ...DEFAULT_SETTINGS, ...readJson<Partial<LeagueSettings>>(raw, {}) };
  const mapped = LEGACY_DIFFICULTY[merged.difficulty as string];
  if (mapped) merged.difficulty = mapped;
  // A settings blob hand-edited to something unrecognised should play, not
  // crash with NaN modifiers three screens later.
  if (!(merged.difficulty in DIFFICULTY_MODS)) merged.difficulty = DEFAULT_SETTINGS.difficulty;
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
