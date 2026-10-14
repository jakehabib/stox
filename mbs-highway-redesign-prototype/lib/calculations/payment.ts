/**
 * Payment Calculator: P&I (fixed or interest-only), optional PITI, and a full amortization
 * schedule rolled up by year. Rates are percent numbers.
 *
 * "Paid" in the yearly schedule uses the payment rounded to whole dollars × months, which is
 * what MBS Highway shows (Yr30 Paid $910,080 while interest + principal = $910,178).
 */
import { monthlyPayment } from './core';

export type PaymentLoanType = 'fixed' | 'interest-only';

export interface PaymentInput {
  loanAmount: number;
  termYears: number;
  ratePct: number;
  loanType: PaymentLoanType;
  /** Interest-only period in years (interest-only loans only). */
  ioYears: number;
}

export interface ScheduleMonth {
  month: number;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
  interestOnly: boolean;
}

export interface ScheduleYear {
  year: number;
  /** Cumulative paid using whole-dollar payments (as shown on the live site). */
  paid: number;
  interest: number;
  principal: number;
  balance: number;
  yearPaid: number;
  yearInterest: number;
  yearPrincipal: number;
  months: ScheduleMonth[];
}

export interface PaymentResult {
  /** Payment in month 1 (interest-only payment for IO loans). */
  payment: number;
  /** Fully amortizing payment after the IO period (equals `payment` for fixed). */
  amortizingPayment: number;
  ioMonths: number;
  termMonths: number;
  months: ScheduleMonth[];
  years: ScheduleYear[];
  totalInterest: number;
  totalPaid: number;
  /** Σ whole-dollar payments (matches the schedule's final "Paid"). */
  totalPaidRounded: number;
}

const fin = (n: number) => (Number.isFinite(n) ? n : 0);

export function sanitizePaymentInput(i: PaymentInput): PaymentInput {
  const termYears = Math.min(50, Math.max(1, Math.round(fin(i.termYears) || 30)));
  return {
    loanAmount: Math.max(0, fin(i.loanAmount)),
    termYears,
    ratePct: Math.min(50, Math.max(0, fin(i.ratePct))),
    loanType: i.loanType === 'interest-only' ? 'interest-only' : 'fixed',
    ioYears: Math.min(termYears - 1, Math.max(1, Math.round(fin(i.ioYears) || 10))),
  };
}

export function paymentSchedule(raw: PaymentInput): PaymentResult {
  const i = sanitizePaymentInput(raw);
  const n = i.termYears * 12;
  const r = i.ratePct / 1200;
  const ioMonths = i.loanType === 'interest-only' ? Math.min(n - 1, i.ioYears * 12) : 0;
  const ioPayment = i.loanAmount * r;
  const amortizingPayment = monthlyPayment(i.loanAmount, i.ratePct, n - ioMonths);
  const months: ScheduleMonth[] = [];
  let bal = i.loanAmount;
  let totalInterest = 0;
  let totalPaid = 0;
  let totalPaidRounded = 0;
  for (let m = 1; m <= n && i.loanAmount > 0; m++) {
    const interestOnly = m <= ioMonths;
    const interest = bal * r;
    const scheduled = interestOnly ? ioPayment : amortizingPayment;
    let principal = interestOnly ? 0 : scheduled - interest;
    if (principal > bal || m === n) principal = bal;
    bal = Math.max(0, bal - principal);
    if (bal < 0.005) bal = 0;
    const payment = principal + interest;
    totalInterest += interest;
    totalPaid += payment;
    totalPaidRounded += Math.round(scheduled);
    months.push({ month: m, payment, interest, principal, balance: bal, interestOnly });
  }

  const years: ScheduleYear[] = [];
  let paid = 0;
  let cumI = 0;
  let cumP = 0;
  for (let y = 1; y <= i.termYears; y++) {
    const slice = months.slice((y - 1) * 12, y * 12);
    if (!slice.length) break;
    const yearPaid = slice.reduce((s, m) => s + Math.round(m.interestOnly ? ioPayment : amortizingPayment), 0);
    const yearInterest = slice.reduce((s, m) => s + m.interest, 0);
    const yearPrincipal = slice.reduce((s, m) => s + m.principal, 0);
    paid += yearPaid;
    cumI += yearInterest;
    cumP += yearPrincipal;
    years.push({ year: y, paid, interest: cumI, principal: cumP, balance: slice[slice.length - 1].balance, yearPaid, yearInterest, yearPrincipal, months: slice });
  }

  return {
    payment: ioMonths > 0 ? ioPayment : amortizingPayment,
    amortizingPayment,
    ioMonths,
    termMonths: n,
    months,
    years,
    totalInterest,
    totalPaid,
    totalPaidRounded,
  };
}

/** P&I + monthly taxes + insurance (+ HOA). */
export function piti(pi: number, taxMonthly: number, insMonthly: number, hoaMonthly = 0): number {
  return fin(pi) + Math.max(0, fin(taxMonthly)) + Math.max(0, fin(insMonthly)) + Math.max(0, fin(hoaMonthly));
}
