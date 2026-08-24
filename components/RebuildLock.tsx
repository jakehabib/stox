'use client';

import { useState } from 'react';

/**
 * THE ONE CONTROL A LOCKED REBUILD SAVE HAS.
 *
 * Two presses, not one, and the second one is labelled with what it does
 * rather than with "Confirm". An irreversible choice behind a button that says
 * OK is a choice somebody makes by accident.
 *
 * It holds no facts about the save — the sentences are handed in by the
 * server-rendered page — so it can never come to describe a run that has moved
 * on. All it owns is whether the second press is showing.
 *
 * Written as a front office deciding to stop playing under its own
 * restrictions, because that is what it is. There is no dialog, no red
 * triangle and no "Are you sure?": the consequence is stated in full, in
 * plain language, and then the button says it again.
 */
export function RebuildLock({ action }: { action: () => Promise<void> }) {
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);

  if (!armed) {
    return (
      <button type="button" className="btn-ghost text-sm" onClick={() => setArmed(true)}>
        End the rebuild and unlock these settings
      </button>
    );
  }

  return (
    <form
      action={async () => {
        setPending(true);
        try {
          await action();
        } finally {
          setPending(false);
          setArmed(false);
        }
      }}
      className="panel p-4 border-warn/40 space-y-3"
    >
      <div className="label-sm text-warn">Before you do</div>
      <p className="text-sm text-chalk/90 leading-relaxed max-w-2xl">
        Ending the run hands you back every setting in this league — the difficulty, the trade rules, the
        ceiling. It also ends your claim on the Rebuild board for good. A title won after this is still a title
        and still counts everywhere else in the game; it is simply not the thing that board measures, which is a
        championship built under the rules you took on when you started. There is no way back into them.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary text-sm" disabled={pending}>
          {pending ? 'Ending the run…' : 'End the run — I give up the board'}
        </button>
        <button type="button" className="btn-ghost text-sm" onClick={() => setArmed(false)} disabled={pending}>
          Keep going
        </button>
      </div>
    </form>
  );
}
