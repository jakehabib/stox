import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { readJson } from '@/lib/json';
import { buildScoutedView } from '@/lib/scouting';
import { ratingColor } from '@/lib/ratings';
import { marketValue, formatMoney } from '@/lib/cap';
import { teamCapSummary } from '@/lib/cap-summary';
import { positionSortKey } from '@/lib/league-data';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { TeamLogo } from '@/components/TeamLogo';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { RatingBadge } from '@/components/ds/RatingBadge';
import { ScoutingRange } from '@/components/ds/ScoutingRange';

type SortKey = 'pos' | 'age' | 'ovr' | 'market';

export default async function FreeAgencyPage({ params, searchParams }: { params: { id: string }; searchParams: { pos?: string; sort?: string; dir?: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

  // Best player on the market, independent of whatever position filter is
  // currently applied — a fixed spotlight, not just "row 1 of the table."
  const topAvailable = await prisma.player.findFirst({
    where: { leagueId: league.id, status: 'FREE_AGENT', teamId: null, isDraftee: false },
    orderBy: { trueOvr: 'desc' },
  });

  const where: any = { leagueId: league.id, status: 'FREE_AGENT', teamId: null, isDraftee: false };
  if (searchParams.pos) where.position = searchParams.pos;

  const freeAgents = await prisma.player.findMany({ where, orderBy: { trueOvr: 'desc' }, take: 100 });
  const reportIds = new Set(freeAgents.map((p) => p.id));
  if (topAvailable) reportIds.add(topAvailable.id);
  const reports = await prisma.scoutingReport.findMany({ where: { teamId: team.id, playerId: { in: Array.from(reportIds) } } });
  const reportMap = new Map(reports.map((r) => [r.playerId, r]));

  const capSummary = settings.capMode === 'OFF' ? null : await teamCapSummary(team.id, league.seasonYear, settings.capMode);
  const teamColor = generateTeamLogoParams(team.id).primary;

  const topView = topAvailable ? buildScoutedView({
    position: topAvailable.position as any, trueAttrs: readJson(topAvailable.trueAttrs, {}), trueOvr: topAvailable.trueOvr, potential: topAvailable.potential,
    report: reportMap.get(topAvailable.id), settings, isOwnRoster: false, isUserView: true,
  }) : null;
  const topMarket = topAvailable && topView ? marketValue({ ovr: topView.scoutedOvr, position: topAvailable.position as any, age: topAvailable.age }) : 0;

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
    <div className="space-y-6">
      <div
        className="relative overflow-hidden rounded-lg border-2 shadow-elevated"
        style={{
          ['--team-accent' as never]: teamColor,
          borderColor: 'var(--team-accent)',
          background: 'radial-gradient(ellipse 120% 140% at 100% 0%, color-mix(in srgb, var(--team-accent) 16%, transparent), transparent 70%)',
        }}
      >
        <div
          className="absolute inset-0 opacity-[0.05] pointer-events-none"
          style={{ backgroundImage: 'repeating-linear-gradient(115deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 14px)', color: 'var(--team-accent)' }}
        />
        <TeamLogo seed={team.id} abbr={team.abbr} size={220} className="watermark-logo opacity-[0.06] -right-14 -top-14" />

        <div className="relative flex flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div>
            <div className="label-sm">Free Agency</div>
            <div className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none mt-1" style={{ color: 'var(--team-text)' }}>
              {freeAgents.length} Available
            </div>
            <p className="text-muted text-sm mt-1.5">Offer a contract to open negotiations.</p>
          </div>
          {capSummary && (
            <div className="text-right">
              <div className="label-sm">Cap Space</div>
              <div
                className={`stat-value text-stat-lg leading-none mt-1 ${capSummary.capSpace < 0 ? 'text-bad' : ''}`}
                style={capSummary.capSpace >= 0 ? { color: 'var(--team-text)' } : undefined}
              >
                {formatMoney(capSummary.capSpace)}
              </div>
            </div>
          )}
        </div>
      </div>

      {topAvailable && topView && (
        <div className="panel p-4 flex items-center gap-4 flex-wrap">
          <div className="label-sm shrink-0">Top Available</div>
          <PlayerAvatar seed={topAvailable.id} age={topAvailable.age} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`font-semibold text-xs ${positionBadgeClass(topAvailable.position)}`}>{topAvailable.position}</span>
              <a href={`/league/${league.id}/player/${topAvailable.id}`} className="font-semibold hover:text-accent2 truncate">{topAvailable.firstName} {topAvailable.lastName}</a>
              <span className="text-xs text-muted">Age {topAvailable.age}</span>
            </div>
            <div className="text-xs text-muted mt-0.5">Est. market {formatMoney(topMarket)}/yr</div>
          </div>
          {topView.revealed || topView.confidence >= 90 ? (
            <RatingBadge value={topView.scoutedOvr} label="OVR" size="sm" />
          ) : (
            <ScoutingRange low={topView.ovrLow} high={topView.ovrHigh} confidence={topView.confidence} label="OVR" className="w-32" />
          )}
          <a href={`/league/${league.id}/player/${topAvailable.id}`} className="btn-secondary text-xs px-2.5 py-1.5 shrink-0">Negotiate</a>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <a href={posHref()} className={`pill ${!searchParams.pos ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted'}`}>All</a>
        {positions.map((pos) => (
          <a key={pos} href={posHref(pos)} className={`pill ${searchParams.pos === pos ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted'}`}>{pos}</a>
        ))}
      </div>

      <div className="panel overflow-hidden">
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
                <td><span className={`font-semibold text-xs ${positionBadgeClass(p.position)}`}>{p.position}</span></td>
                <td><a href={`/league/${league.id}/player/${p.id}`} className="hover:text-accent2 font-medium flex items-center gap-2"><PlayerAvatar seed={p.id} age={p.age} size={26} /> {p.firstName} {p.lastName}</a></td>
                <td className="text-muted">{p.age}</td>
                <td className={`stat-value text-stat-sm ${ratingColor(view.scoutedOvr)}`}>{view.revealed ? view.scoutedOvr : `${view.ovrLow}-${view.ovrHigh}`}</td>
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
