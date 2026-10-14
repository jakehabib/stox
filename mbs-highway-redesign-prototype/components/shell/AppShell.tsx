'use client';

import clsx from 'clsx';
import { Bell, CircleHelp, ExternalLink, Menu, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Combobox, type ComboOption } from '@/components/Combobox';
import { ToolIcon } from '@/components/icons';
import { getMarketSnapshot, priceChangeBp, type MarketSnapshot } from '@/data/mock/market';
import { useStore } from '@/lib/store';
import { RESOURCES, SECTION_HUBS, SECTION_ICONS, SECTION_ORDER, TOOLS, toolForPath, toolsIn, type Section } from '@/lib/tools';

/* ---------------------------------------------------------------- ticker */

function useMarket() {
  const [snap, setSnap] = useState<MarketSnapshot | null>(null);
  useEffect(() => {
    const tick = () => setSnap(getMarketSnapshot(new Date()));
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);
  return snap;
}

function Ticker() {
  const snap = useMarket();
  if (!snap) return <div className="hidden h-8 w-72 animate-pulse rounded bg-white/5 md:block" />;
  const up = snap.umbs.change >= 0;
  const yUp = snap.tenYear.change >= 0;
  return (
    <Link href="/members/markets" className="hidden items-center gap-4 rounded-lg px-2 py-1 text-xs hover:bg-white/5 md:flex" title="Demo market data — refreshes every 30s">
      <div className="flex items-baseline gap-1.5">
        <span className="font-medium text-slate-400">UMBS 30YR 6.5%</span>
        <span className="font-semibold tabular-nums text-white">{snap.umbs.last.toFixed(2)}</span>
        <span className={clsx('font-semibold tabular-nums', up ? 'text-emerald-400' : 'text-red-400')}>{priceChangeBp(snap.umbs.change)}</span>
      </div>
      <div className="h-4 w-px bg-white/15" />
      <div className="flex items-baseline gap-1.5">
        <span className="font-medium text-slate-400">10Y UST</span>
        <span className="font-semibold tabular-nums text-white">{snap.tenYear.last.toFixed(3)}%</span>
        {/* Yield up is bad for rates: show it red. */}
        <span className={clsx('font-semibold tabular-nums', yUp ? 'text-red-400' : 'text-emerald-400')}>
          {snap.tenYear.change > 0 ? '+' : ''}
          {(snap.tenYear.change * 100).toFixed(1)}bp
        </span>
      </div>
      <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300">Demo</span>
    </Link>
  );
}

/* ---------------------------------------------------------------- search */

function GlobalSearch({ className }: { className?: string }) {
  const router = useRouter();
  const options: ComboOption[] = useMemo(
    () => [
      ...TOOLS.map((t) => ({ value: `tool:${t.id}`, label: t.name, sub: t.blurb, group: 'Tools' })),
      ...RESOURCES.map((r) => ({ value: `res:${r.name}`, label: r.name, sub: r.kind, group: 'Resources' })),
    ],
    [],
  );
  const filter = (o: ComboOption, q: string) => {
    if (o.value.startsWith('tool:')) {
      const t = TOOLS.find((x) => `tool:${x.id}` === o.value)!;
      return [t.name, t.blurb, t.section, ...(t.keywords ?? [])].join(' ').toLowerCase().includes(q);
    }
    return `${o.label} ${o.sub}`.toLowerCase().includes(q);
  };
  return (
    <Combobox
      className={className}
      ariaLabel="Search for tools & resources"
      placeholder="Search for tools & resources…"
      value={null}
      options={options}
      filter={filter}
      onChange={(v) => {
        if (v.startsWith('tool:')) {
          const t = TOOLS.find((x) => `tool:${x.id}` === v)!;
          if (t.external) window.open(t.href, '_blank', 'noopener');
          else router.push(t.href);
        } else {
          const r = RESOURCES.find((x) => `res:${x.name}` === v)!;
          if (r.external) window.open(r.href, '_blank', 'noopener');
          else router.push(r.href);
        }
      }}
    />
  );
}

/* ---------------------------------------------------------------- notifications */

const NOTIFICATIONS = [
  { title: 'Morning Update is live', body: 'Today’s video and article are ready to share.', href: '/members/morning-update', time: '8:02 AM' },
  { title: 'Newsletter ready', body: '“Fed Minutes, Home Prices and Market Volatility” is ready to send.', href: '/members/newsletter', time: 'Yesterday' },
  { title: 'Strike Rate', body: 'Add your NMLS ID to enable target-hit notifications.', href: '/members/strike-rate', time: 'Mon' },
];

function Notifications() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label="Notifications" onClick={() => setOpen(!open)} className="relative rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white">
        <Bell className="h-5 w-5" />
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-brand-400 ring-2 ring-ink-950" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lift">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Notifications</div>
          <ul>
            {NOTIFICATIONS.map((n) => (
              <li key={n.title}>
                <Link href={n.href} onClick={() => setOpen(false)} className="block px-4 py-3 hover:bg-slate-50">
                  <div className="flex justify-between gap-2 text-sm font-medium text-slate-900">
                    {n.title}
                    <span className="shrink-0 text-xs font-normal text-slate-400">{n.time}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">{n.body}</div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- sidebar */

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const current = toolForPath(pathname);
  const hubSection = (Object.entries(SECTION_HUBS) as [Section, string][]).find(([, href]) => href === pathname)?.[0];
  const activeSection = current?.section ?? hubSection ?? null;
  const [openSection, setOpenSection] = useState<Section | null>(activeSection);
  useEffect(() => {
    if (activeSection) setOpenSection(activeSection);
  }, [activeSection]);

  return (
    <nav aria-label="Main" className="flex h-full flex-col gap-0.5 overflow-y-auto px-3 py-4">
      {SECTION_ORDER.map((section) => {
        const tools = toolsIn(section);
        const single = tools.length === 1 ? tools[0] : null;
        const active = activeSection === section;
        const itemCls = clsx(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
          active ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white',
        );
        if (single) {
          return single.external ? (
            <a key={section} href={single.href} target="_blank" rel="noopener noreferrer" className={itemCls} onClick={onNavigate}>
              <ToolIcon name={SECTION_ICONS[section]} className="h-[18px] w-[18px]" />
              {section}
              <ExternalLink className="ml-auto h-3.5 w-3.5 opacity-60" />
            </a>
          ) : (
            <Link key={section} href={single.href} className={itemCls} onClick={onNavigate}>
              <ToolIcon name={SECTION_ICONS[section]} className="h-[18px] w-[18px]" />
              {section}
            </Link>
          );
        }
        const isOpen = openSection === section;
        return (
          <div key={section}>
            <button type="button" className={itemCls} aria-expanded={isOpen} onClick={() => setOpenSection(isOpen ? null : section)}>
              <ToolIcon name={SECTION_ICONS[section]} className="h-[18px] w-[18px]" />
              {section}
              <span className="ml-auto text-[10px] text-slate-500">{tools.length}</span>
            </button>
            {isOpen && (
              <div className="mb-1 ml-[22px] mt-0.5 border-l border-white/10 pl-3">
                {SECTION_HUBS[section] && (
                  <Link href={SECTION_HUBS[section]!} onClick={onNavigate} className={clsx('block rounded-md px-2 py-1.5 text-[12.5px]', pathname === SECTION_HUBS[section] ? 'text-white' : 'text-slate-500 hover:text-white')}>
                    All {section.toLowerCase()}
                  </Link>
                )}
                {tools.map((t) => (
                  <Link
                    key={t.id}
                    href={t.href}
                    onClick={onNavigate}
                    className={clsx('block truncate rounded-md px-2 py-1.5 text-[12.5px]', current?.id === t.id ? 'bg-brand-600/30 font-medium text-white' : 'text-slate-400 hover:text-white')}
                  >
                    {t.name}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="mt-auto pt-6">
        <div className="rounded-xl bg-gradient-to-br from-brand-600/40 to-brand-900/40 p-3 text-xs text-slate-300">
          <div className="font-semibold text-white">Prototype build</div>
          All data is synthetic. Nothing is sent, booked or priced.
        </div>
      </div>
    </nav>
  );
}

/* ---------------------------------------------------------------- tool switcher */

function ToolSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const current = toolForPath(pathname);
  const options = useMemo(() => TOOLS.filter((t) => !t.external).map((t) => ({ value: t.id, label: t.name, sub: t.blurb, group: t.section })), []);
  return (
    <div className="no-print flex flex-col gap-2 border-b border-slate-200 bg-white/70 px-4 py-2.5 backdrop-blur sm:flex-row sm:items-center sm:px-6 lg:px-8">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        {current ? (
          <>
            {SECTION_HUBS[current.section] ? (
              <Link href={SECTION_HUBS[current.section]!} className="hover:text-slate-800">
                {current.section}
              </Link>
            ) : (
              <span>{current.section}</span>
            )}
            <span>/</span>
            <span className="font-medium text-slate-800">{current.name}</span>
          </>
        ) : (
          <span className="font-medium text-slate-800">Tools</span>
        )}
      </div>
      <Combobox
        className="sm:ml-auto sm:w-72"
        ariaLabel="Switch tool"
        placeholder="Switch tool…"
        value={current?.id ?? null}
        options={options}
        onChange={(id) => {
          const t = TOOLS.find((x) => x.id === id);
          if (t) router.push(t.href);
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- misc */

function AskMiles() {
  const [open, setOpen] = useState(false);
  return (
    <div className="no-print fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2">
      {open && (
        <div className="w-64 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-lift">
          <div className="mb-1 flex items-center justify-between font-semibold text-slate-900">
            Ask Miles
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-slate-600">Ask Miles — coming soon in prototype.</p>
        </div>
      )}
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-full bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lift hover:bg-ink-800">
        <Sparkles className="h-4 w-4 text-brand-300" />
        Ask Miles
      </button>
    </div>
  );
}

function Toaster() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="no-print pointer-events-none fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'pointer-events-auto flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lift',
            t.tone === 'warning' ? 'bg-amber-500 text-white' : t.tone === 'info' ? 'bg-ink-900 text-white' : 'bg-emerald-600 text-white',
          )}
        >
          {t.message}
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)} className="opacity-70 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();
  useEffect(() => setDrawer(false), [pathname]);
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 bg-ink-950 px-3 sm:px-4">
        <button type="button" aria-label="Open menu" className="rounded-lg p-2 text-slate-300 hover:bg-white/10 lg:hidden" onClick={() => setDrawer(true)}>
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/members/homepage" className="flex shrink-0 items-center gap-2 lg:w-[232px]">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-black text-white">M</span>
          <span className="hidden text-[15px] font-bold tracking-tight text-white sm:block">
            MBS <span className="text-brand-300">Highway</span>
          </span>
        </Link>
        <Ticker />
        <div className="ml-auto flex items-center gap-1">
          <div className="hidden w-80 md:block [&_input]:border-white/10 [&_input]:bg-white/5 [&_input]:text-white [&_input]:placeholder:text-slate-400">
            <GlobalSearch />
          </div>
          <Link href="/members/search" aria-label="Search" className="rounded-lg p-2 text-slate-300 hover:bg-white/10 md:hidden">
            <span className="sr-only">Search</span>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          </Link>
          <a href={TOOLS.find((t) => t.id === 'get-help')!.href} target="_blank" rel="noopener noreferrer" aria-label="Help" className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white">
            <CircleHelp className="h-5 w-5" />
          </a>
          <Notifications />
          <div className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 text-xs font-bold text-white" title="Jake Habib">
            JH
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className="no-print sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[248px] shrink-0 bg-ink-950 lg:block">
          <Sidebar />
        </aside>
        {drawer && (
          <div className="no-print fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} />
            <aside className="absolute left-0 top-0 h-full w-[272px] bg-ink-950">
              <div className="flex h-14 items-center justify-between px-4">
                <span className="font-bold text-white">
                  MBS <span className="text-brand-300">Highway</span>
                </span>
                <button type="button" aria-label="Close menu" onClick={() => setDrawer(false)} className="p-2 text-slate-300">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="h-[calc(100%-3.5rem)]">
                <Sidebar onNavigate={() => setDrawer(false)} />
              </div>
            </aside>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <ToolSwitcher />
          <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
      <AskMiles />
      <Toaster />
    </div>
  );
}

export { GlobalSearch };
