'use client';

import { useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalculatorShell } from '@/components/calc/CalculatorShell';
import { ChartCard, ChartTooltip } from '@/components/calc/ChartCard';
import { ClientPicker } from '@/components/calc/ClientPicker';
import { LocationPicker } from '@/components/calc/LocationPicker';
import { ReportFooter } from '@/components/calc/ReportFooter';
import { ResultsHeader } from '@/components/calc/ResultsHeader';
import { TalkTrack } from '@/components/calc/TalkTrack';
import { ClientEditModal, CustomRateInput, ModeOption, ToolFormCard } from '@/components/tools/appreciation/shared';
import { Button, Card, Field, Modal, NumberInput, SectionLabel, Select, Slider, cx } from '@/components/ui';
import { getLocation } from '@/data/mock/locations';
import { displayedRate, type AppreciationMode } from '@/lib/calculations/appreciation';
import { equityChart, equityResult, validateEquity } from '@/lib/calculations/equityGained';
import { CHART, SERIES, axisProps, axisUsd, gridProps } from '@/lib/chartTheme';
import { pct, usd } from '@/lib/format';
import { useStore } from '@/lib/store';
import { useUrlState } from '@/lib/useUrlState';

const TOOL = 'equity-gained';
const MODE_LABEL: Record<AppreciationMode, string> = { forecast: 'Forecast', historical: 'Historical', custom: 'Custom' };
const PROGRAMS = ['Conventional', 'FHA', 'VA', 'USDA', 'Jumbo'] as const;
const TERMS = ['30', '25', '20', '15', '10'] as const;
const C_VALUE = SERIES[0];
const C_BALANCE = SERIES[1];
const C_EQUITY = SERIES[2];

interface State {
  step: 'form' | 'results';
  clientId: string | null;
  locationId: string;
  price: number;
  mode: AppreciationMode;
  customPct: number;
  loanAmount: number;
  termYears: number;
  program: (typeof PROGRAMS)[number];
  ratePct: number;
  years: number;
}

const DEFAULTS: State = {
  step: 'form',
  clientId: 'c-alex-rivera',
  locationId: 'dallas-tx-75201',
  price: 500000,
  mode: 'forecast',
  customPct: 4,
  loanAmount: 400000,
  termYears: 30,
  program: 'Conventional',
  ratePct: 6.5,
  years: 15,
};

export function EquityGainedTool() {
  const [s, setS] = useUrlState<State>(DEFAULTS);
  const set = (patch: Partial<State>) => setS((p) => ({ ...p, ...patch }));
  const { getClient } = useStore();
  const [tried, setTried] = useState(false);
  const [modal, setModal] = useState<null | 'client' | 'property' | 'loan'>(null);

  const loc = getLocation(s.locationId);
  const errors = validateEquity(s);
  const shown = tried ? errors : {};
  const hasErrors = Object.keys(errors).length > 0;

  const input = { price: s.price, locationId: s.locationId, mode: s.mode, customPct: s.customPct, loanAmount: s.loanAmount, ratePct: s.ratePct, termYears: s.termYears, years: s.years };
  const r = useMemo(() => equityResult(input), [JSON.stringify(input)]); // eslint-disable-line react-hooks/exhaustive-deps
  const pts = useMemo(() => equityChart(input), [JSON.stringify(input)]); // eslint-disable-line react-hooks/exhaustive-deps
  const chartRows = useMemo(() => pts.map((p) => ({ ...p, _base: p.loanBalance })), [pts]);
  const client = getClient(s.clientId);

  const calculate = () => {
    setTried(true);
    if (!hasErrors) {
      set({ step: 'results' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const propertyFields = (
    <div className="grid gap-4 sm:grid-cols-2">
      <LocationPicker value={s.locationId} onChange={(locationId) => set({ locationId })} />
      <Field label="Price" error={shown.price}>
        <NumberInput ariaLabel="Price" prefix="$" decimals={0} min={0} value={s.price} invalid={!!shown.price} onChange={(price) => set({ price })} />
      </Field>
    </div>
  );

  const modeFields = (
    <div>
      <div className="mb-2 text-[13px] font-medium text-slate-700">Appreciation</div>
      <div className="grid gap-2 sm:grid-cols-3">
        {(['forecast', 'historical', 'custom'] as AppreciationMode[]).map((m) => (
          <ModeOption
            key={m}
            type="radio"
            name="equity-appreciation"
            checked={s.mode === m}
            onChange={() => set({ mode: m })}
            title={MODE_LABEL[m]}
            rate={m === 'custom' ? undefined : pct(displayedRate(loc, { mode: m }), 3)}
            hint={m === 'forecast' ? 'Local forecast curve' : m === 'historical' ? 'Long-run local average' : 'Your own annual rate'}
          >
            {m === 'custom' && s.mode === 'custom' ? <CustomRateInput value={s.customPct} onChange={(customPct) => set({ customPct })} invalid={!!shown.customPct} /> : null}
          </ModeOption>
        ))}
      </div>
      {shown.customPct && <p className="mt-1 text-xs font-medium text-red-600">{shown.customPct}</p>}
    </div>
  );

  const loanFields = (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Loan Amount" error={shown.loanAmount} hint={s.price > 0 ? `Down payment ${usd(Math.max(0, s.price - s.loanAmount))} (${pct(Math.max(0, (1 - s.loanAmount / s.price) * 100), 2)})` : undefined}>
        <NumberInput ariaLabel="Loan Amount" prefix="$" decimals={0} min={0} value={s.loanAmount} invalid={!!shown.loanAmount} onChange={(loanAmount) => set({ loanAmount })} />
      </Field>
      <Field label="Rate" error={shown.ratePct}>
        <NumberInput ariaLabel="Rate" suffix="%" decimals={3} min={0} max={25} value={s.ratePct} invalid={!!shown.ratePct} onChange={(ratePct) => set({ ratePct })} />
      </Field>
      <Field label="Term">
        <Select ariaLabel="Term" value={String(s.termYears) as (typeof TERMS)[number]} onChange={(v) => set({ termYears: Number(v) })} options={TERMS.map((t) => ({ value: t, label: `${t} years` }))} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Program">
          <Select ariaLabel="Program" value={s.program} onChange={(program) => set({ program })} options={PROGRAMS} />
        </Field>
        <Field label="Loan Type">
          <Select ariaLabel="Loan Type" value="Fixed" onChange={() => {}} options={['Fixed'] as const} />
        </Field>
      </div>
    </div>
  );

  /* ------------------------------------------------------------------ form */
  if (s.step === 'form') {
    return (
      <CalculatorShell toolId={TOOL} demo subtitle="Show how appreciation and principal paydown build your client’s equity over time.">
        <ToolFormCard title="Property & loan" subtitle="Alex Rivera’s scenario is pre-filled — change anything, then Calculate." onCalculate={calculate} error={tried && hasErrors ? 'Fix the highlighted fields to continue.' : null}>
          <ClientPicker value={s.clientId} onChange={(clientId) => set({ clientId })} error={shown.client} />
          {propertyFields}
          {modeFields}
          <div className="border-t border-slate-100 pt-5">
            <SectionLabel className="mb-3">Loan</SectionLabel>
            {loanFields}
          </div>
        </ToolFormCard>
      </CalculatorShell>
    );
  }

  /* ------------------------------------------------------------------ results */
  const parts = [
    { label: 'Down payment', value: Math.max(0, r.downPayment), color: '#94a3b8' },
    { label: 'Principal paid', value: Math.max(0, r.principalPaid), color: C_BALANCE },
    { label: 'Appreciation', value: Math.max(0, r.appreciation), color: C_EQUITY },
  ];
  const partsTotal = parts.reduce((a, p) => a + p.value, 0) || 1;
  const csv = () => [['Year', 'Home value', 'Loan balance', 'Equity'], ...pts.map((p) => [p.year, p.homeValue, p.loanBalance, p.equity])];

  return (
    <CalculatorShell toolId={TOOL} demo subtitle={`${usd(s.price)} in ${loc.label} with a ${usd(s.loanAmount)} loan`}>
      <ResultsHeader
        toolId={TOOL}
        scenarioTitle={`Equity Gained — ${usd(s.price)} ${loc.label}`}
        clientId={s.clientId}
        onBack={() => set({ step: 'form' })}
        data={s}
        csv={csv}
        emailBody={`Hi ${client?.name.split(' ')[0] ?? 'there'},\n\nIn ${r.years} years your ${usd(s.price)} home could give you about ${usd(r.equity)} in equity: ${usd(r.appreciation)} from appreciation, ${usd(r.principalPaid)} of principal paid down, plus your ${usd(r.downPayment)} down payment.`}
        chips={[
          { label: 'Client', value: client?.name ?? '—', onEdit: () => setModal('client') },
          { label: 'Property', value: `${usd(s.price)} · ${loc.label}`, onEdit: () => setModal('property') },
          { label: 'Loan', value: `${usd(s.loanAmount)} · ${s.termYears}-yr Fixed ${pct(s.ratePct, 3)}`, onEdit: () => setModal('loan') },
          { label: 'Appreciation', value: `${MODE_LABEL[s.mode]} ${pct(r.formRatePct, 3)}`, onEdit: () => setModal('property') },
        ]}
      />

      <Card>
        <Slider label="Years from today" min={1} max={30} value={s.years} onChange={(years) => set({ years })} format={(v) => `${v} year${v === 1 ? '' : 's'}`} />
      </Card>

      <Card className="lg:flex lg:items-stretch lg:gap-8">
        <div className="min-w-0 lg:w-[40%] lg:border-r lg:border-slate-100 lg:pr-8">
          <SectionLabel>Equity after {r.years} year{r.years === 1 ? '' : 's'}</SectionLabel>
          <div className="mt-2 text-4xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-5xl">{usd(r.equity)}</div>
          <div className="mt-2 text-sm text-slate-500">
            includes your {usd(r.downPayment)} down payment · home value {usd(r.homeValue)}, loan balance {usd(r.loanBalance)}
          </div>
          <div className="mt-5">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Equity composition">
              {parts.map((p) => (
                <div key={p.label} style={{ width: `${(p.value / partsTotal) * 100}%`, background: p.color }} />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {parts.map((p) => (
                <span key={p.label} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                  <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                  {p.label} <span className="font-semibold tabular-nums text-slate-800">{usd(p.value)}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:mt-0 lg:flex-1 lg:content-center">
          <Tile label="Appreciation gained" value={usd(r.appreciation, { sign: true })} tone={r.appreciation >= 0 ? 'gain' : 'loss'} sub={`${usd(s.price)} → ${usd(r.homeValue)}`} />
          <Tile label="Amortization" value={usd(r.principalPaid, { sign: true })} tone="gain" sub={`Principal paid over ${Math.min(r.years * 12, s.termYears * 12)} payments`} />
          <Tile label="Total equity gained" value={usd(r.totalGained, { sign: true })} tone={r.totalGained >= 0 ? 'brand' : 'loss'} sub="Appreciation + amortization" highlight />
          <Tile label={s.mode === 'forecast' ? 'Forecasted appreciation' : `${MODE_LABEL[s.mode]} appreciation`} value={`${pct(r.effectiveRatePct, 2)}`} sub={`avg/yr over ${r.years} yr${s.mode === 'forecast' ? ` · form rate ${pct(r.formRatePct, 3)}` : ''}`} />
        </div>
      </Card>

      <ChartCard
        title="Home value vs. loan balance"
        subtitle="The shaded gap is your equity · loan balance shown one payment into each year"
        legend={[
          { label: 'Home value', color: C_VALUE },
          { label: 'Loan balance', color: C_BALANCE },
          { label: 'Equity', color: C_EQUITY },
        ]}
        height={320}
        table={{ head: ['Year', 'Home value', 'Loan balance', 'Equity'], rows: pts.map((p) => [`Yr ${p.year}`, usd(p.homeValue), usd(p.loanBalance), usd(p.equity)]) }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartRows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="year" {...axisProps} tickFormatter={(v) => `Yr ${v}`} interval="preserveStartEnd" minTickGap={16} />
            <YAxis {...axisProps} tickFormatter={axisUsd} width={56} domain={[0, 'auto']} />
            <Tooltip
              content={(props) => (
                <ChartTooltip
                  active={props.active}
                  label={props.label}
                  payload={(props.payload ?? []).filter((p) => p.dataKey !== '_base') as never}
                  format={(v) => usd(v)}
                  labelFormat={(l) => `Year ${l}`}
                />
              )}
            />
            <Area type="monotone" dataKey="_base" stackId="eq" stroke="none" fill="transparent" isAnimationActive={false} activeDot={false} legendType="none" />
            <Area type="monotone" dataKey="equity" name="Equity" stackId="eq" stroke="none" fill={C_EQUITY} fillOpacity={0.14} isAnimationActive={false} activeDot={false} />
            <Line type="monotone" dataKey="homeValue" name="Home value" stroke={C_VALUE} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            <Line type="monotone" dataKey="loanBalance" name="Loan balance" stroke={C_BALANCE} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      <TalkTrack>
        <p>
          “In {r.years} years you’d have about <strong>{usd(r.equity)}</strong> in equity — <strong>{usd(r.appreciation)}</strong> from appreciation, <strong>{usd(r.principalPaid)}</strong> of principal you’ve
          paid down, plus your {usd(r.downPayment)} down payment. Every payment you make is building that number, and the {s.mode === 'forecast' ? 'forecast' : MODE_LABEL[s.mode].toLowerCase()} rate of about {pct(r.effectiveRatePct, 2)} a year does the rest.”
        </p>
      </TalkTrack>

      <ReportFooter note={`Equity = projected home value − remaining loan balance. Forecast appreciation on the input form is the location’s long-run forecast (${pct(loc.forecastDisplayPct, 3)}); results show the effective annual rate over the selected period. Mortgage insurance is not modeled.`} />

      <ClientEditModal open={modal === 'client'} onClose={() => setModal(null)} clientId={s.clientId} onChange={(clientId) => set({ clientId })} />
      <Modal open={modal === 'property'} onClose={() => setModal(null)} title="Property & appreciation" size="lg" footer={<Button onClick={() => setModal(null)} disabled={!!errors.price || !!errors.customPct || !!errors.loanAmount}>Done</Button>}>
        <div className="space-y-5">
          {propertyFields}
          {modeFields}
          {(errors.price || errors.loanAmount) && <p className="text-xs font-medium text-red-600">{errors.price ?? errors.loanAmount}</p>}
        </div>
      </Modal>
      <Modal open={modal === 'loan'} onClose={() => setModal(null)} title="Loan" size="lg" footer={<Button onClick={() => setModal(null)} disabled={!!errors.loanAmount || !!errors.ratePct}>Done</Button>}>
        {loanFields}
        {(errors.loanAmount || errors.ratePct) && <p className="mt-2 text-xs font-medium text-red-600">{errors.loanAmount ?? errors.ratePct}</p>}
      </Modal>
    </CalculatorShell>
  );
}

function Tile({ label, value, sub, tone, highlight }: { label: string; value: string; sub?: string; tone?: 'gain' | 'loss' | 'brand'; highlight?: boolean }) {
  return (
    <div className={cx('rounded-xl border p-4', highlight ? 'border-brand-200 bg-brand-50/60' : 'border-slate-200 bg-white')}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold tabular-nums tracking-tight', tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : tone === 'brand' ? 'text-brand-700' : 'text-slate-900')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
