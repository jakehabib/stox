import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { ratingColor } from '@/lib/ratings';
import { formatMoney, capHit } from '@/lib/cap';
import { readJson } from '@/lib/json';
import { buildScoutedView } from '@/lib/scouting';
import { positionSortKey } from '@/lib/league-data';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';

export default async function RosterPage({ params }: { params: { id: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

  const players = await prisma.player.findMany({
    where: { teamId: team.id },
    include: { contract: true },
  });
  const reports = await prisma.scoutingReport.findMany({ where: { teamId: team.id, playerId: { in: players.map((p) => p.id) } } });
  const reportMap = new Map(reports.map((r) => [r.playerId, r]));

  const sorted = [...players].sort((a, b) => positionSortKey(a.position) - positionSortKey(b.position) || b.trueOvr - a.trueOvr);
  const teamColor = generateTeamLogoParams(team.id).primary;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Roster</h1>
          <p className="text-muted text-sm mt-1">{players.length} players · {team.city} {team.nickname}</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-clean">
            <thead>
              <tr>
                <th>Pos</th><th>Name</th><th>Age</th>
                <th>{settings.scoutingEnabled ? 'Scouted OVR' : 'OVR'}</th>
                <th>Pot.</th><th>Status</th><th>Cap Hit</th><th>Years Left</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const view = buildScoutedView({
                  position: p.position as any, trueAttrs: readJson(p.trueAttrs, {}), trueOvr: p.trueOvr,
                  report: reportMap.get(p.id), settings, isOwnRoster: true, isUserView: true,
                });
                const hit = capHit(p.contract, settings.capMode);
                return (
                  <tr key={p.id}>
                    <td className="font-mono text-xs text-muted">{p.position}</td>
                    <td>
                      <Link href={`/league/${league.id}/player/${p.id}`} className="hover:text-accent2 font-medium flex items-center gap-2">
                        <PlayerAvatar seed={p.id} age={p.age} size={28} teamColor={teamColor} />
                        {p.firstName} {p.lastName}
                      </Link>
                    </td>
                    <td className="text-muted">{p.age}</td>
                    <td className={`font-mono font-semibold ${ratingColor(view.scoutedOvr)}`}>
                      {view.revealed || view.confidence >= 90 ? view.scoutedOvr : `${view.ovrLow}-${view.ovrHigh}`}
                    </td>
                    <td className="text-muted font-mono">{settings.scoutingEnabled && !view.revealed ? '?' : p.potential}</td>
                    <td>
                      {p.injuryWeeks > 0 ? <span className="pill border-bad/30 text-bad bg-bad/10">Injured · {p.injuryWeeks}w</span> :
                        <span className="pill border-accent/30 text-accent bg-accent/10">Active</span>}
                    </td>
                    <td className="font-mono text-muted">{settings.capMode === 'OFF' ? '—' : formatMoney(hit)}</td>
                    <td className="text-muted">{p.contract?.yearsRemaining ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
