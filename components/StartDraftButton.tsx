'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { beginRookieDraftAction } from '@/app/actions/draft';

/**
 * PUTS THE FIRST PICK ON THE CLOCK, and nothing else does.
 *
 * The rookie draft used to open itself. Free agency's last week is advanced,
 * the phase flips to DRAFT, and LiveDraftTicker began burning selections the
 * moment the page rendered — the app owner: *"it autostarted without me
 * knowing"*. DraftState now carries `started` and this is the only control
 * that sets it (beginRookieDraftAction, a compare-and-set, so a double click
 * is one draft and not two).
 *
 * THE CONFIRM STEP IS ABOUT UNSPENT WORKOUTS, NOT ABOUT SECOND-GUESSING.
 * Private workouts are the one scarce scouting decision in the game and their
 * window closes the instant the first card goes in (see lib/workouts.ts). A GM
 * who walks to the podium holding four of them has thrown away the whole
 * mechanic without being told, so when any are left the button asks once and
 * points at the room where they can still be used. With none left there is no
 * second step at all — a confirm that always fires is a confirm nobody reads.
 */
export function StartDraftButton({ leagueId, unusedWorkouts, fullScoutsLeft, scoutingHref }: {
  leagueId: string;
  /** Private workouts still on the books. Above zero, the button asks first. */
  unusedWorkouts: number;
  /** Full Scout evaluations in hand. Mentioned, never gated on — see below. */
  fullScoutsLeft: number;
  scoutingHref: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const begin = () => startTransition(async () => {
    await beginRookieDraftAction(leagueId);
    router.refresh();
  });

  if (!confirming) {
    return (
      <button
        className="btn-primary text-base px-7 py-3"
        disabled={pending}
        onClick={() => (unusedWorkouts > 0 ? setConfirming(true) : begin())}
      >
        {pending ? 'Going on the clock…' : 'Start the Draft'}
      </button>
    );
  }

  return (
    <div className="panel border-warn/50 bg-warn/5 p-4 space-y-3 max-w-md">
      <div className="label-sm text-warn">Before you go to the podium</div>
      <p className="text-sm text-chalk/90 leading-snug">
        Your scouting department still has {unusedWorkouts} private workout{unusedWorkouts === 1 ? '' : 's'} on
        the books. That window shuts the second the first card goes in, and unused slots do not carry to next
        year — there is still time to fly somebody in.
      </p>
      {/* Full Scouts are named but never gated on: unlike a workout they are a
          league-year entitlement and survive into the season, so telling a GM
          they are about to expire would simply be false. */}
      {fullScoutsLeft > 0 && (
        <p className="text-xs text-muted leading-snug">
          You also have {fullScoutsLeft} full evaluation{fullScoutsLeft === 1 ? '' : 's'} in hand. Those keep
          through the league year, but a man taken at 14 is not yours to look at afterwards.
        </p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <a href={scoutingHref} className="btn-secondary text-sm">Open the scouting room</a>
        <button className="btn-primary text-sm" disabled={pending} onClick={begin}>
          {pending ? 'Going on the clock…' : 'Start anyway'}
        </button>
        <button className="btn-ghost text-sm" disabled={pending} onClick={() => setConfirming(false)}>
          Not yet
        </button>
      </div>
    </div>
  );
}
