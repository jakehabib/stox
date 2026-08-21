import { CAP, CONTRACT, MARKET, Position } from './tuning';
import { CapMode } from './types';
import { readJson } from './json';
import { clamp } from './rng';

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

/** Annual proration of a signing bonus (realistic mode only). Void years extend the divisor, up to the real-world 5-year cap. */
export function proration(c: ContractLike): number {
  const yrs = Math.min(c.years + (c.voidYears ?? 0), CAP.MAX_PRORATION_YEARS);
  return yrs > 0 ? Math.round(c.signingBonus / yrs) : 0;
}

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
  const yearIdx = Math.max(0, c.years - c.yearsRemaining);
  const base = bases[yearIdx] ?? bases[bases.length - 1] ?? CAP.MIN_SALARY;

  if (mode === 'SIMPLIFIED') {
    const total = bases.reduce((a, b) => a + b, 0) + c.signingBonus;
    return Math.round(total / Math.max(1, c.years));
  }
  return base + proration(c);
}

/** Total contract value across all remaining years. */
export function remainingValue(c: ContractLike, mode: CapMode): number {
  if (mode === 'OFF') return 0;
  const bases = readJson<number[]>(c.baseSalaries, []);
  const startIdx = Math.max(0, c.years - c.yearsRemaining);
  const remainingBase = bases.slice(startIdx).reduce((a, b) => a + b, 0);
  return remainingBase + (mode === 'REALISTIC' ? proration(c) * c.yearsRemaining : 0);
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
  return proration(c) * (c.yearsRemaining + (c.voidYears ?? 0));
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
  const bases = readJson<number[]>(c.baseSalaries, []).slice(Math.max(0, c.years - c.yearsRemaining));
  if (mode === 'OFF') return bases.map(() => 0);
  if (mode === 'SIMPLIFIED') {
    const total = bases.reduce((a, b) => a + b, 0) + c.signingBonus;
    const flat = Math.round(total / Math.max(1, c.years));
    return bases.map(() => flat);
  }
  const p = proration(c);
  return bases.map((b) => b + p);
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
    voidYears: Math.max(0, opts.addVoidYears ?? 0),
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
 * The LONGEST deal this age may be handed, at any rating, by any negotiator.
 *
 * The age gates in suggestedYears() are documented in CONTRACT (lib/tuning.ts)
 * as absolute — "a 34-year-old gets one year no matter how good he is, which
 * is what keeps an aging star from being handed a five-year deal the team can
 * never escape". They weren't: the AI re-sign wave adds a +1 term nudge for an
 * eager GM on top of suggestedYears() and clamps only against
 * CONTRACT.MAX_DEAL_YEARS, so a 34-year-old's mandatory 1 became 2 and a
 * 40-year-old's became 2 as well. Any code that nudges term has to clamp
 * against this instead, so the gate is enforced where it is decided rather
 * than trusted to every caller.
 */
export function maxYearsForAge(age: number): number {
  if (age >= CONTRACT.AGE_ONE_YEAR) return 1;
  if (age >= CONTRACT.AGE_TWO_YEAR) return 2;
  if (age >= CONTRACT.AGE_THREE_YEAR) return 3;
  return CONTRACT.MAX_DEAL_YEARS;
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
}): {
  years: number;
  yearsRemaining: number;
  signedYear: number;
  baseSalaries: number[];
  signingBonus: number;
  guaranteed: number;
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
