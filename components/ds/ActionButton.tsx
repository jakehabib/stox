'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export type ActionResult = string | false | void;

/**
 * The three-state action button: idle → working → ✓ done (~900ms) → idle.
 *
 * Audited against Saffer's microinteraction model, this app's mutations were
 * consistently strong on trigger and rules and silent on feedback: the success
 * path was communicated by ABSENCE. You released a player and the row was
 * simply gone. You spent a Full Scout and a number somewhere was one lower.
 * The done beat is what turns "the row disappeared" into "you did that".
 *
 * The one rule that makes it free:
 *
 *   THE DONE BEAT NEVER GATES INPUT. It begins AFTER the server has answered
 *   and while the page has already refreshed, and the button is re-enabled at
 *   the same instant it starts. An experienced player who clicks straight
 *   through waits exactly as long as they did before this component existed.
 *
 * If that ever stops being true — if the done state has to be waited out — the
 * right fix is to delete this, not to shorten it.
 */
export function ActionButton({
  className = 'btn-secondary',
  idleLabel,
  workingLabel,
  doneLabel = 'Done',
  onAction,
  disabled,
  title,
  doneMs = 900,
}: {
  className?: string;
  idleLabel: ReactNode;
  /** Shown beside the in-flight ring. A verb, so the pending state names the work. */
  workingLabel: string;
  /** Fallback done text; `onAction` may return a string to state the actual result. */
  doneLabel?: string;
  /**
   * Runs the mutation. Return a string to use it as the done label, or `false`
   * for a failure that should get no success beat at all — a refusal is not an
   * achievement and must not be dressed as one.
   */
  onAction: () => Promise<ActionResult>;
  disabled?: boolean;
  title?: string;
  doneMs?: number;
}) {
  const [phase, setPhase] = useState<'idle' | 'working' | 'done'>('idle');
  const [doneText, setDoneText] = useState(doneLabel);
  const alive = useRef(true);

  // Re-armed on mount, not only cleared on unmount. React StrictMode mounts,
  // unmounts and remounts every component in development, so a ref that is
  // only ever set to false in the cleanup stays false for the rest of the
  // component's life — and every `done` beat is silently swallowed.
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (phase !== 'done') return;
    const t = setTimeout(() => { if (alive.current) setPhase('idle'); }, doneMs);
    return () => clearTimeout(t);
  }, [phase, doneMs]);

  const run = useCallback(async () => {
    if (phase === 'working') return;
    setPhase('working');
    let result: ActionResult;
    try {
      result = await onAction();
    } catch {
      if (alive.current) setPhase('idle');
      return;
    }
    if (!alive.current) return;
    if (result === false) { setPhase('idle'); return; }
    setDoneText(typeof result === 'string' ? result : doneLabel);
    setPhase('done');
  }, [phase, onAction, doneLabel]);

  return (
    <button
      type="button"
      className={className}
      // Disabled ONLY while a request is genuinely open. The done beat is
      // decoration over a button that already works again.
      disabled={disabled || phase === 'working'}
      onClick={run}
      title={title}
    >
      {phase === 'working' && <span className="spinner-ring" aria-hidden />}
      {phase === 'done' && <span aria-hidden>✓</span>}
      <span>{phase === 'working' ? workingLabel : phase === 'done' ? doneText : idleLabel}</span>
    </button>
  );
}
