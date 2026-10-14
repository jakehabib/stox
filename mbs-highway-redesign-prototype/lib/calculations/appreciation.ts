import { getLocation, type Location } from '@/data/mock/locations';
import { cagr } from './core';

export type AppreciationMode = 'forecast' | 'historical' | 'custom';

export interface AppreciationSetting {
  mode: AppreciationMode;
  /** Used when mode === 'custom'. Percent per year. */
  customPct?: number;
}

/** Rate shown on property forms for a given mode. */
export function displayedRate(loc: Location, s: AppreciationSetting): number {
  if (s.mode === 'custom') return s.customPct ?? 0;
  if (s.mode === 'historical') return loc.historicalPct;
  return loc.forecastDisplayPct;
}

/**
 * Projected value at year y (may be fractional). Forecast mode follows the
 * location's year-by-year forecast curve; historical/custom compound a flat rate.
 */
export function valueAtYear(price: number, loc: Location | string, s: AppreciationSetting, year: number): number {
  const l = typeof loc === 'string' ? getLocation(loc) : loc;
  if (year <= 0) return price;
  if (s.mode === 'forecast') {
    const idx = l.forecastIndex;
    const lo = Math.floor(year);
    if (lo >= idx.length - 1) {
      const last = idx[idx.length - 1];
      const g = idx[idx.length - 1] / idx[idx.length - 2];
      return price * last * Math.pow(g, year - (idx.length - 1));
    }
    const frac = year - lo;
    // Geometric interpolation inside a year.
    return price * idx[lo] * Math.pow(idx[lo + 1] / idx[lo], frac);
  }
  const r = s.mode === 'custom' ? s.customPct ?? 0 : l.historicalPct;
  return price * Math.pow(1 + r / 100, year);
}

/** Values for years 0..n inclusive. */
export function projectValues(price: number, loc: Location | string, s: AppreciationSetting, years: number): number[] {
  return Array.from({ length: years + 1 }, (_, y) => valueAtYear(price, loc, s, y));
}

/** Effective annualized rate over n years for the chosen mode. */
export function effectiveRate(price: number, loc: Location | string, s: AppreciationSetting, years: number): number {
  return cagr(price, valueAtYear(price, loc, s, years), years);
}
