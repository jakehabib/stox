'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toggleShortlistAction } from '@/app/actions/draft';

/**
 * The star that puts a prospect in front of your area scouts every week.
 *
 * Two shapes, one behaviour. The bare star is for a board row, where the
 * column header already says what it is and forty of them down a page would
 * be unreadable with words attached. `label` gives the same control the name
 * the rest of the game uses for it — the draft board's filter says
 * "★ Shortlist", so the button that puts a man on it has to say the same
 * word. The app owner, looking at a prospect's card: *"we should also be able
 * to shortlist from the draftee player card"*. The control was already there,
 * captioned "Star to have him watched" and sat inside a scouting-confidence
 * band, which is a different feature as far as anybody reading the page is
 * concerned.
 */
export function ShortlistStar({ leagueId, teamId, playerId, initial, label = false }: {
  leagueId: string; teamId: string; playerId: string; initial: boolean;
  /** Render as a named pill rather than a bare star. */
  label?: boolean;
}) {
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOn((v) => !v);
    startTransition(async () => {
      await toggleShortlistAction(leagueId, teamId, playerId);
      router.refresh();
    });
  };

  if (label) {
    return (
      <button
        disabled={pending}
        onClick={toggle}
        title={on ? 'Your scouts work him every week. Click to drop him.' : 'Put him in front of your scouts every week'}
        className={`pill text-[10px] gap-1.5 transition-colors ${
          on ? 'border-gold/50 text-gold bg-gold/10' : 'border-line text-muted hover:text-chalk hover:border-muted'
        } ${pending ? 'opacity-60' : ''}`}
      >
        <span className="text-xs leading-none">{on ? '★' : '☆'}</span>
        {on ? 'Shortlisted' : 'Shortlist'}
      </button>
    );
  }

  return (
    <button
      disabled={pending}
      onClick={toggle}
      title={on ? 'Remove from shortlist' : 'Add to shortlist'}
      className={`text-base leading-none ${on ? 'text-gold' : 'text-line hover:text-muted'}`}
    >
      {on ? '★' : '☆'}
    </button>
  );
}
