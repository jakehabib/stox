import { ratingColor, ratingStep } from '@/lib/ratings';

const SIZE = {
  sm: { box: 'w-12 h-12', text: 'text-stat-sm', flag: 9 },
  md: { box: 'w-16 h-16', text: 'text-stat-md', flag: 12 },
  lg: { box: 'w-24 h-24', text: 'text-stat-lg', flag: 16 },
} as const;

// Same thresholds as ratingStep() (lib/ratings.ts) — kept in sync there
// deliberately rather than deriving one from the other, since ratingStep
// returns a class name (for plain text) and this needs a literal hex for
// the clip-path corner flag. The VALUES now follow the single sequential
// ramp: one neutral family stepped by intensity, with the accent reserved
// for the top tier alone. They are no longer four categorical hues.
function tierHex(v: number): string {
  if (v >= 88) return '#4ade80'; // accent — elite, and the only tier that gets a hue
  if (v >= 78) return '#f3f2ec'; // chalk — full intensity
  if (v >= 68) return '#8f8e8a'; // chalk, dimmed
  return '#5b5b63'; // neutral floor — barely there on purpose
}

/**
 * The proprietary rating shape — a notched-corner chip (echoing the
 * shield/hexagon crest language used for team logos) with a tier-colored
 * flag in the cut corner, not a plain rounded square. Same ratingStep()
 * ramp as everywhere else, so a green 91 here means the same thing it does
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
  const step = ratingStep(value);
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
        <span className={`stat-value ${s.text} ${color}`}>{value}</span>
        {/* Redundant non-colour cue for the extreme steps — the chip must not
            rely on its flag hue to say "elite" or "below average". */}
        {step.mark && (
          <span
            className={`absolute bottom-0.5 right-1 text-[9px] leading-none ${color}`}
            aria-label={step.markLabel}
            title={step.markLabel}
          >
            {step.mark}
          </span>
        )}
      </div>
      {label && <span className="label-sm">{label}</span>}
    </div>
  );
}
