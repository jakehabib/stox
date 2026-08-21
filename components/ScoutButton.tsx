'use client';

import { useEffect, useState, useTransition, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getScoutPanelAction, scoutPlayerAction, type ScoutPanel, type ScoutResult } from '@/app/actions/scouting';
import type { ScoutTierKey } from '@/lib/tuning';

/**
 * The scouting spend widget. Focus is finite now, so this component's first
 * job is not the button — it's making the price visible before the click:
 * what's left this period, what each tier costs on THIS player (repeat passes
 * cost more), and when the allowance refills.
 */
export function ScoutButton({ leagueId, teamId, playerId }: {
  leagueId: string; teamId: string; playerId: string;
  /** @deprecated the per-week lock was replaced by the focus economy; kept so existing callers still typecheck. */
  alreadyScoutedThisWeek?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [panel, setPanel] = useState<ScoutPanel | null>(null);
  const [result, setResult] = useState<ScoutResult | null>(null);
  const router = useRouter();

  const load = useCallback(() => {
    getScoutPanelAction(leagueId, teamId, playerId).then(setPanel).catch(() => setPanel(null));
  }, [leagueId, teamId, playerId]);

  useEffect(() => { load(); }, [load]);

  const spend = (tier: ScoutTierKey) => {
    startTransition(async () => {
      const r = await scoutPlayerAction(leagueId, teamId, playerId, tier);
      setResult(r);
      load();
      if (r.ok) router.refresh();
    });
  };

  if (!panel) {
    return <span className="text-xs text-muted shrink-0">Checking the scouting budget…</span>;
  }

  const { budget, options } = panel;
  const pct = budget.grant > 0 ? Math.max(0, Math.min(100, (budget.points / budget.grant) * 100)) : 0;
  const atCap = panel.periodPasses >= panel.maxPassesPerPeriod;

  return (
    <div className="shrink-0 w-full sm:w-[22rem]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label-sm">Scouting Focus</span>
        <span className="whitespace-nowrap">
          <span className={`stat-value text-stat-sm ${budget.points === 0 ? 'text-bad' : 'text-chalk'}`}>{budget.points}</span>
          <span className="text-xs text-muted"> / {budget.grant} left</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-raised overflow-hidden mt-1.5">
        <div className={`h-full rounded-full ${budget.points === 0 ? 'bg-bad/70' : 'bg-accent2/70'}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[11px] text-muted mt-1">
        {budget.periodLabel} · {budget.replenishLabel}
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3">
        {options.map((o) => (
          <button
            key={o.tier}
            disabled={pending || !!o.blocked}
            onClick={() => spend(o.tier)}
            title={o.blocked ?? o.blurb}
            className={`${o.tier === 'LOOK' ? 'btn-secondary' : 'btn-primary'} text-xs disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {o.label} · {o.cost}
          </button>
        ))}
      </div>

      {panel.passes > 0 && (
        <div className="text-[11px] text-muted mt-2">
          {panel.passes} pass{panel.passes === 1 ? '' : 'es'} on file — each one costs more and tells you less.
          {atCap && ' Staff is tapped out on him this period.'}
        </div>
      )}
      {panel.devTrait && (
        <div className="text-[11px] text-gold mt-1">Development curve: {panel.devTrait}</div>
      )}
      {result && (
        <div className={`text-xs mt-2 ${result.ok ? 'text-accent' : 'text-warn'}`}>
          {result.message}
          {result.ok && result.revealed && result.revealed.length > 0 && ` · locked ${result.revealed.length} attribute${result.revealed.length === 1 ? '' : 's'}`}
        </div>
      )}
    </div>
  );
}
