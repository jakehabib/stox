'use client';

import { ArrowDownRight, ArrowRight, BellOff, BookOpen, Download, Lock, Mail, Minus, PlayCircle, Plus, Save, Target } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CalculatorShell } from '@/components/calc/CalculatorShell';
import { CoBrandingEditor } from '@/components/calc/ReportFooter';
import { EmailModal } from '@/components/calc/ResultsHeader';
import { TalkTrack } from '@/components/calc/TalkTrack';
import { Combobox } from '@/components/Combobox';
import { Badge, Button, Callout, Card, CardHeader, cx, DataTable, DemoBadge, EmptyState, Field, Modal, NumberInput, Segmented, Select, Slider, StatTile, Switch, TextInput } from '@/components/ui';
import { DemoPlayer } from '@/components/tools/recordings/DemoPlayer';
import { DisplayOnly } from '@/components/tools/strike-rate/DisplayOnly';
import { LOCKED_IN_RATES } from '@/data/mock/content';
import { getEstimatedMarketRates, getStrikeWatchlist, marketRateMap, PRODUCT_LABELS, STRIKE_GUIDE_STEPS, STRIKE_TUTORIAL } from '@/data/mock/strikeRate';
import { EARLY_PAYOFF_MONTHS, evaluateLoan, STRIKE_TIERS, summarize, type MarketProduct, type StrikeStatus, type WatchLoan, type WatchResult } from '@/lib/calculations/strikeRate';
import { downloadCsv } from '@/lib/exportCsv';
import { date, pct, usd } from '@/lib/format';
import { useStore } from '@/lib/store';

type Filter = 'all' | StrikeStatus;

const LOCKED_BY_PRODUCT: Record<MarketProduct, number | undefined> = {
  '30yr': LOCKED_IN_RATES.find((r) => r.product === '30-Yr Fixed')?.rate,
  '15yr': LOCKED_IN_RATES.find((r) => r.product === '15-Yr Fixed')?.rate,
  fha: LOCKED_IN_RATES.find((r) => r.product === 'FHA')?.rate,
  va: LOCKED_IN_RATES.find((r) => r.product === 'VA')?.rate,
  jumbo: LOCKED_IN_RATES.find((r) => r.product === 'Jumbo')?.rate,
};

const PRODUCT_OPTIONS = (Object.keys(PRODUCT_LABELS) as MarketProduct[]).map((p) => ({ value: p, label: PRODUCT_LABELS[p] }));

const toInputDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromInputDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  const x = new Date(y, (m || 1) - 1, d || 1);
  return Number.isNaN(x.getTime()) ? new Date() : x;
};
const r3 = (n: number) => pct(n, 3);

interface Row {
  key: string;
  loan: WatchLoan;
  name: string;
  email: string;
  res: WatchResult;
}

export function StrikeRate() {
  const { getClient, clients, cobranding, toast } = useStore();
  const today = useMemo(() => new Date(), []);
  const rates = useMemo(() => getEstimatedMarketRates(), []);
  const marketMap = useMemo(() => marketRateMap(rates), [rates]);

  const [extra, setExtra] = useState<WatchLoan[]>([]);
  const [shift, setShift] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<'status' | 'gap' | 'savings'>('status');
  const [cobrandOpen, setCobrandOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [email, setEmail] = useState<Row | null>(null);

  const watchlist = useMemo(() => [...extra, ...getStrikeWatchlist(today)], [extra, today]);

  const rows: Row[] = useMemo(
    () =>
      watchlist.map((loan, i) => {
        const c = getClient(loan.clientId);
        return { key: `${loan.clientId}-${i}`, loan, name: c?.name ?? 'Unknown client', email: c?.primaryEmail ?? '', res: evaluateLoan(loan, marketMap, today, shift) };
      }),
    [watchlist, getClient, marketMap, today, shift],
  );
  const summary = summarize(rows.map((r) => r.res));

  const order: Record<StrikeStatus, number> = { strike: 0, 'hit-epo': 1, watching: 2 };
  const visible = rows
    .filter((r) => filter === 'all' || r.res.status === filter)
    .sort((a, b) => {
      if (sort === 'gap') return a.res.gap - b.res.gap || b.res.savings - a.res.savings;
      if (sort === 'savings') return b.res.savings - a.res.savings;
      return order[a.res.status] - order[b.res.status] || a.res.gap - b.res.gap || b.res.savings - a.res.savings;
    });

  const top = rows.filter((r) => r.res.status === 'strike').sort((a, b) => b.res.savings - a.res.savings)[0];

  const exportCsv = () =>
    downloadCsv('strike-rate-watchlist.csv', [
      ['Client', 'Balance', 'Product', 'Current rate %', 'Required drop', 'Target %', 'Market rate %', 'Status', 'Closed', 'EPO eligible on', 'Est. monthly savings'],
      ...visible.map((r) => [r.name, r.loan.balance, PRODUCT_LABELS[r.loan.product], r.loan.ratePct, r.res.tier.drop, r.res.target, r.res.marketRate, statusText(r.res), date(r.loan.closeDate), date(r.res.epo.eligibleOn), Math.max(0, r.res.savings)]),
    ]);

  return (
    <CalculatorShell
      toolId="strike-rate"
      demo
      subtitle="Watch your closed loans and get alerted when today’s market reaches each client’s strike rate — the refi opportunity, as soon as the early payoff period allows it."
      actions={
        <>
          <Button variant="secondary" icon={<PlayCircle className="h-4 w-4" />} onClick={() => setTutorialOpen(true)}>
            Tutorial Video
          </Button>
          <Button variant="secondary" icon={<BookOpen className="h-4 w-4" />} onClick={() => setGuideOpen(true)}>
            Guide
          </Button>
          <DisplayOnly>
            <Button disabled icon={<Save className="h-4 w-4" />}>
              Save
            </Button>
          </DisplayOnly>
        </>
      }
    >
      <Callout tone="warning" title="Missing NMLS ID">
        <p>
          Your NMLS ID is missing. Strike Rate uses your NMLS ID to find the loans you’ve closed — please add it to your co-branding profile to enable Strike Rate alerts.{' '}
          <button type="button" onClick={() => setCobrandOpen(true)} className="font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-700">
            Edit co-branding
          </button>
        </p>
        <p className="mt-1 text-xs text-amber-800/80">
          Prototype note: your co-branding shows NMLS# {cobranding.nmls || '—'}, but the Strike Rate profile is treated as not connected. The watchlist below runs on demo loans.
        </p>
      </Callout>

      {/* Market rates */}
      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              Today’s Estimated Fixed Market Rates <DemoBadge />
            </span>
          }
          subtitle={`Estimated as of ${date(today, 'long')}. Estimates for comparison — not a quote or a lock.`}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {rates.map((r) => {
            const sim = Math.max(0, r.rate + shift);
            const locked = LOCKED_BY_PRODUCT[r.product];
            return (
              <div key={r.product} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-medium text-slate-500">{r.label}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{r3(sim)}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                  {shift !== 0 ? (
                    <Badge tone="brand">Simulated {pct(shift, 3, { sign: true })}</Badge>
                  ) : r.change < 0 ? (
                    <span className="inline-flex items-center gap-0.5 font-semibold text-gain">
                      <ArrowDownRight className="h-3.5 w-3.5" />
                      {pct(Math.abs(r.change), 3)} today
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 font-medium text-slate-500">
                      <Minus className="h-3.5 w-3.5" />
                      unch.
                    </span>
                  )}
                </div>
                {locked !== undefined && <div className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-slate-500">Locked-in avg {pct(locked, 3)}</div>}
              </div>
            );
          })}
        </div>
        <div className="mt-5 grid gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <Slider
            label="What if the market moves?"
            min={-1}
            max={0.5}
            step={0.125}
            value={shift}
            onChange={setShift}
            format={(v) => (v === 0 ? 'Today’s rates' : `${pct(v, 3, { sign: true })} from today`)}
          />
          <Button variant="secondary" size="sm" disabled={shift === 0} onClick={() => setShift(0)}>
            Reset to today
          </Button>
        </div>
      </Card>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile highlight label="Strike — ready to refi" value={summary.strike} sub="Target hit and past the early payoff period" tone="brand" />
        <StatTile label="Hit — inside EPO" value={summary.hitEpo} sub={`Wait for the ${EARLY_PAYOFF_MONTHS}-month early payoff period`} />
        <StatTile label="Watching" value={summary.watching} sub={`${summary.total} loans on your watchlist`} />
        <StatTile label="Monthly savings on the table" value={usd(summary.strikeMonthlySavings)} sub="Est. P&I savings across strike-ready clients" tone="gain" />
      </div>

      {/* Watchlist */}
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900">Client watchlist</h3>
            <p className="mt-0.5 text-sm text-slate-500">Target strike rate = current rate − required drop for the balance tier.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              ariaLabel="Sort watchlist"
              className="w-44"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'status', label: 'Sort: Status' },
                { value: 'gap', label: 'Sort: Closest to target' },
                { value: 'savings', label: 'Sort: Biggest savings' },
              ]}
            />
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportCsv}>
              Export CSV
            </Button>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto px-5 pt-4">
          {(
            [
              ['all', `All · ${summary.total}`],
              ['strike', `Strike · ${summary.strike}`],
              ['hit-epo', `Hit, in EPO · ${summary.hitEpo}`],
              ['watching', `Watching · ${summary.watching}`],
            ] as [Filter, string][]
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              aria-pressed={filter === v}
              onClick={() => setFilter(v)}
              className={cx(
                'whitespace-nowrap rounded-full border px-3 py-1 text-[13px] font-medium transition-colors',
                filter === v ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
              )}
            >
              {l}
            </button>
          ))}
        </div>

        <div className="p-5 pt-3">
          {visible.length === 0 ? (
            <EmptyState title="No clients in this view" icon={<Target className="h-8 w-8" />}>
              Try another filter or move the market simulator.
            </EmptyState>
          ) : (
            <>
              <div className="hidden md:block">
                <DataTable
                  head={['Client', 'Balance', 'Current', 'Drop', 'Target', 'Today', 'Status', 'Closed', 'Est. savings/mo', '']}
                  align={['left', 'right', 'right', 'right', 'right', 'right', 'left', 'left', 'right', 'right']}
                  rows={visible.map((r) => [
                    <div key="c" className="min-w-[150px]">
                      <div className="font-medium text-slate-900">{r.name}</div>
                      <div className="text-xs font-normal text-slate-500">{PRODUCT_LABELS[r.loan.product]}</div>
                    </div>,
                    usd(r.loan.balance),
                    r3(r.loan.ratePct),
                    `−${r.res.tier.drop}`,
                    <span key="t" className="font-semibold text-slate-900">
                      {r3(r.res.target)}
                    </span>,
                    r3(r.res.marketRate),
                    <StatusBadge key="s" res={r.res} />,
                    <div key="d" className="text-xs">
                      <div className="text-slate-700">{date(r.loan.closeDate)}</div>
                      <div className="text-slate-500">{r.res.epo.monthsSinceClose} mo ago</div>
                    </div>,
                    <span key="v" title={r.res.status === 'strike' ? undefined : 'At today’s rate — not yet at the strike rate'} className={r.res.savings <= 0 ? 'text-slate-400' : r.res.status === 'strike' ? 'font-semibold text-gain' : 'text-slate-600'}>
                      {r.res.savings > 0 ? usd(r.res.savings) : '—'}
                    </span>,
                    <Button key="a" size="sm" variant={r.res.status === 'strike' ? 'subtle' : 'ghost'} icon={<Mail className="h-3.5 w-3.5" />} onClick={() => setEmail(r)}>
                      Draft alert
                    </Button>,
                  ])}
                />
              </div>
              <ul className="space-y-3 md:hidden">
                {visible.map((r) => (
                  <li key={r.key} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-900">{r.name}</div>
                        <div className="text-xs text-slate-500">
                          {usd(r.loan.balance)} · {PRODUCT_LABELS[r.loan.product]}
                        </div>
                      </div>
                      <StatusBadge res={r.res} />
                    </div>
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <MiniStat label="Current" value={r3(r.loan.ratePct)} />
                      <MiniStat label="Target" value={r3(r.res.target)} strong />
                      <MiniStat label="Today" value={r3(r.res.marketRate)} />
                    </dl>
                    <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span>
                        Closed {date(r.loan.closeDate)} · {r.res.savings > 0 ? <span className={r.res.status === 'strike' ? 'font-semibold text-gain' : 'font-medium text-slate-700'}>{usd(r.res.savings)}/mo</span> : 'no savings yet'}
                      </span>
                      <Button size="sm" variant="ghost" icon={<Mail className="h-3.5 w-3.5" />} onClick={() => setEmail(r)}>
                        Alert
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <LoanChecker
          today={today}
          marketMap={marketMap}
          shift={shift}
          clients={clients.map((c) => ({ value: c.id, label: c.name, sub: c.primaryEmail }))}
          onAdd={(loan) => {
            setExtra((x) => [loan, ...x]);
            toast(`${getClient(loan.clientId)?.name ?? 'Client'} added to the watchlist`);
          }}
        />
        <TargetHitsSettings />
      </div>

      <TalkTrack>
        {top ? (
          <>
            “{top.name.split(' ')[0]}, I’ve been watching rates for you. Your loan is at {r3(top.loan.ratePct)}, and today’s estimated {PRODUCT_LABELS[top.loan.product]} rate is {r3(top.res.marketRate)} — past
            the {r3(top.res.target)} strike rate we set. On your {usd(top.loan.balance)} balance that’s about <strong>{usd(top.res.savings)} a month</strong> ({usd(top.res.savings * 12)} a year) in
            principal and interest. You’re past the early payoff window, so we can move now — want me to run the numbers on a refi?”
          </>
        ) : (
          <>“Rates haven’t reached anyone’s strike rate yet today. I’m watching {summary.total} loans and will reach out the moment one of them hits.”</>
        )}
      </TalkTrack>

      <p className="text-xs text-slate-500">
        Savings are estimated P&amp;I differences on the current balance over the remaining term at today’s estimated rate; closing costs are not included. Rates are estimates for comparison only.{' '}
        <Link href="/members/refi-cow-express" className="font-medium text-brand-700 hover:underline">
          Show the cost of waiting on a refi <ArrowRight className="inline h-3 w-3" />
        </Link>
      </p>

      <div className="contents">
      <CoBrandingEditor open={cobrandOpen} onClose={() => setCobrandOpen(false)} />

      <Modal open={tutorialOpen} onClose={() => setTutorialOpen(false)} title="Tutorial Video" description="How Strike Rate finds refi opportunities in your closed loans." size="lg">
        <DemoPlayer title={STRIKE_TUTORIAL.title} durationSec={STRIKE_TUTORIAL.durationSec} chapters={STRIKE_TUTORIAL.chapters} />
      </Modal>

      <Modal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Strike Rate Guide"
        size="lg"
        footer={
          <Button
            onClick={() => {
              setGuideOpen(false);
              setTutorialOpen(true);
            }}
            icon={<PlayCircle className="h-4 w-4" />}
          >
            Watch the tutorial
          </Button>
        }
      >
        <ol className="space-y-4">
          {STRIKE_GUIDE_STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">{i + 1}</span>
              <div>
                <div className="font-semibold text-slate-900">{s.title}</div>
                <p className="mt-0.5 text-sm text-slate-600">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Modal>

      {email && (
        <EmailModal
          open
          onClose={() => setEmail(null)}
          to={email.email}
          subject={email.res.hit ? `Good news — rates hit your target, ${email.name.split(' ')[0]}` : `Rate watch update for ${email.name.split(' ')[0]}`}
          body={alertBody(email, cobranding.name)}
        />
      )}
      </div>
    </CalculatorShell>
  );
}

function statusText(r: WatchResult) {
  if (r.status === 'strike') return 'Strike';
  if (r.status === 'hit-epo') return `Hit — EPO until ${date(r.epo.eligibleOn)}`;
  return `Needs −${pct(r.gap, 3)}`;
}

function StatusBadge({ res }: { res: WatchResult }) {
  if (res.status === 'strike') return <Badge tone="green">Strike — reach out</Badge>;
  if (res.status === 'hit-epo')
    return (
      <Badge tone="amber" className="whitespace-nowrap">
        Hit · EPO until {date(res.epo.eligibleOn, 'short')}
      </Badge>
    );
  return <Badge className="whitespace-nowrap">Needs −{pct(res.gap, 3)}</Badge>;
}

function MiniStat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cx('rounded-lg px-2 py-1.5', strong ? 'bg-brand-50' : 'bg-slate-50')}>
      <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={cx('text-sm font-semibold tabular-nums', strong ? 'text-brand-700' : 'text-slate-900')}>{value}</dd>
    </div>
  );
}

function alertBody(r: Row, lo: string) {
  const first = r.name.split(' ')[0];
  if (r.res.status === 'strike')
    return `Hi ${first},\n\nRates have moved in your favor. Your current rate is ${r3(r.loan.ratePct)} and today's estimated ${PRODUCT_LABELS[r.loan.product]} rate is ${r3(r.res.marketRate)} — at or below the ${r3(r.res.target)} target we set for you.\n\nOn your ${usd(r.loan.balance)} balance, that could lower your principal & interest by about ${usd(r.res.savings)} per month (${usd(r.res.savings * 12)} per year).\n\nWant me to put together the full refinance numbers?\n\n${lo}`;
  if (r.res.status === 'hit-epo')
    return `Hi ${first},\n\nQuick update: today's estimated ${PRODUCT_LABELS[r.loan.product]} rate (${r3(r.res.marketRate)}) has reached your ${r3(r.res.target)} target. Your loan becomes eligible to refinance on ${date(r.res.epo.eligibleOn, 'long')}, and I'll keep watching so we're ready to move then.\n\n${lo}`;
  return `Hi ${first},\n\nI'm watching rates for you. Your target is ${r3(r.res.target)} and today's estimated ${PRODUCT_LABELS[r.loan.product]} rate is ${r3(r.res.marketRate)} — about ${pct(r.res.gap, 3)} away. I'll reach out as soon as it hits.\n\n${lo}`;
}

/* ------------------------------------------------------------------ settings (read-only) */

function TargetHitsSettings() {
  return (
    <Card>
      <CardHeader
        title="Strike Rate Target Hits"
        subtitle="How targets are set. Thresholds are managed by MBS Highway."
        action={
          <Badge>
            <Lock className="h-3 w-3" /> Read only
          </Badge>
        }
      />
      <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
        <div>
          <div className="text-[13px] font-medium text-slate-700">Early Payoff Period</div>
          <div className="text-xs text-slate-500">Loans can’t be refinanced until this long after closing.</div>
        </div>
        <div className="text-lg font-semibold tabular-nums text-slate-900">{EARLY_PAYOFF_MONTHS} months</div>
      </div>
      <div className="mt-4 text-[13px] font-medium text-slate-700">Required rate drop by loan balance</div>
      <DataTable
        className="mt-1"
        head={['Loan balance', 'Rate drop needed']}
        rows={STRIKE_TIERS.map((t) => [t.label, <span key="d" className="font-semibold">{t.drop.toFixed(3).replace(/0$/, '')} pts</span>])}
      />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <DisplayOnly reason="Disabled until your NMLS ID is connected">
          <Switch checked={false} onChange={() => {}} disabled label="Notifications" />
        </DisplayOnly>
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
          <BellOff className="h-3.5 w-3.5" /> Alerts are off until your NMLS ID is connected
        </span>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ quick check */

function LoanChecker({
  today,
  marketMap,
  shift,
  clients,
  onAdd,
}: {
  today: Date;
  marketMap: Record<MarketProduct, number>;
  shift: number;
  clients: { value: string; label: string; sub?: string }[];
  onAdd: (l: WatchLoan) => void;
}) {
  // Defaults: the shared test scenario — Alex Rivera, $400,000 at 6.5% 30-yr fixed, closing today.
  const [clientId, setClientId] = useState<string | null>('c-alex-rivera');
  const [balance, setBalance] = useState(400_000);
  const [rate, setRate] = useState(6.5);
  const [product, setProduct] = useState<MarketProduct>('30yr');
  const [closed, setClosed] = useState(toInputDate(today));
  const [touched, setTouched] = useState(false);

  const loan: WatchLoan = { clientId: clientId ?? '', balance, ratePct: rate, product, closeDate: fromInputDate(closed), termMonths: product === '15yr' ? 180 : 360 };
  const res = evaluateLoan(loan, marketMap, today, shift);
  const clientError = touched && !clientId ? 'Client name is required' : undefined;

  return (
    <Card>
      <CardHeader title="Check a loan" subtitle="Set a strike rate for any client and add them to the watchlist." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Client" className="sm:col-span-2" error={clientError}>
          <Combobox ariaLabel="Client" value={clientId} onChange={setClientId} options={clients} placeholder="Search clients…" invalid={!!clientError} />
        </Field>
        <Field label="Loan balance">
          <NumberInput ariaLabel="Loan balance" prefix="$" decimals={0} min={0} value={balance} onChange={setBalance} />
        </Field>
        <Field label="Current rate">
          <NumberInput ariaLabel="Current rate" suffix="%" decimals={3} min={0} max={20} value={rate} onChange={setRate} />
        </Field>
        <Field label="Product">
          <Select ariaLabel="Product" value={product} onChange={setProduct} options={PRODUCT_OPTIONS} />
        </Field>
        <Field label="Closing date">
          <TextInput type="date" aria-label="Closing date" value={closed} onChange={(e) => e.target.value && setClosed(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <MiniStat label="Required drop" value={`−${res.tier.drop}`} />
        <MiniStat label="Strike rate" value={r3(res.target)} strong />
        <MiniStat label="Today" value={r3(res.marketRate)} />
      </div>
      <div
        className={cx(
          'mt-3 rounded-lg px-4 py-3 text-sm',
          res.status === 'strike' ? 'bg-emerald-50 text-emerald-900' : res.status === 'hit-epo' ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-700',
        )}
      >
        {res.status === 'strike' && (
          <>
            <strong>Target hit.</strong> Past the early payoff period — estimated savings <strong>{usd(res.savings)}/mo</strong>.
          </>
        )}
        {res.status === 'hit-epo' && (
          <>
            <strong>Target hit,</strong> but inside the early payoff period — eligible {date(res.epo.eligibleOn, 'long')} ({res.epo.daysRemaining} days).
          </>
        )}
        {res.status === 'watching' && (
          <>
            The market needs to fall another <strong>{pct(res.gap, 3)}</strong> to reach {r3(res.target)}. {res.epo.eligible ? 'Past the early payoff period.' : `Eligible to refinance ${date(res.epo.eligibleOn, 'long')}.`}
          </>
        )}
        <div className="mt-1 text-xs opacity-80">Tier: {res.tier.label}</div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          icon={<Plus className="h-4 w-4" />}
          onClick={() => {
            setTouched(true);
            if (!clientId) return;
            onAdd(loan);
          }}
        >
          Add to watchlist
        </Button>
      </div>
    </Card>
  );
}
