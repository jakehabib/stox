import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { readJson } from '@/lib/json';
import { buildScoutedView } from '@/lib/scouting';
import { loadScoutMods } from '@/lib/dynasty';
import { ratingColor, playerLabel } from '@/lib/ratings';
import { positionSortKey } from '@/lib/league-data';
import { LEAGUE } from '@/lib/tuning';
import { consensusBoardMap, ownGradeFor, disagreementNote } from '@/lib/consensus';
import { imminentDraftYear } from '@/lib/draft';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { DraftPickButton } from '@/components/DraftPickButton';
import { LiveDraftTicker } from '@/components/LiveDraftTicker';
import { ShortlistStar } from '@/components/ShortlistStar';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { TeamLogo } from '@/components/TeamLogo';
import { SectionHeading } from '@/components/ds/SectionHeading';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { Tooltip } from '@/components/Tooltip';
import { tip } from '@/lib/glossary';

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
  // Same rule as Free Agency: the headline count describes the whole class,
  // not the slice below it. Reporting slice.length claimed "300 prospects"
  // against a 400-deep class — and during a live draft the slice narrows to
  // 80, which would have made that claim off a sample of 80.
  const classWhere = { leagueId: league.id, teamId: null, status: 'FREE_AGENT', isDraftee: true } as const;
  const [pool, classSize] = await Promise.all([
    prisma.player.findMany({ where, orderBy: { trueOvr: 'desc' }, take: shortlistOnly ? undefined : (draftLive ? 80 : 300) }),
    prisma.player.count({ where: classWhere }),
  ]);
  const reports = await prisma.scoutingReport.findMany({ where: { teamId: team.id, playerId: { in: pool.map((p) => p.id) } } });
  const reportMap = new Map(reports.map((r) => [r.playerId, r]));
  const positions = Array.from(new Set(pool.map((p) => p.position))).sort((a, b) => positionSortKey(a) - positionSortKey(b));

  const recentPicks = await prisma.transaction.findMany({ where: { leagueId: league.id, type: 'DRAFT' }, orderBy: { createdAt: 'desc' }, take: 10 });
  const classOutlook = await prisma.transaction.findFirst({
    where: { leagueId: league.id, type: 'NEWS', headline: { contains: 'Draft Class Outlook' } },
    orderBy: { createdAt: 'desc' },
  });

  // Dynasty scouting upgrades tighten every range on this board (and a
  // prospect the GM spent a Full Scout on comes back fully revealed via his
  // report row). Omitting the argument means "no skills", so this is additive.
  const scoutMods = await loadScoutMods(league.id);

  const rows = pool.map((p) => {
    const view = buildScoutedView({
      // KEEPS ITS FOG. This is the draft board — the one screen where "we
      // don't know yet" is the whole story, so every range on it is earned.
      // `where` above already filters to isDraftee, so this is true for every
      // row; read off the record anyway so the claim is checkable, not assumed.
      isProspect: p.isDraftee,
      position: p.position as any, trueAttrs: readJson(p.trueAttrs, {}), trueOvr: p.trueOvr, potential: p.potential,
      report: reportMap.get(p.id), settings, isOwnRoster: false, isUserView: true, dynasty: scoutMods,
    });
    return { p, view };
  });

  // THE CONSENSUS BOARD. This rank is the public one — lib/consensus.ts grades
  // every prospect off nothing but public signals (testing, program, the gap
  // between what he is and what he could be, a medical flag) and ranks the
  // class by the boardScore it publishes on every row. It is identical for
  // every team in the league, which is what "consensus" has to mean.
  //
  // What it replaces was a rank computed from THIS team's own scoutedOvr — a
  // private board wearing the word consensus, where two teams saw different
  // "#1 overall" for the same player.
  //
  // Queried by draftYear over the WHOLE class, drafted prospects INCLUDED, so
  // a prospect's rank never moves because somebody else came off the board.
  // Filters on this page (position, shortlist) narrow the rows, never the
  // ranking pool.
  const classYearRow = await prisma.player.findFirst({
    where: { leagueId: league.id, isDraftee: true },
    orderBy: { draftYear: 'desc' },
    select: { draftYear: true },
  });
  const classYear = classYearRow?.draftYear ?? league.seasonYear;
  const consensus = consensusBoardMap(
    await prisma.player.findMany({
      where: { leagueId: league.id, draftYear: classYear },
      select: {
        id: true, position: true, trueOvr: true, potential: true,
        trueAttrs: true, collegeStats: true, combineTesting: true, injuryWeeks: true,
      },
    }),
    { teams: LEAGUE.TEAM_COUNT, rounds: settings.draftRounds },
  );

  const rankBadge = (playerId: string): { label: string; className: string } | null => {
    const read = consensus.get(playerId);
    if (!read) return null;
    if (read.rank === 1) return { label: '#1 Board', className: 'text-gold' };
    if (read.band === 'BLUE_CHIP') return { label: 'Blue chip', className: 'text-gold' };
    if (read.band === 'FIRST_ROUND') return { label: 'R1 grade', className: 'text-accent' };
    if (read.band === 'DAY_TWO') return { label: 'Day 2', className: 'text-accent2' };
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
      case 'consensus': return ((consensus.get(a.p.id)?.rank ?? Infinity) - (consensus.get(b.p.id)?.rank ?? Infinity)) * -dir;
      case 'ovr': return (a.view.scoutedOvr - b.view.scoutedOvr) * dir;
      case 'age': return (a.p.age - b.p.age) * dir;
      case 'potential': {
        const av = a.view.potentialRevealed ? a.p.potential : (a.view.potLow + a.view.potHigh) / 2;
        const bv = b.view.potentialRevealed ? b.p.potential : (b.view.potLow + b.view.potHigh) / 2;
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

  const onClockColor = onClockTeam ? generateTeamLogoParams(onClockTeam.abbr).primary : undefined;

  // How much of this class you actually have a read on, and how much draft
  // capital you hold — the two things that decide whether the board in front
  // of you is useful yet.
  //
  // "Scouted" deliberately means HIGH confidence, not "confidence > 0": every
  // prospect carries a baseline report from league creation, so a >0 test
  // marked the entire class scouted and told you nothing. This matches the
  // threshold ScoutingRange itself labels HIGH.
  const scoutedCount = rows.filter(({ view }) => view.confidence >= 75).length;
  // Picks for the NEXT draft, not the current season year — once a draft has
  // happened, seasonYear and the upcoming draft year diverge (see lib/draft.ts).
  // Null once no future draft is scheduled — fall back to counting every
  // unused pick rather than silently reporting zero.
  const upcomingDraftYear = await imminentDraftYear(league.id);
  const myPickCount = await prisma.draftPick.count({
    where: {
      leagueId: league.id, ownerTeamId: team.id, used: false,
      ...(upcomingDraftYear !== null ? { year: upcomingDraftYear } : {}),
    },
  });

  return (
    <div className="space-y-6">
      {classOutlook && (
        <div className="panel px-4 py-3 flex items-start gap-3">
          <span className="label-sm text-accent2 shrink-0 mt-0.5">Class Outlook</span>
          <p className="text-sm text-chalk/90">{classOutlook.detail}</p>
        </div>
      )}

      {!(state && onClockTeam) && (
        <PageMasthead
          teamId={team.id}
          teamAbbr={team.abbr}
          eyebrow={state ? (state.kind === 'FANTASY' ? 'Fantasy Draft' : `Rookie Draft · Round ${state.round}`) : 'Scouting Hub'}
          // Named for the draft these prospects are actually selected in, not
          // the season being played: they're generated during one season and
          // drafted in the offseason after it, so seasonYear runs a year early
          // and wouldn't match the picks you'd spend on them.
          title={state ? `Pick ${state.pickIndex + 1} of ${totalPicks}` : `${upcomingDraftYear ?? league.seasonYear} Draft Class`}
          subtitle={state
            ? undefined
            : 'The incoming class is browsable all season — scout them now, the draft opens after free agency.'}
          facts={[
            { label: 'Prospects', value: String(classSize), detail: searchParams.pos ? `filtered to ${searchParams.pos}` : 'in the class' },
            {
              label: 'Shortlisted',
              tip: tip('shortlist'),
              value: String(shortlistIds.size),
              detail: shortlistIds.size > 0 ? 'flagged to watch' : 'star anyone to track them',
              color: shortlistIds.size > 0 ? 'text-gold' : undefined,
            },
            { label: 'Your Picks', value: String(myPickCount), detail: upcomingDraftYear !== null ? `owned in the ${upcomingDraftYear} draft` : 'unused picks owned', tip: tip('pickValue') },
            {
              label: 'Well Scouted',
              tip: tip('scoutingConfidence'),
              value: `${scoutedCount}`,
              detail: pool.length > 0 ? `of the top ${pool.length} shown` : 'nobody yet',
              color: scoutedCount === 0 ? 'text-warn' : undefined,
            },
          ]}
        />
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
                <div className="font-display font-extrabold text-3xl uppercase tracking-wide leading-none mt-1 text-team">
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
          <h2 className="label-sm mb-2 inline-flex items-center gap-1.5">
            Upcoming Picks
            <Tooltip text={tip('onTheClock')} />
          </h2>
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
          tip={tip('consensusBoard')}
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
                <th>
                  <span className="inline-flex items-center gap-1">
                    <a href={sortHref('ovr')} className="hover:text-chalk">{settings.scoutingEnabled ? 'Scouted' : 'OVR'}{sortKey === 'ovr' && (dir === -1 ? ' ▾' : ' ▴')}</a>
                    <Tooltip placement="bottom" text={settings.scoutingEnabled ? tip('scoutedRange') : tip('overall')} />
                  </span>
                </th>
                <th>
                  <span className="inline-flex items-center gap-1">
                    <a href={sortHref('potential')} className="hover:text-chalk">Potential{sortKey === 'potential' && (dir === -1 ? ' ▾' : ' ▴')}</a>
                    {/* Downward: this table is wrapped in `panel
                        overflow-hidden`, which clips anything opening above
                        the header row. */}
                    <Tooltip placement="bottom" text={tip('potential')} />
                  </span>
                </th>
                <th>
                  <span className="inline-flex items-center gap-1">
                    Board Grade
                    <Tooltip placement="bottom" text={tip('boardGrade')} />
                  </span>
                </th>
                <th>
                  <span className="inline-flex items-center gap-1">
                    Projection
                    <Tooltip placement="bottom" align="end" text={tip('draftBand')} />
                  </span>
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ p, view }) => {
                const potentialForLabel = view.potentialRevealed ? p.potential : (view.potLow + view.potHigh) / 2;
                const label = playerLabel({ ovr: view.scoutedOvr, potential: potentialForLabel, isDraftee: true, experience: 0, confidence: view.confidence });
                const read = consensus.get(p.id);
                // "Our file vs the board" goes through ownGradeFor, never a raw
                // scoutedOvr. The board grade blends current AND ceiling; a
                // scouted OVR is current only, so subtracting one from the
                // other would report us below the room on every prospect alive.
                const gap = read && view.confidence >= 25 ? ownGradeFor(view) - read.grade : 0;
                const note = read ? disagreementNote(read, view) : null;
                return (
                  <tr key={p.id}>
                    <td><ShortlistStar leagueId={league.id} teamId={team.id} playerId={p.id} initial={shortlistIds.has(p.id)} /></td>
                    <td className="stat-value text-stat-sm text-muted text-right">{read?.rank ?? '—'}</td>
                    <td><span className={`font-semibold text-xs ${positionBadgeClass(p.position)}`}>{p.position}</span></td>
                    <td className="font-medium">
                      <div className="flex items-center gap-2">
                        <a href={`/league/${league.id}/player/${p.id}`} className="flex items-center gap-2 hover:text-accent2">
                          <PlayerAvatar seed={p.id} age={p.age} size={26} weightLb={p.weightLb} heightIn={p.heightIn} position={p.position} /> {p.firstName} {p.lastName} <span className="text-xs text-muted">{p.college}</span>
                        </a>
                        {rankBadge(p.id) && (
                          <span className={`pill text-[10px] px-1.5 py-0.5 border-current ${rankBadge(p.id)!.className}`}>{rankBadge(p.id)!.label}</span>
                        )}
                      </div>
                    </td>
                    <td className="text-muted">{p.age}</td>
                    <td className={`stat-value text-stat-sm ${ratingColor(view.scoutedOvr)}`}>{view.revealed ? view.scoutedOvr : `${view.ovrLow}-${view.ovrHigh}`}</td>
                    <td className="text-muted font-mono">{view.potentialRevealed ? p.potential : `${view.potLow}-${view.potHigh}`}</td>
                    <td>
                      {read && (
                        <div className="flex items-baseline gap-1.5 whitespace-nowrap" title={note ?? read.headline}>
                          <span className="stat-value text-stat-sm text-chalk">{read.grade}</span>
                          {Math.abs(gap) >= 4 && (
                            <span className={`text-[11px] font-mono ${gap > 0 ? 'text-accent' : 'text-warn'}`}>
                              us {ownGradeFor(view)}
                            </span>
                          )}
                        </div>
                      )}
                      {read && <div className="text-[10px] text-muted leading-none mt-0.5">{read.bandLabel}</div>}
                    </td>
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
