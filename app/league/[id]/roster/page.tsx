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
import { FillRosterButton } from '@/components/FillRosterButton';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { teamCapSummary } from '@/lib/cap-summary';

type SortKey = 'pos' | 'ovr' | 'age' | 'potential' | 'cap' | 'years';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'pos', label: 'Pos' },
  { key: 'ovr', label: 'OVR' },
  { key: 'age', label: 'Age' },
  { key: 'potential', label: 'Pot.' },
  { key: 'cap', label: 'Cap Hit' },
  { key: 'years', label: 'Years Left' },
];

export default async function RosterPage({ params, searchParams }: { params: { id: string }; searchParams: { sort?: string; dir?: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

  const players = await prisma.player.findMany({
    where: { teamId: team.id },
    include: { contract: true },
  });
  const reports = await prisma.scoutingReport.findMany({ where: { teamId: team.id, playerId: { in: players.map((p) => p.id) } } });
  const reportMap = new Map(reports.map((r) => [r.playerId, r]));

  const rows = players.map((p) => {
    const view = buildScoutedView({
      position: p.position as any, trueAttrs: readJson(p.trueAttrs, {}), trueOvr: p.trueOvr, potential: p.potential,
      report: reportMap.get(p.id), settings, isOwnRoster: true, isUserView: true,
    });
    return { p, view, hit: capHit(p.contract, settings.capMode) };
  });

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
  const teamColor = generateTeamLogoParams(team.id).primary;

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
          { label: `Average ${ovrLabel}`, value: avgOvr.toFixed(1), detail: 'across the roster' },
          { label: 'Average Age', value: avgAge.toFixed(1), detail: 'years' },
          {
            label: 'Expiring',
            value: String(expiring),
            detail: expiring > 0 ? 'deals up within a year' : 'nothing up soon',
            color: expiring > 0 ? 'text-warn' : undefined,
          },
          ...(capSummary ? [{
            label: 'Cap Space',
            value: formatMoney(capSummary.capSpace),
            detail: `${formatMoney(capSummary.capUsed)} committed`,
            color: capSummary.capSpace >= 0 ? 'text-accent' : 'text-bad',
          }] : []),
        ]}
      />

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-clean">
            <thead>
              <tr>
                <th><Link href={sortHref('pos')} className="hover:text-chalk">Pos{sortKey === 'pos' && (dir === -1 ? ' ▾' : ' ▴')}</Link></th>
                <th>Name</th>
                <th><Link href={sortHref('age')} className="hover:text-chalk">Age{sortKey === 'age' && (dir === -1 ? ' ▾' : ' ▴')}</Link></th>
                <th><Link href={sortHref('ovr')} className="hover:text-chalk">{ovrLabel}{sortKey === 'ovr' && (dir === -1 ? ' ▾' : ' ▴')}</Link></th>
                <th><Link href={sortHref('potential')} className="hover:text-chalk">Pot.{sortKey === 'potential' && (dir === -1 ? ' ▾' : ' ▴')}</Link></th>
                <th>Status</th>
                <th><Link href={sortHref('cap')} className="hover:text-chalk">Cap Hit{sortKey === 'cap' && (dir === -1 ? ' ▾' : ' ▴')}</Link></th>
                <th><Link href={sortHref('years')} className="hover:text-chalk">Years Left{sortKey === 'years' && (dir === -1 ? ' ▾' : ' ▴')}</Link></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ p, view, hit }) => (
                <tr key={p.id}>
                  <td><span className={`font-semibold text-xs ${positionBadgeClass(p.position)}`}>{p.position}</span></td>
                  <td>
                    <Link href={`/league/${league.id}/player/${p.id}`} className="hover:text-accent2 font-medium flex items-center gap-2">
                      <PlayerAvatar seed={p.id} age={p.age} size={28} teamColor={teamColor} />
                      {p.firstName} {p.lastName}
                    </Link>
                  </td>
                  <td className="text-muted">{p.age}</td>
                  <td className={`stat-value text-stat-sm ${ratingColor(view.scoutedOvr)}`}>
                    {view.revealed || view.confidence >= 90 ? view.scoutedOvr : `${view.ovrLow}-${view.ovrHigh}`}
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
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
