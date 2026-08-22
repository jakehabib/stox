'use client';

import { useState } from 'react';

export type DraftView = 'board' | 'room';

/**
 * DRAFT DAY HAS TWO JOBS AND ONE SCREEN.
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
 * THE DEFAULT IS SITUATIONAL, NOT STICKY. A sticky default is wrong in both
 * directions: pinned to the room, the board is buried when you go on the
 * clock; pinned to the board, you never see the draft happen. `urgent` is the
 * page's answer to "is this about to be your turn" — on the clock, or one name
 * away — and the spectacle plays until it flips, at which point the thing you
 * decide with is already in front of you.
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
 * real world, one override; never a re-render.
 *
 * SWITCHING IS STATE, NOT A URL, for the same reason PlayerCardTabs is (read
 * its comment): both panes are already rendered by the server when the page
 * paints, so a navigation would buy nothing, cost the reader his scroll
 * position, and — here — throw away the live ticker's own clock state. The
 * inactive pane is hidden rather than unmounted, so flipping is instant and
 * neither side re-lays-out under him.
 */
export function DraftViewToggle({
  urgent, urgentNote, boardHint, roomHint, board, room,
}: {
  /** On the clock, or one selection away. Decides the default, nothing else. */
  urgent: boolean;
  /** Why it is urgent, in the room's own words — "You are on the clock." */
  urgentNote?: string;
  /** What is on the board right now, e.g. "176 still available". */
  boardHint?: string;
  /** Where the draft is, e.g. "pick 89 of 224". */
  roomHint?: string;
  board: React.ReactNode;
  room: React.ReactNode;
}) {
  const [choice, setChoice] = useState<{ view: DraftView; madeWhileUrgent: boolean } | null>(null);
  // The situation moved on, so the choice made inside the old one is spent.
  // Adjusting state during render (rather than in an effect) means the correct
  // pane is the FIRST thing painted after a refresh — no frame of the wrong
  // view, and no flash of the board over a pick that is being announced.
  if (choice && choice.madeWhileUrgent !== urgent) setChoice(null);

  const live = choice && choice.madeWhileUrgent === urgent ? choice.view : null;
  const view: DraftView = live ?? (urgent ? 'board' : 'room');

  const tab = (id: DraftView, label: string, hint?: string) => (
    <button
      type="button" role="tab" aria-selected={view === id}
      onClick={() => setChoice({ view: id, madeWhileUrgent: urgent })}
      className={`relative flex-1 sm:flex-none flex flex-col items-start px-5 py-3 transition-colors ${
        view === id ? 'text-chalk bg-chalk/[0.05]' : 'text-muted hover:text-chalk hover:bg-raised/40'
      }`}
    >
      <span className="font-display font-bold uppercase tracking-[0.14em] text-base leading-none">{label}</span>
      {hint && <span className="text-[11px] text-muted mt-1 leading-none">{hint}</span>}
      <span
        aria-hidden="true"
        className={`absolute inset-x-0 bottom-0 h-[3px] ${view === id ? 'bg-accent' : 'bg-transparent'}`}
      />
    </button>
  );

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Draft day view"
        className="flex items-stretch flex-wrap rounded-lg border border-line/70 bg-ink/30 divide-x divide-line/40 overflow-hidden"
      >
        {tab('board', 'The Board', boardHint)}
        {tab('room', 'The Room', roomHint)}
        {urgent && urgentNote && (
          <div className="hidden md:flex items-center px-4 text-xs text-accent border-l-0">
            {view === 'board' ? `${urgentNote} The board is up.` : `${urgentNote} The board is one click away.`}
          </div>
        )}
      </div>

      <div role="tabpanel" aria-label="The Board" hidden={view !== 'board'} className="space-y-6">{board}</div>
      <div role="tabpanel" aria-label="The Room" hidden={view !== 'room'} className="space-y-6">{room}</div>
    </div>
  );
}
