'use client';

import { useState } from 'react';

export type PlayerCardView = 'stats' | 'contract';

/**
 * THE PLAYER CARD'S TWO FACES.
 *
 * The card used to be a hero followed by eight sections, with the contract at
 * the bottom of them. The app owner's ruling after seeing the mockup: *"i like
 * it - lets ship it"* — one card, stats by default, the whole contract one
 * click away on the same object.
 *
 * What this component owns is only the FRAME: the team-tinted hero ground, the
 * band under it, and which pane is showing. It holds no data, no money and no
 * arithmetic — everything inside arrives as already-rendered nodes from the
 * server component, so the cap maths, the fog and the ownership gating all
 * stay on the server where they are enforced. That is also why the ledger and
 * the stat table cost the client bundle nothing.
 *
 * THE BAND IS THE SWITCH. The two money cells (this year's cap hit, years
 * left) sit at the left and the two tabs take every pixel they don't, at
 * display size, with the accent underline this app already uses to mark the
 * live section in its top nav. It reads as navigation because it is
 * navigation.
 *
 * SWITCHING is state rather than a URL, deliberately, and the opposite of
 * StatScopeToggle's decision: Regular/Playoffs changes which numbers the
 * SERVER must fetch, so it belongs in the address. Both halves of this switch
 * are already rendered by the time the card paints, so a navigation would buy
 * nothing and would cost the reader his scroll position. Both panes stay
 * mounted and the inactive one is hidden, so flipping never re-lays-out the
 * page under him.
 *
 * ARRIVING is a different question, and `initialView` answers it. A man
 * reached from a negotiation is a man you are about to pay, and opening his
 * card on his receiving numbers makes the reader find the tab himself. The
 * app owner: *"if we are coming from 're-sign' or free agent 'negotiate' can
 * it skip directly to the contract side of the player card? so that way
 * players aren't like 'why am i looking at stats now?'"* The page reads it off
 * the query string; every other route omits it and still lands on stats.
 *
 * `contract` is optional and that is the draft-prospect case: a prospect
 * cannot be signed, so rather than offer a tab onto an empty box, he gets no
 * tabs at all and his band is the scouting strip.
 */
export function PlayerCardTabs({ teamColor, hero, summary, stats, contract, initialView = 'stats', contractShortcuts }: {
  /** The club's primary; undefined for a free agent, who gets no tint. */
  teamColor?: string;
  hero: React.ReactNode;
  /** The band's cells — rendered by the page, so their tooltips stay server-side. */
  summary: React.ReactNode;
  stats: React.ReactNode;
  /** Omitted for a draft prospect: no contract, no tab, no empty box. */
  contract?: React.ReactNode;
  /** Which face the card opens on. Only the arrival — the reader owns it after that. */
  initialView?: PlayerCardView;
  /**
   * The moves available on the contract face, named on the stats face so a
   * GM who has never opened this card knows they exist. Each one only turns
   * the card over — the actual control, and its confirm step, stay on the
   * contract side where the money is. The page decides which to offer, since
   * only it knows whether the man is yours and whether his deal can take an
   * extension.
   */
  contractShortcuts?: { key: string; label: string }[];
}) {
  // A prospect has no contract pane at all, so an arrival asking for one lands
  // on stats rather than on a tab that does not exist.
  const [view, setView] = useState<PlayerCardView>(contract != null ? initialView : 'stats');
  const tabbed = contract != null;

  const tab = (id: PlayerCardView, label: string, first: boolean) => (
    <button
      type="button" role="tab" aria-selected={view === id}
      onClick={() => setView(id)}
      className={`relative flex-1 flex items-center justify-center px-6 py-4 font-display font-bold uppercase
                  tracking-[0.14em] text-lg transition-colors ${first ? '' : 'border-l border-line/40'} ${
        view === id ? 'text-chalk bg-chalk/[0.05]' : 'text-muted hover:text-chalk hover:bg-raised/40'
      }`}
    >
      {label}
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
      {/* No `overflow-hidden` on this card: the radius already cuts the tint,
          and clipping the card clips every tooltip that opens upward out of
          the band and the ledger. */}
      <div
        className="rounded-t-lg"
        style={{
          background: teamColor
            ? `radial-gradient(ellipse 90% 130% at 0% 50%, color-mix(in srgb, ${teamColor} 20%, transparent), transparent 70%)`
            : undefined,
        }}
      >
        {hero}
      </div>

      <div className="relative border-t border-line/60 bg-ink/30 flex flex-wrap items-stretch">
        <div className={`flex items-stretch divide-x divide-line/40 ${tabbed ? 'shrink-0' : 'flex-1 flex-wrap'}`}>
          {summary}
        </div>
        {tabbed && (
          <div role="tablist" aria-label="Player card view" className="flex-1 min-w-[320px] flex items-stretch border-l border-line/60">
            {tab('stats', 'Stats', true)}
            {tab('contract', 'Contract', false)}
          </div>
        )}
      </div>

      <div className="relative border-t border-line/60 p-5">
        <div role={tabbed ? 'tabpanel' : undefined} hidden={tabbed && view !== 'stats'}>
          {stats}
          {/* THE MOVES, NAMED WHERE PEOPLE ARE LOOKING. Extend, restructure
              and release all live on the contract face and a reader who never
              turned the card over had no way to know that. The app owner:
              *"on the stats page IMO we should have a quick link to 'extend',
              'restructure' and 'release'. they just bring you to the contract
              screen but for new players they might not be able to find it
              easy"*. They do exactly that and nothing more — the confirm step
              on a release belongs beside the dead-money figure it is asking
              about, not next to his receiving yards. */}
          {tabbed && contractShortcuts && contractShortcuts.length > 0 && (
            <div className="mt-6 pt-4 border-t border-line/60 flex flex-wrap items-center gap-2">
              <span className="label-sm mr-1">His contract</span>
              {contractShortcuts.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setView('contract')}
                  className={`pill text-xs transition-colors ${
                    a.key === 'release'
                      ? 'border-bad/40 text-bad hover:bg-bad/10'
                      : 'border-line text-muted hover:text-chalk hover:border-muted'
                  }`}
                >
                  {a.label}
                </button>
              ))}
              <span className="text-xs text-muted">— all on the contract side of this card</span>
            </div>
          )}
        </div>
        {tabbed && <div role="tabpanel" hidden={view !== 'contract'}>{contract}</div>}
      </div>
    </div>
  );
}
