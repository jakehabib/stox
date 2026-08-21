'use client';

import { formatMoney } from '@/lib/cap';
import { needSeverity } from '@/lib/ai/gm';
import { loyaltyBand, type NegotiationSession } from '@/lib/negotiation';
import { TeamLogo } from '../TeamLogo';

/**
 * WHO ELSE WANTS HIM — the re-sign window's missing half.
 *
 * Free agency has always been a contest: three unknowns (his number, his term,
 * the rival's bid), two of them hidden, against a resource that runs out.
 * Re-signing your own player had the same sliders and no opponent, so the only
 * live question was how far you overpaid. This is the opponent.
 *
 * EVERY FIGURE HERE IS EVIDENCE, NOT ATMOSPHERE. The club, its cap room, its
 * need at his position and the number it would pay all come out of
 * `leadingCompetingBid` — the same function, at the same seed, over the same
 * `teamCapSummary` and `teamNeeds` the AI's own sealed-bid wave runs on. So
 * "Chicago is interested" is a claim you can go and check: open their roster
 * and the hole is there, open their cap page and the room is there, and if he
 * reaches the market they are the club that comes for him. A rumour generated
 * for the panel alone — a number that exists nowhere else in the simulation —
 * is precisely the lying metric README design principle 6 rules out, and this
 * project has shipped that bug more than once.
 *
 * WHAT IT CLAIMS DEPENDS ON WHERE HE IS, and the three cases are not
 * interchangeable copy:
 *
 *   FREE AGENT  — they can sign him today. This IS the bid you have to beat,
 *                 and `gate.competingApy` carries it, so the meter refuses to
 *                 promise a signing the auction would lose.
 *   FINAL_CALL  — his deal has expired. Nobody may sign a player who is under
 *                 contract to you, so this is never dressed as a bid you can
 *                 lose right now; it is leverage, and it is in his asking
 *                 price and his patience rather than in the gate.
 *   WALK_YEAR   — same, at a distance: a season still stands between him and
 *                 the market, so the same club counts for much less
 *                 (RESIGN_LEVERAGE).
 *
 * The window is read off his contract, not invented, and the copy for each is
 * literally true. An earlier draft rendered the walk-year line — "they cannot
 * touch him this season" — over free agents as well, which was false about a
 * player anyone in the league could sign that minute. Caught in the browser,
 * and worth the reminder that a shared component is a shared claim.
 */
export function SuitorRumour({ session }: { session: NegotiationSession }) {
  const { ctx, suitor } = session;
  // Three states, and they are genuinely different claims. On the open market
  // he can be signed out from under you today; in the re-sign window he cannot,
  // and how close the rumour is to becoming a bid depends on whether his
  // contract still has a season on it. Saying "they cannot touch him this
  // season" over a free agent would be flatly untrue, which is the whole class
  // of bug this component is built to avoid.
  const onTheMarket = !ctx.incumbent;
  const finalCall = ctx.resignWindow === 'FINAL_CALL';

  if (!suitor) {
    // The honest version of "nobody is calling". It is a real state — a
    // 33-year-old backup guard genuinely has no market — and saying so is
    // information, not an empty slot.
    return (
      <div className="text-xs px-3 py-2 rounded-lg border border-line bg-raised text-muted">
        <span className="font-semibold text-chalk">Nobody is circling.</span>{' '}
        No club in the league would get to him: the ones with a hole at {ctx.position} have either no room for
        him or better men to spend it on.
        {finalCall ? ' He can still walk when the window shuts — he just would not be walking into much.' : ''}
      </div>
    );
  }

  const severity = needSeverity(suitor.need);

  return (
    <div className={`px-3 py-2.5 rounded-lg border ${finalCall || onTheMarket ? 'border-bad/35 bg-bad/10' : 'border-warn/30 bg-warn/10'}`}>
      <div className="flex items-center gap-2.5">
        <TeamLogo seed={suitor.teamId} abbr={suitor.teamAbbr} size={30} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className={`label-sm text-[10px] ${finalCall || onTheMarket ? 'text-bad' : 'text-warn'}`}>
            {onTheMarket ? 'Bidding against you' : finalCall ? 'His agent is taking calls' : 'Someone is watching this one'}
          </div>
          <div className="text-sm font-semibold truncate">{suitor.teamName}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="label-sm text-[10px]">{onTheMarket ? 'Their bid' : 'Would go to'}</div>
          <div className="stat-value text-stat-sm">{formatMoney(suitor.apy)}/yr</div>
        </div>
      </div>

      {/* The receipts. Both figures are the ones their own GM bids on, so a
          user who does not believe the rumour can go and verify it. */}
      <div className="flex gap-1.5 flex-wrap mt-2">
        <span className="pill border-line text-muted text-[10px]">{formatMoney(suitor.capSpace)} of room</span>
        <span className={`pill border-line text-[10px] ${severity.className}`}>
          {severity.label} need at {ctx.position}
        </span>
        <span className="pill border-line text-muted text-[10px]">
          {suitor.starterOvr === null ? `Nobody on the roster at ${ctx.position}` : `Best they have: ${suitor.starterOvr} ovr`}
        </span>
      </div>

      <p className="text-[11px] text-muted mt-2">
        {onTheMarket
          ? 'He is on the open market and they can sign him today. This is the bid you have to beat, not a forecast.'
          : finalCall
            ? 'They cannot sign him while he is yours — but his deal is up, and one Advance from here he is theirs to bid on. He is negotiating like a man who knows it.'
            : 'They cannot touch him this season. His agent has still done the arithmetic, and it is in his asking price.'}
      </p>
    </div>
  );
}

/**
 * The other half of the same clock: what staying is currently worth to him,
 * and that it is running out.
 *
 * Stated as a BAND rather than a percentage on purpose. The exact discount is
 * a term of the hidden reservation price; printing it beside the public market
 * estimate would hand over most of the number the whole minigame asks you to
 * probe for. The band is derived from the real figure, so it never lies — it
 * is just coarse, in the way a GM's read on a player is coarse.
 */
export function LoyaltyLine({ session }: { session: NegotiationSession }) {
  const { ctx } = session;
  if (!ctx.incumbent) return null;
  const band = loyaltyBand(ctx.loyaltyDiscount);
  const finalCall = ctx.resignWindow === 'FINAL_CALL';

  const worth =
    band === 'LARGE' ? 'He is knocking a serious amount off his own price to stay.'
      : band === 'REAL' ? 'There is a real hometown discount in this.'
      : band === 'SLIGHT' ? 'There is a little left in the hometown discount.'
      : 'The hometown discount is gone. He is priced like anybody else.';

  return (
    <div className={`text-xs px-3 py-2 rounded-lg border ${finalCall ? 'border-line bg-raised text-muted' : 'border-accent/30 bg-accent/10 text-accent'}`}>
      <span className="font-semibold">{worth}</span>{' '}
      {finalCall
        ? 'Most of it went when his contract ran out — this is what a last call costs.'
        : 'It shrinks the moment his deal actually expires, so the cheapest day to do this is today.'}
    </div>
  );
}
