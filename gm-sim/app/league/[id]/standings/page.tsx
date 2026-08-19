import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { TeamLogo } from '@/components/TeamLogo';

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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Standings</h1>
      <div className="grid md:grid-cols-2 gap-5">
        {Array.from(groups.entries()).map(([division, teamList]) => (
          <div key={division} className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-line font-semibold text-sm">{division}</div>
            <table className="table-clean">
              <thead>
                <tr><th>Team</th><th>W</th><th>L</th><th>T</th><th>PF</th><th>PA</th></tr>
              </thead>
              <tbody>
                {teamList.map((t) => (
                  <tr key={t.id} className={t.isUser ? 'bg-accent/5' : ''}>
                    <td>
                      <Link href={`/league/${league.id}/roster`} className="hover:text-accent2 flex items-center gap-2">
                        <TeamLogo seed={t.id} abbr={t.abbr} size={22} />
                        {t.city} {t.nickname} {t.isUser && <span className="text-accent text-xs">(You)</span>}
                        {t.playoffSeed ? <span className="text-xs text-gold ml-1">#{t.playoffSeed}</span> : null}
                      </Link>
                    </td>
                    <td className="font-mono">{t.wins}</td>
                    <td className="font-mono">{t.losses}</td>
                    <td className="font-mono">{t.ties}</td>
                    <td className="font-mono text-muted">{t.pointsFor}</td>
                    <td className="font-mono text-muted">{t.pointsAgnst}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
