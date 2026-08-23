'use client';

import { useState } from 'react';
import { rankPaint, rankTitle } from './RankChip';
// ordinalRank is the ONE ordinal formatter in this codebase; a local copy of
// "1st / T-3rd" is exactly the kind of second definition that agrees only by
// luck until somebody fixes a suffix in one of them.
import { ordinalRank, type StatRank } from '@/lib/statRanks';

/**
 * ===========================================================================
 * ONE POSITION, ONE TABLE, COLUMNS THAT MEAN THE SAME THING ON EVERY ROW
 * ===========================================================================
 * This replaces the My Team tab's old "Full Roster Stat Line", which put a
 * quarterback, a punter and a corner in one grid under a single header cell
 * reading "Efficiency" spanning five columns. The cells beneath it carried
 * their own inline labels, so column three was "Cmp %" on one row, "YPC" on
 * the next and "Playmaker (INT+PD)" on the one after. Nothing could be
 * compared down a column because no column WAS anything, and nothing could be
 * sorted for the same reason. Grouping by position is what makes a column a
 * column again.
 *
 * SORTING IS CLIENT STATE HERE, DELIBERATELY, AND THE TAB ABOVE IT IS NOT.
 * The two are different animals and the distinction is the one DraftViewToggle
 * writes down: every row of this table is already in the browser when the page
 * paints, so sorting it is a re-order of what is on screen and a navigation
 * would buy nothing while costing the reader his scroll position. The
 * League / My Team tab really is a different query, and lives in the URL so it
 * can be linked and reloaded.
 *
 * THE DEFAULT SORT IS THE POSITION'S OWN LEAD STAT, DESCENDING — a back's
 * yards, a passer's yards, an edge rusher's sacks — because "who is producing"
 * is the first question and the answer should already be at the top.
 *
 * ---------------------------------------------------------------------------
 * THE STANDING IS ON THE NUMBER NOW, NOT IN A COLUMN OF ITS OWN
 * ---------------------------------------------------------------------------
 * Every row used to end with a rosette under a header reading "Lg Rank · Avg".
 * The app owner: *"On the right side it says 'LG Rank - AVG', im not sure what
 * that means. No need to have that column."* He is right that a column whose
 * header has to name its own subject is a column that reads as a riddle, and
 * the standing is not a different fact from the number — it IS the number,
 * placed. So the paint goes on the figure itself, by his own rule: gold and a
 * star for a league leader, blue for the top ten, ordinary ink for everybody
 * else. Nothing is lost that the column carried: a painted cell prints its
 * ordinal beside the figure, and EVERY ranked cell carries the full
 * "9th of 159 at the position" as hover text, painted or not.
 * ===========================================================================
 */

export interface RosterStatColumn {
  key: string;
  short: string;
  /** The number that defines the position. Bolded down the column. */
  lead?: boolean;
}

export interface RosterStatCell {
  /** Printed text, e.g. "1,412" or "98.4" or "—". */
  text: string;
  /** The same number the text shows, for sorting. Null sorts last, always. */
  num: number | null;
  /** Standing at the position on this column, when the column carries one. */
  rank?: StatRank | null;
}

export interface RosterStatRow {
  id: string;
  /** Rendered on the server — avatar, name, the link to his card. */
  identity: React.ReactNode;
  /** Parallel to `columns`. */
  cells: RosterStatCell[];
  /** True for the men the depth chart has on the field. */
  starter: boolean;
}

export function RosterStatTable({ columns, rows, defaultSortKey }: {
  columns: RosterStatColumn[];
  rows: RosterStatRow[];
  defaultSortKey: string;
}) {
  const [sortKey, setSortKey] = useState(defaultSortKey);
  const [asc, setAsc] = useState(false);

  const idx = Math.max(0, columns.findIndex((c) => c.key === sortKey));
  const sorted = [...rows].sort((a, b) => {
    const av = a.cells[idx]?.num;
    const bv = b.cells[idx]?.num;
    // A man with no number for this column is not a zero — he is absent from
    // the question — so he sits at the bottom whichever way the arrow points.
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return asc ? av - bv : bv - av;
  });

  const click = (key: string) => {
    if (key === sortKey) setAsc((v) => !v);
    else { setSortKey(key); setAsc(false); }
  };

  return (
    /*
     * THE SCROLLER STAYS; WHAT IT WAS SCROLLING TO WAS NOTHING.
     *
     * *"The stats below have a sideways scroll bar but its empty on the right
     * and needless. lets remove the scroller."* Measured before cutting
     * anything: at 1600 and at 1280 the widest table on the page is 1,230px
     * inside a 1,230px box — every table already FITS — and yet this div
     * reported a scrollWidth of 1,760 on the EDGE table and 2,358 on the
     * quarterback's Advanced line. The extra was not a column. It was the
     * `?` tooltips in the header: each `<Tooltip>` bubble is absolutely
     * positioned inside the scroll container, and Chrome counts it into the
     * scrollable overflow whatever its size — deleting the two bubbles from
     * the EDGE header dropped scrollWidth from 1,760 to exactly 1,230, and
     * forcing their width to zero changed nothing (1,759). So the bar was
     * scrolling 530px of empty air on a table that fit.
     *
     * The fix is therefore no tooltips inside this table at all — the columns
     * name themselves instead, which is what the owner asked for separately
     * ("it should title 'yards/carry' and be self explanatory") — and NOT the
     * deletion of the wrapper. At 390px these tables really are 1,230px wide
     * and something has to scroll; without this container it would be the
     * whole page body, which is worse than a bar. `.scroll-shadow-y` is the
     * house affordance for a scroller, but it is the vertical one and there is
     * no horizontal sibling, so a plain bar it is — now only where the content
     * genuinely runs past the edge.
     */
    <div className="overflow-x-auto">
      <table className="table-clean">
        <thead>
          <tr>
            <th className="min-w-[180px]">Player</th>
            {columns.map((c) => (
              <th key={c.key} className="text-right whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => click(c.key)}
                  className={`inline-flex items-center gap-0.5 hover:text-chalk transition-colors ${c.key === sortKey ? 'text-chalk' : ''}`}
                >
                  {c.short}
                  {/* The arrow only ever appears on the column actually
                      doing the sorting, so the header row is never a line of
                      six identical hints. */}
                  <span aria-hidden className={c.key === sortKey ? 'opacity-90' : 'opacity-0'}>{asc ? '▲' : '▼'}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            /* The eleven on the field, tinted the way the depth chart tints
               them — production reads differently for a starter and for the
               man behind him, and this is the cheapest way to say which. */
            <tr key={r.id} className={r.starter ? 'bg-raised/40' : ''}>
              <td>{r.identity}</td>
              {r.cells.map((cell, i) => {
                // ONE PAINTED COLUMN PER ROW, the one the page named. Painting
                // every rankable column would put five colours back on a line
                // and say less than one does — which is the ramp this rework
                // just took off the page.
                const paint = rankPaint(cell.rank ?? null);
                return (
                  <td
                    key={columns[i]?.key ?? i}
                    title={cell.rank ? rankTitle(cell.rank) : undefined}
                    className={`text-right font-mono tabular-nums whitespace-nowrap ${
                      paint.hex ? 'font-semibold' : columns[i]?.lead ? 'text-chalk font-semibold' : 'text-muted'
                    }`}
                    style={paint.hex ? { color: paint.hex } : undefined}
                  >
                    {paint.star && <span aria-hidden className="mr-0.5">★</span>}
                    {cell.text}
                    {/* The ordinal rides along ONLY where the paint already
                        drew the eye — ten men a position, at most. Printing it
                        on every ranked cell is the column he just deleted,
                        wearing a different shirt. */}
                    {paint.hex && cell.rank && (
                      <span className="ml-1 opacity-70 text-[0.85em]">{ordinalRank(cell.rank)}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className="text-sm text-muted">Nobody here has a stat line in this split.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
