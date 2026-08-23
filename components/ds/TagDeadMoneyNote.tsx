import { formatMoney } from '@/lib/cap';

/**
 * WHAT THE TAG COSTS THAT IS NOT THE TAG — one sentence, two screens.
 *
 * Since the tag started booking the old deal's unamortised signing bonus
 * (applyFranchiseTag, INV-21's second clause) the re-sign row has named that
 * figure BEFORE the press rather than in the receipt afterwards, because the
 * move is irreversible and once a year. The player card now offers the same
 * move, so it owes the same sentence — and a sentence about money that exists
 * twice is a sentence that will eventually say two different things.
 *
 * The FIGURE is not computed here and must not be: both callers are handed it
 * by their page, from `unamortizedBonus(contract, capMode)` — the same
 * function `applyFranchiseTag` charges. A component that recomputed it would
 * be a second opinion about a number the server already owns, which is exactly
 * how the two paths would come to disagree.
 *
 * Zero in every cap mode but Realistic, and zero on most deals; the line is
 * simply absent then rather than printing $0.0M at a reader.
 */
export function TagDeadMoneyNote({ name, amount }: { name: string; amount: number }) {
  if (!(amount > 0)) return null;
  return (
    <p className="text-xs text-warn">
      Tagging {name} does not end his old contract&apos;s accounting. {formatMoney(amount)} of signing
      bonus the club has already paid him has not finished amortising, and it lands on this year&apos;s cap as
      dead money the moment the tag is signed — on top of the tag itself. That bonus is owed either way:
      letting him walk charges the same figure.
    </p>
  );
}
