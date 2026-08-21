'use client';

import { useEffect, useRef, useState } from 'react';
import { formatMoney } from '@/lib/cap';
import type { SignedDeal } from '@/lib/negotiation';
import { PlayerAvatar } from '../PlayerAvatar';
import { TeamLogo } from '../TeamLogo';
import { DeltaChip, deltaTint } from './DeltaChip';
import { StatNumber } from './StatNumber';

/**
 * IT IS DONE, AND HERE IS WHAT YOU JUST AGREED TO.
 *
 * A signing used to complete by the row disappearing. That is the "success is
 * communicated by absence" failure the whole feedback layer exists to remove,
 * on the highest-stakes action in the game — the app owner felt it and asked
 * for *"some sort of visual feedback that the signing is done. maybe an
 * animated check box? idk"*.
 *
 * WHY A CHECKMARK WOULD HAVE BEEN THE WRONG ANSWER, twice over:
 *
 *   1. It would frequently never paint. `ActionButton`'s done beat runs for
 *      900ms, and a signing revalidates and re-renders the screen out from
 *      under it — one league measured 746ms from action to unmount in the same
 *      frame. A confirmation that only appears when the server happens to be
 *      slow teaches an inconsistent lesson. So this is not an animation with a
 *      lifetime; it is state, and it stays until dismissed. The refresh is
 *      deferred to that dismissal (see NegotiationPanel), which is the only
 *      way the confirmation of an event can outlive the event.
 *   2. A tick answers "did it work". The question a GM actually has at that
 *      instant is "what did I just commit to" — and the answer is the terms,
 *      the cap, and whether he beat somebody to it.
 *
 * EVERY FIGURE HERE WAS READ BACK OFF THE CONTRACT ROW after it was written
 * (see SignedDeal), not off what the panel had staged. Between the two sit a
 * clamp, a contract builder, a bonus split and — on an extension — an append
 * onto an existing deal. Confirming the staged numbers would differ only in
 * the cases nobody ever checks, which is the worst possible place to be wrong.
 *
 * Nothing here delays anything: it renders in the same commit that receives
 * the server's answer, and the button that produced it is already re-enabled.
 * Under reduced motion the entrance collapses to nothing and every fact stays.
 */
export function SigningConfirmation({ deal, answeredAt, onDismiss }: {
  deal: SignedDeal;
  /** performance.now() when the server answered — used only to report paint latency. */
  answeredAt?: number;
  onDismiss: () => void;
}) {
  const [shown, setShown] = useState(false);
  const paintMs = useRef<number | null>(null);
  useEffect(() => {
    if (answeredAt !== undefined && paintMs.current === null) {
      paintMs.current = Math.round(performance.now() - answeredAt);
    }
    // One frame, purely so the entrance has something to transition from. The
    // content is in the DOM and readable before it runs, and it is a CSS
    // transition on opacity/transform only — nothing waits for it.
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [answeredAt]);

  const capDelta = deal.capSpaceAfter - deal.capSpaceBefore;
  const extension = deal.mode === 'EXTENSION';
  const verb = extension ? 'Extended' : deal.mode === 'RESIGN' ? 'Re-signed' : 'Signed';

  return (
    <div
      data-testid="signing-confirmation"
      data-paint-ms={paintMs.current ?? undefined}
      className="rounded-md border border-accent/40 bg-accent/10 p-4 space-y-4"
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'translateY(0)' : 'translateY(6px)',
        transition: 'opacity var(--dur-state) var(--ease-out), transform var(--dur-state) var(--ease-out)',
      }}
    >
      <div className="flex items-center gap-3">
        <PlayerAvatar seed={deal.playerId} size={44} position={deal.position} />
        <div className="flex-1 min-w-0">
          <div className="label-sm text-accent">{verb} — it&apos;s done</div>
          <div className="text-lg font-semibold truncate">{deal.playerName}</div>
          <div className="text-xs text-muted">{deal.position}</div>
        </div>
        <TeamLogo seed={deal.teamId} abbr={deal.teamAbbr} size={38} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatNumber
          value={`${deal.years} yr${deal.years === 1 ? '' : 's'}`}
          label={extension ? 'Under contract' : 'Term'}
          size="sm"
        />
        <StatNumber
          value={formatMoney(extension ? deal.newMoneyValue : deal.totalValue)}
          label={extension ? 'New money' : 'Total value'}
          size="sm"
        />
        <StatNumber value={`${formatMoney(deal.apy)}/yr`} label={extension ? 'On the new years' : 'Per year'} size="sm" />
        <StatNumber value={formatMoney(deal.guaranteed)} label="Guaranteed" size="sm" />
      </div>

      {extension && (
        <p className="text-xs text-muted">
          His existing years kept their salaries; the new money went on the end. The whole contract is
          worth {formatMoney(deal.totalValue)} across {deal.years} years.
        </p>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-3 pt-3 border-t border-accent/25">
        <div className="flex items-center gap-2">
          <span className="label-sm">Cap space</span>
          <span className={`stat-value text-stat-md ${deltaTint(capDelta)}`}>{formatMoney(deal.capSpaceAfter)}</span>
          {/* The change, not just the new number — the whole point of the chip.
              Rendered directly rather than through useDeltaWatch because both
              figures came back from the server in one answer; there is no prop
              to watch and nothing to arm. */}
          <DeltaChip delta={capDelta} format={formatMoney} />
        </div>
        <span className="text-xs text-muted">
          Cap hit this year: {formatMoney(deal.capHitThisYear)}
        </span>
      </div>

      {/* The best moment this feature has, and it used to pass in silence. */}
      {deal.beat && (
        <p className="text-sm text-accent">
          You beat the {deal.beat.teamName} to him — they were at {formatMoney(deal.beat.apy)}/yr.
        </p>
      )}

      <button type="button" onClick={onDismiss} className="btn-secondary w-full">
        Done
      </button>
    </div>
  );
}
