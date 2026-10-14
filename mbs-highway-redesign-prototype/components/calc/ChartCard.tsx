'use client';

import clsx from 'clsx';
import { useState, type ReactNode } from 'react';
import { Card, DataTable } from '@/components/ui';

/**
 * Card wrapper for a chart with an optional "Table" toggle (accessible table view of the
 * same data) and a legend row.
 */
export function ChartCard({
  title,
  subtitle,
  action,
  legend,
  children,
  table,
  height = 300,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  legend?: { label: string; color: string; dashed?: boolean }[];
  children: ReactNode;
  table?: { head: ReactNode[]; rows: ReactNode[][] };
  height?: number;
  className?: string;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <Card className={clsx('min-w-0', className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {action}
          {table && (
            <div className="no-print inline-flex rounded-md bg-slate-100 p-0.5 text-xs">
              {(['chart', 'table'] as const).map((v) => (
                <button key={v} type="button" onClick={() => setView(v)} className={clsx('rounded px-2 py-1 font-medium capitalize', view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}>
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {legend && legend.length > 1 && view === 'chart' && (
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
          {legend.map((l) => (
            <span key={l.label} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
              <span className="inline-block h-0.5 w-4 rounded" style={{ background: l.dashed ? `repeating-linear-gradient(90deg, ${l.color} 0 4px, transparent 4px 7px)` : l.color, height: 3 }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
      {view === 'chart' ? <div style={{ height }} className="w-full">{children}</div> : table && <DataTable head={table.head} rows={table.rows} dense />}
    </Card>
  );
}

/** Recharts tooltip content in the app's style. Pass `format` for values. */
export function ChartTooltip({
  active,
  payload,
  label,
  format,
  labelFormat,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; dataKey?: string; payload?: Record<string, unknown> }[];
  label?: string | number;
  format?: (v: number, name?: string) => ReactNode;
  labelFormat?: (l: string | number) => ReactNode;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lift">
      {label !== undefined && <div className="mb-1 font-semibold text-slate-900">{labelFormat ? labelFormat(label) : label}</div>}
      {payload.map((p) => (
        <div key={String(p.dataKey ?? p.name)} className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-slate-600">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-semibold tabular-nums text-slate-900">{format && typeof p.value === 'number' ? format(p.value, p.name) : p.value}</span>
        </div>
      ))}
    </div>
  );
}
