import { prisma } from './db';
import { POSITION_GROUPS, PositionGroup, positionGroup } from './positionGroups';
import { starterAverageAtGroup } from './lineup';
import { Position } from './tuning';

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

/**
 * Averages the men who actually take the field at a group, PER POSITION —
 * `starterAverageAtGroup` from lib/lineup.ts, the app's one definition.
 *
 * This file used to take the best N of the whole group, which is wrong in the
 * specific way the app owner reported: a line with two good right tackles and
 * a poor left tackle came out identical to one with a tackle on each side,
 * because the best five of ten linemen are the same five either way. The
 * position panel was therefore incapable of showing him the problem he was
 * describing, let alone the fix. Group-level averaging also silently averaged
 * the top THREE linebackers when two start.
 *
 * No `replacement` argument, deliberately, and that is the one difference from
 * lib/teamRating.ts: this panel reports what a group IS, and a group with
 * nobody in it should read as absent (the `count > 0` guards below) rather
 * than as a bad rating. A team rating has to punish the hole; a shape report
 * has to describe it.
 */
function starterAverage(ovrsAt: (pos: Position) => number[], group: PositionGroup): number {
  return starterAverageAtGroup(ovrsAt, group);
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

  // Keyed by team AND position, so the league mean below is computed the same
  // per-position way the team's own number is. Comparing a per-position figure
  // against a group-level baseline would be the two halves of one delta
  // measuring different things.
  const byTeamPos = new Map<string, number[]>();
  const teamIds = new Set<string>();
  for (const p of leaguePlayers) {
    const key = `${p.teamId}|${p.position}`;
    const arr = byTeamPos.get(key) ?? [];
    arr.push(p.trueOvr);
    byTeamPos.set(key, arr);
    teamIds.add(p.teamId!);
  }

  const ownByPos = new Map<string, number[]>();
  for (const p of ownPlayers) ownByPos.set(p.position, [...(ownByPos.get(p.position) ?? []), p.trueOvr]);

  const groups: GroupShape[] = POSITION_GROUPS.map((group) => {
    const mine = ownPlayers.filter((p) => positionGroup(p.position) === group);

    // League mean of each team's own starter average — not a flat mean of
    // every player, which would sit well below any team's starters and make
    // every group look like a strength.
    const perTeam: number[] = [];
    for (const id of teamIds) {
      perTeam.push(starterAverage((pos) => byTeamPos.get(`${id}|${pos}`) ?? [], group));
    }
    const leagueOvr = perTeam.length > 0 ? perTeam.reduce((s, v) => s + v, 0) / perTeam.length : 0;
    const starterOvr = starterAverage((pos) => ownByPos.get(pos) ?? [], group);

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
