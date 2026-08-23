'use client';

import { useState } from 'react';
import { Tooltip } from '@/components/Tooltip';
import { RankChip } from './RankChip';
import type { StatRank } from '@/lib/statRanks';

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
 * ===========================================================================
 */

export interface RosterStatColumn {
  key: string;
  short: string;
  /** Glossary text, on the header — one per table rather than one per cell. */
  tip?: string;
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

export function RosterStatTable({ columns, rows, defaultSortKey, rankKey, rankLabel }: {
  columns: RosterStatColumn[];
  rows: RosterStatRow[];
  defaultSortKey: string;
  /**
   * WHICH COLUMN THE RANK COLUMN IS THE RANK OF. Named, not guessed. It used
   * to be inferred as "the lead column", which was right in the Basic view
   * (where they are the same column) and silently produced an empty rosette
   * in Advanced, where the standing moves onto the rate. A rank column that
   * has to work out its own subject is a rank column that can be wrong about
   * it — README design principle 6.
   */
  rankKey: string;
  /**
   * Printed in the header, so the reader is told what he is looking at. Null
   * for a position nothing here may rank — naming a subject over a column of
   * em dashes would promise a standing that is never coming.
   */
  rankLabel: string | null;
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
    <div className="overflow-x-auto">
      <table className="table-clean">
        <thead>
          <tr>
            <th className="min-w-[180px]">Player</th>
            {columns.map((c) => (
              <th key={c.key} className="text-right whitespace-nowrap">
                <span className="inline-flex items-center gap-1 justify-end">
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
                  {c.tip && <Tooltip placement="bottom" align="end" text={c.tip} />}
                </span>
              </th>
            ))}
            <th className="text-right whitespace-nowrap">Lg Rank{rankLabel ? ` · ${rankLabel}` : ''}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            // ONE rosette per row, on the column the header names. Ranking
            // every column would put six of them on a line and say less than
            // one does.
            const rankIdx = columns.findIndex((c) => c.key === rankKey);
            const leadRank = rankIdx >= 0 ? r.cells[rankIdx]?.rank ?? null : null;
            return (
              /* The eleven on the field, tinted the way the depth chart tints
                 them — production reads differently for a starter and for the
                 man behind him, and this is the cheapest way to say which. */
              <tr key={r.id} className={r.starter ? 'bg-raised/40' : ''}>
                <td>{r.identity}</td>
                {r.cells.map((cell, i) => (
                  <td
                    key={columns[i]?.key ?? i}
                    className={`text-right font-mono tabular-nums ${
                      columns[i]?.lead ? 'text-chalk font-semibold' : 'text-muted'
                    }`}
                  >
                    {cell.text}
                  </td>
                ))}
                <td className="text-right">
                  <RankChip rank={leadRank} />
                </td>
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length + 2} className="text-sm text-muted">Nobody here has a stat line in this split.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
