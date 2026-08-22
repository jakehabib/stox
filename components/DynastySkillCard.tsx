'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { purchaseSkillAction } from '@/app/actions/dynasty';
import type { DynastySkillDef, DynastySkillId } from '@/lib/dynasty';
import { ActionButton } from './ds/ActionButton';
import { DeltaChip, useDeltaWatch } from './ds/DeltaChip';

/**
 * One upgrade, as a row: name, rank pips, what it does at the rank you own
 * (or would own next), price, button. Deliberately NOT a node in a branching
 * tree — there are no prerequisites in this system, so drawing connectors
 * between things that do not gate each other would be decoration pretending
 * to be structure.
 *
 * Spending a skill point is a permanent choice and used to read as a
 * re-render: the pip was simply filled the next time the page painted, and the
 * points counter in the masthead was simply one lower. Now the card
 * acknowledges the purchase — the rank pip fills, the surface carries a single
 * colour-only flash, and the point cost is stated as a delta beside the price
 * it was paid against. All three are additive; nothing on the card was
 * removed, resized or recoloured to make room.
 */
export function DynastySkillCard({ leagueId, def, rank, pointsAvailable, lockedBy, limitedUse }: {
  leagueId: string;
  def: DynastySkillDef;
  rank: number;
  pointsAvailable: number;
  /**
   * The tree. Non-null when this skill's prerequisite has not been bought —
   * the string names what unlocks it, straight from lib/dynasty.ts's
   * `lockedReason`, so the card and the server action cannot disagree about
   * whether a purchase is legal.
   *
   * A locked card must not offer a button. Spending a point on something you
   * cannot use is not a choice, it is a mistake the UI let you make.
   */
  lockedBy?: string | null;
  /**
   * Charge counter for an ability with per-season uses. `alwaysShow` is for
   * Full Scout, whose allowance is a baseline entitlement rather than
   * something this upgrade unlocks — the counter has to be visible at rank 0
   * or the card reads as "locked", which it is not.
   */
  limitedUse?: {
    max: number; remaining: number; label: string; alwaysShow?: boolean;
    /** A second charge this same upgrade buys — Scouting Network grants workouts AND Full Scouts. */
    second?: { max: number; remaining: number; label: string };
  };
}) {
  const [, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [justBought, setJustBought] = useState(false);
  const router = useRouter();
  const points = useDeltaWatch(pointsAvailable);

  // Cleared on a timer rather than on animationend, because under reduced
  // motion the animation is switched off and animationend never fires.
  useEffect(() => {
    if (!justBought) return;
    const t = setTimeout(() => setJustBought(false), 700);
    return () => clearTimeout(t);
  }, [justBought]);

  const locked = !!lockedBy;
  const maxed = rank >= def.ranks.length;
  const nextCost = maxed ? 0 : def.ranks[rank].cost;
  const affordable = !locked && !maxed && pointsAvailable >= nextCost;
  const currentEffect = rank > 0 ? def.ranks[rank - 1].effect : null;
  const nextEffect = maxed ? null : def.ranks[rank].effect;

  const buy = async () => {
    const r = await purchaseSkillAction(leagueId, def.id as DynastySkillId);
    setMsg(r.message);
    if (!r.ok) return false as const;
    // Armed only after the purchase is confirmed, so a refusal never leaves
    // the chip primed to fire on some later, unrelated change.
    points.arm();
    setJustBought(true);
    startTransition(() => router.refresh());
    return rank + 1 >= def.ranks.length ? 'Fully upgraded' : `Rank ${rank + 1}`;
  };

  return (
    <div
      className={`panel p-3.5 transition-colors ${rank > 0 ? 'border-accent/40' : ''} ${locked ? 'opacity-60' : ''} ${justBought ? 'commit-flash' : ''}`}
      style={{ transitionDuration: 'var(--dur-state)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-sm leading-tight">{def.name}</div>
          <div className="text-xs text-muted mt-0.5">{def.blurb}</div>
        </div>
        <div className="shrink-0 flex items-center gap-1 pt-0.5" title={`Rank ${rank} of ${def.ranks.length}`}>
          {def.ranks.map((_, i) => (
            <span key={i} className={`rank-pip w-2.5 h-2.5 rounded-sm ${i < rank ? 'bg-accent' : 'bg-line'}`} />
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
        <div className="mt-2.5 space-y-1">
          {[limitedUse, ...(limitedUse.second ? [limitedUse.second] : [])].map((u) => (
            <div key={u.label} className="flex items-center justify-between gap-2 bg-raised rounded px-2.5 py-1.5">
              <span className="label-sm">{u.label}</span>
              <span className="whitespace-nowrap">
                <span className={`stat-value text-stat-sm ${u.remaining === 0 ? 'text-bad' : 'text-chalk'}`}>
                  {u.remaining}
                </span>
                <span className="text-xs text-muted">/{u.max} remaining</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {nextEffect && (
        <div className="mt-2.5 text-xs text-muted flex gap-1.5">
          <span aria-hidden className="shrink-0">→</span>
          <span>{rank > 0 ? `Rank ${rank + 1}: ` : ''}{nextEffect}</span>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        {locked ? (
          <span className="pill border-line text-muted flex items-center gap-1.5">
            <span aria-hidden>🔒</span>{lockedBy}
          </span>
        ) : maxed ? (
          <span className="pill border-accent/40 text-accent">Fully upgraded</span>
        ) : (
          <span className="text-xs text-muted flex items-center gap-1.5">
            <span>
              Costs <span className="stat-value text-chalk">{nextCost}</span> skill point{nextCost === 1 ? '' : 's'}
            </span>
            <DeltaChip delta={points.delta} tone="info" />
          </span>
        )}
        {!maxed && !locked && (
          <ActionButton
            className="btn-primary text-xs"
            disabled={!affordable}
            idleLabel={rank > 0 ? `Upgrade to rank ${rank + 1}` : 'Unlock'}
            workingLabel="Working…"
            doneLabel={`Rank ${rank + 1}`}
            onAction={buy}
            title={affordable ? undefined : `You have ${pointsAvailable} skill point${pointsAvailable === 1 ? '' : 's'}.`}
          />
        )}
      </div>

      {msg && <div className="text-xs text-muted mt-2">{msg}</div>}
    </div>
  );
}
