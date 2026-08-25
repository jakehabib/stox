'use client';

import { useState, type ReactNode } from 'react';
import { formatMoney } from '@/lib/cap';
import { CapMode } from '@/lib/types';
import { contractClockSentence } from '@/lib/contractClock';
import { ContractActions, type ContractShape } from '../ContractActions';
import { ExtendContractForm } from '../ExtendContractForm';
import { DeltaChip, deltaTint, useDeltaWatch } from '../ds/DeltaChip';

/**
 * ===========================================================================
 * ACROSS THE TABLE — the contract face, laid out as the room it happens in
 * ===========================================================================
 * Eleven directions were drawn for this screen. The app owner picked this one:
 * *"I like #11 the best but i want to make sure it shows all the same details
 * as ours does now"*, and then, on the full-parity build, *"I love them. Lets
 * do it."*
 *
 * Your club's cap sheet is the left half of the room. The player's agent —
 * what he thinks and what he will take — is the right half. The buttons that
 * act on him sit on the line between the two.
 *
 * WHAT THE SHAPE IS FOR, AND WHY THE OLD ONE COULD NOT DO IT. The contract
 * face was a single column: the decisions, then the year-by-year ledger under
 * them, and pressing Negotiate Extension REPLACED the whole box with the
 * negotiation. So the one thing you needed while deciding what to offer — what
 * he already costs, what the seasons after this one already carry, what
 * cutting him would leave behind — was the exact thing opening talks took
 * away. Now the ledger does not move. You drag a salary on the right and read
 * the cap sheet that money lands on, on the left, without a scroll.
 *
 * NOTHING IN HERE COMPUTES ANYTHING. The ledger arrives already rendered from
 * the server (ContractLedger is still a Server Component, so proration, dead
 * money and every cap hit stay off the client bundle), the negotiation is
 * `useNegotiation` inside NegotiationPanel, the state rules for which buttons
 * exist are ContractActions', and the clock sentence is lib/contractClock's.
 * This file owns the room and nothing else, which is the only way a layout
 * change gets to be a layout change.
 *
 * WHERE THE ACTIONS SIT, AND THE ONE PLACE THIS IS NOT THE MOCKUP. In the
 * mockup the strip is a footer under both columns, which is right at desktop
 * width where the columns are side by side and the strip is a few inches down.
 * Stacked on a phone it would put Release under a full cap sheet AND a full
 * negotiation — which is exactly the complaint that moved it in the first
 * place (*"the release button on the player card needs to be near the top.
 * right now it's buried."*). So the strip is ordered second on narrow screens
 * and last on wide ones. Same markup, same DOM order, and the decision is
 * never buried.
 */
export function ContractRoom({
  leagueId, playerId, playerName, position, age, contract, capMode, capSpace,
  resignHref, tag, option, isOwnRoster, clubAbbr, clubName, seasonYear,
  dealAsSigned, ledger, restructureNote, releaseReturnTo,
}: {
  leagueId: string;
  playerId: string;
  playerName: string;
  position: string;
  age: number;
  contract: ContractShape;
  capMode: CapMode;
  capSpace: number;
  resignHref: string | null;
  /** Null for a man who is not yours — then there are no decisions, only the sheet. */
  tag: { blocked: string | null; isTagged: boolean } | null;
  option: { blocked: string | null; decided: 'EXERCISED' | 'DECLINED' | null; optionYear: number } | null;
  isOwnRoster: boolean;
  clubAbbr: string;
  clubName: string;
  seasonYear: number;
  /** Total value and signing bonus — server-rendered; the terms the ledger does not carry. */
  dealAsSigned: ReactNode;
  /** ContractLedger, rendered on the server. */
  ledger: ReactNode;
  restructureNote?: ReactNode;
  releaseReturnTo?: string;
}) {
  const [mode, setMode] = useState<'none' | 'extend' | 'restructure'>('none');
  /*
   * A move landed and the club's books moved with it. Kept here rather than in
   * the strip because the room is what stays mounted across both panes — the
   * restructure form unmounts itself on success and the negotiation is in the
   * other column, so a watch living in either of them would lose the previous
   * figure at the moment it became worth stating. Nothing optimistic: this
   * watches the `capSpace` prop the server re-delivers, and only ever states a
   * difference the server has already written.
   */
  const cap = useDeltaWatch(capSpace);
  const done = () => { cap.arm(); setMode('none'); };

  /*
   * THE CONTRACT CLOCK, AND THE THREE STATES IT STAYS OUT OF.
   *
   * Ported from ContractActions with its rules intact. The wording lives in
   * lib/contractClock.ts precisely so this card and the re-sign screen cannot
   * describe the same man two ways.
   *
   * Suppressed for a TAGGED man: the tag control's own line already says what
   * his season is, and two sentences about the same year is how a card starts
   * reading like a form.
   *
   * Suppressed for a man with an OPTION on his deal, for a stronger reason
   * than tidiness — the sentence would be false. It reads "he is next
   * offseason's question, not this one's", which is right for an ordinary man
   * at one year left and wrong for a first-rounder whose option is answered in
   * this window and never again. The option control owns his clock.
   *
   * Suppressed for a man with REAL YEARS LEFT: "He is under contract for 3
   * more seasons" is the headline two inches above it ("3 of 5") and the term
   * bar under that, said a third time in words. The mockup carries a sentence
   * here about what waiting costs; that sentence exists and it is EdgeLine's,
   * on the right, where it appears the moment talks open with the years of
   * control actually counted rather than asserted.
   *
   * AND IT IS PRINTED HERE RATHER THAN IN THE STRIP, which is the one place
   * this layout genuinely moved a claim. It used to sit under the Re-sign
   * button; on a two-column room that put it six inches from the cap sheet it
   * describes, and — measured on the first build of this screen — printed it
   * twice on one screen, word for word, because both halves wanted it. The
   * button keeps the half that is about the button: the reason to press it
   * today rather than in March.
   */
  const expiring = contract.yearsRemaining <= 1;
  const clockLine = expiring && !tag?.isTagged && !option
    ? contractClockSentence(contract.yearsRemaining)
    : null;

  const canExtend = isOwnRoster && !expiring;
  const talking = mode === 'extend' && canExtend;

  /* His side of the table before anybody has said a number. One line, chosen
     by the state, and never a second telling of what the left half, the tag
     control or the option control has already said. */
  const standing = !isOwnRoster
    ? 'He belongs to somebody else. There is nothing to negotiate here.'
    : expiring
      ? resignHref
        ? 'His deal is up. The number gets agreed in the re-sign window — and his agent is taking other calls while it is open.'
        : 'His agent has nothing to say this league year. He is owed a season either way.'
      : 'Nobody may bid on a man under contract. Open talks and his agent will name a price.';

  return (
    <div className="panel overflow-hidden flex flex-col">
      {/* ================= THE TWO SIDES OF THE TABLE ================= */}
      <div className="order-1 grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 items-center px-4 py-3 bg-raised/50 border-b border-line/70">
        <div className="flex items-center gap-3 min-w-0">
          <span className="shrink-0 w-11 h-11 rounded-md border border-line bg-raised grid place-items-center font-display font-bold text-sm tracking-wide">
            {clubAbbr}
          </span>
          <div className="min-w-0">
            <div className="font-display font-bold text-lg leading-tight truncate">{clubName}</div>
            <div className="text-xs text-muted">
              {capMode === 'OFF' || capSpace === Number.MAX_SAFE_INTEGER
                ? 'No salary cap in this league'
                : <><span className="font-mono text-chalk">{formatMoney(capSpace)}</span> cap room</>}
            </div>
          </div>
        </div>
        <div className="label-sm text-[10px] tracking-[0.18em] sm:text-center">Terms</div>
        <div className="sm:text-right">
          {/* NOT his name and NOT his rating: the card's hero is directly above
              this strip and carries both at full size, and `ovr` here would be
              a third printing of it. What the hero does NOT say is where his
              DEAL stands, which is the only thing this side of the table is
              about. */}
          <div className="font-display font-bold text-lg leading-tight">
            {tag?.isTagged
              ? 'Franchise tagged'
              : contract.yearsRemaining <= 0
                ? 'Expiring this offseason'
                : contract.yearsRemaining === 1
                  ? 'Final season'
                  : `Signed through ${seasonYear + contract.yearsRemaining - 1}`}
          </div>
          <div className="text-xs text-muted">{position} · {age}</div>
        </div>
      </div>

      {/* ================= THE ROOM ================= */}
      <div className="order-3 lg:order-2 grid grid-cols-1 lg:grid-cols-[1.08fr_1fr]">
        {/* ---- YOUR SIDE: the whole cap sheet, and it does not move ---- */}
        <div className="p-4 sm:p-5 space-y-4 min-w-0">
          <div className="label-sm">What he costs you</div>
          {ledger}
          {dealAsSigned}
          {clockLine && <p className="text-sm text-muted">{clockLine}</p>}
        </div>

        {/* ---- HIS SIDE ----
             It hugs its content until there is a negotiation in it. Stretched
             at rest it is six hundred pixels of tinted nothing beside a full
             cap sheet, which reads as a pane that failed to load rather than
             as a side of a table with nobody talking yet. */}
        <div className={`p-4 sm:p-5 bg-ink/40 border-t lg:border-t-0 lg:border-l border-line/70 min-w-0 space-y-3 ${talking ? '' : 'lg:self-start'}`}>
          <div className="label-sm">Where he stands</div>
          {talking ? (
            <ExtendContractForm
              leagueId={leagueId}
              playerId={playerId}
              capMode={capMode}
              contract={contract}
              /* The deal he is on now IS the left half of this room, on screen
                 and unscrolled. The panel's own copy of it would be the same
                 ledger twice at the same moment. */
              showCurrentDeal={false}
              onDone={done}
            />
          ) : (
            <p className="text-sm text-muted">{standing}</p>
          )}
        </div>
      </div>

      {/* ================= ON THE LINE BETWEEN THE TWO ================= */}
      {isOwnRoster && tag && (
        <div className="order-2 lg:order-3 px-4 sm:px-5 py-4 bg-raised/40 border-y lg:border-y-0 lg:border-t border-line/70 space-y-3">
          <ContractActions
            leagueId={leagueId}
            playerId={playerId}
            playerName={playerName}
            contract={contract}
            capSpace={capSpace}
            capMode={capMode}
            resignHref={resignHref}
            tag={tag}
            option={option}
            mode={mode}
            onMode={setMode}
            onDone={done}
            releaseReturnTo={releaseReturnTo}
            restructureNote={restructureNote}
          />
          {/* Present only in the couple of seconds after a move actually
              changed the number. It states the change; the cap page still
              states the state. Renders nothing at all otherwise, so the
              resting layout of this strip is exactly what it was. */}
          {cap.delta !== null && (
            <div className="flex items-center gap-2">
              <span className="label-sm">Cap space</span>
              <span className={`stat-value text-stat-md ${deltaTint(cap.delta)}`}>{formatMoney(capSpace)}</span>
              <DeltaChip delta={cap.delta} format={formatMoney} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
