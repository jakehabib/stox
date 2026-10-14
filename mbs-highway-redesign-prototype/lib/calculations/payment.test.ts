import { describe, expect, it } from 'vitest';
import { paymentSchedule, piti } from './payment';

const base = { loanAmount: 400000, termYears: 30, ratePct: 6.5, loanType: 'fixed' as const, ioYears: 10 };

describe('payment (fixed)', () => {
  const r = paymentSchedule(base);
  it('$400k / 6.5% / 30yr → $2,528.27 P&I', () => expect(r.payment).toBeCloseTo(2528.27, 2));
  it('PITI with $700 tax + $150 ins → $3,378.27', () => expect(piti(r.payment, 700, 150)).toBeCloseTo(3378.27, 2));
  it('Yr9: paid 273,024 / interest 220,170 / principal 52,883 / balance 347,117', () => {
    const y = r.years[8];
    expect(Math.round(y.paid)).toBe(273024);
    expect(Math.round(y.interest)).toBe(220170);
    expect(Math.round(y.principal)).toBe(52883);
    expect(Math.round(y.balance)).toBe(347117);
  });
  it('Yr30: paid 910,080 / interest 510,178 / principal 400,000 / balance 0', () => {
    const y = r.years[29];
    expect(r.years).toHaveLength(30);
    expect(Math.round(y.paid)).toBe(910080);
    expect(Math.round(y.interest)).toBe(510178);
    expect(Math.round(y.principal)).toBe(400000);
    expect(y.balance).toBe(0);
    expect(Math.round(r.totalPaidRounded)).toBe(910080);
  });
  it('$300k / 7% / 15yr → $2,696.48', () => expect(paymentSchedule({ ...base, loanAmount: 300000, ratePct: 7, termYears: 15 }).payment).toBeCloseTo(2696.48, 2));
  it('0% and zero/garbage inputs never produce NaN', () => {
    expect(paymentSchedule({ ...base, ratePct: 0 }).payment).toBeCloseTo(1111.11, 2);
    const z = paymentSchedule({ ...base, loanAmount: 0 });
    expect(z.payment).toBe(0);
    expect(z.years).toHaveLength(0);
    const g = paymentSchedule({ ...base, loanAmount: NaN, ratePct: NaN, termYears: NaN });
    expect(Number.isFinite(g.payment)).toBe(true);
  });
});

describe('payment (interest-only)', () => {
  const r = paymentSchedule({ ...base, loanType: 'interest-only', ioYears: 10 });
  it('IO payment = $400k × 6.5% / 12 = $2,166.67', () => expect(r.payment).toBeCloseTo(2166.67, 2));
  it('after 10 IO years amortizes $400k over 20 yr → $2,982.29', () => expect(r.amortizingPayment).toBeCloseTo(2982.29, 2));
  it('balance unchanged through IO period, 0 at end', () => {
    expect(r.years[9].balance).toBeCloseTo(400000, 6);
    expect(r.years[9].principal).toBeCloseTo(0, 6);
    expect(r.years[29].balance).toBe(0);
    expect(Math.round(r.years[29].principal)).toBe(400000);
  });
  it('5-yr IO on $200k @ 6% → $1,000 then $1,288.60', () => {
    const s = paymentSchedule({ loanAmount: 200000, termYears: 30, ratePct: 6, loanType: 'interest-only', ioYears: 5 });
    expect(s.payment).toBeCloseTo(1000, 2);
    expect(s.amortizingPayment).toBeCloseTo(1288.6, 1);
  });
});
