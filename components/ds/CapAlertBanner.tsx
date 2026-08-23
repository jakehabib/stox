import Link from 'next/link';
import { formatMoney } from '@/lib/cap';
import { positionBadgeClass } from './positionColor';

export interface CapAlertMove {
  playerId: string;
  name: string;
  position: string;
  frees: number;
  kind: 'CUT' | 'RESTRUCTURE';
}

/**
 * Standing "you are over the salary cap" bar. Rendered from the league
 * layout, so it follows the user onto every screen instead of waiting for
 * them to visit the Cap page — being over is a blocking condition, not a
 * detail on one report.
 *
 * It always names the way out. A warning that only says "you're over"
 * leaves the user hunting; the two or three concrete moves here come from
 * the same capReliefOptions() the transaction errors and the advancement
 * block quote, so every surface tells one story.
 *
 * ...AND IT NOW OPENS ON THE MOVE IT NAMED. The relief pills read "Release to
 * free $8.4M" and landed on the man's receiving yards — one click short of the
 * thing the pill promised. Because this bar renders from the league layout it
 * followed the GM onto every screen while he was over the cap, so that was the
 * most-travelled dead end in the product. `?view=contract` is the same
 * convention the free-agency Negotiate button and the re-sign row already use
 * (see PlayerCardTabs' ARRIVING note): arriving from money opens on money.
 */
export function CapAlertBanner({
  leagueId, shortfall, capUsed, capTotal, deadMoney, moves, blocksAdvance, complianceDue,
}: {
  leagueId: string;
  shortfall: number;
  capUsed: number;
  capTotal: number;
  deadMoney: number;
  moves: CapAlertMove[];
  /** True when the compliance gate will refuse to advance the week. */
  blocksAdvance: boolean;
  /**
   * False during the offseason roll, when every team's books are
   * temporarily inflated and expiring deals haven't come off yet
   * (see capComplianceDueNow in lib/season.ts).
   */
  complianceDue: boolean;
}) {
  return (
    <div className="border-b border-bad/40 bg-bad/10">
      <div className="max-w-7xl mx-auto px-6 py-2.5 flex items-center gap-x-5 gap-y-2 flex-wrap">
        <div className="flex items-baseline gap-2.5 shrink-0">
          <span className="label-sm text-bad">Over the cap</span>
          <span className="stat-value text-stat-sm text-bad">{formatMoney(shortfall)}</span>
        </div>

        <div className="text-xs text-muted shrink-0">
          {formatMoney(capUsed)} committed / {formatMoney(capTotal)} ceiling
          {deadMoney > 0 && <span className="text-bad"> · {formatMoney(deadMoney)} dead</span>}
        </div>

        <div className="text-xs text-muted flex-1 min-w-[12rem]">
          {/* "the week advances anyway" without the price attached read as
              "and nothing happens". A club that closes a league year over the
              ceiling now carries the overage into the next one as dead money
              (settleClosingYearCapOverage, lib/season.ts), so the line that
              says you are not stuck has to say what standing still costs. */}
          {!complianceDue
            ? 'Expiring contracts come off your books when free agency opens. Be under the ceiling before this season closes — whatever you are still over by then carries into next year as dead money.'
            : blocksAdvance
              ? 'The week will not advance until you are compliant.'
              : 'No cut or restructure clears this on its own — a trade that sends salary out is the only route left. The week still advances, but whatever you are over by when the season ends carries into next year as dead money.'}
        </div>

        {moves.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {moves.map((m) => (
              <Link
                key={`${m.kind}-${m.playerId}`}
                href={`/league/${leagueId}/player/${m.playerId}?view=contract`}
                className="pill border-line bg-raised hover:border-bad/50 gap-1.5"
                title={`${m.kind === 'CUT' ? 'Release' : 'Restructure'} to free ${formatMoney(m.frees)}`}
              >
                <span className={`font-semibold ${positionBadgeClass(m.position)}`}>{m.position}</span>
                <span className="text-chalk">{m.name}</span>
                <span className="font-mono text-accent">+{formatMoney(m.frees)}</span>
              </Link>
            ))}
          </div>
        )}

        <Link href={`/league/${leagueId}/cap`} className="btn-danger text-xs px-2.5 py-1 shrink-0">
          Fix the Cap
        </Link>
      </div>
    </div>
  );
}
