import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { readJson } from '@/lib/json';
import { buildScoutedView } from '@/lib/scouting';
import { ratingColor, playerLabel } from '@/lib/ratings';
import { positionSortKey } from '@/lib/league-data';
import { LEAGUE, AI, Position } from '@/lib/tuning';
import { bigBoardScore } from '@/lib/gen/prospectProfile';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { DraftPickButton } from '@/components/DraftPickButton';
import { LiveDraftTicker } from '@/components/LiveDraftTicker';
import { ShortlistStar } from '@/components/ShortlistStar';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { TeamLogo } from '@/components/TeamLogo';
import { SectionHeading } from '@/components/ds/SectionHeading';
import { positionBadgeClass } from '@/components/ds/positionColor';

type SortKey = 'consensus' | 'pos' | 'ovr' | 'age' | 'potential';

export default async function DraftPage({ params, searchParams }: { params: { id: string }; searchParams: { pos?: string; sort?: string; dir?: string; shortlist?: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

  const stateRow = await prisma.draftState.findUnique({ where: { leagueId: league.id } });
  // The draft page doubles as a year-round scouting hub: the incoming class
  // is generated at week 1 of the season (see addDraftClass in season.ts),
  // long before DraftState exists — it only gets created once the DRAFT
  // phase actually opens, months later. `stateRow` also lingers as a stale,
  // already-complete row from last year's draft for most of the season
  // (startRookieDraft only replaces it once the next draft starts), so
  // "is a draft live right now" is its own check, not just "does state exist."
  const draftLive = !!stateRow && !stateRow.complete;
  const state = draftLive ? stateRow! : null;

  const isFantasy = state?.kind === 'FANTASY';
  // Fantasy draft has no DraftPick rows — it's a plain snake of team turns,
  // so the stored order is the whole story there. A rookie draft resolves
  // the team on the clock from LIVE DraftPick ownership every round instead
  // of a turn-order array (see lib/draft.ts currentPick() for why a fixed
  // array silently ignores any trade involving a round-2+ pick).
  const order = state && isFantasy ? readJson<string[]>(state.order, []) : [];
  const roundSize = LEAGUE.TEAM_COUNT;
  const rookiePicks = state && !isFantasy
    ? await prisma.draftPick.findMany({ where: { leagueId: league.id, year: league.seasonYear }, orderBy: [{ round: 'asc' }, { slot: 'asc' }] })
    : [];
  const rookiePickByIndex = new Map(rookiePicks.map((p) => [(p.round - 1) * roundSize + (p.slot - 1), p]));

  const totalPicks = state ? (isFantasy ? order.length : roundSize * settings.draftRounds) : 0;
  const onClockTeamId = state
    ? (isFantasy ? (order.length > 0 ? order[state.pickIndex % order.length] : undefined) : rookiePickByIndex.get(state.pickIndex)?.ownerTeamId)
    : undefined;
  const onClockTeam = onClockTeamId ? await prisma.team.findUnique({ where: { id: onClockTeamId } }) : null;
  const isUserOnClock = !!state && onClockTeamId === team.id;

  const allTeams = state?.kind === 'ROOKIE' ? await prisma.team.findMany({ where: { leagueId: league.id } }) : [];
  const teamById = new Map(allTeams.map((t) => [t.id, t]));
  const upcomingPicks = state && totalPicks > 0
    ? Array.from({ length: Math.min(32, totalPicks - state.pickIndex) }, (_, i) => {
        const idx = state.pickIndex + i;
        if (isFantasy) {
          const round = Math.floor(idx / order.length) + 1;
          return { idx, round, team: teamById.get(order[idx % order.length]) };
        }
        const p = rookiePickByIndex.get(idx);
        return { idx, round: p ? p.round : Math.floor(idx / roundSize) + 1, team: p ? teamById.get(p.ownerTeamId) : undefined };
      })
    : [];

  const shortlistEntries = await prisma.shortlistEntry.findMany({ where: { teamId: team.id }, select: { playerId: true } });
  const shortlistIds = new Set(shortlistEntries.map((s) => s.playerId));
  const shortlistOnly = searchParams.shortlist === '1';

  // During a live draft, only the top of the board matters pick-to-pick.
  // Off the clock, this is the whole-class scouting hub — show a lot more
  // of it (the class is ~400 deep now that a real UDFA share exists).
  const where: any = { leagueId: league.id, teamId: null, status: 'FREE_AGENT', isDraftee: true };
  if (searchParams.pos) where.position = searchParams.pos;
  if (shortlistOnly) where.id = { in: Array.from(shortlistIds) };
  const pool = await prisma.player.findMany({ where, orderBy: { trueOvr: 'desc' }, take: shortlistOnly ? undefined : (draftLive ? 80 : 300) });
  const reports = await prisma.scoutingReport.findMany({ where: { teamId: team.id, playerId: { in: pool.map((p) => p.id) } } });
  const reportMap = new Map(reports.map((r) => [r.playerId, r]));
  const positions = Array.from(new Set(pool.map((p) => p.position))).sort((a, b) => positionSortKey(a) - positionSortKey(b));

  const recentPicks = await prisma.transaction.findMany({ where: { leagueId: league.id, type: 'DRAFT' }, orderBy: { createdAt: 'desc' }, take: 10 });
  const classOutlook = await prisma.transaction.findFirst({
    where: { leagueId: league.id, type: 'NEWS', headline: { contains: 'Draft Class Outlook' } },
    orderBy: { createdAt: 'desc' },
  });

  const rows = pool.map((p) => {
    const view = buildScoutedView({
      position: p.position as any, trueAttrs: readJson(p.trueAttrs, {}), trueOvr: p.trueOvr, potential: p.potential,
      report: reportMap.get(p.id), settings, isOwnRoster: false, isUserView: true,
    });
    return { p, view };
  });

  // Consensus big-board rank — position-weighted, computed over the WHOLE
  // class regardless of any position/shortlist filter currently applied, so
  // "#1 overall" means the same thing no matter which slice of the board
  // you're looking at. Reuses the filtered fetch above when nothing's
  // filtering it down (the common case) instead of a second full query.
  const classForRank = !searchParams.pos && !shortlistOnly
    ? rows
    : await (async () => {
        const fullPool = await prisma.player.findMany({ where: { leagueId: league.id, teamId: null, status: 'FREE_AGENT', isDraftee: true }, take: 500 });
        const fullReports = await prisma.scoutingReport.findMany({ where: { teamId: team.id, playerId: { in: fullPool.map((p) => p.id) } } });
        const fullReportMap = new Map(fullReports.map((r) => [r.playerId, r]));
        return fullPool.map((p) => ({
          p,
          view: buildScoutedView({
            position: p.position as any, trueAttrs: readJson(p.trueAttrs, {}), trueOvr: p.trueOvr, potential: p.potential,
            report: fullReportMap.get(p.id), settings, isOwnRoster: false, isUserView: true,
          }),
        }));
      })();
  const ranked = [...classForRank].sort((a, b) =>
    bigBoardScore(b.view.scoutedOvr, b.p.position as any, b.p.id, league.week, AI.DRAFT_POSITION_VALUE[b.p.position as Position] ?? 1) -
    bigBoardScore(a.view.scoutedOvr, a.p.position as any, a.p.id, league.week, AI.DRAFT_POSITION_VALUE[a.p.position as Position] ?? 1),
  );
  const rankById = new Map(ranked.map(({ p }, i) => [p.id, i + 1]));
  const rankBadge = (playerId: string): { label: string; className: string } | null => {
    const rank = rankById.get(playerId);
    if (!rank) return null;
    if (rank === 1) return { label: '#1 Consensus', className: 'text-gold' };
    if (rank <= 5) return { label: 'Top 5', className: 'text-gold' };
    if (rank <= 10) return { label: 'Top 10', className: 'text-accent' };
    if (rank <= 32) return { label: 'Top 32', className: 'text-accent2' };
    return null;
  };

  const sortKey: SortKey = (['consensus', 'pos', 'ovr', 'age', 'potential'] as SortKey[]).includes(searchParams.sort as SortKey)
    ? (searchParams.sort as SortKey) : 'consensus';
  const dir = searchParams.dir === 'asc' ? 1 : -1;

  const sorted = [...rows].sort((a, b) => {
    switch (sortKey) {
      // Rank 1 is the BEST prospect, so "best first" (the default, dir=-1)
      // means ascending rank number — the opposite direction of every other
      // column here, where higher is better. Flip the sign to match.
      case 'consensus': return ((rankById.get(a.p.id) ?? Infinity) - (rankById.get(b.p.id) ?? Infinity)) * -dir;
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

  const shortlistQuery = shortlistOnly ? 'shortlist=1&' : '';
  const posQuery = (searchParams.pos ? `pos=${searchParams.pos}&` : '') + shortlistQuery;
  const sortHref = (key: SortKey) => {
    const nextDir = sortKey === key && dir === -1 ? 'asc' : 'desc';
    return `/league/${league.id}/draft?${posQuery}sort=${key}&dir=${nextDir}`;
  };
  const posHref = (pos?: string) => {
    const suffix = `${shortlistQuery}sort=${sortKey}&dir=${dir === -1 ? 'desc' : 'asc'}`;
    return pos ? `/league/${league.id}/draft?pos=${pos}&${suffix}` : `/league/${league.id}/draft?${suffix}`;
  };
  const shortlistHref = () => {
    const posP = searchParams.pos ? `pos=${searchParams.pos}&` : '';
    const suffix = `sort=${sortKey}&dir=${dir === -1 ? 'desc' : 'asc'}`;
    return `/league/${league.id}/draft?${posP}${shortlistOnly ? '' : 'shortlist=1&'}${suffix}`;
  };

  const onClockColor = onClockTeam ? generateTeamLogoParams(onClockTeam.id).primary : undefined;

  return (
    <div className="space-y-6">
      {classOutlook && (
        <div className="panel px-4 py-3 flex items-start gap-3">
          <span className="label-sm text-accent2 shrink-0 mt-0.5">Class Outlook</span>
          <p className="text-sm text-chalk/90">{classOutlook.detail}</p>
        </div>
      )}

      {!(state && onClockTeam) && (
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {state ? (state.kind === 'FANTASY' ? 'Fantasy Draft' : `Rookie Draft — Round ${state.round}`) : `${league.seasonYear} Draft Class`}
          </h1>
          <p className="text-muted text-sm mt-1">
            {state
              ? `Pick ${state.pickIndex + 1} of ${totalPicks}`
              : `${pool.length} prospects on the board — scout them now, the draft opens after free agency.`}
          </p>
        </div>
      )}

      {state && onClockTeam && (
        <div
          className="relative overflow-hidden rounded-lg border-2 shadow-elevated"
          style={{
            ['--team-accent' as never]: onClockColor,
            borderColor: 'var(--team-accent)',
            background: 'radial-gradient(ellipse 120% 140% at 0% 50%, color-mix(in srgb, var(--team-accent) 18%, transparent), transparent 70%)',
          }}
        >
          <div
            className="absolute inset-0 opacity-[0.05] pointer-events-none"
            style={{ backgroundImage: 'repeating-linear-gradient(115deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 14px)', color: 'var(--team-accent)' }}
          />
          <TeamLogo seed={onClockTeam.id} abbr={onClockTeam.abbr} size={240} className="watermark-logo opacity-[0.06] -right-16 -top-16" />

          <div className="relative flex flex-wrap items-center justify-between gap-4 px-6 py-6">
            <div className="flex items-center gap-4 min-w-[260px]">
              <TeamLogo seed={onClockTeam.id} abbr={onClockTeam.abbr} size={56} />
              <div>
                <div className="label-sm">
                  {state.kind === 'FANTASY' ? 'Fantasy Draft' : `Round ${state.round}`} · Pick {state.pickIndex + 1} of {totalPicks}
                </div>
                <div className="font-display font-extrabold text-3xl uppercase tracking-wide leading-none mt-1" style={{ color: 'var(--team-text)' }}>
                  {isUserOnClock ? 'You Are On The Clock' : `${onClockTeam.city} On The Clock`}
                </div>
              </div>
            </div>
            <LiveDraftTicker leagueId={league.id} userTeamId={team.id} isUserOnClock={isUserOnClock} draftComplete={false} />
          </div>
        </div>
      )}

      {upcomingPicks.length > 1 && (
        <div className="panel p-4">
          <h2 className="label-sm mb-2">Upcoming Picks</h2>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {upcomingPicks.map((p) => (
              <div
                key={p.idx}
                title={p.team ? `${p.team.city} ${p.team.nickname}` : ''}
                className={`shrink-0 flex flex-col items-center gap-1 px-2 py-1.5 rounded-lg border ${
                  p.idx === state!.pickIndex
                    ? 'border-accent bg-accent/10'
                    : p.team?.id === team.id
                    ? 'border-accent2/50 bg-accent2/10'
                    : 'border-line bg-raised'
                }`}
              >
                {p.team && <TeamLogo seed={p.team.id} abbr={p.team.abbr} size={20} />}
                <span className="text-[10px] font-mono font-semibold">{p.team?.abbr ?? '—'}</span>
                <span className="text-[9px] text-muted font-mono">Pick {p.idx + 1}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section">
        <SectionHeading
          title="Big Board"
          action={
            <div className="flex gap-2 flex-wrap items-center">
              <a href={posHref()} className={`pill ${!searchParams.pos ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted'}`}>All</a>
              {positions.map((pos) => (
                <a key={pos} href={posHref(pos)} className={`pill ${searchParams.pos === pos ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted'}`}>{pos}</a>
              ))}
              <a href={shortlistHref()} className={`pill ${shortlistOnly ? 'border-gold text-gold bg-gold/10' : 'border-line text-muted'}`}>
                ★ Shortlist {shortlistIds.size > 0 && `(${shortlistIds.size})`}
              </a>
            </div>
          }
        />

        <div className="panel overflow-hidden">
          <table className="table-clean">
            <thead>
              <tr>
                <th></th>
                <th><a href={sortHref('consensus')} className="hover:text-chalk">Rank{sortKey === 'consensus' && (dir === -1 ? ' ▾' : ' ▴')}</a></th>
                <th><a href={sortHref('pos')} className="hover:text-chalk">Pos{sortKey === 'pos' && (dir === -1 ? ' ▾' : ' ▴')}</a></th>
                <th>Name</th>
                <th><a href={sortHref('age')} className="hover:text-chalk">Age{sortKey === 'age' && (dir === -1 ? ' ▾' : ' ▴')}</a></th>
                <th><a href={sortHref('ovr')} className="hover:text-chalk">{settings.scoutingEnabled ? 'Scouted' : 'OVR'}{sortKey === 'ovr' && (dir === -1 ? ' ▾' : ' ▴')}</a></th>
                <th><a href={sortHref('potential')} className="hover:text-chalk">Potential{sortKey === 'potential' && (dir === -1 ? ' ▾' : ' ▴')}</a></th>
                <th>Projection</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ p, view }) => {
                const potentialForLabel = view.revealed ? p.potential : (view.potLow + view.potHigh) / 2;
                const label = playerLabel({ ovr: view.scoutedOvr, potential: potentialForLabel, isDraftee: true, experience: 0 });
                return (
                  <tr key={p.id}>
                    <td><ShortlistStar leagueId={league.id} teamId={team.id} playerId={p.id} initial={shortlistIds.has(p.id)} /></td>
                    <td className="stat-value text-stat-sm text-muted text-right">{rankById.get(p.id) ?? '—'}</td>
                    <td><span className={`font-semibold text-xs ${positionBadgeClass(p.position)}`}>{p.position}</span></td>
                    <td className="font-medium">
                      <div className="flex items-center gap-2">
                        <a href={`/league/${league.id}/player/${p.id}`} className="flex items-center gap-2 hover:text-accent2">
                          <PlayerAvatar seed={p.id} age={p.age} size={26} /> {p.firstName} {p.lastName} <span className="text-xs text-muted">{p.college}</span>
                        </a>
                        {rankBadge(p.id) && (
                          <span className={`pill text-[10px] px-1.5 py-0.5 border-current ${rankBadge(p.id)!.className}`}>{rankBadge(p.id)!.label}</span>
                        )}
                      </div>
                    </td>
                    <td className="text-muted">{p.age}</td>
                    <td className={`stat-value text-stat-sm ${ratingColor(view.scoutedOvr)}`}>{view.revealed ? view.scoutedOvr : `${view.ovrLow}-${view.ovrHigh}`}</td>
                    <td className="text-muted font-mono">{view.revealed ? p.potential : `${view.potLow}-${view.potHigh}`}</td>
                    <td><span className={`text-xs font-medium ${label.className}`}>{label.label}</span></td>
                    <td>{isUserOnClock && <DraftPickButton leagueId={league.id} teamId={team.id} playerId={p.id} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <SectionHeading title="Recent Picks" />
        <div className="panel px-4">
          {recentPicks.map((t) => (
            <div key={t.id} className="text-sm text-muted py-2 border-b border-line/60 last:border-0">{t.headline}</div>
          ))}
          {recentPicks.length === 0 && <p className="text-muted text-sm py-2">No picks yet.</p>}
        </div>
      </div>
    </div>
  );
}
