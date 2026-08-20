import { CATEGORY_COLOR, type NewsCategory } from './NewsRow';

interface TickerItem { category: NewsCategory; headline: string }

/**
 * Ambient, passive flavor only — a scrolling strip of things that already
 * happened around the league, not a place for anything the player needs to
 * act on or reliably see (that stays in the static UI: Front Office Brief,
 * roster alerts, cap space in the header). If it scrolled past unread,
 * nothing important was missed.
 */
export function LeagueWireTicker({ items }: { items: TickerItem[] }) {
  if (items.length === 0) return null;
  // Duplicated once so the marquee loops seamlessly at -50%.
  const loop = [...items, ...items];

  return (
    <div className="border-b border-line bg-surface/60 overflow-hidden flex items-center text-xs">
      <div className="label-sm shrink-0 px-3 py-1.5 border-r-2 border-accent2/40 bg-raised text-accent2">League Wire</div>
      <div className="ticker-track flex items-center whitespace-nowrap py-1.5 pl-4">
        {loop.map((item, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 px-4 shrink-0">
            <span className={`font-semibold ${CATEGORY_COLOR[item.category]}`}>{item.category}</span>
            <span className="text-muted">{item.headline}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
