import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { teamCapSummary } from '@/lib/cap-summary';
import { formatMoney, capHit } from '@/lib/cap';

export default async function CapPage({ params }: { params: { id: string } }) {
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
    prisma.player.findMany({ where: { teamId: team.id, status: 'ACTIVE' }, include: { contract: true }, orderBy: { trueOvr: 'desc' } }),
    prisma.capCharge.findMany({ where: { teamId: team.id, year: league.seasonYear } }),
  ]);

  const usedPct = Math.min(100, Math.round((summary.capUsed / summary.capTotal) * 100));

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
        <table className="table-clean">
          <thead><tr><th>Player</th><th>Pos</th><th>Cap Hit</th><th>Base</th><th>Bonus Proration</th><th>Yrs Left</th></tr></thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/league/${league.id}/player/${p.id}`} className="hover:text-accent2">{p.firstName} {p.lastName}</Link></td>
                <td className="text-muted font-mono text-xs">{p.position}</td>
                <td className="font-mono">{formatMoney(capHit(p.contract, settings.capMode))}</td>
                <td className="font-mono text-muted">{p.contract ? formatMoney(JSON.parse(p.contract.baseSalaries)[p.contract.years - p.contract.yearsRemaining] ?? 0) : '—'}</td>
                <td className="font-mono text-muted">{p.contract && settings.capMode === 'REALISTIC' ? formatMoney(Math.round(p.contract.signingBonus / Math.min(p.contract.years, 5))) : '—'}</td>
                <td className="font-mono">{p.contract?.yearsRemaining ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
