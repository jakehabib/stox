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
