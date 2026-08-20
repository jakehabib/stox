/**
 * Display-only win-probability estimate for the Dashboard hero's matchup
 * strip. NOT used anywhere in the sim engine (lib/sim/*), which plays the
 * game out on its own per-drive model regardless of this number — this
 * exists purely so the "next game" badge means something at a glance
 * instead of being a decorative percentage. Blends the roster-overall gap
 * (weighted more — it's the better signal) with the season record gap.
 * [PLACEHOLDER] curve, like every other heuristic in lib/tuning.ts.
 */
export function estimateWinProbability(opts: {
  myOverall: number; oppOverall: number;
  myWins: number; myLosses: number; oppWins: number; oppLosses: number;
}): number {
  const ovrDiff = opts.myOverall - opts.oppOverall;
  const myPct = opts.myWins / Math.max(1, opts.myWins + opts.myLosses);
  const oppPct = opts.oppWins / Math.max(1, opts.oppWins + opts.oppLosses);
  const recordDiff = myPct - oppPct;

  const raw = 0.5 + ovrDiff * 0.018 + recordDiff * 0.15;
  return Math.round(Math.min(0.95, Math.max(0.05, raw)) * 100);
}
