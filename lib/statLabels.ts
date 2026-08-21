import type { SeasonStats } from './types';

/**
 * Human labels for the raw SeasonStats/CareerStats JSON keys (see
 * lib/types.ts) — anywhere those get rendered directly to a player, the
 * camelCase key itself ("defInt", "gp") is not something a user should ever
 * have to read. STAT_ORDER controls display order; anything not listed
 * falls in afterward in whatever order it was stored.
 */
export const STAT_LABELS: Record<string, string> = {
  gp: 'Games',
  passAtt: 'Pass Att',
  passCmp: 'Completions',
  passYds: 'Pass Yds',
  passTd: 'Pass TD',
  int: 'INT Thrown',
  rushAtt: 'Rush Att',
  rushYds: 'Rush Yds',
  rushTd: 'Rush TD',
  fum: 'Fumbles',
  targets: 'Targets',
  rec: 'Receptions',
  recYds: 'Rec Yds',
  recTd: 'Rec TD',
  tackles: 'Tackles',
  sacks: 'Sacks',
  defInt: 'Interceptions',
  pd: 'Pass Defended',
  ff: 'Forced Fumbles',
  fgm: 'FG Made',
  fga: 'FG Attempts',
  xpm: 'XP Made',
  xpa: 'XP Attempts',
  punts: 'Punts',
  puntYds: 'Punt Yds',
};

export const STAT_ORDER = Object.keys(STAT_LABELS);

export function statLabel(key: string): string {
  return STAT_LABELS[key] ?? key;
}

/** Sort a stat-line's entries into a stable, sensible reading order. */
export function sortStatEntries(stats: Record<string, number>): [string, number][] {
  return Object.entries(stats).sort((a, b) => {
    const ai = STAT_ORDER.indexOf(a[0]);
    const bi = STAT_ORDER.indexOf(b[0]);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

/**
 * ===========================================================================
 * PER-POSITION STAT COLUMNS
 * ===========================================================================
 * The one place that answers "which numbers define this position?". The
 * year-by-year career table (components/ds/CareerStatTable.tsx) renders the
 * full list; the player page's hero renders headlineColumns() — the two-to-
 * four numbers a broadcast graphic would show. Both read from here so a
 * column can never appear in one and not the other.
 *
 * The lists are deliberately the exact keys lib/sim/engine.ts's
 * allocateStats() can actually write for that position and nothing else.
 * An offensive lineman never gets a box line at all, so he gets no columns —
 * a table of permanent zeroes would be worse than saying so out loud. Only
 * EDGE/DT record sacks; only CB/S record interceptions and passes defended.
 * Adding a column the sim can't fill would put a column of zeroes on every
 * row, which by the project's own design principles carries no information.
 *
 * `short` is the table header (a stat table's headers are three characters,
 * not "Interceptions"); STAT_LABELS above stays the long form for the
 * key/value breakdowns and for tooltips.
 *
 * ---------------------------------------------------------------------------
 * RATE COLUMNS ARE DERIVED AT RENDER TIME, FROM THE ROW'S OWN COMPONENTS
 * ---------------------------------------------------------------------------
 * Completion percentage, yards per attempt, passer rating and their siblings
 * are not stored anywhere and must not be: they are ratios, and a ratio kept
 * alongside its own components is a second copy that drifts. A column with a
 * `derive` runs on whatever raw stat blob its row carries, which is what makes
 * the CAREER row and the "Before <year>" row come out right for free — those
 * rows hold the SUM of their components, so the rate is computed from the sum.
 * A career passer rating is not the mean of the season ratings, and averaging
 * the column would have shipped exactly that.
 *
 * `derive` returns null, not zero, when the denominator is zero. A
 * quarterback with no attempts has no completion percentage; printing "0.0"
 * claims he was perfectly inaccurate, which is the lying-metric failure this
 * project keeps writing down. Null renders as an em dash.
 * ===========================================================================
 */
export interface StatColumn {
  key: string;
  /** Table header — terse, the way a real stat page heads a column. */
  short: string;
  /**
   * Rank among the numbers that DEFINE the position — 1 is the one a
   * broadcast graphic leads with. Deliberately independent of column order: a
   * stat table reads attempts-then-yards because that is volume then result,
   * but the number that defines a running back is the yards. Without this
   * split, emphasising "the first column after games" bolds carries and puts
   * carries in the hero, which is the wrong number in both places.
   *
   * Never set on a derived column. The hero (headlineColumns) is built from
   * the leads and reads raw stored keys; a rate has no stored key, and a hero
   * that opened with "Cmp % 64.1" instead of "Pass Yds 33,785" would be
   * leading with the wrong number anyway.
   */
  lead?: 1 | 2 | 3;
  /**
   * Computes a rate from the row's raw components. Null when there is no
   * denominator — see the block comment. Presence of this field is also what
   * marks the column as derived: `key` is then a display id, not a
   * SeasonStats field, and nothing may look it up in a stat blob.
   */
  derive?: (s: SeasonStats) => number | null;
  /** How a derived value is written. Ignored on raw columns, which are integers. */
  format?: 'pct1' | 'avg1' | 'rate1';
}

/** Is this column a computed rate rather than a stored field? */
export function isDerived(c: StatColumn): boolean {
  return typeof c.derive === 'function';
}

/**
 * Render one column's value for a row. The single place that knows how a
 * derived value is formatted, so the career table and anything else that
 * grows one cannot disagree about it.
 */
export function formatColumn(c: StatColumn, stats: SeasonStats): string | null {
  if (!c.derive) {
    const v = (stats as Record<string, number | undefined>)[c.key] ?? 0;
    return v.toLocaleString();
  }
  const v = c.derive(stats);
  if (v == null || !Number.isFinite(v)) return null;
  switch (c.format) {
    case 'pct1': return `${v.toFixed(1)}%`;
    case 'rate1': return v.toFixed(1);
    default: return v.toFixed(1);
  }
}

/** num/den, or null when there is nothing to divide by. */
function per(num: number | undefined, den: number | undefined): number | null {
  const d = den ?? 0;
  return d > 0 ? (num ?? 0) / d : null;
}

/** As a percentage, or null when there is nothing to divide by. */
function pct(num: number | undefined, den: number | undefined): number | null {
  const r = per(num, den);
  return r == null ? null : r * 100;
}

/**
 * The real NFL passer rating formula — four components, each clamped to
 * [0, 2.375], averaged and scaled. Not a house invention and not a fantasy
 * blend: 158.3 is the mathematical maximum and roughly 100 is a solid,
 * unspectacular season, exactly as they are in the real game.
 *
 * Exported because the league-stats page ranks passers by it too. One
 * definition, so the number on the leaderboard and the number in the career
 * table cannot disagree — the two copies this replaced were identical only by
 * luck.
 */
export function passerRating(s: SeasonStats): number | null {
  const att = s.passAtt ?? 0;
  if (att < 1) return null;
  const clamp = (v: number) => Math.max(0, Math.min(2.375, v));
  const a = clamp(((s.passCmp ?? 0) / att - 0.3) * 5);
  const b = clamp(((s.passYds ?? 0) / att - 3) * 0.25);
  const c = clamp(((s.passTd ?? 0) / att) * 20);
  const d = clamp(2.375 - ((s.int ?? 0) / att) * 25);
  return ((a + b + c + d) / 6) * 100;
}

const OFF_LINE_NONE: StatColumn[] = [];

/**
 * Column order follows the convention every football reference uses: volume,
 * then the rate it produced, then the result. Attempts before completions
 * before percentage; yards before yards-per; rating last, because it is the
 * summary of everything left of it.
 *
 * WHAT IS DELIBERATELY ABSENT, and why it stays absent
 * ----------------------------------------------------
 * Several SeasonStats fields exist on a position's box line and are ALWAYS
 * ZERO there, because lib/sim/engine.ts's allocateStats() can only ever write
 * them for somebody else. Measured across all 92,421 PlayerSeason rows in the
 * dev database, regular season and postseason both:
 *
 *   - LB `sacks`, `defInt`, `pd`      — max 0. Only EDGE/DT take a sack;
 *                                       only CB/S get an interception or a
 *                                       pass defended (`isRusher`/`isCover`).
 *   - EDGE/DT `defInt`, `pd`          — max 0, same reason.
 *   - CB/S `sacks`                    — max 0, same reason.
 *   - QB `rushTd`, RB `recTd`, RB     — the key is never written at all, for
 *     `targets`, and `fum` for anyone   anybody, in any game ever played.
 *
 * They are not columns. A column of permanent zeroes carries no information
 * and actively misinforms: it reads as "this linebacker has never had a sack"
 * when the truth is "this game does not record sacks for linebackers". That is
 * the same judgement that leaves the offensive line with no columns at all,
 * applied to a stat rather than a position.
 *
 * The fantasy-relevance test these columns are chosen by does not change that.
 * A defender's sack total IS decision-relevant, and a rushing quarterback's
 * touchdowns are most of what makes him one — which is why the gap is worth
 * naming as a SIM gap rather than papering over as a display one. Until
 * allocateStats() can write those numbers, a column for them would tell a
 * fantasy manager something false rather than something useful.
 *
 * LB is the thinnest line here as a result, so it gets the one honest extra a
 * tackle total supports — tackles per game, which is a rate on a number the
 * sim really does write for him.
 */
export const CAREER_COLUMNS: Record<string, StatColumn[]> = {
  QB: [
    { key: 'gp', short: 'G' }, { key: 'passAtt', short: 'Att' }, { key: 'passCmp', short: 'Cmp' },
    { key: 'cmpPct', short: 'Pct', derive: (s) => pct(s.passCmp, s.passAtt), format: 'pct1' },
    { key: 'passYds', short: 'Yds', lead: 1 },
    { key: 'passYpa', short: 'Avg', derive: (s) => per(s.passYds, s.passAtt), format: 'avg1' },
    { key: 'passTd', short: 'TD', lead: 2 }, { key: 'int', short: 'Int', lead: 3 },
    { key: 'passerRating', short: 'Rate', derive: passerRating, format: 'rate1' },
    // The rushing half. A running quarterback is a different asset from a
    // pocket one and the volume is the tell, so the carries come with the
    // yards rather than the yards standing alone. No rushing-TD column: see
    // the absent-columns note above — allocateStats() never writes `rushTd`
    // on a quarterback's line, so the column would be a permanent zero and
    // would read as "he has never run one in", which is not what it means.
    { key: 'rushAtt', short: 'RuAtt' }, { key: 'rushYds', short: 'RuYd' },
  ],
  RB: [
    { key: 'gp', short: 'G' }, { key: 'rushAtt', short: 'Att' },
    { key: 'rushYds', short: 'Yds', lead: 1 },
    { key: 'rushYpc', short: 'Avg', derive: (s) => per(s.rushYds, s.rushAtt), format: 'avg1' },
    { key: 'rushTd', short: 'TD', lead: 2 },
    { key: 'rec', short: 'Rec', lead: 3 }, { key: 'recYds', short: 'Rec Yd' },
  ],
  WR: [
    { key: 'gp', short: 'G' }, { key: 'targets', short: 'Tgt' }, { key: 'rec', short: 'Rec', lead: 2 },
    { key: 'catchPct', short: 'Ctch%', derive: (s) => pct(s.rec, s.targets), format: 'pct1' },
    { key: 'recYds', short: 'Yds', lead: 1 },
    { key: 'recYpr', short: 'Avg', derive: (s) => per(s.recYds, s.rec), format: 'avg1' },
    { key: 'recTd', short: 'TD', lead: 3 },
  ],
  TE: [
    { key: 'gp', short: 'G' }, { key: 'targets', short: 'Tgt' }, { key: 'rec', short: 'Rec', lead: 2 },
    { key: 'catchPct', short: 'Ctch%', derive: (s) => pct(s.rec, s.targets), format: 'pct1' },
    { key: 'recYds', short: 'Yds', lead: 1 },
    { key: 'recYpr', short: 'Avg', derive: (s) => per(s.recYds, s.rec), format: 'avg1' },
    { key: 'recTd', short: 'TD', lead: 3 },
  ],
  // Offensive line: the sim writes no box line for them, so there is nothing
  // truthful to put in a row. See the block comment above.
  LT: OFF_LINE_NONE, LG: OFF_LINE_NONE, C: OFF_LINE_NONE, RG: OFF_LINE_NONE, RT: OFF_LINE_NONE,
  EDGE: [
    { key: 'gp', short: 'G' }, { key: 'tackles', short: 'Tkl', lead: 2 },
    { key: 'sacks', short: 'Sk', lead: 1 }, { key: 'ff', short: 'FF', lead: 3 },
  ],
  DT: [
    { key: 'gp', short: 'G' }, { key: 'tackles', short: 'Tkl', lead: 2 },
    { key: 'sacks', short: 'Sk', lead: 1 }, { key: 'ff', short: 'FF', lead: 3 },
  ],
  LB: [
    { key: 'gp', short: 'G' }, { key: 'tackles', short: 'Tkl', lead: 1 },
    { key: 'tklPerG', short: 'Tkl/G', derive: (s) => per(s.tackles, s.gp), format: 'avg1' },
    { key: 'ff', short: 'FF', lead: 2 },
  ],
  CB: [
    { key: 'gp', short: 'G' }, { key: 'tackles', short: 'Tkl', lead: 3 },
    { key: 'defInt', short: 'Int', lead: 1 }, { key: 'pd', short: 'PD', lead: 2 },
    { key: 'ff', short: 'FF' },
  ],
  S: [
    { key: 'gp', short: 'G' }, { key: 'tackles', short: 'Tkl', lead: 1 },
    { key: 'defInt', short: 'Int', lead: 2 }, { key: 'pd', short: 'PD', lead: 3 },
    { key: 'ff', short: 'FF' },
  ],
  K: [
    { key: 'gp', short: 'G' }, { key: 'fgm', short: 'FGM', lead: 1 }, { key: 'fga', short: 'FGA', lead: 2 },
    { key: 'fgPct', short: 'FG%', derive: (s) => pct(s.fgm, s.fga), format: 'pct1' },
    { key: 'xpm', short: 'XPM', lead: 3 }, { key: 'xpa', short: 'XPA' },
  ],
  P: [
    { key: 'gp', short: 'G' }, { key: 'punts', short: 'Punts', lead: 1 },
    { key: 'puntYds', short: 'Yds', lead: 2 },
    { key: 'puntAvg', short: 'Avg', derive: (s) => per(s.puntYds, s.punts), format: 'avg1' },
  ],
};

export function careerColumns(position: string): StatColumn[] {
  return CAREER_COLUMNS[position] ?? [];
}

/** The column a stat page leads with at this position, for emphasis. */
export function leadColumnKey(position: string): string | undefined {
  return careerColumns(position).find((c) => c.lead === 1)?.key;
}

/**
 * The marquee subset for the player-page hero — the lead columns in lead
 * order, then games played. Derived from CAREER_COLUMNS rather than listed
 * separately so the hero can never headline a stat the table below it
 * doesn't carry, or rank it differently.
 */
export function headlineColumns(position: string): { key: string; label: string }[] {
  const cols = careerColumns(position);
  if (cols.length === 0) return [];
  // Derived columns are excluded twice over — none of them carries a `lead`,
  // and this filter says so anyway. The hero reads stored keys straight out of
  // a stat blob, so a rate would resolve to undefined and print 0; and a
  // career headline should open with the yards, not the completion rate.
  const leads = cols.filter((c) => c.lead != null && !isDerived(c)).sort((a, b) => a.lead! - b.lead!);
  return [...leads, { key: 'gp', short: 'G' }].map((c) => ({ key: c.key, label: statLabel(c.key) }));
}
