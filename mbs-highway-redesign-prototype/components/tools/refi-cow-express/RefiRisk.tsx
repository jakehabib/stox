'use client';

import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalculatorShell } from '@/components/calc/CalculatorShell';
import { ChartCard, ChartTooltip } from '@/components/calc/ChartCard';
import { ComparisonTable } from '@/components/calc/ComparisonTable';
import { ReportFooter } from '@/components/calc/ReportFooter';
import { ResultsHeader } from '@/components/calc/ResultsHeader';
import { TalkTrack } from '@/components/calc/TalkTrack';
import { Callout, Card, Field, NumberInput, Select, SectionLabel, cx } from '@/components/ui';
import { REFI_DEFAULTS, refiRisk, type RefiRiskInput } from '@/lib/calculations/refiRisk';
import { CHART, SERIES, axisProps, gridProps } from '@/lib/chartTheme';
import { pct, usd } from '@/lib/format';
import { useUrlState } from '@/lib/useUrlState';
import { CalcFooter, INPUTS_ID, axisUsdFine, focusInputs, useDraft } from '../payment/kit';

const TERMS = [30, 25, 20, 15, 10].map((y) => ({ value: String(y), label: `${y} years` }));
const months = (n: number) => `${n} month${n === 1 ? '' : 's'}`;

export function RefiRisk() {
  const [s, setS, hydrated] = useUrlState({ inp: REFI_DEFAULTS });
  const [draft, patch, dirty, setDraft] = useDraft<RefiRiskInput>(s.inp, hydrated);
  const inp = s.inp;
  const r = useMemo(() => refiRisk(inp), [inp]);
  const submit = () => setS({ inp: draft });
  const never = r.breakEvenMonths === null;
  const futureNotLower = inp.futureRate >= inp.currentRate;
  const noSavingsNow = r.refiNowSavings <= 0;

  const inputs = (
    <form
      id={INPUTS_ID}
      className="scroll-mt-32 space-y-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="space-y-3">
        <SectionLabel>Existing loan</SectionLabel>
        <Field label="Original amount">
          <NumberInput ariaLabel="Existing loan original amount" prefix="$" decimals={0} min={0} max={100_000_000} value={draft.existingAmount} onChange={(existingAmount) => patch({ existingAmount })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Term">
            <Select ariaLabel="Existing term" value={String(draft.existingTermYears)} onChange={(v) => patch({ existingTermYears: Number(v) })} options={TERMS} />
          </Field>
          <Field label="Rate">
            <NumberInput ariaLabel="Existing rate" suffix="%" decimals={3} min={0} max={30} value={draft.existingRate} onChange={(existingRate) => patch({ existingRate })} />
          </Field>
        </div>
      </div>
      <div className="space-y-3 border-t border-slate-100 pt-4">
        <SectionLabel>Refinance</SectionLabel>
        <Field label="Refi amount">
          <NumberInput ariaLabel="Refi amount" prefix="$" decimals={0} min={0} max={100_000_000} value={draft.refiAmount} onChange={(refiAmount) => patch({ refiAmount })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Current available rate">
            <NumberInput ariaLabel="Current available rate" suffix="%" decimals={3} min={0} max={30} value={draft.currentRate} onChange={(currentRate) => patch({ currentRate })} />
          </Field>
          <Field label="Hypothetical future rate">
            <NumberInput ariaLabel="Hypothetical future rate" suffix="%" decimals={3} min={0} max={30} value={draft.futureRate} onChange={(futureRate) => patch({ futureRate })} />
          </Field>
        </div>
        <Field label="Waiting period">
          <NumberInput ariaLabel="Waiting period" suffix="mo" decimals={0} min={0} max={120} value={draft.waitMonths} onChange={(waitMonths) => patch({ waitMonths })} />
        </Field>
      </div>
      <CalcFooter onClick={submit} dirty={dirty} onReset={() => setDraft(REFI_DEFAULTS)} />
    </form>
  );

  const csv = () => [
    ['Month', 'Refi now cumulative savings', 'Wait then refi cumulative savings', 'Advantage of refi now'],
    ...r.series.map((p) => [p.month, p.refiNow, p.waitThenRefi, p.refiNow - p.waitThenRefi]),
  ];

  const tickStep = r.series.length > 120 ? 24 : 12;

  return (
    <CalculatorShell toolId="refi-cow-express" subtitle="What waiting for a lower rate costs — and how long it takes to earn it back." inputs={inputs}>
      <ResultsHeader
        toolId="refi-cow-express"
        scenarioTitle={`Refi ${pct(inp.currentRate, 3)} now vs ${pct(inp.futureRate, 3)} in ${inp.waitMonths} mo`}
        chips={[
          { label: 'Existing loan', value: `${usd(inp.existingAmount)} · ${pct(inp.existingRate, 3)}`, onEdit: () => focusInputs() },
          { label: 'Refinance', value: `${usd(inp.refiAmount)} · ${pct(inp.currentRate, 3)} now`, onEdit: () => focusInputs('[aria-label="Refi amount"]') },
          { label: 'Waiting', value: `${months(r.waitMonths)} for ${pct(inp.futureRate, 3)}`, onEdit: () => focusInputs('[aria-label="Waiting period"]') },
        ]}
        csv={csv}
        data={s}
        emailBody={`Waiting ${months(r.waitMonths)} to refinance costs about ${usd(r.costOfDelay)} in missed savings. ${never ? 'At the assumed future rate, waiting never pays that back.' : `It takes ${months(r.breakEvenMonths ?? 0)} after the later refinance to earn it back.`}`}
      />

      {noSavingsNow && <Callout tone="warning" title="No savings from refinancing today">The current available rate doesn’t lower the payment on the existing loan, so there’s no cost to waiting.</Callout>}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-red-200 bg-white p-5 shadow-card sm:p-6">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Cost of delaying</div>
          <div className="mt-1 text-4xl font-bold tabular-nums tracking-tight text-loss sm:text-5xl">{usd(r.costOfDelay)}</div>
          <div className="mt-1 text-sm text-slate-500">
            {usd(Math.max(0, r.refiNowSavings))}/mo savings missed × {months(r.waitMonths)}
          </div>
        </div>
        <div className={cx('rounded-xl border bg-white p-5 shadow-card sm:p-6', never ? 'border-red-200' : 'border-slate-200')}>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Break even</div>
          <div className={cx('mt-1 text-4xl font-bold tabular-nums tracking-tight sm:text-5xl', never ? 'text-loss' : 'text-slate-900')}>{never ? 'Never' : months(r.breakEvenMonths ?? 0)}</div>
          <div className="mt-1 text-sm text-slate-500">
            {never
              ? futureNotLower
                ? `The future rate (${pct(inp.futureRate, 3)}) isn’t lower than today’s ${pct(inp.currentRate, 3)}, so waiting never pays off.`
                : 'The lower future payment never recovers the missed savings.'
              : `after the future refinance (excludes the ${months(r.waitMonths)} wait) · ${months(r.breakEvenFromToday ?? 0)} from today`}
          </div>
        </div>
      </div>

      <Card>
        <ComparisonTable
          columns={['Existing', 'Refi now', 'Wait & refi']}
          colors={[CHART.neutral, SERIES[0], SERIES[1]]}
          rows={[
            { label: 'Rate', values: [pct(inp.existingRate, 3), pct(inp.currentRate, 3), pct(inp.futureRate, 3)] },
            { label: 'Monthly P&I', values: [usd(r.existingPayment), usd(r.refiNowPayment), usd(r.futurePayment)], strong: true },
            {
              label: 'Monthly savings',
              values: [
                '—',
                <span key="a" className={r.refiNowSavings >= 0 ? 'text-emerald-700' : 'text-red-600'}>{usd(r.refiNowSavings)}</span>,
                <span key="b" className={r.futureSavings >= 0 ? 'text-emerald-700' : 'text-red-600'}>{usd(r.futureSavings)}</span>,
              ],
            },
            { label: 'Starts', values: ['—', 'Today', `Month ${r.waitMonths + 1}`] },
          ]}
        />
      </Card>

      <ChartCard
        title="Cumulative savings"
        subtitle={`Refinance now vs wait ${months(r.waitMonths)} for ${pct(inp.futureRate, 3)}`}
        legend={[
          { label: `Refi now at ${pct(inp.currentRate, 3)}`, color: SERIES[0] },
          { label: `Wait, then refi at ${pct(inp.futureRate, 3)}`, color: SERIES[1] },
        ]}
        table={{ head: ['Month', 'Refi now', 'Wait & refi'], rows: r.series.filter((p) => p.month % 6 === 0).map((p) => [`Mo ${p.month}`, usd(p.refiNow), usd(p.waitThenRefi)]) }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={r.series} margin={{ top: 16, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="month" type="number" domain={[0, r.series.length - 1]} {...axisProps} ticks={r.series.filter((p) => p.month % tickStep === 0).map((p) => p.month)} tickFormatter={(v) => `Mo ${v}`} />
            <YAxis {...axisProps} tickFormatter={axisUsdFine} width={56} />
            <Tooltip content={<ChartTooltip format={(v) => usd(v)} labelFormat={(l) => `Month ${l}`} />} />
            {r.waitMonths > 0 && <ReferenceArea x1={0} x2={r.waitMonths} fill={CHART.neutral} fillOpacity={0.12} label={{ value: 'Waiting', position: 'insideTopLeft', fill: CHART.text, fontSize: 11 }} />}
            {r.breakEvenFromToday !== null && r.breakEvenFromToday > 0 && (
              <ReferenceLine x={r.breakEvenFromToday} stroke={CHART.loss} strokeDasharray="4 4" label={{ value: `Break-even · month ${r.breakEvenFromToday}`, position: 'insideTopRight', fill: CHART.text, fontSize: 11 }} />
            )}
            <Line type="linear" dataKey="refiNow" name={`Refi now at ${pct(inp.currentRate, 3)}`} stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            <Line type="linear" dataKey="waitThenRefi" name={`Wait, then refi at ${pct(inp.futureRate, 3)}`} stroke={SERIES[1]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            {r.breakEvenFromToday !== null && r.breakEvenFromToday > 0 && r.series[r.breakEvenFromToday] && (
              <ReferenceDot x={r.breakEvenFromToday} y={r.series[r.breakEvenFromToday].waitThenRefi} r={5} fill={CHART.loss} stroke="#fff" strokeWidth={2} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <TalkTrack>
        {noSavingsNow ? (
          <>“Refinancing at today’s {pct(inp.currentRate, 3)} wouldn’t lower your payment, so there’s no rush — let’s set a target rate and I’ll watch it for you.”</>
        ) : never ? (
          <>
            “Refinancing today saves you <strong>{usd(r.refiNowSavings)}/mo</strong>. Waiting {months(r.waitMonths)} costs {usd(r.costOfDelay)} — and at {pct(inp.futureRate, 3)} you never get it back. Lock in the savings now.”
          </>
        ) : (
          <>
            “Refinancing today saves you <strong>{usd(r.refiNowSavings)}/mo</strong>. If you wait {months(r.waitMonths)} hoping for {pct(inp.futureRate, 3)}, you give up <strong>{usd(r.costOfDelay)}</strong>, and even if rates do drop it takes{' '}
            <strong>{months(r.breakEvenMonths ?? 0)}</strong> after that refi just to catch up. Take the savings now — if rates fall further, we can look at refinancing again.”
          </>
        )}
      </TalkTrack>

      <ReportFooter />
    </CalculatorShell>
  );
}
