import { getLeagueContext } from '@/lib/league-data';
import { buildGmCareerSummary } from '@/lib/gmCareer';
import { formatMoney } from '@/lib/cap';
import { TeamLogo } from '@/components/TeamLogo';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';

const RESULT_LABEL: Record<string, string> = {
  MISSED: 'Missed Playoffs', WILDCARD: 'Lost Wild Card', DIVISIONAL: 'Lost Divisional',
  CONFERENCE: 'Lost Conference', RUNNER_UP: 'Runner-Up', CHAMPION: 'Champion',
};

export default async function GmCareerPage({ params }: { params: { id: string } }) {
  const { league, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;
  const s = await buildGmCareerSummary(league.id, team, league.seasonYear);

  const games = s.wins + s.losses + s.ties;
  const winPct = games > 0 ? s.wins / (s.wins + s.losses || 1) : 0;

  return (
    <div className="space-y-5">
      <div
        className="relative overflow-hidden rounded-lg border-2 shadow-elevated"
        style={{
          ['--team-accent' as never]: generateTeamLogoParams(team.id).primary,
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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
