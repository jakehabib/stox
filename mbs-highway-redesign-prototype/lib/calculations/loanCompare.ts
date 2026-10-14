/**
 * Loan Comparison ("True Cost Comparison") math. Pure functions, no UI.
 * Rates are PERCENT numbers (6.5 = 6.5%). Money in dollars, unrounded — round only for display.
 *
 * Model (calibrated to the live tool, Alex Rivera scenario):
 *  - Monthly payment view at holding period H years = principal/interest split of payment #(H×12)
 *    + MI + taxes + insurance + HOA.
 *  - Total cost over H = interest paid + MI paid + points + closing costs − lender credits.
 *  - Equity at H = principal paid + appreciation (location curve) + down payment.
 *  - Cash to close = down + closing + prepaid + points − credits.
 */
import { getLocation } from '@/data/mock/locations';
import { valueAtYear, type AppreciationSetting } from './appreciation';
import { apr as aprCalc, balanceAfter, monthlyPayment, paidOver, paymentSplit, yearlySummary } from './core';

export type LoanProgram = 'Conventional' | 'FHA' | 'VA' | 'USDA' | 'Jumbo';
export type LoanKind = 'Fixed';

export interface LoanOption {
  id: string;
  /** Optional custom label; falls back to "Option N". */
  label?: string;
  /** Down payment as percent of the purchase price (source of truth, so price edits keep the ratio). */
  downPct: number;
  termYears: number;
  program: LoanProgram;
  loanType: LoanKind;
  ratePct: number;
  aprPct: number;
  /** Discount points, percent of the loan amount. */
  pointsPct: number;
  miMonthly: number;
  closingCosts: number;
  credits: number;
  prepaid: number;
}

/** Minimal property facts the comparison needs (a PropertyInput satisfies this). */
export interface ComparisonProperty {
  locationId: string;
  price: number;
  taxAnnual: number;
  insuranceMonthly: number;
  hoaMonthly: number;
  appreciation: AppreciationSetting;
}

const fin = (n: number) => (Number.isFinite(n) ? n : 0);
const pos = (n: number) => Math.max(0, fin(n));

export function newLoanOption(partial: Partial<LoanOption> = {}): LoanOption {
  return {
    downPct: 20,
    termYears: 30,
    program: 'Conventional',
    loanType: 'Fixed',
    ratePct: 6.5,
    aprPct: 6.5,
    pointsPct: 0,
    miMonthly: 0,
    closingCosts: 0,
    credits: 0,
    prepaid: 0,
    ...partial,
    id: partial.id ?? `lo-${Math.random().toString(36).slice(2, 9)}`,
  };
}

/** The two options from the spec example (Alex Rivera). */
export function alexLoanOptions(): LoanOption[] {
  return [
    newLoanOption({ id: 'opt-1', ratePct: 6.5, aprPct: 6.5 }),
    newLoanOption({ id: 'opt-2', ratePct: 6.125, aprPct: 6.124 }),
  ];
}

export const optionLabel = (o: LoanOption, i: number) => (o.label && o.label.trim() ? o.label.trim() : `Option ${i + 1}`);

export function downPaymentOf(price: number, o: Pick<LoanOption, 'downPct'>): number {
  return pos(price) * Math.min(100, pos(o.downPct)) / 100;
}
export function loanAmountOf(price: number, o: Pick<LoanOption, 'downPct'>): number {
  return Math.max(0, pos(price) - downPaymentOf(price, o));
}
/** Convert an entered loan amount back to a down-payment percent. */
export function downPctFromLoan(price: number, loan: number): number {
  if (!(price > 0)) return 0;
  return Math.min(100, Math.max(0, ((price - pos(loan)) / price) * 100));
}
export const pointsCost = (loan: number, pointsPct: number) => (pos(loan) * pos(pointsPct)) / 100;

export function cashToClose(price: number, o: LoanOption): number {
  const loan = loanAmountOf(price, o);
  return Math.max(0, downPaymentOf(price, o) + pos(o.closingCosts) + pos(o.prepaid) + pointsCost(loan, o.pointsPct) - pos(o.credits));
}

export interface OptionResult {
  id: string;
  label: string;
  index: number;
  price: number;
  loanAmount: number;
  downPayment: number;
  termMonths: number;
  ratePct: number;
  aprPct: number;
  pointsPct: number;
  pointsCost: number;
  closingCosts: number;
  prepaid: number;
  credits: number;
  pi: number;
  /** Principal/interest split of payment #holdingMonths (the "Monthly Payment" tab). */
  principalPart: number;
  interestPart: number;
  mi: number;
  taxes: number;
  insurance: number;
  hoa: number;
  totalMonthly: number;
  cashToClose: number;
  holdingMonths: number;
  interestPaid: number;
  principalPaid: number;
  miPaid: number;
  totalCost: number;
  balance: number;
  appreciation: number;
  projectedValue: number;
  totalEquity: number;
}

export function clampHolding(years: number): number {
  return Math.min(30, Math.max(1, Math.round(fin(years)) || 1));
}

export function computeOption(prop: ComparisonProperty, o: LoanOption, holdingYears: number, index = 0): OptionResult {
  const price = pos(prop.price);
  const loan = loanAmountOf(price, o);
  const down = downPaymentOf(price, o);
  const termMonths = Math.max(12, Math.round(pos(o.termYears) * 12) || 360);
  const rate = pos(o.ratePct);
  const holdingMonths = Math.min(clampHolding(holdingYears) * 12, termMonths);
  const pi = monthlyPayment(loan, rate, termMonths);
  const split = loan > 0 ? paymentSplit(loan, rate, termMonths, holdingMonths) : { principal: 0, interest: 0 };
  const paid = loan > 0 ? paidOver(loan, rate, termMonths, holdingMonths) : { principal: 0, interest: 0, total: 0 };
  const taxes = pos(prop.taxAnnual) / 12;
  const insurance = pos(prop.insuranceMonthly);
  const hoa = pos(prop.hoaMonthly);
  const mi = pos(o.miMonthly);
  const pts = pointsCost(loan, o.pointsPct);
  const loc = getLocation(prop.locationId);
  const projectedValue = fin(valueAtYear(price, loc, prop.appreciation, clampHolding(holdingYears)));
  const appreciation = projectedValue - price;
  const miPaid = mi * holdingMonths;
  const balance = loan > 0 ? balanceAfter(loan, rate, termMonths, holdingMonths) : 0;
  return {
    id: o.id,
    label: optionLabel(o, index),
    index,
    price,
    loanAmount: loan,
    downPayment: down,
    termMonths,
    ratePct: rate,
    aprPct: pos(o.aprPct),
    pointsPct: pos(o.pointsPct),
    pointsCost: pts,
    closingCosts: pos(o.closingCosts),
    prepaid: pos(o.prepaid),
    credits: pos(o.credits),
    pi,
    principalPart: fin(split.principal),
    interestPart: fin(split.interest),
    mi,
    taxes,
    insurance,
    hoa,
    totalMonthly: pi + mi + taxes + insurance + hoa,
    cashToClose: cashToClose(price, o),
    holdingMonths,
    interestPaid: fin(paid.interest),
    principalPaid: fin(paid.principal),
    miPaid,
    totalCost: fin(paid.interest) + miPaid + pts + pos(o.closingCosts) - pos(o.credits),
    balance,
    appreciation,
    projectedValue,
    totalEquity: fin(paid.principal) + appreciation + down,
  };
}

export type WinnerKey = 'monthly' | 'cash' | 'cost' | 'equity';

export interface ComparisonResult {
  options: OptionResult[];
  /** Indices of winners per category (ties → all tied). Empty when < 2 options. */
  winners: Record<WinnerKey, number[]>;
  /** Max − min of each metric (whole-dollar). */
  spread: { monthly: number; cash: number; cost: number; equity: number };
  /** Projected value at year 10 (spec header). */
  projectedValue10: number;
}

/** Indices achieving the best (rounded to whole dollars) value. */
export function bestIndices(values: number[], better: 'low' | 'high'): number[] {
  if (values.length < 2) return [];
  const r = values.map((v) => Math.round(fin(v)));
  const best = better === 'low' ? Math.min(...r) : Math.max(...r);
  const idx = r.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
  return idx; // ties → every tied option wins
}

export function compareLoans(prop: ComparisonProperty, options: LoanOption[], holdingYears: number): ComparisonResult {
  const res = options.map((o, i) => computeOption(prop, o, holdingYears, i));
  const spread = (k: keyof OptionResult) => {
    if (res.length < 2) return 0;
    const v = res.map((r) => Math.round(r[k] as number));
    return Math.max(...v) - Math.min(...v);
  };
  return {
    options: res,
    winners: {
      monthly: bestIndices(res.map((r) => r.totalMonthly), 'low'),
      cash: bestIndices(res.map((r) => r.cashToClose), 'low'),
      cost: bestIndices(res.map((r) => r.totalCost), 'low'),
      equity: bestIndices(res.map((r) => r.totalEquity), 'high'),
    },
    spread: { monthly: spread('totalMonthly'), cash: spread('cashToClose'), cost: spread('totalCost'), equity: spread('totalEquity') },
    projectedValue10: fin(valueAtYear(pos(prop.price), getLocation(prop.locationId), prop.appreciation, 10)),
  };
}

/* ------------------------------------------------------------------ reinvestment */

/** Future value of a level monthly contribution at an annual rate, compounded monthly. */
export function futureValueMonthly(monthly: number, ratePct: number, months: number): number {
  const m = Math.max(0, Math.round(fin(months)));
  const c = pos(monthly);
  if (m === 0 || c === 0) return 0;
  const r = fin(ratePct) / 100 / 12;
  if (r === 0) return c * m;
  return c * ((Math.pow(1 + r, m) - 1) / r);
}

export interface ReinvestResult {
  id: string;
  /** Monthly savings vs the most expensive option's total monthly payment. */
  monthlySavings: number;
  contributions: number;
  futureValue: number;
  growth: number;
}

/**
 * Reinvestment strategy: each option's monthly savings vs the most expensive option is
 * invested monthly at `ratePct` for the holding period.
 */
export function reinvestment(results: OptionResult[], ratePct: number): ReinvestResult[] {
  if (!results.length) return [];
  const worst = Math.max(...results.map((r) => r.totalMonthly));
  return results.map((r) => {
    const s = Math.max(0, worst - r.totalMonthly);
    const fv = futureValueMonthly(s, ratePct, r.holdingMonths);
    const contributions = s * r.holdingMonths;
    return { id: r.id, monthlySavings: s, contributions, futureValue: fv, growth: fv - contributions };
  });
}

/* ------------------------------------------------------------------ time series */

/** Cumulative cost (interest + MI + upfront costs) and equity by year 0..years for one option. */
export function yearlySeries(prop: ComparisonProperty, o: LoanOption, years: number) {
  const out: { year: number; cost: number; equity: number; balance: number; value: number }[] = [];
  const n = Math.max(1, Math.min(30, Math.round(fin(years))));
  for (let y = 0; y <= n; y++) {
    if (y === 0) {
      const price = pos(prop.price);
      const loan = loanAmountOf(price, o);
      const upfront = pointsCost(loan, o.pointsPct) + pos(o.closingCosts) - pos(o.credits);
      out.push({ year: 0, cost: upfront, equity: downPaymentOf(price, o), balance: loan, value: price });
      continue;
    }
    const r = computeOption(prop, o, y);
    out.push({ year: y, cost: r.totalCost, equity: r.totalEquity, balance: r.balance, value: r.projectedValue });
  }
  return out;
}

/** Yearly amortization schedule for the "View Amortization" modal. */
export function amortizationByYear(price: number, o: LoanOption) {
  const loan = loanAmountOf(price, o);
  const termMonths = Math.max(12, Math.round(pos(o.termYears) * 12) || 360);
  if (!(loan > 0)) return [];
  const pay = monthlyPayment(loan, pos(o.ratePct), termMonths);
  return yearlySummary(loan, pos(o.ratePct), termMonths).map((y) => ({
    year: y.year,
    payment: y.yearInterest + y.yearPrincipal,
    principal: y.yearPrincipal,
    interest: y.yearInterest,
    cumulativeInterest: y.interest,
    cumulativePrincipal: y.principal,
    balance: Math.max(0, y.balance),
    monthly: pay,
  }));
}

/** The LO talk-track facts: who wins what, by how much. */
export function summaryFacts(c: ComparisonResult) {
  const o = c.options;
  if (o.length < 2) return null;
  const monthlyWin = c.winners.monthly.length === 1 ? o[c.winners.monthly[0]] : null;
  const costWin = c.winners.cost.length === 1 ? o[c.winners.cost[0]] : null;
  const equityWin = c.winners.equity.length === 1 ? o[c.winners.equity[0]] : null;
  const sameCash = c.winners.cash.length === o.length;
  const sweep = !!monthlyWin && !!costWin && !!equityWin && monthlyWin.id === costWin.id && costWin.id === equityWin.id;
  return { monthlyWin, costWin, equityWin, sameCash, sweep, anyPoints: o.some((x) => x.pointsPct > 0) };
}

/* ------------------------------------------------------------------ property variants */

export interface PropertyVariantSource extends ComparisonProperty {
  alternatePrices: number[];
  extraLocationIds: string[];
}

export interface PropertyVariant {
  key: string;
  label: string;
  kind: 'primary' | 'alternate-price' | 'location';
  property: ComparisonProperty;
}

/**
 * The LOCATIONS list on the results page: the primary property, each alternate price
 * (tax scales with price) and each additional location (county tax + default insurance there).
 */
export function propertyVariants(p: PropertyVariantSource): PropertyVariant[] {
  const base: ComparisonProperty = { locationId: p.locationId, price: pos(p.price), taxAnnual: pos(p.taxAnnual), insuranceMonthly: pos(p.insuranceMonthly), hoaMonthly: pos(p.hoaMonthly), appreciation: p.appreciation };
  const loc = getLocation(p.locationId);
  const out: PropertyVariant[] = [{ key: 'primary', label: loc.label, kind: 'primary', property: base }];
  (p.alternatePrices ?? []).forEach((alt, i) => {
    const price = pos(alt);
    out.push({
      key: `alt-${i}`,
      label: `${loc.label} · alternate price`,
      kind: 'alternate-price',
      property: { ...base, price, taxAnnual: base.price > 0 ? (base.taxAnnual * price) / base.price : base.taxAnnual },
    });
  });
  (p.extraLocationIds ?? []).forEach((id, i) => {
    const l = getLocation(id);
    out.push({
      key: `loc-${i}`,
      label: l.label,
      kind: 'location',
      property: { ...base, locationId: l.id, taxAnnual: Math.round((base.price * l.taxRatePct) / 100), insuranceMonthly: l.insuranceMonthly },
    });
  });
  return out;
}

/** APR estimate from prepaid finance charges (points + closing costs − credits). */
export function estimateApr(price: number, o: LoanOption): number {
  const loan = loanAmountOf(price, o);
  const termMonths = Math.max(12, Math.round(pos(o.termYears) * 12) || 360);
  const charges = Math.max(0, pointsCost(loan, o.pointsPct) + pos(o.closingCosts) - pos(o.credits));
  return Math.round(aprCalc(loan, pos(o.ratePct), termMonths, charges) * 1000) / 1000;
}
