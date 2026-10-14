'use client';

/** Shared bits for the Market Analysis content tools (Morning Update, Market Wrap, Mauldin, Barry's Insights). */
import clsx from 'clsx';
import { CalendarDays } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Combobox } from '@/components/Combobox';
import { monthLabel, monthsOf, parseIsoDate } from '@/lib/calculations/markets';
import type { Section } from '@/data/mock/articles';

/** Month combobox ("All months" + each month present in `items`). */
export function MonthFilter({ items, value, onChange, className }: { items: { date: string }[]; value: string; onChange: (v: string) => void; className?: string }) {
  const options = useMemo(() => [{ value: 'all', label: 'All months' }, ...monthsOf(items).map((m) => ({ value: m, label: monthLabel(m) }))], [items]);
  return (
    <div className={clsx('w-full sm:w-56', className)}>
      <Combobox ariaLabel="Filter by month" placeholder="Filter by month…" value={value} options={options} onChange={onChange} icon={<CalendarDays className="h-4 w-4" />} />
    </div>
  );
}

export function fmtDate(iso: string, style: 'long' | 'medium' | 'short' = 'medium'): string {
  const d = parseIsoDate(iso);
  if (style === 'long') return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if (style === 'short') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Article body: sections with headings and paragraphs. */
export function ArticleSections({ sections, idPrefix, className }: { sections: Section[]; idPrefix?: string; className?: string }) {
  return (
    <div className={clsx('space-y-6', className)}>
      {sections.map((s, i) => (
        <section key={s.heading} id={idPrefix ? `${idPrefix}-${i}` : undefined} className="scroll-mt-24">
          <h3 className="text-[15px] font-semibold text-slate-900">{s.heading}</h3>
          <div className="mt-2 space-y-3 text-[15px] leading-7 text-slate-700">
            {s.body.map((p, j) => (
              <p key={j}>{p}</p>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Row in a "past issues" archive list. */
export function ArchiveRow({ date, title, meta, active, onClick, right }: { date: string; title: string; meta?: ReactNode; active?: boolean; onClick: () => void; right?: ReactNode }) {
  const d = parseIsoDate(date);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={clsx('flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors', active ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-slate-50')}
    >
      <span className={clsx('flex w-11 shrink-0 flex-col items-center rounded-md border py-1 leading-none', active ? 'border-brand-200 bg-white' : 'border-slate-200 bg-white')}>
        <span className="text-[9px] font-semibold uppercase text-slate-500">{d.toLocaleDateString('en-US', { month: 'short' })}</span>
        <span className="mt-0.5 text-base font-bold tabular-nums text-slate-900">{d.getDate()}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className={clsx('line-clamp-2 text-sm font-medium', active ? 'text-brand-800' : 'text-slate-800')}>{title}</span>
        {meta && <span className="mt-0.5 block text-xs text-slate-500">{meta}</span>}
      </span>
      {right}
    </button>
  );
}

/** Current time, set after mount (avoids server/client hydration mismatch). Re-ticks every `ms`. */
export function useNow(ms = 30_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Trigger a client-side file download. */
export function downloadText(filename: string, text: string, type = 'text/markdown') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
