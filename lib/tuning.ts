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
  /**
   * [TUNE] Share of a draft class that actually sticks on the roster, used to
   * decide how many slots the AI free-agency wave holds back for rookies.
   *
   * This is not cosmetic. Reserving the FULL class (7 of 53) leaves an
   * effective free-agency ceiling of exactly 46 — which is ROSTER_MIN — so
   * every team at or above the legal minimum skipped free agency entirely
   * and the market shut down league-wide the moment roster sizes recovered.
   * Half a class is the realistic figure and leaves genuine headroom.
   */
  ROOKIE_ROSTER_HIT_RATE: 0.5,
  PRACTICE_SQUAD: 0, // not modeled in v1
  DRAFT_ROUNDS: 7,
};

/**
 * The roster floor for a league whose ceiling the user has moved. ROSTER_MIN
 * is calibrated against ROSTER_MAX (46 of 53), so a league configured with a
 * 40-man limit must not be told its minimum is 46 — every keep-or-cut site
 * would then read "short of the minimum" permanently. Scales the same ratio
 * and never exceeds the ceiling itself.
 */
export function rosterMinFor(rosterMax: number): number {
  const scaled = Math.round((rosterMax * LEAGUE.ROSTER_MIN) / LEAGUE.ROSTER_MAX);
  return Math.max(1, Math.min(LEAGUE.ROSTER_MIN, Math.min(rosterMax, scaled)));
}

/**
 * [TUNE] What happens to a player NOBODY signs, and how far a team will go to
 * sign one.
 *
 * The free-agent pool used to be a permanent sink: `progressAllPlayers` only
 * touched `status: 'ACTIVE'`, so an unsigned player never aged, never
 * developed and never retired, while ~400 new prospects entered every draft.
 * Measured over 14 simulated seasons the pool grew 140 -> 4,740 and held 798
 * unsigned players rated 80+ (201 of them 90+, five of them 97 OVR) in a
 * 32-team league. Two things fix that, and both live here: unsigned players
 * now age out of football on their own, and a team at a full roster signs a
 * clear upgrade and releases the man he beats instead of declining to look.
 */
export const FREE_AGENCY = {
  /**
   * Share of a full year's development roll an unsigned player gets. He is
   * still training, but he has no coaching staff, no scheme, and played no
   * snaps — half a year's growth, applied in one offseason roll (a rostered
   * player earns his in weekly in-season checkpoints instead; see
   * lib/development.ts).
   */
  UNSIGNED_PROGRESSION_SCALE: 0.5,
  /**
   * Chance a player who spent a whole league year unsigned is simply out of
   * football, before the quality shield below is applied. This is the real
   * outflow that stops the pool growing without bound: ordinary retirement
   * alone can't, since it doesn't start until 32 and most of the annual
   * inflow is 22-year-old undrafted rookies.
   */
  UNSIGNED_ATTRITION_BASE: 0.42,
  /** Each FURTHER year on the street adds this much on top of the base. */
  UNSIGNED_ATTRITION_PER_YEAR: 0.18,
  /**
   * A player good enough that somebody always calls is shielded: attrition
   * scales linearly to zero as he approaches the shield, and applies at full
   * strength at or below the floor.
   *
   * Both are stated RELATIVE TO THE LEAGUE'S OWN MEAN ACTIVE RATING, not as
   * absolute numbers, and that is not a stylistic choice. Fixed at 78/55 (the
   * first thing tried here) the shield stopped meaning "star" the moment
   * league-wide ratings drifted: by season 13 of a measured run the mean
   * rostered player was 80, so every unsigned player worth anything was above
   * the shield, permanently immune to attrition, and the pool accumulated 459
   * unsigned players rated 80+ — the exact symptom the attrition roll exists
   * to prevent. Same lesson as FREE_AGENCY.MIN_UPGRADE_DELTA's structural
   * displacement test: a threshold on a drifting scale is not a threshold.
   */
  UNSIGNED_ATTRITION_SHIELD_ABOVE_MEAN: 8,
  UNSIGNED_ATTRITION_FLOOR_BELOW_MEAN: 10,
  /** Nobody is ever rolled out of football at higher odds than this. */
  UNSIGNED_ATTRITION_MAX: 0.85,

  /**
   * UPGRADE-AND-DISPLACE. A front office at a full roster does not stop
   * reading the wire — it signs the better player and releases the worst man
   * at that position. These guard it from churning for nothing:
   *   MIN_UPGRADE_DELTA — true-rating points the free agent must beat the
   *     displaced player by before the move is worth a transaction at all.
   *   MAX_DISPLACE_PER_TEAM_PER_WAVE — how many displacements one team may
   *     make in a single wave, so a roster can't be rebuilt in one click.
   * WHO may be displaced is a structural test rather than a rating threshold:
   * only the worst man at the position, and only while that position still
   * carries more bodies than ROSTER_TARGETS asks for. An absolute "never
   * displace anyone rated above 74" cap was tried here first and it quietly
   * stopped working as soon as league-wide ratings moved — every roster spot
   * sat above the line, so no upgrade was ever legal.
   */
  MIN_UPGRADE_DELTA: 5,
  MAX_DISPLACE_PER_TEAM_PER_WAVE: 2,
  /**
   * How deep into the free-agent board an AI wave looks. The old value (60)
   * is fine while the pool is small; once it holds thousands of players the
   * top-60 slice is all 80+ stars nobody has room for and no team ever signs
   * the ordinary depth it actually needs.
   */
  WAVE_BOARD_SIZE: 140,
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

/**
 * How much a mediocre starter at this position should register as a
 * roster "need" — separate from whether the position is filled at all.
 * A below-average kicker, punter, or fullback is real but nowhere near
 * as urgent as a below-average corner or tackle, since these positions
 * touch the game far less and are trivially replaceable off the street.
 * Missing [TUNE] entries default to full weight (1).
 */
export const ROSTER_NEED_QUALITY_WEIGHT: Partial<Record<Position, number>> = {
  K: 0.25, P: 0.25, FB: 0.25,
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
  /**
   * [TUNE] Rookies have more room than a veteran of the same rating.
   *
   * Deliberately left at 14 after being measured as a suspect in league-wide
   * rating inflation and cleared. Dropping it to 6 pulled mean ACTIVE
   * POTENTIAL down hard (87.7 -> 84.1 by season 9) and moved mean ACTIVE
   * RATING by 0.2 (78.6 -> 78.4) — players just sat closer to a lower ceiling
   * (share of the league at or above its own potential went 7% -> 20%).
   * Ratings are pinned by AGE_CURVE and by where the draft class is generated,
   * not by the ceiling; see the note on AGE_CURVE. Lowering this would have
   * been a real nerf to draft upside bought with nothing.
   */
  ROOKIE_POTENTIAL_BONUS_MEAN: 14,
  ROOKIE_POTENTIAL_BONUS_SD: 9,
  AGE_MIN: 21,
  AGE_MAX: 36,
  ROOKIE_AGE_MEAN: 22,
  /** Chance a generated pro has each dev trait. Must sum to 1. */
  DEV_TRAIT_WEIGHTS: { Slow: 0.25, Normal: 0.55, Star: 0.15, Superstar: 0.05 },
  /** Attribute noise around the position-implied value. */
  ATTR_SD: 7,
  DRAFT_CLASS_SIZE: 224, // 7 rounds x 32 — exactly the number of picks
  /** Extra prospects generated beyond the pick count, so a real share of the class goes undrafted into UDFA free agency instead of every prospect getting picked. */
  DRAFT_CLASS_EXTRA_UDFA: 176,
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

/**
 * [TUNE] Position-aware aging. Real careers don't all bend the same way:
 * backs and defensive backs lean on speed/burst, peak earliest, and fall off
 * a cliff; quarterbacks, offensive line, and specialists lean on technique
 * and lean bodies that hold up, so they both develop and decline later and
 * slower. `peakShift` moves a position along the shared AGE_CURVE (positive
 * = ages like someone younger; negative = ages like someone older);
 * `declineMult` then scales only the back (negative) half of the curve, so
 * this never changes how fast a young player develops — only how hard the
 * downslope bites once it starts. Missing positions get no adjustment.
 */
export const POSITION_AGE_PROFILE: Partial<Record<Position, { peakShift: number; declineMult: number }>> = {
  RB: { peakShift: -2, declineMult: 1.35 },
  WR: { peakShift: -1, declineMult: 1.15 },
  CB: { peakShift: -1, declineMult: 1.15 },
  S:  { peakShift: -1, declineMult: 1.1 },
  QB: { peakShift: 3, declineMult: 0.6 },
  LT: { peakShift: 2, declineMult: 0.75 },
  LG: { peakShift: 2, declineMult: 0.75 },
  C:  { peakShift: 2, declineMult: 0.75 },
  RG: { peakShift: 2, declineMult: 0.75 },
  RT: { peakShift: 2, declineMult: 0.75 },
  K:  { peakShift: 4, declineMult: 0.5 },
  P:  { peakShift: 4, declineMult: 0.5 },
};
export const DEFAULT_AGE_PROFILE = { peakShift: 0, declineMult: 1 };

/**
 * [TUNE] In-season player development. Growth used to land in one lump at
 * the offseason PROGRESS step — realistic for a "career" but invisible on a
 * week-to-week basis. Instead, the same total growth a player would've
 * gotten in one offseason roll is now spread across checkpoints during the
 * season itself, so improvement (and decline) is something you can actually
 * watch happen a few games at a time.
 */
export const PROGRESSION = {
  /** Run a development checkpoint every N regular-season weeks. */
  CHECKPOINT_INTERVAL: 4,
  /** Share of a full year's growth applied per checkpoint (4 checkpoints/season ≈ one full year, same total as the old single roll). */
  CHECKPOINT_GROWTH_SHARE: 0.25,
  /** Growth multiplier for a player pacing the top of his position group in production since the last checkpoint. */
  BREAKOUT_GROWTH_MULT: 1.6,
  /** Growth multiplier for an established starter (trueOvr 65+) producing at the bottom of his position group. */
  SLUMP_GROWTH_MULT: 0.6,
  /** OVR bump (spread across attributes) for leading the league in a major stat category at a checkpoint. */
  STAT_LEADER_OVR_BUMP: 1,
  /** Potential-ceiling bump for the same. */
  STAT_LEADER_POTENTIAL_BUMP: 1,
  /** OVR + potential bump for winning a season award (MVP/OPOY/DPOY/ROTY/Super Bowl MVP). */
  AWARD_OVR_BUMP: 3,
  AWARD_POTENTIAL_BUMP: 2,
  /** Growth multiplier at a checkpoint for a player carrying a Development Focus charge (see SCOUT_TIERS.DEVELOP). One charge is consumed per checkpoint. */
  DEV_FOCUS_GROWTH_MULT: 1.5,
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
  /**
   * [TUNE] Years of NFL experience that still counts as "on a rookie deal".
   * League generation uses it to put every young player on a real
   * ROOKIE_DEAL_YEARS contract — it used to flag isRookieDeal on a coin flip
   * without ever granting the length, so ROOKIE_DEAL_YEARS was never applied
   * at generation and young players contributed no long contracts at all.
   */
  ROOKIE_EXPERIENCE_MAX: 3,
  /**
   * [TUNE] The OFFSEASON week whose step rolls League.seasonYear forward
   * (RESET_STANDINGS, see OFFSEASON_STEPS in lib/season.ts). Cap charges
   * booked at or before it belong to the NEXT league year — see
   * capChargeYear() in lib/cap.ts. Keep in step with OFFSEASON_STEPS.
   */
  OFFSEASON_YEAR_ROLL_WEEK: 2,
  /** How far a team may exceed the cap before signings are blocked. */
  HARD_CAP_TOLERANCE: 0,
};

/**
 * [TUNE] Contract length ladder — the numbers behind suggestedYears() in
 * lib/cap.ts. Length is what decides how much of a roster reaches free
 * agency each year: expiry rate is 1 / mean contract length, so a league of
 * two-year deals turns half its rosters over annually and no dynasty ever
 * compounds. Calibrated over 32 generated rosters to land at roughly 27%
 * of players (and ~4 nominal starters per team) expiring per season, which
 * is close to the real-NFL rate of 25-27%.
 *
 * Age gates come FIRST and are absolute: a 34-year-old gets one year no
 * matter how good he is, which is what keeps an aging star from being
 * handed a five-year deal the team can never escape.
 */
export const CONTRACT = {
  AGE_ONE_YEAR: 34,     // at/above this age: 1-year deals only
  AGE_TWO_YEAR: 32,
  AGE_THREE_YEAR: 30,
  /** Prime-age stars — the only players who get the maximum term. */
  MAX_DEAL_OVR: 80,
  MAX_DEAL_MAX_AGE: 28,
  MAX_DEAL_YEARS: 5,
  /** Everyone else who is a real roster player. */
  STANDARD_OVR: 60,
  STANDARD_YEARS: 4,
  /** Fringe/camp-body depth — short deals, high churn at the bottom. */
  FRINGE_YEARS: 3,
};

/**
 * [TUNE] The AI's annual keep-or-let-walk pass over its own expiring
 * players — see resignDecisionsForTeam() in lib/season.ts.
 *
 * The old version gated on `trueOvr >= 62 && (trueOvr >= 74 || need > 0.3)`
 * and then rolled a ~55% die. Measured over live saves, the need clause
 * alone rejected 37% of every expiring class outright (need is computed on a
 * roster that still contains the expiring player, so a team about to lose
 * its starting corner reads need[CB] as zero), and only 17% of the class
 * ever reached a price check. Willingness now sets the PRICE and TERM a team
 * offers instead of whether it looks at a player at all.
 */
export const RESIGN = {
  /** Nobody below this rating is worth a contract at any price. */
  FLOOR_OVR: 58,
  /** At/above this rating a player is kept regardless of depth behind him. */
  PREMIUM_OVR: 74,
  /**
   * How much higher the keep bar sits for a fully rebuilding GM than for a
   * fully win-now one. This is what "how hard a team competes" means for a
   * fringe player: it is a philosophy, not a coin flip.
   */
  REBUILD_BAR_SPAN: 8,
  /** A sitting incumbent gets this much benefit of the doubt vs. the next man up. */
  INCUMBENT_EDGE: 2,
  /** Offer = market x (FLOOR + willingness x SPAN), then +/- NOISE. */
  OFFER_FLOOR_MULT: 0.95,
  OFFER_WILLINGNESS_SPAN: 0.22,
  OFFER_NOISE: 0.05,
  /** Willingness above/below these nudges the term one year up/down. */
  LENGTH_BONUS_ABOVE: 0.7,
  LENGTH_PENALTY_BELOW: 0.35,
  /**
   * Cap room held back from the re-sign wave so the team can still bid in
   * free agency and sign its draft class. On top of this, MIN_SALARY is
   * reserved for every roster slot still short of LEAGUE.ROSTER_MIN.
   */
  CAP_RESERVE: 10_000_000,
  /**
   * A player with a year still to run is only extended EARLY if he's this
   * good and the GM is this eager — otherwise the money belongs to the
   * players who would actually walk.
   */
  EARLY_EXTENSION_WILLINGNESS: 0.6,
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
  STEEPNESS: 0.058,
  /**
   * Decay rate BELOW pivot — steeper than STEEPNESS. A single symmetric
   * exponential can't compress the bottom of the roster toward minimum
   * salary without also re-inflating the ceiling: a whole 53-man roster's
   * worth of below-average depth players priced like fringe starters blows
   * through the cap on its own, before a single above-average player is
   * even signed. Below pivot, value falls off faster instead.
   */
  STEEPNESS_LOW: 0.14,
  /**
   * The whole curve's dollar anchor. This is the ONE number that decides
   * whether the salary cap is a real constraint: nothing else in
   * marketValue() references CAP.BASE_CAP or any ceiling at all, so the
   * market and the cap were free to drift apart — and they had. At the
   * previous 9.0M/0.097/0.050 calibration a full 53-man roster priced at
   * market cost ~124% of BASE_CAP, which no team can pay: lib/gen/league.ts
   * hid that at league creation with a one-time uniform haircut to 0.88 of
   * the cap, but every later signing path (the re-sign wave, the free agency
   * frenzy, the user's own offers) pays full market, so rosters could only
   * ever shrink back toward affordability.
   *
   * Recalibrated over 32 generated rosters so a full 53 at market lands near
   * 92% of BASE_CAP: enough that a team can field a legal roster, tight
   * enough that keeping everyone good is a real choice. The steeper
   * STEEPNESS_LOW is what pays for it — bottom-of-roster depth collapses
   * toward the league minimum (a 62 OVR LB now costs ~$1.9M rather than
   * ~$3.4M) while a genuine star's price is nearly unchanged.
   */
  SCALE: 7_000_000,
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
// SCOUTING ECONOMY [FRAGILE — this is the whole scarcity model]
// ---------------------------------------------------------------------------
/**
 * Focus points are the GM's only scarce non-money resource. The numbers below
 * are sized against a 400-prospect draft class and a ~110 focus/week team:
 *
 *   full season of regular-season grants  ~ 1,870
 *   pre-draft allotment (one lump)        ~   700
 *   whole league year, everything counted ~ 3,600
 *
 *   one Area Look on all 400 prospects    =  2,000   (a whole year of breadth)
 *   one Deep Dive on all 400 prospects    = 18,000   (5x a year's budget — impossible on purpose)
 *
 * So breadth is affordable-ish and depth is not: you triage, or you learn
 * nothing about anybody.
 */
export const SCOUT_ECONOMY = {
  /**
   * Per-period grant as a multiple of the team's weekly staff output. The
   * league year is a sequence of periods (one per week in-season, one per
   * offseason step, ONE for the entire pre-draft window).
   */
  PHASE_GRANT_MULT: {
    PRESEASON: 1.0,
    REGULAR: 1.0,
    PLAYOFFS: 0.8,      // scouts are at bowl games, not everywhere
    OFFSEASON: 0.75,
    RESIGN: 0.75,
    FREE_AGENCY: 1.0,   // the FA board needs real work
    DRAFT: 6.0,         // combine + pro days + private visits, all in one lump
    FANTASY_DRAFT: 6.0,
  } as Record<string, number>,

  /**
   * Carry-over cap, as a fraction of the INCOMING period's grant. Unspent
   * focus above this evaporates at replenishment. Banking one partial week to
   * afford a Deep Dive is a real decision; hoarding a season into the draft is
   * not possible.
   */
  CARRY_CAP_FRACTION: 0.5,

  /** Cost of pass N+1 on the same player = base * (1 + REPEAT_COST_STEP * N). */
  REPEAT_COST_STEP: 0.6,
  /** Reveal strength of pass N+1 on the same player = base * REPEAT_REVEAL_DECAY^N. */
  REPEAT_REVEAL_DECAY: 0.82,
  /**
   * Hard ceiling on passes against one player inside one period. Replaces the
   * old "one scout per player per week" lock: two looks a week is a plausible
   * amount of tape, and it stops a whole week's budget vanishing into one guy
   * in a single sitting.
   */
  MAX_PASSES_PER_PERIOD: 2,
  /**
   * Ceiling on the share of a player's attributes that can ever be locked to
   * their true value. Without it, enough Deep Dives collapse the displayed
   * OVR range to a single number — and "you are never fully certain" is the
   * fog-of-war contract this whole system is built on. Potential is protected
   * separately (errorBand's floor keeps it a range at any confidence).
   */
  MAX_LOCKED_FRACTION: 0.6,

  /**
   * Scout-staff contribution to the weekly grant. Each scout is worth
   * STAFF_FLOOR..1.0 by speed, and additional scouts are discounted
   * geometrically so a 5-scout department isn't 2.5x a 2-scout one.
   */
  STAFF_FLOOR: 0.35,
  STAFF_HEADCOUNT_DECAY: 0.72,
  /** grant = budgetPerWeek * (BASE_SHARE + STAFF_SHARE * staffContribution). */
  BASE_SHARE: 0.35,
  STAFF_SHARE: 0.5,
};

/**
 * The four things a GM can buy with focus. `close` is the fraction of the
 * REMAINING uncertainty a pass removes — which is why the fifth look at a
 * player is worth so much less than the first even before repeat decay.
 */
export type ScoutTierKey = 'LOOK' | 'EVAL' | 'DEEP' | 'DEVELOP';

export const SCOUT_TIERS: Record<ScoutTierKey, {
  label: string;
  cost: number;
  /** Fraction of remaining confidence gap closed. */
  close: number;
  /** How many attributes this pass locks to their true value. */
  revealAttrs: number;
  /** Extra fraction of the POTENTIAL gap closed on top of the general read. */
  potentialClose: number;
  /** Can this pass surface the hidden development trait? */
  revealsDev: boolean;
  /** Own-roster only (coaching focus, not scouting). */
  ownRosterOnly: boolean;
  blurb: string;
}> = {
  LOOK: {
    label: 'Area Look', cost: 5, close: 0.22, revealAttrs: 0, potentialClose: 0,
    revealsDev: false, ownRosterOnly: false,
    blurb: 'One regional scout, one game of tape. Narrows the overall range a little.',
  },
  EVAL: {
    label: 'Full Evaluation', cost: 18, close: 0.42, revealAttrs: 2, potentialClose: 0,
    revealsDev: false, ownRosterOnly: false,
    blurb: 'A full cross-check. Narrows the range and locks two attributes to their true value.',
  },
  DEEP: {
    label: 'Deep Dive', cost: 45, close: 0.65, revealAttrs: 3, potentialClose: 0.5,
    revealsDev: true, ownRosterOnly: false,
    blurb: 'Private visit + medical + interviews. Tightens the potential range and can surface his development trait.',
  },
  DEVELOP: {
    label: 'Development Focus', cost: 30, close: 0.35, revealAttrs: 1, potentialClose: 0.25,
    revealsDev: true, ownRosterOnly: true,
    blurb: 'Coaching hours on one of your own. Boosts his next development checkpoint and reads his growth curve.',
  },
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
// Trade/asset value — positional economics [FRAGILE]
// ---------------------------------------------------------------------------
/**
 * playerValueDetailed() (lib/ai/gm.ts) used to price EVERY position off one
 * universal `Math.pow(1.075, ovr - 55)` curve — a 90 OVR punter and a 90 OVR
 * quarterback got literally the same base number, with only the (capped at
 * 1.25x) need multiplier able to move it. That's why an elite punter could
 * trade like a first-round pick: nothing in the formula knew punters exist.
 *
 * The fix is to give each position its own curve, not just a flat
 * multiplier bolted onto one shared curve — "elite at a low-value position"
 * should mean "the best version of a replaceable role," not "as valuable as
 * an elite premium-position player." Five tiers, from real NFL trade-market
 * economics: QB is its own tier (retains value into its 30s, curves up
 * sharply near the top); EDGE/LT/WR/CB are premium non-QB spots that can
 * still fetch true blue-chip value; DT/RT/IOL/TE/S/LB matter but the market
 * doesn't pay a premium-position price for them; RB is real but shallow —
 * even a great one caps out around Day 2 value on the age curve realities
 * of the position; K/P/FB stay compressed near the bottom no matter the
 * rating, because a replacement at those spots is always close by.
 */
export type TradeValueTier = 'QB' | 'PREMIUM' | 'MID' | 'LOW' | 'MINIMAL';

export const TRADE_VALUE_TIER: Record<Position, TradeValueTier> = {
  QB: 'QB',
  EDGE: 'PREMIUM', LT: 'PREMIUM', WR: 'PREMIUM', CB: 'PREMIUM',
  DT: 'MID', RT: 'MID', LG: 'MID', RG: 'MID', C: 'MID', TE: 'MID', S: 'MID', LB: 'MID',
  RB: 'LOW',
  K: 'MINIMAL', P: 'MINIMAL', FB: 'MINIMAL',
};

export const TRADE_VALUE = {
  /**
   * Per-tier curve: value = min(ceiling, (exp(max(0, ovr - replacementLevel)
   * * steepness) - 1) * scale). `replacementLevel` is the OVR where trade
   * surplus starts being counted at all (a below-replacement player is
   * theoretically a zero/negative asset, floored at a small positive number
   * so the math never inverts); `steepness` is how fast surplus compounds
   * into value — this is the part a flat multiplier can't express, since it
   * changes the CURVE's shape, not just its height; `ceiling` is the
   * absolute sanity cap in the same value-point units pickValue() already
   * uses (a mid/late Round 1 pick prices around 400-900 in these units, see
   * pickValue below), so no combination of contract/age/scarcity bonuses can
   * ever push an ordinary punter into premium-pick territory.
   */
  TIER_CURVE: {
    QB: { replacementLevel: 58, steepness: 0.145, scale: 16, ceiling: 3400 },
    PREMIUM: { replacementLevel: 60, steepness: 0.105, scale: 22, ceiling: 2200 },
    MID: { replacementLevel: 62, steepness: 0.082, scale: 9, ceiling: 1100 },
    LOW: { replacementLevel: 64, steepness: 0.072, scale: 28, ceiling: 480 },
    MINIMAL: { replacementLevel: 68, steepness: 0.05, scale: 14, ceiling: 90 },
  } as Record<TradeValueTier, { replacementLevel: number; steepness: number; scale: number; ceiling: number }>,

  /**
   * Age curve per tier — real career arcs differ enormously by position.
   * `declineStart`/`declinePerYear` model the back half; `youthThreshold`/
   * `youthPremiumPerYear` model the age-control premium teams pay for a
   * player who'll still be great years from now. RBs decline earliest and
   * fastest; offensive line and QB retain value longest; K/P barely age at
   * all (leg talent doesn't erode like a 25-year-old's speed does).
   */
  AGE_CURVE: {
    QB: { declineStart: 34, declinePerYear: 0.035, youthThreshold: 26, youthPremiumPerYear: 0.025 },
    PREMIUM: { declineStart: 29, declinePerYear: 0.075, youthThreshold: 25, youthPremiumPerYear: 0.035 },
    MID: { declineStart: 30, declinePerYear: 0.06, youthThreshold: 25, youthPremiumPerYear: 0.03 },
    LOW: { declineStart: 26, declinePerYear: 0.12, youthThreshold: 24, youthPremiumPerYear: 0.05 },
    MINIMAL: { declineStart: 33, declinePerYear: 0.02, youthThreshold: 26, youthPremiumPerYear: 0.012 },
  } as Record<TradeValueTier, { declineStart: number; declinePerYear: number; youthThreshold: number; youthPremiumPerYear: number }>,

  /** Bounds on the final age multiplier — keeps even a very old/young edge case bounded rather than blowing up. */
  AGE_MULT_MIN: 0.2,
  AGE_MULT_MAX: 1.4,

  /**
   * Contract surplus: expectedMarketCost - actualControlledCost, as a
   * fraction of market cost, scaled down by how much control is actually
   * left (an expiring rental's "surplus" doesn't compound across future
   * years the way a multi-year team-friendly deal's does) and by this
   * weight, then clamped to a bounded multiplier. A cheap rookie-scale
   * blue-chipper should be worth meaningfully more than the same player on
   * a market-rate second contract; an expensive, expiring veteran should be
   * worth meaningfully less.
   */
  CONTRACT_SURPLUS_WEIGHT: 0.55,
  CONTRACT_CONTROL_YEARS_FULL: 4, // years of control at which the surplus/discount fraction applies at full strength
  CONTRACT_MULT_MIN: 0.55,
  CONTRACT_MULT_MAX: 1.75,

  /**
   * League scarcity: how thin the league-wide supply of good (75+ OVR)
   * players at this position is relative to one-per-team. Computed once per
   * trade evaluation (not per player/render) and passed in as a plain
   * number map — see leagueScarcity() in lib/ai/gm.ts. Deliberately modest:
   * this nudges value, it can never be the reason a punter prices like a
   * premium asset.
   */
  SCARCITY_MULT_MIN: 0.9,
  SCARCITY_MULT_MAX: 1.15,

  /**
   * Team-need multiplier, replacing the old flat AI.NEED_MULT=1.25 for
   * every position uniformly. Bounded exactly as real front offices behave:
   * a team that's set at a position pays LESS for a redundant asset (not
   * just "no bonus," an actual discount), and even desperate need has a
   * hard ceiling — "we have no punter" is never a reason to pay a
   * first-round price for one.
   */
  NEED_MULT_MIN: 0.72, // no need / already deep
  NEED_MULT_MAX: 1.28, // maximum, even at severe need
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
