/**
 * Strike Rate — refi-opportunity / lock-alert math. Pure functions, no UI.
 * Rates are PERCENT numbers (7.875 = 7.875%). Balances in dollars.
 *
 * A client's "strike rate" is the rate the market must reach before a refinance makes sense:
 *   target = current note rate − required drop for the client's balance tier.
 * A refi is only actionable once the Early Payoff Period (EPO) has passed — lenders recapture
 * compensation if a loan pays off within N months of closing (6 months, as observed live).
 */
import { monthlyPayment } from './core';

export const EARLY_PAYOFF_MONTHS = 6;

export interface StrikeTier {
  id: 'low' | 'mid' | 'high';
  label: string;
  /** Required rate drop, in percentage points. */
  drop: number;
  /** Inclusive lower bound in dollars (rounded balance). */
  min: number;
  /** Inclusive upper bound in dollars, or null for no cap. */
  max: number | null;
}

/** Thresholds as observed in the live tool. Read-only — the LO does not change them. */
export const STRIKE_TIERS: readonly StrikeTier[] = [
  { id: 'low', label: 'Below $350k', drop: 0.75, min: 0, max: 350_000 },
  { id: 'mid', label: '$350,001 – $806,499', drop: 0.5, min: 350_001, max: 806_499 },
  { id: 'high', label: 'Above $806,500', drop: 0.375, min: 806_500, max: null },
];

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const safeNum = (n: number) => (Number.isFinite(n) ? n : 0);

/**
 * Tier for a loan balance. Balances are compared in whole dollars, so the live ranges
 * ($350k / $350,001–$806,499 / $806,500+) leave no gaps: ≤350,000 → low, ≤806,499 → mid, else high.
 */
export function tierFor(balance: number): StrikeTier {
  const b = Math.round(Math.max(0, safeNum(balance)));
  if (b <= 350_000) return STRIKE_TIERS[0];
  if (b <= 806_499) return STRIKE_TIERS[1];
  return STRIKE_TIERS[2];
}

/** Required rate drop (percentage points) for a balance. */
export function requiredDrop(balance: number): number {
  return tierFor(balance).drop;
}

/** Target strike rate = current rate − required drop (never below 0). */
export function targetRate(currentRatePct: number, balance: number): number {
  return Math.max(0, r3(safeNum(currentRatePct) - requiredDrop(balance)));
}

/** True when today's market rate is at or below the target. */
export function isHit(marketRatePct: number, targetPct: number): boolean {
  return safeNum(marketRatePct) <= safeNum(targetPct) + 1e-9;
}

/** Whole calendar months completed between two dates (0 if `to` is before `from`). */
export function monthsBetween(from: Date, to: Date): number {
  if (!(from instanceof Date) || !(to instanceof Date) || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  let m = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) m -= 1;
  return Math.max(0, m);
}

/** Add whole months, clamping to the last day of the month (Jan 31 + 1 → Feb 28/29). */
export function addMonths(d: Date, months: number): Date {
  const y = d.getFullYear();
  const m = d.getMonth() + months;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(d.getDate(), last), d.getHours(), d.getMinutes());
}

export interface EpoStatus {
  monthsSinceClose: number;
  eligible: boolean;
  eligibleOn: Date;
  monthsRemaining: number;
  daysRemaining: number;
}

/** Early payoff period: not eligible to refinance until `epoMonths` after closing. */
export function epoStatus(closeDate: Date, today: Date, epoMonths = EARLY_PAYOFF_MONTHS): EpoStatus {
  const eligibleOn = addMonths(closeDate, epoMonths);
  const eligible = today.getTime() >= eligibleOn.getTime();
  const msLeft = Math.max(0, eligibleOn.getTime() - today.getTime());
  return {
    monthsSinceClose: monthsBetween(closeDate, today),
    eligible,
    eligibleOn,
    monthsRemaining: eligible ? 0 : Math.max(0, epoMonths - monthsBetween(closeDate, today)),
    daysRemaining: Math.ceil(msLeft / 86_400_000),
  };
}

/**
 * Estimated monthly P&I savings from refinancing the current balance at `newRatePct`,
 * keeping the same remaining term (apples-to-apples — no term-extension savings).
 */
export function monthlySavings(balance: number, currentRatePct: number, newRatePct: number, remainingMonths: number) {
  const n = Math.max(1, Math.round(safeNum(remainingMonths)));
  const current = monthlyPayment(Math.max(0, safeNum(balance)), Math.max(0, safeNum(currentRatePct)), n);
  const next = monthlyPayment(Math.max(0, safeNum(balance)), Math.max(0, safeNum(newRatePct)), n);
  const savings = current - next;
  return { currentPayment: current, newPayment: next, savings, annual: savings * 12 };
}

export type MarketProduct = '30yr' | 'fha' | 'va' | 'jumbo' | '15yr';

export interface WatchLoan {
  clientId: string;
  balance: number;
  ratePct: number;
  product: MarketProduct;
  closeDate: Date;
  /** Original term in months (360 or 180). */
  termMonths: number;
}

export type StrikeStatus = 'strike' | 'hit-epo' | 'watching';

export interface WatchResult {
  tier: StrikeTier;
  target: number;
  marketRate: number;
  hit: boolean;
  /** Percentage points the market still has to fall to reach the target (0 when hit). */
  gap: number;
  epo: EpoStatus;
  status: StrikeStatus;
  remainingMonths: number;
  currentPayment: number;
  newPayment: number;
  savings: number;
}

/** Full evaluation of one watched loan against today's market rates. `shiftPct` simulates a market move. */
export function evaluateLoan(loan: WatchLoan, marketRates: Record<MarketProduct, number>, today: Date, shiftPct = 0): WatchResult {
  const tier = tierFor(loan.balance);
  const target = targetRate(loan.ratePct, loan.balance);
  const marketRate = Math.max(0, r3(safeNum(marketRates[loan.product]) + safeNum(shiftPct)));
  const hit = isHit(marketRate, target);
  const epo = epoStatus(loan.closeDate, today);
  const remainingMonths = Math.max(1, loan.termMonths - epo.monthsSinceClose);
  const s = monthlySavings(loan.balance, loan.ratePct, marketRate, remainingMonths);
  return {
    tier,
    target,
    marketRate,
    hit,
    gap: hit ? 0 : r3(marketRate - target),
    epo,
    status: hit ? (epo.eligible ? 'strike' : 'hit-epo') : 'watching',
    remainingMonths,
    currentPayment: s.currentPayment,
    newPayment: s.newPayment,
    savings: s.savings,
  };
}

/** Counts for the summary tiles. */
export function summarize(results: WatchResult[]) {
  const strike = results.filter((r) => r.status === 'strike');
  return {
    total: results.length,
    strike: strike.length,
    hitEpo: results.filter((r) => r.status === 'hit-epo').length,
    watching: results.filter((r) => r.status === 'watching').length,
    strikeMonthlySavings: strike.reduce((a, r) => a + Math.max(0, r.savings), 0),
  };
}
