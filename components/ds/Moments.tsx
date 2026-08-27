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
 * THE CONFIDENCE FIGURE, at its value from frame one.
 *
 * This USED TO COUNT UP, and it was the only count-up in the application. It
 * was argued for on the grounds that the figure IS the purchase — you spent a
 * charge to move it, so watching it move is the receipt — and that argument
 * does not survive the rule it breaks. The app owner's own list, written at
 * the top of app/globals.css, has three items on it, and the count-up broke
 * two: "animation never delays information — final values render at frame
 * one" and "there are no count-ups anywhere". A reader who wanted to know
 * what he had just bought had to wait out an animation to be told, and the
 * one number on the page he was actually looking at was the one the screen
 * would not yet say.
 *
 * So the digits are the answer immediately, and the REVEAL MOVED OFF THEM
 * ONTO THE DECORATION AROUND THEM: on a rise for the same man, the figure
 * gets one pass of a lift and a brightening, which is a receipt that costs
 * the reader nothing. Nothing about the reveal gates the number — remove the
 * animation entirely, as reduced motion does, and the same digits are in the
 * same place at the same instant.
 */
export function ConfidenceFigure({ value, subject, className = '' }: {
  value: number;
  /**
   * Who this figure is about — the player id. The reveal is only ever a
   * DELTA ON ONE MAN, so when the same node is reused for somebody else (the
   * next player card, a different row) the baseline moves with him and
   * nothing fires. Without this the figure would celebrate one prospect's
   * confidence arriving at another's, which is not a fact about anything.
   */
  subject?: string;
  className?: string;
}) {
  const target = Math.round(value);
  // Bumped once per genuine rise for the same man. It is a remount key, not a
  // value: see the note at the top of this file for why re-adding a class to
  // a live node cannot restart a CSS animation and a fresh key can.
  const [beat, setBeat] = useState(0);
  const from = useRef(target);
  const seen = useRef(subject);

  useEffect(() => {
    const start = from.current;
    const sameMan = seen.current === subject;
    from.current = target;
    seen.current = subject;
    if (sameMan && target > start && !motionReduced()) setBeat((b) => b + 1);
  }, [target, subject]);

  // `target` renders unconditionally and identically on every path, so the
  // accessible name and the visible digits are the same string at frame one
  // whether or not anything is about to animate. The two-span shape is the
  // one this component has always rendered and is kept deliberately: the
  // outer node carries the accessible name and is what the reveal animates,
  // the inner one is the ink.
  return (
    <span key={beat} className={`${className}${beat > 0 ? ' moment-confidence' : ''}`} aria-label={`${target}%`}>
      <span aria-hidden="true">{target}%</span>
    </span>
  );
}
