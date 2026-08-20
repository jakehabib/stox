import { LEAGUE } from './tuning';

/**
 * ===========================================================================
 * CLINCH SCENARIOS
 * ===========================================================================
 * Mathematical clinch/elimination for the division and the playoff picture,
 * derived by running the EXACT SAME seeding algorithm lib/season.ts's
 * seedPlayoffs() uses (division winner + wildcards, sorted by win% then
 * point differential — byStanding below is a deliberate duplicate of
 * season.ts's private byStanding, not a divergent copy; keep them in sync)
 * against a worst-case-for-this-team / best-case-for-everyone-else
 * projection of the remaining schedule. If the team still makes it under
 * that adversarial projection, it's clinched — there's no possible
 * remaining-games outcome that removes them. Same logic in reverse for
 * elimination. This is the standard definition sports use for "clinched,"
 * not a heuristic.
 *
 * Known simplification: future games are projected on win/loss count only
 * — point differential (the tiebreaker) stays at its CURRENT value rather
 * than being projected forward, same simplification byStanding already
 * accepts by skipping head-to-head. Matters only in exact win-count ties.
 * ===========================================================================
 */

export interface StandingsTeam {
  id: string; division: string; wins: number; losses: number; ties: number; pointsFor: number; pointsAgnst: number;
}

export interface ClinchStatus {
  divisionClinched: boolean;
  divisionEliminated: boolean;
  playoffClinched: boolean;
  playoffEliminated: boolean;
}

function byStanding(a: StandingsTeam, b: StandingsTeam): number {
  const pctA = (a.wins + a.ties * 0.5) / Math.max(1, a.wins + a.losses + a.ties);
  const pctB = (b.wins + b.ties * 0.5) / Math.max(1, b.wins + b.losses + b.ties);
  if (pctB !== pctA) return pctB - pctA;
  return (b.pointsFor - b.pointsAgnst) - (a.pointsFor - a.pointsAgnst);
}

function remainingOf(t: StandingsTeam): number {
  return Math.max(0, LEAGUE.REGULAR_SEASON_WEEKS - (t.wins + t.losses + t.ties));
}

/** Projects a team to the end of the season, winning exactly `winsAdded` of their remaining games. */
function project(t: StandingsTeam, winsAdded: number): StandingsTeam {
  const rem = remainingOf(t);
  return { ...t, wins: t.wins + winsAdded, losses: t.losses + (rem - winsAdded) };
}

function seedConference(teams: StandingsTeam[]): Set<string> {
  const divisions = Array.from(new Set(teams.map((t) => t.division)));
  const divWinners = divisions
    .map((div) => teams.filter((t) => t.division === div).sort(byStanding)[0])
    .sort(byStanding);
  const others = teams.filter((t) => !divWinners.includes(t)).sort(byStanding);
  const wildcards = others.slice(0, Math.max(0, LEAGUE.PLAYOFF_TEAMS_PER_CONF - divWinners.length));
  const seeded = [...divWinners, ...wildcards].slice(0, LEAGUE.PLAYOFF_TEAMS_PER_CONF);
  return new Set(seeded.map((t) => t.id));
}

/** `confTeams` must be every team in the SAME conference as `teamId` (all divisions), for a correct wildcard picture. */
export function computeClinchStatus(teamId: string, confTeams: StandingsTeam[]): ClinchStatus {
  const team = confTeams.find((t) => t.id === teamId);
  if (!team) return { divisionClinched: false, divisionEliminated: false, playoffClinched: false, playoffEliminated: false };

  const worstSelfBestOthers = confTeams.map((t) => project(t, t.id === teamId ? 0 : remainingOf(t)));
  const playoffClinched = seedConference(worstSelfBestOthers).has(teamId);

  const bestSelfWorstOthers = confTeams.map((t) => project(t, t.id === teamId ? remainingOf(t) : 0));
  const playoffEliminated = !seedConference(bestSelfWorstOthers).has(teamId);

  const divTeams = confTeams.filter((t) => t.division === team.division);
  const divSorted = [...divTeams].sort(byStanding);
  const isLeader = divSorted[0]?.id === teamId;
  const rival = isLeader ? divSorted[1] : divSorted[0];
  const divisionClinched = !!rival && team.wins > rival.wins + remainingOf(rival);
  const divisionEliminated = !!rival && !isLeader && rival.wins > team.wins + remainingOf(team);

  return { divisionClinched, divisionEliminated, playoffClinched, playoffEliminated };
}

/** A short dashboard tag for the current clinch picture, or null if nothing decided yet. */
export function clinchScenarioTag(status: ClinchStatus): { label: string; tone: 'good' | 'bad' } | null {
  if (status.divisionClinched) return { label: 'Clinched the division', tone: 'good' };
  if (status.playoffClinched) return { label: 'Clinched a playoff spot', tone: 'good' };
  if (status.playoffEliminated) return { label: 'Eliminated from playoff contention', tone: 'bad' };
  if (status.divisionEliminated) return { label: 'Eliminated from the division race', tone: 'bad' };
  return null;
}
