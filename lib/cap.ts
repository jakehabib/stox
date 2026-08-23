import { CAP, CONTRACT, FREE_AGENCY, MARKET, Position } from './tuning';
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

/**
 * What a group of men costs the club this year — the "$X committed here" figure
 * over a position's depth. A man with no contract row charges nothing, which is
 * why the rows that feed this carry `null` rather than 0 for him: null is "no
 * deal on file", 0 is a claim about a deal.
 *
 * It lives HERE, beside `capHit`, and not in the component that first needed it.
 * It was declared in components/ds/DepthAtPosition.tsx, which is a `'use client'`
 * module — and every export of a client module reaches a Server Component as a
 * client reference, not as the function itself. The player card imported it and
 * called it while rendering on the server, so that page threw
 * `capCommitted is not a function` and returned a 500 the moment the panel had
 * a man to price. `next build` cannot catch it (every league page is
 * force-dynamic, so nothing renders at build time) and neither can tsc, which
 * sees a perfectly good function. Cap arithmetic in lib/cap.ts is callable from
 * both sides, which is the only version of this that stays fixed.
 */
export function capCommitted(rows: readonly { capHit: number | null }[]): number {
  return rows.reduce((n, r) => n + (r.capHit ?? 0), 0);
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
 * ---------------------------------------------------------------------------
 * THE GUARANTEE THE PANEL SHOWS AND THE GUARANTEE THAT BINDS
 * ---------------------------------------------------------------------------
 * `deadMoneyOnCut` used to be the unamortised signing bonus and nothing else.
 * It never read `guaranteed` at all — so the guarantee slider on the
 * negotiation screen moved a figure the club was never actually held to, and
 * it was wrong in BOTH directions. Measured on a 93 free agent, four years at
 * market, before this:
 *
 *     slider    "guaranteed" shown    dead money if cut
 *        0%           $0.0M                 $4.6M
 *       50%          $19.2M                $13.2M
 *      100%          $38.4M                $21.8M
 *
 * At the top of the slider the club walked away from $16.6M it had told the
 * player was locked in; at the bottom the panel said nothing was guaranteed
 * while $4.6M still bound, because `contractShapeFor` pays a 12% signing
 * bonus even at a zero guarantee and a signing bonus is cash in his pocket.
 *
 * HOW `guaranteed` IS STORED. `buildContract` writes
 * `(baseSum + signingBonus) * guaranteedPct` — a share of the deal's TOTAL
 * value. The signing bonus is INSIDE that figure, not on top of it. So the
 * guaranteed BASE SALARY is `guaranteed - signingBonus`, and adding the two
 * together would count the bonus twice. Legacy rows can carry a `guaranteed`
 * BELOW the bonus (the 0% slider above); that is not a smaller guarantee,
 * because the bonus was paid regardless, which is what `guaranteedMoney`
 * floors and what `buildContract` now stores directly.
 *
 * WHAT A RELEASE COSTS. The real rule, and now this one: the unamortised
 * signing bonus PLUS the guaranteed base salary still owed. They are
 * different kinds of money — the bonus is cash already paid whose cap charge
 * accelerates, the guaranteed salary is cash the club has yet to pay and now
 * must — and both land on the cut year's cap, which is why one function adds
 * them.
 *
 * A TRADE IS NOT A RELEASE, and this is why `unamortizedBonus` is exported
 * separately. When a player is dealt, only the bonus accelerates onto the
 * club giving him up; his guaranteed salary travels with the contract and is
 * the acquiring club's problem (see `tradeCapEffect`, and the `guaranteed`
 * rewrite in executeTrade that keeps the two halves from being charged twice).
 * ---------------------------------------------------------------------------
 */

/**
 * Base salary for every year of the deal, indexed from signing, with the same
 * fallback capHit() and capHitSchedule() use — so every figure here is
 * measured off the identical schedule those two are.
 */
function baseSchedule(c: ContractLike): number[] {
  const raw = readJson<number[]>(c.baseSalaries, []);
  const out: number[] = [];
  for (let i = 0; i < Math.max(1, Math.round(c.years)); i++) {
    out.push(raw[i] ?? raw[raw.length - 1] ?? CAP.MIN_SALARY);
  }
  return out;
}

/**
 * Total guaranteed money written into a deal — bonus included, since the
 * bonus is guaranteed by being paid up front. `buildContract` stores exactly
 * this now; the floor is what keeps contracts already sitting in a save from
 * claiming a guarantee smaller than the cheque the club has handed over.
 */
export function guaranteedMoney(c: ContractLike): number {
  return Math.max(c.guaranteed, c.signingBonus);
}

/**
 * How the guaranteed base salary sits across the years of the deal.
 *
 * Earliest year first, because that is how guarantees are written and how
 * they are consumed: a man three years into a four-year deal has already
 * COLLECTED the guaranteed part of years one to three, so nothing about
 * those years binds the club any more. The alternative — carrying the whole
 * figure to the end of the deal — would make a veteran on an old contract
 * permanently untradeable and uncuttable, which is the opposite of how a
 * deal ages in real football.
 *
 * The year the club is IN counts as still owed. The cap charges that season
 * whole (capHit takes no view on which week it is), so a release during it
 * has to answer for the whole of it too, or cutting a man in December would
 * quietly cost less than cutting him in August.
 */
function guaranteedBaseByYear(c: ContractLike): number[] {
  let left = Math.max(0, guaranteedMoney(c) - c.signingBonus);
  return baseSchedule(c).map((b) => {
    const g = Math.min(left, b);
    left -= g;
    return g;
  });
}

/** Guaranteed base salary the club still owes him if it releases him today. */
export function guaranteedSalaryOwed(c: ContractLike | null | undefined, mode: CapMode): number {
  if (!c || mode !== 'REALISTIC') return 0;
  return guaranteedBaseByYear(c)
    .slice(yearIndex(c))
    .reduce((a, b) => a + b, 0);
}

/**
 * Signing bonus paid but not yet charged to a cap. Accelerates in full the
 * moment he leaves the roster — by release OR by trade. Void years are
 * already inside `prorationYears`, which is what makes them accelerate the
 * moment the real deal ends.
 */
export function unamortizedBonus(c: ContractLike | null | undefined, mode: CapMode): number {
  if (!c || mode !== 'REALISTIC') return 0;
  return proration(c) * Math.max(0, prorationYears(c) - yearIndex(c));
}

/**
 * Dead money left behind by cutting a player right now.
 * REALISTIC: the unamortised signing bonus plus the guaranteed base salary
 * still owed — see the block comment above for why those are the two halves
 * and why they cannot be double-counted.
 * SIMPLIFIED / OFF: nothing.
 */
export function deadMoneyOnCut(c: ContractLike | null | undefined, mode: CapMode): number {
  if (!c || mode !== 'REALISTIC') return 0;
  return unamortizedBonus(c, mode) + guaranteedSalaryOwed(c, mode);
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
  //
  // `unamortizedBonus`, not `proration x yearsRemaining` — the two are the
  // same number only while the deal fits inside the proration window, and
  // this counted the wrong one in both directions the moment it did not.
  // Years left is not bonus years left: a 7-year deal two seasons in has 5
  // years to run and only 3 of bonus window, so it carried 5 years of
  // proration off a bonus with 3 left and charged the difference a second
  // time — the same double-charge `restructureContract` above carried. A
  // deal with void years fails the other way: 3 real years plus 2 void, one
  // played, has 4 years of window left and carried only 2, quietly writing
  // off bonus that must still be paid for and would still accelerate on a cut.
  const carriedBonus = unamortizedBonus(opts.current, 'REALISTIC');

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
 * ===========================================================================
 * A RESTRUCTURE MOVES MONEY. IT MAY NOT CREATE ANY.
 * ===========================================================================
 * Convert part of the CURRENT year's base salary into signing bonus: this
 * year's cap hit falls, every later year's rises, and the dead money on a
 * cut goes up. The classic real-NFL move, and a real decision because of
 * that last clause.
 *
 * It rebases the deal as if freshly re-signed for exactly the years left, so
 * the bonus reprorates over what actually remains rather than over seasons
 * already played, optionally stretched further with fresh void years.
 *
 * WHAT MAY BE CARRIED ACROSS THAT REBASE IS THE UNAMORTISED BONUS, NOT THE
 * WHOLE ONE. This carried `c.signingBonus + converted` — the full original
 * cheque — onto a schedule covering only the years that are left, so every
 * dollar already charged to a past season was charged again. The proof is a
 * conversion of ZERO dollars, which must by definition change nothing:
 *
 *     5yr deal, $25.0M bonus ($5.00M/yr), 2 years played, 3 remaining
 *     BEFORE   proration $5.00M/yr   unamortised $15.0M   capHit $15.0M
 *     AFTER    $25.0M over 3yr    -> $8.33M/yr           capHit $18.3M
 *     EXPECTED $15.0M over 3yr    -> $5.00M/yr           capHit $15.0M
 *
 * Charged over the life of that deal: $5.00M + $5.00M in the seasons played,
 * then $8.33M x 3 = $35.0M against a $25.0M bonus. $10.0M billed twice, and
 * worse the further into the deal you are — a move whose entire purpose is
 * relief quietly inflated every year it touched. `unamortizedBonus` is the
 * money that has NOT yet hit a cap, and it is the only part a rebase is
 * entitled to re-spread.
 *
 * THE INVARIANT THAT NOW GUARDS IT, checked permanently by
 * scripts/checkRestructure.ts: a zero-dollar restructure is a no-op — same
 * cap hit this year, same figure in every remaining year, same dead money —
 * and total proration charged across a deal's whole life equals the bonus
 * actually paid, however many times it is restructured.
 *
 * THE ONE SHAPE THAT CANNOT HOLD BOTH, stated plainly because it is real: a
 * deal longer than CAP.MAX_PRORATION_YEARS. Its bonus stops amortising in
 * year five while the contract runs on, so partway through it has more years
 * left than it has bonus years left — a 7-year deal two seasons in has 5
 * years to run and 3 years of window. A rebased contract's window is
 * `min(years + void, 5)` counted from year 0, so a window SHORTER than the
 * years left is not expressible, and the carried money spreads over 5 years
 * instead of 3. The total stays exactly right; the shape shifts a little
 * money later. Conservation is the invariant that must not bend — carrying
 * enough bonus to hold the per-year figure steady instead is precisely the
 * double-charge above — so this is the side the model errs on, and only for
 * deals past the proration window. Real accounting keeps the old bonus on
 * its own original schedule and prorates only the converted money afresh;
 * one `signingBonus` column cannot express two schedules, which is the same
 * documented simplification `buildExtension` carries.
 * ===========================================================================
 */
export function restructureContract(
  c: ContractLike,
  convertAmount: number,
  opts: { addVoidYears?: number; nowYear: number },
): { years: number; yearsRemaining: number; signedYear: number; baseSalaries: number[]; signingBonus: number; voidYears: number; guaranteed: number; converted: number } {
  const bases = readJson<number[]>(c.baseSalaries, []);
  const yearIdx = Math.max(0, c.years - c.yearsRemaining);
  const currentBase = bases[yearIdx] ?? 0;
  const converted = clamp(Math.round(convertAmount), 0, Math.max(0, currentBase - CAP.MIN_SALARY));

  const remainingBases = bases.slice(yearIdx);
  remainingBases[0] = currentBase - converted;

  // Bonus money paid but not yet charged to any cap. See the block above:
  // this, and not `c.signingBonus`, is what survives the rebase.
  const carriedBonus = unamortizedBonus(c, 'REALISTIC');

  return {
    years: c.yearsRemaining,
    yearsRemaining: c.yearsRemaining,
    signedYear: opts.nowYear,
    baseSalaries: remainingBases,
    signingBonus: carriedBonus + converted,
    // ADD, as the option name says. This used to assign, which silently DELETED
    // void years a deal already carried: restructuring a 3+2 deal with the void
    // slider left at zero shortened its proration window from five years to
    // three and RAISED the very cap hit the restructure was performed to lower.
    voidYears: usableVoidYears(c.yearsRemaining, (c.voidYears ?? 0) + Math.max(0, opts.addVoidYears ?? 0)),
    // RE-EXPRESSED IN THE REBASED FRAME, because `guaranteed` is read against
    // year 0 of whatever schedule it is stored with (guaranteedBaseByYear) and
    // this deal has just been rebased onto the years that are left. Carrying
    // the old figure across verbatim would resurrect guarantees the player has
    // already collected — a man three years into a deal would come out of a
    // restructure owed his year-one guarantee all over again.
    //
    // It is built on `carriedBonus` for the same reason the bonus itself is,
    // and this is not a smaller promise to the player. `guaranteed` is stored
    // bonus-INCLUSIVE, and the only thing anything ever does with it is
    // subtract the bonus back out to find the guaranteed BASE salary
    // (guaranteedBaseByYear). The two fields therefore have to describe the
    // same frame: pair a full original bonus with an unamortised one here and
    // the difference between them re-reads as guaranteed salary still owed,
    // which lands on the cap as dead money — the identical double-charge, just
    // arriving through the other column. lib/trade.ts restates `guaranteed`
    // against a zeroed bonus for exactly this reason.
    //
    // The converted salary joins the bonus, and is guaranteed by being paid
    // now rather than owed later; whatever guaranteed salary the conversion
    // did not swallow is still owed on top of it. So a conversion out of
    // already-guaranteed salary leaves dead money untouched, and a conversion
    // out of salary the club could have walked away from raises it by exactly
    // the amount converted. That is the trap the panel warns about, priced.
    guaranteed:
      carriedBonus + converted
      + Math.max(0, guaranteedSalaryOwed(c, 'REALISTIC') - Math.min(converted, guaranteedBaseByYear(c)[yearIdx] ?? 0)),
    /**
     * What was ACTUALLY converted after the league-minimum floor clamped the
     * request — which is no longer something a caller can infer by comparing
     * signing bonuses. It used to be: the old bonus was carried whole, so
     * `signingBonus` moved if and only if `converted` was non-zero, and
     * lib/freeagency.ts's restructure refuses a request "too small to change
     * anything" on that test. The rebase now changes `signingBonus` on its
     * own — a zero-dollar restructure drops it to the unamortised figure — so
     * that test would pass a request that moves nothing. Callers gate on this.
     */
    converted,
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
 * The WEEK below is a step index, not a count of Advances, and stayed one when
 * the offseason was collapsed into two presses (OFFSEASON_ADVANCES in
 * lib/season.ts). One press now carries three steps, so a league goes from
 * week 1 to week 4 and the pre-roll window is a single observable week rather
 * than two — but the step at week 2 is still RESET_STANDINGS, so this boundary
 * is unmoved and a save stranded mid-roll by the old build still reads right.
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
  // The BONUS, not the whole dead-money figure a release would cost. His
  // guaranteed salary does not accelerate here — it travels inside the
  // contract and lands on the acquiring club as base salary, which `takesOn`
  // is already charging them for. Charging it to both sides would invent
  // money out of a trade.
  const dead = unamortizedBonus(c, mode);
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
 * ---------------------------------------------------------------------------
 * THE QUARTERBACK PREMIUM IS A PREMIUM ON THE JOB, NOT ON THE POSITION.
 * ---------------------------------------------------------------------------
 * Every other position multiplier can be flat because every other position
 * plays several men: a fourth receiver and a third corner take real snaps, so
 * quality and pay fall off together down the chart and one exponential
 * describes the lot. A quarterback room does not work that way. One man plays
 * every offensive snap and the others play none, so there are thirty-two jobs
 * in the whole league and the price of a quarterback is overwhelmingly the
 * price of holding one of them.
 *
 * Applying POSITION_MULT.QB flat — which is what this did — paid a man for
 * being a quarterback rather than for being THE quarterback. Measured across
 * two freshly generated leagues it produced a starter averaging $14.4M against
 * a backup averaging $8.1M: a 1.79x gap, where real football runs closer to
 * 10x ($40-55M against $2-5M). The league's third-most expensive contract was
 * somebody's backup.
 *
 * So the multiplier is shaped by rating instead of flat, on a logistic that
 * crosses over where the thirty-two jobs run out (MARKET.QB_JOB). Note what it
 * is NOT keyed on: it does not ask where this man sits on HIS OWN depth chart.
 * A 93 stuck behind a 95 is still worth starter money — to the other
 * thirty-one clubs — and that is exactly why a club in that position trades
 * him rather than banking a discount. Depth-blindness here is the model being
 * right, not the model being lazy.
 */
export function qbJobShare(ovr: number): number {
  const { BACKUP, STARTER, STARTABLE_ABOVE_PIVOT, WIDTH } = MARKET.QB_JOB;
  const startable = MARKET.PIVOT + STARTABLE_ABOVE_PIVOT;
  return BACKUP + (STARTER - BACKUP) / (1 + Math.exp((startable - ovr) / WIDTH));
}

/**
 * What a player of this overall/position/age commands per year on the open
 * market. [FRAGILE PLACEHOLDER] — piecewise exponential: gentle growth above
 * PIVOT (a 99 OVR neutral-position unicorn still lands well under $40M/yr),
 * steeper decay below it (so a 53-man roster's worth of below-average depth
 * doesn't blow the cap before a single good player is even signed).
 *
 * Quarterbacks additionally carry `qbJobShare` on top of their position
 * multiplier — see the block above it for why that position alone needs one.
 *
 * THIS IS WORTH, NOT ASK. It answers "what would he fetch if every club could
 * bid", which is the right question about a man on a roster and about a man
 * who has just reached the market. It is NOT what a free agent nobody has
 * signed will actually take three months later — that is `askingPrice` below,
 * this number discounted for time spent standing on the wire, and it is the
 * one every free-agent price in the game goes through.
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
  const posMult = (MARKET.POSITION_MULT[position] ?? 1) * (position === 'QB' ? qbJobShare(ovr) : 1);

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
 * ---------------------------------------------------------------------------
 * THE ASK FALLS WHILE NOBODY CALLS
 * ---------------------------------------------------------------------------
 * `marketValue` above answers "what is this man worth on the open market",
 * which is a fact about the player. What he will actually SIGN for is a fact
 * about the player and the calendar, and the two stop being the same number
 * the moment nobody wants him: a released veteran holds his number through the
 * spring, shades it when camp opens, and by midseason is signing for whatever
 * gets him on a roster. Ask a real agent in December what his client wants and
 * you will not get the April answer.
 *
 * This returns that discount as a share of open-market worth, on a logistic in
 * WEEKS ON THE WIRE — see FREE_AGENCY.ASK_DECAY for the shape and why it is a
 * logistic rather than a straight line down. Normalised so it is exactly 1.0
 * on the day he is released, which is what lets every screen quote
 * `marketValue` as "what he wanted" and this as "what he will take" without
 * the two disagreeing on week zero.
 *
 * Pure, and keyed on one number, so the figure a page prints and the figure
 * the sealed-bid wave enforces cannot drift apart — they are the same call.
 */
export function unsignedAskMultiplier(weeksUnsigned: number): number {
  const { MIDPOINT_WEEKS, WIDTH_WEEKS, FLOOR } = FREE_AGENCY.ASK_DECAY;
  const weeks = Math.max(0, weeksUnsigned || 0);
  const logistic = (w: number) => 1 / (1 + Math.exp((w - MIDPOINT_WEEKS) / WIDTH_WEEKS));
  const shape = logistic(weeks) / logistic(0);
  return FLOOR + (1 - FLOOR) * shape;
}

/**
 * What an unsigned player will actually put his name on today: his open-market
 * worth, discounted for however long he has been standing on the wire.
 *
 * THIS IS THE NUMBER THE GAME ENFORCES, and it is the one every free-agent
 * price in the codebase goes through — the AI's sealed-bid wave and its
 * in-season shopping (lib/freeagency.ts), the AI's own budgeting (`maxOffer`
 * in lib/ai/gm.ts), the reservation price behind the user's negotiation panel,
 * and the free-agency board itself. A screen that quoted `marketValue` for a
 * man the engine would sign at this price would be the lying metric this
 * codebase keeps writing down, so when in doubt about a FREE AGENT, this is
 * the function; `marketValue` is what he WAS worth before nobody called, and
 * is still the right answer for anybody under contract.
 *
 * The league minimum floor is `marketValue`'s own and applies here too: no ask
 * ever lands under it, whatever the discount says.
 */
export function askingPrice(opts: {
  ovr: number;
  position: Position;
  age: number;
  potential?: number;
  /** Player.weeksUnsigned. Zero — an ordinary rostered player — returns market. */
  weeksUnsigned: number;
}): number {
  const open = marketValue(opts);
  const asked = open * unsignedAskMultiplier(opts.weeksUnsigned);
  return Math.max(CAP.MIN_SALARY, Math.round(asked / 100_000) * 100_000);
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
    // A share of the deal's TOTAL value, bonus included — and never less than
    // the bonus itself, which is guaranteed by having been paid. Without the
    // floor a 0%-guarantee offer stored `guaranteed: 0` over a contract that
    // still handed the player a signing bonus, and the contract card then
    // printed "$0 guaranteed" over money the club could not get back.
    guaranteed: Math.max(signingBonus, Math.round((baseSum + signingBonus) * (opts.guaranteedPct ?? 0.45))),
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
