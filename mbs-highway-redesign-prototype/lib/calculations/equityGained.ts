/**
 * Equity Gained & Appreciation (/members/equity-gained).
 * Equity = projected home value − remaining loan balance. Gain = appreciation + principal paid.
 */
import { getLocation } from '@/data/mock/locations';
import { displayedRate, valueAtYear, type AppreciationMode } from './appreciation';
import { balanceAfter, cagr, monthlyPayment } from './core';

const fin = (n: number) => (Number.isFinite(n) ? n : 0);

export interface EquityInput {
  price: number;
  locationId: string;
  mode: AppreciationMode;
  customPct: number;
  loanAmount: number;
  ratePct: number;
  termYears: number;
  years: number;
}

export interface EquityResult {
  years: number;
  homeValue: number;
  appreciation: number;
  /** Principal paid by the end of `years` (year-end, i.e. after years×12 payments). */
  principalPaid: number;
  loanBalance: number;
  downPayment: number;
  /** Home value − loan balance (includes the down payment). */
  equity: number;
  /** Appreciation + principal paid (excludes the down payment). */
  totalGained: number;
  monthlyPI: number;
  /** Effective annualized appreciation over the horizon (Dallas forecast, 15yr → 2.48%). */
  effectiveRatePct: number;
  /** Rate shown on the form (Dallas forecast → 2.481%). */
  formRatePct: number;
}

function clean(i: EquityInput) {
  const price = Math.max(0, fin(i.price));
  const loan = Math.min(Math.max(0, fin(i.loanAmount)), price > 0 ? price : Math.max(0, fin(i.loanAmount)));
  const rate = Math.max(0, fin(i.ratePct));
  const termMonths = Math.max(1, Math.round(fin(i.termYears) || 30) * 12);
  const years = Math.max(0, Math.round(fin(i.years)));
  return { price, loan, rate, termMonths, years };
}

/** Balance after k payments; exactly 0 once the term is paid out. */
function bal(loan: number, rate: number, termMonths: number, k: number) {
  return k >= termMonths ? 0 : fin(balanceAfter(loan, rate, termMonths, k));
}

function value(price: number, i: EquityInput, year: number) {
  return fin(valueAtYear(price, getLocation(i.locationId), { mode: i.mode, customPct: fin(i.customPct) }, year));
}

export function equityResult(i: EquityInput): EquityResult {
  const { price, loan, rate, termMonths, years } = clean(i);
  const homeValue = value(price, i, years);
  const loanBalance = bal(loan, rate, termMonths, years * 12);
  const principalPaid = loan - loanBalance;
  const appreciation = homeValue - price;
  return {
    years,
    homeValue,
    appreciation,
    principalPaid,
    loanBalance,
    downPayment: price - loan,
    equity: homeValue - loanBalance,
    totalGained: appreciation + principalPaid,
    monthlyPI: fin(monthlyPayment(loan, rate, termMonths)),
    effectiveRatePct: fin(cagr(price, homeValue, years)),
    formRatePct: fin(displayedRate(getLocation(i.locationId), { mode: i.mode, customPct: fin(i.customPct) })),
  };
}

export interface EquityChartPoint {
  year: number;
  homeValue: number;
  loanBalance: number;
  equity: number;
}

/**
 * Chart series for years 0..years.
 *
 * PRESERVED QUIRK: the live chart samples the loan balance ONE PAYMENT INTO each year
 * (after payment 12·y + 1), e.g. Yr0 $399,638 rather than $400,000 and Yr15 $289,280 rather
 * than the year-end $290,237 used for the headline amortization figure. We reproduce that.
 */
export function equityChart(i: EquityInput): EquityChartPoint[] {
  const { price, loan, rate, termMonths, years } = clean(i);
  return Array.from({ length: years + 1 }, (_, y) => {
    const homeValue = value(price, i, y);
    const loanBalance = bal(loan, rate, termMonths, 12 * y + 1);
    return { year: y, homeValue, loanBalance, equity: homeValue - loanBalance };
  });
}

export type EquityErrors = Partial<Record<'client' | 'price' | 'loanAmount' | 'ratePct' | 'customPct', string>>;

export function validateEquity(f: { clientId: string | null; price: number; loanAmount: number; ratePct: number; mode: AppreciationMode; customPct: number }): EquityErrors {
  const e: EquityErrors = {};
  if (!f.clientId) e.client = 'Client name is required';
  if (!(f.price > 0)) e.price = 'Enter a price greater than $0';
  if (!(f.loanAmount >= 0)) e.loanAmount = 'Loan amount can’t be negative';
  else if (f.price > 0 && f.loanAmount > f.price) e.loanAmount = 'Loan amount can’t exceed the price';
  if (!(f.ratePct >= 0 && f.ratePct <= 25)) e.ratePct = 'Rate must be between 0% and 25%';
  if (f.mode === 'custom' && !(Number.isFinite(f.customPct) && f.customPct > -20 && f.customPct <= 25)) e.customPct = 'Custom rate must be between -20% and 25%';
  return e;
}
