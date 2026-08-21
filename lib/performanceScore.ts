import type { SeasonStats } from './types';
import { careerColumns, StatColumn } from './statLabels';

/**
 * ===========================================================================
 * POSITION-RELATIVE PERFORMANCE SCORE
 * ===========================================================================
 * A second, deliberately different answer to "how good was that game?".
 *
 * lib/news.ts's `statScore` answers "how newsworthy is this line?" in a single
 * cross-position currency: a passing yard is 1, a passing touchdown is 50. It
 * is the right shape for a headline feed — a 400-yard afternoon IS the league
 * story — and it is left completely untouched, because it decides which
 * performances become news and quietly changing it would change the news.
 *
 * It is the wrong shape for a LIST. Measured over this database's 16,025
 * played games, a starting quarterback's median line already scores 231 yards
 * + 2 TD = 331, while a median running back's whole day scores 53 * 1.5 = 80.
 * Rank a roster by that and every top-performers list is four quarterbacks and
 * a receiver, forever. That is worse than not building the list.
 *
 * So this module measures a player against WHAT IS NORMAL FOR HIS POSITION.
 * A safety with a pick and three passes defended is a 97th-percentile safety
 * game; a quarterback with 231 and 2 is a 50th-percentile quarterback game.
 * Those are the numbers a coach actually reacts to.
 *
 * WHERE THE NORMS COME FROM. Not from intuition — from the box scores already
 * in the database. `scripts/` generated the tables below by reading every
 * played game in this Postgres (16,025 games, 781,420 individual box lines)
 * and taking the 1st/5th/10th/25th/50th/75th/90th/95th/99th percentile of
 * every stat, per position. They are baked in as literals rather than queried
 * so grading costs no database round trip and no measurable time.
 *
 * WHICH STATS COUNT is NOT re-decided here. It is read straight off
 * lib/statLabels.ts's CAREER_COLUMNS — the one place that answers "which
 * numbers define this position?" — including its `lead` ranking, which
 * becomes the weight. This module only adds the one thing a stat page has no
 * reason to know: a stat's DIRECTION (an interception thrown is not a good
 * thing) and whether it is a result or merely volume (attempts are not an
 * achievement).
 *
 * HONESTY LIMITS, read off lib/sim/engine.ts's allocateStats() and enforced
 * below rather than papered over:
 *  - There are no fumbles. `fum` is never written by the engine, so nothing
 *    here may say a player put the ball on the ground.
 *  - `teamStats.thirdDownConv` is `plays/6` over `plays/4` — a constant ~67%
 *    for every team in every game. It is not a real conversion rate and is
 *    never quoted.
 *  - `teamStats.penalties` is `plays/12`. Also not real, also never quoted,
 *    and certainly never attributed to a player.
 *  - `teamStats.passYards`/`rushYards` are a flat 60/40 split of total yards.
 *    The per-player lines carry the real split, so unit yardage is summed
 *    from the lines instead.
 *  - A punter's yards are `punts * rng.int(40, 50)` — pure dice, no input
 *    from his rating. Praising a punt average would be praising a coin flip,
 *    so P is excluded from grading entirely.
 *  - Offensive linemen get no box line at all, which is exactly why
 *    CAREER_COLUMNS gives them no columns. They cannot be graded and are not.
 * ===========================================================================
 */

// ---------------------------------------------------------------------------
// The norms
// ---------------------------------------------------------------------------

/** The percentile each slot of a NORMS row stands for. */
const LEVELS = [1, 5, 10, 25, 50, 75, 90, 95, 99] as const;

/**
 * Percentile ladders per position per stat, from every played game in the
 * database. Regenerate by re-running the sampler if the engine's allocation
 * ever changes; a stale ladder makes the grades wrong, not just imprecise.
 *
 * Read the flatness as information, not as noise: an LB's whole ladder is
 * 4-4-4-4-5-5-5-5-6, because the engine hands every linebacker between four
 * and seven tackles and nothing else but a 6% forced-fumble roll. That is a
 * real and severe ceiling on how much a linebacker can distinguish himself in
 * this simulation, and `GROUP_OF` below is what stops it from being read as
 * "the linebacker had the best game on the field".
 */
const NORMS: Record<string, Record<string, number[]>> = {
  QB: {
    passYds: [105, 135, 153, 187, 231, 279, 326, 356, 416],
    passTd: [0, 0, 1, 1, 2, 3, 3, 4, 5],
    int: [0, 0, 0, 0, 1, 1, 2, 2, 3],
    rushYds: [-18, -10, -5, 2, 10, 18, 25, 30, 38],
    cmpPct: [0.519, 0.551, 0.568, 0.596, 0.627, 0.659, 0.686, 0.702, 0.731],
    ypa: [2.94, 3.605, 3.971, 4.621, 5.409, 6.25, 7.08, 7.621, 8.744],
  },
  RB: {
    rushYds: [14, 20, 24, 34, 53, 82, 113, 131, 168],
    rushTd: [0, 0, 0, 0, 0, 1, 1, 2, 3],
    rec: [0, 0, 0, 0, 1, 2, 3, 4, 4],
    recYds: [0, 0, 1, 3, 6, 10, 16, 19, 22],
    ypc: [2.727, 3.412, 3.818, 4.5, 5.364, 6.308, 7.25, 7.882, 9.167],
  },
  WR: {
    recYds: [14, 19, 22, 29, 41, 57, 73, 83, 102],
    rec: [2, 2, 3, 3, 5, 6, 8, 9, 11],
    recTd: [0, 0, 0, 0, 0, 1, 1, 1, 1],
    targets: [3, 4, 4, 6, 8, 10, 13, 14, 17],
    catchRate: [0.4, 0.5, 0.5, 0.556, 0.6, 0.667, 0.75, 0.778, 0.833],
  },
  TE: {
    recYds: [11, 14, 16, 21, 28, 39, 48, 54, 65],
    rec: [1, 2, 2, 2, 3, 4, 5, 6, 7],
    recTd: [0, 0, 0, 0, 0, 0, 1, 1, 1],
    targets: [3, 3, 3, 4, 5, 7, 8, 9, 10],
    catchRate: [0.4, 0.5, 0.5, 0.5, 0.6, 0.714, 0.75, 0.778, 0.833],
  },
  EDGE: {
    tackles: [3, 4, 4, 4, 4, 5, 5, 5, 6],
    sacks: [0, 0, 0, 0, 0, 1, 1, 1, 1],
    ff: [0, 0, 0, 0, 0, 0, 0, 1, 1],
  },
  DT: {
    tackles: [3, 4, 4, 4, 4, 5, 5, 5, 6],
    sacks: [0, 0, 0, 0, 0, 0, 1, 1, 1],
    ff: [0, 0, 0, 0, 0, 0, 0, 1, 1],
  },
  LB: {
    tackles: [4, 4, 4, 4, 5, 5, 5, 5, 6],
    ff: [0, 0, 0, 0, 0, 0, 0, 1, 1],
  },
  CB: {
    tackles: [3, 4, 4, 4, 4, 5, 5, 5, 6],
    defInt: [0, 0, 0, 0, 0, 0, 0, 1, 1],
    pd: [0, 0, 0, 0, 0, 1, 3, 3, 3],
    ff: [0, 0, 0, 0, 0, 0, 0, 1, 1],
  },
  S: {
    tackles: [4, 4, 4, 4, 5, 5, 5, 5, 6],
    defInt: [0, 0, 0, 0, 0, 0, 1, 1, 1],
    pd: [0, 0, 0, 0, 0, 1, 3, 3, 3],
    ff: [0, 0, 0, 0, 0, 0, 0, 1, 1],
  },
  K: {
    fgm: [0, 0, 0, 1, 1, 2, 3, 4, 5],
    xpm: [0, 0, 1, 2, 3, 4, 5, 6, 7],
    fgPct: [0, 0.333, 0.5, 0.667, 1, 1, 1, 1, 1],
  },
};

/**
 * Where a value sits in its position's ladder, 0-100.
 *
 * The flat-run rule is the whole trick. Half of every ladder above is a run
 * of identical integers, because the engine deals in small whole numbers. A
 * plain interpolation would call a linebacker's utterly ordinary 5 tackles a
 * 50th-percentile game at one end of the run and a 95th-percentile game at
 * the other, purely from where the ladder happened to be sampled. Landing on
 * a run returns the MIDDLE of it, which is the mid-rank percentile — the same
 * answer a full sort of all 94,009 linebacker lines would give.
 */
export function positionPercentile(position: string, key: string, value: number): number | null {
  const ladder = NORMS[position]?.[key];
  if (!ladder) return null;
  if (value < ladder[0]) return 0;
  if (value > ladder[ladder.length - 1]) return 100;
  let first = -1;
  let last = -1;
  for (let i = 0; i < ladder.length; i++) {
    if (ladder[i] === value) { if (first < 0) first = i; last = i; }
  }
  if (first >= 0) return (LEVELS[first] + LEVELS[last]) / 2;
  for (let i = 0; i < ladder.length - 1; i++) {
    if (value > ladder[i] && value < ladder[i + 1]) {
      const t = (value - ladder[i]) / (ladder[i + 1] - ladder[i]);
      return LEVELS[i] + t * (LEVELS[i + 1] - LEVELS[i]);
    }
  }
  return 50;
}

// ---------------------------------------------------------------------------
// Direction and role
// ---------------------------------------------------------------------------

/** Stats that are worse the higher they go. */
const NEGATIVE = new Set(['int', 'fum']);
/**
 * Stats that measure how often a player was ASKED to do something, not how
 * well he did it. They still gate everything below — a rate on four snaps is
 * not a performance — but they never earn a grade. Without this, a kicker who
 * went 1-for-5 would out-grade one who went 2-for-2, because CAREER_COLUMNS
 * quite correctly ranks `fga` as a kicker's second-most defining number.
 */
const VOLUME_ONLY = new Set(['gp', 'passAtt', 'passCmp', 'rushAtt', 'targets', 'fga', 'xpa', 'punts', 'puntYds']);

/** [TUNE] Weight by CAREER_COLUMNS' `lead` rank. Unranked columns still count. */
const LEAD_WEIGHT: Record<number, number> = { 1: 3, 2: 2, 3: 1 };
const UNRANKED_WEIGHT = 0.75;

/**
 * Efficiency terms, added on top of the columns. These exist because a rate
 * is the only part of some lines the engine varies per PLAYER rather than per
 * team: a quarterback's completion rate is rolled off his own rating
 * (`allocateStats` line 318), and a receiver's catch rate off his own noise
 * draw. Each carries the minimum volume below which the rate is meaningless.
 */
interface EffTerm { key: string; num: keyof SeasonStats; den: keyof SeasonStats; gate: number; weight: number }
const EFFICIENCY: Record<string, EffTerm[]> = {
  QB: [
    { key: 'cmpPct', num: 'passCmp', den: 'passAtt', gate: 15, weight: 1.5 },
    { key: 'ypa', num: 'passYds', den: 'passAtt', gate: 15, weight: 1.0 },
  ],
  RB: [{ key: 'ypc', num: 'rushYds', den: 'rushAtt', gate: 8, weight: 1.0 }],
  WR: [{ key: 'catchRate', num: 'rec', den: 'targets', gate: 4, weight: 1.0 }],
  TE: [{ key: 'catchRate', num: 'rec', den: 'targets', gate: 4, weight: 1.0 }],
  K: [{ key: 'fgPct', num: 'fgm', den: 'fga', gate: 2, weight: 2.0 }],
};

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

export interface GradeBreakdown {
  key: string;
  /** 0-100 percentile among this position's games. */
  pct: number;
  weight: number;
  value: number;
}

export interface Grade {
  /** 0-100. 50 is a median game AT THIS POSITION, not a median game. */
  score: number;
  parts: GradeBreakdown[];
  /** The single stat that carried the grade — what the comment leads with. */
  headline: GradeBreakdown | null;
}

/**
 * Grade one line, per game. For a multi-week span the caller grades each
 * week separately and averages — the ladders are per-game distributions, so
 * feeding them a seven-game total would put every starter above the 99th
 * percentile and mean nothing.
 */
export function gradeLine(position: string, stats: SeasonStats): Grade | null {
  const cols = careerColumns(position);
  if (cols.length === 0 || !NORMS[position]) return null;

  const parts: GradeBreakdown[] = [];
  let sum = 0;
  let weightSum = 0;

  const add = (key: string, value: number, pctRaw: number | null, weight: number, negative: boolean) => {
    if (pctRaw === null) return;
    const pct = negative ? 100 - pctRaw : pctRaw;
    parts.push({ key, pct, weight, value });
    sum += pct * weight;
    weightSum += weight;
  };

  for (const c of cols as StatColumn[]) {
    if (VOLUME_ONLY.has(c.key)) continue;
    const value = (stats as Record<string, number | undefined>)[c.key] ?? 0;
    const weight = c.lead ? LEAD_WEIGHT[c.lead] : UNRANKED_WEIGHT;
    add(c.key, value, positionPercentile(position, c.key, value), weight, NEGATIVE.has(c.key));
  }

  for (const e of EFFICIENCY[position] ?? []) {
    const den = (stats[e.den] as number | undefined) ?? 0;
    if (den < e.gate) continue;
    const num = (stats[e.num] as number | undefined) ?? 0;
    add(e.key, num / den, positionPercentile(position, e.key, num / den), e.weight, false);
  }

  if (weightSum === 0) return null;
  const score = sum / weightSum;

  // The headline is the highest-percentile part that is actually good and
  // actually carries weight — never a negative one, because "he threw the
  // fewest interceptions" is not why anybody gets mentioned.
  // Sorted by PERCENTILE, not by percentile x weight. A safety's five
  // tackles carry more weight than his interception does, but the pick is
  // what happened — leading the sentence with the tackles because they are
  // the position's headline column would bury the only rare thing in the
  // line.
  const headline = parts
    .filter((p) => !NEGATIVE.has(p.key) && p.pct >= 60 && p.weight >= 1)
    .sort((a, b) => (b.pct - a.pct) || (b.weight - a.weight))[0] ?? null;

  return { score, parts, headline };
}

// ---------------------------------------------------------------------------
// Units — how the comments stay position-diverse BY CONSTRUCTION
// ---------------------------------------------------------------------------

export type UnitKey = 'QB' | 'BACKS' | 'RECEIVERS' | 'PASS_RUSH' | 'BACK_SEVEN' | 'KICKING';

export const UNIT_OF: Record<string, UnitKey> = {
  QB: 'QB',
  RB: 'BACKS',
  WR: 'RECEIVERS', TE: 'RECEIVERS',
  EDGE: 'PASS_RUSH', DT: 'PASS_RUSH',
  LB: 'BACK_SEVEN', CB: 'BACK_SEVEN', S: 'BACK_SEVEN',
  K: 'KICKING',
};

/**
 * Coach-room order. The list is ordered by UNIT, not by grade, and that is a
 * deliberate refusal rather than an oversight: grades are only comparable
 * INSIDE a unit. A linebacker's ladder tops out at six tackles and a forced
 * fumble, which the maths quite correctly calls a 98th-percentile linebacker
 * game — but printing him above a 400-yard quarterback because 98 > 71 would
 * be inventing a cross-position comparison the numbers cannot support. One
 * mention per unit, in the order a coach walks the room.
 */
export const UNIT_ORDER: UnitKey[] = ['QB', 'BACKS', 'RECEIVERS', 'PASS_RUSH', 'BACK_SEVEN', 'KICKING'];

export const UNIT_LABEL: Record<UnitKey, string> = {
  QB: 'Under center',
  BACKS: 'Backfield',
  RECEIVERS: 'Receivers',
  PASS_RUSH: 'Front',
  BACK_SEVEN: 'Back seven',
  KICKING: 'Kicking',
};

/**
 * [TUNE] A unit only earns a mention when its best line cleared this
 * percentile for the position. 72 is roughly "clearly better than a normal
 * day" — below it a coach has nothing to single anybody out for, and a
 * mention manufactured to fill a slot is exactly the noise this section is
 * supposed to avoid.
 */
export const MENTION_BAR = 72;
/** [TUNE] Never more than this many, however good the week was. */
export const MAX_MENTIONS = 5;

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/**
 * Minimum workload, per game, before a line is allowed to be graded at all.
 * The third-string tight end who ran four routes is not a top performer and
 * is emphatically not a worst performer; he is a man who did not play.
 * Defenders have no gate because the engine only writes a box line for the
 * defenders who were actually on the field.
 */
const TOUCH_GATE: Record<string, (s: SeasonStats, games: number) => boolean> = {
  QB: (s, g) => (s.passAtt ?? 0) >= 12 * g,
  RB: (s, g) => (s.rushAtt ?? 0) + (s.rec ?? 0) >= 5 * g,
  WR: (s, g) => (s.targets ?? 0) >= 3 * g,
  TE: (s, g) => (s.targets ?? 0) >= 3 * g,
  K: (s, g) => (s.fga ?? 0) + (s.xpa ?? 0) >= 2 * g,
};

export function playedEnough(position: string, stats: SeasonStats, games = 1): boolean {
  const gate = TOUCH_GATE[position];
  return gate ? gate(stats, Math.max(1, games)) : true;
}

// ---------------------------------------------------------------------------
// Stat-line rendering
// ---------------------------------------------------------------------------

/** Numerator/denominator pairs a box score prints as one figure. */
const RATIOS: [string, string, string][] = [
  ['passCmp', 'passAtt', ''],
  ['fgm', 'fga', ' FG'],
  ['xpm', 'xpa', ' XP'],
];

/**
 * Reading units for the spoken line — "288 yd", not "288 Yds". Keyed by
 * position first because the same column means a different thing in a
 * different line: `rushYds` is THE number on a running back's line and a
 * footnote on a quarterback's, and only one of them needs the word "rush".
 */
const UNIT_WORD: Record<string, string> = {
  passYds: 'yd', rushYds: 'yd', recYds: 'yd', passTd: 'TD', rushTd: 'TD', recTd: 'TD',
  int: 'INT', tackles: 'tkl', sacks: 'sk', defInt: 'INT', pd: 'PD', ff: 'FF',
  rec: 'rec', rushAtt: 'car', targets: 'tgt', fgm: 'FG', xpm: 'XP',
  punts: 'punts', puntYds: 'punt yd',
};
const UNIT_WORD_BY_POS: Record<string, Record<string, string>> = {
  QB: { rushYds: 'rush yd' },
  RB: { recYds: 'rec yd' },
};

function unitWord(position: string, key: string, fallback: string): string {
  return UNIT_WORD_BY_POS[position]?.[key] ?? UNIT_WORD[key] ?? fallback;
}

/**
 * The stat line as a coach would read it aloud, built by walking
 * CAREER_COLUMNS for the position. Nothing decides here which numbers matter;
 * lib/statLabels.ts already did, and reusing it is what keeps this line and
 * the player page's career table from ever disagreeing about a position.
 */
export function statLine(position: string, stats: SeasonStats): string {
  const cols = careerColumns(position);
  const s = stats as Record<string, number | undefined>;
  const used = new Set<string>(['gp']);
  const parts: string[] = [];

  for (const [num, den, suffix] of RATIOS) {
    if (!cols.some((c) => c.key === num) || !cols.some((c) => c.key === den)) continue;
    if ((s[den] ?? 0) === 0) continue;
    used.add(num); used.add(den);
    parts.push(`${s[num] ?? 0}/${s[den]}${suffix}`);
  }
  // Receptions and targets stay two figures rather than a ratio: the catch
  // rate is the point, and "10 rec (15 tgt)" is how it is read out loud.
  if (cols.some((c) => c.key === 'rec') && cols.some((c) => c.key === 'targets') && (s.targets ?? 0) > 0) {
    used.add('rec'); used.add('targets');
    parts.push(`${s.rec ?? 0} rec (${s.targets} tgt)`);
  }

  for (const c of cols) {
    if (used.has(c.key)) continue;
    const v = s[c.key] ?? 0;
    // A zero is worth printing only when its absence would be the point —
    // a clean sheet at quarterback is news, a tight end's zero forced
    // fumbles is not.
    const keepZero = NEGATIVE.has(c.key) && (s.passAtt ?? 0) > 0;
    if (v === 0 && !keepZero) continue;
    parts.push(`${v} ${unitWord(position, c.key, c.short)}`);
  }
  return parts.join(' · ') || 'took the field';
}

// ---------------------------------------------------------------------------
// Concerns — the careful half
// ---------------------------------------------------------------------------

export type ConcernKind = 'TURNOVERS' | 'ACCURACY' | 'EFFICIENCY' | 'HANDS' | 'KICKING';

export interface Concern {
  kind: ConcernKind;
  /** The literal number the mention rests on. No adjective without one. */
  fact: string;
  severity: number;
}

/**
 * What actually went wrong, and nothing else.
 *
 * Every rule here has two halves: a VOLUME gate and a BAD OUTCOME. A quiet
 * game is not a bad game, and a backup's four snaps are not a game at all —
 * naming a third-string receiver for catching nothing is noise at best and,
 * since a real person is managing that roster, a small unfairness at worst.
 * So nothing appears in this list for what a player failed to accumulate;
 * only for something that measurably cost the team, on a workload big enough
 * for the rate to mean something.
 *
 * The thresholds are the 10th-percentile lines from the same 781,420-line
 * sample the ladders come from — "worse than nine out of ten games at this
 * position", not a number picked because it sounded bad.
 */
export function findConcerns(position: string, stats: SeasonStats, games = 1): Concern[] {
  const s = stats;
  const g = Math.max(1, games);
  const out: Concern[] = [];

  if (position === 'QB') {
    const att = s.passAtt ?? 0;
    const ints = s.int ?? 0;
    // Two picks in a game is a bad afternoon by any standard; the ladder puts
    // 2 at the 90th percentile of interceptions thrown.
    if (ints >= 2 * g) {
      out.push({ kind: 'TURNOVERS', fact: `${ints} interception${ints === 1 ? '' : 's'}`, severity: 60 + ints * 12 });
    }
    if (att >= 25 * g) {
      const cmpPct = (s.passCmp ?? 0) / att;
      if (cmpPct <= 0.568) {
        out.push({
          kind: 'ACCURACY',
          fact: `${s.passCmp ?? 0} of ${att}, ${(cmpPct * 100).toFixed(0)}%`,
          severity: 40 + (0.568 - cmpPct) * 200,
        });
      }
      const ypa = (s.passYds ?? 0) / att;
      if (ypa <= 3.971) {
        out.push({
          kind: 'EFFICIENCY',
          fact: `${s.passYds ?? 0} yards on ${att} throws, ${ypa.toFixed(1)} a drop-back`,
          severity: 40 + (3.971 - ypa) * 15,
        });
      }
    }
  }

  if (position === 'RB') {
    const att = s.rushAtt ?? 0;
    if (att >= 12 * g) {
      const ypc = (s.rushYds ?? 0) / att;
      if (ypc <= 3.818) {
        out.push({
          kind: 'EFFICIENCY',
          fact: `${att} carries for ${s.rushYds ?? 0}, ${ypc.toFixed(1)} a pop`,
          severity: 35 + (3.818 - ypc) * 18,
        });
      }
    }
  }

  if (position === 'WR' || position === 'TE') {
    const tgt = s.targets ?? 0;
    if (tgt >= 7 * g) {
      const rate = (s.rec ?? 0) / tgt;
      if (rate <= 0.5) {
        out.push({
          kind: 'HANDS',
          fact: `${s.rec ?? 0} of ${tgt} thrown his way`,
          severity: 35 + (0.5 - rate) * 120,
        });
      }
    }
  }

  if (position === 'K') {
    const fga = s.fga ?? 0;
    const missedFg = fga - (s.fgm ?? 0);
    const missedXp = (s.xpa ?? 0) - (s.xpm ?? 0);
    if (fga >= 2 * g && missedFg >= 2) {
      out.push({ kind: 'KICKING', fact: `${s.fgm ?? 0} of ${fga} from the field`, severity: 45 + missedFg * 15 });
    } else if (fga >= 2 * g && missedFg === 1 && (s.fgm ?? 0) / fga <= 0.5) {
      out.push({ kind: 'KICKING', fact: `${s.fgm ?? 0} of ${fga} from the field`, severity: 40 });
    }
    if (missedXp >= 1) {
      out.push({ kind: 'KICKING', fact: `${missedXp} extra point${missedXp === 1 ? '' : 's'} missed`, severity: 38 + missedXp * 14 });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Aggregation across a span
// ---------------------------------------------------------------------------

/** Sum two per-game stat lines. Used only for DISPLAY across a multi-week span. */
export function addStats(a: SeasonStats, b: SeasonStats): SeasonStats {
  const out: Record<string, number> = { ...(a as Record<string, number>) };
  for (const [k, v] of Object.entries(b as Record<string, number>)) {
    if (typeof v !== 'number') continue;
    out[k] = (out[k] ?? 0) + v;
  }
  return out as SeasonStats;
}
