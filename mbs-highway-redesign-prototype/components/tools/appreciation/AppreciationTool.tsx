'use client';

import { Plus, Sheet, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalculatorShell } from '@/components/calc/CalculatorShell';
import { ChartCard, ChartTooltip } from '@/components/calc/ChartCard';
import { ClientPicker } from '@/components/calc/ClientPicker';
import { LocationPicker } from '@/components/calc/LocationPicker';
import { ReportFooter } from '@/components/calc/ReportFooter';
import { ResultsHeader } from '@/components/calc/ResultsHeader';
import { TalkTrack } from '@/components/calc/TalkTrack';
import { Button, Card, Field, Modal, NumberInput, SectionLabel, Segmented, Slider, TextInput, cx } from '@/components/ui';
import { getLocation } from '@/data/mock/locations';
import type { AppreciationMode } from '@/lib/calculations/appreciation';
import {
  APPRECIATION_MODE_LABEL,
  DEFAULT_CLOSING_WORKSHEET,
  MAX_APPRECIATION_MODES,
  appreciationResult,
  convertDownUnit,
  downPaymentDollars,
  formRatePct,
  homeValueSeries,
  sumWorksheet,
  toggleAppreciationMode,
  validateAppreciation,
  type AppreciationToolResult,
  type ClosingCostItem,
} from '@/lib/calculations/appreciationTool';
import { CHART, SERIES, axisProps, axisUsd, gridProps } from '@/lib/chartTheme';
import { pct, usd } from '@/lib/format';
import { useStore } from '@/lib/store';
import { useUrlState } from '@/lib/useUrlState';
import { ClientEditModal, CustomRateInput, ModeOption, SeriesDot, ToolFormCard } from './shared';

const TOOL = 'appreciation';
const MODE_COLOR: Record<AppreciationMode, string> = { forecast: SERIES[0], historical: SERIES[1], custom: SERIES[2] };
const MODE_HINT: Record<AppreciationMode, string> = {
  forecast: 'Local forecast curve',
  historical: 'Long-run local average',
  custom: 'Your own annual rate',
};

interface State {
  step: 'form' | 'results';
  clientId: string | null;
  locationId: string;
  price: number;
  modes: AppreciationMode[];
  customPct: number;
  downValue: number;
  downUnit: 'fee' | 'pct';
  closing: number;
  years: number;
}

const DEFAULTS: State = {
  step: 'form',
  clientId: 'c-alex-rivera',
  locationId: 'dallas-tx-75201',
  price: 500000,
  modes: ['forecast'],
  customPct: 4,
  downValue: 100000,
  downUnit: 'fee',
  closing: 8000,
  years: 10,
};

export function AppreciationTool() {
  const [s, setS] = useUrlState<State>(DEFAULTS);
  const set = (patch: Partial<State>) => setS((p) => ({ ...p, ...patch }));
  const { getClient } = useStore();
  const [tried, setTried] = useState(false);
  // Itemization is a working aid; only its total is part of the shareable scenario.
  const [worksheet, setWorksheet] = useState<ClosingCostItem[]>(DEFAULT_CLOSING_WORKSHEET);
  const [modal, setModal] = useState<null | 'client' | 'property' | 'cash' | 'worksheet'>(null);

  const loc = getLocation(s.locationId);
  const down = downPaymentDollars(s.price, s.downValue, s.downUnit);
  const errors = validateAppreciation({ clientId: s.clientId, price: s.price, modes: s.modes, customPct: s.customPct, downPayment: down, closingCosts: s.closing });
  const shown = tried ? errors : {};
  const hasErrors = Object.keys(errors).length > 0;

  const results = useMemo(
    () => s.modes.map((mode) => appreciationResult({ price: s.price, locationId: s.locationId, mode, customPct: s.customPct, downPayment: down, closingCosts: s.closing, years: s.years })),
    [s.modes, s.price, s.locationId, s.customPct, down, s.closing, s.years],
  );
  const series = useMemo(() => s.modes.map((m) => ({ mode: m, values: homeValueSeries(s.price, s.locationId, m, s.customPct, s.years) })), [s.modes, s.price, s.locationId, s.customPct, s.years]);
  const chartData = useMemo(() => Array.from({ length: s.years + 1 }, (_, y) => Object.fromEntries([['year', y], ...series.map((x) => [x.mode, x.values[y]])])), [series, s.years]);

  const calculate = () => {
    setTried(true);
    if (!hasErrors) {
      set({ step: 'results' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const client = getClient(s.clientId);
  const primary = results[0];

  const downField = (
    <Field
      label="Down Payment"
      error={shown.downPayment}
      right={
        <Segmented
          size="sm"
          ariaLabel="Down payment unit"
          value={s.downUnit}
          onChange={(u) => set({ downUnit: u, downValue: convertDownUnit(s.price, s.downValue, s.downUnit, u) })}
          options={[
            { value: 'fee', label: '$ Fee' },
            { value: 'pct', label: '% Percentage' },
          ]}
        />
      }
      hint={s.downUnit === 'pct' ? `${usd(down)} of ${usd(s.price)}` : s.price > 0 ? `${pct((down / s.price) * 100, 2)} of price` : undefined}
    >
      <NumberInput
        ariaLabel="Down Payment"
        prefix={s.downUnit === 'fee' ? '$' : undefined}
        suffix={s.downUnit === 'pct' ? '%' : undefined}
        decimals={s.downUnit === 'pct' ? 3 : 0}
        min={0}
        value={s.downValue}
        invalid={!!shown.downPayment}
        onChange={(downValue) => set({ downValue })}
      />
    </Field>
  );

  const closingField = (
    <Field
      label="Closing Costs"
      error={shown.closingCosts ?? (s.closing <= 0 ? 'Closing costs must be greater than $0' : undefined)}
      right={
        <button type="button" onClick={() => setModal('worksheet')} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
          <Sheet className="h-3.5 w-3.5" /> Use worksheet
        </button>
      }
      hint={`Cash invested: ${usd(down + Math.max(0, s.closing))} (down + closing)`}
    >
      <NumberInput ariaLabel="Closing Costs" prefix="$" decimals={0} min={0} value={s.closing} invalid={s.closing <= 0} onChange={(closing) => set({ closing })} />
    </Field>
  );

  const priceField = (
    <Field label="Price" error={shown.price}>
      <NumberInput ariaLabel="Price" prefix="$" decimals={0} min={0} value={s.price} invalid={!!shown.price} onChange={(price) => set({ price })} />
    </Field>
  );

  const modesBlock = (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-slate-700">Appreciation</span>
        <span className={cx('text-xs', shown.modes ? 'font-medium text-red-600' : 'text-slate-500')}>{shown.modes ?? `Select up to ${MAX_APPRECIATION_MODES}`}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {(['forecast', 'historical', 'custom'] as AppreciationMode[]).map((m) => {
          const on = s.modes.includes(m);
          const full = !on && s.modes.length >= MAX_APPRECIATION_MODES;
          return (
            <ModeOption
              key={m}
              type="checkbox"
              checked={on}
              disabled={full}
              onChange={(v) => set({ modes: toggleAppreciationMode(s.modes, m, v) })}
              title={APPRECIATION_MODE_LABEL[m]}
              rate={m === 'custom' ? undefined : pct(formRatePct(s.locationId, m, s.customPct), 3)}
              hint={MODE_HINT[m]}
            >
              {m === 'custom' && on ? <CustomRateInput value={s.customPct} onChange={(customPct) => set({ customPct })} invalid={!!shown.customPct} /> : null}
            </ModeOption>
          );
        })}
      </div>
      {shown.customPct && <p className="mt-1 text-xs font-medium text-red-600">{shown.customPct}</p>}
    </div>
  );

  /* ------------------------------------------------------------------ form */
  if (s.step === 'form') {
    return (
      <CalculatorShell toolId={TOOL} demo subtitle="Project your client’s future home value and the return on the cash they put in.">
        <ToolFormCard title="Property & purchase" subtitle="Alex Rivera’s scenario is pre-filled — change anything, then Calculate." onCalculate={calculate} error={tried && hasErrors ? 'Fix the highlighted fields to continue.' : null}>
          <ClientPicker value={s.clientId} onChange={(clientId) => set({ clientId })} error={shown.client} />
          <div className="grid gap-4 sm:grid-cols-2">
            <LocationPicker value={s.locationId} onChange={(locationId) => set({ locationId })} />
            {priceField}
          </div>
          {modesBlock}
          <div className="grid gap-4 sm:grid-cols-2">
            {downField}
            {closingField}
          </div>
        </ToolFormCard>
        <WorksheetModal open={modal === 'worksheet'} onClose={() => setModal(null)} items={worksheet} onApply={(w) => { setWorksheet(w); set({ closing: sumWorksheet(w) }); }} />
      </CalculatorShell>
    );
  }

  /* ------------------------------------------------------------------ results */
  const modeSummary = results.map((r) => `${APPRECIATION_MODE_LABEL[r.mode]} ${pct(r.effectiveRatePct, 2)}`).join(' vs ');
  const csv = () => [
    ['Year', ...series.flatMap((x) => [`${APPRECIATION_MODE_LABEL[x.mode]} value`, `${APPRECIATION_MODE_LABEL[x.mode]} appreciation`])],
    ...chartData.map((row) => [row.year as number, ...series.flatMap((x) => [x.values[row.year as number], x.values[row.year as number] - s.price])]),
  ];

  return (
    <CalculatorShell toolId={TOOL} demo subtitle={`Projected value of ${usd(s.price)} in ${loc.label}`}>
      <ResultsHeader
        toolId={TOOL}
        scenarioTitle={`Appreciation — ${usd(s.price)} ${loc.label}`}
        clientId={s.clientId}
        onBack={() => set({ step: 'form' })}
        data={s}
        csv={csv}
        emailBody={`Hi ${client?.name.split(' ')[0] ?? 'there'},\n\nHere’s how your ${usd(s.price)} home in ${loc.label} could appreciate. At ${modeSummary}, it’s projected to be worth ${usd(primary.homeValue)} in ${s.years} years — ${usd(primary.appreciation, { sign: true })} of appreciation on ${usd(primary.cashInvested)} invested.`}
        chips={[
          { label: 'Client', value: client?.name ?? '—', onEdit: () => setModal('client') },
          { label: 'Property', value: `${usd(s.price)} · ${loc.label}`, onEdit: () => setModal('property') },
          { label: 'Cash invested', value: `${usd(down)} down + ${usd(s.closing)} closing`, onEdit: () => setModal('cash') },
          { label: 'Appreciation', value: results.map((r) => `${APPRECIATION_MODE_LABEL[r.mode]} ${pct(r.formRatePct, 3)}`).join(' · '), onEdit: () => set({ step: 'form' }) },
        ]}
      />

      <Card>
        <Slider label="Years from today" min={1} max={30} value={s.years} onChange={(years) => set({ years })} format={(v) => `${v} year${v === 1 ? '' : 's'}`} />
      </Card>

      <div className={cx('grid gap-4', results.length > 1 && 'lg:grid-cols-2')}>
        {results.map((r) => (
          <ResultPanel key={r.mode} r={r} wide={results.length === 1} price={s.price} />
        ))}
      </div>

      <ChartCard
        title="Estimated home value"
        subtitle={`${loc.label} · purchase ${usd(s.price)}`}
        legend={series.map((x) => ({ label: APPRECIATION_MODE_LABEL[x.mode], color: MODE_COLOR[x.mode] }))}
        table={{
          head: ['Year', ...series.flatMap((x) => [`${APPRECIATION_MODE_LABEL[x.mode]} value`, 'Appreciation'])],
          rows: chartData.map((row) => [`Yr ${row.year}`, ...series.flatMap((x) => [usd(x.values[row.year as number]), usd(x.values[row.year as number] - s.price, { sign: true })])]),
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="year" {...axisProps} tickFormatter={(v) => `Yr ${v}`} interval="preserveStartEnd" minTickGap={16} />
            <YAxis {...axisProps} tickFormatter={axisUsd} width={56} domain={[(min: number) => Math.floor((min * 0.97) / 10000) * 10000, 'auto']} />
            <Tooltip content={<ChartTooltip format={(v) => usd(v)} labelFormat={(l) => `Year ${l}`} />} />
            <ReferenceLine y={s.price} stroke={CHART.neutral} strokeDasharray="4 4" label={{ value: 'Purchase price', position: 'insideTopLeft', fill: CHART.text, fontSize: 11 }} />
            {series.map((x) => (
              <Line key={x.mode} type="monotone" dataKey={x.mode} name={APPRECIATION_MODE_LABEL[x.mode]} stroke={MODE_COLOR[x.mode]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <TalkTrack>
        {results.length === 1 ? (
          <p>
            “On the {usd(primary.cashInvested)} you’re putting in — {usd(down)} down plus {usd(s.closing)} in closing costs — the {APPRECIATION_MODE_LABEL[primary.mode].toLowerCase()} projects{' '}
            <strong>{usd(primary.appreciation)}</strong> of appreciation in {s.years} years, taking the home to {usd(primary.homeValue)}. That’s a{' '}
            <strong>{pct(primary.roiPct, 0)}</strong> return on your cash, about {pct(primary.roiAvgPerYearPct, 0)} a year — before counting a single dollar of principal you pay down.”
          </p>
        ) : (
          <p>
            “Here are two ways to look at it. {results.map((r, i) => (
              <span key={r.mode}>
                {i > 0 ? ' Using ' : 'Using '}the {APPRECIATION_MODE_LABEL[r.mode].toLowerCase()} rate ({pct(r.effectiveRatePct, 2)}/yr), the home reaches <strong>{usd(r.homeValue)}</strong> in {s.years} years — {usd(r.appreciation, { sign: true })}, a {pct(r.roiPct, 0)} return on your {usd(r.cashInvested)}.
              </span>
            ))}”
          </p>
        )}
      </TalkTrack>

      <ReportFooter note={`Forecast appreciation shown on the input form is the location’s long-run forecast (${pct(loc.forecastDisplayPct, 3)}); results show the effective annual rate of the forecast curve over the selected period. ROI = appreciation ÷ cash invested (down payment + closing costs).`} />

      <ClientEditModal open={modal === 'client'} onClose={() => setModal(null)} clientId={s.clientId} onChange={(clientId) => set({ clientId })} />
      <Modal open={modal === 'property'} onClose={() => setModal(null)} title="Property" footer={<Button onClick={() => setModal(null)} disabled={!(s.price > 0)}>Done</Button>}>
        <div className="space-y-4">
          <LocationPicker value={s.locationId} onChange={(locationId) => set({ locationId })} />
          <Field label="Price" error={s.price > 0 ? undefined : 'Enter a price greater than $0'}>
            <NumberInput ariaLabel="Price" prefix="$" decimals={0} min={0} value={s.price} onChange={(price) => set({ price })} />
          </Field>
        </div>
      </Modal>
      <Modal open={modal === 'cash'} onClose={() => setModal(null)} title="Cash invested" footer={<Button onClick={() => setModal(null)} disabled={s.closing <= 0 || !!errors.downPayment}>Done</Button>}>
        <div className="space-y-4">
          {downField}
          {closingField}
        </div>
      </Modal>
      <WorksheetModal open={modal === 'worksheet'} onClose={() => setModal('cash')} items={worksheet} onApply={(w) => { setWorksheet(w); set({ closing: sumWorksheet(w) }); }} />
    </CalculatorShell>
  );
}

function ResultPanel({ r, wide, price }: { r: AppreciationToolResult; wide: boolean; price: number }) {
  const color = MODE_COLOR[r.mode];
  const gain = r.appreciation >= 0;
  return (
    <Card className={cx(wide && 'lg:flex lg:items-stretch lg:gap-8')}>
      <div className={cx('min-w-0', wide && 'lg:w-[42%] lg:border-r lg:border-slate-100 lg:pr-8')}>
        <div className="flex items-center gap-2">
          <SeriesDot color={color} />
          <SectionLabel>{APPRECIATION_MODE_LABEL[r.mode]} appreciation</SectionLabel>
        </div>
        <div className="mt-3 text-sm text-slate-500">Est. home value in {r.years} year{r.years === 1 ? '' : 's'}</div>
        <div className="mt-1 text-4xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-5xl">{usd(r.homeValue)}</div>
        <div className="mt-2 text-sm text-slate-500">
          from {usd(price)} at <span className="font-semibold text-slate-700">{pct(r.effectiveRatePct, 2)}</span> per year
          {r.mode === 'forecast' && <span className="text-slate-400"> (effective rate of the forecast curve)</span>}
        </div>
      </div>
      <div className={cx('mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2', wide && 'lg:mt-0 lg:flex-1 lg:content-center')}>
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-xs font-medium text-slate-500">Appreciation</div>
          <div className={cx('mt-1 text-2xl font-semibold tabular-nums', gain ? 'text-gain' : 'text-loss')}>{usd(r.appreciation, { sign: true })}</div>
          <div className="mt-0.5 text-xs text-slate-500">{usd(r.appreciationAvgPerYear, { sign: true })} avg/yr</div>
        </div>
        <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4">
          <div className="text-xs font-medium text-slate-500">ROI on cash invested</div>
          <div className={cx('mt-1 text-2xl font-semibold tabular-nums', r.roiPct >= 0 ? 'text-brand-700' : 'text-loss')}>{pct(r.roiPct, 0, { sign: true })}</div>
          <div className="mt-0.5 text-xs text-slate-500">
            {pct(r.roiAvgPerYearPct, 0, { sign: true })} avg/yr · on {usd(r.cashInvested)}
          </div>
        </div>
      </div>
    </Card>
  );
}

function WorksheetModal({ open, onClose, items, onApply }: { open: boolean; onClose: () => void; items: ClosingCostItem[]; onApply: (items: ClosingCostItem[]) => void }) {
  const [draft, setDraft] = useState<ClosingCostItem[]>(items);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setDraft(items);
  }
  const total = sumWorksheet(draft);
  const upd = (id: string, patch: Partial<ClosingCostItem>) => setDraft((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Closing cost worksheet"
      description="Itemize closing costs — the total fills the Closing Costs field."
      size="lg"
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => setDraft(DEFAULT_CLOSING_WORKSHEET)}>
            Reset
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={total <= 0}
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            Use {usd(total)}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {draft.map((it) => (
          <div key={it.id} className="flex items-center gap-2">
            <TextInput aria-label="Item" value={it.label} onChange={(e) => upd(it.id, { label: e.target.value })} className="min-w-0 flex-1" />
            <div className="w-32 shrink-0 sm:w-36">
              <NumberInput ariaLabel={`${it.label} amount`} prefix="$" decimals={0} min={0} value={it.amount} onChange={(amount) => upd(it.id, { amount })} />
            </div>
            <button type="button" aria-label={`Remove ${it.label}`} onClick={() => setDraft((d) => d.filter((x) => x.id !== it.id))} className="rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-red-600">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <Button variant="subtle" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setDraft((d) => [...d, { id: `item-${Date.now()}`, label: 'Other', amount: 0 }])}>
          Add line item
        </Button>
        <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3">
          <span className="text-sm font-semibold text-slate-700">Total closing costs</span>
          <span className={cx('text-lg font-semibold tabular-nums', total > 0 ? 'text-slate-900' : 'text-red-600')}>{usd(total)}</span>
        </div>
        {total <= 0 && <p className="text-xs font-medium text-red-600">Closing costs must be greater than $0</p>}
      </div>
    </Modal>
  );
}
