'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toggleShortlistAction } from '@/app/actions/draft';
import { useMomentBurst } from './ds/Moments';

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
  const [burst, fire] = useMomentBurst();
  const router = useRouter();

  /*
   * THE STAR FOLLOWS THE WRITE, NOT THE CLICK.
   *
   * It used to flip the instant the button went down and then send the
   * request. That reads well right up until the write is refused — an owner
   * check, a dropped connection — at which point the board is showing a
   * shortlist the database does not have, and the man it says your scouts are
   * working every week is a man nobody is watching. So `on` now comes back
   * from the action, which returns the row it actually wrote.
   *
   * The burst is armed on the same answer and only when he went ON the board.
   * Taking a man off is not a moment; it is housekeeping.
   */
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    startTransition(async () => {
      try {
        const r = await toggleShortlistAction(leagueId, teamId, playerId);
        setOn(r.shortlisted);
        if (r.shortlisted) fire();
        router.refresh();
      } catch {
        // Leave the star exactly where it was. A control that lies about what
        // is in the database is worse than one that appears not to have moved.
      }
    });
  };

  /* Remounted on each burst, which is what makes a CSS animation run a second
     time — see the note in ds/Moments.tsx. */
  const star = (glyph: string, className: string) => (
    <span key={burst} className={`${className} ${burst > 0 && on ? 'moment-star' : ''}`}>{glyph}</span>
  );

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
        {star(on ? '★' : '☆', 'text-xs leading-none')}
        {on ? 'Shortlisted' : 'Shortlist'}
      </button>
    );
  }

  return (
    <button
      disabled={pending}
      onClick={toggle}
      title={on ? 'Remove from shortlist' : 'Add to shortlist'}
      /* The empty star was `text-line`, which is the BORDER token: 1.36:1 on
         the board's surface. A control the user is meant to find was, in
         practice, invisible until the pointer happened to cross it. `muted`
         is the same token the row's other secondary figures use and measures
         5.82:1; the gold filled state stays the loud one, so the on/off
         reading is unchanged — only the off state is now actually there. */
      className={`text-base leading-none ${on ? 'text-gold' : 'text-muted hover:text-chalk'}`}
    >
      {star(on ? '★' : '☆', '')}
    </button>
  );
}
