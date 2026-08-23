'use client';

import { useState, type ReactNode } from 'react';
import { ACCEPT_INTEREST, type NegotiationSession, type OfferDecision, type Verdict } from '@/lib/negotiation';
import { formatMoney } from '@/lib/cap';
import { CLOCK_STOPS, type NegotiationFrame } from './frame';
import { Tooltip } from '../Tooltip';
import { tip } from '@/lib/glossary';

/**
 * The pieces all three mockup directions are built from. Layout is the thing
 * the directions differ in; these are the claims, and a claim that read one
 * way on one direction and another way on the next would make the comparison
 * worthless.
 */

/* ==========================================================================
   THE TRACK
   ========================================================================== */

/**
 * Verdict colours, one channel each of colour AND word — README design
 * principle 4. Taken from the shipped InterestMeter so a mockup and the live
 * panel cannot disagree about what green means.
 */
export const VERDICT_STYLE: Record<Verdict, { label: string; text: string; bar: string; ring: string }> = {
  ACCEPT:      { label: 'Will sign',   text: 'text-accent',  bar: 'bg-accent',  ring: 'border-accent/50' },
  MAYBE:       { label: 'Might sign',  text: 'text-accent2', bar: 'bg-accent2', ring: 'border-accent2/50' },
  CLOSE:       { label: 'Close',       text: 'text-gold',    bar: 'bg-gold',    ring: 'border-gold/50' },
  OUTBID:      { label: 'Losing out',  text: 'text-bad',     bar: 'bg-bad',     ring: 'border-bad/50' },
  CONSIDERING: { label: 'Considering', text: 'text-warn',    bar: 'bg-warn',    ring: 'border-warn/50' },
  COLD:        { label: 'Cold',        text: 'text-muted',   bar: 'bg-muted',   ring: 'border-line' },
  INSULTED:    { label: 'Insulted',    text: 'text-bad',     bar: 'bg-bad',     ring: 'border-bad/50' },
};

/**
 * Where his answer changes: considering, close, and the line where he signs.
 * The last one is ACCEPT_INTEREST rather than a second copy of 90 — a
 * threshold written down twice is how a meter comes to disagree with the
 * decision it is drawing. 45 and 72 are `evaluateOffer`'s own verdict cuts.
 */
export const THRESHOLDS = [45, 72, ACCEPT_INTEREST];

/**
 * The interest track, and the only thing in these mockups allowed to draw one.
 *
 * The rules it carries are not styling. The "might sign" stretch is drawn
 * because the player's number is hidden and the RULES are not — you may see
 * that there is a gamble and roughly how wide it is. The rival's package sits
 * on the same track because it is scored on the same scale by the same
 * function. And nothing here ever renders whether the hidden draw came up
 * yes: inside the band the bar says "might" and means it.
 */
export function MeterTrack({ interest, verdict, band, rival, height = 'h-3' }: {
  interest: number;
  verdict: Verdict;
  band: { lo: number; hi: number } | null;
  rival: { interest: number; label: string } | null;
  height?: string;
}) {
  const style = VERDICT_STYLE[verdict];
  return (
    <div className={`relative ${height} rounded-full bg-ink/70 border border-line/70 overflow-hidden`}>
      {band && (
        <div
          className="absolute inset-y-0 z-0 border-x border-accent2/50 bg-accent2/15"
          style={{ left: `${band.lo}%`, width: `${Math.max(0, band.hi - band.lo)}%` }}
          title={`${tip('maybeBand')} Submitting inside it spends patience either way.`}
        />
      )}
      {THRESHOLDS.map((t) => (
        <div key={t} className="absolute inset-y-0 z-10 w-px bg-line" style={{ left: `${t}%` }} />
      ))}
      {rival && (
        <div
          className="absolute inset-y-0 z-20 w-0.5 bg-chalk"
          style={{ left: `${Math.max(0, Math.min(100, rival.interest))}%` }}
          title={`${rival.label} — how their package reads to him on this same scale. Clear this and he is yours.`}
        />
      )}
      <div
        className={`h-full ${style.bar}`}
        style={{
          width: `${Math.max(2, interest)}%`,
          transition: 'width var(--dur-state) var(--ease-out), background-color var(--dur-state) var(--ease-out)',
        }}
      />
    </div>
  );
}

/* ==========================================================================
   THE CLOCK YOUR LEVERAGE RUNS DOWN ON
   ========================================================================== */

/**
 * The one element that makes this a single design rather than three.
 *
 * A free agent, your own man in his walk year, your own man whose deal has run
 * out and a man you control for three more seasons are four positions on ONE
 * line, and the line runs one way. Where he stands decides who else may put a
 * contract in front of him and what staying is worth to him — so the same
 * shape carries all three states and the copy under it is the only thing that
 * changes. It is also the answer to "why now": the stops to the right of him
 * are where this gets more expensive.
 */
export function LeverageClock({ frame, session, compact }: {
  frame: NegotiationFrame; session: NegotiationSession; compact?: boolean;
}) {
  const { ctx } = session;
  return (
    <div>
      <div className="flex items-stretch gap-1">
        {CLOCK_STOPS.map((s, i) => {
          const here = i === frame.stopIndex;
          const past = i < frame.stopIndex;
          return (
            <div key={s.key} className="flex-1 min-w-0">
              <div
                className={`h-1.5 rounded-full ${
                  here ? 'bg-accent' : past ? 'bg-line' : 'bg-raised'
                }`}
              />
              <div className={`mt-1.5 text-[10px] uppercase tracking-wider leading-tight ${
                here ? 'text-accent font-semibold' : past ? 'text-muted/60' : 'text-muted'
              }`}>
                {here ? '▸ ' : ''}{s.label}
              </div>
            </div>
          );
        })}
      </div>
      {!compact && (
        <div className="mt-3 space-y-1.5">
          <p className={`text-xs ${frame.openToOthers ? 'text-bad' : 'text-chalk'}`}>{frame.exclusivity}</p>
          {ctx.incumbent && (
            <p className="text-xs text-muted">
              <span className="text-chalk">{frame.discount}</span>{frame.discountClock ? ` ${frame.discountClock}` : ''}
            </p>
          )}
          {!ctx.incumbent && frame.discountClock && <p className="text-xs text-muted">{frame.discountClock}</p>}
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   PATIENCE
   ========================================================================== */

export function PatiencePips({ patience, spent, align = 'start' }: {
  patience: number; spent: number; align?: 'start' | 'end';
}) {
  return (
    <div className={`flex items-center gap-1 ${align === 'end' ? 'justify-end' : ''}`}>
      {Array.from({ length: patience }).map((_, i) => (
        <span key={i} className={`pip-well w-2.5 h-2.5 ${i < patience - spent ? '' : 'pip-spent'}`}>
          <span className="pip-fill" />
        </span>
      ))}
    </div>
  );
}

/* ==========================================================================
   WHAT IT DOES TO YOUR BOOKS
   ========================================================================== */

/**
 * The cap consequence, drawn as the shape of the commitment rather than as a
 * row of pills.
 *
 * Every other money surface in this game states the cost before the press —
 * the cut button, the pre-draft cap warning, the franchise tag. A contract is
 * the largest of those commitments and the one that lasts longest, so the
 * years are a column of bars you can read the shape of: which season this
 * lands hardest in, and where it stops. On a deal that appends, the seasons he
 * was already owed are marked as such in the caption as well as in the fill —
 * colour is never the only channel.
 */
export function CapWall({ decision, controlYears, appending, headroomHint }: {
  decision: OfferDecision;
  controlYears: number;
  appending: boolean;
  /** Say what the columns are underneath them. */
  headroomHint?: boolean;
}) {
  const hits = decision.capHitSchedule;
  // The tallest SEASON, not the cap room — scaling these against a club's
  // whole room draws five hairlines and says nothing about the shape of the
  // commitment, which is the only thing this picture is for.
  const peak = Math.max(...hits, 1);
  return (
    <div>
      <div className="flex items-end gap-1.5">
        {hits.map((hit, i) => {
          const owed = appending && i < controlYears;
          const overRoom = i === 0 && decision.blocked === 'CAP';
          return (
            <div key={i} className="flex-1 min-w-0 flex flex-col items-center gap-1">
              <span className={`text-[10px] font-mono ${overRoom ? 'text-bad' : owed ? 'text-muted' : 'text-chalk'}`}>
                {formatMoney(hit)}
              </span>
              {/* The track has a real height so the bar's percentage has
                  something to resolve against — an auto-height parent
                  collapses every bar to a hairline. */}
              <div className="w-full h-24 flex items-end">
                <div
                  className={`w-full rounded-t-sm border-t border-x ${
                    overRoom ? 'bg-bad/30 border-bad'
                      : owed ? 'bg-line/70 border-muted/60'
                      : 'bg-accent2/30 border-accent2/70'
                  }`}
                  style={{ height: `${Math.max(4, (hit / peak) * 100)}%` }}
                />
              </div>
              <span className={`text-[10px] uppercase tracking-wide ${owed ? 'text-muted/70' : 'text-muted'}`}>
                {owed ? 'owed' : `yr ${i + 1}`}
              </span>
            </div>
          );
        })}
      </div>
      {headroomHint && (
        <p className="text-[11px] text-muted mt-2">
          {appending
            ? `The first ${controlYears === 1 ? 'season is one' : `${controlYears} are seasons`} he was already owed, at the salary he was already promised. The rest is what you are adding.`
            : 'What this contract charges the cap, season by season.'}
        </p>
      )}
      {decision.strandedVoidMoney > 0 && (
        <div className="mt-2 flex items-baseline justify-between gap-3 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1.5">
          <span className="text-xs text-warn">After the deal ends — void-year dead money, no season attached</span>
          <span className="stat-value text-stat-sm text-warn">{formatMoney(decision.strandedVoidMoney)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Room before, room after, and the difference — stated in the user's own
 * units before the press rather than discoverable from the cap page
 * afterwards.
 */
export function RoomLine({ capSpace, spaceAfter, blocked, label = 'Cap room' }: {
  capSpace: number; spaceAfter: number; blocked: boolean; label?: string;
}) {
  const delta = spaceAfter - capSpace;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="label-sm inline-flex items-center gap-1.5">
        {label}
        <Tooltip align="start" text={tip('capSpace')} />
      </span>
      <span className="flex items-baseline gap-2 font-mono text-sm">
        <span className="text-muted">{formatMoney(capSpace)}</span>
        <span className="text-muted">→</span>
        <span className={`stat-value text-stat-sm ${blocked || spaceAfter < 0 ? 'text-bad' : 'text-accent'}`}>
          {formatMoney(spaceAfter)}
        </span>
        <span className={`text-[11px] ${delta < 0 ? 'text-bad' : 'text-accent'}`}>
          {delta <= 0 ? '' : '+'}{formatMoney(delta)}
        </span>
      </span>
    </div>
  );
}

/* ==========================================================================
   CONTROLS — a slider to feel it, a box to say it exactly
   ========================================================================== */

export interface NumberField {
  prefix?: string;
  suffix?: string;
  width: string;
  inputMode: 'numeric' | 'decimal';
  format: (v: number) => string;
  parse: (text: string) => number | null;
}

/**
 * Salary, typed in MILLIONS — prefixed "$" and suffixed "M", so "12.35" can
 * only mean $12.35M. Same field the shipped panel uses; a mockup that parsed
 * typed money differently would be a second path to the same offer.
 */
export const MILLIONS_FIELD: NumberField = {
  prefix: '$', suffix: 'M', width: '6ch', inputMode: 'decimal',
  format: (v) => {
    const s = (v / 1_000_000).toFixed(3);
    return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  },
  parse: (text) => {
    const cleaned = text.replace(/[$,\s]/g, '');
    const m = /^(\d*\.?\d*)([mMkK]?)$/.exec(cleaned);
    if (!m || m[1] === '' || m[1] === '.') return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return null;
    const dollars = m[2].toLowerCase() === 'k' ? n * 1_000 : n * 1_000_000;
    return Math.round(dollars / 1_000) * 1_000;
  },
};

export const INTEGER_FIELD: NumberField = {
  width: '3ch', inputMode: 'numeric',
  format: (v) => String(v),
  parse: (text) => {
    const cleaned = text.replace(/\s/g, '');
    if (!/^\d+$/.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  },
};

export const PERCENT_FIELD: NumberField = { ...INTEGER_FIELD, suffix: '%', width: '3ch' };

export function NumberEntry({ label, field, value, min, max, disabled, onCommit, className }: {
  label: string; field: NumberField; value: number; min: number; max: number;
  disabled?: boolean; onCommit: (v: number) => void; className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    /* A SPAN, not a div. This control is set into sentences on the term-sheet
       direction, and a <div> inside a <p> is invalid HTML — the browser closes
       the paragraph around it and the server markup and the client markup stop
       matching, which React reports as a hydration failure. */
    <span className={`inline-flex items-center gap-1 rounded-md border border-line bg-ink/60 px-2 py-1 align-middle ${disabled ? 'opacity-40' : 'focus-within:border-accent2/60'} ${className ?? ''}`}>
      {field.prefix && <span className="text-muted text-sm">{field.prefix}</span>}
      <input
        type="text"
        inputMode={field.inputMode}
        className="bg-transparent text-chalk text-sm font-mono outline-none tabular-nums"
        style={{ width: field.width }}
        value={draft ?? field.format(value)}
        disabled={disabled}
        aria-label={`${label} — type an exact value`}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setDraft(e.target.value);
          const parsed = field.parse(e.target.value);
          if (parsed === null) return;
          onCommit(Math.min(max, Math.max(min, parsed)));
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => { if (e.key === 'Enter') { setDraft(null); e.currentTarget.blur(); } }}
      />
      {field.suffix && <span className="text-muted text-sm">{field.suffix}</span>}
    </span>
  );
}

/**
 * One term of the deal, drawn as the term rather than as a widget: the figure
 * at stat scale, what it BUYS underneath it, and the slider attached to it.
 * The drag is the minigame, so the slider is never hidden behind a step or a
 * disclosure.
 */
export function DealTerm({ label, tipText, value, buys, warn, min, max, step, raw, onChange, disabled, field, children }: {
  label: string;
  tipText?: string;
  /** The figure, formatted — this is the hero of the row. */
  value: string;
  /** What that figure buys, in money or in seasons. */
  buys?: ReactNode;
  warn?: string;
  min: number; max: number; step: number; raw: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  field: NumberField;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-line/70 bg-ink/30 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label-sm inline-flex items-center gap-1.5">
          {label}
          {tipText && <Tooltip align="start" text={tipText} />}
        </span>
        <span className="stat-value text-stat-md">{value}</span>
      </div>
      <input
        type="range"
        className="slider mt-2.5"
        min={min} max={max} step={step} value={raw}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
      <div className="flex items-end justify-between gap-3 mt-2 flex-wrap">
        <NumberEntry
          label={label} field={field} value={raw} min={min} max={max}
          disabled={disabled} onCommit={onChange}
        />
        <div className="text-right min-w-0">
          {buys && <div className="text-xs text-muted">{buys}</div>}
          {warn && <div className="text-xs text-bad">{warn}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}
