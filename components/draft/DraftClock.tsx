'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { beginRookieDraftAction, draftOneAiPickAction, advanceToUserPickAction } from '@/app/actions/draft';

/**
 * Seconds a club sits on the clock before its selection goes in. Matches the
 * pace the draft page's ticker keeps — a round should be watchable in one
 * sitting without a name landing and vanishing before it can be read.
 */
const CLOCK_SECONDS = 5;

/**
 * THE CLOCK, as a clock.
 *
 * The draft page states the pace as a line of text ("Next pick in 3s"). On a
 * broadcast the clock IS the furniture: a scoreboard well counting down, the
 * two controls a GM actually reaches for beside it, and nothing else. It
 * drives the same three server actions the draft page drives, so this is a
 * second face on one mechanism, never a second mechanism.
 *
 * IT NEVER STARTS ITSELF. `started` is DraftState's own gate — until the GM
 * opens the draft there is no timer, no request and no countdown, because a
 * draft that begins because a page was left open is a draft that happened
 * without him.
 */
export function DraftClock({ leagueId, userTeamId, isUserOnClock, complete, started }: {
  leagueId: string;
  userTeamId: string;
  isUserOnClock: boolean;
  complete: boolean;
  /** False while the board is set but the clock has not been started. */
  started: boolean;
}) {
  const [paused, setPaused] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(CLOCK_SECONDS);
  const [opening, setOpening] = useState(false);
  const [ticking, setTicking] = useState(false);
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True while a selection request is out — one pick in flight at a time. */
  const inFlight = useRef(false);

  useEffect(() => {
    if (!started || isUserOnClock || complete || paused) return;

    if (secondsLeft <= 0) {
      // A re-render mid-request (the action revalidates this route, which flips
      // isUserOnClock) must not schedule a second pick on top of the first. A
      // ref, not state: this is read and written inside one tick.
      if (inFlight.current) return;
      inFlight.current = true;
      setTicking(true);
      let cancelled = false;
      timeoutRef.current = setTimeout(async () => {
        try {
          await draftOneAiPickAction(leagueId, userTeamId);
        } finally {
          inFlight.current = false;
          if (!cancelled) {
            setTicking(false);
            setSecondsLeft(CLOCK_SECONDS);
            router.refresh();
          }
        }
      }, 0);
      return () => { cancelled = true; if (timeoutRef.current) clearTimeout(timeoutRef.current); };
    }

    timeoutRef.current = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [secondsLeft, paused, isUserOnClock, complete, started, leagueId, userTeamId, router]);

  if (complete) {
    return <div className="pill border-line text-muted">Every selection is in</div>;
  }

  if (!started) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-sm text-muted max-w-[15rem] leading-snug text-right">
          The board is set and the room is waiting on you. Nothing moves until you open it.
        </p>
        <button
          className="btn-primary"
          disabled={opening}
          onClick={async () => {
            setOpening(true);
            await beginRookieDraftAction(leagueId);
            router.refresh();
          }}
        >
          {opening ? 'Opening…' : 'Open The Draft'}
        </button>
      </div>
    );
  }

  if (isUserOnClock) {
    return (
      <div className="text-right">
        <div className="label-sm">The Call Is Yours</div>
        <p className="text-sm text-chalk mt-1.5 max-w-[18rem] leading-snug">
          Take your man off the board below. Nothing moves until you do.
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <div className="text-center">
        <div className="label-sm">{ticking ? 'Selection In' : 'Clock'}</div>
        <div className="scoreboard-digits mt-1.5">
          <span className="stat-value text-stat-md text-muted">0</span>
          <span className="stat-value text-stat-md text-muted">:</span>
          <span className={`stat-value text-stat-md ${secondsLeft <= 2 ? 'text-warn' : 'text-team'}`}>
            {String(Math.max(0, secondsLeft)).padStart(2, '0')}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <button onClick={() => setPaused((v) => !v)} className="btn-secondary text-xs px-2.5 py-1.5 w-40">
          {paused ? 'Resume Clock' : 'Hold The Clock'}
        </button>
        <button
          onClick={async () => { await advanceToUserPickAction(leagueId, userTeamId); router.refresh(); }}
          className="btn-secondary text-xs px-2.5 py-1.5 w-40"
        >
          Run To My Pick
        </button>
      </div>
    </div>
  );
}
