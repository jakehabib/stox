'use client';

import clsx from 'clsx';
import { ArrowRight, Home, KeyRound, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalculatorShell } from '@/components/calc/CalculatorShell';
import { ChartCard, ChartTooltip } from '@/components/calc/ChartCard';
import { ClientPicker, requireClient } from '@/components/calc/ClientPicker';
import { LocationPicker } from '@/components/calc/LocationPicker';
import { ReportFooter } from '@/components/calc/ReportFooter';
import { ResultsHeader } from '@/components/calc/ResultsHeader';
import { Stepper } from '@/components/calc/Stepper';
import { TalkTrack } from '@/components/calc/TalkTrack';
import { Badge, Button, Card, CardHeader, Field, NumberInput, Segmented, Slider } from '@/components/ui';
import { stateIncomeTaxPct } from '@/data/mock/buyVsRent';
import { getLocation } from '@/data/mock/locations';
import { displayedRate } from '@/lib/calculations/appreciation';
import { calcBuyVsRent, MAX_YEARS, priceForMonthlyPayment, rescaleForPrice, type BuyVsRentYear } from '@/lib/calculations/buyVsRent';
import { countyTaxAnnual } from '@/lib/calculations/property';
import { axisProps, axisUsd, CHART, gridProps, SERIES } from '@/lib/chartTheme';
import { pct, usd, usdCompact } from '@/lib/format';
import { useStore } from '@/lib/store';
import { useUrlState } from '@/lib/useUrlState';
import { BahLookupModal, ClientEditModal, LoanEditModal, PropertyEditModal, RentEditModal, TaxEditModal } from './BvrModals';
import { BVR_DEFAULTS, type BvrMode, type BvrState } from './state';

const TOOL = 'buy-vs-rent';

export function BuyVsRent() {
  const [s, setS, hydrated] = useUrlState<BvrState>(BVR_DEFAULTS);
  const set = (patch: Partial<BvrState>) => setS((p) => ({ ...p, ...patch }));
  return (
    <CalculatorShell toolId={TOOL} subtitle="Compare the wealth built by owning against renting, year by year.">
      {s.step === 'input' || !hydrated ? <StepOne s={s} set={set} setS={setS} /> : <Results s={s} set={set} />}
    </CalculatorShell>
  );
}

/* ------------------------------------------------------------------ Step 1 */

function backSolveArgs(s: BvrState) {
  return {
    ltvPct: s.price > 0 ? (s.loanAmount / s.price) * 100 : 80,
    ratePct: s.ratePct,
    termYears: s.termYears,
    taxRatePct: s.price > 0 ? (s.taxAnnual / s.price) * 100 : getLocation(s.locationId).taxRatePct,
    repairsPctPerYear: s.price > 0 ? ((s.repairsMonthly * 12) / s.price) * 100 : 0.5,
    insuranceMonthly: s.insuranceMonthly,
    hoaMonthly: s.hoaMonthly,
    miMonthly: s.miMonthly,
  };
}

function StepOne({ s, set, setS }: { s: BvrState; set: (p: Partial<BvrState>) => void; setS: (fn: (p: BvrState) => BvrState) => void }) {
  const [clientErr, setClientErr] = useState<string | null>(null);
  const [priceErr, setPriceErr] = useState<string | null>(null);
  const [bahOpen, setBahOpen] = useState(false);
  const target = s.mode === 'payment' ? s.desiredPayment : s.mode === 'bah' ? s.bahMonthly : 0;
  const solved = s.mode === 'price' ? s.price : priceForMonthlyPayment(target, backSolveArgs(s));

  const next = () => {
    const ce = requireClient(s.clientId);
    setClientErr(ce);
    const pe = solved > 0 ? null : s.mode === 'price' ? 'Enter a purchase value' : 'Payment is too low to support a purchase — increase it';
    setPriceErr(pe);
    if (ce || pe) return;
    setS((p) => ({ ...(p.mode === 'price' ? p : rescaleForPrice(p, solved)), appraisedValue: p.useAppraised ? p.appraisedValue : solved, step: 'results' }));
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Stepper steps={['Property', 'Results']} current={0} className="mb-4" />
      <Card className="p-6">
        <CardHeader title="What are we comparing?" subtitle="Start from a price, a monthly payment target, or a military housing allowance." />
        <div className="space-y-5">
          <Segmented<BvrMode>
            ariaLabel="Mode"
            className="flex w-full [&>button]:flex-1"
            value={s.mode}
            onChange={(mode) => set({ mode })}
            options={[
              { value: 'price', label: 'Purchase Price' },
              { value: 'payment', label: 'Desired Monthly Payment' },
              { value: 'bah', label: 'Military BAH' },
            ]}
          />
          <ClientPicker value={s.clientId} onChange={(clientId) => (set({ clientId }), clientId && setClientErr(null))} error={clientErr} />
          <LocationPicker
            value={s.locationId}
            onChange={(id) => {
              if (id === s.locationId) return;
              const l = getLocation(id);
              set({ locationId: id, taxAnnual: countyTaxAnnual(id, s.price), insuranceMonthly: l.insuranceMonthly, statePct: stateIncomeTaxPct(l.state) });
            }}
          />
          {s.mode === 'price' && (
            <Field label="Purchase Value" error={priceErr ?? undefined}>
              <NumberInput ariaLabel="Purchase Value" prefix="$" decimals={0} invalid={!!priceErr} value={s.price} onChange={(price) => (setS((p) => rescaleForPrice(p, price)), price > 0 && setPriceErr(null))} />
            </Field>
          )}
          {s.mode === 'payment' && (
            <Field label="Desired Monthly Payment" hint="Total housing payment: P&I + tax + insurance + repairs + HOA" error={priceErr ?? undefined}>
              <NumberInput ariaLabel="Desired Monthly Payment" prefix="$" suffix="/mo" decimals={0} value={s.desiredPayment} onChange={(desiredPayment) => (set({ desiredPayment }), setPriceErr(null))} />
            </Field>
          )}
          {s.mode === 'bah' && (
            <Field
              label="Monthly Allowance"
              hint="Housing allowance used as the monthly payment target"
              error={priceErr ?? undefined}
              right={
                <button type="button" onClick={() => setBahOpen(true)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                  <Search className="h-3 w-3" /> Find allowance
                </button>
              }
            >
              <NumberInput ariaLabel="Monthly Allowance" prefix="$" suffix="/mo" decimals={0} value={s.bahMonthly} onChange={(bahMonthly) => (set({ bahMonthly }), setPriceErr(null))} />
            </Field>
          )}
          {s.mode !== 'price' && (
            <div className="rounded-lg border border-brand-100 bg-brand-50/60 px-4 py-3">
              <div className="text-xs font-medium text-slate-500">Supports a purchase price of</div>
              <div className="text-2xl font-semibold tabular-nums text-slate-900">{usd(solved)}</div>
              <div className="mt-0.5 text-xs text-slate-500">
                {pct(backSolveArgs(s).ltvPct, 0)} LTV at {pct(s.ratePct, 3)} / {s.termYears}yr, tax {pct(backSolveArgs(s).taxRatePct, 2)}, insurance {usd(s.insuranceMonthly)}/mo
              </div>
            </div>
          )}
          <Button size="lg" className="w-full" onClick={next}>
            Next <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </Card>
      <BahLookupModal open={bahOpen} onClose={() => setBahOpen(false)} onUse={(bahMonthly) => set({ bahMonthly })} />
    </div>
  );
}

/* ------------------------------------------------------------------ Results */

type ModalKey = 'client' | 'property' | 'rent' | 'loan' | 'tax' | null;

function Results({ s, set }: { s: BvrState; set: (p: Partial<BvrState>) => void }) {
  const { getClient, saveScenario, ready } = useStore();
  const [modal, setModal] = useState<ModalKey>(null);
  const client = getClient(s.clientId);
  const loc = getLocation(s.locationId);
  const res = useMemo(() => calcBuyVsRent({ ...s, startValue: s.useAppraised ? s.appraisedValue : s.price }), [s]);
  const year = Math.min(MAX_YEARS, Math.max(1, Math.round(s.year) || MAX_YEARS));
  const y = res.years[year - 1];
  const y1 = res.years[0];
  const apprRate = displayedRate(loc, s.appreciation);
  const apprLabel = s.appreciation.mode === 'custom' ? `Custom ${pct(apprRate, 3)}/yr` : s.appreciation.mode === 'historical' ? `Historical ${pct(apprRate, 3)}/yr` : `Forecast ${pct(apprRate, 3)}/yr`;

  // Auto-save once when results first show for this scenario.
  const saved = useRef(false);
  useEffect(() => {
    if (!ready || saved.current) return;
    saved.current = true;
    saveScenario({
      toolId: TOOL,
      title: `Buy vs Rent · ${usdCompact(s.price)} ${loc.label}`,
      clientId: s.clientId ?? undefined,
      clientName: client?.name,
      href: window.location.pathname + window.location.search,
      data: s,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const rows: { label: string; sub?: string; value: number }[] = [
    { label: 'Appreciation gain', sub: `${apprLabel} · Est. value ${usd(y.value)}`, value: y.appreciationGain },
    { label: 'Purchase closing costs', sub: s.pointsPct > 0 ? `Includes ${pct(s.pointsPct, 3)} points` : undefined, value: -y.closing },
    { label: 'Tax benefit', sub: s.includeTaxBenefit ? `${s.federalPct}% federal${s.statePct ? ` + ${pct(s.statePct, 2)} state` : ''} above ${usd(s.standardDeduction)} deduction` : 'Excluded', value: y.cumTaxBenefit },
    { label: 'Amortization (principal paid)', sub: `Remaining balance ${usd(y.balance)}`, value: y.principalPaid },
    { label: 'Cashflow difference', sub: `Renting ${usd(y.cumRenting)} − Buying ${usd(y.cumBuying)}`, value: y.cashflowDiff },
    { label: `Cost to sell (${pct(s.costToSellPct, 2)})`, sub: `Of ${usd(y.value)} sale value`, value: -y.costToSell },
  ];

  const chartData = res.years.map((r) => ({ name: `Yr ${r.year}`, year: r.year, netGain: Math.round(r.netGain) }));
  const monthlyData = res.years.map((r) => ({ name: `Yr ${r.year}`, buying: r.buyMonthly, renting: r.rentMonthly }));

  const drivers = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 2).map((r) => r.label.toLowerCase().replace(' (principal paid)', '').replace('amortization', 'principal').replace(' gain', ''));
  const buy1Diff = y1.buyMonthly - y1.rentMonthly;

  const csv = () => [
    ['Year', 'Est. value', 'Appreciation gain', 'Closing', 'Cumulative tax benefit', 'Principal paid', 'Balance', 'Buying /mo', 'Renting /mo', 'Total buying', 'Total renting', 'Cashflow diff', 'Cost to sell', 'Net gain'],
    ...res.years.map((r) => [r.year, r.value, r.appreciationGain, -r.closing, r.cumTaxBenefit, r.principalPaid, r.balance, r.buyMonthly, r.rentMonthly, r.cumBuying, r.cumRenting, r.cashflowDiff, -r.costToSell, r.netGain]),
  ];

  const ahead = y.netGain >= 0;

  return (
    <div className="space-y-6">
      <ResultsHeader
        toolId={TOOL}
        scenarioTitle={`Buy vs Rent · ${usdCompact(s.price)} ${loc.label}`}
        clientId={s.clientId}
        onBack={() => set({ step: 'input' })}
        autoSaved
        csv={csv}
        data={s}
        emailBody={`Hi ${client?.name.split(' ')[0] ?? 'there'},\n\nHere is your Buy vs Rent comparison for a ${usd(s.price)} home in ${loc.label}. By year ${year}, buying puts you ${usd(y.netGain)} ${ahead ? 'ahead of' : 'behind'} renting.`}
        chips={[
          { label: 'Client', value: client?.name ?? '—', onEdit: () => setModal('client') },
          { label: 'Property', value: `${usdCompact(s.price)} · ${loc.label}`, onEdit: () => setModal('property') },
          { label: 'Renting', value: `${usd(s.rentMonthly)}/mo`, onEdit: () => setModal('rent') },
          { label: 'Loan', value: `${usdCompact(s.loanAmount)} · ${s.termYears}yr · ${pct(s.ratePct, 3)}`, onEdit: () => setModal('loan') },
          { label: 'Tax', value: s.includeTaxBenefit ? `${usd(s.standardDeduction)} std. deduction` : 'Benefit excluded', onEdit: () => setModal('tax') },
        ]}
      />

      {/* Hero */}
      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-slate-500">Net gain from buying vs renting · Year {year}</span>
              {res.breakEvenYear ? <Badge tone="green">Break-even during Year {res.breakEvenYear}</Badge> : <Badge tone="amber">No break-even within {MAX_YEARS} years</Badge>}
            </div>
            <div className={clsx('mt-2 text-5xl font-bold tabular-nums tracking-tight', ahead ? 'text-gain' : 'text-loss')}>{usd(y.netGain, { sign: true })}</div>
            <p className="mt-2 max-w-xl text-sm text-slate-600">
              {client ? `${client.name.split(' ')[0]}, by` : 'By'} year {year} buying a {usd(s.price)} home in {loc.city} puts you {usd(Math.abs(y.netGain))} {ahead ? 'ahead of' : 'behind'} renting at {usd(s.rentMonthly)}/mo — after closing costs and the cost to sell.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat icon={<Home className="h-4 w-4" />} label="Buying today" value={`${usd(y1.buyMonthly)}/mo`} />
              <MiniStat icon={<KeyRound className="h-4 w-4" />} label="Renting today" value={`${usd(y1.rentMonthly)}/mo`} />
              <MiniStat label={`Total buying · ${year}yr`} value={usd(y.cumBuying)} />
              <MiniStat label={`Total renting · ${year}yr`} value={usd(y.cumRenting)} />
            </div>
          </div>
          <div className="border-t border-slate-100 bg-slate-50/70 p-6 lg:border-l lg:border-t-0">
            <Slider label="How many years?" min={1} max={MAX_YEARS} value={year} onChange={(v) => set({ year: v })} format={(v) => `${v} year${v === 1 ? '' : 's'}`} />
            <dl className="mt-5 space-y-2 text-sm">
              <Row k="Est. home value" v={usd(y.value)} />
              <Row k="Equity (value − balance)" v={usd(y.value - y.balance)} />
              <Row k="Remaining balance" v={usd(y.balance)} />
              <Row k="Down payment" v={usd(res.downPayment)} />
            </dl>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader title={`Year ${year} breakdown`} subtitle="How the net gain adds up" />
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.label} className="flex items-start justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800">{r.label}</div>
                  {r.sub && <div className="text-xs text-slate-500">{r.sub}</div>}
                </div>
                <div className={clsx('shrink-0 text-sm font-semibold tabular-nums', Math.round(r.value) > 0 ? 'text-gain' : Math.round(r.value) < 0 ? 'text-loss' : 'text-slate-900')}>{usd(r.value, { sign: true })}</div>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-3">
            <span className="text-sm font-semibold text-slate-900">Net gain · Year {year}</span>
            <span className={clsx('text-lg font-bold tabular-nums', ahead ? 'text-gain' : 'text-loss')}>{usd(y.netGain, { sign: true })}</span>
          </div>
        </Card>

        <ChartCard
          title="Net gain by year"
          subtitle="Buying vs renting — click a bar to see that year"
          height={320}
          table={{ head: ['Year', 'Net gain'], rows: res.years.map((r) => [`Year ${r.year}`, usd(r.netGain)]) }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} onClick={(e) => e?.activePayload?.[0] && set({ year: (e.activePayload[0].payload as { year: number }).year })}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="name" {...axisProps} />
              <YAxis {...axisProps} tickFormatter={axisUsd} width={56} />
              <ReferenceLine y={0} stroke={CHART.axis} />
              <Tooltip cursor={{ fill: 'rgba(15,23,42,0.04)' }} content={<ChartTooltip format={(v) => usd(v)} />} />
              <Bar dataKey="netGain" name="Net gain" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} className="cursor-pointer">
                {chartData.map((d) => (
                  <Cell key={d.year} fill={d.netGain < 0 ? CHART.loss : CHART.gain} fillOpacity={d.year === year ? 1 : 0.45} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <MonthlyTable years={res.years} selected={year} onSelect={(v) => set({ year: v })} />
        <ChartCard
          title="Monthly cost"
          subtitle="Buying vs renting each year"
          height={260}
          legend={[
            { label: 'Buying', color: SERIES[0] },
            { label: 'Renting', color: SERIES[1] },
          ]}
          table={{ head: ['Year', 'Buying', 'Renting'], rows: res.years.map((r) => [`Year ${r.year}`, usd(r.buyMonthly), usd(r.rentMonthly)]) }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthlyData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="name" {...axisProps} />
              <YAxis {...axisProps} tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}K`} width={52} domain={['auto', 'auto']} />
              <Tooltip content={<ChartTooltip format={(v) => `${usd(v)}/mo`} />} />
              <Line type="monotone" dataKey="buying" name="Buying" stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="renting" name="Renting" stroke={SERIES[1]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <TalkTrack>
        “Year 1 buying costs {usd(Math.abs(buy1Diff))} {buy1Diff >= 0 ? 'more' : 'less'} monthly
        {res.breakEvenYear ? `, but by Year ${res.breakEvenYear} you break even` : `, and at these numbers buying doesn’t break even within ${MAX_YEARS} years`} — by Year {year} you’re {usd(Math.abs(y.netGain))} {ahead ? 'ahead' : 'behind'}
        {ahead && drivers.length ? `, mostly ${drivers.join(' + ')}` : ''}. Renting {year}yr costs {usd(y.cumRenting)} with nothing to show.”
      </TalkTrack>

      <ReportFooter note="Buy vs Rent assumes the home is sold at the end of the selected year; tax benefit uses the standard deduction and your marginal rate." />

      <ClientEditModal open={modal === 'client'} onClose={() => setModal(null)} value={s} onSave={set} />
      <PropertyEditModal open={modal === 'property'} onClose={() => setModal(null)} value={s} onSave={set} />
      <RentEditModal open={modal === 'rent'} onClose={() => setModal(null)} value={s} onSave={set} />
      <LoanEditModal open={modal === 'loan'} onClose={() => setModal(null)} value={s} onSave={set} />
      <TaxEditModal open={modal === 'tax'} onClose={() => setModal(null)} value={s} onSave={set} />
    </div>
  );
}

function MiniStat({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-base font-semibold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{k}</dt>
      <dd className="font-semibold tabular-nums text-slate-900">{v}</dd>
    </div>
  );
}

function MonthlyTable({ years, selected, onSelect }: { years: BuyVsRentYear[]; selected: number; onSelect: (y: number) => void }) {
  const R = Math.round;
  return (
    <Card className="min-w-0">
      <CardHeader title="Monthly cost comparison" subtitle="Principal + interest + tax/insurance/maintenance vs rent + renters insurance" />
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-500">
              <th className="px-2 py-2 text-left font-semibold">Year</th>
              <th className="px-2 py-2 text-right font-semibold">Principal</th>
              <th className="px-2 py-2 text-right font-semibold">Interest</th>
              <th className="px-2 py-2 text-right font-semibold">Tax/Ins/Maint</th>
              <th className="px-2 py-2 text-right font-semibold text-slate-700">Buying</th>
              <th className="px-2 py-2 text-right font-semibold">Rent</th>
              <th className="px-2 py-2 text-right font-semibold">Renters ins.</th>
              <th className="px-2 py-2 text-right font-semibold text-slate-700">Renting</th>
              <th className="px-2 py-2 text-right font-semibold">Difference</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => {
              const diff = y.buyMonthly - y.rentMonthly;
              return (
                <tr key={y.year} onClick={() => onSelect(y.year)} className={clsx('cursor-pointer border-b border-slate-100 tabular-nums last:border-b-0', y.year === selected ? 'bg-brand-50/70' : 'hover:bg-slate-50')}>
                  <td className="px-2 py-2 font-medium text-slate-800">Yr {y.year}</td>
                  <td className="px-2 py-2 text-right text-slate-700">{usd(R(y.principalMonthly))}</td>
                  <td className="px-2 py-2 text-right text-slate-700">{usd(R(y.interestMonthly))}</td>
                  <td className="px-2 py-2 text-right text-slate-700" title={`Tax ${usd(y.taxMonthly)} + ins/repairs/HOA/MI ${usd(y.otherMonthly - y.taxMonthly)}`}>
                    {usd(R(y.otherMonthly))}
                  </td>
                  <td className="px-2 py-2 text-right font-semibold text-slate-900">{usd(y.buyMonthly)}</td>
                  <td className="px-2 py-2 text-right text-slate-700">{usd(R(y.rentOnlyMonthly))}</td>
                  <td className="px-2 py-2 text-right text-slate-700">{usd(R(y.rentersInsMonthly))}</td>
                  <td className="px-2 py-2 text-right font-semibold text-slate-900">{usd(y.rentMonthly)}</td>
                  <td className={clsx('px-2 py-2 text-right font-medium', diff > 0 ? 'text-loss' : 'text-gain')}>{usd(diff, { sign: true })}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 font-semibold tabular-nums">
              <td className="px-2 py-2.5 text-slate-900" colSpan={4}>
                Total over {years.length} yrs
              </td>
              <td className="px-2 py-2.5 text-right text-slate-900">{usd(years[years.length - 1].cumBuying)}</td>
              <td className="px-2 py-2.5" colSpan={2} />
              <td className="px-2 py-2.5 text-right text-slate-900">{usd(years[years.length - 1].cumRenting)}</td>
              <td className={clsx('px-2 py-2.5 text-right', years[years.length - 1].cashflowDiff < 0 ? 'text-loss' : 'text-gain')}>{usd(years[years.length - 1].cashflowDiff, { sign: true })}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
