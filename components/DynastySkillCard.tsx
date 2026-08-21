'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { purchaseSkillAction } from '@/app/actions/dynasty';
import type { DynastySkillDef, DynastySkillId } from '@/lib/dynasty';

/**
 * One upgrade, as a row: name, rank pips, what it does at the rank you own
 * (or would own next), price, button. Deliberately NOT a node in a branching
 * tree — there are no prerequisites in this system, so drawing connectors
 * between things that do not gate each other would be decoration pretending
 * to be structure.
 */
export function DynastySkillCard({ leagueId, def, rank, pointsAvailable, limitedUse }: {
  leagueId: string;
  def: DynastySkillDef;
  rank: number;
  pointsAvailable: number;
  /**
   * Charge counter for an ability with per-season uses. `alwaysShow` is for
   * Full Scout, whose allowance is a baseline entitlement rather than
   * something this upgrade unlocks — the counter has to be visible at rank 0
   * or the card reads as "locked", which it is not.
   */
  limitedUse?: { max: number; remaining: number; label: string; alwaysShow?: boolean };
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  const maxed = rank >= def.ranks.length;
  const nextCost = maxed ? 0 : def.ranks[rank].cost;
  const affordable = !maxed && pointsAvailable >= nextCost;
  const currentEffect = rank > 0 ? def.ranks[rank - 1].effect : null;
  const nextEffect = maxed ? null : def.ranks[rank].effect;

  const buy = () => {
    startTransition(async () => {
      const r = await purchaseSkillAction(leagueId, def.id as DynastySkillId);
      setMsg(r.message);
      if (r.ok) router.refresh();
    });
  };

  return (
    <div className={`panel p-3.5 ${rank > 0 ? 'border-accent/40' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-sm leading-tight">{def.name}</div>
          <div className="text-xs text-muted mt-0.5">{def.blurb}</div>
        </div>
        <div className="shrink-0 flex items-center gap-1 pt-0.5" title={`Rank ${rank} of ${def.ranks.length}`}>
          {def.ranks.map((_, i) => (
            <span key={i} className={`w-2.5 h-2.5 rounded-sm ${i < rank ? 'bg-accent' : 'bg-line'}`} />
          ))}
        </div>
      </div>

      {currentEffect && (
        <div className="mt-2.5 text-xs text-accent/90 flex gap-1.5">
          <span aria-hidden className="shrink-0">✓</span>
          <span>{currentEffect}</span>
        </div>
      )}

      {limitedUse && (rank > 0 || limitedUse.alwaysShow) && (
        <div className="mt-2.5 flex items-center justify-between gap-2 bg-raised rounded px-2.5 py-1.5">
          <span className="label-sm">{limitedUse.label}</span>
          <span className="whitespace-nowrap">
            <span className={`stat-value text-stat-sm ${limitedUse.remaining === 0 ? 'text-bad' : 'text-chalk'}`}>
              {limitedUse.remaining}
            </span>
            <span className="text-xs text-muted">/{limitedUse.max} remaining</span>
          </span>
        </div>
      )}

      {nextEffect && (
        <div className="mt-2.5 text-xs text-muted flex gap-1.5">
          <span aria-hidden className="shrink-0">→</span>
          <span>{rank > 0 ? `Rank ${rank + 1}: ` : ''}{nextEffect}</span>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        {maxed ? (
          <span className="pill border-accent/40 text-accent">Fully upgraded</span>
        ) : (
          /* The price is the same on nearly every node on the page, so it
             sits back and lets the effect line above it lead. */
          <span className="cell-constant">
            Costs <span className="stat-value text-muted">{nextCost}</span> skill point{nextCost === 1 ? '' : 's'}
          </span>
        )}
        {!maxed && (
          <button
            className="btn-secondary text-xs"
            disabled={pending || !affordable}
            onClick={buy}
            title={affordable ? undefined : `You have ${pointsAvailable} skill point${pointsAvailable === 1 ? '' : 's'}.`}
          >
            {pending ? 'Working…' : rank > 0 ? `Upgrade to rank ${rank + 1}` : 'Unlock'}
          </button>
        )}
      </div>

      {msg && <div className="text-xs text-muted mt-2">{msg}</div>}
    </div>
  );
}
