import { describe, it, expect } from 'vitest';
import {
  appreciationResult,
  convertDownUnit,
  DEFAULT_CLOSING_WORKSHEET,
  downPaymentDollars,
  formRatePct,
  homeValueSeries,
  sumWorksheet,
  toggleAppreciationMode,
  validateAppreciation,
} from './appreciationTool';

const D = 'dallas-tx-75201';
const alex = { price: 500000, locationId: D, mode: 'forecast' as const, customPct: 4, downPayment: 100000, closingCosts: 8000, years: 10 };

describe('appreciationResult — spec example ($500k, down $100k, closing $8k, Dallas forecast, 10yr)', () => {
  const r = appreciationResult(alex);
  it('Est home value $634,338, appreciation +$134,338, +$13,434 avg/yr', () => {
    expect(Math.round(r.homeValue)).toBe(634338);
    expect(Math.round(r.appreciation)).toBe(134338);
    expect(Math.round(r.appreciationAvgPerYear)).toBe(13434);
  });
  it('cash invested $108,000; clean ROI = 134,338 / 108,000 = 124.4% (+12.4%/yr)', () => {
    expect(r.cashInvested).toBe(108000);
    expect(r.roiPct.toFixed(1)).toBe('124.4');
    expect(r.roiAvgPerYearPct.toFixed(1)).toBe('12.4');
  });
  it('live-site 126% / 13% avg/yr reproduces as (appreciation − closing) ÷ down payment', () => {
    expect(Math.round(r.roiNetOfClosingOnDownPct)).toBe(126);
    expect(Math.round(r.roiNetOfClosingOnDownPct / 10)).toBe(13);
  });
  it('form rate 2.481% vs results effective 10-yr rate 2.41% (both preserved)', () => {
    expect(r.formRatePct).toBe(2.481);
    expect(r.effectiveRatePct.toFixed(2)).toBe('2.41');
  });
  it('chart points yr 0,2,4,6,8,10 = 500,000 / 541,664 / 582,853 / 596,940 / 611,772 / 634,338', () => {
    const s = homeValueSeries(500000, D, 'forecast', 0, 10).map(Math.round);
    expect([0, 2, 4, 6, 8, 10].map((y) => s[y])).toEqual([500000, 541664, 582853, 596940, 611772, 634338]);
    expect([1, 3, 5, 9].map((y) => s[y])).toEqual([522351, 561846, 589480, 622058]);
  });
  it('other horizons on the same curve (Y12 665,342, Y15 722,153)', () => {
    expect(Math.round(appreciationResult({ ...alex, years: 12 }).homeValue)).toBe(665342);
    expect(Math.round(appreciationResult({ ...alex, years: 15 }).homeValue)).toBe(722153);
    expect(appreciationResult({ ...alex, years: 30 }).homeValue).toBeGreaterThan(722153);
  });
});

describe('historical / custom modes compound a flat rate', () => {
  it('historical Dallas 2.963%', () => {
    const r = appreciationResult({ ...alex, mode: 'historical' });
    expect(Math.round(r.homeValue)).toBe(Math.round(500000 * 1.02963 ** 10));
    expect(formRatePct(D, 'historical', 0)).toBe(2.963);
  });
  it('custom 4% for 10yr → $740,122; ROI on $108k', () => {
    const r = appreciationResult({ ...alex, mode: 'custom', customPct: 4 });
    expect(Math.round(r.homeValue)).toBe(740122);
    expect(r.effectiveRatePct.toFixed(2)).toBe('4.00');
    expect(Math.round(r.roiPct)).toBe(Math.round((240122.14 / 108000) * 100));
  });
});

describe('guards', () => {
  it('zero / empty inputs never produce NaN', () => {
    const r = appreciationResult({ price: 0, locationId: D, mode: 'custom', customPct: NaN, downPayment: NaN, closingCosts: 0, years: 0 });
    for (const v of Object.values(r)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
  });
  it('huge inputs stay finite', () => {
    const r = appreciationResult({ ...alex, price: 1e12, years: 30, mode: 'custom', customPct: 25 });
    expect(Number.isFinite(r.roiPct)).toBe(true);
  });
});

describe('select up to 2', () => {
  it('adds up to two, refuses a third, keeps canonical order', () => {
    let s = toggleAppreciationMode(['forecast'], 'custom', true);
    expect(s).toEqual(['forecast', 'custom']);
    s = toggleAppreciationMode(s, 'historical', true);
    expect(s).toEqual(['forecast', 'custom']);
    expect(toggleAppreciationMode(s, 'forecast', false)).toEqual(['custom']);
  });
});

describe('down payment and closing worksheet', () => {
  it('fee / percentage', () => {
    expect(downPaymentDollars(500000, 20, 'pct')).toBe(100000);
    expect(downPaymentDollars(500000, 100000, 'fee')).toBe(100000);
    expect(convertDownUnit(500000, 100000, 'fee', 'pct')).toBe(20);
    expect(convertDownUnit(500000, 20, 'pct', 'fee')).toBe(100000);
  });
  it('worksheet defaults sum to $8,000', () => {
    expect(sumWorksheet(DEFAULT_CLOSING_WORKSHEET)).toBe(8000);
    expect(sumWorksheet([{ id: 'a', label: 'a', amount: 100 }, { id: 'b', label: 'b', amount: -5 }])).toBe(100);
  });
  it('validation: client required, closing 0 invalid, at least one mode', () => {
    const ok = { clientId: 'c-alex-rivera', price: 500000, modes: ['forecast' as const], customPct: 4, downPayment: 100000, closingCosts: 8000 };
    expect(validateAppreciation(ok)).toEqual({});
    expect(validateAppreciation({ ...ok, clientId: null }).client).toBe('Client name is required');
    expect(validateAppreciation({ ...ok, closingCosts: 0 }).closingCosts).toBe('Closing costs must be greater than $0');
    expect(validateAppreciation({ ...ok, modes: [] }).modes).toBeTruthy();
  });
});
