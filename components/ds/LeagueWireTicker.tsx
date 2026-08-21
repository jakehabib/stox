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
      {/* Stacked above the track: the marquee is a later sibling, so without an
          explicit z-index the scrolling headlines paint straight over this
          label as they exit left. */}
      <div className="relative z-10 label-sm shrink-0 px-3 py-1.5 border-r-2 border-accent2/40 bg-raised text-accent2">League Wire</div>
      {/* A short fade where headlines pass behind the label. The label already
          sits on top (z-10 above), so nothing paints over it — but content
          reappearing at a hard edge gets chopped mid-word, which reads as a
          rendering bug rather than as a marquee. The gradient makes items
          arrive and leave instead of being sliced. */}
      <div className="relative z-[9] w-8 shrink-0 -ml-px bg-gradient-to-r from-surface to-transparent pointer-events-none" />
      <div className="ticker-track flex items-center whitespace-nowrap py-1.5 -ml-8 pl-8">
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
