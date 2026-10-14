'use client';

import clsx from 'clsx';
import type { ReactNode } from 'react';

export interface ComparisonRow {
  label: ReactNode;
  values: ReactNode[];
  /** Index of the best column for this row (highlighted). */
  best?: number;
  strong?: boolean;
  sub?: boolean;
}

/** Side-by-side comparison: one column per option. */
export function ComparisonTable({ columns, rows, className, colors }: { columns: ReactNode[]; rows: ComparisonRow[]; className?: string; colors?: string[] }) {
  return (
    <div className={clsx('overflow-x-auto', className)}>
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="py-2.5 pr-3 text-left text-xs font-semibold text-slate-500" />
            {columns.map((c, i) => (
              <th key={i} className="px-3 py-2.5 text-right text-xs font-semibold text-slate-700">
                <span className="inline-flex items-center gap-1.5">
                  {colors?.[i] && <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors[i] }} />}
                  {c}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className={clsx('border-b border-slate-100 last:border-b-0', r.strong && 'bg-slate-50/80')}>
              <td className={clsx('py-2.5 pr-3 text-left', r.sub ? 'pl-4 text-slate-500' : 'font-medium text-slate-700', r.strong && 'font-semibold text-slate-900')}>{r.label}</td>
              {r.values.map((v, i) => (
                <td key={i} className={clsx('px-3 py-2.5 text-right tabular-nums', r.strong ? 'font-semibold text-slate-900' : 'text-slate-800', r.best === i && 'text-emerald-700')}>
                  {v}
                  {r.best === i && <span className="ml-1 text-[10px]">★</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
