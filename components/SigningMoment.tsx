'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { SignedDeal } from '@/lib/negotiation';
import { SigningConfirmation } from './ds/SigningConfirmation';

export interface SigningMoment {
  /** Read back off the contract row after it was written — see SignedDeal. */
  deal: SignedDeal;
  /** performance.now() when the server answered; the card reports its own paint latency. */
  answeredAt?: number;
  /**
   * What the screen that opened the talks still has to do once the card is
   * gone — collapse the re-sign row, close the extension form, ask for a fresh
   * render. A screen whose Server Action already revalidated passes nothing,
   * because there is nothing left to ask for.
   */
  onDismiss?: () => void;
}

interface SigningMomentApi {
  show: (moment: SigningMoment) => void;
}

const SigningMomentContext = createContext<SigningMomentApi | null>(null);

/**
 * THE SIGNING CARD, RAISED ABOVE EVERY SCREEN THAT CAN SIGN A PLAYER.
 *
 * The card used to be drawn by `NegotiationPanel`, inside whatever the panel
 * was mounted in — and on the open market that is the free agent's own player
 * card, which is gated on `player.status === 'FREE_AGENT'`. The instant the
 * deal closes that condition is false. So any re-render of that route took the
 * confirmation of the signing down with it, and the screens could only keep
 * the card by refusing to re-render at all: `submitOfferAction` did not
 * revalidate, and the refresh waited for the user to press Done.
 *
 * That bought the card and cost the header. `LineupGapBanner` and
 * `CapAlertBanner` are rendered by app/league/[id]/layout.tsx, and Next reuses
 * a cached layout payload across client-side navigations — so an amber NO
 * HEALTHY K sat above a depth chart reading "every starting slot filled",
 * because the kicker who fixed it had been signed by a path that deliberately
 * refreshed nothing. The app owner found it from a phone: *"this banner
 * persists even after signing a new kicker"*. On a phone the Done button is at
 * the bottom of a long panel and the nav bar is at the bottom of the screen,
 * so the tap that leaves the page is the easy one — and a standing warning
 * that a starting spot has nobody healthy for it cannot be left lying by a
 * button the user was never obliged to press.
 *
 * This is the draft's fix, applied to the other card that dies with its row.
 * `DraftMomentProvider` hoists the pick confirmation out of the drafted man's
 * board row for exactly this reason; the difference here is that hoisting also
 * frees the Server Action, so free-agent signings now revalidate the layout
 * like every other roster mutation and the banner is correct before the user
 * has touched anything. Nothing unmounts this: it sits in the league layout,
 * above the page, and a revalidation re-renders it rather than replacing it.
 *
 * It is a dialog rather than a strip inside the panel because the panel it
 * used to sit in is frequently gone by the time it is read, and because a
 * confirmation you have to scroll to is the thing that made the banner stale
 * in the first place.
 */
export function SigningMomentProvider({ children }: { children: React.ReactNode }) {
  const [moment, setMoment] = useState<SigningMoment | null>(null);
  const show = useCallback((m: SigningMoment) => setMoment(m), []);
  // Stable, so raising a card does not re-render every negotiation panel under
  // this provider along with it.
  const api = useMemo(() => ({ show }), [show]);

  // The screen's own follow-up runs AFTER the card is taken down, and it is
  // read off the moment rather than out of a ref so a stale callback from an
  // earlier negotiation can never be the one that fires.
  const dismiss = useCallback(() => {
    const after = moment?.onDismiss;
    setMoment(null);
    after?.();
  }, [moment]);

  // A card that outlived its screen. The dialog covers the page, so the only
  // ways off it while the card is up are the keyboard and the phone's back
  // button — and a confirmation of a signing hanging over the standings is
  // just litter. It is dropped, not dismissed: whatever the screen wanted
  // doing afterwards was about a screen that is no longer here.
  const pathname = usePathname();
  useEffect(() => { setMoment(null); }, [pathname]);

  useEffect(() => {
    if (!moment) return;
    // Escape only. Enter and Space belong to the Done button underneath, and
    // binding them here would dismiss the card twice on one keypress.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moment, dismiss]);

  return (
    <SigningMomentContext.Provider value={api}>
      {children}
      {moment && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 bg-ink/85 backdrop-blur-sm animate-fadeUp"
          onClick={dismiss}
          role="dialog"
          aria-modal="true"
          aria-label={`Contract agreed with ${moment.deal.playerName}`}
        >
          {/* Solid card behind it: the confirmation's own background is a
              translucent accent wash, which was designed to sit on a panel and
              would otherwise be reading over the dimmed page. */}
          <div
            className="w-full max-w-lg my-auto rounded-md bg-card shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <SigningConfirmation deal={moment.deal} answeredAt={moment.answeredAt} onDismiss={dismiss} />
          </div>
        </div>
      )}
    </SigningMomentContext.Provider>
  );
}

/**
 * null outside the provider, so `NegotiationPanel` still works anywhere it is
 * mounted — it falls back to drawing the card inline, which is what every
 * screen did before this existed.
 */
export function useSigningMoment(): SigningMomentApi | null {
  return useContext(SigningMomentContext);
}
