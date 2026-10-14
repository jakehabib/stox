/**
 * Cost of Waiting (standalone purchase tool). Pure functions, no UI.
 *
 * Model (calibrated to the live tool, Alex Rivera scenario):
 *  - Price after t years follows the chosen appreciation (COW default: custom 4%/yr → 500k × 1.04^t).
 *  - Loan keeps the same down-payment percent (80% LTV → 407,922 at 6 months).
 *  - Property tax scales with price and is shown in whole dollars per month (700 → 714 → 728);
 *    insurance and HOA stay fixed.
 *  - Benefit of Buying Now = appreciation + cumulative payment difference − refinance cost.
 *    Monthly difference = rounded waiting total − rounded today total (28 → 336 over 12 months);
 *    the refinance cost (default 1% of today's loan) applies only when the waiting rate is LOWER
 *    than today's, because the buy-now client would refinance into that lower rate later.
 */
import { getLocation } from '@/data/mock/locations';
import { valueAtYear, type AppreciationSetting } from './appreciation';
import { monthlyPayment } from './core';

export interface WaitColumn {
  months: number;
  ratePct: number;
  aprPct: number;
  miMonthly: number;
  closingCosts: number;
  /** Manually edited future price (Edit Waiting modal). null/undefined = from appreciation. */
  priceOverride?: number | null;
}

export interface CowInput {
  locationId: string;
  price: number;
  taxAnnual: number;
  insuranceMonthly: number;
  hoaMonthly: number;
  appreciation: AppreciationSetting;
  downPct: number;
  termYears: number;
  ratePct: number;
  aprPct: number;
  miMonthly: number;
  closingCosts: number;
  /** Refinance cost as percent of today's loan (default 1%). */
  refiCostPct: number;
  waits: WaitColumn[];
}

export const WAIT_PERIODS = [6, 12, 18, 24] as const;

/**
 * Default waiting columns. The live tool defaults to FALLING future rates (6.25% at 6 months,
 * 6.125% at 1 year). The $78 MI at 6 months is preserved as observed (see GAPS).
 */
export function defaultWaits(): WaitColumn[] {
  return [
    { months: 6, ratePct: 6.25, aprPct: 6.269, miMonthly: 78, closingCosts: 0, priceOverride: null },
    { months: 12, ratePct: 6.125, aprPct: 6.124, miMonthly: 0, closingCosts: 0, priceOverride: null },
    { months: 18, ratePct: 6.0, aprPct: 6.0, miMonthly: 0, closingCosts: 0, priceOverride: null },
    { months: 24, ratePct: 6.0, aprPct: 6.0, miMonthly: 0, closingCosts: 0, priceOverride: null },
  ];
}

export function alexCowInput(): CowInput {
  return {
    locationId: 'dallas-tx-75201',
    price: 500000,
    taxAnnual: 8400,
    insuranceMonthly: 146,
    hoaMonthly: 0,
    appreciation: { mode: 'custom', customPct: 4 },
    downPct: 20,
    termYears: 30,
    ratePct: 6.5,
    aprPct: 6.5,
    miMonthly: 0,
    closingCosts: 0,
    refiCostPct: 1,
    waits: defaultWaits(),
  };
}

const fin = (n: number) => (Number.isFinite(n) ? n : 0);
const pos = (n: number) => Math.max(0, fin(n));

export interface CowColumn {
  key: string;
  label: string;
  months: number;
  price: number;
  priceChangePct: number;
  loan: number;
  down: number;
  ratePct: number;
  aprPct: number;
  mi: number;
  pi: number;
  annualPI: number;
  taxes: number;
  insurance: number;
  hoa: number;
  totalMonthly: number;
  totalAnnual: number;
  cashToClose: number;
  closingCosts: number;
}

export function periodLabel(months: number): string {
  if (months <= 0) return 'Today';
  if (months % 12 === 0) return months === 12 ? '1 year' : `${months / 12} years`;
  if (months < 12) return `${months} months`;
  return `${(months / 12).toLocaleString('en-US', { maximumFractionDigits: 1 })} years`;
}

/** Future price for a waiting column (appreciation unless manually overridden). */
export function futurePrice(input: CowInput, w: Pick<WaitColumn, 'months' | 'priceOverride'>): number {
  if (w.priceOverride != null && Number.isFinite(w.priceOverride) && w.priceOverride > 0) return w.priceOverride;
  return pos(valueAtYear(pos(input.price), getLocation(input.locationId), input.appreciation, pos(w.months) / 12));
}

function buildColumn(input: CowInput, key: string, months: number, price: number, ratePct: number, aprPct: number, mi: number, closing: number): CowColumn {
  const basePrice = pos(input.price);
  const downPct = Math.min(100, pos(input.downPct));
  const loan = (price * (100 - downPct)) / 100;
  const down = price - loan;
  const termMonths = Math.max(12, Math.round(pos(input.termYears) * 12) || 360);
  const pi = monthlyPayment(loan, pos(ratePct), termMonths);
  const baseTaxMonthly = pos(input.taxAnnual) / 12;
  const taxes = Math.round(basePrice > 0 ? (baseTaxMonthly * price) / basePrice : baseTaxMonthly);
  const insurance = pos(input.insuranceMonthly);
  const hoa = pos(input.hoaMonthly);
  const totalMonthly = pi + pos(mi) + taxes + insurance + hoa;
  return {
    key,
    label: periodLabel(months),
    months,
    price,
    priceChangePct: basePrice > 0 ? ((price - basePrice) / basePrice) * 100 : 0,
    loan,
    down,
    ratePct: pos(ratePct),
    aprPct: pos(aprPct),
    mi: pos(mi),
    pi,
    annualPI: pi * 12,
    taxes,
    insurance,
    hoa,
    totalMonthly,
    totalAnnual: totalMonthly * 12,
    cashToClose: down + pos(closing),
    closingCosts: pos(closing),
  };
}

export function todayColumn(input: CowInput): CowColumn {
  return buildColumn(input, 'today', 0, pos(input.price), input.ratePct, input.aprPct, input.miMonthly, input.closingCosts);
}

export function waitColumns(input: CowInput): CowColumn[] {
  return input.waits.map((w) => buildColumn(input, `w${w.months}`, pos(w.months), futurePrice(input, w), w.ratePct, w.aprPct, w.miMonthly, w.closingCosts));
}

export interface CowBenefit {
  months: number;
  appreciation: number;
  /** Rounded waiting total monthly − rounded today total monthly. */
  monthlyDiff: number;
  cumulativeDiff: number;
  refinanceCost: number;
  refinanceApplies: boolean;
  benefit: number;
  now: CowColumn;
  wait: CowColumn;
}

/** Benefit of buying now vs waiting `months` (must match one of the waiting columns). */
export function benefitOfBuyingNow(input: CowInput, months: number): CowBenefit {
  const now = todayColumn(input);
  const cols = waitColumns(input);
  const wait = cols.find((c) => c.months === months) ?? cols[0] ?? now;
  const appreciation = Math.round(wait.price - now.price);
  const monthlyDiff = Math.round(wait.totalMonthly) - Math.round(now.totalMonthly);
  const cumulativeDiff = monthlyDiff * wait.months;
  const refinanceApplies = wait.ratePct < now.ratePct;
  const refinanceCost = refinanceApplies ? Math.round((now.loan * pos(input.refiCostPct)) / 100) : 0;
  return {
    months: wait.months,
    appreciation,
    monthlyDiff,
    cumulativeDiff,
    refinanceCost,
    refinanceApplies,
    benefit: appreciation + cumulativeDiff - refinanceCost,
    now,
    wait,
  };
}

/** Benefit for every waiting column (for the "all periods" summary chart). */
export function benefitByPeriod(input: CowInput): CowBenefit[] {
  return input.waits.map((w) => benefitOfBuyingNow(input, w.months));
}
