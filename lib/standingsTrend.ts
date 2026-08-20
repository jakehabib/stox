import { prisma } from './db';

/**
 * Week-over-week rank movement for a division standings table, without any
 * historical snapshot table — reconstructs "last week's" record for each
 * team by finding their most recently played game (the whole league shares
 * one schedule with no bye weeks, so that's the same reference week for
 * every team in the division) and subtracting its result back out.
 */
export async function computeRankDeltas(
  leagueId: string,
  divisionTeams: { id: string; wins: number; losses: number; ties: number }[],
): Promise<Map<string, number>> {
  const deltas = new Map<string, number>();
  if (divisionTeams.length === 0) return deltas;

  const teamIds = divisionTeams.map((t) => t.id);
  const lastGames = await prisma.game.findMany({
    where: { leagueId, played: true, OR: [{ homeTeamId: { in: teamIds } }, { awayTeamId: { in: teamIds } }] },
    orderBy: { week: 'desc' },
    select: { week: true, homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
  });
  const latestWeek = lastGames[0]?.week;
  if (latestWeek === undefined) return deltas;

  const gameByTeam = new Map<string, (typeof lastGames)[number]>();
  for (const g of lastGames) {
    if (g.week !== latestWeek) continue;
    if (teamIds.includes(g.homeTeamId)) gameByTeam.set(g.homeTeamId, g);
    if (teamIds.includes(g.awayTeamId)) gameByTeam.set(g.awayTeamId, g);
  }

  const priorRecord = divisionTeams.map((t) => {
    const g = gameByTeam.get(t.id);
    if (!g) return { id: t.id, wins: t.wins, losses: t.losses, ties: t.ties };
    const isHome = g.homeTeamId === t.id;
    const my = isHome ? g.homeScore : g.awayScore;
    const opp = isHome ? g.awayScore : g.homeScore;
    if (my === opp) return { id: t.id, wins: t.wins, losses: t.losses, ties: t.ties - 1 };
    return my > opp ? { id: t.id, wins: t.wins - 1, losses: t.losses, ties: t.ties } : { id: t.id, wins: t.wins, losses: t.losses - 1, ties: t.ties };
  });

  const pct = (t: { wins: number; losses: number; ties: number }) => (t.wins + t.ties * 0.5) / Math.max(1, t.wins + t.losses + t.ties);
  const priorRanked = [...priorRecord].sort((a, b) => pct(b) - pct(a));
  const currentRanked = [...divisionTeams].sort((a, b) => pct(b) - pct(a));

  for (const t of divisionTeams) {
    const priorRank = priorRanked.findIndex((r) => r.id === t.id);
    const currentRank = currentRanked.findIndex((r) => r.id === t.id);
    deltas.set(t.id, priorRank - currentRank);
  }
  return deltas;
}
