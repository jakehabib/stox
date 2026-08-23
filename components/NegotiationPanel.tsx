'use client';

import { useState, type ReactNode } from 'react';
import {
  DEFAULT_STRUCTURE, askHasFallen, loyaltyBand, personalityBlurb, PERSONALITY_LABEL,
  type DealStructure, type NegotiationOutcome, type NegotiationSession, type Offer,
} from '@/lib/negotiation';
import { formatMoney } from '@/lib/cap';
import { useNegotiation } from './negotiate/useNegotiation';
import { InterestMeter } from './ds/InterestMeter';
import { ActionButton } from './ds/ActionButton';
import { SigningConfirmation } from './ds/SigningConfirmation';
import { SuitorRumour } from './ds/SuitorRumour';
import { PlayerAvatar } from './PlayerAvatar';
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
 * the server.
 *
 * ===========================================================================
 * THE RULES ARE NOT IN THIS FILE ANY MORE
 * ===========================================================================
 * `useNegotiation` (components/negotiate/useNegotiation.ts) holds them: the
 * clamp, the decision, what the meter is ALLOWED to say, what the button says,
 * and the fact that patience is the server's. That file was lifted out of this
 * one for the three rejected design directions, and it was an exact copy —
 * 110 lines of the same reasoning, in two files, with nothing making either
 * follow the other. Two evaluators is precisely the bug the module was written
 * to remove (see THE decision in lib/negotiation.ts); leaving a second one
 * standing in the shipped panel because it happened to be first would be the
 * same mistake wearing a different filename.
 *
 * So the shipped panel reads the same hook the mockups read. Nothing about
 * what it DRAWS came from a mockup — the layout below is the layout the app
 * owner kept — but the answer it draws can no longer differ from theirs.
 *
 * The four rules that survive the move, restated because they are the whole
 * value of the meter:
 *
 *   THE SAME FUNCTION DECIDES. `decideOffer` draws this bar and runs again in
 *   the Server Action, against a session re-resolved from the database.
 *   THE OFFER IS CLAMPED with the function the Server Action clamps with.
 *   INSIDE THE BAND `accepted` IS NEVER EXPOSED — not in the button, not in
 *   the reason line, not by the presence or absence of anything.
 *   PATIENCE IS THE SERVER'S. Seeded from the session, replaced by whatever
 *   comes back on submit, never counted here.
 *
 * ===========================================================================
 * WHAT THIS PANEL SAYS, AND HOW MANY TIMES IT SAYS IT
 * ===========================================================================
 * Counted on the free-agency table of a scratch save before this pass, in the
 * panel's own rendered text:
 *
 *   $32.1M total value          twice — the term control's hint, and the
 *                               ledger's "Total value" row 300px below it.
 *   $16.1M guaranteed           twice — the guarantee hint and a ledger row.
 *   $16.1M dead if you cut him  twice — the guarantee warning and a ledger row.
 *   "They will take it to him,  twice — the meter headline, and the reason
 *    but they are not excited"   line above the button, which for a signBand
 *                               of NO is literally `evaluation.headline`.
 *   the rival's package         twice on an outbid offer — SuitorRumour's
 *                               figures and the reason line's recital of them.
 *   the term refusal            up to five times at once — meter headline,
 *                               control warning, the willing line under the
 *                               control, the reason paragraph, the button.
 *
 * The rule applied throughout: A FIGURE LIVES WHERE THE CONTROL THAT MOVES IT
 * LIVES, and the ledger keeps what no single control owns — what this costs
 * your cap, year by year. That is why the money rows came out of the ledger
 * rather than the hints coming out of the controls: dragging guarantee while
 * the dollar figure sits 300px below is the app owner's own complaint about
 * holding a number in your head.
 *
 * A BLOCKED DEAL IS EXPLAINED ONCE, AT THE CONTROL THAT CAUSED IT. The
 * standalone reason paragraph is gone; `decision.reason` is rendered as the
 * offending control's own note, which is where the fix is. The meter headline
 * (short, his mood) and the button label (what pressing it would do) are the
 * other two, and they say different things.
 *
 * WHAT WAS NOT CUT: length. *"I would rather have a lot of really cool data
 * ... rather than minimal on one tab to save room."* The demands list, the
 * whole cap-hit-by-year row, the void-year warning, the suitor's receipts and
 * the record of the talks are all still here, and the record of the talks got
 * bigger.
 *
 * ===========================================================================
 * THE THREE TABLES GET THE SAME PANEL, INCLUDING THE PARTS ABOUT WHO ELSE
 * ===========================================================================
 * *"It should apply equally to free agents and re-signs."* Before this pass
 * each screen assembled its own answer to "who else can have him" and "what is
 * staying worth to him": free agency wrote a line saying nobody was bidding,
 * the re-sign list mounted LoyaltyLine and SuitorRumour, and the extension
 * form wrote a paragraph of its own about appending years. Three call sites,
 * three chances to say a different thing about one mechanic.
 *
 * Both claims are made HERE now, once, off the session — which is where the
 * mode already lives, so each of them is the true thing for the table it is on
 * without any screen having to decide. `SuitorRumour` was already mode-aware
 * and is mounted as it is; the discount line is `EdgeLine` below, which is the
 * old `LoyaltyLine` with the third table's wording added, because the old one
 * had only the two the re-sign list needed.
 *
 * What a screen may still pass in `banner` is evidence that is genuinely its
 * own: the Dynasty market-knowledge band on free agency, the current contract
 * in full on an extension.
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
  /**
   * Front/back-loading and void-year controls, rendered inside the panel with
   * the FULL length of the deal on the table — appended total on an extension.
   * A plain node could not be given that, and the void-year control has to be
   * sized off it or it offers positions the contract will silently discard.
   */
  structureSlot?: (contractYears: number) => ReactNode;
  /**
   * Evidence this SCREEN has and the session does not. Not the place for
   * anything about exclusivity, loyalty or appending years — those are facts
   * about the mechanic and are drawn above, from the session, on all three
   * tables.
   */
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
  const n = useNegotiation({ initialSession, structure, onOffer, onSigned, onReset, disabled, returnTo });
  const { session, offer, decision, over, talksDead, appending, totalTerm, capOn } = n;
  const { ctx, gate } = session;
  const ev = decision.evaluation;

  // WHAT HIS ROOM IS AFTER, AND NEVER WHAT IT WAS BEFORE.
  //
  // `gate.capSpace` is not the club's cap room. `resolveNegotiationSession`
  // adds the incumbent's current cap hit back onto it (`+ oldHit`) because the
  // signing replaces that deal, which is correct for the gate — it has to
  // measure what `assertCapRoom` will measure — and wrong as a displayed
  // figure: measured at $48.5M on one re-sign while the page header for the
  // same team said $32.7M. The room AFTER is right either way, because the
  // refund is real; only the before was ever wrong. So the panel prints the
  // after and nothing else, and a before/after pair here would be a lying
  // metric the moment somebody added it. (The honest "before" exists — it is
  // `teamCapSummary().capSpace`, which the page header is already showing.)
  const spaceAfter = n.spaceAfter;

  return (
    <div className="panel overflow-hidden">
      {/* IDENTITY IS NOT ORNAMENT (README design principle 2), and the panel
          had none of it: the header read "Business-first · WR · age 30" and
          never once said whose contract this was.

          Measured before adding it, because every container of this panel
          names him at the top — the player card's hero, the re-sign row's own
          header. The panel is 1454px tall at 1600 wide and 2190px at 390, in a
          1000px and an 844px viewport: by the time you are working the
          guarantee slider the hero is a screen and a half above you, and on
          the re-sign list the row header has gone with it. So the man is named
          where the money is being decided, which is the only place it is
          currently possible to forget who he is.

          NOT a rating chip: `ctx.ovr` is the TRUE overall (see
          buildNegotiationContext), and the user is only ever shown the scouted
          view. A number here would be the one place in the game that leaks it. */}
      <div className="px-4 py-3 border-b border-line/70 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <PlayerAvatar seed={ctx.playerId} age={ctx.age} size={30} position={ctx.position} />
          <div className="min-w-0">
            <div className="label-sm">{title}</div>
            <div className="text-sm mt-0.5 truncate">
              <span className="font-semibold">{ctx.playerName}</span>
              <span className="text-muted"> · {ctx.position} · {ctx.age}</span>
            </div>
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
              <span key={i} className={`pip-well w-2 h-2 ${i < ctx.patience - n.patienceSpent ? '' : 'pip-spent'}`}>
                <span className="pip-fill" />
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* IT IS SIGNED. Everything that was a decision is now a fact, so the
          controls go and the record stays — see SigningConfirmation.
          Drawn here ONLY where there is no provider to raise it to. Under the
          league layout there always is, and the card is a dialog above the
          page instead: this panel is frequently unmounted by the signing
          itself, and a record of an event cannot be stored inside the thing
          the event destroys. See SigningMomentProvider. */}
      {n.signedDeal && !n.hasMoment ? (
        <div className="px-4 py-4">
          <SigningConfirmation
            deal={n.signedDeal}
            answeredAt={n.answeredAt}
            onDismiss={() => onSigned?.()}
            returnTo={returnTo}
          />
        </div>
      ) : (
      <>
      <div className="px-4 py-3 border-b border-line/60 space-y-2">
        {/* Who he is at a table, in one line. Mode-aware now: the LOYAL blurb
            used to promise an outside free agent wanted to "finish what he
            started here". See personalityBlurb. */}
        <p className="text-xs text-muted">
          <span className="text-chalk">{PERSONALITY_LABEL[ctx.personality]}.</span>{' '}
          {personalityBlurb(ctx)}
        </p>
      </div>

      {/* Both halves of the same clock, above the meter and before any control
          is touched: what staying is worth to him right now, and who is
          waiting if it stops being worth enough. Neither is revealed after the
          fact — a pressure you only learn about once you have committed is a
          gotcha, not a mechanic.

          Mounted here rather than by each screen, which is what makes the
          claim identical on all three tables. Both read the mode off the
          session and say the true thing for it: `EdgeLine` draws nothing at
          all for an outside free agent (he is owed no discount) and has its
          own wording for an extension, and `SuitorRumour` has three separate
          wordings for "can this club actually have him" and picks by the same
          window the signing path enforces. */}
      <div className="px-4 pt-3 space-y-2">
        <EdgeLine session={session} />
        <SuitorRumour session={session} />
        {banner}
      </div>

      <div className="px-4 py-4 space-y-4">
        <InterestMeter
          interest={talksDead ? 0 : ev.interest}
          verdict={n.shownVerdict}
          headline={n.shownHeadline}
          maybeBand={n.band}
          // The rival on the same track, at the number the same evaluation
          // gave their package. This is the mark to clear, and it moves for
          // salary, term and guarantee alike.
          rival={n.rivalMark}
        />

        {/* THE METER IS NOT STICKY, AND THAT IS A MEASUREMENT RATHER THAN AN
            OMISSION. It was the whole argument for the rejected Table
            direction — the answer scrolling away from the control that changes
            it — so it was measured on all three tables at 390px before
            anything was built: the salary slider sits 136-172px below the top
            of the meter, the term slider 286-306px, the guarantee slider
            436-532px, all inside an 844px viewport. Every control that can
            move the bar is on screen WITH the bar at the narrowest width this
            project draws. The only controls that fall past the fold are the
            deal-shape sliders below, and those cannot move the bar at all —
            he does not judge your cap accounting. Sticky positioning would
            also have to fight `overflow-hidden` on this panel and on the
            re-sign row that contains it, for no measured gain. */}
        <div className="space-y-4">
          <Control
            label={appending ? 'New money' : 'Salary'}
            tipText={appending ? tip('newMoney') : tip('apy')}
            display={`${formatMoney(offer.apy)}/yr`}
            /* His number, and — for a man who has been sitting on the wire —
               the number he started at. The second half needs a REAL fall to
               appear: `openMarketApy > marketApy` was true after one week
               unsigned, which is one $100K rounding step, and the panel told a
               story about nobody calling for a man released last week. See
               askHasFallen. */
            hint={
              askHasFallen(ctx)
                ? `${appending ? `On the ${offer.years} new year${offer.years === 1 ? '' : 's'} — asking` : 'Asking'} ${formatMoney(ctx.marketApy)}/yr, down from ${formatMoney(ctx.openMarketApy)} since nobody called`
                : `${appending ? `On the ${offer.years} new year${offer.years === 1 ? '' : 's'} — market` : 'Market'} estimate ${formatMoney(ctx.marketApy)}/yr`
            }
            /* THE BLOCK, EXPLAINED WHERE IT CAN BE FIXED. This used to be a
               four-word warning here ("Over your room by $X") AND the full
               sentence in a paragraph 300px lower AND the meter headline AND
               the button label. `decision.reason` is the sentence the SERVER
               refuses with, so putting it on the control that caused it is
               both the fewest copies and the most useful one. */
            note={decision.blocked === 'CAP' || decision.blocked === 'FLOOR'
              ? { text: decision.reason, tone: 'bad' as const }
              : null}
            min={gate.minSalary}
            max={gate.maxSalary}
            step={100_000}
            value={offer.apy}
            onChange={n.setApy}
            disabled={over}
            field={MILLIONS_FIELD}
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

              This block is also the only place an outbid offer is now
              explained. `decision.reason` for LOSING recited the rival's
              salary, term and guarantee — the same three figures SuitorRumour
              is drawing 200px above with a crest on them — and then said "any
              of them can beat it", which is what the chips are. The recital
              went; the chips stayed, because they are the actionable half. */}
          {n.beat && !over && (
            <div className="space-y-1.5">
              <div className="label-sm text-[10px] text-bad">
                {gate.rival ? `Beating ${gate.rival.teamName}` : 'Beating their offer'} — any one of these closes it
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {n.beat.apy !== null && (
                  <button
                    type="button"
                    onClick={() => n.setApy(n.beat!.apy!)}
                    className={`pill hover:bg-bad/10 ${n.beat.cheapest === 'APY' ? 'border-bad text-bad' : 'border-line text-muted'}`}
                  >
                    Salary → {formatMoney(n.beat.apy)}/yr
                  </button>
                )}
                {n.beat.guaranteePct !== null && (
                  <button
                    type="button"
                    onClick={() => n.setGuaranteePct(n.beat!.guaranteePct!)}
                    className={`pill hover:bg-bad/10 ${n.beat.cheapest === 'GUARANTEE' ? 'border-bad text-bad' : 'border-line text-muted'}`}
                  >
                    Guarantee → {Math.round(n.beat.guaranteePct * 100)}%
                  </button>
                )}
                {n.beat.years !== null && (
                  <button
                    type="button"
                    onClick={() => n.setYears(n.beat!.years!)}
                    className={`pill hover:bg-bad/10 ${n.beat.cheapest === 'YEARS' ? 'border-bad text-bad' : 'border-line text-muted'}`}
                  >
                    Term → {n.beat.years} year{n.beat.years === 1 ? '' : 's'}
                  </button>
                )}
              </div>
              {n.beat.apy === null && n.beat.guaranteePct === null && n.beat.years === null ? (
                <p className="text-[11px] text-muted">
                  Nothing you can move on its own gets there. It will take more than one of them together.
                </p>
              ) : n.beat.cheapest === 'GUARANTEE' ? (
                <p className="text-[11px] text-muted">
                  Guaranteeing more commits no extra cash — it becomes signing bonus, which prorates, so it is
                  dead money if you ever cut him. Cheapest today, not free later.
                </p>
              ) : null}
            </div>
          )}
          <Control
            label={appending ? 'Years added' : 'Years'}
            /* The display carries the append arithmetic — "+4 → 7 yrs" — so
               the hint no longer repeats it in words. What it used to read was
               "$51.6M of new money on top of the 3 years he is already owed —
               7 years in all", of which everything after the money is either
               in the display above it or in the sentence under the cap-hit
               row, which explains the same boundary with the years drawn out. */
            display={appending
              ? `+${offer.years} → ${totalTerm} yrs`
              : `${offer.years} year${offer.years === 1 ? '' : 's'}`}
            hint={appending
              ? `${formatMoney(decision.newMoneyValue)} of new money`
              : `Total ${formatMoney(decision.totalValue)}`}
            /* One statement of what he will not do, not two. When the term is
               refused the reason is the SERVER's sentence; when it is merely
               capped, the standing limit. They used to render together, the
               second one restating the first with his age in it. */
            note={decision.blocked === 'WILLING' || decision.blocked === 'TERM'
              ? { text: decision.reason, tone: 'bad' as const }
              : n.termCapped ? { text: n.willingLine, tone: 'muted' as const } : null}
            min={1}
            max={gate.maxYears}
            step={1}
            value={offer.years}
            onChange={n.setYears}
            disabled={over || gate.maxYears <= 1}
            field={INTEGER_FIELD}
          />
          <Control
            label="Guaranteed"
            tipText={tip('guaranteedMoney')}
            display={`${Math.round(offer.guaranteePct * 100)}%`}
            /* Both figures the ledger used to carry a screen below. They
               belong to this slider: it is the one control that moves either
               of them, and reading a percentage here while the dollars sat in
               a box 300px down is the app owner's own complaint about holding
               a number in your head while you drag. */
            hint={
              <>
                <div>{formatMoney(decision.guaranteedMoney)} locked in</div>
                {capOn && decision.deadMoneyIfCut > 0 && (
                  <div className="text-bad">{formatMoney(decision.deadMoneyIfCut)} dead if you cut him</div>
                )}
              </>
            }
            /* HE HAS A FLOOR, and it is stated beside the control that sets it
               rather than discovered by a refusal — the same rule the term
               limit follows. Deliberately NOT the exact percentage: unlike the
               term limit this one is a price you can pay, and printing the
               figure would turn "how little can I lock in" into arithmetic
               instead of a thing the meter tells you when you cross it. */
            note={ctx.guaranteeFloor > 0 && !over
              ? {
                tone: ev.underGuaranteed ? 'bad' as const : 'muted' as const,
                text: (
                  <span className="inline-flex items-start gap-1.5">
                    <Tooltip className="mt-0.5" align="start" text={tip('guaranteeFloor')} />
                    {ev.underGuaranteed
                      // Deliberately not "no salary fixes it": that is the
                      // glossary's own sentence, one hover away, and the tip
                      // repeating the line beside it is the same duplication
                      // as two panels saying one thing.
                      ? 'A man of his standing does not put his name to a deal this size with this little locked in.'
                      : 'A player of his standing expects a real share of it guaranteed, and this clears that.'}
                  </span>
                ),
              }
              : null}
            min={0}
            max={100}
            step={5}
            value={Math.round(offer.guaranteePct * 100)}
            onChange={(v) => n.setGuaranteePct(v / 100)}
            disabled={over}
            field={PERCENT_FIELD}
          />
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

        {/* WHAT IT DOES TO YOUR BOOKS — and only that.
            ==================================================================
            This box used to open with Total value, Guaranteed and Dead money
            if cut, all three of which are now printed against the controls
            that move them, 100-300px above. What is left is the half no single
            control owns: the shape of the charge across the years, and the
            room you have afterwards.

            Read off the SAME decision object that drew the meter, so the cap
            number the panel refuses on is the cap number on screen. */}
        {(capOn || appending) && (
          <div className="panel p-3 space-y-1.5 text-sm">
            {appending && (
              <div className="flex justify-between gap-3">
                <span className="text-muted">Full contract — {totalTerm} yrs, old years included</span>
                <span className="font-mono">{formatMoney(decision.totalValue)}</span>
              </div>
            )}
            {capOn && (
              <>
                <div>
                  <div className="text-xs text-muted mb-1">
                    {appending ? 'Cap hit by year — the whole contract, old years and new' : 'Cap hit by year'}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {decision.capHitSchedule.map((hit, i) => (
                      <div
                        key={i}
                        /* THE BOUNDARY THE WRITER USED, not a second reading of
                           it. This was `i >= ctx.controlYears`; `buildExtension`
                           returns `firstNewYearIndex` for exactly this and
                           computes it from the base salaries it actually
                           appended after. The two agree on every deal this
                           league generates and are not the same rule — see
                           OfferDecision.firstNewYearIndex. */
                        className={`pill ${
                          i === 0 && decision.blocked === 'CAP' ? 'border-bad/40 text-bad'
                            : appending && i >= decision.firstNewYearIndex ? 'border-accent2/50 text-accent2'
                            : 'border-line text-chalk'
                        }`}
                        title={appending ? (i >= decision.firstNewYearIndex ? 'A year you are adding' : 'A year he was already owed') : undefined}
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
                <div className="flex justify-between pt-2 border-t border-line/60">
                  <span className="text-muted">Cap space after</span>
                  <span className={`stat-value text-stat-sm ${spaceAfter < 0 ? 'text-bad' : 'text-accent'}`}>{formatMoney(spaceAfter)}</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* THE RECORD OF THE TALKS, which is worth more than four lines of
            grey monospace.
            ==================================================================
            It used to read "$10.7M/yr × 3yr — cold" and drop the guarantee —
            a third of the package he was actually judging, and the dimension
            the beat-them chips most often reach for. So the row carries the
            whole offer, and the newest one carries what his agent said back:
            `res.message` is the SERVER's own sentence about that offer, which
            this panel was already printing as a floating line above the
            button, unattached to the offer it described.

            Only the newest keeps its sentence. An older refusal's terms are
            the record — they are what stops you re-offering it — but a
            paragraph describing an offer you have already replaced is the
            stale-result line this panel deletes on every drag. */}
        {n.history.length > 0 && (
          <div className="border-t border-line/50 pt-2.5 space-y-1.5">
            <span className="label-sm text-[10px]">The talks so far</span>
            {n.history.map((h, i) => (
              <div key={i}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[11px] font-mono text-muted">
                    {formatMoney(h.apy)}/yr × {h.years}yr · {Math.round(h.guaranteePct * 100)}% gtd
                  </span>
                  <span className="text-[11px] text-muted">{h.outcome}</span>
                </div>
                {i === n.history.length - 1 && (
                  <p className={`text-xs mt-0.5 ${n.gone ? 'text-bad' : 'text-accent2'}`}>{h.message}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {n.walkedAway && !n.signed && !n.gone && (
          <p className="text-sm text-bad">
            His agent has stopped returning calls. {ctx.incumbent ? 'He will test the market.' : 'He is signing somewhere else.'}
          </p>
        )}
        {/* Only a signing gets a line of its own now. Every refusal's message
            is attached to the offer that earned it, in the record above. */}
        {n.result?.ok && <p className="text-sm text-accent">{n.result.message}</p>}
        {disabled && disabledReason && <p className="text-sm text-muted">{disabledReason}</p>}

        <ActionButton
          /* A blocked deal's button is not an invitation. It used to keep the
             primary green while reading "Not enough cap room", which is the
             shape of a button you are meant to press. */
          className={`w-full ${decision.blocked ? 'btn-secondary' : decision.outbid ? 'btn-danger' : 'btn-primary'}`}
          disabled={!n.canSubmit}
          idleLabel={n.buttonLabel}
          workingLabel="On the phone…"
          doneLabel="Signed"
          onAction={n.submit}
        />

        {(onCancel || onReset !== undefined) && (
          <div className="border-t border-line/50 pt-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              {!over && (
                <button type="button" onClick={n.resetTerms} className="btn-secondary text-sm">
                  Reset terms
                </button>
              )}
              {onCancel && (
                <button type="button" onClick={onCancel} className="btn-ghost text-sm">
                  Leave the table
                </button>
              )}
            </div>
            {/* The three sentences that used to be here spent two of them
                restating the two button labels directly above ("Reset terms
                puts the sliders back where they opened", "Leave the table
                closes talks"). What neither label can say is the part that
                actually costs money, and it is the whole reason this
                paragraph exists — a control that implied otherwise would be
                the page-reload exploit wearing a friendlier label. */}
            <p className="text-xs text-muted">
              Neither undoes an offer: patience you have spent is spent, and he remembers what he has already
              been offered — the same money will not get a different answer out of him.
            </p>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}

/**
 * ===========================================================================
 * WHAT YOUR EDGE IS WORTH, AND WHICH WAY IT IS MOVING
 * ===========================================================================
 * One claim about one mechanic, on every table that has the mechanic.
 *
 * It was `LoyaltyLine` (components/ds/SuitorRumour.tsx), mounted by the
 * re-sign list alone, and it is worded for a re-sign alone: two states, walk
 * year and final call, chosen off `ctx.resignWindow`. An EXTENSION has no
 * resign window — `buildNegotiationContext` sets it null and hands the man
 * his FULL undecayed loyalty discount plus a `controlDiscount` that grows
 * with every year you still own — so mounting that component on the extension
 * table renders the walk-year branch over a man with three seasons left:
 * "it shrinks the moment his deal actually expires", which is a year that is
 * not on this screen's horizon, and no mention at all of the control years
 * that are the bigger half of the edge there.
 *
 * So the sentence lives here, where the panel already knows which of the three
 * tables it is. The two re-sign wordings are LoyaltyLine's own, to the word,
 * because nothing about the shipped re-sign screen should move; the extension
 * one is new because that screen never had one.
 *
 * THE BAND, NEVER THE FIGURE. `loyaltyBand` is derived from the real
 * `loyaltyDiscount`, so this cannot lie — it is just coarse, the way a GM's
 * read on a player is coarse. The exact percentage is a term of his hidden
 * reservation price and printing it beside the public market estimate would
 * hand over most of the number the minigame asks you to probe for.
 */
function EdgeLine({ session }: { session: NegotiationSession }) {
  const { ctx } = session;
  // An outside free agent owes this club nothing, and a line saying so on
  // every free-agency table is a sentence about the absence of a mechanic.
  // SuitorRumour underneath is already saying he is on the open market.
  if (!ctx.incumbent) return null;
  const band = loyaltyBand(ctx.loyaltyDiscount);
  const finalCall = ctx.resignWindow === 'FINAL_CALL';

  const worth =
    band === 'LARGE' ? 'He is knocking a serious amount off his own price to stay.'
      : band === 'REAL' ? 'There is a real hometown discount in this.'
      : band === 'SLIGHT' ? 'There is a little left in the hometown discount.'
      : 'The hometown discount is gone. He is priced like anybody else.';

  const clock = ctx.mode === 'EXTENSION'
    // The control years, which are the leverage a re-sign does not give you —
    // see `controlDiscount`, which is priced per year owned beyond the first.
    // Deliberately NOT "worth more than the loyalty is": that comparison is
    // true for a long-controlled man and false for a two-year one, and a
    // sentence that is true of some deals is a lying metric on the rest.
    ? `You still own ${ctx.controlYears} year${ctx.controlYears === 1 ? '' : 's'} of him. Years of control come off his price, and there is one fewer of them every season you wait.`
    : finalCall
      ? 'Most of it went when his contract ran out — this is what a last call costs.'
      : 'It shrinks the moment his deal actually expires, so the cheapest day to do this is today.';

  return (
    <div className={`text-xs px-3 py-2 rounded-lg border ${finalCall ? 'border-line bg-raised text-muted' : 'border-accent/30 bg-accent/10 text-accent'}`}>
      <span className="font-semibold">{worth}</span> {clock}
    </div>
  );
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
 *
 * THE NOTE SLOT IS PART OF THE CONTROL. There used to be three loose
 * paragraphs after three controls, two of them dragged back up under the
 * thing they belonged to with `-mt-2.5`, plus a `warn` column competing with
 * the hint for the same corner. Everything a control has to say about its own
 * value is now one full-width line underneath it, in the order a reader hits
 * it: the value, the slider, the box, what the value means, then what is
 * wrong with it.
 */
function Control({ label, display, hint, note, min, max, step, value, onChange, disabled, field, tipText }: {
  label: string; display: string; hint?: ReactNode;
  /** A refusal, a standing limit, or a fact about his structure. Full width. */
  note?: { text: ReactNode; tone: 'muted' | 'bad' } | null;
  min: number; max: number; step: number; value: number;
  onChange: (v: number) => void; disabled?: boolean;
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
        {hint && <div className="text-xs text-muted text-right">{hint}</div>}
      </div>
      {note && <p className={`text-xs mt-1.5 ${note.tone === 'bad' ? 'text-bad' : 'text-muted'}`}>{note.text}</p>}
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
