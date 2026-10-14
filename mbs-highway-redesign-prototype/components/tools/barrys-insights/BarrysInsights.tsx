'use client';

import clsx from 'clsx';
import { Clock, Play, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Card, DemoBadge, EmptyState, Modal, PageHeader, Segmented, TextInput } from '@/components/ui';
import { WEBINARS, type Webinar } from '@/data/mock/articles';
import { clock, filterByMonth } from '@/lib/calculations/markets';
import { fmtDate, MonthFilter } from '@/components/tools/morning-update/content';
import { VideoPlayer } from '@/components/tools/morning-update/VideoPlayer';

type Kind = 'all' | Webinar['kind'];
const KINDS: { value: Kind; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'Market Outlook', label: 'Market Outlook' },
  { value: 'Training', label: 'Training' },
  { value: 'Sales Strategy', label: 'Sales Strategy' },
];
const KIND_TONE: Record<Webinar['kind'], 'brand' | 'blue' | 'green'> = { 'Market Outlook': 'brand', Training: 'blue', 'Sales Strategy': 'green' };

function Thumb({ w, large }: { w: Webinar; large?: boolean }) {
  const seed = Number(w.date.slice(-2));
  const hue = ({ 'Market Outlook': 268, Training: 222, 'Sales Strategy': 172 } as const)[w.kind] + (seed % 3) * 8;
  return (
    <div className="relative aspect-video overflow-hidden rounded-lg" style={{ background: `radial-gradient(110% 90% at 90% 10%, hsl(${hue} 85% 55% / .6), transparent 55%), linear-gradient(135deg, #0b1020, #1a2347)` }}>
      <svg className="absolute inset-x-0 bottom-0 h-1/2 w-full opacity-25" viewBox="0 0 400 100" preserveAspectRatio="none" aria-hidden>
        <path d={`M0 ${70 - (seed % 7)} C 60 ${40 + (seed % 11)}, 110 80, 170 55 S 280 ${20 + (seed % 13)}, 330 40 S 380 30, 400 ${25 + (seed % 9)}`} fill="none" stroke="white" strokeWidth="1.5" />
      </svg>
      <div className={clsx('absolute inset-0 flex flex-col justify-between text-white', large ? 'p-5' : 'p-3')}>
        <span className="self-start rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-brand-200">Barry’s Insights</span>
        {large ? (
          <div className="line-clamp-2 pr-14 text-xl font-bold leading-snug sm:text-2xl">{w.title}</div>
        ) : (
          <div className="pr-14 text-xs font-medium text-slate-300">
            {w.kind} · with Barry Habib
          </div>
        )}
      </div>
      <span className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-brand-700 shadow-lift">
          <Play className="ml-0.5 h-5 w-5 fill-current" />
        </span>
      </span>
      <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">{clock(w.durationSec)}</span>
    </div>
  );
}

export function BarrysInsights() {
  const [month, setMonth] = useState('all');
  const [kind, setKind] = useState<Kind>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Webinar | null>(null);
  const [seek, setSeek] = useState({ at: 0, n: 0 });

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    return filterByMonth(WEBINARS, month).filter(
      (w) => (kind === 'all' || w.kind === kind) && (!query || [w.title, w.description, ...w.topics].join(' ').toLowerCase().includes(query)),
    );
  }, [month, kind, q]);

  const [featured, ...rest] = list;
  const openWebinar = (w: Webinar) => {
    setSeek({ at: 0, n: 0 });
    setOpen(w);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Market Analysis"
        title="Barry’s Insights"
        subtitle="Webinar archive — market outlooks, tool training and sales strategy sessions. Also linked from the dashboard as Training Webinars."
        actions={<DemoBadge label="Demo content" />}
      />

      <Card className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <TextInput aria-label="Search webinars" placeholder="Search webinars by title or topic…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <div className="-mx-1 overflow-x-auto px-1 [&_button]:whitespace-nowrap">
          <Segmented ariaLabel="Webinar type" value={kind} onChange={setKind} options={KINDS} />
        </div>
        <MonthFilter items={WEBINARS} value={month} onChange={setMonth} />
      </Card>

      {list.length === 0 ? (
        <EmptyState title="No webinars match your filters" icon={<Search className="h-6 w-6" />}>
          Try another month or clear the search.
        </EmptyState>
      ) : (
        <>
          <button type="button" onClick={() => openWebinar(featured)} className="group mb-6 grid w-full gap-5 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-card transition hover:border-brand-300 hover:shadow-lift md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:p-5">
            <Thumb w={featured} large />
            <div className="flex min-w-0 flex-col justify-center">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="brand">Latest</Badge>
                <Badge tone={KIND_TONE[featured.kind]}>{featured.kind}</Badge>
              </div>
              <h2 className="mt-3 text-xl font-bold tracking-tight text-slate-900 group-hover:text-brand-700">{featured.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{featured.description}</p>
              <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
                <span>{fmtDate(featured.date)}</span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> {clock(featured.durationSec)}
                </span>
              </div>
              <span className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white group-hover:bg-brand-700">
                <Play className="h-4 w-4 fill-current" /> Watch webinar
              </span>
            </div>
          </button>

          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {rest.map((w) => (
              <button key={w.id} type="button" onClick={() => openWebinar(w)} className="group flex flex-col rounded-xl border border-slate-200 bg-white p-3 text-left shadow-card transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lift">
                <Thumb w={w} />
                <div className="flex flex-1 flex-col px-1 pb-1 pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={KIND_TONE[w.kind]}>{w.kind}</Badge>
                    <span className="text-xs text-slate-500">{fmtDate(w.date)}</span>
                  </div>
                  <div className="mt-2 font-semibold leading-snug text-slate-900 group-hover:text-brand-700">{w.title}</div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-500">{w.description}</p>
                  <div className="mt-auto flex flex-wrap gap-1 pt-3">
                    {w.topics.map((t) => (
                      <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-500">
            {list.length} webinar{list.length === 1 ? '' : 's'}
          </p>
        </>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.title ?? ''} description={open ? `${fmtDate(open.date, 'long')} · ${open.kind}` : undefined} size="xl">
        {open && (
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_240px]">
            <div className="min-w-0">
              <VideoPlayer title={open.title} eyebrow="Barry’s Insights" durationSec={open.durationSec} seed={Number(open.date.slice(-2))} seek={seek} />
              <p className="mt-4 text-sm leading-6 text-slate-600">{open.description}</p>
            </div>
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Chapters</div>
              <ol className="space-y-1">
                {open.chapters.map((c, i) => (
                  <li key={c.label}>
                    <button type="button" onClick={() => setSeek({ at: c.at, n: seek.n + 1 })} className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-brand-50">
                      <span className="w-12 shrink-0 tabular-nums text-xs font-medium text-brand-700">{clock(c.at)}</span>
                      <span className="text-slate-700">
                        {i + 1}. {c.label}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
