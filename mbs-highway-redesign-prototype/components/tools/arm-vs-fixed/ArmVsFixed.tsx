'use client';

import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalculatorShell } from '@/components/calc/CalculatorShell';
import { ChartCard, ChartTooltip } from '@/components/calc/ChartCard';
import { ClientPicker, requireClient } from '@/components/calc/ClientPicker';
import { ComparisonTable } from '@/components/calc/ComparisonTable';
import { ReportFooter } from '@/components/calc/ReportFooter';
import { ResultsHeader } from '@/components/calc/ResultsHeader';
import { TalkTrack } from '@/components/calc/TalkTrack';
import { Badge, Card, CardHeader, DataTable, Field, NumberInput, Segmented, Select, Slider, cx } from '@/components/ui';
import { ARM_DEFAULTS, simulateArmVsFixed, type ArmScenario } from '@/lib/calculations/armVsFixed';
import { CHART, SERIES, axisProps, gridProps } from '@/lib/chartTheme';
import { pct, usd, yearsMonths } from '@/lib/format';
import { useStore } from '@/lib/store';
import { useUrlState } from '@/lib/useUrlState';
import { CalcFooter, INPUTS_ID, axisUsdFine, focusInputs, useDraft } from '../payment/kit';

const INPUT_DEFAULTS = {
  clientId: 'c-alex-rivera' as string | null,
  loanAmount: ARM_DEFAULTS.loanAmount,
  termYears: ARM_DEFAULTS.termYears,
  fixedRate: ARM_DEFAULTS.fixedRate,
  fixedApr: 6.5,
  armRate: ARM_DEFAULTS.armRate,
  fixedYears: ARM_DEFAULTS.fixedYears,
  adjustMonths: ARM_DEFAULTS.adjustMonths,
  scenario: ARM_DEFAULTS.scenario as ArmScenario,
  capInitial: 5,
  capPeriodic: 2,
  capLifetime: 5,
  floorRate: ARM_DEFAULTS.floorRate,
  customTargetRate: ARM_DEFAULTS.customTargetRate,
};
type Inputs = typeof INPUT_DEFAULTS;
const DEFAULTS = { inp: INPUT_DEFAULTS, reinvest: false, year: 8 };

const SCENARIO_LABEL: Record<ArmScenario, string> = { worst: 'Worst case', best: 'Best case', custom: 'Custom path' };

export function ArmVsFixed() {
  const [s, setS, hydrated] = useUrlState(DEFAULTS);
  const [draft, patch, dirty, setDraft] = useDraft<Inputs>(s.inp, hydrated);
  const { getClient } = useStore();
  const clientErr = requireClient(draft.clientId);
  const committedClientErr = requireClient(s.inp.clientId);

  const inp = s.inp;
  const r = useMemo(
    () =>
      simulateArmVsFixed({
        loanAmount: inp.loanAmount,
        termYears: inp.termYears,
        fixedRate: inp.fixedRate,
        armRate: inp.armRate,
        fixedYears: inp.fixedYears,
        adjustMonths: inp.adjustMonths,
        caps: { initial: inp.capInitial, periodic: inp.capPeriodic, lifetime: inp.capLifetime },
        scenario: inp.scenario,
        floorRate: inp.floorRate,
        customTargetRate: inp.customTargetRate,
        reinvest: s.reinvest,
      }),
    [inp, s.reinvest],
  );

  const year = Math.min(Math.max(1, s.year), r.years.length || 1);
  const sel = r.years[year - 1];
  const prev = r.years[year - 2];
  const fy = inp.fixedYears;
  const firstAdj = r.years[fy];
  const be = r.breakEvenMonth;
  const client = getClient(inp.clientId);
  const product = `${fy}/${inp.adjustMonths === 6 ? '6' : '1'} ARM`;

  const submit = () => {
    if (clientErr) return;
    setS((p) => ({ ...p, inp: draft }));
  };

  const pathData = r.years.map((y) => ({ year: y.year, fixed: y.fixedPayment, arm: y.armPayment, rate: y.armRate }));
  const savingsData = r.months.filter((m) => m.month % 3 === 0 || m.month === 1).map((m) => ({ t: m.month / 12, total: m.total, cashflow: m.cashflow, principal: m.principalGained }));
  const beYear = be ? be / 12 : null;
  const [range, setRange] = useState<'focus' | 'full'>('focus');
  const focusYears = Math.min(inp.termYears, Math.max(12, be ? Math.ceil(be / 12) + 4 : fy + 6));
  const horizon = range === 'full' ? inp.termYears : focusYears;
  const tickStep = horizon > 15 ? 5 : horizon > 8 ? 2 : 1;
  const savingsShown = savingsData.filter((d) => d.t <= horizon);
  const maxPay = Math.max(...r.years.map((y) => y.armPayment), r.fixedPayment);

  const inputs = (
    <form
      id={INPUTS_ID}
      className="scroll-mt-32 space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <ClientPicker value={draft.clientId} onChange={(clientId) => patch({ clientId })} error={dirty || committedClientErr ? clientErr : null} />
      <Field label="Loan Amount">
        <NumberInput ariaLabel="Loan Amount" prefix="$" decimals={0} min={0} max={100_000_000} value={draft.loanAmount} onChange={(loanAmount) => patch({ loanAmount })} />
      </Field>
      <Field label="Term">
        <Select ariaLabel="Term" value={String(draft.termYears)} onChange={(v) => patch({ termYears: Number(v), fixedYears: Math.min(draft.fixedYears, Number(v) - 1) })} options={[30, 25, 20, 15].map((y) => ({ value: String(y), label: `${y} years` }))} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fixed Rate">
          <NumberInput ariaLabel="Fixed Rate" suffix="%" decimals={3} min={0} max={30} value={draft.fixedRate} onChange={(fixedRate) => patch({ fixedRate })} />
        </Field>
        <Field label="APR">
          <NumberInput ariaLabel="Fixed APR" suffix="%" decimals={3} min={0} max={30} value={draft.fixedApr} onChange={(fixedApr) => patch({ fixedApr })} />
        </Field>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-4">
        <Field label="ARM Term">
          <Segmented
            ariaLabel="ARM Term"
            className="w-full [&>button]:flex-1"
            value={String(draft.fixedYears)}
            onChange={(v) => patch({ fixedYears: Number(v) })}
            options={[3, 5, 7, 10].filter((y) => y < draft.termYears).map((y) => ({ value: String(y), label: `${y}/1` }))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ARM Rate">
            <NumberInput ariaLabel="ARM Rate" suffix="%" decimals={3} min={0} max={30} value={draft.armRate} onChange={(armRate) => patch({ armRate })} />
          </Field>
          <Field label="Adjusts every">
            <Select ariaLabel="Adjustment frequency" value={String(draft.adjustMonths)} onChange={(v) => patch({ adjustMonths: Number(v) })} options={[{ value: '12', label: '1 year' }, { value: '6', label: '6 months' }]} />
          </Field>
        </div>
        <Field label="Caps" hint="Initial / per adjustment / lifetime, in rate points">
          <div className="grid grid-cols-3 gap-2">
            <NumberInput ariaLabel="Initial cap" suffix="%" decimals={3} min={0} max={20} value={draft.capInitial} onChange={(capInitial) => patch({ capInitial })} />
            <NumberInput ariaLabel="Annual cap" suffix="%" decimals={3} min={0} max={20} value={draft.capPeriodic} onChange={(capPeriodic) => patch({ capPeriodic })} />
            <NumberInput ariaLabel="Lifetime cap" suffix="%" decimals={3} min={0} max={20} value={draft.capLifetime} onChange={(capLifetime) => patch({ capLifetime })} />
          </div>
          <div className="mt-1 grid grid-cols-3 gap-2 text-[11px] text-slate-500">
            <span>Initial</span>
            <span>Annual</span>
            <span>Lifetime</span>
          </div>
        </Field>
        <Field label="Scenario">
          <Segmented
            ariaLabel="Scenario"
            className="w-full [&>button]:flex-1"
            value={draft.scenario}
            onChange={(scenario) => patch({ scenario })}
            options={[
              { value: 'worst', label: 'Worst' },
              { value: 'best', label: 'Best' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
        </Field>
        {draft.scenario === 'best' && (
          <Field label="Floor (margin)" hint="Best case: the rate falls by the caps until it reaches the floor.">
            <NumberInput ariaLabel="Floor rate" suffix="%" decimals={3} min={0} max={30} value={draft.floorRate} onChange={(floorRate) => patch({ floorRate })} />
          </Field>
        )}
        {draft.scenario === 'custom' && (
          <Field label="Fully-indexed rate (index + margin)" hint="The ARM moves toward this rate at each adjustment, limited by the caps.">
            <NumberInput ariaLabel="Fully-indexed rate" suffix="%" decimals={3} min={0} max={30} value={draft.customTargetRate} onChange={(customTargetRate) => patch({ customTargetRate })} />
          </Field>
        )}
      </div>
      <CalcFooter label="Continue" onClick={submit} dirty={dirty} error={dirty || committedClientErr ? clientErr : null} onReset={() => setDraft(INPUT_DEFAULTS)} />
    </form>
  );

  const csv = () => [
    ['Year', 'ARM rate %', 'Fixed P&I', 'ARM P&I', 'Monthly difference', 'Cash flow to date', 'Principal gained', 'Total savings', 'Fixed balance', 'ARM balance'],
    ...r.years.map((y) => [y.year, y.armRate, y.fixedPayment, y.armPayment, y.monthlyDiff, y.cashflow, y.principalGained, y.total, y.fixedBalance, y.armBalance]),
  ];

  const tableRows = r.years.map((y) => [
    <span key="y" className={cx(y.year === year && 'text-brand-700')}>Yr {y.year}</span>,
    pct(y.armRate, 3),
    usd(y.fixedPayment),
    usd(y.armPayment),
    <span key="d" className={y.monthlyDiff >= 0 ? 'text-emerald-700' : 'text-red-600'}>{usd(y.monthlyDiff, { sign: true })}</span>,
    usd(y.cashflow),
    usd(y.principalGained),
    <span key="t" className={cx('font-semibold', y.total >= 0 ? 'text-emerald-700' : 'text-red-600')}>{usd(y.total)}</span>,
    usd(y.fixedBalance),
    usd(y.armBalance),
  ]);

  const modeLabel = s.reinvest ? 'Reinvest to principal' : 'Cash in hand';

  return (
    <CalculatorShell toolId="arm-vs-fixed" subtitle="Initial ARM savings vs the payment risk after the fixed period — year by year." inputs={inputs}>
      <ResultsHeader
        toolId="arm-vs-fixed"
        clientId={inp.clientId}
        scenarioTitle={`${product} ${pct(inp.armRate, 3)} vs Fixed ${pct(inp.fixedRate, 3)}`}
        chips={[
          { label: 'Client', value: client?.name ?? 'No client', onEdit: () => focusInputs('input') },
          { label: 'Loan', value: `${usd(inp.loanAmount)} · ${inp.termYears} yr`, onEdit: () => focusInputs('[aria-label="Loan Amount"]') },
          { label: 'Fixed', value: `${pct(inp.fixedRate, 3)} · APR ${pct(inp.fixedApr, 3)}`, onEdit: () => focusInputs('[aria-label="Fixed Rate"]') },
          { label: 'ARM', value: `${product} ${pct(inp.armRate, 3)} · ${SCENARIO_LABEL[inp.scenario]}`, onEdit: () => focusInputs('[aria-label="ARM Rate"]') },
        ]}
        csv={csv}
        data={s}
        emailBody={`ARM vs Fixed for ${usd(inp.loanAmount)}: Fixed ${pct(inp.fixedRate, 3)} = ${usd(r.fixedPayment)}/mo vs ${product} ${pct(inp.armRate, 3)} = ${usd(r.armInitialPayment)}/mo. ${be ? `Under the ${SCENARIO_LABEL[inp.scenario].toLowerCase()} the ARM's advantage is gone after ${yearsMonths(be)}.` : ''}`}
      />

      {committedClientErr && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">Client name is required — select a client and press Continue.</div>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          ariaLabel="Savings mode"
          value={s.reinvest ? 'reinvest' : 'cash'}
          onChange={(v) => setS((p) => ({ ...p, reinvest: v === 'reinvest' }))}
          options={[
            { value: 'cash', label: 'Cash in hand' },
            { value: 'reinvest', label: 'Reinvest to principal' },
          ]}
        />
        <p className="text-xs text-slate-500">{s.reinvest ? 'The monthly savings are paid as extra ARM principal while the ARM payment is lower.' : 'The monthly savings stay in your pocket.'}</p>
      </div>

      {/* Headline */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="grid gap-5 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[0] }} /> {inp.termYears}-yr Fixed {pct(inp.fixedRate, 3)}
              </div>
              <div className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{usd(r.fixedPayment)}<span className="text-base font-medium text-slate-500">/mo</span></div>
            </div>
            <div className="hidden text-sm font-medium text-slate-400 sm:block">vs</div>
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[1] }} /> {product} {pct(inp.armRate, 3)}
              </div>
              <div className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{usd(r.armInitialPayment)}<span className="text-base font-medium text-slate-500">/mo</span></div>
            </div>
          </div>
          <div className={cx('mt-5 rounded-lg px-4 py-3 text-sm', r.initialMonthlySavings > 0 ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900')}>
            {r.initialMonthlySavings > 0 ? (
              <>
                The ARM saves <strong className="tabular-nums">{usd(r.initialMonthlySavings)}/mo</strong> in years 1–{fy}.
                {firstAdj && firstAdj.armPaymentChange > 0 && (
                  <>
                    {' '}
                    {SCENARIO_LABEL[inp.scenario]}, year {fy + 1} it adjusts to {pct(firstAdj.armRate, 3)}: <strong className="tabular-nums">{usd(firstAdj.armPayment)}/mo</strong> ({usd(firstAdj.armPaymentChange, { sign: true })}).
                  </>
                )}
              </>
            ) : (
              <>The ARM start rate isn’t lower than the fixed rate, so there are no initial savings.</>
            )}
          </div>
        </Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
            <div className="text-xs font-medium text-slate-500">Total savings after {fy} yrs · {modeLabel}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-gain">{usd(r.atFixedEnd.total)}</div>
            <div className="mt-0.5 text-xs text-slate-500">
              Cash flow {usd(r.atFixedEnd.cashflow)} + principal gained {usd(r.atFixedEnd.principalGained)}
            </div>
          </div>
          <div className={cx('rounded-xl border p-4', be ? 'border-slate-200 bg-white' : 'border-emerald-200 bg-white')}>
            <div className="text-xs font-medium text-slate-500">Break-even</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{r.armNeverAhead ? 'Never ahead' : be ? yearsMonths(be) : 'ARM stays ahead'}</div>
            <div className="mt-0.5 text-xs text-slate-500">{r.armNeverAhead ? 'Fixed is cheaper from day one' : be ? `Month ${be} — after this the fixed loan is ahead` : `Through all ${inp.termYears} years in this scenario`}</div>
          </div>
        </div>
      </div>

      {/* Year timeline */}
      {sel && (
        <Card>
          <CardHeader title={`Year ${year} snapshot`} subtitle="Drag through the loan to see where the ARM stands each year." action={<Badge tone={sel.total >= 0 ? 'green' : 'red'}>{sel.total >= 0 ? 'ARM ahead' : 'Fixed ahead'}</Badge>} />
          <Slider min={1} max={r.years.length} value={year} onChange={(v) => setS((p) => ({ ...p, year: v }))} label="Year" format={(v) => `Year ${v}`} ariaLabel="Year" />
          <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <div className="text-xs font-medium text-slate-500">ARM rate</div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{pct(sel.armRate, 3)}</div>
              <div className="text-xs text-slate-500">{prev && sel.armRate !== prev.armRate ? `${sel.armRate > prev.armRate ? '+' : ''}${pct(sel.armRate - prev.armRate, 3)} this year` : 'unchanged'}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">ARM P&I vs fixed</div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{usd(sel.armPayment)} <span className="text-sm font-normal text-slate-500">vs {usd(sel.fixedPayment)}</span></div>
              <div className={cx('inline-flex items-center gap-0.5 text-xs', sel.armPaymentChange > 0.5 ? 'text-red-600' : sel.armPaymentChange < -0.5 ? 'text-emerald-700' : 'text-slate-500')}>
                {sel.armPaymentChange > 0.5 ? <ArrowUpRight className="h-3 w-3" /> : sel.armPaymentChange < -0.5 ? <ArrowDownRight className="h-3 w-3" /> : null}
                {Math.abs(sel.armPaymentChange) > 0.5 ? `${usd(sel.armPaymentChange, { sign: true })} vs last year` : 'no change'}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">Total savings to date</div>
              <div className={cx('mt-1 text-lg font-semibold tabular-nums', sel.total >= 0 ? 'text-gain' : 'text-loss')}>{usd(sel.total)}</div>
              <div className="text-xs text-slate-500">
                {usd(sel.cashflow)} cash + {usd(sel.principalGained)} principal
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">Balances</div>
              <div className="mt-1 text-sm tabular-nums text-slate-900">
                Fixed <strong>{usd(sel.fixedBalance)}</strong>
              </div>
              <div className="text-sm tabular-nums text-slate-900">
                ARM <strong>{usd(sel.armBalance)}</strong>
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-6 2xl:grid-cols-2">
        <ChartCard
          title="Payment path"
          subtitle={`Monthly P&I by year · ${SCENARIO_LABEL[inp.scenario].toLowerCase()}`}
          legend={[
            { label: `Fixed ${pct(inp.fixedRate, 3)}`, color: SERIES[0] },
            { label: product, color: SERIES[1] },
          ]}
          table={{ head: ['Year', 'ARM rate', 'Fixed P&I', 'ARM P&I'], rows: pathData.map((d) => [`Yr ${d.year}`, pct(d.rate, 3), usd(d.fixed), usd(d.arm)]) }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={pathData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="year" {...axisProps} tickFormatter={(v) => `Yr ${v}`} interval="preserveStartEnd" minTickGap={20} />
              <YAxis {...axisProps} tickFormatter={axisUsdFine} width={56} domain={[0, Math.ceil((maxPay * 1.1) / 500) * 500]} />
              <Tooltip content={<ChartTooltip format={(v) => usd(v)} labelFormat={(l) => `Year ${l}`} />} />
              <ReferenceLine x={year} stroke={CHART.neutral} strokeDasharray="4 4" />
              <Line type="stepAfter" dataKey="fixed" name={`Fixed ${pct(inp.fixedRate, 3)}`} stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="arm" name={product} stroke={SERIES[1]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Savings over time"
          subtitle={`${modeLabel} · cumulative ARM advantage${be ? ` · break-even ${yearsMonths(be)}` : ''}`}
          legend={[
            { label: 'Total savings', color: SERIES[0] },
            { label: 'Cash flow', color: SERIES[1] },
            { label: 'Principal gained', color: SERIES[2] },
          ]}
          action={
            focusYears < inp.termYears ? (
              <Segmented
                size="sm"
                ariaLabel="Chart range"
                value={range}
                onChange={setRange}
                options={[
                  { value: 'focus', label: `${focusYears} yrs` },
                  { value: 'full', label: `${inp.termYears} yrs` },
                ]}
              />
            ) : undefined
          }
          table={{ head: ['Year', 'Cash flow', 'Principal gained', 'Total'], rows: r.years.map((y) => [`Yr ${y.year}`, usd(y.cashflow), usd(y.principalGained), usd(y.total)]) }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={savingsShown} margin={{ top: 16, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="t" type="number" domain={[0, horizon]} {...axisProps} tickFormatter={(v) => `Yr ${Math.round(v)}`} ticks={Array.from({ length: Math.floor(horizon / tickStep) + 1 }, (_, i) => i * tickStep)} />
              <YAxis {...axisProps} tickFormatter={axisUsdFine} width={60} />
              <Tooltip content={<ChartTooltip format={(v) => usd(v)} labelFormat={(l) => yearsMonths(Number(l) * 12)} />} />
              <ReferenceLine y={0} stroke={CHART.axis} />
              {beYear !== null && <ReferenceLine x={beYear} stroke={CHART.loss} strokeDasharray="4 4" label={{ value: `Break-even ${yearsMonths(be ?? 0)}`, position: 'insideTopRight', fill: CHART.text, fontSize: 11 }} />}
              <Line type="monotone" dataKey="cashflow" name="Cash flow" stroke={SERIES[1]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="principal" name="Principal gained" stroke={SERIES[2]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="total" name="Total savings" stroke={SERIES[0]} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              {beYear !== null && <ReferenceDot x={beYear} y={0} r={5} fill={CHART.loss} stroke="#fff" strokeWidth={2} />}
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader title="Year-by-year comparison" subtitle={`${modeLabel} · balances and savings at each year end`} />
        </div>
        <DataTable head={['Year', 'ARM rate', 'Fixed P&I', 'ARM P&I', 'Diff / mo', 'Cash flow', 'Principal gained', 'Total savings', 'Fixed balance', 'ARM balance']} rows={tableRows} dense className="max-h-[480px] overflow-y-auto" />
      </Card>

      <Card>
        <CardHeader title={`${inp.termYears}-year totals`} subtitle="If the loan is held to payoff under this scenario" />
        <ComparisonTable
          columns={[`Fixed ${pct(inp.fixedRate, 3)}`, product]}
          colors={[SERIES[0], SERIES[1]]}
          rows={[
            { label: 'Start rate', values: [pct(inp.fixedRate, 3), pct(inp.armRate, 3)] },
            { label: 'Highest rate', values: [pct(inp.fixedRate, 3), pct(r.peakRate, 3)], best: r.peakRate > inp.fixedRate ? 0 : 1 },
            { label: 'Initial P&I', values: [usd(r.fixedPayment), usd(r.armInitialPayment)], best: r.armInitialPayment < r.fixedPayment ? 1 : 0 },
            { label: 'Highest P&I', values: [usd(r.fixedPayment), usd(r.peakPayment)], best: r.peakPayment > r.fixedPayment ? 0 : 1 },
            { label: 'Total interest', values: [usd(r.totals.fixedInterest), usd(r.totals.armInterest)], best: r.totals.armInterest > r.totals.fixedInterest ? 0 : 1 },
            { label: 'Total paid (P&I)', values: [usd(r.totals.fixedPaid), usd(r.totals.armPaid)], best: r.totals.armPaid > r.totals.fixedPaid ? 0 : 1, strong: true },
          ]}
        />
      </Card>

      <TalkTrack>
        {r.initialMonthlySavings > 0 ? (
          <>
            “The ARM saves you <strong>{usd(r.initialMonthlySavings)}/mo</strong> for {fy} years
            {s.reinvest ? <> — put that toward principal and you’re {usd(r.atFixedEnd.total)} ahead by year {fy}</> : <> — {usd(r.atFixedEnd.total)} ahead by year {fy} counting cash and principal</>}.{' '}
            {firstAdj && firstAdj.armPaymentChange > 0 ? (
              <>
                But in the {SCENARIO_LABEL[inp.scenario].toLowerCase()}, the year-{fy + 1} payment jumps <strong>{usd(firstAdj.armPaymentChange)}</strong> to {usd(firstAdj.armPayment)}
                {be ? (
                  <>
                    {' '}and the advantage evaporates by year {Math.floor(be / 12)}–{Math.floor(be / 12) + 1} (break-even <strong>{yearsMonths(be)}</strong>). The ARM only wins if you move or refinance before year {Math.floor(be / 12)}.”
                  </>
                ) : (
                  <>, yet you still stay ahead over the full term.”</>
                )}
              </>
            ) : (
              <>In this scenario the rate doesn’t rise, so the ARM stays ahead{be ? ` until ${yearsMonths(be)}` : ''}.”</>
            )}
          </>
        ) : (
          <>“At these rates the fixed loan is the better deal from day one — the ARM doesn’t buy you any payment savings.”</>
        )}
      </TalkTrack>

      <ReportFooter note={`ARM projections use ${SCENARIO_LABEL[inp.scenario].toLowerCase()} rate adjustments within the stated caps (initial ${pct(inp.capInitial, 3)}, annual ${pct(inp.capPeriodic, 3)}, lifetime ${pct(inp.capLifetime, 3)}); the payment is recast at each adjustment.`} />
    </CalculatorShell>
  );
}
