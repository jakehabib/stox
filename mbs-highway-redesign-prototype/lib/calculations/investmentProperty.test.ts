import { describe, expect, it } from 'vitest';
import { calcInvestment, capRate, cashOnCash, dscr, grm, INVESTMENT_DEFAULTS as D, irr, onePercentRule } from './investmentProperty';

/* Step 2+ is INFERRED (not observed live). Known textbook cases + the demo default scenario. */
const r = Math.round;

describe('ratio definitions (known cases)', () => {
  it('cap rate: $30k NOI / $500k = 6%; $18k / $300k = 6%', () => {
    expect(capRate(30000, 500000)).toBeCloseTo(6, 10);
    expect(capRate(18000, 300000)).toBeCloseTo(6, 10);
  });
  it('cash-on-cash: $10k / $125k = 8%; −$2k / $100k = −2%', () => {
    expect(cashOnCash(10000, 125000)).toBeCloseTo(8, 10);
    expect(cashOnCash(-2000, 100000)).toBeCloseTo(-2, 10);
  });
  it('DSCR: 36k / 30k = 1.2; 25k / 25k = 1.0', () => {
    expect(dscr(36000, 30000)).toBeCloseTo(1.2, 10);
    expect(dscr(25000, 25000)).toBe(1);
  });
  it('GRM: $500k / $48k = 10.42; $300k / $36k = 8.33', () => {
    expect(grm(500000, 48000).toFixed(2)).toBe('10.42');
    expect(grm(300000, 36000).toFixed(2)).toBe('8.33');
  });
  it('1% rule', () => {
    expect(onePercentRule(5000, 500000)).toBe(true);
    expect(onePercentRule(4200, 500000)).toBe(false);
  });
  it('IRR: [−100, 110] = 10%; [−1000, 100, 100, 1100] = 10%', () => {
    expect(irr([-100, 110])!).toBeCloseTo(10, 6);
    expect(irr([-1000, 100, 100, 1100])!).toBeCloseTo(10, 6);
    expect(irr([100, 100])).toBeNull();
  });
});

describe('default scenario — $500k Dallas, 25% down @ 7%, rent $4,200', () => {
  const a = calcInvestment(D);
  it('cash invested $140,000 = $125k down + $15k closing; P&I $2,495', () => {
    expect(a.cashInvested).toBe(140000);
    expect(r(a.monthlyPI)).toBe(2495);
  });
  it('EGI $47,880, opex $20,176, NOI $27,704, cap rate 5.54%', () => {
    expect(r(a.year1.egi)).toBe(47880);
    expect(r(a.year1.opex)).toBe(20176);
    expect(r(a.noi)).toBe(27704);
    expect(a.capRatePct.toFixed(2)).toBe('5.54');
  });
  it('cash flow −$186/mo (−$2,235/yr), CoC −1.60%, DSCR 0.93, GRM 9.92, fails 1% rule', () => {
    expect(r(a.cashFlowMonthly)).toBe(-186);
    expect(r(a.cashFlowAnnual)).toBe(-2235);
    expect(a.cashOnCashPct.toFixed(2)).toBe('-1.60');
    expect(a.dscr.toFixed(2)).toBe('0.93');
    expect(a.grm.toFixed(2)).toBe('9.92');
    expect(a.onePercent).toBe(false);
  });
  it('break-even rent $4,441/mo zeroes year-1 cash flow', () => {
    expect(r(a.breakEvenRent)).toBe(4441);
    expect(Math.abs(calcInvestment({ ...D, monthlyRent: a.breakEvenRent }).cashFlowAnnual)).toBeLessThan(0.01);
  });
  it('10-yr projection on the Dallas forecast curve: value $589,480 (yr5) / $634,338 (yr10), IRR 7.77%', () => {
    expect(r(a.projection[4].value)).toBe(589480);
    expect(r(a.projection[9].value)).toBe(634338);
    expect(a.irrPct!.toFixed(2)).toBe('7.77');
    expect(a.projection[3].cashFlow).toBeGreaterThan(0);
  });
  it('more rent → more cash flow; more down → lower debt service', () => {
    expect(calcInvestment({ ...D, monthlyRent: 5000 }).cashFlowAnnual).toBeGreaterThan(a.cashFlowAnnual);
    expect(calcInvestment({ ...D, downPct: 40 }).annualDebtService).toBeLessThan(a.annualDebtService);
  });
  it('no NaN on zero inputs', () => {
    const z = calcInvestment({ ...D, price: 0, monthlyRent: 0, ratePct: 0, termYears: 0, holdYears: 0 });
    for (const v of [z.capRatePct, z.cashOnCashPct, z.dscr, z.grm, z.breakEvenRent, z.equityMultiple, z.cashFlowMonthly]) expect(Number.isFinite(v)).toBe(true);
    expect(z.projection.length).toBe(1);
  });
});
