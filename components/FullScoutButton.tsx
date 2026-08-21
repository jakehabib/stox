'use client';

import { useEffect, useState, useTransition, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fullScoutAction, fullScoutPanelAction, type FullScoutPanelData } from '@/app/actions/dynasty';

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
 */
export function FullScoutButton({ leagueId, teamId, playerId, compact }: {
  leagueId: string;
  teamId: string;
  playerId: string;
  /** Renders as a single inline row rather than a bordered block. */
  compact?: boolean;
}) {
  const [panel, setPanel] = useState<FullScoutPanelData | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const load = useCallback(() => {
    // An empty query returns the default board plus the live charge count;
    // only the counter is used here.
    fullScoutPanelAction(leagueId, teamId, '').then(setPanel).catch(() => setPanel(null));
  }, [leagueId, teamId]);

  useEffect(() => { load(); }, [load]);

  const spend = () => {
    startTransition(async () => {
      const r = await fullScoutAction(leagueId, teamId, playerId);
      setMsg(r.message);
      load();
      if (r.ok) router.refresh();
    });
  };

  if (!panel) return <span className="text-xs text-muted">Checking Full Scouts…</span>;

  const out = panel.remaining <= 0;

  return (
    <div className={compact ? 'flex items-center gap-2 flex-wrap' : 'panel p-3 space-y-2'}>
      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-secondary text-xs" disabled={pending || out} onClick={spend}>
          {pending ? 'Evaluating…' : 'Full Scout'}
        </button>
        <span className="text-xs whitespace-nowrap">
          <span className={`stat-value ${out ? 'text-bad' : 'text-chalk'}`}>{panel.remaining}</span>
          <span className="text-muted">/{panel.max} remaining</span>
        </span>
      </div>
      <p className="text-[11px] text-muted">
        {out
          ? `All ${panel.max} used for ${panel.seasonYear}. They reset when the new league year starts.`
          : 'Reveals this player’s true ratings and exact ceiling. Permanent, and it costs one of your evaluations for the year.'}
      </p>
      {msg && <div className="text-xs text-muted">{msg}</div>}
    </div>
  );
}
