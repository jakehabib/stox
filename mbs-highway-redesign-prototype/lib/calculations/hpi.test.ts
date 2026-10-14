import { describe, expect, it } from 'vitest';
import { getHpiState, HPI_DIVISIONS, HPI_NATIONAL, HPI_STATES, NJ_OBSERVED_LABEL } from '@/data/mock/hpi';
import { binIndex, comparisonLabel, indexSeries, periodValue, rankOf, relativeToNational, SERIES_LENGTH, quarterLabel, windowRebased } from './hpi';

describe('HPI spec values', () => {
  it('national quarterly avg 0.35%, 1-year 2.14%', () => {
    expect(periodValue(HPI_NATIONAL, 'quarter')).toBe(0.35);
    expect(periodValue(HPI_NATIONAL, 'year1')).toBe(2.14);
  });
  it('NJ quarterly 1.03%, 1-year 4.59%', () => {
    const nj = getHpiState('NJ');
    expect(periodValue(nj, 'quarter')).toBe(1.03);
    expect(periodValue(nj, 'year1')).toBe(4.59);
  });
  it('NJ keeps the observed "20% above national avg" label in both views (preserved)', () => {
    expect(comparisonLabel('NJ', 1.03, 0.35, 'quarter')).toBe('20% above national avg');
    expect(comparisonLabel('NJ', 4.59, 2.14, 'year1')).toBe(NJ_OBSERVED_LABEL);
  });
  it('…which the numbers do not support (documented discrepancy)', () => {
    expect(Math.round(relativeToNational(1.03, 0.35))).toBe(194);
    expect(Math.round(relativeToNational(4.59, 2.14))).toBe(114);
  });
  it('other states get a computed points label', () => {
    expect(comparisonLabel('CT', 1.12, 0.35, 'quarter')).toBe('0.77 pts above national avg');
    expect(comparisonLabel('FL', -1.8, 2.14, 'year1')).toBe('3.94 pts below national avg');
    expect(comparisonLabel('NJ', 46.8, 33.4, 'year5')).toBe('13.40 pts above national avg');
  });
});

describe('HPI dataset', () => {
  it('50 states + DC, unique codes, 9 census divisions', () => {
    expect(HPI_STATES).toHaveLength(51);
    expect(new Set(HPI_STATES.map((s) => s.code)).size).toBe(51);
    expect(HPI_DIVISIONS).toHaveLength(9);
    for (const d of HPI_DIVISIONS) expect(HPI_STATES.some((s) => s.division === d.id)).toBe(true);
  });
  it('NJ ranks in the top 10 for 1-year; FL ranks last', () => {
    expect(rankOf(HPI_STATES, 'NJ', 'year1')).toBeLessThanOrEqual(10);
    expect(rankOf(HPI_STATES, 'FL', 'year1')).toBe(51);
    expect(rankOf(HPI_STATES, 'ZZ', 'year1')).toBe(0);
  });
});

describe('index series', () => {
  it('runs 1991 Q1 → 2026 Q2', () => {
    expect(SERIES_LENGTH).toBe(142);
    expect(quarterLabel(0)).toBe('1991 Q1');
    expect(quarterLabel(SERIES_LENGTH - 1)).toBe('2026 Q2');
  });
  for (const [label, s] of [['national', HPI_NATIONAL], ['NJ', getHpiState('NJ')], ['FL', getHpiState('FL')]] as const) {
    it(`reproduces ${label} stats exactly`, () => {
      const x = indexSeries(s);
      const n = x.length - 1;
      expect(x[0]).toBeCloseTo(100, 6);
      expect(((x[n] / x[n - 1] - 1) * 100).toFixed(2)).toBe(s.q.toFixed(2));
      expect(((x[n] / x[n - 4] - 1) * 100).toFixed(2)).toBe(s.y1.toFixed(2));
      expect(((x[n] / x[n - 20] - 1) * 100).toFixed(2)).toBe(s.y5.toFixed(2));
      expect(((x[n] / x[0] - 1) * 100).toFixed(2)).toBe(s.s91.toFixed(2));
      x.forEach((v) => expect(Number.isFinite(v) && v > 0).toBe(true));
    });
  }
  it('rebased window starts at 100 and ends at 100 × (1 + 1yr change)', () => {
    const w = windowRebased(indexSeries(HPI_NATIONAL), 4);
    expect(w).toHaveLength(5);
    expect(w[0]).toBe(100);
    expect(w[4].toFixed(2)).toBe('102.14');
  });
});

describe('color bins', () => {
  it('maps min → 0, max → last, middle → middle', () => {
    expect(binIndex(-2, -2, 5, 7)).toBe(0);
    expect(binIndex(5, -2, 5, 7)).toBe(6);
    expect(binIndex(1.5, -2, 5, 7)).toBe(3);
  });
  it('degenerate range / NaN never throws', () => {
    expect(binIndex(1, 1, 1, 7)).toBe(3);
    expect(binIndex(NaN, 0, 10, 7)).toBe(0);
  });
});
