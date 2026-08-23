import { Tooltip } from '@/components/Tooltip';
import { tip } from '@/lib/glossary';
import { formatMoney } from '@/lib/cap';
import type { CapSheet, CapSheetYear } from '@/lib/cap-summary';

/**
 * ===========================================================================
 * THE MULTI-YEAR OUTLOOK — HOW MUCH ROOM, IN EACH OF THE NEXT FOUR YEARS
 * ===========================================================================
 * TOP OF THE ADVANCED TAB, AND A BAR CHART, BECAUSE THE APP OWNER SAID SO:
 * *"multi year outlook as a bar graph to the top so its easy to look at"*.
 * The reason is in his own sentence — this is the thing he wants to read at a
 * glance, first, without hunting for it — so the panel carries the shape and
 * the numbers and no roster detail at all. The names live at the bottom of the
 * tab, in the dead-money panel.
 *
 * WHAT CHANGED BESIDES THE FORM, and it is the part that actually mattered.
 * The line chart this replaces plotted ACTIVE contract charges only; its own
 * tooltip admitted "dead money and new signings aren't included". So it was
 * half of the future cap, and the other half was a second four-year chart on
 * the same screen. These bars are the COMPLETE picture: every dollar charged
 * in a year, active salary and dead money both, stacked against that year's
 * ceiling. The dead-money panel at the foot of the tab is now the ITEMISATION
 * of the dead segment of these bars rather than a rival account of it — both
 * read one `capSheet` result (see lib/cap-summary.ts), so the summary is
 * arithmetically the sum of the detail and they cannot disagree.
 *
 * ROOM, NOT COMMITTED. The old chart's series was "Committed Cap" — what has
 * been spent — and left the GM to subtract it from a grey ceiling line by eye.
 * The number he plans against is what is LEFT, so room is what every column
 * prints, in the ink that says whether it is a problem.
 *
 * ONE DOLLAR SCALE, SHARED BY ALL FOUR COLUMNS, with each year's ceiling drawn
 * as a rule across its own column at its own height — so a FLAT league's four
 * rules sit level and a FAST league's climb. Room is the distance between the
 * top of the stack and that rule, which makes the answer a gap you can see
 * rather than a subtraction. A club over the ceiling overflows past the rule
 * instead of being clipped flat: the scale is taken over
 * max(ceiling, committed) across the window. No second axis anywhere —
 * everything drawn here is dollars.
 *
 * THE COLOURS ARE TWO HUES, AND THE THIRD WAS DROPPED ON A MEASUREMENT. Money
 * on players is blue (#3987e5), money on nobody is red (#e66767): validated
 * against this app's card surface with the dataviz skill's checker at ΔE 29.0
 * normal / 19.2 protan / 31.4 tritan, every check passing under `--pairs all`.
 * The dead-money panel's violet (#9085e9, for a void-year bill not yet
 * written) is CORRECT down there, where it is adjacent only to red — but in
 * these bars it would sit in the same stack as blue, and blue against violet
 * measures ΔE 9.8 normal and 1.9 protan. That is a hard FAIL, not a floor-band
 * warning. Every other hue in the app's fixed viz order fails beside red too
 * (amber 6.7 deutan, pink 7.5, orange 6.6, teal 6.5; only green clears, at
 * 8.6, and green for dead money is a lie about what it is). So the
 * booked/scheduled split is carried by TEXTURE here: the scheduled portion is
 * the same red drawn as a 45° hatch, the dataviz skill's own escape for
 * exactly this case, and it says "provisional" better than a fourth hue would.
 * It is named in the legend and in the hover as well, so it never rests on
 * fill alone. The full split by name is one panel away, at the bottom.
 *
 * NO 'use client'. Everything here is CSS — `group-hover` for the hover layer,
 * the same mechanism components/Tooltip.tsx uses — because this renders inside
 * a Server Component, and an export of a client module reaches a server render
 * as a client reference rather than as a function.
 * ===========================================================================
 */

const ACTIVE_FILL = '#3987e5';
const DEAD_FILL = '#e66767';
/** The card surface the hatch is cut against — tailwind.config.ts `card`. */
const CARD = '#18181b';
const SCHEDULED_HATCH = `repeating-linear-gradient(45deg, ${DEAD_FILL} 0 3px, ${CARD} 3px 6px)`;
/**
 * Plot height in px — the single dollar scale every column is drawn against.
 * 220 rather than the 148 it was first drawn at: across a full-width panel the
 * cells are ~470px, and a bar as tall as it is wide is a block, not a mark.
 * The dataviz skill's thin-mark rule exists precisely because a fill that
 * square stops reading as a quantity.
 */
const BAR_PX = 220;
/**
 * How wide a bar is allowed to get, whatever the cell. Left-aligned under its
 * own year label rather than centred in the cell — centred, the bar and the
 * figure beneath it drifted apart and read as two separate things.
 */
const BAR_W = '5.5rem';

export function MultiYearOutlookPanel({ sheet }: { sheet: CapSheet }) {
  const { years, rosterFloor, preRoll, ledgerYear, beyondActive, beyondActiveMen, dead } = sheet;
  const first = years[0];
  const last = years[years.length - 1];

  // The scale spans the ceiling AND the commitment, so an over-cap year draws
  // past its own rule rather than being silently clipped flat against it.
  const scaleMax = Math.max(...years.map((y) => Math.max(y.capTotal, y.committed)), 1);
  const px = (v: number) => (v > 0 ? Math.max(2, Math.round((v / scaleMax) * BAR_PX)) : 0);
  const anyScheduled = years.some((y) => y.deadScheduled > 0);
  const anyDead = years.some((y) => y.deadTotal > 0);
  const deadInWindow = years.reduce((s, y) => s + y.deadTotal, 0);

  /**
   * THE BRIEF, and the reason the honesty sentence is in it rather than in a
   * tooltip. This is the first thing on the Advanced tab and the place a
   * reader forms his impression of the next four years, so the caveat has to
   * travel with the impression.
   *
   * The far column is a handful of men under contract, not a squad — a median
   * of 8 across every club in the database — so a bare "$235.4M free in 2043"
   * reads as money spare when it is really money he has to build a roster
   * with. It names the count and prices the empty slots at the league minimum,
   * which is a floor the game genuinely enforces rather than a guess at what
   * those men will cost. No such guess exists in this game and inventing one
   * here would be the lying metric with a helpful face on it.
   *
   * "As the books stand" because every figure is today's roster told forward:
   * no draft class, no free agent, no extension he has not signed yet. And a
   * club over the ceiling is a real state on this page — the compliance block
   * fires on exactly that — so the sentence has to survive a negative;
   * "leaves you -$71.3M under the ceiling" is not English.
   */
  const roomPhrase = (v: number) => (v >= 0 ? `${formatMoney(v)} under the ceiling` : `${formatMoney(-v)} OVER the ceiling`);
  const trend = last.room > first.room
    ? `opens up to ${last.room >= 0 ? formatMoney(last.room) : roomPhrase(last.room)} by ${last.year}`
    : `tightens to ${last.room >= 0 ? formatMoney(last.room) : roomPhrase(last.room)} by ${last.year}`;

  return (
    <div className="panel p-4 space-y-4">
      <div className="section-head !pb-1.5">
        <div>
          <div className="section-eyebrow">Multi-Year Outlook</div>
          <h2 className="section-title inline-flex items-center gap-1.5">
            Room, {first.year}–{last.year}
            <Tooltip text={tip('capSpace')} />
          </h2>
        </div>
        <div className="text-right">
          <div className={`stat-value text-stat-md ${first.room >= 0 ? 'text-accent' : 'text-bad'}`}>
            {formatMoney(first.room)}
          </div>
          <div className="text-[11px] text-muted">room in {first.year}</div>
        </div>
      </div>

      <p className="text-sm text-muted leading-relaxed">
        As the books stand, {first.year} leaves you {roomPhrase(first.room)} and the sheet {trend}.
        {' '}That last column is <strong className="text-chalk font-semibold">{last.menSigned} men under contract, not {rosterFloor}</strong>
        {last.openSlots > 0
          ? ` — filling the other ${last.openSlots} slots at the league minimum alone would take ${formatMoney(last.floorCost)} of it, before a single draft pick or free agent is paid what he is actually worth.`
          : ' — a full squad, so what is left there is genuinely spare.'}
        {/* NO EQUALITY CLAIM between this figure and the one the bottom panel
            heads with, because they are not the same figure: `deadInWindow` is
            the four columns drawn here, and the runway's headline is the WHOLE
            bill including anything dated past them. Saying "the panel below is
            that figure by name" would have put $59.0M here over a $61.8M
            headline three panels down — a small lie, and exactly the kind this
            page keeps having to be rescued from. */}
        {anyDead && ` ${formatMoney(deadInWindow)} of it is dead money and cannot be released; every charge is named at the foot of this tab.`}
      </p>

      {/* THE ONE WINDOW WHERE THE COLUMN LABELS SKEW, said out loud rather
          than left for a GM to trip over. Through OFFSEASON weeks 1-2 the
          contract ledger has already stepped onto the new league year while
          League.seasonYear has not, so every charge below is written in next
          year's terms under this year's heading. That is the whole page's
          convention — the masthead, the compliance gate and teamCapSummary all
          share it — and this panel is pinned to it deliberately (see
          lib/cap-summary.ts) rather than inventing a second calendar on one
          screen. What it can do is name it, which nothing else here does. */}
      {preRoll && (
        <p className="text-[11px] text-muted border-l-2 border-line pl-2.5 leading-relaxed">
          The books have already turned over onto {ledgerYear}: every charge below is written in the new league year&apos;s
          terms, and expiring deals stay on them until free agency opens. Every club in the league reads heavy right now.
        </p>
      )}

      {/* THE BARS. Column count follows the window rather than a literal 4, so
          CAP_SHEET_YEARS moving cannot draw the wrong number of plots. Each
          bar is capped at 7rem and centred in its cell: full width, four bars
          across 1,500px are blocks rather than marks, and the dataviz skill's
          thin-mark rule exists precisely because a fill that wide stops
          reading as a quantity. */}
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${years.length}, minmax(0, 1fr))` }}>
        {years.map((y, i) => (
          <YearColumn key={y.year} y={y} px={px} first={i === 0} last={i === years.length - 1} rosterFloor={rosterFloor} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: ACTIVE_FILL }} />
          Players under contract
        </span>
        {anyDead && (
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: DEAD_FILL }} />
            Dead money — on the ledger
            <Tooltip text={tip('deadMoney')} />
          </span>
        )}
        {anyScheduled && (
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundImage: SCHEDULED_HATCH }} />
            Void years — lands when the deal runs out
            <Tooltip text={tip('voidYears')} />
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0 shrink-0 border-t-2 border-dashed" style={{ borderColor: '#93939c' }} />
          The ceiling that season
          <Tooltip text={tip('capLimit')} />
        </span>
      </div>

      {/* Nothing past the last column is dropped. A chart that ended at the
          last column without saying so would read as "the books are clear
          after 2043", which is a promise the game never made. The dead half of
          what is out there is named in the panel at the foot of the tab; the
          long contracts are counted here, because this is where they were
          charged. */}
      {(beyondActive > 0 || dead.beyondWindow > 0) && (
        <p className="text-[11px] text-muted leading-relaxed">
          Past the last column, {last.year + 1} and beyond:
          {beyondActive > 0 && ` ${formatMoney(beyondActive)} still owed to ${beyondActiveMen} ${beyondActiveMen === 1 ? 'man' : 'men'} under contract`}
          {beyondActive > 0 && dead.beyondWindow > 0 && ', and'}
          {dead.beyondWindow > 0 && ` ${formatMoney(dead.beyondWindow)} of dead money, named at the foot of this tab`}.
        </p>
      )}
    </div>
  );
}

/**
 * One year: the stack, its ceiling rule, and the figure a GM came for.
 *
 * PIXELS, NOT PERCENTAGES, for the fills. Two stacked percentage heights plus
 * the 2px surface gap the mark spec asks for between them add up to more than
 * the box on the year that sets the scale, and that overflow lands on whatever
 * is drawn underneath.
 */
function YearColumn({ y, px, first, last, rosterFloor }: {
  y: CapSheetYear;
  px: (v: number) => number;
  first: boolean;
  last: boolean;
  rosterFloor: number;
}) {
  const over = y.room < 0;
  return (
    <div className="min-w-0">
      <div className="group relative" style={{ height: `${BAR_PX}px` }}>
        {/* The ceiling for THIS season, at its own height, drawn across the
            WHOLE cell rather than just the bar — it is a reference line for
            the year, and a rule the width of the mark it is measuring reads as
            part of the mark. A single baseline at this year's limit — which is
            what the old chart's grey line was before it was fixed —
            understates later headroom by tens of millions on any league that
            is not FLAT; four rules at four heights is the growth rung drawn
            honestly, level on FLAT and climbing on FAST. */}
        <div
          className="absolute left-0 right-0 border-t-2 border-dashed border-muted/70"
          style={{ bottom: `${px(y.capTotal)}px` }}
        />
        <div className="absolute left-0 bottom-0 w-full flex flex-col justify-end" style={{ maxWidth: BAR_W }}>
          {/* Scheduled on booked on active, each separated by the 2px surface
              gap — without it a club whose kinds are close in size reads as
              one undifferentiated bar. */}
          {y.deadScheduled > 0 && (
            <div className="rounded-t-[4px] mb-[2px]" style={{ height: `${px(y.deadScheduled)}px`, backgroundImage: SCHEDULED_HATCH }} />
          )}
          {y.deadBooked > 0 && (
            <div className={`mb-[2px] ${y.deadScheduled > 0 ? '' : 'rounded-t-[4px]'}`} style={{ height: `${px(y.deadBooked)}px`, backgroundColor: DEAD_FILL }} />
          )}
          {y.activeSalary > 0 && (
            <div className={y.deadTotal > 0 ? '' : 'rounded-t-[4px]'} style={{ height: `${px(y.activeSalary)}px`, backgroundColor: ACTIVE_FILL }} />
          )}
          {/* A year with nothing on the books is a flat baseline, not a missing
              column — the empty space up to the rule IS the answer. */}
          {y.committed === 0 && <div className="h-[2px] bg-line rounded-full" />}
        </div>

        {/* THE HOVER LAYER, which carries the split the column label cannot: a
            $60M year of active salary and a $60M year of dead money are the
            same bar and completely different clubs. */}
        <span
          role="tooltip"
          // A 12rem bubble over a column a quarter of a phone wide hangs well
          // past it, so the outer columns open INWARD — the same reasoning as
          // Tooltip's `align` prop, and without it the first column's bubble
          // pushes the page sideways.
          className={`pointer-events-none absolute z-40 bottom-full mb-1.5 w-48
                     rounded-md border border-line bg-surface px-2 py-1.5 text-[11px] leading-snug text-chalk
                     shadow-card opacity-0 group-hover:opacity-100 transition-opacity duration-100 text-left
                     ${first ? 'left-0' : last ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}
        >
          <span className="block font-semibold">{y.year} · {formatMoney(y.room)} {over ? 'over' : 'room'}</span>
          <span className="block text-muted">Ceiling {formatMoney(y.capTotal)}</span>
          {y.activeSalary > 0 && <span className="block text-muted">Under contract {formatMoney(y.activeSalary)} · {y.menSigned} men</span>}
          {y.deadBooked > 0 && <span className="block text-muted">Dead money {formatMoney(y.deadBooked)}</span>}
          {y.deadScheduled > 0 && <span className="block text-muted">Void years {formatMoney(y.deadScheduled)}</span>}
          {y.openSlots > 0 && <span className="block text-muted">{y.openSlots} slots short of {rosterFloor} · {formatMoney(y.floorCost)} at the minimum</span>}
        </span>
      </div>

      <div className="mt-2 pt-2 border-t border-line/70">
        <div className="label-sm">{y.year}</div>
        {/* formatMoney already signs a negative, so the minus is NOT added
            here — "−-$71.3M" is what doing both looks like. The typographic
            minus replaces the hyphen formatMoney emits, because in a mono face
            a hyphen beside a dollar sign reads as a dash between two figures. */}
        <div className={`stat-value text-stat-sm mt-0.5 ${over ? 'text-bad' : 'text-chalk'}`}>
          {over ? `−${formatMoney(-y.room)}` : formatMoney(y.room)}
        </div>
        <div className="text-[11px] text-muted mt-0.5">
          {over ? 'over the cap' : 'room'} · {y.menSigned} signed
        </div>
      </div>
    </div>
  );
}
