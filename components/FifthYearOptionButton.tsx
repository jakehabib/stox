'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fifthYearOptionAction, fifthYearOptionImpactAction, type FifthYearOptionImpact } from '@/app/actions/roster';
import { formatMoney } from '@/lib/cap';
import { ActionButton } from './ds/ActionButton';
import { Tooltip } from './Tooltip';
import { tip } from '@/lib/glossary';

/**
 * ===========================================================================
 * THE FIFTH-YEAR OPTION: A REAL CONTROL, BOTH ANSWERS, AND THE PRICE FIRST
 * ===========================================================================
 * Modelled on `FranchiseTagButton` deliberately, because the app owner already
 * told us what a contract decision has to look like on this card:
 *
 *   *"it should be a large option players can notice, and clicking it should
 *     show the cap implications just like a regular contract would and ask to
 *     confirm instead of just 1-clicking into it"*
 *
 * So: full width, at the size of the other decisions in the box; pressing it
 * opens a priced preview rather than committing; and every figure in that
 * preview comes back from the server (`fifthYearOptionImpactAction`) off the
 * same functions the write path charges on.
 *
 * WHAT IS DIFFERENT FROM THE TAG, AND IT IS THE WHOLE DECISION.
 *
 *   BOTH ANSWERS ARE BUTTONS. A tag is a thing you do or do not do; an option
 *   is a question with a deadline, and turning it down is a real move with a
 *   real cost — he reaches free agency a year earlier. Offering only "pick it
 *   up" would leave declining as the thing that happens when you close the tab,
 *   which is exactly how a decision stops feeling like one. So the cost of
 *   saying no is priced on the same panel as the cost of saying yes, and both
 *   are pressed rather than defaulted into.
 *
 *   THE BILL IS IN A DIFFERENT YEAR FROM THE PRESS. Exercising does not move
 *   this season's cap by a dollar — his fourth year is whatever his rookie deal
 *   already said. The money lands a whole league year later, which is what
 *   makes this a bet rather than a purchase, so the ledger below is the OPTION
 *   YEAR's books and says so in its own heading. A panel that showed this
 *   year's cap space would be showing a number the decision does not touch.
 * ===========================================================================
 */
export function FifthYearOptionButton({ leagueId, playerId, playerName, blocked, decided, optionYear }: {
  leagueId: string;
  playerId: string;
  playerName: string;
  /** Null when the decision is live. Otherwise the reason, from fifthYearOptionBlockReason. */
  blocked: string | null;
  /** What his club has already answered, if it has. */
  decided: 'EXERCISED' | 'DECLINED' | null;
  /** The league year the option would buy — for the standing status lines. */
  optionYear: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const [impact, setImpact] = useState<FifthYearOptionImpact>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const router = useRouter();

  // THE RECEIPT OUTRANKS THE STANDING LINE, and only for the reader who just
  // pressed the button — `router.refresh()` would otherwise replace it with the
  // status a beat later, the same as the tag's.
  if (receipt) return <p className="text-sm text-accent">{receipt}</p>;

  // ANSWERED IS A STATE, NOT A CONTROL. It says what his career now looks like,
  // where the button would be, and offers nothing.
  if (decided === 'EXERCISED') {
    return (
      <p className="text-sm text-muted">
        His fifth-year option is picked up — he is under contract through {optionYear}, and that season is fully
        guaranteed whatever happens between now and it.
      </p>
    );
  }
  if (decided === 'DECLINED') {
    return (
      <p className="text-sm text-muted">
        You turned his fifth-year option down. He plays this season out and reaches free agency when it ends —
        a year earlier than he would have.
      </p>
    );
  }

  if (blocked) {
    return (
      <div className="space-y-1.5">
        <span className="inline-flex items-center gap-1.5">
          {/* Really disabled, not styled that way — same rule as the tag: a
              button that looks live and does nothing is worse than an absent
              one, and a greyed one carrying its reason teaches the rule. */}
          <button type="button" disabled className="btn-secondary">Fifth-Year Option</button>
          <Tooltip text={tip('fifthYearOption')} />
        </span>
        <p className="text-xs text-muted">{blocked}</p>
      </div>
    );
  }

  const beginConfirm = async () => {
    setConfirming(true);
    setLoading(true);
    setFailure(null);
    try {
      setImpact(await fifthYearOptionImpactAction(leagueId, playerId));
    } finally {
      setLoading(false);
    }
  };

  if (!confirming) {
    return (
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={beginConfirm}
          className="btn w-full border border-accent2/50 bg-accent2/15 text-accent2 hover:bg-accent2/25 py-3 text-base"
        >
          Fifth-Year Option
        </button>
        <p className="text-xs text-muted inline-flex items-center gap-1.5">
          A first-round pick only, answered once, in this window. Nothing is decided until you have seen the price.
          <Tooltip text={tip('fifthYearOption')} />
        </p>
      </div>
    );
  }

  const answer = async (decision: 'EXERCISE' | 'DECLINE') => {
    const result = await fifthYearOptionAction(leagueId, playerId, decision);
    // A refusal is not an achievement: no done beat, and the server's own
    // sentence goes on screen. The already-answered guard can still fire here.
    if (!result.ok) { setFailure(result.message); return false; }
    setReceipt(result.message);
    setConfirming(false);
    router.refresh();
  };

  return (
    <div className="space-y-3 pl-3.5 border-l-2 border-accent2">
      <div className="label-sm text-accent2">Fifth-year option · answered once, cannot be undone</div>
      <div className="font-semibold text-[15px] -mt-1.5">{playerName}</div>
      {loading && <p className="text-xs text-muted">Pricing the option…</p>}

      {impact && (
        <>
          {/* WHAT HE HAS EARNED, BEFORE WHAT IT COSTS. The tier is the reason
              for the number, and a GM who is told the price without the reason
              cannot tell a rule from a die roll. */}
          <div className="panel p-3 space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted">
                Option salary — one year, {impact.optionYear}, fully guaranteed
              </span>
              <span className="stat-value text-stat-sm">{formatMoney(impact.optionSalary)}</span>
            </div>
            <div className="text-[11px] text-muted">
              {impact.tierEarned}, so his option is priced at {impact.tierBand}
              {impact.bandSalaries.length > 0
                ? `: ${impact.bandSalaries.map((v) => formatMoney(v)).join(' · ')}`
                : ''}
            </div>

            {impact.capEnabled ? (
              <>
                <div className="flex justify-between gap-3 pt-1.5 border-t border-line/60">
                  <span className="text-muted">His {impact.seasonYear} cap hit — unchanged either way</span>
                  <span className="font-mono text-muted">{formatMoney(impact.fourthYearHit)}</span>
                </div>
                {/* THE YEAR THE BILL LANDS IN, read off the same multi-year
                    outlook the Cap page renders (capSheet) rather than a second
                    projection built for this panel. */}
                <div className="flex justify-between gap-3">
                  <span className="text-muted">{impact.optionYear} room as it stands</span>
                  <span className="font-mono text-muted">{formatMoney(impact.optionYearRoomBefore)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted">{impact.optionYear} room with him on the books</span>
                  <span className={`stat-value text-stat-sm ${impact.optionYearRoomAfter < 0 ? 'text-bad' : 'text-accent'}`}>
                    {formatMoney(impact.optionYearRoomAfter)}
                  </span>
                </div>
                <div className="flex justify-between gap-3 pt-1.5 border-t border-line/60">
                  <span className="text-muted">Dead money if you release him after this</span>
                  <span className={`font-mono ${impact.deadMoneyIfCutAfter > 0 ? 'text-bad' : ''}`}>
                    {formatMoney(impact.deadMoneyIfCutAfter)}
                  </span>
                </div>
              </>
            ) : (
              <div className="text-[11px] text-muted">
                This league runs without a salary cap, so the option costs you nothing but the year it buys.
              </div>
            )}
          </div>

          {impact.leavesOverCapThen && (
            <p className="text-xs text-bad">
              On today&apos;s books that puts you {formatMoney(-impact.optionYearRoomAfter)} over the {impact.optionYear} ceiling.
              You have a season to clear it, and the league year will not open until you have.
            </p>
          )}

          {/* THE COST OF SAYING NO, ON THE SCREEN WHERE YOU SAY IT. */}
          <p className="text-xs text-muted">
            Turn it down and he plays out {impact.seasonYear} and reaches free agency when it ends — a year earlier
            than he would have, with every club in the league free to bid. Pick it up and the {impact.optionYear} salary
            above is guaranteed from the moment you press it, whether he plays a down of it or not.
          </p>

          {/* The button that opened this was drawn by a page render that may be
              a navigation old. An answer given in another tab since then is
              found out HERE, not at the press. */}
          {impact.blocked && <p className="text-xs text-bad">{impact.blocked}</p>}
        </>
      )}

      {failure && <p className="text-xs text-bad">{failure}</p>}

      <div className="flex flex-wrap gap-2">
        {/* The label carries the price, exactly as the release and tag buttons
            do: "Confirm" is a form, "$18.2M for 2031" is a decision. */}
        <ActionButton
          className="btn flex-1 border border-accent2/50 bg-accent2/15 text-accent2 hover:bg-accent2/25"
          disabled={loading || !!impact?.blocked}
          idleLabel={impact ? `Pick it up — ${formatMoney(impact.optionSalary)} for ${impact.optionYear}` : 'Pick it up'}
          workingLabel="Picking it up…"
          doneLabel="Picked up"
          onAction={() => answer('EXERCISE')}
        />
        <ActionButton
          className="btn-secondary flex-1"
          disabled={loading || !!impact?.blocked}
          idleLabel="Turn it down"
          workingLabel="Turning it down…"
          doneLabel="Turned down"
          onAction={() => answer('DECLINE')}
        />
        <button
          type="button"
          onClick={() => { setConfirming(false); setImpact(null); setFailure(null); }}
          className="btn-ghost"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
