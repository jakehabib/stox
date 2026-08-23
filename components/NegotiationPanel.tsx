'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  decideOffer, sessionFingerprint, PERSONALITY_BLURB, PERSONALITY_LABEL,
  DEFAULT_STRUCTURE, ACCEPT_INTEREST, clampOffer, beatRival, openingBidApy,
  type DealStructure, type NegotiationOutcome, type NegotiationSession, type Offer, type Verdict,
} from '@/lib/negotiation';
import { formatMoney } from '@/lib/cap';
import { InterestMeter } from './ds/InterestMeter';
import { ActionButton } from './ds/ActionButton';
import { SigningConfirmation } from './ds/SigningConfirmation';
import { useSigningMoment } from './SigningMoment';
import { Tooltip } from './Tooltip';
import { tip } from '@/lib/glossary';

/**
 * The negotiation minigame — the one surface in this game the app owner asked
 * for by name: *"the contract negotiations for re-sign and free agency need to
 * be more of a minigame instead of them accepting everything. A live updating
 * interest meter might work"*, and then *"the salary should just be a slider
 * too"*.
 *
 * Every control is a slider AND a number field. The slider is what makes the
 * meter feel alive — it re-reads on every drag with no server round trip —
 * but a slider that steps in $100K cannot express $12.35M, and the owner
 * asked for that too: *"on the contracts, allow us to type in the numbers in
 * case the sliders aren't granular enough"*. Both controls write the same
 * state, so a typed number and a dragged one are the same offer by
 * construction; there is no second path to the meter and no second path to
 * the server. Typed values are clamped with `clampOffer`, which is the same
 * function the Server Action clamps with.
 *
 * THE SAME FUNCTION DECIDES. `decideOffer` is what draws this meter and it is
 * what the Server Action runs on submit, against a session it re-resolves
 * from the database. The client's answer is never trusted — it is computed
 * here only so the bar can move — but it can never disagree either, which is
 * the property that makes the meter worth looking at. (README design
 * principle 6: no lying metrics.)
 *
 * What the user cannot see is the number he will sign for. They get the
 * meter, his agent's mood and a list of demands, and have to work it out.
 * Patience is what stops them binary-searching the hidden number: each
 * formally submitted offer he rejects costs one, and a genuine lowball costs
 * two. Dragging sliders is free; *submitting* is not.
 *
 * AND NOW THE NUMBER CANNOT BE FOUND EXACTLY EITHER. There is a band around
 * the signing threshold where he MIGHT sign — see lib/negotiation.ts, "HE
 * MIGHT SIGN HERE" — because a threshold you can binary-search to the dollar
 * is a calculator rather than a negotiation. This panel never renders
 * `decision.accepted` inside that band: not in the button, not in the reason
 * line, not by the presence or absence of anything. The hidden draw is real
 * and the server acts on it, so showing it here would be showing the user the
 * answer to the gamble they are being asked to take.
 *
 * PATIENCE IS THE SERVER'S. This component displays it and never decides it.
 * `patienceSpent` is seeded from the session the server resolved and replaced
 * by whatever the server hands back on each submit; there is no local counter
 * and nothing is sent up. It is stored per team/player/league year; see the
 * NegotiationTalks model. That is also why LEAVING the table refunds nothing —
 * the Cancel control below closes a panel, it does not undo a negotiation, and
 * it is worded so nobody can mistake the two.
 */
export function NegotiationPanel({
  initialSession, structure = DEFAULT_STRUCTURE, structureSlot, banner,
  onOffer, onSigned, onCancel, onReset, disabled, disabledReason, title = 'Contract Talks',
  returnTo,
}: {
  /** Resolved server-side. Replaced by whatever the server hands back on every submit. */
  initialSession: NegotiationSession;
  /** Cap accounting the user controls; the player does not judge it. */
  structure?: DealStructure;
  /** Front/back-loading and void-year controls, rendered inside the panel. */
  /**
   * Rendered with the FULL length of the deal on the table — appended total on
   * an extension. A plain node could not be given that, and the void-year
   * control has to be sized off it or it offers positions the contract will
   * silently discard.
   */
  structureSlot?: (contractYears: number) => ReactNode;
  /** Rival-bid line, Market Knowledge line — whatever the screen wants above the meter. */
  banner?: ReactNode;
  /** Executes the offer. The server re-decides; this component never signs anything. */
  onOffer: (
    offer: Offer, structure: DealStructure, fingerprint: string,
  ) => Promise<NegotiationOutcome>;
  onSigned?: () => void;
  /**
   * Leave the table. The screen closes the panel; NOTHING about the
   * negotiation is undone — see the footer copy. Omit it and no Cancel
   * control is drawn.
   */
  onCancel?: () => void;
  /**
   * Put the deal shape back where it opened. The sliders in this panel reset
   * themselves; this is how the screen resets the structure it owns.
   */
  onReset?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  title?: string;
  /**
   * Where the GM came from, carried through to the signing card so the loop
   * closes instead of stranding him on the man he just signed. Passed straight
   * through — this panel never invents it, because only the screen that opened
   * the talks knows what list was being worked. See SigningConfirmation.
   */
  returnTo?: { href: string; label: string };
}) {
  const [session, setSession] = useState(initialSession);
  const { ctx, gate } = session;
  // Where the signing card is actually drawn — above the whole page, out of
  // reach of anything this panel is mounted inside. null off the league
  // layout, and then the card is drawn here instead, as it always was.
  const moment = useSigningMoment();

  // Opens a shade UNDER what he would take. Not at zero — a slider that starts
  // at the bottom reads as "make a lowball" and the first thing anyone does is
  // drag it up. But not at a yes either: opening on a number that signs him
  // is the rubber stamp this panel replaced, wearing a slider.
  //
  // The share lives in lib/negotiation.ts (`openingBidApy`) rather than here,
  // because it is a fact about the model's pricing rather than about this
  // component: the advertised estimate is now anchored so that paying it in
  // full signs him, so nine tenths of the ESTIMATE is a yes for most of the
  // league and nine tenths of his actual price is not. Both halves of that are
  // measured in the note over there.
  const openingApy = () =>
    clampStep(Math.max(gate.minSalary, Math.min(openingBidApy(ctx), gate.maxSalary)), gate.minSalary, gate.maxSalary);
  // He will not commit past his own horizon, so the panel does not open past
  // it either. The limit is stated under the control either way.
  const openingYears = () => Math.min(ctx.desiredYears, gate.maxYears, ctx.willingYears);

  const [apy, setApy] = useState(openingApy);
  const [years, setYears] = useState(openingYears);
  const [guaranteePct, setGuaranteePct] = useState(0.5);

  // Seeded from the SERVER's count, not from zero. This is the whole fix for
  // the reload exploit on the client's side of it: the panel opens already
  // knowing what previous visits burned, so a negotiation you walked out of is
  // still over when you come back to it, and the pips you see on load are the
  // pips the server will charge against. The component never increments this
  // itself — every value it ever holds came out of the database.
  const [patienceSpent, setPatienceSpent] = useState(initialSession.patienceSpent);
  // The outcome line describes the offer that was submitted, so it is cleared
  // the moment the offer stops being that one. Leaving it up next to a meter
  // reading "he'll sign this" was the same offer being described two
  // different ways at once.
  const clearStaleResult = () => setResult((r) => (r && !r.ok && !r.lostTo && !r.walkedAway ? null : r));
  const [history, setHistory] = useState<{ apy: number; years: number; outcome: string }[]>([]);
  const [result, setResult] = useState<NegotiationOutcome | null>(null);
  // When the server's answer arrived, purely so the confirmation can report
  // how long it took to paint. Nothing waits on it.
  const [answeredAt, setAnsweredAt] = useState<number | undefined>(undefined);

  /**
   * THE OFFER, forced into the legal range before anything looks at it —
   * including the meter. Not belt-and-braces over the controls: the session
   * is REPLACED by whatever the server hands back on every refusal, and a
   * fresh session can carry a smaller ceiling (cap room moved, a rival moved)
   * than the one the sliders were set against. Clamping here, with the same
   * function the Server Action clamps with, is what stops the panel deciding
   * on one offer while the server decides on another.
   */
  const offer: Offer = useMemo(
    () => clampOffer({ apy, years, guaranteePct }, gate),
    [apy, years, guaranteePct, gate],
  );
  // useMemo purely to avoid recomputing on unrelated re-renders; the call is
  // cheap enough that correctness never depends on it.
  const decision = useMemo(
    () => decideOffer(ctx, offer, gate, structure),
    [ctx, gate, offer, structure],
  );
  const ev = decision.evaluation;

  const signed = result?.ok === true;
  const gone = !!result?.lostTo;
  const walkedAway = patienceSpent >= ctx.patience || !!result?.walkedAway;
  const over = signed || gone || walkedAway || !!disabled;
  const canSubmit = !over && decision.blocked === null;

  /**
   * Talks are finished and he did NOT sign — he walked, or somebody else got
   * him. The meter must stop describing the sliders at this point.
   *
   * This became reachable the moment patience started surviving a reload: open
   * the panel on a negotiation you had already burned out and `decideOffer`
   * happily drew "Will sign — 85" for whatever the sliders defaulted to, three
   * inches above a dead button reading "Talks are over". Both sentences on
   * screen, describing the same instant, disagreeing. The bar is answering
   * "would he sign this offer", and the true answer once his agent has stopped
   * taking calls is no — so it reads zero, and the line under it says why
   * rather than quoting a deal nobody is going to sign. (README, design
   * principle 6.) `disabled` is deliberately not included: that is a screen
   * saying "not here, not now", not the player ending the negotiation.
   */
  const talksDead = gone || walkedAway;

  const submit = async () => {
    const res = await onOffer(offer, structure, sessionFingerprint(session));
    const answered = performance.now();
    setAnsweredAt(answered);
    setResult(res);
    setSession(res.session);
    setPatienceSpent(res.patienceSpent);
    // HE SIGNED, SO THE CARD LEAVES THIS COMPONENT.
    //
    // Every state call above may already be landing on a component that is on
    // its way out: a signed player is no longer in the re-sign list and no
    // longer a free agent, so the row or the page section this panel sits in
    // can be gone before the user has read a word of what was agreed. That is
    // measured, not theoretical — `ActionButton` documents 746ms from action
    // to unmount on one league.
    //
    // `show` belongs to SigningMomentProvider in the league layout, which
    // nothing on the page can unmount, so handing the deal over here is what
    // makes the confirmation outlive the event it confirms. What the screen
    // still has to do once the card is gone travels with it as `onDismiss`;
    // a screen whose Server Action already revalidated passes nothing.
    //
    // NOTE WHAT IS STILL NOT HERE: calling `onSigned()` now. On the re-sign
    // list that collapses the row and on the extension form it closes the
    // form, either of which would take the card with it in this frame.
    if (res.ok) {
      // `signed` is typed optional and is present exactly when `ok`; the guard
      // is so a missing deal produces no card rather than an empty one.
      if (res.signed) moment?.show({ deal: res.signed, answeredAt: answered, onDismiss: onSigned, returnTo });
      return 'Signed';
    }
    setHistory((h) => [...h, {
      apy: offer.apy, years: offer.years,
      outcome: res.lostTo ? `lost to ${res.lostTo.teamName}` : res.decision.evaluation.verdict.toLowerCase(),
    }]);
    // A refusal is not an achievement and must not be dressed as one — the
    // done beat is suppressed and the message below carries the answer.
    return false as const;
  };

  /**
   * Put the terms back where they opened. Sliders and typed fields alike —
   * they are the same state — plus whatever deal shape the screen owns.
   *
   * It resets TERMS and says so. It does not, and must not be read to, undo
   * anything he has already heard: patience spent stays spent, and the
   * sentence under the buttons states that in plain words. A control that
   * implied otherwise would be the page-reload exploit wearing a friendlier
   * label.
   */
  const resetTerms = () => {
    clearStaleResult();
    setApy(openingApy());
    setYears(openingYears());
    setGuaranteePct(0.5);
    onReset?.();
  };

  // A DEAL WITH A MAN STILL UNDER CONTRACT APPENDS. The controls therefore
  // mean something different and are labelled differently: the salary is the
  // NEW money, the term is how many years are being ADDED, and the contract
  // that results is longer than either. Saying "years: 4" over a deal that
  // will run seven is the easiest lying metric in this flow to ship.
  //
  // THE SAME TEST `decideOffer` USES, and it has to be: that is where every
  // figure on this screen comes from, and the two disagreeing about whether
  // this offer appends would put a year-1 cap hit on the panel that the
  // signing does not produce. It used to read `ctx.mode === 'EXTENSION'`,
  // which was true of the only screen that appended at the time; a walk-year
  // re-sign appends now too (see extendContract in lib/freeagency.ts), so a
  // user re-signing him is told he is adding years on top of the season he is
  // owed, because that is what is happening.
  const appending = ctx.currentContract !== null && ctx.controlYears > 0;
  const totalTerm = decision.contractYears;

  const capOn = gate.capMode !== 'OFF';
  const spaceAfter = gate.capSpace - decision.year1CapHit;
  const signedDeal = result?.ok ? result.signed : undefined;
  // The "he might sign" stretch sits BELOW the certain-yes line now, not
  // symmetrically around it, so that buying certainty costs real money — see
  // signBandFor. Both edges come from the shared constants; a second copy of
  // either here is how the meter and the decision drift apart.
  const bandLo = ACCEPT_INTEREST - ctx.bandHalfWidth;
  const bandHi = ACCEPT_INTEREST;

  // WHAT THE METER IS ALLOWED TO SAY. Inside the band the raw verdict would
  // read "Will sign" for anything the server might still refuse, which is
  // precisely the certainty the band exists to remove.
  const shownVerdict: Verdict = talksDead
    ? 'COLD'
    : decision.signBand === 'YES' ? 'ACCEPT'
    : decision.signBand === 'MAYBE' ? 'MAYBE'
    // LOSING is not a shade of the player's opinion — it is what happens. The
    // meter used to read "Will sign" over a red rival banner because the two
    // were computed by different code (lib/negotiation.ts, THE CONTEST); the
    // band carries the contest now, so there is one answer and this line
    // cannot disagree with the sentence underneath it.
    : decision.signBand === 'LOSING' ? 'OUTBID'
    // A blocked deal is refused whatever he thinks of it, so the meter says
    // COLD rather than drawing a green ACCEPT over a dead button.
    : decision.signBand === 'BLOCKED' ? 'COLD'
    : ev.verdict;

  const shownHeadline = gone && result?.lostTo
    ? `He signed with the ${result.lostTo.teamName}.`
    : walkedAway ? 'His agent is no longer taking your calls.'
    : decision.signBand === 'LOSING' && gate.rival
      ? `He would take the ${gate.rival.teamName} deal over this one.`
    : decision.signBand === 'MAYBE' ? 'He might sign here. His agent is not saying.'
    // A blocked deal gets a headline that names the blocker, not his mood —
    // it used to read "he will sign this" over a dead button. Short on
    // purpose: the sentence underneath carries the numbers and the way out,
    // and repeating it here would just be the same words twice.
    : decision.blocked === 'CAP' ? "Your cap won't take this deal."
    : decision.blocked === 'FLOOR' ? 'That is under the league minimum.'
    : decision.blocked === 'TERM' ? "That term isn't legal."
    : decision.blocked === 'WILLING' ? "He won't commit for that long."
    : ev.headline;

  // WHAT WOULD BEAT THEM, in each dimension separately — the package route the
  // app owner asked for: *"you can overcome that score with more guaranteed
  // money/years/salary. so it's not just raw salary"*. Memoised because it
  // costs roughly a hundred evaluations and the offer moves on every drag.
  const beat = useMemo(
    () => (decision.signBand === 'LOSING' && !over ? beatRival(ctx, offer, gate) : null),
    [ctx, gate, offer, decision.signBand, over],
  );

  // The term he will not go past, stated beside the control that sets it
  // rather than sprung on somebody who has already chosen one.
  // On an extension the control adds years to a deal he already has, so what
  // he has left to give is his horizon MINUS the years already on the books —
  // comparing his total horizon against the add-on ceiling would state the
  // limit wrongly on exactly the screen where it binds soonest.
  //
  // NOT `appending`. This line has to say what `decideOffer` will actually
  // refuse, and the test there is `committedTerm`, which counts the years he
  // is already owed only on an EXTENSION — a walk-year re-sign is still
  // priced as a walk-year re-sign, weighing the years offered and no others.
  // Written off `appending` this would quietly dock him a year he has not
  // refused.
  const termCountsOwedYears = ctx.mode === 'EXTENSION' && ctx.controlYears > 0;
  const yearsHeCanStillAdd = termCountsOwedYears ? Math.max(0, ctx.willingYears - ctx.controlYears) : ctx.willingYears;
  const termCapped = yearsHeCanStillAdd < gate.maxYears;
  const willingLine = ctx.willingYears <= 1
    ? `At ${ctx.age} he will only go year to year — he does not intend to play past ${ctx.intendedFinalAge}.`
    : termCountsOwedYears
      ? `He does not intend to play past ${ctx.intendedFinalAge}. With ${ctx.controlYears} years already on his deal, ${yearsHeCanStillAdd} more is all he will add — at any price.`
      : `He does not intend to play past ${ctx.intendedFinalAge}, so ${ctx.willingYears} years is the longest deal he will sign — at any price.`;

  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-line/70 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="label-sm">{title}</div>
          <div className="text-sm mt-0.5">
            <span className="font-semibold">{PERSONALITY_LABEL[ctx.personality]}</span>
            <span className="text-muted"> · {ctx.position} · age {ctx.age}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="label-sm inline-flex items-center gap-1.5 justify-end">
            Patience
            {/* Top-right corner of a `panel overflow-hidden`: downward AND
                right-aligned, or the bubble opens out of two edges at once. */}
            <Tooltip placement="bottom" align="end" text={tip('patience')} />
          </div>
          <div className="flex items-center gap-1 mt-1 justify-end">
            {Array.from({ length: ctx.patience }).map((_, i) => (
              <span key={i} className={`pip-well w-2 h-2 ${i < ctx.patience - patienceSpent ? '' : 'pip-spent'}`}>
                <span className="pip-fill" />
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-line/60">
        <p className="text-xs text-muted">{PERSONALITY_BLURB[ctx.personality]}</p>
      </div>

      {/* IT IS SIGNED. Everything that was a decision is now a fact, so the
          controls go and the record stays — see SigningConfirmation.
          Drawn here ONLY where there is no provider to raise it to. Under the
          league layout there always is, and the card is a dialog above the
          page instead: this panel is frequently unmounted by the signing
          itself, and a record of an event cannot be stored inside the thing
          the event destroys. See SigningMomentProvider. */}
      {signedDeal && !moment ? (
        <div className="px-4 py-4">
          <SigningConfirmation
            deal={signedDeal}
            answeredAt={answeredAt}
            onDismiss={() => onSigned?.()}
            returnTo={returnTo}
          />
        </div>
      ) : (
      <>
      {banner && <div className="px-4 pt-3 space-y-2">{banner}</div>}

      <div className="px-4 py-4 space-y-4">
        <InterestMeter
          interest={talksDead ? 0 : ev.interest}
          verdict={shownVerdict}
          headline={shownHeadline}
          maybeBand={talksDead ? null : { lo: bandLo, hi: bandHi }}
          // The rival on the same track, at the number the same evaluation
          // gave their package. This is the mark to clear, and it moves for
          // salary, term and guarantee alike.
          rival={talksDead || decision.rivalInterest === null || !gate.rival
            ? null
            : { interest: decision.rivalInterest, label: gate.rival.teamName.split(' ').pop() ?? 'Rival' }}
        />

        <div className="space-y-4">
          <Control
            label={appending ? 'New money' : 'Salary'}
            tipText={appending ? tip('newMoney') : tip('apy')}
            display={`${formatMoney(offer.apy)}/yr`}
            /* His number, and — for a man who has been sitting on the wire —
               the number he started at. The second half only appears when he
               has actually come down, so nothing changes for a player under
               contract or one who has just been released. */
            hint={
              appending
                ? `On the ${offer.years} new year${offer.years === 1 ? '' : 's'} — market estimate ${formatMoney(ctx.marketApy)}/yr`
                : ctx.openMarketApy > ctx.marketApy
                  ? `Asking ${formatMoney(ctx.marketApy)}/yr, down from ${formatMoney(ctx.openMarketApy)}`
                  : `Market estimate ${formatMoney(ctx.marketApy)}/yr`
            }
            min={gate.minSalary}
            max={gate.maxSalary}
            step={100_000}
            value={offer.apy}
            onChange={(v) => { clearStaleResult(); setApy(v); }}
            disabled={over}
            field={MILLIONS_FIELD}
            warn={decision.blocked === 'CAP' ? `Over your room by ${formatMoney(decision.year1CapHit - gate.capSpace)}` : undefined}
          />
          {/* ==================================================================
              WHAT WOULD BEAT THEM — a package, not a salary.
              ==================================================================
              This used to be one chip that put `competingApy * 1.03` in the
              salary box, because salary was the only thing the old comparison
              looked at. The app owner's note is the design: *"you can overcome
              that score with more guaranteed money/years/salary. so it's not
              just raw salary"*.

              So there is a chip per dimension, each of them the CHEAPEST move
              in that dimension alone that both wins the contest and closes him
              outright — see `beatRival`. A dimension that cannot do it on its
              own gets no chip rather than a chip that would not work, which is
              itself information: if only salary is offered, guaranteed money
              genuinely will not get there for this man.

              The cheapest one is marked, and cheapest is measured in cash
              committed — which is why guaranteed money usually wins it and why
              the note underneath says what that actually costs you. A chip
              that read "free" over a move that quietly triples your dead money
              would be the same class of half-truth this whole pass removes. */}
          {beat && !over && (
            <div className="space-y-1.5">
              <div className="label-sm text-[10px] text-bad">
                {gate.rival ? `Beating ${gate.rival.teamName}` : 'Beating their offer'} — any one of these closes it
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {beat.apy !== null && (
                  <button
                    type="button"
                    onClick={() => { clearStaleResult(); setApy(beat.apy!); }}
                    className={`pill hover:bg-bad/10 ${beat.cheapest === 'APY' ? 'border-bad text-bad' : 'border-line text-muted'}`}
                  >
                    Salary → {formatMoney(beat.apy)}/yr
                  </button>
                )}
                {beat.guaranteePct !== null && (
                  <button
                    type="button"
                    onClick={() => { clearStaleResult(); setGuaranteePct(beat.guaranteePct!); }}
                    className={`pill hover:bg-bad/10 ${beat.cheapest === 'GUARANTEE' ? 'border-bad text-bad' : 'border-line text-muted'}`}
                  >
                    Guarantee → {Math.round(beat.guaranteePct * 100)}%
                  </button>
                )}
                {beat.years !== null && (
                  <button
                    type="button"
                    onClick={() => { clearStaleResult(); setYears(beat.years!); }}
                    className={`pill hover:bg-bad/10 ${beat.cheapest === 'YEARS' ? 'border-bad text-bad' : 'border-line text-muted'}`}
                  >
                    Term → {beat.years} year{beat.years === 1 ? '' : 's'}
                  </button>
                )}
              </div>
              {beat.apy === null && beat.guaranteePct === null && beat.years === null ? (
                <p className="text-[11px] text-muted">
                  Nothing you can move on its own gets there. It will take more than one of them together.
                </p>
              ) : beat.cheapest === 'GUARANTEE' ? (
                <p className="text-[11px] text-muted">
                  Guaranteeing more commits no extra cash — it becomes signing bonus, which prorates, so it is
                  dead money if you ever cut him. Cheapest today, not free later.
                </p>
              ) : null}
            </div>
          )}
          <Control
            label={appending ? 'Years added' : 'Years'}
            display={appending
              ? `+${offer.years} → ${totalTerm} yrs`
              : `${offer.years} year${offer.years === 1 ? '' : 's'}`}
            hint={
              appending
                ? `${formatMoney(decision.newMoneyValue)} of new money on top of the ${ctx.controlYears === 1 ? 'season' : `${ctx.controlYears} years`} he is already owed — ${totalTerm} years in all`
                : `Total ${formatMoney(decision.totalValue)}`
            }
            min={1}
            max={gate.maxYears}
            step={1}
            value={offer.years}
            onChange={(v) => { clearStaleResult(); setYears(v); }}
            disabled={over || gate.maxYears <= 1}
            field={INTEGER_FIELD}
            warn={decision.blocked === 'WILLING' ? `He will not sign for ${offer.years}` : undefined}
          />
          {termCapped && (
            <p className={`text-xs -mt-2.5 ${decision.blocked === 'WILLING' ? 'text-bad' : 'text-muted'}`}>
              {willingLine}
            </p>
          )}
          <Control
            label="Guaranteed"
            tipText={tip('guaranteedMoney')}
            display={`${Math.round(offer.guaranteePct * 100)}%`}
            hint={`${formatMoney(decision.guaranteedMoney)} locked in`}
            min={0}
            max={100}
            step={5}
            value={Math.round(offer.guaranteePct * 100)}
            onChange={(v) => { clearStaleResult(); setGuaranteePct(v / 100); }}
            disabled={over}
            field={PERCENT_FIELD}
            warn={capOn && decision.deadMoneyIfCut > 0 ? `${formatMoney(decision.deadMoneyIfCut)} dead if you cut him` : undefined}
          />
          {/* HE HAS A FLOOR, and it is stated beside the control that sets it
              rather than discovered by a refusal — the same rule the term limit
              follows. Deliberately NOT the exact percentage: unlike the term
              limit this one is a price you can pay, and printing the figure
              would turn "how little can I lock in" into arithmetic instead of a
              thing the meter tells you when you cross it. What is stated is
              that the limit exists, which is what stops it being a gotcha. */}
          {ctx.guaranteeFloor > 0 && !over && (
            <p className={`text-xs -mt-2.5 inline-flex items-start gap-1.5 ${ev.underGuaranteed ? 'text-bad' : 'text-muted'}`}>
              <Tooltip className="mt-0.5" align="start" text={tip('guaranteeFloor')} />
              {ev.underGuaranteed
                ? `A man of his standing does not sign for this little locked in. No salary fixes it — guarantee more of it.`
                : `A player of his standing expects a real share of it guaranteed, and this clears that.`}
            </p>
          )}
        </div>

        {structureSlot?.(totalTerm)}

        {ev.demands.length > 0 && !over && (
          <ul className="space-y-1">
            {ev.demands.map((d) => (
              <li key={d} className="text-xs text-muted flex gap-2">
                <span className="text-warn shrink-0">▸</span>{d}
              </li>
            ))}
          </ul>
        )}

        {/* The ledger. Same figures the old offer form showed, in the same
            shape — but read off the SAME decision object that drew the meter,
            so the cap number the panel refuses on is the cap number on
            screen. */}
        <div className="panel p-3 space-y-1.5 text-sm">
          {appending && (
            <div className="flex justify-between">
              <span className="text-muted">New money — {offer.years} yr{offer.years === 1 ? '' : 's'}, what he is agreeing to</span>
              <span className="stat-value text-stat-sm">{formatMoney(decision.newMoneyValue)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted">{appending ? `Full contract — ${totalTerm} yrs, old years included` : 'Total value'}</span>
            <span className="font-mono">{formatMoney(decision.totalValue)}</span>
          </div>
          <div className="flex justify-between"><span className="text-muted">Guaranteed</span><span className="font-mono">{formatMoney(decision.guaranteedMoney)}</span></div>
          {capOn && (
            <>
              <div className="flex justify-between"><span className="text-muted">Dead money if cut</span><span className="font-mono">{formatMoney(decision.deadMoneyIfCut)}</span></div>
              <div className="flex justify-between pt-2 border-t border-line/60">
                <span className="text-muted">Cap space after</span>
                <span className={`stat-value text-stat-sm ${spaceAfter < 0 ? 'text-bad' : 'text-accent'}`}>{formatMoney(spaceAfter)}</span>
              </div>
              <div>
                <div className="text-xs text-muted mb-1">
                  {appending ? 'Cap hit by year — the whole contract, old years and new' : 'Cap hit by year'}
                </div>
                <div className="flex flex-wrap gap-2">
                  {decision.capHitSchedule.map((hit, i) => (
                    <div
                      key={i}
                      className={`pill ${
                        i === 0 && decision.blocked === 'CAP' ? 'border-bad/40 text-bad'
                          : appending && i >= ctx.controlYears ? 'border-accent2/50 text-accent2'
                          : 'border-line text-chalk'
                      }`}
                      title={appending ? (i >= ctx.controlYears ? 'A year you are adding' : 'A year he was already owed') : undefined}
                    >
                      Yr{i + 1}: {formatMoney(hit)}
                    </div>
                  ))}
                </div>
                {appending && (
                  <p className="text-[11px] text-muted mt-1">
                    {ctx.controlYears === 1
                      ? 'The first is the season he was already owed, at the salary he was already promised'
                      : `The first ${ctx.controlYears} are the years he was already owed, at the salaries he was already promised`}
                    ; the highlighted ones are what you are adding.
                  </p>
                )}
                {/* NOT a pill in the row above. It used to sit alongside
                    "Yr1…Yr4" reading "Void: $5.16M", which parses as a fifth
                    year of the contract — the one misreading that costs
                    somebody a cap sheet. It is dead money landing after the
                    deal, and it is drawn as its own line saying exactly
                    that. */}
                {decision.strandedVoidMoney > 0 && (
                  <div className="mt-2 flex items-baseline justify-between gap-3 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1.5">
                    <span className="text-xs text-warn">
                      After the deal ends — void-year dead money, no season attached
                    </span>
                    <span className="stat-value text-stat-sm text-warn">{formatMoney(decision.strandedVoidMoney)}</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {history.length > 0 && (
          <div className="text-[11px] text-muted border-t border-line/50 pt-2.5">
            <span className="label-sm text-[10px]">Offers made</span>
            <div className="mt-1 space-y-0.5">
              {history.map((h, i) => (
                <div key={i} className="font-mono">
                  {formatMoney(h.apy)}/yr × {h.years}yr — {h.outcome}
                </div>
              ))}
            </div>
          </div>
        )}

        {walkedAway && !signed && !gone && (
          <p className="text-sm text-bad">
            His agent has stopped returning calls. {ctx.incumbent ? 'He will test the market.' : 'He is signing somewhere else.'}
          </p>
        )}
        {result && <p className={`text-sm ${result.ok ? 'text-accent' : result.lostTo ? 'text-bad' : 'text-accent2'}`}>{result.message}</p>}
        {/* Shown whenever there is a block, whatever the band. It used to be
            hidden on a YES, which is exactly the case where the meter and the
            button contradicted each other and nothing on screen explained
            why. */}
        {!result && decision.reason && (decision.blocked !== null || decision.signBand !== 'YES') && (
          <p className={`text-xs ${decision.blocked || decision.outbid ? 'text-bad' : 'text-muted'}`}>{decision.reason}</p>
        )}
        {disabled && disabledReason && <p className="text-sm text-muted">{disabledReason}</p>}

        <ActionButton
          /* A blocked deal's button is not an invitation. It used to keep the
             primary green while reading "Not enough cap room", which is the
             shape of a button you are meant to press. */
          className={`w-full ${decision.blocked ? 'btn-secondary' : decision.outbid ? 'btn-danger' : 'btn-primary'}`}
          disabled={!canSubmit}
          idleLabel={
            signed ? 'Signed'
              : gone ? 'He signed elsewhere'
              : walkedAway ? 'Talks are over'
              : decision.blocked === 'CAP' ? 'Not enough cap room'
              : decision.blocked === 'WILLING' ? `He will not sign for ${offer.years} years`
              : decision.blocked ? 'Cannot offer this'
              : decision.signBand === 'YES' ? 'Offer this deal — he signs'
              : decision.outbid ? `Offer anyway — he prefers the ${gate.rival?.teamName ?? 'rival'} package, costs ${decision.maxPatienceCost} patience`
              // Inside the band the price is stated as what a REFUSAL costs,
              // not as what this offer costs. The real figure is 0 or 1
              // according to the hidden draw, and printing it would put the
              // answer on the button.
              : decision.signBand === 'MAYBE' ? `Offer this deal — he might take it, ${decision.maxPatienceCost} patience if he does not`
              : `Offer this deal — costs ${decision.maxPatienceCost} patience`
          }
          workingLabel="On the phone…"
          doneLabel="Signed"
          onAction={submit}
        />

        {(onCancel || onReset !== undefined) && (
          <div className="border-t border-line/50 pt-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              {!over && (
                <button type="button" onClick={resetTerms} className="btn-secondary text-sm">
                  Reset terms
                </button>
              )}
              {onCancel && (
                <button type="button" onClick={onCancel} className="btn-ghost text-sm">
                  Leave the table
                </button>
              )}
            </div>
            <p className="text-xs text-muted">
              <span className="text-chalk">Reset terms</span> puts the sliders back where they opened.{' '}
              <span className="text-chalk">Leave the table</span> closes talks and you can come back to him.
              Neither undoes an offer: patience you have spent is spent, he remembers what he has already
              been offered, and the same money will not get a different answer out of him.
            </p>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}

function clampStep(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(v / 100_000) * 100_000));
}

/**
 * How a typed string becomes a number, per control.
 *
 * `parse` returns null for anything it cannot read — empty, a lone minus
 * sign, letters — and null means "leave the offer alone", so garbage in the
 * box never becomes garbage in the state. Anything it CAN read is then
 * clamped into the control's own range before it is committed, which is the
 * same range the slider can reach and the same one `clampOffer` enforces on
 * the way into the Server Action. There is no value a keyboard can produce
 * that the meter is not describing.
 */
interface NumberField {
  prefix?: string;
  suffix?: string;
  /** Width of the box, in ch, so a salary field is not the size of a percentage. */
  width: string;
  inputMode: 'numeric' | 'decimal';
  format: (v: number) => string;
  parse: (text: string) => number | null;
}

/**
 * Salary, typed in MILLIONS — which is how anybody discussing a contract says
 * it and, crucially, is unambiguous: the box is prefixed "$" and suffixed "M",
 * so "12.35" can only mean $12.35M. Typing dollars into a field labelled M was
 * the alternative and it is a trap for exactly the number the owner asked to
 * be able to enter. A "k" suffix is accepted for the minimum-salary end of the
 * range. Rounded to the nearest $1,000, which three decimals can represent
 * exactly, so the box always reads back what it committed.
 */
const MILLIONS_FIELD: NumberField = {
  prefix: '$', suffix: 'M', width: '6ch', inputMode: 'decimal',
  format: (v) => {
    const s = (v / 1_000_000).toFixed(3);
    return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  },
  parse: (text) => {
    const cleaned = text.replace(/[$,\s]/g, '');
    const m = /^(\d*\.?\d*)([mMkK]?)$/.exec(cleaned);
    if (!m || m[1] === '' || m[1] === '.') return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return null;
    const dollars = m[2].toLowerCase() === 'k' ? n * 1_000 : n * 1_000_000;
    return Math.round(dollars / 1_000) * 1_000;
  },
};

const INTEGER_FIELD: NumberField = {
  width: '3ch', inputMode: 'numeric',
  format: (v) => String(v),
  parse: (text) => {
    const cleaned = text.replace(/\s/g, '');
    if (!/^\d+$/.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  },
};

const PERCENT_FIELD: NumberField = { ...INTEGER_FIELD, suffix: '%', width: '3ch' };

/**
 * One term of the deal: a slider to feel it and a box to say it exactly.
 *
 * Both write the same piece of state — there is no separate "typed offer" —
 * so a number reached by dragging and the same number reached by typing are
 * the same object by the time anything looks at it. That is not a tidiness
 * argument: if typing produced a different verdict from dragging to the same
 * figure, the meter would be lying about one of them.
 */
function Control({ label, display, hint, min, max, step, value, onChange, disabled, warn, field, tipText }: {
  label: string; display: string; hint?: string;
  min: number; max: number; step: number; value: number;
  onChange: (v: number) => void; disabled?: boolean; warn?: string;
  field: NumberField;
  /** Glossary text for what this slider is actually setting. */
  tipText?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="label-sm inline-flex items-center gap-1.5">
          {label}
          {/* Left-aligned: these labels sit against the panel's left padding,
              and a centred 18rem bubble hangs out past the card edge. */}
          {tipText && <Tooltip align="start" text={tipText} />}
        </span>
        <span className="stat-value text-stat-md">{display}</span>
      </div>
      <input
        type="range"
        className="slider mt-2"
        min={min} max={max} step={step} value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
      <div className="flex items-center justify-between gap-3 mt-2 flex-wrap">
        <NumberEntry
          label={label} field={field} value={value} min={min} max={max}
          disabled={disabled} onCommit={onChange}
        />
        <div className="text-right">
          {hint && <div className="text-xs text-muted">{hint}</div>}
          {warn && <div className="text-xs text-bad">{warn}</div>}
        </div>
      </div>
    </div>
  );
}

function NumberEntry({ label, field, value, min, max, disabled, onCommit }: {
  label: string; field: NumberField; value: number; min: number; max: number;
  disabled?: boolean; onCommit: (v: number) => void;
}) {
  // What the user is in the middle of typing, which is NOT the offer. The
  // offer only ever moves to a parsed, clamped number; the draft exists so a
  // half-typed "1" on the way to "12.35" is not fought by the formatter or
  // snapped up to the league minimum under the cursor. Dropped on blur, when
  // the box goes back to showing the committed figure.
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <div className={`inline-flex items-center gap-1 rounded-md border border-line bg-raised px-2 py-1 ${disabled ? 'opacity-40' : 'focus-within:border-accent2/60'}`}>
      {field.prefix && <span className="text-muted text-sm">{field.prefix}</span>}
      <input
        type="text"
        inputMode={field.inputMode}
        className="bg-transparent text-chalk text-sm font-mono outline-none tabular-nums"
        style={{ width: field.width }}
        value={draft ?? field.format(value)}
        disabled={disabled}
        aria-label={`${label} — type an exact value`}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setDraft(e.target.value);
          const parsed = field.parse(e.target.value);
          if (parsed === null) return;
          onCommit(Math.min(max, Math.max(min, parsed)));
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => { if (e.key === 'Enter') { setDraft(null); e.currentTarget.blur(); } }}
      />
      {field.suffix && <span className="text-muted text-sm">{field.suffix}</span>}
    </div>
  );
}
