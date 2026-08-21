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
 */
export function CapAlertBanner({
  leagueId, shortfall, capUsed, capTotal, deadMoney, moves, blocksAdvance,
}: {
  leagueId: string;
  shortfall: number;
  capUsed: number;
  capTotal: number;
  deadMoney: number;
  moves: CapAlertMove[];
  /** True when the compliance gate will refuse to advance the week. */
  blocksAdvance: boolean;
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
          {blocksAdvance
            ? 'The week will not advance until you are compliant.'
            : 'No cut or restructure clears this on its own — a trade that sends salary out is the only route left, so the week is still allowed to advance.'}
        </div>

        {moves.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {moves.map((m) => (
              <Link
                key={`${m.kind}-${m.playerId}`}
                href={`/league/${leagueId}/player/${m.playerId}`}
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
