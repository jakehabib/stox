import { SeasonStats } from './types';

/** Sum two stat lines field-by-field. Used both for in-game accumulation and year-end career rollup. */
export function mergeStats(a: SeasonStats, b: SeasonStats): SeasonStats {
  const out: SeasonStats = { ...a };
  for (const key of Object.keys(b) as (keyof SeasonStats)[]) {
    const bv = b[key];
    if (typeof bv !== 'number') continue;
    out[key] = ((out[key] as number) ?? 0) + bv;
  }
  return out;
}
