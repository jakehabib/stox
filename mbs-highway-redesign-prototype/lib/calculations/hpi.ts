/**
 * House Price Index helpers: period selection, ranking, comparison labels, color binning
 * and a reconstructed quarterly index series that reproduces each geography's stats exactly.
 */
import { NJ_OBSERVED_LABEL, type HpiPeriod, type HpiStats } from '@/data/mock/hpi';

export const PERIOD_LABELS: Record<HpiPeriod, string> = {
  quarter: 'Quarter',
  year1: '1 Year',
  year5: '5 Year',
  since1991: 'Since 1991',
};
export const PERIOD_PHRASE: Record<HpiPeriod, string> = {
  quarter: 'last quarter',
  year1: 'last year',
  year5: 'over the last 5 years',
  since1991: 'since 1991',
};

const fin = (n: number) => (Number.isFinite(n) ? n : 0);

export function periodValue(s: HpiStats, p: HpiPeriod): number {
  return fin(p === 'quarter' ? s.q : p === 'year1' ? s.y1 : p === 'year5' ? s.y5 : s.s91);
}

/** 1-based rank (1 = highest) of `code` among items for the period. */
export function rankOf<T extends HpiStats & { code?: string; id?: string }>(items: T[], key: string, p: HpiPeriod): number {
  const sorted = [...items].sort((a, b) => periodValue(b, p) - periodValue(a, p));
  const i = sorted.findIndex((x) => (x.code ?? x.id) === key);
  return i < 0 ? 0 : i + 1;
}

/**
 * "vs national" label. New Jersey keeps the label observed on the live site
 * ("20% above national avg") in the quarterly and 1-year views — preserved, not recomputed.
 * Everything else shows the honest difference in percentage points.
 */
export function comparisonLabel(code: string, value: number, national: number, p: HpiPeriod): string {
  if (code === 'NJ' && (p === 'quarter' || p === 'year1')) return NJ_OBSERVED_LABEL;
  const d = fin(value) - fin(national);
  if (Math.abs(d) < 0.005) return 'In line with national avg';
  return `${Math.abs(d).toFixed(2)} pts ${d > 0 ? 'above' : 'below'} national avg`;
}

/** Relative difference vs national, percent (what an "X% above" label would mean if computed). */
export function relativeToNational(value: number, national: number): number {
  return national !== 0 ? ((fin(value) - national) / Math.abs(national)) * 100 : 0;
}

/** Bin a value into `steps` equal-width classes over [min, max]. */
export function binIndex(value: number, min: number, max: number, steps: number): number {
  if (!(steps > 0)) return 0;
  if (!(max > min)) return Math.floor((steps - 1) / 2);
  const t = (fin(value) - min) / (max - min);
  return Math.max(0, Math.min(steps - 1, Math.floor(t * steps)));
}

/** Equal-width bin edges (steps + 1 values). */
export function binEdges(min: number, max: number, steps: number): number[] {
  return Array.from({ length: steps + 1 }, (_, i) => min + ((max - min) * i) / steps);
}

export const SERIES_START = { year: 1991, quarter: 1 };
/** Number of quarters from 1991 Q1 to 2026 Q2 inclusive. */
export const SERIES_LENGTH = (2026 - 1991) * 4 + 2;

export function quarterLabel(i: number): string {
  const y = SERIES_START.year + Math.floor(i / 4);
  return `${y} Q${(i % 4) + 1}`;
}

/**
 * Quarterly index (1991 Q1 = 100) through 2026 Q2 whose last value reproduces the stats exactly:
 * last/prev − 1 = q, last/(4 back) − 1 = y1, last/(20 back) − 1 = y5, last/first − 1 = s91.
 * Shape before the 5-year anchor follows a stylised boom (2006 Q2 peak) and bust (2011 Q4 trough),
 * log-linear between anchors with a gentle wave that is zero at every anchor.
 */
export function indexSeries(s: HpiStats, length = SERIES_LENGTH): number[] {
  const n = length - 1;
  const E = 100 * (1 + fin(s.s91) / 100);
  const v5 = E / (1 + fin(s.y5) / 100);
  const v1 = E / (1 + fin(s.y1) / 100);
  const vq = E / (1 + fin(s.q) / 100);
  const L5 = Math.log(Math.max(v5, 1) / 100);
  const anchors: [number, number][] = [
    [0, Math.log(100)],
    [61, Math.log(100) + 0.6 * L5], // 2006 Q2 peak
    [83, Math.log(100) + 0.44 * L5], // 2011 Q4 trough
    [n - 20, Math.log(v5)],
    [n - 4, Math.log(v1)],
    [n - 1, Math.log(vq)],
    [n, Math.log(E)],
  ].filter(([i]) => i >= 0 && i <= n) as [number, number][];
  const out: number[] = new Array(length).fill(100);
  for (let k = 0; k < anchors.length - 1; k++) {
    const [i0, l0] = anchors[k];
    const [i1, l1] = anchors[k + 1];
    for (let i = i0; i <= i1; i++) {
      const t = i1 === i0 ? 0 : (i - i0) / (i1 - i0);
      const wave = i1 - i0 > 8 ? 0.012 * Math.sin(Math.PI * t) * Math.sin((i - i0) * 0.9) : 0;
      out[i] = Math.exp(l0 + (l1 - l0) * t + wave);
    }
  }
  return out;
}

/** Number of quarters shown in the chart for each period. */
export const PERIOD_WINDOW: Record<HpiPeriod, number> = { quarter: 8, year1: 12, year5: 20, since1991: SERIES_LENGTH - 1 };

/** Slice the last `window` quarters (plus the starting point) and rebase to 100. */
export function windowRebased(series: number[], window: number): number[] {
  const start = Math.max(0, series.length - 1 - window);
  const base = series[start] || 1;
  return series.slice(start).map((v) => (v / base) * 100);
}
