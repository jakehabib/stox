'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * "Show what changed, not just what is."
 *
 * Every mutation in this app already updates the numbers correctly — cut a
 * player and cap space really does go $21.1M → $22.1M. What it has never done
 * is say the change out loud. The user is left to remember the old figure and
 * subtract. That is not a missing animation, it is missing information, which
 * is exactly why a chip stating `+$1.04M` earns its place while a count-up
 * would not: a count-up DELAYS the number, and the numbers are the product.
 *
 * The mechanism is deliberately dumb. The value arrives as a prop from the
 * server (`router.refresh()` / `revalidatePath` already deliver it), the hook
 * keeps the previous one in a ref, and the difference is rendered beside the
 * new value for a couple of seconds. Nothing is optimistic — React is 18.3
 * here so `useOptimistic` does not exist, and it would be the wrong tool
 * anyway: a cap number the server then rejects would be a lying metric.
 *
 * ARMING is the important part. A ref that simply diffs on every re-render
 * fires on things that are not consequences — navigating from one player to
 * the next, a poll, a parent re-render with different data. So the chip only
 * fires when the component that owns the action explicitly says "I just did
 * something": call `arm()` at the moment of commit, and the next genuine
 * change within the window is attributed to it. One arm, one chip.
 */
export function useDeltaWatch(value: number, holdMs = 2500) {
  const last = useRef(value);
  const armed = useRef(false);
  const [delta, setDelta] = useState<number | null>(null);

  useEffect(() => {
    if (last.current === value) return;
    const d = value - last.current;
    last.current = value;
    if (armed.current) {
      armed.current = false;
      if (d !== 0) setDelta(d);
    }
  }, [value]);

  useEffect(() => {
    if (delta === null) return;
    const t = setTimeout(() => setDelta(null), holdMs);
    return () => clearTimeout(t);
  }, [delta, holdMs]);

  const arm = useCallback(() => { armed.current = true; }, []);

  return { delta, arm };
}

/**
 * The chip itself. Renders nothing at all when there is no delta, so it never
 * reserves space or shifts a layout that is sitting still.
 *
 * Reduced motion: the CSS duration tokens collapse to 1ms, so the chip appears
 * in place instead of rising. It still appears, and it still carries polarity
 * in its colour AND in its explicit sign. No fact is delivered by movement.
 */
export function DeltaChip({ delta, format, tone = 'polarity', className = '' }: {
  /** null hides the chip entirely. */
  delta: number | null;
  /** Formats the magnitude. The sign is prepended here, not by the formatter. */
  format?: (abs: number) => string;
  /**
   * `polarity` colours by direction (green up / red bad down). `info` is for a
   * change that is neither good nor bad — a confidence gain, a count.
   * `spend` treats a decrease as the intended, correct outcome, so it reads
   * neutral-blue rather than as a loss.
   */
  tone?: 'polarity' | 'info' | 'spend';
  className?: string;
}) {
  // A mount-then-add-class pass so the CSS transition has two frames to run
  // between. Without it the element is born in its final state and the rise
  // never happens (the value itself is unaffected either way).
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (delta === null) { setShown(false); return; }
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, [delta]);

  if (delta === null) return null;

  const up = delta > 0;
  const sign = up ? '+' : '−';
  const body = format ? format(Math.abs(delta)) : String(Math.abs(delta));
  const toneClass =
    tone === 'polarity' ? (up ? 'delta-up' : 'delta-down') : 'delta-info';

  return (
    <span
      className={`delta-chip ${toneClass} ${shown ? 'delta-chip-in' : ''} ${className}`}
      // Announced once, as a status, so a screen-reader user gets the same
      // "and here is what that changed" the sighted user gets.
      role="status"
    >
      {sign}{body}
    </span>
  );
}

/** Transient tint class for the value the chip is describing. */
export function deltaTint(delta: number | null, tone: 'polarity' | 'info' | 'spend' = 'polarity') {
  if (delta === null || tone !== 'polarity') return 'delta-tint';
  return `delta-tint ${delta > 0 ? 'delta-tint-up' : 'delta-tint-down'}`;
}
