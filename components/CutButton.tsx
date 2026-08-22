'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cutPlayerAction, cutImpactAction, CutImpact } from '@/app/actions/roster';
import { formatMoney } from '@/lib/cap';
import { ActionButton } from './ds/ActionButton';

/**
 * Release a player — with the cap consequence shown BEFORE the confirm,
 * not discovered afterwards on the cap sheet.
 *
 * In REALISTIC mode every remaining dollar of prorated signing bonus (void
 * years included) accelerates onto this year's cap the instant he's gone,
 * so a heavily restructured deal can cost MORE to release than to keep.
 * That's the "restructure now, cut later" trap, and it's the single most
 * expensive mistake available on this screen, so it gets called out in
 * words rather than left for the user to infer from two numbers.
 *
 * The impact is fetched on entering the confirm step rather than passed in,
 * so this stays a drop-in for every existing call site.
 *
 * The confirm step is now staged as a decision rather than a form: an accent
 * edge marks it irreversible, the ledger states cap space BEFORE as well as
 * after (the change, not just the destination — the app has always told you
 * what a number is and never what it changed by), and the button's own label
 * carries the cost. "Confirm Release" is a form. "Release — $1.62M dead" is a
 * decision. Nothing was taken away to make room for any of it.
 *
 * Deliberately no portrait here. This component knows the player's id and
 * name but not his age, build or position, and PlayerAvatar derives the face
 * from all of those — so a portrait drawn from defaults would be a DIFFERENT
 * man's face beside the same man's name, six inches below his real one. A
 * wrong picture is worse than no picture.
 */
export function CutButton({ leagueId, playerId }: { leagueId: string; playerId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [impact, setImpact] = useState<CutImpact | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const router = useRouter();

  const beginConfirm = async () => {
    setConfirming(true);
    setLoading(true);
    try {
      setImpact(await cutImpactAction(leagueId, playerId));
    } finally {
      setLoading(false);
    }
  };

  if (!confirming) {
    return <button onClick={beginConfirm} className="btn-danger w-full">Release Player</button>;
  }

  // The label carries the price. Dead money is the number a GM regrets, so
  // that is the one the button says out loud when there is one.
  const confirmLabel = !impact || !impact.capEnabled
    ? 'Confirm Release'
    : impact.deadMoney > 0
      ? `Release — ${formatMoney(impact.deadMoney)} dead`
      : `Release — frees ${formatMoney(impact.savings)}`;

  return (
    <div className="space-y-3 pl-3.5 border-l-2 border-bad">
      <div className="label-sm text-bad">Release · cannot be undone</div>
      {impact?.playerName && <div className="font-semibold text-[15px] -mt-1.5">{impact.playerName}</div>}
      {loading && <p className="text-xs text-muted">Checking what this costs…</p>}

      {impact?.capEnabled && (
        <div className="panel p-3 space-y-1.5 text-sm">
          <div className="label-sm">If you release him now</div>
          <div className="flex justify-between">
            <span className="text-muted">Cap hit removed</span>
            <span className="font-mono">{formatMoney(impact.currentHit)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Dead money created</span>
            <span className="font-mono text-bad">{formatMoney(impact.deadMoney)}</span>
          </div>
          {/* Broken out only when both halves are actually in it. One line
              saying "$23.0M dead" leaves a GM guessing which decision cost
              him that — the bonus he paid to sign the man, or the salary he
              promised him. They are different mistakes. */}
          {impact.deadBonus > 0 && impact.deadGuaranteedSalary > 0 && (
            <>
              <div className="flex justify-between text-xs">
                <span className="text-muted pl-3">Bonus you already paid him</span>
                <span className="font-mono text-muted">{formatMoney(impact.deadBonus)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted pl-3">Salary you guaranteed him</span>
                <span className="font-mono text-muted">{formatMoney(impact.deadGuaranteedSalary)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between pt-1.5 border-t border-line/60">
            <span className="text-muted">Net cap {impact.savings >= 0 ? 'freed' : 'LOST'}</span>
            <span className={`font-mono font-semibold ${impact.savings >= 0 ? 'text-accent' : 'text-bad'}`}>
              {formatMoney(impact.savings)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Your cap space now</span>
            <span className="font-mono text-muted">{formatMoney(impact.capSpaceBefore)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Your cap space after</span>
            <span className={`font-mono font-semibold ${impact.capSpaceAfter >= 0 ? 'text-accent' : 'text-bad'}`}>
              {formatMoney(impact.capSpaceAfter)}
            </span>
          </div>
        </div>
      )}

      {impact?.costsMoreThanKeeping && (
        <p className="text-xs text-bad">
          This release costs you {formatMoney(-impact.savings)} of cap space rather than freeing any.
          {impact.deadGuaranteedSalary > 0 && ` You guaranteed him ${formatMoney(impact.deadGuaranteedSalary)} of salary, and you owe it whether he plays or not.`}
          {impact.deadBonus > 0 && ` His signing bonus was prorated across years you'd no longer get, and all ${formatMoney(impact.deadBonus)} of it accelerates onto this season the moment he's cut.`}
          {' '}Keeping him through the season is cheaper; the bill shrinks each year the deal runs down, as the bonus
          amortises and the guarantee is paid off.
        </p>
      )}

      {impact?.capEnabled && !impact.costsMoreThanKeeping && impact.deadMoney > 0 && (
        <p className="text-xs text-muted">
          {formatMoney(impact.deadMoney)} stays on your books as dead money
          {impact.deadGuaranteedSalary > 0 && impact.deadBonus > 0
            ? ' — bonus you have already paid, and salary you promised him in writing.'
            : impact.deadGuaranteedSalary > 0
              ? ' — salary you promised him in writing.'
              : ' — signing bonus you have already paid.'}
          {' '}You pay for him either way, you just stop getting the player.
        </p>
      )}

      {impact?.leavesOverCap && (
        <p className="text-xs text-warn">You are still over the salary cap after this move.</p>
      )}

      {failure && <p className="text-xs text-bad">{failure}</p>}

      <div className="flex gap-2">
        <ActionButton
          className="btn-danger flex-1"
          disabled={loading}
          idleLabel={confirmLabel}
          workingLabel="Releasing…"
          // Stated as the consequence, not the verb. The route change is
          // already in flight while this shows, so it costs nothing: the beat
          // fills the navigation that was happening anyway.
          doneLabel={impact && impact.capEnabled && impact.savings > 0 ? `Released — ${formatMoney(impact.savings)} freed` : 'Released'}
          onAction={async () => {
            // Returning false suppresses the success beat — a refusal must not
            // be dressed as an achievement — and the message goes on screen
            // instead of vanishing into ActionButton's catch.
            const result = await cutPlayerAction(leagueId, playerId);
            if (!result.ok) { setFailure(result.message); return false; }
            router.push(`/league/${leagueId}/roster`);
          }}
        />
        <button onClick={() => { setConfirming(false); setImpact(null); setFailure(null); }} className="btn-ghost">Cancel</button>
      </div>
    </div>
  );
}
