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
import type { Position } from '@/lib/tuning';
import { SeasonStats } from '@/lib/types';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { FillRosterButton } from '@/components/FillRosterButton';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { Tooltip } from '@/components/Tooltip';
import { tip } from '@/lib/glossary';
import { RosterGroupHeader } from '@/components/ds/RosterGroupHeader';
import { startersAt } from '@/lib/lineup';
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

/*
 * GROUPS THAT ARE REALLY SEVERAL JOBS GET SPLIT ON THIS PAGE.
 *
 * "Offensive Line" over five men reads as one interchangeable block, and the
 * app owner's note is that it is confusing to look at — a left tackle and a
 * right guard are not the same job, and the roster page was the one screen
 * that implied they were. Same for the two ends of a defensive line and for
 * corners against safeties.
 *
 * Split HERE and not in lib/positionGroups.ts on purpose: that taxonomy is
 * shared with the analytics charts (where 17 series is unreadable, and worse
 * under colour-vision deficiency) and with STARTERS_AT_GROUP in lib/lineup.ts,
 * which is the single definition of the starting eleven. This is a display
 * decision about one table, so it lives with that table.
 */
const SPLIT_INTO_POSITIONS: Partial<Record<PositionGroup, Position[]>> = {
  OL: ['LT', 'LG', 'C', 'RG', 'RT'],
  DL: ['EDGE', 'DT'],
  DB: ['CB', 'S'],
};

const POSITION_LABEL: Partial<Record<Position, string>> = {
  LT: 'Left Tackle', LG: 'Left Guard', C: 'Center', RG: 'Right Guard', RT: 'Right Tackle',
  EDGE: 'Edge Rushers', DT: 'Interior Line',
  CB: 'Cornerbacks', S: 'Safeties',
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
    // NO `isProspect` HERE, ON PURPOSE. These are your own signed players, and
    // a roster page that reads as guesswork about your own men is the exact
    // failure fog was cut back to avoid (see the SCOPE block in
    // lib/scouting.ts). `fogOnOwnRoster` already defaulted false, so this
    // screen was unfogged before the scope change too — the call stays routed
    // through buildScoutedView so one function still owns the answer.
    const view = buildScoutedView({
      position: p.position as any, trueAttrs: readJson(p.trueAttrs, {}), trueOvr: p.trueOvr, potential: p.potential,
      report: reportMap.get(p.id), settings, isOwnRoster: true, isUserView: true, dynasty: scoutMods,
    });
    return { p, view, hit: capHit(p.contract, settings.capMode) };
  });

  /*
   * WHO ACTUALLY PLAYS. The Depth Chart's manual ranking, falling back to the
   * best true rating at that exact position for anyone never ranked.
   *
   * ONE PER POSITION WAS WRONG, and visibly so. This was a Map of position to
   * a SINGLE player id, so a defence that fields two edge rushers, two
   * tackles, two linebackers, three corners and two safeties printed exactly
   * one "Starter" tag in each of those groups — the second edge rusher on the
   * field read as a backup. Offence had it too: three receivers start and one
   * was tagged.
   *
   * `startersAt` (lib/lineup.ts) is THE definition of how many men are on the
   * field at a position, and DepthChartGroup has always used it. This page had
   * its own rule instead, so the two screens disagreed about who starts — and
   * the comment that used to sit here claimed they agreed, which is the same
   * defect one layer up.
   *
   * A slot whose player is no longer on the roster is skipped rather than
   * counted: DepthChartSlot rows outlive a trade or a cut until the next
   * checkpoint sweeps them, and a starter tag on a man who left is worse than
   * no tag at all.
   */
  const onRoster = new Set(players.map((p) => p.id));
  const rankedByPosition = new Map<string, string[]>();
  for (const s of slots) {
    if (!onRoster.has(s.playerId)) continue;
    rankedByPosition.set(s.position, [...(rankedByPosition.get(s.position) ?? []), s.playerId]);
  }
  const starterIds = new Set<string>();
  for (const position of new Set(players.map((p) => p.position))) {
    const spots = startersAt(position);
    if (spots <= 0) continue;
    const ranked = rankedByPosition.get(position) ?? [];
    const alreadyRanked = new Set(ranked);
    const unranked = players
      .filter((p) => p.position === position && !alreadyRanked.has(p.id))
      .sort((a, b) => b.trueOvr - a.trueOvr)
      .map((p) => p.id);
    for (const id of [...ranked, ...unranked].slice(0, spots)) starterIds.add(id);
  }

  // What kind of team this is, not just who's on it — starter rating at each
  // unit against the league's average starter there. Computed after the
  // starter set above so "aging starters" means the men who actually play.
  // That count was structurally short for the same reason the tag was: it
  // could never exceed one man per position, so a club could not have more
  // than sixteen starters at all, let alone sixteen aged thirty or over.
  const leagueRatings = await buildLeagueRatings(league.id);
  const myRating = leagueRatings.get(team.id);

  const shape = await buildRosterShape(
    league.id,
    team.id,
    players.map((p) => ({ position: p.position, trueOvr: p.trueOvr, age: p.age, contract: p.contract })),
    starterIds,
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
        // `potentialRevealed`, not `revealed`: a player can have an exact OVR
        // and a banded ceiling at the same time (see lib/scouting.ts's three
        // tiers). Sorting off the wrong flag would read a true potential the
        // column is not printing.
        const av = a.view.potentialRevealed ? a.p.potential : (a.view.potLow + a.view.potHigh) / 2;
        const bv = b.view.potentialRevealed ? b.p.potential : (b.view.potLow + b.view.potHigh) / 2;
        return (av - bv) * dir;
      }
      case 'cap': return (a.hit - b.hit) * dir;
      case 'years': return ((a.p.contract?.yearsRemaining ?? 0) - (b.p.contract?.yearsRemaining ?? 0)) * dir;
      default: return (positionSortKey(a.p.position) - positionSortKey(b.p.position)) * dir || b.p.trueOvr - a.p.trueOvr;
    }
  });
  const teamColor = generateTeamLogoParams(team.abbr).primary;

  // The header should say what's actually SHOWN, not what the settings would
  // permit. Fog is scoped to draft prospects now (see lib/scouting.ts), so no
  // signed player on this page is ever fogged and this reads "OVR" — but ask
  // the views rather than hard-coding it, so the label cannot drift away from
  // the column the way the free-agency one did.
  const fogged = rows.some((r) => !r.view.revealed);
  const ovrLabel = fogged ? 'Scouted OVR' : 'OVR';

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

  // ONE definition of a roster line, so the split sections (offensive line,
  // defensive line, secondary) and the whole-group sections render exactly
  // the same row. It was inline in the group loop, which meant a split
  // section would have needed a second copy of it.
  const renderRow = ({ p, view, hit }: (typeof sorted)[number]) => {
    const isStarter = starterIds.has(p.id);
    // Regular season only — seasonStats is the regular-season bucket (see
    // Player.seasonStats in the schema). A roster line is a "what has he
    // done for me lately", and folding in a January run would make two
    // players with identical seasons read differently.
    const production = productionLine(p.position, readJson<SeasonStats>(p.seasonStats, {}));
    return (
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
                {/* `.text-team`, not the raw primary. Painting this tag with
                    the raw teamColor put it at 2.72:1 for Boston's teal and
                    1.08:1 for the midnight pair — a label nobody could read
                    on the row it describes. The utility's color-mix clears
                    5.03:1 for every team, and --team-accent is set here so
                    it resolves against THIS club, not the house blue. */}
                {isStarter && <span className="text-[10px] uppercase tracking-wider font-semibold text-team" style={{ ['--team-accent' as never]: teamColor }}>Starter</span>}
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
        <td className="text-muted font-mono">{view.potentialRevealed ? p.potential : `${view.potLow}-${view.potHigh}`}</td>
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
  };

  let lastUnit: string | null = null;
  const bodyRows: React.ReactNode[] = [];
  for (const group of groupOrder) {
    const groupRows = sorted.filter(({ p }) => positionGroup(p.position) === group);
    if (groupRows.length === 0) continue;

    const unit = UNIT_FOR_GROUP[group];
    if (unit !== lastUnit) {
      bodyRows.push(
        <tr key={`unit-${unit}`}>
          {/* Full `muted`. At muted/60 this composited to 2.97:1 on the card
              surface, and it is the only thing on the page telling you where
              offence stops and defence starts. */}
          <td colSpan={8} className={`px-3 text-[11px] font-display font-bold uppercase tracking-[0.18em] text-muted ${lastUnit ? 'pt-5' : 'pt-1'} pb-1`}>
            {unit}
          </td>
        </tr>
      );
      lastUnit = unit;
    }

    // A split group emits one header per position instead of one for the
    // block. Everything below — the totals, the thin check — is computed off
    // whichever set of rows the header is actually describing, so a section
    // never summarises men it isn't showing.
    const split = SPLIT_INTO_POSITIONS[group];
    if (split) {
      const seen = new Set<string>();
      const order = sortKey === 'pos' && dir === 1 ? [...split].reverse() : split;
      for (const pos of order) {
        const posRows = groupRows.filter(({ p }) => p.position === pos);
        if (posRows.length === 0) continue;
        posRows.forEach(({ p }) => seen.add(p.id));
        bodyRows.push(
          <RosterGroupHeader
            key={`group-${group}-${pos}`}
            label={POSITION_LABEL[pos] ?? pos}
            count={posRows.length}
            avgOvr={posRows.reduce((s, r) => s + r.view.scoutedOvr, 0) / posRows.length}
            capHit={settings.capMode === 'OFF' ? null : posRows.reduce((s, r) => s + r.hit, 0)}
            thin={posRows.length <= 1}
          />
        );
        for (const row of posRows) bodyRows.push(renderRow(row));
      }
      // Anything the split table doesn't name still has to appear — a roster
      // is not allowed to hide a man because a display list is out of date.
      const orphans = groupRows.filter(({ p }) => !seen.has(p.id));
      if (orphans.length > 0) {
        bodyRows.push(
          <RosterGroupHeader
            key={`group-${group}-other`}
            label={GROUP_LABEL[group]}
            count={orphans.length}
            avgOvr={orphans.reduce((s, r) => s + r.view.scoutedOvr, 0) / orphans.length}
            capHit={settings.capMode === 'OFF' ? null : orphans.reduce((s, r) => s + r.hit, 0)}
            thin={false}
          />
        );
        for (const row of orphans) bodyRows.push(renderRow(row));
      }
      continue;
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

    for (const row of groupRows) {
      bodyRows.push(renderRow(row));
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
            // The re-sign page IS the list of these men, one negotiation per
            // row. Counting them here and making the GM find that screen from
            // the nav was the whole dead end.
            href: expiring > 0 ? `/league/${league.id}/resign` : undefined,
          },
          ...(capSummary ? [{
            label: 'Cap Space',
            value: formatMoney(capSummary.capSpace),
            detail: `${formatMoney(capSummary.capUsed)} committed`,
            tip: tip('capSpace'),
            color: capSummary.capSpace >= 0 ? 'text-accent' : 'text-bad',
            href: `/league/${league.id}/cap`,
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
                    {/* THE COLOUR IS PART OF THE COLUMN, so it is part of the
                        column's explanation. Every rating in this game is
                        drawn in its tier's ink (ratingColor, lib/ratings.ts)
                        and until now nothing anywhere told the player that —
                        a re-sign screenshot with 93 gold, 88 green, 85 green,
                        79 blue and 75 white in one column, and no legend on
                        any screen. Gated on `fogged` for the same reason the
                        label is: when the cell shows a RANGE, the ink comes
                        from the fogged centre point, and calling that "the
                        tier he falls in" would be promising a read the fog is
                        there to withhold. No signed player is fogged today —
                        fog is scoped to prospects — but the gate keeps this
                        honest if that ever changes. */}
                    <Tooltip placement="bottom" text={fogged ? tip('scoutedRange') : `${tip('overall')} ${tip('ratingColours')}`} />
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
