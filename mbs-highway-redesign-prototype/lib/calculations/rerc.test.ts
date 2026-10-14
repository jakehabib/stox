import { describe, expect, it } from 'vitest';
import { getRercData, MARLBORO_RERC } from '@/data/mock/rerc';
import { LOCATIONS } from '@/data/mock/locations';
import { forecastSummary, historicalPath, homeownershipSplit, incomeVsNational, pctChange, rercProjection } from './rerc';

const M = MARLBORO_RERC;

describe('RERC — Marlboro Township, NJ 07746 (spec values)', () => {
  it('median price $940,915, DOM 82', () => {
    expect(M.medianPrice).toBe(940915);
    expect(M.medianDaysOnMarket).toBe(82);
    expect(M.areaName).toBe('Marlboro Township, NJ 07746');
  });
  it('5-yr forecast: +$219,774 (23.36%), 4.67% avg/yr', () => {
    const f = forecastSummary(M.forecastValues);
    expect(Math.round(f.cumulative)).toBe(219774);
    expect(f.cumulativePct.toFixed(2)).toBe('23.36');
    expect(f.avgPct.toFixed(2)).toBe('4.67');
    expect(f.cagrPct.toFixed(2)).toBe('4.29');
  });
  it('compounding 4.67%/yr would NOT give $219,774 (documented discrepancy)', () => {
    expect(Math.round(940915 * (Math.pow(1.0467, 5) - 1))).toBe(241205);
  });
  it('historical 5yr 6.02%, 10yr 4.52%, 63yr 4.2%', () => expect(M.historical).toEqual({ y5: 6.02, y10: 4.52, y63: 4.2 }));
  it('homes being built in Monmouth 1,973/yr', () => {
    expect(M.homesBuiltPerYear).toBe(1973);
    expect(M.county).toBe('Monmouth');
  });
  it('active listings ZIP 71 / 54% M/M / 122% Y/Y / 3 new; county 2,765 / 69% / 94% / 150 new', () => {
    expect(M.listings.zip).toEqual({ total: 71, momPct: 54, yoyPct: 122, newLast5Days: 3 });
    expect(M.listings.county).toEqual({ total: 2765, momPct: 69, yoyPct: 94, newLast5Days: 150 });
  });
  it('inventory series reproduces the M/M and Y/Y figures', () => {
    const s = M.listingsSeries;
    const last = s[12];
    expect(last.zip).toBe(71);
    expect(Math.round(pctChange(last.zip, s[11].zip))).toBe(54);
    expect(Math.round(pctChange(last.zip, s[0].zip))).toBe(122);
    expect(Math.round(pctChange(last.county, s[11].county))).toBe(69);
    expect(Math.round(pctChange(last.county, s[0].county))).toBe(94);
  });
  it('demographics by age total 650.5K', () => {
    expect(M.ageBuckets.reduce((a, b) => a + b.value, 0).toFixed(1)).toBe('650.5');
  });
  it('homeowners & renters: renters 141.3K (16%), can afford 35.6K (5%), homeowners 509.2K (78%)', () => {
    const h = homeownershipSplit(M.renters, M.rentersCanAfford, M.homeowners);
    expect(h.total.toFixed(1)).toBe('650.5');
    expect(M.renters).toBe(141.3);
    expect(Math.round(h.rentersCantAffordPct)).toBe(16);
    expect(Math.floor(h.canAffordPct)).toBe(5);
    expect(Math.round(h.ownersPct)).toBe(78);
  });
  it('median household income $128,386 vs national $80,630 (+59%)', () => {
    expect(M.medianIncome).toBe(128386);
    expect(M.nationalMedianIncome).toBe(80630);
    expect(Math.round(incomeVsNational(128386, 80630))).toBe(59);
  });
  it('affordability index 90', () => expect(M.affordabilityIndex).toBe(90));
});

describe('RERC — edits & projections', () => {
  it('editing price to $500,000 keeps the forecast percentages (+$116,787, 23.36%)', () => {
    const f = forecastSummary(M.forecastValues, 500000);
    expect(Math.round(f.cumulative)).toBe(116787);
    expect(f.cumulativePct.toFixed(2)).toBe('23.36');
  });
  it('historical mode compounds the 63-yr 4.2% rate', () => {
    const h = rercProjection(M.forecastValues, 940915, 'historical', 4.2);
    expect(Math.round(h.end)).toBe(Math.round(940915 * Math.pow(1.042, 5)));
    expect(h.cagrPct.toFixed(2)).toBe('4.20');
  });
  it('guards: zero / NaN price', () => {
    expect(forecastSummary(M.forecastValues, 0).cumulativePct).toBe(0);
    expect(forecastSummary(M.forecastValues, NaN).cumulative).toBe(0);
    expect(historicalPath(NaN, 4, 3)).toEqual([0, 0, 0, 0]);
    expect(pctChange(5, 0)).toBe(0);
  });
  it('every demo location has complete, finite, deterministic data', () => {
    for (const l of LOCATIONS) {
      const d = getRercData(l.id);
      expect(d.forecastValues).toHaveLength(6);
      expect(d.listingsSeries).toHaveLength(13);
      expect(d.listingsSeries[12].zip).toBe(d.listings.zip.total);
      const vals = [d.medianPrice, d.medianDaysOnMarket, d.medianIncome, d.affordabilityIndex, d.renters, d.homeowners, ...d.forecastValues];
      vals.forEach((v) => expect(Number.isFinite(v) && v > 0).toBe(true));
      expect(getRercData(l.id)).toEqual(d);
    }
  });
  it('Dallas uses the Dallas forecast curve', () => {
    const d = getRercData('dallas-tx-75201');
    expect(d.forecastValues[1] / d.forecastValues[0]).toBeCloseTo(522351 / 500000, 4);
  });
});
