'use client';

import { useState } from 'react';

export interface GmCareerPane {
  /**
   * THE JOB THE PANE DOES, not what it is called today — same split, and the
   * same reason, as DraftPane's `id` vs `label` in components/draft/DraftViewToggle.tsx.
   * The landing pane is written in terms of this id.
   */
  id: string;
  label: string;
  /** What is actually in it — "9 seasons · 1 title". Never an instruction. */
  hint?: string;
  body: React.ReactNode;
}

/**
 * THE CAREER PAGE HAS THREE JOBS AND ONE SCREEN.
 *
 * The page was one column: the card, a dead-money panel, a best-season panel, a
 * season log, a move ledger, the graded trades, an All-Star table and an awards
 * table, stacked. The app owner: *"can we clean up the GM career tab? Maybe we
 * just have sub-tabs underneath with 'trades', 'stats'...etc."* — and then,
 * asked whether that meant showing less: *"I would rather have a lot of really
 * cool data on GM career across 2 or 3 tabs rather than minimal on one tab to
 * save room"*, and *"We still want it decluttered — as with EVERY page on our
 * game."*
 *
 * Both of those at once is the whole design. LENGTH IS NOT CLUTTER. A tab that
 * runs long because it is genuinely rich is doing its job; a tab where four
 * panels compete to answer different questions is not. So each pane here owns
 * exactly ONE question a GM asks about his own tenure — what my teams did, who
 * I drafted, what deals I made — and every panel in it has to earn its place
 * against that question or belong to a different one.
 *
 * WHAT STANDS ABOVE THE TABS, ALWAYS: the club masthead and the GM card button.
 * The card is the one thing on this page that leaves the game, it is built at a
 * size meant to be screenshotted, and its entry point has already had to be
 * rescued once for being unfindable — *"how do you get to the card? i dont see
 * it on the GM profile"*. Gating it behind a tab would be losing that argument
 * a second time. It is the page's header, not a panel in one of these panes,
 * which is also why the reveal mounts once and cannot double-fire: nothing here
 * unmounts it, and switching panes never re-renders it.
 *
 * SWITCHING IS STATE, NOT A URL, for exactly the reason PlayerCardTabs and
 * DraftViewToggle both give (read either comment): every pane is already
 * rendered by the server when the page paints, so a navigation would buy
 * nothing and would cost the reader his scroll position. The inactive panes are
 * hidden rather than unmounted, so flipping is instant and nothing re-lays-out
 * underneath him.
 *
 * NO SITUATIONAL DEFAULT HERE, unlike the draft toggle. That page has a clock
 * on it and the right pane changes minute to minute; a career does not move
 * while you are reading it, so the landing pane is simply the one the page is
 * opened for — the record — and the reader owns it from there.
 */
export function GmCareerTabs({ panes, initial }: {
  /** In tab order. */
  panes: GmCareerPane[];
  /** The pane id to land on. */
  initial: string;
}) {
  const [view, setView] = useState(initial);
  const live = panes.some((p) => p.id === view) ? view : panes[0]?.id;

  return (
    <div className="space-y-5">
      <div
        role="tablist"
        aria-label="GM career view"
        className="flex items-stretch flex-wrap rounded-lg border border-line/70 bg-ink/30 divide-x divide-line/40 overflow-hidden"
      >
        {panes.map((pane) => (
          <button
            key={pane.id}
            type="button" role="tab" aria-selected={live === pane.id}
            onClick={() => setView(pane.id)}
            className={`relative flex-1 sm:flex-none flex flex-col items-start px-5 py-3 transition-colors ${
              live === pane.id ? 'text-chalk bg-chalk/[0.05]' : 'text-muted hover:text-chalk hover:bg-raised/40'
            }`}
          >
            <span className="font-display font-bold uppercase tracking-[0.14em] text-base leading-none">{pane.label}</span>
            {pane.hint && <span className="text-[11px] text-muted mt-1 leading-none">{pane.hint}</span>}
            <span
              aria-hidden="true"
              className={`absolute inset-x-0 bottom-0 h-[3px] ${live === pane.id ? 'bg-accent' : 'bg-transparent'}`}
            />
          </button>
        ))}
      </div>

      {panes.map((pane) => (
        <div key={pane.id} role="tabpanel" aria-label={pane.label} hidden={live !== pane.id} className="space-y-5">
          {pane.body}
        </div>
      ))}
    </div>
  );
}
