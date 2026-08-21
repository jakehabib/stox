import Link from 'next/link';
import { positionBadgeClass } from './positionColor';

export interface AllStarHonor {
  playerId?: string;
  name: string;
  position: string;
  statLine: string;
}

/**
 * "Your guy made it." The dashboard's moment of finding out.
 *
 * All-Star rosters are named the week the regular season ends (lib/allStars.ts),
 * so this appears then and stays up through the postseason alongside the
 * season announcement — the same window in which a GM would actually be
 * hearing about it.
 *
 * Renders nothing when the club had nobody selected AND nobody close, which is
 * a real outcome for a bad roster and should read as silence rather than as an
 * empty panel headed "All-Stars: 0". The near-miss is shown when there is one
 * because being the first man out at a crowded position is a genuine story
 * about a real season, and it is the honest way to say "not this year".
 */
export function AllStarHonorRoll({
  seasonYear, leagueId, teamAbbr, honors, nearMiss,
}: {
  seasonYear: number;
  leagueId: string;
  teamAbbr: string;
  honors: AllStarHonor[];
  /**
   * The first man out, frozen at selection time (lib/allStars.ts
   * ALL_STAR_SNUB_TYPE). `note` is the placement — "first man out at EDGE in
   * the AFC" — written when the ranking happened, not re-derived here.
   */
  nearMiss: { name: string; position: string; statLine: string; note: string } | null;
}) {
  if (honors.length === 0 && !nearMiss) return null;

  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-line/70 flex items-baseline justify-between gap-3 flex-wrap">
        <div className="label-sm text-gold">⭐ {seasonYear} All-Stars</div>
        <div className="text-xs text-muted">
          {honors.length > 0
            ? `${honors.length} ${teamAbbr} player${honors.length === 1 ? '' : 's'} selected`
            : `No ${teamAbbr} players selected`}
        </div>
      </div>

      {honors.length > 0 && (
        <div className="divide-y divide-line/50">
          {honors.map((h) => {
            const row = (
              <div className="px-4 py-2.5 flex items-baseline gap-2.5">
                <span className={`font-semibold text-xs w-10 shrink-0 ${positionBadgeClass(h.position)}`}>{h.position}</span>
                <span className="font-medium text-sm truncate">{h.name}</span>
                <span className="text-xs text-muted truncate ml-auto text-right">{h.statLine}</span>
              </div>
            );
            return h.playerId ? (
              <Link key={h.playerId} href={`/league/${leagueId}/player/${h.playerId}`} className="block hover:bg-raised/40 transition-colors">
                {row}
              </Link>
            ) : (
              <div key={`${h.name}-${h.position}`}>{row}</div>
            );
          })}
        </div>
      )}

      {nearMiss && (
        <div className="px-4 py-2.5 border-t border-line/50 text-xs text-muted">
          <span className="font-medium text-chalk">{nearMiss.name}</span>{' '}
          <span className={positionBadgeClass(nearMiss.position)}>({nearMiss.position})</span>
          {nearMiss.note ? ` was the ${nearMiss.note}` : ' was the closest'} — {nearMiss.statLine}.
        </div>
      )}
    </div>
  );
}
