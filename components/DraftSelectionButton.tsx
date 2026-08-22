'use client';

import { useState, useTransition } from 'react';
import { draftPlayerAction } from '@/app/actions/draft';
import { useDraftMoment, type SelectionMoment } from './DraftMoment';

/**
 * Make the selection. The button itself is unchanged from what the board has
 * always had — including the cap refusal, which is a real outcome of a rookie
 * deal (see draftPlayer) and has to be readable right here rather than
 * blanking the screen.
 *
 * What is new is that a successful pick raises the moment card, which lives up
 * in DraftMomentProvider: the action revalidates the league layout, so this row
 * (and this component with it) is gone from the board a moment later.
 */
export function DraftSelectionButton({ leagueId, teamId, moment }: {
  leagueId: string;
  teamId: string;
  moment: SelectionMoment;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const show = useDraftMoment();

  return (
    <div className="space-y-1">
      <button
        className="btn-primary text-xs px-2.5 py-1"
        disabled={pending}
        onClick={() => startTransition(async () => {
          const res = await draftPlayerAction(leagueId, moment.player.id, teamId);
          if (!res.ok) { setError(res.message); return; }
          setError(null);
          show?.(moment);
        })}
      >
        {pending ? 'Drafting…' : 'Draft'}
      </button>
      {error && <p className="text-[11px] text-bad max-w-[16rem] leading-snug">{error}</p>}
    </div>
  );
}
