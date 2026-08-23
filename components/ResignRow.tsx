'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { NegotiationPanel } from './NegotiationPanel';
import { PlayerAvatar } from './PlayerAvatar';
import { ratingColor } from '@/lib/ratings';
import { formatMoney } from '@/lib/cap';
import { startersAt } from '@/lib/lineup';
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
export function ResignRow({ leagueId, playerId, name, position, age, ovr, currentApy, capMode, yearsRemaining, canTag, tagDeadMoney, weightLb, heightIn, depth, marketApy, setAside }: {
  leagueId: string; playerId: string; name: string; position: string; age: number; ovr: number;
  currentApy: number; capMode: CapMode; yearsRemaining: number; canTag?: boolean;
  /**
   * Signing bonus on his EXPIRING deal that has not finished amortising, and
   * which accelerates onto this year's cap as dead money the moment he is
   * tagged — the tag writes a new contract over the old one but does not
   * retire what the old one still owes (applyFranchiseTag, and INV-21's second
   * clause). It used to evaporate, so the button used to be free and honest
   * about being free. It is not free now, and a control with no confirmation
   * step has to say what it costs before it is pressed rather than after.
   * Resolved on the server by the page; 0 on most deals and in every cap mode
   * but Realistic, and the line is simply absent then.
   */
  tagDeadMoney?: number;
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
  /**
   * What the OPEN MARKET says a player of his rating, position and age is worth
   * — `marketValue()`, resolved by the page. Deliberately not what he will sign
   * for: his reservation price is this number run through a personality, a
   * loyalty discount that decays as his deal runs out, a premium for whoever
   * else is calling, and a seeded wobble (see buildContext in
   * lib/negotiation.ts). None of that is visible until talks open, and none of
   * it can be reconstructed from this. It is a benchmark for triage, and the
   * row prints it as a band for exactly that reason.
   */
  marketApy?: number;
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

  /**
   * ===========================================================================
   * TRIAGE BEFORE TALKS — WHAT THE COLLAPSED ROW OWES YOU
   * ===========================================================================
   * Measured on a real save: eleven expiring men, and the collapsed row showed
   * name, position, age, his current salary, a pill and his rating. Everything
   * a keep-or-let-go call actually turns on — who plays if he leaves, and
   * roughly what the market says he is worth — was behind Negotiate, which is
   * one click and one server round-trip each. Eleven clicks and eleven
   * negotiations resolved to make eleven decisions, most of which are obvious
   * the moment you know those two things.
   *
   * So both are computed here, from what the page already had in hand, and
   * neither costs a request:
   *
   *   SUCCESSION comes off `depth` — the DepthChartSlot rows in the depth
   *     chart's own rank order, the same table the Depth Chart screen renders.
   *     If he starts, the man who inherits the job is whoever is first off the
   *     bench, because everyone below him shifts up one when he goes. If
   *     nobody is, the slot goes unmanned and that is worth saying loudest.
   *   THE BAND is `marketValue` — see the prop. A RANGE, never a number, and
   *     never his reservation price: printing what he will actually sign for
   *     would end the negotiation minigame, which measures as working. The band
   *     tells you which conversation this is (a minimum-salary body, or eight
   *     figures) and nothing finer, which is all triage needs.
   */
  const starterSlots = startersAt(position);
  const succession = (() => {
    if (!depth || depth.length === 0 || starterSlots === 0) return null;
    const at = depth.findIndex((d) => d.isSubject);
    if (at < 0) return null;
    if (at >= starterSlots) {
      // The man one rank above him, which is literally what "behind" means
      // here — not the last starter, who may be several places further up.
      const ahead = depth[at - 1];
      return ahead ? { starts: false as const, other: ahead } : null;
    }
    // He is in the lineup. The man who takes the snaps is the first man not in
    // it — index `starterSlots` — because his departure moves everybody up one.
    const heir = depth[starterSlots];
    return { starts: true as const, other: heir ?? null };
  })();

  /**
   * ±20% around the open-market figure, rounded to the nearest $100k so the two
   * ends read as an estimate rather than a quote. Wide enough that the true
   * reservation — which the loyalty discount pushes below it and a rival's
   * interest pushes above it — is not readable off either end.
   */
  const band = marketApy && marketApy > 0
    ? {
      low: Math.round(marketApy * 0.8 / 100_000) * 100_000,
      high: Math.round(marketApy * 1.2 / 100_000) * 100_000,
    }
    : null;

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
    setTagMessage(null);
    startTransition(async () => {
      // A release can legitimately fail — he is already gone, or a second tab
      // got there first. This used to await a promise that threw and say
      // nothing at all, which read as the button doing nothing.
      const result = await cutPlayerAction(leagueId, playerId);
      if (!result.ok) { setTagMessage(result.message); return; }
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
      {/* THE HEADER IS TWO CONTROLS, NOT ONE. "Not now" used to live inside the
          `{open && …}` block below — so parking a man cost a click to open
          talks, a session resolved on the server, and a second click, for the
          one action whose entire meaning is "I am not dealing with him yet".
          The control that lets you skip the interaction cannot be behind the
          interaction. It sits beside the toggle rather than inside it because
          a button inside a button is not a thing a browser will render. */}
      <div className="flex items-stretch">
        <button onClick={() => setOpen((v) => !v)} className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3 text-left hover:bg-raised transition-colors">
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
            {(succession || band) && (
              <div className="text-xs mt-1 flex items-center gap-1.5 flex-wrap">
                {succession && (succession.starts
                  ? (succession.other
                    ? <span className="text-muted">Starting {position} — {succession.other.name} ({succession.other.ovr}) takes the job if he goes</span>
                    : <span className="text-bad">Starting {position} — nobody behind him</span>)
                  : <span className="text-muted">Behind {succession.other.name} ({succession.other.ovr})</span>)}
                {succession && band && <span className="text-muted">·</span>}
                {band && (
                  <span className="text-muted">
                    Market {formatMoney(band.low)}–{formatMoney(band.high)}/yr
                  </span>
                )}
              </div>
            )}
          </div>
          <span className={`stat-value text-stat-sm ${ratingColor(ovr)}`}>{ovr}</span>
          <span className="pill border-line text-muted">{open ? 'Close' : 'Negotiate'}</span>
        </button>
        <div className="flex items-center gap-1 pr-4 pl-1 shrink-0">
          <ActionButton
            className="btn-ghost text-xs px-2 py-1.5 whitespace-nowrap"
            idleLabel="Not now"
            workingLabel="Setting aside…"
            onAction={() => toggleAside(true)}
          />
          {/* The sentence that used to sit beside the button in the open block.
              It has to travel with the control, because the control is what a
              GM meets first now and "not now" and "let him walk" are one word
              apart in a window where one of them is irreversible. */}
          <Tooltip text={tip('setAside')} />
        </div>
      </div>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-line/60 space-y-3">
          {/* Out to his whole file, opened on the money rather than on his
              receiving numbers — this row is a negotiation, and the card
              should arrive already talking about the same thing. */}
          <a
            href={`/league/${leagueId}/player/${playerId}?view=contract`}
            className="text-xs text-muted hover:text-accent2 inline-flex items-center gap-1"
          >
            {name}&apos;s full card and contract history ▸
          </a>
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
          {/* "Not now" USED TO BE HERE, and being here was the whole problem:
              its entire point is to let a GM skip opening talks, and it could
              only be reached by opening talks. It is on the collapsed header
              now, one press, no session resolved. It is deliberately NOT also
              duplicated here — one control, one place, and it sits nowhere near
              "Not Re-sign", which releases a player and cannot be undone. */}
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
          {/* THE BILL THE TAG DOES NOT CANCEL. Named before the press, with
              the figure, because the tag is a one-click move and this is the
              part of its price that is not the tag number. */}
          {isTrulyExpiring && canTag && (tagDeadMoney ?? 0) > 0 && (
            <p className="text-xs text-warn">
              Tagging {name} does not end his old contract&apos;s accounting. {formatMoney(tagDeadMoney!)} of signing
              bonus the club has already paid him has not finished amortising, and it lands on this year&apos;s cap as
              dead money the moment the tag is signed — on top of the tag itself. That bonus is owed either way:
              letting him walk charges the same figure.
            </p>
          )}
          {tagMessage && <p className={`text-xs ${tagMessage.startsWith('Tagged') ? 'text-accent' : 'text-bad'}`}>{tagMessage}</p>}
        </div>
      )}
    </div>
  );
}
