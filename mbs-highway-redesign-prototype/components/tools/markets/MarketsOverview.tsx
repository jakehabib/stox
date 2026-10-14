'use client';

import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight, ChevronRight, Lightbulb, Moon, Plus, Sunrise, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Area, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { z } from 'zod';
import { ChartCard, ChartTooltip } from '@/components/calc/ChartCard';
import { TalkTrack } from '@/components/calc/TalkTrack';
import { Badge, Button, Card, CardHeader, Checkbox, DataTable, DemoBadge, EmptyState, Field, Modal, PageHeader, RadioGroup, Segmented, Tabs, TextArea, TextInput } from '@/components/ui';
import { EventDetail, ImportanceTag } from '@/components/tools/econ-calendar/EconCalendar';
import { useNow, fmtDate } from '@/components/tools/morning-update/content';
import { getMorningUpdates, getMarketWraps, TODAYS_ARTICLES, type ShortArticle } from '@/data/mock/articles';
import { LOCKED_IN_RATES } from '@/data/mock/content';
import { formatEventValue, getUpcomingEvents, getWeekEvents, type EconEvent } from '@/data/mock/econCalendar';
import { getMarketSnapshot, getMbsIntraday, type MarketSnapshot } from '@/data/mock/market';
import { DEMO_NOW, DEMO_TODAY, getMbsDaily, getQuoteTables, getTreasuryCurve, prevCloseOf, type TableQuote } from '@/data/mock/markets';
import {
  curveShape,
  curveSpreadBp,
  formatEt,
  priceToBp,
  rangeStats,
  sessionsFor,
  TIMEFRAMES,
  windowOf,
  type PricePoint,
  type Timeframe,
} from '@/lib/calculations/markets';
import { axisProps, CHART, gridProps, SERIES } from '@/lib/chartTheme';
import { useStore } from '@/lib/store';

/* ------------------------------------------------------------------ helpers */

function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none', className)} />;
}

const signed = (n: number, d = 2) => `${n > 0 ? '+' : ''}${n.toFixed(d)}`;

function Delta({ value, digits = 2, invert, suffix = '' }: { value: number; digits?: number; invert?: boolean; suffix?: string }) {
  const good = invert ? value < 0 : value > 0;
  const flat = Math.abs(value) < 10 ** -digits / 2;
  return (
    <span className={clsx('inline-flex items-center gap-0.5 font-semibold tabular-nums', flat ? 'text-slate-500' : good ? 'text-gain' : 'text-loss')}>
      {flat ? '' : value > 0 ? '▲' : '▼'} {signed(value, digits)}
      {suffix}
    </span>
  );
}

function fmtLast(q: TableQuote) {
  if (q.kind === 'yield') return `${q.last.toFixed(3)}%`;
  if (q.kind === 'fx') return q.last.toFixed(q.last < 10 ? 4 : 2);
  if (q.kind === 'usd') return `$${q.last.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return q.last.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ------------------------------------------------------------------ My Market Insights (local only) */

interface Insight {
  id: string;
  title: string;
  outlook: 'improving' | 'neutral' | 'worsening';
  note: string;
  createdAt: string;
  snapshot?: { umbs: number; umbsBp: number; tenYear: number };
}
const INSIGHT_KEY = 'mbsh-market-insights-v1';
const insightSchema = z.object({
  title: z.string().trim().min(1, 'Give your insight a title').max(80, 'Keep the title under 80 characters'),
  note: z.string().trim().min(1, 'Write a short note').max(1000, 'Keep the note under 1,000 characters'),
  outlook: z.enum(['improving', 'neutral', 'worsening']),
});
const OUTLOOK: Record<Insight['outlook'], { label: string; tone: 'green' | 'neutral' | 'red'; Icon: typeof ArrowUpRight }> = {
  improving: { label: 'Bonds improving', tone: 'green', Icon: ArrowUpRight },
  neutral: { label: 'Neutral', tone: 'neutral', Icon: ChevronRight },
  worsening: { label: 'Bonds worsening', tone: 'red', Icon: ArrowDownRight },
};

function useInsights() {
  const [list, setList] = useState<Insight[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(INSIGHT_KEY);
      if (raw) setList(JSON.parse(raw));
    } catch {
      /* storage unavailable */
    }
  }, []);
  const save = (next: Insight[]) => {
    setList(next);
    try {
      localStorage.setItem(INSIGHT_KEY, JSON.stringify(next));
    } catch {
      /* session-only */
    }
  };
  return { list, add: (i: Insight) => save([i, ...list]), remove: (id: string) => save(list.filter((x) => x.id !== id)) };
}

function InsightComposer({ open, onClose, onSave, snap }: { open: boolean; onClose: () => void; onSave: (i: Insight) => void; snap: MarketSnapshot | null }) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [outlook, setOutlook] = useState<Insight['outlook']>('neutral');
  const [attach, setAttach] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setTitle('');
      setNote('');
      setOutlook('neutral');
      setAttach(true);
      setErrors({});
    }
  }, [open]);
  const submit = () => {
    const r = insightSchema.safeParse({ title, note, outlook });
    if (!r.success) {
      const e: Record<string, string> = {};
      r.error.issues.forEach((i) => (e[String(i.path[0])] = i.message));
      setErrors(e);
      return;
    }
    onSave({
      id: `ins-${Date.now()}`,
      ...r.data,
      createdAt: new Date().toISOString(),
      snapshot: attach && snap ? { umbs: snap.umbs.last, umbsBp: priceToBp(snap.umbs.change), tenYear: snap.tenYear.last } : undefined,
    });
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="My Market Insight"
      description="Jot down your read on the market. Saved privately in this browser."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Save insight</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title" htmlFor="ins-title" error={errors.title}>
          <TextInput id="ins-title" value={title} invalid={!!errors.title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. MBS testing resistance after CPI" maxLength={80} />
        </Field>
        <Field label="Outlook for rates">
          <RadioGroup
            value={outlook}
            onChange={setOutlook}
            options={(Object.keys(OUTLOOK) as Insight['outlook'][]).map((k) => ({ value: k, label: OUTLOOK[k].label }))}
          />
        </Field>
        <Field label="Note" htmlFor="ins-note" error={errors.note} hint={`${note.length}/1000`}>
          <TextArea id="ins-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What are you telling clients and agents today?" maxLength={1000} />
        </Field>
        <Checkbox
          checked={attach}
          onChange={setAttach}
          label={
            <span>
              Attach current market snapshot
              {snap && (
                <span className="ml-1 text-slate-500">
                  (UMBS {snap.umbs.last.toFixed(2)}, 10Y {snap.tenYear.last.toFixed(3)}%)
                </span>
              )}
            </span>
          }
        />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ main */

export function MarketsOverview() {
  const now = useNow(30_000);
  const [tf, setTf] = useState<Timeframe>('1D');
  const [table, setTable] = useState<'bonds' | 'stocks' | 'commodities' | 'currencies'>('bonds');
  const [reports, setReports] = useState<'today' | 'week'>('today');
  const [composer, setComposer] = useState(false);
  const [event, setEvent] = useState<EconEvent | null>(null);
  const [article, setArticle] = useState<ShortArticle | null>(null);
  const insights = useInsights();
  const { toast } = useStore();

  const snap = useMemo(() => (now ? getMarketSnapshot(now) : null), [now]);
  const intraday = useMemo(() => (now ? getMbsIntraday(now) : []), [now]);
  const daily = useMemo(() => (snap ? getMbsDaily(snap) : []), [snap]);
  const tables = useMemo(() => (snap && now ? getQuoteTables(snap, now) : null), [snap, now]);
  const curve = useMemo(() => (snap ? getTreasuryCurve(snap) : []), [snap]);

  const series: PricePoint[] = useMemo(() => {
    if (!snap) return [];
    if (tf === '1D') return intraday;
    return windowOf(daily, sessionsFor(tf)).points;
  }, [tf, intraday, daily, snap]);
  const prevClose = snap ? (tf === '1D' ? prevCloseOf(snap) : windowOf(daily, sessionsFor(tf)).prevClose) : 0;
  const stats = rangeStats(series, prevClose);

  const weekEvents = useMemo(() => getWeekEvents(DEMO_NOW, DEMO_NOW), []);
  const shownEvents = reports === 'today' ? weekEvents.filter((e) => e.date === DEMO_TODAY) : weekEvents;
  const upcoming = useMemo(() => getUpcomingEvents(DEMO_NOW, 5), []);
  const updates = useMemo(() => getMorningUpdates().slice(0, 4), []);
  const wraps = useMemo(() => getMarketWraps().slice(0, 4), []);
  const locked30 = LOCKED_IN_RATES.find((r) => r.product.startsWith('30'))?.rate ?? 0;
  const spread = curveSpreadBp(curve, '2Y', '10Y');
  const spreadAgo = curveSpreadBp(curve, '2Y', '10Y', 'monthAgo');

  const tickFmt = (t: string) => (tf === '1D' ? t : new Date(t + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  const umbsBp = snap ? priceToBp(snap.umbs.change) : 0;
  const bondsPhrase = snap ? `${umbsBp === 0 ? 'flat' : umbsBp > 0 ? `up ${umbsBp}bp` : `down ${Math.abs(umbsBp)}bp`} at ${snap.umbs.last.toFixed(2)} on the UMBS 30-year 6.5% coupon` : '…';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Market Analysis"
        title="Markets Overview"
        subtitle="Mortgage-backed securities drive mortgage rates. Higher MBS prices mean lower rates."
        actions={
          <>
            <DemoBadge />
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setComposer(true)}>
              Create New
            </Button>
          </>
        }
      />

      {/* MBS chart + quotes */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <ChartCard
          title="UMBS 30YR 6.5% coupon"
          subtitle={tf === '1D' ? 'Intraday, 5-minute bars · live adapter' : `Daily closes · last ${sessionsFor(tf)} sessions`}
          action={<Segmented size="sm" ariaLabel="Timeframe" value={tf} onChange={setTf} options={TIMEFRAMES} />}
          height={300}
          table={{ head: [tf === '1D' ? 'Time' : 'Date', 'Price'], rows: [...series].reverse().slice(0, 60).map((p) => [tickFmt(p.t), p.price.toFixed(2)]) }}
        >
          {snap ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <defs>
                  <linearGradient id="mbsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="t" {...axisProps} tickFormatter={tickFmt} minTickGap={36} />
                <YAxis {...axisProps} domain={[(min: number) => Math.floor((Math.min(min, prevClose) - 0.05) * 20) / 20, (max: number) => Math.ceil((Math.max(max, prevClose) + 0.05) * 20) / 20]} tickFormatter={(v: number) => v.toFixed(2)} width={56} />
                <Tooltip content={<ChartTooltip format={(v) => v.toFixed(2)} labelFormat={(l) => tickFmt(String(l))} />} />
                <ReferenceLine y={prevClose} stroke={CHART.neutral} strokeDasharray="4 4" label={{ value: tf === '1D' ? 'Prev close' : 'Prior close', position: 'insideTopLeft', fill: CHART.text, fontSize: 11 }} />
                <Area type="monotone" dataKey="price" name="UMBS 6.5" stroke={SERIES[0]} strokeWidth={2} fill="url(#mbsFill)" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <Skeleton className="h-full" />
          )}
          <span className="sr-only">Chart of MBS prices; switch to Table for values.</span>
        </ChartCard>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <QuoteCard
            label="UMBS 30YR 6.5%"
            value={snap ? snap.umbs.last.toFixed(2) : '—'}
            delta={snap ? <Delta value={snap.umbs.change} /> : null}
            sub={snap ? `${umbsBp > 0 ? '+' : ''}${umbsBp}bp · higher price = lower rates` : ''}
          />
          <QuoteCard
            label="10-Year Treasury yield"
            value={snap ? `${snap.tenYear.last.toFixed(3)}%` : '—'}
            delta={snap ? <Delta value={snap.tenYear.change * 100} digits={1} invert suffix="bp" /> : null}
            sub="Yield up = pressure on rates"
          />
          <Card className="sm:col-span-2 xl:col-span-1">
            <div className="grid grid-cols-3 gap-x-3 gap-y-3">
              {[
                ['Low', stats.low.toFixed(2)],
                ['High', stats.high.toFixed(2)],
                [tf === '1D' ? 'Prev close' : 'Prior close', stats.prevClose.toFixed(2)],
                ['Current', stats.current.toFixed(2)],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <div className="text-[11px] font-medium text-slate-500">{k}</div>
                  <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-slate-900">{snap ? v : '—'}</div>
                </div>
              ))}
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-slate-500">Change</div>
                <div className="mt-0.5 text-[15px]">{snap ? <Delta value={stats.change} /> : '—'}</div>
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-slate-500">Range</div>
                <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-slate-900">{snap ? `${priceToBp(stats.high - stats.low)}bp` : '—'}</div>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">{tf} range stats · {tf === '1D' ? 'vs yesterday’s close' : 'vs the close before the period'}</p>
          </Card>
        </div>
      </div>

      <TalkTrack>
        “Bonds are {bondsPhrase}. Locked-in rates this morning were around <strong>{locked30}%</strong> for 30-yr fixed — your <strong>6.5%</strong> example is favorable for comparison.”
        <span className="mt-1 block text-xs text-brand-700">Locked-in rates are industry averages, not a client quote.</span>
      </TalkTrack>

      {/* Tables + curve */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader title="Markets" subtitle="Delayed demo quotes" />
          <Tabs
            value={table}
            onChange={setTable}
            tabs={[
              { value: 'bonds', label: 'Bonds' },
              { value: 'stocks', label: 'Stocks' },
              { value: 'commodities', label: 'Commodities' },
              { value: 'currencies', label: 'Currencies' },
            ]}
            className="mb-2"
          />
          {tables ? (
            <DataTable
              dense
              head={['Name', 'Last', 'Change', '% Chg']}
              rows={tables[table].map((q) => {
                const invert = q.kind === 'yield';
                return [
                  <span key="n" className="block">
                    <span className="block whitespace-nowrap">{q.name}</span>
                    <span className="block text-[11px] font-normal text-slate-400">{q.symbol}</span>
                  </span>,
                  fmtLast(q),
                  <Delta key="c" value={q.kind === 'yield' ? q.change * 100 : q.change} digits={q.kind === 'yield' ? 1 : q.kind === 'fx' && q.last < 10 ? 4 : 2} invert={invert} suffix={q.kind === 'yield' ? 'bp' : ''} />,
                  <span key="p" className="tabular-nums text-slate-600">{signed(q.changePct)}%</span>,
                ];
              })}
            />
          ) : (
            <Skeleton className="h-64" />
          )}
          {table === 'bonds' && <p className="mt-2 text-[11px] text-slate-500">For yields, ▲ (red) means rates are rising — unfavorable for borrowers.</p>}
        </Card>

        <ChartCard
          title="Treasury yield curve"
          subtitle={snap ? `2s10s spread ${spread > 0 ? '+' : ''}${spread}bp (${curveShape(spread).toLowerCase()}) · 1 month ago ${spreadAgo > 0 ? '+' : ''}${spreadAgo}bp` : ' '}
          legend={[
            { label: 'Today', color: SERIES[0] },
            { label: '1 month ago', color: SERIES[1], dashed: true },
          ]}
          height={330}
          table={{ head: ['Tenor', 'Today', '1 month ago', 'Change'], rows: curve.map((c) => [c.tenor, `${c.today.toFixed(3)}%`, `${c.monthAgo.toFixed(3)}%`, `${Math.round((c.today - c.monthAgo) * 100)}bp`]) }}
        >
          {snap ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curve} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="tenor" {...axisProps} interval={0} tick={{ ...axisProps.tick, fontSize: 11 }} />
                <YAxis {...axisProps} domain={['dataMin - 0.1', 'dataMax + 0.1']} tickFormatter={(v: number) => `${v.toFixed(1)}%`} width={48} />
                <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(3)}%`} />} />
                <Line dataKey="today" name="Today" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 4 }} isAnimationActive={false} />
                <Line dataKey="monthAgo" name="1 month ago" stroke={SERIES[1]} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Skeleton className="h-full" />
          )}
        </ChartCard>
      </div>

      {/* Calendar + upcoming + articles */}
      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Card className="min-w-0">
          <CardHeader
            title="Economic Reports"
            action={
              <Link href="/members/econ-calendar" className="text-xs font-medium text-brand-700 hover:underline">
                Full calendar
              </Link>
            }
          />
          <Segmented
            size="sm"
            value={reports}
            onChange={setReports}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'week', label: 'This Week' },
            ]}
            className="mb-3"
          />
          <ul className="divide-y divide-slate-100">
            {shownEvents.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => setEvent(e)} className="flex w-full items-start gap-3 py-2.5 text-left hover:bg-slate-50/60">
                  <span className="w-16 shrink-0 text-[11px] font-medium tabular-nums text-slate-500">
                    {reports === 'week' && <span className="block font-semibold text-slate-700">{new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })}</span>}
                    {e.time ? formatEt(e.time) : 'All day'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-800">{e.name}</span>
                    {e.unit !== 'none' && (
                      <span className="block text-xs tabular-nums text-slate-500">
                        Fcst {formatEventValue(e.forecast, e)} · Actual <span className="font-semibold text-slate-800">{formatEventValue(e.actual, e)}</span>
                      </span>
                    )}
                  </span>
                  {e.holiday ? <Badge tone="amber">Closed</Badge> : <ImportanceTag level={e.importance} />}
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="min-w-0">
          <CardHeader title="Upcoming Events" subtitle="High-importance releases & market closures" />
          <ul className="space-y-2">
            {upcoming.map((e) => {
              const d = new Date(e.date + 'T12:00:00');
              return (
                <li key={e.id}>
                  <button type="button" onClick={() => setEvent(e)} className="flex w-full items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-brand-300">
                    <span className="flex w-10 shrink-0 flex-col items-center leading-none">
                      <span className="text-[9px] font-semibold uppercase text-slate-500">{d.toLocaleDateString('en-US', { month: 'short' })}</span>
                      <span className="text-base font-bold tabular-nums text-slate-900">{d.getDate()}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-800">{e.name}</span>
                      <span className="block text-xs text-slate-500">
                        {d.toLocaleDateString('en-US', { weekday: 'long' })} · {e.time ? `${formatEt(e.time)} ET` : 'All day'}
                      </span>
                    </span>
                    {e.holiday ? <Badge tone="amber">Closed</Badge> : <ImportanceTag level={e.importance} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="min-w-0 lg:col-span-2 xl:col-span-1">
          <CardHeader title="Today’s Articles" subtitle={fmtDate(DEMO_TODAY, 'long')} />
          <ul className="space-y-1">
            {TODAYS_ARTICLES.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => setArticle(a)} className="w-full rounded-lg px-2 py-2 text-left hover:bg-slate-50">
                  <span className="flex items-center gap-2 text-[11px] text-slate-500">
                    <Badge tone="blue">{a.category}</Badge> {a.time}
                  </span>
                  <span className="mt-1 block text-sm font-semibold text-slate-900">{a.title}</span>
                  <span className="line-clamp-2 text-xs text-slate-500">{a.summary}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Insights + recent content */}
      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Card className="min-w-0">
          <CardHeader
            title="My Market Insights"
            subtitle="Private notes · saved in this browser"
            action={
              <Button size="sm" variant="subtle" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setComposer(true)}>
                New
              </Button>
            }
          />
          {insights.list.length === 0 ? (
            <EmptyState title="No insights yet" icon={<Lightbulb className="h-6 w-6" />} action={<Button size="sm" onClick={() => setComposer(true)}>Create New</Button>}>
              Capture your read on the market to reuse in client calls and social posts.
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {insights.list.map((i) => {
                const o = OUTLOOK[i.outlook];
                return (
                  <li key={i.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900">{i.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                          <Badge tone={o.tone}>
                            <o.Icon className="h-3 w-3" /> {o.label}
                          </Badge>
                          {new Date(i.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={`Delete insight ${i.title}`}
                        onClick={() => {
                          insights.remove(i.id);
                          toast('Insight deleted', 'info');
                        }}
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{i.note}</p>
                    {i.snapshot && (
                      <p className="mt-2 text-[11px] tabular-nums text-slate-500">
                        Snapshot: UMBS {i.snapshot.umbs.toFixed(2)} ({i.snapshot.umbsBp > 0 ? '+' : ''}
                        {i.snapshot.umbsBp}bp) · 10Y {i.snapshot.tenYear.toFixed(3)}%
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <RecentList
          title="Recent Morning Updates"
          icon={<Sunrise className="h-4 w-4" />}
          href="/members/morning-update"
          items={updates.map((u) => ({ id: u.id, date: u.date, title: u.title, href: `/members/morning-update?d=${u.date}` }))}
        />
        <RecentList
          title="Recent Market Wraps"
          icon={<Moon className="h-4 w-4" />}
          href="/members/market-wrap"
          items={wraps.map((w) => ({
            id: w.id,
            date: w.date,
            title: w.title,
            href: `/members/market-wrap?d=${w.date}`,
            meta: `MBS ${w.mbsClose.toFixed(2)} (${w.mbsChangeBp >= 0 ? '+' : ''}${w.mbsChangeBp}bp)`,
          }))}
        />
      </div>

      <InsightComposer
        open={composer}
        onClose={() => setComposer(false)}
        snap={snap}
        onSave={(i) => {
          insights.add(i);
          toast('Insight saved to My Market Insights');
        }}
      />
      <EventDetail event={event} onClose={() => setEvent(null)} now={DEMO_NOW} />
      <Modal open={!!article} onClose={() => setArticle(null)} title={article?.title ?? ''} description={article ? `${article.category} · ${fmtDate(article.date)} · ${article.time}` : undefined} size="lg">
        {article && (
          <div className="space-y-3 text-[15px] leading-7 text-slate-700">
            <p className="font-medium text-slate-900">{article.summary}</p>
            {article.body.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            <p className="pt-2 text-xs text-slate-400">Synthetic commentary written for the prototype.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function QuoteCard({ label, value, delta, sub }: { label: string; value: string; delta: React.ReactNode; sub: string }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Demo · live adapter</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-3">
        <span className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</span>
        <span className="text-sm">{delta}</span>
      </div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </Card>
  );
}

function RecentList({ title, icon, href, items }: { title: string; icon: React.ReactNode; href: string; items: { id: string; date: string; title: string; href: string; meta?: string }[] }) {
  return (
    <Card className="min-w-0">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <span className="text-brand-600">{icon}</span>
            {title}
          </span>
        }
        action={
          <Link href={href} className="text-xs font-medium text-brand-700 hover:underline">
            View all
          </Link>
        }
      />
      <ul className="divide-y divide-slate-100">
        {items.map((i) => (
          <li key={i.id}>
            <Link href={i.href} className="group flex items-center gap-3 py-2.5">
              <span className="w-12 shrink-0 text-xs font-medium tabular-nums text-slate-500">{fmtDate(i.date, 'short')}</span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-sm font-medium text-slate-800 group-hover:text-brand-700">{i.title}</span>
                {i.meta && <span className="block text-[11px] tabular-nums text-slate-500">{i.meta}</span>}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-brand-600" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

