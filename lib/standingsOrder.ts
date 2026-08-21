import { LEAGUE } from './tuning';

/**
 * ===========================================================================
 * STANDINGS ORDER — one canonical comparator
 * ===========================================================================
 * The order teams stand in is computed in three places in this codebase:
 * `seedPlayoffs`/`byStanding` in lib/season.ts (which decides the actual
 * bracket), `byStanding` in lib/clinchScenario.ts (which is documented there
 * as a deliberate duplicate of season.ts's, "keep them in sync"), and now
 * anything that wants to *show* a rank.
 *
 * A displayed rank that disagrees with the bracket the sim actually seeds is
 * exactly the lying-metric class of bug this project has shipped before. So
 * rather than adding a third copy, this is the canonical one:
 * lib/season.ts's private `byStanding` now delegates here, which means the
 * "3rd → 1st in the division" line in a Week Report is computed by the same
 * function that decides who actually plays in January.
 *
 * (lib/clinchScenario.ts's copy is left alone — it is not owned by this
 * change and its formula is already identical.)
 *
 * Known simplification, inherited unchanged: head-to-head is not modelled;
 * the tiebreak after win percentage is point differential.
 * ===========================================================================
 */

export interface StandingsRow {
  id: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgnst: number;
}

export function winPct(t: { wins: number; losses: number; ties: number }): number {
  return (t.wins + t.ties * 0.5) / Math.max(1, t.wins + t.losses + t.ties);
}

/** Sort comparator: better team first. Win% then point differential. */
export function standingsCompare(a: StandingsRow, b: StandingsRow): number {
  const pctA = winPct(a);
  const pctB = winPct(b);
  if (pctB !== pctA) return pctB - pctA;
  return (b.pointsFor - b.pointsAgnst) - (a.pointsFor - a.pointsAgnst);
}

/** 1-based position of `teamId` among the rows given, in standings order. */
export function rankAmong(teamId: string, rows: StandingsRow[]): number {
  const sorted = [...rows].sort(standingsCompare);
  const idx = sorted.findIndex((t) => t.id === teamId);
  return idx === -1 ? 0 : idx + 1;
}

/**
 * The conference in seeding order — division winners first, then everyone
 * else — which is precisely what `seedPlayoffs` does to build the bracket.
 * Returned in full (not truncated to the playoff field) so a team on the
 * outside still has a real position rather than "not in the picture".
 */
export function conferenceSeedOrder<T extends StandingsRow & { division: string }>(confTeams: T[]): T[] {
  const divisions = Array.from(new Set(confTeams.map((t) => t.division)));
  const divWinners = divisions
    .map((div) => confTeams.filter((t) => t.division === div).sort(standingsCompare)[0])
    .filter(Boolean)
    .sort(standingsCompare);
  const winnerIds = new Set(divWinners.map((t) => t.id));
  const others = confTeams.filter((t) => !winnerIds.has(t.id)).sort(standingsCompare);
  return [...divWinners, ...others];
}

/** How many playoff spots a conference has. */
export const PLAYOFF_SPOTS = LEAGUE.PLAYOFF_TEAMS_PER_CONF;

/**
 * Games back of the last playoff spot, in the standard half-game convention.
 * Negative would mean "in the field", so a team already inside gets null —
 * the honest answer there is a seed, not a deficit.
 */
export function gamesBackOfCutLine<T extends StandingsRow & { division: string }>(
  teamId: string,
  confTeams: T[],
): number | null {
  const order = conferenceSeedOrder(confTeams);
  const pos = order.findIndex((t) => t.id === teamId);
  if (pos === -1 || pos < PLAYOFF_SPOTS) return null;
  const cut = order[PLAYOFF_SPOTS - 1];
  const me = order[pos];
  if (!cut) return null;
  return Math.max(0, ((cut.wins - me.wins) + (me.losses - cut.losses)) / 2);
}

/** "3rd", "1st", "22nd". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** "7-2", "7-2-1". */
export function recordString(t: { wins: number; losses: number; ties: number }): string {
  return `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`;
}
