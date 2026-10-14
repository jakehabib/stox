import { describe, expect, it } from 'vitest';
import { bahAllowance } from '@/data/mock/buyVsRent';
import { calcBuyVsRent, defaultRepairsMonthly, federalMarginalRate, priceForMonthlyPayment, rescaleForPrice, STANDARD_DEDUCTION, type BuyVsRentInput } from './buyVsRent';

/** The spec FINAL EXAMPLE (Alex Rivera, Dallas). */
const FINAL: BuyVsRentInput = {
  locationId: 'dallas-tx-75201',
  price: 500000,
  loanAmount: 400000,
  ratePct: 6.5,
  termYears: 30,
  miMonthly: 0,
  closingCosts: 10000,
  pointsPct: 0,
  taxAnnual: 8400,
  taxIncreasePct: 2,
  insuranceMonthly: 150,
  hoaMonthly: 0,
  repairsMonthly: defaultRepairsMonthly(500000),
  costToSellPct: 4,
  appreciation: { mode: 'custom', customPct: 4 },
  rentMonthly: 2800,
  rentersInsuranceMonthly: 55,
  rentIncreasePct: 3,
  federalPct: 22,
  statePct: 0,
  standardDeduction: 32200,
  includeTaxBenefit: true,
};

const r = calcBuyVsRent(FINAL);
const y9 = r.years[8];
const R = Math.round;

describe('Buy vs Rent — spec FINAL EXAMPLE', () => {
  it('P&I $2,528 and repairs $208/mo', () => {
    expect(R(r.piMonthly)).toBe(2528);
    expect(R(FINAL.repairsMonthly)).toBe(208);
  });
  it('Year 9 net gain $183,193 and its components', () => {
    expect(R(y9.netGain)).toBe(183193);
    expect(R(y9.appreciationGain)).toBe(211656);
    expect(R(y9.value)).toBe(711656);
    expect(R(y9.closing)).toBe(10000);
    expect(R(y9.cumTaxBenefit)).toBe(2708);
    expect(R(y9.principalPaid)).toBe(52883);
    expect(R(y9.balance)).toBe(347117);
    expect(R(y9.cashflowDiff)).toBe(-45588);
    expect(R(y9.costToSell)).toBe(28466);
  });
  it('totals over 9 years: renting $348,060, buying $393,648', () => {
    expect(y9.cumRenting).toBe(348060);
    expect(y9.cumBuying).toBe(393648);
  });
  it('yearly tax benefit 455,426,394,357,316,271,221,165,104', () => {
    expect(r.years.map((y) => R(y.taxBenefit))).toEqual([455, 426, 394, 357, 316, 271, 221, 165, 104]);
  });
  it('chart: net gain Yr1..Yr9', () => {
    expect(r.years.map((y) => R(y.netGain))).toEqual([-14646, 2610, 21828, 43106, 66505, 92130, 120050, 150371, 183193]);
  });
  it('break-even during Year 2', () => expect(r.breakEvenYear).toBe(2));
  it('table Yr1: buying 3586 = 384 + 2145 + 1058 (700+150+208) vs rent 2855 (2800+55)', () => {
    const y = r.years[0];
    expect(y.buyMonthly).toBe(3586);
    expect(R(y.principalMonthly)).toBe(384);
    expect(R(y.interestMonthly)).toBe(2145);
    expect(R(y.otherMonthly)).toBe(1058);
    expect(R(y.taxMonthly)).toBe(700);
    expect(y.rentMonthly).toBe(2855);
    expect(R(y.rentOnlyMonthly)).toBe(2800);
    expect(R(y.rentersInsMonthly)).toBe(55);
  });
  it('table Yr5: buying 3644 (497+2031+1116) vs rent 3213 (3151+62)', () => {
    const y = r.years[4];
    expect(y.buyMonthly).toBe(3644);
    expect(R(y.principalMonthly)).toBe(497);
    expect(R(y.interestMonthly)).toBe(2031);
    expect(R(y.otherMonthly)).toBe(1116);
    expect(y.rentMonthly).toBe(3213);
    expect(R(y.rentOnlyMonthly)).toBe(3151);
    expect(R(y.rentersInsMonthly)).toBe(62);
  });
  it('table Yr9: buying 3706 (645+1884+1178) vs rent 3617 (3547+70)', () => {
    const y = r.years[8];
    expect(y.buyMonthly).toBe(3706);
    expect(R(y.principalMonthly)).toBe(645);
    expect(R(y.interestMonthly)).toBe(1884);
    expect(R(y.otherMonthly)).toBe(1178);
    expect(y.rentMonthly).toBe(3617);
    expect(R(y.rentOnlyMonthly)).toBe(3547);
    expect(R(y.rentersInsMonthly)).toBe(70);
  });
  it('horizon is capped at 9 years (no 10-year option)', () => {
    expect(calcBuyVsRent(FINAL, 10).years).toHaveLength(9);
    expect(calcBuyVsRent(FINAL, 3).years).toHaveLength(3);
  });
});

describe('Buy vs Rent — behaviour & guards', () => {
  it('no tax benefit when deductions stay under the standard deduction', () => {
    const x = calcBuyVsRent({ ...FINAL, standardDeduction: 60000 });
    expect(x.years.every((y) => y.taxBenefit === 0)).toBe(true);
  });
  it('excluding the tax benefit lowers Year 9 by exactly $2,708', () => {
    const x = calcBuyVsRent({ ...FINAL, includeTaxBenefit: false });
    expect(R(y9.netGain - x.years[8].netGain)).toBe(2708);
  });
  it('higher rent → buying wins by more', () => {
    expect(calcBuyVsRent({ ...FINAL, rentMonthly: 3500 }).years[8].netGain).toBeGreaterThan(y9.netGain);
  });
  it('points add to purchase closing', () => {
    expect(calcBuyVsRent({ ...FINAL, pointsPct: 1 }).totalClosing).toBe(14000);
  });
  it('zero / empty / huge inputs never produce NaN', () => {
    const zero = calcBuyVsRent({ ...FINAL, price: 0, loanAmount: 0, ratePct: 0, rentMonthly: 0, taxAnnual: 0 });
    const huge = calcBuyVsRent({ ...FINAL, price: 1e12, loanAmount: 1e12, ratePct: 99, rentMonthly: 1e9 });
    const nan = calcBuyVsRent({ ...FINAL, price: NaN, loanAmount: NaN, ratePct: NaN, termYears: NaN });
    for (const res of [zero, huge, nan]) for (const y of res.years) for (const v of Object.values(y)) expect(Number.isFinite(v)).toBe(true);
  });
  it('forecast mode uses the Dallas forecast curve ($500k → $622,058 in year 9)', () => {
    const x = calcBuyVsRent({ ...FINAL, appreciation: { mode: 'forecast' } });
    expect(R(x.years[8].value)).toBe(622058);
  });
});

describe('Desired Monthly Payment back-solve', () => {
  const a = { ltvPct: 80, ratePct: 6.5, termYears: 30, taxRatePct: 1.68, repairsPctPerYear: 0.5, insuranceMonthly: 150, hoaMonthly: 0, miMonthly: 0 };
  it('$3,586.60/mo total → ~$500,000 price', () => {
    expect(Math.abs(priceForMonthlyPayment(3586.6, a) - 500000)).toBeLessThan(10);
  });
  it('$3,000/mo → $414,653 ((3000−150) ÷ 0.0068733); payment under fixed costs → 0', () => {
    expect(priceForMonthlyPayment(3000, a)).toBe(414653);
    expect(priceForMonthlyPayment(100, a)).toBe(0);
  });
});

describe('helpers', () => {
  it('federal marginal rate (2026 brackets)', () => {
    expect(federalMarginalRate(150000, 'mfj')).toBe(22);
    expect(federalMarginalRate(60000, 'mfj')).toBe(12);
    expect(federalMarginalRate(150000, 'single')).toBe(24);
    expect(federalMarginalRate(0, 'single')).toBe(0);
  });
  it('standard deduction MFJ $32,200', () => expect(STANDARD_DEDUCTION.mfj).toBe(32200));
  it('rescaleForPrice keeps ratios ($600k → loan $480k, closing $12k, tax $10,080, repairs $250)', () => {
    const s = rescaleForPrice(FINAL, 600000);
    expect(s.loanAmount).toBe(480000);
    expect(s.closingCosts).toBe(12000);
    expect(s.taxAnnual).toBe(10080);
    expect(R(s.repairsMonthly)).toBe(250);
  });
  it('BAH lookup', () => {
    expect(bahAllowance('dallas-tx', 'E-5', true)).toBe(2511);
    expect(bahAllowance('dallas-tx', 'E-5', false)).toBeLessThan(2511);
  });
});
