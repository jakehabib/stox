/**
 * ARM vs Fixed. Pure functions. Rates are percent numbers (6.5 = 6.5%).
 *
 * Model (reproduces the observed MBS Highway numbers):
 * - Fixed loan amortizes normally.
 * - ARM starts at `armRate` for `fixedYears`; then adjusts every `adjustMonths`.
 *   Worst case: first adjustment = min(start + initial cap, start + lifetime cap); each later
 *   adjustment + periodic cap, never above start + lifetime cap.
 *   Best case: mirror image downward, never below the floor (margin).
 *   Custom: the rate moves toward a fully-indexed target rate, limited by the same caps.
 * - At every adjustment the ARM payment is recast on the remaining balance over the remaining term.
 * - Cash-in-hand: savings(m) = Σ(fixed P&I − ARM P&I) + (fixed balance − ARM balance).
 * - Reinvest to principal: while the ARM payment is below the fixed payment the borrower keeps
 *   paying the fixed payment, so the difference is extra ARM principal (no cash flow).
 */
import { monthlyPayment } from './core';

export type ArmScenario = 'worst' | 'best' | 'custom';

export interface ArmCaps {
  initial: number;
  periodic: number;
  lifetime: number;
}

export interface ArmInput {
  loanAmount: number;
  termYears: number;
  fixedRate: number;
  armRate: number;
  /** Years at the start rate (3/1 → 3, 5/1 → 5, 7/1 → 7, 10/1 → 10). */
  fixedYears: number;
  /** Months between adjustments after the fixed period (12 or 6). */
  adjustMonths: number;
  caps: ArmCaps;
  scenario: ArmScenario;
  /** Best-case floor (usually the margin). */
  floorRate: number;
  /** Custom scenario: fully-indexed rate (index + margin) the ARM moves toward. */
  customTargetRate: number;
  reinvest: boolean;
}

export const ARM_DEFAULTS: ArmInput = {
  loanAmount: 400000,
  termYears: 30,
  fixedRate: 6.5,
  armRate: 5.5,
  fixedYears: 7,
  adjustMonths: 12,
  caps: { initial: 5, periodic: 2, lifetime: 5 },
  scenario: 'worst',
  floorRate: 2.75,
  customTargetRate: 7.5,
  reinvest: false,
};

export interface ArmMonth {
  month: number;
  armRate: number;
  fixedPayment: number;
  /** Required (scheduled) ARM P&I this month. */
  armPayment: number;
  /** What the ARM borrower actually pays (≥ armPayment when reinvesting). */
  armPaid: number;
  fixedInterest: number;
  armInterest: number;
  fixedBalance: number;
  armBalance: number;
  /** Cumulative (fixed paid − ARM paid). */
  cashflow: number;
  /** fixed balance − ARM balance. */
  principalGained: number;
  /** cashflow + principalGained. */
  total: number;
}

export interface ArmYear {
  year: number;
  armRate: number;
  fixedPayment: number;
  armPayment: number;
  /** ARM payment change vs the previous year (0 in year 1). */
  armPaymentChange: number;
  /** Monthly fixed − ARM payment for the year (positive = ARM cheaper). */
  monthlyDiff: number;
  cashflow: number;
  principalGained: number;
  total: number;
  fixedBalance: number;
  armBalance: number;
  fixedInterestCum: number;
  armInterestCum: number;
}

export interface ArmResult {
  months: ArmMonth[];
  years: ArmYear[];
  fixedPayment: number;
  armInitialPayment: number;
  initialMonthlySavings: number;
  fixedMonths: number;
  /** First month after the fixed period where total savings ≤ 0; null if the ARM stays ahead. */
  breakEvenMonth: number | null;
  /** True when the ARM is not cheaper even at the start. */
  armNeverAhead: boolean;
  /** Savings at the end of the fixed period. */
  atFixedEnd: { cashflow: number; principalGained: number; total: number };
  peakRate: number;
  peakPayment: number;
  totals: { fixedInterest: number; armInterest: number; fixedPaid: number; armPaid: number };
}

const fin = (n: number, d = 0) => (Number.isFinite(n) ? n : d);

function sanitize(i: ArmInput): ArmInput {
  const termYears = Math.min(50, Math.max(1, Math.round(fin(i.termYears, 30))));
  return {
    ...i,
    loanAmount: Math.max(0, fin(i.loanAmount)),
    termYears,
    fixedRate: Math.min(50, Math.max(0, fin(i.fixedRate))),
    armRate: Math.min(50, Math.max(0, fin(i.armRate))),
    fixedYears: Math.min(termYears, Math.max(1, Math.round(fin(i.fixedYears, 7)))),
    adjustMonths: Math.max(1, Math.round(fin(i.adjustMonths, 12))),
    caps: {
      initial: Math.max(0, fin(i.caps?.initial)),
      periodic: Math.max(0, fin(i.caps?.periodic)),
      lifetime: Math.max(0, fin(i.caps?.lifetime)),
    },
    floorRate: Math.max(0, fin(i.floorRate)),
    customTargetRate: Math.max(0, fin(i.customTargetRate)),
  };
}

/** Rate after each adjustment. Returns the rate for adjustment #k (k = 0 is the first adjustment). */
export function nextArmRate(prev: number, start: number, k: number, input: Pick<ArmInput, 'caps' | 'scenario' | 'floorRate' | 'customTargetRate'>): number {
  const cap = k === 0 ? input.caps.initial : input.caps.periodic;
  const ceiling = start + input.caps.lifetime;
  const floor = Math.max(input.floorRate, start - input.caps.lifetime, 0);
  if (input.scenario === 'worst') return Math.min(prev + cap, ceiling);
  if (input.scenario === 'best') return Math.max(prev - cap, Math.min(floor, prev));
  // custom: move toward target, limited by cap, lifetime ceiling and floor
  const target = Math.min(Math.max(input.customTargetRate, floor), ceiling);
  if (target > prev) return Math.min(prev + cap, target);
  return Math.max(prev - cap, target);
}

/** Monthly ARM rate path (index 0 = month 1). */
export function armRatePath(raw: ArmInput): number[] {
  const i = sanitize(raw);
  const n = i.termYears * 12;
  const fixedMonths = i.fixedYears * 12;
  const out: number[] = [];
  let rate = i.armRate;
  let k = 0;
  for (let m = 1; m <= n; m++) {
    if (m > fixedMonths && (m - fixedMonths - 1) % i.adjustMonths === 0) {
      rate = nextArmRate(rate, i.armRate, k, i);
      k++;
    }
    out.push(rate);
  }
  return out;
}

export function simulateArmVsFixed(raw: ArmInput): ArmResult {
  const i = sanitize(raw);
  const n = i.termYears * 12;
  const fixedMonths = Math.min(n, i.fixedYears * 12);
  const path = armRatePath(i);
  const fixedPayment = monthlyPayment(i.loanAmount, i.fixedRate, n);
  const armInitialPayment = monthlyPayment(i.loanAmount, i.armRate, n);
  const rf = i.fixedRate / 1200;

  let fBal = i.loanAmount;
  let aBal = i.loanAmount;
  let armPay = armInitialPayment;
  let cash = 0;
  let fInt = 0;
  let aInt = 0;
  let fPaid = 0;
  let aPaid = 0;
  const months: ArmMonth[] = [];

  for (let m = 1; m <= n; m++) {
    const rate = path[m - 1];
    if (m > fixedMonths && (m - fixedMonths - 1) % i.adjustMonths === 0) {
      // adjustment: recast on remaining balance over remaining term
      armPay = monthlyPayment(aBal, rate, n - m + 1);
    }
    // fixed
    const fi = fBal * rf;
    let fp = fixedPayment - fi;
    if (fp > fBal) fp = fBal;
    const fPay = fBal > 0 ? fp + fi : 0;
    fBal = Math.max(0, fBal - fp);
    // arm
    const ai = aBal * (rate / 1200);
    const required = aBal > 0 ? Math.min(armPay, aBal + ai) : 0;
    let paid = required;
    if (i.reinvest && aBal > 0 && required < fPay) paid = Math.min(fPay, aBal + ai);
    const ap = Math.max(0, paid - ai);
    aBal = Math.max(0, aBal - ap);
    if (aBal < 0.005) aBal = 0;
    if (fBal < 0.005) fBal = 0;

    cash += fPay - paid;
    fInt += fi;
    aInt += ai;
    fPaid += fPay;
    aPaid += paid;
    const gained = fBal - aBal;
    months.push({
      month: m,
      armRate: rate,
      fixedPayment: fPay,
      armPayment: required,
      armPaid: paid,
      fixedInterest: fi,
      armInterest: ai,
      fixedBalance: fBal,
      armBalance: aBal,
      cashflow: cash,
      principalGained: gained,
      total: cash + gained,
    });
  }

  const armNeverAhead = months.length > 0 && months[0].total <= 0;
  let breakEvenMonth: number | null = null;
  for (const r of armNeverAhead ? [] : months) {
    if (r.month > fixedMonths && r.total <= 0) {
      breakEvenMonth = r.month;
      break;
    }
  }

  const years: ArmYear[] = [];
  let fiCum = 0;
  let aiCum = 0;
  let prevArmPay = 0;
  for (let y = 1; y <= i.termYears; y++) {
    const slice = months.slice((y - 1) * 12, y * 12);
    if (!slice.length) break;
    slice.forEach((r) => {
      fiCum += r.fixedInterest;
      aiCum += r.armInterest;
    });
    const first = slice[0];
    const last = slice[slice.length - 1];
    const armPayment = first.armPayment;
    years.push({
      year: y,
      armRate: first.armRate,
      fixedPayment: first.fixedPayment,
      armPayment,
      armPaymentChange: y === 1 ? 0 : armPayment - prevArmPay,
      monthlyDiff: first.fixedPayment - first.armPaid,
      cashflow: last.cashflow,
      principalGained: last.principalGained,
      total: last.total,
      fixedBalance: last.fixedBalance,
      armBalance: last.armBalance,
      fixedInterestCum: fiCum,
      armInterestCum: aiCum,
    });
    prevArmPay = armPayment;
  }

  const atEnd = months[fixedMonths - 1] ?? months[months.length - 1];
  return {
    months,
    years,
    fixedPayment,
    armInitialPayment,
    initialMonthlySavings: fixedPayment - armInitialPayment,
    fixedMonths,
    breakEvenMonth,
    armNeverAhead,
    atFixedEnd: atEnd ? { cashflow: atEnd.cashflow, principalGained: atEnd.principalGained, total: atEnd.total } : { cashflow: 0, principalGained: 0, total: 0 },
    peakRate: path.length ? Math.max(...path) : i.armRate,
    peakPayment: months.length ? Math.max(...months.map((r) => r.armPayment)) : 0,
    totals: { fixedInterest: fInt, armInterest: aInt, fixedPaid: fPaid, armPaid: aPaid },
  };
}

/** ARM product label → fixed years. */
export const ARM_PRODUCTS = [
  { value: '3', label: '3/1 ARM' },
  { value: '5', label: '5/1 ARM' },
  { value: '7', label: '7/1 ARM' },
  { value: '10', label: '10/1 ARM' },
] as const;
