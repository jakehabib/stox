'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * THE HELPER BEHIND app/moments.css. Three small things and nothing else —
 * no animation library, no dependency, and nothing here is on any path the
 * simulation runs.
 *
 * WHY A KEY AND NOT "ADD THE CLASS, REMOVE IT ON animationend". That is the
 * right instinct on a hand-written page and the wrong one in React. A CSS
 * animation runs when a node carrying it is INSERTED; putting the same class
 * back on a node that already ran it does nothing, and the remove-on-end
 * dance turns into a two-render cycle that misfires whenever a re-render
 * lands between the two. Remounting the node with a fresh `key` is the same
 * intent expressed in the framework's own terms: the old node goes, a new one
 * arrives with the class already on it, and it animates exactly once. The
 * animationend listener is then unnecessary — which is the point.
 */

/**
 * Has the reader asked for less motion? app/globals.css already collapses
 * --dur-* to 1ms, so nothing that is pure CSS needs to ask. This is only for
 * the one place that counts a number in JavaScript, and it is read through a
 * single function so there is one answer in the app rather than two.
 */
export function motionReduced(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A one-shot burst. Returns the key to hang on the node that should react,
 * and the function to call ON THE SUCCESS PATH — never on the click.
 */
export function useMomentBurst(): [number, () => void] {
  const [n, setN] = useState(0);
  const fire = useCallback(() => setN((v) => v + 1), []);
  return [n, fire];
}

// ---------------------------------------------------------------------------
// SIGNALS
// ---------------------------------------------------------------------------
/*
 * A success in one control sometimes lands somewhere else on the page. A
 * workout is the case: the button is a control in the scouting band and the
 * information arrives in the Attributes panel two sections down, which is
 * server-rendered and knows nothing about the click.
 *
 * router.refresh() re-renders the server tree in place without unmounting the
 * client components inside it, so a listener mounted around that panel is
 * still there when the new attributes arrive. That is the whole mechanism: a
 * module-level set of callbacks, one number per listener, no context and no
 * provider to thread through a page that does not otherwise need one.
 */
const listeners = new Map<string, Set<() => void>>();

/** Call on the success path. Named for the thing that happened, plus its subject. */
export function signalMoment(name: string): void {
  listeners.get(name)?.forEach((fn) => fn());
}

function useMomentSignal(names: string[]): number {
  const [n, setN] = useState(0);
  const key = names.join('\u0000');
  useEffect(() => {
    const fn = () => setN((v) => v + 1);
    const mine = key.split('\u0000');
    for (const name of mine) {
      let set = listeners.get(name);
      if (!set) { set = new Set(); listeners.set(name, set); }
      set.add(fn);
    }
    return () => {
      for (const name of mine) {
        const set = listeners.get(name);
        if (!set) continue;
        set.delete(fn);
        if (set.size === 0) listeners.delete(name);
      }
    };
  }, [key]);
  return n;
}

/**
 * Wraps a server-rendered block that reacts when `signal` fires. Nothing
 * happens on mount — a page load is not a moment — so the block paints
 * exactly as it does today until a signal actually arrives.
 */
export function MomentReveal({ signal, className = '', revealClassName, children }: {
  /** One name, or every name that should uncover this block. */
  signal: string | string[];
  className?: string;
  /** Classes added only for the run of the animation. */
  revealClassName: string;
  children: ReactNode;
}) {
  const n = useMomentSignal(typeof signal === 'string' ? [signal] : signal);
  return (
    <div key={n} className={n === 0 ? className : `${className} ${revealClassName}`}>
      {children}
    </div>
  );
}

/**
 * THE CONFIDENCE FIGURE, counting to what the file now says.
 *
 * This is the one count-up in the application and it is deliberately the only
 * one. Everywhere else the standing rule holds — final values are in the DOM
 * at frame one, because a number withheld for effect is a number the reader
 * has to wait for. It is made an exception here because the figure IS the
 * purchase: you spent a charge to move it, and watching it move is the
 * receipt. Three things keep it honest:
 *
 *   - It runs for --dur-reveal and no longer, so the answer is never more
 *     than a blink away.
 *   - It only ever counts UP, and only from a figure the reader was already
 *     looking at on this page. A first paint prints the number flat.
 *   - The accessible name carries the final figure from frame one, so a
 *     screen reader is told the answer rather than the animation, and reduced
 *     motion skips the count entirely.
 */
export function ConfidenceFigure({ value, subject, className = '' }: {
  value: number;
  /**
   * Who this figure is about — the player id. A count-up is only ever a
   * DELTA ON ONE MAN, so when the same node is reused for somebody else (the
   * next player card, a different row) the baseline moves with him and
   * nothing animates. Without this the figure would count from one prospect's
   * confidence to another's, which is not a fact about anything.
   */
  subject?: string;
  className?: string;
}) {
  const target = Math.round(value);
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const seen = useRef(subject);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const start = from.current;
    const sameMan = seen.current === subject;
    from.current = target;
    seen.current = subject;
    if (!sameMan || target <= start || motionReduced()) { setShown(target); return; }

    // --dur-reveal, read off the same token the stylesheet uses rather than
    // duplicated as a number here.
    const declared = getComputedStyle(document.documentElement).getPropertyValue('--dur-reveal').trim();
    const ms = declared.endsWith('ms') ? parseFloat(declared) : parseFloat(declared) * 1000;
    const dur = Number.isFinite(ms) && ms > 0 ? ms : 450;

    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      setShown(Math.round(start + (target - start) * k));
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current !== null) cancelAnimationFrame(raf.current); };
  }, [target, subject]);

  return (
    <span className={className} aria-label={`${target}%`}>
      <span aria-hidden="true">{shown}%</span>
    </span>
  );
}
