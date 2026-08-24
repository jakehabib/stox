import { Rng, clamp } from './rng';
import { GENERATION, type Position } from './tuning';
import { marketValue } from './cap';
import { bendToCeiling } from './gen/players';
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
 * ON TURN ONE — not hard, broken. So the opening cap position is never a
 * subtraction that might go negative. It is two independently bounded terms —
 * a payroll scaled to at most ACTIVE_TARGET_SHARE of the ceiling, and a dead
 * money charge bent asymptotically toward DEAD_CEILING — whose bounds sum to
 * 0.98. The bend never reaches its asymptote at any input, so no roll of the
 * dice, however extreme and none of them clipped, can deal a hand at or over
 * the ceiling. See THE BOOKS for the derivation, and for the first version of
 * this plan, which was safe and absurd.
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
   * How far below the worst club this league actually rolled the hand lands,
   * at minimum, plus a drawn tail.
   *
   * SMALL ON PURPOSE, AND IT WAS MEASURED THE HARD WAY. The aim is to BE the
   * floor of the league, not to fall through it. Raising this to 1.2 to force
   * a strictly-worst RATING did force it — the hand came out first of 32 with
   * six points of daylight — and the same club won 1.92 games, which is not a
   * rebuild, it is a bye week for the other thirty-one. The extra margin also
   * made the roster cheap enough that its cap room went UP, to $55.2M.
   *
   * So this stays where the measurements are good, and the claim above stays
   * honest about what that buys: at or within a point of the bottom, not
   * guaranteed last on realised rating. A visibly worse hand is not worth a
   * two-win season.
   */
  STRENGTH_MARGIN_MIN: 0.5,
  STRENGTH_MARGIN_SD: 0.7,

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
   * THE BOOKS, AND THE GUARANTEE THAT THEY OPEN UNDER THE CEILING
   * =========================================================================
   * Two terms, each independently bounded, and the bound on their sum is what
   * makes the mode safe:
   *
   *   PAYROLL   is scaled to at most ACTIVE_TARGET_SHARE of the ceiling, by
   *             exactly the mechanism lib/gen/league.ts already uses for all
   *             thirty-two clubs (`scale = min(1, target / total)`). 0.72 is a
   *             contender's books — this club pays like a team going for it,
   *             which is the point, because it is not one.
   *
   *   DEAD MONEY is a drawn share bent asymptotically toward DEAD_CEILING and
   *             therefore strictly below it at every possible draw.
   *
   * So `used < (0.72 + 0.24) x ceiling`, always, with no clamp anywhere and no
   * dependence on how the roster happened to roll. lib/season.ts refuses to
   * advance a week while the user's own club is over the ceiling, so this is
   * the property that stops a REBUILD save being frozen on turn one.
   *
   * THE FIRST ATTEMPT AT THIS WAS WRONG AND IS WORTH RECORDING. It picked a
   * target for USED (95.5% of the ceiling) and booked whatever was left over
   * as dead money. Measured, that produced $131.7M of dead money against a
   * $107.1M payroll — more owed to men who had left than to the men playing.
   * It satisfied every constraint and was absurd, because a genuinely terrible
   * roster is CHEAP: the market curve is exponential, so nine rating points
   * off a club takes two thirds off its payroll. Fixing a share of USED means
   * the worse the roster, the more invented money has to be poured in. Fixing
   * the two terms separately is the version that survives a bad roll.
   */
  ACTIVE_TARGET_SHARE: 0.72,
  DEAD_MEAN: 0.215,
  DEAD_SD: 0.035,
  /** Below the knee the draw is itself; above it, bent toward the asymptote. */
  DEAD_KNEE: 0.18,
  /**
   * ~$66M on a $255.0M ceiling, approached and never reached. Extreme, and
   * deliberately within a distance of real football rather than beyond it —
   * clubs have carried north of $60M of dead money through one very bad year.
   *
   * 0.72 + 0.26 = 0.98, AND THAT SUM IS THE SAFETY PROPERTY. Neither of these
   * two numbers may be raised without checking the other: the moment they sum
   * to 1, a REBUILD save can be dealt a cap sheet it cannot advance out of.
   */
  DEAD_CEILING: 0.26,
  /**
   * How much of an under-spent payroll comes back as dead money instead of as
   * room. 1.0 would be "every dollar you failed to spend is owed to somebody
   * who left", which is too neat; a share of it keeps a cheap roll reading as
   * a slightly kinder hand rather than as no hand at all.
   */
  DEAD_SHORTFALL_PULL: 0.75,

  /**
   * How much of this year's dead money is still owed NEXT year, as a share.
   * The year after that it is gone. Two seasons is the answer to "rough but
   * not impossible": long enough that you cannot spend your way out of it in
   * one offseason, short enough that the climb is visible from the first one.
   */
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
  ALBATROSS_MIN: 5,
  ALBATROSS_MAX: 7,
  ALBATROSS_AGE_MIN: 28,
  /** How much better he was at his peak, in rating points. */
  PEAK_GAP_MEAN: 16,
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
  const absolute = rng.normal(REBUILD.STRENGTH_MEAN, REBUILD.STRENGTH_SD);
  const margin = REBUILD.STRENGTH_MARGIN_MIN + Math.abs(rng.normal(0, REBUILD.STRENGTH_MARGIN_SD));
  const floor = others.length > 0 ? Math.min(...others) - margin : absolute;
  return Math.min(absolute, floor);
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
 * Pick the deals the last regime is remembered for, and price each one at the
 * player the man used to be.
 *
 * Drawn WITHOUT REPLACEMENT and WEIGHTED BY MARKET VALUE among the club's
 * veterans, because that is who gets overpaid in real football — nobody hands
 * a fifth receiver a bad contract, they hand it to the 31-year-old who was
 * very good two years ago. Falls back to the whole roster if the club somehow
 * has no veterans at all, so this can never return an empty set on a legal
 * roster and quietly leave the books clean.
 *
 * The price is floored at what he is worth TODAY: a deal that came out below
 * that is a bargain rather than an albatross, and the floor is the one place
 * that could happen — a man whose peak fell at an age the market pays less for.
 */
export function chooseAlbatrosses(
  rng: Rng,
  roster: readonly AlbatrossCandidate[],
): Map<string, Albatross> {
  const veterans = roster.filter((p) => p.age >= REBUILD.ALBATROSS_AGE_MIN);
  const pool = (veterans.length >= REBUILD.ALBATROSS_MAX ? veterans : [...roster])
    .map((p) => ({ p, w: Math.max(1, p.marketValue) }));

  const want = Math.min(pool.length, rng.int(REBUILD.ALBATROSS_MIN, REBUILD.ALBATROSS_MAX));
  const out = new Map<string, Albatross>();

  for (let k = 0; k < want; k++) {
    const total = pool.reduce((s, c) => s + c.w, 0);
    if (total <= 0) break;
    let roll = rng.float(0, total);
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      roll -= pool[i].w;
      if (roll <= 0) { idx = i; break; }
    }
    const [chosen] = pool.splice(idx, 1);
    const p = chosen.p;

    const gap = Math.max(0, rng.normal(REBUILD.PEAK_GAP_MEAN, REBUILD.PEAK_GAP_SD));
    const yearsServed = rng.int(REBUILD.PEAK_YEARS_MIN, REBUILD.PEAK_YEARS_MAX);
    // The rating he signed off the back of, bent toward 99 rather than clipped
    // at it, so a man who was already very good does not stack on the bound.
    const peakOvr = Math.round(bendToCeiling(p.trueOvr + gap, 92, 99));
    const peak = marketValue({
      ovr: peakOvr,
      position: p.position,
      age: Math.max(GENERATION.AGE_MIN, p.age - yearsServed),
      potential: p.potential,
    });

    out.set(p.id, {
      apy: Math.max(p.marketValue, peak),
      yearsRemaining: rng.int(REBUILD.ALBATROSS_YEARS_MIN, REBUILD.ALBATROSS_YEARS_MAX),
      yearsServed,
      peakOvr,
    });
  }
  return out;
}

/**
 * WHAT THE CLUB'S PAYROLL IS BUILT TO — the same kind of number
 * `rosterCapTarget` produces for the other thirty-one, read by the same
 * `scale = min(1, target / total)` mechanism, and never exceeded. That is half
 * of the "opens under the ceiling" guarantee.
 */
export function rebuildActiveTarget(capTotal: number): number {
  return capTotal * REBUILD.ACTIVE_TARGET_SHARE;
}

/**
 * WHAT THE LAST REGIME LEFT ON THE BOOKS — the other half.
 *
 * A drawn share of the ceiling, bent asymptotically toward DEAD_CEILING and
 * therefore strictly below it at every possible draw: a roll of 0.6, eleven
 * standard deviations out and not clipped away, still returns 0.2399. Together
 * with the payroll bound above, `used` is guaranteed under the ceiling by
 * arithmetic rather than by a check somebody could forget to run.
 *
 * IT LEANS ON HOW FAR THE PAYROLL FELL SHORT, and that is what makes the
 * opening ROOM consistent instead of the opening BILL. Measured across real
 * REBUILD leagues with a flat draw, the club opened with anywhere from $12.5M
 * of space to $57.9M — and $57.9M is more room than an average club has, which
 * is not a rough cap situation by any reading. The cause is the market curve:
 * when the inherited contracts roll small the roster simply does not cost
 * enough to reach its payroll target, and every dollar it fails to spend
 * becomes room.
 *
 * So the shortfall is added to the draw BEFORE the bend. A club whose payroll
 * landed on target gets the ordinary bill; a club whose payroll came in cheap
 * gets a heavier one, and the two open in a similar place. This is emphatically
 * NOT the plug that produced $131.7M of dead money against a $107.1M payroll in
 * the first version of this design — that one solved for a fixed share of USED
 * and had to grow without limit as the roster got cheaper. This is a nudge
 * INSIDE a bound that already existed: whatever the shortfall, the bend still
 * approaches DEAD_CEILING and never reaches it, so the guarantee is untouched.
 */
export function rebuildDeadMoney(rng: Rng, capTotal: number, activeSalary: number): number {
  const shortfall = Math.max(0, rebuildActiveTarget(capTotal) - activeSalary) / capTotal;
  const raw = rng.normal(REBUILD.DEAD_MEAN, REBUILD.DEAD_SD) + shortfall * REBUILD.DEAD_SHORTFALL_PULL;
  const share = bendToCeiling(Math.max(0, raw), REBUILD.DEAD_KNEE, REBUILD.DEAD_CEILING);
  return Math.round(capTotal * share);
}

/** How much of this year's dead money is still on the books next year. */
export function rebuildDeadTailShare(rng: Rng): number {
  return Math.max(0, rng.normal(REBUILD.DEAD_TAIL_MEAN, REBUILD.DEAD_TAIL_SD));
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
}): string {
  return `The ${opts.clubName} job is open for a reason. The roster is the bottom of the league, `
    + `${opts.deadMoney} of the cap belongs to men who no longer play here, and ${opts.albatrosses} `
    + `contracts on this book were signed by somebody who is not answering his phone. `
    + `You have ${opts.capSpace} to work with and every one of your own draft picks. `
    + `Nobody is coming to help. Win it and they will never stop talking about it.`;
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
  'You inherit the bottom of the league, a cap sheet buried under the last regime’s dead money, '
  + 'and no way to change the rules until you have won something. Every draft pick is still yours.';
