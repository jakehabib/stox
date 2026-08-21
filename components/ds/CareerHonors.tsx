import { positionBadgeClass } from './positionColor';

export interface HonorAward {
  year: number;
  /** Display label, e.g. "MVP" — the caller maps the Transaction type. */
  label: string;
  statLine: string;
}

/**
 * A veteran's résumé: the rings, the trophies, and the career line that
 * earned them. Rendered as a dense .panel rather than a .card — this is the
 * player's record, not a second object on the page, and it sits directly
 * under the hero that already introduced him.
 *
 * Renders nothing at all when there's nothing to show, which is the common
 * case: most of a roster is young, and a rookie with an empty trophy shelf
 * should simply not have a trophy shelf on his card.
 */
export function CareerHonors({
  position, ringYears, awards, allStarYears = [], careerHighlights, seasons,
}: {
  position: string;
  ringYears: number[];
  awards: HonorAward[];
  /**
   * Seasons he was named an All-Star, oldest first — the years he EARNED it
   * from his production (lib/allStars.ts), never a read of his rating. It
   * accumulates the way a real résumé does: three of these make him a
   * "3x All-Star", and that is a sentence about three seasons that happened.
   */
  allStarYears?: number[];
  /** Two or three headline career totals, pre-formatted by the caller. */
  careerHighlights: { label: string; value: string }[];
  seasons: number;
}) {
  if (ringYears.length === 0 && awards.length === 0 && allStarYears.length === 0 && careerHighlights.length === 0) return null;

  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-line/70 flex items-baseline justify-between gap-3 flex-wrap">
        <div className="label-sm">Career &amp; Honors</div>
        <div className="text-xs text-muted">
          <span className={`font-semibold ${positionBadgeClass(position)}`}>{position}</span>
          {seasons > 0 && <> · {seasons} pro season{seasons === 1 ? '' : 's'} on record</>}
        </div>
      </div>

      {(ringYears.length > 0 || awards.length > 0 || allStarYears.length > 0) && (
        <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-line/40 border-b border-line/60">
          <div className="px-4 py-3">
            <div className="label-sm">Championships</div>
            <div className={`stat-value text-stat-md leading-none mt-1 ${ringYears.length > 0 ? 'text-gold' : ''}`}>
              {ringYears.length}
            </div>
            {ringYears.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {ringYears.map((y) => (
                  <span key={y} className="pill border-gold/40 text-gold bg-gold/10 text-[10px]">🏆 {y}</span>
                ))}
              </div>
            )}
          </div>
          <div className="px-4 py-3 sm:col-span-2">
            {allStarYears.length > 0 && (
              <div className="mb-3 pb-3 border-b border-line/40">
                <div className="label-sm">All-Star</div>
                <div className="flex items-baseline gap-2 flex-wrap mt-1">
                  <span className="stat-value text-stat-md leading-none text-gold">
                    {allStarYears.length}&times;
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {allStarYears.map((y) => (
                      <span key={y} className="pill border-gold/40 text-gold bg-gold/10 text-[10px]">&#11088; {y}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="label-sm">Awards</div>
            {awards.length === 0 ? (
              <div className="text-sm text-muted mt-1.5">None — he has never finished a season as a league honoree.</div>
            ) : (
              <div className="mt-1.5 space-y-1">
                {awards.map((a) => (
                  <div key={`${a.year}-${a.label}`} className="flex items-baseline gap-2 text-sm">
                    <span className="font-mono text-muted text-xs w-10 shrink-0">{a.year}</span>
                    <span className="text-gold font-medium shrink-0">{a.label}</span>
                    <span className="text-xs text-muted truncate">{a.statLine}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {careerHighlights.length > 0 && (<>
        {/* Regular season, which is what "career stats" means on every real
            football reference — and here it is literally what the column
            holds, since the postseason lives in its own bucket. Labelled so
            the number can't be read as a combined total. */}
        <div className="px-4 pt-3 -mb-1 label-sm">Career · regular season</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-line/40">
          {careerHighlights.map((h) => (
            <div key={h.label} className="px-4 py-3">
              <div className="label-sm">{h.label}</div>
              <div className="stat-value text-stat-sm leading-none mt-1">{h.value}</div>
            </div>
          ))}
        </div>
      </>)}
    </div>
  );
}
