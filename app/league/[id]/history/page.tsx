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

  // The championship roll — every title ever decided in this league, whether
  // the user won it or it happened decades before he took the job (a new
  // league now arrives with a seeded past; see lib/gen/leagueHistory.ts).
  // Read from TeamSeasonRecord rather than the CHAMPION transaction feed
  // because the season row is the one that also carries the record the club
  // finished with, and the two can't disagree if only one of them is used.
  const titleRows = await prisma.teamSeasonRecord.findMany({
    where: { leagueId: league.id, playoffResult: { in: ['CHAMPION', 'RUNNER_UP'] } },
    orderBy: { year: 'desc' },
  });
  const finalsByYear = new Map<number, { champion?: (typeof titleRows)[number]; runnerUp?: (typeof titleRows)[number] }>();
  for (const r of titleRows) {
    const entry = finalsByYear.get(r.year) ?? {};
    if (r.playoffResult === 'CHAMPION') entry.champion = r; else entry.runnerUp = r;
    finalsByYear.set(r.year, entry);
  }
  const finals = [...finalsByYear.entries()].sort((a, b) => b[0] - a[0]);
  const sbMvpByYear = new Map(awardWinners.filter((t) => t.type === 'AWARD_SBMVP').map((t) => [t.seasonYear, t]));
  const titleCounts = new Map<string, number>();
  for (const r of titleRows) {
    if (r.playoffResult !== 'CHAMPION') continue;
    titleCounts.set(r.teamId, (titleCounts.get(r.teamId) ?? 0) + 1);
  }
  const mostDecorated = [...titleCounts.entries()]
    .map(([id, count]) => ({ team: teamById.get(id), count }))
    .filter((x) => x.team)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

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

      {finals.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="px-4 py-3 border-b border-line/70 flex items-baseline justify-between gap-3 flex-wrap">
            <div>
              <div className="label-sm">Championship Roll</div>
              <div className="text-xs text-muted mt-0.5">Every title this league has decided, oldest silverware included.</div>
            </div>
            {mostDecorated.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {mostDecorated.map(({ team: t, count }) => (
                  <span key={t!.id} className="pill border-gold/40 text-gold bg-gold/10 text-[10px] flex items-center gap-1">
                    <TeamLogo seed={t!.id} abbr={t!.abbr} size={12} />{t!.abbr} ×{count}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Year</th><th>Champion</th><th>Record</th><th>Runner-Up</th><th>Championship MVP</th></tr></thead>
              <tbody>
                {finals.map(([year, f]) => {
                  const champTeam = f.champion ? teamById.get(f.champion.teamId) : null;
                  const ruTeam = f.runnerUp ? teamById.get(f.runnerUp.teamId) : null;
                  const mvp = sbMvpByYear.get(year);
                  return (
                    <tr key={year} className={champTeam?.id === teamId ? 'bg-gold/5' : ''}>
                      <td className="font-mono text-muted">{year}</td>
                      <td className="text-gold font-semibold">
                        {champTeam ? (
                          <span className="flex items-center gap-1.5">
                            <TeamLogo seed={champTeam.id} abbr={champTeam.abbr} size={18} />
                            🏆 {champTeam.city} {champTeam.nickname}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="font-mono">{f.champion ? `${f.champion.wins}-${f.champion.losses}${f.champion.ties ? `-${f.champion.ties}` : ''}` : '—'}</td>
                      <td className="text-muted">
                        {ruTeam ? (
                          <span className="flex items-center gap-1.5">
                            <TeamLogo seed={ruTeam.id} abbr={ruTeam.abbr} size={16} />{ruTeam.city} {ruTeam.nickname}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="text-xs">{mvp ? <>{mvp.headline} <span className="text-muted">· {mvp.detail}</span></> : <span className="text-muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
