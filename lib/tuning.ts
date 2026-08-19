/**
 * ===========================================================================
 * TUNING TABLE — EVERY BALANCE NUMBER IN THE GAME LIVES HERE
 * ===========================================================================
 * The design doc marks a lot of this "tunable". Every constant below is a
 * PLACEHOLDER chosen to produce plausible football-shaped output, not a
 * balanced final value. Change numbers here rather than in the systems that
 * consume them — nothing else in the codebase should hardcode a balance value.
 *
 * Each block is tagged with how sensitive it is:
 *   [SAFE]   — cosmetic / low blast radius
 *   [TUNE]   — expect to iterate on this during playtesting
 *   [FRAGILE]— changing this shifts scoring or economy league-wide
 * ===========================================================================
 */

// ---------------------------------------------------------------------------
// League shape
// ---------------------------------------------------------------------------
export const LEAGUE = {
  TEAM_COUNT: 32,
  CONFERENCES: ['AFC', 'NFC'] as const,
  DIVISIONS: ['East', 'North', 'South', 'West'] as const,
  REGULAR_SEASON_WEEKS: 17, // [TUNE] 17 games, no bye weeks (keeps scheduling simple)
  PLAYOFF_TEAMS_PER_CONF: 6, // [TUNE] 6 => 2 byes per conference
  ROSTER_MAX: 53,
  ROSTER_MIN: 46, // below this the AI/user is nudged to sign bodies
  PRACTICE_SQUAD: 0, // not modeled in v1
  DRAFT_ROUNDS: 7,
};

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------
export const POSITIONS = [
  'QB', 'RB', 'FB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT',
  'EDGE', 'DT', 'LB', 'CB', 'S', 'K', 'P',
] as const;
export type Position = (typeof POSITIONS)[number];

export const POSITION_GROUP: Record<Position, 'OL' | 'SKILL' | 'FRONT7' | 'SECONDARY' | 'SPEC'> = {
  QB: 'SKILL', RB: 'SKILL', FB: 'SKILL', WR: 'SKILL', TE: 'SKILL',
  LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL',
  EDGE: 'FRONT7', DT: 'FRONT7', LB: 'FRONT7',
  CB: 'SECONDARY', S: 'SECONDARY',
  K: 'SPEC', P: 'SPEC',
};

/** [TUNE] Target roster construction — how many of each position a 53 holds. */
export const ROSTER_TARGETS: Record<Position, { min: number; ideal: number; max: number }> = {
  QB:   { min: 2, ideal: 3, max: 3 },
  RB:   { min: 3, ideal: 4, max: 5 },
  FB:   { min: 0, ideal: 1, max: 1 },
  WR:   { min: 5, ideal: 6, max: 7 },
  TE:   { min: 2, ideal: 3, max: 4 },
  LT:   { min: 1, ideal: 2, max: 2 },
  LG:   { min: 1, ideal: 2, max: 2 },
  C:    { min: 1, ideal: 2, max: 2 },
  RG:   { min: 1, ideal: 2, max: 2 },
  RT:   { min: 1, ideal: 2, max: 2 },
  EDGE: { min: 3, ideal: 4, max: 5 },
  DT:   { min: 3, ideal: 4, max: 5 },
  LB:   { min: 3, ideal: 5, max: 6 },
  CB:   { min: 4, ideal: 5, max: 6 },
  S:    { min: 3, ideal: 4, max: 5 },
  K:    { min: 1, ideal: 1, max: 1 },
  P:    { min: 1, ideal: 1, max: 1 },
};

// ---------------------------------------------------------------------------
// Player generation [TUNE]
// ---------------------------------------------------------------------------
export const GENERATION = {
  /**
   * Mean/stdev of a generated pro player's overall, before position curves.
   * Calibrated so <65 reads as "poor," 65-80 as "average" (the bulk of a
   * pro roster), 80-90 as "good," 90-98 as "amazing," and 99 as essentially
   * never — roughly a Madden-style ratings spread rather than a bell curve
   * centered on mediocrity. [TUNE]
   */
  VETERAN_OVR_MEAN: 72,
  VETERAN_OVR_SD: 8,
  /** Rookie class skews lower and much wider — that's the point of scouting. */
  ROOKIE_OVR_MEAN: 65,
  ROOKIE_OVR_SD: 10,
  /** Potential is overall + this roll, capped at 99. */
  POTENTIAL_BONUS_MEAN: 8,
  POTENTIAL_BONUS_SD: 7,
  ROOKIE_POTENTIAL_BONUS_MEAN: 14, // rookies have more room
  ROOKIE_POTENTIAL_BONUS_SD: 9,
  AGE_MIN: 21,
  AGE_MAX: 36,
  ROOKIE_AGE_MEAN: 22,
  /** Chance a generated pro has each dev trait. Must sum to 1. */
  DEV_TRAIT_WEIGHTS: { Slow: 0.25, Normal: 0.55, Star: 0.15, Superstar: 0.05 },
  /** Attribute noise around the position-implied value. */
  ATTR_SD: 7,
  DRAFT_CLASS_SIZE: 224, // 7 rounds x 32, plus UDFA overflow handled separately
  DRAFT_CLASS_EXTRA_UDFA: 60,
};

/** [TUNE] Age curve: multiplier applied to progression roll by age bracket. */
export const AGE_CURVE: { maxAge: number; growth: number }[] = [
  { maxAge: 23, growth: 3.2 },
  { maxAge: 25, growth: 2.0 },
  { maxAge: 27, growth: 0.9 },
  { maxAge: 29, growth: 0.0 },
  { maxAge: 31, growth: -1.6 },
  { maxAge: 33, growth: -3.0 },
  { maxAge: 99, growth: -5.0 },
];

export const DEV_TRAIT_MULT: Record<string, number> = {
  Slow: 0.6, Normal: 1.0, Star: 1.5, Superstar: 2.1, // [TUNE]
};

// ---------------------------------------------------------------------------
// Sim engine [FRAGILE]
// ---------------------------------------------------------------------------
export const SIM = {
  /** Unit scores are normalized around this. A 50-rated unit scores 0 edge. */
  UNIT_BASELINE: 60,
  /** Points per full drive at league-average offense vs league-average defense. */
  BASE_POINTS_PER_DRIVE: 1.85,
  /** Drives per team per game. Real NFL ~11. */
  DRIVES_PER_TEAM: 11,
  /** How much a 1-point unit-rating edge moves expected points per drive. */
  RATING_TO_PPD: 0.028,
  /** Home field advantage, added to the home offense's unit score. */
  HOME_FIELD_EDGE: 2.0,
  /** Per-drive gaussian noise on drive value — the main source of upsets. */
  DRIVE_NOISE_SD: 1.15,
  /** Game-level "one team just had it today" roll applied to both units. */
  GAME_FORM_SD: 2.4,
  /** Share of drives that end in points at a neutral matchup. */
  SCORING_DRIVE_BASE: 0.38,
  /** Of scoring drives, share that are TDs (rest are FGs) at neutral. */
  TD_SHARE_BASE: 0.55,
  /** Unit-rating edge -> scoring-drive probability, per rating point. */
  EDGE_TO_SCORE_PROB: 0.012,
  /** Unit-rating edge -> TD share, per rating point. */
  EDGE_TO_TD_SHARE: 0.008,
  /** Turnover rate per drive at neutral; modulated by QB/skill vs defense. */
  TURNOVER_RATE_BASE: 0.11,
  /** Unit-score points granted per 10 points of coordinator skill above 50. */
  COORD_WEIGHT: 0.6,
  /** Scheme fit bonus applied to unit score when roster matches scheme. */
  SCHEME_FIT_MAX: 2.5,
  /** Fatigue accrued per game; reduces effective rating next week if unrested. */
  FATIGUE_PER_GAME: 18,
  FATIGUE_RECOVERY: 22,
  /** Baseline weekly injury probability per player. */
  INJURY_RATE_PER_GAME: 0.032,
  INJURY_WEEKS_MEAN: 2.6,
  /** Overtime: if tied after regulation, a single sudden-value drive-off. */
  OVERTIME_TIE_CHANCE: 0.06,
};

/** [FRAGILE] How much each positional unit contributes to team offense score. */
export const OFFENSE_UNIT_WEIGHTS: Partial<Record<Position, number>> = {
  QB: 0.34, RB: 0.07, FB: 0.01, WR: 0.17, TE: 0.07,
  LT: 0.07, LG: 0.055, C: 0.055, RG: 0.055, RT: 0.065,
};

/** [FRAGILE] Defensive unit weights. */
export const DEFENSE_UNIT_WEIGHTS: Partial<Record<Position, number>> = {
  EDGE: 0.26, DT: 0.16, LB: 0.16, CB: 0.27, S: 0.15,
};

/** How many players at each position feed the unit rating, and their weights. */
export const UNIT_DEPTH_WEIGHTS: Partial<Record<Position, number[]>> = {
  QB: [1.0],
  RB: [0.62, 0.28, 0.10],
  FB: [1.0],
  WR: [0.42, 0.31, 0.19, 0.08],
  TE: [0.7, 0.3],
  LT: [1.0], LG: [1.0], C: [1.0], RG: [1.0], RT: [1.0],
  EDGE: [0.38, 0.32, 0.18, 0.12],
  DT: [0.4, 0.33, 0.17, 0.10],
  LB: [0.45, 0.33, 0.22],
  CB: [0.4, 0.32, 0.19, 0.09],
  S: [0.55, 0.35, 0.10],
  K: [1.0], P: [1.0],
};

// ---------------------------------------------------------------------------
// Salary cap [FRAGILE]
// ---------------------------------------------------------------------------
export const CAP = {
  BASE_CAP: 255_000_000,
  CAP_GROWTH_PER_YEAR: 0.07, // [TUNE] 7% annual bump
  MIN_SALARY: 1_000_000,
  MAX_PRORATION_YEARS: 5,
  /** Simplified mode: flat annual number, no bonus proration, no dead money. */
  SIMPLIFIED_DEAD_MONEY_PCT: 0.0,
  /** Realistic mode: cutting a player accelerates all remaining proration. */
  REALISTIC_POST_JUNE_SPLIT: true,
  FRANCHISE_TAG_TOP_N: 5, // tag = avg of top-5 salaries at the position
  ROOKIE_SCALE_R1_PICK1: 9_500_000,   // total APY at pick 1.1 [TUNE]
  ROOKIE_SCALE_R7_LAST: 1_050_000,    // APY at the last pick
  ROOKIE_DEAL_YEARS: 4,
  /** How far a team may exceed the cap before signings are blocked. */
  HARD_CAP_TOLERANCE: 0,
};

/** [TUNE] Market value curve: $ APY a player of a given overall commands. */
export const MARKET = {
  /**
   * value = exp((ovr - PIVOT) * STEEPNESS) * SCALE, floored at MIN_SALARY.
   * Anchored so a neutral-position player at PIVOT (the new average OVR,
   * see GENERATION.VETERAN_OVR_MEAN) earns roughly market-rate-starter
   * money, and even a 99 OVR neutral-position unicorn tops out well short
   * of ten figures. [FRAGILE PLACEHOLDER] — previous values here produced
   * a $101M/yr CB at merely "good" tier; this curve is much gentler.
   */
  PIVOT: 70,
  /** Growth rate ABOVE pivot — kept gentle so stars stay bounded. */
  STEEPNESS: 0.05,
  /**
   * Decay rate BELOW pivot — steeper than STEEPNESS. A single symmetric
   * exponential can't compress the bottom of the roster toward minimum
   * salary without also re-inflating the ceiling: a whole 53-man roster's
   * worth of below-average depth players priced like fringe starters blows
   * through the cap on its own, before a single above-average player is
   * even signed. Below pivot, value falls off faster instead.
   */
  STEEPNESS_LOW: 0.097,
  SCALE: 9_000_000,
  /** Positional value multipliers — the premium-position tax. */
  POSITION_MULT: {
    QB: 1.85, RB: 0.62, FB: 0.35, WR: 1.15, TE: 0.85,
    LT: 1.30, LG: 0.80, C: 0.85, RG: 0.80, RT: 1.05,
    EDGE: 1.45, DT: 1.05, LB: 0.82, CB: 1.25, S: 0.85,
    K: 0.30, P: 0.25,
  } as Record<Position, number>,
  /** Age discount applied per year past this age. */
  AGE_DISCOUNT_START: 28,
  AGE_DISCOUNT_PER_YEAR: 0.07,
  /** Young-and-ascending premium per year under 26. */
  YOUTH_PREMIUM_PER_YEAR: 0.03,
  /** Free agency bid noise — each AI team values a player slightly differently. */
  AI_VALUATION_SD: 0.10,
};

// ---------------------------------------------------------------------------
// Scouting [TUNE]
// ---------------------------------------------------------------------------
export const SCOUTING = {
  /** Displayed range half-width at 0 confidence, in rating points. */
  MAX_ERROR: 16,
  /** Half-width at 100 confidence. Never 0 — you're never fully certain. */
  MIN_ERROR: 2,
  /** Observation noise: sd of the observed value around truth at 0 confidence. */
  OBSERVE_SD_MAX: 11,
  OBSERVE_SD_MIN: 1.5,
  /** Weekly scouting points a team generates, before scout speed. */
  BASE_POINTS_PER_WEEK: 100,
  /** Confidence gained per point spent on one player. */
  CONFIDENCE_PER_POINT: 0.45,
  /** Scout accuracy at/above this reduces error by SPECIALTY_BONUS. */
  SPECIALTY_BONUS: 0.25,
  /** Confidence a team starts with on its OWN roster (you know your guys). */
  OWN_ROSTER_CONFIDENCE: 92,
  /** Confidence on other teams' veterans — tape exists, they've played. */
  LEAGUE_VETERAN_CONFIDENCE: 74,
  /** Confidence on an unscouted rookie. */
  ROOKIE_BASE_CONFIDENCE: 8,
  /** Confidence decay per offseason on players you stop watching. */
  DECAY_PER_SEASON: 0,
  /** How hard potential specifically is to project — higher than any single physical attribute, since it's a projection of a whole career, not a measurement. */
  POTENTIAL_DIFFICULTY: 0.95,
  /** Unscouted default center for potential — a blurred league-average read, same idea as the 62 default used for individual attributes. */
  POTENTIAL_DEFAULT_CENTER: 75,
};

// ---------------------------------------------------------------------------
// AI GM behavior [TUNE]
// ---------------------------------------------------------------------------
export const AI = {
  /** Willingness to overpay in FA, as a multiplier on computed market value. */
  FA_MAX_OVERPAY: 1.22,
  /** AI keeps this much cap space in reserve for in-season moves. */
  CAP_RESERVE: 4_000_000,
  /** Trade acceptance: AI accepts if incoming value >= outgoing * this. */
  TRADE_ACCEPT_RATIO: 1.06,
  /** Range within which the AI counters rather than flatly refusing. */
  TRADE_COUNTER_WINDOW: 0.25,
  /** How much AI values a draft pick vs a player of equal chart value. */
  PICK_VALUE_BIAS: 1.0,
  /** Need multiplier: value of a player at a position of need. */
  NEED_MULT: 1.25,
  /** Rebuilding teams weight youth/potential this much more. */
  REBUILD_POTENTIAL_WEIGHT: 0.55,
  CONTENDER_POTENTIAL_WEIGHT: 0.18,
  /** Chance the AI reaches (drafts off-board) on a given pick — adds variance. */
  DRAFT_REACH_CHANCE: 0.18,
  DRAFT_REACH_DEPTH: 6, // picks from the top of its board it may reach into
  /**
   * Positional premium for draft value specifically — separate from trade/FA
   * value, which is about what a team pays for a KNOWN quantity. The draft
   * is about betting on unknowns, and real front offices bet much bigger on
   * premium positions (QB, the pass rush, the left tackle's blindside, the
   * corners who have to man up against WR1) than on a punter, no matter how
   * good that punter's ceiling looks on paper. [TUNE]
   */
  DRAFT_POSITION_VALUE: {
    QB: 1.5, EDGE: 1.25, LT: 1.2, WR: 1.15, CB: 1.15,
    DT: 1.05, S: 1.0, LB: 1.0, TE: 1.0, RB: 0.9,
    RT: 0.9, RG: 0.85, LG: 0.85, C: 0.8, FB: 0.55,
    K: 0.35, P: 0.3,
  } as Record<Position, number>,
};

/** [TUNE] Jimmy Johnson-style draft pick value chart, by overall pick number. */
export const PICK_VALUE_CHART = (overallPick: number): number => {
  // Smooth exponential approximation of the classic chart. PLACEHOLDER curve.
  return Math.round(3000 * Math.exp(-0.0255 * (overallPick - 1)));
};

// ---------------------------------------------------------------------------
// Schemes [SAFE]
// ---------------------------------------------------------------------------
export const OFF_SCHEMES = ['Balanced', 'Air Raid', 'West Coast', 'Power Run', 'Spread Option'] as const;
export const DEF_SCHEMES = ['4-3 Base', '3-4 Base', 'Nickel Heavy', 'Cover 3 Zone', 'Man Press'] as const;

/** Which attributes a scheme leans on. Fit bonus scales with roster match. */
export const SCHEME_EMPHASIS: Record<string, { pos: Position; attr: string }[]> = {
  'Air Raid':      [{ pos: 'QB', attr: 'armStrength' }, { pos: 'WR', attr: 'speed' }, { pos: 'WR', attr: 'route' }],
  'West Coast':    [{ pos: 'QB', attr: 'accuracy' }, { pos: 'TE', attr: 'catching' }, { pos: 'RB', attr: 'catching' }],
  'Power Run':     [{ pos: 'RB', attr: 'power' }, { pos: 'LG', attr: 'runBlock' }, { pos: 'RG', attr: 'runBlock' }],
  'Spread Option': [{ pos: 'QB', attr: 'speed' }, { pos: 'RB', attr: 'elusiveness' }, { pos: 'WR', attr: 'speed' }],
  'Balanced':      [],
  '4-3 Base':      [{ pos: 'EDGE', attr: 'passRush' }, { pos: 'LB', attr: 'tackling' }],
  '3-4 Base':      [{ pos: 'DT', attr: 'strength' }, { pos: 'LB', attr: 'passRush' }],
  'Nickel Heavy':  [{ pos: 'CB', attr: 'coverage' }, { pos: 'S', attr: 'coverage' }],
  'Cover 3 Zone':  [{ pos: 'S', attr: 'awareness' }, { pos: 'CB', attr: 'awareness' }],
  'Man Press':     [{ pos: 'CB', attr: 'press' }, { pos: 'CB', attr: 'speed' }],
};
