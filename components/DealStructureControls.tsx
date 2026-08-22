'use client';

import type { DealStructure } from '@/lib/negotiation';
import { CapMode } from '@/lib/types';
import { Tooltip } from './Tooltip';
import { tip } from '@/lib/glossary';

/** Where the escalation slider stops, and the step it moves in. */
export const STRUCTURE_RANGE = { min: 0.85, max: 1.25, step: 0.01 };
/** The shape a fresh deal opens in — cap-friendly year 1, same as buildContract's default. */
export const DEFAULT_ESCALATION = 1.12;
export const MAX_VOID_YEARS = 3;

export function structureLabel(escalation: number): string {
  if (escalation < 0.95) return 'Front-loaded';
  if (escalation > 1.05) return 'Back-loaded';
  return 'Balanced';
}

/**
 * Front-load / back-load and void years — the cap accounting on YOUR side of
 * the table, shared by every screen that signs a contract.
 *
 * This block lived inside SignOfferForm and only inside it, which is why the
 * app owner could say *"On the re-sign, we can't front load or backload - the
 * slider is missing"* and be exactly right: `ResignRow` passed no
 * `structureSlot`, so `structure` fell back to DEFAULT_STRUCTURE and the shape
 * of a re-signed deal simply could not be chosen. Extensions had a third copy
 * of the same two sliders in `ExtendContractForm`, wired to different state
 * with slightly different wording.
 *
 * One component, three screens. Copying it a second time would have been
 * faster and the three would have drifted the moment anybody tuned one.
 *
 * The player does not judge any of this. Escalation and void years change what
 * the deal does to your books, never what it pays him, so they stay out of
 * `evaluateOffer` entirely and only ever move the ledger — which is why they
 * are the one part of the panel that can be dragged with no risk of insulting
 * anybody.
 */
export function DealStructureControls({ structure, onChange, capMode, disabled }: {
  structure: DealStructure;
  onChange: (next: DealStructure) => void;
  capMode: CapMode;
  disabled?: boolean;
}) {
  // Nothing here means anything with the cap off: there is no proration to
  // shape and no year-1 hit to lower. Saying so is the job of whatever renders
  // the ledger; an empty pair of dead sliders is not.
  if (capMode === 'OFF') return null;

  return (
    <div className="space-y-4 border-t border-line/50 pt-4">
      <div className="label-sm">Deal shape — your books, not his decision</div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <label className="label-sm inline-flex items-center gap-1.5" htmlFor="deal-escalation">
            Structure
            <Tooltip align="start" text={tip('dealShape')} />
          </label>
          <span className="stat-value text-stat-sm">{structureLabel(structure.escalation)}</span>
        </div>
        <input
          id="deal-escalation"
          type="range"
          className="slider mt-2 accent-accent2"
          min={STRUCTURE_RANGE.min} max={STRUCTURE_RANGE.max} step={STRUCTURE_RANGE.step}
          value={structure.escalation}
          disabled={disabled}
          onChange={(e) => onChange({ ...structure, escalation: Number(e.target.value) })}
        />
        <div className="flex justify-between text-[11px] text-muted mt-1">
          <span>Front-load (pay now)</span><span>Back-load (defer cap)</span>
        </div>
      </div>

      {capMode === 'REALISTIC' && (
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label className="label-sm inline-flex items-center gap-1.5" htmlFor="deal-void-years">
              Void years
              <Tooltip align="start" text={tip('voidYears')} />
            </label>
            <span className="stat-value text-stat-sm">
              {structure.voidYears === 0 ? 'None' : `+${structure.voidYears}`}
            </span>
          </div>
          <input
            id="deal-void-years"
            type="range"
            className="slider mt-2 accent-warn"
            min={0} max={MAX_VOID_YEARS} step={1}
            value={structure.voidYears}
            disabled={disabled}
            onChange={(e) => onChange({ ...structure, voidYears: Number(e.target.value) })}
          />
          <p className="text-xs text-muted mt-1.5">
            Spreads bonus proration further to lower every real year&apos;s cap hit — but the remainder lands
            as dead money the season this deal ends. They are not extra contract years and he is not paid for them.
          </p>
        </div>
      )}
    </div>
  );
}
