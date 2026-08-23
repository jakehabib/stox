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

// Type-only: erased at compile time, so this cannot create a runtime cycle
// with lib/gen/prospectProfile.ts (which imports Position from here).
import type { CompetitionGrade } from './gen/prospectProfile';

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
   * [TUNE] Weeks of open bidding before the draft goes on the clock. One AI
   * wave runs per week (runAiFreeAgencyWave), and the FREE_AGENCY case in
   * lib/season.ts starts the draft once the next week would exceed this.
   *
   * FOUR BECAME THREE with the offseason collapse. The app owner: *"then free
   * agency itself is only 3 advances from 4"*. The fourth wave was picking
   * over what three had already refused: driven twice from the same saved
   * league, four waves and three waves signed the SAME 23 of the top 25
   * unsigned players and the SAME 38 of the top 40, and differed only at the
   * bottom of the top 60 — 57 of 60 against 55 of 60, with the best man left
   * unsigned an 88 either way. Two extra fringe signings is what the press was
   * buying, and both of those men remain signable all season (see IN_SEASON
   * below). If a shorter window ever does strand somebody real, the fix is the
   * wave's board size and per-team allowance, not a fourth press.
   */
  WEEKS: 3,
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

  /**
   * ---------------------------------------------------------------------
   * THE FLOOR UNDER THE MARKET
   * ---------------------------------------------------------------------
   * The unsigned pool is topped up to this many players at league creation
   * and again at the top of every offseason's free agency, with the fringe
   * population described at GENERATION.FRINGE_OVR_MEAN. It is a FLOOR, not a
   * target: from the second offseason on the league's own expiring contracts
   * and undrafted rookies carry the pool well past it (measured 300-470), so
   * the top-up does nothing at all and mints nobody.
   *
   * Sized against the league it serves: 32 clubs x 53 = 1,696 roster spots,
   * and roughly a sixth of that again unsigned is what a real offseason wire
   * looks like. Small enough that the AI's roster-filling cannot drain it,
   * large enough that every position has several names under it. [TUNE]
   */
  POOL_FLOOR: 260,
  /**
   * `fillTeamsToRosterMinimum` signs at CAP.MIN_SALARY for one year, and it
   * is the ONE signing path in the game that never asks whether the man would
   * accept — so a short-handed club could buy the best free agent in football
   * for the league minimum, and did: the 2027 market went 91 players to 15 in
   * a single step, top man 85 OVR to 57, before the user ever saw the screen.
   *
   * A minimum-salary one-year deal buys a camp body. This is the ceiling on
   * what such a deal may buy, as a multiple of CAP.MIN_SALARY — anyone
   * pricier stays on the board for the wave and for the user. A club with no
   * minimum-tier body left still falls back to the cheapest man available
   * rather than staying illegal; see fillTeamsToRosterMinimum. [TUNE]
   *
   * THE USER'S "FILL ROSTER" BUTTON SHOPS THE SAME TIER. `planRosterFill`
   * (lib/freeagency.ts) admits a free agent only if his `askingPrice` already
   * sits at or under this, then offers him exactly that price on a one-year,
   * no-bonus, nothing-guaranteed deal. The two paths differ in what they PAY
   * inside the tier — the AI's recovery fill offers a flat CAP.MIN_SALARY, the
   * user's button pays each man his own ask — but one constant fixes what
   * either of them can REACH, so a human cannot buy a body a CPU club could
   * not. That is what stops the button being a way to sign a starter for the
   * minimum, which is exactly what it had become.
   *
   * WHY 1.5x AND NOT A FLAT 1.0x. `marketValue` floors every ask at
   * CAP.MIN_SALARY and rounds to $100K, so an exact-minimum filter admits only
   * the men the curve has already bottomed out on — a thin, arbitrary slice of
   * the bottom of the board that empties the moment a couple of clubs fill.
   * 1.5x is the veteran-minimum tier as football actually uses it: the
   * minimum plus a small sweetener, still a deal any club can walk away from.
   * At a $1.0M minimum that is a $1.5M ceiling. WHAT IT REACHES IS NOT ONE
   * RATING: `askingPrice` discounts for position and for weeks spent on the
   * wire, so a cheap-position veteran nobody has called about clears it at a
   * higher overall than a premium-position man does. Measured on a fresh
   * league in PRESEASON it admitted bodies up to about 70 OVR at RB and 68 at
   * LB, and nothing any club would field as a starter.
   */
  FILL_MAX_MARKET_MULT: 1.5,

  /**
   * ---------------------------------------------------------------------
   * WHAT A MAN NOBODY HAS SIGNED WILL TAKE
   * ---------------------------------------------------------------------
   * An asking price is not a fact about a player, it is a fact about a
   * player AND a date. Nobody sits out a season at his April number: a good
   * veteran still unsigned when camp opens takes less, and one still
   * unsigned at midseason signs for close to nothing. Until this existed
   * `marketValue` answered the same question on day 400 as on day 1, so a
   * 98-overall quarterback released in the spring was still asking $60M in
   * December — unsignable, and therefore still there. (The app owner, deep
   * into a season: *"those same really high overall 95, 96, 97, 98 overall
   * players are still on the free agent list. Those players should
   * gradually drop their salary demand. So that way, they get picked up."*)
   *
   * The shape is a logistic on WEEKS ON THE WIRE (Player.weeksUnsigned),
   * normalised so it is exactly 1.0 the week he is released, and it is a
   * logistic rather than a straight line because that is how the market
   * actually treats him. Early on nothing has been learned — clubs are
   * still working through their own re-signs and the draft, and his agent
   * has no reason to blink — so the price barely moves. Once it is clear
   * nobody is coming, it falls fast. Then it flattens, because a genuinely
   * good player is still a genuinely good player and there is a price below
   * which he would rather wait for next spring.
   *
   * A LEAGUE YEAR IS 26 TICKS OF THIS CLOCK — measured by driving a league
   * a full year round, and 26 rather than the 30 presses that year takes
   * because the first three playoff rounds do not move League.week and so do
   * not age the wire (see advanceWeekStep in lib/season.ts, which ticks on the
   * league's own clock and nothing else; those rounds are twelve clubs
   * playing, not a league-wide week).
   *
   * IT WAS 30 UNTIL THE OFFSEASON WAS COLLAPSED — five bookkeeping presses
   * became two (OFFSEASON_ADVANCES in lib/season.ts) and free agency four
   * weeks became three (WEEKS above), so the same calendar now costs the wire
   * four fewer ticks. That makes an unsigned man very slightly dearer at every
   * point of the year, and measured it is small enough to leave the curve
   * alone: a man released the day free agency opens is at 99% when the window
   * opens and 95% when the draft goes on the clock (it was 92%) — so nothing
   * about the offseason market moves either way — and he is at ~90% on opening
   * day, ~74% by week 5, ~55% by week 9 and ~43% by week 13. A full year
   * unsigned still puts him on the floor.
   *
   * THE FLOOR IS A SHARE, AND THERE IS A SECOND FLOOR UNDER IT. This one
   * stops a 97 being available for pocket change — a star signing for
   * nothing is exactly as wrong as a star asking $45M in December — and
   * `marketValue`'s own Math.max keeps every ask at or above CAP.MIN_SALARY,
   * which is the league's real floor and the one that binds for depth. [TUNE]
   */
  ASK_DECAY: {
    /** Weeks on the wire where the slide is steepest — roughly midseason. */
    MIDPOINT_WEEKS: 11,
    /** How abrupt the slide is. Smaller is sharper; this is ~7 weeks top to bottom. */
    WIDTH_WEEKS: 3.5,
    /** He never asks less than this share of his open-market worth. */
    FLOOR: 0.35,
  },

  /**
   * ---------------------------------------------------------------------
   * CLUBS SHOP DURING THE SEASON TOO
   * ---------------------------------------------------------------------
   * `runAiFreeAgencyWave` was called from exactly one place — the
   * FREE_AGENCY phase — so from the moment a league reached PRESEASON
   * nothing in the game could sign a free agent to an AI roster until the
   * next offseason. A player released in April was unreachable for a full
   * calendar year no matter how far his price had fallen, which is half of
   * why the elite unsigned pile up: the other half was the price never
   * falling, and fixing either one alone changes nothing.
   *
   * These numbers exist to make the in-season market PLAUSIBLE rather than
   * a sweep. A front office does not clear the wire the week prices drop;
   * it signs when it has a real hole and the man it wants has come down to
   * what it can pay. A bargain veteran is exactly the sort of thing the GM
   * should get a shot at, so the AI is deliberately slow: most weeks nobody
   * signs anybody, and the clubs that do are the ones with the worst holes.
   */
  IN_SEASON: {
    /** Chance any club at all goes shopping in a given week. */
    WEEK_CHANCE: 0.5,
    /** How many clubs may sign in one week, on the weeks anything happens. */
    MAX_CLUBS_PER_WEEK: 2,
    /** And at most one man each — nobody rebuilds a roster in a bye week. */
    MAX_SIGNINGS_PER_CLUB: 1,
    /**
     * A hole worth signing a stranger for, on `teamNeeds`' 0..1 scale. The
     * rest of the game calls 0.15 "notable"; in-season is a higher bar,
     * because a club that merely wants to be better waits for the offseason.
     * A club below the roster minimum is a candidate whatever it scores.
     *
     * IT EXCLUDES ALMOST NOBODY MID-SEASON, and that is worth knowing rather
     * than assuming: measured on a save at the end of a season, 29 of 31 AI
     * clubs cleared it, because injuries push somebody below a positional
     * minimum on nearly every roster and `teamNeeds` scores that at 1.00.
     * What actually keeps the in-season market small is MAX_CLUBS_PER_WEEK
     * above; this floor is the sanity check underneath it.
     */
    NEED_FLOOR: 0.35,
    /** How deep into the board an in-season club looks. Its hole is specific. */
    BOARD_SIZE: 60,
    /** Displacements per club per week. One: this is a signing, not a purge. */
    MAX_DISPLACE: 1,
  },
};

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------
export const POSITIONS = [
  'QB', 'RB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT',
  'EDGE', 'DT', 'LB', 'CB', 'S', 'K', 'P',
] as const;
export type Position = (typeof POSITIONS)[number];

/**
 * Positions that used to exist and no longer do, mapped to what they became.
 *
 * The fullback was retired: he is not a starter in eleven personnel, he is
 * not on the field in the modern game, and the roster spot goes to a fourth
 * receiver. But retiring a position from the TYPE does not retire it from the
 * DATABASE — `Player.position` is a plain string column, and every save
 * written before the change still holds fullbacks on rosters, under contract,
 * in depth charts and in draft history. A data migration converts the ones we
 * know about; this alias covers the ones we do not (an imported league file,
 * a restored backup, a save that was mid-write).
 *
 * This matters more than it looks. Every `Record<Position, …>` table in this
 * file is indexed by a position string that ultimately came from the
 * database. Indexing one with a retired position returns `undefined`, which
 * does not throw — it silently becomes NaN inside an average or a multiply,
 * and a NaN rating looks like a rendering bug rather than a data bug. That is
 * the same failure mode that let a twelve-man defence ship unnoticed.
 */
const RETIRED_POSITIONS: Record<string, Position> = {
  FB: 'RB', // fullback -> running back: same group, same stat line, same build
};

/**
 * The live position a stored position string means. Unknown values fall back
 * to the string itself, so a genuinely bad value still fails visibly at the
 * lookup rather than being silently mapped onto a real position.
 */
export function canonicalPosition(raw: string): Position {
  return RETIRED_POSITIONS[raw] ?? (raw as Position);
}

export const POSITION_GROUP: Record<Position, 'OL' | 'SKILL' | 'FRONT7' | 'SECONDARY' | 'SPEC'> = {
  QB: 'SKILL', RB: 'SKILL', WR: 'SKILL', TE: 'SKILL',
  LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL',
  EDGE: 'FRONT7', DT: 'FRONT7', LB: 'FRONT7',
  CB: 'SECONDARY', S: 'SECONDARY',
  K: 'SPEC', P: 'SPEC',
};

/** [TUNE] Target roster construction — how many of each position a 53 holds. */
export const ROSTER_TARGETS: Record<Position, { min: number; ideal: number; max: number }> = {
  QB:   { min: 2, ideal: 3, max: 3 },
  RB:   { min: 3, ideal: 4, max: 5 },
  WR:   { min: 5, ideal: 7, max: 8 },
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
  /**
   * K AND P STAY AT max: 1, AND IT WAS CHECKED RATHER THAN LEFT ALONE.
   *
   * The app owner reported no specialist ever available in the trade hub, and
   * this hard ceiling is the obvious culprit. It is not the culprit, and
   * raising it is worse than useless. Two measurements:
   *
   * 1. IT IS NOT WHAT KEEPS A CLUB AT ONE KICKER. `topUpRoster` in
   *    lib/gen/league.ts fills the roster by largest `spec.ideal - held`
   *    deficit and stops at ~47 men. A club that already holds its one kicker
   *    scores a deficit of 0 there and is never chosen again, whatever `max`
   *    says. Replayed over 400 generated clubs with max at 1 and then at 2,
   *    the composition is IDENTICAL to two decimal places — K per club
   *    {"1":400} both times. The binding number is `ideal`, not `max`.
   *
   * 2. AND `max` IS NOT ONLY A CEILING. lib/ai/gm.ts reads `max > 1` twice as
   *    a different question — "is this a one-man job" — because K and P are the
   *    only rows in this table where the two answers differ. `teamNeeds` skips
   *    its depth term for them and `rosterFit` gives them no bench snap
   *    weights. Setting max: 2 flips both: measured, a club with a perfectly
   *    good kicker goes from needs.K 0.000 to 0.293, which is over free
   *    agency's 0.15 bid gate, so all 32 clubs would shop for a backup kicker
   *    in every wave forever; and a spare kicker's rosterFit gain goes from
   *    0.00 to 2.64, pricing a man who takes no snaps as though he took some.
   *
   * So the roster half of a specialist market is not a change here. It needs
   * lib/ai/gm.ts to stop reading `max > 1` as "carries depth" — a ONE_MAN_JOB
   * set, which lib/gen/players.ts already keeps under that exact name — and
   * only then can this become 2 without side effects. The half that IS a
   * constant is ROSTER_NEED_QUALITY_WEIGHT below, and that one moved.
   */
  K:    { min: 1, ideal: 1, max: 1 },
  P:    { min: 1, ideal: 1, max: 1 },
};

/**
 * ---------------------------------------------------------------------------
 * HOW BADLY A CLUB WANTS TO UPGRADE A MEDIOCRE STARTER, PER POSITION
 * ---------------------------------------------------------------------------
 * Separate from whether the position is FILLED at all — that is `countNeed`,
 * which multiplies by 1.4 and treats an empty slot as an emergency at every
 * position including these two. This term is only about replacing a man who is
 * there and is not good. Missing entries default to full weight (1).
 *
 * IT WAS 0.25 FOR BOTH, on the note: "A below-average kicker or punter is real
 * but nowhere near as urgent as a below-average corner or tackle, since these
 * positions touch the game far less and are trivially replaceable off the
 * street." Two things were wrong with that. It gave K and P the same number
 * when they are not remotely the same size, and 0.25 does not mean "less
 * urgent", it means NEVER — which is a different policy and nobody chose it.
 *
 * WHAT 0.25 ACTUALLY DID. `teamNeeds` computes
 * `clamp((72 - starter)/18, 0, 1) * weight`, that lands in `needs` at 0.75x,
 * and free agency bids when `needs > 0.15`. At 0.25 the ceiling of the whole
 * term is 0.1875, so a club shopped for a kicker only if its own rated 57 or
 * worse — one point above the generator's roster floor. Measured over 4,000
 * generated clubs: 1.8% of them. That is the closed specialist market the app
 * owner reported ("there is no kicker or punter available for trade in the
 * trade hub"), expressed as a constant.
 *
 * THE NEW NUMBERS ARE A MEASURED RATIO, not a fresh adjective. Every position
 * below was swapped between a 99 and a 40 in the sim on identical rosters and
 * seeds, and the difference scored — the points a club gains plus the points
 * it denies, per game, over 40,000-150,000 paired games each:
 *
 *     starting CB          5.24 pts/game     (whole group 13.11 x 0.40 weight)
 *     starting S           4.00              (whole group  7.27 x 0.55)
 *     K                    2.21              1.68 field goals a game vs 1.06
 *     P                    0.32              and see SIM.PUNT_PIN_PER_RATING
 *
 * Against a starting safety at 1.00, the kicker is 0.55 and the punter 0.08,
 * and that is what they are set to. A kicker is not "trivially replaceable" —
 * he is worth more than half a starting safety, because his rating swings
 * field goals from 60% to 95% and the club takes 1.8 of them a game.
 *
 * WHAT EACH ONE BUYS. At 0.55 a club shops for a kicker when its own rates
 * below 66, which is 17.8% of generated starters — a live market, roughly six
 * clubs in a league of 32. At 0.08 a club never upgrades a punter at all, and
 * that is the honest answer for a third of a point a game: he is worth having
 * and he is not worth a roster move. An EMPTY punter slot is still an
 * emergency, because that is countNeed's job and this number does not touch it.
 */
export const ROSTER_NEED_QUALITY_WEIGHT: Partial<Record<Position, number>> = {
  K: 0.55, P: 0.08,
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
  VETERAN_OVR_MEAN: 77,
  VETERAN_OVR_SD: 7,
  /** Rookie class skews lower and much wider — that's the point of scouting. */
  ROOKIE_OVR_MEAN: 68,
  ROOKIE_OVR_SD: 7.5,
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
  /**
   * ---------------------------------------------------------------------
   * DEPTH-CHART DECAY, THE ROSTER FLOOR, AND THE STAR TIER
   * ---------------------------------------------------------------------
   * The full derivation, with measurements against Madden's published
   * numbers, is docs/rating-distribution.md. The short version:
   *
   * Depth used to be `i * rng.float(4, 8)` — linear and unbounded. With
   * ROSTER_TARGETS.WR.ideal at 7 that put the seventh receiver 36 points
   * below his team's mean, and it was where the whole sub-50 population
   * came from. Worse, it made a POSITION's mean rating a function of how
   * many of them a roster carries: receivers averaged 58 and left tackles
   * 74, purely because a roster holds seven of one and two of the other.
   *
   * The decay is now asymptotic, so it is front-loaded like a real depth
   * chart (slot 1 -5.1, slot 2 -8.2, slot 4 -11.2, slot 6 -12.4) and can
   * never drag anyone more than DEPTH_DECAY_MAX below his team's mean.
   */
  DEPTH_DECAY_MAX: 13,
  DEPTH_DECAY_TAU: 2.0,
  DEPTH_DECAY_JITTER: 0.25,
  /** Nobody on a 53-man roster is worse than this. Madden's floor is ~57. */
  ROSTER_OVR_FLOOR: 56,
  /**
   * Kickers and punters are the only positions with exactly one roster
   * slot, so they never take a depth penalty and used to sit at the raw
   * team mean while every other position was dragged down by its backups.
   * The result was a league whose best player was a 99 PUNTER, with
   * punters holding three of the top twenty-five slots. This is the
   * offset that puts a specialist's overall back on the same scale as
   * everyone else's. [TUNE]
   */
  SPECIALIST_OVR_PENALTY: 5,
  /**
   * The star tier. The old roll — normal(85, 4) clamped to [78, 99] —
   * put 99 at +3.5 standard deviations, i.e. structurally unreachable:
   * the league had never generated one. This is not a limitation of
   * computeOverall, which reaches 99 fine; it was only ever this roll.
   */
  STAR_OVR_MEAN: 89,
  STAR_OVR_SD: 5.5,
  STAR_OVR_MIN: 82,
  STAR_COUNT_MIN: 2,
  STAR_COUNT_MAX: 4,
  /**
   * Which positions stars land at. This used to be an unweighted
   * rng.pick over ten positions, which handed a 79-man tight-end pool as
   * many stars as a 193-man receiver pool — tight ends took five of the
   * league's top twenty-five and left tackles were the highest-rated
   * position in the game.
   *
   * QB WAS 2.2, WHICH READ CORRECTLY OFF A TOP-100 AND WRONGLY OFF A LEAGUE.
   * A top hundred containing 21 quarterbacks is Madden-shaped, but there is
   * only ONE starting quarterback per club against three receivers, so 21 of
   * them meant two thirds of the league was set at the position — and a club
   * that is set has no reason to trade for one. Measured on identical seeds,
   * 2.2 -> 1.5 takes clubs holding an 88+ passer from 10.3 to 8.0 per league
   * and 85+ from 14.7 to 12.3, against a real-football feel of about 7-8 and
   * 10-12. The 90+ tail barely moves either way: several stars landing at one
   * club's quarterback slot just overwrite each other, so that tail is set by
   * STAR_OVR_MEAN and STAR_OVR_SD below, not by this share. [TUNE]
   *
   * THE INTERIOR LINE AND THE RIGHT TACKLE WERE MISSING ENTIRELY, and an
   * absent key is weight zero — so no generated league had ever contained an
   * elite guard, centre or right tackle, at any rating, ever. That is not a
   * defensible reading of football (the highest-paid lineman in the real game
   * plays right tackle, and elite guards sign for more than elite centres),
   * and it is half of why the biggest cap hits in a new league were always the
   * same four or five positions. They are in now, at weights matching how many
   * genuinely elite men exist at each spot — a handful each, well short of the
   * receiver and edge pools. Adding them also dilutes every other share,
   * quarterback included, which pulls the same way as the 2.2 -> 1.5 cut.
   */
  STAR_POSITION_WEIGHTS: {
    QB: 1.5, WR: 1.8, EDGE: 1.6, CB: 1.3, DT: 1.1, LB: 0.9,
    LT: 0.7, S: 0.7, RB: 0.6, RT: 0.5, TE: 0.45, LG: 0.35, RG: 0.35, C: 0.35,
  } as Record<string, number>,
  /** Draft-class tier ramp: top of round one down to the last pick. */
  DRAFT_TIER_SPREAD: 17,
  DRAFT_TIER_OFFSET: 9,
  DRAFT_OVR_MIN: 54,
  DRAFT_OVR_MAX: 88,
  /**
   * The unsigned pool. Hardcoded in TWO places before this (lib/gen/league.ts
   * and lib/leagueFile.ts) and following nothing, so raising the roster
   * curve without raising this would have left free agents 13 points below
   * the rostered mean instead of the 7 they sat at.
   */
  FREE_AGENT_OVR_MEAN: 64,
  FREE_AGENT_OVR_SD: 8,
  FREE_AGENT_OVR_MIN: 52,
  FREE_AGENT_OVR_MAX: 88,
  /**
   * ---------------------------------------------------------------------
   * HOW BIG A ROSTER A GENERATED CLUB STARTS WITH
   * ---------------------------------------------------------------------
   * `generateRoster` rolls `rng.int(min, ideal)` bodies per position. Summed
   * over ROSTER_TARGETS that is 35 at the low end and 51 at the high, so the
   * MEAN generated club carried 43 men against a 46-man legal minimum: 31 of
   * 32 clubs began life illegal, which is the whole of the standing INV-20
   * "below the roster minimum" warning and — because
   * `fillTeamsToRosterMinimum` then buys ~90 bodies off the market to fix it
   * — the reason the first offseason's free agency was empty.
   *
   * So a generated club is topped up to a legal size before it is written.
   * The band stops short of ROSTER_MAX on purpose: a club needs open slots
   * for its rookie class and for free agency, or cut-down day just deletes
   * whatever it signed.
   *
   * The ceiling is not arbitrary. `bidderState` gives a club
   * `rosterMax - roster.length - rookieReserve` open slots to bid with, and
   * rookieReserve is ceil(7 x ROOKIE_ROSTER_HIT_RATE) = 4 — so a club born at
   * 49 has ZERO slots and is shut out of its own first free agency, which is
   * the opposite of the point. 48 leaves every club at least one, and a
   * measured 47..50 band also carried enough extra salary to push the
   * end-of-season over-cap warning (INV-19) up by half again. [TUNE]
   */
  INITIAL_ROSTER_MIN: 47,
  INITIAL_ROSTER_MAX: 48,
  /**
   * ---------------------------------------------------------------------
   * THE FRINGE POPULATION — camp bodies, recent cuts, career backups
   * ---------------------------------------------------------------------
   * Real football always has hundreds of unsigned players in it. This league
   * only ever minted 140 at creation and nothing replenished them, so once
   * the first offseason's roster-filling had eaten the pool the free-agency
   * screen was blank for four straight weeks (measured: pool 15, best
   * available 57 OVR, in a league whose rostered mean is 77).
   *
   * These men exist to make the market a market. They are DELIBERATELY not
   * talent: capped below the roster floor's useful band, potential pinned
   * close to the overall they already have, and never a Star or Superstar
   * development trait. A GM should recognise them for what they are — a
   * fourth tight end, a camp arm, a 31-year-old special-teamer — and the
   * signing that matters should still be the veteran whose contract actually
   * expired. See generateFringeFreeAgents in lib/gen/league.ts.
   *
   * They are also self-clearing: sitting far below the league's mean active
   * rating puts them under UNSIGNED_ATTRITION_FLOOR_BELOW_MEAN, so ~42% of
   * any that go unsigned are out of football a year later and the pool tops
   * up rather than accumulating. [TUNE]
   */
  FRINGE_OVR_MEAN: 59,
  FRINGE_OVR_SD: 4,
  FRINGE_OVR_MIN: 50,
  FRINGE_OVR_MAX: 66,
  /** Share of the fringe population that is a 22-25 year old camp body rather than an ageing depth veteran. */
  FRINGE_YOUNG_SHARE: 0.55,
  /** The most room above his current rating a fringe player may ever carry — young, then old. */
  FRINGE_POTENTIAL_BONUS_YOUNG: 6,
  FRINGE_POTENTIAL_BONUS_OLD: 2,
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
  /**
   * Growth multiplier at a checkpoint for a player carrying a Development
   * Focus charge (Player.devFocus). One charge would be consumed per
   * checkpoint.
   *
   * CURRENTLY UNREACHABLE. Charges were bought with "scouting focus points",
   * a currency that was removed; nothing in the codebase grants a charge, so
   * devFocus is 0 for every player and this multiplier never applies. Left in
   * place with the column rather than deleted — see the note at the read site,
   * lib/development.ts. If it is ever wired up, 1.5 is far too large next to
   * the Dynasty Coaching Staff skill, whose maximum is 1.15: re-tune it before
   * granting the first charge rather than after.
   */
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
  /**
   * [TUNE] LIVE drives per team per game. Was 11 on the note "Real NFL ~11".
   *
   * The NFL figure is right and the mapping onto this engine was not. A real
   * team gets about 11.2 possessions a game, but roughly 1.4 of them are the
   * drive that ends a half or the game — a kneel-down, or two snaps and the
   * clock — and this sim has no such outcome. `DriveResult` declares
   * 'END_HALF' and nothing has ever produced one, so all 11 possessions here
   * were full scoring chances and every one of them was handed a punt drive's
   * worth of yardage. Real football's ~9.8 LIVE drives is what this constant
   * governs, so it is 10.
   *
   * That gap was the last irreducible part of the yardage surplus. With the
   * per-drive yardage in lib/sim/engine.ts corrected to real drive lengths,
   * this engine still floored at ~381 total yards a team-game at 11 drives
   * against a real ~330, because 26% of its drives end in a touchdown (2.86 a
   * game, against a real 2.2) and a touchdown drive is 66 yards by geometry —
   * you cannot shorten it without moving the end zone. Removing the drive
   * real football spends kneeling is the honest way to remove those yards.
   *
   * It takes scoring from 24.4 to 22.2 a team-game, which reads like a step
   * past the real ~22.5 and is not: every point this sim scores is scored by
   * an offence, where about 1.8 of a real team's 21.8 come from returns,
   * defensive scores and safeties this engine does not simulate. Against real
   * OFFENSIVE scoring of ~20 a game, 22.2 is still a little hot.
   *
   * lib/gameShape.ts mirrors this as a literal and had to move with it.
   */
  DRIVES_PER_TEAM: 10,
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

  // -------------------------------------------------------------------------
  // PUNTING
  //
  // The app owner, on finding that a punter's average was `punts * rng.int(40,
  // 50)`: "Wait a punter is not actually based on their rating? That's not
  // good... Special teams has a smaller, but measurable impact on a teams
  // success." And on the fix: "I think the punter should matter. it should be
  // slight, but it should impact things."
  //
  // SLIGHT IS THE BINDING WORD, and everything below is sized to it.
  // -------------------------------------------------------------------------

  /**
   * [TUNE] The rating a league-average STARTING punter carries. Measured, not
   * assumed: 2,000 rosters out of `generateRoster` put the best punter on the
   * roster at a mean of 72.1 and a standard deviation of 6.7 (p5 61, p95 83).
   *
   * WHY THIS IS NOT `UNIT_BASELINE`. That constant is 60 and is nothing like
   * the middle of anything — measured, a team's offensive unit score means
   * 80.1 and its defensive 76.2. It gets away with being wrong because the
   * only thing that ever reads it is a DIFFERENCE (`edge = off - def`), where
   * a shared offset cancels. The two terms below are absolute: they turn one
   * man's rating into yards and into a probability, with nothing to cancel
   * against. Centred at 60, every punter in the league would come out above
   * average and the whole league would punt like a Pro Bowler.
   *
   * This is a fact about lib/gen/players.ts (the specialist OVR penalty and
   * two punters per roster). If that generator changes, re-measure it.
   */
  PUNTER_BASELINE: 72,
  /**
   * [TUNE] Gross yards a punt travels for a punter rated exactly
   * PUNTER_BASELINE. THE CHECKABLE FIGURE: the NFL's league-wide gross
   * punting average has sat between 45.3 and 46.0 every year for a decade
   * (45.6 in 2023). 45.5 is the middle of that band.
   *
   * `puntYds` was `punts * rng.int(40, 50)` — one roll of a ten-sided die
   * applied to every punt of the afternoon, with no input from the man kicking
   * them. lib/coachRoom.ts called that out in its own header and barred P from
   * ever being mentioned because of it.
   */
  PUNT_GROSS_BASE: 45.5,
  /**
   * [TUNE] Gross yards added per rating point above PUNTER_BASELINE.
   *
   * THE CHECKABLE FIGURE is the SHAPE OF THE LEAGUE, not this number. Real
   * qualifying punters run roughly 42.5 to 50 gross, so the whole league fits
   * inside about eight yards, and the best season ever punted is 50.4 (2022).
   * At 0.16 the generator's best possible punter (99) means 49.8 — the best
   * season in a typical league, with an all-time year needing luck on top of
   * him rather than being his baseline. A p5 starter (61) means 43.7 and a p95
   * (83) means 47.3, and the per-punt noise below widens the realised league
   * to about 42-49 across 32 clubs.
   *
   * Deliberately gentle. A steeper slope would fit the observed league spread
   * a shade better and would also hand a 99 punter a 52-yard average, which no
   * one has ever done over a season.
   */
  PUNT_GROSS_PER_RATING: 0.16,
  /**
   * [TUNE] Spread of a SINGLE punt around that mean. Real gross punt distance
   * has a standard deviation near 9-10 yards — a shank and a 60-yarder are
   * both ordinary events — and that is what makes a punter's season average
   * settle only over a full season rather than over an afternoon. Over the ~68
   * punts a season this is worth about 1.15 yards of noise on the average,
   * which is real and is not to be tuned away.
   */
  PUNT_GROSS_SD: 9.5,
  /**
   * [TUNE] How much a punt subtracts from the RECEIVING team's chance of
   * scoring on the possession it starts, per rating point of the punter above
   * PUNTER_BASELINE. See the drive loop in lib/sim/engine.ts for why it lands
   * on scoring probability and on nothing else.
   *
   * SIZED AGAINST A CHECKABLE FIGURE. In real football the gap between the
   * best and worst net-punting teams is worth on the order of a third of a
   * point a game — a nudge, not a difference-maker. This engine punts about
   * 4.0 times a team-game and a scoring drive is worth about 4.9 points, so
   * the swing between a 99 punter (+27) and a 40 punter (-32) is
   * 4.0 x 59 x PUNT_PIN_PER_RATING x 4.9 points a game. At 0.00026 that is
   * 0.30 — the target. Anything that measures above about half a point a game
   * across that same 59-point spread is too strong and this number is what to
   * turn down.
   */
  PUNT_PIN_PER_RATING: 0.00026,
};

/** [FRAGILE] How much each positional unit contributes to team offense score. */
export const OFFENSE_UNIT_WEIGHTS: Partial<Record<Position, number>> = {
  QB: 0.34, RB: 0.07, WR: 0.18, TE: 0.07,
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
  /**
   * [TUNE] The DEFAULT annual bump — the SLOW rung of CAP_GROWTH_MODES
   * (lib/settings.ts), which reads this constant rather than copying it.
   * A league's real rate is a setting now (FLAT / SLOW / FAST); this is only
   * what a ceiling computed with no league behind it falls back to.
   *
   * It was 7%, unconditionally, for every league. Compounded that is not a
   * drift, it is a different game: 1.07^10 = 1.97, so season eleven plays
   * under nearly double the opening ceiling while marketValue() still answers
   * in year-one dollars. Measured over 20 league years against 32 real
   * generated clubs priced at market, 7% leaves a median club at 24% of its
   * own ceiling by year 20 and 2% leaves it at 60% — still a squeeze, still a
   * choice. The rungs and the table are in lib/settings.ts.
   */
  CAP_GROWTH_PER_YEAR: 0.02,
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
   *
   * It is an index into the STEP list, not a count of Advances, and that
   * survived the offseason being collapsed into two presses: one press now
   * carries several steps, so a league goes from week 1 straight to week 4
   * without ever sitting on 2 or 3, but the step at week 2 is still
   * RESET_STANDINGS and "week 1 is before the roll, week 4 is after it" is
   * still what this number says. Move it only if RESET_STANDINGS moves within
   * OFFSEASON_STEPS — not if the steps are regrouped into different presses.
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
  MAX_DEAL_OVR: 85, // +5 with the curve — see docs/rating-distribution.md
  MAX_DEAL_MAX_AGE: 28,
  MAX_DEAL_YEARS: 5,
  /** Everyone else who is a real roster player. */
  STANDARD_OVR: 68, // percentile-matched to the old 60
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
  FLOOR_OVR: 67, // percentile-matched to the old 58
  /** At/above this rating a player is kept regardless of depth behind him. */
  PREMIUM_OVR: 80, // percentile-matched to the old 74
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
  /**
   * Moved 70 -> 77 in lockstep with GENERATION.VETERAN_OVR_MEAN (72 -> 77).
   * `ovr` enters this curve ONLY as `(ovr - PIVOT)`, so shifting the rating
   * curve and the pivot together cancels exactly and every player's price is
   * unchanged at his new number: an average-starter quarterback was a 70 at
   * $13.0M and is now a 77 at $13.0M; an elite receiver was a 90 at $25.7M
   * and is now a 97 at $25.7M. SCALE would NOT have worked — it rescales
   * every price by a constant and so changes the star-to-backup ratio.
   * Solved empirically against median team payroll; see
   * docs/rating-distribution.md section 4.
   */
  PIVOT: 77,
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
   * Recalibrated over 32 generated rosters so a roster at market lands near
   * 92% of BASE_CAP: enough that a team can field a legal roster, tight
   * enough that keeping everyone good is a real choice. The steeper
   * STEEPNESS_LOW is what pays for it — bottom-of-roster depth collapses
   * toward the league minimum (a 62 OVR LB now costs ~$1.9M rather than
   * ~$3.4M) while a genuine star's price is nearly unchanged.
   *
   * THAT 92% IS A 44-MAN ROSTER, NOT A 53-MAN ONE, and this comment used to
   * say 53. `generateRoster` returns about 44 men and the calibration was run
   * on its output; `topUpRoster` — which arrived later, to stop clubs being
   * born below the legal minimum — then adds five or six more. Re-measured
   * over 160 freshly generated clubs, what a club actually carries is 47.4
   * men costing 99% of BASE_CAP at market (median 94%), and only the
   * generator's own scale-down to a club's payroll target keeps books that
   * open legal: 0 of 160 clubs were over the cap, at a mean payroll of 78%.
   * So the cap is TIGHTER than the old wording claimed, not looser. Left as
   * a measured fact rather than retuned, because moving SCALE reprices every
   * contract in the game and that is its own piece of work.
   */
  SCALE: 7_000_000,
  /**
   * Positional value multipliers — the premium-position tax.
   *
   * QB is the multiplier for a man who HOLDS the job; QB_JOB below scales it
   * down the further a quarterback is from being able to hold one. Every other
   * entry here applies flat, because every other position plays several men.
   * This entry is also read by `acceptableStarter` (lib/ai/gm.ts) to set how
   * good a starter each position needs, so it is the one number that says how
   * much this game thinks a position matters — leave it meaning that.
   *
   * ANCHORED, AND UNDER A FIXED BUDGET. Each entry is set from the average
   * APY of the thirty-two STARTERS at that position in the real NFL, since
   * that is the same quantity this multiplier prices: what one job at this
   * spot costs. The whole non-QB vector is then multiplied by one constant
   * (0.9904, folded in below) so the league-wide bill does not move — this
   * table decides how the money is SPLIT, never how much of it there is.
   * Re-solve that constant with scripts/_qbp_posmult.ts after any edit here,
   * or the roster-affordability calibration under MARKET.SCALE quietly rots.
   *
   * What moved and why, against the real market:
   *   WR   1.15 -> 1.27  receivers are the second-biggest market in football
   *                      and this table had them below left tackles.
   *   RB   0.62 -> 0.54  the one position the real market has repriced DOWN.
   *   LB   0.82 -> 0.73  off-ball linebacker pay has gone the same way.
   *   S    0.85 -> 0.77  the safety market fell away with it.
   *   DT   1.05 -> 1.11  the best interior rushers now clear the best corners.
   *   LG/RG 0.80 -> 0.85, C 0.85 -> 0.79  guards out-earn centres now; this
   *                      table had it backwards.
   *   RT   1.05 -> 1.09  the tackle gap has narrowed — the highest-paid
   *                      lineman in football plays on the right.
   *   TE   0.85 -> 0.79, K 0.30 -> 0.32, P 0.25 -> 0.22, EDGE/LT/CB ~flat.
   *
   * KNOWN LIMITATION: one multiplier scales a position's WHOLE curve, so it
   * cannot say "top-heavy". The real receiver market is far more top-heavy
   * than this — a genuine WR1 is worth more than 1.27 says and a fifth
   * receiver less. Fixing that needs a per-position curve shape, not a bigger
   * number here, which would just overpay the depth.
   */
  POSITION_MULT: {
    QB: 1.85, RB: 0.54, WR: 1.27, TE: 0.79,
    LT: 1.29, LG: 0.85, C: 0.79, RG: 0.85, RT: 1.09,
    EDGE: 1.47, DT: 1.11, LB: 0.73, CB: 1.24, S: 0.77,
    K: 0.32, P: 0.22,
  } as Record<Position, number>,
  /**
   * THE THIRTY-TWO JOBS. [TUNE]
   *
   * A logistic on POSITION_MULT.QB — see `qbJobShare` (lib/cap.ts) for why
   * quarterback alone is priced on a curve rather than a constant.
   *
   *   effective QB multiplier = POSITION_MULT.QB x (BACKUP .. STARTER)
   *
   * Calibrated against the quarterbacks a generated league actually contains,
   * not against a wish. Sorting every quarterback in a 32-club league by
   * rating, the thirty-second — the last man who could hold a job if talent
   * were distributed one per club — grades right around PIVOT + 1, so that is
   * where the crossover sits. WIDTH is the softness of that edge in rating
   * points: narrow enough that the drop from a starter to a backup is a cliff
   * rather than a slope, wide enough that one rating point either side of the
   * bar is not worth $20M. At 2.6 the steep zone runs about $2.5M per rating
   * point against $1.2M for a premium edge rusher at the top of his curve —
   * twice the slope, which is the intended difference between the two.
   *
   * STARTER is set so the whole thing is CAP-NEUTRAL: measured over 320
   * generated quarterback rooms, a club's total spend on quarterbacks is
   * $27.2M flat and $27.2M on this curve. The money is not new; it is taken
   * off the two men who do not play and handed to the one who does.
   *
   * What that buys at age 27: a 72 goes from $6.4M to $2.5M, a 76 from $11.3M
   * to $7.2M, an 80 from $15.4M to $15.9M, an 85 from $20.6M to $27.0M, a 90
   * from $27.5M to $37.7M and a 95 from $36.8M to $50.7M.
   */
  QB_JOB: {
    /** Share of the starter multiplier a man who will not play commands. */
    BACKUP: 0.29,
    /** ...and what the man taking every snap commands. */
    STARTER: 1.38,
    /** Where the jobs run out, as an offset from PIVOT so it tracks the rating curve. */
    STARTABLE_ABOVE_PIVOT: 1,
    /** Softness of the crossover, in rating points. */
    WIDTH: 2.6,
  },
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
  POTENTIAL_DEFAULT_CENTER: 80,
};

// ---------------------------------------------------------------------------
// THE CONSENSUS BOARD [TUNE] — see lib/consensus.ts
// ---------------------------------------------------------------------------
/**
 * The public draft board every team sees for free. Its whole job is to be
 * WRONG in named, learnable ways: the biases below have to stay large next to
 * NOISE_SD, because that ratio is the difference between finding a steal
 * being a read and finding a steal being a dice roll.
 */
export const CONSENSUS = {
  /**
   * How the room blends "what he is" against "what he might become". Draft
   * boards are forward-looking, but not entirely — a polished 78 goes ahead
   * of a raw 64 with the same ceiling, every year.
   */
  CURRENT_WEIGHT: 0.62,
  POTENTIAL_WEIGHT: 0.38,

  /**
   * Random disagreement between evaluators, on the grade scale. Kept SMALL
   * relative to the bias pulls below — the whole design rests on the board's
   * error being learnable rather than random. If this ever grows past the
   * bias magnitudes, finding a steal becomes a coin flip.
   */
  NOISE_SD: 2.4,

  /** Max swing from the room over-indexing on the stopwatch. */
  TESTING_PULL: 9,
  /**
   * Grade adjustment by strength of competition faced. Only the two extremes
   * move the grade enough to be worth naming: a genuine blue blood and a
   * genuine small school. B and D are where most of a class plays and the room
   * has no strong feeling about either.
   */
  PROGRAM_PULL: { A: 4, B: 1.2, C: 0, D: -1.2, F: -4 } as Record<CompetitionGrade, number>,
  /** Max markdown applied to a raw, high-ceiling developmental player. */
  DEVELOPMENTAL_PULL: 6,
  /**
   * Ceiling-minus-current gap at which the room starts calling a player "a
   * project". Set above the class median gap on purpose — nearly every
   * prospect has SOME room to grow, and a tag that lands on half the board
   * tells the user nothing.
   */
  DEVELOPMENTAL_GAP_MIN: 16,
  /** Flat markdown the room applies to anyone carrying a medical flag. */
  MEDICAL_PULL: 6.5,
  /**
   * Odds a prospect picks up a public medical flag at all. Correlated with
   * true durability but floored well above zero: the exploitable case is the
   * flagged player whose shoulder is genuinely fine, and that case has to
   * exist often enough to be worth scouting for.
   */
  MEDICAL_BASE_ODDS: 0.06,
  MEDICAL_MIN_ODDS: 0.03,
  MEDICAL_MAX_ODDS: 0.3,

  /** A bias is only NAMED to the user once its pull clears this. Below it, it is rounding. */
  BIAS_REPORT_THRESHOLD: 2,

  /**
   * How far positional value moves a prospect's BOARD SLOT, in board-score
   * points, at AI.DRAFT_POSITION_VALUE's extremes. This does not touch the
   * grade — a guard and a quarterback who grade out the same are the same
   * football player, they just do not come off the board at the same pick.
   * It is the room's fifth bias and the most exploitable one: nothing stops a
   * GM taking the guard.
   */
  POSITION_PULL: 8,

  /**
   * How fast the positional reach decays down a position group. At N, the
   * player N deep at his position keeps half the reach the best one gets:
   * QB1 the full +4.0, QB3 half of it, QB7 a quarter. Applied flat instead,
   * a measured 400-man class put six quarterbacks in the top ten and eight
   * in the first round — every year, identically. Only the POSITIVE pulls
   * decay; a punter keeps his whole penalty however good he is. [TUNE]
   */
  SCARCITY_HALF_LIFE: 2,

  /**
   * Extra weight on the NEGATIVE positional pulls — kicker and punter.
   * The plain penalty left a 99-grade kicker at board #28. A first-round
   * kicker is not a thing, however good the kicker is, and the specialist
   * positions are exactly where a flat points-per-grade board goes wrong.
   * [TUNE]
   */
  CHEAP_POSITION_MULT: 2.6,

  /**
   * Spread of the per-class, per-position mood that scales each position's
   * reach. This is what makes one draft quarterback-rich and the next one
   * barren, instead of every class being the same shape with different
   * names. Seeded off the class, so it is stable for a given save. [TUNE]
   */
  CLASS_MOOD_SD: 0.45,

  /**
   * Band cutoffs as PICK NUMBERS, so they mean what they say — a
   * "first-round grade" is a player the room expects inside the first round.
   * Scaled to the actual draft (teams x rounds) rather than hard-coded, so a
   * league running 4 rounds does not label a hundred players Day 3.
   */
  BANDS: [
    { id: 'BLUE_CHIP', label: 'Blue chip', blurb: 'Top of the board. The room does not expect him to get past the first handful of picks.' },
    { id: 'FIRST_ROUND', label: 'First-round grade', blurb: 'A consensus first rounder.' },
    { id: 'DAY_TWO', label: 'Day 2 grade', blurb: 'Second or third round on most boards.' },
    { id: 'DAY_THREE', label: 'Day 3 grade', blurb: 'A rotational bet in the middle rounds.' },
    { id: 'LATE_FLIER', label: 'Late flier', blurb: 'Last-day name. Special teams and a roster spot to win.' },
    { id: 'PRIORITY_FA', label: 'Priority free agent', blurb: 'Expected to go undrafted. Somebody signs him after the phones stop.' },
  ] as const,
};

// ---------------------------------------------------------------------------
// SHORTLIST ATTENTION [TUNE] — see lib/shortlistAttention.ts
// ---------------------------------------------------------------------------
/**
 * The only ongoing scouting input there is: a fixed weekly pool of staff
 * attention split evenly across whoever the GM has starred. Nothing is spent
 * and nothing runs out — the decision the system asks for is how MANY players
 * to star, and the spread in the table below is that decision's whole payoff.
 */
export const SHORTLIST_ATTENTION = {
  /**
   * Attention units a department produces in a week, before staff scaling.
   * Abstract by design: the number the user is ever shown is the per-player
   * SHARE this divides into, never the pool itself.
   *
   * Set so a MEDIAN department lands on an effective pool of ~100, which is
   * what the table below is measured at. Across every team in the dev
   * database the staff multiplier runs 0.57 to 2.28 (median 1.26), so a
   * well-staffed front office covers roughly four times the ground a poor one
   * does — which is most of what Scout.accuracy and Scout.speed are for now
   * that the focus economy they used to feed is gone.
   */
  WEEKLY_POOL: 80,

  /**
   * Fraction of the remaining confidence gap one attention unit closes.
   *
   * Sized against a 17-week season, which is all the time there is: the class
   * lands at PRESEASON of the year before its draft and this only runs on
   * regular-season weeks. Confidence after 17 weeks, starting from a cold 8,
   * for a median department (see WEEKLY_POOL — a top department is a few
   * points better, a poor one materially worse):
   *
   *     5 starred  -> 81   a near-complete file on all five
   *    10 starred  -> 72   solid on everyone, ceilings still open
   *    20 starred  -> 54   partial evaluations across the board
   *    40 starred  -> 36   names and shapes
   *    60 starred  -> 28   an early look, nothing more
   *
   * That spread IS the decision the system asks for. Raising this collapses
   * it — at double, sixty players is as good as five and there is no longer a
   * reason to choose.
   */
  CLOSE_PER_UNIT: 0.011,
  /** No single week may close more than this share of what is left, whatever the shortlist size. A one-week jump from unscouted to a real file reads as a bug. */
  MAX_WEEKLY_CLOSE: 0.25,

  /**
   * Where sustained attention converges. Below 100 on purpose: a season of
   * watching gets you a good file, never a finished one.
   */
  CONFIDENCE_CEILING: 82,
  /**
   * Potential's own ceiling, lower still. Watching a player play does not tell
   * you what he becomes — that read is what a workout buys.
   */
  POT_CONFIDENCE_CEILING: 62,
  /** Potential moves at this fraction of the general read's rate. */
  POT_CLOSE_SHARE: 0.55,

  /** Scout-quality multiplier on throughput: a 0-accuracy staff, a 100-accuracy staff. */
  STAFF_QUALITY_RANGE: [0.72, 1.32] as [number, number],
  /** Each additional scout beyond the first adds this much, geometrically discounted. */
  STAFF_HEADCOUNT_DECAY: 0.72,
  /** Throughput floor for a team with no scouts at all — the GM still watches tape himself. */
  STAFF_MIN: 0.55,
  /** A scout whose specialty matches the prospect's position group works him this much harder. */
  SPECIALTY_BONUS: 1.12,

  /**
   * How much a fully-invested Dynasty scouting branch adds to throughput, on
   * top of the range tightening it already buys. Kept small — the branch's
   * real reward is clarity, not speed.
   */
  DYNASTY_MAX_GAIN: 0.14,
};

// ---------------------------------------------------------------------------
// PRIVATE WORKOUTS [FRAGILE — the only scarce scouting decision left]
// ---------------------------------------------------------------------------
/**
 * A handful of slots a year against a class of hundreds. BASE_SLOTS is the
 * single most dangerous number in the scouting rework: at a dozen, the draft
 * stops being a bet.
 */
export const WORKOUTS = {
  /**
   * Slots per league year. Five against a class of hundreds: enough to cover
   * the top of your board, nowhere near enough to cover a position group.
   */
  BASE_SLOTS: 5,
  /**
   * Extra slots per rank of the Dynasty Scouting Network skill. Reuses that
   * skill rather than adding an eleventh node: Scouting Network is already
   * "more contacts, more access", which is exactly what buys a workout.
   */
  SLOTS_PER_NETWORK_RANK: 1,

  /**
   * Phases a workout may be scheduled in. RESIGN and FREE_AGENCY are the
   * whole stretch between the season ending and the draft going on the clock
   * — combine season, pro days and visits — and they are the phases where the
   * board is the GM's live concern.
   *
   * DRAFT is deliberately NOT here: by the time League.phase is DRAFT the
   * draft is actually running and teams are on the clock. Nobody flies a
   * prospect in between picks.
   */
  PHASES: ['RESIGN', 'FREE_AGENCY'] as string[],

  /** A workout brings a cold file at least this far on its own. */
  CONFIDENCE_FLOOR: 74,
  /** ...and then closes this share of whatever gap is still left above the floor. */
  CONFIDENCE_CLOSE: 0.6,
  /** Hard cap. Short of certainty, because a workout is one day and Full Scout is the thing that finishes a file. */
  CONFIDENCE_CAP: 90,

  /**
   * Where the ceiling projection lands. High enough that the potential range
   * visibly collapses — at SCOUTING.POTENTIAL_DIFFICULTY the displayed
   * half-width goes from ±24 on a cold prospect, and ±8.5 on one starred all
   * season, to ±4.6 here. Never 100: errorBand's floor keeps potential a range
   * at any confidence and that is the contract lib/scouting.ts enforces.
   */
  POT_CONFIDENCE: 88,

  /**
   * Attributes at or below this scoutDifficulty are what a workout actually
   * measures — the stopwatch, the tape measure, the bar. Everything above it
   * is a judgement call that one day in a facility cannot settle.
   */
  MEASURABLE_DIFFICULTY: 0.25,
  /**
   * Ceiling on the share of a position's attributes that may ever be locked
   * to truth, counting anything already locked: if every attribute locks, the
   * displayed OVR stops being a range.
   */
  MAX_LOCKED_FRACTION: 0.6,
};

// ---------------------------------------------------------------------------
// AI GM behavior [TUNE]
// ---------------------------------------------------------------------------
export const AI = {
  /** Willingness to overpay in FA, as a multiplier on computed market value. */
  FA_MAX_OVERPAY: 1.22,
  /** AI keeps this much cap space in reserve for in-season moves. */
  CAP_RESERVE: 4_000_000,
  /**
   * Trade acceptance: AI accepts if incoming value >= outgoing * this.
   *
   * [TUNE] 1.04, down from 1.06. This is the AI's negotiating margin — the
   * edge it wants for agreeing to a deal it did not propose — and it is not
   * the only tax on a trade: TRADE_VALUE.NEED_MULT already charges an
   * incoming player the bottom of its band and an outgoing one the top, so
   * the two compound to about 1.47x on a player-for-player swap. 4% keeps a
   * visible thumb on the scale without that product reaching the point where
   * a football-literate offer reads as lopsided. It is also inside the ~9%
   * per-asset valuation noise, so a genuinely fair offer is answered
   * differently by different clubs rather than uniformly — which is what
   * shopping a player around should feel like. Note the noise is seeded per
   * club, per season, per asset (see lib/trade.ts), so this is variety
   * between front offices, never a re-roll on the same one.
   */
  TRADE_ACCEPT_RATIO: 1.04,
  /**
   * Range below the accept ratio within which the AI counters ("close, but
   * we need a bit more") rather than flatly refusing ("not enough here").
   * [TUNE] 0.35, up from 0.25: with players and picks now on one scale a
   * near-miss is usually one mid-round pick away from closing, and a deal
   * that close should say so. Purely how a refusal is worded — the accept
   * threshold above is the only thing that decides yes or no.
   */
  TRADE_COUNTER_WINDOW: 0.35,
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
    RT: 0.9, RG: 0.85, LG: 0.85, C: 0.8,
    K: 0.35, P: 0.3,
  } as Record<Position, number>,
};

/**
 * THE DRAFT PICK VALUE CHART, BY OVERALL PICK NUMBER — the real one.
 *
 * This is the Jimmy Johnson chart, transcribed as a literal table rather than
 * approximated by a curve, on the app owner's instruction: *"this is a chart
 * of draft picks value as used by the NFL"*. It is the chart front offices
 * have actually traded off since the early nineties, and it runs to exactly
 * 224 picks — which is exactly this league (LEAGUE.TEAM_COUNT 32 x 7 rounds),
 * so the pick axis maps one-to-one with no rescaling at all.
 *
 * ITS NUMBERS ARE THIS GAME'S VALUE UNITS. Everything a trade weighs —
 * players, picks, both sides of a swap — is quoted in Jimmy Johnson points,
 * so every valuation in the game is a sentence a football person can check:
 * "this man is worth 420" means "this man is worth pick 48". The tier curves
 * below are calibrated directly against it and pickValue() returns it
 * unscaled to a neutral GM, so there is no conversion factor anywhere for a
 * later change to desynchronise.
 *
 * WHAT REPLACING THE OLD EXPONENTIAL FIXED. `3000 * exp(-0.0255 * (pick - 1))`
 * tracked this table at roughly 0.55-0.65x through the middle rounds, but the
 * ratio drifted (0.55 at pick 16, 0.69 at pick 112, 2.0x too generous at pick
 * 176) and it could not hold the top of round one at all: the real chart puts
 * pick 1 at 5.1x pick 32 and 68x pick 128, the exponential put it at 2.2x and
 * 15x. A smooth curve cannot be that steep in one place and that flat in
 * another, which is why the first overall pick used to trade for barely more
 * than a mid-first.
 *
 * JIMMY JOHNSON IS FAMOUSLY TOP-HEAVY and most modern front offices use a
 * flatter successor (Rich Hill and the analytics charts) for exactly that
 * reason. The owner named this chart, so this chart is the reference; the
 * top-heaviness is then a deliberate property, not a defect — see the ceiling
 * note on TIER_CURVE for where it bites and what bounds it.
 */
const JIMMY_JOHNSON: readonly number[] = [
  // Round 1
  3000, 2600, 2200, 1800, 1700, 1600, 1500, 1400,
  1350, 1300, 1250, 1200, 1150, 1100, 1050, 1000,
   950,  900,  875,  850,  800,  780,  760,  740,
   720,  700,  680,  660,  640,  620,  600,  590,
  // Round 2
   580,  560,  550,  540,  530,  520,  510,  500,
   490,  480,  470,  460,  450,  440,  430,  420,
   410,  400,  390,  380,  370,  360,  350,  340,
   330,  320,  310,  300,  292,  284,  276,  270,
  // Round 3
   265,  260,  255,  250,  245,  240,  235,  230,
   225,  220,  215,  210,  205,  200,  195,  190,
   185,  180,  175,  170,  165,  160,  155,  150,
   145,  140,  136,  132,  128,  124,  120,  116,
  // Round 4
   112,  108,  104,  100,   96,   92,   88,   86,
    84,   82,   80,   78,   76,   74,   72,   70,
    68,   66,   64,   62,   60,   58,   56,   54,
    52,   50,   49,   48,   47,   46,   45,   44,
  // Round 5
    43,   42,   41,   40,   39,   38,   38,   38,
    37,   37,   36,   36,   35,   35,   34,   34,
    33,   33,   32,   32,   31,   31,   31,   30,
    30,   29,   29,   29,   28,   28,   27,   27,
  // Round 6
    27,   26,   26,   25,   25,   25,   24,   24,
    23,   23,   23,   22,   22,   21,   21,   21,
    20,   20,   19,   19,   19,   18,   18,   17,
    17,   17,   16,   16,   15,   15,   15,   14,
  // Round 7
    14,   13,   13,   13,   12,   12,   11,   11,
    11,   10,   10,    9,    9,    9,    8,    8,
     7,    7,    7,    6,    6,    5,    5,    5,
     4,    4,    3,    3,    3,    2,    2,    2,
];

/**
 * Chart value of an overall pick number. Clamped rather than allowed to
 * return undefined: a league configured with more teams than the chart has
 * rows would otherwise silently price its last round at NaN, and the honest
 * answer for a pick past the end of the chart is what the last pick on it is
 * worth.
 */
export const PICK_VALUE_CHART = (overallPick: number): number => {
  const i = Math.min(Math.max(Math.round(overallPick), 1), JIMMY_JOHNSON.length);
  return JIMMY_JOHNSON[i - 1];
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
 * an elite premium-position player."
 *
 * ---------------------------------------------------------------------------
 * A TIER IS BOUNDED BY THE CONVERSION MENU, NOT ALWAYS EQUAL ACROSS IT
 * ---------------------------------------------------------------------------
 * The owner's ruling: *"Why would RT be mid and LT be premium? they should be
 * same value. For the most part the position groups should be similar"*.
 *
 * There is a hard constraint underneath that preference. lib/ratings.ts offers
 * a menu of position changes and they are REVERSIBLE, so if a move to a
 * position this table pays more for leaves a man worth more, the game is a
 * money printer: buy the cheap label, convert, sell the dear one. That
 * arbitrage was live and measured at 5.5x — the same 84-rated man was 46
 * points as a right tackle and 251 as a left tackle. The connected components
 * of RELATED_POSITIONS are therefore the things this table has to reason
 * about:
 *
 *   {LT, LG, C, RG, RT}   {EDGE, DT, LB}   {CB, S}   and six singletons
 *
 * assertNoProfitableConversion() (lib/ratings.ts) fails the build if this
 * table and that menu ever drift into a state where a move PAYS; lib/ai/gm.ts,
 * the only consumer of this table, calls it at module load.
 *
 * BUT THE CONSTRAINT IS "NO MOVE MAY PAY", NOT "ONE TIER PER COMPONENT", and
 * the difference is the whole of the paragraph below. A conversion is charged
 * in rating points — `convertedAttributes` turns the uncoached-attribute fill
 * down until the move stops paying — so two connected positions may price
 * apart exactly as far as that rating cost reaches. Whether it reaches is a
 * measurement, not a judgement, and it comes out differently for the two
 * components this used to lump together:
 *
 *   EDGE/DT/LB — SPLITS. A linebacker has never been graded on `passRush`,
 *                which is 0.36 of an edge rusher's overall, so LB -> EDGE has
 *                a real lever: measured over 22,600 rostered linebackers it
 *                costs a mean of 6.2 rating points at 65-69 rising to 11.1 at
 *                92+, and PREMIUM-over-MID needs 4.36 (the tiers share a
 *                steepness, so that gap is a constant, not a curve). Feasible
 *                at every rating from 60 to 99 with room to spare; the fill
 *                only runs out around MINIMAL, which is where the assertion
 *                starts firing again. So LB prices at MID and the menu keeps
 *                the LB -> EDGE move the owner asked for by name.
 *                THIS DOES NOT HOLD ON ITS OWN. The guard checks the raw tier
 *                curve; the market prices a blend of rating and CEILING, and
 *                a conversion that left `potential` alone refunded most of
 *                itself through it — LB at MID went from 227 profitable
 *                conversions in 22,600 to 6,055. lib/ratings.ts now moves the
 *                ceiling with the rating (see THE CEILING MOVES WITH THE
 *                FLOOR); that brings it back to 763, and it is a load-bearing
 *                part of this row, not an unrelated tidy-up.
 *                DT stays with EDGE because it has NO lever — DT and EDGE
 *                weight the same attributes, so at equal ratings the engine
 *                cannot tell them apart and has nothing to charge.
 *   The OL     — DOES NOT SPLIT, however much MARKET.POSITION_MULT wants it
 *                to (LT 1.29 against LG/RG 0.85). LT, RT, LG and RG weight
 *                the IDENTICAL five attributes, so a guard and a left tackle
 *                with the same attributes are literally the same player to
 *                `computeOverall` and a slide along the line costs a measured
 *                mean of 0.31 rating points. There is nothing to charge with.
 *                Putting the interior at MID was tried and the assertion
 *                fires immediately: LG -> LT at 72 OVR, 23 points -> 48, free.
 *                The only way to buy that split is to delete guard <-> tackle
 *                from RELATED_POSITIONS, which deletes the owner's own
 *                request (*"if someone has two solid RT and a weak LT, they
 *                can't swap the spare RT over"*), so the line stays PREMIUM.
 *
 * That the OL disagreement survives is not a bug being tolerated, it is two
 * tables measuring two different things: MARKET.POSITION_MULT prices the JOB
 * (left tackle is a scarcer job than left guard, so it costs more to fill),
 * and this table prices the MAN (and the ratings model says those two men are
 * the same man). The EDGE/LB case was the one where the men really are
 * different — an edge rusher's defining attribute is one a linebacker does
 * not have — and that is the one that moved.
 *
 * Where the tiers land, against real NFL trade comparables:
 *
 *   QB       — its own tier and by a clear margin. Three firsts for a
 *              franchise passer is a real price teams have paid.
 *   PREMIUM  — WR, the offensive line, and the EDGE/DT front. The trenches
 *              and the receivers: unified OL franchise tag, DE/DT and WR tags
 *              all sit within a few percent of each other at the top of the
 *              non-QB market, and elite ones fetch a genuine first.
 *   MID      — CB/S, TE and LB. Real starters whose trade market is visibly
 *              softer than the trenches: corners have gone for a third
 *              (Sneed) and a third-plus-change (Lattimore), the best tight
 *              ends for a third (Waller), and the off-ball linebacker market
 *              is the same shape — a good one fetches a second and a fifth
 *              (Roquan Smith), which is what MID pays at 88.
 *   LOW      — RB. Genuinely devalued in the modern game, and capped: even
 *              the best back in football tops out around second-round money.
 *   MINIMAL  — K/P. Near-worthless in trade without being literally zero,
 *              because a replacement is always close by.
 */
export type TradeValueTier = 'QB' | 'PREMIUM' | 'MID' | 'LOW' | 'MINIMAL';

/** Career-arc shapes, kept separate from the trade tiers — see AGE_CURVE. */
export type AgeArc = 'QB' | 'SPEED' | 'STURDY' | 'BACK' | 'SPECIALIST';

export const TRADE_VALUE_TIER: Record<Position, TradeValueTier> = {
  QB: 'QB',
  // Bounded by the conversion menu — see the block above before editing. A
  // split within a component is legal only where the rating cost of the move
  // covers it; the OL and EDGE<->DT have no lever and must stay level.
  WR: 'PREMIUM',
  LT: 'PREMIUM', LG: 'PREMIUM', C: 'PREMIUM', RG: 'PREMIUM', RT: 'PREMIUM',
  EDGE: 'PREMIUM', DT: 'PREMIUM',
  CB: 'MID', S: 'MID',
  TE: 'MID',
  LB: 'MID', // paid 0.73 against EDGE 1.47; LB -> EDGE costs the rating to match
  RB: 'LOW',
  K: 'MINIMAL', P: 'MINIMAL',
};

export const TRADE_VALUE = {
  /**
   * Per-tier curve: value = min(ceiling, (exp(max(0, ovr - replacementLevel)
   * * steepness) - 1) * scale). `replacementLevel` is the OVR where trade
   * surplus starts being counted at all (a below-replacement player is
   * theoretically a zero/negative asset, floored at a small positive number
   * so the math never inverts); `steepness` is how fast surplus compounds
   * into value; `scale` is the height.
   *
   * `ceiling` CAPS THE FINISHED VALUATION, not the base curve — see the end
   * of playerValueDetailed, which applies it after age, contract, fit,
   * scarcity, cap and noise have all been multiplied in. That is what makes
   * it a real bound: no stack of favourable modifiers on a cheap young
   * in-demand player can carry any position past what that position can ever
   * be worth. (This comment used to claim the opposite. It was wrong about
   * the code, which is worse than saying nothing.)
   *
   * -------------------------------------------------------------------------
   * CALIBRATED IN JIMMY JOHNSON POINTS — the same units PICK_VALUE_CHART
   * returns, unscaled. A value here IS a pick number, and every row below is
   * a claim about football that can be checked by reading it aloud:
   *
   *   pick   1 = 3000    pick  16 = 1000    pick  48 = 420    pick  96 = 116
   *   pick   5 = 1700    pick  32 =  590    pick  64 = 270    pick 144 =  34
   *
   * THE ANCHORS, and the real trades behind them. Real NFL trades are the
   * source of truth (the owner's ruling); dynasty markets such as KeepTradeCut
   * are one more data point and are cited nowhere below, because they price
   * only skill positions — no linemen, no linebackers, no defensive backs,
   * which is more than half a starting lineup and the whole of MID.
   *
   *   QB       94 ~ 2799, about the first overall pick; 96 ~ 3796; 98+ clips
   *            at the 5000 ceiling, four to five mid-firsts. The owner's
   *            anchor: *"Josh Allen in the real nfl would go for at least 4
   *            or 5 first round pick equivalents"*. 91 ~ 1783 is the Stafford
   *            package (two firsts and a third); 85 ~ 716 a late first.
   *   PREMIUM  94 ~ 1457 (pick 8), 96 ~ 1957 (pick 4). Mack cost two firsts
   *            and a third against a second coming back (~1765); Tunsil two
   *            firsts and a second; Hill a first, a second and three later
   *            picks (~1205). 88 ~ 597 is a late first, which is what a
   *            Pro-Bowl receiver or tackle actually fetches; 82 ~ 241 a
   *            third; 78 ~ 130 a late third.
   *   MID      94 ~ 766 (pick 23) — Fitzpatrick went for a first, Ramsey for
   *            two and a fourth, and the elite corner market is genuinely
   *            that bimodal. 88 ~ 313 (a late second): Sneed went for a
   *            third, Lattimore for a third and change, Waller for pick 100.
   *   LOW      94 ~ 442 (a mid second) and the ceiling at 750 is the
   *            McCaffrey package itself (a second, third, fourth and fifth ~
   *            713). 90 ~ 243, a third — Swift went for a fourth and the best
   *            backs of the last few years reached free agency untraded.
   *   MINIMAL  99 ~ 32, a fifth. 94 ~ 16, a sixth. Never zero, never a real
   *            asset, and the ceiling stops even a club with no kicker at all
   *            from paying more than a low fifth for one.
   *
   * WHERE THE CEILINGS COME FROM, each derived from the same anchor rather
   * than inherited: QB 5000 = five mid-firsts, so the best quarterback in the
   * game out-prices the first overall pick decisively, which is the real
   * answer and why nobody trades that man for a lottery ticket. PREMIUM 2100
   * = two mid-firsts, the most any veteran non-quarterback has actually cost.
   * MID 1500 = a first and a high second, Ramsey's price. LOW 750 = the
   * McCaffrey package. MINIMAL 40 = a low fifth.
   *
   * STEEPNESS IS SHARED ACROSS PREMIUM/MID/LOW (0.147) ON PURPOSE. Curves
   * with their own steepness made the gap between tiers swing with rating —
   * an older pass at this had PREMIUM at 5.5x MID at 78 and 2.4x at 94 — so
   * the same relabel was worth wildly different amounts depending on who you
   * did it to. One steepness makes the positional gap a stable multiple; the
   * economics live in `replacementLevel` (a replacement kicker is a 68, a
   * replacement quarterback a 58) and `scale`. QB is steeper still (0.150),
   * because quarterback scarcity genuinely compounds at the top; MINIMAL is
   * flatter (0.135), because the best kicker alive is still a kicker.
   *
   * Ordering QB > PREMIUM > MID > LOW > MINIMAL holds at every rating from 60
   * to 99. QB runs about 1.9x PREMIUM and 3.6x MID at equal rating, widening
   * to 2.4x / 3.3x at the very top where the ceilings bind — a clear margin
   * for the most valuable job in the sport, and nothing like the 18.3x this
   * table used to charge at rating 88.
   */
  TIER_CURVE: {
    QB: { replacementLevel: 58, steepness: 0.150, scale: 12.70, ceiling: 5000 },
    PREMIUM: { replacementLevel: 60, steepness: 0.147, scale: 9.90, ceiling: 2100 },
    MID: { replacementLevel: 62, steepness: 0.147, scale: 7.00, ceiling: 1500 },
    LOW: { replacementLevel: 64, steepness: 0.147, scale: 5.44, ceiling: 750 },
    MINIMAL: { replacementLevel: 68, steepness: 0.135, scale: 0.494, ceiling: 40 },
  } as Record<TradeValueTier, { replacementLevel: number; steepness: number; scale: number; ceiling: number }>,

  /**
   * HOW A CAREER ARCS IS A DIFFERENT QUESTION FROM WHAT A POSITION IS WORTH,
   * and these used to be the same table. Age curves were keyed on
   * TradeValueTier, which was harmless only because the old tiers happened to
   * sort roughly by career length. Re-tiering by conversion component broke
   * that coincidence: the offensive line and the front seven moved to
   * PREMIUM, and would have silently started ageing like wide receivers —
   * declining from 29 at 7.5% a year, when a left tackle is the position that
   * ages BEST in football. So the arcs get their own names and their own
   * mapping below, and no position's ageing changed when the tiers did.
   *
   * `declineStart`/`declinePerYear` model the back half; `youthThreshold`/
   * `youthPremiumPerYear` model the age-control premium teams pay for a
   * player who'll still be great years from now. Backs decline earliest and
   * fastest; quarterbacks and specialists latest (leg talent doesn't erode
   * like a 25-year-old's speed does).
   */
  AGE_CURVE: {
    QB: { declineStart: 34, declinePerYear: 0.035, youthThreshold: 26, youthPremiumPerYear: 0.025 },
    SPEED: { declineStart: 29, declinePerYear: 0.075, youthThreshold: 25, youthPremiumPerYear: 0.035 },
    STURDY: { declineStart: 30, declinePerYear: 0.06, youthThreshold: 25, youthPremiumPerYear: 0.03 },
    BACK: { declineStart: 26, declinePerYear: 0.12, youthThreshold: 24, youthPremiumPerYear: 0.05 },
    SPECIALIST: { declineStart: 33, declinePerYear: 0.02, youthThreshold: 26, youthPremiumPerYear: 0.012 },
  } as Record<AgeArc, { declineStart: number; declinePerYear: number; youthThreshold: number; youthPremiumPerYear: number }>,

  /**
   * Which arc each position ages on. CONSTANT ACROSS A CONVERSION COMPONENT,
   * for exactly the reason the trade tiers are: a free position change must
   * not move a man's price, and the age multiplier is part of his price.
   * Keying arcs per-position reopened the arbitrage in the age dimension — an
   * old left tackle relabelled a guard was measured at 1.10x mean and 2.49x at
   * worst, purely by escaping the receivers' decline curve. lib/ai/gm.ts runs
   * lib/ai/gm.ts checks this map directly, right beside the trade-value check:
   * an age arc is a table, not an outcome, so assertNoProfitableConversion
   * (which only ever sees value at a rating) cannot see a split in it.
   *
   * That constraint settles three cases the old tier-keyed lookup split down
   * the middle, and the football answer agrees with it in all three:
   *   - the whole offensive line is STURDY. It was LT alone on SPEED, which
   *     was always wrong — left tackle is the position that ages BEST in
   *     football, not like a wide receiver.
   *   - the whole EDGE/DT/LB front is STURDY. Edge rushers were on SPEED;
   *     interior rushers and off-ball backers hold up into their thirties and
   *     the great edge rushers largely have too.
   *   - both defensive backs are SPEED. Safety was on STURDY; corner is the
   *     most speed-dependent job on the field after running back and the
   *     component has to take the corner's arc.
   */
  AGE_ARC: {
    QB: 'QB',
    WR: 'SPEED',
    CB: 'SPEED', S: 'SPEED',
    LT: 'STURDY', LG: 'STURDY', C: 'STURDY', RG: 'STURDY', RT: 'STURDY',
    EDGE: 'STURDY', DT: 'STURDY', LB: 'STURDY',
    TE: 'STURDY',
    RB: 'BACK',
    K: 'SPECIALIST', P: 'SPECIALIST',
  } as Record<Position, AgeArc>,

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
  /**
   * [TUNE] WHAT A DEAD DOLLAR COSTS, IN JIMMY JOHNSON POINTS.
   *
   * This replaces CONTRACT_MULT_MIN, which was 0.60 and was the constant that
   * capped how bad a contract could ever look. Two floors made that cap
   * unrecoverable — playerValueDetailed returned `Math.max(1, total)` and
   * assetValues did `Math.max(1, value - deficit * tax)` — so the worst deal
   * in the game reduced a man to 60% of a talent value that was itself
   * floored at one point. A 62 corner owed $135.4M over five years priced at
   * 1.0, and thirty of the league's thirty-one clubs took him for nothing.
   *
   * A multiplier could never have fixed it. `base` is surplus over
   * REPLACEMENT LEVEL, so a replacement-level man is worth exactly zero before
   * any multiplier runs, and zero times a negative is still zero. The bill has
   * to be SUBTRACTED, which means it has to be denominated — hence this.
   *
   * THE ANCHOR, in one checkable football sentence: burning a full season's
   * salary cap on a man who gives you nothing costs about what a cornerstone
   * is worth. PACKAGE.HEADLINE_THRESHOLD puts a cornerstone at 800 points and
   * this is 900, a shade dearer, because a cap year is spent and a cornerstone
   * is still on your roster afterwards.
   *
   * Read against real trades at the sizes that actually happen:
   *   $22M above market   0.09 cap-years  ~  78 pts, a fourth-rounder. That is
   *                       roughly what clubs have really paid to have a bad
   *                       contract absorbed.
   *   $60M above market   0.24 cap-years  ~ 212 pts, a third.
   *   $130M above market  0.51 cap-years  ~ 459 pts, a second — the $135.4M
   *                       albatross, which now costs a real pick to be rid of
   *                       instead of being a gift somebody thanks you for.
   *
   * It is deliberately linear and deliberately not steeper. The bar this has
   * to clear is "a liability must cost something", and an AI that refuses
   * every trade is worse than one that accepts too many — the market is most
   * of this game. Measured against the ordinary-trade sweep in
   * scripts/_lb_trade.ts, this leaves fair player-for-picks and man-for-man
   * deals accepted at the same rate as before.
   */
  CONTRACT_BURDEN_PER_CAP_YEAR: 900,

  /**
   * [TUNE] HOW FAR OVER MARKET A DEAL GOES BEFORE ANYONE CALLS IT BAD.
   *
   * `marketValue` in lib/cap.ts carries a [FRAGILE PLACEHOLDER] tag and rounds
   * to $100K, and no front office in football looks at a man a million and a
   * half over the estimate and calls him an albatross. Without a band the
   * burden charged that noise: an 85-overall punter at $3.5M against a $2.3M
   * market — an ordinary deal, one year left — came out a NEGATIVE asset,
   * because his entire trade value is about four points and $1.2M is worth
   * four. (scripts/benchmarkTradeValue.ts catches exactly that, and did.)
   *
   * FLAT DOLLARS, NOT A PERCENTAGE OF MARKET. A 20% band would forgive $1.2M
   * on the punter and $8M a year on a quarterback, which is forgiveness that
   * grows precisely where the money is. The mispricing this exists to absorb
   * is the estimator's, and the estimator's error is roughly a fixed number of
   * dollars, not a fixed share of a salary.
   *
   * Stated against CAP.BASE_CAP like the rate above — about 0.8% of a cap.
   * It costs the albatross case almost nothing: the $135.4M contract goes from
   * $129.9M over market to $119.9M, still a second-round pick to be rid of.
   */
  CONTRACT_FAIR_BAND_PER_YEAR: 2_000_000,
  CONTRACT_MULT_MAX: 1.30,

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
   * =========================================================================
   * THREE PRICES, NOT ONE — THE BID/ASK SPREAD AND THE CLUB'S WINDOW
   * =========================================================================
   * A club does not have a price for a player. It has two, and which one you
   * meet depends on which way he is travelling:
   *
   *   ASK   what it costs to pry one of ITS players loose  = V x (1 + poach)
   *   BID   what it will give you for one of YOURS         = V x (1 - haircut)
   *
   * DIFFICULTY SETS THE WIDTH OF THAT SPREAD, and that is deliberately not
   * the same thing as moving the acceptance threshold. The research paper's
   * "Failure 5" is difficulty settings that only make every deal need more
   * value — which is what `aiAcceptsLopsided` does today. A spread instead
   * makes the DIRECTION of a trade matter, so the skill on HARD is finding a
   * club that actually wants what you have rather than finding more points.
   *
   * PICKS ARE EXEMPT, and that is what keeps it from collapsing back into a
   * threshold. A spread applied to everything is algebraically identical to
   * raising TRADE_ACCEPT_RATIO. Applied to players only, it prices the thing
   * it is actually about — prying a man off a roster and out of a building —
   * and leaves pick-for-pick trades at chart value, where a chart belongs.
   *
   * BAD_CONTRACT_TAX is the app owner's specific ask: on the hardest setting,
   * dumping a burden should cost real compensation, because the club taking
   * it on is doing you a favour. It multiplies the contract DEFICIT the
   * valuation already found, so it is silent on a fair deal and bites hard on
   * a toxic one — no separate judgement about what a bad contract is.
   */
  SPREAD: {
    /** ASK: markup on a PLAYER the AI is being asked to give up. */
    POACH_PREMIUM: { EASY: 0.03, NORMAL: 0.07, HARD: 0.18 } as Record<string, number>,
    /** BID: markdown on a PLAYER the AI is being asked to take in. */
    DUMP_HAIRCUT: { EASY: 0.03, NORMAL: 0.07, HARD: 0.18 } as Record<string, number>,
    /** Extra charge, as a share of the contract deficit, for absorbing a bad deal. */
    BAD_CONTRACT_TAX: { EASY: 0.1, NORMAL: 0.25, HARD: 0.6 } as Record<string, number>,

    /**
     * -----------------------------------------------------------------------
     * THE CLUB'S WINDOW — WHY A REBUILDER TAKES 915 IN PICKS AND NOT IN MEN
     * -----------------------------------------------------------------------
     * The app owner's case, in his words: a bad club "might sell a 1000 point
     * asset for [a] 915 point draft pick". The clarification is the whole
     * mechanism — it is not that rebuilding clubs are cheap, it is that they
     * want a DIFFERENT KIND of asset back. Picks are what a rebuild is for.
     *
     * So this is not a discount on the man being sold. It is a change in what
     * the club thinks every asset is worth, applied wherever that asset
     * appears, and the 915 falls out of it: to a rebuilder a future pick
     * really is worth more than the chart says and a 30-year-old starter
     * really is worth less, so 915 neutral points of picks clears his price
     * and 915 neutral points of veteran does not. Pricing it this way rather
     * than as a second scalar is also what stops it double-counting with the
     * roster-fit term, which answers a different question entirely (does he
     * improve our lineup, not do we want him now or later).
     *
     * WINDOW_SWING is how far a club at the extreme of `winNow` moves a
     * player's price; the paper puts the buyer band at roughly +/-15% and
     * this sits just inside it. FUTURE_DISCOUNT_* does the same job for
     * picks: everyone marks a further-out pick down, a contender much harder
     * (paper does not help him win this year), a rebuilder barely at all.
     */
    /**
     * [TUNE] 0.13, set against the app owner's own number: a fully rebuilding
     * club should price a 31-year-old starter at about 0.91 of neutral, so
     * that 915 points of draft capital clears a 1000-point veteran. 31 is
     * four years past the pivot over a six-year span = 0.67 of the full
     * reading, and 1 - 0.67 x 0.13 = 0.913.
     */
    WINDOW_SWING: 0.13,
    /** Age at which a player is neither a "future" asset nor a "win now" one. */
    WINDOW_PIVOT_AGE: 27,
    /** Years either side of the pivot that reach the full future/now reading — 33+ is all "now", 21 and under all "later". */
    WINDOW_AGE_SPAN: 6,
    /** Value kept per draft beyond the next one, for a club with no window lean. */
    FUTURE_DISCOUNT_BASE: 0.85,
    /** ...swung this far by the club's window: a contender discounts paper, a rebuilder hardly does. */
    FUTURE_DISCOUNT_SWING: 0.22,

    /**
     * Bounds on fitMult x windowMult TOGETHER. The two are different
     * questions and legitimately compose — a contender that also has a hole
     * really does want a ready starter twice over — but their product must
     * not run away, and checking it here is how "never apply the spread
     * twice" stops being a hope. Measured on the probe save, the product
     * reaches these bounds only at the extremes and sits inside 0.85-1.25 for
     * 95% of club/player pairs.
     */
    FIT_WINDOW_MIN: 0.72,
    FIT_WINDOW_MAX: 1.36,
  },

  /**
   * =========================================================================
   * PACKAGE QUALITY — FOUR QUARTERS ARE NOT A DOLLAR
   * =========================================================================
   * A trade is judged on what the piles CONTAIN, not only on what they add
   * up to. Without this the arithmetic says six backups equal one star, and
   * every trade economy that has shipped without it has been broken the same
   * way: aggregate junk until the sum clears the threshold. The research the
   * app owner commissioned calls this out by name ("the major dynasty-
   * calculator failure: four quarters for a dollar") and it is the one
   * exploit class this engine had no defence against at all.
   *
   * TWO RULES, AND THEY DO DIFFERENT JOBS.
   *
   * CONCENTRATION discounts the tail of a pile. The best asset counts fully,
   * the second nearly so, and it falls away from there — a roster fields
   * eleven men at a time and holds 53, so the fifth piece of a package is
   * worth genuinely less to the club receiving it than its price tag says.
   * Weights are the research's (100/95/85/70, then 50-60%).
   *
   * THE HEADLINE RULE is the one that actually stops the exploit. Moving a
   * cornerstone requires getting back at least one asset that is itself a
   * real piece: no quantity of depth adds up to a man of that class, because
   * what the seller is short of afterwards is not points, it is a player
   * nobody else has. Sized as the research suggests (35-50% of the man being
   * moved; 40% here).
   *
   * BOTH SIDES ARE WEIGHTED THE SAME WAY, which is deliberate and is the
   * property that keeps the rule safe. If a bundle were discounted only when
   * received, the same assets would be worth different amounts depending on
   * which way they were travelling, and a user could trade a pile for a star
   * and the star back for the pile, manufacturing value on every lap. (That
   * is invariant 14 of the research's anti-exploit list, and it is checked in
   * scripts/_tradeEquate.ts.) Judging both piles by one rule makes a
   * round trip exactly neutral by construction.
   */
  PACKAGE: {
    /** Weight on the 1st, 2nd, 3rd... most valuable asset in a pile. */
    CONCENTRATION: [1, 0.95, 0.85, 0.7] as number[],
    /** Everything past that list. */
    CONCENTRATION_TAIL: 0.55,
    /**
     * A single asset worth this much is a cornerstone and triggers the
     * headline rule. 800 JJ points is about a mid-first — an 89-90 at a
     * premium position, a 92 corner, or a genuine franchise quarterback.
     * Below it, a club is trading a good player rather than a pillar, and
     * quantity is a legitimate way to pay.
     */
    HEADLINE_THRESHOLD: 800,
    /** ...and then at least one asset coming back must be worth this share of him. */
    HEADLINE_SHARE: 0.4,
    /**
     * ...OR the package must contain at least this many first-round-quality
     * assets, which is the research's own second clause and is not optional:
     * without it the rule blocks the most classic real trade in the sport.
     * Two firsts for a franchise quarterback has a headline asset worth only
     * about a quarter of him, and the Rams, the Bears and the Texans all made
     * that trade. What makes such a package acceptable is not one enormous
     * piece, it is that both pieces are premium — so that is what gets
     * checked. "First-round quality" is read off the chart itself, at the
     * value of the LAST pick of round one, so it stays true if the league
     * ever changes size.
     */
    HEADLINE_PREMIUM_COUNT: 2,
  },

  /**
   * Team-need multiplier, replacing the old flat AI.NEED_MULT=1.25 for
   * every position uniformly. Bounded as real front offices behave: a team
   * that's set at a position pays LESS for a redundant asset (not just "no
   * bonus," an actual discount), and even desperate need has a hard ceiling
   * — "we have no punter" is never a reason to pay a first-round price for
   * one.
   *
   * NARROWED FROM 0.72/1.28, AND THE WIDTH IS THE POINT. This multiplier is
   * applied to BOTH sides of a trade, and the two sides pull opposite ways:
   * a club prices its own starter at the top of the band (losing him drops
   * its depth chart) and prices an incoming man at the bottom (it already
   * has one). So the band's width is a tax on every player-for-player trade
   * in the game, and it compounds with AI.TRADE_ACCEPT_RATIO:
   *
   *   0.72 / 1.28  =>  1.78x, and 1.88x once the accept ratio is applied
   *   0.85 / 1.20  =>  1.41x, and 1.47x
   *
   * At the old width a club would not swap two genuinely comparable starters
   * unless one side sent nearly twice the value — which is the "sending far
   * more than you get is still refused" report, and it is an artefact of
   * charging the same preference twice rather than a judgement about
   * football. Narrowing it does not weaken the depth-chart read that feeds
   * it (see rosterFit in lib/ai/gm.ts): an obvious upgrade still reaches the
   * top of the band and a redundant body still sits at the bottom. It only
   * stops the two ends being 78% apart.
   */
  NEED_MULT_MIN: 0.85, // no need / already deep — a discount, not a refusal
  /*
   * A DESPERATE CLUB HAS TO BE ABLE TO ACT DESPERATE. [TUNE]
   *
   * 1.20 was too narrow to express the thing this multiplier exists for. The
   * owner's case: a win-now club with $108M of room and a 68 at quarterback
   * refused a legitimate starter, and at a +20% ceiling it could not have done
   * otherwise — even a club with NOTHING at the position could only bid a
   * fifth more than one that was set there.
   *
   * Real football is not that flat. Denver sent Seattle two firsts, two
   * seconds, two thirds and three players for a quarterback; the Rams sent two
   * firsts and a third for one. Those are not valuations, they are a club with
   * a hole at the one position that decides games, paying what it takes.
   *
   * Widened to 1.40 rather than further because this multiplier is applied to
   * BOTH piles: it is what a club pays for what it needs AND what it holds out
   * for on what it would be giving up, so the distance between the two ends is
   * a friction on every player-for-player swap. 0.85 to 1.40 is a 1.65x span,
   * still well inside the 1.78x that was measured as too punishing.
   */
  NEED_MULT_MAX: 1.40,
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
