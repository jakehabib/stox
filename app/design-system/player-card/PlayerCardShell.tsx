'use client';

import { useState } from 'react';

export type CardView = 'stats' | 'contract';

/**
 * MOCKUP ONLY — the frame of a player card whose body switches between his
 * stats and his contract.
 *
 * The card carries the hero, one always-visible money line (this year's cap
 * hit and how many years are left), and a two-state switch that swaps what
 * fills the rest of it. Stats are the default because that is what the card
 * is opened for; the contract is one click away rather than a scroll and a
 * separate section.
 *
 * THE SWITCH IS THE BAND, not a control parked at the end of it. It was two
 * small pills in the right-hand corner and read as a secondary filter — the
 * app owner's note: *"Lets make the contract and stats tabs BIGGER and more
 * noticeable - maybe filling the blank space to the left of them"*. So the two
 * tabs now take every pixel the money cells don't, at display size, with the
 * accent underline this app already uses to mark the active section in its
 * top nav (.nav-link-active). It is navigation, and it now looks like it.
 *
 * The switch is component state rather than a URL, which is the opposite of
 * StatScopeToggle's decision and for the opposite reason: Regular/Playoffs
 * picks which numbers the SERVER has to fetch, so it belongs in the address.
 * Both halves of this one are already on the card by the time it renders, so
 * a navigation would buy nothing and cost the reader his scroll position.
 *
 * Both panes stay mounted and the inactive one is hidden, so flipping back and
 * forth never re-lays-out the page under the pointer.
 *
 * Everything inside is passed in as rendered nodes: this file holds no data,
 * no money, and no arithmetic. See page.tsx for where every figure comes from.
 */
export function PlayerCardShell({
  teamColor, hero, summary, stats, contract, initialView = 'stats',
}: {
  teamColor: string;
  /** The hero block — sits on the team-tinted ground. */
  hero: React.ReactNode;
  /** The always-on money line: cap hit and years left, rendered by the page. */
  summary: React.ReactNode;
  stats: React.ReactNode;
  contract: React.ReactNode;
  /** Which pane this instance opens on. The page shows one of each. */
  initialView?: CardView;
}) {
  const [view, setView] = useState<CardView>(initialView);

  const tab = (id: CardView, label: string, first: boolean) => (
    <button
      type="button" role="tab" aria-selected={view === id}
      onClick={() => setView(id)}
      className={`relative flex-1 flex items-center justify-center px-6 py-4 font-display font-bold uppercase
                  tracking-[0.14em] text-lg transition-colors ${first ? '' : 'border-l border-line/40'} ${
        view === id ? 'text-chalk bg-chalk/[0.05]' : 'text-muted hover:text-chalk hover:bg-raised/40'
      }`}
    >
      {label}
      {/* The lower-third bar, same as the top nav's active section. It sits on
          the band's bottom edge so the live tab reads as joined to the pane
          under it. */}
      <span
        aria-hidden="true"
        className={`absolute inset-x-0 bottom-0 h-[3px] ${view === id ? 'bg-accent' : 'bg-transparent'}`}
      />
    </button>
  );

  return (
    <div
      className="relative rounded-lg border border-line/70 bg-card/40"
      style={{ ['--team-accent' as never]: teamColor }}
    >
      {/* No `overflow-hidden` anywhere on this card: the radius already cuts
          the tint, and clipping the card would clip every tooltip that opens
          out of the ledger and the fact line. */}
      <div
        className="rounded-t-lg"
        style={{ background: `radial-gradient(ellipse 90% 130% at 0% 50%, color-mix(in srgb, ${teamColor} 20%, transparent), transparent 70%)` }}
      >
        {hero}
      </div>

      {/* The money line and the switch share one band — the two figures are
          the contract's presence in the stats view, and the way through to the
          rest of it owns the remainder of the same row. */}
      <div className="relative border-t border-line/60 bg-ink/30 flex flex-wrap items-stretch">
        <div className="flex items-stretch divide-x divide-line/40 shrink-0">{summary}</div>
        <div role="tablist" aria-label="Card view" className="flex-1 min-w-[320px] flex items-stretch border-l border-line/60">
          {tab('stats', 'Stats', true)}
          {tab('contract', 'Contract', false)}
        </div>
      </div>

      <div className="relative border-t border-line/60 p-5">
        <div role="tabpanel" hidden={view !== 'stats'}>{stats}</div>
        <div role="tabpanel" hidden={view !== 'contract'}>{contract}</div>
      </div>
    </div>
  );
}
