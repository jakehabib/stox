'use client';

import clsx from 'clsx';
import { ArrowRight, Building2, CheckCircle2, Hammer, Loader2, MapPin, RotateCcw, TrendingUp, Users } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalculatorShell } from '@/components/calc/CalculatorShell';
import { ChartCard, ChartTooltip } from '@/components/calc/ChartCard';
import { ClientPicker } from '@/components/calc/ClientPicker';
import { LocationPicker } from '@/components/calc/LocationPicker';
import { CoBrandingEditor, ReportFooter } from '@/components/calc/ReportFooter';
import { ResultsHeader } from '@/components/calc/ResultsHeader';
import { TalkTrack } from '@/components/calc/TalkTrack';
import { Badge, Button, Card, CardHeader, DemoBadge, Field, Modal, NumberInput, Segmented } from '@/components/ui';
import { RERC_DEFAULT_LOCATION_ID } from '@/data/mock/locations';
import { geocode, getRercData, type ListingStats } from '@/data/mock/rerc';
import { homeownershipSplit, incomeVsNational, rercProjection, type RercAppreciationMode } from '@/lib/calculations/rerc';
import { axisProps, axisUsd, CHART, gridProps, SERIES } from '@/lib/chartTheme';
import { date, num, pct, usd, usdCompact } from '@/lib/format';
import { useStore } from '@/lib/store';
import { useUrlState } from '@/lib/useUrlState';

const TOOL = 'rerc';

interface RercState {
  step: 'input' | 'results';
  clientId: string | null;
  locationId: string | null;
  /** Price override for MARKET DATA; null = use the market median. */
  price: number | null;
  mode: RercAppreciationMode;
  cobrand: boolean;
}

const DEFAULTS: RercState = { step: 'input', clientId: null, locationId: RERC_DEFAULT_LOCATION_ID, price: null, mode: 'forecast', cobrand: false };

export function Rerc() {
  const [s, setS, hydrated] = useUrlState<RercState>(DEFAULTS);
  const set = (patch: Partial<RercState>) => setS((p) => ({ ...p, ...patch }));
  return (
    <CalculatorShell toolId={TOOL} demo subtitle="Local market snapshot — prices, forecast, inventory, demographics and affordability.">
      {s.step === 'results' && hydrated && s.locationId ? <Results s={s} set={set} reset={() => setS({ ...DEFAULTS, locationId: null })} /> : <StepOne s={s} set={set} />}
    </CalculatorShell>
  );
}

/* ------------------------------------------------------------------ Step 1 */

function StepOne({ s, set }: { s: RercState; set: (p: Partial<RercState>) => void }) {
  // Mock geocode: resolves shortly after a location is chosen. Next stays disabled until then.
  const [geocoded, setGeocoded] = useState<string | null>(s.locationId);
  useEffect(() => {
    if (!s.locationId) return setGeocoded(null);
    if (s.locationId === geocoded) return;
    setGeocoded(null);
    const t = setTimeout(() => setGeocoded(s.locationId), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.locationId]);
  const g = geocoded ? geocode(geocoded) : null;
  const ready = !!s.locationId && geocoded === s.locationId;

  return (
    <div className="mx-auto max-w-2xl">
      <Card className="p-6">
        <CardHeader title="Which market?" subtitle="Search a city, ZIP or county. The report uses the local median price — no price needed." />
        <div className="space-y-5">
          <ClientPicker value={s.clientId} onChange={(clientId) => set({ clientId })} required={false} />
          <div>
            <LocationPicker value={s.locationId} onChange={(locationId) => set({ locationId, price: null })} label="Location" />
            <div className="mt-2 min-h-[24px] text-xs">
              {s.locationId && !ready && (
                <span className="inline-flex items-center gap-1.5 text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Locating…
                </span>
              )}
              {ready && g && (
                <span className="inline-flex flex-wrap items-center gap-1.5 text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {g.label} · {g.county} · {g.lat.toFixed(4)}°, {g.lng.toFixed(4)}°
                  <button type="button" onClick={() => set({ locationId: null })} className="ml-1 font-medium text-slate-500 hover:text-slate-800">
                    Clear
                  </button>
                </span>
              )}
              {!s.locationId && <span className="text-slate-500">Select a location to continue.</span>}
            </div>
          </div>
          <Button size="lg" className="w-full" disabled={!ready} onClick={() => (set({ step: 'results' }), window.scrollTo({ top: 0 }))}>
            Next <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ Results */

type ModalKey = 'market' | 'location' | 'client' | 'cobrand' | null;

function Results({ s, set, reset }: { s: RercState; set: (p: Partial<RercState>) => void; reset: () => void }) {
  const { getClient, cobranding } = useStore();
  const [modal, setModal] = useState<ModalKey>(null);
  const [inv, setInv] = useState<'zip' | 'county'>('zip');
  const d = getRercData(s.locationId!);
  const client = getClient(s.clientId);
  const price = s.price ?? d.medianPrice;
  const proj = useMemo(() => rercProjection(d.forecastValues, price, s.mode, d.historical.y63), [d, price, s.mode]);
  const fc = useMemo(() => rercProjection(d.forecastValues, price, 'forecast', d.historical.y63), [d, price]);
  const h = homeownershipSplit(d.renters, d.rentersCanAfford, d.homeowners);
  const ageTotal = d.ageBuckets.reduce((a, b) => a + b.value, 0);
  const incomeDiff = incomeVsNational(d.medianIncome, d.nationalMedianIncome);
  const placeShort = d.areaName.replace(/,.*$/, '').replace(' Township', '');
  // Price target for the talk track: the client's saved scenario, else the shared $500k test scenario.
  const target = client?.saved?.price ?? 500000;

  const forecastData = proj.path.map((v, i) => ({ name: i === 0 ? 'Today' : `Yr ${i}`, value: Math.round(v) }));
  const invData = d.listingsSeries.map((r, i) => ({ name: r.month, value: inv === 'zip' ? r.zip : r.county, current: i === d.listingsSeries.length - 1 }));
  const modeLabel = s.mode === 'forecast' ? 'Forecasted' : `Historical ${pct(d.historical.y63, 2)}`;

  const csv = () => [
    ['Metric', 'Value'],
    ['Area', d.areaName],
    ['Median price', d.medianPrice],
    ['Median days on market', d.medianDaysOnMarket],
    ['Report price', price],
    [`5-yr ${modeLabel} cumulative $`, proj.cumulative],
    [`5-yr ${modeLabel} cumulative %`, proj.cumulativePct],
    ['Avg per year %', proj.avgPct],
    ['Historical 5yr %', d.historical.y5],
    ['Historical 10yr %', d.historical.y10],
    ['Historical 63yr %', d.historical.y63],
    [`Homes being built per year (${d.county})`, d.homesBuiltPerYear],
    [`Active listings ZIP ${d.zip}`, d.listings.zip.total],
    [`Active listings ${d.county} County`, d.listings.county.total],
    ['Renters (K)', d.renters],
    ['Renters who can afford (K)', d.rentersCanAfford],
    ['Homeowners (K)', d.homeowners],
    ['Median household income', d.medianIncome],
    ['National median income', d.nationalMedianIncome],
    ['Affordability index', d.affordabilityIndex],
    [],
    ['Month', `Listings ZIP ${d.zip}`, `Listings ${d.county} County`],
    ...d.listingsSeries.map((r) => [r.month, r.zip, r.county]),
  ];

  return (
    <div className="space-y-6">
      <ResultsHeader
        toolId={TOOL}
        scenarioTitle={`Real Estate Report Card · ${d.areaName}`}
        clientId={s.clientId}
        onBack={reset}
        backLabel="Create New"
        csv={csv}
        data={s}
        emailBody={`Here is the Real Estate Report Card for ${d.areaName}: median price ${usd(d.medianPrice)}, ${d.medianDaysOnMarket} median days on market, and a 5-year forecast of ${pct(fc.avgPct, 2, { sign: true })} per year.`}
        chips={[
          { label: 'Co-branding', value: s.cobrand ? cobranding.name : 'Not added', onEdit: () => setModal('cobrand'), editLabel: s.cobrand ? 'Edit' : 'Add' },
          { label: 'Market data', value: `${usd(price)} · ${modeLabel}`, onEdit: () => setModal('market') },
          { label: 'Location', value: d.areaName, onEdit: () => setModal('location') },
          { label: 'Client', value: client?.name ?? 'None', onEdit: () => setModal('client'), editLabel: client ? 'Edit' : 'Add' },
        ]}
      />

      {/* Hero */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-600">
              <MapPin className="h-3.5 w-3.5" /> Real Estate Report Card
            </div>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{d.areaName}</h2>
            <p className="text-sm text-slate-500">
              {d.county} County · Market data as of {date(d.asOf)}
              {client ? ` · Prepared for ${client.name}` : ''}
            </p>
          </div>
          <DemoBadge />
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Tile label="Median Price" value={usd(d.medianPrice)} sub={s.price !== null && s.price !== d.medianPrice ? `Report uses ${usd(price)}` : 'Median sale price'} />
          <Tile label="Median Days on Market" value={num(d.medianDaysOnMarket)} sub="Days from list to contract" />
          <Tile
            highlight
            label={`${s.mode === 'forecast' ? 'Forecasted' : 'Historical'} Appreciation · 5-yr`}
            value={<span className="text-gain">{pct(proj.avgPct, 2, { sign: true })} avg/yr</span>}
            sub={`Cumulative ${usd(proj.cumulative, { sign: true })} (${pct(proj.cumulativePct, 2)})`}
          />
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="text-xs font-medium text-slate-500">Historical Appreciation</div>
            <dl className="mt-2 space-y-1 text-sm">
              {[
                ['5 yr', d.historical.y5],
                ['10 yr', d.historical.y10],
                ['63 yr', d.historical.y63],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="font-semibold tabular-nums text-slate-900">{pct(v as number, 2)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Card>

      <ChartCard
        title={`${s.mode === 'forecast' ? 'Forecasted' : 'Historical-rate'} home value · next 5 years`}
        subtitle={`${usd(price)} today → ${usd(proj.end)} in 5 years (${pct(proj.cumulativePct, 2, { sign: true })})`}
        height={280}
        action={<Segmented size="sm" ariaLabel="Appreciation" value={s.mode} onChange={(mode) => set({ mode })} options={[{ value: 'forecast', label: 'Forecasted' }, { value: 'historical', label: 'Historical' }]} />}
        table={{ head: ['Year', 'Value', 'Change'], rows: proj.path.map((v, i) => [i === 0 ? 'Today' : `Year ${i}`, usd(v), i === 0 ? '—' : pct(((v - price) / (price || 1)) * 100, 2, { sign: true })]) }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={forecastData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="name" {...axisProps} />
            <YAxis {...axisProps} tickFormatter={axisUsd} width={60} domain={['auto', 'auto']} />
            <Tooltip content={<ChartTooltip format={(v) => usd(v)} />} />
            <Line type="monotone" dataKey="value" name="Home value" stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <div>
        <h3 className="mb-3 text-lg font-semibold text-slate-900">Supply & Demographics</h3>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="min-w-0">
            <CardHeader title="Active listings" subtitle="Inventory right now" />
            <ListingBlock title={`ZIP ${d.zip}`} l={d.listings.zip} />
            <div className="my-4 h-px bg-slate-100" />
            <ListingBlock title={`${d.county} County`} l={d.listings.county} />
            <div className="mt-4 flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-3">
              <Hammer className="h-5 w-5 text-slate-400" />
              <div>
                <div className="text-xs text-slate-500">Homes being built · {d.county}</div>
                <div className="text-lg font-semibold tabular-nums text-slate-900">{num(d.homesBuiltPerYear)}/yr</div>
              </div>
            </div>
          </Card>
          <ChartCard
            className="xl:col-span-2"
            title="Inventory trend"
            subtitle={`Active listings, last 13 months · ${inv === 'zip' ? `ZIP ${d.zip}` : `${d.county} County`}`}
            height={300}
            action={<Segmented size="sm" ariaLabel="Inventory area" value={inv} onChange={setInv} options={[{ value: 'zip', label: 'ZIP' }, { value: 'county', label: 'County' }]} />}
            table={{ head: ['Month', `ZIP ${d.zip}`, `${d.county} County`], rows: d.listingsSeries.map((r) => [r.month, num(r.zip), num(r.county)]) }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={invData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} interval="preserveStartEnd" minTickGap={8} />
                <YAxis {...axisProps} width={44} tickFormatter={(v: number) => num(v)} />
                <Tooltip cursor={{ fill: 'rgba(15,23,42,0.04)' }} content={<ChartTooltip format={(v) => `${num(v)} listings`} />} />
                <Bar dataKey="value" name="Active listings" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false}>
                  {invData.map((r) => (
                    <Cell key={r.name} fill={SERIES[0]} fillOpacity={r.current ? 1 : 0.5} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ChartCard
          title="Demographics by age"
          subtitle={`${d.county} County · total ${ageTotal.toFixed(1)}K people`}
          height={280}
          table={{ head: ['Age', 'People'], rows: d.ageBuckets.map((a) => [a.label, `${a.value.toFixed(1)}K`]) }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={d.ageBuckets} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} interval={0} tick={{ ...axisProps.tick, fontSize: 11 }} />
              <YAxis {...axisProps} width={44} tickFormatter={(v: number) => `${v}K`} />
              <Tooltip cursor={{ fill: 'rgba(15,23,42,0.04)' }} content={<ChartTooltip format={(v) => `${v.toFixed(1)}K`} />} />
              <Bar dataKey="value" name="People" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <Card className="min-w-0">
          <CardHeader title="Homeowners & renters" subtitle={`${d.county} County · ${h.total.toFixed(1)}K people`} />
          <div className="flex h-8 w-full gap-0.5 overflow-hidden rounded-md" role="img" aria-label="Homeowners and renters split">
            <div style={{ width: `${h.rentersCantAffordPct}%`, background: SERIES[1] }} />
            <div style={{ width: `${h.canAffordPct}%`, background: SERIES[2] }} />
            <div style={{ width: `${h.ownersPct}%`, background: SERIES[0] }} />
          </div>
          <ul className="mt-5 space-y-3">
            <SplitRow color={SERIES[1]} icon={<Users className="h-4 w-4" />} label="Renters" value={`${d.renters.toFixed(1)}K`} share={`${Math.round(h.rentersCantAffordPct)}%`} note={`${h.rentersCantAfford.toFixed(1)}K can’t yet afford to buy`} />
            <SplitRow color={SERIES[2]} icon={<TrendingUp className="h-4 w-4" />} label="Renters who can afford to purchase" value={`${d.rentersCanAfford.toFixed(1)}K`} share={`${Math.floor(h.canAffordPct)}%`} note="Your prospective buyers" />
            <SplitRow color={SERIES[0]} icon={<Building2 className="h-4 w-4" />} label="Homeowners" value={`${d.homeowners.toFixed(1)}K`} share={`${Math.round(h.ownersPct)}%`} />
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader title={`Affordability in ${d.county}`} subtitle="Can a median-income household buy the median home?" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <div className="text-xs font-medium text-slate-500">Median household income</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">{usd(d.medianIncome)}</div>
            <div className="mt-0.5 text-sm text-slate-500">
              {pct(Math.abs(incomeDiff), 0)} {incomeDiff >= 0 ? 'above' : 'below'} the national median of {usd(d.nationalMedianIncome)}
            </div>
            <div className="mt-4 space-y-2">
              <IncomeBar label={`${d.county} County`} value={d.medianIncome} max={Math.max(d.medianIncome, d.nationalMedianIncome)} color={SERIES[0]} />
              <IncomeBar label="National" value={d.nationalMedianIncome} max={Math.max(d.medianIncome, d.nationalMedianIncome)} color={CHART.neutral} />
            </div>
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <div className="text-xs font-medium text-slate-500">Affordability Index</div>
              <Badge tone={d.affordabilityIndex >= 100 ? 'green' : 'amber'}>{d.affordabilityIndex >= 100 ? 'Affordable' : 'Just short'}</Badge>
            </div>
            <div className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">{d.affordabilityIndex}</div>
            <AffordMeter value={d.affordabilityIndex} />
            <p className="mt-3 text-sm text-slate-600">At 100, a median-income household can afford the median-priced home with 20% down. Above 100 means more buying power than needed; below 100 means the median household falls short.</p>
          </div>
        </div>
      </Card>

      <TalkTrack>
        “{placeShort} median is {usd(d.medianPrice)}
        {target ? ` — ${target < d.medianPrice ? 'well above' : 'below'} your ${usdCompact(target)} target, so your price point is ${target < d.medianPrice ? 'below' : 'above'} median` : ''}. Inventory {d.listings.zip.yoyPct >= 0 ? 'up' : 'down'} {Math.abs(d.listings.zip.yoyPct)}% Y/Y, 5-yr forecast {pct(fc.avgPct, 2, { sign: true })}/yr. Affordability {d.affordabilityIndex} means median household is{' '}
        {d.affordabilityIndex >= 100 ? 'able to buy the median home' : d.affordabilityIndex >= 85 ? 'just short' : 'well short'}
        {target ? ' — your 20% down puts you stronger.' : '.'}”
      </TalkTrack>

      <ReportFooter note="Market data: demo dataset (median price, listings, demographics, income). Forecast is not guaranteed." />

      <MarketDataModal open={modal === 'market'} onClose={() => setModal(null)} median={d.medianPrice} price={price} mode={s.mode} onSave={(p, mode) => set({ price: p === d.medianPrice ? null : p, mode })} />
      <LocationModal open={modal === 'location'} onClose={() => setModal(null)} value={s.locationId!} onSave={(locationId) => set({ locationId, price: null })} />
      <ClientModal open={modal === 'client'} onClose={() => setModal(null)} value={s.clientId} onSave={(clientId) => set({ clientId })} />
      <CoBrandingEditor open={modal === 'cobrand'} onClose={() => (setModal(null), set({ cobrand: true }))} />
    </div>
  );
}

function Tile({ label, value, sub, highlight }: { label: string; value: ReactNode; sub?: ReactNode; highlight?: boolean }) {
  return (
    <div className={clsx('rounded-xl border p-4', highlight ? 'border-brand-200 bg-brand-50/60' : 'border-slate-200')}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function ListingBlock({ title, l }: { title: string; l: ListingStats }) {
  const chg = (v: number) => <span className={v >= 0 ? 'text-gain' : 'text-loss'}>{pct(v, 0, { sign: true })}</span>;
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</div>
      <div className="mt-2 grid grid-cols-4 gap-2 text-sm">
        <div>
          <div className="text-[11px] text-slate-500">Total</div>
          <div className="text-lg font-semibold tabular-nums text-slate-900">{num(l.total)}</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">M/M</div>
          <div className="text-lg font-semibold tabular-nums">{chg(l.momPct)}</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Y/Y</div>
          <div className="text-lg font-semibold tabular-nums">{chg(l.yoyPct)}</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">New (5 days)</div>
          <div className="text-lg font-semibold tabular-nums text-slate-900">{num(l.newLast5Days)}</div>
        </div>
      </div>
    </div>
  );
}

function SplitRow({ color, icon, label, value, share, note }: { color: string; icon: ReactNode; label: string; value: string; share: string; note?: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: color }} />
      <span className="text-slate-400">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-800">{label}</div>
        {note && <div className="text-xs text-slate-500">{note}</div>}
      </div>
      <div className="text-right">
        <div className="text-sm font-semibold tabular-nums text-slate-900">{value}</div>
        <div className="text-xs tabular-nums text-slate-500">{share}</div>
      </div>
    </li>
  );
}

function IncomeBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold tabular-nums text-slate-900">{usd(value)}</span>
      </div>
      <div className="h-2.5 rounded-full bg-slate-100">
        <div className="h-2.5 rounded-full" style={{ width: `${max > 0 ? (value / max) * 100 : 0}%`, background: color }} />
      </div>
    </div>
  );
}

function AffordMeter({ value }: { value: number }) {
  const max = 150;
  const pos = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="mt-3">
      <div className="relative h-2.5 rounded-full bg-slate-100">
        <div className="h-2.5 rounded-full" style={{ width: `${pos}%`, background: SERIES[0] }} />
        <div className="absolute -top-1 h-4.5 w-0.5 bg-slate-500" style={{ left: `${(100 / max) * 100}%`, height: 18 }} />
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-slate-500">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${(100 / max) * 100}%` }}>
          100 = affordable
        </span>
        <span className="absolute right-0">{max}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ edit modals */

function MarketDataModal({ open, onClose, median, price, mode, onSave }: { open: boolean; onClose: () => void; median: number; price: number; mode: RercAppreciationMode; onSave: (price: number, mode: RercAppreciationMode) => void }) {
  const [p, setP] = useState(price);
  const [m, setM] = useState(mode);
  useEffect(() => {
    if (open) (setP(price), setM(mode));
  }, [open, price, mode]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Market data"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => (onSave(p, m), onClose())}>Save</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Price"
          hint={`Market median ${usd(median)}`}
          right={
            p !== median && (
              <button type="button" onClick={() => setP(median)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                <RotateCcw className="h-3 w-3" /> Reset to median
              </button>
            )
          }
        >
          <NumberInput ariaLabel="Price" prefix="$" decimals={0} value={p} onChange={setP} />
        </Field>
        <Field label="Appreciation">
          <Segmented ariaLabel="Appreciation" value={m} onChange={setM} options={[{ value: 'forecast', label: 'Forecasted' }, { value: 'historical', label: 'Historical' }]} />
        </Field>
      </div>
    </Modal>
  );
}

function LocationModal({ open, onClose, value, onSave }: { open: boolean; onClose: () => void; value: string; onSave: (id: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (open) setV(value);
  }, [open, value]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Location"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => (onSave(v), onClose())}>Save</Button>
        </>
      }
    >
      <LocationPicker value={v} onChange={setV} />
    </Modal>
  );
}

function ClientModal({ open, onClose, value, onSave }: { open: boolean; onClose: () => void; value: string | null; onSave: (id: string | null) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (open) setV(value);
  }, [open, value]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Client"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => (onSave(v), onClose())}>Save</Button>
        </>
      }
    >
      <ClientPicker value={v} onChange={setV} required={false} />
    </Modal>
  );
}
