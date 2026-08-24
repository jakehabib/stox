import { Rng, clamp } from './rng';
import { GENERATION, type Position } from './tuning';
import { marketValue } from './cap';
import { bendToCeiling, bendToFloor } from './gen/players';
import type { GeneratedPlayer } from './gen/players';
import type { LeagueSettings } from './settings';

/**
 * ===========================================================================
 * THE REBUILD
 * ===========================================================================
 * A third `LeagueStart`, and deliberately nothing more than that. It is the
 * ordinary randomized-rosters league — same generator, same thirty-two clubs,
 * same market — dealt a different STARTING HAND at one club: yours. There is
 * no second season machine, no second sim and no second set of rules for how
 * football works, because a mode that forks the game is a mode that drifts
 * away from it.
 *
 * What it changes is three facts about the club you take over and one rule
 * about what you may change afterwards.
 *
 *   THE ROSTER    is the bottom of the league, on purpose, and bad in a way
 *                 you can fix — see THE HAND below.
 *   THE BOOKS     are ugly and legal: very little room, a mountain of the last
 *                 regime's dead money, and a handful of contracts you would
 *                 not have signed. See THE BOOKS.
 *   THE RULES     are locked while the run is live. See IRONMAN.
 *
 * AND THE COPY IS WRITTEN TO THE MEASUREMENT, NOT THE OTHER WAY AROUND. The
 * club is confirmed by simulation to show 31st or 32nd of 32 on the rating the
 * dashboard prints, and to win between three and five games off the roster as
 * generated. It says "the bottom of the league" everywhere a player can read
 * it, because "the worst roster in football" is a place it reaches about half
 * the time and a claim it cannot keep — see STRENGTH_MARGIN_MIN for what
 * forcing the stronger claim actually cost.
 *
 * ---------------------------------------------------------------------------
 * THE ONE THING THAT COULD RUIN IT: STARTING OVER THE CAP
 * ---------------------------------------------------------------------------
 * lib/season.ts refuses to advance a week while the user's own club is over
 * the ceiling. A REBUILD save dealt an over-cap hand would therefore be FROZEN
 * ON TURN ONE — not hard, broken.
 *
 * SO THE ROOM IS THE THING THAT IS DRAWN, and everything else is solved to fit
 * behind it. `rebuildCapRoom` returns a strictly positive number of dollars —
 * positive by construction, because it is a lognormal (an exponential of a
 * normal, which cannot be zero or negative at any input) bent at BOTH ends,
 * toward a floor it never reaches and a ceiling it never reaches. The club's
 * books are then filled up to `ceiling - room` and never past it. There is no
 * subtraction anywhere that can go negative and no clamp anywhere holding the
 * line: `used < ceiling` is arithmetic.
 *
 * This replaced a version that bounded the two SPENDING terms instead and
 * argued their bounds summed to 0.98. That was safe too, but it could only
 * promise a room somewhere under 2% of the ceiling — it could not promise a
 * room BETWEEN one and eight million, which is what the mode now needs. Draw
 * the quantity you have to guarantee; solve for the ones you do not.
 *
 * Everything else that is randomised here is shaped the same way: extremes get
 * steadily less likely rather than being chopped off and stacked on a bound.
 * ===========================================================================
 */

/** [TUNE] Every number the mode is dealt with. Measured values are marked. */
export const REBUILD = {
  /**
   * MEASURED. How far below an average club the roster is generated, in the
   * same units as `strengthByAbbr` in lib/gen/league.ts — points added to
   * every overall target on the roster.
   *
   * Calibrated against a real 32-club league (scripts/_rb_base.ts: 32 clubs x
   * 12 simulated seasons of their own schedule, every club measured, no
   * slice): off+def unit rating ran 141.0 to 171.0 with a mean of 157.5, and
   * regressed on expected wins at `wins = -44.50 + 0.3363 x (off+def)`. The
   * club at the floor of that range won 3.67 games.
   *
   * THIS NUMBER IS ONLY HALF OF THE ANSWER — see rebuildTeamStrength, which
   * takes the WORSE of this and "a shade below the worst club this league
   * actually rolled". An absolute target alone fails in both directions, and
   * both were measured rather than reasoned about: at -8.0 the hand came out
   * third-worst in one league and fourth-worst in another, because the other
   * thirty-one are drawn from N(0, 4) and some of them roll very low; and a
   * fixed rating cannot promise a record either, because a league whose clubs
   * bunch tightly makes its worst club a six-win team while one with a strong
   * top makes its worst club a two-win team at the same rating.
   *
   * WHAT IS AND IS NOT PROMISED, because the loose version of this is exactly
   * the kind of overclaim this project treats as a defect:
   *
   *   THE WORST *STRENGTH* IS GUARANTEED. The worst realised unit RATING is
   *   not. Strength is the mean a roster's ratings are drawn around; what a
   *   club ends up rated is that plus fifty individual rolls, which move it
   *   two or three points on their own. Measured, a club generated strictly
   *   below every other one came out second-worst on rating — and won the
   *   fewest games in its league anyway. STRENGTH_MARGIN_MIN exists to clear
   *   that noise; the honest claim is "at or within a point of the bottom".
   *
   *   A WIN TOTAL IS NOT PROMISED AT ALL. Measured across real leagues, the
   *   same off+def of 145 produced 4.42 wins in one and 5.67 in another,
   *   because a record depends on the schedule drawn and on how far the rest
   *   of the league is spread. About four is the centre and two to six is the
   *   range; no value of this constant narrows it, and tuning further would be
   *   tuning against noise.
   *
   * The SD is real spread, not decoration: two REBUILD saves should not open
   * on the same roster. It came down from 1.4 in the same pass, because at 1.4
   * the spread of what got DEALT was wider than the gap between a three-win
   * club and a six-win one.
   */
  STRENGTH_MEAN: -9.25,
  STRENGTH_SD: 0.9,
  /**
   * WHERE THE SEARCH FOR A LAST-PLACE ROSTER STARTS, as a margin below the
   * worst club this league actually rolled. `rebuildTeamStrength` opens here
   * and lib/gen/league.ts walks down from it until the club is genuinely 32nd
   * (see THE RANK IS A GUARANTEE) — so this is an opening bid, not the answer.
   *
   * IT IS SMALL, AND THAT IS THE WHOLE LESSON OF THIS TUNING PASS. Trying to
   * buy the guarantee with a big margin failed twice over: at 2.2 the club was
   * STILL only 32nd in five leagues of six, and the leagues it did win opened
   * 10 to 15 rating points clear of the field, won 1.3 games and — because a
   * worse roster is a cheaper roster — carried up to $71.0M of cap room. The
   * guarantee comes from conditioning on the result now, so the opening bid's
   * only job is to start near the floor rather than far below it. Starting
   * near it is what keeps the finished club expensive enough for the inherited
   * contracts to fill its books, and close enough to 31st to be worth playing.
   */
  STRENGTH_MARGIN_MIN: 0.2,
  STRENGTH_MARGIN_SD: 0.3,
  /**
   * How far the roster drops each time it fails to be the worst in its league
   * — the walk down, in lib/gen/league.ts, that turns the opening bid above
   * into a guarantee.
   *
   * IT IS ONLY THE EPSILON. The walk moves by the amount it MISSED by plus
   * this, because a club's overall tracks its strength about one-for-one — see
   * the note at the walk itself. This is just the nudge that turns "level with
   * the worst club" into "below it".
   *
   * FINE ON PURPOSE, BECAUSE THE STEP *IS* THE OVERSHOOT. Whatever the walk
   * takes past the finish line is roster quality thrown away, and measured, it
   * is thrown away twice over: a cheaper roster is also one the inherited
   * contracts cannot fill the books with. At 0.6 the rating gap to 31st ran 2
   * to 8 points and the cap room tracked it almost exactly — $4.97M at a gap
   * of 2, $71.0M at a gap of 8. Landing nearer the boundary is both the better
   * game and the tighter cap.
   */
  RANK_STEP: 0.2,
  /** A termination bound, not a policy — the walk is in memory and cheap. */
  RANK_MAX_ATTEMPTS: 200,
  /**
   * Extra rosters drawn once one has qualified, so the DEAREST roster that is
   * still last can be kept rather than the first one that got there. See the
   * walk in lib/gen/league.ts — this is what stops a lucky-low draw handing
   * the other thirty-one clubs a bye week.
   */
  RANK_REFINE_DRAWS: 6,

  /**
   * THE HAND IS OLD, NOT STRIPPED. The previous front office kept its own
   * veterans a year or three too long, so the men at the top of this depth
   * chart are past their runway — same ratings, no ceiling left, and about to
   * start declining. The young men on the roster are untouched, which is the
   * whole difference between a rebuild and a sentence: the fixable part is
   * still there.
   *
   * Chance of being an inherited veteran runs from AGED_P_FLOOR at the bottom
   * of the depth chart to AGED_P_FLOOR + AGED_P_SPAN at the top — the club's
   * best players are the ones most likely to be its oldest, which is exactly
   * the shape of a roster that won three years ago and has not moved on — and
   * is then scaled by how old the man already is (AGE_GATE_*), so a
   * twenty-three-year-old is never one of them however good he is.
   *
   * THAT SECOND FACTOR IS NOT A REFINEMENT, IT IS THE FIX. Without it,
   * measured against the other thirty-one clubs in the same league, the
   * rebuild club came out with FOUR men aged 24 or under against a league
   * median of thirteen — which is not a club that kept its veterans too long,
   * it is a club with no future, and the whole design rests on the future
   * being intact. The old guard gets older; the kids are left alone.
   */
  AGED_P_FLOOR: 0.10,
  AGED_P_SPAN: 0.50,
  /** No chance of ageing at or below this age; full chance at or above HIGH. */
  AGE_GATE_LOW: 24,
  AGE_GATE_HIGH: 29,
  AGE_SHIFT_MEAN: 4.0,
  AGE_SHIFT_SD: 1.6,
  /** Where the age curve starts bending toward the world's oldest man. */
  AGE_BEND_KNEE: 30,

  /**
   * =========================================================================
   * THE BOOKS: DRAW THE ROOM, SOLVE FOR THE REST
   * =========================================================================
   * The app owner asked for two things at once — "a less ideal cap situation
   * AND league worst roster", with room varying run to run, "some rosters have
   * ~1M in cap spcae, some have 7M etc." Those pull against each other, and
   * the reason is measured and written down in this file already: the market
   * curve is exponential, so nine rating points off a club takes two thirds
   * off its payroll. A WORSE ROSTER IS A CHEAPER ROSTER, so every attempt to
   * make the club more hopeless hands it more cap room. Measured: widening the
   * roster margin to force a last-place rating moved the club to $55.2M of
   * space, the opposite of the intent.
   *
   * So the room is not a residue any more, it is the input. It is drawn first,
   * strictly positive, in the band the owner named; the payroll and the dead
   * money are then solved to consume exactly what is left.
   *
   * AND THE INSTRUMENT THAT CONSUMES IT IS THE ALBATROSS CONTRACTS, not more
   * dead money. That is the whole trick, and it is the one lever that gets
   * tighter BECAUSE the roster got worse rather than in spite of it: a wrecked
   * club's payroll is bad players on deals nobody would sign. Piling on dead
   * money instead was tried in the first version of this design and produced
   * $131.7M owed to men who had left against a $107.1M payroll — safe, legal
   * and absurd. Scaling the NUMBER of inherited deals keeps every single
   * contract honestly priced at what that man was worth at his peak, and lets
   * the total reach whatever the target needs.
   */
  /**
   * The room, as a share of the ceiling. ~$4.0M median on a $255.0M cap, and
   * the SPREAD IS THE POINT — with the rank now fixed at 32nd every time (see
   * STRENGTH_MARGIN_MIN), this and the pick forfeits are where one run stops
   * feeling like the last one. A log SD of 0.55 puts two thirds of runs
   * between $2.3M and $6.9M.
   */
  ROOM_MEDIAN_SHARE: 0.0157,
  ROOM_LOG_SD: 0.55,
  /**
   * Both ends are bends, not caps, and the LOW one is the safety property.
   * `bendToFloor` compresses toward its floor and never reaches it, so the
   * room is always strictly greater than ROOM_FLOOR_SHARE of the ceiling —
   * about $0.9M — however badly the draw goes. A club with $0.9M of room can
   * still advance; a club with $0 of room cannot, and one with -$0.1M is a
   * save that never plays a down.
   */
  ROOM_FLOOR_KNEE: 0.0098,
  ROOM_FLOOR_SHARE: 0.0035,
  /** ~$8.4M, approached and never reached — the top of the owner's band. */
  ROOM_CEIL_KNEE: 0.0255,
  ROOM_CEIL_SHARE: 0.0329,

  /**
   * WHAT THE LAST REGIME LEFT ON THE BOOKS. Still a real, drawn charge — it is
   * the flavour of the mode and the thing the cap page leads with — but it is
   * no longer asked to be the plug. Roughly $40M of a $255.0M ceiling.
   */
  DEAD_MEAN: 0.16,
  DEAD_SD: 0.035,
  /** Below the knee the draw is itself; above it, bent toward the asymptote. */
  DEAD_KNEE: 0.14,
  /**
   * ~$56M, approached and never reached. Extreme, and deliberately within a
   * distance of real football rather than beyond it — clubs have carried north
   * of $60M of dead money through one very bad year.
   */
  DEAD_CEILING: 0.22,

  /**
   * How much of this year's dead money is still owed NEXT year, as a share.
   * The year after that it is gone. Two seasons is the answer to "rough but
   * not impossible": long enough that you cannot spend your way out of it in
   * one offseason, short enough that the climb is visible from the first one.
   */
  /**
   * THE PICKS THE LAST REGIME TRADED AWAY — see drawForfeitedPicks.
   *
   * Two or three lost picks is the usual hand, four or five the bad one. The
   * decays front-load the damage: each year further out is ~55% as likely to
   * be raided as the one before, and each round down ~55% as likely as the one
   * above, so a first-rounder in the first draft is far and away the most
   * common thing to lose and a seventh in year four is nearly impossible.
   */
  FORFEIT_MIN: 2,
  FORFEIT_SPREAD: 1.15,
  /** Only the drafts the mode can reasonably reach. */
  FORFEIT_YEARS: 3,
  FORFEIT_YEAR_DECAY: 0.55,
  FORFEIT_ROUND_DECAY: 0.55,
  /** Never more than this from one draft. */
  MAX_PER_YEAR: 2,
  /** In these years, at least one of the first PROTECTED_ROUNDS survives. */
  PROTECTED_YEARS: 3,
  PROTECTED_ROUNDS: 2,

  DEAD_TAIL_MEAN: 0.45,
  DEAD_TAIL_SD: 0.09,

  /**
   * THE CONTRACTS YOU WOULD NOT HAVE SIGNED — AND WHY THEY ARE NOT A FUDGE
   * FACTOR.
   *
   * The first attempt multiplied a man's market value by a number and called
   * it an overpay. It priced nothing: to make the books hurt, the multiplier
   * had to reach 3x and 4x, at which point the generator was inventing a
   * salary no front office would ever have written down.
   *
   * These are priced as WHAT HE WAS WORTH WHEN HE SIGNED. An albatross is a
   * man who was very good three years ago, was paid like it on a long
   * extension, and is not that player any more — which is the actual shape of
   * every ruinous contract in football. So his deal is `marketValue` evaluated
   * at the player he WAS: PEAK_GAP rating points higher, PEAK_YEARS younger.
   * The market curve does the rest, and it does it steeply — a 72 priced as
   * the 86 he used to be is a very large number arrived at honestly.
   *
   * Two consequences worth stating. The cap page will show a mediocre player
   * on a superstar's money, and that is the intended reading rather than a
   * bug. And because these are the only deals on the club above market, they
   * are findable: the fix is to get off THESE five, not to unpick fifty.
   *
   * Drawn without replacement, weighted by market value among the veterans, so
   * they land on the men a real front office would have extended.
   */
  /**
   * THE COUNT IS AN OUTCOME, NOT A DRAW. `chooseAlbatrosses` keeps signing the
   * last regime's mistakes until the books reach their target, so a very cheap
   * wreck takes more of them and a costlier roll takes fewer. A fixed count
   * cannot guarantee a tight cap, because what a fixed number of men ADD
   * depends on how the roster rolled — which is exactly the failure that put
   * $55.2M of room on a guaranteed-last roster.
   *
   * MIN is the floor for flavour: even a roster that needs no help carries a
   * few. MAX is a tripwire rather than a target — the value of this model is
   * that the fix is getting off a handful of contracts rather than unpicking
   * fifty.
   *
   * IT WENT 8 -> 11 ON MEASUREMENT, and the reason is worth stating because it
   * is a real cost. The cheapest rosters the mode deals cost about $110M at
   * market against a payroll target near $215M, and eight inherited deals
   * could only carry them to $190M — leaving $28.9M of room where the mode
   * promises single digits. Each extra man is worth roughly $10M of the gap.
   * PEAK_GAP went up in the same pass, which is the lever that closes it
   * without adding bodies; MAX is what covers the tail the lever cannot reach.
   * It reached 14 because at 11 one league in ten still opened on $16.0M. Note
   * what the ceiling does and does not cost: the loop stops the moment the
   * books are full, so a typical roster never comes near it — measured, the
   * median club carries far fewer — and raising it only lengthens the tail for
   * the cheapest wrecks. Fourteen deals on a forty-eight man roster is a lot of
   * bad paper, and it is what a club with no cap room and the worst roster in
   * football actually looks like.
   */
  ALBATROSS_MIN: 4,
  ALBATROSS_MAX: 14,
  ALBATROSS_AGE_MIN: 28,
  /**
   * How much better he was at his peak, in rating points.
   *
   * MEASURED UP FROM 16. At 16 each inherited deal added about $7.8M over
   * market, the closing loop ran into ALBATROSS_MAX at ten men and still
   * finished $11M short of its payroll target — so the club opened with $21.2M
   * of room instead of the $1M-$8M the mode promises. The choice then is more
   * men or dearer men, and more men is the wrong one: the value of this model
   * is that the fix is getting off a handful of contracts rather than unpicking
   * the roster. At 21 each deal adds roughly $12M, so the target is reached
   * with fewer of them and the loop stops before the tripwire.
   *
   * A 70 priced as the 91 he was four years ago is around $16M. That is a real
   * contract for a former all-pro who fell off, not an invented number — which
   * is the whole reason this is a market lookup and not a multiplier.
   */
  PEAK_GAP_MEAN: 23,
  PEAK_GAP_SD: 3.5,
  /** How long ago that was. Also how long the deal has been running. */
  PEAK_YEARS_MIN: 3,
  PEAK_YEARS_MAX: 4,
  ALBATROSS_YEARS_MIN: 2,
  ALBATROSS_YEARS_MAX: 3,

} as const;

// ---------------------------------------------------------------------------
// THE STATE MACHINE
// ---------------------------------------------------------------------------

/**
 * ===========================================================================
 * THREE STATES, TWO ONE-WAY DOORS
 * ===========================================================================
 *
 *                    +-- player abandons --> ABANDONED (unlocked, never ranked)
 *   LOCKED (ironman) +
 *                    +-- championship won --> WON       (unlocked, ranked)
 *
 * Neither door goes back, and there is no door IN: a save that was not founded
 * as a REBUILD can never become one, because the only thing that says a save is
 * a REBUILD is `settings.leagueStart`, and `updateSettingsAction` does not
 * write that field on any path. The founding choice is the whole record.
 *
 * ABANDONING FORFEITS THE LEADERBOARD ENTRY, PERMANENTLY. The board measures
 * how many seasons it took to win a title UNDER IRONMAN RULES — locked at
 * Normal, no forced trades, a ceiling that never moves. A save that takes the
 * handcuffs off has not done that thing, and ranking it would make the number
 * mean nothing and the board unfair to everyone still wearing them.
 *
 * WHICH IS WHY ABANDONED BEATS WON IN THIS ORDER. The two cannot both be
 * honestly true — `abandonRebuildAction` refuses to record an abandonment on a
 * save that has already won, because there is nothing left to abandon — but if
 * a row ever carried both, the forfeit is the answer that cannot be gamed.
 *
 * A SAVE THAT NEVER WINS STAYS LOCKED FOREVER, and that is the deliberate
 * answer rather than an unhandled case: ironman with an expiry is not ironman.
 * The way out is the abandon door, which is always open and always costs the
 * entry.
 * ===========================================================================
 */
export type RebuildState = 'NONE' | 'LOCKED' | 'WON' | 'ABANDONED';

export function rebuildState(input: {
  leagueStart: string;
  /** `League.rebuildAbandonedAt` — non-null means the door was taken. */
  rebuildAbandonedAt: Date | null;
  /** Does the user's club have a CHAMPION season on the books? */
  hasChampionship: boolean;
}): RebuildState {
  if (input.leagueStart !== 'REBUILD') return 'NONE';
  if (input.rebuildAbandonedAt) return 'ABANDONED';
  if (input.hasChampionship) return 'WON';
  return 'LOCKED';
}

/** Are this save's rules frozen? True in exactly one state, by construction. */
export function isIronman(state: RebuildState): boolean {
  return state === 'LOCKED';
}

/**
 * THE PINS. What a REBUILD save is played under, whatever a form posts.
 *
 * Applied at creation AND re-applied on every settings write, so the pins are
 * a property of the save rather than of the request that last touched it.
 *
 *   difficulty NORMAL   — every club plays what its roster is worth, yours
 *                         included. A run that could be dialled down is not a
 *                         measurement of anything.
 *   forceTradeEnabled   — off. The repair hatch that writes a deal nobody
 *                         agreed to is the one tool that could hand a rebuild
 *                         a roster it did not earn.
 *   capGrowth FLAT      — the ceiling never moves. The owner's words: "the cap
 *                         stays stable year to year." It also closes the exit
 *                         a rising ceiling quietly offers, which is waiting
 *                         for the bad contracts to inflate away.
 *   capMode REALISTIC   — dead money has to be real for the opening hand to
 *                         mean anything; it IS the opening hand.
 */
export const REBUILD_PINS: Pick<
  LeagueSettings,
  'difficulty' | 'forceTradeEnabled' | 'capGrowth' | 'capMode'
> = {
  difficulty: 'NORMAL',
  forceTradeEnabled: false,
  capGrowth: 'FLAT',
  capMode: 'REALISTIC',
};

/**
 * The settings a save is actually played under. A no-op for every save that is
 * not a live REBUILD run, so this is safe to wrap around any settings write.
 */
export function applyRebuildPins(settings: LeagueSettings, state: RebuildState): LeagueSettings {
  return isIronman(state) ? { ...settings, ...REBUILD_PINS } : settings;
}

// ---------------------------------------------------------------------------
// THE LEADERBOARD NUMBER
// ---------------------------------------------------------------------------

/**
 * ===========================================================================
 * SEASONS TO FIRST CHAMPIONSHIP — THE DEFINITION, IN ONE PLACE
 * ===========================================================================
 * THE FOUNDING SEASON IS SEASON 1. A GM who takes over a wreck and wins the
 * title in the year he arrives scores 1, not 0 — he played a season and won
 * it. The count is INCLUSIVE of the season the title was won in, and of every
 * season before it, and it stops there: seasons played AFTER the first title
 * are not part of the climb and do not count against it.
 *
 * So the arithmetic is exactly:
 *
 *     firstChampionYear - tenureStartYear + 1
 *
 * `tenureStartYear` is `resolveStartYear(league)` — the same founding year the
 * Dynasty screen and the XP total already measure from, which is what keeps
 * the two decades of FICTIONAL backstory a new league is seeded with out of
 * this number. If a save's history somehow held a title from before the GM
 * arrived, it is not his and it is filtered out here.
 *
 * NULL MEANS NOT YET, AND IT IS NOT A ZERO AND NOT A BIG NUMBER. A run still
 * in progress has no seasons-to-title, because the denominator has not
 * happened. The board shows those saves as in progress and ranks none of them;
 * see lib/leaderboard.ts.
 * ===========================================================================
 */
export function seasonsToFirstTitle(
  seasons: readonly { year: number; playoffResult: string }[],
  tenureStartYear: number,
): number | null {
  let first: number | null = null;
  for (const s of seasons) {
    if (s.playoffResult !== 'CHAMPION') continue;
    if (s.year < tenureStartYear) continue;
    if (first === null || s.year < first) first = s.year;
  }
  return first === null ? null : first - tenureStartYear + 1;
}

// ---------------------------------------------------------------------------
// THE HAND — the roster
// ---------------------------------------------------------------------------

/**
 * The club's own strength, in `strengthByAbbr` units — the WORSE of two
 * answers, and it needs both. See STRENGTH_MEAN for the measurements that
 * forced this shape.
 *
 * Taking the minimum is not a clamp on a distribution: both terms are
 * themselves drawn and neither has a bound. It states that the hand must
 * satisfy two conditions at once — grim in absolute terms, AND worse than
 * every other club in this particular league — the same way `scale = min(1,
 * target / total)` states that a club must be both under its target and at or
 * below market.
 *
 * `others` is every OTHER club's strength, already rolled. Pass them all: this
 * reads the minimum, and a subset would silently weaken the guarantee to
 * "worst of the ones you happened to look at".
 */
export function rebuildTeamStrength(rng: Rng, others: readonly number[]): number {
  const margin = REBUILD.STRENGTH_MARGIN_MIN + Math.abs(rng.normal(0, REBUILD.STRENGTH_MARGIN_SD));
  if (others.length === 0) return rng.normal(REBUILD.STRENGTH_MEAN, REBUILD.STRENGTH_SD);
  // Just under the league's own floor. NOT also capped by an absolute target
  // any more: in a league whose clubs bunched, an absolute -9.25 sat miles
  // below a floor of -3 and produced the 0.90-win roster this pass removed.
  // The worst real club IS the grim benchmark, and the walk in
  // lib/gen/league.ts takes it the rest of the way.
  return Math.min(...others) - margin;
}

/**
 * Age the inherited veterans in place.
 *
 * RATINGS ARE NOT TOUCHED. A man who is 33 instead of 28 is exactly as good
 * today and has nothing left to come — so this moves `age`, the `experience`
 * that follows from it, and the runway above his current rating, and nothing
 * else. The roster is bad because of `rebuildTeamStrength`; it is OLD because
 * of this, and those are two separate facts about it.
 *
 * The runway is recomputed with `generatePlayer`'s own age damping — the
 * headroom a man was rolled scales by (30 - age) / 8 — so an aged veteran ends
 * up with the ceiling the generator would have given him at his new age. Past
 * 30 that is zero, and his potential is his current rating: what you see is
 * what he is.
 *
 * The age itself is bent toward GENERATION.AGE_MAX rather than clipped at it,
 * so a 36-year-old stays possible and a 39-year-old cannot exist — the same
 * shape as every other bound in this generator.
 */
export function ageRebuildRoster(rng: Rng, roster: GeneratedPlayer[]): GeneratedPlayer[] {
  // Best first, so the chance of being one of the old guard runs down the
  // depth chart rather than across a bucket boundary.
  const order = [...roster].sort((a, b) => b.trueOvr - a.trueOvr);
  const n = Math.max(1, order.length - 1);

  order.forEach((p, i) => {
    // Two factors. How far up the depth chart he is — the club's best men are
    // its old guard — and how old he already is, which keeps the kids out of
    // it entirely. A 24-year-old is never one of these however highly rated.
    const gate = clamp(
      (p.age - REBUILD.AGE_GATE_LOW) / (REBUILD.AGE_GATE_HIGH - REBUILD.AGE_GATE_LOW), 0, 1,
    );
    const p_aged = (REBUILD.AGED_P_FLOOR + REBUILD.AGED_P_SPAN * (1 - i / n)) * gate;
    if (!rng.bool(p_aged)) return;

    const shift = Math.abs(rng.normal(REBUILD.AGE_SHIFT_MEAN, REBUILD.AGE_SHIFT_SD));
    // +0.49 so AGE_MAX itself is still reachable after rounding while nothing
    // above it ever is. The asymptote does the bounding; Math.round does not.
    const aged = bendToCeiling(p.age + shift, REBUILD.AGE_BEND_KNEE, GENERATION.AGE_MAX + 0.49);
    const age = Math.round(aged);
    if (age <= p.age) return;

    // generatePlayer's own rule, re-run at the new age rather than re-invented.
    const damp = clamp((30 - age) / 8, 0, 1);
    const headroom = Math.max(0, p.potential - p.trueOvr) * damp;

    p.age = age;
    p.experience = clamp(age - 22, 0, 15);
    p.potential = Math.max(p.trueOvr, Math.round(p.trueOvr + headroom));
  });

  return roster;
}

// ---------------------------------------------------------------------------
// THE HAND — the books
// ---------------------------------------------------------------------------

/** One inherited contract nobody in the building will defend. */
export interface Albatross {
  /** The annual value of the deal, in dollars. */
  apy: number;
  /** Seasons still to run. */
  yearsRemaining: number;
  /** Seasons already served — how long ago he was worth this. */
  yearsServed: number;
  /** The rating he was paid for. */
  peakOvr: number;
}

/** What one of these men has to be priced against. */
export interface AlbatrossCandidate {
  id: string;
  age: number;
  position: Position;
  trueOvr: number;
  potential: number;
  /** His value on today's market — the weight, and the floor on his deal. */
  marketValue: number;
}

/**
 * Pick the deals the last regime is remembered for, price each at the player
 * the man used to be, AND KEEP SIGNING THEM UNTIL THE BOOKS REACH `targetApy`.
 *
 * THE COUNT CLOSES THE GAP. That is the whole change from the version that
 * drew a fixed 5-7: what a fixed number of men ADD to a payroll depends
 * entirely on how the roster rolled, so it could not promise a tight cap on a
 * cheap wreck — measured, a guaranteed-last roster opened with $55.2M of room.
 * Drawing the ROOM first and letting the number of bad contracts be whatever
 * closes it makes the cap position a property of the mode instead of a
 * property of the dice.
 *
 * EVERY MAN IS STILL HONESTLY PRICED. Nobody is paid a number nobody would
 * write down; he is paid what he was worth at his peak, PEAK_GAP rating points
 * higher and PEAK_YEARS younger, through the same `marketValue` the rest of the
 * game quotes. Only how MANY such men there are is solved for. The alternative
 * — inflating a fixed few by a multiplier — needed 3-4x to bite and was
 * rejected for inventing salaries; see the note on ALBATROSS_MIN.
 *
 * IT CANNOT OVERSHOOT. The last man signed is trimmed back toward his own
 * market value so the total lands ON the target rather than past it, and his
 * trim can never take him below market (at market he adds nothing, which is
 * the identity). So the payroll is <= target, which is what keeps the club's
 * room >= the room that was drawn, which is what keeps it under the ceiling.
 *
 * THE FALLBACK IS EXPLICIT AND IT IS ALWAYS SAFE. If every eligible veteran is
 * already overpaid and the payroll still falls short — a roster so cheap that
 * even its whole old guard on peak money cannot fill the books — the club
 * simply opens with MORE room than was drawn. Never less, never over the
 * ceiling. A rebuild with $14M instead of $4M is an easier hand, not a broken
 * save, and that is the correct direction to fail in.
 */
export function chooseAlbatrosses(
  rng: Rng,
  roster: readonly AlbatrossCandidate[],
  /** What the club's payroll has to reach, in APY dollars. */
  targetApy: number,
): Map<string, Albatross> {
  const veterans = roster.filter((p) => p.age >= REBUILD.ALBATROSS_AGE_MIN);
  const pool = (veterans.length >= REBUILD.ALBATROSS_MIN ? veterans : [...roster])
    .map((p) => ({ p, w: Math.max(1, p.marketValue) }));

  // What the roster costs before anybody is overpaid.
  let payroll = roster.reduce((sum, p) => sum + p.marketValue, 0);
  const out = new Map<string, Albatross>();

  const draw = () => {
    const total = pool.reduce((sum, c) => sum + c.w, 0);
    if (total <= 0) return null;
    let roll = rng.float(0, total);
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      roll -= pool[i].w;
      if (roll <= 0) { idx = i; break; }
    }
    return pool.splice(idx, 1)[0].p;
  };

  while (pool.length > 0 && out.size < REBUILD.ALBATROSS_MAX) {
    // Stop once the books are full, but never before the flavour floor: a
    // rebuild with no inherited mistakes on it is not a rebuild.
    if (out.size >= REBUILD.ALBATROSS_MIN && payroll >= targetApy) break;

    const p = draw();
    if (!p) break;

    const gap = Math.max(0, rng.normal(REBUILD.PEAK_GAP_MEAN, REBUILD.PEAK_GAP_SD));
    const yearsServed = rng.int(REBUILD.PEAK_YEARS_MIN, REBUILD.PEAK_YEARS_MAX);
    // The rating he signed off the back of, bent toward 99 rather than clipped
    // at it, so a man who was already very good does not stack on the bound.
    const peakOvr = Math.round(bendToCeiling(p.trueOvr + gap, 92, 99));
    const peak = Math.max(p.marketValue, marketValue({
      ovr: peakOvr,
      position: p.position,
      age: Math.max(GENERATION.AGE_MIN, p.age - yearsServed),
      potential: p.potential,
    }));

    // What signing him at his peak ADDS. Trimmed if it would carry the books
    // past the target — never below his own market value, where it adds zero.
    const room = Math.max(0, targetApy - payroll);
    const apy = out.size + 1 > REBUILD.ALBATROSS_MIN
      ? Math.min(peak, p.marketValue + room)
      : peak;

    payroll += apy - p.marketValue;
    out.set(p.id, {
      apy,
      yearsRemaining: rng.int(REBUILD.ALBATROSS_YEARS_MIN, REBUILD.ALBATROSS_YEARS_MAX),
      yearsServed,
      peakOvr,
    });
  }
  return out;
}

/**
 * HOW MUCH ROOM THE CLUB OPENS WITH, and the safety property of the whole mode.
 *
 * Drawn, not derived — see THE BOOKS. The shape is a lognormal, which is an
 * exponential of a normal and therefore STRICTLY POSITIVE at every possible
 * input: there is no draw, however extreme, that returns zero or a negative
 * number, and nothing here clips one away. Both ends are then bends rather
 * than caps — compressed toward a floor it never reaches and a ceiling it
 * never reaches — so the result always lands inside the band the owner named
 * without any value being stacked on a bound.
 *
 * `used = ceiling - room` with `room > 0` is the entire proof that a REBUILD
 * save is never dealt an over-cap sheet, and lib/season.ts refusing to advance
 * a club that is over the ceiling is why that proof has to be airtight rather
 * than typical.
 */
export function rebuildCapRoom(rng: Rng, capTotal: number): number {
  const raw = REBUILD.ROOM_MEDIAN_SHARE * Math.exp(rng.normal(0, REBUILD.ROOM_LOG_SD));
  const capped = bendToCeiling(raw, REBUILD.ROOM_CEIL_KNEE, REBUILD.ROOM_CEIL_SHARE);
  const floored = bendToFloor(capped, REBUILD.ROOM_FLOOR_KNEE, REBUILD.ROOM_FLOOR_SHARE);
  return Math.round(capTotal * floored);
}

/**
 * WHAT THE LAST REGIME LEFT ON THE BOOKS — a real drawn charge, bent toward
 * DEAD_CEILING and never reaching it.
 *
 * It is no longer asked to be the plug that closes the cap. That job belongs to
 * the inherited contracts now (see chooseAlbatrosses), because dead money
 * grows without limit as the roster gets cheaper: the version that used it as
 * the closing term booked $131.7M against a $107.1M payroll, which conserved
 * every rule and described a club that cannot exist.
 */
export function rebuildDeadMoney(rng: Rng, capTotal: number): number {
  const raw = rng.normal(REBUILD.DEAD_MEAN, REBUILD.DEAD_SD);
  const share = bendToCeiling(Math.max(0, raw), REBUILD.DEAD_KNEE, REBUILD.DEAD_CEILING);
  return Math.round(capTotal * share);
}

/** How much of this year's dead money is still on the books next year. */
export function rebuildDeadTailShare(rng: Rng): number {
  return Math.max(0, rng.normal(REBUILD.DEAD_TAIL_MEAN, REBUILD.DEAD_TAIL_SD));
}

/**
 * ===========================================================================
 * DEALING A ROSTER THAT IS LAST BY CONSTRUCTION
 * ===========================================================================
 * The app owner asked for the worst roster in the league EVERY time, and a
 * strength margin cannot promise that: strength is the mean a roster's ratings
 * are drawn around, and fifty individual rolls move the finished club two or
 * three points on their own. Measured, a margin widened to 2.2 — far past the
 * point of doing damage — still came out 31st in one league of six, while the
 * leagues it did win opened 10 to 15 points clear, won 1.3 games and carried
 * up to $71.0M of cap room, because a worse roster is a cheaper roster.
 *
 * SO THE RANK IS CONDITIONED ON RATHER THAN SAMPLED FOR, and this function is
 * the whole of it. It draws a roster; if that roster is not below the league's
 * floor it lowers the strength BY THE AMOUNT IT MISSED BY and draws again.
 *
 * THE GUARANTEE IS A POSTCONDITION, NOT A FREQUENCY. This returns a roster
 * whose overall is strictly below `floorOverall` or it throws. There is no
 * path on which it returns something that failed the test, which is what makes
 * "every REBUILD league shows 32nd of 32" a property of the code rather than a
 * statistic — a league that could not satisfy it is never written at all.
 *
 * IT TERMINATES. Every rejected draw lowers the strength by at least
 * RANK_STEP, and every rating on a roster is generated around
 * `VETERAN_OVR_MEAN + strength` under a floor of GENERATION.ROSTER_OVR_FLOOR,
 * so a low enough strength drives the whole roster onto that floor — below any
 * overall a normally-drawn club can have. The attempt bound is therefore a
 * tripwire for a caller that passed an impossible floor, not the exit.
 *
 * WHY IT THROWS RATHER THAN RETURNING ITS BEST EFFORT: the first version of
 * this kept the best roster seen and broke out of the loop on the bound, which
 * meant an exhausted search returned the EMPTY roster it started with. That is
 * a club with no players, written to the database, discovered by the user. A
 * generator that cannot meet its contract must fail where it is standing.
 */
export function dealLastPlaceRoster<T>(rng: Rng, opts: {
  /** Where the search starts — see rebuildTeamStrength. */
  startStrength: number;
  /** The lowest overall among the other clubs. Must be beaten strictly. */
  floorOverall: number;
  build: (strength: number) => T;
  overallOf: (roster: T) => number;
}): { roster: T; overall: number; strength: number; attempts: number } {
  let strength = opts.startStrength;
  let best: T | null = null;
  let bestOverall = -Infinity;

  for (let attempt = 1; attempt <= REBUILD.RANK_MAX_ATTEMPTS; attempt++) {
    const roster = opts.build(strength);
    const overall = opts.overallOf(roster);

    if (overall < opts.floorOverall) {
      best = roster;
      bestOverall = overall;
      /**
       * KEEP THE DEAREST ROSTER THAT STILL LOSES, not the first one found.
       * The step aims the strength at the floor, but each draw carries its own
       * noise and the one that clears the bar can clear it by a mile —
       * measured, one league in six accepted a roster six points under the
       * field, worth 1.50 expected wins and $56.3M of room. These rosters are
       * built in memory and thrown away, so sampling a few more and keeping
       * the best qualifier is free, and it turns "somewhere below last" into
       * "just below last".
       */
      for (let k = 0; k < REBUILD.RANK_REFINE_DRAWS; k++) {
        const alt = opts.build(strength);
        const altOverall = opts.overallOf(alt);
        if (altOverall < opts.floorOverall && altOverall > bestOverall) {
          best = alt;
          bestOverall = altOverall;
        }
      }
      return { roster: best, overall: bestOverall, strength, attempts: attempt };
    }

    // The miss IS the step. `floorOverall` is the lowest of thirty-one rosters
    // — an extreme order statistic, well under what its own strength predicts —
    // so a roster built at the same strength is typically still above it, and a
    // fixed step has to inch down many times to get under. Measured, that walk
    // ran deep enough to drag a club to 0.20 expected wins and $80.0M of room
    // while still, technically, being 32nd. A club's overall tracks its
    // strength about one-for-one, so the distance missed is the distance to
    // move, and one informed step lands just under instead of far beneath.
    strength -= (overall - opts.floorOverall) + REBUILD.RANK_STEP;
  }

  throw new Error(
    `REBUILD: could not deal a roster below ${opts.floorOverall.toFixed(2)} overall in `
    + `${REBUILD.RANK_MAX_ATTEMPTS} attempts (last strength ${strength.toFixed(2)}). `
    + 'Refusing to write a league that would not show the club last.',
  );
}

/**
 * ===========================================================================
 * THE PICKS THE LAST REGIME TRADED AWAY
 * ===========================================================================
 * The app owner: *"is it also possible to give a draft pick disadvantage? Like
 * maybe no first round pick first year, no second etcetc. but every run should
 * be random so its fun each time."*
 *
 * MODELLED AS TRADES, NOT AS DELETIONS, and that decision buys three things at
 * once. The league keeps thirty-two picks in every round, so nothing in the
 * draft machinery has to learn about a hole. Another club visibly holds the
 * pick, which is what actually happened in the fiction. And the draft screen
 * ALREADY renders exactly this — a pick whose `originalTeamId` is yours and
 * whose `ownerTeamId` is not shows up under "traded away", with the club that
 * has it — so the player is told he was dealt this rather than left to notice
 * a gap. No new screen, and the mode borrows the game's existing vocabulary
 * instead of inventing one.
 *
 * WEIGHTED TOWARD EARLY ROUNDS AND EARLY YEARS, because that is the shape of
 * the damage a desperate front office actually does: it mortgages the top of
 * next year's draft, not the bottom of the one after next.
 *
 * WHAT IT WILL NEVER DO, and these are guarantees rather than tendencies:
 *
 *   IT NEVER TAKES EVERY EARLY PICK. At least one of the first two rounds
 *   survives in every one of the first PROTECTED_YEARS years. A rebuild whose
 *   own draft capital is gone in all directions is not a climb, it is a
 *   sentence, and the whole design rests on the climb being winnable.
 *
 *   IT NEVER GUTS ONE YEAR. At most MAX_PER_YEAR picks go from any single
 *   draft, so no season arrives with nothing to do.
 *
 * Both are enforced by REDRAWING a candidate that would violate them, which
 * shapes the distribution rather than clipping it — the same reason nothing
 * else in this file clamps.
 */
export interface ForfeitedPick {
  /** Years from the founding draft: 0 is the first draft the GM will run. */
  yearOffset: number;
  round: number;
}

/**
 * How many picks are lost, and which. Drawn per run — with the roster rank now
 * fixed at 32nd every time, this and the cap room are where two runs stop
 * feeling like the same disaster.
 */
export function drawForfeitedPicks(rng: Rng, draftRounds: number): ForfeitedPick[] {
  const count = REBUILD.FORFEIT_MIN
    + Math.round(Math.abs(rng.normal(0, REBUILD.FORFEIT_SPREAD)));

  const taken: ForfeitedPick[] = [];
  const has = (y: number, r: number) => taken.some((t) => t.yearOffset === y && t.round === r);
  const perYear = (y: number) => taken.filter((t) => t.yearOffset === y).length;
  // Early picks still held in a protected year, if this one were taken too.
  const earlyLeft = (y: number, r: number) => {
    let n = 0;
    for (let round = 1; round <= REBUILD.PROTECTED_ROUNDS; round++) {
      if (!has(y, round) && !(round === r)) n++;
    }
    return n;
  };

  // Weighted draw over (year, round), front-loaded on both axes.
  const candidates: { y: number; r: number; w: number }[] = [];
  for (let y = 0; y < REBUILD.FORFEIT_YEARS; y++) {
    for (let r = 1; r <= draftRounds; r++) {
      candidates.push({ y, r, w: Math.pow(REBUILD.FORFEIT_YEAR_DECAY, y) * Math.pow(REBUILD.FORFEIT_ROUND_DECAY, r - 1) });
    }
  }

  let guard = 0;
  while (taken.length < count && guard++ < 400) {
    const total = candidates.reduce((s, c) => s + c.w, 0);
    if (total <= 0) break;
    let roll = rng.float(0, total);
    let pick = candidates[candidates.length - 1];
    for (const c of candidates) { roll -= c.w; if (roll <= 0) { pick = c; break; } }

    const violatesYear = perYear(pick.y) >= REBUILD.MAX_PER_YEAR;
    const violatesEarly = pick.y < REBUILD.PROTECTED_YEARS
      && pick.r <= REBUILD.PROTECTED_ROUNDS
      && earlyLeft(pick.y, pick.r) < 1;
    if (has(pick.y, pick.r) || violatesYear || violatesEarly) {
      // Redraw: drop this candidate's weight to zero rather than clipping the
      // count, so the shape stays a draw and the guarantee stays absolute.
      pick.w = 0;
      continue;
    }
    taken.push({ yearOffset: pick.y, round: pick.r });
    pick.w = 0;
  }

  return taken.sort((a, b) => a.yearOffset - b.yearOffset || a.round - b.round);
}

/**
 * What the founding transaction says. Written as a handover, not as a
 * difficulty tooltip — the figures are the real ones the club opens with,
 * passed in rather than restated, so this line cannot come to disagree with
 * the cap sheet it describes.
 */
export function rebuildHandoverNote(opts: {
  clubName: string;
  deadMoney: string;
  capSpace: string;
  albatrosses: number;
  /** The picks the last regime dealt away, already worded by the caller. */
  forfeits: string | null;
}): string {
  return `The ${opts.clubName} job is open for a reason. The roster is the worst in the league, `
    + `${opts.deadMoney} of the cap belongs to men who no longer play here, and ${opts.albatrosses} `
    + `contracts on this book were signed by somebody who is not answering his phone. `
    + `That leaves you ${opts.capSpace}. `
    + (opts.forfeits
      ? `He also mortgaged the draft on his way out — ${opts.forfeits} are gone. `
      : `He did at least leave the draft picks alone. `)
    + `Nobody is coming to help. Win it and they will never stop talking about it.`;
}

/**
 * "your 2027 first and your 2028 second" — the forfeited picks as a GM would
 * say them out loud. Ordinals rather than round numbers, because nobody in
 * football says "a round 1 pick".
 */
export function describeForfeits(picks: readonly ForfeitedPick[], firstDraftYear: number): string | null {
  if (picks.length === 0) return null;
  const ord = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
  const parts = picks.map((p) =>
    `your ${firstDraftYear + p.yearOffset} ${ord[p.round - 1] ?? `round ${p.round}`}`);
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * What a settings write on a live run is refused with. Here rather than beside
 * the action that throws it, because app/actions/league.ts is a 'use server'
 * module and those may export only async functions.
 */
export const IRONMAN_REFUSAL =
  'This league is a Rebuild run. Its rules are fixed until you win a championship — '
  + 'or until you end the run yourself on the Settings screen.';

/** Shared by the create screen and anywhere else that has to name the mode. */
export const REBUILD_LABEL = 'The Rebuild';

export const REBUILD_BLURB =
  'You inherit the worst roster in the league — guaranteed, every time — a cap sheet with almost '
  + 'nothing left on it, draft picks the last man mortgaged, and no way to change the rules until '
  + 'you have won something. No two runs are handed the same wreck.';
