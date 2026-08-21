'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Item { href: string; label: string }
interface Category { key: string; label: string; items: Item[] }

// Every real destination from the old flat 15-item bar, grouped into the
// categories a GM actually thinks in — front office, the market, the
// league around you — instead of one long strip of tabs.
const CATEGORIES: Category[] = [
  { key: 'home', label: 'Home', items: [{ href: '', label: 'Dashboard' }] },
  {
    key: 'team', label: 'Team', items: [
      { href: '/roster', label: 'Roster' },
      { href: '/depth-chart', label: 'Depth Chart' },
      { href: '/resign', label: 'Re-sign' },
      { href: '/cap', label: 'Cap' },
    ],
  },
  {
    key: 'market', label: 'Market', items: [
      { href: '/free-agency', label: 'Free Agency' },
      { href: '/trade', label: 'Trade' },
    ],
  },
  {
    key: 'draft', label: 'Draft', items: [
      { href: '/draft', label: 'Draft Board' },
      { href: '/scouting', label: 'Scouting Dept' },
    ],
  },
  {
    key: 'league', label: 'League', items: [
      { href: '/standings', label: 'Standings' },
      { href: '/schedule', label: 'Schedule' },
      { href: '/stats', label: 'Stats' },
      { href: '/news', label: 'News' },
      { href: '/history', label: 'History' },
    ],
  },
  // Dynasty is its own top-level category rather than a sub-tab under GM
  // Career. As a second-level item it only appeared once you were already in
  // that category, so the whole progression system — levels, XP, the skill
  // tree — was invisible to someone who had never clicked GM Career, and it
  // was reported as missing entirely.
  { key: 'gm', label: 'GM Career', items: [{ href: '/gm', label: 'GM Career' }] },
  { key: 'dynasty', label: 'Dynasty', items: [{ href: '/dynasty', label: 'Dynasty' }] },
  { key: 'system', label: 'System', items: [{ href: '/settings', label: 'Settings' }] },
];

export function LeagueNav({ leagueId }: { leagueId: string }) {
  const pathname = usePathname();
  const base = `/league/${leagueId}`;

  const isActive = (href: string) => (href === '' ? pathname === base : pathname.startsWith(`${base}${href}`));
  // Some real routes (e.g. a player detail page) live outside every nav
  // category on purpose — leave the whole nav unhighlighted rather than
  // guessing a parent, same as the old flat bar did for those routes.
  const activeCategory = CATEGORIES.find((c) => c.items.some((i) => isActive(i.href)));

  return (
    <div>
      <nav className="max-w-7xl mx-auto px-6 flex gap-1 overflow-x-auto overflow-y-hidden">
        {CATEGORIES.map((cat) => {
          const active = cat.key === activeCategory?.key;
          return (
            <Link
              key={cat.key}
              href={`${base}${cat.items[0].href}`}
              className={`${active ? 'nav-link-active' : 'nav-link'} whitespace-nowrap font-semibold`}
            >
              {cat.label}
            </Link>
          );
        })}
      </nav>
      {activeCategory && activeCategory.items.length > 1 && (
        <nav className="max-w-7xl mx-auto px-6 pb-2 flex gap-1 overflow-x-auto overflow-y-hidden border-t border-line/60 pt-1.5 mt-0.5">
          {activeCategory.items.map((item) => {
            const href = `${base}${item.href}`;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={href}
                className={`text-xs px-2.5 py-1 rounded-md whitespace-nowrap ${active ? 'text-accent2 bg-accent2/10' : 'text-muted hover:text-chalk'}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
