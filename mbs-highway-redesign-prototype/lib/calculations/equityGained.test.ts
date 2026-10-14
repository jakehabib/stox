import { describe, it, expect } from 'vitest';
import { equityChart, equityResult, validateEquity } from './equityGained';

const alex = { price: 500000, locationId: 'dallas-tx-75201', mode: 'forecast' as const, customPct: 4, loanAmount: 400000, ratePct: 6.5, termYears: 30, years: 15 };

describe('equityResult — spec example ($500k, $400k, 6.5% 30yr, Dallas forecast, 15yr)', () => {
  const r = equityResult(alex);
  it('appreciation gained $222,153, amortization $109,763', () => {
    expect(Math.round(r.homeValue)).toBe(722153);
    expect(Math.round(r.appreciation)).toBe(222153);
    expect(Math.round(r.principalPaid)).toBe(109763);
  });
  it('equity after 15yr ≈ $431,917 (incl. $100k down); total gained $331,917', () => {
    expect(r.downPayment).toBe(100000);
    expect(Math.round(r.equity)).toBe(431917);
    expect(Math.round(r.totalGained)).toBe(331917);
    expect(Math.abs(r.totalGained - 331917)).toBeLessThanOrEqual(1);
    expect(r.equity).toBeCloseTo(r.totalGained + r.downPayment, 6);
  });
  it('forecasted 2.48% (effective over 15yr) vs form 2.481%', () => {
    expect(r.effectiveRatePct.toFixed(2)).toBe('2.48');
    expect(r.formRatePct).toBe(2.481);
  });
  it('P&I $2,528.27', () => {
    expect(r.monthlyPI.toFixed(2)).toBe('2528.27');
  });
});

describe('equityChart — reproduces the live chart (balance sampled after payment 12y+1)', () => {
  const pts = equityChart(alex);
  const at = (ys: number[], k: 'homeValue' | 'loanBalance') => ys.map((y) => Math.round(pts[y][k]));
  it('home value 500,000 → 561,846 → 596,940 → 622,058 → 665,342 → 722,153', () => {
    expect(at([0, 3, 6, 9, 12, 15], 'homeValue')).toEqual([500000, 561846, 596940, 622058, 665342, 722153]);
  });
  it('loan balance 399,638 → 385,230 → 367,728 → 346,469 → 320,646 → 289,280', () => {
    expect(at([0, 3, 6, 9, 12, 15], 'loanBalance')).toEqual([399638, 385230, 367728, 346469, 320646, 289280]);
  });
  it('has years 0..N', () => {
    expect(pts).toHaveLength(16);
    expect(equityChart({ ...alex, years: 30 })).toHaveLength(31);
  });
});

describe('other cases & guards', () => {
  it('custom 4%, 9yr matches Buy vs Rent amortization $52,883 / value $711,656', () => {
    const r = equityResult({ ...alex, mode: 'custom', customPct: 4, years: 9 });
    expect(Math.round(r.principalPaid)).toBe(52883);
    expect(Math.round(r.homeValue)).toBe(711656);
  });
  it('past the term the loan is paid off', () => {
    const r = equityResult({ ...alex, termYears: 15, years: 20 });
    expect(r.loanBalance).toBe(0);
    expect(r.principalPaid).toBeCloseTo(400000, 4);
  });
  it('zero / NaN inputs stay finite', () => {
    const r = equityResult({ price: 0, locationId: 'dallas-tx-75201', mode: 'custom', customPct: NaN, loanAmount: NaN, ratePct: NaN, termYears: 0, years: 0 });
    for (const v of Object.values(r)) expect(Number.isFinite(v)).toBe(true);
    for (const p of equityChart({ ...alex, ratePct: 0, years: 30 })) expect(Number.isFinite(p.loanBalance)).toBe(true);
  });
  it('validation', () => {
    const ok = { clientId: 'c-alex-rivera', price: 500000, loanAmount: 400000, ratePct: 6.5, mode: 'forecast' as const, customPct: 4 };
    expect(validateEquity(ok)).toEqual({});
    expect(validateEquity({ ...ok, clientId: null }).client).toBe('Client name is required');
    expect(validateEquity({ ...ok, loanAmount: 600000 }).loanAmount).toBeTruthy();
  });
});
