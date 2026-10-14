'use client';

import clsx from 'clsx';
import { CalendarClock, CalendarDays, ChevronLeft, ChevronRight, Landmark, SignalHigh, SignalLow, SignalMedium } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, DemoBadge, Modal, PageHeader, Segmented } from '@/components/ui';
import { formatEventValue, getWeekEvents, type EconEvent, type Importance } from '@/data/mock/econCalendar';
import { DEMO_NOW } from '@/data/mock/markets';
import { addWeeks, formatEt, isoDate, isPast, parseIsoDate, reportSurprise, sameDay, weekDays, weekLabel, weekStart } from '@/lib/calculations/markets';

export const IMPORTANCE: Record<Importance, { label: string; short: string; Icon: typeof SignalHigh; cls: string }> = {
  high: { label: 'High importance', short: 'High', Icon: SignalHigh, cls: 'text-red-700 bg-red-50 border-red-200' },
  medium: { label: 'Medium importance', short: 'Med', Icon: SignalMedium, cls: 'text-amber-800 bg-amber-50 border-amber-200' },
  low: { label: 'Low importance', short: 'Low', Icon: SignalLow, cls: 'text-slate-600 bg-slate-50 border-slate-200' },
};

export function ImportanceTag({ level, className }: { level: Importance; className?: string }) {
  const m = IMPORTANCE[level];
  return (
    <span title={m.label} className={clsx('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', m.cls, className)}>
      <m.Icon className="h-3 w-3" aria-hidden />
      <span>{m.short}</span>
      <span className="sr-only"> importance</span>
    </span>
  );
}

function Values({ e, compact }: { e: EconEvent; compact?: boolean }) {
  if (e.unit === 'none') return null;
  const cells: [string, string, boolean][] = [
    ['Prior', formatEventValue(e.prior, e), false],
    ['Fcst', formatEventValue(e.forecast, e), false],
    ['Actual', formatEventValue(e.actual, e), true],
  ];
  return (
    <div className={clsx('grid grid-cols-3 gap-1', compact ? 'mt-2' : 'mt-3')}>
      {cells.map(([k, v, strong]) => (
        <div key={k} className={clsx('rounded-md px-1.5 py-1 text-center', strong && e.actual !== null ? 'bg-brand-50' : 'bg-slate-50')}>
          <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{k}</div>
          <div className={clsx('text-xs tabular-nums', strong ? 'font-bold text-slate-900' : 'font-medium text-slate-700')}>{v}</div>
        </div>
      ))}
    </div>
  );
}

/** Detail modal: values, surprise and "What it means for rates". */
export function EventDetail({ event, onClose, now }: { event: EconEvent | null; onClose: () => void; now: Date }) {
  if (!event) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;
  const released = event.actual !== null;
  const s = reportSurprise(event.actual, event.forecast, event.bias, event.tolerance);
  const past = isPast(event.date, event.time || '23:59', now);
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={event.name}
      description={`${parseIsoDate(event.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${event.time ? ` · ${formatEt(event.time)} ET` : ' · All day'}${event.period ? ` · Period: ${event.period}` : ''}`}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          {event.holiday ? (
            <Badge tone="amber">
              <Landmark className="h-3 w-3" /> Market holiday
            </Badge>
          ) : (
            <ImportanceTag level={event.importance} />
          )}
          {!event.holiday && <Badge tone={released ? 'green' : past ? 'neutral' : 'blue'}>{released ? 'Released' : past ? 'Released — qualitative' : 'Upcoming'}</Badge>}
        </div>

        {event.unit !== 'none' && (
          <div>
            <div className="grid grid-cols-3 gap-2">
              {[
                ['Prior', event.prior],
                ['Forecast', event.forecast],
                ['Actual', event.actual],
              ].map(([k, v]) => (
                <div key={k as string} className={clsx('rounded-xl border p-3 text-center', k === 'Actual' ? 'border-brand-200 bg-brand-50/60' : 'border-slate-200')}>
                  <div className="text-xs font-medium text-slate-500">{k as string}</div>
                  <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{formatEventValue(v as number | null, event)}</div>
                </div>
              ))}
            </div>
            {!released && <p className="mt-2 text-xs text-slate-500">Actual appears after release at {formatEt(event.time)} ET.</p>}
          </div>
        )}

        {event.secondary && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{event.secondary}</p>}

        {released && (
          <div className={clsx('rounded-xl border px-4 py-3 text-sm', s.forBonds.startsWith('Positive') ? 'border-emerald-200 bg-emerald-50 text-emerald-950' : s.forBonds.startsWith('Negative') ? 'border-red-200 bg-red-50 text-red-950' : 'border-slate-200 bg-slate-50 text-slate-800')}>
            <div className="font-semibold">
              {s.label}
              {s.label !== 'In line' && ` (${s.diff > 0 ? '+' : ''}${formatEventValue(s.diff, event)} vs forecast)`}
            </div>
            <div className="mt-0.5">{s.forBonds}</div>
          </div>
        )}

        <div>
          <h4 className="text-sm font-semibold text-slate-900">What it measures</h4>
          <p className="mt-1 text-sm leading-6 text-slate-600">{event.about}</p>
        </div>
        <div className="rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3">
          <h4 className="text-sm font-semibold text-brand-800">What it means for rates</h4>
          <p className="mt-1 text-sm leading-6 text-brand-950">{event.ratesImpact}</p>
        </div>
      </div>
    </Modal>
  );
}

function EventCard({ e, onOpen }: { e: EconEvent; onOpen: () => void }) {
  if (e.holiday) {
    return (
      <button type="button" onClick={onOpen} className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3 text-left transition hover:border-amber-300 hover:shadow-card">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
          <Landmark className="h-3.5 w-3.5" /> All day
        </div>
        <div className="mt-1 text-sm font-semibold text-amber-950">{e.name.replace(' — ', ' · ')}</div>
        <div className="mt-1 text-xs text-amber-800">No MBS trading · rate sheets carried over</div>
      </button>
    );
  }
  return (
    <button type="button" onClick={onOpen} className="group w-full rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-brand-300 hover:shadow-card">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold tabular-nums text-slate-500">{formatEt(e.time)} ET</span>
        <ImportanceTag level={e.importance} />
      </div>
      <div className="mt-1.5 text-sm font-semibold leading-snug text-slate-900 group-hover:text-brand-700">{e.name}</div>
      {e.period && <div className="text-[11px] text-slate-500">{e.period}</div>}
      <Values e={e} compact />
    </button>
  );
}

export function EconCalendar() {
  const now = DEMO_NOW;
  const thisWeek = weekStart(now);
  const [monday, setMonday] = useState(thisWeek);
  const [filter, setFilter] = useState<'all' | 'high' | 'medium'>('all');
  const [open, setOpen] = useState<EconEvent | null>(null);

  const events = useMemo(() => getWeekEvents(monday, now), [monday, now]);
  const visible = events.filter((e) => e.holiday || filter === 'all' || (filter === 'high' ? e.importance === 'high' : e.importance !== 'low'));
  const days = weekDays(monday);
  const isThisWeek = sameDay(monday, thisWeek);
  const highCount = events.filter((e) => e.importance === 'high' && !e.holiday).length;

  return (
    <div>
      <PageHeader
        eyebrow="Market Analysis"
        title="Economic Calendar"
        subtitle="This week’s reports and events that move mortgage rates. Times are Eastern. Click any event for what it means for rates."
        actions={<DemoBadge />}
      />

      <Card className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" aria-label="Previous week" onClick={() => setMonday(addWeeks(monday, -1))} icon={<ChevronLeft className="h-4 w-4" />} />
          <Button variant={isThisWeek ? 'subtle' : 'secondary'} size="sm" onClick={() => setMonday(thisWeek)} disabled={isThisWeek} icon={<CalendarDays className="h-4 w-4" />}>
            This week
          </Button>
          <Button variant="secondary" size="sm" aria-label="Next week" onClick={() => setMonday(addWeeks(monday, 1))} icon={<ChevronRight className="h-4 w-4" />} />
          <div className="ml-2 min-w-0">
            <div className="text-base font-semibold text-slate-900">Week of {weekLabel(monday)}</div>
            <div className="text-xs text-slate-500">
              {events.length} events · {highCount} high importance
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            size="sm"
            ariaLabel="Importance filter"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'medium', label: 'Med + High' },
              { value: 'high', label: 'High only' },
            ]}
          />
        </div>
      </Card>

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
        <span className="font-medium text-slate-600">Importance:</span>
        {(['high', 'medium', 'low'] as Importance[]).map((l) => (
          <ImportanceTag key={l} level={l} />
        ))}
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="h-3.5 w-3.5" /> Actuals shown once released (demo clock: Wed Oct 14 2026, 10:00 AM ET)
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:gap-3">
        {days.map((d) => {
          const iso = isoDate(d);
          const list = visible.filter((e) => e.date === iso);
          const today = sameDay(d, now);
          return (
            <section key={iso} aria-label={d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} className={clsx('min-w-0 rounded-xl border p-2.5', today ? 'border-brand-300 bg-brand-50/40 ring-1 ring-brand-200' : 'border-slate-200 bg-slate-100/50')}>
              <header className="mb-2.5 flex items-baseline justify-between px-1">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>{' '}
                  <span className="text-lg font-bold tabular-nums text-slate-900">{d.getDate()}</span>{' '}
                  <span className="text-xs text-slate-500">{d.toLocaleDateString('en-US', { month: 'short' })}</span>
                </div>
                {today && <Badge tone="brand">Today</Badge>}
              </header>
              <div className="space-y-2">
                {list.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 px-3 py-5 text-center text-xs text-slate-500">No scheduled releases{filter !== 'all' ? ' at this importance' : ''}</div>
                ) : (
                  list.map((e) => <EventCard key={e.id} e={e} onOpen={() => setOpen(e)} />)
                )}
              </div>
            </section>
          );
        })}
      </div>

      <EventDetail event={open} onClose={() => setOpen(null)} now={now} />
    </div>
  );
}
