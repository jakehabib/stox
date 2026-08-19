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
  progressionSpeed: number;         // multiplier on offseason dev rolls
  injuriesEnabled: boolean;
  injurySeverity: number;           // multiplier on injury duration
  retirementEnabled: boolean;

  // --- Transactions ---------------------------------------------------------
  tradesEnabled: boolean;
  aiTradeFrequency: number;         // 0..1, how often AI teams propose trades
  tradeDeadlineWeek: number;
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
  difficulty: 'PRO',
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

export function parseSettings(raw: string | null | undefined): LeagueSettings {
  return { ...DEFAULT_SETTINGS, ...readJson<Partial<LeagueSettings>>(raw, {}) };
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
  ROOKIE:  { aiUnitBonus: -1.5, aiSharpness: 0.75, userScoutPenalty: -3 },
  PRO:     { aiUnitBonus: 0,    aiSharpness: 0.9,  userScoutPenalty: 0 },
  ALL_PRO: { aiUnitBonus: 1.5,  aiSharpness: 1.0,  userScoutPenalty: 2 },
  LEGEND:  { aiUnitBonus: 3.0,  aiSharpness: 1.1,  userScoutPenalty: 4 },
};
