'use client';

import { Tooltip } from '../Tooltip';
import { tip } from '@/lib/glossary';

export interface PickAsset {
  id: string;
  year: number;
  round: number;
  slot: number;
  /**
   * Where this pick would land if the season ended today. Only ever set for
   * the next draft — a further-out year has no standings to project from, so
   * those chips deliberately show no slot rather than a made-up one.
   */
  projectedSlot?: number;
  /** Club the pick originally belonged to, when that isn't the club holding it now. */
  via?: string;
}

/**
 * Round is the only honest read on a pick before its slot exists, so it
 * carries the same tier ramp the rest of the app already uses for quality
 * (see RatingBadge): gold, sky, chalk, then muted. Accent green is
 * conspicuously absent — that colour means "in the deal" on this screen, and
 * a second-rounder must never be mistaken for a selected one.
 */
const ROUND_TIER: Record<number, { text: string; edge: string; bar: string; wash: string }> = {
  1: { text: 'text-gold', edge: 'border-gold/50', bar: 'bg-gold', wash: 'bg-gold/[0.07]' },
  2: { text: 'text-accent2', edge: 'border-accent2/45', bar: 'bg-accent2', wash: 'bg-accent2/[0.06]' },
  3: { text: 'text-chalk', edge: 'border-line', bar: 'bg-chalk/60', wash: 'bg-raised/40' },
};
const LATE_ROUND = { text: 'text-muted', edge: 'border-line/60', bar: 'bg-muted/45', wash: 'bg-raised/25' };

/**
 * The round's chip colours. Exported so a pick rendered anywhere else on this
 * screen — the deal sheet, the recap of a completed trade — is the same object
 * the board just showed, rather than a second opinion about what a third-round
 * pick looks like.
 */
export function pickTier(round: number) {
  return ROUND_TIER[round] ?? LATE_ROUND;
}

function tierFor(round: number) {
  return pickTier(round);
}

function PickChip({ pick, selected, showSlot, showVia, onToggle }: {
  pick: PickAsset; selected: boolean; showSlot: boolean; showVia: boolean; onToggle: (id: string) => void;
}) {
  const tier = tierFor(pick.round);
  return (
    <button
      type="button"
      onClick={() => onToggle(pick.id)}
      aria-pressed={selected}
      aria-label={`${pick.year} round ${pick.round}${pick.via ? ` via ${pick.via}` : ''}`}
      className={`relative w-full overflow-hidden rounded-md border px-1.5 pt-1 pb-1.5 text-left transition-colors ${
        selected ? 'border-accent bg-accent/20' : `${tier.edge} ${tier.wash} hover:bg-raised`
      }`}
    >
      <div className={`stat-value text-[15px] leading-none ${selected ? 'text-accent' : tier.text}`}>R{pick.round}</div>
      {/* Reserved per YEAR rather than per chip: a row where nothing carries a
          projection stays compact instead of holding open a line for a number
          that year can never have. */}
      {showSlot && (
        <div className="mt-1 font-mono text-[10px] leading-none text-chalk/80 min-h-[10px]">
          {pick.projectedSlot ? `#${pick.projectedSlot}` : ''}
        </div>
      )}
      {showVia && (
        <div className="mt-1 text-[9px] leading-none text-muted truncate min-h-[9px]">
          {pick.via ? `via ${pick.via}` : ''}
        </div>
      )}
      {/* The round drawn as weight. Reading down a column says nothing;
          reading ACROSS a year says at a glance whether this club's capital is
          front-loaded or a pile of late-round filler. */}
      <span
        className={`absolute left-0 right-0 bottom-0 h-[2px] ${selected ? 'bg-accent' : tier.bar}`}
        style={{ opacity: Math.max(0.25, 1 - (pick.round - 1) * 0.13) }}
      />
    </button>
  );
}

/**
 * A club's draft capital as a board: years down, rounds across.
 *
 * The flat wrap of identical pills this replaces ("2027 R1  2027 R2  2027 R3
 * …") gave a club holding twenty-one picks four rows of undifferentiated
 * text, with no grouping, no sense of which were worth anything, and a
 * first-rounder rendered exactly like a seventh. Fixing the round column in
 * place does two things at once: a missing pick reads as a gap rather than as
 * something you have to notice isn't there, and the two clubs' boards line up
 * with each other across the screen.
 */
export function TradePickBoard({ picks, rounds, imminentYear, selected, onToggle }: {
  picks: PickAsset[];
  /** The league's configured draft rounds — the column count, so both clubs' boards line up even where one holds nothing in a round. */
  rounds: number;
  /** The next draft that will actually run. Only its picks carry a live slot projection. */
  imminentYear?: number | null;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  // A pick outside the configured round count would otherwise fall off the
  // right edge of the grid without a trace, so the grid widens to hold it.
  const cols = picks.reduce((m, p) => Math.max(m, p.round), rounds);
  const cols100 = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` };

  /**
   * Every year from the next draft to the last one this club holds anything
   * in — INCLUDING the ones it holds nothing in, which are the years worth
   * knowing about. Listing only the years with picks in them renders a club
   * that has traded away its entire 2028 as though 2028 did not exist.
   * Bounded, so a stray far-future pick cannot draw a decade of empty rows.
   */
  const held = picks.map((p) => p.year);
  const last = Math.max(...held);
  const first = Math.min(imminentYear && imminentYear <= last ? imminentYear : last, ...held);
  const years = Array.from({ length: Math.min(last - first + 1, 8) }, (_, i) => first + i);

  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="label-sm inline-flex items-center gap-1.5">
          Draft Capital
          <Tooltip text={tip('pickValue')} />
        </span>
        <span className="text-[11px] text-muted tabular-nums">
          {picks.length} {picks.length === 1 ? 'pick' : 'picks'}
        </span>
      </div>

      {picks.length === 0 ? (
        <div className="rounded-md border border-dashed border-line/70 px-3 py-3 text-xs text-muted">
          No picks owned.
        </div>
      ) : (
        <div className="space-y-1.5">
          {years.map((year) => {
            const yearPicks = picks.filter((p) => p.year === year);
            const showSlot = yearPicks.some((p) => p.projectedSlot);
            const showVia = yearPicks.some((p) => p.via);
            return (
              <div key={year} className="flex items-stretch gap-1.5">
                <div className="w-[40px] shrink-0 pt-0.5">
                  <div className="stat-value text-[13px] leading-none text-chalk">{year}</div>
                  {year === imminentYear && (
                    <div className="mt-1 inline-flex items-center gap-1 text-[9px] leading-none text-accent2 uppercase tracking-wide">
                      Next
                      <Tooltip text="The next draft to actually run, so these picks carry where they would land if the season ended today. Later years have no standings behind them yet." />
                    </div>
                  )}
                </div>
                <div className="grid flex-1 gap-1.5" style={cols100}>
                  {Array.from({ length: cols }, (_, i) => {
                    // Earliest selection first where both are known, so a
                    // stacked cell reads in the order the picks would be made.
                    const inRound = yearPicks
                      .filter((p) => p.round === i + 1)
                      .sort((a, b) => (a.projectedSlot ?? 99) - (b.projectedSlot ?? 99));
                    if (inRound.length === 0) {
                      return <div key={i} className="rounded-md border border-dashed border-line/30 min-h-[30px]" />;
                    }
                    return (
                      <div key={i} className="flex flex-col gap-1">
                        {inRound.map((p) => (
                          <PickChip
                            key={p.id}
                            pick={p}
                            selected={selected.has(p.id)}
                            showSlot={showSlot}
                            showVia={showVia}
                            onToggle={onToggle}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
