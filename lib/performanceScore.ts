import { SeasonStats } from './types';
import { Position, canonicalPosition } from './tuning';
import { careerColumns } from './statLabels';

/**
 * ===========================================================================
 * PERFORMANCE SCORE — HOW GOOD WAS THAT, FOR A PLAYER AT HIS POSITION?
 * ===========================================================================
 * One definition of "who played well", used by everything that has to rank
 * players against each other. Two features depend on it — All-Star selection
 * (lib/allStars.ts) ranks a season, the week report's Coach's Comments ranks a
 * week — and they must not disagree about who is good.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT `statScore` / `offensiveScore`
 * ---------------------------------------------------------------------------
 * lib/awards.ts scores everyone through one hand-weighted formula:
 * `passYds * 0.04 + passTd * 4 + rushYds * 0.1 + ...`. That is fine for naming
 * an MVP, where the quarterback usually IS the answer, and quietly wrong
 * everywhere else: passing yards are simply a bigger number than any other
 * statistic in the sport, so a formula that puts them on one scale with
 * everything else hands the quarterback the trophy by arithmetic rather than
 * by merit. Measured, it gave the game ball to a quarterback in four weeks
 * out of six.
 *
 * There is no set of coefficients that fixes this, because the question
 * "was 96 receiving yards a better afternoon than 7 tackles and a sack" has no
 * answer in yards. It only has an answer in DISTRIBUTION: how unusual was each
 * of those, for a player at that position?
 *
 * ---------------------------------------------------------------------------
 * THE METHOD
 * ---------------------------------------------------------------------------
 * Every stat becomes a z-score against the players who play that position —
 * standard deviations above the positional mean — and a position's stats are
 * combined into a weighted mean of those z-scores. The output is in units of
 * "how far above an ordinary outing at this position", which is the SAME unit
 * at every position. A defensive tackle's nine sacks and a quarterback's 4,800
 * yards land on one scale without either being converted into the other.
 *
 * WHICH stats count comes from `CAREER_COLUMNS` in lib/statLabels.ts, the file
 * that already answers "which numbers define this position?", and the WEIGHTS
 * come from that file's `lead` ranks, which already answer "which of them does
 * a broadcast graphic lead with". Nothing about what matters at a position is
 * written down in two places.
 *
 * ---------------------------------------------------------------------------
 * THE DISTRIBUTION IS A PARAMETER, ON PURPOSE
 * ---------------------------------------------------------------------------
 * A season and a single game are not the same population, and a function that
 * quietly assumed one would lie to the other: 4,800 passing yards is an
 * extraordinary season and an impossible afternoon; 280 is a fine afternoon
 * and a catastrophic season. So the caller builds the distribution from the
 * population it actually means — season totals for All-Star selection, this
 * week's box lines for the week report — and passes it in. The scoring is
 * identical either way; only the yardstick changes.
 *
 * The scale is unitless (standard deviations), so a season score and a week
 * score are directly readable against each other as "how exceptional", which
 * is exactly what both callers want and neither could get from raw totals.
 * ===========================================================================
 */

/** `lead` rank -> weight. Unranked columns are context, not the case. */
const LEAD_WEIGHT: Record<number, number> = { 1: 3, 2: 2, 3: 1 };
const CONTEXT_WEIGHT = 0.5;

/**
 * Stats where a bigger number is a worse outing. Negated before scoring, so a
 * quarterback's interceptions cut against him exactly as far as their
 * `lead: 3` rank says they should.
 */
const NEGATIVE_KEYS = new Set(['int', 'fum']);

/**
 * Attempts are opportunity, not production, and the converted column is
 * already counted — a kicker's merit is the field goals he made, not the ones
 * he lined up for; a quarterback's is the yards, not the drop-backs. Scoring
 * both double-counts volume and answers "who got the most work" when the
 * question was "who was best". They stay in CAREER_COLUMNS because a stat
 * TABLE should show attempts; they earn nothing here.
 */
const OPPORTUNITY_KEYS = new Set([
  'passAtt', 'rushAtt', 'targets', 'fga', 'xpa',
  // A punter's volume AND his gross yardage are both facts about how often his
  // offense went three-and-out, not about him: punt yards are punts times
  // average, and the average is the only half he controls. Scoring the total
  // put a 46.2-yard punter with 91 kicks ahead of a 46.5-yard punter with 69,
  // which rewards playing behind the worse team. `puntAvg` below is the merit.
  'punts', 'puntYds',
]);

/**
 * Rate stats the raw columns cannot express, added per position.
 *
 * A punter's season is his average, not his volume — `punts` is the only
 * counting column he has, and ranking punters by it would hand the honour to
 * whoever played behind the worst offense in the league. Same for a kicker's
 * accuracy. Rates need a real sample to mean anything, and guarding that is
 * the CALLER's job (lib/allStars.ts requires half a season of appearances) —
 * this file does not know how big a sample it is looking at, which is the
 * same reason the distribution is a parameter.
 */
const DERIVED_STATS: Partial<Record<Position, { key: string; weight: number; of: (s: SeasonStats) => number | null }[]>> = {
  K: [{ key: 'fgPct', weight: 2, of: (s) => ((s.fga ?? 0) > 0 ? (s.fgm ?? 0) / (s.fga ?? 1) : null) }],
  P: [{ key: 'puntAvg', weight: 3, of: (s) => ((s.punts ?? 0) > 0 ? (s.puntYds ?? 0) / (s.punts ?? 1) : null) }],
};

export interface ScoredStat {
  key: string;
  weight: number;
  /** Already signed — a negative stat arrives here flipped, so bigger is always better. */
  value: number;
}

/**
 * The quantities that make up a player's case at his position, signed and
 * weighted. Pure: no database, no league, no distribution.
 */
export function scoredStats(position: string, s: SeasonStats): ScoredStat[] {
  const pos = canonicalPosition(position);
  const out: ScoredStat[] = [];
  for (const col of careerColumns(pos)) {
    if (OPPORTUNITY_KEYS.has(col.key)) continue;
    const weight = col.lead ? LEAD_WEIGHT[col.lead] : CONTEXT_WEIGHT;
    const raw = (s as Record<string, number | undefined>)[col.key] ?? 0;
    out.push({ key: col.key, weight, value: NEGATIVE_KEYS.has(col.key) ? -raw : raw });
  }
  for (const d of DERIVED_STATS[pos] ?? []) {
    const v = d.of(s);
    if (v !== null) out.push({ key: d.key, weight: d.weight, value: v });
  }
  return out;
}

/** Mean and standard deviation of each scored stat among a population of outings. */
export interface PositionDistribution {
  position: string;
  /** How many outings the yardstick was built from — a caller can refuse a tiny one. */
  n: number;
  mean: Record<string, number>;
  sd: Record<string, number>;
}

export function buildPositionDistribution(position: string, pool: SeasonStats[]): PositionDistribution {
  const values = new Map<string, number[]>();
  for (const s of pool) {
    for (const st of scoredStats(position, s)) {
      const arr = values.get(st.key) ?? [];
      arr.push(st.value);
      values.set(st.key, arr);
    }
  }
  const mean: Record<string, number> = {};
  const sd: Record<string, number> = {};
  for (const [key, arr] of values) {
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    mean[key] = m;
    sd[key] = Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
  }
  return { position, n: pool.length, mean, sd };
}

/**
 * Build a yardstick per position from a mixed population in one pass — the
 * shape both callers actually want, since neither has a single position's
 * players in hand.
 */
export function buildPositionDistributions(
  pool: { position: string; stats: SeasonStats }[],
): Map<string, PositionDistribution> {
  const byPosition = new Map<string, SeasonStats[]>();
  for (const p of pool) {
    const pos = canonicalPosition(p.position);
    const arr = byPosition.get(pos) ?? [];
    arr.push(p.stats);
    byPosition.set(pos, arr);
  }
  const out = new Map<string, PositionDistribution>();
  for (const [pos, stats] of byPosition) out.set(pos, buildPositionDistribution(pos, stats));
  return out;
}

/**
 * How far above an ordinary outing at his position this was, in standard
 * deviations. Zero is exactly the positional average; negative is below it.
 * Comparable across positions, which is the entire point.
 *
 * Returns 0 for a position the sim records no statistics for (the offensive
 * line has no columns at all) — there is nothing to measure, and callers must
 * treat that as "unmeasurable", never as "average".
 */
export function positionRelativeScore(position: string, s: SeasonStats, dist: PositionDistribution): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const st of scoredStats(position, s)) {
    // A column where nobody's number varies carries no signal, and a zero
    // standard deviation would divide by zero — it contributes a z of 0
    // rather than an infinity.
    const sd = dist.sd[st.key] ?? 0;
    const z = sd > 1e-9 ? (st.value - (dist.mean[st.key] ?? 0)) / sd : 0;
    weighted += z * st.weight;
    totalWeight += st.weight;
  }
  return totalWeight > 0 ? weighted / totalWeight : 0;
}

/** True when the sim records enough about this position to rank it at all. */
export function isRankablePosition(position: string): boolean {
  return careerColumns(canonicalPosition(position)).length > 0;
}
