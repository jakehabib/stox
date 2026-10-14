'use client';

import clsx from 'clsx';
import { Activity, ArrowRight, ArrowUpRight, BookOpen, CalendarClock, ExternalLink, GraduationCap, Info, Lock, Newspaper, Pause, Play, PlayCircle, Sparkles, Video, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ToolIcon } from '@/components/icons';
import { Badge, Card, CardHeader, DemoBadge, EmptyState } from '@/components/ui';
import { VideoPlayer } from '@/components/tools/morning-update/VideoPlayer';
import { fmtDate, useNow } from '@/components/tools/morning-update/content';
import { getMorningUpdates, MAULDIN_ISSUES, WEBINARS } from '@/data/mock/articles';
import { LOCKED_IN_RATES } from '@/data/mock/content';
import { getMarketSnapshot } from '@/data/mock/market';
import { DEMO_TODAY, MARKET_NEWS } from '@/data/mock/markets';
import { priceToBp, relativeTime } from '@/lib/calculations/markets';
import { useStore } from '@/lib/store';
import { findTool } from '@/lib/tools';

/* ------------------------------------------------------------------ config */

const QUICK = [
  { id: 'loan-compare', label: 'Loan Comparison' },
  { id: 'cost-of-waiting', label: 'Cost of Waiting' },
  { id: 'rerc', label: 'Real Estate Report Card' },
  { id: 'buy-vs-rent', label: 'Buy vs Rent' },
  { id: 'appreciation', label: 'Appreciation' },
  { id: 'refi-cow-express', label: 'Refinance' },
  { id: 'investment-property-analyzer', label: 'Investment Property Analyzer' },
  { id: 'house-price-index', label: 'House Price Index' },
  { id: 'calculators', label: 'Calculators', href: '/members/calculators', icon: 'calculator', blurb: 'Payment, affordability, ARM vs fixed & more' },
];

const WORKFLOW: { step: string; title: string; items: { label: string; href: string }[] }[] = [
  {
    step: '1',
    title: 'Morning prep',
    items: [
      { label: 'Markets', href: '/members/markets' },
      { label: 'Economic Calendar', href: '/members/econ-calendar' },
      { label: 'Morning Update', href: '/members/morning-update' },
      { label: 'Strike Rate', href: '/members/strike-rate' },
    ],
  },
  {
    step: '2',
    title: 'Client meeting',
    items: [
      { label: 'Report Card', href: '/members/rerc' },
      { label: 'Purchase Analysis', href: '/members/purchase-analysis' },
      { label: 'Buy vs Rent', href: '/members/buy-vs-rent' },
      { label: 'Loan Comparison', href: '/members/loan-compare' },
      { label: 'Cost of Waiting', href: '/members/cost-of-waiting' },
      { label: 'Appreciation', href: '/members/appreciation' },
      { label: 'Equity Gained', href: '/members/equity-gained' },
      { label: 'Debt Consolidation', href: '/members/debt-consolidation' },
    ],
  },
  {
    step: '3',
    title: 'Follow-up',
    items: [{ label: 'Marketing', href: '/members/marketing' }],
  },
];

/* ------------------------------------------------------------------ news ticker */

const TICKER_CSS = `
        @keyframes mbsh-ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .mbsh-ticker-track { animation: mbsh-ticker 70s linear infinite; width: max-content; }
        .mbsh-ticker-wrap:hover .mbsh-ticker-track, .mbsh-ticker-wrap[data-paused="true"] .mbsh-ticker-track { animation-play-state: paused; }
        @media (prefers-reduced-motion: reduce) {
          .mbsh-ticker-track { animation: none; }
          .mbsh-ticker-wrap { overflow-x: auto; }
          .mbsh-ticker-track > ul + ul { display: none; }
          .mbsh-pause { display: none; }
        }
      `;

function NewsTicker() {
  const [paused, setPaused] = useState(false);
  const items = MARKET_NEWS;
  const row = (dup: boolean) => (
    <ul className="mbsh-ticker-row flex shrink-0 items-center" aria-hidden={dup || undefined}>
      {items.map((n) => (
        <li key={n.id + (dup ? '-d' : '')} className="flex shrink-0 items-center gap-2 whitespace-nowrap px-5 text-sm">
          <span className="text-[11px] font-semibold tabular-nums text-slate-400">{n.time}</span>
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-200">{n.tag}</span>
          <span className="text-slate-100">{n.headline}</span>
          <span className="ml-3 text-slate-600" aria-hidden>
            •
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="flex items-stretch overflow-hidden rounded-xl bg-ink-900 shadow-card" aria-label="Market news" role="region">
      <style dangerouslySetInnerHTML={{ __html: TICKER_CSS }} />
      <div className="flex shrink-0 items-center gap-2 bg-brand-600 px-3 text-[11px] font-bold uppercase tracking-wider text-white sm:px-4">
        <Newspaper className="h-4 w-4" />
        <span className="hidden sm:inline">Market News</span>
      </div>
      <div className="mbsh-ticker-wrap relative min-w-0 flex-1 overflow-hidden py-2.5" data-paused={paused}>
        <div className="mbsh-ticker-track flex">
          {row(false)}
          {row(true)}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setPaused(!paused)}
        aria-label={paused ? 'Resume news ticker' : 'Pause news ticker'}
        className="mbsh-pause shrink-0 border-l border-white/10 px-3 text-slate-300 hover:bg-white/5 hover:text-white"
      >
        {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function Pulse({ label, value, delta, good }: { label: string; value: string; delta: string; good: boolean | null }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/[0.06] px-4 py-3 ring-1 ring-white/10">
      <div className="truncate text-[11px] font-medium text-slate-400">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums text-white">{value}</span>
        <span className={clsx('text-xs font-semibold tabular-nums', good === null ? 'text-slate-400' : good ? 'text-emerald-400' : 'text-red-400')}>{delta}</span>
      </div>
    </div>
  );
}

function LockedInRates() {
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Lock className="h-4 w-4 text-brand-600" /> Locked-In Rates
          </span>
        }
        subtitle="Industry averages locked this morning"
        action={<DemoBadge />}
      />
      <ul className="divide-y divide-slate-100">
        {LOCKED_IN_RATES.map((r, i) => (
          <li key={r.product} className="flex items-center justify-between py-2.5">
            <span className="text-sm font-medium text-slate-700">{r.product}</span>
            <span className={clsx('tabular-nums tracking-tight text-slate-900', i === 0 ? 'text-2xl font-bold' : 'text-lg font-semibold')}>{r.rate.toFixed(r.rate % 1 === 0 ? 1 : 2).replace(/0$/, '')}%</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
        These are industry locked-in rate averages — not a client’s rate or a quote.
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ main */

export function Dashboard() {
  const now = useNow(60_000);
  const { scenarios } = useStore();
  const snap = useMemo(() => (now ? getMarketSnapshot(now) : null), [now]);
  const today = useMemo(() => getMorningUpdates()[0], []);
  const mauldin = MAULDIN_ISSUES[0];
  const webinar = WEBINARS[0];
  const umbsBp = snap ? priceToBp(snap.umbs.change) : 0;
  const tenBp = snap ? Math.round(snap.tenYear.change * 1000) / 10 : 0;

  const headline = !snap
    ? 'Loading this morning’s market…'
    : umbsBp > 0
      ? `Bonds are up ${umbsBp}bp after a cooler core CPI — a good morning to talk rates.`
      : umbsBp < 0
        ? `Bonds are down ${Math.abs(umbsBp)}bp this morning — review locks for near-term closings.`
        : 'Bonds are flat this morning ahead of the Beige Book.';

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-ink-950 p-5 text-white shadow-lift sm:p-7">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(60% 120% at 100% 0%, rgba(124,77,255,.45), transparent 60%), radial-gradient(40% 80% at 0% 100%, rgba(42,120,214,.25), transparent 60%)' }} />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wider text-brand-200">{fmtDate(DEMO_TODAY, 'long')}</div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Good morning, Jake</h1>
            <p className="mt-2 max-w-xl text-[15px] text-slate-300">{headline}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/members/markets" className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-ink-950 hover:bg-brand-50">
                Open Markets <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/members/morning-update" className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3.5 py-2 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15">
                <PlayCircle className="h-4 w-4" /> Today’s update
              </Link>
            </div>
          </div>
          <div className="grid w-full grid-cols-2 gap-3 lg:w-[400px]">
            <Pulse label="UMBS 30YR 6.5%" value={snap ? snap.umbs.last.toFixed(2) : '—'} delta={snap ? `${umbsBp > 0 ? '+' : ''}${umbsBp}bp` : ''} good={snap ? (umbsBp === 0 ? null : umbsBp > 0) : null} />
            <Pulse label="10Y Treasury" value={snap ? `${snap.tenYear.last.toFixed(3)}%` : '—'} delta={snap ? `${tenBp > 0 ? '+' : ''}${tenBp.toFixed(1)}bp` : ''} good={snap ? (tenBp === 0 ? null : tenBp < 0) : null} />
            <div className="col-span-2 flex items-center justify-between text-[11px] text-slate-400">
              <span>Demo data · live ticker adapter</span>
              <span>30-yr locked-in avg {LOCKED_IN_RATES[0].rate}%</span>
            </div>
          </div>
        </div>
      </section>

      <NewsTicker />

      {/* Start your day */}
      <Card className="p-4 sm:p-5">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-600" />
          <h2 className="text-[15px] font-semibold text-slate-900">Start your day</h2>
          <span className="hidden text-sm text-slate-500 sm:inline">— the LO workflow, in order</span>
        </div>
        <ol className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_minmax(0,0.5fr)]">
          {WORKFLOW.map((g) => (
            <li key={g.step} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-[11px] text-white">{g.step}</span>
                {g.title}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {g.items.map((it, i) => (
                  <span key={it.label} className="inline-flex items-center gap-1">
                    <Link href={it.href} className="rounded-md bg-white px-2 py-1 text-[13px] font-medium text-slate-700 ring-1 ring-slate-200 hover:text-brand-700 hover:ring-brand-300">
                      {it.label}
                    </Link>
                    {i < g.items.length - 1 && <ArrowRight className="h-3 w-3 shrink-0 text-slate-300" aria-hidden />}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {/* Daily update */}
          <Card className="p-4 sm:p-5">
            <CardHeader
              title="Daily Mortgage Market Update"
              subtitle={fmtDate(today.date, 'long')}
              action={
                <Link href="/members/morning-update" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                  Morning Update <ArrowUpRight className="h-4 w-4" />
                </Link>
              }
            />
            <div className="grid gap-5 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <VideoPlayer title={today.title} eyebrow="Daily Update" durationSec={today.durationSec} seed={14} compact className="self-start" />
              <div className="flex min-w-0 flex-col">
                <div className="flex flex-wrap gap-1.5">
                  {today.tags.map((t) => (
                    <Badge key={t} tone="brand">
                      {t}
                    </Badge>
                  ))}
                </div>
                <h3 className="mt-2 text-lg font-bold leading-snug tracking-tight text-slate-900">{today.title}</h3>
                <p className="mt-2 line-clamp-4 text-sm leading-6 text-slate-600">{today.summary}</p>
                <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-900">
                  <span className="font-semibold">LO takeaway: </span>
                  {today.takeaway}
                </div>
                <Link href="/members/morning-update" className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-semibold text-brand-700 hover:underline">
                  Read the full update <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </Card>

          <div className="xl:hidden">
            <LockedInRates />
          </div>

          {/* Quick access */}
          <section aria-labelledby="qa-h">
            <h2 id="qa-h" className="mb-3 text-[15px] font-semibold text-slate-900">
              Quick access
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {QUICK.map((q) => {
                const t = findTool(q.id);
                const href = q.href ?? t?.href ?? '#';
                const icon = q.icon ?? t?.icon ?? 'calculator';
                const blurb = q.blurb ?? t?.blurb ?? '';
                return (
                  <Link key={q.id} href={href} className="group flex min-w-0 items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-card transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lift sm:p-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 transition-colors group-hover:bg-brand-600 group-hover:text-white">
                      <ToolIcon name={icon} className="h-5 w-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold leading-snug text-slate-900">{q.label}</span>
                      <span className="mt-0.5 hidden text-xs leading-5 text-slate-500 sm:line-clamp-2">{blurb}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>

          {/* Recently used reports */}
          <Card padded={false}>
            <div className="flex items-start justify-between gap-3 px-5 pt-5">
              <div>
                <h3 className="text-[15px] font-semibold text-slate-900">Recently Used Reports</h3>
                <p className="mt-0.5 text-sm text-slate-500">{scenarios.length} reports · click to reopen</p>
              </div>
              <Link href="/members/client-manager" className="text-sm font-medium text-brand-700 hover:underline">
                Clients
              </Link>
            </div>
            <div className="mt-3 hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,1fr)_96px] gap-3 border-y border-slate-100 bg-slate-50/70 px-5 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 md:grid">
              <span>Tool</span>
              <span>Report</span>
              <span>Client</span>
              <span className="text-right">Used</span>
            </div>
            <ul className="divide-y divide-slate-100 border-t border-slate-100 md:border-t-0">
              {scenarios.slice(0, 11).map((s) => {
                const t = findTool(s.toolId);
                return (
                  <li key={s.id}>
                    <Link href={s.href} className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-5 py-2.5 hover:bg-brand-50/40 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,1fr)_96px]">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 group-hover:bg-brand-100 group-hover:text-brand-700">
                          <ToolIcon name={t?.icon ?? 'calculator'} className="h-4 w-4" />
                        </span>
                        <span className="truncate text-sm font-semibold text-slate-900">{t?.name ?? s.toolId}</span>
                      </span>
                      <span className="col-start-1 truncate pl-[38px] text-xs text-slate-600 md:col-start-auto md:pl-0 md:text-sm">
                        {s.title}
                        <span className="md:hidden">{s.clientName ? ` · ${s.clientName}` : ''}</span>
                      </span>
                      <span className="hidden truncate text-sm text-slate-600 md:block">{s.clientName ?? <span className="text-slate-400">No client</span>}</span>
                      <span className="col-start-2 row-span-2 row-start-1 text-right text-xs tabular-nums text-slate-500 md:col-start-auto md:row-span-1 md:row-start-auto">{now ? relativeTime(s.savedAt, now) : ''}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>

          {/* Recommended content */}
          <section aria-labelledby="rc-h">
            <h2 id="rc-h" className="mb-3 text-[15px] font-semibold text-slate-900">
              Recommended for you
            </h2>
            <div className="grid gap-3 md:grid-cols-3">
              {[
                { href: `/members/mauldin?d=${mauldin.date}`, kind: 'Newsletter', icon: <BookOpen className="h-4 w-4" />, title: mauldin.title, sub: `Thoughts from the Frontline · ${fmtDate(mauldin.date, 'short')}` },
                { href: '/members/barrys-insights', kind: 'Webinar', icon: <Video className="h-4 w-4" />, title: webinar.title, sub: `Barry’s Insights · ${Math.round(webinar.durationSec / 60)} min` },
                { href: '/members/newsletter', kind: 'Client newsletter', icon: <Newspaper className="h-4 w-4" />, title: 'Fed Minutes, Home Prices and Market Volatility', sub: 'This week’s newsletter · ready to send' },
              ].map((r) => (
                <Link key={r.href} href={r.href} className="group flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-card transition hover:border-brand-300 hover:shadow-lift">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand-700">
                    {r.icon} {r.kind}
                  </span>
                  <span className="mt-2 line-clamp-2 font-semibold leading-snug text-slate-900 group-hover:text-brand-700">{r.title}</span>
                  <span className="mt-1 text-xs text-slate-500">{r.sub}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>

        {/* Right rail */}
        <aside className="min-w-0 space-y-6">
          <div className="hidden xl:block">
            <LockedInRates />
          </div>

          <Card>
            <CardHeader title="Upcoming Payments" subtitle="Subscription & billing reminders" action={<Badge>0</Badge>} />
            <EmptyState icon={<Wallet className="h-6 w-6" />} title="No upcoming payments">
              You’re all set — nothing is due.
            </EmptyState>
          </Card>

          <Card>
            <CardHeader title="Recent Activity" subtitle="Client views, opens and shares" />
            <EmptyState icon={<Activity className="h-6 w-6" />} title="No recent activity">
              When clients open reports you send, it shows up here.
            </EmptyState>
          </Card>

          <Card>
            <CardHeader title="Resources" />
            <div className="space-y-2">
              <Link href="/members/barrys-insights" className="group flex items-center gap-3 rounded-lg border border-slate-200 p-3 hover:border-brand-300">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  <Video className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">Training Webinars</span>
                  <span className="block text-xs text-slate-500">Barry’s Insights archive</span>
                </span>
                <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-brand-600" />
              </Link>
              <Link href="/members/market-wrap" className="group flex items-center gap-3 rounded-lg border border-slate-200 p-3 hover:border-brand-300">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  <Newspaper className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">MBS Highway Articles</span>
                  <span className="block text-xs text-slate-500">Market Wrap & daily commentary</span>
                </span>
                <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-brand-600" />
              </Link>
              <a
                href="https://becomecma.com"
                target="_blank"
                rel="noopener noreferrer"
                className="group relative block overflow-hidden rounded-xl bg-gradient-to-br from-brand-600 to-brand-900 p-4 text-white shadow-card hover:shadow-lift"
              >
                <GraduationCap aria-hidden className="absolute -right-3 -top-3 h-20 w-20 text-white/10" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-200">Certification</span>
                <span className="mt-1 block text-base font-bold">Become a CMA</span>
                <span className="mt-1 block text-xs text-brand-100">Certified Mortgage Advisor program — learn more at becomecma.com.</span>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold">
                  Visit becomecma.com <ExternalLink className="h-3.5 w-3.5" />
                  <span className="sr-only">(opens in a new tab)</span>
                </span>
              </a>
            </div>
          </Card>

          <div className="flex items-center gap-2 px-1 text-xs text-slate-400">
            <CalendarClock className="h-3.5 w-3.5" /> Demo clock: Wed Oct 14 2026
          </div>
        </aside>
      </div>
    </div>
  );
}
