'use client';

/**
 * Cost of Waiting (standalone). Step 1 Property → Step 2 Loan → Results: Benefit of Buying Now
 * for the chosen wait period, cost breakdown, payment now vs waiting, Today vs waiting table,
 * Edit Waiting modal (price, rate/APR, closing, MI per column). Defaults to FALLING future rates.
 */
import { ArrowRight, Hourglass, Minus, Pencil, Plus, RotateCcw, TrendingDown, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalculatorShell } from '@/components/calc/CalculatorShell';
import { ChartCard, ChartTooltip } from '@/components/calc/ChartCard';
import { ClientPicker, requireClient } from '@/components/calc/ClientPicker';
import { ComparisonTable } from '@/components/calc/ComparisonTable';
import { PropertyEditor } from '@/components/calc/PropertyEditor';
import { ReportFooter } from '@/components/calc/ReportFooter';
import { ResultsHeader } from '@/components/calc/ResultsHeader';
import { Stepper } from '@/components/calc/Stepper';
import { TalkTrack } from '@/components/calc/TalkTrack';
import { Badge, Button, Callout, Card, Field, Modal, NumberInput, Segmented, Select, cx } from '@/components/ui';
import { getLocation } from '@/data/mock/locations';
import { benefitByPeriod, benefitOfBuyingNow, futurePrice, periodLabel, todayColumn, waitColumns, type CowColumn, type CowInput, type WaitColumn } from '@/lib/calculations/costOfWaiting';
import { displayedRate } from '@/lib/calculations/appreciation';
import { axisProps, axisUsd, gridProps, SERIES } from '@/lib/chartTheme';
import { pct, usd } from '@/lib/format';
import { useStore } from '@/lib/store';
import { useUrlState } from '@/lib/useUrlState';
import { ClientEditModal, CoBrandingSection, PartnerBlock, StepCard } from '../loan-compare/shared';
import { COW_DEFAULTS, toCowInput, type CowLoan, type CowState } from './state';

const STEPS = ['Property', 'Loan', 'Results'];
const shortPeriod = (m: number) => (m === 0 ? 'Today' : m < 12 ? `${m} mo` : `${(m / 12).toLocaleString('en-US', { maximumFractionDigits: 1 })} yr`);
const smallUsd = (v: number) => (Math.abs(v) < 10000 ? usd(v) : axisUsd(v));

export function CostOfWaitingTool() {
  const [s, setS] = useUrlState<CowState>(COW_DEFAULTS);
  const { getClient } = useStore();
  const [clientError, setClientError] = useState<string | null>(null);
  const [clientOpen, setClientOpen] = useState(false);
  const [waitOpen, setWaitOpen] = useState(false);
  const set = (patch: Partial<CowState>) => setS((p) => ({ ...p, ...patch }));
  const client = getClient(s.clientId);
  const loc = getLocation(s.property.locationId);
  const input = useMemo(() => toCowInput(s), [s]);

  const next = () => {
    const err = requireClient(s.clientId);
    setClientError(err);
    if (!err) set({ step: 1 });
  };

  if (s.step < 2) {
    return (
      <CalculatorShell toolId="cost-of-waiting" subtitle="Show what waiting to buy really costs: a more expensive house, a different rate, and the cost to refinance if rates fall.">
        <Stepper steps={STEPS} current={s.step} onStep={(i) => set({ step: i as 0 | 1 })} />
        {s.step === 0 ? (
          <StepCard
            title="Property"
            subtitle="Price today, location and how fast prices are rising"
            footer={
              <>
                <span className="text-xs text-slate-500">Cost of Waiting uses a 4% custom appreciation by default</span>
                <Button onClick={next} icon={<ArrowRight className="h-4 w-4" />} className="flex-row-reverse">
                  Next
                </Button>
              </>
            }
          >
            <div className="space-y-6">
              <div className="max-w-md">
                <ClientPicker
                  value={s.clientId}
                  error={clientError}
                  onChange={(clientId) => {
                    set({ clientId });
                    if (clientId) setClientError(null);
                  }}
                />
              </div>
              <PropertyEditor value={s.property} onChange={(property) => set({ property })} showAlternates={false} />
            </div>
          </StepCard>
        ) : (
          <StepCard
            title="Loan options"
            subtitle="Today’s loan — the waiting scenarios keep the same down-payment percent"
            footer={
              <>
                <Button variant="secondary" onClick={() => set({ step: 0 })}>
                  Back
                </Button>
                <Button onClick={() => set({ step: 2 })}>Calculate</Button>
              </>
            }
          >
            <LoanFields loan={s.loan} price={s.property.price} onChange={(loan) => set({ loan })} />
            <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Waiting assumptions</div>
                  <div className="text-xs text-slate-500">Defaults assume rates fall — edit any column</div>
                </div>
                <Button variant="secondary" size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setWaitOpen(true)}>
                  Edit waiting
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {waitColumns(input).map((c) => (
                  <div key={c.key} className="rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200">
                    <div className="text-xs text-slate-500">{c.label}</div>
                    <div className="font-semibold tabular-nums text-slate-900">{pct(c.ratePct, 3)}</div>
                    <div className="text-xs tabular-nums text-slate-500">{usd(c.price)}</div>
                  </div>
                ))}
              </div>
            </div>
          </StepCard>
        )}
        <EditWaitingModal open={waitOpen} onClose={() => setWaitOpen(false)} state={s} onSave={(waits, refiCostPct) => set({ waits, refiCostPct })} />
      </CalculatorShell>
    );
  }

  return <CowResults s={s} set={set} input={input} clientName={client?.name} onEditClient={() => setClientOpen(true)} onEditWaiting={() => setWaitOpen(true)} locLabel={loc.label}>
    <ClientEditModal open={clientOpen} onClose={() => setClientOpen(false)} value={s.clientId} onChange={(clientId) => set({ clientId })} />
    <EditWaitingModal open={waitOpen} onClose={() => setWaitOpen(false)} state={s} onSave={(waits, refiCostPct) => set({ waits, refiCostPct })} />
  </CowResults>;
}

/* ------------------------------------------------------------------ loan form */

function LoanFields({ loan, price, onChange }: { loan: CowLoan; price: number; onChange: (l: CowLoan) => void }) {
  const [unit, setUnit] = useState<'fee' | 'percentage'>('percentage');
  const set = (p: Partial<CowLoan>) => onChange({ ...loan, ...p });
  const down = (price * loan.downPct) / 100;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field
        label="Down Payment"
        right={<Segmented size="sm" ariaLabel="Down payment unit" value={unit} onChange={setUnit} options={[{ value: 'fee', label: '$' }, { value: 'percentage', label: '%' }]} />}
        hint={unit === 'fee' ? `${pct(loan.downPct, 2)} · loan ${usd(price - down)}` : `${usd(down)} · loan ${usd(price - down)}`}
      >
        {unit === 'percentage' ? (
          <NumberInput ariaLabel="Down payment percent" suffix="%" decimals={3} min={0} max={99} value={loan.downPct} onChange={(downPct) => set({ downPct })} />
        ) : (
          <NumberInput ariaLabel="Down payment amount" prefix="$" decimals={0} min={0} value={Math.round(down)} onChange={(v) => set({ downPct: price > 0 ? Math.min(99, (v / price) * 100) : 0 })} />
        )}
      </Field>
      <Field label="Term">
        <Select ariaLabel="Term" value={String(loan.termYears)} onChange={(v) => set({ termYears: Number(v) })} options={['30', '25', '20', '15', '10'].map((t) => ({ value: t, label: `${t} years` }))} />
      </Field>
      <Field label="Program / Type" hint="Cost of Waiting compares conventional fixed loans">
        <Select ariaLabel="Program" disabled value="Conventional Fixed" onChange={() => undefined} options={['Conventional Fixed']} />
      </Field>
      <Field label="Rate">
        <NumberInput ariaLabel="Rate" suffix="%" decimals={3} min={0} max={25} value={loan.ratePct} onChange={(ratePct) => set({ ratePct, aprPct: loan.aprPct === loan.ratePct ? ratePct : loan.aprPct })} />
      </Field>
      <Field label="APR">
        <NumberInput ariaLabel="APR" suffix="%" decimals={3} min={0} max={30} value={loan.aprPct} onChange={(aprPct) => set({ aprPct })} />
      </Field>
      <Field label="Monthly MI">
        <NumberInput ariaLabel="Monthly MI" prefix="$" suffix="/mo" decimals={2} min={0} value={loan.miMonthly} onChange={(miMonthly) => set({ miMonthly })} />
      </Field>
      <Field label="Closing costs">
        <NumberInput ariaLabel="Closing costs" prefix="$" decimals={0} min={0} value={loan.closingCosts} onChange={(closingCosts) => set({ closingCosts })} />
      </Field>
    </div>
  );
}

/* ------------------------------------------------------------------ edit waiting modal */

function EditWaitingModal({ open, onClose, state, onSave }: { open: boolean; onClose: () => void; state: CowState; onSave: (w: WaitColumn[], refiPct: number) => void }) {
  const [draft, setDraft] = useState<WaitColumn[]>(state.waits);
  const [refi, setRefi] = useState(state.refiCostPct);
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDraft(state.waits);
      setRefi(state.refiCostPct);
    }
  }
  const input = toCowInput({ ...state, waits: draft });
  const up = (i: number, p: Partial<WaitColumn>) => setDraft((d) => d.map((w, j) => (j === i ? { ...w, ...p } : w)));
  const rate = displayedRate(getLocation(state.property.locationId), state.property.appreciation);
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Edit waiting"
      description={`Price, rate and closing costs if your client waits. Prices default to ${pct(rate, 3)}/yr appreciation.`}
      footer={
        <>
          <Button variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setDraft(COW_DEFAULTS.waits)}>
            Restore defaults
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(draft, refi);
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {draft.map((w, i) => {
          const price = futurePrice(input, w);
          return (
            <div key={w.months} className="space-y-3 rounded-xl border border-slate-200 p-3">
              <div className="text-sm font-semibold text-slate-900">Wait {periodLabel(w.months)}</div>
              <Field
                label="Price"
                right={
                  w.priceOverride != null && (
                    <button type="button" className="text-[11px] font-medium text-brand-700 hover:underline" onClick={() => up(i, { priceOverride: null })}>
                      Reset
                    </button>
                  )
                }
              >
                <NumberInput ariaLabel={`Price after ${periodLabel(w.months)}`} prefix="$" decimals={0} min={0} value={Math.round(price)} onChange={(v) => up(i, { priceOverride: v })} />
              </Field>
              <Field label="Rate">
                <NumberInput ariaLabel={`Rate after ${periodLabel(w.months)}`} suffix="%" decimals={3} min={0} max={25} value={w.ratePct} onChange={(ratePct) => up(i, { ratePct, aprPct: w.aprPct === w.ratePct ? ratePct : w.aprPct })} />
              </Field>
              <Field label="APR">
                <NumberInput ariaLabel={`APR after ${periodLabel(w.months)}`} suffix="%" decimals={3} min={0} max={30} value={w.aprPct} onChange={(aprPct) => up(i, { aprPct })} />
              </Field>
              <Field label="Closing">
                <NumberInput ariaLabel={`Closing after ${periodLabel(w.months)}`} prefix="$" decimals={0} min={0} value={w.closingCosts} onChange={(closingCosts) => up(i, { closingCosts })} />
              </Field>
              <Field label="MI">
                <NumberInput ariaLabel={`MI after ${periodLabel(w.months)}`} prefix="$" suffix="/mo" decimals={2} min={0} value={w.miMonthly} onChange={(miMonthly) => up(i, { miMonthly })} />
              </Field>
            </div>
          );
        })}
      </div>
      <div className="mt-4 max-w-xs">
        <Field label="Refinance cost (if rates fall)" hint="Percent of today’s loan — applies only when the waiting rate is lower than today’s">
          <NumberInput ariaLabel="Refinance cost percent" suffix="% of loan" decimals={3} min={0} max={10} value={refi} onChange={setRefi} />
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ results */

function CowResults({
  s,
  set,
  input,
  clientName,
  onEditClient,
  onEditWaiting,
  locLabel,
  children,
}: {
  s: CowState;
  set: (p: Partial<CowState>) => void;
  input: CowInput;
  clientName?: string;
  onEditClient: () => void;
  onEditWaiting: () => void;
  locLabel: string;
  children: React.ReactNode;
}) {
  const b = benefitOfBuyingNow(input, s.waitMonths);
  const all = benefitByPeriod(input);
  const now = todayColumn(input);
  const waits = waitColumns(input);
  const cols: CowColumn[] = [now, ...waits];
  const ratesFall = b.wait.ratePct < now.ratePct;
  const appreciationPct = now.price > 0 ? (b.appreciation / now.price) * 100 : 0;
  // Talk-track alternative: same wait, rate rises to today + 0.5% (7.0% for the 6.5% example).
  const riseRate = Math.round((now.ratePct + 0.5) * 1000) / 1000;
  const rise = benefitOfBuyingNow({ ...input, waits: input.waits.map((w) => (w.months === b.months ? { ...w, ratePct: riseRate, aprPct: riseRate } : w)) }, b.months);

  const rows = [
    { label: 'Property', get: (c: CowColumn) => (c.months === 0 ? usd(c.price) : `${usd(c.price)} (${pct(c.priceChangePct, 2, { sign: true })})`) },
    { label: 'Loan', get: (c: CowColumn) => usd(c.loan) },
    { label: 'Down payment', get: (c: CowColumn) => usd(c.down) },
    { label: 'Rate', get: (c: CowColumn) => pct(c.ratePct, 3) },
    { label: 'APR', get: (c: CowColumn) => pct(c.aprPct, 3) },
    { label: 'Mortgage insurance', get: (c: CowColumn) => usd(c.mi) },
    { label: 'Annual P&I', get: (c: CowColumn) => usd(c.annualPI) },
    { label: 'Monthly P&I', get: (c: CowColumn) => usd(c.pi) },
    { label: 'Taxes / mo', get: (c: CowColumn) => usd(c.taxes) },
    { label: 'Insurance + HOA / mo', get: (c: CowColumn) => usd(c.insurance + c.hoa) },
    { label: 'Total monthly', get: (c: CowColumn) => usd(c.totalMonthly), strong: true },
    { label: 'Total annual', get: (c: CowColumn) => usd(c.totalAnnual), strong: true },
    { label: 'Cash to close', get: (c: CowColumn) => usd(c.cashToClose) },
  ];

  const csv = () => [['Metric', ...cols.map((c) => c.label)], ...rows.map((r) => [r.label, ...cols.map((c) => r.get(c))]), [], ['Benefit of buying now', `${periodLabel(b.months)} wait`], ['Appreciation', b.appreciation], ['Cumulative payment difference', b.cumulativeDiff], ['Refinance cost', -b.refinanceCost], ['Benefit', b.benefit]];

  const payData = cols.map((c) => ({ name: shortPeriod(c.months), pi: Math.round(c.pi), mi: Math.round(c.mi), taxes: Math.round(c.taxes), ins: Math.round(c.insurance + c.hoa), total: Math.round(c.totalMonthly) }));
  const anyMi = cols.some((c) => c.mi > 0);
  const stack = [
    { key: 'pi', label: 'P&I', color: SERIES[0] },
    ...(anyMi ? [{ key: 'mi', label: 'MI', color: SERIES[1] }] : []),
    { key: 'taxes', label: 'Taxes', color: SERIES[2] },
    { key: 'ins', label: 'Insurance + HOA', color: SERIES[3] },
  ];

  const steps: { label: string; sub: string; value: number; icon: React.ReactNode }[] = [
    { label: 'Home price appreciation', sub: `${usd(now.price)} → ${usd(b.wait.price)} (${pct(appreciationPct, 2, { sign: true })})`, value: b.appreciation, icon: <TrendingUp className="h-4 w-4" /> },
    { label: 'Cumulative payment difference', sub: `${usd(b.monthlyDiff, { sign: true })}/mo × ${b.months} months (${usd(now.totalMonthly)} now vs ${usd(b.wait.totalMonthly)} waiting)`, value: b.cumulativeDiff, icon: b.cumulativeDiff >= 0 ? <Plus className="h-4 w-4" /> : <Minus className="h-4 w-4" /> },
    { label: 'Refinance cost', sub: b.refinanceApplies ? `${pct(s.refiCostPct, 3)} of ${usd(now.loan)} — buy now, refinance to ${pct(b.wait.ratePct, 3)} later` : `Not needed — waiting rate ${pct(b.wait.ratePct, 3)} isn’t lower than ${pct(now.ratePct, 3)}`, value: -b.refinanceCost, icon: <TrendingDown className="h-4 w-4" /> },
  ];
  const maxAbs = Math.max(1, ...steps.map((x) => Math.abs(x.value)), Math.abs(b.benefit));

  return (
    <CalculatorShell toolId="cost-of-waiting" subtitle={`${clientName ?? 'No client'} · ${usd(now.price)} · ${locLabel}`}>
      <ResultsHeader
        toolId="cost-of-waiting"
        scenarioTitle={`Cost of Waiting · ${usd(now.price)} · ${periodLabel(b.months)}`}
        clientId={s.clientId}
        onBack={() => set({ step: 1 })}
        data={s}
        csv={csv}
        emailBody={`Hi ${clientName ?? 'there'},\n\nWaiting ${periodLabel(b.months)} to buy would cost about ${usd(b.benefit)}: the home is projected to cost ${usd(b.appreciation)} more, payments change by ${usd(b.monthlyDiff, { sign: true })}/mo${b.refinanceApplies ? `, less ${usd(b.refinanceCost)} you’d spend to refinance if rates fall` : ''}.`}
        chips={[
          { label: 'Client', value: clientName ?? 'Client name is required', onEdit: onEditClient },
          { label: 'Property', value: `${usd(now.price)} · ${locLabel}`, onEdit: () => set({ step: 0 }) },
          { label: 'Loan', value: `${usd(now.loan)} · ${pct(now.ratePct, 3)} · ${s.loan.termYears} yr`, onEdit: () => set({ step: 1 }) },
          { label: 'Waiting', value: waits.map((w) => pct(w.ratePct, 3)).join(' / '), onEdit: onEditWaiting },
        ]}
      />
      {!clientName && (
        <Callout tone="error" title="Client name is required">
          <button type="button" className="font-semibold underline" onClick={onEditClient}>
            Choose a client
          </button>{' '}
          so the report is addressed correctly.
        </Callout>
      )}

      {/* ---------------------------------------------------------- hero */}
      <Card padded={false} className="overflow-hidden">
        <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 px-5 py-6 text-white sm:px-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/75">
                <Hourglass className="h-3.5 w-3.5" /> Benefit of buying now
              </span>
              <div className="rounded-lg bg-white/15 p-0.5" role="radiogroup" aria-label="Wait period">
                {input.waits.map((w) => (
                  <button
                    key={w.months}
                    type="button"
                    role="radio"
                    aria-checked={s.waitMonths === w.months}
                    onClick={() => set({ waitMonths: w.months })}
                    className={cx('rounded-md px-2.5 py-1 text-xs font-semibold transition-colors', s.waitMonths === w.months ? 'bg-white text-brand-700 shadow-sm' : 'text-white/80 hover:text-white')}
                  >
                    {shortPeriod(w.months)}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-5 text-sm text-white/80">If {clientName ? clientName.split(' ')[0] : 'your client'} waits {periodLabel(b.months)}, it costs</div>
            <div className="mt-1 text-5xl font-bold tabular-nums tracking-tight">{usd(b.benefit)}</div>
            <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm tabular-nums text-white/90">
              <span>Appreciation {usd(b.appreciation)}</span>
              <span className="text-white/60">{b.cumulativeDiff < 0 ? '−' : '+'}</span>
              <span>Payment diff {usd(Math.abs(b.cumulativeDiff))}</span>
              <span className="text-white/60">−</span>
              <span>Refinance {usd(b.refinanceCost)}</span>
            </div>
            <div className="mt-4 text-xs text-white/70">
              Future rate assumption: {pct(b.wait.ratePct, 3)} ({ratesFall ? 'rates fall' : b.wait.ratePct > now.ratePct ? 'rates rise' : 'unchanged'}) ·{' '}
              <button type="button" onClick={onEditWaiting} className="font-semibold text-white underline-offset-2 hover:underline">
                Edit waiting
              </button>
            </div>
          </div>
          <div className="grid gap-px bg-slate-200 sm:grid-cols-3 lg:grid-cols-1">
            <HeroStat label={`Property in ${periodLabel(b.months)}`} value={usd(b.wait.price)} sub={`${usd(b.appreciation, { sign: true })} (${pct(appreciationPct, 2, { sign: true })})`} tone="loss" />
            <HeroStat label="Payment difference" value={`${usd(b.monthlyDiff, { sign: true })}/mo`} sub={`Now ${usd(now.totalMonthly)}/mo vs waiting ${usd(b.wait.totalMonthly)}/mo`} tone={b.monthlyDiff > 0 ? 'loss' : b.monthlyDiff < 0 ? 'gain' : undefined} />
            <HeroStat label={`Cumulative over ${b.months} months`} value={usd(b.cumulativeDiff, { sign: true })} sub={b.refinanceApplies ? `Refinance avoided by waiting: ${usd(b.refinanceCost)}` : 'No refinance cost applies'} tone={b.cumulativeDiff > 0 ? 'loss' : b.cumulativeDiff < 0 ? 'gain' : undefined} />
          </div>
        </div>
      </Card>

      {ratesFall && (
        <Callout tone="info" title="Even if rates fall, waiting still costs">
          This scenario assumes rates drop to {pct(b.wait.ratePct, 3)}. Buying now and refinancing later costs about {usd(b.refinanceCost)} — still {usd(b.benefit)} less than waiting for a {usd(b.appreciation)} more expensive home.
        </Callout>
      )}

      {/* ---------------------------------------------------------- charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="text-[15px] font-semibold text-slate-900">What waiting {periodLabel(b.months)} costs</h3>
          <p className="mt-0.5 text-sm text-slate-500">Cost breakdown of the benefit of buying now</p>
          <div className="mt-5 space-y-4">
            {steps.map((x) => (
              <div key={x.label}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                    <span className={cx('flex h-5 w-5 items-center justify-center rounded-full', x.value > 0 ? 'bg-red-50 text-red-600' : x.value < 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400')}>{x.icon}</span>
                    {x.label}
                  </span>
                  <span className="font-semibold tabular-nums text-slate-900">{usd(x.value, { sign: true })}</span>
                </div>
                <div className="mt-1.5 h-2.5 rounded-full bg-slate-100">
                  <div className={cx('h-2.5 rounded-full', x.value >= 0 ? 'bg-red-500/80' : 'bg-emerald-500/80')} style={{ width: `${Math.max(x.value === 0 ? 0 : 1.5, (Math.abs(x.value) / maxAbs) * 100)}%` }} />
                </div>
                <div className="mt-1 text-xs text-slate-500">{x.sub}</div>
              </div>
            ))}
            <div className="border-t border-slate-200 pt-3">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-semibold text-slate-900">Benefit of buying now</span>
                <span className="text-lg font-bold tabular-nums text-slate-900">{usd(b.benefit)}</span>
              </div>
              <div className="mt-1.5 h-2.5 rounded-full bg-slate-100">
                <div className="h-2.5 rounded-full bg-brand-600" style={{ width: `${(Math.abs(b.benefit) / maxAbs) * 100}%` }} />
              </div>
            </div>
          </div>
          <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="mb-2 text-xs font-medium text-slate-500">By wait period</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {all.map((x) => (
                <button
                  key={x.months}
                  type="button"
                  onClick={() => set({ waitMonths: x.months })}
                  className={cx('rounded-lg border px-3 py-2 text-left transition-colors', x.months === b.months ? 'border-brand-400 bg-brand-50/70' : 'border-slate-200 hover:border-slate-300')}
                >
                  <div className="text-xs text-slate-500">{periodLabel(x.months)}</div>
                  <div className="font-semibold tabular-nums text-slate-900">{usd(x.benefit)}</div>
                </button>
              ))}
            </div>
          </div>
        </Card>

        <ChartCard
          title="Payment now vs waiting"
          subtitle="Total monthly payment by when you buy"
          legend={stack.map((x) => ({ label: x.label, color: x.color }))}
          table={{ head: ['When', 'P&I', 'MI', 'Taxes', 'Ins + HOA', 'Total'], rows: payData.map((d) => [d.name, usd(d.pi), usd(d.mi), usd(d.taxes), usd(d.ins), usd(d.total)]) }}
          height={340}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={payData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="name" {...axisProps} interval={0} />
              <YAxis {...axisProps} tickFormatter={smallUsd} width={60} />
              <Tooltip cursor={{ fill: 'rgba(100,116,139,0.08)' }} content={<ChartTooltip format={(v) => usd(v)} />} />
              {stack.map((x, i) => (
                <Bar key={x.key} dataKey={x.key} name={x.label} stackId="pay" fill={x.color} stroke="#fff" strokeWidth={1} radius={i === stack.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} maxBarSize={48} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ---------------------------------------------------------- table */}
      <Card>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900">Today vs waiting</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              Prices grow at {pct(displayedRate(getLocation(s.property.locationId), s.property.appreciation), 3)}/yr; loan keeps {pct(100 - s.loan.downPct, 2)} of price; taxes scale with price.
            </p>
          </div>
          <Button variant="secondary" size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={onEditWaiting}>
            Edit waiting
          </Button>
        </div>
        <ComparisonTable
          columns={cols.map((c) => (
            <span key={c.key} className="inline-flex items-center gap-1.5">
              {c.label}
              {c.months === b.months && <Badge tone="brand">Selected</Badge>}
            </span>
          ))}
          rows={rows.map((r) => ({ label: r.label, strong: r.strong, values: cols.map((c) => r.get(c)) }))}
        />
      </Card>

      <TalkTrack>
        {ratesFall ? (
          <>
            “Even if rates FALL to {pct(b.wait.ratePct, 3)}, waiting {periodLabel(b.months)} costs {usd(b.benefit)} — the house gets {usd(b.appreciation)} more expensive. If rates rise to {pct(riseRate, 3)}, waiting costs {usd(rise.benefit)}.”
          </>
        ) : (
          <>
            “If rates are {pct(b.wait.ratePct, 3)} in {periodLabel(b.months)}, waiting costs {usd(b.benefit)} — the house gets {usd(b.appreciation)} more expensive and the payment is {usd(Math.abs(b.monthlyDiff))}/mo {b.monthlyDiff >= 0 ? 'higher' : 'lower'}, {usd(Math.abs(b.cumulativeDiff))} over {b.months} months.”
          </>
        )}
      </TalkTrack>

      <div className="no-print">
        <CoBrandingSection hideOwn partnerIdx={s.partnerIdx} onPartnerChange={(partnerIdx) => set({ partnerIdx })} />
      </div>
      <PartnerBlock partnerIdx={s.partnerIdx} />
      <ReportFooter />
      {children}
    </CalculatorShell>
  );
}

function HeroStat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'gain' | 'loss' }) {
  return (
    <div className="bg-white px-5 py-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold tabular-nums tracking-tight', tone === 'loss' ? 'text-red-600' : tone === 'gain' ? 'text-emerald-700' : 'text-slate-900')}>{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{sub}</div>
    </div>
  );
}
