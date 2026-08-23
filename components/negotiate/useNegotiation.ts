'use client';

import { useMemo, useState } from 'react';
import {
  ACCEPT_INTEREST, beatRival, clampOffer, decideOffer, openingBidApy, sessionFingerprint,
  type BeatPlan, type DealStructure, type NegotiationOutcome, type NegotiationSession,
  type Offer, type OfferDecision, type Verdict,
} from '@/lib/negotiation';
import { useSigningMoment } from '../SigningMoment';

/**
 * ===========================================================================
 * THE NEGOTIATION, WITHOUT A LAYOUT ATTACHED
 * ===========================================================================
 * Three mockups of the contract table share this file, and that is the whole
 * reason it exists. Each direction draws the negotiation differently; none of
 * them is allowed to DECIDE it differently, because the rules about what a
 * meter may say are not styling — they are the difference between a meter
 * worth looking at and a lying one.
 *
 * Everything below is the live panel's own reasoning, lifted whole from
 * components/NegotiationPanel.tsx and left alone:
 *
 *   THE SAME FUNCTION DECIDES. `decideOffer` draws the bar here and runs
 *   again in the Server Action against a session re-resolved from the
 *   database. The client's answer is never trusted; it simply cannot
 *   disagree.
 *   THE OFFER IS CLAMPED with `clampOffer`, the same function the Server
 *   Action clamps with, before anything — including the meter — looks at it.
 *   INSIDE THE BAND, `decision.accepted` IS NEVER EXPOSED. Not in a label,
 *   not in a colour, not by the presence or absence of anything. The hidden
 *   draw is the gamble; showing it would be showing the answer.
 *   PATIENCE IS THE SERVER'S. Seeded from the session, replaced by whatever
 *   comes back on submit, never counted here.
 *
 * A direction that wanted to say something else about an offer would have to
 * come through this file to do it, which is the point.
 * ===========================================================================
 */
export interface NegotiationView {
  session: NegotiationSession;
  offer: Offer;
  decision: OfferDecision;
  /** Live setters. Every one of them clears a stale result line first. */
  setApy: (v: number) => void;
  setYears: (v: number) => void;
  setGuaranteePct: (v: number) => void;
  resetTerms: () => void;
  submit: () => Promise<string | false>;
  /** Pips burned, as the server counts them. */
  patienceSpent: number;
  /** Offers actually put on the table, in the order they were made. */
  history: { apy: number; years: number; guaranteePct: number; outcome: string; message: string }[];
  result: NegotiationOutcome | null;
  signed: boolean;
  gone: boolean;
  walkedAway: boolean;
  /** He signed, he walked, somebody else got him, or the screen is closed. */
  over: boolean;
  /** Talks are finished and he did NOT sign — the meter must stop describing sliders. */
  talksDead: boolean;
  canSubmit: boolean;
  /** What the meter is ALLOWED to say, which is not always the raw verdict. */
  shownVerdict: Verdict;
  shownHeadline: string;
  /** The "he might sign" stretch, in interest points. Null once talks are dead. */
  band: { lo: number; hi: number } | null;
  /** The rival's package on the same scale, or null when nobody is bidding. */
  rivalMark: { interest: number; label: string } | null;
  /** The cheapest single move in each dimension that wins the auction outright. */
  beat: BeatPlan | null;
  /** This deal appends to one he is already on, so the controls mean new money. */
  appending: boolean;
  /** Length of the contract that results — old years included. */
  totalTerm: number;
  capOn: boolean;
  /** Room left after year one of this deal. */
  spaceAfter: number;
  /** The label under the term control: what he will not go past, and why. */
  willingLine: string;
  termCapped: boolean;
  /** What the button says, and what it costs. */
  buttonLabel: string;
  /**
   * The deal as it was actually written, read back off the contract row —
   * present only where there is no SigningMomentProvider above the page to
   * raise the card into. Under the league layout there always is.
   */
  signedDeal: NegotiationOutcome['signed'];
  answeredAt: number | undefined;
  /** Null off the league layout, and then the card is drawn in place instead. */
  hasMoment: boolean;
}

export function useNegotiation({ initialSession, structure, onOffer, onSigned, onReset, disabled, returnTo }: {
  initialSession: NegotiationSession;
  structure: DealStructure;
  onOffer: (offer: Offer, structure: DealStructure, fingerprint: string) => Promise<NegotiationOutcome>;
  onSigned?: () => void;
  onReset?: () => void;
  disabled?: boolean;
  returnTo?: { href: string; label: string };
}): NegotiationView {
  const [session, setSession] = useState(initialSession);
  const { ctx, gate } = session;
  const moment = useSigningMoment();

  // Opens a shade UNDER what he would take — `openingBidApy` is a fact about
  // the model's pricing, not about any one screen, so all three directions
  // open on the same number the live panel opens on.
  const openingApy = () =>
    clampStep(Math.max(gate.minSalary, Math.min(openingBidApy(ctx), gate.maxSalary)), gate.minSalary, gate.maxSalary);
  const openingYears = () => Math.min(ctx.desiredYears, gate.maxYears, ctx.willingYears);

  const [apy, setApyRaw] = useState(openingApy);
  const [years, setYearsRaw] = useState(openingYears);
  const [guaranteePct, setGuaranteeRaw] = useState(0.5);
  const [patienceSpent, setPatienceSpent] = useState(initialSession.patienceSpent);
  const [history, setHistory] = useState<{ apy: number; years: number; guaranteePct: number; outcome: string; message: string }[]>([]);
  const [result, setResult] = useState<NegotiationOutcome | null>(null);
  const [answeredAt, setAnsweredAt] = useState<number | undefined>(undefined);

  // The outcome line describes the offer that was submitted, so it goes the
  // moment the offer stops being that one.
  const clearStale = () => setResult((r) => (r && !r.ok && !r.lostTo && !r.walkedAway ? null : r));
  const setApy = (v: number) => { clearStale(); setApyRaw(v); };
  const setYears = (v: number) => { clearStale(); setYearsRaw(v); };
  const setGuaranteePct = (v: number) => { clearStale(); setGuaranteeRaw(v); };

  const offer: Offer = useMemo(
    () => clampOffer({ apy, years, guaranteePct }, gate),
    [apy, years, guaranteePct, gate],
  );
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
  const talksDead = gone || walkedAway;

  const submit = async (): Promise<string | false> => {
    const res = await onOffer(offer, structure, sessionFingerprint(session));
    const answered = performance.now();
    setAnsweredAt(answered);
    setResult(res);
    setSession(res.session);
    setPatienceSpent(res.patienceSpent);
    if (res.ok) {
      if (res.signed) moment?.show({ deal: res.signed, answeredAt: answered, onDismiss: onSigned, returnTo });
      return 'Signed';
    }
    setHistory((h) => [...h, {
      apy: offer.apy, years: offer.years, guaranteePct: offer.guaranteePct,
      outcome: res.lostTo ? `lost to ${res.lostTo.teamName}` : res.decision.evaluation.verdict.toLowerCase(),
      // The SERVER's words for what happened, not a second sentence written
      // here from the same decision.
      message: res.message,
    }]);
    return false;
  };

  const resetTerms = () => {
    clearStale();
    setApyRaw(openingApy());
    setYearsRaw(openingYears());
    setGuaranteeRaw(0.5);
    onReset?.();
  };

  const appending = ctx.currentContract !== null && ctx.controlYears > 0;
  const totalTerm = decision.contractYears;
  const capOn = gate.capMode !== 'OFF';
  const spaceAfter = gate.capSpace - decision.year1CapHit;

  const shownVerdict: Verdict = talksDead
    ? 'COLD'
    : decision.signBand === 'YES' ? 'ACCEPT'
    : decision.signBand === 'MAYBE' ? 'MAYBE'
    : decision.signBand === 'LOSING' ? 'OUTBID'
    : decision.signBand === 'BLOCKED' ? 'COLD'
    : ev.verdict;

  const shownHeadline = gone && result?.lostTo
    ? `He signed with the ${result.lostTo.teamName}.`
    : walkedAway ? 'His agent is no longer taking your calls.'
    : decision.signBand === 'LOSING' && gate.rival
      ? `He would take the ${gate.rival.teamName} deal over this one.`
    : decision.signBand === 'MAYBE' ? 'He might sign here. His agent is not saying.'
    : decision.blocked === 'CAP' ? "Your cap won't take this deal."
    : decision.blocked === 'FLOOR' ? 'That is under the league minimum.'
    : decision.blocked === 'TERM' ? "That term isn't legal."
    : decision.blocked === 'WILLING' ? "He won't commit for that long."
    : ev.headline;

  const beat = useMemo(
    () => (decision.signBand === 'LOSING' && !over ? beatRival(ctx, offer, gate) : null),
    [ctx, gate, offer, decision.signBand, over],
  );

  // On an EXTENSION the years he is already owed count against his horizon;
  // a walk-year re-sign is still priced as a walk-year re-sign. Same test
  // `decideOffer` refuses on, so this line cannot promise a term he refuses.
  const termCountsOwedYears = ctx.mode === 'EXTENSION' && ctx.controlYears > 0;
  const yearsHeCanStillAdd = termCountsOwedYears ? Math.max(0, ctx.willingYears - ctx.controlYears) : ctx.willingYears;
  const termCapped = yearsHeCanStillAdd < gate.maxYears;
  const willingLine = ctx.willingYears <= 1
    ? `At ${ctx.age} he will only go year to year — he does not intend to play past ${ctx.intendedFinalAge}.`
    : termCountsOwedYears
      ? `He does not intend to play past ${ctx.intendedFinalAge}. With ${ctx.controlYears} years already on his deal, ${yearsHeCanStillAdd} more is all he will add — at any price.`
      : `He does not intend to play past ${ctx.intendedFinalAge}, so ${ctx.willingYears} years is the longest deal he will sign — at any price.`;

  const buttonLabel =
    signed ? 'Signed'
      : gone ? 'He signed elsewhere'
      : walkedAway ? 'Talks are over'
      : decision.blocked === 'CAP' ? 'Not enough cap room'
      : decision.blocked === 'WILLING' ? `He will not sign for ${offer.years} years`
      : decision.blocked ? 'Cannot offer this'
      : decision.signBand === 'YES' ? 'Offer this deal — he signs'
      : decision.outbid ? `Offer anyway — he prefers the ${gate.rival?.teamName ?? 'rival'} package, costs ${decision.maxPatienceCost} patience`
      // Inside the band the price is stated as what a REFUSAL costs. The real
      // figure is 0 or 1 on the hidden draw, and printing it would put the
      // answer on the button.
      : decision.signBand === 'MAYBE' ? `Offer this deal — he might take it, ${decision.maxPatienceCost} patience if he does not`
      : `Offer this deal — costs ${decision.maxPatienceCost} patience`;

  return {
    session, offer, decision, setApy, setYears, setGuaranteePct, resetTerms, submit,
    patienceSpent, history, result, signed, gone, walkedAway, over, talksDead, canSubmit,
    shownVerdict, shownHeadline,
    band: talksDead ? null : { lo: ACCEPT_INTEREST - ctx.bandHalfWidth, hi: ACCEPT_INTEREST },
    rivalMark: talksDead || decision.rivalInterest === null || !gate.rival
      ? null
      : { interest: decision.rivalInterest, label: gate.rival.teamName.split(' ').pop() ?? 'Rival' },
    beat, appending, totalTerm, capOn, spaceAfter, willingLine, termCapped, buttonLabel,
    signedDeal: result?.ok ? result.signed : undefined,
    answeredAt,
    hasMoment: moment !== null,
  };
}

function clampStep(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(v / 100_000) * 100_000));
}
