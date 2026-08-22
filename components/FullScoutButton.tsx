'use client';

import { useEffect, useState, useTransition, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fullScoutAction, fullScoutPanelAction, type FullScoutPanelData } from '@/app/actions/dynasty';
import { ActionButton } from './ds/ActionButton';
import { DeltaChip, deltaTint, useDeltaWatch } from './ds/DeltaChip';

/**
 * FULL SCOUT, on one player.
 *
 * A single button plus the charge counter, so the price of the click is
 * visible before it is made — the whole point of the ability is the decision
 * "is THIS the guy I burn one of my two perfect evaluations on", and a button
 * that does not show what is left cannot pose that question.
 *
 * Drop-in for any player-detail surface: it fetches its own charge count and
 * refreshes the route on success, so the host page needs no state.
 *
 * The confirm step is new, and it is the one place in this pass that adds a
 * click. It is added on purpose: this is the most irreversible action in the
 * game, the panel version of it has always asked (with `window.confirm`, which
 * is now a proper card), and this version — sitting inches from the player's
 * own name and portrait — fired on a single click with nothing in between.
 * Two paths to the same permanent spend, one of which asked and one of which
 * did not, was incoherent. Full Scouts run to a handful a season, so this is
 * not a path anyone repeats; the veto rule is about the fiftieth click, and
 * there is no fiftieth click here.
 */
export function FullScoutButton({ leagueId, teamId, playerId, compact }: {
  leagueId: string;
  teamId: string;
  playerId: string;
  /** Renders as a single inline row rather than a bordered block. */
  compact?: boolean;
}) {
  const [panel, setPanel] = useState<FullScoutPanelData | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const load = useCallback(() => {
    // An empty query returns the default board plus the live charge count;
    // only the counter is used here.
    fullScoutPanelAction(leagueId, teamId, '').then(setPanel).catch(() => setPanel(null));
  }, [leagueId, teamId]);

  useEffect(() => { load(); }, [load]);

  const charges = useDeltaWatch(panel?.remaining ?? 0);

  const spend = async () => {
    const r = await fullScoutAction(leagueId, teamId, playerId);
    setMsg(r.message);
    if (!r.ok) { load(); return false as const; }
    // Armed only on a spend that actually happened — a refusal must not leave
    // the chip primed to fire on some later, unrelated change.
    charges.arm();
    load();
    setConfirming(false);
    startTransition(() => router.refresh());
    return 'File complete';
  };

  if (!panel) return <span className="text-xs text-muted">Checking Full Scouts…</span>;

  const out = panel.remaining <= 0;

  return (
    // Compact still STACKS. It used to be a single horizontal flex row, which
    // made the explanatory paragraph a flex item on the same line as the
    // button — and its host on the player page is a `shrink-0` column, so
    // nothing could constrain the text and nothing could wrap it. Measured: an
    // 83px overhang past a 1024px panel. `min-w-0` lets it shrink inside a
    // flex parent, and `max-w-xs` keeps the sentence from stretching the
    // parent wide in the first place.
    <div className={compact ? 'flex flex-col items-start gap-1 min-w-0 max-w-xs' : 'panel p-3 space-y-2'}>
      <div className="flex items-center gap-2 flex-wrap">
        {confirming ? (
          <>
            <ActionButton
              className="btn-primary text-xs"
              idleLabel={`Spend one — ${panel.remaining - 1} left after`}
              workingLabel="Evaluating…"
              doneLabel="File complete"
              onAction={spend}
            />
            <button className="btn-ghost text-xs" onClick={() => setConfirming(false)}>Cancel</button>
          </>
        ) : (
          <button className="btn-secondary text-xs" disabled={out} onClick={() => { setMsg(null); setConfirming(true); }}>
            Full Scout
          </button>
        )}
        <span className="text-xs whitespace-nowrap flex items-center gap-1.5">
          <span>
            <span className={`stat-value ${out ? 'text-bad' : 'text-chalk'} ${deltaTint(charges.delta, 'info')}`}>{panel.remaining}</span>
            <span className="text-muted">/{panel.max} remaining</span>
          </span>
          <DeltaChip delta={charges.delta} tone="info" />
        </span>
      </div>
      <p className="text-[11px] text-muted text-balance">
        {out
          ? `All ${panel.max} used for ${panel.seasonYear}. They reset when the new league year starts.`
          : confirming
            ? 'Permanent. The charge is spent whether or not you like what the file says, and unused ones do not carry over.'
            /* "Reveals this player's true ratings and exact ceiling" described
               the data model. A scouting department does not talk about
               revealing true ratings; it talks about putting people on a
               player. Same information, told from inside the building. */
            : 'Put the whole department on him and you will know exactly what he is and how high he goes. Costs one of this year’s evaluations.'}
      </p>
      {msg && <div className="text-xs text-muted">{msg}</div>}
    </div>
  );
}
