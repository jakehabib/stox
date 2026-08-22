'use client';

import type { DealStructure } from '@/lib/negotiation';
import { usableVoidYears } from '@/lib/cap';
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
export function DealStructureControls({ structure, onChange, capMode, contractYears, disabled }: {
  structure: DealStructure;
  onChange: (next: DealStructure) => void;
  capMode: CapMode;
  /**
   * The FULL length of the deal this produces — on an extension that is the
   * appended total, not the years being added. The void-year control is sized
   * off it; see the block above the slider.
   */
  contractYears: number;
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
        /*
         * THE SLIDER MAY ONLY OFFER TRAVEL THAT DOES SOMETHING.
         * =====================================================================
         * A void year works by widening the proration divisor, and the divisor
         * stops at five. So on a five-year deal every void year is inert, and on
         * a four-year deal only the first one moves anything. This control used
         * to run 0-3 regardless, which is what the tester was looking at when he
         * reported that *"void years aren't altering cap hits"* — he was right,
         * and dragging harder was never going to help. Measured, year-1 hit on a
         * $20M/yr deal:
         *
         *     3yr:  +0 $20.00M  +1 $18.00M  +2 $16.80M  +3 $16.80M
         *     4yr:  +0 $20.00M  +1 $18.40M  +2 $18.40M  +3 $18.40M
         *     5yr:  +0 $20.00M  +1 $20.00M  +2 $20.00M  +3 $20.00M
         *
         * `usableVoidYears` is the same function `buildContract` clamps with, so
         * the control cannot offer a position the contract would silently drop.
         * At zero room the honest thing is to say why rather than render a dead
         * slider, so that is what happens — and it doubles as the explanation of
         * a real rule most players will not know.
         */
        (() => {
          const room = usableVoidYears(contractYears, MAX_VOID_YEARS);
          const shown = Math.min(structure.voidYears, room);
          return (
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <label className="label-sm inline-flex items-center gap-1.5" htmlFor="deal-void-years">
                  Void years
                  <Tooltip align="start" text={tip('voidYears')} />
                </label>
                <span className={`stat-value text-stat-sm ${room === 0 ? 'text-muted' : ''}`}>
                  {room === 0 ? 'Not available' : shown === 0 ? 'None' : `+${shown}`}
                </span>
              </div>
              {room === 0 ? (
                <p className="text-xs text-muted mt-1.5">
                  A signing bonus spreads over five years at most, and {contractYears} year
                  {contractYears === 1 ? '' : 's'} already uses that up — void years would have nothing
                  left to spread. Shorten the deal to open them up.
                </p>
              ) : (
                <>
                  <input
                    id="deal-void-years"
                    type="range"
                    className="slider mt-2 accent-warn"
                    min={0} max={room} step={1}
                    value={shown}
                    disabled={disabled}
                    onChange={(e) => onChange({ ...structure, voidYears: Number(e.target.value) })}
                  />
                  <p className="text-xs text-muted mt-1.5">
                    Spreads bonus proration further to lower every real year&apos;s cap hit — but the remainder lands
                    as dead money the season this deal ends. They are not extra contract years and he is not paid for them.
                  </p>
                </>
              )}
            </div>
          );
        })()
      )}
    </div>
  );
}
