import Link from 'next/link';

/**
 * LEAGUE / MY TEAM — A REAL TAB PAIR, AND IT LIVES IN THE URL.
 *
 * This was a pill beside the Basic/Advanced pills and the Regular/Playoffs
 * pills, which is three rows of near-identical controls saying three unrelated
 * things: WHICH PLAYERS, HOW MUCH DETAIL, WHICH HALF OF THE YEAR. The first of
 * those is the page's own division — the two tabs are separate pages with
 * separate jobs, not a filter on one — so it gets the shape that says so.
 *
 * WHY THE URL, WHEN `DraftViewToggle` AND `PlayerCardTabs` ARE CLIENT STATE.
 * Read DraftViewToggle's header for the reasoning this deliberately departs
 * from: both of those have BOTH panes server-rendered when the page paints, so
 * switching is a re-reveal and a navigation would only cost the reader his
 * scroll position. These two are genuinely different work — the League tab
 * ranks a whole league's stat lines, the My Team tab builds a depth chart, a
 * rank book and six verdict cards — and rendering both on every paint to save
 * a navigation would be the wrong trade twice over. Keeping it on the URL also
 * makes a view linkable, which is the same reason free agency's filters and
 * the Regular/Playoffs split live there.
 */
export function StatsTabs({ tabs }: {
  tabs: { id: string; label: string; hint?: string; href: string; active: boolean }[];
}) {
  return (
    <div className="flex items-stretch gap-1 border-b border-line/70 -mb-px overflow-x-auto">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          scroll={false}
          aria-current={t.active ? 'page' : undefined}
          className={`relative px-4 py-2.5 font-display font-bold uppercase tracking-wide text-sm whitespace-nowrap transition-colors ${
            t.active ? 'text-chalk' : 'text-muted hover:text-chalk'
          }`}
        >
          {t.label}
          {t.hint && <span className="ml-2 font-mono text-[10px] normal-case tracking-normal text-muted">{t.hint}</span>}
          {/* The broadcast lower-third underline the nav already uses, so an
              active tab here reads the same as an active page up top. */}
          <span
            aria-hidden
            className={`absolute left-3 right-3 -bottom-px h-[2px] rounded-full ${t.active ? 'bg-accent' : 'bg-transparent'}`}
          />
        </Link>
      ))}
    </div>
  );
}
