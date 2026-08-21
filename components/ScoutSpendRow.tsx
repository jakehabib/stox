'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { scoutPlayerAction, type ScoutResult } from '@/app/actions/scouting';
import type { ScoutTierKey } from '@/lib/tuning';

export interface SpendOption {
  tier: ScoutTierKey;
  label: string;
  /** Short form for the dense hub rows ("Look", "Eval", "Deep", "Focus"). */
  short: string;
  cost: number;
  blocked: string | null;
}

/**
 * The per-row spend control on the Scouting Department board. Costs arrive
 * pre-computed from the server (they depend on how many passes this team has
 * already spent on this player), so the price on the button is always the
 * price that will be charged.
 */
export function ScoutSpendRow({ leagueId, teamId, playerId, options }: {
  leagueId: string; teamId: string; playerId: string; options: SpendOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ScoutResult | null>(null);
  const router = useRouter();

  const spend = (tier: ScoutTierKey) => {
    startTransition(async () => {
      const r = await scoutPlayerAction(leagueId, teamId, playerId, tier);
      setResult(r);
      router.refresh();
    });
  };

  return (
    <div className="flex items-center justify-end gap-1.5">
      {result && (
        <span className={`text-[11px] whitespace-nowrap ${result.ok ? 'text-accent' : 'text-warn'}`}>
          {result.ok ? `−${result.spent} · ${result.confidence}%` : result.message}
        </span>
      )}
      {options.map((o) => (
        <button
          key={o.tier}
          disabled={pending || !!o.blocked}
          onClick={() => spend(o.tier)}
          title={o.blocked ?? `${o.label} — costs ${o.cost} focus`}
          className="btn-secondary text-[11px] px-2 py-1 disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {o.short} <span className="font-mono text-muted">{o.cost}</span>
        </button>
      ))}
    </div>
  );
}
