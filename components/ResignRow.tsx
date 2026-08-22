'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { NegotiationPanel } from './NegotiationPanel';
import { PlayerAvatar } from './PlayerAvatar';
import { ratingColor } from '@/lib/ratings';
import { formatMoney } from '@/lib/cap';
import { positionBadgeClass } from './ds/positionColor';
import { CapMode } from '@/lib/types';
import type { DealStructure, NegotiationSession } from '@/lib/negotiation';
import { DealStructureControls, DEFAULT_ESCALATION } from './DealStructureControls';
import { cutPlayerAction, applyFranchiseTagAction } from '@/app/actions/roster';
import { openResignNegotiationAction, submitResignOfferAction, setAsideResignAction } from '@/app/actions/resign';
import { ActionButton } from './ds/ActionButton';
import { SuitorRumour, LoyaltyLine } from './ds/SuitorRumour';
import { DepthAtPosition, type DepthEntry } from './ds/DepthAtPosition';
import { Tooltip } from './Tooltip';
import { tip } from '@/lib/glossary';

/** Where a fresh deal opens. Reset terms returns the shape here. */
const OPENING_STRUCTURE: DealStructure = { escalation: DEFAULT_ESCALATION, voidYears: 0 };

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
 *
 * They are also CLOSED honestly. Collapsing the row throws the client session
 * away and re-opens from the database next time, which is the only correct
 * behaviour once patience is server state: a negotiation you walked out of has
 * to still be the negotiation you walked out of when you come back to it.
 */
export function ResignRow({ leagueId, playerId, name, position, age, ovr, currentApy, capMode, yearsRemaining, canTag, weightLb, heightIn, depth, setAside }: {
  leagueId: string; playerId: string; name: string; position: string; age: number; ovr: number;
  currentApy: number; capMode: CapMode; yearsRemaining: number; canTag?: boolean;
  /**
   * He is parked — "not now" rather than "let him walk". The row draws itself
   * closed, with the one control that undoes it, and nothing about his
   * negotiation has changed: same asking price, same pips, same everything.
   * See setAsideResignAction.
   */
  setAside?: boolean;
  /**
   * Your depth chart at his position, in the depth chart's own order, with him
   * marked. Resolved by the page from DepthChartSlot — the same rows the Depth
   * Chart screen renders — so the two screens cannot disagree about who plays.
   */
  depth?: DepthEntry[];
  /** Still accepted from the page; the negotiation resolves its own cap room server-side. */
  availableSpace?: number;
  weightLb?: number; heightIn?: number;
}) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<NegotiationSession | null | undefined>(undefined);
  // The deal SHAPE — front/back-load and void years. The re-sign window simply
  // did not have this: it passed no structure at all, so every re-signed deal
  // silently took DEFAULT_STRUCTURE and the app owner was right that the
  // slider was missing. Same component free agency and extensions render.
  const [structure, setStructure] = useState<DealStructure>(OPENING_STRUCTURE);
  // A lookup, not a column: the list is already long and this is the answer to
  // a question you only ask about one man at a time.
  // Open by default. "Do I pay this man" is not answerable without knowing who
  // plays if he walks, so the answer should not be behind a second click on a
  // row you already had to open — the app owner's note was that the re-sign
  // pop-out "always needs to show the starter".
  const [showDepth, setShowDepth] = useState(true);
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

  /**
   * Leave the table. It closes the row and drops the client's copy of the
   * session so re-opening resolves a fresh one from the database — which is
   * how the pips he has already spent come back with him. Nothing is written,
   * nothing is refunded, and the panel says so in as many words.
   */
  const leaveTable = () => {
    setOpen(false);
    setSession(undefined);
    setStructure(OPENING_STRUCTURE);
  };

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

  /**
   * Park him, or pick him back up. Deliberately NOT wired through
   * `confirmingWalk` — that control releases a player and asks first, because
   * it cannot be undone. This one is undone by the button that replaces it, so
   * asking would be theatre. Nothing is refunded and nothing is spent: see
   * setAsideResignAction.
   */
  const toggleAside = async (aside: boolean) => {
    await setAsideResignAction(leagueId, playerId, aside);
    router.refresh();
    return aside ? 'Set aside' : 'Back on the list';
  };

  // SET ASIDE, DRAWN AS PARKED — not as gone. He keeps his avatar, his rating
  // and his money (design principle 2: identity is not ornament), because the
  // point of the pile is that you can look at it and pick somebody back out.
  if (setAside) {
    return (
      <div className="panel overflow-hidden opacity-70">
        <div className="w-full flex items-center gap-3 px-4 py-2.5">
          <PlayerAvatar seed={playerId} age={age} size={26} weightLb={weightLb} heightIn={heightIn} position={position} />
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate text-sm">{name}</div>
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
          <ActionButton
            className="btn-secondary text-xs px-3 py-1.5"
            idleLabel="Bring back"
            workingLabel="Bringing back…"
            onAction={() => toggleAside(false)}
          />
        </div>
      </div>
    );
  }

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
          {depth && depth.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowDepth((v) => !v)}
                className="btn-secondary text-sm"
                aria-expanded={showDepth}
              >
                {showDepth ? 'Hide' : 'Show'} what&apos;s behind him at {position}
              </button>
              {showDepth && <DepthAtPosition position={position} depth={depth} capOn={capMode !== 'OFF'} />}
            </div>
          )}
          {session === undefined && <div className="text-sm text-muted py-2">Getting his agent on the phone…</div>}
          {session === null && <div className="text-sm text-bad py-2">Could not open talks with {name}.</div>}
          {session && (
            <NegotiationPanel
              title="Re-sign Talks"
              initialSession={session}
              structure={structure}
              onSigned={() => { setOpen(false); router.refresh(); }}
              onReset={() => setStructure(OPENING_STRUCTURE)}
              onCancel={leaveTable}
              onOffer={(offer, str, fingerprint) =>
                submitResignOfferAction(leagueId, playerId, offer, str, fingerprint)}
              structureSlot={
                (years) => <DealStructureControls capMode={capMode} contractYears={years} structure={structure} onChange={setStructure} />
              }
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
          {/* TRIAGE, NOT A DECISION. It sits apart from "Not Re-sign" on purpose:
              one of these two buttons releases a player to free agency and the
              other only moves him down the page. The copy has to make that
              impossible to confuse, so it says what it does and what it does
              not do. */}
          <div className="flex items-center gap-3 flex-wrap border-t border-line/50 pt-3">
            <ActionButton
              className="btn-secondary text-xs px-3 py-1.5"
              idleLabel="Not now — set aside"
              workingLabel="Setting aside…"
              onAction={() => toggleAside(true)}
            />
            <span className="text-xs text-muted flex-1 min-w-[14rem]">
              Moves him to the bottom of this page so you can work the list. He is not released, nothing is
              offered, and it costs him no patience — bring him back any time before this phase ends.
            </span>
          </div>
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
                <span className="inline-flex items-center gap-1.5">
                  <button disabled={tagPending} onClick={tag} className="pill border-gold/40 text-gold text-xs hover:bg-gold/10">
                    {tagPending ? 'Tagging…' : 'Franchise Tag'}
                  </button>
                  <Tooltip text={tip('franchiseTag')} />
                </span>
              )}
            </div>
          )}
          {tagMessage && <p className={`text-xs ${tagMessage.startsWith('Tagged') ? 'text-accent' : 'text-bad'}`}>{tagMessage}</p>}
        </div>
      )}
    </div>
  );
}
