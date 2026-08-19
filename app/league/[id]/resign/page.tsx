import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { teamCapSummary } from '@/lib/cap-summary';
import { capHit, formatMoney } from '@/lib/cap';
import { ResignRow } from '@/components/ResignRow';

export default async function ResignPage({ params }: { params: { id: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

  const expiring = await prisma.player.findMany({
    where: { teamId: team.id, status: 'ACTIVE', contract: { yearsRemaining: 0 } },
    include: { contract: true },
    orderBy: { trueOvr: 'desc' },
  });

  const summary = settings.capMode === 'OFF' ? null : await teamCapSummary(team.id, league.seasonYear, settings.capMode);

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Re-sign Window</h1>
        <p className="text-muted text-sm mt-1">
          These players' contracts are up. Extend anyone you want to keep — whoever you don't gets released to free agency
          the moment you advance out of this phase, and other teams can sign them from there.
        </p>
      </div>

      {summary && (
        <div className="card card-pad flex items-center justify-between text-sm">
          <span className="text-muted">Current cap space</span>
          <span className={`font-mono font-semibold ${summary.capSpace >= 0 ? 'text-accent' : 'text-bad'}`}>{formatMoney(summary.capSpace)}</span>
        </div>
      )}

      {expiring.length === 0 ? (
        <div className="card card-pad text-sm text-muted">Nobody's contract is expiring this offseason — nothing to do here. Advance whenever you're ready.</div>
      ) : (
        <div className="space-y-2">
          {expiring.map((p) => (
            <ResignRow
              key={p.id}
              leagueId={league.id} playerId={p.id} name={`${p.firstName} ${p.lastName}`} position={p.position} age={p.age} ovr={p.trueOvr}
              currentApy={p.contract ? capHit(p.contract, settings.capMode) : 0}
              availableSpace={summary ? summary.capSpace + (p.contract ? capHit(p.contract, settings.capMode) : 0) : Number.MAX_SAFE_INTEGER}
              capMode={settings.capMode}
            />
          ))}
        </div>
      )}
    </div>
  );
}
