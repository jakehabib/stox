'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

interface Item {
  href: string;
  label: string;
  /**
   * An href that is NOT relative to /league/<id>. The nav is otherwise a
   * league-scoped bar, but the public leaderboard is a global page a player
   * should be able to reach from inside a save without going home first.
   */
  absolute?: boolean;
}
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
      // Read-only derivations over what the save already produced — it sits
      // under Team because every panel on it is about this club's roster,
      // money and results, and after Cap because it reads the cap sheet.
      { href: '/analytics', label: 'Analytics' },
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
      { href: '/power-rankings', label: 'Power Rankings' },
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
  // The public board sits under Dynasty because that is the screen whose
  // number it publishes. Absolute, because it is not a page of this league.
  {
    key: 'dynasty', label: 'Dynasty', items: [
      { href: '/dynasty', label: 'Dynasty' },
      { href: '/leaderboard', label: 'Leaderboard', absolute: true },
    ],
  },
  { key: 'system', label: 'System', items: [{ href: '/settings', label: 'Settings' }] },
];

/**
 * BADGES — WHERE A DECISION IS WAITING.
 *
 * Measured across a full league year: twenty-nine presses of Advance, and the
 * button posed a question the GM could have answered differently once. Every
 * real decision in this game — the depth chart, a trade, a cut, an extension,
 * a bid — is something he has to go LOOKING for, and this bar could not tell
 * him any of it was there. Twenty-three destinations, no indicator of any kind
 * on any of them; incoming trade offers rendered inside /trade and nowhere
 * else, so nobody who did not already open that page knew a club was waiting
 * on him.
 *
 * The rule every count here has to pass is that it must be OFF most of the
 * time. A badge that is always lit is furniture, and the second one becomes
 * furniture it also stops working for the times it mattered. That is why the
 * re-sign count is collected only while the window is open and why free agency
 * carries no badge at all: the size of the free-agent pool is non-zero every
 * week the market exists, and a number that never changes state is not news.
 *
 * The other rule is that every count must be the number the SYSTEM uses. These
 * are computed in app/league/[id]/layout.tsx against the same queries the
 * destination pages run — the nav does not count anything itself, and there is
 * no second definition of "expiring" or "unmanned" living in this file.
 */
export function LeagueNav({ leagueId, counts = {} }: {
  leagueId: string;
  /** Item href -> pending decisions there. Zero or absent draws nothing. */
  counts?: Record<string, number>;
}) {
  const pathname = usePathname();
  const base = `/league/${leagueId}`;
  /**
   * WHICH CATEGORY'S SUB-ROW IS SHOWING, when it is not the one you are in.
   *
   * The sub-row used to render for the ACTIVE category only, so fourteen of
   * the twenty-two destinations did not exist on screen until the GM had
   * already navigated into their category on a guess. On the dashboard he saw
   * eight words: Depth Chart, Re-sign, Cap and Analytics were all behind
   * "Team", and Standings, Power Rankings, Schedule, Stats, News and History
   * were all behind "League". This file already records the same bug being
   * found and fixed once, for Dynasty — "the whole progression system was
   * invisible to someone who had never clicked GM Career, and it was reported
   * as missing entirely" — and the pattern was still live for six categories.
   *
   * Hovering or tabbing to a category swaps the sub-row to that category's
   * items, in place, rather than opening a floating menu: the row is already
   * there, it is already the right shape, and a panel that overlays the page
   * would have to be dismissed. Single-item categories never take the row,
   * because emptying it would move the whole page up under the cursor.
   */
  const [peek, setPeek] = useState<string | null>(null);

  const hrefFor = (item: Item) => (item.absolute ? item.href : `${base}${item.href}`);
  // An absolute item is never "active" from inside a league — you are on a
  // league page, so highlighting it would claim you are somewhere you are not.
  const isActive = (item: Item) =>
    item.absolute ? false : item.href === '' ? pathname === base : pathname.startsWith(`${base}${item.href}`);
  // Some real routes (e.g. a player detail page) live outside every nav
  // category on purpose — leave the whole nav unhighlighted rather than
  // guessing a parent, same as the old flat bar did for those routes.
  const activeCategory = CATEGORIES.find((c) => c.items.some((i) => isActive(i)));

  const countFor = (item: Item) => (item.absolute ? 0 : counts[item.href] ?? 0);
  // A category wears the sum of what is waiting inside it, because the item
  // that owns the number is invisible until the row is open.
  const countForCategory = (cat: Category) => cat.items.reduce((n, i) => n + countFor(i), 0);

  // Hovering a multi-item category previews its row; anything else falls back
  // to where you actually are, so the bar never empties under the cursor.
  const peeked = peek ? CATEGORIES.find((c) => c.key === peek) : null;
  const shown = peeked && peeked.items.length > 1 ? peeked : activeCategory;

  return (
    <div
      onMouseLeave={() => setPeek(null)}
      // focusout bubbles, so this fires for every link in the bar — the
      // relatedTarget check is what keeps the row open while a keyboard user
      // is tabbing from a category INTO the row it just opened, and closes it
      // only once focus has left the nav entirely.
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPeek(null); }}
    >
      <nav className="max-w-7xl mx-auto px-6 flex gap-1 overflow-x-auto overflow-y-hidden">
        {CATEGORIES.map((cat) => {
          const active = cat.key === activeCategory?.key;
          const pending = countForCategory(cat);
          return (
            <Link
              key={cat.key}
              href={hrefFor(cat.items[0])}
              // Focus as well as hover, so the row opens for a keyboard too —
              // tabbing along the bar walks the same preview a mouse gets.
              onMouseEnter={() => setPeek(cat.key)}
              onFocus={() => setPeek(cat.key)}
              className={`${active ? 'nav-link-active' : 'nav-link'} whitespace-nowrap font-semibold inline-flex items-center gap-1.5`}
            >
              {cat.label}
              {pending > 0 && (
                <span
                  className="min-w-[1.05rem] px-1 h-[1.05rem] rounded-full bg-accent2 text-ink text-[10px] font-bold leading-[1.05rem] text-center"
                  aria-label={`${pending} waiting`}
                >
                  {pending}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      {shown && shown.items.length > 1 && (
        <nav className="max-w-7xl mx-auto px-6 pb-2 flex gap-1 overflow-x-auto overflow-y-hidden border-t border-line/60 pt-1.5 mt-0.5">
          {shown.items.map((item) => {
            const href = hrefFor(item);
            const active = isActive(item);
            const pending = countFor(item);
            return (
              <Link
                key={item.href}
                href={href}
                className={`text-xs px-2.5 py-1 rounded-md whitespace-nowrap inline-flex items-center gap-1.5 ${active ? 'text-accent2 bg-accent2/10' : 'text-muted hover:text-chalk'}`}
              >
                {item.label}
                {pending > 0 && (
                  <span className="min-w-[1rem] px-1 rounded-full bg-accent2 text-ink text-[10px] font-bold text-center">
                    {pending}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
