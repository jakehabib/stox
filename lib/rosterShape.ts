import { prisma } from './db';
import { POSITION_GROUPS, PositionGroup, positionGroup } from './positionGroups';

/**
 * How a roster is actually built, measured against the rest of the league.
 *
 * The roster page was a 53-row table and nothing else: every number on it was
 * about one player, so there was no way to answer the question a GM opens the
 * page with — "where is this team strong, and where is it about to fall over?"
 * This computes that in one pass, and every figure is relative, because a 78
 * average at linebacker means nothing until you know the league sits at 72.
 */

export interface GroupShape {
  group: PositionGroup;
  count: number;
  /** Mean rating of the starters at this group, weighted toward the top. */
  starterOvr: number;
  /** League mean for the same measure. */
  leagueOvr: number;
  /** starterOvr - leagueOvr. Positive is a strength. */
  delta: number;
  /** Mean age of this group. Reveals a unit about to age out. */
  avgAge: number;
  /** Deals expiring within a year in this group. */
  expiring: number;
}

export interface RosterShape {
  groups: GroupShape[];
  /** Best and worst groups by delta — the page's headline. */
  strongest: GroupShape | null;
  weakest: GroupShape | null;
  /** Players 30 or older. An aging core is a dynasty problem, not a season one. */
  over30: number;
  /** Starters 30 or older — the sharper version of the same worry. */
  agingStarters: number;
}

/** How many bodies at a group actually see the field, roughly. */
const STARTERS_AT: Record<PositionGroup, number> = {
  QB: 1, RB: 1, WR: 3, TE: 1, OL: 5, DL: 4, LB: 3, DB: 5, ST: 2,
};

/**
 * Averages the top N at a group rather than the whole group, because depth
 * players drag the mean down and a team is not worse at receiver for carrying
 * a seventh one. N is how many actually play.
 */
function starterAverage(ovrs: number[], group: PositionGroup): number {
  if (ovrs.length === 0) return 0;
  const n = Math.min(STARTERS_AT[group] ?? 1, ovrs.length);
  const top = [...ovrs].sort((a, b) => b - a).slice(0, n);
  return top.reduce((s, v) => s + v, 0) / top.length;
}

export async function buildRosterShape(
  leagueId: string,
  teamId: string,
  ownPlayers: { position: string; trueOvr: number; age: number; contract: { yearsRemaining: number } | null }[],
  starterIds?: Set<string>,
  ownWithIds?: { id: string; age: number }[],
): Promise<RosterShape> {
  // One query for the whole league. 32 rosters of ~50 is small enough that
  // pulling three columns and averaging in memory beats 8 grouped queries.
  const leaguePlayers = await prisma.player.findMany({
    where: { leagueId, teamId: { not: null } },
    select: { teamId: true, position: true, trueOvr: true },
  });

  const byTeamGroup = new Map<string, number[]>();
  for (const p of leaguePlayers) {
    const key = `${p.teamId}|${positionGroup(p.position)}`;
    const arr = byTeamGroup.get(key) ?? [];
    arr.push(p.trueOvr);
    byTeamGroup.set(key, arr);
  }

  const groups: GroupShape[] = POSITION_GROUPS.map((group) => {
    const mine = ownPlayers.filter((p) => positionGroup(p.position) === group);

    // League mean of each team's own starter average — not a flat mean of
    // every player, which would sit well below any team's starters and make
    // every group look like a strength.
    const perTeam: number[] = [];
    for (const [key, ovrs] of byTeamGroup) {
      if (!key.endsWith(`|${group}`)) continue;
      perTeam.push(starterAverage(ovrs, group));
    }
    const leagueOvr = perTeam.length > 0 ? perTeam.reduce((s, v) => s + v, 0) / perTeam.length : 0;
    const starterOvr = starterAverage(mine.map((p) => p.trueOvr), group);

    return {
      group,
      count: mine.length,
      starterOvr,
      leagueOvr,
      delta: mine.length > 0 ? starterOvr - leagueOvr : 0,
      avgAge: mine.length > 0 ? mine.reduce((s, p) => s + p.age, 0) / mine.length : 0,
      expiring: mine.filter((p) => (p.contract?.yearsRemaining ?? 99) <= 1).length,
    };
  });

  const staffed = groups.filter((g) => g.count > 0);
  const ranked = [...staffed].sort((a, b) => b.delta - a.delta);

  const over30 = ownPlayers.filter((p) => p.age >= 30).length;
  const agingStarters = starterIds && ownWithIds
    ? ownWithIds.filter((p) => starterIds.has(p.id) && p.age >= 30).length
    : 0;

  return {
    groups,
    strongest: ranked[0] ?? null,
    weakest: ranked[ranked.length - 1] ?? null,
    over30,
    agingStarters,
  };
}
