import { ratingColor, ratingMark, ratingPlateClass } from '@/lib/ratings';

const SIZE = {
  sm: { box: 'w-12 h-12', text: 'text-stat-sm', flag: 9 },
  md: { box: 'w-16 h-16', text: 'text-stat-md', flag: 12 },
  lg: { box: 'w-24 h-24', text: 'text-stat-lg', flag: 16 },
} as const;

// Same thresholds as ratingColor() (lib/ratings.ts) — kept in sync there
// deliberately rather than deriving one from the other, since ratingColor
// returns a Tailwind class name (for plain text) and this needs a literal
// hex for the clip-path corner flag.
function tierHex(v: number): string {
  if (v >= 88) return '#eab308'; // gold
  if (v >= 78) return '#4ade80'; // accent
  if (v >= 68) return '#38bdf8'; // accent2
  if (v >= 58) return '#5b5b63'; // chalk tier — neutral, not full white
  return '#3a3a40'; // muted/depth tier — barely there on purpose
}

/**
 * The proprietary rating shape — a notched-corner chip (echoing the
 * shield/hexagon crest language used for team logos) with a tier-colored
 * flag in the cut corner, not a plain rounded square. Same ratingColor()
 * tiers as everywhere else, so a gold 91 here means the same thing it does
 * in a roster table.
 */
export function RatingBadge({ value, label, size = 'md', filled }: {
  value: number; label?: string; size?: keyof typeof SIZE;
  /** Bolder tinted-fill treatment for hero contexts — still the notched
   * chip, just with presence to match a big player-card header instead of
   * blending into a sidebar. */
  filled?: boolean;
}) {
  const color = ratingColor(value);
  const hex = tierHex(value);
  const s = SIZE[size];
  return (
    <div className="inline-flex flex-col items-center gap-1">
      <div
        className={`rating-chip relative ${filled ? '' : 'panel'} ${s.box} flex items-center justify-center`}
        style={{
          borderColor: hex, borderWidth: filled ? 2 : 1,
          background: filled ? `${hex}1f` : undefined,
          ['--chip-notch' as never]: `${s.flag}px`,
        }}
      >
        <div className="rating-chip-flag" style={{ borderTopColor: hex }} />
        {/* The plate and the mark ride with the number wherever this chip is
            drawn. They are how the top two steps of the ramp stay legible
            without colour vision (see ratingTier in lib/ratings.ts) — a 95 and
            an 89 are both gold, and only the star separates them. Empty for
            everyone below 95, so no ordinary rating grows an ornament. */}
        <span className={`stat-value ${s.text} ${color}`}>
          <span className={ratingPlateClass(value) ?? undefined}>{value}</span>
          {ratingMark(value) && <span className="ml-1 text-[0.45em] align-super">{ratingMark(value)}</span>}
        </span>
      </div>
      {label && <span className="label-sm">{label}</span>}
    </div>
  );
}
