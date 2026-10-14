/**
 * Seller Contribution math: how a seller concession of $X is best used —
 *  (a) price reduction, (b) closing-cost credit, (c) permanent rate buydown (points),
 *  (d) temporary 2-1 buydown — compared on monthly payment, cash to close and the total
 *  cost over a holding period. Optional piggyback second loan (80/10/10).
 * Pure functions. Rates are PERCENT numbers (6.5 = 6.5%).
 */
import { balanceAfter, monthlyPayment } from './core';
import { monthlyMi, type MiFicoBand } from './flyer';

export type ConcessionUse = 'none' | 'price' | 'credit' | 'permanent' | 'temporary';

export interface SellerContributionInput {
  price: number;
  downPct: number;
  ratePct: number;
  termYears: number;
  /** Seller concession in dollars. */
  concession: number;
  /** Buyer's closing costs before any credit. */
  closingCosts: number;
  /** Rate reduction per discount point, in percent (0.25 = 1 point buys 0.25%). */
  rateDropPerPoint: number;
  holdingYears: number;
  taxAnnual: number;
  insuranceMonthly: number;
  hoaMonthly: number;
  fico: MiFicoBand;
  /** Piggyback second loan: first lien capped at `firstLienPct` of price, second covers the gap. */
  secondLoan: boolean;
  firstLienPct: number;
  secondRatePct: number;
  secondTermYears: number;
}

export const ALEX_SELLER_DEFAULTS: SellerContributionInput = {
  price: 500000,
  downPct: 20,
  ratePct: 6.5,
  termYears: 30,
  concession: 10000,
  closingCosts: 12000,
  rateDropPerPoint: 0.25,
  holdingYears: 7,
  taxAnnual: 8400,
  insuranceMonthly: 150,
  hoaMonthly: 0,
  fico: '720–739',
  secondLoan: false,
  firstLienPct: 80,
  secondRatePct: 8.5,
  secondTermYears: 30,
};

const fin = (n: number) => (Number.isFinite(n) ? n : 0);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, fin(n)));

/** Sanitise every input so nothing downstream can produce NaN / Infinity. */
export function normalizeSellerInput(i: SellerContributionInput): SellerContributionInput {
  return {
    ...i,
    price: clamp(i.price, 0, 1e9),
    downPct: clamp(i.downPct, 0, 100),
    ratePct: clamp(i.ratePct, 0, 30),
    termYears: clamp(Math.round(fin(i.termYears)) || 30, 1, 40),
    concession: clamp(i.concession, 0, 1e9),
    closingCosts: clamp(i.closingCosts, 0, 1e9),
    rateDropPerPoint: clamp(i.rateDropPerPoint, 0, 2),
    holdingYears: clamp(Math.round(fin(i.holdingYears)) || 1, 1, 40),
    taxAnnual: clamp(i.taxAnnual, 0, 1e8),
    insuranceMonthly: clamp(i.insuranceMonthly, 0, 1e7),
    hoaMonthly: clamp(i.hoaMonthly, 0, 1e7),
    firstLienPct: clamp(i.firstLienPct, 0, 100),
    secondRatePct: clamp(i.secondRatePct, 0, 30),
    secondTermYears: clamp(Math.round(fin(i.secondTermYears)) || 30, 1, 40),
  };
}

/* ------------------------------------------------------------------ building blocks */

/**
 * Cost of a temporary 2-1 buydown: the sum of the payment differences the seller pre-funds —
 * 12 × (note payment − payment at note−2%) + 12 × (note payment − payment at note−1%).
 * Reduced payments are amortised over the full term (industry convention).
 */
export function buydown21Cost(loan: number, ratePct: number, termMonths = 360): number {
  const p0 = monthlyPayment(loan, ratePct, termMonths);
  const p1 = monthlyPayment(loan, Math.max(0, ratePct - 2), termMonths);
  const p2 = monthlyPayment(loan, Math.max(0, ratePct - 1), termMonths);
  return 12 * (p0 - p1) + 12 * (p0 - p2);
}

/** Discount points (in points, 1 = 1% of the loan) that $`dollars` buys on `loan`. */
export function pointsFromDollars(dollars: number, loan: number): number {
  if (!(loan > 0)) return 0;
  return Math.max(0, fin(dollars)) / loan * 100;
}

/** Note rate after buying `points` at `rateDropPerPoint` % per point (never below 0). */
export function boughtDownRate(ratePct: number, points: number, rateDropPerPoint: number): number {
  return Math.max(0, fin(ratePct) - Math.max(0, fin(points)) * Math.max(0, fin(rateDropPerPoint)));
}

/** Max seller interested-party contribution for a conventional loan by LTV (% of price). */
export function maxConcessionPct(ltv: number): number {
  if (ltv > 90) return 3;
  if (ltv > 75) return 6;
  return 9;
}

export interface Financing {
  downPayment: number;
  firstLoan: number;
  secondLoan: number;
  ltv: number;
  cltv: number;
}

/** Split price into down payment, first lien and (optional) piggyback second. */
export function financing(price: number, downPct: number, secondLoan: boolean, firstLienPct: number): Financing {
  const p = Math.max(0, fin(price));
  const downPayment = (p * clamp(downPct, 0, 100)) / 100;
  const totalLoan = Math.max(0, p - downPayment);
  let firstLoan = totalLoan;
  let second = 0;
  if (secondLoan) {
    firstLoan = Math.min(totalLoan, (p * clamp(firstLienPct, 0, 100)) / 100);
    second = totalLoan - firstLoan;
  }
  return { downPayment, firstLoan, secondLoan: second, ltv: p > 0 ? (firstLoan / p) * 100 : 0, cltv: p > 0 ? (totalLoan / p) * 100 : 0 };
}

/* ------------------------------------------------------------------ option results */

export interface ConcessionOption {
  use: ConcessionUse;
  label: string;
  short: string;
  price: number;
  downPayment: number;
  firstLoan: number;
  secondLoan: number;
  /** Long-term note rate on the first lien. */
  noteRate: number;
  /** Rate the borrower effectively pays in year 1 / year 2. */
  year1Rate: number;
  year2Rate: number;
  points: number;
  buydownCost: number;
  creditApplied: number;
  /** Part of the concession that could not be used (e.g. credit larger than closing costs). */
  unused: number;
  /** Buyer shortfall when the concession doesn't cover the buydown cost. */
  shortfall: number;
  piFirst: number;
  piSecond: number;
  mi: number;
  escrow: number;
  /** Total monthly (P&I + 2nd + MI + tax + ins + HOA), long term (year 3+). */
  monthly: number;
  monthlyYear1: number;
  monthlyYear2: number;
  cashToClose: number;
  /** Borrower's out-of-pocket P&I + 2nd + MI over the holding period. */
  paymentsOverHold: number;
  /** Loan balances remaining at the end of the holding period. */
  balanceAtHold: number;
  /** Cash to close + payments + balance owed at the end of the holding period (T&I excluded — identical for every option). */
  totalCost: number;
}

function sumPayments(monthlyByYear: (y: number) => number, years: number): number {
  let t = 0;
  for (let y = 1; y <= years; y++) t += 12 * monthlyByYear(y);
  return t;
}

/** Evaluate one use of the concession. */
export function evaluateOption(raw: SellerContributionInput, use: ConcessionUse): ConcessionOption {
  const i = normalizeSellerInput(raw);
  const n = i.termYears * 12;
  const n2 = i.secondTermYears * 12;
  const hold = i.holdingYears;
  const X = use === 'none' ? 0 : i.concession;

  const price = use === 'price' ? Math.max(0, i.price - X) : i.price;
  const f = financing(price, i.downPct, i.secondLoan, i.firstLienPct);

  let noteRate = i.ratePct;
  let points = 0;
  let buydownCost = 0;
  let creditApplied = 0;
  let unused = 0;
  let shortfall = 0;
  let y1 = noteRate;
  let y2 = noteRate;

  if (use === 'credit') {
    creditApplied = Math.min(X, i.closingCosts);
    unused = X - creditApplied;
  } else if (use === 'permanent') {
    points = pointsFromDollars(X, f.firstLoan);
    noteRate = boughtDownRate(i.ratePct, points, i.rateDropPerPoint);
    y1 = y2 = noteRate;
  } else if (use === 'temporary') {
    buydownCost = buydown21Cost(f.firstLoan, i.ratePct, n);
    y1 = Math.max(0, i.ratePct - 2);
    y2 = Math.max(0, i.ratePct - 1);
    const excess = X - buydownCost;
    if (excess >= 0) {
      creditApplied = Math.min(excess, i.closingCosts);
      unused = excess - creditApplied;
    } else {
      shortfall = -excess;
    }
  }

  const piFirst = monthlyPayment(f.firstLoan, noteRate, n);
  const piY1 = monthlyPayment(f.firstLoan, y1, n);
  const piY2 = monthlyPayment(f.firstLoan, y2, n);
  const piSecond = monthlyPayment(f.secondLoan, i.secondRatePct, n2);
  const mi = monthlyMi(f.firstLoan, price, i.fico);
  const escrow = i.taxAnnual / 12 + i.insuranceMonthly + i.hoaMonthly;

  const debtByYear = (y: number) => (y === 1 ? piY1 : y === 2 ? piY2 : piFirst) + piSecond + mi;
  const paymentsOverHold = sumPayments(debtByYear, hold);
  const balanceAtHold = balanceAfter(f.firstLoan, noteRate, n, hold * 12) + balanceAfter(f.secondLoan, i.secondRatePct, n2, hold * 12);
  const cashToClose = f.downPayment + i.closingCosts - creditApplied + shortfall;

  const labels: Record<ConcessionUse, [string, string]> = {
    none: ['No concession', 'Baseline'],
    price: ['Price reduction', 'Lower price'],
    credit: ['Closing cost credit', 'Closing credit'],
    permanent: ['Permanent buydown', 'Buy points'],
    temporary: ['Temporary 2-1 buydown', '2-1 buydown'],
  };

  return {
    use,
    label: labels[use][0],
    short: labels[use][1],
    price,
    downPayment: f.downPayment,
    firstLoan: f.firstLoan,
    secondLoan: f.secondLoan,
    noteRate,
    year1Rate: y1,
    year2Rate: y2,
    points,
    buydownCost,
    creditApplied,
    unused,
    shortfall,
    piFirst,
    piSecond,
    mi,
    escrow,
    monthly: piFirst + piSecond + mi + escrow,
    monthlyYear1: piY1 + piSecond + mi + escrow,
    monthlyYear2: piY2 + piSecond + mi + escrow,
    cashToClose,
    paymentsOverHold,
    balanceAtHold,
    totalCost: cashToClose + paymentsOverHold + balanceAtHold,
  };
}

export const CONCESSION_USES: ConcessionUse[] = ['price', 'credit', 'permanent', 'temporary'];

export interface SellerComparison {
  baseline: ConcessionOption;
  options: ConcessionOption[];
  best: { payment: ConcessionUse; year1: ConcessionUse; cash: ConcessionUse; total: ConcessionUse };
  maxConcessionPct: number;
  concessionPct: number;
  overLimit: boolean;
}

function argmin(opts: ConcessionOption[], key: (o: ConcessionOption) => number): ConcessionUse {
  let best = opts[0];
  for (const o of opts) if (key(o) < key(best) - 0.005) best = o;
  return best.use;
}

/** Full comparison of the four uses + baseline + "best option" picks. */
export function compareSellerContribution(raw: SellerContributionInput): SellerComparison {
  const i = normalizeSellerInput(raw);
  const baseline = evaluateOption(i, 'none');
  const options = CONCESSION_USES.map((u) => evaluateOption(i, u));
  const cltv = i.price > 0 ? ((i.price - (i.price * i.downPct) / 100) / i.price) * 100 : 0;
  const maxPct = maxConcessionPct(cltv);
  const concessionPct = i.price > 0 ? (i.concession / i.price) * 100 : 0;
  return {
    baseline,
    options,
    best: {
      payment: argmin(options, (o) => o.monthly),
      year1: argmin(options, (o) => o.monthlyYear1),
      cash: argmin(options, (o) => o.cashToClose),
      total: argmin(options, (o) => o.totalCost),
    },
    maxConcessionPct: maxPct,
    concessionPct,
    overLimit: concessionPct > maxPct + 1e-9,
  };
}

/** Cumulative out-of-pocket (cash to close + payments) at each year end, for the chart. */
export function cumulativeOutOfPocket(raw: SellerContributionInput, use: ConcessionUse, years: number): number[] {
  const o = evaluateOption(raw, use);
  const out: number[] = [];
  let t = o.cashToClose;
  const debtNonFirst = o.piSecond + o.mi;
  const firstByYear = (y: number) => {
    // recompute first-lien payment per year from the option's rates
    const n = Math.max(1, Math.round(fin(raw.termYears)) || 30) * 12;
    const r = y === 1 ? o.year1Rate : y === 2 ? o.year2Rate : o.noteRate;
    return monthlyPayment(o.firstLoan, r, n);
  };
  for (let y = 1; y <= Math.max(1, Math.round(years)); y++) {
    t += 12 * (firstByYear(y) + debtNonFirst);
    out.push(t);
  }
  return out;
}
