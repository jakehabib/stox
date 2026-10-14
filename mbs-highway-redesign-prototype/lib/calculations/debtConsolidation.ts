/**
 * Debt Consolidation — Refinance (cash-out) or Move-Up Purchase.
 *
 * BUILT TO SPEC: the live session never reached results (the "Add new debt" button failed
 * to create Debt 2), so there are no live numbers to verify against. The model below is the
 * standard LO presentation:
 *
 * Refinance  — new loan = remaining balance + consolidated debts + closing costs (+ extra cash
 *              out), checked against the program's max cash-out LTV.
 * Move-Up    — sell the existing home (value − cost to sell − payoff = net proceeds), pay
 *              purchase closing costs and the consolidated debts from the proceeds, and put the
 *              rest down on the new home. Compared with moving up WITHOUT consolidating.
 *
 * Honesty: rolling short debts into a 30-year loan lowers the monthly payment but usually
 * raises lifetime interest. Results show both, plus "reinvest the savings" options.
 */
import { conventionalMiRatePct } from '@/data/mock/mi';
import type { FicoBand } from '@/data/mock/clients';
import { amortize, balanceAfter, monthlyPayment } from './core';

export type DebtType = 'Installment' | 'Revolving' | 'Other';
export const DEBT_TYPES: DebtType[] = ['Installment', 'Revolving', 'Other'];
export type DcTab = 'refinance' | 'moveup';
export type DcProgram = 'Conventional' | 'FHA' | 'VA';

export interface Debt {
  id: string;
  name: string;
  type: DebtType;
  balance: number;
  payment: number;
  ratePct: number;
  include: boolean;
}

export interface ExistingHome {
  locationId: string;
  originalPrice: number;
  taxAnnual: number;
  insuranceMonthly: number;
  hoaMonthly: number;
  /** ISO date (YYYY-MM-DD). */
  purchaseDate: string;
  estValue: number;
  loanAmount: number;
  termYears: number;
  program: DcProgram;
  loanType: 'Fixed';
  ratePct: number;
  miMonthly: number;
}

export interface RefiTerms {
  /** Value the refinance is underwritten at (defaults to the estimated value). */
  appraisedValue: number;
  maxLtvPct: number;
  additionalCashOut: number;
  closingCosts: number;
}

export interface MoveUpTerms {
  costToSellPct: number;
  newLocationId: string;
  newPrice: number;
  newTaxAnnual: number;
  newInsuranceMonthly: number;
  newHoaMonthly: number;
  purchaseClosingPct: number;
}

export interface ProposedLoan {
  program: DcProgram;
  termYears: number;
  ratePct: number;
  fico: FicoBand;
  miMode: 'auto' | 'manual';
  miMonthly: number;
}

export interface Reinvest {
  /** Return assumed when savings are invested. */
  ratePct: number;
  years: number;
}

export interface DebtConsolidationInput {
  tab: DcTab;
  clientId: string | null;
  monthlyIncome: number;
  debts: Debt[];
  existing: ExistingHome;
  refi: RefiTerms;
  moveUp: MoveUpTerms;
  proposed: ProposedLoan;
  reinvest: Reinvest;
}

/** Spec debts (Alex Rivera). */
export const DEFAULT_DEBTS: Debt[] = [
  { id: 'd1', name: 'Credit Card', type: 'Revolving', balance: 8000, payment: 250, ratePct: 22, include: true },
  { id: 'd2', name: 'Auto Loan', type: 'Installment', balance: 15000, payment: 350, ratePct: 8, include: true },
];

/**
 * DEMO existing home — the live session never reached this step with data, so these are
 * illustrative: bought mid-2023 for $460k with 20% down at 7.25%, now worth $500k.
 */
export const DEMO_EXISTING: ExistingHome = {
  locationId: 'dallas-tx-75201',
  originalPrice: 460000,
  taxAnnual: 8400,
  insuranceMonthly: 150,
  hoaMonthly: 0,
  purchaseDate: '2023-06-15',
  estValue: 500000,
  loanAmount: 368000,
  termYears: 30,
  program: 'Conventional',
  loanType: 'Fixed',
  ratePct: 7.25,
  miMonthly: 0,
};

export const DEBT_CONSOLIDATION_DEFAULTS: DebtConsolidationInput = {
  tab: 'refinance',
  clientId: 'c-alex-rivera',
  monthlyIncome: 12500,
  debts: DEFAULT_DEBTS,
  existing: DEMO_EXISTING,
  refi: { appraisedValue: 500000, maxLtvPct: 80, additionalCashOut: 0, closingCosts: 6000 },
  moveUp: { costToSellPct: 6, newLocationId: 'dallas-tx-75201', newPrice: 650000, newTaxAnnual: 11968, newInsuranceMonthly: 146, newHoaMonthly: 0, purchaseClosingPct: 3 },
  proposed: { program: 'Conventional', termYears: 30, ratePct: 6.5, fico: '720–739', miMode: 'auto', miMonthly: 0 },
  reinvest: { ratePct: 6, years: 10 },
};

/** Max cash-out LTV by program (demo guideline). */
export const CASH_OUT_MAX_LTV: Record<DcProgram, number> = { Conventional: 80, FHA: 80, VA: 90 };
/** Max purchase LTV by program (demo guideline). */
export const PURCHASE_MAX_LTV: Record<DcProgram, number> = { Conventional: 97, FHA: 96.5, VA: 100 };

const nn = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
const termMonths = (y: number) => Math.max(1, Math.round(nn(y) * 12) || 360);

export function newDebt(index: number): Debt {
  return { id: `d${Date.now()}-${index}`, name: `Debt ${index}`, type: 'Other', balance: 0, payment: 0, ratePct: 0, include: true };
}

/** Whole months elapsed between an ISO date and `asOf` (0 if invalid/future). */
export function monthsBetween(isoStart: string, asOf: Date): number {
  const s = new Date(`${isoStart}T00:00:00`);
  if (Number.isNaN(s.getTime())) return 0;
  let m = (asOf.getFullYear() - s.getFullYear()) * 12 + (asOf.getMonth() - s.getMonth());
  if (asOf.getDate() < s.getDate()) m -= 1;
  return Math.max(0, m);
}

/* ---------------------------------------------------------------- debts */

export interface DebtPayoff {
  months: number;
  interest: number;
  /** Payment doesn't cover the interest — never pays off. */
  neverPaysOff: boolean;
}

/** Month-by-month payoff of a debt at its own payment. Capped at 50 years. */
export function debtPayoff(balance: number, ratePct: number, payment: number): DebtPayoff {
  let bal = nn(balance);
  const r = nn(ratePct) / 100 / 12;
  const pay = nn(payment);
  if (bal === 0) return { months: 0, interest: 0, neverPaysOff: false };
  if (pay <= bal * r || pay === 0) return { months: 600, interest: bal * r * 600, neverPaysOff: true };
  let months = 0;
  let interest = 0;
  while (bal > 0.005 && months < 600) {
    const i = bal * r;
    interest += i;
    bal = bal + i - Math.min(pay, bal + i);
    months++;
  }
  return { months, interest, neverPaysOff: false };
}

export function summarizeDebts(debts: Debt[]) {
  const sum = (list: Debt[]) => ({
    count: list.length,
    balance: list.reduce((s, d) => s + nn(d.balance), 0),
    payment: list.reduce((s, d) => s + nn(d.payment), 0),
  });
  const included = debts.filter((d) => d.include);
  const excluded = debts.filter((d) => !d.include);
  const payoffs = included.map((d) => ({ id: d.id, ...debtPayoff(d.balance, d.ratePct, d.payment) }));
  return {
    all: sum(debts),
    included: sum(included),
    excluded: sum(excluded),
    includedInterest: payoffs.reduce((s, p) => s + p.interest, 0),
    includedPayoffMonths: payoffs.reduce((m, p) => Math.max(m, p.months), 0),
    anyNeverPaysOff: payoffs.some((p) => p.neverPaysOff),
    /** Balance-weighted average rate of the consolidated debts. */
    includedAvgRatePct: included.reduce((s, d) => s + nn(d.balance) * nn(d.ratePct), 0) / (included.reduce((s, d) => s + nn(d.balance), 0) || 1),
    payoffs,
  };
}

/* ---------------------------------------------------------------- existing loan */

export interface ExistingStatus {
  monthsPaid: number;
  remainingMonths: number;
  pi: number;
  balance: number;
  equity: number;
  equityPct: number;
  housing: number;
  remainingInterest: number;
}

export function existingStatus(e: ExistingHome, asOf: Date): ExistingStatus {
  const n = termMonths(e.termYears);
  const loan = nn(e.loanAmount);
  const rate = nn(e.ratePct);
  const monthsPaid = Math.min(monthsBetween(e.purchaseDate, asOf), n);
  const pi = monthlyPayment(loan, rate, n);
  const balance = balanceAfter(loan, rate, n, monthsPaid);
  const remainingMonths = n - monthsPaid;
  const value = nn(e.estValue);
  const housing = pi + nn(e.taxAnnual) / 12 + nn(e.insuranceMonthly) + nn(e.hoaMonthly) + nn(e.miMonthly);
  return {
    monthsPaid,
    remainingMonths,
    pi,
    balance,
    equity: value - balance,
    equityPct: value > 0 ? ((value - balance) / value) * 100 : 0,
    housing,
    remainingInterest: Math.max(0, pi * remainingMonths - balance),
  };
}

/* ---------------------------------------------------------------- results */

export interface PaymentSide {
  pi: number;
  taxIns: number;
  mi: number;
  hoa: number;
  housing: number;
  debts: number;
  total: number;
  dtiPct: number;
}

function side(pi: number, taxIns: number, mi: number, hoa: number, debts: number, income: number): PaymentSide {
  const housing = pi + taxIns + mi + hoa;
  const total = housing + debts;
  return { pi, taxIns, mi, hoa, housing, debts, total, dtiPct: income > 0 ? (total / income) * 100 : 0 };
}

function proposedMi(p: ProposedLoan, loan: number, ltvPct: number): { mi: number; rate: number } {
  if (!(loan > 0)) return { mi: 0, rate: 0 };
  if (p.miMode === 'manual') return { mi: nn(p.miMonthly), rate: 0 };
  let rate = 0;
  if (p.program === 'Conventional') rate = conventionalMiRatePct(ltvPct, p.fico);
  if (p.program === 'FHA') rate = ltvPct > 95 ? 0.55 : 0.5;
  return { mi: (loan * rate) / 100 / 12, rate };
}

/** Future value of a monthly contribution at an annual return. */
export function futureValueMonthly(monthly: number, ratePct: number, months: number): number {
  const m = Math.max(0, Math.round(months));
  const r = (Number.isFinite(ratePct) ? ratePct : 0) / 100 / 12;
  const c = nn(monthly);
  if (r === 0) return c * m;
  return c * ((Math.pow(1 + r, m) - 1) / r);
}

export interface DebtConsolidationResult {
  tab: DcTab;
  existing: ExistingStatus;
  debts: ReturnType<typeof summarizeDebts>;
  newLoan: {
    amount: number;
    ratePct: number;
    termMonths: number;
    pi: number;
    mi: number;
    miRatePct: number;
    ltvPct: number;
    maxLtvPct: number;
    maxLoan: number;
    exceedsMaxLtv: boolean;
    closing: number;
    /** Refi: cash available for consolidation within max LTV. */
    roomForDebts: number;
  };
  before: PaymentSide;
  after: PaymentSide;
  monthlySavings: number;
  interest: {
    /** Baseline interest: refi → existing mortgage's remaining interest; move-up → the no-consolidation move-up loan. Plus the debts paid on their own. */
    keepMortgage: number;
    keepDebts: number;
    keepTotal: number;
    newLoan: number;
    newTotalWithClosing: number;
    /** Lifetime cost difference (positive = consolidation costs more over the long run). */
    lifetimeDiff: number;
    /** Portion of the new loan's interest attributable to the consolidated balances. */
    debtShareOfNewInterest: number;
    debtsPayoffMonths: number;
  };
  reinvest: {
    amount: number;
    principal: { payoffMonths: number; interest: number; interestSaved: number; monthsSaved: number };
    invest: { months: number; contributions: number; futureValue: number; growth: number };
  };
  moveUp?: {
    salePrice: number;
    costToSell: number;
    payoff: number;
    netProceeds: number;
    purchaseClosing: number;
    down: number;
    downPct: number;
    /** Same move WITHOUT consolidating (debts stay, larger down payment). */
    alt: PaymentSide;
    altLoan: number;
    altInterest: number;
    altDownPct: number;
    savingsVsAlt: number;
    shortfall: number;
  };
  warnings: string[];
}

export function calcDebtConsolidation(i: DebtConsolidationInput, asOf: Date = new Date()): DebtConsolidationResult {
  const income = nn(i.monthlyIncome);
  const ex = existingStatus(i.existing, asOf);
  const debts = summarizeDebts(i.debts);
  const p = i.proposed;
  const n = termMonths(p.termYears);
  const rate = nn(p.ratePct);
  const warnings: string[] = [];

  const before = side(ex.pi, nn(i.existing.taxAnnual) / 12 + nn(i.existing.insuranceMonthly), nn(i.existing.miMonthly), nn(i.existing.hoaMonthly), debts.all.payment, income);

  let amount = 0;
  let after: PaymentSide;
  let maxLtvPct = 0;
  let maxLoan = 0;
  let closing = 0;
  let roomForDebts = 0;
  let mi = { mi: 0, rate: 0 };
  let ltvPct = 0;
  let moveUp: DebtConsolidationResult['moveUp'];

  if (i.tab === 'refinance') {
    const value = nn(i.refi.appraisedValue) || nn(i.existing.estValue);
    closing = nn(i.refi.closingCosts);
    amount = ex.balance + debts.included.balance + closing + nn(i.refi.additionalCashOut);
    ltvPct = value > 0 ? (amount / value) * 100 : 0;
    maxLtvPct = nn(i.refi.maxLtvPct) || CASH_OUT_MAX_LTV[p.program];
    maxLoan = (value * maxLtvPct) / 100;
    roomForDebts = Math.max(0, maxLoan - ex.balance - closing - nn(i.refi.additionalCashOut));
    mi = proposedMi(p, amount, ltvPct);
    const pi = monthlyPayment(amount, rate, n);
    after = side(pi, nn(i.existing.taxAnnual) / 12 + nn(i.existing.insuranceMonthly), mi.mi, nn(i.existing.hoaMonthly), debts.excluded.payment, income);
    if (amount > maxLoan + 0.5) warnings.push(`New loan is ${ltvPct.toFixed(1)}% of value — above the ${maxLtvPct}% max cash-out LTV for ${p.program}. Reduce debts consolidated (room for ${Math.round(roomForDebts).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}) or use a higher value.`);
  } else {
    const m = i.moveUp;
    const salePrice = nn(i.existing.estValue);
    const costToSell = (salePrice * nn(m.costToSellPct)) / 100;
    const netProceeds = salePrice - costToSell - ex.balance;
    const price = nn(m.newPrice);
    closing = (price * nn(m.purchaseClosingPct)) / 100;
    const cashForDown = netProceeds - closing - debts.included.balance;
    const down = Math.min(Math.max(0, cashForDown), price);
    const shortfall = Math.max(0, -cashForDown);
    amount = Math.max(0, price - down);
    ltvPct = price > 0 ? (amount / price) * 100 : 0;
    maxLtvPct = PURCHASE_MAX_LTV[p.program];
    maxLoan = (price * maxLtvPct) / 100;
    mi = proposedMi(p, amount, ltvPct);
    const taxIns = nn(m.newTaxAnnual) / 12 + nn(m.newInsuranceMonthly);
    const pi = monthlyPayment(amount, rate, n);
    after = side(pi, taxIns, mi.mi, nn(m.newHoaMonthly), debts.excluded.payment, income);

    // Same move without consolidating.
    const altDown = Math.min(Math.max(0, netProceeds - closing), price);
    const altLoan = Math.max(0, price - altDown);
    const altLtv = price > 0 ? (altLoan / price) * 100 : 0;
    const altMi = proposedMi(p, altLoan, altLtv);
    const altPi = monthlyPayment(altLoan, rate, n);
    const alt = side(altPi, taxIns, altMi.mi, nn(m.newHoaMonthly), debts.all.payment, income);
    moveUp = {
      salePrice,
      costToSell,
      payoff: ex.balance,
      netProceeds,
      purchaseClosing: closing,
      down,
      downPct: price > 0 ? (down / price) * 100 : 0,
      alt,
      altLoan,
      altInterest: Math.max(0, altPi * n - altLoan),
      altDownPct: price > 0 ? (altDown / price) * 100 : 0,
      savingsVsAlt: alt.total - after.total,
      shortfall,
    };
    if (shortfall > 0) warnings.push(`Sale proceeds fall ${Math.round(shortfall).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} short of closing costs plus the debts being paid off — the borrower would need that much additional cash.`);
    if (ltvPct > maxLtvPct + 1e-9) warnings.push(`Down payment is ${(100 - ltvPct).toFixed(1)}% — below the ${(100 - maxLtvPct).toFixed(1)}% minimum for ${p.program}.`);
  }

  const newPi = after.pi;
  const newLoanInterest = Math.max(0, newPi * n - amount);
  // Baseline mortgage interest: refi → keep the existing loan; move-up → same move without consolidating.
  const keepMortgage = i.tab === 'refinance' ? ex.remainingInterest : moveUp?.altInterest ?? 0;
  const keepDebts = debts.includedInterest;
  const keepTotal = keepMortgage + keepDebts;
  const newTotalWithClosing = i.tab === 'refinance' ? newLoanInterest + closing : newLoanInterest;
  const debtShareOfNewInterest = amount > 0 ? (debts.included.balance / amount) * newLoanInterest : 0;
  if (debts.anyNeverPaysOff) warnings.push('At least one debt’s payment does not cover its interest — it never pays off on its own (interest shown is capped at 50 years).');

  const monthlySavings = before.total - after.total;
  // Savings available to reinvest: refi → monthly savings; move-up → savings vs moving without consolidating.
  const reinvestAmount = Math.max(0, i.tab === 'refinance' ? monthlySavings : moveUp?.savingsVsAlt ?? 0);
  const sched = reinvestAmount > 0 ? amortize(amount, rate, n, reinvestAmount) : amortize(amount, rate, n);
  const accelInterest = sched.reduce((s, r) => s + r.interest, 0);
  const invMonths = Math.round(nn(i.reinvest.years) * 12);
  const fv = futureValueMonthly(reinvestAmount, i.reinvest.ratePct, invMonths);

  return {
    tab: i.tab,
    existing: ex,
    debts,
    newLoan: { amount, ratePct: rate, termMonths: n, pi: newPi, mi: mi.mi, miRatePct: mi.rate, ltvPct, maxLtvPct, maxLoan, exceedsMaxLtv: i.tab === 'refinance' ? amount > maxLoan + 0.5 : ltvPct > maxLtvPct + 1e-9, closing, roomForDebts },
    before,
    after,
    monthlySavings,
    interest: {
      keepMortgage,
      keepDebts,
      keepTotal,
      newLoan: newLoanInterest,
      newTotalWithClosing,
      lifetimeDiff: newTotalWithClosing - keepTotal,
      debtShareOfNewInterest,
      debtsPayoffMonths: debts.includedPayoffMonths,
    },
    reinvest: {
      amount: reinvestAmount,
      principal: { payoffMonths: sched.length, interest: accelInterest, interestSaved: Math.max(0, newLoanInterest - accelInterest), monthsSaved: Math.max(0, n - sched.length) },
      invest: { months: invMonths, contributions: reinvestAmount * invMonths, futureValue: fv, growth: fv - reinvestAmount * invMonths },
    },
    moveUp,
    warnings,
  };
}

/** Balance over time: new loan with and without reinvesting savings into principal (yearly). */
export function balanceSeries(r: DebtConsolidationResult) {
  const base = amortize(r.newLoan.amount, r.newLoan.ratePct, r.newLoan.termMonths);
  const accel = amortize(r.newLoan.amount, r.newLoan.ratePct, r.newLoan.termMonths, r.reinvest.amount);
  const years = Math.ceil(r.newLoan.termMonths / 12);
  const at = (rows: typeof base, m: number) => (m === 0 ? r.newLoan.amount : m > rows.length ? 0 : rows[m - 1].balance);
  return Array.from({ length: years + 1 }, (_, y) => ({ year: y, standard: at(base, y * 12), accelerated: at(accel, y * 12) }));
}
