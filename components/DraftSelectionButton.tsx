'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { draftPlayerAction } from '@/app/actions/draft';
import { useDraftMoment, type SelectionMoment } from './DraftMoment';

/**
 * Make the selection. The button itself is what the board has always had —
 * including the cap refusal, which is a real outcome of a rookie deal (see
 * draftPlayer) and has to be readable right here rather than blanking the
 * screen.
 *
 * The card it raises deliberately does NOT live in this component. It used to,
 * and this row is the one thing on the page guaranteed to be gone a moment
 * after the pick — which is exactly how the confirmation came to flash and
 * die. It is raised in DraftMomentProvider, above the whole page; see the
 * comment there, and the standing one in app/actions/draft.ts about why the
 * server action does not revalidate.
 *
 * While the board behind a dismissed card is being refetched, every Draft
 * button on it points at a row that may already be gone — the ticker starts
 * the next club's clock the moment the refresh reports the user off the clock,
 * and draftPlayer() does not re-check that its man is still free. So they all
 * go disabled until the new board lands.
 */
export function DraftSelectionButton({ leagueId, teamId, moment }: {
  leagueId: string;
  teamId: string;
  moment: SelectionMoment;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const draft = useDraftMoment();
  const router = useRouter();
  const stale = draft?.refreshing ?? false;

  return (
    <div className="space-y-1">
      <button
        className="btn-primary text-xs px-2.5 py-1"
        disabled={pending || stale}
        onClick={() => startTransition(async () => {
          const res = await draftPlayerAction(leagueId, moment.player.id, teamId);
          if (!res.ok) { setError(res.message); return; }
          setError(null);
          // The card's dismissal is what refreshes the board and restarts the
          // clock on the next club (see DraftMomentProvider). Outside the
          // provider there is no card and therefore no dismissal, so the
          // refresh has to happen here instead — without it the draft would
          // simply sit on a stale board with nobody picking.
          if (draft) draft.show(moment);
          else router.refresh();
        })}
      >
        {pending ? 'Drafting…' : stale ? 'Board updating…' : 'Draft'}
      </button>
      {error && <p className="text-[11px] text-bad max-w-[16rem] leading-snug">{error}</p>}
    </div>
  );
}
