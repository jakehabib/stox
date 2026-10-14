'use client';

/**
 * "True Cost Comparison" results — reused by Loan Comparison and the Purchase Analysis summary.
 * Greeting + option cards with badges, holding-period slider, Financial Snapshot tabs
 * (Monthly Payment / Total Cost / Equity Impact), Reinvestment Strategy, Detailed Comparison
 * (View all, View Amortization, Add Reinvestment per loan) and the LO talk track.
 */
import { Award, Check, ChevronDown, Plus, Table2, TrendingUp } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartCard, ChartTooltip } from '@/components/calc/ChartCard';
import { ComparisonTable, type ComparisonRow } from '@/components/calc/ComparisonTable';
import { TalkTrack } from '@/components/calc/TalkTrack';
import { Badge, Button, Card, NumberInput, Slider, Tabs, cx } from '@/components/ui';
import { axisProps, axisUsd, gridProps, SERIES } from '@/lib/chartTheme';
import {
  compareLoans,
  reinvestment,
  summaryFacts,
  yearlySeries,
  type ComparisonProperty,
  type ComparisonResult,
  type LoanOption,
  type OptionResult,
  type ReinvestResult,
} from '@/lib/calculations/loanCompare';
import { pct, usd } from '@/lib/format';
import { useStore } from '@/lib/store';
import { AmortizationModal } from './AmortizationModal';

export interface ReinvestSettings {
  enabled: boolean;
  ratePct: number;
  /** Options the strategy is applied to. */
  ids: string[];
}
export const DEFAULT_REINVEST: ReinvestSettings = { enabled: false, ratePct: 6, ids: [] };

type SnapshotTab = 'monthly' | 'total' | 'equity';

const color = (i: number) => SERIES[i % SERIES.length];
/** Axis ticks: exact dollars under $10K (avoids duplicate "$2K" ticks), compact above. */
const smallUsd = (v: number) => (Math.abs(v) < 10000 ? usd(v) : axisUsd(v));
const loanDesc = (o: OptionResult, src: LoanOption) => `${src.termYears}-yr ${src.loanType} ${pct(o.ratePct, 3)}`;

/* ------------------------------------------------------------------ detailed rows (table + CSV) */

interface DetailRow {
  label: string;
  values: (number | string)[];
  fmt?: (v: number) => string;
  better?: 'low' | 'high';
  extended?: boolean;
  strong?: boolean;
}

function detailRows(c: ComparisonResult, src: LoanOption[], reinv: ReinvestResult[] | null, years: number): DetailRow[] {
  const o = c.options;
  const m = (fn: (r: OptionResult) => number) => o.map(fn);
  const $ = (v: number) => usd(v);
  const rows: DetailRow[] = [
    { label: 'Purchase price', values: m((r) => r.price), fmt: $ },
    { label: 'Down payment', values: m((r) => r.downPayment), fmt: $ },
    { label: 'Loan amount', values: m((r) => r.loanAmount), fmt: $ },
    { label: 'Program', values: o.map((_, i) => src[i].program) },
    { label: 'Term', values: o.map((_, i) => `${src[i].termYears}-yr ${src[i].loanType}`) },
    { label: 'Rate', values: m((r) => r.ratePct), fmt: (v) => pct(v, 3), better: 'low' },
    { label: 'APR', values: m((r) => r.aprPct), fmt: (v) => pct(v, 3), better: 'low' },
    { label: 'Points', values: m((r) => r.pointsPct), fmt: (v) => `${v.toLocaleString('en-US', { maximumFractionDigits: 3 })} pts` },
    { label: 'Principal & interest', values: m((r) => r.pi), fmt: $, better: 'low' },
    { label: 'Mortgage insurance', values: m((r) => r.mi), fmt: $ },
    { label: 'Taxes', values: m((r) => r.taxes), fmt: $ },
    { label: 'Insurance / HOA', values: m((r) => r.insurance + r.hoa), fmt: $ },
    { label: 'Total monthly payment', values: m((r) => r.totalMonthly), fmt: $, better: 'low', strong: true },
    { label: 'Cash to close', values: m((r) => r.cashToClose), fmt: $, better: 'low', strong: true },
    { label: 'Closing costs', values: m((r) => r.closingCosts), fmt: $, extended: true },
    { label: 'Prepaid', values: m((r) => r.prepaid), fmt: $, extended: true },
    { label: 'Points cost', values: m((r) => r.pointsCost), fmt: $, extended: true },
    { label: 'Credits', values: m((r) => r.credits), fmt: $, extended: true },
    { label: `Interest paid (${years} yrs)`, values: m((r) => r.interestPaid), fmt: $, better: 'low', extended: true },
    { label: `Principal paid (${years} yrs)`, values: m((r) => r.principalPaid), fmt: $, better: 'high', extended: true },
    { label: `MI paid (${years} yrs)`, values: m((r) => r.miPaid), fmt: $, extended: true },
    { label: `Total cost (${years} yrs)`, values: m((r) => r.totalCost), fmt: $, better: 'low', extended: true, strong: true },
    { label: `Loan balance (yr ${years})`, values: m((r) => r.balance), fmt: $, better: 'low', extended: true },
    { label: `Appreciation (yr ${years})`, values: m((r) => r.appreciation), fmt: $, extended: true },
    { label: `Total equity (yr ${years})`, values: m((r) => r.totalEquity), fmt: $, better: 'high', extended: true, strong: true },
  ];
  if (reinv) rows.push({ label: `Reinvestment value (yr ${years})`, values: reinv.map((x) => x.futureValue), fmt: $, better: 'high', extended: true });
  return rows;
}

function bestOf(values: (number | string)[], better?: 'low' | 'high'): number | undefined {
  if (!better || values.length < 2 || values.some((v) => typeof v !== 'number')) return undefined;
  const r = (values as number[]).map((v) => Math.round(v * 1000) / 1000);
  const target = better === 'low' ? Math.min(...r) : Math.max(...r);
  const idx = r.filter((v) => v === target);
  return idx.length === 1 ? r.indexOf(target) : undefined;
}

/** CSV rows for the ResultsHeader Export button. */
export function comparisonCsv(property: ComparisonProperty, options: LoanOption[], holdingYears: number, reinvest?: ReinvestSettings): (string | number)[][] {
  const c = compareLoans(property, options, holdingYears);
  const reinv = reinvest?.enabled ? reinvestment(c.options, reinvest.ratePct).map((x) => (reinvest.ids.includes(x.id) ? x : { ...x, futureValue: 0 })) : null;
  const rows = detailRows(c, options, reinv, holdingYears);
  return [['Metric', ...c.options.map((o) => o.label)], ...rows.map((r) => [r.label, ...r.values.map((v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v))])];
}

/* ------------------------------------------------------------------ component */

export function ComparisonResults({
  property,
  locationLabel,
  options,
  holdingYears,
  onHoldingChange,
  clientName,
  message,
  reinvest,
  onReinvestChange,
  onEditOption,
  showTalkTrack = true,
}: {
  property: ComparisonProperty;
  locationLabel: string;
  options: LoanOption[];
  holdingYears: number;
  onHoldingChange: (y: number) => void;
  clientName?: string | null;
  message?: string;
  reinvest?: ReinvestSettings;
  onReinvestChange?: (r: ReinvestSettings) => void;
  onEditOption?: (id: string) => void;
  showTalkTrack?: boolean;
}) {
  const { cobranding } = useStore();
  const c = useMemo(() => compareLoans(property, options, holdingYears), [property, options, holdingYears]);
  const [tab, setTab] = useState<SnapshotTab>('monthly');
  const [viewAll, setViewAll] = useState(false);
  const [amortId, setAmortId] = useState<string | null>(null);
  const rv = reinvest ?? DEFAULT_REINVEST;
  const reinvAll = useMemo(() => reinvestment(c.options, rv.ratePct), [c.options, rv.ratePct]);
  const reinvShown = rv.enabled ? reinvAll.map((x) => (rv.ids.includes(x.id) ? x : { ...x, futureValue: 0, contributions: 0, growth: 0 })) : null;
  const multi = c.options.length > 1;
  const first = c.options[0];
  const facts = summaryFacts(c);

  const badgesFor = (i: number) => {
    const b: string[] = [];
    if (c.winners.monthly.includes(i)) b.push('Lowest monthly payment');
    if (c.winners.cash.includes(i)) b.push('Lowest total cash to close');
    if (c.winners.cost.includes(i)) b.push('Lowest cost loan');
    return b;
  };

  const toggleReinvestFor = (id: string) => {
    if (!onReinvestChange) return;
    const has = rv.enabled && rv.ids.includes(id);
    const ids = has ? rv.ids.filter((x) => x !== id) : Array.from(new Set([...rv.ids, id]));
    onReinvestChange({ ...rv, enabled: ids.length > 0 || rv.enabled, ids });
  };

  const amortOpt = options.find((o) => o.id === amortId) ?? null;
  const amortIdx = amortOpt ? options.indexOf(amortOpt) : 0;

  /* ---------- detailed table */
  const allRows = detailRows(c, options, reinvShown, holdingYears);
  const tableRows: ComparisonRow[] = allRows
    .filter((r) => viewAll || !r.extended)
    .map((r) => ({
      label: r.label,
      strong: r.strong,
      best: bestOf(r.values, r.better),
      values: r.values.map((v) => (typeof v === 'number' && r.fmt ? r.fmt(v) : String(v))),
    }));
  tableRows.push({
    label: <span className="text-xs font-normal text-slate-500">Actions</span>,
    values: c.options.map((o) => (
      <div key={o.id} className="no-print flex flex-col items-end gap-1 py-0.5">
        <button type="button" onClick={() => setAmortId(o.id)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
          <Table2 className="h-3 w-3" /> View Amortization
        </button>
        {onReinvestChange && (
          <button type="button" onClick={() => toggleReinvestFor(o.id)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
            {rv.enabled && rv.ids.includes(o.id) ? (
              <>
                <Check className="h-3 w-3" /> Reinvesting · remove
              </>
            ) : (
              <>
                <Plus className="h-3 w-3" /> Add Reinvestment
              </>
            )}
          </button>
        )}
        {onEditOption && (
          <button type="button" onClick={() => onEditOption(o.id)} className="text-xs font-medium text-slate-500 hover:text-slate-800 hover:underline">
            Edit loan
          </button>
        )}
      </div>
    )),
  });

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------- greeting + option cards */}
      <Card padded={false} className="overflow-hidden">
        <div className="bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 px-5 py-6 text-white sm:px-7">
          <div className="text-xs font-semibold uppercase tracking-wider text-white/70">True Cost Comparison</div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-[28px]">
            Hi, {clientName || 'there'}! <span className="font-medium text-white/90">Here is your True Cost Comparison.</span>
          </h2>
          <p className="mt-2 text-sm text-white/80">
            {usd(property.price)} home · {locationLabel} · {c.options.length} loan option{c.options.length === 1 ? '' : 's'} · owning {holdingYears} year{holdingYears === 1 ? '' : 's'}
          </p>
          {message && message.trim() && (
            <figure className="mt-4 rounded-lg bg-white/10 px-4 py-3 text-sm backdrop-blur">
              <blockquote className="whitespace-pre-line text-white">“{message.trim()}”</blockquote>
              <figcaption className="mt-1 text-xs text-white/70">— {cobranding.name}, {cobranding.company}</figcaption>
            </figure>
          )}
        </div>
        <div className={cx('grid gap-px bg-slate-200', c.options.length >= 2 && 'sm:grid-cols-2', c.options.length === 3 && 'xl:grid-cols-3', c.options.length >= 4 && 'xl:grid-cols-4')}>
          {c.options.map((o, i) => {
            const badges = badgesFor(i);
            return (
              <div key={o.id} className="relative bg-white px-5 pb-5 pt-6">
                <span className="absolute inset-x-0 top-0 h-1" style={{ background: color(i) }} aria-hidden />
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color(i) }} aria-hidden />
                      {o.label}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {loanDesc(o, options[i])} · {o.pointsPct ? `${o.pointsPct} pts` : '0 pts'} · {usd(o.loanAmount)}
                    </div>
                  </div>
                  {onEditOption && (
                    <button type="button" onClick={() => onEditOption(o.id)} className="no-print text-xs font-medium text-brand-700 hover:underline">
                      Edit
                    </button>
                  )}
                </div>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-bold tabular-nums tracking-tight text-slate-900">{usd(o.totalMonthly)}</span>
                  <span className="text-sm text-slate-500">/mo</span>
                </div>
                {multi && i > 0 && <DiffLine value={o.totalMonthly - first.totalMonthly} better="low" suffix="/mo vs Option 1" />}
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <Kv k="P&I" v={usd(o.pi, { cents: true })} />
                  <Kv k="APR" v={pct(o.aprPct, 3)} />
                  <Kv k="Cash to close" v={usd(o.cashToClose)} />
                  <Kv k={`Cost · ${holdingYears} yrs`} v={usd(o.totalCost)} />
                </dl>
                {badges.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {badges.map((b) => (
                      <Badge key={b} tone="green" className="uppercase tracking-wide">
                        <Award className="h-3 w-3" />
                        {b}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* ---------------------------------------------------------- holding period */}
      <Card>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] lg:items-center">
          <div>
            <Slider
              label="How long does your client plan on owning their home?"
              min={1}
              max={30}
              value={holdingYears}
              onChange={onHoldingChange}
              format={(v) => `${v} year${v === 1 ? '' : 's'}`}
            />
            <p className="mt-2 text-xs text-slate-500">
              Note: per NAR, the average length of residency is 10 years.{' '}
              {holdingYears !== 10 && (
                <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => onHoldingChange(10)}>
                  Use 10 years
                </button>
              )}
            </p>
          </div>
          {multi && facts && (
            <div className="rounded-xl bg-emerald-50 px-4 py-3">
              <div className="text-xs font-medium text-emerald-800">Over {holdingYears} years</div>
              {facts.costWin ? (
                <div className="mt-0.5 text-sm text-emerald-900">
                  <span className="font-semibold">{facts.costWin.label}</span> costs <span className="text-lg font-bold tabular-nums">{usd(c.spread.cost)}</span> less in total
                </div>
              ) : (
                <div className="mt-0.5 text-sm text-emerald-900">All options cost the same over this period.</div>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* ---------------------------------------------------------- financial snapshot */}
      <section aria-labelledby="snap-h">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 id="snap-h" className="text-lg font-semibold text-slate-900">
              Financial Snapshot
            </h3>
            <p className="text-sm text-slate-500">After {holdingYears} year{holdingYears === 1 ? '' : 's'} of ownership</p>
          </div>
        </div>
        <Tabs<SnapshotTab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'monthly', label: 'Monthly Payment' },
            { value: 'total', label: 'Total Cost' },
            { value: 'equity', label: 'Equity Impact' },
          ]}
          className="mb-4"
        />
        {tab === 'monthly' && <MonthlyTab c={c} holdingYears={holdingYears} />}
        {tab === 'total' && <TotalCostTab c={c} property={property} options={options} holdingYears={holdingYears} />}
        {tab === 'equity' && <EquityTab c={c} property={property} options={options} holdingYears={holdingYears} />}
      </section>

      {/* ---------------------------------------------------------- reinvestment */}
      {rv.enabled && (
        <Card>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
                <TrendingUp className="h-4 w-4 text-brand-600" /> Reinvestment Strategy
              </h3>
              <p className="mt-0.5 text-sm text-slate-500">Invest each option’s monthly savings vs. the highest-payment option for {holdingYears} years.</p>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-600">Assumed return</span>
              <NumberInput ariaLabel="Assumed reinvestment rate" className="w-28" suffix="%/yr" decimals={2} min={0} max={30} value={rv.ratePct} onChange={(ratePct) => onReinvestChange?.({ ...rv, ratePct })} />
            </div>
          </div>
          <div className={cx('grid gap-3', c.options.length > 1 && 'sm:grid-cols-2', c.options.length > 2 && 'xl:grid-cols-4')}>
            {c.options.map((o, i) => {
              const r = reinvAll[i];
              const on = rv.ids.includes(o.id);
              return (
                <div key={o.id} className={cx('rounded-xl border p-4', on ? 'border-slate-200' : 'border-dashed border-slate-300 bg-slate-50/60')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color(i) }} aria-hidden />
                      {o.label}
                    </span>
                    {onReinvestChange && (
                      <button type="button" className="no-print text-xs font-medium text-brand-700 hover:underline" onClick={() => toggleReinvestFor(o.id)}>
                        {on ? 'Remove' : 'Add'}
                      </button>
                    )}
                  </div>
                  {on ? (
                    r.monthlySavings > 0.5 ? (
                      <>
                        <div className="mt-3 text-2xl font-bold tabular-nums text-slate-900">{usd(r.futureValue)}</div>
                        <div className="text-xs text-slate-500">
                          {usd(r.monthlySavings)}/mo × {o.holdingMonths} months at {pct(rv.ratePct, 2)} · contributions {usd(r.contributions)} · growth <span className="font-medium text-emerald-700">{usd(r.growth, { sign: true })}</span>
                        </div>
                      </>
                    ) : (
                      <p className="mt-3 text-sm text-slate-500">Highest payment — no monthly savings to reinvest.</p>
                    )
                  ) : (
                    <p className="mt-3 text-sm text-slate-500">Not included. {r.monthlySavings > 0.5 ? `Could invest ${usd(r.monthlySavings)}/mo.` : ''}</p>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ---------------------------------------------------------- detailed comparison */}
      <Card>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900">Detailed Comparison</h3>
            <p className="mt-0.5 text-sm text-slate-500">★ marks the better value in each row</p>
          </div>
          <Button variant="secondary" size="sm" icon={<ChevronDown className={cx('h-4 w-4 transition-transform', viewAll && 'rotate-180')} />} onClick={() => setViewAll(!viewAll)}>
            {viewAll ? 'Show less' : 'View all'}
          </Button>
        </div>
        <ComparisonTable columns={c.options.map((o) => o.label)} colors={c.options.map((_, i) => color(i))} rows={tableRows} />
      </Card>

      {showTalkTrack && <LoanTalkTrack c={c} holdingYears={holdingYears} />}

      <AmortizationModal open={!!amortOpt} onClose={() => setAmortId(null)} option={amortOpt} label={amortOpt ? c.options[amortIdx]?.label ?? 'Loan' : ''} price={property.price} holdingYears={holdingYears} />
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function Kv({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{k}</dt>
      <dd className="font-semibold tabular-nums text-slate-900">{v}</dd>
    </div>
  );
}

/** Signed difference vs Option 1; emerald when better, red when worse. */
function DiffLine({ value, better, suffix }: { value: number; better: 'low' | 'high'; suffix?: string }) {
  const r = Math.round(value);
  if (r === 0) return <div className="mt-0.5 text-xs text-slate-500">Same as Option 1</div>;
  const good = better === 'low' ? r < 0 : r > 0;
  return (
    <div className={cx('mt-0.5 text-xs font-medium tabular-nums', good ? 'text-emerald-700' : 'text-red-600')}>
      {better === 'low' && r < 0 ? `Saves ${usd(-r)}` : usd(r, { sign: true })}
      {suffix ? ` ${suffix}` : ''}
    </div>
  );
}

function Diff({ v, better }: { v: number; better: 'low' | 'high' }) {
  const r = Math.round(v);
  if (r === 0) return null;
  const good = better === 'low' ? r < 0 : r > 0;
  return <div className={cx('text-[11px] font-medium', good ? 'text-emerald-700' : 'text-red-600')}>({usd(r, { sign: true })})</div>;
}

/** Breakdown table: one column per option; later options show the diff vs Option 1. */
function BreakdownTable({ c, rows }: { c: ComparisonResult; rows: { label: string; get: (o: OptionResult) => number; better?: 'low' | 'high'; strong?: boolean; hideIfZero?: boolean }[] }) {
  const shown = rows.filter((r) => !r.hideIfZero || c.options.some((o) => Math.round(r.get(o)) !== 0));
  return (
    <ComparisonTable
      columns={c.options.map((o) => o.label)}
      colors={c.options.map((_, i) => color(i))}
      rows={shown.map((r) => ({
        label: r.label,
        strong: r.strong,
        values: c.options.map((o, i) => (
          <div key={o.id}>
            {usd(r.get(o))}
            {i > 0 && r.better && <Diff v={r.get(o) - r.get(c.options[0])} better={r.better} />}
          </div>
        )),
      }))}
    />
  );
}

function MonthlyTab({ c, holdingYears }: { c: ComparisonResult; holdingYears: number }) {
  const anyMi = c.options.some((o) => o.mi > 0);
  const comps: { key: string; get: (o: OptionResult) => number }[] = [
    { key: 'Principal', get: (o) => o.principalPart },
    { key: 'Interest', get: (o) => o.interestPart },
    ...(anyMi ? [{ key: 'MI', get: (o: OptionResult) => o.mi }] : []),
    { key: 'Taxes', get: (o) => o.taxes },
    { key: 'HOA / Ins', get: (o) => o.insurance + o.hoa },
  ];
  const data = comps.map((k) => Object.fromEntries([['name', k.key], ...c.options.map((o, i) => [`o${i}`, Math.round(k.get(o))])]));
  const months = c.options[0]?.holdingMonths ?? holdingYears * 12;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h4 className="text-sm font-semibold text-slate-900">Monthly payment in year {holdingYears}</h4>
        <p className="mb-3 text-xs text-slate-500">Principal/interest split of payment #{months}; P&amp;I stays level for the life of a fixed loan.</p>
        <BreakdownTable
          c={c}
          rows={[
            { label: 'Principal', get: (o) => o.principalPart, better: 'high' },
            { label: 'Interest', get: (o) => o.interestPart, better: 'low' },
            { label: 'Mortgage insurance', get: (o) => o.mi, hideIfZero: true },
            { label: 'HOA / Insurance', get: (o) => o.insurance + o.hoa },
            { label: 'Taxes', get: (o) => o.taxes },
            { label: 'Total', get: (o) => o.totalMonthly, better: 'low', strong: true },
          ]}
        />
      </Card>
      <ChartCard
        title="Payment breakdown"
        subtitle={`Payment #${months}, by option`}
        legend={c.options.map((o, i) => ({ label: o.label, color: color(i) }))}
        table={{ head: ['Component', ...c.options.map((o) => o.label)], rows: data.map((d) => [d.name as string, ...c.options.map((_, i) => usd(d[`o${i}`] as number))]) }}
        height={280}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="name" {...axisProps} interval={0} />
            <YAxis {...axisProps} tickFormatter={smallUsd} width={56} />
            <Tooltip cursor={{ fill: 'rgba(100,116,139,0.08)' }} content={<ChartTooltip format={(v) => usd(v)} />} />
            {c.options.map((o, i) => (
              <Bar key={o.id} dataKey={`o${i}`} name={o.label} fill={color(i)} radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function SeriesChart({ title, subtitle, c, property, options, holdingYears, pick }: { title: string; subtitle: string; c: ComparisonResult; property: ComparisonProperty; options: LoanOption[]; holdingYears: number; pick: 'cost' | 'equity' }) {
  const data = useMemo(() => {
    const series = options.map((o) => yearlySeries(property, o, holdingYears));
    return Array.from({ length: holdingYears + 1 }, (_, y) => Object.fromEntries([['year', y], ...series.map((s, i) => [`o${i}`, Math.round(s[y]?.[pick] ?? 0)])]));
  }, [options, property, holdingYears, pick]);
  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      legend={c.options.map((o, i) => ({ label: o.label, color: color(i) }))}
      table={{ head: ['Year', ...c.options.map((o) => o.label)], rows: data.map((d) => [`Yr ${d.year}`, ...c.options.map((_, i) => usd(d[`o${i}`] as number))]) }}
      height={280}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="year" {...axisProps} tickFormatter={(v) => `Yr ${v}`} minTickGap={16} />
          <YAxis {...axisProps} tickFormatter={axisUsd} width={60} />
          <Tooltip content={<ChartTooltip format={(v) => usd(v)} labelFormat={(l) => `Year ${l}`} />} />
          {c.options.map((o, i) => (
            <Line key={o.id} type="monotone" dataKey={`o${i}`} name={o.label} stroke={color(i)} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function TotalCostTab({ c, property, options, holdingYears }: { c: ComparisonResult; property: ComparisonProperty; options: LoanOption[]; holdingYears: number }) {
  const win = c.winners.cost.length === 1 ? c.options[c.winners.cost[0]] : null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h4 className="text-sm font-semibold text-slate-900">Total cost over {holdingYears} years</h4>
        <p className="mb-3 text-xs text-slate-500">Interest + mortgage insurance + points + closing costs − credits.</p>
        <BreakdownTable
          c={c}
          rows={[
            { label: 'Interest', get: (o) => o.interestPaid, better: 'low' },
            { label: 'Mortgage insurance', get: (o) => o.miPaid, hideIfZero: true },
            { label: 'Points', get: (o) => o.pointsCost },
            { label: 'Closing costs', get: (o) => o.closingCosts },
            { label: 'Credits', get: (o) => -o.credits, hideIfZero: true },
            { label: 'Total', get: (o) => o.totalCost, better: 'low', strong: true },
          ]}
        />
        {c.options.length > 1 && (
          <div className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            {win ? (
              <>
                Difference <span className="font-bold tabular-nums">{usd(c.spread.cost)}</span> savings with <span className="font-semibold">{win.label}</span>.
              </>
            ) : (
              'No difference in total cost.'
            )}
          </div>
        )}
      </Card>
      <SeriesChart title="Cumulative cost" subtitle="Upfront costs + interest + MI, by year" c={c} property={property} options={options} holdingYears={holdingYears} pick="cost" />
    </div>
  );
}

function EquityTab({ c, property, options, holdingYears }: { c: ComparisonResult; property: ComparisonProperty; options: LoanOption[]; holdingYears: number }) {
  const v = c.options[0];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Projected value · Yr 10</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-slate-900">{usd(c.projectedValue10)}</span>
            <span className="text-sm font-medium text-emerald-700">{usd(c.projectedValue10 - property.price, { sign: true })}</span>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Projected value · Yr {holdingYears}</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-slate-900">{usd(v?.projectedValue ?? property.price)}</span>
            <span className="text-sm font-medium text-emerald-700">{usd(v?.appreciation ?? 0, { sign: true })}</span>
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h4 className="text-sm font-semibold text-slate-900">Equity after {holdingYears} years</h4>
          <p className="mb-3 text-xs text-slate-500">Principal paid + appreciation + down payment.</p>
          <BreakdownTable
            c={c}
            rows={[
              { label: 'Principal paid', get: (o) => o.principalPaid, better: 'high' },
              { label: 'Appreciation', get: (o) => o.appreciation },
              { label: 'Down payment', get: (o) => o.downPayment },
              { label: 'Total equity', get: (o) => o.totalEquity, better: 'high', strong: true },
              { label: 'Loan balance', get: (o) => o.balance, better: 'low' },
            ]}
          />
        </Card>
        <SeriesChart title="Equity over time" subtitle="Principal paid + appreciation + down payment" c={c} property={property} options={options} holdingYears={holdingYears} pick="equity" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ talk track */

export function LoanTalkTrack({ c, holdingYears }: { c: ComparisonResult; holdingYears: number }) {
  const f = summaryFacts(c);
  if (!f) {
    const o = c.options[0];
    if (!o) return null;
    return (
      <TalkTrack>
        “At {pct(o.ratePct, 3)}, your total payment is {usd(o.totalMonthly)} a month with {usd(o.cashToClose)} to close. Over {holdingYears} years you’d build {usd(o.totalEquity)} in equity. Let’s add a second quote so you can see the true cost side by side.”
      </TalkTrack>
    );
  }
  const winRate = (r: OptionResult) => pct(r.ratePct, 3);
  const w = f.sweep ? f.monthlyWin! : null;
  const cashNote = f.sameCash ? 'with the same cash to close' : `but cash to close differs by ${usd(c.spread.cash)}`;
  const pointsLine = f.anyPoints
    ? `Here the lower rate is bought with points (${c.options.map((o) => `${o.label}: ${o.pointsPct} pts`).join(', ')}), so check the break-even against how long you’ll keep the loan.`
    : `In this example ${c.options.length === 2 ? 'both show' : 'all show'} 0 points, so treat ${w ? w.label : 'the lower-rate option'} as a lower-rate quote to verify.`;
  return (
    <TalkTrack>
      {w ? (
        <>
          “{winRate(w)} wins on payment, total cost, and equity {cashNote} — {usd(c.spread.monthly)}/mo less, {usd(c.spread.cost)} less over {holdingYears} years.
        </>
      ) : (
        <>
          “{f.monthlyWin ? `${f.monthlyWin.label} has the lowest payment` : 'Payments are tied'}
          {f.costWin ? `, ${f.costWin.label} has the lowest total cost over ${holdingYears} years` : ''}
          {f.equityWin ? `, and ${f.equityWin.label} builds the most equity` : ''} — {cashNote}.
        </>
      )}{' '}
      Tradeoff: a lower rate usually comes with points or a different lock — if you move or refi in under ~5 years, the higher-rate / no-cost option can win. {pointsLine}”
    </TalkTrack>
  );
}
