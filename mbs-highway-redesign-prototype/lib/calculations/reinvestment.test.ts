import { describe, expect, it } from 'vitest';
import { REINVEST_DEFAULTS, reinvest } from './reinvestment';

describe('reinvest', () => {
  it('spec: $100k + $269/mo @ 6% for 10 yr → ending $226,933, interest $94,653, contributions $132,280', () => {
    const r = reinvest(REINVEST_DEFAULTS);
    expect(Math.round(r.endingBalance)).toBe(226933);
    expect(Math.round(r.interest)).toBe(94653);
    expect(Math.round(r.contributions)).toBe(132280);
    expect(r.periods).toBe(120);
  });
  it('standard end-of-period timing → $226,023', () => {
    expect(Math.round(reinvest({ ...REINVEST_DEFAULTS, timing: 'standard' }).endingBalance)).toBe(226023);
  });
  it('length in months (120) equals 10 years', () => {
    expect(Math.round(reinvest({ ...REINVEST_DEFAULTS, length: 120, lengthUnit: 'months' }).endingBalance)).toBe(226933);
  });
  it('yearly: $10k/yr @ 5% for 3 yr, no lump → $31,525', () => {
    const r = reinvest({ ...REINVEST_DEFAULTS, lumpSum: 0, periodPayment: 10000, frequency: 'yearly', ratePct: 5, length: 3 });
    expect(Math.round(r.endingBalance)).toBe(31525);
    expect(r.contributions).toBe(30000);
  });
  it('quarterly compounding of a lump sum (standard): $10k @ 8% 1 yr → $10,824', () => {
    const r = reinvest({ ...REINVEST_DEFAULTS, lumpSum: 10000, periodPayment: 0, frequency: 'quarterly', ratePct: 8, length: 1, timing: 'standard' });
    expect(Math.round(r.endingBalance)).toBe(10824);
  });
  it('0% rate → balance = contributions; yearly table has start + 10 rows', () => {
    const r = reinvest({ ...REINVEST_DEFAULTS, ratePct: 0 });
    expect(r.endingBalance).toBeCloseTo(132280, 6);
    expect(reinvest(REINVEST_DEFAULTS).yearly).toHaveLength(11);
  });
  it('garbage inputs stay finite', () => {
    const r = reinvest({ ...REINVEST_DEFAULTS, lumpSum: NaN, length: NaN, ratePct: NaN });
    expect(Number.isFinite(r.endingBalance)).toBe(true);
  });
});
