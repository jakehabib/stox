const ITEMS = [
  { icon: '🏠', label: 'Home' },
  { icon: '🛡️', label: 'Team' },
  { icon: '🏈', label: 'League' },
  { icon: '🔁', label: 'Market' },
  { icon: '⋯', label: 'More' },
];

/**
 * Concept only — not wired to routing yet. A mobile IA decision (collapsing
 * today's 14 top-level sections into 5 buckets with sub-navigation inside
 * each) belongs to the mobile-polish stage, not this token pass.
 */
export function BottomNav({ active = 0 }: { active?: number }) {
  return (
    <div className="flex items-stretch border-t border-line bg-card">
      {ITEMS.map((item, i) => (
        <button
          key={item.label}
          className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-xs font-medium ${i === active ? 'text-accent' : 'text-muted'}`}
        >
          <span className="text-base leading-none">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>
  );
}
