/**
 * Investment Property Analyzer.
 *
 * Step 1 (Location + Price) is faithful to the live tool. Step 2+ (financing, income,
 * expenses, returns) is INFERRED — the live session never got past Step 1 — and uses the
 * standard rental-analysis definitions:
 *
 *   Gross scheduled income = (rent + other income) × 12
 *   Effective gross income (EGI) = gross × (1 − vacancy)
 *   Operating expenses = taxes + insurance + HOA + utilities + management (% of EGI)
 *                        + maintenance & capex reserves (% of gross scheduled rent)
 *   NOI = EGI − operating expenses          Cap rate = NOI / price
 *   Cash flow = NOI − annual debt service   Cash-on-cash = cash flow / cash invested
 *   DSCR = NOI / debt service               GRM = price / gross annual rent
 *   1% rule: monthly rent ≥ 1% of price
 * Projection: value follows the location appreciation setting (same curve as the other
 * tools), rent grows at rent growth, fixed expenses at expense growth. IRR uses sale at the
 * end of the hold net of selling costs and loan payoff.
 */
import { getLocation } from '@/data/mock/locations';
import { valueAtYear, type AppreciationSetting } from './appreciation';
import { balanceAfter, monthlyPayment } from './core';

export interface InvestmentInput {
  clientId: string | null;
  locationId: string;
  price: number;
  /* financing */
  downPct: number;
  ratePct: number;
  termYears: number;
  closingPct: number;
  /* income (monthly) */
  monthlyRent: number;
  otherIncome: number;
  vacancyPct: number;
  /* expenses */
  taxAnnual: number;
  insuranceMonthly: number;
  hoaMonthly: number;
  utilitiesMonthly: number;
  managementPct: number;
  maintenancePct: number;
  capexPct: number;
  /* projection */
  appreciation: AppreciationSetting;
  rentGrowthPct: number;
  expenseGrowthPct: number;
  holdYears: number;
  sellingCostPct: number;
}

export const INVESTMENT_DEFAULTS: InvestmentInput = {
  clientId: 'c-alex-rivera',
  locationId: 'dallas-tx-75201',
  price: 500000,
  downPct: 25,
  ratePct: 7.0,
  termYears: 30,
  closingPct: 3,
  monthlyRent: 4200,
  otherIncome: 0,
  vacancyPct: 5,
  taxAnnual: 9206,
  insuranceMonthly: 175,
  hoaMonthly: 0,
  utilitiesMonthly: 0,
  managementPct: 8,
  maintenancePct: 5,
  capexPct: 5,
  appreciation: { mode: 'forecast' },
  rentGrowthPct: 3,
  expenseGrowthPct: 2.5,
  holdYears: 10,
  sellingCostPct: 6,
};

const nn = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
const safeDiv = (a: number, b: number) => (b !== 0 && Number.isFinite(a / b) ? a / b : 0);

/* ---------------------------------------------------------------- ratio helpers */

export const capRate = (noi: number, price: number) => safeDiv(noi, price) * 100;
export const cashOnCash = (annualCashFlow: number, cashInvested: number) => safeDiv(annualCashFlow, cashInvested) * 100;
export const dscr = (noi: number, annualDebtService: number) => safeDiv(noi, annualDebtService);
export const grm = (price: number, grossAnnualRent: number) => safeDiv(price, grossAnnualRent);
export const onePercentRule = (monthlyRent: number, price: number) => price > 0 && monthlyRent >= price * 0.01;

/** Internal rate of return (percent) for periodic cash flows; null if it has no root in (−99%, 1000%). */
export function irr(flows: number[]): number | null {
  if (flows.length < 2 || !flows.some((f) => f < 0) || !flows.some((f) => f > 0)) return null;
  const npv = (r: number) => flows.reduce((s, f, t) => s + f / Math.pow(1 + r, t), 0);
  let lo = -0.99;
  let hi = 10;
  let flo = npv(lo);
  const fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (fm * flo > 0) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return ((lo + hi) / 2) * 100;
}

/* ---------------------------------------------------------------- year-one analysis */

export interface OperatingYear {
  grossRent: number;
  grossOther: number;
  grossIncome: number;
  vacancyLoss: number;
  egi: number;
  tax: number;
  insurance: number;
  hoa: number;
  utilities: number;
  management: number;
  maintenance: number;
  capex: number;
  opex: number;
  noi: number;
}

function operatingYear(i: InvestmentInput, rentMonthly: number, otherMonthly: number, fixedGrowth: number): OperatingYear {
  const grossRent = nn(rentMonthly) * 12;
  const grossOther = nn(otherMonthly) * 12;
  const grossIncome = grossRent + grossOther;
  const vacancyLoss = (grossIncome * Math.min(100, nn(i.vacancyPct))) / 100;
  const egi = grossIncome - vacancyLoss;
  const tax = nn(i.taxAnnual) * fixedGrowth;
  const insurance = nn(i.insuranceMonthly) * 12 * fixedGrowth;
  const hoa = nn(i.hoaMonthly) * 12 * fixedGrowth;
  const utilities = nn(i.utilitiesMonthly) * 12 * fixedGrowth;
  const management = (egi * nn(i.managementPct)) / 100;
  const maintenance = (grossRent * nn(i.maintenancePct)) / 100;
  const capex = (grossRent * nn(i.capexPct)) / 100;
  const opex = tax + insurance + hoa + utilities + management + maintenance + capex;
  return { grossRent, grossOther, grossIncome, vacancyLoss, egi, tax, insurance, hoa, utilities, management, maintenance, capex, opex, noi: egi - opex };
}

export interface ProjectionYear {
  year: number;
  value: number;
  rentMonthly: number;
  noi: number;
  debtService: number;
  cashFlow: number;
  cumulativeCashFlow: number;
  loanBalance: number;
  equity: number;
  /** Net if sold at the end of this year (value − selling costs − loan). */
  saleNet: number;
  /** Cumulative cash flow + sale net − cash invested. */
  totalReturn: number;
}

export interface InvestmentResult {
  loanAmount: number;
  downPayment: number;
  closingCosts: number;
  cashInvested: number;
  monthlyPI: number;
  annualDebtService: number;
  year1: OperatingYear;
  noi: number;
  capRatePct: number;
  cashFlowAnnual: number;
  cashFlowMonthly: number;
  cashOnCashPct: number;
  dscr: number;
  grm: number;
  onePercent: boolean;
  rentToPricePct: number;
  /** Monthly rent at which year-1 cash flow is $0 (other inputs unchanged). */
  breakEvenRent: number;
  expenseRatioPct: number;
  projection: ProjectionYear[];
  irrPct: number | null;
  equityMultiple: number;
}

export function calcInvestment(i: InvestmentInput): InvestmentResult {
  const price = nn(i.price);
  const downPct = Math.min(100, nn(i.downPct));
  const downPayment = (price * downPct) / 100;
  const loanAmount = price - downPayment;
  const closingCosts = (price * nn(i.closingPct)) / 100;
  const cashInvested = downPayment + closingCosts;
  const n = Math.max(1, Math.round(nn(i.termYears) * 12) || 360);
  const rate = nn(i.ratePct);
  const monthlyPI = monthlyPayment(loanAmount, rate, n);
  const annualDebtService = monthlyPI * 12;

  const year1 = operatingYear(i, i.monthlyRent, i.otherIncome, 1);
  const noi = year1.noi;
  const cashFlowAnnual = noi - annualDebtService;

  // Break-even rent: cash flow is linear in rent.
  const v = Math.min(100, nn(i.vacancyPct)) / 100;
  const perRentDollar = 12 * ((1 - v) * (1 - nn(i.managementPct) / 100) - (nn(i.maintenancePct) + nn(i.capexPct)) / 100);
  const otherNet = nn(i.otherIncome) * 12 * (1 - v) * (1 - nn(i.managementPct) / 100);
  const fixed = year1.tax + year1.insurance + year1.hoa + year1.utilities;
  const breakEvenRent = perRentDollar > 0 ? Math.max(0, (annualDebtService + fixed - otherNet) / perRentDollar) : 0;

  const hold = Math.max(1, Math.min(30, Math.round(nn(i.holdYears)) || 1));
  const loc = getLocation(i.locationId);
  const projection: ProjectionYear[] = [];
  let cumulative = 0;
  for (let y = 1; y <= hold; y++) {
    const rg = Math.pow(1 + (Number.isFinite(i.rentGrowthPct) ? i.rentGrowthPct : 0) / 100, y - 1);
    const eg = Math.pow(1 + (Number.isFinite(i.expenseGrowthPct) ? i.expenseGrowthPct : 0) / 100, y - 1);
    const op = operatingYear(i, nn(i.monthlyRent) * rg, nn(i.otherIncome) * rg, eg);
    const debtService = y * 12 <= n ? annualDebtService : Math.max(0, n - (y - 1) * 12) * monthlyPI;
    const cashFlow = op.noi - debtService;
    cumulative += cashFlow;
    const value = valueAtYear(price, loc, i.appreciation, y);
    const loanBalance = balanceAfter(loanAmount, rate, n, y * 12);
    const saleNet = value * (1 - nn(i.sellingCostPct) / 100) - loanBalance;
    projection.push({
      year: y,
      value,
      rentMonthly: nn(i.monthlyRent) * rg,
      noi: op.noi,
      debtService,
      cashFlow,
      cumulativeCashFlow: cumulative,
      loanBalance,
      equity: value - loanBalance,
      saleNet,
      totalReturn: cumulative + saleNet - cashInvested,
    });
  }
  const flows = [-cashInvested, ...projection.map((p, k) => p.cashFlow + (k === projection.length - 1 ? p.saleNet : 0))];
  const last = projection[projection.length - 1];

  return {
    loanAmount,
    downPayment,
    closingCosts,
    cashInvested,
    monthlyPI,
    annualDebtService,
    year1,
    noi,
    capRatePct: capRate(noi, price),
    cashFlowAnnual,
    cashFlowMonthly: cashFlowAnnual / 12,
    cashOnCashPct: cashOnCash(cashFlowAnnual, cashInvested),
    dscr: dscr(noi, annualDebtService),
    grm: grm(price, year1.grossRent),
    onePercent: onePercentRule(nn(i.monthlyRent), price),
    rentToPricePct: safeDiv(nn(i.monthlyRent), price) * 100,
    breakEvenRent,
    expenseRatioPct: safeDiv(year1.opex, year1.egi) * 100,
    projection,
    irrPct: irr(flows),
    equityMultiple: cashInvested > 0 ? safeDiv(last.cumulativeCashFlow + last.saleNet, cashInvested) : 0,
  };
}
