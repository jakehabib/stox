import Link from 'next/link';

export interface BriefItem {
  category: 'Roster' | 'Scouting' | 'Contracts' | 'Trade Market' | 'Cap' | 'Trade Offers';
  headline: string;
  detail: string;
  action: string;
  /** Where the action button goes. Renders a plain button (inert) when omitted. */
  href?: string;
}

const CATEGORY_COLOR: Record<BriefItem['category'], string> = {
  Roster: 'text-accent2 border-accent2/40', Scouting: 'text-gold border-gold/40', Contracts: 'text-warn border-warn/40',
  'Trade Market': 'text-accent border-accent/40', Cap: 'text-bad border-bad/40', 'Trade Offers': 'text-accent2 border-accent2/40',
};

/**
 * The game's core differentiator gets a treatment that says so: a headline
 * (not a plain sentence), and — the actual point of a "brief" — a concrete
 * next action per item, not a chevron implying "go read more elsewhere."
 * Same BriefItem category set as lib/frontOffice.ts, so wiring real data in
 * later is close to a straight prop swap.
 */
export function FrontOfficeBrief({ items, weekLabel }: { items: BriefItem[]; weekLabel?: string }) {
  return (
    <div className="panel border-l-2 border-l-accent overflow-hidden">
      <div className="px-4 py-3 border-b border-line/70">
        <div className="section-eyebrow">Front Office</div>
        <div className="font-display font-bold text-sm uppercase tracking-wide">
          This Week's Brief{weekLabel ? ` — ${weekLabel}` : ''}
        </div>
      </div>
      <div className="divide-y divide-line/60">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <span className={`pill ${CATEGORY_COLOR[item.category]} mb-1.5`}>{item.category}</span>
              <div className="text-sm font-semibold">{item.headline}</div>
              <div className="text-xs text-muted mt-0.5">{item.detail}</div>
            </div>
            {item.href ? (
              <Link href={item.href} className="btn-secondary text-xs shrink-0 whitespace-nowrap">{item.action}</Link>
            ) : (
              <button className="btn-secondary text-xs shrink-0 whitespace-nowrap">{item.action}</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
