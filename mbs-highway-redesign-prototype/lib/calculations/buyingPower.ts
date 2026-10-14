/**
 * Buying Power: how a rate move changes what the same payment buys.
 *
 * "You" table      — your loan amount held constant: payment and APR at each rate column.
 * "Buying Power"   — your payment held constant: the loan amount it supports at each rate,
 *                    rounded to the nearest $1,000 (as the live tool shows: $371k at 7.25%).
 */
import { apr, loanFromPayment, monthlyPayment } from './core';

export interface BuyingPowerInput {
  loanAmount: number;
  ratePct: number;
  /** APR as entered; when `aprAuto` the APR is computed from `aprCosts`. */
  aprPct: number;
  aprAuto: boolean;
  /** Prepaid finance charges used for APR. */
  aprCosts: number;
  termYears: number;
  /** Rate columns for the tables. */
  rates: number[];
  agentIndex: number; // -1 = None
  display: 'left' | 'right';
}

/** Rate columns observed on the live tool. The trailing 0% column is preserved as observed. */
export const DEFAULT_RATE_COLUMNS = [6.0, 6.25, 6.5, 6.625, 6.75, 7.0, 7.25, 0];

export const BUYING_POWER_DEFAULTS: BuyingPowerInput = {
  loanAmount: 400000,
  ratePct: 6.5,
  aprPct: 6.5,
  aprAuto: true,
  aprCosts: 1000,
  termYears: 30,
  rates: DEFAULT_RATE_COLUMNS,
  agentIndex: -1,
  display: 'left',
};

const nn = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
const months = (y: number) => Math.max(1, Math.round(nn(y) * 12) || 360);

export const roundToThousand = (n: number) => Math.round(nn(n) / 1000) * 1000;

export function aprFor(loan: number, ratePct: number, termYears: number, costs: number): number {
  return apr(nn(loan), Math.max(0, ratePct || 0), months(termYears), nn(costs));
}

export interface BuyingPowerColumn {
  ratePct: number;
  /** Your loan at this rate. */
  payment: number;
  paymentDiff: number;
  apr: number;
  /** Loan the base payment supports at this rate (raw and rounded to $1k). */
  supportedLoan: number;
  supportedLoanRounded: number;
  loanDiff: number;
  isBase: boolean;
}

export interface BuyingPowerResult {
  basePayment: number;
  baseApr: number;
  columns: BuyingPowerColumn[];
}

export function calcBuyingPower(i: BuyingPowerInput): BuyingPowerResult {
  const n = months(i.termYears);
  const loan = nn(i.loanAmount);
  const rate = Math.max(0, i.ratePct || 0);
  const basePayment = monthlyPayment(loan, rate, n);
  const baseApr = i.aprAuto ? aprFor(loan, rate, i.termYears, i.aprCosts) : nn(i.aprPct);
  const columns = i.rates.map((r0) => {
    const r = Math.max(0, Number.isFinite(r0) ? r0 : 0);
    const payment = monthlyPayment(loan, r, n);
    const supportedLoan = loanFromPayment(basePayment, r, n);
    const supportedLoanRounded = roundToThousand(supportedLoan);
    return {
      ratePct: r,
      payment,
      paymentDiff: payment - basePayment,
      apr: aprFor(loan, r, i.termYears, i.aprCosts),
      supportedLoan,
      supportedLoanRounded,
      loanDiff: supportedLoanRounded - roundToThousand(loan),
      isBase: Math.abs(r - rate) < 1e-9,
    };
  });
  return { basePayment, baseApr, columns };
}

/** Curve of supported loan amount vs rate (for the chart). */
export function buyingPowerCurve(i: BuyingPowerInput, from = 5, to = 8, step = 0.125) {
  const n = months(i.termYears);
  const pay = monthlyPayment(nn(i.loanAmount), Math.max(0, i.ratePct || 0), n);
  const out: { rate: number; loan: number }[] = [];
  for (let r = from; r <= to + 1e-9; r += step) out.push({ rate: Math.round(r * 1000) / 1000, loan: loanFromPayment(pay, r, n) });
  return out;
}

/** Each 1/8 point of rate change ≈ this many dollars of loan amount at the base payment. */
export function dollarsPerEighth(i: BuyingPowerInput): number {
  const n = months(i.termYears);
  const r = Math.max(0, i.ratePct || 0);
  const pay = monthlyPayment(nn(i.loanAmount), r, n);
  return loanFromPayment(pay, r, n) - loanFromPayment(pay, r + 0.125, n);
}
