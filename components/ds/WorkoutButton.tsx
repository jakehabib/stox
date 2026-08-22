'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { runWorkoutAction } from '@/app/actions/scouting';
import { CommitmentCard } from './CommitmentCard';

/**
 * The one scarce scouting decision in the game, staged as a decision.
 *
 * Everything else in scouting is now free: the consensus board is public from
 * the day the class is generated, and a starred prospect is worked every week
 * at no cost. A workout is the only place the GM has to give something up to
 * get something, which is exactly why it goes through CommitmentCard rather
 * than being one more button in a row of buttons — the label carries the cost
 * ("fly him in — 4 left, then 3"), so the price is read at the moment of the
 * choice instead of discovered afterwards on a counter in the header.
 *
 * SLOT STATE COMES FROM THE SERVER. `remaining`, `max`, `open` and `done` are
 * props, not a fetch: the pages that render this already load the ledger for
 * their own header, and lib/workouts.ts re-derives every one of these rules
 * from the database inside runWorkout() anyway. A client that lies about its
 * remaining slots gets the same refusal as one that does not — these props
 * decide what to OFFER, never what is allowed.
 */
export function WorkoutButton({
  leagueId, teamId, playerId, name, meta, avatar,
  remaining, max, open, windowLabel, done, potLow, potHigh, confidence,
  className = 'btn-secondary text-xs',
  layout = 'card',
}: {
  leagueId: string; teamId: string; playerId: string;
  name: string;
  meta?: ReactNode;
  /** Rendered by the server parent — the row has to read as a person, not a key. */
  avatar?: ReactNode;
  remaining: number;
  max: number;
  open: boolean;
  windowLabel: string;
  /** Already worked out this league year. A slot cannot be spent on him twice. */
  done: boolean;
  potLow?: number;
  potHigh?: number;
  confidence?: number;
  className?: string;
  /**
   * How the confirm step is drawn. 'card' is the original: a full
   * CommitmentCard with the ledger and the explanation, for a surface with a
   * column of space to give it.
   *
   * 'row' is for a table cell on the big board. A CommitmentCard in a table
   * cell is squeezed to the column's width and turns one row seven hundred
   * pixels tall — measured, not guessed. So the commit step collapses to the
   * one thing the card exists to guarantee: the PRICE IS ON THE BUTTON, read
   * at the moment of the choice rather than found afterwards on a counter in
   * the header. The paragraph explaining what a workout buys lives on the
   * column's own tooltip and on the player card, both one click away.
   */
  layout?: 'card' | 'row';
}) {
  const [staged, setStaged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (done) {
    return <span className="text-[11px] text-gold whitespace-nowrap" title="One workout per prospect per year.">✓ Worked out</span>;
  }
  if (!open) {
    return <span className="text-[11px] text-muted whitespace-nowrap" title={windowLabel}>Window closed</span>;
  }
  if (remaining <= 0) {
    return <span className="text-[11px] text-bad whitespace-nowrap" title={`All ${max} slots spent. They reset with the new league year.`}>No slots left</span>;
  }

  if (!staged) {
    return (
      <button type="button" className={className} onClick={() => setStaged(true)} title={windowLabel}>
        Work him out
      </button>
    );
  }

  if (layout === 'row') {
    return (
      <div className="flex flex-col items-start gap-1 min-w-[9.5rem]">
        <button
          type="button"
          className="btn-primary text-[11px] px-2 py-1 whitespace-nowrap"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const r = await runWorkoutAction(leagueId, teamId, playerId);
            setBusy(false);
            if (!r.ok) { setError(r.message); return; }
            setStaged(false);
            router.refresh();
          }}
        >
          {busy ? 'Flying him in…' : `Fly him in — ${remaining} left, then ${remaining - 1}`}
        </button>
        <button type="button" className="btn-ghost text-[11px] px-1 py-0.5" disabled={busy} onClick={() => { setError(null); setStaged(false); }}>
          Not him
        </button>
        {error && <p className="text-[11px] text-bad max-w-[12rem] leading-snug">{error}</p>}
      </div>
    );
  }

  return (
    <div className="w-full">
      <CommitmentCard
        tone="gold"
        eyebrow={`Private workout · ${remaining} of ${max} left this year`}
        avatar={avatar}
        name={name}
        meta={meta}
        ledger={[
          {
            label: 'Ceiling projection',
            value: potLow != null && potHigh != null ? `${potLow}–${potHigh} now` : '—',
          },
          { label: 'Our file', value: confidence != null ? `${Math.round(confidence)}% confidence` : '—' },
          { label: 'Workout slots', value: `${remaining} → ${remaining - 1}`, emphasis: true },
        ]}
        note={
          <>
            He flies in for a day. Your people run their own testing, so every timed and measured trait comes back
            exact, the ceiling projection tightens to about as narrow as it gets, and a day in the building gets you a
            firm read on his development curve. What a workout cannot settle is how he reads a defense on third
            down — the mental traits stay a range, and those are the traits that bust a pick.
          </>
        }
        confirmLabel={`Fly ${name} in — ${remaining} left, then ${remaining - 1}`}
        workingLabel="Working him out"
        doneLabel="Worked out"
        onConfirm={async () => {
          setError(null);
          const r = await runWorkoutAction(leagueId, teamId, playerId);
          if (!r.ok) {
            setError(r.message);
            return false;
          }
          router.refresh();
          setStaged(false);
          return `${r.measured?.length ?? 0} traits measured`;
        }}
        onCancel={() => { setError(null); setStaged(false); }}
      />
      {error && <p className="text-xs text-warn mt-2">{error}</p>}
    </div>
  );
}
