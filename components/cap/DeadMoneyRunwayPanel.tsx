import Link from 'next/link';
import { formatMoney } from '@/lib/cap';
import { Tooltip } from '@/components/Tooltip';
import { tip } from '@/lib/glossary';
import type { DeadMoneyItem, DeadMoneyRunway } from '@/lib/cap-summary';

/**
 * ===========================================================================
 * WHEN THE BILL ENDS, NOT JUST WHAT IT IS
 * ===========================================================================
 * The masthead already carries a dead-money figure for this season and the cap
 * bar carries it again. This panel exists for the question neither of them can
 * answer — *"when does it leave?"* — and it REPLACES the old "Dead Money
 * Charges" list at the foot of the page, which was this year's rows with no
 * year on them and no sense of an end. Nothing reads twice as a result: that
 * list is the first column here, with three more years of runway behind it.
 *
 * WHY THIS IS THE DETAIL AND NOT A SECOND OPINION — the thing that was wrong
 * when this panel sat beside the old Multi-Year Cap Outlook, and the reason it
 * is legitimate now that it sits at the foot of the same tab.
 *
 * The outlook charted ACTIVE contract charges only and said so in its own
 * tooltip ("dead money and new signings aren't included"). So the tab carried
 * two four-year charts, one of the future cap MINUS this money and one of this
 * money ALONE, and a reader had to add them in his head to get the figure he
 * actually plans against. They were even dated off different years — the
 * outlook counted forward from `league.seasonYear`, the runway dates its void
 * bills off `capChargeYear` — and nothing reconciled them.
 *
 * MultiYearOutlookPanel is a bar chart now, and its bars are the COMPLETE
 * picture: active salary and dead money stacked together against each year's
 * ceiling. Every figure it stacks and every figure this panel lists comes from
 * ONE `capSheet` call (lib/cap-summary.ts) — the top chart's dead segment is
 * `years[i].deadBooked + deadScheduled`, this panel is `sheet.dead`, and both
 * are the same `deadMoneyRunway` result. So the summary at the top of the tab
 * is arithmetically the SUM of the detail at the foot of it, and the two
 * cannot drift apart. That is what makes a summary-and-detail pair legitimate
 * where two independent halves were not.
 *
 * NOTHING ELSE ABOUT THIS FILE CHANGED, deliberately. Its two fills were
 * measured (see below) and its layout, hover, "clear" baseline and
 * beyond-window handling all still do the job they were written for. It takes
 * the same `DeadMoneyRunway` prop it always took.
 *
 * WHY COLUMNS AND NOT FOUR NUMBERS IN A ROW. The answer a GM wants is a SHAPE
 * — "it halves next year and then it is gone" — and four figures in a row make
 * him do that comparison himself. The bars share one scale so the fall-off is
 * the picture, and every column still carries its own figure directly, so
 * nothing is gated behind reading a bar against an axis.
 *
 * THE TWO FILLS ARE NOT DECORATION. Red is money on the ledger; violet is a
 * void-year bill that is not written anywhere yet (see `deadMoneyRunway` in
 * lib/cap-summary.ts). One is settled and one still depends on a contract the
 * club could move, so they are never added into a single fill. The pair is
 * #e66767 / #9085e9 — viz8 and viz7 from tailwind.config.ts, in the palette's
 * own fixed order — and it is that pair because it PASSES: the obvious first
 * choice of red against the amber viz4 failed the dataviz validator's
 * normal-vision floor at ΔE 13.0 (below 15) and its deutan separation at 6.7,
 * i.e. the two bills would have been hard to tell apart in full colour, never
 * mind colourblind. This pair measures ΔE 22.5 normal / 19.5 protan / 24.3
 * tritan against the #18181b card surface, passing every check. Both are also
 * carried in the line list as a labelled dot, so the split never rests on
 * colour alone.
 *
 * NO 'use client'. Everything here is CSS — `group-hover` for the tooltip, the
 * same mechanism components/Tooltip.tsx uses — because this renders inside a
 * Server Component, and an export of a client module reaches a server render
 * as a client reference rather than as a function.
 * ===========================================================================
 */

const BOOKED_FILL = '#e66767';
const SCHEDULED_FILL = '#9085e9';
/** Bar box height in px — the scale the columns are drawn against. */
const BAR_PX = 88;

/**
 * A ledger label is written "cause — man", and the man is what a GM scans a
 * bill for. Split so the name can lead and the cause can sit behind it in
 * muted ink; a label with no dash ("Cap overage carried (2027)") is all cause
 * and is left whole rather than pulled apart into something it is not.
 */
function splitLabel(label: string): { name: string; cause: string | null } {
  const i = label.indexOf('—');
  if (i < 0) return { name: label, cause: null };
  return { name: label.slice(i + 1).trim(), cause: label.slice(0, i).trim() };
}

export function DeadMoneyRunwayPanel({ runway, leagueId, seasonYear }: {
  runway: DeadMoneyRunway;
  leagueId: string;
  /** The league year the rest of the Cap page is written in — the first column. */
  seasonYear: number;
}) {
  const { years, total, thisYear, lastYear, largest, beyondWindow, beyondItems } = runway;
  // A panel that reports nothing is clutter by the app's own rule, and the
  // masthead tile already says "none on the books" when it is empty.
  if (total <= 0 || lastYear === null) return null;

  // The scale is taken over the DRAWN columns only. Folding `beyondWindow`
  // into it would shorten every bar on screen to make room for a quantity that
  // is not on screen — the reader would see a shrunken chart with nothing to
  // explain it. What is past the window is said in words underneath instead.
  const max = Math.max(...years.map((y) => y.total), 1);
  const anyScheduled = years.some((y) => y.scheduled > 0) || beyondWindow > 0;
  const yearsCarried = lastYear - seasonYear + 1;
  const beyondLabel = `${years[years.length - 1].year + 1} and beyond`;
  const firstYear = years.find((y) => y.total > 0)?.year ?? null;

  /**
   * The brief. Four shapes because a club can be in four genuinely different
   * positions and one sentence covering all of them would be wrong in three:
   * a bill that ends with this season, a bill that starts this season and
   * runs, a club with NOTHING on this year's ceiling but a void-year charge
   * waiting for it (the sentence would otherwise open "$0 of it lands"), and
   * the rare deal whose bonus is stranded past the last column entirely.
   *
   * "Lands on", not "is charged to": inside the re-sign window a void-year
   * deal at zero years left is dated to this same season and is not on the
   * ledger yet, so the harder verb would be a claim the ledger does not back.
   *
   * "As the books stand" is in there on purpose. Every one of these years is
   * only the bill as it is TODAY — the next release the GM makes adds to it —
   * and a panel that said "the last of it clears after 2028" flat would be
   * promising him something the game never promised.
   *
   * The single-year case names no figure at all: the header already carries
   * the total, and with the whole bill in one year the sentence, the header
   * and the column label were three printings of one number.
   */
  const brief = lastYear === seasonYear
    ? `All of it lands on the ${seasonYear} ceiling and none of it follows you past it — close this year out and the books are clean.`
    : thisYear > 0
      ? `${formatMoney(thisYear)} of it lands on the ${seasonYear} ceiling, and as the books stand the bill runs ${yearsCarried} league years — the last of it clears after ${lastYear}.`
      : firstYear !== null
        ? `Nothing lands on the ${seasonYear} ceiling. The bill opens in ${firstYear}, and as the books stand the last of it clears after ${lastYear}.`
        : `None of it lands inside the next four league years — as the books stand the whole ${formatMoney(total)} is charged in ${lastYear}.`;

  return (
    <div className="panel p-4 space-y-4">
      <div className="section-head !pb-1.5">
        <div>
          <div className="section-eyebrow text-bad">Dead Money</div>
          <h2 className="section-title inline-flex items-center gap-1.5">
            The Runway
            {/* The glossary affordance the panel this replaced carried. Kept
                because "dead money" is the one term here a new GM genuinely
                may not know, and dropping it would have been a quiet
                regression dressed up as a redesign. */}
            <Tooltip text={tip('deadMoney')} />
          </h2>
        </div>
        <div className="text-right">
          <div className="stat-value text-stat-md text-bad">{formatMoney(total)}</div>
          <div className="text-[11px] text-muted">still to be charged</div>
        </div>
      </div>

      {/* THE BRIEF, IN THE VOICE OF SOMEONE WHO WORKS HERE. Two facts and no
          instruction: what the club is carrying, and the year it ends. The
          heaviest single charge is named because a total tells a GM nothing he
          can act on — the one deal driving the bill does. */}
      <p className="text-sm text-muted leading-relaxed">
        {brief}
        {largest && total > largest.amount
          && ` ${splitLabel(largest.label).name} is the heaviest single charge at ${formatMoney(largest.amount)}, dated ${largest.year}.`}
      </p>

      {/* THE SHAPE AND THE NAMES, SIDE BY SIDE where there is room for both.
          Stacked full width, the chart drew four bars 470px across — that is a
          block, not a mark, and the dataviz skill's thin-mark rule exists
          precisely because a fill that wide stops reading as a quantity. Boxed
          into a column it is a chart again, the ledger labels get the width
          they actually need, and the panel is half as tall. */}
      <div className="grid lg:grid-cols-[minmax(0,20rem)_1fr] gap-5">
        <div className="self-start">
          <div className="grid grid-cols-4 gap-2">
            {years.map((y, i) => {
              // Pixels, not percentages. Two stacked percentage heights plus
              // the 2px spacer between them add up to more than the box on the
              // year that sets the scale, and that overflow lands on whatever
              // is drawn underneath.
              const px = (v: number) => (v > 0 ? Math.max(3, Math.round((v / max) * (BAR_PX - 2))) : 0);
              return (
                <div key={y.year} className="min-w-0">
                  <div className="group relative flex flex-col justify-end" style={{ height: `${BAR_PX}px` }}>
                    {/* Scheduled stacked on booked, with the 2px surface gap
                        the mark spec asks for between fills — without it a
                        club whose two kinds are close in size reads as one
                        undifferentiated bar. */}
                    {y.scheduled > 0 && (
                      <div
                        className="rounded-t-[4px] mb-[2px]"
                        style={{ height: `${px(y.scheduled)}px`, backgroundColor: SCHEDULED_FILL }}
                      />
                    )}
                    {y.booked > 0 && (
                      <div
                        className={y.scheduled > 0 ? '' : 'rounded-t-[4px]'}
                        style={{ height: `${px(y.booked)}px`, backgroundColor: BOOKED_FILL }}
                      />
                    )}
                    {/* A clear year is a flat baseline, not a missing column —
                        the gap between the bars IS the answer being shown. */}
                    {y.total === 0 && <div className="h-[2px] bg-line rounded-full" />}

                    {/* Hover carries the split, which is the one thing the
                        column label cannot: a $12M year made of $9M booked and
                        $3M not yet written is a different year from $12M of
                        either one. */}
                    <span
                      role="tooltip"
                      // A 10rem bubble over a column a quarter of a phone wide
                      // hangs well past it, so the outer columns open INWARD —
                      // the same reasoning as Tooltip's `align` prop, and
                      // without it the first column's bubble pushes the page
                      // sideways.
                      className={`pointer-events-none absolute z-40 bottom-full mb-1.5 w-40
                                 rounded-md border border-line bg-surface px-2 py-1.5 text-[11px] leading-snug text-chalk
                                 shadow-card opacity-0 group-hover:opacity-100 transition-opacity duration-100 text-left
                                 ${i === 0 ? 'left-0' : i === years.length - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}
                    >
                      <span className="block font-semibold">{y.year} · {y.total > 0 ? formatMoney(y.total) : 'clear'}</span>
                      {y.booked > 0 && <span className="block text-muted">On the ledger {formatMoney(y.booked)}</span>}
                      {y.scheduled > 0 && <span className="block text-muted">Void years {formatMoney(y.scheduled)}</span>}
                      {y.total === 0 && <span className="block text-muted">Nothing charged</span>}
                    </span>
                  </div>
                  <div className="mt-1.5 pt-1.5 border-t border-line/70">
                    <div className="label-sm">{y.year}</div>
                    <div className={`font-mono text-xs mt-0.5 ${y.total > 0 ? 'text-chalk' : 'text-muted'}`}>
                      {y.total > 0 ? formatMoney(y.total) : 'clear'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {beyondWindow > 0 && (
            <p className="text-[11px] text-muted mt-2.5">
              A further {formatMoney(beyondWindow)} is dated {beyondLabel}, past the last column — named alongside.
            </p>
          )}

          {/* Legend only when there are genuinely two kinds on the books. One
              series names itself in the heading, and a legend for it would be
              a row that says nothing. */}
          {anyScheduled && (
            <div className="mt-3 space-y-1 text-[11px] text-muted">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: BOOKED_FILL }} />
                On the ledger
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: SCHEDULED_FILL }} />
                Void years — lands when the deal runs out
                <Tooltip text={tip('voidYears')} />
              </span>
            </div>
          )}
        </div>

        {/* --- the names -------------------------------------------------- */}
        {/* Capped rather than let loose across the panel: a $52.9M sitting
            700px to the right of the name it belongs to is two facts, not one
            line. 36rem keeps the longest generated name and its figure inside
            one comfortable scan. */}
        <div className="space-y-3 lg:border-l lg:border-line/60 lg:pl-5 max-w-[36rem]">
          {years.filter((y) => y.items.length > 0).map((y) => (
            <div key={y.year}>
              <div className="label-sm mb-1">{y.year}</div>
              <div className="space-y-0.5">
                {y.items.map((it) => (
                  <ChargeLine key={`${it.kind}-${it.label}-${it.year}`} item={it} leagueId={leagueId} />
                ))}
              </div>
            </div>
          ))}
          {/* Anything past the last column gets its names printed too. The
              line above it is a total, and a total is not a thing a GM can do
              anything about — the deal that owes it is. */}
          {beyondItems.length > 0 && (
            <div>
              <div className="label-sm mb-1">{beyondLabel}</div>
              <div className="space-y-0.5">
                {beyondItems.map((it) => (
                  <ChargeLine key={`${it.kind}-${it.label}-${it.year}`} item={it} leagueId={leagueId} showYear />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One line of the bill, name first — that is what a GM scans for, and three
 * rows all opening "Traded away —" put the identical words where the names
 * should be.
 *
 * A scheduled charge links to the contract that owes it, because that man is
 * still on the roster and his deal is the only thing that can still change the
 * figure. A booked charge links nowhere: the player it names has already gone
 * and there is nothing left to open.
 */
function ChargeLine({ item, leagueId, showYear }: { item: DeadMoneyItem; leagueId: string; showYear?: boolean }) {
  const { name, cause } = splitLabel(item.label);
  const body = (
    <>
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: item.kind === 'BOOKED' ? BOOKED_FILL : SCHEDULED_FILL }}
      />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-chalk">{name}</span>
        {cause && <span className="text-muted text-xs"> · {cause.toLowerCase()}</span>}
      </span>
      {/* Only outside the four columns, where the group heading is a range
          rather than a year and the line would otherwise be undated. */}
      {showYear && <span className="font-mono text-[11px] text-muted shrink-0">{item.year}</span>}
      <span className="font-mono text-xs shrink-0">{formatMoney(item.amount)}</span>
    </>
  );
  if (item.kind === 'SCHEDULED' && item.playerId) {
    return (
      <Link
        href={`/league/${leagueId}/player/${item.playerId}?view=contract`}
        className="flex items-center gap-2 text-sm py-0.5 hover:text-accent2"
      >
        {body}
      </Link>
    );
  }
  return <div className="flex items-center gap-2 text-sm py-0.5">{body}</div>;
}
