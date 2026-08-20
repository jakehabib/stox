import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { MatchupCard } from '@/components/ds/MatchupCard';

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
      <h1 className="font-display font-extrabold text-3xl uppercase tracking-wide">Schedule</h1>
      <div className="space-y-6">
        {Array.from(byWeek.entries()).map(([week, weekGames]) => (
          <div key={week}>
            <h2 className="label-sm mb-2">Week {week} {weekGames[0]?.kind !== 'REGULAR' ? `— ${weekGames[0].kind}` : ''}</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {weekGames.map((g) => (
                <Link
                  key={g.id}
                  href={g.played ? `/league/${league.id}/game/${g.id}` : '#'}
                  className={g.played ? 'hover:opacity-90 transition-opacity' : 'opacity-70'}
                >
                  <MatchupCard
                    away={{ teamId: g.awayTeam.id, abbr: g.awayTeam.abbr, city: g.awayTeam.city, wins: g.awayTeam.wins, losses: g.awayTeam.losses, ties: g.awayTeam.ties }}
                    home={{ teamId: g.homeTeam.id, abbr: g.homeTeam.abbr, city: g.homeTeam.city, wins: g.homeTeam.wins, losses: g.homeTeam.losses, ties: g.homeTeam.ties }}
                    weekLabel={g.played ? 'Final' : 'Upcoming'}
                    score={g.played ? { away: g.awayScore, home: g.homeScore } : undefined}
                  />
                </Link>
              ))}
            </div>
          </div>
        ))}
        {games.length === 0 && <p className="text-sm text-muted">No games scheduled yet.</p>}
      </div>
    </div>
  );
}
