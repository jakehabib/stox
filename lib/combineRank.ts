import { CombineTesting, COMBINE_ANCHOR, POSITION_DRILL_WEIGHTS, DrillKey } from './gen/prospectProfile';
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
 * the page silently inverts — fast becomes "worst 40" — so it is isolated
 * here as the one place direction is decided, and every reader of a drill
 * goes through it rather than restating which way round its units run.
 * (An earlier note here pointed at a combineRank test file. There is no such
 * file in this repository; the claim is removed rather than left standing.)
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
 * This file names the drills after the columns on the player card; the
 * generator names them after the anchor table it rolls them from. One map,
 * declared once, rather than the two vocabularies being restated wherever they
 * meet.
 */
const DRILL_OF: Record<CombineMeasurable, DrillKey> = {
  fortyYard: 'forty',
  vertical: 'vertical',
  broadJump: 'broad',
  threeCone: 'cone',
  shuttle: 'shuttle',
  benchReps: 'bench',
};

/**
 * WHAT THE COMPOSITE WEIGHS, at this position. The app owner: *"athletic
 * testing matters differently across position. 40 time matters more for a CB
 * than it does a LT."*
 *
 * The table is derived from the engine rather than typed in — see
 * POSITION_DRILL_WEIGHTS in lib/gen/prospectProfile.ts, which multiplies what
 * the game says a position's play is made of by which physical qualities each
 * of those skills rests on by what each drill measures. A corner's rank leans
 * on the forty, the shuttle and the three-cone; a tackle's on the bench, the
 * three-cone and the broad; an edge rusher sits between them.
 *
 * Relative, and renormalised over the drills a man actually ran by every
 * caller below — a position that skips the bench keeps working, with the other
 * five rescaled.
 *
 * Returns undefined for a position with no anchor at all, which is the same
 * "no opinion" every reader here already handles by falling back to flat.
 */
export function positionDrillWeights(position: string): Partial<Record<CombineMeasurable, number>> | undefined {
  const row = POSITION_DRILL_WEIGHTS[position as Position];
  if (!row) return undefined;
  const out: Partial<Record<CombineMeasurable, number>> = {};
  for (const key of COMBINE_MEASURABLES) out[key] = row[DRILL_OF[key]];
  return out;
}

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
 *
 * DELIBERATELY STILL FLAT, unlike the athletic rank below. This one feeds
 * PUBLIC PERCEPTION — bigBoardScore's testing swing — and the public does not
 * weight a workout by position. The board's stopwatch bias is a bias; see
 * CONSENSUS.FORTY_FIXATION for the same decision made about the same thing.
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
 * WHO CALLS IT. lib/consensus.ts, twice and for two different jobs, which is
 * why it takes weights. publicAthleticism() passes none, so it gets the
 * DEFAULT — this position's own drill weights, the read this file's athletic
 * rank is built on. roomStopwatchRead() overrides them with
 * CONSENSUS.FORTY_FIXATION of the weight on the forty and the rest split flat,
 * because a draft room grades the number it quotes on television and it quotes
 * it for everybody. The gap between those two reads is what leaves the
 * athletic rank saying something the consensus board has not already said; see
 * THE ATHLETIC RANK below.
 *
 * IT WAS FLAT FOR EVERYBODY UNTIL RECENTLY, and that was the defect the app
 * owner named: *"athletic testing matters differently across position. 40 time
 * matters more for a CB than it does a LT."* Six drills averaged equally meant
 * a 330lb tackle's forty counted for exactly as much of his athletic rank as a
 * corner's did. The default is now positionDrillWeights() above.
 *
 * It used to be neither — consensus.ts inverted the generator's formulas by
 * hand and anchored ONLY the 40, scoring the other four against flat constants
 * (28in, 100in, 7.00s, 14 reps) from back when every position tested
 * identically. Measured over 10,000 prospects that inverter returned a mean of
 * 0.635 for a corner and 0.376 for a right tackle purely because of where they
 * line up, plus a spread collapse (sd 0.30 -> 0.17) that weakened the
 * stopwatch bias for everybody. One anchor table, one reader.
 *
 * `weights` are relative and are renormalised over the drills a man actually
 * ran, so a corner who never benched is not silently scored against a battery
 * he was never going to run.
 * ===========================================================================
 */
export function testingAthleticism(
  position: string,
  testing: Partial<CombineTesting>,
  weights?: Partial<Record<CombineMeasurable, number>>,
): number | null {
  const anchor = COMBINE_ANCHOR[position as Position];
  if (!anchor) return null;
  // Omitting `weights` means "weight this the way his position is played",
  // never "weight everything the same" — a caller that wants the flat average
  // has to say so, because on this board the flat average is the unusual read.
  const w6 = weights ?? positionDrillWeights(position);
  let sum = 0;
  let total = 0;
  const add = (key: CombineMeasurable, z: number) => {
    const w = w6?.[key] ?? 1;
    if (w <= 0) return;
    sum += w * z;
    total += w;
  };
  // Timed drills subtract: quicker than the anchor is a positive z.
  const timed: [CombineMeasurable, number | null | undefined, [number, number]][] = [
    ['fortyYard', testing.fortyYard, anchor.forty],
    ['threeCone', testing.threeCone, anchor.cone],
    ['shuttle', testing.shuttle, anchor.shuttle],
  ];
  for (const [key, v, [mean, sd]] of timed) if (v != null && sd > 0) add(key, (mean - v) / sd);
  const scored: [CombineMeasurable, number | null | undefined, [number, number]][] = [
    ['vertical', testing.vertical, anchor.vertical],
    ['broadJump', testing.broadJump, anchor.broad],
    ['benchReps', testing.benchReps, anchor.bench],
  ];
  for (const [key, v, [mean, sd]] of scored) if (v != null && sd > 0) add(key, (v - mean) / sd);
  if (total <= 0) return null;
  return normalCdf(sum / total);
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
 * THE ATHLETIC RANK — one public figure per prospect, against his own position
 * ===========================================================================
 * "Athletic 4 of 16" is the fourth-best tester among the sixteen left tackles
 * in this draft class. It is built by ranking every drill a man ran against
 * the men at HIS OWN POSITION, taking a WEIGHTED mean of those finishes — the
 * weight being what that drill is worth at that position — and then ordering
 * his POSITION GROUP on that mean.
 *
 * THE MEAN WAS UNWEIGHTED AND THAT WAS THE SECOND WRONG DENOMINATOR. The app
 * owner, on seeing a 290lb tackle read as an ordinary athlete off an excellent
 * tackle workout: *"and remember, athletic testing matters differently across
 * position. 40 time matters more for a CB than it does a LT."* He had run 5.29
 * — twelfth of sixteen — and finished FIRST in his group in the three-cone,
 * FIRST in the shuttle and SECOND on the bench, and the drill that means least
 * for the job he is being hired to do was counting for exactly as much of his
 * rank as the three that mean most. The weights are in POSITION_DRILL_WEIGHTS
 * (lib/gen/prospectProfile.ts) and they are DERIVED from the engine's own
 * account of what each position's play is made of, not typed in.
 *
 * IT USED TO BE ORDERED AGAINST THE WHOLE CLASS AND THAT WAS THE WRONG
 * DENOMINATOR. Each drill was already placed inside the position group — a
 * 330-pound tackle is never going to run a 4.4, so ranking the raw stopwatch
 * across a class turns the column into a proxy for "is he a skill player",
 * which tells a front office nothing it could not read off the position badge
 * — but the headline that came out of it read "67th of 400 in the class", and
 * a tackle is not chosen out of four hundred men. The app owner: *"it should
 * also be ranked against same position players, not the general class."* So
 * the average is now ordered inside the group too, and the number a GM reads
 * is where this man stands among the tackles he is actually choosing between.
 *
 * The cross-class neutrality measurement the old ordering needed is gone with
 * it. It existed to show that a position-relative average produced a flat
 * spread of ranks across the sixteen positions; a rank scoped to the position
 * is flat by construction, because every group runs 1..n.
 *
 * WHAT IT DOES AND DOES NOT GIVE AWAY. Testing is public — every club watched
 * the same stopwatch, and the six numbers are already printed in full on the
 * player card — so this is arithmetic over visible data and is never fogged.
 * It does carry real signal about ability, because good players do tend to
 * test well (see COMBINE.ABILITY_WEIGHT), and it is MEANT to: the app owner
 * asked for combine testing to be one of the ways a GM spots a late-round gem.
 * Measured over 40 generated classes (16,000 prospects, scripts/_cg_gem.ts,
 * career peaks rolled through lib/progression.ts), inside a position
 * group it runs rho -0.56 against a man's true overall, against rho -0.69 for
 * the CONSENSUS BOARD RANK sitting two columns away on the same table — which
 * is equally free to every club — and once that board rank is held fixed this
 * figure adds rho -0.35 of its own. On the classes actually sitting in the
 * local database (scripts/_cg_db.ts, four saves) the same partial reads -0.32
 * to -0.40.
 *
 * THAT LAST NUMBER IS DELIBERATE AND IT IS CAPPED ON PURPOSE. It was -0.20,
 * which was too little for testing to be worth acting on at all; it is not
 * -0.7, because a public column that reliably beat the board would end
 * scouting. What it buys, over the same 40 classes:
 *
 *                                                       before     after
 *   rounds 4-7 top-quartile tester -> 70+ starter        68.5%     73.9%
 *   ... base rate for rounds 4-7                         66.1%     65.9%
 *   rounds 1-2 top-quartile tester -> bust (<78)         17.7%     15.9%
 *   ... base rate for rounds 1-2                         22.1%     22.3%
 *   "best tester of the 8 left" beats "best board rank"  34.8%     41.6%
 *   ... and loses to it                                  38.9%     39.4%
 *
 * Before the change, tilting late picks toward the stopwatch LOST money — 73.2
 * mean career peak against the board's 74.1. It now runs 74.3 against 74.7 and
 * lands more quality starters (37.2% at 78-plus against the board's 34.0%),
 * which is an edge worth taking without being a free one. Following testing
 * ALONE — best tester anywhere on the board — is still a disaster (38.6%
 * starters against the board's 71.8%), which is what stops the draft being
 * solved by a stopwatch.
 *
 * WHAT THE POSITION WEIGHTS THEN BOUGHT, and it is the interaction rather than
 * either half. The room's forty fixation stays GLOBAL (CONSENSUS.FORTY_FIXATION
 * — a bias that adjusted itself sensibly by position would not be one), so the
 * board now pays for a drill that only predicts anything at some positions.
 * The men it underpays hardest are exactly the owner's tackle. Measured over
 * 30 freshly generated classes (11,796 tested prospects, scripts/_pdw_bargain.ts,
 * career peaks rolled through lib/progression.ts), among picks in rounds 4-7:
 *
 *                                            n    mean board   peak   70+ starter
 *   every pick in rounds 4-7               3798      160       70.7      55.7%
 *   slow forty + top-quartile, OLD flat      102      150       78.0      90.2%
 *   slow forty + top-quartile, position-w    122      153       77.5      86.1%
 *
 * The cohort was always good; the weighted composite finds a FIFTH MORE of
 * them at the same quality — 105 starters against 92 — and on the offensive
 * line, where the forty is worth 0.07 of a man's rank against a corner's 0.21,
 * it finds 49 against 36. Over 40 classes the class-wide acceptance numbers
 * move with it (scripts/_pdw_measure.ts, an in-memory rebuild of the harness
 * the figures above this paragraph came from, so it is the before-and-after
 * that is comparable and not the levels):
 *
 *                                                       before     after
 *   rounds 4-7 top-quartile tester -> 70+ starter        62.2%     63.7%
 *   ... base rate for rounds 4-7                         55.5%     55.6%
 *   rounds 1-2 top-quartile tester -> bust (<78)         25.2%     25.4%
 *   ... base rate for rounds 1-2                         34.6%     34.6%
 *   "best tester of the 8 left" beats "best board rank"  45.4%     46.0%
 *   ... and loses to it                                  38.7%     38.0%
 *   following the stopwatch ALONE -> 70+ starters        62.8%     63.3%
 *   ... against the BOARD alone                          68.8%     68.9%
 *   board+athletic recovering an unscouted true rating   0.715     0.719
 *
 * The last two are the guard rails and both held: the stopwatch on its own is
 * still six points of starter rate worse than simply following the board, so
 * scouting still has to happen, and the fog is where it was.
 *
 * MISSING EVENTS ARE AVERAGED OVER, NEVER SCORED AS FAILURES. A man is ranked
 * on the drills he actually ran; a corner who was never going to bench is not
 * pushed down his group for it, because the battery that group runs is
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
  /** 1 = the best tester at his position in this class. Ties share a rank. */
  rank: number;
  /** Men at HIS POSITION in this class with testing numbers on file — the denominator. */
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
      const ranked = rankProspectCombine(p.testing, peers.get(p.position)!);
      const finishes = Object.entries(ranked)
        .filter((e): e is [CombineMeasurable, MeasurableRank] => e[1] != null);
      /*
       * THE AVERAGE IS NOT AN AVERAGE ANY MORE, AND THAT IS THE POINT. It used
       * to be the plain mean of his six finishes, which said a forty was worth
       * as much to a left tackle as to a corner. It is now weighted by what
       * each drill is worth AT HIS POSITION — see positionDrillWeights above,
       * derived from the engine's own account of what his job is made of.
       *
       * Weights are relative and are renormalised over the drills he actually
       * RAN (the divisor is the weight accumulated, not a constant), so a
       * corner who was never going to bench has that column dropped and the
       * other five rescaled, exactly as before. A position with no weights at
       * all falls back to 1 apiece, which is the old flat mean.
       */
      const w6 = positionDrillWeights(p.position);
      let wSum = 0;
      let wTotal = 0;
      for (const [key, r] of finishes) {
        const w = w6?.[key] ?? 1;
        if (w <= 0) continue;
        // MeasurableRank.percentile is rounded to a whole number, which is
        // right on a card tile and wrong as an input to an average: a group of
        // twenty-five offers only twenty-five finishes, so six rounded
        // percentiles land on a coarse lattice and men collide who are not
        // level. Measured over 158 classes, averaging the rounded figure left
        // 39.8% of every class sharing a rank with somebody. This is
        // rankValue's own formula with the rounding left off — the same
        // finish, at full precision.
        wSum += w * ((100 * (r.outOf - r.rank)) / (r.outOf - 1));
        wTotal += w;
      }
      return {
        id: p.id,
        position: p.position,
        events: finishes.length,
        percentile: wTotal <= 0 ? null : wSum / wTotal,
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
   * ONE ORDERING PER POSITION GROUP, never one across the class — that is the
   * whole of the scoping change, and it is done here rather than at either
   * call site so the draft board and the player card cannot disagree about the
   * same man. They read this one function; the previous round of this feature
   * had to fix exactly that kind of disagreement.
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
  const out = new Map<string, AthleticRead>();
  const groups = new Map<string, typeof scored>();
  for (const s of scored) {
    const list = groups.get(s.position);
    if (list) list.push(s);
    else groups.set(s.position, [s]);
  }
  for (const group of groups.values()) {
    const ordered = group.slice().sort((a, b) => b.percentile - a.percentile || b.precise - a.precise);
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
  }
  return out;
}
