import { ratingStep } from '@/lib/ratings';

const SIZE = {
  xs: 'text-xs',
  sm: 'text-stat-sm',
  md: 'text-stat-md',
  lg: 'text-stat-lg',
  xl: 'text-stat-xl',
} as const;

const MARK_SIZE: Record<keyof typeof SIZE, string> = {
  xs: 'text-[7px]', sm: 'text-[9px]', md: 'text-[10px]', lg: 'text-xs', xl: 'text-sm',
};

/**
 * A rating figure rendered against the app's single sequential ramp.
 *
 * The ramp itself lives in ratingStep() (lib/ratings.ts) — this is just the
 * one place that draws it, so the redundant non-colour cue can't be
 * forgotten at a call site. The top and bottom steps carry a glyph as well
 * as a weight/intensity change; the two middle steps carry neither, because
 * "normal" should not announce itself.
 *
 * `display` exists for fogged views, where the honest thing to show is a
 * range ("60-89") but the ramp still has to read from a single number.
 */
export function RatingValue({
  value, display, size = 'sm', className, title, mark = true,
}: {
  /** The number the ramp reads from. */
  value: number;
  /** What is actually printed. Defaults to `value`; pass a range for a fogged read. */
  display?: React.ReactNode;
  size?: keyof typeof SIZE;
  className?: string;
  title?: string;
  /**
   * Suppress the tier glyph. Set this when `display` is a fogged RANGE: the
   * point estimate the glyph is derived from is deliberately hidden, so a
   * mark next to "82-98" but not next to "74-96" reads as arbitrary. The
   * range itself is the redundant non-colour encoding in that case.
   */
  mark?: boolean;
}) {
  const step = ratingStep(value);
  return (
    <span className={`inline-flex items-baseline gap-0.5 ${className ?? ''}`} title={title}>
      <span className={`stat-value ${SIZE[size]} ${step.className}`}>{display ?? value}</span>
      {mark && step.mark && (
        <span className={`${MARK_SIZE[size]} ${step.className} leading-none`} aria-label={step.markLabel} title={step.markLabel}>
          {step.mark}
        </span>
      )}
    </span>
  );
}
