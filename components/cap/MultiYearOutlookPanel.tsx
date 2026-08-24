import { Tooltip } from '@/components/Tooltip';
import { TeamLogo } from '@/components/TeamLogo';
import { tip } from '@/lib/glossary';
import { formatMoney } from '@/lib/cap';
import type { CapSheet, CapSheetYear } from '@/lib/cap-summary';

/**
 * ===========================================================================
 * THE MULTI-YEAR OUTLOOK — HOW MUCH ROOM, IN EACH OF THE NEXT FOUR YEARS
 * ===========================================================================
 * TOP OF THE ADVANCED TAB, AND A BAR GRAPH, BECAUSE THE APP OWNER SAID SO:
 * *"multi year outlook as a bar graph to the top so its easy to look at"*.
 * The reason is in his own sentence — this is the thing he wants to read at a
 * glance, first, without hunting for it — so the panel carries the shape and
 * the numbers and no roster detail at all. The names live at the bottom of the
 * tab, in the dead-money panel.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS WAS REDRAWN: THE BAR AND THE NUMBER ENCODED OPPOSITE QUANTITIES
 * ---------------------------------------------------------------------------
 * The app owner, after using the version that shipped in 1867784: *"can we
 * change the look of the year over year cap view in the advanced tab? the
 * current is extremely confusing"* — a considered second reaction, his first
 * having been "outlook looks great".
 *
 * He was reading a real contradiction. That panel drew each column's HEIGHT
 * from `y.committed` and printed `y.room` — the ceiling MINUS that — as the
 * large figure beneath it. So every column said two opposite things at once:
 *
 *     2038   tall bar     "$24.7M   room"     ← a lot of ink, a little money
 *     2041   shortest     "$248.0M  room"     ← almost no ink, the most money
 *
 * MEASURED, not assumed (scripts/_yo_diag.ts, which re-derives the shipped
 * geometry by hand rather than importing it): across 960 clubs and 2,880
 * consecutive column pairs, the bar moved in the OPPOSITE direction to the
 * figure under it on 92.8% of pairs and the SAME direction on 0.5%. On 93.3%
 * of clubs the bar fell left-to-right while the headline figure rose. That is
 * not an edge case, it is the panel.
 *
 * The old header comment said *"room is what every column prints"*, which was
 * true of the text and false of the picture. A comment describing a policy the
 * code no longer follows is as wrong as a bad number, so the ENCODING was
 * changed to match the stated intent rather than the comment softened to match
 * the drawing.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DRAWN NOW: ONE TRACK PER SEASON, AND THE ROOM IS THE GAP
 * ---------------------------------------------------------------------------
 * Each season is one row. The TRACK is that season's CEILING, drawn to length
 * on a single dollar scale shared by all four rows. It fills from the left
 * with everything charged against it — active salary, then booked dead money,
 * then scheduled void-year money — and WHAT IS LEFT OF THE TRACK IS THE ROOM.
 * The gap is the answer, the word "Room" sits in the gap, and the figure at
 * the end of the row is that gap's size. Picture and number are now the same
 * quantity, so there is nothing left for them to contradict.
 *
 * REJECTED: bar length = room, with committed as context (candidate B, shot
 * and kept). It makes the headline agree with the mark, but it costs both
 * halves of what the 1867784 merge was allowed on: dead money leaves the bar
 * for a secondary rail, and that rail can only be drawn as a share of each
 * year's OWN committed total — a second scale on one screen, which is a dual
 * axis wearing a different hat. It also paints "room" in the same blue the
 * legend gives to "players under contract".
 * REJECTED: four vertical year-cards carrying this identical encoding
 * (candidate A, shot and kept, and the close runner-up — it is this same
 * budget split stood on end). Same honesty, worse ergonomics, measured: 546px
 * tall at 1600 against this row form's 406px, and at 390 the per-card footer
 * truncates to "room · 4…" where a row has the width to write "43 signed" in
 * full. Four figures in a right-hand column also compare down a page at a
 * glance; four figures spread across 1,200px do not.
 *
 * ONE DOLLAR SCALE, NO SECOND AXIS. Every length on this panel — ceiling,
 * salary, dead money, room, overage — is the same dollars per pixel.
 * `scaleMax` spans max(ceiling, committed) across the window, so an over-cap
 * year has somewhere to be drawn.
 *
 * EACH SEASON'S CEILING AT ITS OWN LENGTH. `capTotal` per year comes from
 * `capForLeague` (lib/cap-summary.ts), which resolves the league's founding
 * year AND its own growth rung — so a FLAT league's four tracks are the same
 * length and a FAST league's lengthen row by row. `capForYear` with two
 * arguments silently computes the tuning default's curve and would draw a
 * league nobody is playing. Proven on all three rungs in scripts/_yo_probe.ts.
 *
 * AN OVER-CAP YEAR STILL READS AS OVER, and is not clipped flat. The fill runs
 * PAST the end of its own track, and the ceiling mark is drawn LAST — over the
 * fill — so the line it broke through stays visible through it. That mark goes
 * chalk rather than red on an over year: red-on-red measured invisible in the
 * first pass, and red already belongs to dead money. The figure at the end of
 * the row turns `text-bad` and says "over the cap".
 *
 * THE COLOURS ARE TWO HUES, AND THE THIRD WAS DROPPED ON A MEASUREMENT. Money
 * on players is blue (#3987e5), money on nobody is red (#e66767). Re-validated
 * for this redraw against the recessed well the fills are now cut against
 * (#0c0c0e, darker than the old #18181b card surface, so the contrast check
 * had to be re-run rather than assumed): ΔE 29.0 normal / 19.2 protan / 31.4
 * tritan, every check passing under `--pairs all` — lightness band, chroma
 * floor, CVD separation, normal-vision floor and contrast vs surface. The
 * dead-money panel's violet (#9085e9, for a void-year bill not yet written) is
 * CORRECT down there, where it is adjacent only to red — but in these bars it
 * would sit in the same track as blue, and blue against violet measures ΔE 9.8
 * normal and 1.9 protan. That is a hard FAIL, not a floor-band warning. Every
 * other hue in the app's fixed viz order fails beside red too (amber 6.7
 * deutan, pink 7.5, orange 6.6, teal 6.5; only green clears, at 8.6, and green
 * for dead money is a lie about what it is). So the booked/scheduled split is
 * carried by TEXTURE: the scheduled portion is the same red drawn as a 45°
 * hatch, the dataviz skill's own escape for exactly this case, and it says
 * "provisional" better than a fourth hue would. It is named in the legend and
 * in the hover as well, so it never rests on fill alone.
 *
 * THE HOUSE KIT, AND WHAT EACH PIECE IS FOR — because the owner's other
 * sentence was *"it just doesnt have the same clean, polished look as
 * everything else"*, and what he was looking at was flat rectangles and dashed
 * grey rules in a dark box. Nothing here is ornament for its own sake:
 *   TEAM ACCENT + CREST + HASH TEXTURE in the header band — the PageMasthead
 *     device, verbatim. IDENTITY. Deliberately kept OFF the plot: a watermark
 *     behind a chart makes the bars harder to read, which is worse than no
 *     watermark at all.
 *   THE NOTCHED CORNER on the plot well (`.rating-chip`, the shape RatingBadge
 *     and the stats hero cards carry) with the club's colour in the cut.
 *     IDENTITY — one gesture at panel scale rather than four fake cards.
 *   AN ACCENT EDGE ON THE CURRENT SEASON'S ROW. READ — it says "you are here"
 *     without spending a word, a chip or a legend entry on it.
 *   THE DISPLAY FACE AND TABULAR FIGURES (`.stat-value`) on the four room
 *     figures, right-aligned in one column. READ — tabular digits in one
 *     column are what make four money figures comparable at a glance.
 *   THE CEILING NAMED IN THE HEADER. READ — it is the scale every length here
 *     is drawn against, and on the old panel it appeared nowhere but a hover.
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
 * The recessed well the fills are cut against, and the colour that shows
 * through the 2px gaps between stacked segments. Darker than `card` (#18181b)
 * on purpose: the plot is a well sunk into the panel, which is what gives the
 * fills something to sit IN rather than float on. The hatch is cut against
 * this same value, so the palette was re-validated against it — see above.
 */
const WELL = '#0c0c0e';
const SCHEDULED_HATCH = `repeating-linear-gradient(45deg, ${DEAD_FILL} 0 3px, ${WELL} 3px 6px)`;
/**
 * Track height. 36px rather than the 16px a plain progress bar would take:
 * three stacked segments with a 2px gap between them need enough bar to be
 * told apart, and it is also what lets the year block beside it sit two lines
 * deep without the row growing to fit.
 */
const ROW_H = 36;

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

  // ONE SCALE. It spans the ceiling AND the commitment, so an over-cap year
  // draws past the end of its own track rather than being clipped flat to it.
  const scaleMax = Math.max(...years.map((y) => Math.max(y.capTotal, y.committed)), 1);
  const pct = (v: number) => (v / scaleMax) * 100;
  const anyScheduled = years.some((y) => y.deadScheduled > 0);
  const anyDead = years.some((y) => y.deadTotal > 0);
  const deadInWindow = years.reduce((s, y) => s + y.deadTotal, 0);

  /**
   * THE BRIEF, and the reason the honesty sentence is in it rather than in a
   * tooltip. This is the first thing on the Advanced tab and the place a
   * reader forms his impression of the next four years, so the caveat has to
   * travel with the impression.
   *
   * The far row is a handful of men under contract, not a squad — a median of
   * 8 across every club in the database — so a bare "$235.4M free in 2043"
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
   * THE SCALE, NAMED. Every length on this panel is drawn against the ceiling,
   * and the only place that figure appeared before was inside a hover. It is
   * also the one line that makes the league's cap-growth rung readable as a
   * number rather than as four tracks a reader has to measure by eye — a FLAT
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
          tooltip bubble that opens upward out of it. Same pixels, one layer
          lower. */}
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
              room in {first.year} is already the first row's own headline and
              the opening clause of the sentence below. This is the SCALE. */}
          <div className="shrink-0 font-mono text-[11px] text-muted whitespace-nowrap">{ceilingLine}</div>
        </div>

        <p className="text-sm text-muted leading-relaxed mt-3">
          As the books stand, {first.year} leaves you {roomPhrase(first.room)} and the sheet {trend}.
          {' '}That last row is <strong className="text-chalk font-semibold">{last.menSigned} men under contract, not {rosterFloor}</strong>
          {last.openSlots > 0
            ? ` — filling the other ${last.openSlots} slots at the league minimum alone would take ${formatMoney(last.floorCost)} of it, before a single draft pick or free agent is paid what he is actually worth.`
            : ' — a full squad, so what is left there is genuinely spare.'}
          {/* NO EQUALITY CLAIM between this figure and the one the bottom panel
              heads with, because they are not the same figure: `deadInWindow`
              is the four rows drawn here, and the runway's headline is the
              WHOLE bill including anything dated past them. Saying "the panel
              below is that figure by name" would have put $59.0M here over a
              $61.8M headline three panels down — a small lie, and exactly the
              kind this page keeps having to be rescued from. */}
          {anyDead && ` ${formatMoney(deadInWindow)} of it is dead money and cannot be released; every charge is named at the foot of this tab.`}
        </p>

        {/* THE ONE WINDOW WHERE THE ROW LABELS SKEW, said out loud rather than
            left for a GM to trip over. Through OFFSEASON weeks 1-2 the
            contract ledger has already stepped onto the new league year while
            League.seasonYear has not, so every charge below is written in next
            year's terms under this year's heading. That is the whole page's
            convention — the masthead, the compliance gate and teamCapSummary
            all share it — and this panel is pinned to it deliberately (see
            lib/cap-summary.ts) rather than inventing a second calendar on one
            screen. What it can do is name it, which nothing else here does. */}
        {preRoll && (
          <p className="text-[11px] text-muted border-l-2 border-line pl-2.5 leading-relaxed mt-2.5">
            The books have already turned over onto {ledgerYear}: every charge below is written in the new league year&apos;s
            terms, and expiring deals stay on them until free agency opens. Every club in the league reads heavy right now.
          </p>
        )}
      </div>

      {/* ---- The plot well ----------------------------------------------- */}
      {/* The notched corner is the house shape (`.rating-chip`, as used by
          RatingBadge and the stats hero cards) and the flag in the cut is the
          club's own colour. It is on the WELL and not on four separate marks,
          because four notched boxes in a row would read as four cards and
          these are four rows of ONE chart. Row count follows the window rather
          than a literal 4, so CAP_SHEET_YEARS moving cannot draw the wrong
          number of rows. */}
      <div
        className="relative rating-chip border-y border-line/60 bg-ink/50 px-3 sm:px-4 py-3"
        style={{ ['--chip-notch' as never]: '18px' }}
      >
        <div className="rating-chip-flag" style={{ borderTopColor: accent ?? '#2d2d32' }} />
        <div className="divide-y divide-line/30">
          {years.map((y, i) => (
            <YearRow
              key={y.year}
              y={y}
              pct={pct}
              isNow={i === 0}
              first={i === 0}
              rosterFloor={rosterFloor}
              accent={accent}
            />
          ))}
        </div>
      </div>

      {/* ---- Legend, and what sits past the window ------------------------ */}
      <div className="relative px-4 py-3 space-y-2">
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
          {/* THE EMPTY REMAINDER EARNS A LEGEND ENTRY, because in this encoding
              it is the answer rather than the background — and the swatch is an
              outlined well, which is exactly what the room looks like on a row. */}
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0 border border-muted/60" style={{ backgroundColor: WELL }} />
            Room left, up to the ceiling mark
            <Tooltip text={tip('capLimit')} />
          </span>
        </div>

        {/* Nothing past the last row is dropped. A chart that ended at the last
            row without saying so would read as "the books are clear after
            2043", which is a promise the game never made. The dead half of
            what is out there is named in the panel at the foot of the tab; the
            long contracts are counted here, because this is where they were
            charged. */}
        {(beyondActive > 0 || dead.beyondWindow > 0) && (
          <p className="text-[11px] text-muted leading-relaxed">
            Past the last row, {last.year + 1} and beyond:
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
 * ONE SEASON: the year, the track, and the figure a GM came for.
 *
 * PERCENTAGES, NOT PIXELS, for the fills — the opposite of the vertical panel
 * this replaces, and for the same underlying reason. There the plot box was a
 * fixed pixel height, so two stacked percentage heights plus the 2px gap the
 * mark spec asks for added up to more than the box on whichever year set the
 * scale, and the overflow landed on whatever was drawn underneath. Here the
 * track's LENGTH is fluid — it is whatever the row happens to be wide — so a
 * pixel geometry would have to be measured at render time, which a Server
 * Component cannot do. The GAPS are the fixed quantity instead: 2px of margin
 * between segments, costing at most 4px of a ~700px track.
 */
function YearRow({ y, pct, isNow, first, rosterFloor, accent }: {
  y: CapSheetYear;
  pct: (v: number) => number;
  /** The season the page is written in — the club's colour marks it. */
  isNow: boolean;
  /** The top row, whose hover bubble has to open DOWNWARD instead. */
  first: boolean;
  rosterFloor: number;
  accent?: string;
}) {
  const over = y.room < 0;
  /**
   * A charge worth a fraction of a pixel is still a charge, which is why every
   * segment carries a `minWidth` alongside its percentage: a $2.0M void bill
   * against a $270M ceiling is 0.7% of the track — under 2px on a phone — and
   * dead money going invisible is the exact defect the 1867784 merge fixed.
   * Same escape the vertical panel applied to its heights, same reason.
   */
  const parts = [
    { key: 'active', v: y.activeSalary, style: { backgroundColor: ACTIVE_FILL } },
    { key: 'booked', v: y.deadBooked, style: { backgroundColor: DEAD_FILL } },
    { key: 'scheduled', v: y.deadScheduled, style: { backgroundImage: SCHEDULED_HATCH } },
  ].filter((p) => p.v > 0);

  return (
    <div className="group relative flex items-center gap-2 sm:gap-3 py-1.5">
      {/* The current season carries the club's colour on its leading edge —
          "you are here", spending no word and no legend entry to say it. */}
      <span
        aria-hidden
        className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full"
        style={{ backgroundColor: isNow ? (accent ?? '#4ade80') : 'transparent' }}
      />
      <div className="w-[54px] sm:w-[72px] shrink-0 pl-2">
        <div className={`font-display font-bold text-xs uppercase tracking-wide leading-none ${isNow ? 'text-team' : 'text-chalk'}`}>
          {y.year}
        </div>
        <div className="text-[10px] text-muted mt-1 leading-none whitespace-nowrap">{y.menSigned} signed</div>
      </div>

      <div className="flex-1 min-w-0 relative" style={{ height: `${ROW_H}px` }}>
        {/* The track IS this season's ceiling, at its own length. */}
        <div
          className="absolute left-0 top-0 bottom-0 rounded-[4px] border border-line/60"
          style={{ width: `${pct(y.capTotal)}%`, backgroundColor: WELL }}
        />
        {/* Everything charged against it, filling from the left: 4px rounded
            data-ends anchored to the baseline per the mark spec, and a 2px
            surface gap between segments — without it a club whose kinds of
            money are close in size reads as one undifferentiated bar. */}
        <div className="absolute left-0 right-0 top-[3px] bottom-[3px] flex">
          {parts.map((p, i) => (
            <div
              key={p.key}
              className={`${i === 0 ? 'rounded-l-[3px]' : ''} ${i === parts.length - 1 ? 'rounded-r-[3px]' : ''}`}
              style={{ width: `${pct(p.v)}%`, minWidth: 2, marginLeft: i === 0 ? 3 : 2, ...p.style }}
            />
          ))}
          {/* A year with nothing on the books is a flat baseline, not a missing
              row — the empty track up to the mark IS the answer. */}
          {y.committed === 0 && <div className="w-[2px] ml-[3px] h-1/2 self-center bg-line rounded-full" />}
        </div>
        {/* THE WORD IN THE GAP. It names what the empty part of the track is,
            which is the whole encoding — and it is a WORD, not a second
            printing of the figure already sitting at the end of the row.
            TWO GUARDS, both measured on screenshots rather than guessed. The
            12% floor is the share of the scale below which the gap is thinner
            than the word: at 7% it fitted at 1600 and ran straight through the
            ceiling mark and out of the track at 390. And `hidden sm:flex`,
            because a percentage cannot know pixels — below 640px the whole
            track is only ~215px wide, so even a wide-looking gap is too few
            pixels for six letter-spaced capitals. Nothing is lost there: the
            legend names the outlined remainder and the figure at the end of
            the row says "room" in words. */}
        {!over && pct(y.room) > 12 && (
          <div
            className="absolute top-0 bottom-0 hidden sm:flex items-center pointer-events-none"
            style={{ left: `calc(${pct(y.committed)}% + 10px)` }}
          >
            <span className="label-sm text-[9px] tracking-[0.15em] text-muted/70">Room</span>
          </div>
        )}
        {/* THE CEILING MARK, DRAWN LAST so it is drawn OVER the fill. Beneath
            it, an over-cap year hides the one line the reader needs: the fill
            covers the track's own end, and the breach then reads as a long bar
            rather than as a bar through a limit. Chalk on an over year because
            red-on-red measured invisible, and red is dead money's colour. */}
        <div
          aria-hidden
          className={`absolute top-0 bottom-0 left-0 rounded-[4px] border-r-2 ${over ? 'border-chalk' : 'border-muted/60'}`}
          style={{ width: `${pct(y.capTotal)}%` }}
        />
      </div>

      <div className="w-[78px] sm:w-[98px] shrink-0 text-right">
        {/* formatMoney already signs a negative, so the minus is NOT added
            here — "−-$71.3M" is what doing both looks like. The typographic
            minus replaces the hyphen formatMoney emits, because in a mono face
            a hyphen beside a dollar sign reads as a dash between two figures. */}
        <div className={`stat-value text-[0.95rem] sm:text-stat-sm leading-none ${over ? 'text-bad' : 'text-chalk'}`}>
          {over ? `−${formatMoney(-y.room)}` : formatMoney(y.room)}
        </div>
        <div className="text-[10px] text-muted mt-1 leading-none">{over ? 'over the cap' : 'room'}</div>
      </div>

      {/* THE HOVER LAYER, which carries the split the row itself cannot: a
          $60M year of active salary and a $60M year of dead money are the same
          bar and completely different clubs. The top row opens DOWNWARD — the
          panel's header sits directly above it and a bubble opening up would
          cover the sentence a reader is checking the row against. */}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-40 left-1/2 -translate-x-1/2 w-48
                   rounded-md border border-line bg-surface px-2 py-1.5 text-[11px] leading-snug text-chalk
                   shadow-card opacity-0 group-hover:opacity-100 transition-opacity duration-100 text-left
                   ${first ? 'top-full mt-1' : 'bottom-full mb-1'}`}
      >
        <span className="block font-semibold">{y.year} · {formatMoney(Math.abs(y.room))} {over ? 'over' : 'room'}</span>
        <span className="block text-muted">Ceiling {formatMoney(y.capTotal)}</span>
        <span className="block text-muted">Committed {formatMoney(y.committed)}</span>
        {y.activeSalary > 0 && <span className="block text-muted">Under contract {formatMoney(y.activeSalary)} · {y.menSigned} men</span>}
        {y.deadBooked > 0 && <span className="block text-muted">Dead money {formatMoney(y.deadBooked)}</span>}
        {y.deadScheduled > 0 && <span className="block text-muted">Void years {formatMoney(y.deadScheduled)}</span>}
        {y.openSlots > 0 && <span className="block text-muted">{y.openSlots} slots short of {rosterFloor} · {formatMoney(y.floorCost)} at the minimum</span>}
      </span>
    </div>
  );
}
