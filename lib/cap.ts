import { CAP, CONTRACT, MARKET, Position } from './tuning';
import { CapMode } from './types';
import { readJson } from './json';
import { retirementChance } from './progression';
import { Rng, clamp } from './rng';

export interface ContractLike {
  years: number;
  yearsRemaining: number;
  signedYear: number;
  baseSalaries: string; // JSON number[]
  signingBonus: number;
  guaranteed: number;
  /** Cap-only trailing years (see schema comment) — optional so older call sites without it still work. */
  voidYears?: number;
  isRookieDeal?: boolean;
}

/** Salary cap for a given season. Grows each year. */
export function capForYear(seasonYear: number, leagueStartYear: number): number {
  const elapsed = Math.max(0, seasonYear - leagueStartYear);
  return Math.round(CAP.BASE_CAP * Math.pow(1 + CAP.CAP_GROWTH_PER_YEAR, elapsed));
}

/**
 * How many SEASONS FROM SIGNING a bonus is charged over. The real rule: five,
 * whatever the length of the deal (CAP.MAX_PRORATION_YEARS). Void years extend
 * the divisor up to that same ceiling.
 */
export function prorationYears(c: ContractLike): number {
  return Math.min(c.years + (c.voidYears ?? 0), CAP.MAX_PRORATION_YEARS);
}

/**
 * How many void years can actually DO anything on a deal of this length, and
 * therefore how many a contract is allowed to carry.
 *
 * Void years work by widening the proration divisor, and that divisor stops at
 * CAP.MAX_PRORATION_YEARS. A five-year deal already amortises its bonus over
 * five years, so a void year on it changes nothing — not the cap hit, not the
 * dead money, nothing. That is not a limitation of this model; it is the real
 * rule, and it is why real front offices hang void years off SHORT deals.
 *
 * Left unclamped this is the bug the tester actually hit when he reported that
 * *"void years aren't altering cap hits"*. The slider ran 0-3 on every deal,
 * but measured against a 5-year contract all three positions produced the
 * identical year-1 number, and on a 4-year contract only the first one moved it:
 *
 *     3yr:  +0 $20.00M   +1 $18.00M   +2 $16.80M   +3 $16.80M
 *     4yr:  +0 $20.00M   +1 $18.40M   +2 $18.40M   +3 $18.40M
 *     5yr:  +0 $20.00M   +1 $20.00M   +2 $20.00M   +3 $20.00M   <- all inert
 *
 * So the control moved, the ledger did not, and the contract card then went on
 * to print "+3 void years" over a deal where they bought precisely nothing.
 * Clamping here means a stored contract never claims a void year that is not
 * really doing work, and `MAX_VOID_YEARS_FOR` gives the slider the same ceiling
 * so the user is never offered inert travel in the first place.
 */
export function usableVoidYears(years: number, requested: number): number {
  const room = Math.max(0, CAP.MAX_PRORATION_YEARS - Math.max(1, Math.round(years)));
  return clamp(Math.round(requested), 0, room);
}

/** Annual proration of a signing bonus (realistic mode only), for the years it is charged in. */
export function proration(c: ContractLike): number {
  const yrs = prorationYears(c);
  return yrs > 0 ? Math.round(c.signingBonus / yrs) : 0;
}

/**
 * Which season of the deal we are in, counting from signing. 0 is the year it
 * was signed. This is the index `baseSalaries` is stored against and the one
 * the proration window is measured in.
 */
function yearIndex(c: ContractLike): number {
  return Math.max(0, c.years - c.yearsRemaining);
}

/**
 * ---------------------------------------------------------------------------
 * THE FIVE-YEAR PRORATION WINDOW, AND THE BUG THE 12-YEAR CEILING EXPOSED
 * ---------------------------------------------------------------------------
 * `proration()` divides the bonus by AT MOST five years, and every function
 * below used to add that figure to every single year of the contract. While no
 * deal could exceed five years those two statements were the same statement,
 * so nothing surfaced it. They are not the same statement any more: the league
 * ceiling is twelve years now, and a seven-year deal was charging its bonus
 * seven times over — on the worked example, $58.8M of cap charges against a
 * $42.0M bonus, and dead money to match.
 *
 * The real rule is the one this now implements: the bonus is charged for the
 * first five seasons and years six onward are PURE BASE SALARY, which is also
 * why a long deal gets cheap to escape near the end. Every figure below is
 * measured in the same window so they cannot disagree with each other.
 *
 * Nothing changes for any contract that could exist before this: at five years
 * or fewer the window covers the whole deal and every one of these returns
 * exactly what it returned. What it also fixes, in passing, is a void-year deal
 * whose real years plus void years exceeded five — 4+3 charged seven years of
 * proration against a bonus that only ever amortised over five.
 * ---------------------------------------------------------------------------
 */

/**
 * Cap hit for the CURRENT year of a contract, by mode (design doc section 8).
 *
 * REALISTIC — base salary + prorated signing bonus. Cuts leave dead money.
 * SIMPLIFIED — flat APY every year, no proration, no dead money. Cuts are free.
 * OFF        — everything is 0; cap checks are skipped entirely.
 */
export function capHit(c: ContractLike | null | undefined, mode: CapMode): number {
  if (!c || mode === 'OFF') return 0;
  const bases = readJson<number[]>(c.baseSalaries, []);
  const yearIdx = yearIndex(c);
  const base = bases[yearIdx] ?? bases[bases.length - 1] ?? CAP.MIN_SALARY;

  if (mode === 'SIMPLIFIED') {
    const total = bases.reduce((a, b) => a + b, 0) + c.signingBonus;
    return Math.round(total / Math.max(1, c.years));
  }
  return base + (yearIdx < prorationYears(c) ? proration(c) : 0);
}

/** Total contract value across all remaining years. */
export function remainingValue(c: ContractLike, mode: CapMode): number {
  if (mode === 'OFF') return 0;
  const bases = readJson<number[]>(c.baseSalaries, []);
  const startIdx = yearIndex(c);
  const remainingBase = bases.slice(startIdx).reduce((a, b) => a + b, 0);
  // Only the bonus years still inside the five-year window are still to be
  // charged; on a long deal the later years carry base salary and nothing else.
  const bonusYearsLeft = Math.max(0, prorationYears(c) - startIdx);
  return remainingBase + (mode === 'REALISTIC' ? proration(c) * bonusYearsLeft : 0);
}

/**
 * Dead money left behind by cutting a player right now.
 * REALISTIC: all remaining bonus proration accelerates onto this year's cap
 * — including any void years, since those were never real roster years to
 * begin with and always accelerate the moment the real deal ends.
 * SIMPLIFIED / OFF: nothing.
 */
export function deadMoneyOnCut(c: ContractLike | null | undefined, mode: CapMode): number {
  if (!c || mode !== 'REALISTIC') return 0;
  // Everything not yet amortised accelerates onto this year's cap — no more
  // than that, and no less. Void years are already inside `prorationYears`,
  // which is what makes them accelerate the moment the real deal ends.
  return proration(c) * Math.max(0, prorationYears(c) - yearIndex(c));
}

/**
 * Cap hit for every remaining real year of the deal (index 0 = this year),
 * so a negotiation UI can show the whole schedule a front-loaded or
 * back-loaded structure actually produces instead of just year 1.
 *
 * `baseSalaries` always holds the FULL original contract (indexed from
 * signing, same as capHit()'s own yearIdx lookup) — it has to, since
 * capHit() reads year-elapsed-so-far back out of it. This only ever got
 * called on a brand-new contract preview before (ExtendContractForm), where
 * yearsRemaining == years, so yearIdx is always 0 and slicing was a no-op —
 * nothing surfaced this. Called on an existing, partway-elapsed contract
 * without slicing from yearIdx, it would hand back already-elapsed past
 * years glued onto the front of "the remaining schedule."
 */
export function capHitSchedule(c: ContractLike, mode: CapMode): number[] {
  const startIdx = yearIndex(c);
  const all = readJson<number[]>(c.baseSalaries, []);
  // Exactly one row per remaining year, always. A well-formed contract has one
  // base salary per year and this is just `slice`; a row that has lost an entry
  // would otherwise render a schedule SHORTER than the "3 of 5 years remaining"
  // printed above it, and a table disagreeing with the sentence over it is the
  // bug class this codebase treats as a bug. Same fallback capHit() uses.
  const bases: number[] = [];
  for (let i = 0; i < Math.max(0, c.yearsRemaining); i++) {
    bases.push(all[startIdx + i] ?? all[all.length - 1] ?? CAP.MIN_SALARY);
  }
  if (mode === 'OFF') return bases.map(() => 0);
  if (mode === 'SIMPLIFIED') {
    const total = all.reduce((a, b) => a + b, 0) + c.signingBonus;
    const flat = Math.round(total / Math.max(1, c.years));
    return bases.map(() => flat);
  }
  const p = proration(c);
  const window = prorationYears(c);
  return bases.map((b, i) => b + (startIdx + i < window ? p : 0));
}

/**
 * ===========================================================================
 * AN EXTENSION ADDS YEARS. IT DOES NOT REPLACE THE DEAL.
 * ===========================================================================
 * `extendContract` (lib/freeagency.ts) tears the old contract up and writes a
 * fresh one — which is what a re-sign is, and it is what extensions used to do
 * too. The app owner's ruling on that: *"it should add a year on top, as it
 * does it real life"*. So this is the real shape:
 *
 *   A man with 3 years left signs a 4-year extension. He is under contract for
 *   SEVEN years. The 3 existing years keep their base salaries exactly as they
 *   were. The 4 new years are appended. A new signing bonus is paid now and
 *   prorates from now, still capped at CAP.MAX_PRORATION_YEARS.
 *
 * WHAT "NEW MONEY" MEANS, because it is the number he negotiates and the one
 * most likely to mislead. A "4 year, $120M extension" is $30M/yr on the NEW
 * years; the APY across all seven years is a different and lower figure. Both
 * come back from here — `newMoneyTotal` and the full schedule — because
 * quoting either as the other is the lying-metric failure in its most natural
 * habitat.
 *
 * THE ONE DOCUMENTED SIMPLIFICATION. Real accounting keeps the OLD bonus
 * prorating on its own original schedule while the new one prorates
 * separately; a contract row here has a single `signingBonus` field and a
 * single proration, so the old bonus's unamortized remainder is carried into
 * the combined bonus and re-prorated across what is now left. This is exactly
 * what `restructureContract` above already does and for the same reason, it
 * keeps the total dead money right (every unamortized dollar is still on the
 * books and still accelerates on a cut), and its visible effect — this year's
 * cap hit drops a little while the later years rise — is the real-world effect
 * of extending anyway. What it does NOT do is let the old bonus vanish: after
 * an extension the dead money is the sum of both bonuses, which is precisely
 * why extending early is a commitment rather than a freebie.
 * ===========================================================================
 */
export function buildExtension(opts: {
  /** The deal as stored. Its remaining years keep their salaries untouched. */
  current: ContractLike;
  /** APY of the NEW years only — the number he actually negotiates. */
  newMoneyApy: number;
  /** How many years are being added on the end. */
  addYears: number;
  /** The league year this is signed in. */
  signedYear: number;
  escalation?: number;
  bonusPct?: number;
  guaranteedPct?: number;
  voidYears?: number;
}): {
  years: number;
  yearsRemaining: number;
  signedYear: number;
  baseSalaries: number[];
  signingBonus: number;
  guaranteed: number;
  voidYears: number;
  /** Total value of the years being ADDED, bonus included. What he agreed to. */
  newMoneyTotal: number;
  /** Total value of what he was already owed, carried bonus included. */
  oldMoneyRemaining: number;
  /** Index into baseSalaries where the extension starts. */
  firstNewYearIndex: number;
} {
  const bases = readJson<number[]>(opts.current.baseSalaries, []);
  const elapsed = Math.max(0, opts.current.years - opts.current.yearsRemaining);
  // The years he is still owed, at the salaries he was already promised.
  //
  // Padded to the number of years he is actually owed. A well-formed contract
  // has one base salary per year and this does nothing — but `capHit` already
  // carries the same fallback for the same reason, and a row that has lost an
  // entry must not quietly SHORTEN the deal here, which would hand the player
  // fewer years than the ledger says he has.
  const remainingBases = bases.slice(elapsed);
  while (remainingBases.length < opts.current.yearsRemaining) {
    remainingBases.push(remainingBases[remainingBases.length - 1] ?? bases[bases.length - 1] ?? CAP.MIN_SALARY);
  }
  // Bonus money already paid but not yet charged to a cap. It does not
  // disappear because a new deal was signed on top of it.
  const carriedBonus = Math.round(proration(opts.current) * opts.current.yearsRemaining);

  const addYears = Math.max(1, Math.round(opts.addYears));
  const fresh = buildContract({
    apy: opts.newMoneyApy,
    years: addYears,
    signedYear: opts.signedYear,
    escalation: opts.escalation,
    bonusPct: opts.bonusPct,
    guaranteedPct: opts.guaranteedPct,
  });

  const baseSalaries = [...remainingBases, ...fresh.baseSalaries];
  // Rebased on the years that are actually left, exactly as restructureContract
  // does — so `years - yearsRemaining` is 0 right now and capHit() reads
  // baseSalaries[0] for the current season, then walks forward a year at a
  // time as the ledger ages. Getting this wrong is silent and expensive.
  const years = baseSalaries.length;

  return {
    years,
    yearsRemaining: years,
    signedYear: opts.signedYear,
    baseSalaries,
    signingBonus: carriedBonus + fresh.signingBonus,
    // What is locked in GOING FORWARD: bonus money already paid plus whatever
    // the new years guarantee. The old deal's guarantee figure described money
    // some of which has already been paid out, so it is not carried whole.
    guaranteed: carriedBonus + fresh.guaranteed,
    // Clamped against the FULL appended length, not the added years: an
    // extension that takes a man to six contract years has already exhausted
    // the proration window, so a void year on it does nothing and must not be
    // stored claiming otherwise. See usableVoidYears.
    voidYears: usableVoidYears(years, opts.voidYears ?? 0),
    newMoneyTotal: fresh.baseSalaries.reduce((a, b) => a + b, 0) + fresh.signingBonus,
    oldMoneyRemaining: remainingBases.reduce((a, b) => a + b, 0) + carriedBonus,
    firstNewYearIndex: remainingBases.length,
  };
}

/**
 * Restructure a contract: convert part of the CURRENT year's base salary
 * into signing bonus, which lowers this year's cap hit but raises every
 * future year's (via a bigger prorated bonus) — the classic real-NFL move.
 * Rebases the deal as if freshly re-signed for exactly the years left, so
 * the combined (old + newly converted) bonus reprorates cleanly over what
 * actually remains, optionally stretched further with fresh void years.
 */
export function restructureContract(
  c: ContractLike,
  convertAmount: number,
  opts: { addVoidYears?: number; nowYear: number },
): { years: number; yearsRemaining: number; signedYear: number; baseSalaries: number[]; signingBonus: number; voidYears: number; guaranteed: number } {
  const bases = readJson<number[]>(c.baseSalaries, []);
  const yearIdx = Math.max(0, c.years - c.yearsRemaining);
  const currentBase = bases[yearIdx] ?? 0;
  const converted = clamp(Math.round(convertAmount), 0, Math.max(0, currentBase - CAP.MIN_SALARY));

  const remainingBases = bases.slice(yearIdx);
  remainingBases[0] = currentBase - converted;

  return {
    years: c.yearsRemaining,
    yearsRemaining: c.yearsRemaining,
    signedYear: opts.nowYear,
    baseSalaries: remainingBases,
    signingBonus: c.signingBonus + converted,
    // ADD, as the option name says. This used to assign, which silently DELETED
    // void years a deal already carried: restructuring a 3+2 deal with the void
    // slider left at zero shortened its proration window from five years to
    // three and RAISED the very cap hit the restructure was performed to lower.
    voidYears: usableVoidYears(c.yearsRemaining, (c.voidYears ?? 0) + Math.max(0, opts.addVoidYears ?? 0)),
    guaranteed: c.guaranteed,
  };
}

/**
 * Which league year a cap charge booked RIGHT NOW belongs to.
 *
 * The offseason phase machine bumps League.seasonYear at its RESET_STANDINGS
 * step (OFFSEASON week 2), and expireStaleCapCharges() then hard-deletes
 * every CapCharge from a year before the new one. So dead money booked during
 * OFFSEASON weeks 1-2 was filed under the season that was ending, sat in a
 * window where cap compliance is deliberately not enforced (see
 * CAP_ROLLOVER_PHASES in lib/season.ts), and was deleted two steps later
 * without ever being charged to anyone. Cutting a player cost full price in
 * PRESEASON week 1 and exactly nothing in OFFSEASON week 1 — a timing trick,
 * not a decision, and invisible in the UI.
 *
 * Real football has the same boundary and answers it the same way: a player
 * released after the season ends but before the new league year opens counts
 * against the NEW year. So do we.
 *
 * The AMOUNT has to describe that same year, which is a separate question and
 * used to have a different answer: deadMoneyOnCut() reads `yearsRemaining`,
 * and the contract ledger only stepped forward at the OFFSEASON week-3 step —
 * two steps after this function starts pointing at the new year. A cut made
 * early therefore charged one extra year of proration to a season the deal
 * had already spent a year of. The ledger now ages the moment the season ends
 * (ageContractsForYear in lib/season.ts), so by the time this returns
 * `seasonYear + 1` the contract is already counted in that year's terms and
 * an early cut and a late one cost exactly the same.
 */
export function capChargeYear(opts: { phase: string; week: number; seasonYear: number }): number {
  const beforeYearRoll = opts.phase === 'OFFSEASON' && opts.week <= CAP.OFFSEASON_YEAR_ROLL_WEEK;
  return beforeYearRoll ? opts.seasonYear + 1 : opts.seasonYear;
}

/** Net cap saved by cutting: this year's hit minus the dead money incurred. */
export function capSavingsOnCut(c: ContractLike | null | undefined, mode: CapMode): number {
  if (!c || mode === 'OFF') return 0;
  return capHit(c, mode) - deadMoneyOnCut(c, mode);
}

/**
 * WHAT MOVING ONE CONTRACT DOES TO THE TWO CAP SHEETS IT TOUCHES.
 *
 * The two sides of a trade are NOT mirror images, and this is the single
 * place that says so: in REALISTIC the signing bonus does not travel — the
 * club giving him up eats the whole remaining proration immediately, and the
 * club acquiring him inherits base salary only. In SIMPLIFIED the flat-APY
 * contract travels intact and nothing accelerates.
 *
 * It lives in lib/cap.ts, with the rest of the pure math, precisely so the
 * SCREEN and the EXECUTOR can share it: `tradeCapDeltas` (lib/capEnforcement)
 * — which the cap gate, the executor and the AI's own cap refusal all run —
 * is nothing but this function summed over the assets, and the trade
 * builder's live "space after" readout is the same call made per player on
 * the server. Two derivations of one figure is exactly how this app has
 * repeatedly shipped a panel quoting a number it was not using.
 */
export interface TradeCapEffect {
  /** Cap the club SENDING him actually frees — his hit less the bonus that accelerates onto them. */
  frees: number;
  /** Cap the club RECEIVING him actually takes on — base salary only in REALISTIC. */
  takesOn: number;
  /** Bonus that accelerates onto the sending club as an immediate dead-money charge. Always 0 outside REALISTIC. */
  dead: number;
}

export function tradeCapEffect(c: ContractLike | null | undefined, mode: CapMode): TradeCapEffect {
  if (!c || mode === 'OFF') return { frees: 0, takesOn: 0, dead: 0 };
  const hit = capHit(c, mode);
  const dead = deadMoneyOnCut(c, mode);
  return {
    frees: hit - dead,
    takesOn: hit - (mode === 'REALISTIC' ? proration(c) : 0),
    dead,
  };
}

// ---------------------------------------------------------------------------
// Market value
// ---------------------------------------------------------------------------

/**
 * What a player of this overall/position/age commands per year on the open
 * market. [FRAGILE PLACEHOLDER] — piecewise exponential: gentle growth above
 * PIVOT (a 99 OVR neutral-position unicorn still lands well under $40M/yr),
 * steeper decay below it (so a 53-man roster's worth of below-average depth
 * doesn't blow the cap before a single good player is even signed).
 */
export function marketValue(opts: {
  ovr: number;
  position: Position;
  age: number;
  potential?: number;
}): number {
  const { ovr, position, age } = opts;
  const steepness = ovr >= MARKET.PIVOT ? MARKET.STEEPNESS : MARKET.STEEPNESS_LOW;
  const base = Math.exp((ovr - MARKET.PIVOT) * steepness) * MARKET.SCALE;
  const posMult = MARKET.POSITION_MULT[position] ?? 1;

  let ageMult = 1;
  if (age > MARKET.AGE_DISCOUNT_START) {
    ageMult -= (age - MARKET.AGE_DISCOUNT_START) * MARKET.AGE_DISCOUNT_PER_YEAR;
  } else if (age < 26) {
    ageMult += (26 - age) * MARKET.YOUTH_PREMIUM_PER_YEAR;
  }
  ageMult = clamp(ageMult, 0.35, 1.35);

  return Math.max(CAP.MIN_SALARY, Math.round((base * posMult * ageMult) / 100_000) * 100_000);
}

/**
 * Reasonable contract length for a player's age/quality. Constants live in
 * CONTRACT (lib/tuning.ts) — see there for the calibration.
 *
 * This used to bottom out at `return 2` for anyone under 66 OVR, which is
 * the modal roster player, so roughly half of every generated league sat on
 * two-year deals and hit free agency on the same cycle forever. Age gates
 * still come first and still shorten hard: quality buys term only for a
 * player young enough to still be worth it at the end of the deal.
 */
export function suggestedYears(ovr: number, age: number): number {
  if (age >= CONTRACT.AGE_ONE_YEAR) return 1;
  if (age >= CONTRACT.AGE_TWO_YEAR) return 2;
  if (age >= CONTRACT.AGE_THREE_YEAR) return 3;
  if (ovr >= CONTRACT.MAX_DEAL_OVR && age <= CONTRACT.MAX_DEAL_MAX_AGE) return CONTRACT.MAX_DEAL_YEARS;
  if (ovr >= CONTRACT.STANDARD_OVR) return CONTRACT.STANDARD_YEARS;
  return CONTRACT.FRINGE_YEARS;
}

/**
 * ---------------------------------------------------------------------------
 * HOW LONG A DEAL MAY BE, AND HOW LONG HE IS WILLING TO SIGN FOR
 * ---------------------------------------------------------------------------
 * These two used to be the same question and the answer was a ladder: 34 and
 * over got one year, 32 got two, 30 got three, everyone else five. Blunt, and
 * it said nothing about the man — a 34-year-old quarterback and a 34-year-old
 * running back were handed the identical rule.
 *
 * The app owner asked for the ladder gone: *"We should remove the max ages for
 * the contracts. Just set it to a 12 year max and if the player is old they
 * can say 'the player doesn't want to play that long' but lets assume that's
 * for 35-40year olds at random depending on the player"*. So there are two
 * separate answers now:
 *
 *   THE RULEBOOK  — `maxYearsForAge`, flat 12 for everybody. It is a league
 *                   rule and it knows nothing about the player.
 *   THE PLAYER    — `willingnessHorizon`, how many more seasons THIS man will
 *                   actually commit to, refused in his own voice by
 *                   `decideOffer` rather than by the rulebook.
 *
 * WHY THE HORIZON IS DERIVED AND NOT INVENTED. There is already a retirement
 * model — `retirementChance(age, trueOvr, position)` in lib/progression.ts,
 * rolled every offseason in lib/season.ts. If the panel says he does not
 * intend to play past 38 and the sim then has him playing at 41, that is a
 * lying metric (README, design principle 6). So the horizon is that same
 * function walked forward: accumulate the probability he is still playing at
 * each future age and stop where it falls through a floor. Position comes
 * along for free, because `retirementChance` is already position-adjusted —
 * a 34-year-old quarterback genuinely outlasts a 34-year-old running back and
 * nothing here had to be told so.
 * ---------------------------------------------------------------------------
 */

/**
 * [TUNE] These belong in CONTRACT (lib/tuning.ts) and should move there the
 * moment that file is free — they are parked here, beside the function that
 * reads them, only because tuning.ts is being edited elsewhere.
 */
export const TERM = {
  /** The league rule. No contract, from anybody, to anybody, may exceed this. */
  MAX_CONTRACT_YEARS: 12,
  /**
   * Retirement rolls do not start until 32 (see retirementChance), so the
   * walk-forward is anchored there rather than at his current age. That makes
   * the horizon a property of the PLAYER — the last season he means to play —
   * instead of a property of when you happen to ask him. A 41-year-old who is
   * still going does not thereby acquire three more years of intent.
   */
  ANCHOR_AGE: 32,
  /**
   * Survival probability at which he stops committing seasons, drawn per
   * player inside this band. The width is the "at random depending on the
   * player" the owner asked for: two identical 36-year-olds land a year or
   * two apart.
   */
  FLOOR_MIN: 0.22,
  FLOOR_MAX: 0.48,
  /** The band the owner named. Nobody refuses before 35; nobody commits past 40. */
  MIN_FINAL_AGE: 35,
  MAX_FINAL_AGE: 40,
} as const;

/**
 * The LONGEST deal anyone may be handed, by rule. Flat — see the block above.
 *
 * The age ladder that used to live here has moved to the player himself
 * (`willingnessHorizon`), where it can differ by man and position and be
 * stated in his own voice before the user commits to a term, rather than
 * appearing as a rulebook refusal after the fact.
 *
 * Kept as a function of age, and kept named this way, because the AI re-sign
 * wave in lib/season.ts calls it as its term ceiling; it now clamps against
 * the league rule, and its own `suggestedYears` base (which still has the age
 * ladder in it) is what keeps AI deals short for old players.
 */
export function maxYearsForAge(_age?: number): number {
  return TERM.MAX_CONTRACT_YEARS;
}

/**
 * How many more seasons this player will actually put his name to, and the
 * age he does not intend to play past.
 *
 * Walks `retirementChance` forward from ANCHOR_AGE accumulating survival
 * probability, takes the last age where survival is still above a per-player
 * floor, and clamps it into the 35-40 band. Seeded off the player id alone,
 * so the same man gives the same answer in the browser, in the Server Action
 * and in a script — this is called on both sides of the negotiation and the
 * two may never disagree.
 *
 * `years` is inclusive of the season he is signing for: a 39-year-old who
 * does not mean to play past 40 will sign for two.
 */
export function willingnessHorizon(opts: {
  playerId: string;
  age: number;
  trueOvr: number;
  position: string;
}): { finalAge: number; years: number } {
  const floor = new Rng(`willing-${opts.playerId}`).float(TERM.FLOOR_MIN, TERM.FLOOR_MAX);
  const position = opts.position as Position;

  let survival = 1;
  let finalAge: number = TERM.ANCHOR_AGE;
  for (let age = TERM.ANCHOR_AGE + 1; age <= TERM.MAX_FINAL_AGE + 8; age++) {
    survival *= 1 - retirementChance(age, opts.trueOvr, position);
    if (survival < floor) break;
    finalAge = age;
  }
  /*
   * The floor is his CURRENT age, not a constant. Clamped to a flat
   * MIN_FINAL_AGE, a 38-year-old was told he "does not intend to play past
   * 35" — a sentence about a season he has already played. It lands on the
   * oldest free agent in the pool, which is the first name anyone sees
   * sorting by age. Capped again at MAX_FINAL_AGE so a 44-year-old cannot
   * push the lower bound above the upper one.
   */
  const notBeforeNow = Math.min(Math.max(TERM.MIN_FINAL_AGE, Math.round(opts.age)), TERM.MAX_FINAL_AGE);
  finalAge = clamp(Math.round(finalAge), notBeforeNow, TERM.MAX_FINAL_AGE);

  return {
    finalAge,
    years: clamp(finalAge - opts.age + 1, 1, TERM.MAX_CONTRACT_YEARS),
  };
}

/**
 * Build a contract offer: APY split into escalating base salaries plus a
 * signing bonus, which is how real deals are shaped (low year-1 cap hit).
 */
export function buildContract(opts: {
  apy: number;
  years: number;
  signedYear: number;
  bonusPct?: number; // share of total value paid as signing bonus
  guaranteedPct?: number;
  isRookieDeal?: boolean;
  /**
   * Year-over-year base salary growth multiplier. Default 1.12 makes a
   * FRESH signing cap-friendly in year 1. Pass ~1.0 (flat) for contracts
   * that get immediately "aged" into a random later year at league
   * generation — otherwise staggering lands players in the single most
   * expensive year of a backloaded deal, with none of the cheap early
   * years ever having applied, wildly inflating that team's cap hit.
   */
  escalation?: number;
  /**
   * Cap-only trailing years. They widen the proration divisor (see
   * `prorationYears`) and nothing else — he is not paid for them, and they are
   * not contract years.
   *
   * THIS OPTION USED NOT TO EXIST, and its absence was a bug rather than a
   * missing convenience. Every caller that wanted void years had to remember
   * to splice the field back on by hand before pricing — `{ ...contract,
   * voidYears }` — because the object this returns did not carry it.
   * `signFreeAgent` and `decideOffer` remembered. `extendContract`, which is
   * the RE-SIGN path, did not: it wrote `voidYears` to the database but gated
   * the signing on a cap hit computed without them, so the game demanded
   * $20.00M of room for a deal that would only ever cost $18.40M, and refused
   * re-signs it should have allowed. Taking the option here is what stops a
   * caller forgetting it again.
   */
  voidYears?: number;
}): {
  years: number;
  yearsRemaining: number;
  signedYear: number;
  baseSalaries: number[];
  signingBonus: number;
  guaranteed: number;
  voidYears: number;
  isRookieDeal: boolean;
} {
  const years = Math.max(1, Math.round(opts.years));
  // No year of any contract may pay below the league minimum, so the smallest
  // deal that can exist over `years` is MIN_SALARY x years. Deciding that HERE
  // rather than silently clamping year by year is the whole fix: the base
  // salaries were floored at MIN_SALARY while the signing bonus was still
  // computed off the un-floored nominal total, so every league-minimum deal
  // quietly cost 28-39% more than the APY it was written for (measured:
  // {apy: $1.00M, years: 3} produced a $1.28M year-1 cap hit; {apy: $0.90M,
  // years: 4} produced $5.01M of contract against a $3.60M nominal). Every
  // budget that priced a minimum signing off `apy` — the re-sign reserve most
  // of all — was short by exactly that much.
  const total = Math.max(Math.round(opts.apy * years), CAP.MIN_SALARY * years);
  const bonusPct = opts.bonusPct ?? 0.28; // [TUNE]
  const nominalBonus = Math.round(total * bonusPct);
  const baseTotal = total - nominalBonus;

  // Escalate base salary ~12% per year so year 1 is cap-friendly. [TUNE]
  const escalation = opts.escalation ?? 1.12;
  const weights: number[] = [];
  for (let i = 0; i < years; i++) weights.push(Math.pow(escalation, i));
  const wSum = weights.reduce((a, b) => a + b, 0);
  const baseSalaries = weights.map((w) =>
    Math.max(CAP.MIN_SALARY, Math.round((baseTotal * w) / wSum / 100_000) * 100_000),
  );

  // Whatever the minimum-salary floor (and the 100K rounding) added to the
  // base schedule comes OUT of the signing bonus, so the deal is still worth
  // what it was written for. At a true league-minimum deal this drives the
  // bonus to exactly 0 — which is what a minimum contract looks like anyway.
  const baseSum = baseSalaries.reduce((a, b) => a + b, 0);
  const signingBonus = Math.max(0, nominalBonus - (baseSum - baseTotal));

  return {
    years,
    yearsRemaining: years,
    signedYear: opts.signedYear,
    baseSalaries,
    signingBonus,
    guaranteed: Math.round((baseSum + signingBonus) * (opts.guaranteedPct ?? 0.45)),
    voidYears: usableVoidYears(years, opts.voidYears ?? 0),
    isRookieDeal: opts.isRookieDeal ?? false,
  };
}

/** Rookie scale: linear-ish interpolation between pick 1 and the last pick. */
export function rookieScaleApy(overallPick: number, totalPicks: number): number {
  const t = clamp((overallPick - 1) / Math.max(1, totalPicks - 1), 0, 1);
  // Exponential decay matches the real scale's shape better than linear. [TUNE]
  const apy = CAP.ROOKIE_SCALE_R1_PICK1 * Math.pow(CAP.ROOKIE_SCALE_R7_LAST / CAP.ROOKIE_SCALE_R1_PICK1, t);
  return Math.max(CAP.MIN_SALARY, Math.round(apy / 50_000) * 50_000);
}

/** Franchise tag value = average of the top-N cap hits at the position. */
export function franchiseTagValue(positionSalaries: number[]): number {
  const top = [...positionSalaries].sort((a, b) => b - a).slice(0, CAP.FRANCHISE_TAG_TOP_N);
  if (top.length === 0) return CAP.MIN_SALARY * 5;
  return Math.round(top.reduce((a, b) => a + b, 0) / top.length);
}

export function formatMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs}`;
}
