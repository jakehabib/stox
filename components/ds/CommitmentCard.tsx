'use client';

import type { ReactNode } from 'react';
import { ActionButton, type ActionResult } from './ActionButton';

/**
 * A decision staged as an object.
 *
 * The irreversible moments in a GM game — releasing a veteran, spending one of
 * the two perfect evaluations you get all year — were form submissions. Weight
 * does not come from making the user wait, and it does not come from
 * hold-to-confirm (which punishes the hundredth cut exactly as hard as the
 * first, and is miserable for keyboard and switch users). It comes from three
 * static things:
 *
 *   1. The player's face at size, so the row reads as a person.
 *   2. The consequence stated as a ledger, in the app's own voice, BEFORE the
 *      commit rather than discovered afterwards on the cap sheet.
 *   3. A confirm button whose LABEL CARRIES THE COST. "Confirm" is a form.
 *      "Spend a charge on Devereaux — 2 left, then 1" is a decision.
 *
 * `CutButton` already worked this way and worked well; this is that pattern
 * made available to the places that were missing it. Nothing here adds a step
 * to a path that already had one — where it replaces `window.confirm()` it is
 * one FEWER context switch, not one more.
 */
export function CommitmentCard({
  eyebrow, avatar, name, meta, ledger, note, warning,
  confirmLabel, workingLabel, doneLabel, onConfirm, onCancel, tone = 'bad',
}: {
  /** "Release · cannot be undone" — states the irreversibility in words. */
  eyebrow: string;
  avatar?: ReactNode;
  name: string;
  meta?: ReactNode;
  /** Before/after rows. `emphasis` marks the line the decision actually turns on. */
  ledger?: { label: string; value: ReactNode; emphasis?: boolean }[];
  note?: ReactNode;
  warning?: ReactNode;
  confirmLabel: string;
  workingLabel: string;
  doneLabel?: string;
  onConfirm: () => Promise<ActionResult>;
  onCancel: () => void;
  /** The accent edge. `bad` for destructive, `gold` for spending a scarce thing. */
  tone?: 'bad' | 'gold';
}) {
  const edge = tone === 'gold' ? 'border-gold' : 'border-bad';
  const eyebrowColor = tone === 'gold' ? 'text-gold' : 'text-bad';

  return (
    <div className={`pl-3.5 border-l-2 ${edge} space-y-3`}>
      <div className="flex items-center gap-3">
        {avatar}
        <div className="min-w-0">
          <div className={`label-sm ${eyebrowColor}`}>{eyebrow}</div>
          <div className="font-semibold text-[15px] mt-0.5 truncate">{name}</div>
          {meta && <div className="text-xs text-muted">{meta}</div>}
        </div>
      </div>

      {ledger && ledger.length > 0 && (
        <div className="panel p-3 space-y-1.5 text-sm">
          {ledger.map((row) => (
            <div
              key={row.label}
              className={`flex justify-between gap-3 ${row.emphasis ? 'pt-1.5 border-t border-line/60' : ''}`}
            >
              <span className="text-muted">{row.label}</span>
              <span className={`font-mono ${row.emphasis ? 'font-semibold' : ''}`}>{row.value}</span>
            </div>
          ))}
        </div>
      )}

      {note && <p className="text-xs text-muted leading-relaxed">{note}</p>}
      {warning && <p className="text-xs text-warn">{warning}</p>}

      <div className="flex gap-2">
        <ActionButton
          className={tone === 'gold' ? 'btn-primary flex-1' : 'btn-danger flex-1'}
          idleLabel={confirmLabel}
          workingLabel={workingLabel}
          doneLabel={doneLabel}
          onAction={onConfirm}
        />
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
