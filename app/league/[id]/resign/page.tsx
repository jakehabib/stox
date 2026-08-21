import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { teamCapSummary } from '@/lib/cap-summary';
import { capHit, formatMoney } from '@/lib/cap';
import { ResignRow } from '@/components/ResignRow';
import { LetAiResignButton } from '@/components/LetAiResignButton';
import { PageMasthead } from '@/components/ds/PageMasthead';

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

  // What these deals currently occupy on the books. This is NOT a cost to
  // re-sign them: teamCapSummary's activeSalary already counts every active
  // player, so this figure is a subset of the committed total that produced
  // capSpace. Comparing the two implied you were short by the whole amount
  // when keeping everyone at their current number costs nothing extra — it
  // is money that comes OFF the books, not money you still have to find.
  const committedToExpiring = settings.capMode === 'OFF'
    ? 0
    : expiring.reduce((s, p) => s + capHit(p.contract, settings.capMode), 0);

  return (
    <div className="space-y-5 max-w-4xl">
      <PageMasthead
        teamId={team.id}
        teamAbbr={team.abbr}
        eyebrow={`${league.seasonYear} Offseason`}
        title="Re-sign Window"
        subtitle="Players whose deals are up or about to be. Nobody else can bid on them while they are still yours, which is the only discount you will ever get on them — once the re-sign phase ends, whoever is undecided is released to free agency and the rest of the league can call. Open talks to make an offer; he decides whether to take it."
        action={expiring.length > 0 ? <LetAiResignButton leagueId={league.id} /> : undefined}
        facts={[
          { label: 'Decisions', value: String(expiring.length), detail: 'contracts on the clock' },
          {
            label: 'Already Expired',
            value: String(trulyExpiringCount),
            detail: trulyExpiringCount > 0 ? 'walk if not re-signed' : 'none yet',
            color: trulyExpiringCount > 0 ? 'text-bad' : 'text-accent',
          },
          ...(summary ? [
            {
              label: 'Cap Space',
              value: formatMoney(summary.capSpace),
              detail: `${formatMoney(summary.capUsed)} committed`,
              color: summary.capSpace >= 0 ? 'text-accent' : 'text-bad',
            },
            {
              label: 'On The Books',
              value: formatMoney(committedToExpiring),
              detail: 'these deals — comes off if they walk',
            },
          ] : []),
        ]}
      />

      {expiring.length === 0 ? (
        <div className="panel p-4 text-sm text-muted">Nobody's contract is expiring soon — nothing to do here. Advance whenever you're ready.</div>
      ) : (
        <div className="space-y-2">
          {expiring.map((p) => (
            <ResignRow
              key={p.id}
              leagueId={league.id} playerId={p.id} name={`${p.firstName} ${p.lastName}`} position={p.position} age={p.age} ovr={p.trueOvr}
              weightLb={p.weightLb} heightIn={p.heightIn}
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
