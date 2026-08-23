import { careerColumns, isDerived, type StatColumn } from './statLabels';
import { canonicalPosition } from './tuning';
import type { SeasonStats } from './types';

/**
 * ===========================================================================
 * WHERE A MAN STANDS AT HIS POSITION — ONE DEFINITION OF "RANKED Nth"
 * ===========================================================================
 * The stats page shows a rank in three places now: the verdict card at the top
 * of the My Team tab, the rank column on every roster stat table, and the
 * position number down the left of the League tab's leader boards. They must
 * agree, because the failure this project keeps having is a displayed value
 * that is not the value the system used (README design principle 6).
 *
 * So all three read this file, and this file enforces three rules.
 *
 * ---------------------------------------------------------------------------
 * 1. THE RANK IS THE RANK OF THE NUMBER ON SCREEN, TO THE DIGIT
 * ---------------------------------------------------------------------------
 * `columnValue()` quantises to the precision the cell is PRINTED at — integers
 * for a stored count, one decimal for a rate — and the ranking sorts those
 * quantised numbers. Rank the raw double instead and two passers both printed
 * as "98.4" come out 5th and 6th, which is a table disagreeing with itself in
 * public. Ranking the printed number means a reader can always verify the
 * order by eye, which is the only test that matters.
 *
 * ---------------------------------------------------------------------------
 * 2. TIES SHARE A RANK — STANDARD COMPETITION RANKING
 * ---------------------------------------------------------------------------
 * `1, 2, 3, 3, 5`, the way every real stat page does it, and the reason the
 * League tab's leader boards no longer print their array index. Two men on 27
 * touchdowns are both 3rd; printing one of them 4th because the sort happened
 * to put him second is a lie about a tie, and it is the exact thing that would
 * make a verdict card and a leader board disagree about the same player.
 *
 * ---------------------------------------------------------------------------
 * 3. TWO POOLS, BOTH NAMED OUT LOUD WHEREVER THEY ARE SHOWN
 * ---------------------------------------------------------------------------
 * A COUNTING stat ranks against every man at the position with a stat line
 * this split. Nothing is filtered, so "4th in passing yards" here is the same
 * 4th the League tab's Passing Yards board shows.
 *
 * A RATE ranks only among men who cleared `minGamesForRate`. A third-stringer
 * who threw four passes in garbage time carries a 12.0 yards-per-attempt that
 * would push every starter in the league down a place, and a leaderboard that
 * a real season cannot win is not a leaderboard. Real stat pages have always
 * drawn this line and call it "qualified"; so does this one, in the copy.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT RANKED, AND WHY (the lying-metric list)
 * ---------------------------------------------------------------------------
 * Read off lib/sim/engine.ts's allocateStats() and lib/coachRoom.ts's honesty
 * limits, which already did this audit for the week report:
 *
 *   * A PUNTER, AT ALL. `punts * rng.int(40, 50)` — his gross and therefore
 *     his average are dice with no input from his rating, and his volume is a
 *     fact about how often the offense stalled. coachRoom leaves P out of
 *     praise for this reason; a rosette on a coin flip is worse than silence.
 *   * OPPORTUNITY COLUMNS — attempts, carries, targets, field goals attempted,
 *     extra points. They are how much work a man was handed, not how well he
 *     did it, and a table should still show them (they stay in CAREER_COLUMNS)
 *     without a standing attached.
 *   * GAMES PLAYED. Availability, not production.
 *   * INTERCEPTIONS THROWN. Fewest is only a virtue against attempts, and the
 *     attempt-adjusted version — passer rating — is already on the row.
 *   * EXTRA POINTS MADE. A kicker's extra points are his offense's touchdowns;
 *     the half he controls is the accuracy, which is `fgPct`.
 * ===========================================================================
 */

/** Standing at a position, already resolved against a named pool. */
export interface StatRank {
  /** 1-based, ties sharing the better number (competition ranking). */
  rank: number;
  /** How many men were in the pool — printed, so "3rd" is never scale-free. */
  of: number;
  /** True when at least one other man is on exactly this number. */
  tied: boolean;
  /** How many men are on exactly this number, this one included. */
  tiedWith: number;
  /** True when the pool was the qualified one, so the copy can say so. */
  qualified: boolean;
}

/** Positions whose every column is engine noise. See the honesty list above. */
const UNRANKABLE_POSITIONS = new Set(['P']);

/** Columns that measure work handed out, or availability, rather than merit. */
const OPPORTUNITY_KEYS = new Set(['gp', 'passAtt', 'rushAtt', 'targets', 'fga', 'xpa', 'xpm', 'punts', 'puntYds']);

/** Columns where a bigger number is worse, and the honest rate is elsewhere. */
const UNRANKED_KEYS = new Set(['int', 'fum']);

/** Can this column carry a standing at all? */
export function isRankableColumn(position: string, col: StatColumn): boolean {
  if (UNRANKABLE_POSITIONS.has(canonicalPosition(position))) return false;
  if (UNRANKED_KEYS.has(col.key) || OPPORTUNITY_KEYS.has(col.key)) return false;
  return true;
}

/**
 * The number this column shows for this stat line, at printed precision, or
 * null when there is nothing to show. See rule 1 above — every caller that
 * prints a cell and every caller that ranks one reads THIS, so the two can
 * never be looking at different digits. `formatColumn` in lib/statLabels.ts
 * renders exactly this number; the quantisation here is what guarantees it.
 */
export function columnValue(col: StatColumn, stats: SeasonStats): number | null {
  if (!col.derive) return (stats as Record<string, number | undefined>)[col.key] ?? 0;
  const v = col.derive(stats);
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(v * 10) / 10;
}

/** One man's line, as the book needs him. */
export interface RankPoolEntry {
  position: string;
  stats: SeasonStats;
}

export interface RankBook {
  /**
   * Where this line stands at this position on this column, or null when the
   * column is not rankable, the man has no value for it, or ranks are not open
   * yet (see `ranksOpen`).
   */
  rank(position: string, col: StatColumn, stats: SeasonStats): StatRank | null;
  /**
   * False while the season is too young for a standing to mean anything. The
   * numbers still print; the rosettes do not. A card calling somebody the
   * league's best passer after two games is technically true and reads as a
   * judgement about a season.
   */
  ranksOpen: boolean;
  /** Games a man needs before his RATES are ranked. Printed in the footnote. */
  minGamesForRate: number;
}

/**
 * Build the book from the league-wide pool the page already loaded.
 *
 * One pass, every position, every column that position has. The caller passes
 * the SAME array it renders the League tab's leader boards from — that shared
 * origin is what makes "3rd" mean 3rd on both surfaces, rather than two
 * queries that agree until one of them grows a filter.
 */
export function buildRankBook(
  pool: RankPoolEntry[],
  opts: { minGamesForRate: number; ranksOpen: boolean },
): RankBook {
  // `${position}|${key}` -> every printed value in the pool, descending.
  const columns = new Map<string, number[]>();

  for (const entry of pool) {
    const pos = canonicalPosition(entry.position);
    if (UNRANKABLE_POSITIONS.has(pos)) continue;
    const gp = entry.stats.gp ?? 0;
    for (const col of careerColumns(pos)) {
      if (!isRankableColumn(pos, col)) continue;
      // The qualified pool, and only for rates. A counting stat's pool is
      // everybody, so that this rank and the League tab's board agree.
      if (isDerived(col) && gp < opts.minGamesForRate) continue;
      const v = columnValue(col, entry.stats);
      if (v == null) continue;
      const key = `${pos}|${col.key}`;
      const arr = columns.get(key);
      if (arr) arr.push(v); else columns.set(key, [v]);
    }
  }
  for (const arr of columns.values()) arr.sort((a, b) => b - a);

  return {
    ranksOpen: opts.ranksOpen,
    minGamesForRate: opts.minGamesForRate,
    rank(position, col, stats) {
      if (!opts.ranksOpen) return null;
      const pos = canonicalPosition(position);
      if (!isRankableColumn(pos, col)) return null;
      const derived = isDerived(col);
      if (derived && (stats.gp ?? 0) < opts.minGamesForRate) return null;
      const v = columnValue(col, stats);
      if (v == null) return null;
      const arr = columns.get(`${pos}|${col.key}`);
      if (!arr || arr.length === 0) return null;
      // Competition ranking off the sorted array: one place better than the
      // count of men strictly above him, so a tie shares the better number.
      let above = 0;
      let equal = 0;
      for (const x of arr) {
        if (x > v) above++;
        else if (x === v) equal++;
        else break;
      }
      if (equal === 0) return null; // he is not in this pool — never invent a slot for him
      return { rank: above + 1, of: arr.length, tied: equal > 1, tiedWith: equal, qualified: derived };
    },
  };
}

/**
 * The five steps a standing is read in. Tiers, not raw places, because the
 * question the card answers is "is he good", and 6th of 12 and 6th of 64 are
 * opposite answers to it.
 */
export type RankTier = 'elite' | 'strong' | 'average' | 'below' | 'bottom';

export function rankTier(r: StatRank): RankTier {
  // Share of the field he is ahead of. A one-man pool is not a standing, and
  // falls to 'average' rather than crowning him.
  if (r.of <= 1) return 'average';
  /*
   * THE MIDDLE OF A TIE, NOT THE TOP OF IT — the same flat-run rule
   * lib/coachRoom.ts's `ladderPercentile` already applies, for the same
   * reason. Competition ranking gives everybody on a tied number the BEST
   * place on it, which is the right thing to print and the wrong thing to
   * grade: a corner with no interceptions in a postseason where twenty-six of
   * thirty-seven also have none is truthfully "T-8th of 37", and painting him
   * green for it is praise for nothing. The mid-rank is where a full sort of
   * the pool would actually put him, so a man buried in a flat run reads as
   * the middle of the field — while the ordinal beside the colour still says
   * T-8th, which is the honest place.
   */
  const midRank = r.rank + (r.tiedWith - 1) / 2;
  const pct = (midRank - 1) / (r.of - 1);
  if (pct <= 0.10) return 'elite';
  if (pct <= 0.33) return 'strong';
  if (pct <= 0.66) return 'average';
  if (pct <= 0.90) return 'below';
  return 'bottom';
}

/** "3rd", "T-3rd" — the ordinal, with the tie said out loud. */
export function ordinalRank(r: StatRank): string {
  const n = r.rank;
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${r.tied ? 'T-' : ''}${n}${suffix}`;
}
