'use client';

import clsx from 'clsx';
import { AlertTriangle, Bath, BedDouble, CalendarDays, Download, Home, MapPin, Ruler, Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalculatorShell } from '@/components/calc/CalculatorShell';
import { ChartCard, ChartTooltip } from '@/components/calc/ChartCard';
import { CoBrandingBlock, ReportFooter } from '@/components/calc/ReportFooter';
import { TalkTrack } from '@/components/calc/TalkTrack';
import { Badge, Button, Card, CardHeader, DataTable, Field, Segmented, Select, TextInput } from '@/components/ui';
import { AVM_EXAMPLES, AVM_TOWN_ONLY_EXAMPLE } from '@/data/mock/avm';
import { DEMO_AGENTS } from '@/data/mock/cobranding';
import { getValue, valuationCsv, type Valuation } from '@/lib/calculations/mbestimate';
import { axisProps, axisUsd, gridProps, SERIES } from '@/lib/chartTheme';
import { downloadCsv } from '@/lib/exportCsv';
import { date, num, usd } from '@/lib/format';
import { useUrlState } from '@/lib/useUrlState';

const TOOL = 'mbestimate';

interface MbState {
  address: string;
  /** Address that "Get value" was run on; null = nothing valued yet. */
  submitted: string | null;
  agent: string; // '' = none, else agent name
  display: 'left' | 'right';
}
const DEFAULTS: MbState = { address: '', submitted: null, agent: '', display: 'left' };

export function MbEstimate() {
  const [s, setS] = useUrlState<MbState>(DEFAULTS);
  const set = (patch: Partial<MbState>) => setS((p) => ({ ...p, ...patch }));
  const [touched, setTouched] = useState(false);
  const result = useMemo(() => (s.submitted !== null ? getValue(s.submitted) : null), [s.submitted]);
  const valuation = result?.ok ? result.valuation : null;
  const agent = DEMO_AGENTS.find((a) => a.name === s.agent);
  const emptyError = touched && !s.address.trim() ? 'Enter an address to get a value.' : undefined;

  const run = (addr = s.address) => {
    setTouched(true);
    if (!addr.trim()) return;
    set({ address: addr, submitted: addr });
  };

  const download = () => {
    if (!valuation) return;
    const slug = `${valuation.address.number}-${valuation.address.street}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadCsv(`mbestimate-${slug}.csv`, valuationCsv(valuation, agent?.name));
  };

  return (
    <CalculatorShell toolId={TOOL} demo subtitle="Instant home value estimate by street address, co-branded with a real estate agent.">
      <Card className="p-5">
        <form
          className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_auto] lg:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <Field label="Location" error={emptyError}>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <TextInput aria-label="Location" placeholder="Enter address" className="pl-9" value={s.address} invalid={!!emptyError} onChange={(e) => set({ address: e.target.value })} />
            </div>
          </Field>
          <Field label="Co-brand Agent (Optional)">
            <Select ariaLabel="Co-brand Agent" value={s.agent} onChange={(agent) => set({ agent })} options={[{ value: '', label: 'None' }, ...DEMO_AGENTS.map((a) => ({ value: a.name, label: `${a.name} · ${a.company}` }))]} />
          </Field>
          <Field label="Display">
            <Segmented ariaLabel="Display" value={s.display} onChange={(display) => set({ display })} options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" icon={<Search className="h-4 w-4" />} className="flex-1 lg:flex-none">
              Get value
            </Button>
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} disabled={!valuation} title={valuation ? 'Download valuation (CSV)' : 'Get a value first'} onClick={download} className="flex-1 lg:flex-none">
              Download
            </Button>
          </div>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>Try:</span>
          {[...AVM_EXAMPLES, AVM_TOWN_ONLY_EXAMPLE].map((ex) => (
            <button key={ex} type="button" onClick={() => run(ex)} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:border-brand-300 hover:text-brand-700">
              {ex}
              {ex === AVM_TOWN_ONLY_EXAMPLE ? ' (town only)' : ''}
            </button>
          ))}
        </div>
      </Card>

      {result && !result.ok && s.submitted?.trim() && (
        <Card className="flex flex-col items-center px-6 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="mt-3 font-semibold text-slate-900">{result.message}</div>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            “{s.submitted}” resolves to a town or ZIP, not a single property. Add the house number and street, e.g. <span className="font-medium text-slate-700">{AVM_EXAMPLES[0]}</span>.
          </p>
        </Card>
      )}

      {!result && (
        <Card className="flex flex-col items-center px-6 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            <Home className="h-6 w-6" />
          </div>
          <div className="mt-3 font-semibold text-slate-900">Enter a street address to get an instant value</div>
          <p className="mt-1 max-w-md text-sm text-slate-500">MBEstimate returns an estimated value, a likely range, a confidence score, recent comparable sales and the value trend.</p>
        </Card>
      )}

      {valuation && <ValuationView v={valuation} agent={agent} display={s.display} />}
    </CalculatorShell>
  );
}

function ValuationView({ v, agent, display }: { v: Valuation; agent?: (typeof DEMO_AGENTS)[number]; display: 'left' | 'right' }) {
  const addr = `${v.address.number} ${v.address.street}`;
  const place = v.address.rest || v.market.label;
  const pos = v.high > v.low ? ((v.estimate - v.low) / (v.high - v.low)) * 100 : 50;
  const first = v.trend[0].value;
  const yr = v.trend[v.trend.length - 13]?.value ?? first;
  const yoy = yr > 0 ? ((v.estimate - yr) / yr) * 100 : 0;
  const tone = v.confidenceLabel === 'High' ? 'green' : v.confidenceLabel === 'Medium' ? 'blue' : 'amber';

  const cobrand = (
    <div className="space-y-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Prepared by</div>
      <CoBrandingBlock compact />
      {agent ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-800 text-base font-bold text-white">
              {agent.name
                .split(' ')
                .map((x) => x[0])
                .join('')}
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-slate-900">{agent.name}</div>
              <div className="text-xs text-slate-500">
                {agent.title} · {agent.company}
              </div>
            </div>
          </div>
          <div className="mt-3 space-y-0.5 text-xs text-slate-600">
            <div>Cell {agent.cell}</div>
            <div>{agent.email}</div>
            <div>{agent.address}</div>
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-xs text-slate-500">No co-brand agent selected. Pick one above to add an agent card.</p>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className={clsx('grid grid-cols-1 gap-6 lg:grid-cols-[300px_minmax(0,1fr)]', display === 'right' && 'lg:grid-cols-[minmax(0,1fr)_300px]')}>
        <aside className={clsx('min-w-0', display === 'right' && 'lg:order-2')}>{cobrand}</aside>
        <Card className="min-w-0 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wider text-brand-600">MBEstimate</div>
              <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900">{addr}</h2>
              <p className="text-sm text-slate-500">{place}</p>
            </div>
            <Badge tone={tone}>
              {v.confidenceLabel} confidence · {v.confidence}
            </Badge>
          </div>
          <div className="mt-5 text-xs font-medium text-slate-500">Estimated value</div>
          <div className="text-5xl font-bold tabular-nums tracking-tight text-slate-900">{usd(v.estimate)}</div>
          <div className="mt-1 text-sm text-slate-500">
            {usd(v.pricePerSqft)}/sq ft · <span className={yoy >= 0 ? 'text-gain' : 'text-loss'}>{`${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}%`}</span> past 12 months
          </div>

          <div className="mt-6">
            <div className="relative h-2.5 rounded-full" style={{ background: `linear-gradient(90deg, #cde2fb, ${SERIES[0]}, #cde2fb)` }}>
              <div className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow" style={{ left: `${pos}%`, background: '#0d366b' }} />
            </div>
            <div className="mt-2 flex justify-between text-sm">
              <div>
                <div className="text-xs text-slate-500">Low</div>
                <div className="font-semibold tabular-nums text-slate-900">{usd(v.low)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-500">High</div>
                <div className="font-semibold tabular-nums text-slate-900">{usd(v.high)}</div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Fact icon={<BedDouble className="h-4 w-4" />} label="Beds" value={num(v.beds)} />
            <Fact icon={<Bath className="h-4 w-4" />} label="Baths" value={String(v.baths)} />
            <Fact icon={<Ruler className="h-4 w-4" />} label="Sq ft" value={num(v.sqft)} />
            <Fact icon={<CalendarDays className="h-4 w-4" />} label="Built" value={String(v.yearBuilt)} />
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Value as of {date(v.asOf)} · Market model: {v.market.label} · Lot {v.lotAcres} acres
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <ChartCard title="Value trend" subtitle="Estimated value, last 24 months" height={280} table={{ head: ['Month', 'Value'], rows: v.trend.map((t) => [t.month, usd(t.value)]) }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={v.trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="month" {...axisProps} minTickGap={24} />
              <YAxis {...axisProps} width={64} tickFormatter={(x: number) => (Math.abs(x) >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : axisUsd(x))} domain={['auto', 'auto']} />
              <Tooltip content={<ChartTooltip format={(x) => usd(x)} />} />
              <Line type="monotone" dataKey="value" name="Estimated value" stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        <Card className="min-w-0">
          <CardHeader title="Comparable sales" subtitle="Recent nearby sales used by the model" />
          <DataTable
            dense
            head={['Address', 'Sold', 'Price', 'Sq ft', 'Bd/Ba', '$/sq ft', 'Distance']}
            rows={v.comps.map((c) => [c.address, date(c.soldDate, 'short'), usd(c.price), num(c.sqft), `${c.beds}/${c.baths}`, usd(c.pricePerSqft), `${c.distanceMi.toFixed(2)} mi`])}
          />
        </Card>
      </div>

      <TalkTrack>
        “Our model puts {addr} at about {usd(v.estimate)}, with a likely range of {usd(v.low)}–{usd(v.high)} ({v.confidenceLabel.toLowerCase()} confidence). Five nearby sales averaged {usd(Math.round(v.comps.reduce((a, c) => a + c.pricePerSqft, 0) / v.comps.length))}/sq ft — an appraisal will confirm the final number.”
      </TalkTrack>

      <ReportFooter note="MBEstimate is an automated estimate from demo data, not an appraisal." />
    </div>
  );
}

function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-base font-semibold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}
