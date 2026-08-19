import { prisma } from './db';
import { parseSettings } from './settings';
import { PHASE_LABELS } from './season';

export async function getLeagueContext(leagueId: string) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
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
