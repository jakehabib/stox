import { IconHome, IconShield, IconTrophy, IconSwap, IconMore } from './icons';

const ITEMS = [
  { Icon: IconHome, label: 'Home' },
  { Icon: IconShield, label: 'Team' },
  { Icon: IconTrophy, label: 'League' },
  { Icon: IconSwap, label: 'Market' },
  { Icon: IconMore, label: 'More' },
];

/**
 * Concept only — not wired to routing yet. A mobile IA decision (collapsing
 * today's 14 top-level sections into 5 buckets with sub-navigation inside
 * each) belongs to the mobile-polish stage, not this token pass. Active
 * state uses --team-text (a lightened, legible variant of --team-accent —
 * see globals.css), not a generic accent color, so the nav itself reads as
 * "your team's app" without risking unreadable text for a dark team color.
 */
export function BottomNav({ active = 0 }: { active?: number }) {
  return (
    <div className="flex items-stretch border-t border-line bg-card">
      {ITEMS.map(({ Icon, label }, i) => (
        <button
          key={label}
          className="flex-1 flex flex-col items-center gap-1 py-2.5 text-xs font-medium text-muted"
          style={i === active ? { color: 'var(--team-text)' } : undefined}
        >
          <Icon size={20} />
          {label}
        </button>
      ))}
    </div>
  );
}
