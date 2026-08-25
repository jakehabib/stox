'use client';

import Link from 'next/link';
import { RestructureForm } from './RestructureForm';
import { CapMode } from '@/lib/types';
import { CutButton } from './CutButton';
import { FranchiseTagButton } from './FranchiseTagButton';
import { FifthYearOptionButton } from './FifthYearOptionButton';

export interface ContractShape {
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
 *
 * ===========================================================================
 * WHAT MOVED WHEN THE CARD BECAME A ROOM, AND WHAT DID NOT
 * ===========================================================================
 * Every rule above is unchanged. The four decisions they record were the app
 * owner's, several of them fixes to complaints he raised, and none of them is
 * re-opened here: the extension is still refused at the entrance for a man
 * whose deal is up, the tag still sits with the other contract decisions and
 * still greys itself with its reason, Re-sign still names the man, and the
 * option still renders above the tag for the man who has both.
 *
 * TWO THINGS CHANGED, BOTH OF THEM ABOUT WHERE A PANE OPENS RATHER THAN ABOUT
 * WHO MAY PRESS WHAT.
 *
 * A. THE EXTENSION NO LONGER REPLACES THE SCREEN. This component used to
 *    return the negotiation INSTEAD of itself — which meant opening talks
 *    took away the cap sheet you needed to decide what to offer. The room
 *    (components/contract/ContractRoom.tsx) owns the mode now and mounts the
 *    negotiation in the other half of the same screen, so the ledger never
 *    moves. Hence `mode`/`onMode` rather than local state: two panes have to
 *    agree about which one is open.
 *
 * B. RELEASE IS PART OF THIS SET. It was a sibling of this component on the
 *    page, and the reason it sat there — *"the release button on the player
 *    card needs to be near the top. right now it's buried"* — is a rule about
 *    the strip, not about the page. Keeping it here is what stops the next
 *    layout from separating them again.
 */
export function ContractActions({
  leagueId, playerId, playerName, contract, capSpace, capMode, resignHref, tag, option,
  mode, onMode, onDone, releaseReturnTo, restructureNote,
}: {
  leagueId: string; playerId: string; playerName: string;
  contract: ContractShape; capSpace: number; capMode: CapMode;
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
   * Which pane is open, owned by the room because the extension opens in the
   * OTHER half of it. This strip only ever asks for a change.
   */
  mode: 'none' | 'extend' | 'restructure';
  onMode: (next: 'none' | 'extend' | 'restructure') => void;
  /** A move landed and the club's books moved with it — the room says so. */
  onDone: () => void;
  /** Where a release lands the GM. Straight through to CutButton; never invented here. */
  releaseReturnTo?: string;
  /**
   * What a maximum restructure would free, in the page's own words and from
   * the page's own call to the restructure function. It sits under the button
   * that would do it rather than in the cap sheet, which is the rule the whole
   * screen follows: a figure lives with the control that moves it.
   */
  restructureNote?: React.ReactNode;
}) {
  // His deal is up. That is the Re-sign window's negotiation, not this
  // screen's — signposted, not errored, and explained so the missing button
  // does not read as something broken.
  const expiring = contract.yearsRemaining <= 1;

  return (
    <div className="space-y-3">
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
                  to four separate times.

                  WHERE HIS CLOCK IS NOW. It opened with
                  `contractClockSentence(...)` — and that sentence is the last
                  line of the cap sheet on the other side of this strip, so on
                  the room layout it was printing twice, six inches apart,
                  word for word. The clock is the sheet's; what belongs to the
                  BUTTON is the reason to press it today rather than in March,
                  which is what is left. */}
              <p className="text-sm text-muted">
                Get to him now and he will still take something like a hometown price. The closer he gets
                to the open market, the less of one he will take.
              </p>
            </div>
          ) : null}
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
            {/* Pressed, this fills the other half of the room rather than
                replacing this one — so it is a toggle with a live state, not
                a door. Pressed again it closes the talks pane; nothing about
                the negotiation is undone by that, which is the panel's own
                footer copy. */}
            <button
              onClick={() => onMode(mode === 'extend' ? 'none' : 'extend')}
              aria-pressed={mode === 'extend'}
              className={mode === 'extend' ? 'btn-secondary' : 'btn-primary'}
            >
              {mode === 'extend' ? 'Close extension talks' : 'Negotiate Extension'}
            </button>
            {capMode === 'REALISTIC' && (
              <button
                onClick={() => onMode(mode === 'restructure' ? 'none' : 'restructure')}
                aria-pressed={mode === 'restructure'}
                className="btn-secondary"
              >
                Restructure
              </button>
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
      {restructureNote}

      {/* RELEASE, WITH THE OTHER DECISIONS. Its confirm step is the control's
          own and is deliberately not shortened — a release is irreversible and
          is the one move in this game that can cost more to take than to skip.
          See CutButton. */}
      <CutButton leagueId={leagueId} playerId={playerId} returnTo={releaseReturnTo} />

      {/* The restructure opens UNDER the strip rather than over the cap sheet,
          for the same reason the extension opens beside it: its whole argument
          is a comparison against the years already on the books, and those are
          on screen, six inches to the left, the entire time. */}
      {mode === 'restructure' && (
        <div className="pt-3 border-t border-line/60 space-y-3">
          <RestructureForm
            leagueId={leagueId} playerId={playerId} contract={contract}
            capSpace={capSpace} onDone={onDone}
          />
          <button onClick={() => onMode('none')} className="btn-ghost text-sm px-0">Never mind</button>
        </div>
      )}
    </div>
  );
}
