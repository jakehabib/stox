import { getLeagueContext } from '@/lib/league-data';
import { buildGmCareerSummary, tradeInvolves } from '@/lib/gmCareer';
import { formatMoney } from '@/lib/cap';
import { TeamLogo } from '@/components/TeamLogo';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';

const RESULT_LABEL: Record<string, string> = {
  MISSED: 'Missed Playoffs', WILDCARD: 'Lost Wild Card', DIVISIONAL: 'Lost Divisional',
  CONFERENCE: 'Lost Conference', RUNNER_UP: 'Runner-Up', CHAMPION: 'Champion',
};

export default async function GmCareerPage({ params }: { params: { id: string } }) {
  const { league, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;
  const s = await buildGmCareerSummary(league.id, team, league.seasonYear);

  // A first-season GM page was five sparse tiles and six hundred pixels of
  // empty page. Two things fill it with the GM's actual body of work rather
  // than placeholders: the season log (including the season in progress, which
  // has no TeamSeasonRecord row yet) and the ledger of moves they've made.
  const MOVE_TYPES = ['SIGN', 'CUT', 'DRAFT', 'TAG'];
  const [seasonRecords, ownMoves, moveCounts, tradeRows] = await Promise.all([
    prisma.teamSeasonRecord.findMany({ where: { teamId: team.id }, orderBy: { year: 'desc' } }),
    prisma.transaction.findMany({
      where: { leagueId: league.id, teamId: team.id, type: { in: MOVE_TYPES } },
      orderBy: [{ seasonYear: 'desc' }, { createdAt: 'desc' }],
      take: 14,
    }),
    prisma.transaction.groupBy({
      by: ['type'],
      where: { leagueId: league.id, teamId: team.id, type: { in: MOVE_TYPES } },
      _count: true,
    }),
    // Trades carry no teamId — both sides are encoded in one headline — so
    // they need the shared matcher rather than a teamId filter. Filtering
    // these by teamId is exactly how this ledger first reported "Trades 0" on
    // the same page whose summary tile said seven.
    prisma.transaction.findMany({
      where: { leagueId: league.id, type: 'TRADE' },
      orderBy: [{ seasonYear: 'desc' }, { createdAt: 'desc' }],
    }),
  ]);
  const myTrades = tradeRows.filter((t) => tradeInvolves(t.headline, team.abbr));
  const countOf = (t: string) => (t === 'TRADE' ? myTrades.length : moveCounts.find((m) => m.type === t)?._count ?? 0);
  const moves = [...ownMoves, ...myTrades]
    .sort((a, b) => b.seasonYear - a.seasonYear || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 14);

  const games = s.wins + s.losses + s.ties;
  const winPct = games > 0 ? s.wins / (s.wins + s.losses || 1) : 0;

  return (
    <div className="space-y-5">
      <div
        className="relative overflow-hidden rounded-lg border-2 shadow-elevated"
        style={{
          ['--team-accent' as never]: generateTeamLogoParams(team.abbr).primary,
          borderColor: 'var(--team-accent)',
          background: 'radial-gradient(ellipse 120% 140% at 0% 0%, color-mix(in srgb, var(--team-accent) 16%, transparent), transparent 70%)',
        }}
      >
        <TeamLogo seed={team.id} abbr={team.abbr} size={220} className="watermark-logo opacity-[0.06] -right-14 -top-14" />
        <div className="relative flex items-center gap-4 px-6 py-5">
          <TeamLogo seed={team.id} abbr={team.abbr} size={48} />
          <div>
            <div className="label-sm">GM Career</div>
            <div className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none mt-1 text-team">
              {team.city} {team.nickname}
            </div>
            <p className="text-muted text-sm mt-1.5">
              On the job since {s.firstYear} — {s.tenureYears} season{s.tenureYears === 1 ? '' : 's'} and counting.
            </p>
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {s.badges.map((b) => (
          <div key={b.title} className="panel p-4 flex items-start gap-3">
            <span className="text-2xl leading-none">{b.icon}</span>
            <div>
              <div className="font-semibold text-sm">{b.title}</div>
              <div className="text-xs text-muted mt-0.5">{b.blurb}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="stat-tile">
          <div className="label-sm">Record</div>
          <div className="text-lg font-mono font-semibold">{s.wins}-{s.losses}{s.ties ? `-${s.ties}` : ''}</div>
          <div className="text-xs text-muted">{games > 0 ? `${(winPct * 100).toFixed(0)}% win rate` : 'No games yet'}</div>
        </div>
        <div className="stat-tile">
          <div className="label-sm">Championships</div>
          <div className={`text-lg font-mono font-semibold ${s.championships > 0 ? 'text-gold' : ''}`}>{s.championships}</div>
          <div className="text-xs text-muted">{s.playoffAppearances} playoff trip{s.playoffAppearances === 1 ? '' : 's'}</div>
        </div>
        <div className="stat-tile">
          <div className="label-sm">Draft Hit Rate</div>
          <div className="text-lg font-mono font-semibold">{s.draftHitRate !== null ? `${Math.round(s.draftHitRate * 100)}%` : '—'}</div>
          <div className="text-xs text-muted">{s.draftHits}/{s.draftPicksMade} picks hit</div>
        </div>
        <div className="stat-tile">
          <div className="label-sm">Trades Made</div>
          <div className="text-lg font-mono font-semibold">{s.trades}</div>
          <div className="text-xs text-muted">{s.tagsUsed} franchise tag{s.tagsUsed === 1 ? '' : 's'} used</div>
        </div>
        {/* DISTINCT players, on the owner's call — a five-time All-Star
            quarterback is one All-Star player, not five. The selections count
            sits underneath rather than in the headline slot so the two can
            never be read as each other. Both are bounded to this GM's tenure
            (lib/allStars.ts allStarTallyForTeam). */}
        <div className="stat-tile">
          <div className="label-sm">All-Star Players</div>
          <div className={`text-lg font-mono font-semibold ${s.allStars.players > 0 ? 'text-gold' : ''}`}>{s.allStars.players}</div>
          <div className="text-xs text-muted">
            {s.allStars.selections === 0
              ? 'None selected yet'
              : `${s.allStars.selections} selection${s.allStars.selections === 1 ? '' : 's'} since ${s.firstYear}`}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <div className="panel p-4">
          <div className="label-sm mb-3">Cap Management</div>
          <div className="text-sm text-muted">Average dead money per season</div>
          <div className="stat-value text-stat-md mt-1">{formatMoney(s.avgDeadMoneyPerYear)}</div>
        </div>
        <div className="panel p-4">
          <div className="label-sm mb-3">Best Season</div>
          {s.bestSeason ? (
            <div className="flex items-center justify-between">
              <div>
                <div className="font-mono text-sm">{s.bestSeason.year} · {s.bestSeason.wins}-{s.bestSeason.losses}{s.bestSeason.ties ? `-${s.bestSeason.ties}` : ''}</div>
                <div className={`text-xs mt-0.5 ${s.bestSeason.result === 'CHAMPION' ? 'text-gold font-semibold' : 'text-muted'}`}>
                  {s.bestSeason.result === 'CHAMPION' && '🏆 '}{RESULT_LABEL[s.bestSeason.result] ?? s.bestSeason.result}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted">No completed seasons yet.</div>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="section">
          <div className="section-head">
            <h2 className="section-title">Season Log</h2>
            <span className="label-sm">{s.tenureYears} season{s.tenureYears === 1 ? '' : 's'}</span>
          </div>
          <div className="panel overflow-hidden">
            <table className="table-clean">
              <thead><tr><th>Year</th><th className="text-right">W</th><th className="text-right">L</th><th className="text-right">T</th><th className="text-right">PF</th><th className="text-right">PA</th><th>Result</th></tr></thead>
              <tbody>
                {/* The season in progress has no TeamSeasonRecord row until it
                    ends, so it's synthesised here — otherwise a first-year GM
                    sees an empty table while sitting on a 7-2 start. */}
                <tr className="bg-accent/[0.06]">
                  <td className="font-mono">{league.seasonYear}</td>
                  <td className="font-mono text-right">{team.wins}</td>
                  <td className="font-mono text-right">{team.losses}</td>
                  <td className="font-mono text-right">{team.ties}</td>
                  <td className="font-mono text-muted text-right">{team.pointsFor}</td>
                  <td className="font-mono text-muted text-right">{team.pointsAgnst}</td>
                  <td className="text-accent text-xs">In progress</td>
                </tr>
                {seasonRecords.map((r) => (
                  <tr key={r.id} className={r.playoffResult === 'CHAMPION' ? 'bg-gold/5' : ''}>
                    <td className="font-mono">{r.year}</td>
                    <td className="font-mono text-right">{r.wins}</td>
                    <td className="font-mono text-right">{r.losses}</td>
                    <td className="font-mono text-right">{r.ties}</td>
                    <td className="font-mono text-muted text-right">{r.pointsFor}</td>
                    <td className="font-mono text-muted text-right">{r.pointsAgnst}</td>
                    <td className={`text-xs ${r.playoffResult === 'CHAMPION' ? 'text-gold font-semibold' : 'text-muted'}`}>
                      {r.playoffResult === 'CHAMPION' && '🏆 '}{RESULT_LABEL[r.playoffResult] ?? r.playoffResult}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="section">
          <div className="section-head">
            <h2 className="section-title">Your Moves</h2>
            <Link href={`/league/${league.id}/news`} className="text-xs text-accent2 hover:underline">League wire →</Link>
          </div>
          <div className="panel overflow-hidden">
            <div className="grid grid-cols-3 sm:grid-cols-5 divide-x divide-line/40 border-b border-line/70">
              {[
                // No "Re-signs" column: nothing in the sim writes a RESIGN
                // transaction, so it could only ever read zero. Extensions
                // land as SIGN and are counted there.
                { label: 'Trades', n: countOf('TRADE') },
                { label: 'Signings', n: countOf('SIGN') },
                { label: 'Drafted', n: countOf('DRAFT') },
                { label: 'Released', n: countOf('CUT') },
                { label: 'Tags', n: countOf('TAG') },
              ].map((c) => (
                <div key={c.label} className="px-3 py-2.5">
                  <div className="label-sm text-[10px]">{c.label}</div>
                  <div className="stat-value text-stat-sm mt-1">{c.n}</div>
                </div>
              ))}
            </div>
            <div className="divide-y divide-line/50">
              {moves.length === 0 && <div className="px-4 py-4 text-sm text-muted">No moves yet — the ledger starts with your first trade or signing.</div>}
              {moves.map((m) => (
                <div key={m.id} className="px-4 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="label-sm text-[10px] shrink-0">{m.type}</span>
                    <span className="text-sm truncate">{m.headline}</span>
                  </div>
                  {m.detail && <div className="text-[11px] text-muted mt-0.5 truncate">{m.detail}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {s.allStars.entries.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="px-4 py-3 border-b border-line/70 flex items-baseline justify-between gap-3 flex-wrap">
            <div className="label-sm">All-Stars You Developed</div>
            <div className="text-xs text-muted">
              {s.allStars.players} player{s.allStars.players === 1 ? '' : 's'} · {s.allStars.selections} selection{s.allStars.selections === 1 ? '' : 's'}
            </div>
          </div>
          <table className="table-clean">
            <thead><tr><th>Year</th><th>Player</th><th>Pos</th><th>Season</th></tr></thead>
            <tbody>
              {/* One row per SELECTION, so a repeat All-Star appears once per
                  year he earned it — the tile above counts the men, this
                  counts the seasons, and each says which it is. */}
              {s.allStars.entries.map((a, i) => (
                <tr key={i}>
                  <td className="font-mono text-muted">{a.year}</td>
                  <td className="text-gold">⭐ {a.name}</td>
                  <td className="font-mono text-xs text-muted">{a.position}</td>
                  <td className="text-xs text-muted">{a.statLine}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {s.awards.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="px-4 py-3 border-b border-line/70 label-sm">Awards Won By Your Players</div>
          <table className="table-clean">
            <thead><tr><th>Year</th><th>Award</th><th>Player</th></tr></thead>
            <tbody>
              {s.awards.map((a, i) => (
                <tr key={i}>
                  <td className="font-mono text-muted">{a.year}</td>
                  <td className="text-gold">🏆 {a.label}</td>
                  <td>{a.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
