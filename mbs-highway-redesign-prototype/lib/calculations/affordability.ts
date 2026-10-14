/**
 * Affordability: the highest price whose full housing payment fits the borrower's budget.
 *
 * Income mode — budget = max DTI × gross monthly income − existing monthly debts.
 * Payment mode — budget = the desired total monthly housing payment.
 *
 * Housing payment(P) = P&I(loan) + MI + taxes & insurance + HOA, where loan = P − down
 * (plus a financed FHA UFMIP / VA funding fee). We solve the largest P with
 * payment(P) ≤ budget (bisection — the function is monotone, MI tiers only step up)
 * and round the price to the dollar.
 *
 * Taxes & insurance default ("Estimate") reproduces the live tool: 0.35%/yr of price,
 * rounded to whole dollars per month. That is far below county tax averages (Dallas is
 * 1.84%), so the LO can switch to "Location average" or a custom $ amount.
 */
import { getLocation } from '@/data/mock/locations';
import type { FicoBand } from '@/data/mock/clients';
import { conventionalMiRatePct, FHA_UFMIP_PCT, fhaAnnualMipPct, vaFundingFeePct } from '@/data/mock/mi';
import { monthlyPayment } from './core';

export type AffordProgram = 'Conventional' | 'FHA' | 'VA';
export type AffordMode = 'income' | 'payment';
export type TaxInsMode = 'estimate' | 'location' | 'custom';
export type CostUnit = 'pct' | 'fee';
export type DtiZone = 'Comfortable' | 'Stretch' | 'Aggressive';

export interface AffordabilityInput {
  mode: AffordMode;
  locationId: string;
  annualIncome: number;
  /** Payment mode: desired total monthly housing payment (P&I + MI + taxes/ins + HOA). */
  targetPayment: number;
  downPayment: number;
  termYears: number;
  program: AffordProgram;
  ratePct: number;
  /** Disclosure only — the max-price solve uses the note rate. */
  aprPct: number;
  closingUnit: CostUnit;
  closingValue: number;
  prepaidUnit: CostUnit;
  prepaidValue: number;
  fico: FicoBand;
  /** 'auto' = MI rate card by LTV × FICO; 'manual' = fixed monthly MI. */
  miMode: 'auto' | 'manual';
  miMonthlyManual: number;
  /* Advanced */
  monthlyDebts: number;
  maxDtiPct: number;
  taxInsMode: TaxInsMode;
  /** Estimate mode: taxes + insurance as % of price per year. */
  taxInsRatePct: number;
  /** Custom mode: fixed monthly taxes + insurance. */
  taxInsMonthly: number;
  hoaMonthly: number;
}

export const AFFORDABILITY_DEFAULTS: AffordabilityInput = {
  mode: 'income',
  locationId: 'dallas-tx-75201',
  annualIncome: 65000,
  targetPayment: 1450,
  downPayment: 20000,
  termYears: 30,
  program: 'Conventional',
  ratePct: 7.5,
  aprPct: 7.634,
  closingUnit: 'pct',
  closingValue: 3,
  prepaidUnit: 'pct',
  prepaidValue: 3,
  fico: '720–739',
  miMode: 'auto',
  miMonthlyManual: 0,
  monthlyDebts: 500,
  maxDtiPct: 36,
  taxInsMode: 'estimate',
  taxInsRatePct: 0.35,
  taxInsMonthly: 0,
  hoaMonthly: 0,
};

export const DTI_ZONES: { zone: DtiZone; max: number }[] = [
  { zone: 'Comfortable', max: 36 },
  { zone: 'Stretch', max: 43 },
  { zone: 'Aggressive', max: Infinity },
];

/** ≤36% Comfortable, ≤43% Stretch, >43% Aggressive. Rounded to 0.1% first so 36.0004% stays Comfortable. */
export function dtiZone(dtiPct: number): DtiZone {
  const d = Math.round((Number.isFinite(dtiPct) ? dtiPct : 0) * 10) / 10;
  return d <= 36 ? 'Comfortable' : d <= 43 ? 'Stretch' : 'Aggressive';
}

/** Minimum down payment (% of price) by program. */
export const MIN_DOWN_PCT: Record<AffordProgram, number> = { Conventional: 3, FHA: 3.5, VA: 0 };

const nn = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** Monthly housing budget before solving for price. */
export function housingBudget(i: AffordabilityInput): number {
  if (i.mode === 'payment') return nn(i.targetPayment);
  return (nn(i.maxDtiPct) / 100) * (nn(i.annualIncome) / 12) - nn(i.monthlyDebts);
}

export function costAmount(unit: CostUnit, value: number, price: number): number {
  return unit === 'pct' ? (nn(price) * nn(value)) / 100 : nn(value);
}

/** Monthly taxes + insurance (excludes MI and HOA). */
export function taxesInsurance(i: AffordabilityInput, price: number): number {
  const p = nn(price);
  if (i.taxInsMode === 'custom') return nn(i.taxInsMonthly);
  if (i.taxInsMode === 'location') {
    const loc = getLocation(i.locationId);
    return (p * loc.taxRatePct) / 100 / 12 + (p > 0 ? loc.insuranceMonthly : 0);
  }
  return Math.round((p * nn(i.taxInsRatePct)) / 100 / 12);
}

export interface PaymentBreakdown {
  price: number;
  baseLoan: number;
  /** Base loan + financed UFMIP / VA funding fee. */
  loanAmount: number;
  upfrontFee: number;
  upfrontFeePct: number;
  ltvPct: number;
  downPct: number;
  pi: number;
  mi: number;
  miRatePct: number;
  taxIns: number;
  hoa: number;
  total: number;
}

/** Full monthly housing payment for a given price. */
export function paymentAtPrice(i: AffordabilityInput, price: number): PaymentBreakdown {
  const p = nn(price);
  const down = Math.min(nn(i.downPayment), p);
  const baseLoan = Math.max(0, p - down);
  const ltvPct = p > 0 ? (baseLoan / p) * 100 : 0;
  const downPct = p > 0 ? (down / p) * 100 : 0;
  let upfrontFeePct = 0;
  if (baseLoan > 0 && i.program === 'FHA') upfrontFeePct = FHA_UFMIP_PCT;
  if (baseLoan > 0 && i.program === 'VA') upfrontFeePct = vaFundingFeePct(downPct);
  const upfrontFee = (baseLoan * upfrontFeePct) / 100;
  const loanAmount = baseLoan + upfrontFee;
  const n = Math.max(1, Math.round(nn(i.termYears) * 12));
  const pi = monthlyPayment(loanAmount, Math.max(0, i.ratePct || 0), n);
  let miRatePct = 0;
  let mi = 0;
  if (baseLoan > 0) {
    if (i.miMode === 'manual') mi = nn(i.miMonthlyManual);
    else {
      if (i.program === 'Conventional') miRatePct = conventionalMiRatePct(ltvPct, i.fico);
      if (i.program === 'FHA') miRatePct = fhaAnnualMipPct(ltvPct);
      mi = (baseLoan * miRatePct) / 100 / 12;
    }
  }
  const taxIns = taxesInsurance(i, p);
  const hoa = nn(i.hoaMonthly);
  return { price: p, baseLoan, loanAmount, upfrontFee, upfrontFeePct, ltvPct, downPct, pi, mi, miRatePct, taxIns, hoa, total: pi + mi + taxIns + hoa };
}

/** Largest price (to the dollar) whose housing payment fits `budget`. */
export function maxPriceForBudget(i: AffordabilityInput, budget: number): { price: number; limitedByDown: boolean } {
  const minDown = MIN_DOWN_PCT[i.program] ?? 3;
  const capByDown = minDown > 0 ? nn(i.downPayment) / (minDown / 100) : Infinity;
  if (!(budget > 0)) return { price: Math.round(Math.min(nn(i.downPayment), capByDown)), limitedByDown: false };
  let lo = 0;
  let hi = Math.min(capByDown, 100_000_000);
  if (paymentAtPrice(i, hi).total <= budget) return { price: Math.round(hi), limitedByDown: Number.isFinite(capByDown) };
  for (let k = 0; k < 90; k++) {
    const mid = (lo + hi) / 2;
    if (paymentAtPrice(i, mid).total <= budget) lo = mid;
    else hi = mid;
  }
  return { price: Math.round(lo), limitedByDown: false };
}

export interface AffordabilityResult extends PaymentBreakdown {
  budget: number;
  monthlyIncome: number;
  dtiPct: number;
  frontDtiPct: number;
  zone: DtiZone;
  closing: number;
  prepaid: number;
  cashToClose: number;
  /** Taxes, insurance & MI combined — the live tool's "TaxIns" line. */
  taxInsMi: number;
  limitedByDown: boolean;
  /** Payment mode with no income → DTI unknown. */
  hasIncome: boolean;
}

export function calcAffordability(i: AffordabilityInput): AffordabilityResult {
  const budget = housingBudget(i);
  const { price, limitedByDown } = maxPriceForBudget(i, budget);
  const b = paymentAtPrice(i, price);
  const monthlyIncome = nn(i.annualIncome) / 12;
  const hasIncome = monthlyIncome > 0;
  const dtiPct = hasIncome ? ((b.total + nn(i.monthlyDebts)) / monthlyIncome) * 100 : 0;
  const frontDtiPct = hasIncome ? (b.total / monthlyIncome) * 100 : 0;
  const closing = costAmount(i.closingUnit, i.closingValue, price);
  const prepaid = costAmount(i.prepaidUnit, i.prepaidValue, price);
  const down = Math.min(nn(i.downPayment), price);
  return {
    ...b,
    budget,
    monthlyIncome,
    dtiPct,
    frontDtiPct,
    zone: dtiZone(dtiPct),
    closing,
    prepaid,
    cashToClose: down + closing + prepaid,
    taxInsMi: b.taxIns + b.mi,
    limitedByDown,
    hasIncome,
  };
}

/** Max price across a DTI range (income mode) — the price-vs-DTI view. */
export function priceByDti(i: AffordabilityInput, from = 25, to = 50, step = 1): { dti: number; price: number; zone: DtiZone }[] {
  const out: { dti: number; price: number; zone: DtiZone }[] = [];
  for (let d = from; d <= to + 1e-9; d += step) {
    const r = calcAffordability({ ...i, mode: 'income', maxDtiPct: d });
    out.push({ dti: Math.round(d * 10) / 10, price: r.price, zone: dtiZone(d) });
  }
  return out;
}

/** The three zone scenarios shown side by side: 36% / 43% / 50% back-end DTI. */
export function zoneScenarios(i: AffordabilityInput) {
  return ([['Comfortable', 36], ['Stretch', 43], ['Aggressive', 50]] as const).map(([zone, dti]) => {
    const r = calcAffordability({ ...i, mode: 'income', maxDtiPct: dti });
    return { zone, dti, price: r.price, total: r.total, cashToClose: r.cashToClose };
  });
}
