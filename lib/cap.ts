import { CAP, MARKET, Position } from './tuning';
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
}

/** Salary cap for a given season. Grows each year. */
export function capForYear(seasonYear: number, leagueStartYear: number): number {
  const elapsed = Math.max(0, seasonYear - leagueStartYear);
  return Math.round(CAP.BASE_CAP * Math.pow(1 + CAP.CAP_GROWTH_PER_YEAR, elapsed));
}

/** Annual proration of a signing bonus (realistic mode only). */
export function proration(c: ContractLike): number {
  const yrs = Math.min(c.years, CAP.MAX_PRORATION_YEARS);
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
 * REALISTIC: all remaining bonus proration accelerates onto this year's cap.
 * SIMPLIFIED / OFF: nothing.
 */
export function deadMoneyOnCut(c: ContractLike | null | undefined, mode: CapMode): number {
  if (!c || mode !== 'REALISTIC') return 0;
  return proration(c) * c.yearsRemaining;
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

/** Reasonable contract length for a player's age/quality. [TUNE] */
export function suggestedYears(ovr: number, age: number): number {
  if (age >= 33) return 1;
  if (age >= 31) return 2;
  if (ovr >= 82 && age <= 28) return 5;
  if (ovr >= 74) return 4;
  if (ovr >= 66) return 3;
  return 2;
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
  const total = Math.round(opts.apy * years);
  const bonusPct = opts.bonusPct ?? 0.28; // [TUNE]
  const signingBonus = Math.round(total * bonusPct);
  const baseTotal = total - signingBonus;

  // Escalate base salary ~12% per year so year 1 is cap-friendly. [TUNE]
  const escalation = opts.escalation ?? 1.12;
  const weights: number[] = [];
  for (let i = 0; i < years; i++) weights.push(Math.pow(escalation, i));
  const wSum = weights.reduce((a, b) => a + b, 0);
  const baseSalaries = weights.map((w) =>
    Math.max(CAP.MIN_SALARY, Math.round((baseTotal * w) / wSum / 100_000) * 100_000),
  );

  return {
    years,
    yearsRemaining: years,
    signedYear: opts.signedYear,
    baseSalaries,
    signingBonus,
    guaranteed: Math.round(total * (opts.guaranteedPct ?? 0.45)),
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
