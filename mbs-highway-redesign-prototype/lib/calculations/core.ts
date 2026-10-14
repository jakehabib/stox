/**
 * Core mortgage math. Pure functions, no UI. Rates are PERCENT numbers (6.5 = 6.5%).
 * Terms are in MONTHS unless the name says otherwise.
 */

export interface AmortRow {
  month: number;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
}

/** Monthly principal & interest payment. */
export function monthlyPayment(loan: number, ratePct: number, termMonths: number): number {
  if (!(loan > 0) || !(termMonths > 0)) return 0;
  const r = ratePct / 100 / 12;
  if (r === 0) return loan / termMonths;
  return (loan * r) / (1 - Math.pow(1 + r, -termMonths));
}

/** Loan amount that a given P&I payment supports. Inverse of monthlyPayment. */
export function loanFromPayment(payment: number, ratePct: number, termMonths: number): number {
  if (!(payment > 0) || !(termMonths > 0)) return 0;
  const r = ratePct / 100 / 12;
  if (r === 0) return payment * termMonths;
  return (payment * (1 - Math.pow(1 + r, -termMonths))) / r;
}

/** Full schedule. `extra` is an optional extra principal per month. */
export function amortize(loan: number, ratePct: number, termMonths: number, extra = 0): AmortRow[] {
  const rows: AmortRow[] = [];
  const pay = monthlyPayment(loan, ratePct, termMonths);
  const r = ratePct / 100 / 12;
  let bal = loan;
  for (let m = 1; m <= termMonths && bal > 0.005; m++) {
    const interest = bal * r;
    let principal = pay - interest + extra;
    if (principal > bal) principal = bal;
    bal -= principal;
    rows.push({ month: m, payment: principal + interest, interest, principal, balance: Math.max(0, bal) });
  }
  return rows;
}

/** Balance remaining after `k` payments. */
export function balanceAfter(loan: number, ratePct: number, termMonths: number, k: number): number {
  if (k <= 0) return loan;
  const r = ratePct / 100 / 12;
  const pay = monthlyPayment(loan, ratePct, termMonths);
  const n = Math.min(k, termMonths);
  if (r === 0) return Math.max(0, loan - pay * n);
  const g = Math.pow(1 + r, n);
  return Math.max(0, loan * g - (pay * (g - 1)) / r);
}

/** Principal and interest paid over the first `k` payments. */
export function paidOver(loan: number, ratePct: number, termMonths: number, k: number) {
  const n = Math.min(Math.max(0, k), termMonths);
  const pay = monthlyPayment(loan, ratePct, termMonths);
  const principal = loan - balanceAfter(loan, ratePct, termMonths, n);
  const total = pay * n;
  return { principal, interest: total - principal, total };
}

/** Interest/principal split of payment number `k` (1-based). */
export function paymentSplit(loan: number, ratePct: number, termMonths: number, k: number) {
  const before = balanceAfter(loan, ratePct, termMonths, k - 1);
  const pay = monthlyPayment(loan, ratePct, termMonths);
  const interest = before * (ratePct / 100 / 12);
  return { interest, principal: pay - interest, payment: pay };
}

/**
 * APR: the rate at which the amount financed net of prepaid finance charges
 * produces the same payment. Bisection; returns percent.
 */
export function apr(loan: number, ratePct: number, termMonths: number, financeCharges: number): number {
  const pay = monthlyPayment(loan, ratePct, termMonths);
  const net = loan - financeCharges;
  if (!(net > 0) || !(pay > 0)) return ratePct;
  if (financeCharges <= 0) return ratePct;
  let lo = 0;
  let hi = 100;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (loanFromPayment(pay, mid, termMonths) > net) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Yearly summary from a schedule: cumulative paid/interest/principal and balance at each year end. */
export function yearlySummary(loan: number, ratePct: number, termMonths: number, roundedPaymentForPaid = false) {
  const pay = monthlyPayment(loan, ratePct, termMonths);
  const shownPay = roundedPaymentForPaid ? Math.round(pay) : pay;
  const years = Math.ceil(termMonths / 12);
  const out = [] as { year: number; paid: number; interest: number; principal: number; balance: number; yearInterest: number; yearPrincipal: number }[];
  let prev = { principal: 0, interest: 0 };
  for (let y = 1; y <= years; y++) {
    const k = Math.min(y * 12, termMonths);
    const p = paidOver(loan, ratePct, termMonths, k);
    out.push({
      year: y,
      paid: shownPay * k,
      interest: p.interest,
      principal: p.principal,
      balance: loan - p.principal,
      yearInterest: p.interest - prev.interest,
      yearPrincipal: p.principal - prev.principal,
    });
    prev = p;
  }
  return out;
}

/** Simple compound growth helper: value * (1 + rate)^years. */
export function grow(value: number, ratePct: number, years: number): number {
  return value * Math.pow(1 + ratePct / 100, years);
}

/** Compound annual growth rate between two values over `years`, in percent. */
export function cagr(start: number, end: number, years: number): number {
  if (!(start > 0) || !(years > 0)) return 0;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}

/** Round to cents. */
export const cents = (n: number) => Math.round(n * 100) / 100;
