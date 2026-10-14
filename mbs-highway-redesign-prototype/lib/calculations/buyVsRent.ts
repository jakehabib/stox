/**
 * Buy vs Rent — wealth built by owning vs renting, year by year (max 9 years).
 *
 * Year N net gain (buying vs renting)
 *   = appreciation gain (value_N − price)
 *   − purchase closing costs (incl. points)
 *   + cumulative tax benefit
 *   + principal paid (amortization)
 *   + cashflow difference (cumulative renting cost − cumulative buying cost)
 *   − cost to sell (% of value_N)
 *
 * Monthly costs are evaluated per year and rounded to whole dollars the way the live
 * tool displays them (this reproduces the spec totals exactly):
 *   Buying_y  = round( round(P&I) + MI + propertyTax_y/12 + insurance + repairs + HOA )
 *   Renting_y = round( rent_y + rentersInsurance_y )     (both grow at the rent increase)
 * Tax benefit_y = (federal% + state%) × max(0, mortgage interest_y + property tax_y − standard deduction)
 */
import { valueAtYear, type AppreciationSetting } from './appreciation';
import { monthlyPayment, paymentSplit } from './core';

export const MAX_YEARS = 9;
export const TERM_OPTIONS = [30, 20, 15, 10] as const;

export type FilingStatus = 'mfj' | 'single' | 'hoh' | 'mfs';
export const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  mfj: 'Married filing jointly',
  single: 'Single',
  hoh: 'Head of household',
  mfs: 'Married filing separately',
};
/** 2026 standard deduction by filing status. */
export const STANDARD_DEDUCTION: Record<FilingStatus, number> = { mfj: 32200, single: 16100, hoh: 24150, mfs: 16100 };

/** 2026 federal brackets (upper bounds of each rate). */
const BRACKETS: Record<FilingStatus, [number, number][]> = {
  single: [[12400, 10], [50400, 12], [105700, 22], [201775, 24], [256225, 32], [640600, 35], [Infinity, 37]],
  mfj: [[24800, 10], [100800, 12], [211400, 22], [403550, 24], [512450, 32], [768700, 35], [Infinity, 37]],
  hoh: [[17700, 10], [67450, 12], [105700, 22], [201750, 24], [256200, 32], [640600, 35], [Infinity, 37]],
  mfs: [[12400, 10], [50400, 12], [105700, 22], [201775, 24], [256225, 32], [384350, 35], [Infinity, 37]],
};
export const FEDERAL_RATES = [0, 10, 12, 22, 24, 32, 35, 37] as const;

/** Federal marginal rate for a taxable income. */
export function federalMarginalRate(taxableIncome: number, status: FilingStatus): number {
  const inc = Number.isFinite(taxableIncome) ? Math.max(0, taxableIncome) : 0;
  if (inc <= 0) return 0;
  for (const [cap, rate] of BRACKETS[status] ?? BRACKETS.mfj) if (inc <= cap) return rate;
  return 37;
}

export interface BuyVsRentInput {
  locationId: string;
  price: number;
  /** Starting value for appreciation (appraised value if it differs from price). */
  startValue?: number;
  // loan
  loanAmount: number;
  ratePct: number;
  termYears: number;
  miMonthly: number;
  closingCosts: number;
  pointsPct: number;
  // property
  taxAnnual: number;
  taxIncreasePct: number;
  insuranceMonthly: number;
  hoaMonthly: number;
  repairsMonthly: number;
  costToSellPct: number;
  appreciation: AppreciationSetting;
  // renting
  rentMonthly: number;
  rentersInsuranceMonthly: number;
  rentIncreasePct: number;
  // tax
  federalPct: number;
  statePct: number;
  standardDeduction: number;
  includeTaxBenefit: boolean;
}

export interface BuyVsRentYear {
  year: number;
  value: number;
  appreciationGain: number;
  closing: number;
  taxBenefit: number; // this year
  cumTaxBenefit: number;
  interestPaid: number; // this year
  principalPaid: number; // cumulative
  balance: number;
  propertyTaxAnnual: number;
  // monthly view (last payment of the year for the P/I split)
  principalMonthly: number;
  interestMonthly: number;
  taxMonthly: number;
  otherMonthly: number; // tax + insurance + repairs + HOA + MI
  buyMonthly: number;
  rentOnlyMonthly: number;
  rentersInsMonthly: number;
  rentMonthly: number;
  cumBuying: number;
  cumRenting: number;
  cashflowDiff: number;
  costToSell: number;
  netGain: number;
}

export interface BuyVsRentResult {
  piMonthly: number;
  downPayment: number;
  totalClosing: number;
  years: BuyVsRentYear[];
  /** First year whose net gain is ≥ 0; null when buying never catches up within the horizon. */
  breakEvenYear: number | null;
}

const fin = (n: number, fallback = 0) => (Number.isFinite(n) ? n : fallback);
const nonNeg = (n: number) => Math.max(0, fin(n));

export function calcBuyVsRent(input: BuyVsRentInput, horizon = MAX_YEARS): BuyVsRentResult {
  const price = nonNeg(input.price);
  const startValue = nonNeg(input.startValue ?? price) || price;
  const loan = nonNeg(input.loanAmount);
  const rate = Math.min(nonNeg(input.ratePct), 50);
  const termMonths = Math.max(12, Math.round(nonNeg(input.termYears) || 30) * 12);
  const pi = monthlyPayment(loan, rate, termMonths);
  const piShown = Math.round(pi);
  const totalClosing = nonNeg(input.closingCosts) + (loan * nonNeg(input.pointsPct)) / 100;
  const n = Math.max(1, Math.min(MAX_YEARS, Math.round(fin(horizon, MAX_YEARS))));
  const taxRate = (nonNeg(input.federalPct) + nonNeg(input.statePct)) / 100;
  const stdDed = nonNeg(input.standardDeduction);
  const rentG = 1 + fin(input.rentIncreasePct) / 100;
  const taxG = 1 + fin(input.taxIncreasePct) / 100;

  const years: BuyVsRentYear[] = [];
  let cumTax = 0;
  let cumBuy = 0;
  let cumRent = 0;
  let balance = loan;
  for (let y = 1; y <= n; y++) {
    // Interest/principal for the 12 payments of year y.
    let interest = 0;
    const r = rate / 100 / 12;
    for (let m = 0; m < 12; m++) {
      const k = (y - 1) * 12 + m + 1;
      if (k > termMonths || balance <= 0) break;
      const i = balance * r;
      const p = Math.min(balance, pi - i);
      interest += i;
      balance -= p;
    }
    const propertyTax = nonNeg(input.taxAnnual) * Math.pow(taxG, y - 1);
    const benefit = input.includeTaxBenefit ? taxRate * Math.max(0, interest + propertyTax - stdDed) : 0;
    cumTax += benefit;

    const lastK = Math.min(y * 12, termMonths);
    const split = loan > 0 ? paymentSplit(loan, rate, termMonths, lastK) : { principal: 0, interest: 0 };
    const taxMonthly = propertyTax / 12;
    const other = taxMonthly + nonNeg(input.insuranceMonthly) + nonNeg(input.repairsMonthly) + nonNeg(input.hoaMonthly) + nonNeg(input.miMonthly);
    const buyMonthly = Math.round(piShown + other);
    const rentOnly = nonNeg(input.rentMonthly) * Math.pow(rentG, y - 1);
    const rentersIns = nonNeg(input.rentersInsuranceMonthly) * Math.pow(rentG, y - 1);
    const rentMonthly = Math.round(rentOnly + rentersIns);
    cumBuy += buyMonthly * 12;
    cumRent += rentMonthly * 12;

    const value = valueAtYear(startValue, input.locationId, input.appreciation, y);
    const appreciationGain = value - price;
    const costToSell = (value * nonNeg(input.costToSellPct)) / 100;
    const principalPaid = loan - Math.max(0, balance);
    const cashflowDiff = cumRent - cumBuy;
    const netGain = appreciationGain - totalClosing + cumTax + principalPaid + cashflowDiff - costToSell;

    years.push({
      year: y,
      value: fin(value),
      appreciationGain: fin(appreciationGain),
      closing: totalClosing,
      taxBenefit: benefit,
      cumTaxBenefit: cumTax,
      interestPaid: interest,
      principalPaid,
      balance: Math.max(0, balance),
      propertyTaxAnnual: propertyTax,
      principalMonthly: fin(split.principal),
      interestMonthly: fin(split.interest),
      taxMonthly,
      otherMonthly: other,
      buyMonthly,
      rentOnlyMonthly: rentOnly,
      rentersInsMonthly: rentersIns,
      rentMonthly,
      cumBuying: cumBuy,
      cumRenting: cumRent,
      cashflowDiff,
      costToSell,
      netGain: fin(netGain),
    });
  }
  const be = years.find((y) => y.netGain >= 0);
  return { piMonthly: pi, downPayment: Math.max(0, price - loan), totalClosing, years, breakEvenYear: be ? be.year : null };
}

/**
 * "Desired Monthly Payment" / "Military BAH" modes: back-solve the purchase price whose
 * total monthly buying cost (P&I + tax + insurance + repairs + HOA + MI) equals `target`,
 * holding the loan-to-value, tax rate and repairs rate of the current scenario.
 */
export function priceForMonthlyPayment(
  target: number,
  a: { ltvPct: number; ratePct: number; termYears: number; taxRatePct: number; repairsPctPerYear: number; insuranceMonthly: number; hoaMonthly: number; miMonthly: number },
): number {
  const t = nonNeg(target);
  const fixed = nonNeg(a.insuranceMonthly) + nonNeg(a.hoaMonthly) + nonNeg(a.miMonthly);
  const perDollar =
    (nonNeg(a.ltvPct) / 100) * monthlyPayment(1, nonNeg(a.ratePct), Math.max(12, (a.termYears || 30) * 12)) +
    nonNeg(a.taxRatePct) / 100 / 12 +
    nonNeg(a.repairsPctPerYear) / 100 / 12;
  if (!(perDollar > 0) || t <= fixed) return 0;
  return Math.round((t - fixed) / perDollar);
}

/** Price-driven defaults when the purchase value changes on Step 1 (keeps the scenario's ratios). */
export function rescaleForPrice<T extends Pick<BuyVsRentInput, 'price' | 'loanAmount' | 'closingCosts' | 'repairsMonthly' | 'taxAnnual'>>(s: T, price: number): T {
  const old = s.price > 0 ? s.price : 0;
  const p = nonNeg(price);
  const ratio = (v: number, fallbackPct: number) => (old > 0 ? (v / old) * p : (p * fallbackPct) / 100);
  return {
    ...s,
    price: p,
    loanAmount: Math.round(ratio(s.loanAmount, 80)),
    closingCosts: Math.round(ratio(s.closingCosts, 2)),
    repairsMonthly: Math.round(ratio(s.repairsMonthly * 12, 0.5) / 12 * 100) / 100,
    taxAnnual: Math.round(ratio(s.taxAnnual, 1.68)),
  };
}

/** Default repairs/maintenance: 0.5% of price per year, monthly. $500k → $208.33. */
export const defaultRepairsMonthly = (price: number) => Math.round(((nonNeg(price) * 0.5) / 100 / 12) * 100) / 100;
