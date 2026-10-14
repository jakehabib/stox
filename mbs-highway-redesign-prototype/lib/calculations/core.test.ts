import { describe, expect, it } from 'vitest';
import { amortize, apr, balanceAfter, cagr, loanFromPayment, monthlyPayment, paidOver, paymentSplit, yearlySummary } from './core';
import { projectValues, valueAtYear } from './appreciation';

describe('monthlyPayment', () => {
  it('$400k @ 6.5% / 30yr = $2,528.27', () => expect(monthlyPayment(400000, 6.5, 360)).toBeCloseTo(2528.27, 2));
  it('$400k @ 6.125% / 30yr = $2,430.44', () => expect(monthlyPayment(400000, 6.125, 360)).toBeCloseTo(2430.44, 2));
  it('0% rate divides evenly ($1,111.11)', () => expect(monthlyPayment(400000, 0, 360)).toBeCloseTo(1111.11, 2));
  it('inverse: loanFromPayment', () => expect(loanFromPayment(monthlyPayment(400000, 6.5, 360), 6.5, 360)).toBeCloseTo(400000, 4));
});

describe('balances & amortization', () => {
  it('9 years → balance $347,117', () => expect(Math.round(balanceAfter(400000, 6.5, 360, 108))).toBe(347117));
  it('7 years → balance $361,665, principal $38,335, interest $174,040', () => {
    expect(Math.round(balanceAfter(400000, 6.5, 360, 84))).toBe(361665);
    const p = paidOver(400000, 6.5, 360, 84);
    expect(Math.round(p.principal)).toBe(38335);
    expect(Math.round(p.interest)).toBe(174040);
  });
  it('payment 84 split: principal $566 / interest $1,962', () => {
    const s = paymentSplit(400000, 6.5, 360, 84);
    expect(Math.round(s.principal)).toBe(566);
    expect(Math.round(s.interest)).toBe(1962);
  });
  it('schedule pays off exactly and matches closed form', () => {
    const rows = amortize(400000, 6.5, 360);
    expect(rows).toHaveLength(360);
    expect(rows[359].balance).toBeLessThan(0.01);
    expect(rows[107].balance).toBeCloseTo(balanceAfter(400000, 6.5, 360, 108), 4);
  });
  it('yearly summary: Yr9 paid $273,024 (rounded payment), interest $220,170; Yr30 interest $510,178', () => {
    const y = yearlySummary(400000, 6.5, 360, true);
    expect(Math.round(y[8].paid)).toBe(273024);
    expect(Math.round(y[8].interest)).toBe(220170);
    expect(Math.round(y[8].principal)).toBe(52883);
    expect(Math.round(y[29].paid)).toBe(910080);
    expect(Math.round(y[29].interest)).toBe(510178);
  });
});

describe('apr', () => {
  it('no fees → APR equals note rate', () => expect(apr(400000, 6.5, 360, 0)).toBe(6.5));
  it('fees raise APR', () => expect(apr(400000, 6.5, 360, 5000)).toBeGreaterThan(6.6));
});

describe('appreciation curve (Dallas forecast)', () => {
  it('matches observed values', () => {
    const v = projectValues(500000, 'dallas-tx-75201', { mode: 'forecast' }, 15).map(Math.round);
    expect(v[1]).toBe(522351);
    expect(v[7]).toBe(604686);
    expect(v[10]).toBe(634338);
    expect(v[15]).toBe(722153);
  });
  it('custom 4% for 9 years = $711,656', () => expect(Math.round(valueAtYear(500000, 'dallas-tx-75201', { mode: 'custom', customPct: 4 }, 9))).toBe(711656));
  it('10-yr forecast CAGR is 2.41%', () => expect(cagr(500000, 634338, 10)).toBeCloseTo(2.41, 2));
});
