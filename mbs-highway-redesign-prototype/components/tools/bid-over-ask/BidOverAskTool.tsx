'use client';

import { Clock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CartesianGrid, LabelList, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalculatorShell } from '@/components/calc/CalculatorShell';
import { ChartCard, ChartTooltip } from '@/components/calc/ChartCard';
import { ClientPicker } from '@/components/calc/ClientPicker';
import { LocationPicker } from '@/components/calc/LocationPicker';
import { ReportFooter } from '@/components/calc/ReportFooter';
import { ResultsHeader } from '@/components/calc/ResultsHeader';
import { TalkTrack } from '@/components/calc/TalkTrack';
import { ClientEditModal, CustomRateInput, ModeOption, ToolFormCard } from '@/components/tools/appreciation/shared';
import { Button, Card, Field, Modal, NumberInput, SectionLabel, cx } from '@/components/ui';
import { getLocation } from '@/data/mock/locations';
import type { AppreciationMode } from '@/lib/calculations/appreciation';
import { CROSSING_HORIZON_YEARS, bidFormRates, bidOverAsk, validateBid } from '@/lib/calculations/bidOverAsk';
import { CHART, SERIES, axisProps, axisUsd, gridProps } from '@/lib/chartTheme';
import { pct, usd } from '@/lib/format';
import { useStore } from '@/lib/store';
import { useUrlState } from '@/lib/useUrlState';

const TOOL = 'bid-over-ask';
const MODE_LABEL: Record<AppreciationMode, string> = { forecast: 'Forecasted', historical: 'Historical', custom: 'Custom' };

interface State {
  step: 'form' | 'results';
  clientId: string | null;
  locationId: string;
  askingPrice: number;
  bidAbove: number;
  currentValue: number;
  /** false while Estimated Current Value still mirrors the asking price. */
  valueEdited: boolean;
  mode: AppreciationMode;
  customPct: number;
}

const DEFAULTS: State = {
  step: 'form',
  clientId: 'c-alex-rivera',
  locationId: 'dallas-tx-75201',
  askingPrice: 500000,
  bidAbove: 25000,
  currentValue: 500000,
  valueEdited: false,
  mode: 'forecast',
  customPct: 4,
};

function monthsLabel(m: number | null): string {
  if (m === null) return `Not within ${CROSSING_HORIZON_YEARS} years`;
  if (m <= 0) return 'Immediately';
  return `${m.toFixed(1)} months`;
}

function monthYearFromNow(m: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + Math.ceil(m));
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function BidOverAskTool() {
  const [s, setS] = useUrlState<State>(DEFAULTS);
  const set = (patch: Partial<State>) => setS((p) => ({ ...p, ...patch }));
  const { getClient } = useStore();
  const [tried, setTried] = useState(false);
  const [modal, setModal] = useState<null | 'client' | 'property'>(null);

  const loc = getLocation(s.locationId);
  const rates = bidFormRates(loc);
  const input = { askingPrice: s.askingPrice, bidAbove: s.bidAbove, currentValue: s.currentValue, locationId: s.locationId, mode: s.mode, customPct: s.customPct };
  const errors = validateBid({ clientId: s.clientId, ...input });
  const shown = tried ? errors : {};
  const hasErrors = Object.keys(errors).length > 0;
  const r = useMemo(() => bidOverAsk(input), [JSON.stringify(input)]); // eslint-disable-line react-hooks/exhaustive-deps
  const client = getClient(s.clientId);

  const calculate = () => {
    setTried(true);
    if (!hasErrors) {
      set({ step: 'results' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const priceFields = (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="Current Asking Price" error={shown.askingPrice}>
        <NumberInput
          ariaLabel="Current Asking Price"
          prefix="$"
          decimals={0}
          min={0}
          value={s.askingPrice}
          invalid={!!shown.askingPrice}
          onChange={(askingPrice) => set(s.valueEdited ? { askingPrice } : { askingPrice, currentValue: askingPrice })}
        />
      </Field>
      <Field label="Bid Above Asking" error={shown.bidAbove} hint={`Total bid ${usd(r.totalBid)}`}>
        <NumberInput ariaLabel="Bid Above Asking" prefix="$" decimals={0} min={0} value={s.bidAbove} invalid={!!shown.bidAbove} onChange={(bidAbove) => set({ bidAbove })} />
      </Field>
      <Field
        label="Estimated Current Value"
        error={shown.currentValue}
        hint={s.valueEdited ? undefined : 'Auto-filled from asking price'}
        right={
          s.valueEdited ? (
            <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => set({ currentValue: s.askingPrice, valueEdited: false })}>
              Use asking
            </button>
          ) : undefined
        }
      >
        <NumberInput ariaLabel="Estimated Current Value" prefix="$" decimals={0} min={0} value={s.currentValue} invalid={!!shown.currentValue} onChange={(currentValue) => set({ currentValue, valueEdited: true })} />
      </Field>
    </div>
  );

  const modeFields = (
    <div>
      <div className="mb-2 text-[13px] font-medium text-slate-700">Appreciation</div>
      <div className="grid gap-2 sm:grid-cols-3">
        <ModeOption type="radio" name="boa-mode" checked={s.mode === 'forecast'} onChange={() => set({ mode: 'forecast' })} title="Forecasted" rate={pct(rates.forecast1yrPct, 2)} hint={`1-yr forecast · ${pct(rates.forecast5yrAvgPct, 2)} 5-yr avg`} />
        <ModeOption type="radio" name="boa-mode" checked={s.mode === 'historical'} onChange={() => set({ mode: 'historical' })} title="Historical" rate={pct(rates.historical63yrPct, 2)} hint="63-yr average" />
        <ModeOption type="radio" name="boa-mode" checked={s.mode === 'custom'} onChange={() => set({ mode: 'custom' })} title="Custom" hint="Your own annual rate">
          {s.mode === 'custom' ? <CustomRateInput value={s.customPct} onChange={(customPct) => set({ customPct })} invalid={!!shown.customPct} /> : null}
        </ModeOption>
      </div>
      {shown.customPct && <p className="mt-1 text-xs font-medium text-red-600">{shown.customPct}</p>}
    </div>
  );

  /* ------------------------------------------------------------------ form */
  if (s.step === 'form') {
    return (
      <CalculatorShell toolId={TOOL} demo subtitle="Show a buyer how quickly the home’s value is forecast to catch up with an over-asking offer.">
        <ToolFormCard title="Offer details" subtitle="Alex Rivera’s scenario is pre-filled — change anything, then Calculate." onCalculate={calculate} error={tried && errors.client ? errors.client : tried && hasErrors ? 'Fix the highlighted fields to continue.' : null}>
          <ClientPicker value={s.clientId} onChange={(clientId) => set({ clientId })} error={shown.client} />
          <LocationPicker value={s.locationId} onChange={(locationId) => set({ locationId })} />
          {priceFields}
          {modeFields}
        </ToolFormCard>
      </CalculatorShell>
    );
  }

  /* ------------------------------------------------------------------ results */
  const chartData = r.years.map((y) => ({ year: y.year, value: y.value, pct: y.pctVsBid }));
  const cross = r.monthsToExceed;
  const crossInChart = cross !== null && cross > 0 && cross / 12 <= 5;
  const yMin = Math.min(r.totalBid, ...r.years.map((y) => y.value));
  const yMax = Math.max(r.totalBid, ...r.years.map((y) => y.value));
  const pad = Math.max(5000, (yMax - yMin) * 0.12);
  const modeText = s.mode === 'forecast' ? 'forecast' : s.mode === 'historical' ? `historical ${pct(rates.historical63yrPct, 2)} rate` : `${pct(s.customPct, 3)} custom rate`;
  const csv = () => [['Year', 'Projected value', 'Vs bid ($)', 'Vs bid (%)'], ...r.years.map((y) => [y.year, y.value, y.vsBid, Math.round(y.pctVsBid * 100) / 100])];

  return (
    <CalculatorShell toolId={TOOL} demo subtitle={`${usd(r.totalBid)} offer on a ${usd(s.askingPrice)} listing in ${loc.label}`}>
      <ResultsHeader
        toolId={TOOL}
        scenarioTitle={`Bid Over Ask — ${usd(r.totalBid)} ${loc.label}`}
        clientId={s.clientId}
        onBack={() => set({ step: 'form' })}
        data={s}
        csv={csv}
        emailBody={`Hi ${client?.name.split(' ')[0] ?? 'there'},\n\nOn a ${usd(r.totalBid)} offer (${usd(s.bidAbove)} over asking), the home’s value is forecast to catch up in ${monthsLabel(cross).toLowerCase()} and reach ${usd(r.value5)} by year 5 — ${usd(r.gain5, { sign: true })} over what you paid.`}
        chips={[
          { label: 'Client', value: client?.name ?? '—', onEdit: () => setModal('client') },
          { label: 'Property', value: `${usd(s.askingPrice)} ask · ${loc.label}`, onEdit: () => setModal('property') },
          { label: 'Bid', value: `${usd(r.totalBid)} (${usd(s.bidAbove, { sign: true })})`, onEdit: () => setModal('property') },
          { label: 'Appreciation', value: s.mode === 'forecast' ? `Forecasted ${pct(rates.forecast1yrPct, 2)} 1-yr` : s.mode === 'historical' ? `Historical ${pct(rates.historical63yrPct, 2)}` : `Custom ${pct(s.customPct, 3)}`, onEdit: () => setModal('property') },
        ]}
      />

      <Card className="lg:flex lg:items-stretch lg:gap-8">
        <div className="min-w-0 lg:w-[40%] lg:border-r lg:border-slate-100 lg:pr-8">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-brand-600" />
            <SectionLabel>When home value is forecasted to exceed the bid</SectionLabel>
          </div>
          <div className="mt-3 text-4xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-5xl">{monthsLabel(cross)}</div>
          <div className="mt-2 text-sm text-slate-500">
            {cross === null
              ? `At this rate the value doesn’t reach ${usd(r.totalBid)} within ${CROSSING_HORIZON_YEARS} years.`
              : cross <= 0
                ? `The bid doesn’t exceed the estimated current value of ${usd(s.currentValue)}.`
                : `Around ${monthYearFromNow(cross)} — the projected value passes your ${usd(r.totalBid)} bid on the ${modeText} curve.`}
          </div>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:mt-0 lg:flex-1 lg:content-center">
          <Tile label="Total bid" value={usd(r.totalBid)} sub={`${pct(r.pctOverValue, 2)} over value (${usd(r.dollarsOverValue, { sign: true })})`} />
          <Tile label="5-yr projected value" value={usd(r.value5)} sub={`from ${usd(s.currentValue)} today`} />
          <Tile label="5-yr forecast gain" value={usd(r.gain5, { sign: true })} tone={r.gain5 >= 0 ? 'gain' : 'loss'} sub={`${pct(r.gain5PctOfBid, 2, { sign: true })} over ${usd(r.totalBid)} bid`} highlight />
        </div>
      </Card>

      <ChartCard
        title="Projected value vs. your bid"
        subtitle={`${loc.label} · labels show value vs. the ${usd(r.totalBid)} bid`}
        legend={[
          { label: 'Projected value', color: SERIES[0] },
          { label: 'Your bid', color: CHART.neutral, dashed: true },
        ]}
        height={320}
        table={{
          head: ['Year', 'Projected value', 'Vs bid', 'Vs bid %'],
          rows: r.years.map((y) => [`Yr ${y.year}`, usd(y.value), usd(y.vsBid, { sign: true }), pct(y.pctVsBid, 2, { sign: true })]),
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 28, right: 24, left: 4, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="year" type="number" domain={[0, 5]} ticks={[0, 1, 2, 3, 4, 5]} {...axisProps} tickFormatter={(v) => `Yr ${v}`} />
            <YAxis {...axisProps} tickFormatter={axisUsd} width={56} domain={[Math.floor((yMin - pad) / 5000) * 5000, Math.ceil((yMax + pad) / 5000) * 5000]} />
            <Tooltip content={<ChartTooltip format={(v) => usd(v)} labelFormat={(l) => `Year ${l}`} />} />
            <ReferenceLine y={r.totalBid} stroke={CHART.neutral} strokeDasharray="5 4" label={{ value: `Bid ${usd(r.totalBid)}`, position: 'insideBottomRight', fill: CHART.text, fontSize: 11 }} />
            {crossInChart && <ReferenceDot x={cross! / 12} y={r.totalBid} r={5} fill={CHART.brand} stroke="#fff" strokeWidth={2} />}
            <Line type="linear" dataKey="value" name="Projected value" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3, fill: SERIES[0], strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={false}>
              <LabelList dataKey="pct" position="top" offset={10} formatter={(v: number) => pct(v, 2, { sign: true })} style={{ fill: CHART.textStrong, fontSize: 11, fontWeight: 600 }} />
            </Line>
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <TalkTrack>
        <p>
          “You’re bidding <strong>{usd(r.totalBid)}</strong> — {usd(s.bidAbove)} over asking, about {pct(r.pctOverValue, 1)} above today’s value.{' '}
          {cross === null ? (
            <>At this rate the value doesn’t catch up, so let’s look at a different offer.</>
          ) : cross <= 0 ? (
            <>You’re not paying over value at all.</>
          ) : (
            <>
              On the {modeText}, the home’s value catches up in about <strong>{Math.round(cross)} months</strong>
            </>
          )}
          {cross !== null && (
            <>
              {cross > 0 ? ', and ' : ' '}by Year 5 it’s projected to be worth <strong>{usd(r.value5)}</strong> — {usd(r.gain5, { sign: true })} versus what you paid. You’re not overpaying forever.”
            </>
          )}
          {cross === null && '”'}
        </p>
      </TalkTrack>

      <ReportFooter note="Forecasted mode follows the location’s forecast curve (1-yr and 5-yr average rates shown on the form); Historical and Custom compound a flat annual rate. The crossing point is read off the same curve shown in the chart." />

      <ClientEditModal open={modal === 'client'} onClose={() => setModal(null)} clientId={s.clientId} onChange={(clientId) => set({ clientId })} />
      <Modal
        open={modal === 'property'}
        onClose={() => setModal(null)}
        title="Property & offer"
        size="xl"
        footer={
          <Button onClick={() => setModal(null)} disabled={!!(errors.askingPrice || errors.bidAbove || errors.currentValue || errors.customPct)}>
            Done
          </Button>
        }
      >
        <div className="space-y-5">
          <LocationPicker value={s.locationId} onChange={(locationId) => set({ locationId })} />
          {priceFields}
          {modeFields}
          {(errors.askingPrice || errors.currentValue || errors.customPct) && <p className="text-xs font-medium text-red-600">{errors.askingPrice ?? errors.currentValue ?? errors.customPct}</p>}
        </div>
      </Modal>
    </CalculatorShell>
  );
}

function Tile({ label, value, sub, tone, highlight }: { label: string; value: string; sub?: string; tone?: 'gain' | 'loss'; highlight?: boolean }) {
  return (
    <div className={cx('rounded-xl border p-4', highlight ? 'border-brand-200 bg-brand-50/60' : 'border-slate-200 bg-white')}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold tabular-nums tracking-tight', tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-slate-900')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
