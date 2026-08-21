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
   */
  lead?: 1 | 2 | 3;
}

const OFF_LINE_NONE: StatColumn[] = [];

export const CAREER_COLUMNS: Record<string, StatColumn[]> = {
  QB: [
    { key: 'gp', short: 'G' }, { key: 'passCmp', short: 'Cmp' }, { key: 'passAtt', short: 'Att' },
    { key: 'passYds', short: 'Yds', lead: 1 }, { key: 'passTd', short: 'TD', lead: 2 },
    { key: 'int', short: 'Int', lead: 3 }, { key: 'rushYds', short: 'RuYd' },
  ],
  RB: [
    { key: 'gp', short: 'G' }, { key: 'rushAtt', short: 'Att' },
    { key: 'rushYds', short: 'Yds', lead: 1 }, { key: 'rushTd', short: 'TD', lead: 2 },
    { key: 'rec', short: 'Rec', lead: 3 }, { key: 'recYds', short: 'Rec Yd' },
  ],
  WR: [
    { key: 'gp', short: 'G' }, { key: 'targets', short: 'Tgt' }, { key: 'rec', short: 'Rec', lead: 2 },
    { key: 'recYds', short: 'Yds', lead: 1 }, { key: 'recTd', short: 'TD', lead: 3 },
  ],
  TE: [
    { key: 'gp', short: 'G' }, { key: 'targets', short: 'Tgt' }, { key: 'rec', short: 'Rec', lead: 2 },
    { key: 'recYds', short: 'Yds', lead: 1 }, { key: 'recTd', short: 'TD', lead: 3 },
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
    { key: 'gp', short: 'G' }, { key: 'tackles', short: 'Tkl', lead: 1 }, { key: 'ff', short: 'FF', lead: 2 },
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
    { key: 'xpm', short: 'XPM', lead: 3 }, { key: 'xpa', short: 'XPA' },
  ],
  P: [
    { key: 'gp', short: 'G' }, { key: 'punts', short: 'Punts', lead: 1 },
    { key: 'puntYds', short: 'Yds', lead: 2 },
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
  const leads = cols.filter((c) => c.lead != null).sort((a, b) => a.lead! - b.lead!);
  return [...leads, { key: 'gp', short: 'G' }].map((c) => ({ key: c.key, label: statLabel(c.key) }));
}
