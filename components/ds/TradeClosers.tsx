'use client';

import type { TradeCloser, TradeClosersResult } from '@/lib/tradeClosers';

/**
 * ===========================================================================
 * WHAT WOULD CLOSE IT
 * ===========================================================================
 * The panel under a refusal that turns "no" into moves. Every row on it is a
 * package the other club has ALREADY been asked about — findTradeClosers puts
 * each candidate through the same evaluateTrade the verdict above ran and
 * keeps only the ones that came back accepted — so a row is a fact, not a
 * projection.
 *
 * WHAT IT DELIBERATELY DOES NOT SAY. Not one number about worth. The club's
 * value points are the price list its whole board runs on, and a panel that
 * printed "he'd cover 280 of the 340 you're short" would hand the GM the
 * engine instead of the negotiation. So a row is an ACTION and the club's own
 * football reason for it, and the only measure of size is the band on the
 * right — three words, read off the verified evaluation, in the same language
 * the acceptance meter already uses for the same idea.
 *
 * The rows are also not a restatement of anything above them: the meter says
 * how far off the CURRENT offer is and the club's quote says why it said no.
 * This says what to do about it.
 * ===========================================================================
 */

/**
 * Where the verified package landed against the club's line. `ROOM_TO_SPARE`
 * is drawn in the warning colour for the reason the meter draws its overshoot
 * that way: past their line is not more good, it is money you did not have to
 * spend, and a GM choosing between these should be able to see which of them
 * overpays without doing the sum himself.
 */
const BAND: Record<TradeCloser['band'], { label: string; className: string }> = {
  ONLY_JUST: { label: 'only just', className: 'text-accent' },
  COMFORTABLY: { label: 'comfortably', className: 'text-accent' },
  ROOM_TO_SPARE: { label: 'more than they need', className: 'text-warn' },
};

/**
 * The honest answer when the engine found nothing, which is a real outcome and
 * not an error. Each wording is only as strong as what was actually checked:
 * with the whole candidate set exhausted, "nothing you could add" is exact —
 * every single-asset change that could arithmetically have covered the gap was
 * put to the club. When the set outran the evaluation budget, the claim
 * narrows to the pieces that were tried.
 */
function emptyLine(result: TradeClosersResult): string {
  if (result.block === 'CAP') {
    return result.truncated
      ? 'Nothing that would clear their books on its own survives the value side of the deal.'
      : 'Nothing on its own clears their books. The money is the block here, not their read on the players.';
  }
  return result.truncated
    ? 'Nothing among the pieces big enough to cover this closes it on its own.'
    : 'Nothing you could add on its own gets this done — this one needs more than a single piece.';
}

export function TradeClosers({ result, loading, partnerAbbr, onApply }: {
  result: TradeClosersResult | null;
  loading: boolean;
  partnerAbbr: string;
  /** Sets the selection to this package, exactly as clicking the assets would. */
  onApply: (closer: TradeCloser) => void;
}) {
  if (!loading && !result) return null;

  return (
    <div className="rounded-md border border-line/70 bg-ink/40 px-3 py-2.5 space-y-2">
      <div className="label-sm inline-flex items-center gap-2">
        What would close it
        {/* Runs only while the request is open, and gates nothing: the verdict,
            the meter and the club's answer are all already on screen behind
            it. Under reduced motion the line below carries the state. */}
        {loading && <span className="spinner-ring text-muted" aria-hidden />}
      </div>

      {loading && <p className="text-xs text-muted">Putting the alternatives to their front office.</p>}

      {!loading && result && result.closers.length === 0 && (
        <p className="text-xs leading-relaxed text-muted">{emptyLine(result)}</p>
      )}

      {!loading && result && result.closers.length > 0 && (
        <>
          <p className="text-[11px] leading-relaxed text-muted">
            Each of these was put to them as written, and came back a yes.
          </p>
          <div className="space-y-1.5">
            {result.closers.map((c) => (
              <button
                key={`${c.move}:${c.asset.type}:${c.asset.id}`}
                type="button"
                onClick={() => onApply(c)}
                className="w-full text-left rounded-md border border-line/60 bg-card/60 px-3 py-2
                           hover:border-accent/50 hover:bg-accent/[0.07] focus-visible:border-accent/60
                           transition-colors duration-[var(--dur-tick)]"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold text-chalk">{c.action}</span>
                  <span className={`text-[10px] uppercase tracking-wider whitespace-nowrap ${BAND[c.band].className}`}>
                    {BAND[c.band].label}
                  </span>
                </div>
                {/* Attributed, because it is written in their voice — these are
                    the club's own notes on the man, the same ones the columns
                    above quote. */}
                <p className="text-[11px] leading-relaxed text-muted mt-1">
                  <span className="font-semibold text-chalk/75">{partnerAbbr}</span> · {c.reason}
                </p>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
