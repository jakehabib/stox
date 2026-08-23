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
 * rank book and six position cards — and rendering both on every paint to save
 * a navigation would be the wrong trade twice over. Keeping it on the URL also
 * makes a view linkable, which is the same reason free agency's filters and
 * the Regular/Playoffs split live there.
 */
export function StatsTabs({ tabs }: {
  tabs: { id: string; label: string; hint?: string; href: string; active: boolean }[];
}) {
  return (
    /* NO SCROLL CONTAINER HERE, AND THE BAR IT PRODUCED WAS VERTICAL.
       This row carried `overflow-x-auto`. It has at most two items and cannot
       overflow sideways — measured at 1600, 1280 and 390 the row's scrollWidth
       equals its clientWidth exactly, 342px of content in 342px at the
       narrowest. But `overflow-x: auto` makes the OTHER axis compute to `auto`
       too (CSS overflow, §3: neither axis may be `visible` when the other is
       not), and the active-tab underline below draws at `-bottom-px` — one
       pixel outside the box. scrollHeight 43 against clientHeight 42, so the
       browser hung a vertical scrollbar in the top-right corner of the tab
       row for one pixel of a decoration this component draws itself. The app
       owner: *"There is a scroller wheel in the top right that shouldnt be
       there."* Deleting the underline would have hidden it too and cost the
       active-tab marker; deleting the scroll container is the actual cause. */
    <div className="flex items-stretch gap-1 border-b border-line/70 -mb-px">
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
