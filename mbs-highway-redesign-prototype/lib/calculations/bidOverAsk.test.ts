import { describe, it, expect } from 'vitest';
import { bidFormRates, bidOverAsk, bidValueAt, monthsAtFlatRate, monthsToExceedBid, totalBid, validateBid } from './bidOverAsk';

const alex = { askingPrice: 500000, bidAbove: 25000, currentValue: 500000, locationId: 'dallas-tx-75201', mode: 'forecast' as const, customPct: 4 };

describe('bidOverAsk — spec example ($500k ask, +$25k, value $500k, Dallas forecast)', () => {
  const r = bidOverAsk(alex);
  it('total bid $525,000, 5% over value', () => {
    expect(r.totalBid).toBe(525000);
    expect(r.pctOverValue).toBe(5);
    expect(totalBid({ askingPrice: 400000, bidAbove: 10000 })).toBe(410000);
  });
  it('5-yr projected value $589,480, gain $64,480 (+12.28% over bid)', () => {
    expect(Math.round(r.value5)).toBe(589480);
    expect(Math.round(r.gain5)).toBe(64480);
    expect(r.gain5PctOfBid.toFixed(2)).toBe('12.28');
  });
  it('chart Yr0..Yr5 values and % vs bid', () => {
    expect(r.years.map((y) => Math.round(y.value))).toEqual([500000, 522351, 541664, 561846, 582853, 589480]);
    expect(r.years.map((y) => y.pctVsBid.toFixed(2))).toEqual(['-4.76', '-0.50', '3.17', '7.02', '11.02', '12.28']);
  });
  it('form rates: forecast 4.47% 1-yr, 3.35% 5-yr avg; historical 2.96% 63-yr', () => {
    expect(bidFormRates('dallas-tx-75201')).toEqual({ forecast1yrPct: 4.47, forecast5yrAvgPct: 3.35, historical63yrPct: 2.96 });
    // The 5-yr avg is the CAGR of the curve over 5 years; the 1-yr is the curve's Yr1 step.
    expect(((589480 / 500000) ** (1 / 5) - 1) * 100).toBeCloseTo(3.35, 2);
    expect(((522351 / 500000) - 1) * 100).toBeCloseTo(4.47, 2);
  });
  it('crossing on the displayed curve: 13.7 months (spec shows 18.3 — inconsistent with its own chart, see report)', () => {
    expect(r.monthsToExceed!.toFixed(1)).toBe('13.7');
    expect(bidValueAt(alex, r.monthsToExceed! / 12)).toBeCloseTo(525000, 0);
    // reference models
    expect(monthsAtFlatRate(5, 3.35)!.toFixed(1)).toBe('17.8');
    expect(monthsAtFlatRate(5, 2.96)!.toFixed(1)).toBe('20.1');
  });
});

describe('historical / custom compound a flat rate', () => {
  it('historical 2.96%: Yr5 = 500k × 1.0296^5, crossing 20.1 months', () => {
    const r = bidOverAsk({ ...alex, mode: 'historical' });
    expect(Math.round(r.value5)).toBe(Math.round(500000 * 1.0296 ** 5));
    expect(r.monthsToExceed!.toFixed(1)).toBe('20.1');
  });
  it('custom 5%: crossing exactly 12 months', () => {
    expect(monthsToExceedBid({ ...alex, mode: 'custom', customPct: 5 })!).toBeCloseTo(12, 6);
  });
  it('bid at/below value → 0 months; never catches up → null', () => {
    expect(monthsToExceedBid({ ...alex, bidAbove: 0 })).toBe(0);
    expect(monthsToExceedBid({ ...alex, mode: 'custom', customPct: 0 })).toBeNull();
    expect(monthsToExceedBid({ ...alex, mode: 'custom', customPct: -3 })).toBeNull();
  });
  it('estimated value differs from asking', () => {
    const r = bidOverAsk({ ...alex, currentValue: 510000 });
    expect(r.pctOverValue.toFixed(2)).toBe('2.94');
    expect(Math.round(r.years[1].value)).toBe(Math.round(510000 * 522351 / 500000));
  });
});

describe('guards', () => {
  it('zero / NaN inputs stay finite', () => {
    const r = bidOverAsk({ askingPrice: 0, bidAbove: NaN, currentValue: 0, locationId: 'dallas-tx-75201', mode: 'custom', customPct: NaN });
    expect(Number.isFinite(r.pctOverValue)).toBe(true);
    expect(Number.isFinite(r.gain5PctOfBid)).toBe(true);
    for (const y of r.years) expect(Number.isFinite(y.pctVsBid)).toBe(true);
  });
  it('validation: client required', () => {
    expect(validateBid({ clientId: null, ...alex }).client).toBe('Client name is required');
    expect(validateBid({ clientId: 'c-alex-rivera', ...alex })).toEqual({});
  });
});
