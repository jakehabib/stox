'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExtendContractForm } from './ExtendContractForm';
import { RestructureForm } from './RestructureForm';
import { CapMode } from '@/lib/types';
import { DeltaChip, deltaTint, useDeltaWatch } from './ds/DeltaChip';
import { formatMoney } from '@/lib/cap';
import { FranchiseTagButton } from './FranchiseTagButton';
import { FifthYearOptionButton } from './FifthYearOptionButton';
import { contractClockSentence } from '@/lib/contractClock';

interface ContractShape {
  years: number; yearsRemaining: number; signedYear: number;
  baseSalaries: string; signingBonus: number; guaranteed: number; voidYears: number;
}

/**
 * Extend or restructure, and — new — say what it did to the cap.
 *
 * A restructure moves several million dollars of cap space and the only
 * acknowledgement was the form closing. The masthead figure updated silently
 * and the user was left to remember what it used to say. This watches the
 * capSpace prop the page already hands down (revalidatePath delivers the new
 * one; this component is not remounted by router.refresh(), so the previous
 * value survives in a ref) and states the difference beside the new number.
 *
 * It is armed at the moment a form reports success, so it can only ever fire
 * as the consequence of something the user just did — never on a navigation
 * or an unrelated re-render. Nothing optimistic: React is 18.3 here, and a cap
 * figure guessed on the client and then corrected by the server would be a
 * lying metric, which this codebase treats as a bug class rather than a
 * trade-off.
 *
 * FOUR THINGS CHANGED HERE, EVERY ONE OF THEM FROM THE OWNER USING IT.
 *
 * 1. REFUSE AT THE ENTRANCE. Extending a man whose deal is expiring is a
 *    re-sign, and the server has always said so — but it said so on SUBMIT.
 *    He dragged four sliders, watched a ledger compute a four-year $92.4M
 *    deal, pressed the button and only then got "his deal is up — that's a
 *    re-sign". A whole negotiation's work refused by a screen that was never
 *    going to accept it, in wording that reads as a rejection of the offer
 *    rather than of the screen. So the button is not offered for him at all
 *    now: the card explains why and points at the window that does negotiate
 *    him. The server guard stays exactly where it is — a Server Action is a
 *    POST and a hidden button protects nothing.
 *
 * 2. THE TAG WAS NOWHERE. *"I don't see any way to franchise tag someone. I
 *    see the option in the contract tab, but no option to use it."* The pill
 *    he saw up in the section heading is a status badge for a man who is
 *    already tagged; the only control in the game was inside an expanded row
 *    on the re-sign screen. It is a decision about a contract, so it belongs
 *    in the box where the contract decisions are — and it stays here, greyed
 *    and explaining itself, in every state where it cannot be taken. See
 *    FranchiseTagButton.
 *
 * 3. RE-SIGN POINTED AT A LIST, NOT AT A MAN. The button dropped a GM on
 *    /resign with eleven rows on it and left him to find the player he had
 *    open a second ago. It names him now, and the page opens his talks. When
 *    the window is not taking him at all this league year — a man with a
 *    season still to run, during the offseason — there is no button, because
 *    the honest answer is that there is nothing to do yet, and the sentence
 *    says so instead.
 *
 * 4. LEGIBILITY. *"Everything in that box should be more visible 'negotiate
 *    extension' for example is so small"*. These were `text-xs px-2.5 py-1.5`
 *    — a button rendered at footnote size on the screen where you commit tens
 *    of millions of dollars. They are ordinary buttons at ordinary button
 *    size now, with the extension as the primary action, which is all that
 *    was ever wrong with them.
 */
export function ContractActions({
  leagueId, playerId, playerName, ovr, position, age, contract,
  availableSpaceForExtension, capSpace, capMode, resignHref, tag, option, ledgerYear,
}: {
  leagueId: string; playerId: string; playerName: string; ovr: number; position: string; age: number;
  contract: ContractShape; availableSpaceForExtension: number; capSpace: number; capMode: CapMode;
  /**
   * Where his re-sign is actually negotiated — his own row, opened. Null when
   * the window is not taking him this league year, which is the man with a
   * season still to run once the offseason has begun: the re-sign screen
   * deliberately keeps him off the list (it cost the app owner a huge
   * extension he did not need to give), so pointing a button at it would land
   * him on a list he is not on.
   */
  resignHref: string | null;
  /**
   * Everything the tag control needs, resolved by the page against the same
   * facts the Server Action refuses on. `blocked` is null when it can be
   * pressed and a sentence naming the reason when it cannot.
   */
  tag: { blocked: string | null; isTagged: boolean };
  /**
   * NULL FOR ALMOST EVERY MAN IN THE GAME, and that is the rule rather than a
   * default: only a first-round pick still on his rookie deal has a fifth-year
   * option at all, so there is nothing to grey out or explain on anybody else's
   * card. Non-null carries the answer already given, or `blocked` naming why it
   * cannot be given yet — the same sentence the server refuses with.
   */
  option: { blocked: string | null; decided: 'EXERCISED' | 'DECLINED' | null; optionYear: number } | null;
  /**
   * The year the contract LEDGER is currently written in — pass-through for
   * the extension screen's copy of the ledger, which labels its rows with it.
   * It is not `League.seasonYear`; see the header on `ledgerYear` in the
   * player page, which resolves it once through `capChargeYear`.
   */
  ledgerYear: number;
}) {
  const [mode, setMode] = useState<'none' | 'extend' | 'restructure'>('none');
  const cap = useDeltaWatch(capSpace);
  const done = () => { cap.arm(); setMode('none'); };

  if (mode === 'extend') {
    return (
      <div className="space-y-3">
        <button onClick={() => setMode('none')} className="btn-ghost text-sm px-0">← Back</button>
        <ExtendContractForm
          leagueId={leagueId} playerId={playerId} ovr={ovr} position={position} age={age}
          availableSpace={availableSpaceForExtension} capMode={capMode}
          contract={contract} ledgerYear={ledgerYear} onDone={done}
        />
      </div>
    );
  }

  if (mode === 'restructure') {
    return (
      <div className="space-y-3">
        <button onClick={() => setMode('none')} className="btn-ghost text-sm px-0">← Back</button>
        <RestructureForm leagueId={leagueId} playerId={playerId} contract={contract} capSpace={capSpace} onDone={done} />
      </div>
    );
  }

  // His deal is up. That is the Re-sign window's negotiation, not this
  // screen's — signposted, not errored, and explained so the missing button
  // does not read as something broken.
  const expiring = contract.yearsRemaining <= 1;

  return (
    <div className="space-y-3 pt-1">
      {expiring ? (
        <div className="space-y-3">
          {resignHref ? (
            <div className="space-y-2">
              {/* The button says what it does. It used to read "Re-sign him in
                  the Re-sign Window", and the sentence beneath then said "in
                  the Re-sign Window" a second time — the app owner's note. The
                  label is the action; the sentence is the reason to take it
                  now. It carries his id now, so it opens his talks rather than
                  handing back the list he came from. */}
              <Link href={resignHref} className="btn-primary w-full sm:w-auto">
                Re-sign
              </Link>
              {/* The football situation, not the taxonomy. This used to explain
                  that "keeping him is a re-sign rather than an extension",
                  which tells the user about our own vocabulary rather than
                  about his player — the explainer voice the owner has objected
                  to four separate times. What is actually useful here is the
                  clock, and the clock is worded in one place now so that this
                  card and the re-sign screen cannot describe the same man two
                  ways (lib/contractClock.ts). */}
              <p className="text-sm text-muted">
                {contractClockSentence(contract.yearsRemaining)}
                {' '}Get to him now and he will still take something like a hometown price. The closer he gets
                to the open market, the less of one he will take.
              </p>
            </div>
          ) : (
            // Suppressed for a tagged man: the tag control's own line already
            // says what his season is, and two sentences about the same year
            // is how a card starts reading like a form.
            //
            // Suppressed for a man with an option on his deal for a stronger
            // reason than tidiness — this sentence would be FALSE. It reads
            // "he is next offseason's question, not this one's", which is
            // exactly right for an ordinary man at one year left and exactly
            // wrong for a first-rounder whose option is answered in this
            // window and never again. The option control owns his clock.
            !tag.isTagged && !option && <p className="text-sm text-muted">{contractClockSentence(contract.yearsRemaining)}</p>
          )}
          {/* ABOVE THE TAG, because for the man who has both it is the only one
              of the two that can actually be pressed: the tag is for a deal
              that is UP, and his has a season to run. */}
          {option && (
            <FifthYearOptionButton
              leagueId={leagueId} playerId={playerId} playerName={playerName}
              blocked={option.blocked} decided={option.decided} optionYear={option.optionYear}
            />
          )}
          {/* WHERE THE TAG LIVES NOW. In the box with the other contract
              decisions, at their size, live or greyed — and never for a man
              who is not a re-sign question in the first place, since offering
              it under a deal with three years to run would be noise rather
              than reach. The price and the confirm are the control's own
              (FranchiseTagButton). */}
          <FranchiseTagButton
            leagueId={leagueId} playerId={playerId} playerName={playerName}
            blocked={tag.blocked} isTagged={tag.isTagged}
          />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setMode('extend')} className="btn-primary">Negotiate Extension</button>
            {capMode === 'REALISTIC' && (
              <button onClick={() => setMode('restructure')} className="btn-secondary">Restructure</button>
            )}
          </div>
          {/* A man whose option has just been PICKED UP has two years left and
              lands here rather than in the expiring branch. The control renders
              its standing line — under contract through the option year, that
              year guaranteed — which is the single most important fact about
              his deal and would otherwise vanish the moment it became true. */}
          {option && (
            <FifthYearOptionButton
              leagueId={leagueId} playerId={playerId} playerName={playerName}
              blocked={option.blocked} decided={option.decided} optionYear={option.optionYear}
            />
          )}
        </div>
      )}
      {/* Present only in the couple of seconds after a move actually changed
          the number. It states the change; the cap page still states the
          state. Renders nothing at all otherwise, so the resting layout of
          this section is exactly what it was. */}
      {cap.delta !== null && (
        <div className="flex items-center gap-2">
          <span className="label-sm">Cap space</span>
          <span className={`stat-value text-stat-md ${deltaTint(cap.delta)}`}>{formatMoney(capSpace)}</span>
          <DeltaChip delta={cap.delta} format={formatMoney} />
        </div>
      )}
    </div>
  );
}
