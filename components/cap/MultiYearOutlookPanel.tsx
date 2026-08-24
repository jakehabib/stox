import { Tooltip } from '@/components/Tooltip';
import { TeamLogo } from '@/components/TeamLogo';
import { tip } from '@/lib/glossary';
import { formatMoney } from '@/lib/cap';
import type { CapSheet, CapSheetYear } from '@/lib/cap-summary';

/**
 * ===========================================================================
 * THE MULTI-YEAR OUTLOOK — FOUR SEASONS OF MONEY, STACKED TO A CEILING LINE
 * ===========================================================================
 * TOP OF THE ADVANCED TAB, AND A BAR GRAPH, BECAUSE THE APP OWNER SAID SO:
 * *"multi year outlook as a bar graph to the top so its easy to look at"*.
 * The reason is in his own sentence — this is the thing he wants to read at a
 * glance, first, without hunting for it — so the panel carries the shape and
 * the numbers and no roster detail at all. The names live at the bottom of the
 * tab, in the dead-money panel.
 *
 * ---------------------------------------------------------------------------
 * THE FORM, AND WHO CHOSE IT
 * ---------------------------------------------------------------------------
 * *"vertical bars going horizontal... with cap on the Y axis and years on the
 * X axis"*, then, off four drawn mockups, *"lets do mockup option B, and then
 * ship that"*. B is **Stacked to a Ceiling Line**, and this file is it:
 *
 *   Y AXIS IS DOLLARS, from zero, ticked every $50M with a gridline across the
 *     plot at each tick. Heights are therefore money, directly comparable
 *     season to season — the thing the previous horizontal form could not do,
 *     because there every track was a full-width ceiling and the eye compared
 *     fractions instead of dollars.
 *   X AXIS IS SEASONS. Each carries its year, the men signed that year, and
 *     THAT YEAR'S DEAD MONEY, printed even when it is nothing. See the note on
 *     the disappearing panel below — that line is the fix.
 *   ONE COLUMN PER SEASON, GROWN FROM ZERO, stacked: salary under contract at
 *     the bottom, then dead money on the ledger, then dead money scheduled
 *     against void years.
 *   THE CEILING IS FOUR STEPPED CHALK SEGMENTS, one over each column, NOT one
 *     flat rule across the plot. It climbs 1% a season on the default growth
 *     rung, so a single line would be a lie about a growing league — and on a
 *     FLAT league the four steps land level and say so honestly.
 *   ROOM IS THE FIGURE ABOVE THE COLUMN, red and reading "over" when negative.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE THIS PANEL KEEPS BEING RESCUED BY: DRAWN == PRINTED
 * ---------------------------------------------------------------------------
 * The version that shipped in 1867784 drew each column's HEIGHT from
 * `committed` and printed `room` — the ceiling MINUS that — beneath it, so
 * every column said two opposite things at once, and scripts/_yo_diag.ts
 * measured the bar moving OPPOSITE to its own figure on 92.8% of consecutive
 * column pairs. That is what "extremely confusing" was.
 *
 * In this form the identity is structural rather than lucky:
 *
 *     column height   = pct(committed)          on the shared dollar scale
 *     ceiling step    = pct(capTotal)           on the SAME scale
 *     the gap between = pct(capTotal - committed) = pct(room) = THE FIGURE
 *
 * The number above the column is the distance from the top of the column to
 * its own step, in the same dollars per pixel as everything else on the plot.
 * There is no second scale and nothing is normalised per column. Proven on
 * real clubs in scripts/_capb_probe.ts, which re-derives this geometry BY HAND
 * from these rules rather than importing it, so a component that broke the
 * identity would fail there rather than be echoed back.
 *
 * ONE DOLLAR SCALE, ZERO-BASED. `scaleMax` spans max(ceiling, committed)
 * across the window plus 6% of headroom, rounded up to the next $25M so the
 * $50M tick ladder lands on round money and an over-cap column has somewhere
 * to be drawn.
 *
 * EACH SEASON'S CEILING AT ITS OWN HEIGHT. `capTotal` per year comes from
 * `capForLeague` (lib/cap-summary.ts), which resolves the league's founding
 * year AND its own growth rung — so a FLAT league's four steps sit level and a
 * FAST league's climb. `capForYear` with two arguments silently computes the
 * tuning default's curve and would draw a league nobody is playing.
 *
 * AN OVER-CAP COLUMN IS NOT CLIPPED. It grows PAST its own step, and the step
 * is drawn LAST — over the fills — so the line it broke through stays visible
 * through the red. Chalk rather than red on an over year: red-on-red measured
 * invisible in an earlier pass, and red already belongs to dead money.
 *
 * ---------------------------------------------------------------------------
 * THE DEAD MONEY THAT WENT MISSING
 * ---------------------------------------------------------------------------
 * *"the dead cap is missing from the advanced tab"*. It was not missing: the
 * runway panel at the foot of the tab returns null on a club with nothing
 * dead on the books, so "you have none" and "we forgot to show you" looked
 * identical. The X axis here answers it for every club on every season, in one
 * line of type, whether the figure is $59.2M or $0 — and the two red fills are
 * inside the column rather than in a panel that can delete itself.
 *
 * THE COLOURS ARE TWO HUES, AND THE THIRD WAS DROPPED ON A MEASUREMENT. Money
 * on players is blue (#3987e5), money on nobody is red (#e66767). Validated
 * against the well the fills are cut against (#0c0c0e): ΔE 29.0 normal / 19.2
 * protan / 31.4 tritan, every check passing under `--pairs all` — lightness
 * band, chroma floor, CVD separation, normal-vision floor and contrast vs
 * surface. The dead-money panel's violet (#9085e9, for a void-year bill not
 * yet written) is CORRECT down there, where it is adjacent only to red — but
 * in this column it would sit directly on blue, and blue against violet
 * measures ΔE 9.8 normal and 1.9 protan. A hard FAIL, not a floor-band
 * warning. Every other hue in the app's fixed viz order fails beside red too
 * (amber 6.7 deutan, pink 7.5, orange 6.6, teal 6.5; only green clears, at
 * 8.6, and green for dead money is a lie about what it is). So the
 * booked/scheduled split is carried by TEXTURE: the scheduled portion is the
 * same red drawn as a 135° hatch, the dataviz skill's own escape for exactly
 * this case, and it says "provisional" better than a fourth hue would. It is
 * named in the legend and in the hover, so it never rests on fill alone.
 *
 * GEOMETRY IN PERCENTAGES, AND WHY NOT FLEX. Column, ceiling step, hover slot
 * and X-axis cell all take their left/width from ONE pair (`colLeft`, `colW`)
 * against the plot's own box. A flex row with a percentage gap would
 * have resolved that gap against the row's CONTENT box — inset by its own
 * percentage padding — while the absolutely positioned ceiling step resolved
 * its left against the PADDING box, and the step would have sat a fraction of
 * a percent off its column. Same numbers everywhere is what makes "the step
 * belongs to that column" a fact rather than a near miss.
 *
 * THE HOUSE KIT, AND WHAT EACH PIECE IS FOR — because the owner's other
 * sentence was *"it just doesnt have the same clean, polished look as
 * everything else"*:
 *   TEAM ACCENT + CREST + HASH TEXTURE in the header band — the PageMasthead
 *     device, verbatim. IDENTITY. Deliberately kept OFF the plot: a watermark
 *     behind a chart makes the bars harder to read.
 *   THE NOTCHED CORNER on the plot well (`.rating-chip`, the shape RatingBadge
 *     and the stats hero cards carry) with the club's colour in the cut.
 *     IDENTITY — one gesture at panel scale rather than four fake cards.
 *   THE CURRENT SEASON'S YEAR IN THE CLUB'S COLOUR, with a colour rule under
 *     its column. READ — "you are here" without spending a word or a legend
 *     entry on it.
 *   THE DISPLAY FACE AND TABULAR FIGURES on the four room figures. READ —
 *     tabular digits are what keep four money figures comparable at a glance.
 *   THE CEILING RANGE NAMED IN THE HEADER. READ — it is the scale every height
 *     here is drawn against, and it makes the league's growth rung a number
 *     rather than four steps a reader has to measure by eye.
 *
 * WHY THE HOVER BUBBLE OPENS INSIDE THE PLOT. The well is clipped by
 * `.rating-chip`'s clip-path, so a bubble opening out of the top of the plot
 * would be sliced by the notch geometry. It opens downward from the plot's top
 * edge for a short column and upward from its floor for a tall one — either
 * way inside the well, and never over the top of the column being read, which
 * is the mark the reader is hovering to check.
 *
 * THE `data-capb` ATTRIBUTES ARE LOAD-BEARING, not leftovers. The arithmetic
 * proof lives in scripts/_capb_probe.ts, but arithmetic cannot see a CSS
 * mistake — a percentage resolved against the wrong box draws a wrong chart
 * out of right numbers. scripts/_capb_shot.mjs opens the real page in Chromium
 * and reads `getBoundingClientRect` off the plot, every column and every step,
 * then checks the RENDERED PIXELS against `committed`, `capTotal` and `room`
 * on one pixels-per-dollar. These four hooks are how it finds them.
 *
 * NO 'use client'. Everything here is CSS — `group-hover` for the hover layer,
 * the same mechanism components/Tooltip.tsx uses — because this renders inside
 * a Server Component, and an export of a client module reaches a server render
 * as a client reference rather than as a function.
 * ===========================================================================
 */

const ACTIVE_FILL = '#3987e5';
const DEAD_FILL = '#e66767';
/**
 * The recessed well the plot is cut into, and the colour that shows through
 * the 2px gaps between stacked segments. Darker than `card` (#18181b) on
 * purpose: it is what gives the fills something to sit IN rather than float
 * on. The hatch is cut against this same value, so the palette was validated
 * against it — see above.
 */
const WELL = '#0c0c0e';
const SCHEDULED_HATCH = `repeating-linear-gradient(135deg, ${DEAD_FILL} 0 4px, ${WELL} 4px 8px)`;

/** Gridline and Y-tick spacing, in dollars. */
const TICK = 50_000_000;
/** `scaleMax` rounds up to a multiple of this, so ticks land on round money. */
const SCALE_STEP = 25_000_000;
/** Headroom above the tallest thing drawn, so an over-cap column has somewhere to go. */
const HEADROOM = 1.06;

/** Plot inset at each edge, and the gap between columns, in % of plot width. */
const PAD = 2.4;
const GAP = 2.4;

export function MultiYearOutlookPanel({ sheet, teamId, teamAbbr, accent }: {
  sheet: CapSheet;
  /** Identity only — the crest watermark. Omit and the panel renders plain. */
  teamId?: string;
  teamAbbr?: string;
  /** The club's primary, so this panel wears the same colours as its masthead. */
  accent?: string;
}) {
  const { years, rosterFloor, preRoll, ledgerYear, beyondActive, beyondActiveMen, dead } = sheet;
  const first = years[0];
  const last = years[years.length - 1];
  const n = years.length;

  // ONE SCALE, ZERO-BASED. It spans the ceiling AND the commitment so an
  // over-cap column draws past its own step rather than being clipped to it,
  // and rounds up to a $25M step so the $50M ticks are round money.
  const top = Math.max(...years.map((y) => Math.max(y.capTotal, y.committed)), 1);
  const scaleMax = Math.ceil((top * HEADROOM) / SCALE_STEP) * SCALE_STEP;
  const pct = (v: number) => (v / scaleMax) * 100;

  // ONE COLUMN GEOMETRY, shared by the column, its ceiling step, its hover
  // slot and its X-axis cell. Column count follows the window rather than a
  // literal 4, so CAP_SHEET_YEARS moving cannot draw the wrong chart.
  const colW = (100 - 2 * PAD - GAP * (n - 1)) / n;
  const colLeft = (i: number) => PAD + i * (colW + GAP);

  const ticks: number[] = [];
  for (let v = 0; v <= scaleMax + 1; v += TICK) ticks.push(v);

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

  /**
   * THE SCALE, NAMED. Every height on this panel is drawn against the ceiling,
   * and it is the one line that makes the league's cap-growth rung readable as
   * a number rather than as four steps a reader has to measure by eye — a FLAT
   * league says so in words instead of looking like a rendering fault.
   */
  const ceilingLine = first.capTotal === last.capTotal
    ? `Ceiling flat at ${formatMoney(first.capTotal)}`
    : `Ceiling ${formatMoney(first.capTotal)} → ${formatMoney(last.capTotal)}`;

  return (
    <div className="panel relative" style={{ ['--team-accent' as never]: accent }}>
      {/* THE CLIP LIVES ON THE DECORATIONS, NOT ON THE PANEL — the same
          reasoning PageMasthead states in full: the crest hangs off the corner
          and the hash runs to the edges, so both have to be cut to the rounded
          rect, but `overflow-hidden` on the panel itself would also eat every
          tooltip bubble that opens out of it. Same pixels, one layer lower. */}
      <div aria-hidden className="absolute inset-0 overflow-hidden rounded-md pointer-events-none">
        <div
          className="absolute inset-x-0 top-0 h-28 opacity-[0.05]"
          style={{
            backgroundImage: 'repeating-linear-gradient(115deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 14px)',
            color: accent ?? '#f4f6fa',
          }}
        />
        {teamId && teamAbbr && (
          <TeamLogo seed={teamId} abbr={teamAbbr} size={150} className="watermark-logo opacity-[0.05] -right-10 -top-10" />
        )}
      </div>

      {/* ---- The header band -------------------------------------------- */}
      <div className="relative px-4 pt-4 pb-3">
        <div className="section-head !pb-2">
          <div className="min-w-0">
            <div className="section-eyebrow">Multi-Year Outlook</div>
            <h2 className="section-title inline-flex items-center gap-1.5">
              Room, {first.year}–{last.year}
              <Tooltip text={tip('capSpace')} />
            </h2>
          </div>
          {/* NOT a second printing of column 0's figure, which is what stood
              here before and is the duplication principle 7 is about — the
              room in {first.year} is already that column's own headline and
              the opening clause of the sentence below. This is the SCALE. */}
          <div className="shrink-0 font-mono text-[11px] text-muted whitespace-nowrap">{ceilingLine}</div>
        </div>

        <p className="text-sm text-muted leading-relaxed mt-3">
          As the books stand, {first.year} leaves you {roomPhrase(first.room)} and the sheet {trend}.
          {' '}That last column is <strong className="text-chalk font-semibold">{last.menSigned} {last.menSigned === 1 ? 'man' : 'men'} under contract, not {rosterFloor}</strong>
          {last.openSlots > 0
            ? ` — filling the other ${last.openSlots} slots at the league minimum alone would take ${formatMoney(last.floorCost)} of it, before a single draft pick or free agent is paid what he is actually worth.`
            : ' — a full squad, so what is left there is genuinely spare.'}
          {/* NO EQUALITY CLAIM between this figure and the one the bottom panel
              heads with, because they are not the same figure: `deadInWindow`
              is the four columns drawn here, and the runway's headline is the
              WHOLE bill including anything dated past them. Saying "the panel
              below is that figure by name" would have put $59.0M here over a
              $61.8M headline three panels down — a small lie, and exactly the
              kind this page keeps having to be rescued from. */}
          {anyDead && ` ${formatMoney(deadInWindow)} of it is dead money and cannot be released; every charge is named at the foot of this tab.`}
        </p>

        {/* THE TWO WEEKS WHERE THE LEAGUE CLOCK AND THE BOOKS DISAGREE, said
            out loud rather than left for a GM to trip over. Through OFFSEASON
            weeks 1-2 the contract ledger has already stepped onto the new
            league year (ageContractsForYear runs the instant the season ends)
            while League.seasonYear does not move until RESET_STANDINGS — so
            the header clock reads one year and every cap figure on this page,
            this chart included, is written in the next. They used to disagree
            SILENTLY and in the arithmetic too: the ceiling and the dead money
            were read a year behind the salaries they were being subtracted
            from. That is fixed (see bookYearFor, lib/cap-summary.ts) and the
            whole page now speaks one year — this note is what tells a reader
            WHICH one, and why his club still reads heavy.

            The heaviness is real and it is temporary: every expiring contract
            in the league is still charged here, at its final year's number,
            until the re-sign window closes and the unkept walk. That is the
            one honest reason a club's room improves on an Advance it made no
            move in, and it is the reason this sentence names it up front. */}
        {preRoll && (
          <p className="text-[11px] text-muted border-l-2 border-line pl-2.5 leading-relaxed mt-2.5">
            The books have turned over onto {ledgerYear} — every figure on this page is written in it, though the header
            clock still reads the season just played. Expiring deals stay on these books at their last year&apos;s number
            until free agency opens, so every club in the league reads heavy right now and comes back down when they walk.
          </p>
        )}
      </div>

      {/* ---- The plot well ----------------------------------------------- */}
      {/* The notched corner is the house shape (`.rating-chip`, as used by
          RatingBadge and the stats hero cards) and the flag in the cut is the
          club's own colour. It is on the WELL and not on four separate marks,
          because four notched boxes in a row would read as four cards and
          these are four columns of ONE chart. */}
      <div
        className="relative rating-chip border-y border-line/60 bg-ink/50 px-2 sm:px-4 py-3"
        style={{ ['--chip-notch' as never]: '18px' }}
      >
        <div className="rating-chip-flag" style={{ borderTopColor: accent ?? '#2d2d32' }} />

        {/* THE CHART IS CAPPED AT 980px. The panel runs to 1,232px on a
            desktop and four columns across that plot are 250px of solid fill
            each — a block, not a mark, which is the same width complaint the
            dead-money panel at the foot of this tab was rebuilt over. Capped,
            the columns land at ~200px: the proportions of the mockup this form
            was chosen from. The top padding is the room the room-figure needs
            above the tallest column — it sits OUTSIDE the plot box by design,
            so a column can reach the top of the dollar scale without its own
            label being pushed onto it. */}
        <div className="relative grid grid-cols-[42px_1fr] sm:grid-cols-[58px_1fr] max-w-[980px] pt-7 sm:pt-9 [--plot-h:190px] sm:[--plot-h:240px]">
          {/* ---- Y axis: dollars ---------------------------------------- */}
          <div className="relative" style={{ height: 'var(--plot-h)' }}>
            {ticks.map((v) => (
              <span
                key={v}
                /* `translate-y-1/2`, POSITIVE, and it is not a typo. With
                   `bottom` set, the box sits ABOVE the line it names — the
                   offset has to push it back DOWN by half its own height to
                   centre it. The negative half the mockup carried put every
                   tick a full line-height above its gridline, which a
                   screenshot caught and arithmetic never would. */
                className="absolute right-2 translate-y-1/2 font-mono text-[9px] sm:text-[10px] text-muted tabular-nums whitespace-nowrap"
                style={{ bottom: `${pct(v)}%` }}
              >
                {/* Ticks are always whole $50M, so the app's one-decimal money
                    format would print ".0" seven times down the axis for no
                    information. The figures that carry decimals are the ones
                    a GM reads off the columns, and those go through
                    `formatMoney` like every other figure in the app. */}
                {v === 0 ? '$0' : `$${Math.round(v / 1_000_000)}M`}
              </span>
            ))}
          </div>

          {/* ---- The plot ------------------------------------------------ */}
          <div>
            <div data-capb="plot" className="relative border-l border-b border-line/70" style={{ height: 'var(--plot-h)' }}>
              {ticks.map((v) => (
                <span key={v} aria-hidden className="absolute left-0 right-0 h-px bg-line/40" style={{ bottom: `${pct(v)}%` }} />
              ))}

              {/* The columns, each grown from zero to its own commitment. */}
              {years.map((y, i) => (
                <Column key={y.year} y={y} pct={pct} left={colLeft(i)} width={colW} />
              ))}

              {/* THE CEILING, DRAWN LAST so it is drawn OVER the fills.
                  Beneath them an over-cap column would hide the one line the
                  reader needs, and the breach would read as a tall bar rather
                  than as a bar through a limit. Four stepped segments and not
                  one rule across the plot, because the ceiling is not flat —
                  it climbs a percent a season on the default rung. */}
              {years.map((y, i) => (
                <span
                  key={y.year}
                  aria-hidden
                  data-capb="step"
                  data-year={y.year}
                  className="absolute h-[2px] rounded-[1px] bg-chalk/90 z-30"
                  style={{ bottom: `${pct(y.capTotal)}%`, left: `${colLeft(i)}%`, width: `${colW}%` }}
                />
              ))}

              {/* THE HOVER LAYER, which carries the split the column itself
                  cannot: a $60M season of salary and a $60M season of dead
                  money are the same height and completely different clubs.
                  The slots tile the whole plot, so the pointer never falls
                  between two columns and gets nothing. */}
              {years.map((y, i) => {
                const l = i === 0 ? 0 : colLeft(i) - GAP / 2;
                const r = i === n - 1 ? 100 : colLeft(i + 1) - GAP / 2;
                return (
                  <HoverSlot key={y.year} y={y} pct={pct} left={l} width={r - l} first={i === 0} lastCol={i === n - 1} />
                );
              })}
            </div>

            {/* ---- X axis: seasons ------------------------------------- */}
            {/* Absolutely positioned off the SAME formula as the columns, so
                every label sits under the column it names rather than under a
                flex track that resolved its gap against a different box. */}
            {/* The height is explicit because the cells are absolutely
                positioned off the column formula, and it is sized for THREE
                LINES THAT DO NOT WRAP. At 390 a column is ~62px and
                "$74.4M dead" is about that wide, so without `nowrap` it broke
                across two lines and the well's clip-path ate the second one —
                a club's whole dead-money figure, gone, on the one screen size
                where this was reported missing. */}
            <div className="relative pt-2 h-[54px] sm:h-[58px]">
              {years.map((y, i) => (
                <div key={y.year} className="absolute top-2 text-center" style={{ left: `${colLeft(i)}%`, width: `${colW}%` }}>
                  {/* The season the page is written in wears the club's
                      colour, above a rule its own column wide — "you are
                      here", spending no word and no legend entry to say it.
                      The rule is drawn on EVERY column and coloured on one, so
                      the four year labels sit on one baseline rather than
                      three of them riding 8px higher than the current one. */}
                  <span
                    aria-hidden
                    className="block h-[2px] rounded-full mb-1.5"
                    style={{ backgroundColor: i === 0 ? (accent ?? '#4ade80') : 'transparent' }}
                  />
                  <div className={`font-display font-bold text-[13px] sm:text-sm leading-none ${i === 0 ? 'text-team' : 'text-chalk'}`}>
                    {y.year}
                  </div>
                  <div className="text-[9.5px] sm:text-[10.5px] text-muted leading-tight mt-1 whitespace-nowrap">{y.menSigned} signed</div>
                  {/* THE LINE THAT FIXES THE DISAPPEARING PANEL. Printed on
                      every season for every club, including $0 — because the
                      runway panel at the foot of this tab renders nothing at
                      all on a club with a clean ledger, and "you have none"
                      and "we forgot to show you" then look identical. */}
                  <div
                    data-capb="dead"
                    data-year={y.year}
                    className={`font-mono text-[9.5px] sm:text-[10.5px] tabular-nums leading-tight whitespace-nowrap ${y.deadTotal > 0 ? 'text-vizBad' : 'text-muted/60'}`}
                  >
                    {formatMoney(y.deadTotal)} dead
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ---- Legend, and what sits past the window ------------------------ */}
      <div className="relative px-4 py-3 space-y-2">
        {/* The full key, unconditionally. A club with a clean ledger is
            exactly the club that was left wondering whether this app tracks
            dead money at all, and two swatches it can match against four
            "$0 dead" labels answer that at no cost to anyone else. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: ACTIVE_FILL }} />
            Salary under contract
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: DEAD_FILL }} />
            Dead money — on the ledger
            <Tooltip text={tip('deadMoney')} />
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundImage: SCHEDULED_HATCH }} />
            Dead money — scheduled, void years
            <Tooltip text={tip('voidYears')} />
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3.5 h-[2px] rounded-full shrink-0 bg-chalk/90" />
            The ceiling that season
            <Tooltip text={tip('capLimit')} />
          </span>
        </div>

        {/* Nothing past the last column is dropped. A chart that ended at the
            last season without saying so would read as "the books are clear
            after 2043", which is a promise the game never made. The dead half
            of what is out there is named in the panel at the foot of the tab;
            the long contracts are counted here, because this is where they
            were charged. */}
        {(beyondActive > 0 || dead.beyondWindow > 0) && (
          <p className="text-[11px] text-muted leading-relaxed">
            Past the last column, {last.year + 1} and beyond:
            {beyondActive > 0 && ` ${formatMoney(beyondActive)} still owed to ${beyondActiveMen} ${beyondActiveMen === 1 ? 'man' : 'men'} under contract`}
            {beyondActive > 0 && dead.beyondWindow > 0 && ', and'}
            {dead.beyondWindow > 0 && ` ${formatMoney(dead.beyondWindow)} of dead money, named at the foot of this tab`}.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * ONE SEASON'S COLUMN, and the figure a GM came for above it.
 *
 * THE COLUMN'S HEIGHT IS `committed` ON THE SHARED SCALE — that is the whole
 * encoding, and it is why the segments inside take their heights as a share of
 * `committed` rather than of the scale. The box is the quantity; the split is
 * how the box is made up. A segment can therefore be nudged to a 2px minimum
 * so a $2.0M void bill never vanishes on a phone, and the TOTAL is still
 * exactly right — flexbox takes the 2px out of the segment above it, not out
 * of the column.
 */
function Column({ y, pct, left, width }: {
  y: CapSheetYear;
  pct: (v: number) => number;
  left: number;
  width: number;
}) {
  const over = y.room < 0;
  const parts = [
    { key: 'active', v: y.activeSalary, style: { backgroundColor: ACTIVE_FILL } },
    { key: 'booked', v: y.deadBooked, style: { backgroundColor: DEAD_FILL } },
    { key: 'scheduled', v: y.deadScheduled, style: { backgroundImage: SCHEDULED_HATCH } },
  ].filter((p) => p.v > 0);

  return (
    <div data-capb="col" data-year={y.year} className="absolute bottom-0" style={{ left: `${left}%`, width: `${width}%`, height: `${pct(y.committed)}%` }}>
      {/* Bottom-up: salary, then money on the ledger, then money scheduled
          against void years, with the 2px surface gap the mark spec asks for
          between fills — without it a club whose kinds of money are close in
          size reads as one undifferentiated block. */}
      <div className="absolute inset-0 flex flex-col-reverse gap-[2px]">
        {parts.map((p, i) => (
          <div
            key={p.key}
            className={i === parts.length - 1 ? 'rounded-t-[3px]' : ''}
            style={{ height: `${(p.v / y.committed) * 100}%`, minHeight: 2, ...p.style }}
          />
        ))}
      </div>
      {/* A season with nothing on the books is a flat baseline, not a missing
          column — the empty plot up to the step IS the answer being shown. */}
      {y.committed === 0 && <div className="absolute inset-x-0 bottom-0 h-[2px] bg-line rounded-full" />}

      {/* THE ROOM. The distance from the top of this column to its own step,
          printed in the same dollars the column is drawn in. formatMoney
          already signs a negative, so the minus is NOT added here — "−-$71.3M"
          is what doing both looks like. The typographic minus replaces the
          hyphen it emits, because beside a dollar sign a hyphen reads as a
          dash between two figures. */}
      <div className="absolute bottom-full inset-x-0 mb-1.5 text-center pointer-events-none">
        <div className={`stat-value text-[11px] sm:text-[15px] leading-none whitespace-nowrap ${over ? 'text-bad' : 'text-chalk'}`}>
          {over ? `−${formatMoney(-y.room)}` : formatMoney(y.room)}
        </div>
        <div className="text-[8.5px] sm:text-[9px] uppercase tracking-[0.11em] text-muted leading-none mt-[3px]">
          {over ? 'over' : 'room'}
        </div>
      </div>
    </div>
  );
}

/**
 * The hover target for one season — a transparent slot the full height of the
 * plot, so the answer is available anywhere in that season's band rather than
 * only on the ink.
 *
 * The bubble opens DOWNWARD from the top of the plot when the column is short
 * and UPWARD from the floor when it is tall. Both keep it inside the well,
 * which `.rating-chip`'s clip-path would otherwise slice, and both keep it off
 * the top of the column — the mark the reader is hovering to read.
 */
function HoverSlot({ y, pct, left, width, first, lastCol }: {
  y: CapSheetYear;
  pct: (v: number) => number;
  left: number;
  width: number;
  first: boolean;
  lastCol: boolean;
}) {
  const over = y.room < 0;
  const tall = pct(y.committed) > 50;
  return (
    <div className="group absolute inset-y-0 z-40" style={{ left: `${left}%`, width: `${width}%` }}>
      <span
        role="tooltip"
        className={`pointer-events-none absolute w-44 rounded-md border border-line bg-surface px-2 py-1.5
                   text-[11px] leading-snug text-chalk shadow-card text-left
                   opacity-0 group-hover:opacity-100 transition-opacity duration-100
                   ${tall ? 'bottom-1' : 'top-1'}
                   ${first ? 'left-0' : lastCol ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}
      >
        <span className="block font-semibold">{y.year} · {formatMoney(Math.abs(y.room))} {over ? 'over' : 'room'}</span>
        <span className="block text-muted">Ceiling {formatMoney(y.capTotal)}</span>
        <span className="block text-muted">Committed {formatMoney(y.committed)}</span>
        {y.activeSalary > 0 && <span className="block text-muted">Under contract {formatMoney(y.activeSalary)}</span>}
        {y.deadBooked > 0 && <span className="block text-muted">Dead money {formatMoney(y.deadBooked)}</span>}
        {y.deadScheduled > 0 && <span className="block text-muted">Void years {formatMoney(y.deadScheduled)}</span>}
        {y.openSlots > 0 && <span className="block text-muted">{y.openSlots} slots short · {formatMoney(y.floorCost)} at the minimum</span>}
      </span>
    </div>
  );
}
