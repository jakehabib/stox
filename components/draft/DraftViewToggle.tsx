'use client';

import { useState } from 'react';

export type DraftView = 'board' | 'room';

export interface DraftPane {
  /**
   * WHICH OF THE TWO JOBS THIS PANE DOES, not what it is called today. `board`
   * is always the men — the list, the filters, the club's own capital. `room`
   * is always the draft as an event — the broadcast while it runs, its record
   * once it is over. The label is free to change with the moment (see below);
   * the id may not, because the situational default is written in terms of it.
   */
  id: DraftView;
  label: string;
  /** What is in it right now, e.g. "176 still available". */
  hint?: string;
  body: React.ReactNode;
}

/**
 * DRAFT DAY HAS TWO JOBS AND ONE SCREEN — AND SO DOES THE MORNING AFTER.
 *
 * Everything on this page above the big board is something a GM READS — the
 * pick on screen, the feed, the run watch, the war room panel, both
 * best-available columns. The board is the only thing he ACTS on, and it was
 * last on the page, which meant it was furthest away at the exact moment it
 * mattered most. The app owner: *"theres a lot going on. the money item is the
 * actual draft itself and its buried at the bottom of the screen. Can we maybe
 * clean it up? or toggle 1 or 2 views?"*
 *
 * So: THE BOARD (the men, the filters, the search, your picks) and THE ROOM
 * (the broadcast). Nothing is dropped — every panel that was on this page is
 * in exactly one of the two, and the clock stands above both, always, because
 * a GM must never be unable to see whose pick it is.
 *
 * THE TOGGLE USED TO SWITCH ITSELF OFF AT THE END OF THE DRAFT, which is the
 * one moment this page has the MOST on it: the recap arrives (the class, round
 * one, every other round), and none of the broadcast leaves. Measured on a
 * finished 224-pick save at 1600×1000, the page ran to 4,971px — five screens
 * — against 1,882px for the same save mid-draft. The app owner: *"lets make
 * sure we clean up the draft complete page too. its so long"*. The two jobs do
 * not stop existing when the clock does; they change into THE CLASS (what the
 * room did) and WHAT'S LEFT (the men nobody called, and next spring's picks).
 * Which is why a pane carries an `id` for its job and a `label` for its name:
 * the same two lanes, renamed for the moment they are read in.
 *
 * THE DEFAULT IS THE CALLER'S CALL, and it used to be this component's. It
 * guessed from `urgent` — on the clock or one name away — so a GM who opened
 * a live draft holding pick 20 landed on the broadcast, and the board he had
 * spent a season building was one click away rather than in front of him. The
 * app owner: *"when we start the draft, it should default to showing the draft
 * board not the war room"*. It is also the tab-order the page already declares
 * for a live draft: the board is the leading pane there, and a leading tab
 * that is not the open one is a screen disagreeing with itself.
 *
 * So the page passes `defaultView`, because the page is the half that knows
 * which situation this is. `urgent` is still read, but only for the scoping
 * below — it is what "the situation" MEANS, not what it selects.
 *
 * AFTER THE LAST CARD the recap is the whole reason to open this page, so the
 * page defaults it to the room — and the room is the recap. It reads the same
 * on the first visit and the tenth, because the record of a draft does not go
 * stale. The one thing that does — the undrafted, who are free agents the
 * moment the league moves on — is the other tab, named for exactly that.
 *
 * A MANUAL CHOICE IS SCOPED TO THE SITUATION IT WAS MADE IN. This page
 * re-renders every few seconds while a draft runs (LiveDraftTicker calls
 * router.refresh() after every AI pick), so "snap to the board when urgent"
 * written as a plain effect would drag a GM who deliberately chose to watch
 * the room while on the clock back to the board a heartbeat later, over and
 * over. Instead the choice is remembered together with the situation it was
 * made in, and it holds for every re-render inside that situation. Only when
 * the clock's relationship to this club actually changes — waiting becomes
 * on-the-clock, or your selection goes in and the wait starts again — is the
 * choice forgotten and the situational default allowed back. One flip of the
 * real world, one override; never a re-render. A finished draft has no flips
 * left in it, so a choice made there simply holds.
 *
 * SWITCHING IS STATE, NOT A URL, for the same reason PlayerCardTabs is (read
 * its comment): both panes are already rendered by the server when the page
 * paints, so a navigation would buy nothing, cost the reader his scroll
 * position, and — here — throw away the live ticker's own clock state. The
 * inactive pane is hidden rather than unmounted, so flipping is instant and
 * neither side re-lays-out under him.
 */
export function DraftViewToggle({ panes, urgent, urgentNote, defaultView }: {
  /** Both panes, in tab order — the leading one first. */
  panes: [DraftPane, DraftPane];
  /** Which pane is open before the reader chooses one. Normally the leading pane. */
  defaultView: DraftView;
  /**
   * On the clock, or one selection away. This is the SITUATION a manual choice
   * is scoped to (see below) — it no longer picks the default.
   */
  urgent: boolean;
  /** Why it is urgent, in the room's own words — "You are on the clock." */
  urgentNote?: string;
}) {
  const [choice, setChoice] = useState<{ view: DraftView; madeWhileUrgent: boolean } | null>(null);
  // The situation moved on, so the choice made inside the old one is spent.
  // Adjusting state during render (rather than in an effect) means the correct
  // pane is the FIRST thing painted after a refresh — no frame of the wrong
  // view, and no flash of the board over a pick that is being announced.
  if (choice && choice.madeWhileUrgent !== urgent) setChoice(null);

  const live = choice && choice.madeWhileUrgent === urgent ? choice.view : null;
  const view: DraftView = live ?? defaultView;

  return (
    <div className="space-y-6">
      {/* BOTH TABS HAVE TO LOOK LIKE TABS. The first cut styled the open one
          and left the other as grey text on the same ground — which reads as a
          heading with a word after it, not as a control. The app owner: *"it
          should also be more obvious that there are two tabs there for the
          draft and war room"*. Three things carry it now, and none of them is
          a line of instructions: the closed tab is RAISED and legible (its own
          surface, chalk text, its own border) rather than dim text on the same
          ground; the open one is CUT INTO the page (darker, accent bar along
          its bottom edge, no bottom border) so the panel below reads as its
          body; and the pair splits the full width at every breakpoint, so two
          equal halves is the first thing the shape says. */}
      <div
        role="tablist"
        aria-label="Draft day view"
        className="flex items-stretch flex-wrap gap-px rounded-lg border border-line/70 bg-line/40 overflow-hidden"
      >
        {panes.map((pane) => {
          const open = view === pane.id;
          return (
            <button
              key={pane.id}
              type="button" role="tab" aria-selected={open}
              onClick={() => setChoice({ view: pane.id, madeWhileUrgent: urgent })}
              className={`relative flex-1 min-w-[9rem] flex flex-col items-start px-5 py-3 transition-colors ${
                open
                  ? 'bg-ink text-chalk'
                  : 'bg-raised/70 text-chalk/70 hover:bg-raised hover:text-chalk'
              }`}
            >
              <span className="font-display font-bold uppercase tracking-[0.14em] text-base leading-none">{pane.label}</span>
              {pane.hint && (
                <span className={`text-[11px] mt-1 leading-none ${open ? 'text-muted' : 'text-muted/90'}`}>{pane.hint}</span>
              )}
              {/* The closed tab says what it is FOR in one word, because "The
                  Room" and "What's Left" name a place, not an action. It is on
                  the closed tab only — the open one is already open. */}
              {!open && (
                <span className="absolute top-2 right-3 text-[10px] uppercase tracking-[0.16em] text-accent2">View</span>
              )}
              <span
                aria-hidden="true"
                className={`absolute inset-x-0 bottom-0 h-[3px] ${open ? 'bg-accent' : 'bg-transparent'}`}
              />
            </button>
          );
        })}
        {urgent && urgentNote && (
          <div className="hidden lg:flex items-center px-4 text-xs text-accent bg-ink/60">
            {view === 'board' ? `${urgentNote} The board is up.` : `${urgentNote} The board is one click away.`}
          </div>
        )}
      </div>

      {panes.map((pane) => (
        <div key={pane.id} role="tabpanel" aria-label={pane.label} hidden={view !== pane.id} className="space-y-6">
          {pane.body}
        </div>
      ))}
    </div>
  );
}
