/**
 * ===========================================================================
 * WHY THIS CLUB CANNOT TAG THIS MAN — one answer, every screen
 * ===========================================================================
 * The app owner went looking for the franchise tag three times and did not
 * find it: *"is the franchise tag available for users? I haven't seen it
 * yet"*, *"I don't see any way to franchise tag someone"*, *"it should be a
 * large option players can notice"*. Part of that is where the control lives,
 * which is a layout problem. The other part is that OUTSIDE the re-sign window
 * there was no control anywhere and nothing on any screen said why — so the
 * game read as broken rather than as having a rule.
 *
 * A greyed control that names its reason teaches the rule. But the reason has
 * to be the SAME reason the server would give, and there are now three places
 * that need it: the player card, the re-sign row, and the impact preview
 * behind them both. Three copies of a four-branch rule is three chances to
 * grey a button for a reason the server does not hold — so it is written once,
 * here, in the same order `applyFranchiseTagAction` refuses in.
 *
 * The rules themselves are unchanged: one club, one tag, one league year; the
 * re-sign window only; a man whose deal is actually up; and the league setting
 * that can switch the whole thing off.
 * ===========================================================================
 */
export function franchiseTagBlockReason(opts: {
  /** `settings.franchiseTagEnabled`. */
  enabled: boolean;
  phase: string;
  /** PHASE_LABELS[phase] — named so the sentence can say where the league actually is. */
  phaseLabel: string;
  /** Years left on the deal the tag would replace. */
  yearsRemaining: number;
  /**
   * The man this club has ALREADY tagged this league year, if there is one and
   * he is not the player being asked about. Resolved by the caller from the
   * same query `applyFranchiseTag` guards on — a contract on this team with
   * `isFranchiseTag` and this `signedYear`.
   */
  heldBy?: { position: string; lastName: string } | null;
}): string | null {
  if (!opts.enabled) {
    return 'Franchise tags are switched off in this league. The commissioner can turn them back on in league settings.';
  }
  if (opts.phase !== 'RESIGN') {
    return `The tag goes on during the re-sign window, once the season is over. Right now: ${opts.phaseLabel}.`;
  }
  if (opts.yearsRemaining !== 0) {
    return 'The tag is for a man whose deal is up. His has a season left on it — nobody can sign him before that.';
  }
  if (opts.heldBy) {
    return `Your tag is already on ${opts.heldBy.position} ${opts.heldBy.lastName} this year — one club, one tag, one league year.`;
  }
  return null;
}
