'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { NegotiationPanel } from './NegotiationPanel';
import { PlayerAvatar } from './PlayerAvatar';
import { ratingColor } from '@/lib/ratings';
import { formatMoney } from '@/lib/cap';
import { positionBadgeClass } from './ds/positionColor';
import { CapMode } from '@/lib/types';
import type { NegotiationSession } from '@/lib/negotiation';
import { cutPlayerAction, applyFranchiseTagAction } from '@/app/actions/roster';
import { openResignNegotiationAction, submitResignOfferAction } from '@/app/actions/resign';
import { SuitorRumour, LoyaltyLine } from './ds/SuitorRumour';

/**
 * One expiring contract, and the decision it forces.
 *
 * "Negotiate" used to open an extension form that the server rubber-stamped:
 * any number, any term, instantly signed. Your own players were the easiest
 * thing in the game to keep, which drained the meaning out of the whole
 * re-sign window. It now opens the same negotiation minigame free agency uses
 * — the identical model, the identical `decideOffer` — with two differences
 * that the server resolves, not this component:
 *
 *   - He is an INCUMBENT, so a player who wants to stay will take a real
 *     discount to do it, and the longer he has been here the bigger it is —
 *     but that discount now DECAYS as his deal runs out, which is what makes
 *     "when" a question with an answer. LoyaltyLine states which side of it
 *     you are on before you touch a slider.
 *   - Nobody else may SIGN him yet — but somebody already wants him, and the
 *     panel names them. SuitorRumour is a real club with real room and a real
 *     hole at his position, resolved by the same function free agency uses, so
 *     the pressure in this window is checkable rather than atmospheric. That
 *     is the difference between "how much do I overpay" and a negotiation.
 *
 * Talks are opened lazily, when the row is expanded, so a re-sign page with
 * twelve expiring contracts does not resolve twelve negotiations on load.
 */
export function ResignRow({ leagueId, playerId, name, position, age, ovr, currentApy, capMode, yearsRemaining, canTag, weightLb, heightIn }: {
  leagueId: string; playerId: string; name: string; position: string; age: number; ovr: number;
  currentApy: number; capMode: CapMode; yearsRemaining: number; canTag?: boolean;
  /** Still accepted from the page; the negotiation resolves its own cap room server-side. */
  availableSpace?: number;
  weightLb?: number; heightIn?: number;
}) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<NegotiationSession | null | undefined>(undefined);
  const [confirmingWalk, setConfirmingWalk] = useState(false);
  const [tagPending, setTagPending] = useState(false);
  const [tagMessage, setTagMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Still mid-deal (this is his walk year, but the season isn't over) —
  // there's nothing to "decide" yet, just re-sign early if you want to.
  const isTrulyExpiring = yearsRemaining === 0;

  useEffect(() => {
    if (!open || session !== undefined) return;
    let cancelled = false;
    openResignNegotiationAction(leagueId, playerId)
      .then((s) => { if (!cancelled) setSession(s); })
      .catch(() => { if (!cancelled) setSession(null); });
    return () => { cancelled = true; };
  }, [open, session, leagueId, playerId]);

  const notResign = () => {
    startTransition(async () => {
      await cutPlayerAction(leagueId, playerId);
      router.refresh();
    });
  };

  const tag = () => {
    setTagPending(true);
    setTagMessage(null);
    startTransition(async () => {
      const result = await applyFranchiseTagAction(leagueId, playerId);
      setTagPending(false);
      setTagMessage(result.message);
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="panel overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-raised transition-colors">
        <PlayerAvatar seed={playerId} age={age} size={30} weightLb={weightLb} heightIn={heightIn} position={position} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{name}</div>
          <div className="text-xs mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span className={`font-semibold ${positionBadgeClass(position)}`}>{position}</span>
            <span className="text-muted">Age {age}</span>
            <span className="text-muted">·</span>
            <span className="text-muted">~{formatMoney(currentApy)}/yr</span>
            {isTrulyExpiring
              ? <span className="pill border-bad/40 text-bad text-[10px]">Expired</span>
              : <span className="pill border-warn/40 text-warn text-[10px]">Walk Year</span>}
          </div>
        </div>
        <span className={`stat-value text-stat-sm ${ratingColor(ovr)}`}>{ovr}</span>
        <span className="pill border-line text-muted">{open ? 'Close' : 'Negotiate'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-line/60 space-y-3">
          {session === undefined && <div className="text-sm text-muted py-2">Getting his agent on the phone…</div>}
          {session === null && <div className="text-sm text-bad py-2">Could not open talks with {name}.</div>}
          {session && (
            <NegotiationPanel
              title="Re-sign Talks"
              initialSession={session}
              onSigned={() => { setOpen(false); router.refresh(); }}
              onOffer={(offer, structure, fingerprint) =>
                submitResignOfferAction(leagueId, playerId, offer, structure, fingerprint)}
              banner={
                <>
                  {/* Both halves of the same clock, above the meter and before
                      any control is touched: what staying is worth to him right
                      now, and who is waiting if it stops being worth enough.
                      Neither is revealed after the fact — a pressure you only
                      learn about once you have committed is a gotcha, not a
                      mechanic. */}
                  <LoyaltyLine session={session} />
                  <SuitorRumour session={session} />
                </>
              }
            />
          )}
          {isTrulyExpiring && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              {confirmingWalk ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted flex-1">Let {name} walk to free agency?</span>
                  <button disabled={pending} onClick={notResign} className="btn-danger text-xs px-3 py-1.5">
                    {pending ? 'Releasing…' : 'Confirm — Not Re-sign'}
                  </button>
                  <button onClick={() => setConfirmingWalk(false)} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setConfirmingWalk(true)} className="text-xs text-bad hover:underline">
                  Not Re-sign — let him walk
                </button>
              )}
              {canTag && (
                <button disabled={tagPending} onClick={tag} className="pill border-gold/40 text-gold text-xs hover:bg-gold/10">
                  {tagPending ? 'Tagging…' : 'Franchise Tag'}
                </button>
              )}
            </div>
          )}
          {tagMessage && <p className={`text-xs ${tagMessage.startsWith('Tagged') ? 'text-accent' : 'text-bad'}`}>{tagMessage}</p>}
        </div>
      )}
    </div>
  );
}
