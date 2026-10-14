/**
 * Open House Flyer math + the shared MI worksheet (used by Open House Flyers and
 * Seller Contribution). Pure functions. Rates are PERCENT numbers (6.5 = 6.5%).
 */
import { monthlyPayment } from './core';

export type Program = 'conventional' | 'fha';
export type MiFicoBand = '760+' | '740–759' | '720–739' | '700–719' | '680–699' | '660–679' | '640–659' | '620–639';

export const MI_FICO_BANDS: MiFicoBand[] = ['760+', '740–759', '720–739', '700–719', '680–699', '660–679', '640–659', '620–639'];

/** LTV bands for borrower-paid monthly MI (conventional). Upper bound inclusive. */
export const MI_LTV_BANDS = [
  { label: '80.01–85%', max: 85 },
  { label: '85.01–90%', max: 90 },
  { label: '90.01–95%', max: 95 },
  { label: '95.01–97%', max: 97 },
] as const;

/**
 * DEMO DATA — annual MI rate (% of loan) by FICO band × LTV band. Illustrative only; a real
 * build pulls this from the MI provider rate cards. The 720–739 row lines up with the
 * Affordability tool (0.66% at 90–95% LTV, 0.87% at 95–97%).
 */
export const MI_RATES: Record<MiFicoBand, [number, number, number, number]> = {
  '760+': [0.17, 0.28, 0.41, 0.55],
  '740–759': [0.2, 0.34, 0.49, 0.66],
  '720–739': [0.26, 0.44, 0.66, 0.87],
  '700–719': [0.31, 0.53, 0.78, 1.02],
  '680–699': [0.38, 0.65, 0.95, 1.21],
  '660–679': [0.5, 0.86, 1.17, 1.44],
  '640–659': [0.6, 1.03, 1.42, 1.69],
  '620–639': [0.71, 1.21, 1.65, 1.92],
};

/** FHA: 1.75% upfront MIP (financed) + 0.55% annual MIP (30-yr, LTV > 95%) — 0.50% at ≤ 95% LTV. */
export const FHA_UFMIP_PCT = 1.75;
export function fhaAnnualMipPct(ltvPct: number): number {
  return ltvPct > 95 ? 0.55 : 0.5;
}

const fin = (n: number) => (Number.isFinite(n) ? n : 0);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, fin(n)));

/** Loan-to-value in percent. */
export function ltvPct(loan: number, value: number): number {
  if (!(value > 0)) return 0;
  return Math.max(0, (fin(loan) / value) * 100);
}

/** Index into MI_LTV_BANDS for an LTV, or -1 when no MI is required (≤ 80%). LTV above 97 uses the top band. */
export function miLtvBandIndex(ltv: number): number {
  if (!(ltv > 80)) return -1;
  const i = MI_LTV_BANDS.findIndex((b) => ltv <= b.max + 1e-9);
  return i === -1 ? MI_LTV_BANDS.length - 1 : i;
}

/** Annual conventional MI rate (% of loan) for an LTV + FICO band. 0 when LTV ≤ 80%. */
export function miRatePct(ltv: number, fico: MiFicoBand = '720–739'): number {
  const i = miLtvBandIndex(ltv);
  if (i < 0) return 0;
  return (MI_RATES[fico] ?? MI_RATES['720–739'])[i];
}

/** Monthly conventional MI dollars. */
export function monthlyMi(loan: number, value: number, fico: MiFicoBand = '720–739'): number {
  const rate = miRatePct(ltvPct(loan, value), fico);
  return (Math.max(0, fin(loan)) * rate) / 100 / 12;
}

export interface FlyerScenarioInput {
  price: number;
  downPct: number;
  program: Program;
  ratePct: number;
  termYears: number;
  taxAnnual: number;
  insuranceMonthly: number;
  hoaMonthly: number;
  fico: MiFicoBand;
}

export interface FlyerScenarioResult {
  downPayment: number;
  baseLoan: number;
  /** Loan incl. financed FHA upfront MIP. */
  loan: number;
  upfrontMip: number;
  ltv: number;
  miRatePct: number;
  pi: number;
  mi: number;
  tax: number;
  insurance: number;
  hoa: number;
  total: number;
}

/** One payment scenario on the flyer: P&I + MI + tax + insurance (+ HOA). */
export function flyerScenario(input: FlyerScenarioInput): FlyerScenarioResult {
  const price = Math.max(0, fin(input.price));
  const downPct = clamp(input.downPct, 0, 100);
  const termMonths = Math.round(clamp(input.termYears, 1, 40) * 12);
  const rate = clamp(input.ratePct, 0, 30);
  const downPayment = (price * downPct) / 100;
  const baseLoan = Math.max(0, price - downPayment);
  const ltv = ltvPct(baseLoan, price);
  let loan = baseLoan;
  let upfrontMip = 0;
  let mi = 0;
  let miRate = 0;
  if (input.program === 'fha') {
    upfrontMip = (baseLoan * FHA_UFMIP_PCT) / 100;
    loan = baseLoan + upfrontMip;
    miRate = baseLoan > 0 ? fhaAnnualMipPct(ltv) : 0;
    mi = (baseLoan * miRate) / 100 / 12;
  } else {
    miRate = miRatePct(ltv, input.fico);
    mi = (baseLoan * miRate) / 100 / 12;
  }
  const pi = monthlyPayment(loan, rate, termMonths);
  const tax = Math.max(0, fin(input.taxAnnual)) / 12;
  const insurance = Math.max(0, fin(input.insuranceMonthly));
  const hoa = Math.max(0, fin(input.hoaMonthly));
  return { downPayment, baseLoan, loan, upfrontMip, ltv, miRatePct: miRate, pi, mi, tax, insurance, hoa, total: pi + mi + tax + insurance + hoa };
}

/** Price per square foot (0 when sqft is missing). */
export function pricePerSqft(price: number, sqft: number): number {
  if (!(sqft > 0)) return 0;
  return Math.max(0, fin(price)) / sqft;
}

/** Monthly income needed to keep the total payment at `dtiPct` of gross income (front-end). */
export function incomeNeeded(totalMonthly: number, dtiPct = 28): number {
  if (!(dtiPct > 0)) return 0;
  return Math.max(0, fin(totalMonthly)) / (dtiPct / 100);
}
