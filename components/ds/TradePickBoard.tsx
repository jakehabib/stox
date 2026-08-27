'use client';

import { Tooltip } from '../Tooltip';
import { tip } from '@/lib/glossary';

/**
 * A pick as this board draws it. The number fields come straight off
 * `pickNumbers` (lib/draft.ts) and are never merged: `overall`/`slot` are the
 * selection this pick IS, present only once that draft's order has been
 * seeded, and the projected pair is where it would land if the order were set
 * off today's standings. A pick can carry one pair or neither, never both — a
 * projection printed beside a real number would be the screen arguing with the
 * draft it is describing.
 */
export interface PickAsset {
  id: string;
  year: number;
  round: number;
  /** Real in-round slot (1..roundSize). Only when the order for that year is seeded. */
  slot?: number;
  /** Real overall selection number, derived from that same slot. */
  overall?: number;
  /** Projected in-round slot. Only ever the next draft — a further-out year has no standings behind it. */
  projectedSlot?: number;
  /** Projected overall, from that same projected slot. */
  projectedOverall?: number;
  /** Which standings the projection is off, and whether that season is still being played. */
  projectedFrom?: { season: number; live: boolean };
  /** Picks per round — the "of 32" in a slot. */
  roundSize?: number;
  /** Club the pick originally belonged to, when that isn't the club holding it now. */
  via?: string;
}

/** The selection a chip prints, and the sentence that explains it. Both off the same number. */
function pickReading(p: PickAsset): { number?: number; real: boolean; title: string } {
  const of = p.roundSize ? ` of ${p.roundSize}` : '';
  if (p.overall !== undefined) {
    return {
      number: p.overall,
      real: true,
      title: `Round ${p.round}, pick ${p.slot}${of} — #${p.overall} overall. The order for this draft is set.`,
    };
  }
  if (p.projectedOverall !== undefined) {
    const from = p.projectedFrom?.live === false
      ? `off the ${p.projectedFrom.season} final standings — the order is stamped on when the draft opens`
      : 'if the season ended today';
    return {
      number: p.projectedOverall,
      real: false,
      title: `Projected round ${p.round}, pick ${p.projectedSlot}${of} — #${p.projectedOverall} overall, ${from}.`,
    };
  }
  return { real: false, title: `${p.year} round ${p.round} — the order for that draft does not exist yet.` };
}

/** Earliest selection first where both are known — the order the picks would be made in. */
const selectionRank = (p: PickAsset) => p.overall ?? p.projectedOverall ?? Number.MAX_SAFE_INTEGER;

/** What the numbers on a year's row mean, in one sentence. */
function yearNumbering(yearPicks: PickAsset[]): string {
  if (yearPicks.some((p) => p.overall !== undefined)) {
    return 'This draft is on the board — every number here is the selection that pick actually is, and it does not move again.';
  }
  const from = yearPicks.find((p) => p.projectedFrom)?.projectedFrom;
  if (from && !from.live) {
    return `The next draft to actually run. Its order comes off the ${from.season} final standings, which are in the books — these are the selections it opens with.`;
  }
  if (from) {
    return 'The next draft to actually run, so these picks carry where they would land if the season ended today. Later years have no standings behind them yet.';
  }
  return 'The next draft to actually run. No season has been played to set its order yet, so these picks carry no selection number.';
}

/**
 * Round is the only honest read on a pick before its slot exists, so it
 * carries the same tier ramp the rest of the app already uses for quality
 * (see RatingBadge): gold, sky, chalk, then muted. Accent green is
 * conspicuously absent — that colour means "in the deal" on this screen, and
 * a second-rounder must never be mistaken for a selected one.
 *
 * No number goes on a chip beyond its round and its selection number, real or
 * projected. The AI's value points for a pick sit behind the Trade Intel
 * upgrade (see TradeVerdict), so printing them here would give away the one
 * thing that upgrade sells.
 */
const ROUND_TIER: Record<number, { text: string; edge: string; bar: string; wash: string }> = {
  1: { text: 'text-gold', edge: 'border-gold/55', bar: 'bg-gold', wash: 'bg-gold/[0.10]' },
  2: { text: 'text-accent2', edge: 'border-accent2/45', bar: 'bg-accent2', wash: 'bg-accent2/[0.07]' },
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

/** "R1–R7", "R2, R4–R7" — a set of rounds collapsed into runs. */
function roundRuns(rounds: number[]): string {
  const sorted = [...new Set(rounds)].sort((a, b) => a - b);
  if (sorted.length === 0) return '—';
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const r of sorted.slice(1)) {
    if (r === prev + 1) { prev = r; continue; }
    parts.push(start === prev ? `R${start}` : `R${start}–R${prev}`);
    start = r;
    prev = r;
  }
  parts.push(start === prev ? `R${start}` : `R${start}–R${prev}`);
  return parts.join(', ');
}

function PickChip({ pick, selected, showSlot, showVia, compact, onToggle }: {
  pick: PickAsset; selected: boolean; showSlot: boolean; showVia: boolean; compact?: boolean; onToggle: (id: string) => void;
}) {
  const tier = pickTier(pick.round);
  const reading = pickReading(pick);
  return (
    <button
      type="button"
      onClick={() => onToggle(pick.id)}
      aria-pressed={selected}
      title={reading.title}
      aria-label={`${pick.year} round ${pick.round}${pick.via ? ` via ${pick.via}` : ''}${
        reading.number === undefined ? '' : reading.real ? `, pick ${reading.number} overall` : `, projected pick ${reading.number} overall`
      }`}
      className={`relative overflow-hidden rounded-md border text-left transition-colors ${
        compact ? 'px-2 pt-1 pb-1.5' : 'w-full px-1.5 pt-1 pb-1.5'
      } ${selected ? 'border-accent bg-accent/20' : `${tier.edge} ${tier.wash} hover:bg-raised`}`}
    >
      <div className={`stat-value leading-none ${compact ? 'text-[13px]' : 'text-[15px]'} ${selected ? 'text-accent' : tier.text}`}>
        R{pick.round}
      </div>
      {/* THE SELECTION, AS AN OVERALL NUMBER. Overall rather than in-round
          because that is the number a GM trades in — "it is pick 32", not
          "the 32nd of the first" — and because #32 and #128 can never be
          mistaken for each other the way two "#32"s in different rounds can.
          A real one is printed in chalk, a projection in the same accent the
          rest of the app uses for "this hasn't happened yet"; the title on the
          chip says which it is in words, off the same number.

          Reserved per YEAR rather than per chip: a row where nothing carries a
          number stays compact instead of holding open a line for a number that
          year can never have. */}
      {showSlot && (
        <div className={`mt-1 font-mono text-[10px] leading-none min-h-[10px] ${reading.real ? 'text-chalk/80' : 'text-accent2/80'}`}>
          {reading.number === undefined ? '' : `#${reading.number}`}
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
 * A year earns the round-by-round ladder when there is something in it to
 * read: selection numbers, a round held twice, a round that is gone, a pick
 * that came from another club. A future year holding one plain pick per round
 * has none of that, and seven boxes reading R1…R7 for the third year running
 * is a shape rather than information — the app owner, on exactly that on the
 * draft page: *"there is also no reason to show this in the draft years prior.
 * it doesn't add or do anything"*. Those years get one line.
 *
 * They still get their CHIPS on that line, unlike the draft page's collapsed
 * years, because here every pick is something you can put in a deal. What
 * collapses is the scaffolding — the fixed grid, the empty cells, the space
 * held open for a slot number that year cannot have — never the assets.
 */
/**
 * How deep one round's cell may stack before the ladder stops being the right
 * shape. Two or three picks in a round is a rebuild and reads perfectly as a
 * stack; a column tens deep turns the board into a tower — a probe league here
 * put eighty-three fourth-rounders on one club and drew a thirteen-thousand
 * pixel page. Past this the year flows instead, which wraps sideways, stays
 * bounded, and keeps every pick clickable.
 */
const MAX_STACK = 4;

function deepestRound(yearPicks: PickAsset[]): number {
  const perRound = new Map<number, number>();
  for (const p of yearPicks) perRound.set(p.round, (perRound.get(p.round) ?? 0) + 1);
  return Math.max(0, ...perRound.values());
}

function earnsLadder(yearPicks: PickAsset[], rounds: number, isNext: boolean): boolean {
  if (deepestRound(yearPicks) > MAX_STACK) return false;
  if (isNext) return true;
  if (yearPicks.some((p) => p.via)) return true;
  const held = yearPicks.map((p) => p.round);
  if (new Set(held).size !== held.length) return true;
  // A club starts life with exactly one pick in every round of every year it
  // holds, so a round that isn't here left in a trade. That earns the ladder —
  // it shows WHICH round is gone, in place, instead of leaving the reader to
  // notice an absence.
  return new Set(held).size < rounds;
}

/**
 * A club's draft capital as a board: years down, rounds across.
 *
 * The flat wrap of identical pills this replaces ("2027 R1  2027 R2  2027 R3
 * …") gave a club holding thirty picks five rows of undifferentiated text,
 * with no grouping, no sense of which were worth anything, and a first-rounder
 * rendered exactly like a seventh. Fixing the round column in place does two
 * things at once: a missing pick reads as a gap rather than as something you
 * have to notice isn't there, and the two clubs' boards line up with each
 * other across the screen.
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
  const colStyle = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` };

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
            const isNext = year === imminentYear;
            const showSlot = yearPicks.some((p) => p.overall !== undefined || p.projectedOverall !== undefined);
            const showVia = yearPicks.some((p) => p.via);
            const ladder = yearPicks.length > 0 && earnsLadder(yearPicks, rounds, isNext);
            return (
              <div key={year} className="flex items-stretch gap-1.5">
                <div className="w-[40px] shrink-0 pt-0.5">
                  <div className="stat-value text-[13px] leading-none text-chalk">{year}</div>
                  {isNext && (
                    <div className="mt-1 inline-flex items-center gap-1 text-[9px] leading-none text-accent2 uppercase tracking-wide">
                      Next
                      {/* What the numbers on this row ARE, which changes as the
                          calendar turns: a guess off an unfinished season, the
                          finished season the order will be stamped from, or —
                          once it has been — the selections themselves. Read off
                          the picks rather than passed in, so the sentence and
                          the chips can never describe different states. */}
                      {/* `start`: this is the first cell of the first column
                          of the board, 40px wide and hard against the left
                          margin of the panel, so a centred bubble opened 60px
                          off the left of the screen at 1440. */}
                      <Tooltip text={yearNumbering(yearPicks)} align="start" />
                    </div>
                  )}
                </div>

                {/* A year the club owns nothing in is one line, not seven
                    empty boxes. The fact is "there is nothing here", and a
                    ladder of dashes takes a row of space to say it. */}
                {yearPicks.length === 0 ? (
                  <div className="flex-1 flex items-center rounded-md border border-dashed border-line/30 px-2 text-[11px] text-muted min-h-[30px]">
                    Nothing held — every round gone
                  </div>
                ) : ladder ? (
                  <div className="grid flex-1 gap-1.5" style={colStyle}>
                    {Array.from({ length: cols }, (_, i) => {
                      // Earliest selection first where both are known, so a
                      // stacked cell reads in the order the picks would be made.
                      const inRound = yearPicks
                        .filter((p) => p.round === i + 1)
                        .sort((a, b) => selectionRank(a) - selectionRank(b));
                      if (inRound.length === 0) {
                        return (
                          <div
                            key={i}
                            title={`No ${year} round ${i + 1} pick`}
                            className="flex items-start justify-center rounded-md border border-dashed border-line/35 min-h-[30px] pt-1 text-[13px] leading-none text-muted/45"
                          >
                            –
                          </div>
                        );
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
                ) : (
                  /* THE QUIET YEAR. A full, plain set with no slot to project
                     and nothing that has happened to it — so it states its own
                     shape once, in words, and carries the picks themselves on
                     the same line to be clicked. Flowing rather than gridded is
                     also the fallback for a year too deep in one round to
                     column sensibly; it carries whatever those picks know, so
                     nothing is lost by arriving here. */
                  <div className="flex-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 min-h-[26px]">
                    {yearPicks
                      .slice()
                      .sort((a, b) => a.round - b.round || selectionRank(a) - selectionRank(b))
                      .map((p) => (
                        <PickChip
                          key={p.id}
                          pick={p}
                          selected={selected.has(p.id)}
                          showSlot={showSlot}
                          showVia={showVia}
                          compact
                          onToggle={onToggle}
                        />
                      ))}
                    <span className="text-[11px] text-muted ml-auto tabular-nums whitespace-nowrap">
                      {yearPicks.length} picks · {roundRuns(yearPicks.map((p) => p.round))}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
