import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { readJson } from '@/lib/json';
import { buildScoutedView } from '@/lib/scouting';
import { ratingColor } from '@/lib/ratings';
import { positionSortKey } from '@/lib/league-data';
import { DraftPickButton } from '@/components/DraftPickButton';
import { SkipToMyPickButton } from '@/components/SkipToMyPickButton';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { TeamLogo } from '@/components/TeamLogo';

type SortKey = 'pos' | 'ovr' | 'age' | 'potential';

export default async function DraftPage({ params, searchParams }: { params: { id: string }; searchParams: { pos?: string; sort?: string; dir?: string } }) {
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
  // `order` is one round's worth of turn order, reused every round (see
  // reseedDraftOrder) — pickIndex climbs across the whole multi-round
  // draft, so it must be taken modulo the order length, not indexed
  // directly (that was indexing past the array for every pick after round
  // 1, which silently broke the entire draft beyond round 1).
  const onClockTeamId = order.length > 0 ? order[state.pickIndex % order.length] : undefined;
  const onClockTeam = onClockTeamId ? await prisma.team.findUnique({ where: { id: onClockTeamId } }) : null;
  const isUserOnClock = onClockTeamId === team.id;
  const totalPicks = order.length * settings.draftRounds;

  const allTeams = state.kind === 'ROOKIE' && !state.complete ? await prisma.team.findMany({ where: { leagueId: league.id } }) : [];
  const teamById = new Map(allTeams.map((t) => [t.id, t]));
  const upcomingPicks = order.length > 0 && !state.complete
    ? Array.from({ length: Math.min(32, totalPicks - state.pickIndex) }, (_, i) => {
        const idx = state.pickIndex + i;
        const round = Math.floor(idx / order.length) + 1;
        const teamId = order[idx % order.length];
        return { idx, round, team: teamById.get(teamId) };
      })
    : [];

  const where: any = { leagueId: league.id, teamId: null, status: 'FREE_AGENT', isDraftee: true };
  if (searchParams.pos) where.position = searchParams.pos;
  const pool = await prisma.player.findMany({ where, orderBy: { trueOvr: 'desc' }, take: 80 });
  const reports = await prisma.scoutingReport.findMany({ where: { teamId: team.id, playerId: { in: pool.map((p) => p.id) } } });
  const reportMap = new Map(reports.map((r) => [r.playerId, r]));
  const positions = Array.from(new Set(pool.map((p) => p.position))).sort((a, b) => positionSortKey(a) - positionSortKey(b));

  const recentPicks = await prisma.transaction.findMany({ where: { leagueId: league.id, type: 'DRAFT' }, orderBy: { createdAt: 'desc' }, take: 10 });

  const rows = pool.map((p) => {
    const view = buildScoutedView({
      position: p.position as any, trueAttrs: readJson(p.trueAttrs, {}), trueOvr: p.trueOvr, potential: p.potential,
      report: reportMap.get(p.id), settings, isOwnRoster: false, isUserView: true,
    });
    return { p, view };
  });

  const sortKey: SortKey = (['pos', 'ovr', 'age', 'potential'] as SortKey[]).includes(searchParams.sort as SortKey)
    ? (searchParams.sort as SortKey) : 'ovr';
  const dir = searchParams.dir === 'asc' ? 1 : -1;

  const sorted = [...rows].sort((a, b) => {
    switch (sortKey) {
      case 'ovr': return (a.view.scoutedOvr - b.view.scoutedOvr) * dir;
      case 'age': return (a.p.age - b.p.age) * dir;
      case 'potential': {
        const av = a.view.revealed ? a.p.potential : (a.view.potLow + a.view.potHigh) / 2;
        const bv = b.view.revealed ? b.p.potential : (b.view.potLow + b.view.potHigh) / 2;
        return (av - bv) * dir;
      }
      default: return (positionSortKey(a.p.position) - positionSortKey(b.p.position)) * dir || b.p.trueOvr - a.p.trueOvr;
    }
  });

  const posQuery = searchParams.pos ? `pos=${searchParams.pos}&` : '';
  const sortHref = (key: SortKey) => {
    const nextDir = sortKey === key && dir === -1 ? 'asc' : 'desc';
    return `/league/${league.id}/draft?${posQuery}sort=${key}&dir=${nextDir}`;
  };
  const posHref = (pos?: string) => {
    const suffix = `sort=${sortKey}&dir=${dir === -1 ? 'desc' : 'asc'}`;
    return pos ? `/league/${league.id}/draft?pos=${pos}&${suffix}` : `/league/${league.id}/draft?${suffix}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{state.kind === 'FANTASY' ? 'Fantasy Draft' : `Rookie Draft — Round ${state.round}`}</h1>
          <p className="text-muted text-sm mt-1">{state.complete ? 'Draft complete.' : `Pick ${state.pickIndex + 1} of ${totalPicks}`}</p>
        </div>
        {!state.complete && onClockTeam && (
          <div className="flex items-center gap-2">
            <div className={`pill ${isUserOnClock ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted'}`}>
              {isUserOnClock ? 'You are on the clock' : `On the clock: ${onClockTeam.city} ${onClockTeam.nickname}`}
            </div>
            {!isUserOnClock && <SkipToMyPickButton leagueId={league.id} teamId={team.id} />}
          </div>
        )}
      </div>

      {upcomingPicks.length > 1 && (
        <div className="card card-pad">
          <h2 className="label-sm mb-2">Upcoming Picks</h2>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {upcomingPicks.map((p) => (
              <div
                key={p.idx}
                title={p.team ? `${p.team.city} ${p.team.nickname}` : ''}
                className={`shrink-0 flex flex-col items-center gap-1 px-2 py-1.5 rounded-lg border ${
                  p.idx === state.pickIndex
                    ? 'border-accent bg-accent/10'
                    : p.team?.id === team.id
                    ? 'border-accent2/50 bg-accent2/10'
                    : 'border-line bg-raised'
                }`}
              >
                {p.team && <TeamLogo seed={p.team.id} abbr={p.team.abbr} size={20} />}
                <span className="text-[10px] text-muted font-mono">R{p.round}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!state.complete && (
        <>
          <div className="flex gap-2 flex-wrap">
            <a href={posHref()} className={`pill ${!searchParams.pos ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted'}`}>All</a>
            {positions.map((pos) => (
              <a key={pos} href={posHref(pos)} className={`pill ${searchParams.pos === pos ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted'}`}>{pos}</a>
            ))}
          </div>

          <div className="card overflow-hidden">
            <table className="table-clean">
              <thead>
                <tr>
                  <th><a href={sortHref('pos')} className="hover:text-chalk">Pos{sortKey === 'pos' && (dir === -1 ? ' ▾' : ' ▴')}</a></th>
                  <th>Name</th>
                  <th><a href={sortHref('age')} className="hover:text-chalk">Age{sortKey === 'age' && (dir === -1 ? ' ▾' : ' ▴')}</a></th>
                  <th><a href={sortHref('ovr')} className="hover:text-chalk">{settings.scoutingEnabled ? 'Scouted' : 'OVR'}{sortKey === 'ovr' && (dir === -1 ? ' ▾' : ' ▴')}</a></th>
                  <th><a href={sortHref('potential')} className="hover:text-chalk">Potential{sortKey === 'potential' && (dir === -1 ? ' ▾' : ' ▴')}</a></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(({ p, view }) => (
                  <tr key={p.id}>
                    <td className="font-mono text-xs text-muted">{p.position}</td>
                    <td className="font-medium flex items-center gap-2"><PlayerAvatar seed={p.id} age={p.age} size={26} /> {p.firstName} {p.lastName} <span className="text-xs text-muted">{p.college}</span></td>
                    <td className="text-muted">{p.age}</td>
                    <td className={`font-mono font-semibold ${ratingColor(view.scoutedOvr)}`}>{view.revealed ? view.scoutedOvr : `${view.ovrLow}-${view.ovrHigh}`}</td>
                    <td className="text-muted font-mono">{view.revealed ? p.potential : `${view.potLow}-${view.potHigh}`}</td>
                    <td>{isUserOnClock && <DraftPickButton leagueId={league.id} teamId={team.id} playerId={p.id} />}</td>
                  </tr>
                ))}
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
