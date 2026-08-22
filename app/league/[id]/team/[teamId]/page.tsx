import Link from 'next/link';
import { notFound } from 'next/navigation';
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
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { RosterGroupHeader } from '@/components/ds/RosterGroupHeader';
import { teamCapSummary } from '@/lib/cap-summary';
import { tip } from '@/lib/glossary';

export const dynamic = 'force-dynamic';

/**
 * ===========================================================================
 * ANOTHER CLUB'S ROSTER — THE SAME PAGE, WITHOUT THE BUTTONS
 * ===========================================================================
 * Clicking a rival in the standings used to open its FRANCHISE HISTORY, which
 * is a fine page and is not the question anyone is asking. What a GM wants
 * when he clicks another club is what a GM always wants: who have they got,
 * what are they paying, and where are they thin.
 *
 * READ-ONLY IS THE WHOLE POINT, and it is enforced by construction rather
 * than by hiding controls: this page renders no action component at all. The
 * server actions are guarded separately — assertPlayerOnUserTeam() in
 * app/actions/{roster,resign,extension}.ts refuses anything aimed at a man on
 * somebody else's roster, because a Server Action is a POST and a page that
 * declines to draw a button protects nothing.
 *
 * AND IT IS FOGGED. `isOwnRoster: false` means ratings come from what YOUR
 * scouts have filed on these men, not from the truth — the same
 * buildScoutedView every other screen routes through. That is the difference
 * between this and your own roster page, and it is the reason scouting a
 * trade target is worth doing.
 * ===========================================================================
 */

const GROUP_LABEL: Record<PositionGroup, string> = {
  QB: 'Quarterback', RB: 'Backfield', WR: 'Receivers', TE: 'Tight Ends',
  OL: 'Offensive Line', DL: 'Defensive Line', LB: 'Linebackers',
  DB: 'Secondary', ST: 'Special Teams',
};

const UNIT_FOR_GROUP: Record<PositionGroup, string> = {
  QB: 'Offense', RB: 'Offense', WR: 'Offense', TE: 'Offense', OL: 'Offense',
  DL: 'Defense', LB: 'Defense', DB: 'Defense',
  ST: 'Special Teams',
};

// The same split the user's own roster page uses — a left tackle and a right
// guard are not the same job, and one "Offensive Line" header over five men
// implies they are. See the note in app/league/[id]/roster/page.tsx.
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

export default async function RivalTeamPage({ params }: { params: { id: string; teamId: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);

  const team = await prisma.team.findUnique({ where: { id: params.teamId } });
  // A team id from another save must not resolve here. getLeagueContext has
  // already proved the caller may see THIS league; it says nothing about a
  // team id typed into the URL.
  if (!team || team.leagueId !== league.id) notFound();

  // Your own club has its own page, with the buttons on it.
  if (userTeam && team.id === userTeam.id) {
    return (
      <div className="space-y-4">
        <PageMasthead
          teamId={team.id} teamAbbr={team.abbr}
          eyebrow={`${league.seasonYear} Roster`} title={`${team.city} ${team.nickname}`}
          subtitle="This is your club."
          facts={[]}
        />
        <Link href={`/league/${league.id}/roster`} className="btn-primary inline-block">Open your roster ▸</Link>
      </div>
    );
  }

  const players = await prisma.player.findMany({
    where: { teamId: team.id, status: 'ACTIVE' },
    include: { contract: true },
  });

  // What YOUR scouts have filed on these men. Without this the page would be
  // a list of true ratings for a club you have never looked at.
  const reports = userTeam
    ? await prisma.scoutingReport.findMany({ where: { teamId: userTeam.id, playerId: { in: players.map((p) => p.id) } } })
    : [];
  const reportMap = new Map(reports.map((r) => [r.playerId, r]));
  const scoutMods = await loadScoutMods(league.id);

  const rows = players.map((p) => {
    const view = buildScoutedView({
      position: p.position as Position, trueAttrs: readJson(p.trueAttrs, {}), trueOvr: p.trueOvr,
      potential: p.potential, report: reportMap.get(p.id), settings,
      isOwnRoster: false, isUserView: true, dynasty: scoutMods,
    });
    return { p, view, hit: capHit(p.contract, settings.capMode) };
  });
  rows.sort((a, b) => positionSortKey(a.p.position) - positionSortKey(b.p.position) || b.view.scoutedOvr - a.view.scoutedOvr);

  const cap = settings.capMode !== 'OFF' ? await teamCapSummary(team.id, league.seasonYear, settings.capMode) : null;
  const avgOvr = rows.length > 0 ? rows.reduce((s, r) => s + r.view.scoutedOvr, 0) / rows.length : 0;
  const scouted = rows.filter((r) => reportMap.has(r.p.id)).length;
  const expiring = rows.filter((r) => (r.p.contract?.yearsRemaining ?? 99) <= 1).length;

  const renderRow = ({ p, view, hit }: (typeof rows)[number]) => (
    <tr key={p.id}>
      <td>
        <span className={`font-semibold text-xs ${positionBadgeClass(p.position)}`}>{p.position}</span>
      </td>
      <td>
        <Link href={`/league/${league.id}/player/${p.id}`} className="hover:text-accent2 flex items-center gap-2.5">
          <PlayerAvatar seed={p.id} age={p.age} size={30} weightLb={p.weightLb} heightIn={p.heightIn} position={p.position} />
          <span className="font-medium">{p.firstName} {p.lastName}</span>
        </Link>
      </td>
      <td className={`stat-value text-stat-sm ${ratingColor(view.scoutedOvr)}`}>
        <span className={ratingPlateClass(view.scoutedOvr) ?? undefined}>
          {view.scoutedOvr}
          {ratingMark(view.scoutedOvr) && <span className="ml-0.5 text-[0.7em] align-super not-italic">{ratingMark(view.scoutedOvr)}</span>}
        </span>
      </td>
      <td className="text-muted">{p.age}</td>
      {settings.capMode !== 'OFF' && <td className="font-mono text-muted">{formatMoney(hit)}</td>}
      <td className="text-muted">{p.contract?.yearsRemaining ?? '—'}</td>
    </tr>
  );

  let lastUnit: string | null = null;
  const bodyRows: React.ReactNode[] = [];
  for (const group of POSITION_GROUPS) {
    const groupRows = rows.filter(({ p }) => positionGroup(p.position) === group);
    if (groupRows.length === 0) continue;

    const unit = UNIT_FOR_GROUP[group];
    if (unit !== lastUnit) {
      bodyRows.push(
        <tr key={`unit-${unit}`}>
          <td colSpan={6} className={`px-3 text-[11px] font-display font-bold uppercase tracking-[0.18em] text-muted/60 ${lastUnit ? 'pt-5' : 'pt-1'} pb-1`}>
            {unit}
          </td>
        </tr>
      );
      lastUnit = unit;
    }

    const sections = SPLIT_INTO_POSITIONS[group]
      ? SPLIT_INTO_POSITIONS[group]!.map((pos) => ({ label: POSITION_LABEL[pos] ?? pos, rs: groupRows.filter(({ p }) => p.position === pos) }))
        // Anything the split list doesn't name still has to appear.
        .concat([{ label: GROUP_LABEL[group], rs: groupRows.filter(({ p }) => !SPLIT_INTO_POSITIONS[group]!.includes(p.position as Position)) }])
      : [{ label: GROUP_LABEL[group], rs: groupRows }];

    for (const section of sections) {
      if (section.rs.length === 0) continue;
      bodyRows.push(
        <RosterGroupHeader
          key={`sec-${group}-${section.label}`}
          label={section.label}
          count={section.rs.length}
          avgOvr={section.rs.reduce((s, r) => s + r.view.scoutedOvr, 0) / section.rs.length}
          capHit={settings.capMode === 'OFF' ? null : section.rs.reduce((s, r) => s + r.hit, 0)}
          thin={false}
        />
      );
      for (const row of section.rs) bodyRows.push(renderRow(row));
    }
  }

  return (
    <div className="space-y-5">
      <PageMasthead
        teamId={team.id}
        teamAbbr={team.abbr}
        eyebrow={`${league.seasonYear} · ${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ''}`}
        title={`${team.city} ${team.nickname}`}
        subtitle="Another club's roster, as your scouts have it. Nothing here is yours to move."
        facts={[
          { label: 'Roster Size', value: String(rows.length), detail: `${scouted} scouted` },
          { label: 'Average Rating', value: avgOvr.toFixed(1), detail: 'across the roster', tip: tip('overall') },
          ...(cap ? [{
            label: 'Cap Space',
            value: formatMoney(cap.capSpace),
            detail: cap.capSpace < 0 ? 'over the ceiling' : 'room to take salary on',
            color: cap.capSpace < 0 ? 'text-bad' : undefined,
            tip: tip('capSpace'),
          }] : []),
          {
            label: 'Expiring',
            value: String(expiring),
            detail: expiring > 0 ? 'deals up within a year' : 'nothing up soon',
            tip: tip('expiringContract'),
          },
        ]}
      />

      <div className="flex flex-wrap gap-2">
        <Link href={`/league/${league.id}/trade?partner=${team.id}`} className="btn-primary">Open a trade with them ▸</Link>
        <Link href={`/league/${league.id}/history?team=${team.id}#franchise`} className="btn-secondary">Franchise history</Link>
      </div>

      <div className="panel overflow-x-auto">
        <table className="table-tight w-full">
          <thead>
            <tr>
              <th className="w-12">Pos</th>
              <th>Player</th>
              <th className="w-16">Rating</th>
              <th className="w-12">Age</th>
              {settings.capMode !== 'OFF' && <th className="w-24">Cap Hit</th>}
              <th className="w-12">Yrs</th>
            </tr>
          </thead>
          <tbody>{bodyRows}</tbody>
        </table>
      </div>
    </div>
  );
}
