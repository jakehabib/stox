'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { draftOneAiPickAction, advanceToUserPickAction } from '@/app/actions/draft';

const TICK_SECONDS = 3;

/**
 * Drives the live draft-day experience: while it isn't the user's turn,
 * ticks through AI picks one at a time on a pausable clock instead of a
 * single opaque "Skip to My Pick" batch — so picks are actually visible as
 * they happen, and the on-clock display never goes stale mid-batch the way
 * the old all-at-once skip could feel like it did.
 */
export function LiveDraftTicker({ leagueId, userTeamId, isUserOnClock, draftComplete }: {
  leagueId: string; userTeamId: string; isUserOnClock: boolean; draftComplete: boolean;
}) {
  const [paused, setPaused] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(TICK_SECONDS);
  const [lastPick, setLastPick] = useState<{ teamName: string; playerName: string; position: string; round: number } | null>(null);
  const [ticking, setTicking] = useState(false);
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True while an AI pick request is out. See the guard in the effect below. */
  const inFlight = useRef(false);

  useEffect(() => {
    if (isUserOnClock || draftComplete || paused) return;

    if (secondsLeft <= 0) {
      /*
       * ONE PICK IN FLIGHT AT A TIME, AND A CLEANUP ON THE WAY OUT.
       *
       * This branch used to `return` with no cleanup function while a pick was
       * pending. Anything that re-ran the effect before the action resolved —
       * and revalidatePath inside the action re-renders the page, which flips
       * the isUserOnClock prop — left the in-flight request unowned and
       * scheduled a second one on top of it. The app owner saw the result as a
       * draft that would not move: *"the timer ran out but i saw no players
       * taken"*.
       *
       * `inFlight` is a ref rather than state on purpose: it has to be read and
       * set synchronously inside the same tick, and a state update would not
       * land before the second effect run checked it.
       */
      if (inFlight.current) return;
      inFlight.current = true;
      setTicking(true);
      let cancelled = false;
      timeoutRef.current = setTimeout(async () => {
        try {
          const result = await draftOneAiPickAction(leagueId, userTeamId);
          if (cancelled) return;
          if (result) setLastPick(result);
        } finally {
          inFlight.current = false;
          if (!cancelled) {
            setTicking(false);
            setSecondsLeft(TICK_SECONDS);
            router.refresh();
          }
        }
      }, 0);
      return () => { cancelled = true; if (timeoutRef.current) clearTimeout(timeoutRef.current); };
    }

    timeoutRef.current = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [secondsLeft, paused, isUserOnClock, draftComplete, leagueId, userTeamId, router]);

  if (draftComplete) return null;

  if (isUserOnClock) {
    return (
      <div className="pill border-accent text-accent bg-accent/10">You are on the clock</div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="pill border-line text-muted">
        {ticking ? 'Picking…' : `Next pick in ${secondsLeft}s`}
      </div>
      <button onClick={() => setPaused((v) => !v)} className="btn-secondary text-xs px-2.5 py-1.5">
        {paused ? 'Resume' : 'Pause'}
      </button>
      <button
        onClick={async () => { await advanceToUserPickAction(leagueId, userTeamId); router.refresh(); }}
        className="btn-secondary text-xs px-2.5 py-1.5"
      >
        Fast Forward to My Pick
      </button>
      {lastPick && (
        <span className="text-xs text-muted hidden md:inline">
          Last: {lastPick.teamName} — R{lastPick.round} {lastPick.playerName} ({lastPick.position})
        </span>
      )}
    </div>
  );
}
