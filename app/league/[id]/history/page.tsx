import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { TeamLogo } from '@/components/TeamLogo';
import { HistoryTeamSelect } from '@/components/HistoryTeamSelect';

const RESULT_LABEL: Record<string, string> = {
  MISSED: 'Missed Playoffs', WILDCARD: 'Lost Wild Card', DIVISIONAL: 'Lost Divisional',
  CONFERENCE: 'Lost Conference', RUNNER_UP: 'Runner-Up', CHAMPION: 'Champion',
};

export default async function HistoryPage({ params, searchParams }: { params: { id: string }; searchParams: { team?: string } }) {
  const { league, userTeam } = await getLeagueContext(params.id);
  const allTeams = await prisma.team.findMany({ where: { leagueId: league.id }, orderBy: { city: 'asc' } });
  const teamId = searchParams.team || userTeam?.id || allTeams[0]?.id;
  const team = allTeams.find((t) => t.id === teamId);

  const records = teamId
    ? await prisma.teamSeasonRecord.findMany({ where: { teamId }, orderBy: { year: 'desc' } })
    : [];
  const championships = records.filter((r) => r.playoffResult === 'CHAMPION');

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Franchise History</h1>
          <p className="text-muted text-sm mt-1">Every completed season survives here, even after standings reset for the new year.</p>
        </div>
        <HistoryTeamSelect leagueId={league.id} teamId={teamId} options={allTeams.map((t) => ({ id: t.id, label: `${t.city} ${t.nickname}` }))} />
      </div>

      {team && (
        <div className="card card-pad flex items-center gap-4">
          <TeamLogo seed={team.id} abbr={team.abbr} size={56} />
          <div>
            <div className="font-semibold text-lg">{team.city} {team.nickname}</div>
            <div className="text-sm text-muted">
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

      <div className="card overflow-hidden">
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
  );
}
