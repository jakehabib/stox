import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { teamCapSummary } from '@/lib/cap-summary';
import { capHit, formatMoney } from '@/lib/cap';
import { ResignRow } from '@/components/ResignRow';
import { LetAiResignButton } from '@/components/LetAiResignButton';

export default async function ResignPage({ params }: { params: { id: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

  // Contracts show up here from the year they enter their FINAL season
  // (yearsRemaining === 1) — not just once they've actually hit 0 during
  // the RESIGN phase — so expiring deals are visible from week 1 of that
  // season, with time to negotiate instead of a surprise once the season's over.
  const expiring = await prisma.player.findMany({
    where: { teamId: team.id, status: 'ACTIVE', contract: { yearsRemaining: { lte: 1 } } },
    include: { contract: true },
    orderBy: [{ contract: { yearsRemaining: 'asc' } }, { trueOvr: 'desc' }],
  });
  const trulyExpiringCount = expiring.filter((p) => p.contract?.yearsRemaining === 0).length;

  const summary = settings.capMode === 'OFF' ? null : await teamCapSummary(team.id, league.seasonYear, settings.capMode);

  const canTag = settings.franchiseTagEnabled && league.phase === 'RESIGN';
  const alreadyTagged = canTag
    ? (await prisma.contract.findFirst({ where: { teamId: team.id, isFranchiseTag: true, signedYear: league.seasonYear } })) !== null
    : true;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Re-sign Window</h1>
          <p className="text-muted text-sm mt-1">
            Players whose deals are up or about to be. Extend anyone you want to keep — whoever's still undecided once the
            re-sign phase ends gets released to free agency, and other teams can sign them from there.
          </p>
        </div>
        {trulyExpiringCount > 0 && <LetAiResignButton leagueId={league.id} />}
      </div>

      {summary && (
        <div className="card card-pad flex items-center justify-between text-sm">
          <span className="text-muted">Current cap space</span>
          <span className={`font-mono font-semibold ${summary.capSpace >= 0 ? 'text-accent' : 'text-bad'}`}>{formatMoney(summary.capSpace)}</span>
        </div>
      )}

      {expiring.length === 0 ? (
        <div className="card card-pad text-sm text-muted">Nobody's contract is expiring soon — nothing to do here. Advance whenever you're ready.</div>
      ) : (
        <div className="space-y-2">
          {expiring.map((p) => (
            <ResignRow
              key={p.id}
              leagueId={league.id} playerId={p.id} name={`${p.firstName} ${p.lastName}`} position={p.position} age={p.age} ovr={p.trueOvr}
              currentApy={p.contract ? capHit(p.contract, settings.capMode) : 0}
              availableSpace={summary ? summary.capSpace + (p.contract ? capHit(p.contract, settings.capMode) : 0) : Number.MAX_SAFE_INTEGER}
              capMode={settings.capMode}
              yearsRemaining={p.contract?.yearsRemaining ?? 0}
              canTag={canTag && !alreadyTagged}
            />
          ))}
        </div>
      )}
    </div>
  );
}
