import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { ratingColor, ratingMark, ratingPlateClass } from '@/lib/ratings';
import { formatMoney, capHit } from '@/lib/cap';
import { readJson } from '@/lib/json';
import { buildScoutedView } from '@/lib/scouting';
import { loadScoutMods } from '@/lib/dynasty';
import { positionSortKey } from '@/lib/league-data';
import { POSITION_GROUPS, PositionGroup, positionGroup } from '@/lib/positionGroups';
import { SeasonStats } from '@/lib/types';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { FillRosterButton } from '@/components/FillRosterButton';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { Tooltip } from '@/components/Tooltip';
import { tip } from '@/lib/glossary';
import { RosterGroupHeader } from '@/components/ds/RosterGroupHeader';
import { teamCapSummary } from '@/lib/cap-summary';
import { buildRosterShape } from '@/lib/rosterShape';
import { buildLeagueRatings } from '@/lib/teamRating';
import { RosterShapePanel } from '@/components/ds/RosterShapePanel';

type SortKey = 'pos' | 'ovr' | 'age' | 'potential' | 'cap' | 'years';

const GROUP_LABEL: Record<PositionGroup, string> = {
  QB: 'Quarterback',
  RB: 'Backfield',
  WR: 'Receivers',
  TE: 'Tight Ends',
  OL: 'Offensive Line',
  DL: 'Defensive Line',
  LB: 'Linebackers',
  DB: 'Secondary',
  ST: 'Special Teams',
};

// Which broadcast-style "unit" banner a group falls under — purely a display
// grouping one level up from PositionGroup, so the page reads offense →
// defense → special teams instead of eight undifferentiated headers in a row.
const UNIT_FOR_GROUP: Record<PositionGroup, string> = {
  QB: 'Offense', RB: 'Offense', WR: 'Offense', TE: 'Offense', OL: 'Offense',
  DL: 'Defense', LB: 'Defense', DB: 'Defense',
  ST: 'Special Teams',
};

/**
 * The one-line box score a scout actually cares about, shaped per position —
 * mirrors the per-position stat picks on the Stats page, but condensed to a
 * single scannable string for a table row instead of a labeled grid.
 * Returns null for positions/players this sim doesn't box-score (OL) or who
 * haven't played yet, so the row just omits the line rather than showing zeros.
 */
function productionLine(position: string, s: SeasonStats): string | null {
  if (!s.gp) return null;
  switch (position) {
    case 'QB':
      return `${(s.passYds ?? 0).toLocaleString()} YDS · ${s.passTd ?? 0} TD · ${s.int ?? 0} INT`;
    case 'RB':
      return `${(s.rushYds ?? 0).toLocaleString()} YDS · ${s.rushTd ?? 0} TD · ${s.rushAtt ?? 0} ATT`;
    case 'WR': case 'TE':
      return `${s.rec ?? 0} REC · ${(s.recYds ?? 0).toLocaleString()} YDS · ${s.recTd ?? 0} TD`;
    case 'EDGE': case 'DT': case 'LB':
      return `${s.tackles ?? 0} TKL · ${s.sacks ?? 0} SK${s.ff ? ` · ${s.ff} FF` : ''}`;
    case 'CB': case 'S':
      return `${s.defInt ?? 0} INT · ${s.pd ?? 0} PD · ${s.tackles ?? 0} TKL`;
    case 'K':
      return `${s.fgm ?? 0}/${s.fga ?? 0} FG · ${s.xpm ?? 0}/${s.xpa ?? 0} XP`;
    case 'P':
      return s.punts ? `${s.punts} PUNTS · ${((s.puntYds ?? 0) / s.punts).toFixed(1)} AVG` : null;
    default:
      return null;
  }
}

export default async function RosterPage({ params, searchParams }: { params: { id: string }; searchParams: { sort?: string; dir?: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

  const [players, slots] = await Promise.all([
    prisma.player.findMany({ where: { teamId: team.id }, include: { contract: true } }),
    prisma.depthChartSlot.findMany({ where: { teamId: team.id }, orderBy: { rank: 'asc' } }),
  ]);
  const reports = await prisma.scoutingReport.findMany({ where: { teamId: team.id, playerId: { in: players.map((p) => p.id) } } });
  const reportMap = new Map(reports.map((r) => [r.playerId, r]));
  // Dynasty scouting upgrades tighten the ranges below. Omitting this argument
  // is safe (it means "no skills"), so nothing breaks if a page forgets it.
  const scoutMods = await loadScoutMods(league.id);

  const rows = players.map((p) => {
    const view = buildScoutedView({
      position: p.position as any, trueAttrs: readJson(p.trueAttrs, {}), trueOvr: p.trueOvr, potential: p.potential,
      report: reportMap.get(p.id), settings, isOwnRoster: true, isUserView: true, dynasty: scoutMods,
    });
    return { p, view, hit: capHit(p.contract, settings.capMode) };
  });

  // Who actually plays: the Depth Chart page's manual rank-0, falling back
  // to the best true rating at that exact position for anyone never set —
  // same "first player is the starter" rule DepthChartGroup already uses,
  // so the two pages agree on who's WR1 without the roster page reimplementing
  // depth-chart ordering itself.
  const starterIdByPosition = new Map<string, string>();
  for (const s of slots) if (!starterIdByPosition.has(s.position)) starterIdByPosition.set(s.position, s.playerId);
  for (const p of players) {
    if (starterIdByPosition.has(p.position)) continue;
    const incumbent = players.filter((x) => x.position === p.position).reduce((best, x) => (x.trueOvr > best.trueOvr ? x : best));
    starterIdByPosition.set(p.position, incumbent.id);
  }

  // What kind of team this is, not just who's on it — starter rating at each
  // unit against the league's average starter there. Computed after the
  // starter map above so "aging starters" means the men who actually play.
  const leagueRatings = await buildLeagueRatings(league.id);
  const myRating = leagueRatings.get(team.id);

  const shape = await buildRosterShape(
    league.id,
    team.id,
    players.map((p) => ({ position: p.position, trueOvr: p.trueOvr, age: p.age, contract: p.contract })),
    new Set(starterIdByPosition.values()),
    players.map((p) => ({ id: p.id, age: p.age })),
  );

  const sortKey: SortKey = (['pos', 'ovr', 'age', 'potential', 'cap', 'years'] as SortKey[]).includes(searchParams.sort as SortKey)
    ? (searchParams.sort as SortKey) : 'pos';
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
      case 'cap': return (a.hit - b.hit) * dir;
      case 'years': return ((a.p.contract?.yearsRemaining ?? 0) - (b.p.contract?.yearsRemaining ?? 0)) * dir;
      default: return (positionSortKey(a.p.position) - positionSortKey(b.p.position)) * dir || b.p.trueOvr - a.p.trueOvr;
    }
  });
  const teamColor = generateTeamLogoParams(team.abbr).primary;

  // Own roster is fully revealed unless the settings specifically fog it —
  // the header should say what's actually shown, not always claim "Scouted".
  const ovrLabel = settings.scoutingEnabled && settings.fogOnOwnRoster ? 'Scouted OVR' : 'OVR';

  const sortHref = (key: SortKey) => {
    const nextDir = sortKey === key && dir === -1 ? 'asc' : 'desc';
    return `/league/${league.id}/roster?sort=${key}&dir=${nextDir}`;
  };

  // Roster health at a glance — the questions you open this page to answer,
  // rather than making you scan 50 rows to work them out.
  const capSummary = settings.capMode === 'OFF'
    ? null
    : await teamCapSummary(team.id, league.seasonYear, settings.capMode);
  const injured = players.filter((p) => p.injuryWeeks > 0).length;
  const avgAge = players.length > 0 ? players.reduce((s, p) => s + p.age, 0) / players.length : 0;
  const avgOvr = rows.length > 0 ? rows.reduce((s, r) => s + r.view.scoutedOvr, 0) / rows.length : 0;
  const expiring = players.filter((p) => (p.contract?.yearsRemaining ?? 99) <= 1).length;

  // Group order tracks the depth-chart shape (QB → ST) by default so the
  // page always reads like a squad. The one exception: flipping the Pos
  // column itself should visibly do something, so that specific sort also
  // flips which end of the squad leads.
  const groupOrder = sortKey === 'pos' && dir === 1 ? [...POSITION_GROUPS].reverse() : POSITION_GROUPS;

  let lastUnit: string | null = null;
  const bodyRows: React.ReactNode[] = [];
  for (const group of groupOrder) {
    const groupRows = sorted.filter(({ p }) => positionGroup(p.position) === group);
    if (groupRows.length === 0) continue;

    const unit = UNIT_FOR_GROUP[group];
    if (unit !== lastUnit) {
      bodyRows.push(
        <tr key={`unit-${unit}`}>
          <td colSpan={8} className={`px-3 text-[11px] font-display font-bold uppercase tracking-[0.18em] text-muted/60 ${lastUnit ? 'pt-5' : 'pt-1'} pb-1`}>
            {unit}
          </td>
        </tr>
      );
      lastUnit = unit;
    }

    const groupAvgOvr = groupRows.reduce((s, r) => s + r.view.scoutedOvr, 0) / groupRows.length;
    const groupCap = groupRows.reduce((s, r) => s + r.hit, 0);
    // "Thin" means zero rostered depth beyond one body per exact position this
    // group covers — a flat headcount threshold would flag a normal 2-QB room
    // or a kicker/punter (always exactly one each) every single time.
    const startingSlots = new Set(groupRows.map((r) => r.p.position)).size;
    bodyRows.push(
      <RosterGroupHeader
        key={`group-${group}`}
        label={GROUP_LABEL[group]}
        count={groupRows.length}
        avgOvr={groupAvgOvr}
        capHit={settings.capMode === 'OFF' ? null : groupCap}
        thin={groupRows.length <= startingSlots}
      />
    );

    for (const { p, view, hit } of groupRows) {
      const isStarter = starterIdByPosition.get(p.position) === p.id;
      // Regular season only — seasonStats is the regular-season bucket (see
      // Player.seasonStats in the schema). A roster line is a "what has he
      // done for me lately", and folding in a January run would make two
      // players with identical seasons read differently.
      const production = productionLine(p.position, readJson<SeasonStats>(p.seasonStats, {}));
      bodyRows.push(
        <tr key={p.id} style={isStarter ? { background: `${teamColor}0d` } : undefined}>
          <td style={{ borderLeft: `3px solid ${isStarter ? teamColor : 'transparent'}` }}>
            <span className={`font-semibold text-xs ${positionBadgeClass(p.position)}`}>{p.position}</span>
          </td>
          <td>
            <Link href={`/league/${league.id}/player/${p.id}`} className="hover:text-accent2 flex items-center gap-2.5">
              <PlayerAvatar seed={p.id} age={p.age} size={30} teamColor={teamColor} weightLb={p.weightLb} heightIn={p.heightIn} position={p.position} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={isStarter ? 'font-semibold' : 'font-medium'}>{p.firstName} {p.lastName}</span>
                  {isStarter && <span className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: teamColor }}>Starter</span>}
                </div>
                {production && <div className="text-[11px] text-muted font-mono mt-0.5 truncate">{production}</div>}
              </div>
            </Link>
          </td>
          <td className="text-muted">{p.age}</td>
          <td className={`stat-value text-stat-sm ${ratingColor(view.scoutedOvr)}`}>
            {view.revealed || view.confidence >= 90 ? (
              // The mark is the non-colour channel for the top two steps; it
              // only appears when we are actually showing a number, never
              // beside a scouting range.
              <span className={ratingPlateClass(view.scoutedOvr) ?? undefined}>
                {view.scoutedOvr}
                {ratingMark(view.scoutedOvr) && <span className="ml-0.5 text-[0.7em] align-super not-italic">{ratingMark(view.scoutedOvr)}</span>}
              </span>
            ) : `${view.ovrLow}-${view.ovrHigh}`}
          </td>
          <td className="text-muted font-mono">{view.revealed ? p.potential : `${view.potLow}-${view.potHigh}`}</td>
          <td>
            {p.injuryWeeks > 0 ? (
              <span title={p.injuryType ?? 'Injured'} className="pill border-bad/30 text-bad bg-bad/10 cursor-help">Injured · {p.injuryWeeks}w</span>
            ) : (
              <span className="pill border-accent/30 text-accent bg-accent/10">Active</span>
            )}
          </td>
          <td className="font-mono text-muted">{settings.capMode === 'OFF' ? '—' : formatMoney(hit)}</td>
          <td className="text-muted">{p.contract?.yearsRemaining ?? '—'}</td>
        </tr>
      );
    }
  }

  return (
    <div className="space-y-5">
      <PageMasthead
        teamId={team.id}
        teamAbbr={team.abbr}
        eyebrow={`${league.seasonYear} Roster`}
        title={`${team.city} ${team.nickname}`}
        action={<FillRosterButton leagueId={league.id} teamId={team.id} />}
        facts={[
          {
            label: 'Roster Size',
            value: String(players.length),
            detail: injured > 0 ? `${injured} injured` : 'all healthy',
            color: injured > 0 ? 'text-warn' : undefined,
          },
          { label: `Average ${ovrLabel}`, value: avgOvr.toFixed(1), detail: 'across the roster', tip: tip('overall') },
          { label: 'Average Age', value: avgAge.toFixed(1), detail: 'years' },
          {
            label: 'Expiring',
            value: String(expiring),
            detail: expiring > 0 ? 'deals up within a year' : 'nothing up soon',
            tip: tip('expiringContract'),
            color: expiring > 0 ? 'text-warn' : undefined,
          },
          ...(capSummary ? [{
            label: 'Cap Space',
            value: formatMoney(capSummary.capSpace),
            detail: `${formatMoney(capSummary.capUsed)} committed`,
            tip: tip('capSpace'),
            color: capSummary.capSpace >= 0 ? 'text-accent' : 'text-bad',
          }] : []),
        ]}
      />

      <RosterShapePanel shape={shape} rating={myRating} />

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-clean">
            <thead>
              <tr>
                <th><Link href={sortHref('pos')} className="hover:text-chalk">Pos{sortKey === 'pos' && (dir === -1 ? ' ▾' : ' ▴')}</Link></th>
                <th>Player</th>
                <th><Link href={sortHref('age')} className="hover:text-chalk">Age{sortKey === 'age' && (dir === -1 ? ' ▾' : ' ▴')}</Link></th>
                <th>
                  <span className="inline-flex items-center gap-1">
                    <Link href={sortHref('ovr')} className="hover:text-chalk">{ovrLabel}{sortKey === 'ovr' && (dir === -1 ? ' ▾' : ' ▴')}</Link>
                    {/* Downward on every one of these: this table is inside
                        `panel overflow-hidden` AND an `overflow-x-auto`
                        scroller — the exact pair that once rendered a Cap-page
                        tooltip perfectly and clipped it out of existence. */}
                    <Tooltip placement="bottom" text={tip('overall')} />
                  </span>
                </th>
                <th>
                  <span className="inline-flex items-center gap-1">
                    <Link href={sortHref('potential')} className="hover:text-chalk">Pot.{sortKey === 'potential' && (dir === -1 ? ' ▾' : ' ▴')}</Link>
                    <Tooltip placement="bottom" text={tip('potential')} />
                  </span>
                </th>
                <th>Status</th>
                <th>
                  <span className="inline-flex items-center gap-1">
                    <Link href={sortHref('cap')} className="hover:text-chalk">Cap Hit{sortKey === 'cap' && (dir === -1 ? ' ▾' : ' ▴')}</Link>
                    <Tooltip placement="bottom" text={tip('capHit')} />
                  </span>
                </th>
                <th><Link href={sortHref('years')} className="hover:text-chalk">Years Left{sortKey === 'years' && (dir === -1 ? ' ▾' : ' ▴')}</Link></th>
              </tr>
            </thead>
            <tbody>
              {bodyRows}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
