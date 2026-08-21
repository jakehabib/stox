'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cutPlayerAction, cutImpactAction, CutImpact } from '@/app/actions/roster';
import { formatMoney } from '@/lib/cap';

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
 */
export function CutButton({ leagueId, playerId }: { leagueId: string; playerId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [impact, setImpact] = useState<CutImpact | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
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

  return (
    <div className="space-y-3">
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
          <div className="flex justify-between pt-1.5 border-t border-line/60">
            <span className="text-muted">Net cap {impact.savings >= 0 ? 'freed' : 'LOST'}</span>
            <span className={`font-mono font-semibold ${impact.savings >= 0 ? 'text-accent' : 'text-bad'}`}>
              {formatMoney(impact.savings)}
            </span>
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
          This release costs you {formatMoney(-impact.savings)} of cap space rather than freeing any. His signing bonus
          has been prorated across years you'd no longer get — all of it accelerates onto this season the moment he's
          cut. Keeping him through the season is cheaper; the dead money shrinks each year the deal runs down.
        </p>
      )}

      {impact?.capEnabled && !impact.costsMoreThanKeeping && impact.deadMoney > 0 && (
        <p className="text-xs text-muted">
          {formatMoney(impact.deadMoney)} of prorated signing bonus stays on your books as dead money — you pay for him
          either way, you just stop getting the player.
        </p>
      )}

      {impact?.leavesOverCap && (
        <p className="text-xs text-warn">You are still over the salary cap after this move.</p>
      )}

      <div className="flex gap-2">
        <button
          disabled={pending || loading}
          onClick={() => startTransition(async () => { await cutPlayerAction(leagueId, playerId); router.push(`/league/${leagueId}/roster`); })}
          className="btn-danger flex-1"
        >
          {pending ? 'Releasing…' : 'Confirm Release'}
        </button>
        <button onClick={() => { setConfirming(false); setImpact(null); }} className="btn-ghost">Cancel</button>
      </div>
    </div>
  );
}
