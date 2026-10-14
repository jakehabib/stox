import { describe, expect, it } from 'vitest';
import { ARM_DEFAULTS, armRatePath, simulateArmVsFixed } from './armVsFixed';

const R = (n: number) => Math.round(n);

describe('ARM vs Fixed — worst case 7/1, cash in hand', () => {
  const r = simulateArmVsFixed(ARM_DEFAULTS);
  it('Fixed $2,528 vs ARM $2,271 → save $257/mo yrs 1–7', () => {
    expect(R(r.fixedPayment)).toBe(2528);
    expect(R(r.armInitialPayment)).toBe(2271);
    expect(R(r.initialMonthlySavings)).toBe(257);
    expect(r.years.slice(0, 7).every((y) => R(y.monthlyDiff) === 257)).toBe(true);
  });
  it('Yr7 total $27,999 = cashflow $21,598 + principal $6,401', () => {
    expect(R(r.atFixedEnd.total)).toBe(27999);
    expect(R(r.atFixedEnd.cashflow)).toBe(21598);
    expect(R(r.atFixedEnd.principalGained)).toBe(6401);
  });
  it('break-even month 109 = 9y 1m', () => expect(r.breakEvenMonth).toBe(109));
  it('Yr8: ARM 10.5%, P&I $3,417 (+$1,146), total savings $14,181, balances 354,627 vs 351,377', () => {
    const y = r.years[7];
    expect(y.armRate).toBe(10.5);
    expect(R(y.armPayment)).toBe(3417);
    expect(R(y.armPaymentChange)).toBe(1146);
    expect(R(y.total)).toBe(14181);
    expect(R(y.fixedBalance)).toBe(354627);
    expect(R(y.armBalance)).toBe(351377);
  });
  it('Yr9 ARM 347,062 vs fixed 347,117 (+$55); Yr10 ARM 342,271 vs fixed 339,105', () => {
    expect(R(r.years[8].armBalance)).toBe(347062);
    expect(R(r.years[8].fixedBalance)).toBe(347117);
    expect(R(r.years[8].principalGained)).toBe(55);
    expect(R(r.years[9].armBalance)).toBe(342271);
    expect(R(r.years[9].fixedBalance)).toBe(339105);
  });
  it('30-yr interest: fixed $510,178, ARM worst case $733,914; true totals paid 910,178 / 1,133,914', () => {
    expect(R(r.totals.fixedInterest)).toBe(510178);
    expect(R(r.totals.armInterest)).toBe(733914);
    expect(R(r.totals.fixedPaid)).toBe(910178);
    expect(R(r.totals.armPaid)).toBe(1133914);
  });
});

describe('ARM vs Fixed — reinvest to principal', () => {
  const r = simulateArmVsFixed({ ...ARM_DEFAULTS, reinvest: true });
  it('total at month 84 = $32,673 (no cashflow), break-even month 120 = 10y 0m', () => {
    expect(R(r.atFixedEnd.total)).toBe(32673);
    expect(R(r.atFixedEnd.cashflow)).toBe(0);
    expect(r.breakEvenMonth).toBe(120);
  });
});

describe('ARM rate paths', () => {
  it('worst case 5/2/5 from 5.5%: 5.5 ×84 then 10.5 for the rest', () => {
    const p = armRatePath(ARM_DEFAULTS);
    expect(p[83]).toBe(5.5);
    expect(p[84]).toBe(10.5);
    expect(p[359]).toBe(10.5);
  });
  it('worst case 2/2/5 climbs by 2 then hits lifetime cap', () => {
    const p = armRatePath({ ...ARM_DEFAULTS, fixedYears: 5, caps: { initial: 2, periodic: 2, lifetime: 5 } });
    expect([p[59], p[60], p[72], p[84]]).toEqual([5.5, 7.5, 9.5, 10.5]);
  });
  it('best case drops to the floor (margin 2.75%)', () => {
    const p = armRatePath({ ...ARM_DEFAULTS, scenario: 'best', caps: { initial: 2, periodic: 2, lifetime: 5 } });
    expect([p[84], p[96]]).toEqual([3.5, 2.75]);
    const r = simulateArmVsFixed({ ...ARM_DEFAULTS, scenario: 'best' });
    expect(r.breakEvenMonth).toBeNull();
  });
  it('6-month adjustments step every 6 months', () => {
    const p = armRatePath({ ...ARM_DEFAULTS, adjustMonths: 6, caps: { initial: 1, periodic: 1, lifetime: 5 } });
    expect([p[84], p[90], p[96]]).toEqual([6.5, 7.5, 8.5]);
  });
  it('custom target moves toward 7.5% and holds', () => {
    const p = armRatePath({ ...ARM_DEFAULTS, scenario: 'custom', customTargetRate: 7.5, caps: { initial: 1, periodic: 1, lifetime: 5 } });
    expect([p[84], p[96], p[108]]).toEqual([6.5, 7.5, 7.5]);
  });
  it('ARM rate ≥ fixed → ARM never ahead; garbage stays finite', () => {
    const n = simulateArmVsFixed({ ...ARM_DEFAULTS, armRate: 7 });
    expect(n.armNeverAhead).toBe(true);
    expect(n.breakEvenMonth).toBeNull();
    const g = simulateArmVsFixed({ ...ARM_DEFAULTS, loanAmount: NaN, armRate: NaN });
    expect(Number.isFinite(g.fixedPayment)).toBe(true);
  });
});
