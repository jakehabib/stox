'use client';

import { ArrowDownRight, ArrowUpRight, Bath, BedDouble, Check, Copy, Home, LineChart, Megaphone, Ruler, Share2, TrendingDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Callout, Card, cx, DemoBadge, EmptyState, Field, Modal, PageHeader, Select, TextArea, TextInput } from '@/components/ui';
import { DEMO_AGENTS } from '@/data/mock/cobranding';
import { AGENT_FEED, FEED_KIND_LABELS, type FeedItem, type FeedKind, type ListingItem, type MarketItem, type PostItem, type RateAlertItem } from '@/data/mock/agentFeed';
import { getMarketSnapshot, priceChangeBp } from '@/data/mock/market';
import { flyerPayment, rateMoveSavings } from '@/lib/calculations/agentFeed';
import { bp, date, num, pct, usd } from '@/lib/format';
import { useStore } from '@/lib/store';
import type { CoBranding } from '@/data/mock/cobranding';

type Filter = 'all' | FeedKind;
const KIND_ICON: Record<FeedKind, typeof Home> = { market: LineChart, listing: Home, 'rate-alert': TrendingDown, post: Megaphone };
const KIND_TONE: Record<FeedKind, 'blue' | 'brand' | 'green' | 'amber'> = { market: 'blue', listing: 'brand', 'rate-alert': 'green', post: 'amber' };
const PALETTE: Record<ListingItem['palette'], string> = {
  brand: 'from-brand-400 via-brand-600 to-brand-900',
  emerald: 'from-emerald-300 via-emerald-600 to-emerald-900',
  sky: 'from-sky-300 via-sky-600 to-sky-900',
};

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function itemText(item: FeedItem, snap: ReturnType<typeof getMarketSnapshot>): string {
  switch (item.kind) {
    case 'market':
      if (item.source === 'live')
        return `${item.title}\n${item.body}\n• UMBS 30YR 6.5%: ${snap.umbs.last.toFixed(2)} (${priceChangeBp(snap.umbs.change)})\n• 10Y Treasury: ${snap.tenYear.last.toFixed(3)}% (${bp(snap.tenYear.change)})`;
      return `${item.title}\n${item.body}\n${(item.stats ?? []).map((s) => `• ${s.label}: ${s.value}`).join('\n')}`;
    case 'listing': {
      const p = flyerPayment(item);
      return `${item.address}, ${item.city} — ${usd(item.price)}\n${item.beds} bd · ${item.baths} ba · ${num(item.sqft)} sq ft\nEst. payment ${usd(p.total)}/mo with ${pct(item.downPct, 1)} down (${item.product} at ${pct(item.ratePct, 3)}): P&I ${usd(p.pi)}, taxes ${usd(p.tax)}, insurance ${usd(p.ins)}${p.hoa ? `, HOA ${usd(p.hoa)}` : ''}.`;
    }
    case 'rate-alert': {
      const s = rateMoveSavings(item.exampleLoan, item.fromPct, item.toPct);
      return `${item.title}\n${item.body}\nOn a ${usd(item.exampleLoan)} loan, ${pct(item.fromPct, 3)} → ${pct(item.toPct, 3)} is about ${usd(Math.abs(s))}/mo ${s >= 0 ? 'less' : 'more'} in principal & interest.`;
    }
    case 'post':
      return `${item.body}\n\n${item.hashtags.join(' ')}`;
  }
}

export function AgentFeed() {
  const { cobranding } = useStore();
  const snap = useMemo(() => getMarketSnapshot(), []);
  const [filter, setFilter] = useState<Filter>('all');
  const [sharing, setSharing] = useState<FeedItem | null>(null);
  const [shared, setShared] = useState<Set<string>>(new Set());

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: AGENT_FEED.length, market: 0, listing: 0, 'rate-alert': 0, post: 0 };
    AGENT_FEED.forEach((i) => (c[i.kind] += 1));
    return c;
  }, []);
  const visible = AGENT_FEED.filter((i) => filter === 'all' || i.kind === filter);
  const filters: { v: Filter; label: string }[] = [
    { v: 'all', label: 'All' },
    { v: 'market', label: 'Market snapshots' },
    { v: 'listing', label: 'Listing flyers' },
    { v: 'rate-alert', label: 'Rate alerts' },
    { v: 'post', label: 'Shareable posts' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Agent Feed"
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            Agent Feed
            <Badge tone="blue" className="border border-sky-200">
              Inferred — not observed in live session
            </Badge>
            <DemoBadge />
          </span>
        }
        subtitle="Ready-to-share content for your realtor partners: market snapshots, co-branded listing flyers, rate-move alerts and social posts."
      />

      <Callout tone="info" title="Inferred design">
        The live Agent Feed couldn’t be accessed during the observation session, so this page is a proposed design built on mock content. Sharing copies the message to your clipboard — nothing is sent.
      </Callout>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {filters.map((f) => (
          <button
            key={f.v}
            type="button"
            aria-pressed={filter === f.v}
            onClick={() => setFilter(f.v)}
            className={cx(
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors',
              filter === f.v ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
            )}
          >
            {f.label}
            <span className={cx('rounded-full px-1.5 text-[11px] tabular-nums', filter === f.v ? 'bg-white/20' : 'bg-slate-100 text-slate-500')}>{counts[f.v]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState title="Nothing here yet" />
      ) : (
        <div className="columns-1 gap-4 md:columns-2 xl:columns-3 [&>*]:mb-4">
          {visible.map((item) => (
            <FeedCard key={item.id} item={item} snap={snap} cobranding={cobranding} shared={shared.has(item.id)} onShare={() => setSharing(item)} />
          ))}
        </div>
      )}

      <div className="contents">
      {sharing && (
        <ShareModal
          item={sharing}
          text={itemText(sharing, snap)}
          cobranding={cobranding}
          onClose={() => setSharing(null)}
          onCopied={() => {
            setShared((s) => new Set(s).add(sharing.id));
            setSharing(null);
          }}
        />
      )}
      </div>
    </div>
  );
}

function FeedCard({ item, snap, cobranding, shared, onShare }: { item: FeedItem; snap: ReturnType<typeof getMarketSnapshot>; cobranding: CoBranding; shared: boolean; onShare: () => void }) {
  const Icon = KIND_ICON[item.kind];
  return (
    <Card padded={false} className="break-inside-avoid overflow-hidden">
      {item.kind === 'listing' && <ListingVisual item={item} cobranding={cobranding} />}
      <div className="p-5">
        <div className="flex items-center justify-between gap-2">
          <Badge tone={KIND_TONE[item.kind]}>
            <Icon className="h-3 w-3" /> {FEED_KIND_LABELS[item.kind]}
          </Badge>
          <span className="text-xs text-slate-400">{date(item.postedAt)}</span>
        </div>
        <h3 className="mt-3 text-[15px] font-semibold leading-snug text-slate-900">{item.title}</h3>
        {item.kind === 'market' && <MarketBody item={item} snap={snap} />}
        {item.kind === 'listing' && <ListingBody item={item} />}
        {item.kind === 'rate-alert' && <RateBody item={item} />}
        {item.kind === 'post' && <PostBody item={item} />}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {item.tags.map((t) => (
            <span key={t} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
              {t}
            </span>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
          {shared ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
              <Check className="h-3.5 w-3.5" /> Copied for sharing
            </span>
          ) : (
            <span className="text-xs text-slate-400">Co-branded with your profile</span>
          )}
          <Button size="sm" variant="subtle" icon={<Share2 className="h-3.5 w-3.5" />} onClick={onShare}>
            Share with agent
          </Button>
        </div>
      </div>
    </Card>
  );
}

function MarketBody({ item, snap }: { item: MarketItem; snap: ReturnType<typeof getMarketSnapshot> }) {
  const stats =
    item.source === 'live'
      ? [
          { label: 'UMBS 30YR 6.5%', value: snap.umbs.last.toFixed(2), sub: priceChangeBp(snap.umbs.change), up: snap.umbs.change >= 0, good: snap.umbs.change >= 0 },
          { label: '10Y Treasury', value: `${snap.tenYear.last.toFixed(3)}%`, sub: bp(snap.tenYear.change), up: snap.tenYear.change >= 0, good: snap.tenYear.change <= 0 },
        ]
      : (item.stats ?? []).map((s) => ({ label: s.label, value: s.value, sub: undefined as string | undefined, up: true, good: s.tone !== 'loss' }));
  return (
    <>
      <p className="mt-1.5 text-sm text-slate-600">{item.body}</p>
      <div className={cx('mt-4 grid gap-2', stats.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg bg-slate-50 px-3 py-2">
            <div className="text-[11px] text-slate-500">{s.label}</div>
            <div className="text-lg font-semibold tabular-nums text-slate-900">{s.value}</div>
            {s.sub && (
              <div className={cx('inline-flex items-center gap-0.5 text-xs font-semibold', s.good ? 'text-gain' : 'text-loss')}>
                {s.up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {s.sub}
              </div>
            )}
          </div>
        ))}
      </div>
      {item.source === 'live' && <div className="mt-2 text-[11px] text-slate-400">From the market feed adapter (demo) · updates through the day</div>}
    </>
  );
}

function ListingVisual({ item, cobranding }: { item: ListingItem; cobranding: CoBranding }) {
  const agent = DEMO_AGENTS[item.agentIndex] ?? DEMO_AGENTS[0];
  return (
    <div className={cx('relative bg-gradient-to-br p-5 text-white', PALETTE[item.palette])}>
      <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_20%_20%,white_1px,transparent_1px)] [background-size:16px_16px]" aria-hidden />
      <div className="relative">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-white/70">Just listed</div>
        <div className="mt-1 text-2xl font-bold tabular-nums">{usd(item.price)}</div>
        <div className="text-sm font-medium">{item.address}</div>
        <div className="text-xs text-white/75">{item.city}</div>
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-white/20 pt-3 text-[11px] text-white/80">
          <span className="truncate">{agent.name} · {agent.company}</span>
          <span className="truncate">{cobranding.name} · NMLS# {cobranding.nmls}</span>
        </div>
      </div>
    </div>
  );
}

function ListingBody({ item }: { item: ListingItem }) {
  const p = flyerPayment(item);
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1">
          <BedDouble className="h-3.5 w-3.5" /> {item.beds} bd
        </span>
        <span className="inline-flex items-center gap-1">
          <Bath className="h-3.5 w-3.5" /> {item.baths} ba
        </span>
        <span className="inline-flex items-center gap-1">
          <Ruler className="h-3.5 w-3.5" /> {num(item.sqft)} sq ft
        </span>
      </div>
      <div className="mt-4 rounded-lg bg-brand-50/70 px-4 py-3">
        <div className="text-xs text-brand-800">Est. monthly payment</div>
        <div className="text-2xl font-semibold tabular-nums text-slate-900">{usd(p.total)}</div>
        <div className="mt-0.5 text-xs text-slate-600">
          {pct(item.downPct, 1)} down ({usd(p.down)}) · {item.product} at {pct(item.ratePct, 3)}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-slate-500">
          <span>
            P&amp;I <b className="block text-[13px] text-slate-800">{usd(p.pi)}</b>
          </span>
          <span>
            Taxes <b className="block text-[13px] text-slate-800">{usd(p.tax)}</b>
          </span>
          <span>
            Ins.{p.hoa ? ' + HOA' : ''} <b className="block text-[13px] text-slate-800">{usd(p.ins + p.hoa)}</b>
          </span>
        </div>
      </div>
    </>
  );
}

function RateBody({ item }: { item: RateAlertItem }) {
  const s = rateMoveSavings(item.exampleLoan, item.fromPct, item.toPct);
  return (
    <>
      <div className="mt-3 flex items-end gap-3">
        <div className="text-3xl font-bold tabular-nums tracking-tight text-slate-900">{pct(item.toPct, 3)}</div>
        <div className="pb-1 text-sm text-slate-500">
          from <span className="line-through">{pct(item.fromPct, 3)}</span> · {item.product}
        </div>
      </div>
      <p className="mt-2 text-sm text-slate-600">{item.body}</p>
      <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        On a {usd(item.exampleLoan)} loan: <b>{usd(Math.abs(s))}/mo {s >= 0 ? 'less' : 'more'}</b> in P&amp;I
      </div>
    </>
  );
}

function PostBody({ item }: { item: PostItem }) {
  return (
    <>
      <blockquote className="mt-3 border-l-2 border-amber-300 pl-3 text-sm leading-relaxed text-slate-700">{item.body}</blockquote>
      <div className="mt-2 text-xs font-medium text-brand-700">{item.hashtags.join(' ')}</div>
    </>
  );
}

function ShareModal({ item, text, cobranding, onClose, onCopied }: { item: FeedItem; text: string; cobranding: CoBranding; onClose: () => void; onCopied: () => void }) {
  const { toast } = useStore();
  const [agentIdx, setAgentIdx] = useState(String(item.kind === 'listing' ? item.agentIndex : 0));
  const agent = DEMO_AGENTS[Number(agentIdx)] ?? DEMO_AGENTS[0];
  const build = (a: CoBranding) => `Hi ${a.name.split(' ')[0]},\n\nSharing this for your buyers — feel free to forward or post:\n\n${text}\n\n${cobranding.name}, ${cobranding.title ?? 'Loan Officer'}\n${cobranding.company} · NMLS# ${cobranding.nmls}\n${cobranding.cell} · ${cobranding.email}`;
  const [message, setMessage] = useState(build(agent));

  return (
    <Modal
      open
      onClose={onClose}
      title="Share with agent"
      description="Prototype: nothing is sent. Copy the message and paste it into a text, email or social post."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            icon={<Copy className="h-4 w-4" />}
            onClick={async () => {
              const ok = await copyText(message);
              toast(ok ? `Copied for ${agent.name} — nothing was sent` : 'Copy failed — select the text and copy manually', ok ? 'success' : 'warning');
              if (ok) onCopied();
            }}
          >
            Copy to clipboard
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Agent partner">
            <Select
              ariaLabel="Agent partner"
              value={agentIdx}
              onChange={(v) => {
                setAgentIdx(v);
                setMessage(build(DEMO_AGENTS[Number(v)] ?? DEMO_AGENTS[0]));
              }}
              options={DEMO_AGENTS.map((a, i) => ({ value: String(i), label: `${a.name} · ${a.company}` }))}
            />
          </Field>
          <Field label="Agent email">
            <TextInput readOnly value={agent.email} />
          </Field>
        </div>
        <Field label="Message">
          <TextArea rows={12} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
