import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { teamCapSummary } from '@/lib/cap-summary';
import { capHit, formatMoney, unamortizedBonus, marketValue } from '@/lib/cap';
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
  /*
   * ONLY THE MEN WHO WALK AT THE END OF THIS LEAGUE YEAR.
   *
   * This asked for `yearsRemaining <= 1`, which is two different cohorts
   * wearing one list. Contracts age when the season ends, so once the
   * offseason has begun a man at 1 has a whole season still to play — he is
   * next year's decision, not this year's. Shown beside men who genuinely
   * walk in a few clicks, he reads as urgent, and the app owner paid for
   * exactly that: *"i just gave a huge extension to someone thinking they
   * needed it but really i had 1 more year after to decide"*. A screen that
   * costs a GM real money by implying a deadline that is twelve months away
   * is worse than one that shows him less.
   *
   * So the cohort is pinned to the phase, and to the rule that actually
   * releases people. `releaseUnresignedExpiringContracts` (lib/season.ts)
   * takes `yearsRemaining: 0` — during the offseason cycle those men, and
   * only those men, are the ones the window is about. Before the season ends
   * nothing has aged yet, so the men who will be free agents when it does are
   * the ones playing out their final year; anybody already at zero in-season
   * is more urgent still and is never hidden.
   */
  const offseasonCycle = league.phase === 'OFFSEASON' || league.phase === 'RESIGN';
  const expiringCutoff = offseasonCycle ? 0 : 1;
  const expiring = await prisma.player.findMany({
    where: { teamId: team.id, status: 'ACTIVE', contract: { yearsRemaining: { lte: expiringCutoff } } },
    include: { contract: true },
    /*
     * BEST MAN FIRST. This used to lead on `yearsRemaining`, so the list ran
     * expired-then-walk-year and the rating column started over halfway down.
     * The app owner read that as no order at all: *"on the contracts running
     * out page, its sorted randomly. we should have it sort by overall from
     * top to bottom."*
     *
     * Rating leads now and the deadline is the tiebreak. Nothing is lost by
     * it — every row already wears its own Expired or Walk Year pill, so the
     * urgent ones are still marked; they are just no longer allowed to bury
     * the best player on the list under men you were always going to let go.
     */
    orderBy: [{ trueOvr: 'desc' }, { contract: { yearsRemaining: 'asc' } }],
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
      // Null, not zero, when there is no contract row: a man with no deal on
      // file is a different thing from a man whose deal charges nothing, and
      // the row says so instead of printing $0.0M at him.
      capHit: slot.player.contract ? capHit(slot.player.contract, settings.capMode) : null,
      yearsRemaining: slot.player.contract?.yearsRemaining ?? null,
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
          capHit: p.contract ? capHit(p.contract, settings.capMode) : null,
          yearsRemaining: p.contract?.yearsRemaining ?? null,
          isSubject: true,
        });
      }
    }
    return list;
  };

  const canTag = settings.franchiseTagEnabled && league.phase === 'RESIGN';
  /** Is the deadline actually running? Everything that calls this a window depends on it. */
  const inWindow = league.phase === 'RESIGN';
  const tagContract = canTag
    ? await prisma.contract.findFirst({
        where: { teamId: team.id, isFranchiseTag: true, signedYear: league.seasonYear },
        include: { player: { select: { firstName: true, lastName: true, position: true } } },
      })
    : null;
  const alreadyTagged = canTag ? tagContract !== null : true;

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
        /*
         * THE MASTHEAD HAS TO KNOW WHAT MONTH IT IS. This page is reachable in
         * every phase, and it said "2027 Offseason · Re-sign Window" over a
         * league in week 5 of the regular season, with a subtitle promising
         * that undecided players are "released to free agency when this phase
         * ends" — false in REGULAR, PLAYOFFS and DRAFT alike. During the
         * window it is a deadline; outside it, it is simply the list of men
         * whose deals are running out, which is worth having and is not a
         * deadline.
         */
        eyebrow={inWindow ? `${league.seasonYear} Offseason` : `${league.seasonYear} Season`}
        title={inWindow ? 'Re-sign Window' : 'Contracts Running Out'}
        subtitle={"Players whose deals are up or about to be. Nobody else may sign them while they are still yours — but somebody is already watching, and open talks will tell you who, what room they have and what they would pay. The hometown discount is real and it is on a clock: it is at its biggest while a contract still has a season to run and mostly gone once it has expired." + (inWindow ? ' Whoever you leave undecided is released to free agency when this window shuts, and the rest of the league can call.' : ' The window itself opens in the offseason — that is when a decision becomes a deadline. Until then this is a list, and getting ahead of it is up to you.')
          + (offseasonCycle
            ? ' Only the men whose deals have actually run out are here. Anyone with a season still to play is next year\'s decision and is deliberately kept off it.'
            : ' Only the men whose deals end when this season does are here — anyone with more than that left is not your problem yet.')}
        action={expiring.length > 0 ? <LetAiResignButton leagueId={league.id} /> : undefined}
        facts={[
          { label: 'Decisions', value: String(onTheList.length), detail: parked.length > 0 ? `${parked.length} more set aside` : 'contracts on the clock', tip: tip('walkYear') },
          /*
           * THE TAG EXISTS AND NOTHING SAID SO. It is one per league year, it
           * only works inside this window, and the control is a small pill
           * inside a row you have to click open first — so a GM could play a
           * whole career without learning he had it. The app owner: *"Is the
           * franchise tag available for users? I haven't seen it yet."* The
           * rules are unchanged; this is the sign on the door.
           */
          ...(settings.franchiseTagEnabled ? [
            inWindow
              ? {
                label: 'Franchise Tag',
                tip: tip('franchiseTag'),
                value: alreadyTagged ? 'Used' : '1 left',
                detail: tagContract?.player
                  ? `${tagContract.player.position} ${tagContract.player.lastName} — keeps him a year`
                  : 'one a year, and only in this window',
                color: alreadyTagged ? undefined : 'text-gold',
              }
              : {
                label: 'Franchise Tag',
                tip: tip('franchiseTag'),
                value: '1 a year',
                detail: 'usable once the window opens',
              },
          ] : []),
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
              // The only tile on this strip with an elsewhere. Franchise Tag
              // and Already Expired both resolve in the rows below — a link
              // would just reload the screen the GM is already reading.
              href: `/league/${league.id}/cap`,
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
              /*
               * WHAT TAGGING HIM ACTUALLY COSTS ON TOP OF THE TAG. The tag
               * replaces his contract, it does not retire the old deal's
               * accounting: whatever signing bonus that deal had not finished
               * amortising accelerates as dead money the moment it is signed
               * (applyFranchiseTag). The button is one press with no
               * confirmation, so the number has to be on screen BEFORE it,
               * not in the message afterwards. Zero in every mode but
               * REALISTIC, and zero on most deals, which is why the row only
               * draws the line when there is something to say.
               */
              tagDeadMoney={unamortizedBonus(p.contract, settings.capMode)}
              depth={depthFor(p.id, p.position)}
              /*
               * THE OPEN-MARKET BENCHMARK, SO THE LIST CAN BE TRIAGED WITHOUT
               * OPENING ELEVEN NEGOTIATIONS. `marketValue` is pure arithmetic on
               * rating, position and age — no query, no session, nothing this
               * page did not already have — and it is emphatically NOT what he
               * will sign for: buildContext (lib/negotiation.ts) runs it through
               * a personality, a decaying loyalty discount, a premium for
               * whoever else is calling and a seeded wobble before it becomes a
               * reservation price. The row prints it as a band, and printing his
               * real number would end the minigame this window is built around.
               */
              marketApy={marketValue({ ovr: p.trueOvr, position: p.position as any, age: p.age, potential: p.potential })}
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
