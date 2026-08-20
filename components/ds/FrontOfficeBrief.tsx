import { IconChevronRight } from './icons';

export interface BriefItem {
  category: 'Roster' | 'Scouting' | 'Contracts' | 'Trade Market' | 'Cap' | 'Trade Offers';
  text: string;
}

const CATEGORY_COLOR: Record<BriefItem['category'], string> = {
  Roster: 'text-accent2', Scouting: 'text-gold', Contracts: 'text-warn',
  'Trade Market': 'text-accent', Cap: 'text-bad', 'Trade Offers': 'text-accent2',
};

/**
 * The game's core differentiator gets a treatment that says so — a left
 * accent spine and per-item category kickers, not a plain gray list. Same
 * BriefItem category set as lib/frontOffice.ts, so wiring real data in
 * later is a straight prop swap.
 */
export function FrontOfficeBrief({ items }: { items: BriefItem[] }) {
  return (
    <div className="panel border-l-2 border-l-accent overflow-hidden">
      <div className="px-4 py-3 border-b border-line/70">
        <div className="section-eyebrow">Front Office</div>
        <div className="font-display font-bold text-sm uppercase tracking-wide">This Week's Brief</div>
      </div>
      <div className="divide-y divide-line/60">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-raised/50 transition-colors">
            <span className={`label-sm w-24 shrink-0 ${CATEGORY_COLOR[item.category]}`}>{item.category}</span>
            <span className="text-sm flex-1">{item.text}</span>
            <IconChevronRight size={16} className="text-muted shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
