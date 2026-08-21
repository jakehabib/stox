import { prisma } from './db';
import { canViewLeague } from './owner';
import { parseSettings } from './settings';
import { PHASE_LABELS } from './season';

export async function getLeagueContext(leagueId: string) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  // Every league page funnels through here, so this is the one place a save
  // that belongs to another account — or to another browser, when nobody is
  // signed in — can be refused a render. Server actions
  // are guarded separately (assertLeagueOwner) — they are POST endpoints and
  // a page-level check does nothing for them. Thrown, not `notFound()`, so
  // the same call works from a non-page caller; the league layout already
  // turns a throw from this function into a 404.
  if (!(await canViewLeague(league))) throw new Error('This save belongs to another account.');
  const settings = parseSettings(league.settings);
  const userTeam = league.userTeamId
    ? await prisma.team.findUnique({ where: { id: league.userTeamId } })
    : null;
  return { league, settings, userTeam, phaseLabel: PHASE_LABELS[league.phase] ?? league.phase };
}

export function positionSortKey(pos: string): number {
  const ORDER = ['QB', 'RB', 'FB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT', 'EDGE', 'DT', 'LB', 'CB', 'S', 'K', 'P'];
  const idx = ORDER.indexOf(pos);
  return idx === -1 ? 99 : idx;
}
