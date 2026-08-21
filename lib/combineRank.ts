import { CombineTesting } from './gen/prospectProfile';

/**
 * Ranks a prospect's testing numbers against the rest of his position group
 * within the same draft class. Combine/pro-day numbers are PUBLIC — every
 * team sees the same stopwatch — so unlike scouted attributes this never
 * gets fogged; it's pure arithmetic over numbers that are already visible.
 */

export type CombineMeasurable = 'fortyYard' | 'vertical' | 'broadJump' | 'threeCone' | 'shuttle' | 'benchReps';

export const COMBINE_MEASURABLES: CombineMeasurable[] = ['fortyYard', 'vertical', 'broadJump', 'threeCone', 'shuttle', 'benchReps'];

/**
 * Direction of "good" per measurable. Get this backwards and every rank on
 * the page silently inverts — fast becomes "worst 40" — so it's isolated
 * here as the one place direction is decided, and it's what combineRank.test
 * exists to pin down.
 */
export const LOWER_IS_BETTER: Record<CombineMeasurable, boolean> = {
  fortyYard: true,
  vertical: false,
  broadJump: false,
  threeCone: true,
  shuttle: true,
  benchReps: false,
};

export interface MeasurableRank {
  /** 1 = best in the position group. */
  rank: number;
  /** Size of the peer group this was ranked against (includes the player himself). */
  outOf: number;
  /** 0..100, 100 = best. Undefined (never returned) when outOf < 2 — a field of one can't be ranked. */
  percentile: number;
}

/** "1st", "2nd", "3rd", "4th", "11th"... */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/**
 * Rank one value against a peer group (which should include the value
 * itself once). Ties share a rank (standard "competition ranking": two guys
 * tied for best are both rank 1, the next guy is rank 3, not 2).
 */
export function rankValue(value: number, peers: number[], lowerIsBetter: boolean): MeasurableRank | null {
  if (peers.length < 2) return null;
  const better = peers.filter((p) => (lowerIsBetter ? p < value : p > value)).length;
  const rank = better + 1;
  const outOf = peers.length;
  // rank 1 -> 100th percentile (best), rank outOf -> 0th percentile (worst).
  const percentile = outOf > 1 ? Math.round((100 * (outOf - rank)) / (outOf - 1)) : 100;
  return { rank, outOf, percentile };
}

export type ProspectCombineRanks = Partial<Record<CombineMeasurable, MeasurableRank>>;

/**
 * Rank every measurable `subject` has a recorded value for against
 * `positionPeers` — the full position group's testing rows for the same
 * draft class, subject included. Pure and DB-free: the page does the one
 * query (position + draftYear + isDraftee) and hands the rows in here.
 */
export function rankProspectCombine(subject: CombineTesting, positionPeers: CombineTesting[]): ProspectCombineRanks {
  const out: ProspectCombineRanks = {};
  for (const key of COMBINE_MEASURABLES) {
    const value = subject[key];
    if (value == null) continue;
    const peerValues = positionPeers
      .map((c) => c[key])
      .filter((v): v is number => v != null);
    const ranked = rankValue(value, peerValues, LOWER_IS_BETTER[key]);
    if (ranked) out[key] = ranked;
  }
  return out;
}

/**
 * One aggregate "how did he test overall relative to his position" read —
 * the plain average of his per-measurable percentiles. Used where a single
 * public signal is more useful than six separate ones (e.g. weighing into
 * the consensus big-board score in prospectProfile.ts).
 */
export function overallTestingPercentile(ranks: ProspectCombineRanks): number | null {
  const values = Object.values(ranks).filter((r): r is MeasurableRank => r != null).map((r) => r.percentile);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
