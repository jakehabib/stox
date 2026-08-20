'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '', label: 'Dashboard' },
  { href: '/roster', label: 'Roster' },
  { href: '/depth-chart', label: 'Depth Chart' },
  { href: '/resign', label: 'Re-sign' },
  { href: '/free-agency', label: 'Free Agency' },
  { href: '/trade', label: 'Trade' },
  { href: '/draft', label: 'Draft' },
  { href: '/cap', label: 'Cap' },
  { href: '/standings', label: 'Standings' },
  { href: '/stats', label: 'Stats' },
  { href: '/schedule', label: 'Schedule' },
  { href: '/news', label: 'News' },
  { href: '/history', label: 'History' },
  { href: '/gm', label: 'GM Career' },
  { href: '/settings', label: 'Settings' },
];

export function LeagueNav({ leagueId }: { leagueId: string }) {
  const pathname = usePathname();
  const base = `/league/${leagueId}`;

  return (
    <nav className="max-w-7xl mx-auto px-6 pb-2 flex gap-1 overflow-x-auto">
      {NAV.map((item) => {
        const href = `${base}${item.href}`;
        // Dashboard ('') only matches the exact base route; every other tab
        // also covers its own sub-routes.
        const active = item.href === '' ? pathname === base : pathname.startsWith(href);
        return (
          <Link key={item.href} href={href} className={`${active ? 'nav-link-active' : 'nav-link'} whitespace-nowrap`}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
