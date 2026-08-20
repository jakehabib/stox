import { ratingColor } from '@/lib/ratings';

const SIZE = {
  sm: { box: 'w-12 h-12', text: 'text-stat-sm' },
  md: { box: 'w-16 h-16', text: 'text-stat-md' },
  lg: { box: 'w-24 h-24', text: 'text-stat-lg' },
} as const;

const TIER_BORDER: Record<string, string> = {
  'text-gold': 'border-b-gold',
  'text-accent': 'border-b-accent',
  'text-accent2': 'border-b-accent2',
  'text-chalk': 'border-b-line',
  'text-muted': 'border-b-line',
};

/**
 * The one distinctive reusable treatment for a rating (OVR, potential
 * ceiling, scouted grade) — a squared tile with a tier-colored bottom
 * accent, not just colored text. Same ratingColor() tiers used everywhere
 * else in the app, so a "gold" 91 here means the same thing it does in a
 * roster table.
 */
export function RatingBadge({ value, label, size = 'md' }: { value: number; label?: string; size?: keyof typeof SIZE }) {
  const color = ratingColor(value);
  const s = SIZE[size];
  return (
    <div className="inline-flex flex-col items-center gap-1">
      <div className={`panel ${s.box} flex items-center justify-center border-b-2 ${TIER_BORDER[color]}`}>
        <span className={`stat-value ${s.text} ${color}`}>{value}</span>
      </div>
      {label && <span className="label-sm">{label}</span>}
    </div>
  );
}
