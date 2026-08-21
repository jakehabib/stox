import { ONE_SCORE_MARGIN, BLOWOUT_MARGIN, resultWeight } from '@/lib/gameShape';

/**
 * Margin-driven weight for a listed score.
 *
 * Everywhere this app lists a final score it currently renders a 28-point
 * humiliation and a one-point road win in identical type at identical
 * weight, while the margin needed to tell them apart is already sitting in
 * the row. This adds a channel; it removes nothing, changes no row height,
 * drops no column, and keeps the W/L letter, the logo and the opponent name
 * exactly where they were.
 *
 * Per principle 4, colour is never the only channel: every step is paired
 * with the margin figure itself and with type weight.
 *
 * Thresholds live in lib/gameShape.ts and were set against the real
 * distribution of 11,723 played games in a live save — the recap engine's
 * own BLOWOUT_MARGIN of 21 would mark 28% of the schedule, which is not a
 * marker, it is wallpaper.
 */

/** `mine–theirs`, with the beaten side's number dropped back on a rout. */
export function WeightedScore({ mine, theirs, className = '', size = 'text-stat-sm' }: {
  mine: number; theirs: number; className?: string; size?: string;
}) {
  const margin = mine - theirs;
  const weight = resultWeight(margin);
  const dim = 'text-muted font-bold';
  const won = margin > 0;

  return (
    <span
      className={`stat-value ${size} ${className} ${weight === 'tight' ? 'border-b-2 pb-px' : ''}`}
      style={weight === 'tight' ? { borderColor: 'color-mix(in srgb, var(--team-accent, #38bdf8) 70%, transparent)' } : undefined}
      title={weight === 'tight'
        ? `One-score game (${Math.abs(margin)} points)`
        : weight === 'decisive' ? `Decided by ${Math.abs(margin)}` : undefined}
    >
      <span className={weight === 'decisive' && !won ? dim : ''}>{mine}</span>
      <span className="text-muted font-normal">–</span>
      <span className={weight === 'decisive' && won ? dim : ''}>{theirs}</span>
    </span>
  );
}

/** `+8` / `-24`. Tiny, monospace, never a sentence. */
export function MarginTag({ margin, className = '' }: { margin: number; className?: string }) {
  if (margin === 0) return <span className={`font-mono text-[10px] text-muted ${className}`}>TIE</span>;
  return (
    <span className={`font-mono text-[10px] text-muted tabular-nums ${className}`} title={`Margin: ${Math.abs(margin)} points`}>
      {margin > 0 ? '+' : ''}{margin}
    </span>
  );
}

/**
 * The left rule that makes a season's shape read down a column: an accent
 * edge on your routs, a bad-toned one on your beatings. Only the outer
 * deciles get one, so it still means something when it appears.
 */
export function ResultRule({ margin }: { margin: number }) {
  if (resultWeight(margin) !== 'decisive') return <span aria-hidden className="w-[3px] shrink-0" />;
  return (
    <span
      aria-hidden
      className={`w-[3px] self-stretch rounded-sm shrink-0 ${margin > 0 ? 'bg-accent' : 'bg-bad'}`}
    />
  );
}

/** A small editorial kicker, in the vocabulary the News rows already use. */
export function ResultKicker({ label, tone = 'warn' }: { label: string; tone?: 'warn' | 'info' }) {
  return (
    <span
      className={`text-[9px] font-extrabold tracking-[0.13em] rounded-sm px-1.5 py-px ${
        tone === 'warn' ? 'bg-warn text-[#1a1200]' : 'bg-accent2 text-[#04202e]'
      }`}
    >
      {label}
    </span>
  );
}

export { ONE_SCORE_MARGIN, BLOWOUT_MARGIN };
