import { CombineTesting, COMBINE_ANCHOR } from './gen/prospectProfile';
import type { Position } from './tuning';

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
 * draft class, subject included. Pure and DB-free: the caller loads the class
 * (draftClassScope in lib/draft.ts, which is the whole class and not just the
 * men still on the board) and hands the rows in here.
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

/**
 * ===========================================================================
 * THE POSITION-ADJUSTED PUBLIC ATHLETICISM READ
 * ===========================================================================
 * 0..1, 0.5 = an average tester FOR HIS POSITION. Every drill is converted to
 * a z against that position's own anchor in lib/gen/prospectProfile.ts, the
 * z's are averaged, and the mean is put through a normal CDF — so a guard who
 * benches 26 and runs 5.25 reads 0.50, exactly like a corner who benches
 * nothing and runs 4.47.
 *
 * WHY THIS EXISTS AND WHAT SHOULD CALL IT. lib/consensus.ts publicAthleticism()
 * does the same job by inverting the generator's formulas, and it anchors ONLY
 * the 40 — the other four drills are inverted against flat constants (28in,
 * 100in, 7.00s, 14 reps) that were the same for every position back when every
 * position tested identically. Now that a corner really does jump 35.5in and a
 * guard 27in, that inverter reads the corner as a better athlete than the
 * guard by construction. Measured over 10,000 prospects it now returns a mean
 * of 0.635 for a corner and 0.376 for a right tackle, which at
 * CONSENSUS.TESTING_PULL = 9 is a silent, permanent 2.3-point positional
 * distortion on the consensus board, plus a spread collapse (sd 0.30 -> 0.17)
 * that weakens the stopwatch bias for everybody.
 *
 * The correct call there is `return testingAthleticism(position, testing)`.
 * It is not made yet only because lib/consensus.ts belongs to another change
 * in flight; this function is written to be that one-line drop-in, on the
 * same 0..1 scale the room already compares against its `ability` term.
 * ===========================================================================
 */
export function testingAthleticism(position: string, testing: Partial<CombineTesting>): number | null {
  const anchor = COMBINE_ANCHOR[position as Position];
  if (!anchor) return null;
  const zs: number[] = [];
  // Timed drills subtract: quicker than the anchor is a positive z.
  const timed: [number | null | undefined, [number, number]][] = [
    [testing.fortyYard, anchor.forty],
    [testing.threeCone, anchor.cone],
    [testing.shuttle, anchor.shuttle],
  ];
  for (const [v, [mean, sd]] of timed) if (v != null && sd > 0) zs.push((mean - v) / sd);
  const scored: [number | null | undefined, [number, number]][] = [
    [testing.vertical, anchor.vertical],
    [testing.broadJump, anchor.broad],
    [testing.benchReps, anchor.bench],
  ];
  for (const [v, [mean, sd]] of scored) if (v != null && sd > 0) zs.push((v - mean) / sd);
  if (zs.length === 0) return null;
  const z = zs.reduce((a, b) => a + b, 0) / zs.length;
  return normalCdf(z);
}

/** Standard normal CDF via Abramowitz & Stegun 7.1.26 (|err| < 1.5e-7). */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * ===========================================================================
 * THE CLASS ATHLETIC RANK — one public figure per prospect
 * ===========================================================================
 * "Athletic 7" is the seventh-best tester in this draft class. It is built by
 * ranking every drill a man ran against the men at HIS OWN POSITION, averaging
 * those finishes, and then ordering the whole class on that average.
 *
 * WHY EACH DRILL IS RANKED INSIDE THE POSITION GROUP AND ONLY THE AVERAGE IS
 * RANKED ACROSS THE CLASS. A 330-pound tackle is never going to run a 4.4, so
 * ranking the raw stopwatch across a whole class turns the column into a proxy
 * for "is he a skill player", which tells a front office nothing it could not
 * read off the position badge. Measured over 158 generated classes (63,020
 * prospects), ranking each drill inside the position group leaves the MEDIAN
 * athletic rank varying by sd 15.3 across the sixteen positions of a 400-man
 * class — flat, as it should be. Ranking the raw numbers across the class
 * instead puts that spread at sd 39.6, and the order it produces is simply the
 * depth chart. So: measured against his peers, ordered against the class.
 *
 * WHAT IT DOES AND DOES NOT GIVE AWAY. Testing is public — every club watched
 * the same stopwatch, and the six numbers are already printed in full on the
 * player card — so this is arithmetic over visible data and is never fogged.
 * It does carry real signal about ability, because good players do tend to
 * test well (see COMBINE.ABILITY_WEIGHT): over those same 158 classes it runs
 * rho -0.558 against a prospect's true overall. That is well short of the
 * CONSENSUS BOARD RANK sitting two columns away on the same table, which is
 * equally free to every club and runs rho -0.799; and once the consensus rank
 * is held fixed, this figure adds only rho -0.148 of its own. A GM cannot back
 * a hidden rating out of it that the board has not already told him.
 *
 * MISSING EVENTS ARE AVERAGED OVER, NEVER SCORED AS FAILURES. A man is ranked
 * on the drills he actually ran; a corner who was never going to bench is not
 * pushed down the class for it, because the battery his position group runs is
 * measured from the group rather than assumed. Anyone who ran fewer drills
 * than his own group's usual battery is flagged `thin` — his average rests on
 * less, and the reader is told rather than sold a number that looks as solid
 * as the rest. Measured across every class in the local database, that flag
 * fires on nobody: the generator gives every man his group's full battery, and
 * the four prospects with no testing recorded at all get no rank rather than a
 * last place. It is a guard on data that does not exist yet, not a thing the
 * board shows today.
 */
export interface AthleticRead {
  /** 1 = the best tester in the class. Ties share a rank. */
  rank: number;
  /** Men in this class with testing numbers on file — the denominator. */
  outOf: number;
  /** 0..100, the mean of his within-position drill percentiles. */
  percentile: number;
  /** How many drills the average is built on. */
  events: number;
  /** He ran fewer drills than the usual battery for his position group. */
  thin: boolean;
}

export function classAthleticRanks(
  prospects: { id: string; position: string; testing: CombineTesting | null }[],
): Map<string, AthleticRead> {
  const tested = prospects.filter(
    (p): p is { id: string; position: string; testing: CombineTesting } => p.testing != null,
  );

  const peers = new Map<string, CombineTesting[]>();
  for (const p of tested) {
    const list = peers.get(p.position);
    if (list) list.push(p.testing);
    else peers.set(p.position, [p.testing]);
  }

  const scored = tested
    .map((p) => {
      const finishes = Object.values(rankProspectCombine(p.testing, peers.get(p.position)!))
        .filter((r): r is MeasurableRank => r != null);
      return {
        id: p.id,
        position: p.position,
        events: finishes.length,
        // MeasurableRank.percentile is rounded to a whole number, which is
        // right on a card tile and wrong as an input to an average: a group of
        // twenty-five offers only twenty-five finishes, so six rounded
        // percentiles land on a coarse lattice and men collide who are not
        // level. Measured over 158 classes, averaging the rounded figure left
        // 39.8% of every class sharing a rank with somebody. This is
        // rankValue's own formula with the rounding left off — the same
        // finish, at full precision.
        percentile: finishes.length === 0
          ? null
          : finishes.reduce((sum, r) => sum + (100 * (r.outOf - r.rank)) / (r.outOf - 1), 0) / finishes.length,
        // The same six numbers against the same position anchors, never
        // collapsed into finishes at all. Only ever used to separate men the
        // average could not tell apart — see the tiebreak note below.
        precise: testingAthleticism(p.position, p.testing) ?? 0.5,
      };
    })
    .filter((s): s is { id: string; position: string; events: number; percentile: number; precise: number } => s.percentile != null);

  // The battery each position group actually runs, taken from the group rather
  // than hard-coded: the positions that skip the bench are a generator detail
  // (SKIPS_BENCH in lib/gen/prospectProfile.ts) and a list of them copied over
  // here is one more thing to drift. The modal count is the group's normal
  // day; ties break high, so an evenly split group reads the fuller battery as
  // normal.
  const usual = new Map<string, number>();
  for (const pos of peers.keys()) {
    const counts = new Map<number, number>();
    for (const s of scored) if (s.position === pos) counts.set(s.events, (counts.get(s.events) ?? 0) + 1);
    let best = 0;
    let bestSeen = -1;
    for (const [events, seen] of counts) if (seen > bestSeen || (seen === bestSeen && events > best)) { best = events; bestSeen = seen; }
    usual.set(pos, best);
  }

  /*
   * THE ORDER, AND THE TIEBREAK IT NEEDS.
   *
   * The primary key is the average finish, exactly as the column claims. Six
   * finishes out of a twenty-five-man group still average onto a lattice
   * though, and men land level who are not really level — on the average
   * alone, 22.4% of a class shared a rank and the worst pile-up put nine men
   * on one, which reads as a broken column rather than a dead heat. With the
   * tiebreak it is 0.4%, and never more than three.
   *
   * Level men are separated by `precise`: the same public stopwatch against
   * the same position anchors, so it reveals nothing the average did not, and
   * it only ever orders men the average could not tell apart. Two men alike on
   * both did test the same, and share a rank, as they should.
   */
  const ordered = scored.slice().sort((a, b) => b.percentile - a.percentile || b.precise - a.precise);

  const out = new Map<string, AthleticRead>();
  let rank = 0;
  ordered.forEach((s, i) => {
    const prev = ordered[i - 1];
    if (!prev || prev.percentile !== s.percentile || prev.precise !== s.precise) rank = i + 1;
    out.set(s.id, {
      rank,
      outOf: ordered.length,
      percentile: Math.round(s.percentile),
      events: s.events,
      thin: s.events < (usual.get(s.position) ?? s.events),
    });
  });
  return out;
}
