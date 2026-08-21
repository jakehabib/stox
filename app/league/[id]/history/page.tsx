import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { TeamLogo } from '@/components/TeamLogo';
import { HistoryTeamSelect } from '@/components/HistoryTeamSelect';
import { statLabel } from '@/lib/statLabels';
import { buildDynastyLeaderboard } from '@/lib/dynastyScore';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { PageMasthead } from '@/components/ds/PageMasthead';

const RESULT_LABEL: Record<string, string> = {
  MISSED: 'Missed Playoffs', WILDCARD: 'Lost Wild Card', DIVISIONAL: 'Lost Divisional',
  CONFERENCE: 'Lost Conference', RUNNER_UP: 'Runner-Up', CHAMPION: 'Champion',
};

const AWARD_LABEL: Record<string, string> = {
  AWARD_MVP: 'MVP', AWARD_OPOY: 'Offensive Player of the Year', AWARD_DPOY: 'Defensive Player of the Year',
  AWARD_ROTY: 'Rookie of the Year', AWARD_SBMVP: 'Championship MVP',
};

export default async function HistoryPage({ params, searchParams }: { params: { id: string }; searchParams: { team?: string } }) {
  const { league, userTeam } = await getLeagueContext(params.id);
  const allTeams = await prisma.team.findMany({ where: { leagueId: league.id }, orderBy: { city: 'asc' } });
  const teamId = searchParams.team || userTeam?.id || allTeams[0]?.id;
  const team = allTeams.find((t) => t.id === teamId);
  const teamById = new Map(allTeams.map((t) => [t.id, t]));

  const records = teamId
    ? await prisma.teamSeasonRecord.findMany({ where: { teamId }, orderBy: { year: 'desc' } })
    : [];
  const championships = records.filter((r) => r.playoffResult === 'CHAMPION');

  const [leagueRecords, awardWinners, dynastyLeaderboard] = await Promise.all([
    prisma.leagueRecord.findMany({ where: { leagueId: league.id } }),
    prisma.transaction.findMany({
      where: { leagueId: league.id, type: { in: Object.keys(AWARD_LABEL) } },
      orderBy: [{ seasonYear: 'desc' }, { createdAt: 'asc' }],
    }),
    buildDynastyLeaderboard(league.id),
  ]);
  const seasonRecords = leagueRecords.filter((r) => r.scope === 'SEASON');
  const careerRecords = leagueRecords.filter((r) => r.scope === 'CAREER');

  const champCount = await prisma.teamSeasonRecord.count({
    where: { team: { leagueId: league.id }, playoffResult: 'CHAMPION' },
  });

  return (
    <div className="space-y-5">
      <PageMasthead
        eyebrow={`${league.seasonYear} · League Archive`}
        title="Ring of Honor"
        subtitle="League-wide records and award winners — every franchise's story feeds into this one."
        facts={[
          { label: 'Champions Crowned', value: String(champCount), detail: champCount > 0 ? 'seasons completed' : 'no title decided yet', color: champCount > 0 ? 'text-gold' : undefined },
          { label: 'Records On The Books', value: String(leagueRecords.length), detail: `${seasonRecords.length} season · ${careerRecords.length} career` },
          { label: 'Awards Handed Out', value: String(awardWinners.length), detail: 'across every season' },
          { label: 'Franchises', value: String(allTeams.length), detail: 'all tracked here' },
        ]}
      />

      <div className="panel overflow-hidden">
        <div className="px-4 py-3 border-b border-line/70">
          <div className="label-sm">Dynasty Score</div>
          <div className="text-xs text-muted mt-0.5">Championships, playoff depth, win rate, draft hits, cap discipline, awards, and league records held — rolled into one ranking.</div>
        </div>
        <table className="table-clean">
          <thead><tr><th>Rank</th><th>Team</th><th>Score</th><th>Driven By</th></tr></thead>
          <tbody>
            {dynastyLeaderboard.map((d, i) => (
              <tr key={d.teamId} className={d.isUser ? 'bg-accent/5' : ''}>
                <td className="font-mono text-muted">{i + 1}</td>
                <td>
                  <span className="flex items-center gap-1.5">
                    <TeamLogo seed={d.teamId} abbr={d.teamAbbr} size={18} />
                    <span className={d.isUser ? 'font-semibold' : ''}>{d.teamName}</span>
                    {d.isUser && <span className="pill border-accent/40 text-accent text-[10px]">You</span>}
                  </span>
                </td>
                <td className="font-mono font-semibold">{d.score}</td>
                <td className="text-xs text-muted">{d.breakdown.slice(0, 3).map((b) => b.label).join(' · ') || 'Nothing on the board yet'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {leagueRecords.length > 0 && (
        <div className="grid md:grid-cols-2 gap-5">
          <div className="panel overflow-hidden">
            <div className="px-4 py-3 border-b border-line/70 label-sm">Single-Season Records</div>
            <table className="table-clean">
              <thead><tr><th>Category</th><th>Record</th><th>Player</th><th>Year</th></tr></thead>
              <tbody>
                {seasonRecords.map((r) => (
                  <tr key={r.id}>
                    <td className="text-muted">{statLabel(r.category)}</td>
                    <td className="font-mono font-semibold">{r.value.toLocaleString()}</td>
                    <td>{r.playerName} <span className="text-xs text-muted">{r.teamAbbr}</span></td>
                    <td className="font-mono text-muted">{r.seasonYear}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel overflow-hidden">
            <div className="px-4 py-3 border-b border-line/70 label-sm">Career Records</div>
            <table className="table-clean">
              <thead><tr><th>Category</th><th>Record</th><th>Player</th><th>As Of</th></tr></thead>
              <tbody>
                {careerRecords.map((r) => (
                  <tr key={r.id}>
                    <td className="text-muted">{statLabel(r.category)}</td>
                    <td className="font-mono font-semibold">{r.value.toLocaleString()}</td>
                    <td>{r.playerName} <span className="text-xs text-muted">{r.teamAbbr}</span></td>
                    <td className="font-mono text-muted">{r.seasonYear}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {awardWinners.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="px-4 py-3 border-b border-line/70 label-sm">Award Winners</div>
          <table className="table-clean">
            <thead><tr><th>Year</th><th>Award</th><th>Player</th><th>Team</th><th>Stat Line</th></tr></thead>
            <tbody>
              {awardWinners.map((t) => {
                const winnerTeam = t.teamId ? teamById.get(t.teamId) : null;
                return (
                  <tr key={t.id}>
                    <td className="font-mono text-muted">{t.seasonYear}</td>
                    <td className="text-gold">🏆 {AWARD_LABEL[t.type] ?? t.type}</td>
                    <td>{t.headline}</td>
                    <td>{winnerTeam ? <span className="flex items-center gap-1.5"><TeamLogo seed={winnerTeam.id} abbr={winnerTeam.abbr} size={18} /> {winnerTeam.abbr}</span> : <span className="text-muted">FA</span>}</td>
                    <td className="text-xs text-muted">{t.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div id="franchise" className="border-t border-line/60 pt-5 space-y-5 scroll-mt-24">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display font-extrabold text-2xl uppercase tracking-wide">Franchise History</h2>
          <p className="text-muted text-sm mt-1">Every completed season survives here, even after standings reset for the new year.</p>
        </div>
        <HistoryTeamSelect leagueId={league.id} teamId={teamId} options={allTeams.map((t) => ({ id: t.id, label: `${t.city} ${t.nickname}` }))} />
      </div>

      {team && (
        <div
          className="relative overflow-hidden rounded-lg border-2 shadow-elevated flex items-center gap-4 px-6 py-5"
          style={{
            ['--team-accent' as never]: generateTeamLogoParams(team.id).primary,
            borderColor: 'var(--team-accent)',
            background: 'radial-gradient(ellipse 120% 140% at 100% 0%, color-mix(in srgb, var(--team-accent) 16%, transparent), transparent 70%)',
          }}
        >
          <TeamLogo seed={team.id} abbr={team.abbr} size={220} className="watermark-logo opacity-[0.06] -right-14 -top-14" />
          <TeamLogo seed={team.id} abbr={team.abbr} size={56} className="relative" />
          <div className="relative">
            <div className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none text-team">{team.city} {team.nickname}</div>
            <div className="text-sm text-muted mt-1.5">
              {records.length} season{records.length === 1 ? '' : 's'} on record
              {championships.length > 0 && <span className="text-gold"> · {championships.length}× Champion</span>}
            </div>
          </div>
        </div>
      )}

      {championships.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {championships.map((c) => (
            <span key={c.id} className="pill border-gold/40 text-gold bg-gold/10">🏆 {c.year} Champions ({c.wins}-{c.losses}{c.ties ? `-${c.ties}` : ''})</span>
          ))}
        </div>
      )}

      <div className="panel overflow-hidden">
        <table className="table-clean">
          <thead>
            <tr><th>Year</th><th>W</th><th>L</th><th>T</th><th>PF</th><th>PA</th><th>Result</th></tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} className={r.playoffResult === 'CHAMPION' ? 'bg-gold/5' : ''}>
                <td className="font-mono">{r.year}</td>
                <td className="font-mono">{r.wins}</td>
                <td className="font-mono">{r.losses}</td>
                <td className="font-mono">{r.ties}</td>
                <td className="font-mono text-muted">{r.pointsFor}</td>
                <td className="font-mono text-muted">{r.pointsAgnst}</td>
                <td className={r.playoffResult === 'CHAMPION' ? 'text-gold font-semibold' : 'text-muted'}>
                  {r.playoffResult === 'CHAMPION' && '🏆 '}{RESULT_LABEL[r.playoffResult] ?? r.playoffResult}
                </td>
              </tr>
            ))}
            {records.length === 0 && (
              <tr><td colSpan={7} className="text-center text-muted py-6">No completed seasons yet — finish a full season to start the history book.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  );
}
