import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { TeamLogo } from '@/components/TeamLogo';
import { computeRankDeltas } from '@/lib/standingsTrend';

export default async function StandingsPage({ params }: { params: { id: string } }) {
  const { league } = await getLeagueContext(params.id);
  const teams = await prisma.team.findMany({ where: { leagueId: league.id } });

  const groups = new Map<string, typeof teams>();
  for (const t of teams) {
    const key = `${t.conference} ${t.division}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  for (const arr of groups.values()) {
    arr.sort((a, b) => {
      const pctA = (a.wins + a.ties * 0.5) / Math.max(1, a.wins + a.losses + a.ties);
      const pctB = (b.wins + b.ties * 0.5) / Math.max(1, b.wins + b.losses + b.ties);
      return pctB - pctA;
    });
  }

  // Rank deltas only mean something once games have actually been played —
  // same "week-over-week movement" reconstruction the Dashboard uses,
  // applied here to every division rather than just the user's own.
  const deltasByDivision = league.phase === 'REGULAR'
    ? new Map(await Promise.all(Array.from(groups.entries()).map(async ([division, teamList]) => [division, await computeRankDeltas(league.id, teamList)] as const)))
    : new Map<string, Map<string, number>>();

  return (
    <div className="space-y-6">
      <h1 className="font-display font-extrabold text-3xl uppercase tracking-wide">Standings</h1>
      <div className="grid md:grid-cols-2 gap-5">
        {Array.from(groups.entries()).map(([division, teamList]) => {
          const deltas = deltasByDivision.get(division);
          return (
            <div key={division} className="panel overflow-hidden">
              <div className="px-4 py-3 border-b border-line/70 label-sm">{division}</div>
              <table className="table-clean">
                <thead>
                  <tr><th></th><th>Team</th><th>W</th><th>L</th><th>T</th><th>PF</th><th>PA</th></tr>
                </thead>
                <tbody>
                  {teamList.map((t) => {
                    const delta = deltas?.get(t.id);
                    return (
                      <tr key={t.id} className={t.isUser ? 'bg-raised/60' : ''}>
                        <td className="w-8">
                          {delta ? (
                            <span className={`text-xs font-mono ${delta > 0 ? 'text-accent' : 'text-bad'}`}>{delta > 0 ? '▲' : '▼'}{Math.abs(delta)}</span>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                        </td>
                        <td>
                          <Link href={`/league/${league.id}/roster`} className="hover:text-accent2 flex items-center gap-2">
                            <TeamLogo seed={t.id} abbr={t.abbr} size={22} />
                            <span className={t.isUser ? 'font-semibold' : ''}>{t.city} {t.nickname}</span> {t.isUser && <span className="text-accent text-xs">(You)</span>}
                            {t.playoffSeed ? <span className="text-xs text-gold ml-1">#{t.playoffSeed}</span> : null}
                          </Link>
                        </td>
                        <td className="stat-value text-stat-sm">{t.wins}</td>
                        <td className="stat-value text-stat-sm">{t.losses}</td>
                        <td className="stat-value text-stat-sm">{t.ties}</td>
                        <td className="font-mono text-muted">{t.pointsFor}</td>
                        <td className="font-mono text-muted">{t.pointsAgnst}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
