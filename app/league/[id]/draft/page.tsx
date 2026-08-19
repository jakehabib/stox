import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { readJson } from '@/lib/json';
import { buildScoutedView } from '@/lib/scouting';
import { ratingColor } from '@/lib/ratings';
import { positionSortKey } from '@/lib/league-data';
import { DraftPickButton } from '@/components/DraftPickButton';
import { PlayerAvatar } from '@/components/PlayerAvatar';

export default async function DraftPage({ params, searchParams }: { params: { id: string }; searchParams: { pos?: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

  const state = await prisma.draftState.findUnique({ where: { leagueId: league.id } });

  if (!state) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Draft</h1>
        <div className="card card-pad text-sm text-muted">No draft is currently active. The rookie draft opens automatically after free agency each offseason.</div>
      </div>
    );
  }

  const order = readJson<string[]>(state.order, []);
  const onClockTeamId = order[state.pickIndex];
  const onClockTeam = onClockTeamId ? await prisma.team.findUnique({ where: { id: onClockTeamId } }) : null;
  const isUserOnClock = onClockTeamId === team.id;

  const where: any = { leagueId: league.id, teamId: null, status: 'FREE_AGENT', isDraftee: true };
  if (searchParams.pos) where.position = searchParams.pos;
  const pool = await prisma.player.findMany({ where, orderBy: { trueOvr: 'desc' }, take: 80 });
  const reports = await prisma.scoutingReport.findMany({ where: { teamId: team.id, playerId: { in: pool.map((p) => p.id) } } });
  const reportMap = new Map(reports.map((r) => [r.playerId, r]));
  const positions = Array.from(new Set(pool.map((p) => p.position))).sort((a, b) => positionSortKey(a) - positionSortKey(b));

  const recentPicks = await prisma.transaction.findMany({ where: { leagueId: league.id, type: 'DRAFT' }, orderBy: { createdAt: 'desc' }, take: 10 });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{state.kind === 'FANTASY' ? 'Fantasy Draft' : `Rookie Draft — Round ${state.round}`}</h1>
          <p className="text-muted text-sm mt-1">{state.complete ? 'Draft complete.' : `Pick ${state.pickIndex + 1} of ${order.length}`}</p>
        </div>
        {!state.complete && onClockTeam && (
          <div className={`pill ${isUserOnClock ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted'}`}>
            {isUserOnClock ? 'You are on the clock' : `On the clock: ${onClockTeam.city} ${onClockTeam.nickname}`}
          </div>
        )}
      </div>

      {!state.complete && (
        <>
          <div className="flex gap-2 flex-wrap">
            <a href={`/league/${league.id}/draft`} className={`pill ${!searchParams.pos ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted'}`}>All</a>
            {positions.map((pos) => (
              <a key={pos} href={`/league/${league.id}/draft?pos=${pos}`} className={`pill ${searchParams.pos === pos ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted'}`}>{pos}</a>
            ))}
          </div>

          <div className="card overflow-hidden">
            <table className="table-clean">
              <thead><tr><th>Pos</th><th>Name</th><th>Age</th><th>{settings.scoutingEnabled ? 'Scouted' : 'OVR'}</th><th>Potential</th><th></th></tr></thead>
              <tbody>
                {pool.map((p) => {
                  const view = buildScoutedView({
                    position: p.position as any, trueAttrs: readJson(p.trueAttrs, {}), trueOvr: p.trueOvr,
                    report: reportMap.get(p.id), settings, isOwnRoster: false, isUserView: true,
                  });
                  return (
                    <tr key={p.id}>
                      <td className="font-mono text-xs text-muted">{p.position}</td>
                      <td className="font-medium flex items-center gap-2"><PlayerAvatar seed={p.id} age={p.age} size={26} /> {p.firstName} {p.lastName} <span className="text-xs text-muted">{p.college}</span></td>
                      <td className="text-muted">{p.age}</td>
                      <td className={`font-mono font-semibold ${ratingColor(view.scoutedOvr)}`}>{view.revealed ? view.scoutedOvr : `${view.ovrLow}-${view.ovrHigh}`}</td>
                      <td className="text-muted font-mono">{view.revealed ? p.potential : '?'}</td>
                      <td>{isUserOnClock && <DraftPickButton leagueId={league.id} teamId={team.id} playerId={p.id} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="card card-pad">
        <h2 className="font-semibold mb-2 text-sm">Recent Picks</h2>
        <div className="space-y-1.5 text-sm">
          {recentPicks.map((t) => <div key={t.id} className="text-muted">{t.headline}</div>)}
          {recentPicks.length === 0 && <p className="text-muted text-sm">No picks yet.</p>}
        </div>
      </div>
    </div>
  );
}
