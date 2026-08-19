import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { positionSortKey } from '@/lib/league-data';
import { teamCapSummary } from '@/lib/cap-summary';
import { formatMoney, capHit, deadMoneyOnCut, capSavingsOnCut } from '@/lib/cap';

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

export default async function CapPage({ params, searchParams }: { params: { id: string }; searchParams: { sort?: string; dir?: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

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
    return `/league/${league.id}/cap?sort=${key}&dir=${nextDir}`;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Salary Cap — {league.seasonYear}</h1>

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
          <div><div className="label-sm">Dead Money</div><div className="font-mono">{formatMoney(summary.deadMoney)}</div></div>
          <div><div className="label-sm">Mode</div><div>{settings.capMode === 'REALISTIC' ? 'Realistic' : 'Simplified'}</div></div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-line font-semibold text-sm">Contracts</div>
        <div className="overflow-x-auto">
          <table className="table-clean">
            <thead>
              <tr>
                <th>Player</th>
                {COLUMNS.map((c) => (
                  <th key={c.key}>
                    <Link href={sortHref(c.key)} className="hover:text-chalk whitespace-nowrap">
                      {c.label}{sortKey === c.key && (dir === -1 ? ' ▾' : ' ▴')}
                    </Link>
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
