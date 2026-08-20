import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { readJson } from '@/lib/json';
import { buildScoutedView } from '@/lib/scouting';
import { ratingColor } from '@/lib/ratings';
import { marketValue, formatMoney } from '@/lib/cap';
import { positionSortKey } from '@/lib/league-data';
import { PlayerAvatar } from '@/components/PlayerAvatar';

type SortKey = 'pos' | 'age' | 'ovr' | 'market';

export default async function FreeAgencyPage({ params, searchParams }: { params: { id: string }; searchParams: { pos?: string; sort?: string; dir?: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

  const where: any = { leagueId: league.id, status: 'FREE_AGENT', teamId: null, isDraftee: false };
  if (searchParams.pos) where.position = searchParams.pos;

  const freeAgents = await prisma.player.findMany({ where, orderBy: { trueOvr: 'desc' }, take: 100 });
  const reports = await prisma.scoutingReport.findMany({ where: { teamId: team.id, playerId: { in: freeAgents.map((p) => p.id) } } });
  const reportMap = new Map(reports.map((r) => [r.playerId, r]));

  const positions = Array.from(new Set(freeAgents.map((p) => p.position))).sort((a, b) => positionSortKey(a) - positionSortKey(b));

  const rows = freeAgents.map((p) => {
    const view = buildScoutedView({
      position: p.position as any, trueAttrs: readJson(p.trueAttrs, {}), trueOvr: p.trueOvr, potential: p.potential,
      report: reportMap.get(p.id), settings, isOwnRoster: false, isUserView: true,
    });
    const market = marketValue({ ovr: view.scoutedOvr, position: p.position as any, age: p.age });
    return { p, view, market };
  });

  const sortKey: SortKey = (['pos', 'age', 'ovr', 'market'] as SortKey[]).includes(searchParams.sort as SortKey)
    ? (searchParams.sort as SortKey) : 'ovr';
  const dir = searchParams.dir === 'asc' ? 1 : -1;

  const sorted = [...rows].sort((a, b) => {
    switch (sortKey) {
      case 'age': return (a.p.age - b.p.age) * dir;
      case 'market': return (a.market - b.market) * dir;
      case 'pos': return (positionSortKey(a.p.position) - positionSortKey(b.p.position)) * dir || b.view.scoutedOvr - a.view.scoutedOvr;
      default: return (a.view.scoutedOvr - b.view.scoutedOvr) * dir;
    }
  });

  const posQuery = searchParams.pos ? `pos=${searchParams.pos}&` : '';
  const sortHref = (key: SortKey) => {
    const nextDir = sortKey === key && dir === -1 ? 'asc' : 'desc';
    return `/league/${league.id}/free-agency?${posQuery}sort=${key}&dir=${nextDir}`;
  };
  const posHref = (pos?: string) => {
    const suffix = `sort=${sortKey}&dir=${dir === -1 ? 'desc' : 'asc'}`;
    return pos ? `/league/${league.id}/free-agency?pos=${pos}&${suffix}` : `/league/${league.id}/free-agency?${suffix}`;
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Free Agency</h1>
        <p className="text-muted text-sm mt-1">{freeAgents.length} available. Offer a contract to open negotiations.</p>
      </div>

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
              <th><a href={sortHref('market')} className="hover:text-chalk">Est. Market{sortKey === 'market' && (dir === -1 ? ' ▾' : ' ▴')}</a></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ p, view, market }) => (
              <tr key={p.id}>
                <td className="font-mono text-xs text-muted">{p.position}</td>
                <td><a href={`/league/${league.id}/player/${p.id}`} className="hover:text-accent2 font-medium flex items-center gap-2"><PlayerAvatar seed={p.id} age={p.age} size={26} /> {p.firstName} {p.lastName}</a></td>
                <td className="text-muted">{p.age}</td>
                <td className={`font-mono font-semibold ${ratingColor(view.scoutedOvr)}`}>{view.revealed ? view.scoutedOvr : `${view.ovrLow}-${view.ovrHigh}`}</td>
                <td className="font-mono text-muted">{formatMoney(market)}/yr</td>
                <td><a href={`/league/${league.id}/player/${p.id}`} className="btn-secondary text-xs px-2.5 py-1">Negotiate</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
