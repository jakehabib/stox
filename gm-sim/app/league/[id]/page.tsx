import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { teamCapSummary } from '@/lib/cap-summary';
import { formatMoney } from '@/lib/cap';
import { ratingTier } from '@/lib/ratings';
import { readJson } from '@/lib/json';
import { shortResult } from '@/lib/sim/recap';
import { teamNeeds } from '@/lib/ai/gm';
import { TeamLogo } from '@/components/TeamLogo';

export default async function TeamDashboard({ params }: { params: { id: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

  const [roster, upcomingGames, recentGames, picks, transactions] = await Promise.all([
    prisma.player.findMany({ where: { teamId: team.id }, orderBy: { trueOvr: 'desc' } }),
    prisma.game.findMany({ where: { leagueId: league.id, OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }], played: false }, orderBy: { week: 'asc' }, take: 1, include: { homeTeam: true, awayTeam: true } }),
    prisma.game.findMany({ where: { leagueId: league.id, OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }], played: true }, orderBy: { week: 'desc' }, take: 3, include: { homeTeam: true, awayTeam: true } }),
    prisma.draftPick.count({ where: { ownerTeamId: team.id, used: false } }),
    prisma.transaction.findMany({ where: { leagueId: league.id, OR: [{ teamId: team.id }, { teamId: null }] }, orderBy: { createdAt: 'desc' }, take: 6 }),
  ]);

  const cap = settings.capMode === 'OFF' ? null : await teamCapSummary(team.id, league.seasonYear, settings.capMode);
  const overall = Math.round(roster.reduce((s, p) => s + p.trueOvr, 0) / Math.max(1, roster.length));
  const needs = teamNeeds(roster.map((p) => ({ id: p.id, position: p.position, trueOvr: p.trueOvr, age: p.age, potential: p.potential })));
  const topNeeds = Object.entries(needs).sort((a, b) => b[1] - a[1]).slice(0, 5).filter(([, v]) => v > 0.1);
  const injured = roster.filter((p) => p.injuryWeeks > 0);
  const next = upcomingGames[0];

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <TeamLogo seed={team.id} abbr={team.abbr} size={64} />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{team.city} {team.nickname}</h1>
            <p className="text-muted text-sm mt-1">
              {team.conference} {team.division} · {team.wins}-{team.losses}{team.ties ? `-${team.ties}` : ''} ·
              {' '}Overall <span className={ratingTier(overall).className}>{overall}</span> ({ratingTier(overall).label})
            </p>
          </div>
        </div>
        <div className="flex gap-2 text-sm text-muted">
          <span className="pill border-line">{team.offScheme}</span>
          <span className="pill border-line">{team.defScheme}</span>
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <div className="card card-pad">
          <div className="label-sm mb-1">Next Game</div>
          {next ? (
            <>
              <div className="font-semibold flex items-center gap-2">
                {next.homeTeamId === team.id ? 'vs' : '@'}
                <TeamLogo seed={next.homeTeamId === team.id ? next.awayTeam.id : next.homeTeam.id} abbr={next.homeTeamId === team.id ? next.awayTeam.abbr : next.homeTeam.abbr} size={22} />
                {next.homeTeamId === team.id ? next.awayTeam.abbr : next.homeTeam.abbr}
              </div>
              <div className="text-xs text-muted mt-1">Week {next.week} · {next.kind}</div>
            </>
          ) : <div className="text-sm text-muted">Season complete</div>}
        </div>
        <div className="card card-pad">
          <div className="label-sm mb-1">Roster</div>
          <div className="font-semibold">{roster.length} players</div>
          <div className="text-xs text-muted mt-1">{injured.length} on injury report</div>
        </div>
        <div className="card card-pad">
          <div className="label-sm mb-1">Cap Space</div>
          {cap ? (
            <div className={`font-semibold font-mono ${cap.capSpace >= 0 ? 'text-accent' : 'text-bad'}`}>{formatMoney(cap.capSpace)}</div>
          ) : <div className="font-semibold text-muted">Cap Off</div>}
          <div className="text-xs text-muted mt-1">{cap ? `${formatMoney(cap.capUsed)} used` : 'No spending limit'}</div>
        </div>
        <div className="card card-pad">
          <div className="label-sm mb-1">Draft Capital</div>
          <div className="font-semibold">{picks} picks owned</div>
          <Link href={`/league/${league.id}/draft`} className="text-xs text-accent2 hover:underline">View draft board →</Link>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card card-pad">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Roster Needs</h2>
              <Link href={`/league/${league.id}/free-agency`} className="text-xs text-accent2 hover:underline">Browse free agents →</Link>
            </div>
            {topNeeds.length === 0 ? (
              <p className="text-sm text-muted">No glaring holes right now — nice work.</p>
            ) : (
              <div className="space-y-2">
                {topNeeds.map(([pos, val]) => (
                  <div key={pos} className="flex items-center gap-3">
                    <span className="w-12 text-sm font-mono text-muted">{pos}</span>
                    <div className="flex-1 h-2 bg-raised rounded-full overflow-hidden">
                      <div className="h-full bg-warn" style={{ width: `${Math.round(val * 100)}%` }} />
                    </div>
                    <span className="text-xs text-muted w-10 text-right">{Math.round(val * 100)}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card card-pad">
            <h2 className="font-semibold mb-3">Recent Results</h2>
            {recentGames.length === 0 ? (
              <p className="text-sm text-muted">No games played yet.</p>
            ) : (
              <div className="space-y-2">
                {recentGames.map((g) => {
                  const box = readJson<any>(g.boxScore, null);
                  const won = (g.homeTeamId === team.id ? g.homeScore : g.awayScore) > (g.homeTeamId === team.id ? g.awayScore : g.homeScore);
                  return (
                    <Link key={g.id} href={`/league/${league.id}/game/${g.id}`} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-raised transition-colors">
                      <span className="text-sm flex items-center gap-2">
                        Wk {g.week} · {g.homeTeamId === team.id ? 'vs' : '@'}
                        <TeamLogo seed={g.homeTeamId === team.id ? g.awayTeam.id : g.homeTeam.id} abbr={g.homeTeamId === team.id ? g.awayTeam.abbr : g.homeTeam.abbr} size={20} />
                        {g.homeTeamId === team.id ? g.awayTeam.abbr : g.homeTeam.abbr}
                      </span>
                      <span className={`text-sm font-mono font-semibold ${won ? 'text-accent' : 'text-bad'}`}>{box ? shortResult(box) : `${g.homeScore}-${g.awayScore}`}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="card card-pad">
          <h2 className="font-semibold mb-3">League Wire</h2>
          <div className="space-y-3">
            {transactions.map((t) => (
              <div key={t.id} className="text-sm border-b border-line/60 pb-2 last:border-0">
                <div className="font-medium">{t.headline}</div>
                {t.detail && <div className="text-xs text-muted mt-0.5">{t.detail}</div>}
              </div>
            ))}
            {transactions.length === 0 && <p className="text-sm text-muted">No transactions yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
