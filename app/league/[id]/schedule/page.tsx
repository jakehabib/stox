import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { readJson } from '@/lib/json';
import { shortResult } from '@/lib/sim/recap';
import { TeamLogo } from '@/components/TeamLogo';

export default async function SchedulePage({ params }: { params: { id: string } }) {
  const { league } = await getLeagueContext(params.id);
  const games = await prisma.game.findMany({
    where: { leagueId: league.id, seasonYear: league.seasonYear },
    orderBy: [{ week: 'asc' }],
    include: { homeTeam: true, awayTeam: true },
  });

  const byWeek = new Map<number, typeof games>();
  for (const g of games) {
    if (!byWeek.has(g.week)) byWeek.set(g.week, []);
    byWeek.get(g.week)!.push(g);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
      <div className="space-y-6">
        {Array.from(byWeek.entries()).map(([week, weekGames]) => (
          <div key={week}>
            <h2 className="label-sm mb-2">Week {week} {weekGames[0]?.kind !== 'REGULAR' ? `— ${weekGames[0].kind}` : ''}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {weekGames.map((g) => {
                const box = readJson<any>(g.boxScore, null);
                return (
                  <Link
                    key={g.id}
                    href={g.played ? `/league/${league.id}/game/${g.id}` : '#'}
                    className={`card card-pad flex items-center justify-between text-sm ${g.played ? 'hover:border-accent2/40' : 'opacity-70'}`}
                  >
                    <span className="flex items-center gap-1.5">
                      <TeamLogo seed={g.awayTeam.id} abbr={g.awayTeam.abbr} size={20} /> {g.awayTeam.abbr}
                      <span className="text-muted">@</span>
                      <TeamLogo seed={g.homeTeam.id} abbr={g.homeTeam.abbr} size={20} /> {g.homeTeam.abbr}
                    </span>
                    <span className="font-mono text-muted">{g.played && box ? shortResult(box) : g.played ? `${g.awayScore}-${g.homeScore}` : '—'}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
        {games.length === 0 && <p className="text-sm text-muted">No games scheduled yet.</p>}
      </div>
    </div>
  );
}
