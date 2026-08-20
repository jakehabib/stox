import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { positionSortKey } from '@/lib/league-data';
import { teamCapSummary } from '@/lib/cap-summary';
import { formatMoney, capHit, deadMoneyOnCut, capSavingsOnCut, capHitSchedule, capForYear, marketValue } from '@/lib/cap';
import { Tooltip } from '@/components/Tooltip';
import { POSITION_GROUPS, positionGroup } from '@/lib/positionGroups';
import { HorizontalBarChart } from '@/components/charts/HorizontalBarChart';
import { LineChart } from '@/components/charts/LineChart';
import { ScatterChart } from '@/components/charts/ScatterChart';

type SortKey = 'pos' | 'age' | 'ovr' | 'cap' | 'base' | 'years' | 'savings';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'pos', label: 'Pos' },
  { key: 'age', label: 'Age' },
  { key: 'ovr', label: 'OVR' },
  { key: 'cap', label: 'Cap Hit' },
  { key: 'base', label: 'Base' },
  { key: 'years', label: 'Yrs Left' },
  { key: 'savings', label: 'Cut: Savings / Dead' },
];

// Fixed group -> color assignment, in POSITION_GROUPS order — identity, not
// value-rank, drives the color per the dataviz skill's categorical rule.
const GROUP_COLOR: Record<string, string> = {
  QB: '#3987e5', RB: '#d95926', 'WR/TE': '#199e70', OL: '#c98500',
  DL: '#d55181', LB: '#008300', DB: '#9085e9', ST: '#e66767',
};

export default async function CapPage({ params, searchParams }: { params: { id: string }; searchParams: { sort?: string; dir?: string; view?: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;
  const advanced = searchParams.view === 'advanced';

  if (settings.capMode === 'OFF') {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Salary Cap</h1>
        <div className="card card-pad text-muted text-sm">
          Cap mode is set to <strong>Off</strong> in league settings — spending has no limit and cuts leave no dead money.
          Change this in <Link href={`/league/${league.id}/settings`} className="text-accent2 hover:underline">Settings</Link>.
        </div>
      </div>
    );
  }

  const [summary, players, deadRows] = await Promise.all([
    teamCapSummary(team.id, league.seasonYear, settings.capMode),
    prisma.player.findMany({ where: { teamId: team.id, status: 'ACTIVE' }, include: { contract: true } }),
    prisma.capCharge.findMany({ where: { teamId: team.id, year: league.seasonYear } }),
  ]);

  const usedPct = Math.min(100, Math.round((summary.capUsed / summary.capTotal) * 100));

  const rows = players.map((p) => {
    const bases = p.contract ? (JSON.parse(p.contract.baseSalaries) as number[]) : [];
    const yearIdx = p.contract ? Math.max(0, p.contract.years - p.contract.yearsRemaining) : 0;
    return {
      p,
      hit: capHit(p.contract, settings.capMode),
      base: bases[yearIdx] ?? 0,
      dead: deadMoneyOnCut(p.contract, settings.capMode),
      savings: capSavingsOnCut(p.contract, settings.capMode),
    };
  });

  const sortKey: SortKey = (['pos', 'age', 'ovr', 'cap', 'base', 'years', 'savings'] as SortKey[]).includes(searchParams.sort as SortKey)
    ? (searchParams.sort as SortKey) : 'cap';
  const dir = searchParams.dir === 'asc' ? 1 : -1;

  const sorted = [...rows].sort((a, b) => {
    switch (sortKey) {
      case 'age': return (a.p.age - b.p.age) * dir;
      case 'ovr': return (a.p.trueOvr - b.p.trueOvr) * dir;
      case 'cap': return (a.hit - b.hit) * dir;
      case 'base': return (a.base - b.base) * dir;
      case 'years': return ((a.p.contract?.yearsRemaining ?? 0) - (b.p.contract?.yearsRemaining ?? 0)) * dir;
      case 'savings': return (a.savings - b.savings) * dir;
      default: return (positionSortKey(a.p.position) - positionSortKey(b.p.position)) * dir || b.p.trueOvr - a.p.trueOvr;
    }
  });

  const sortHref = (key: SortKey) => {
    const nextDir = sortKey === key && dir === -1 ? 'asc' : 'desc';
    return `/league/${league.id}/cap?sort=${key}&dir=${nextDir}${advanced ? '&view=advanced' : ''}`;
  };

  // --- Advanced-view data -----------------------------------------------
  let allocationBars: { label: string; value: number; displayValue: string; color: string }[] = [];
  let outlookSeries: { label: string; color: string; points: { x: string; y: number }[] }[] = [];
  let outlookBaseline: { y: number; label: string } | undefined;
  let valuePoints: { id: string; x: number; y: number; label: string; color: string; detail?: string }[] = [];
  let vsLeagueBars: { label: string; value: number; displayValue: string; color: string }[] = [];

  if (advanced) {
    // League-average spend per position group, so "too much at one spot" has
    // a real baseline instead of just eyeballing the allocation chart alone.
    const [leagueTeams, leaguePlayers] = await Promise.all([
      prisma.team.count({ where: { leagueId: league.id } }),
      prisma.player.findMany({ where: { leagueId: league.id, status: 'ACTIVE' }, include: { contract: true } }),
    ]);
    const leagueByGroup = new Map<string, number>();
    for (const g of POSITION_GROUPS) leagueByGroup.set(g, 0);
    for (const p of leaguePlayers) {
      const hit = capHit(p.contract, settings.capMode);
      const g = positionGroup(p.position);
      leagueByGroup.set(g, (leagueByGroup.get(g) ?? 0) + hit);
    }
    const myByGroup = new Map<string, number>();
    for (const g of POSITION_GROUPS) myByGroup.set(g, 0);
    for (const { p, hit } of rows) myByGroup.set(positionGroup(p.position), (myByGroup.get(positionGroup(p.position)) ?? 0) + hit);

    vsLeagueBars = POSITION_GROUPS.map((g) => {
      const avg = (leagueByGroup.get(g) ?? 0) / Math.max(1, leagueTeams);
      const mine = myByGroup.get(g) ?? 0;
      const diff = mine - avg;
      return {
        label: g,
        value: Math.abs(diff),
        displayValue: `${diff >= 0 ? '+' : '-'}${formatMoney(Math.abs(diff))} vs avg`,
        color: diff >= 0 ? '#e66767' : '#3987e5',
      };
    }).sort((a, b) => b.value - a.value);
    const byGroup = new Map<string, number>();
    for (const g of POSITION_GROUPS) byGroup.set(g, 0);
    for (const { p, hit } of rows) byGroup.set(positionGroup(p.position), (byGroup.get(positionGroup(p.position)) ?? 0) + hit);
    allocationBars = POSITION_GROUPS
      .map((g) => ({ label: g, value: byGroup.get(g) ?? 0, displayValue: `${formatMoney(byGroup.get(g) ?? 0)} (${summary.capUsed > 0 ? Math.round(((byGroup.get(g) ?? 0) / summary.capUsed) * 100) : 0}%)`, color: GROUP_COLOR[g] }))
      .sort((a, b) => b.value - a.value);

    const OUTLOOK_YEARS = 4;
    const totals = new Array(OUTLOOK_YEARS).fill(0);
    for (const { p } of rows) {
      if (!p.contract) continue;
      const schedule = capHitSchedule(p.contract, settings.capMode);
      for (let i = 0; i < OUTLOOK_YEARS; i++) totals[i] += schedule[i] ?? 0;
    }
    outlookSeries = [{
      label: 'Committed Cap',
      color: '#3987e5',
      points: totals.map((v, i) => ({ x: String(league.seasonYear + i), y: v })),
    }];
    outlookBaseline = { y: summary.capTotal, label: `${league.seasonYear} cap limit` };

    valuePoints = rows
      .filter(({ p }) => p.contract)
      .map(({ p, hit }) => {
        const expected = marketValue({ ovr: p.trueOvr, position: p.position as any, age: p.age, potential: p.potential });
        const surplus = expected - hit; // positive = good value (underpaying for the rating)
        return {
          id: p.id, x: p.trueOvr, y: hit,
          label: `${p.firstName} ${p.lastName}`,
          color: surplus >= 0 ? '#3987e5' : '#e66767',
          detail: surplus >= 0 ? `${formatMoney(surplus)}/yr under market value` : `${formatMoney(-surplus)}/yr over market value`,
        };
      });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Salary Cap — {league.seasonYear}</h1>
        <div className="flex gap-1.5">
          <Link href={`/league/${league.id}/cap`} className={`pill ${!advanced ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-chalk'}`}>Basic</Link>
          <Link href={`/league/${league.id}/cap?view=advanced`} className={`pill ${advanced ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-chalk'}`}>Advanced</Link>
        </div>
      </div>

      <div className="card card-pad">
        <div className="flex items-center justify-between mb-2 text-sm">
          <span className="text-muted">{formatMoney(summary.capUsed)} used of {formatMoney(summary.capTotal)}</span>
          <span className={summary.capSpace >= 0 ? 'text-accent font-semibold' : 'text-bad font-semibold'}>{formatMoney(summary.capSpace)} space</span>
        </div>
        <div className="h-3 bg-raised rounded-full overflow-hidden">
          <div className={`h-full ${usedPct > 96 ? 'bg-bad' : usedPct > 85 ? 'bg-warn' : 'bg-accent'}`} style={{ width: `${usedPct}%` }} />
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4 text-sm">
          <div><div className="label-sm">Active Salary</div><div className="font-mono">{formatMoney(summary.activeSalary)}</div></div>
          <div>
            <div className="label-sm inline-flex items-center gap-1.5">
              Dead Money
              <Tooltip text="Cap charges left behind by players already cut or traded away — signing bonus proration that has to count against the cap somewhere even though they're gone. It still counts against your space, but nothing you do now changes it." />
            </div>
            <div className="font-mono">{formatMoney(summary.deadMoney)}</div>
          </div>
          <div><div className="label-sm">Mode</div><div>{settings.capMode === 'REALISTIC' ? 'Realistic' : 'Simplified'}</div></div>
        </div>
      </div>

      {advanced && (
        <div className="grid lg:grid-cols-2 gap-5">
          <div className="card card-pad">
            <h2 className="font-semibold mb-1 inline-flex items-center gap-1.5">
              Cap Allocation by Position
              <Tooltip text="Share of your total cap spend going to each position group right now. Real front offices watch this to spot an unbalanced roster — e.g. too much of the cap tied up at one spot to build real depth elsewhere." />
            </h2>
            <p className="text-xs text-muted mb-3">Share of {formatMoney(summary.capUsed)} committed, by position group.</p>
            <HorizontalBarChart bars={allocationBars} />
          </div>

          <div className="card card-pad">
            <h2 className="font-semibold mb-1 inline-flex items-center gap-1.5">
              Multi-Year Cap Outlook
              <Tooltip text="Total cap already committed in each future year from contracts on the books today (dead money and new signings aren't included — this is just what you'd owe if the roster froze exactly as it is). The dashed line is this year's cap limit for reference; future caps will actually be higher as the league cap grows." />
            </h2>
            <p className="text-xs text-muted mb-3">Already-committed cap dollars, {league.seasonYear}–{league.seasonYear + 3}.</p>
            <LineChart series={outlookSeries} baseline={outlookBaseline} formatY="money" />
          </div>

          <div className="card card-pad">
            <h2 className="font-semibold mb-1 inline-flex items-center gap-1.5">
              Spend vs. League Average
              <Tooltip text="How your cap allocation at each position group compares to the league-wide average team. Blue = spending less than average there; red = more. Neither is inherently good or bad on its own — a position running red might be a deliberate strength, or an overpay; running blue might be a bargain, or a real hole." />
            </h2>
            <p className="text-xs text-muted mb-3">Deviation from the average team's spend, by position group.</p>
            <HorizontalBarChart bars={vsLeagueBars} />
          </div>

          <div className="card card-pad lg:col-span-2">
            <h2 className="font-semibold mb-1 inline-flex items-center gap-1.5">
              Cap Hit vs. Overall Rating
              <Tooltip text="Every player under contract, plotted by rating and cap hit. Blue = costing less than his rating's market value (a bargain); red = costing more (an overpay, fairly or not — a young player on a big second contract will often show red here even if the deal was reasonable when signed)." />
            </h2>
            <p className="text-xs text-muted mb-3">Blue = under market value for the rating · Red = over market value</p>
            <ScatterChart
              points={valuePoints}
              xLabel="Overall Rating" yLabel="Cap Hit"
              formatX="integer" formatY="money"
            />
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-line font-semibold text-sm">Contracts</div>
        <div className="overflow-x-auto">
          <table className="table-clean">
            <thead>
              <tr>
                <th>Player</th>
                {COLUMNS.map((c) => (
                  <th key={c.key}>
                    <span className="inline-flex items-center gap-1">
                      <Link href={sortHref(c.key)} className="hover:text-chalk whitespace-nowrap">
                        {c.label}{sortKey === c.key && (dir === -1 ? ' ▾' : ' ▴')}
                      </Link>
                      {c.key === 'savings' && <Tooltip text="What cutting this player right now would do to your cap: how much space you'd free up, and how much dead money it would leave behind instead." />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ p, hit, base, dead, savings }) => (
                <tr key={p.id}>
                  <td><Link href={`/league/${league.id}/player/${p.id}`} className="hover:text-accent2 font-medium">{p.firstName} {p.lastName}</Link></td>
                  <td className="text-muted font-mono text-xs">{p.position}</td>
                  <td className="text-muted">{p.age}</td>
                  <td className="font-mono text-muted">{p.trueOvr}</td>
                  <td className="font-mono">{formatMoney(hit)}</td>
                  <td className="font-mono text-muted">{formatMoney(base)}</td>
                  <td className="font-mono">{p.contract?.yearsRemaining ?? '—'}</td>
                  <td className="font-mono text-xs whitespace-nowrap">
                    <span className={savings >= 0 ? 'text-accent' : 'text-bad'}>{formatMoney(savings)}</span>
                    <span className="text-muted"> / </span>
                    <span className="text-bad">{formatMoney(dead)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {deadRows.length > 0 && (
        <div className="card card-pad">
          <h2 className="font-semibold mb-2 text-sm">Dead Money Charges</h2>
          {deadRows.map((r) => (
            <div key={r.id} className="flex justify-between text-sm py-1">
              <span className="text-muted">{r.label}</span><span className="font-mono">{formatMoney(r.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
