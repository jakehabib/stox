import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { teamCapSummary } from '@/lib/cap-summary';
import { capHit, formatMoney } from '@/lib/cap';
import { ResignRow } from '@/components/ResignRow';
import type { DepthEntry } from '@/components/ds/DepthAtPosition';
import { LetAiResignButton } from '@/components/LetAiResignButton';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { Tooltip } from '@/components/Tooltip';
import { tip } from '@/lib/glossary';

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

  // WHO HAS BEEN PARKED. "Not now" rather than "let him walk" — see
  // setAsideResignAction. Read off NegotiationTalks, which is already keyed on
  // team + player + league year, so this is this year's triage and nothing
  // carries into the next one.
  const setAsideRows = await prisma.negotiationTalks.findMany({
    where: { teamId: team.id, seasonYear: league.seasonYear, dismissedAt: { not: null } },
    select: { playerId: true },
  });
  const setAsideIds = new Set(setAsideRows.map((r) => r.playerId));
  const onTheList = expiring.filter((p) => !setAsideIds.has(p.id));
  const parked = expiring.filter((p) => setAsideIds.has(p.id));
  // The half of the trap that is this page's to close: the men parked here who
  // are one Advance from free agency. The other half — refusing to advance
  // until they have been named — is in lib/season.ts.
  const parkedExpiring = parked.filter((p) => p.contract?.yearsRemaining === 0).length;

  const summary = settings.capMode === 'OFF' ? null : await teamCapSummary(team.id, league.seasonYear, settings.capMode);

  // WHAT IS BEHIND EACH OF THEM. "Do I pay this man" cannot be answered without
  // it — a 74 you can replace with a 72 is a different decision from a 74 whose
  // backup is a 58 — and the window was asking for the decision without showing
  // that half of it.
  //
  // Read from DepthChartSlot in its own rank order, which is the same table and
  // the same order the Depth Chart screen renders. Deliberately NOT re-derived
  // by sorting on rating here: two screens sorting the same players their own
  // way is how they end up disagreeing about who plays.
  const depthSlots = await prisma.depthChartSlot.findMany({
    where: { teamId: team.id },
    orderBy: { rank: 'asc' },
    include: { player: { include: { contract: true } } },
  });
  const depthByPosition = new Map<string, DepthEntry[]>();
  for (const slot of depthSlots) {
    const row: DepthEntry = {
      playerId: slot.playerId,
      name: `${slot.player.firstName} ${slot.player.lastName}`,
      ovr: slot.player.trueOvr,
      age: slot.player.age,
      weightLb: slot.player.weightLb,
      heightIn: slot.player.heightIn,
      capHit: capHit(slot.player.contract, settings.capMode),
      yearsRemaining: slot.player.contract?.yearsRemaining ?? 0,
      isSubject: false,
    };
    const list = depthByPosition.get(slot.position) ?? [];
    list.push(row);
    depthByPosition.set(slot.position, list);
  }

  /** His position's chart, with him marked — and appended if he is not slotted. */
  const depthFor = (playerId: string, position: string): DepthEntry[] => {
    const list = (depthByPosition.get(position) ?? []).map((d) => ({ ...d, isSubject: d.playerId === playerId }));
    if (!list.some((d) => d.isSubject)) {
      const p = expiring.find((e) => e.id === playerId);
      if (p) {
        list.push({
          playerId, name: `${p.firstName} ${p.lastName}`, ovr: p.trueOvr, age: p.age,
          weightLb: p.weightLb, heightIn: p.heightIn,
          capHit: capHit(p.contract, settings.capMode),
          yearsRemaining: p.contract?.yearsRemaining ?? 0,
          isSubject: true,
        });
      }
    }
    return list;
  };

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
        subtitle="Players whose deals are up or about to be. Nobody else may sign them while they are still yours — but somebody is already watching, and open talks will tell you who, what room they have and what they would pay. The hometown discount is real and it is on a clock: it is at its biggest while a contract still has a season to run and mostly gone once it has expired. Whoever you leave undecided is released to free agency when this phase ends, and the rest of the league can call."
        action={expiring.length > 0 ? <LetAiResignButton leagueId={league.id} /> : undefined}
        facts={[
          { label: 'Decisions', value: String(onTheList.length), detail: parked.length > 0 ? `${parked.length} more set aside` : 'contracts on the clock', tip: tip('walkYear') },
          {
            label: 'Already Expired',
            tip: tip('loyaltyDiscount'),
            value: String(trulyExpiringCount),
            detail: trulyExpiringCount > 0 ? 'last call — discount is gone' : 'none yet',
            color: trulyExpiringCount > 0 ? 'text-bad' : 'text-accent',
          },
          ...(summary ? [
            {
              label: 'Cap Space',
              tip: tip('capSpace'),
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
          {onTheList.length === 0 && (
            <div className="panel p-4 text-sm text-muted">
              Every expiring contract is set aside. They are below, and none of them has been released — bring
              anyone back before you advance.
            </div>
          )}
          {onTheList.map((p) => (
            <ResignRow
              key={p.id}
              leagueId={league.id} playerId={p.id} name={`${p.firstName} ${p.lastName}`} position={p.position} age={p.age} ovr={p.trueOvr}
              weightLb={p.weightLb} heightIn={p.heightIn}
              currentApy={p.contract ? capHit(p.contract, settings.capMode) : 0}
              availableSpace={summary ? summary.capSpace + (p.contract ? capHit(p.contract, settings.capMode) : 0) : Number.MAX_SAFE_INTEGER}
              capMode={settings.capMode}
              yearsRemaining={p.contract?.yearsRemaining ?? 0}
              canTag={canTag && !alreadyTagged}
              depth={depthFor(p.id, p.position)}
            />
          ))}

          {/* THE PILE, AND WHAT IT COSTS. Set aside is reversible and says so
              with a count and a control on every row — but a man parked here
              with an expired deal still walks when the phase ends, so this
              states that in front of the decision rather than after it. The
              advance itself refuses once and names them (lib/season.ts). */}
          {parked.length > 0 && (
            <div className="pt-3 space-y-2">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <span className="label-sm inline-flex items-center gap-1.5">
                  Set aside · {parked.length}
                  <Tooltip text={tip('setAside')} />
                </span>
                <span className="text-xs text-muted">
                  {parkedExpiring > 0
                    ? `Not released — but ${parkedExpiring} of them ${parkedExpiring === 1 ? 'has an expired deal and walks' : 'have expired deals and walk'} when this phase ends.`
                    : 'Not released. Their deals still have a season to run.'}
                </span>
              </div>
              {parked.map((p) => (
                <ResignRow
                  key={p.id}
                  setAside
                  leagueId={league.id} playerId={p.id} name={`${p.firstName} ${p.lastName}`} position={p.position} age={p.age} ovr={p.trueOvr}
                  weightLb={p.weightLb} heightIn={p.heightIn}
                  currentApy={p.contract ? capHit(p.contract, settings.capMode) : 0}
                  capMode={settings.capMode}
                  yearsRemaining={p.contract?.yearsRemaining ?? 0}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
