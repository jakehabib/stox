/**
 * Real Estate Report Card math: forecast summary, historical projection, homeownership split.
 *
 * The live tool reports the 5-yr forecast as "+4.67% avg/yr, $219,774 (23.36%)" for a
 * $940,915 median. 219,774 / 940,915 = 23.36% and 23.36% / 5 = 4.67% — i.e. "avg/yr" is the
 * SIMPLE average of the cumulative change, not a compound rate (compounding 4.67%/yr for 5
 * years would give +25.64% / $241,205). We reproduce the live definition and also expose the
 * compound (CAGR) rate.
 */
import { cagr } from './core';

export type RercAppreciationMode = 'forecast' | 'historical';

export interface ForecastSummary {
  /** Values for years 0..n at the chosen price. */
  path: number[];
  start: number;
  end: number;
  cumulative: number;
  cumulativePct: number;
  /** Simple average per year (cumulative % ÷ years) — the figure the report shows as "avg/yr". */
  avgPct: number;
  /** Compound annual rate. */
  cagrPct: number;
}

const fin = (n: number) => (Number.isFinite(n) ? n : 0);

/**
 * Summarise a value path. `basePath` is the market's forecast at its median; when the LO edits
 * the price, the same year-by-year percentages are applied to `price`.
 */
export function forecastSummary(basePath: number[], price?: number): ForecastSummary {
  const base = basePath.length ? basePath : [0];
  const b0 = fin(base[0]);
  const p = price === undefined ? b0 : Math.max(0, fin(price));
  const path = base.map((v) => (b0 > 0 ? (fin(v) / b0) * p : p));
  const years = path.length - 1;
  const start = path[0];
  const end = path[years];
  const cumulative = end - start;
  const cumulativePct = start > 0 ? (cumulative / start) * 100 : 0;
  return {
    path,
    start,
    end,
    cumulative,
    cumulativePct,
    avgPct: years > 0 ? cumulativePct / years : 0,
    cagrPct: years > 0 ? cagr(start, end, years) : 0,
  };
}

/** Compound a flat historical rate (percent/yr) for `years` years. */
export function historicalPath(price: number, ratePct: number, years = 5): number[] {
  const p = Math.max(0, fin(price));
  return Array.from({ length: years + 1 }, (_, y) => p * Math.pow(1 + fin(ratePct) / 100, y));
}

/** Path for the chosen appreciation mode. Historical uses the long-run (63-yr) average. */
export function rercProjection(basePath: number[], price: number, mode: RercAppreciationMode, historicalPct: number): ForecastSummary {
  if (mode === 'forecast') return forecastSummary(basePath, price);
  return forecastSummary(historicalPath(price, historicalPct, Math.max(1, basePath.length - 1)));
}

/**
 * Homeowners & renters split, as the report shows it: three segments of the population —
 * renters who can't afford to buy, renters who can afford to purchase, homeowners.
 * The live label "Renters 141.3K (16%)" pairs the TOTAL renter count with the share of
 * renters who can NOT afford (105.7K / 650.5K = 16%).
 */
export function homeownershipSplit(rentersK: number, canAffordK: number, ownersK: number) {
  const renters = Math.max(0, fin(rentersK));
  const can = Math.min(renters, Math.max(0, fin(canAffordK)));
  const owners = Math.max(0, fin(ownersK));
  const total = renters + owners;
  const share = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  return {
    total,
    rentersCantAfford: renters - can,
    rentersCantAffordPct: share(renters - can),
    canAfford: can,
    canAffordPct: share(can),
    owners,
    ownersPct: share(owners),
  };
}

/** Percent change between two counts (M/M, Y/Y). */
export function pctChange(now: number, before: number): number {
  return before > 0 ? ((fin(now) - before) / before) * 100 : 0;
}

/** Ratio of local to national median income, percent above (+) / below (−). */
export function incomeVsNational(local: number, national: number): number {
  return national > 0 ? ((fin(local) - national) / national) * 100 : 0;
}
