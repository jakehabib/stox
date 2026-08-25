'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { draftOneAiPickAction, runDraftChunkAction, draftRunStatusAction } from '@/app/actions/draft';
import type { DraftRunStatus } from '@/app/actions/draft';

/**
 * Seconds a club is left on the clock before the pick goes in.  [TUNE]
 *
 * Three was too fast to read: the name of the man taken, the club that took
 * him and where the board had him all landed and were gone before you could
 * look up. Five is long enough to actually watch a round go by and short
 * enough that seven rounds is still one sitting — which is the trade the
 * number is here to make.
 */
const TICK_SECONDS = 5;

/**
 * How often the BOARD ITSELF is re-rendered while a run is going.  [TUNE]
 *
 * The chunk action deliberately does not revalidate per chunk (see
 * runDraftChunkAction), so without this the broadcast band would sit on the
 * club that was on the clock when the run started while the ticker inside it
 * counted past round three — a screen disagreeing with itself. Refreshing
 * after every chunk is the other extreme: a full server render of the heaviest
 * page in the app twenty times in one run.
 *
 * TICK_SECONDS is the answer to both, and not by coincidence. A normal draft
 * already re-renders this page once per tick pick, so a run that refreshes on
 * the same cadence is not new load — it is the same load, with more selections
 * behind each one.
 */
const RUN_REFRESH_MS = TICK_SECONDS * 1000;

/**
 * How long the run steps aside so that refresh actually goes out.  [TUNE]
 *
 * router.refresh() is queued against the same channel the chunk requests use,
 * and a loop that fires the next chunk the instant the last one lands never
 * gives it a turn. MEASURED on a live run against a 224-pick draft: with no
 * pause at all — `setTimeout(..., 0)` — the band sat on "Round 1 · Pick 1"
 * while this ticker counted 96 selections past it; at 200 ms it tracked the
 * run to within a few cards, which is what a broadcast band is for. Kept well
 * under RUN_REFRESH_MS: it is a gap in one run every five seconds, not a pace.
 */
const RUN_REFRESH_YIELD_MS = 200;

/**
 * Drives the live draft-day experience: while it isn't the user's turn, ticks
 * through AI picks one at a time on a pausable clock — so picks are actually
 * visible as they happen instead of arriving as one opaque jump. This is now
 * the ONLY thing that runs an AI selection during a normal draft;
 * draftPlayerAction used to batch every intervening pick the instant the user
 * chose, which meant the board leapt straight to his next turn and he watched
 * none of it. Skipping ahead survives as the run button below, which is a
 * thing a GM presses, not a thing that happens to him.
 *
 * IT RUNS ONLY ONCE THE GM HAS OPENED THE DRAFT. `started` is DraftState's
 * gate (see beginRookieDraftAction), and until it is true this component does
 * nothing at all — no clock, no request, no rendering. The draft page puts its
 * war room up in this component's place instead. Before that gate existed the
 * ticker began taking picks the moment the page mounted, which is how the
 * owner's rookie draft started without him: *"it autostarted without me
 * knowing"*.
 *
 * ===========================================================================
 * ONE IDEA OF WHETHER THE BOARD IS MOVING
 * ===========================================================================
 * There are three ways it can be moving and they are states of one thing, not
 * three features: the clock is running (a card every TICK_SECONDS), the board
 * is being RUN DOWN (runDraftChunkAction, chunk after chunk, as fast as the
 * database will go), or it is STOPPED. Exactly one is true at a time.
 *
 *   - A run suspends the clock rather than racing it. `inFlight` — the same
 *     ref that already stops two tick picks being scheduled on top of each
 *     other, and for the same reason — is held for the WHOLE run, and the
 *     effect below refuses to even count down while `running`. Two writers
 *     taking picks against one DraftState is the bug the owner reported as
 *     *"the timer ran out but i saw no players taken"*; a batch runner is a
 *     second writer, so it goes behind the same gate instead of beside it.
 *   - Stop ends the run at the next chunk boundary and leaves the board
 *     STOPPED — not back on a five-second clock. A GM who presses Stop during
 *     a run means "stop", and handing him back a board that keeps drafting
 *     every five seconds would be answering a different question. Resume is
 *     right there.
 *   - Anything that ends the run puts the clock back at the top of
 *     TICK_SECONDS. It used to be possible to leave it sitting at zero with a
 *     blocked tick behind it, which is a stopped draft that says "Next pick in
 *     0s".
 */
export function LiveDraftTicker({ leagueId, userTeamId, isUserOnClock, draftComplete, started }: {
  leagueId: string; userTeamId: string; isUserOnClock: boolean; draftComplete: boolean;
  /** False while the board is set but the clock has not been started. */
  started: boolean;
}) {
  const [paused, setPaused] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(TICK_SECONDS);
  const [lastPick, setLastPick] = useState<{ teamName: string; playerName: string; position: string; round: number } | null>(null);
  const [ticking, setTicking] = useState(false);
  /** Non-null while the board is being run down: how many cards this run has put in. */
  const [runCount, setRunCount] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<DraftRunStatus | null>(null);
  /** Bumped when a run ends, to re-read what the GM can be offered next. */
  const [statusNonce, setStatusNonce] = useState(0);
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True while an AI pick request is out — a tick's, or a whole run's. */
  const inFlight = useRef(false);
  /** Set by Stop; read at the chunk boundary. */
  const stopRun = useRef(false);
  /** False once this ticker is off the screen, so a run stops asking for chunks. */
  const alive = useRef(true);
  /*
   * SET ON THE WAY IN AS WELL AS CLEARED ON THE WAY OUT. React Strict Mode is
   * on (next.config.js) and mounts every effect twice in development — mount,
   * cleanup, mount — so a cleanup-only version of this latches false on the
   * first teardown and never comes back. A run then made exactly one chunk,
   * discarded the result and left `inFlight` held forever: the board froze on
   * "0 selections in" with a Stop button that did nothing, which is the very
   * thing this component exists to stop happening.
   */
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const running = runCount !== null;

  /*
   * WHICH RUN BUTTON IS TRUE. The label has to be earned, so it is read off
   * the GM's actual unused DraftPick rows rather than assumed — see
   * draftRunStatusAction. Re-read when the situation changes: he goes on or
   * off the clock (he has just spent a selection), the draft opens, or a run
   * ends. Deliberately NOT read on a timer: nothing else can change his pick
   * count while the board is running, and the ticker already has one clock.
   */
  useEffect(() => {
    if (!started || draftComplete) { setStatus(null); return; }
    let cancelled = false;
    draftRunStatusAction(leagueId, userTeamId)
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch(() => { if (!cancelled) setStatus(null); });
    return () => { cancelled = true; };
  }, [leagueId, userTeamId, started, draftComplete, isUserOnClock, statusNonce]);

  useEffect(() => {
    // `confirming` holds the board too: the panel is telling him how many
    // cards are left and asking whether to run them out, and a clock ticking
    // cards off underneath that question makes the number in it wrong while
    // he is reading it.
    if (!started || isUserOnClock || draftComplete || paused || running || confirming) return;

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
  }, [secondsLeft, paused, running, confirming, isUserOnClock, draftComplete, started, leagueId, userTeamId, router]);

  /**
   * Run the board down, a chunk at a time, until it reaches his card or the
   * end of the draft.
   *
   * THE LOOP IS ON THE CLIENT BECAUSE THE PROGRESS IS. Each call returns after
   * a bounded number of selections (see CHUNK_PICKS/CHUNK_MS in
   * app/actions/draft.ts), so no single request can approach the function
   * timeout that left the owner staring at a dead 'Picking…' — and every one
   * that comes back moves the count and the last name on screen. A progress
   * indicator that does not track progress would be worse than none.
   */
  const runBoard = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    stopRun.current = false;
    setConfirming(false);
    setRunCount(0);
    let made = 0;
    let refreshedAt = Date.now();
    try {
      for (;;) {
        const chunk = await runDraftChunkAction(leagueId, userTeamId);
        if (!alive.current) return;
        made += chunk.picksMade;
        setRunCount(made);
        if (chunk.last) setLastPick(chunk.last);

        if (chunk.done) {
          /* Nothing is announced when a run reaches his card or the end of the
             board. The refresh in the finally puts "You are on the clock" or
             the class recap on the screen, and either says it better than a
             line of status text worded over the top of it would.

             BOARD_EMPTY is the one that needs saying, by stopping: it means
             cards still to come and nobody left to take them, and a board that
             is not stopped would ask for a pick every five seconds for the
             rest of the night and get nothing back each time. */
          if (chunk.stoppedBy === 'BOARD_EMPTY') setPaused(true);
          break;
        }
        if (stopRun.current) { setPaused(true); break; }
        /*
         * A chunk that comes back with nothing done and does not call itself
         * finished has no next state to move to, so asking again would be an
         * unbounded loop against the server. It should not happen — the
         * action's deadline is only checked after a pick has landed — and if
         * it ever does, stopping is the failure a GM can see and recover from.
         */
        if (chunk.picksMade === 0) { setPaused(true); break; }

        // The board catches up on a clock of its own, so the band around this
        // ticker never disagrees with it for long. Safe to re-render mid-run
        // now that the tick is suspended: a re-render used to be exactly what
        // put a second pick request in the air (see the effect above).
        if (Date.now() - refreshedAt >= RUN_REFRESH_MS) {
          refreshedAt = Date.now();
          router.refresh();
          await new Promise((r) => setTimeout(r, RUN_REFRESH_YIELD_MS));
        }
      }
    } finally {
      if (alive.current) {
        inFlight.current = false;
        setRunCount(null);
        setSecondsLeft(TICK_SECONDS);
        setStatusNonce((n) => n + 1);
        router.refresh();
      }
    }
  }, [leagueId, userTeamId, router]);

  if (draftComplete) return null;
  // The war room owns this corner of the header until the GM opens the draft.
  if (!started) return null;

  if (isUserOnClock) {
    return (
      <div className="pill border-accent text-accent bg-accent/10">You are on the clock</div>
    );
  }

  /*
   * ENDING HIS DRAFT IS SAID BEFORE IT HAPPENS, NEVER AFTER.
   *
   * Sibling of StartDraftButton's confirm, and it is asked for the same reason
   * and only when there is something to ask: a run that stops at his own card
   * costs him nothing and gets no gate ("a confirm that always fires is a
   * confirm nobody reads"). A run with no card left to stop at ends the draft,
   * and the owner has already had that happen to him without warning —
   * *"nevermind, it actually just ended randomly"*.
   */
  if (confirming) {
    const cards = status?.picksLeft ?? 0;
    return (
      <div className="panel border-warn/50 bg-warn/5 p-4 space-y-3 max-w-md">
        <div className="label-sm text-warn">Before you run it out</div>
        <p className="text-sm text-chalk/90 leading-snug">
          You hold no more selections, so there is nothing left for the board to stop at.{' '}
          {cards > 0 ? `${cards} more card${cards === 1 ? '' : 's'} go in` : 'The rest of the board goes in'} and
          that is your draft — anyone still on the board when it ends goes undrafted. You can stop it at any
          point once it starts.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn-primary text-sm" onClick={runBoard}>Run it out</button>
          <button className="btn-ghost text-sm" onClick={() => setConfirming(false)}>Not yet</button>
        </div>
      </div>
    );
  }

  // The one action that is true for this GM's situation. No status yet (the
  // read is still out) means no button rather than a guessed one.
  const hasStop = (status?.userPicksLeft ?? 0) > 0;
  const runLabel = hasStop ? 'Fast Forward to My Pick' : 'Run Out the Draft';

  return (
    <div className="flex items-center gap-2">
      <div className="pill border-line text-muted">
        {running
          ? `${lastPick ? `R${lastPick.round} · ` : ''}${runCount} selection${runCount === 1 ? '' : 's'} in`
          : paused
            ? 'Board stopped'
            : ticking
              ? 'Picking…'
              : (
                /*
                 * THE CLOCK, BEATING. One pulse a second and a colour that
                 * moves with it, because a number that changes silently in a
                 * corner is not a clock — it is a label that happens to
                 * disagree with itself every second.
                 *
                 * Deliberately the smallest animation in the app. A draft is
                 * 224 of these; anything that reads as a bounce the first time
                 * reads as a stutter by the third round. The `key` is the
                 * second itself, so the span is a new node on every tick and
                 * the keyframe runs — see ds/Moments.tsx on why re-adding a
                 * class to a live node does not.
                 */
                <>
                  Next pick in{' '}
                  <span
                    key={secondsLeft}
                    className={`moment-clock-tick font-semibold ${
                      secondsLeft <= 1 ? 'text-bad' : secondsLeft <= 2 ? 'text-warn' : 'text-chalk'
                    }`}
                  >
                    {secondsLeft}
                  </span>
                  s
                </>
              )}
      </div>

      {running ? (
        /* Stop is the same control Pause is, worded for what it is doing: it
           ends the run at the next chunk boundary — the picks already in are
           in, and nothing is rolled back — and leaves the board stopped. */
        <button onClick={() => { stopRun.current = true; }} className="btn-secondary text-xs px-2.5 py-1.5">
          Stop
        </button>
      ) : (
        <>
          <button onClick={() => setPaused((v) => !v)} className="btn-secondary text-xs px-2.5 py-1.5">
            {paused ? 'Resume' : 'Pause'}
          </button>
          {status?.live && (
            <button
              onClick={() => (hasStop ? runBoard() : setConfirming(true))}
              disabled={ticking}
              className="btn-secondary text-xs px-2.5 py-1.5"
              title={hasStop && status.nextUserPick
                ? `Runs to Round ${status.nextUserPick.round}, pick ${status.nextUserPick.slot} — your selection`
                : undefined}
            >
              {runLabel}
            </button>
          )}
        </>
      )}

      {lastPick && (
        <span className="text-xs text-muted hidden md:inline">
          Last: {lastPick.teamName} — R{lastPick.round} {lastPick.playerName} ({lastPick.position})
        </span>
      )}
    </div>
  );
}
