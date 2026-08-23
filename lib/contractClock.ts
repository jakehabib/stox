/**
 * ===========================================================================
 * WHERE A DEAL IS ON ITS CLOCK — the words, in one place
 * ===========================================================================
 * Two states, one year apart, and the whole re-sign window turns on telling
 * them apart. The app owner has now been confused by our words for them twice:
 *
 *   *"what is the difference between walk year and expired?"*
 *   *"the term 'expired' on re-sign makes it feel like the contract is lost.
 *     maybe we just say 'expiring this offseason'"*
 *
 * He is right both times, and the second complaint says why the first
 * happened. "Expired" describes a parking permit, not a football contract: it
 * says the thing is over and gone. What `yearsRemaining === 0` actually means
 * is that the deal runs out at the end of THIS league year — the man is still
 * yours, nobody else may sign him, and he only walks if the window shuts with
 * him undecided. Every one of those is the opposite of "expired". Meanwhile
 * "walk year" is a real football term that a first-timer has no reason to
 * know, and it was carrying the OTHER state.
 *
 * So the two names say the one thing that separates them — WHEN he can leave —
 * and neither says he is already gone:
 *
 *   yearsRemaining === 0  →  "Expiring this offseason"  (his own phrase)
 *   yearsRemaining === 1  →  "One season left"
 *
 * They read cold, side by side, in either order. "Walk year" survives in the
 * glossary, where a term can be taught instead of assumed.
 *
 * WHY THIS IS A MODULE AND NOT TWO TERNARIES. It was two ternaries — the same
 * pair of pills written out twice inside ResignRow — beside a masthead tile, a
 * subtitle, a set-aside line and a glossary entry that each said it their own
 * way. That is this codebase's oldest defect (see the header of
 * lib/glossary.ts) and the reason the tile could say "Already Expired" while
 * the rows below it were about men who were still under contract. One export,
 * every surface, and a rewrite lands on all of them at once.
 *
 * WHY IT DOES NOT TAKE THE PHASE. It reads as though it should — contracts
 * age when a season ends, so surely the same number means different things in
 * March and in October. It does not: aging happens in the offseason roll, so
 * from the moment it runs until it runs again, `yearsRemaining === 1` means
 * exactly one more season of football owed, whether that season is upcoming or
 * being played. The count is already relative to the next kickoff. What DOES
 * depend on the phase is whether a decision is due, and that is the calling
 * page's business (see the cohort note in the re-sign page).
 * ===========================================================================
 */

export type ContractStage =
  /** No seasons left. Free agency at the end of this league year unless he is re-signed or tagged. */
  | 'UP'
  /** One season still owed — this year's, or the one about to start. Next year's decision. */
  | 'FINAL_SEASON'
  /** More than a season to run. Not a re-sign question yet. */
  | 'RUNNING';

export function contractStage(yearsRemaining: number | null | undefined): ContractStage {
  if (yearsRemaining == null || yearsRemaining >= 2) return 'RUNNING';
  return yearsRemaining <= 0 ? 'UP' : 'FINAL_SEASON';
}

/**
 * The pill a row wears, and the ink it wears it in.
 *
 * The colours moved with the words. "Expired" was `text-bad` — the red this
 * app uses for dead money and a lost game — over a man who is still on the
 * roster and can still be kept, which is the same false claim the word was
 * making. Urgency is amber here and the season-in-hand state is quiet ink,
 * which is also the honest ranking of the two: one is a deadline, the other
 * is a note.
 */
export const CONTRACT_STAGE_PILL: Record<Exclude<ContractStage, 'RUNNING'>, { label: string; className: string }> = {
  UP: { label: 'Expiring this offseason', className: 'border-warn/40 text-warn' },
  FINAL_SEASON: { label: 'One season left', className: 'border-line text-muted' },
};

/** The pill for a deal, or null for one with real years left — those wear nothing. */
export function contractStagePill(yearsRemaining: number | null | undefined) {
  const stage = contractStage(yearsRemaining);
  return stage === 'RUNNING' ? null : CONTRACT_STAGE_PILL[stage];
}

/**
 * The same fact as a sentence, for the places that have room for one — the
 * player card's contract face, where the reader is deciding rather than
 * scanning. Written to be true in any phase, for the reason in the header.
 */
export function contractClockSentence(yearsRemaining: number): string {
  if (yearsRemaining <= 0) {
    return 'His deal is up this offseason. He is still yours and nobody else may sign him — but his agent is taking calls, and he walks if the re-sign window shuts with him undecided.';
  }
  if (yearsRemaining === 1) {
    return 'He has one season left on his deal. Nothing is decided until it is played out — he is next offseason\'s question, not this one\'s.';
  }
  return `He is under contract for ${yearsRemaining} more seasons.`;
}

/**
 * WHOSE DEAL THE RE-SIGN WINDOW IS TAKING THIS LEAGUE YEAR.
 *
 * The re-sign screen filters on this, and it is exported so the player card
 * can decide whether pointing a Re-sign button at that screen would land a GM
 * on a list the man is not on. It is one rule with a price attached: once the
 * offseason roll has aged contracts, a man at 1 has a whole season still to
 * play and is deliberately kept off the window, because seeing him there beside
 * men who walk in a few clicks cost the app owner a contract — *"i just gave a
 * huge extension to someone thinking they needed it but really i had 1 more
 * year after to decide"*. Before the season ends nothing has aged yet, so the
 * men who will be free agents when it does are the ones in their final season.
 *
 * The long version of the reasoning lives over the query in the re-sign page,
 * next to the rule in lib/season.ts that actually releases people.
 */
export function resignListCutoff(phase: string): 0 | 1 {
  return phase === 'OFFSEASON' || phase === 'RESIGN' ? 0 : 1;
}
