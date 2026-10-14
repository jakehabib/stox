'use client';

import { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalculatorShell } from '@/components/calc/CalculatorShell';
import { ChartCard, ChartTooltip } from '@/components/calc/ChartCard';
import { ClientPicker, requireClient } from '@/components/calc/ClientPicker';
import { ReportFooter } from '@/components/calc/ReportFooter';
import { ResultsHeader } from '@/components/calc/ResultsHeader';
import { TalkTrack } from '@/components/calc/TalkTrack';
import { Card, CardHeader, Checkbox, DataTable, Field, NumberInput, Segmented, Select, StatTile } from '@/components/ui';
import { REINVEST_DEFAULTS, reinvest, type ReinvestFrequency, type ReinvestInput, type ReinvestTiming } from '@/lib/calculations/reinvestment';
import { SERIES, axisProps, gridProps } from '@/lib/chartTheme';
import { pct, usd } from '@/lib/format';
import { useStore } from '@/lib/store';
import { useUrlState } from '@/lib/useUrlState';
import { CalcFooter, HeroResult, INPUTS_ID, ShareBar, axisUsdFine, focusInputs, useDraft } from '../payment/kit';

type Inputs = ReinvestInput & { clientId: string | null };
const INPUT_DEFAULTS: Inputs = { ...REINVEST_DEFAULTS, clientId: 'c-alex-rivera' };
const PER: Record<ReinvestFrequency, string> = { monthly: 'mo', quarterly: 'qtr', yearly: 'yr' };
const FREQ_LABEL: Record<ReinvestFrequency, string> = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };

function lengthLabel(i: ReinvestInput) {
  const n = i.length;
  return i.lengthUnit === 'years' ? `${n} year${n === 1 ? '' : 's'}` : `${n} month${n === 1 ? '' : 's'}`;
}

export function Reinvestment() {
  const [s, setS, hydrated] = useUrlState({ inp: INPUT_DEFAULTS, showBalance: true, showContrib: true });
  const [draft, patch, dirty, setDraft] = useDraft<Inputs>(s.inp, hydrated);
  const { getClient } = useStore();
  const inp = s.inp;
  const r = useMemo(() => reinvest(inp), [inp]);
  const clientErr = requireClient(draft.clientId);
  const committedErr = requireClient(inp.clientId);
  const client = getClient(inp.clientId);
  const submit = () => {
    if (clientErr) return;
    setS((p) => ({ ...p, inp: draft }));
  };

  const data = r.yearly.map((p) => ({ label: p.label, balance: p.balance, contributions: p.contributions, interest: Math.max(0, p.interest) }));
  const both = s.showBalance && s.showContrib;

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
      <ClientPicker value={draft.clientId} onChange={(clientId) => patch({ clientId })} error={dirty || committedErr ? clientErr : null} />
      <Field label="Lump sum">
        <NumberInput ariaLabel="Lump sum" prefix="$" decimals={0} min={0} max={1_000_000_000} value={draft.lumpSum} onChange={(lumpSum) => patch({ lumpSum })} />
      </Field>
      <Field label="Period payment" hint="Tip: use the monthly savings from a refinance.">
        <NumberInput ariaLabel="Period payment" prefix="$" suffix={`/${PER[draft.frequency]}`} decimals={2} min={0} max={10_000_000} value={draft.periodPayment} onChange={(periodPayment) => patch({ periodPayment })} />
      </Field>
      <Field label="Frequency">
        <Segmented
          ariaLabel="Frequency"
          className="w-full [&>button]:flex-1"
          value={draft.frequency}
          onChange={(frequency) => patch({ frequency })}
          options={[
            { value: 'monthly', label: 'Monthly' },
            { value: 'quarterly', label: 'Quarterly' },
            { value: 'yearly', label: 'Yearly' },
          ]}
        />
      </Field>
      <Field label="Assumed rate" hint="Annual return, compounded each period.">
        <NumberInput ariaLabel="Assumed rate" suffix="%" decimals={3} min={-50} max={100} value={draft.ratePct} onChange={(ratePct) => patch({ ratePct })} />
      </Field>
      <Field label="Length" right={<Segmented size="sm" ariaLabel="Length unit" value={draft.lengthUnit} onChange={(lengthUnit) => patch({ lengthUnit, length: lengthUnit === draft.lengthUnit ? draft.length : lengthUnit === 'months' ? draft.length * 12 : Math.max(1, Math.round(draft.length / 12)) })} options={[{ value: 'years', label: 'Years' }, { value: 'months', label: 'Months' }]} />}>
        <NumberInput ariaLabel="Length" suffix={draft.lengthUnit === 'years' ? 'yrs' : 'mos'} decimals={0} min={0} max={draft.lengthUnit === 'years' ? 100 : 1200} value={draft.length} onChange={(length) => patch({ length })} />
      </Field>
      <details className="group rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm">
        <summary className="cursor-pointer select-none text-[13px] font-medium text-slate-600">Calculation method</summary>
        <div className="mt-3 pb-1">
          <Select<ReinvestTiming>
            ariaLabel="Calculation method"
            value={draft.timing}
            onChange={(timing) => patch({ timing })}
            options={[
              { value: 'live', label: 'MBS Highway convention (default)' },
              { value: 'standard', label: 'Standard end-of-period' },
            ]}
          />
          <p className="mt-2 text-xs text-slate-500">MBS Highway’s convention credits the lump sum with one extra period of interest. Standard starts the lump sum and contributions on the same schedule.</p>
        </div>
      </details>
      <CalcFooter onClick={submit} dirty={dirty} error={dirty || committedErr ? clientErr : null} onReset={() => setDraft(INPUT_DEFAULTS)} />
    </form>
  );

  const csv = () => [['Point', 'Elapsed months', 'Contributions', 'Interest', 'Balance'], ...r.yearly.map((p) => [p.label, p.month, p.contributions, p.interest, p.balance])];

  return (
    <CalculatorShell toolId="reinvestment" subtitle="Put the savings to work — lump sum plus regular contributions at an assumed return." inputs={inputs}>
      <ResultsHeader
        toolId="reinvestment"
        clientId={inp.clientId}
        scenarioTitle={`${usd(inp.lumpSum)} + ${usd(inp.periodPayment)}/${PER[inp.frequency]} @ ${pct(inp.ratePct, 3)}`}
        chips={[
          { label: 'Client', value: client?.name ?? 'No client', onEdit: () => focusInputs('input') },
          { label: 'Lump sum', value: usd(inp.lumpSum), onEdit: () => focusInputs('[aria-label="Lump sum"]') },
          { label: 'Contributions', value: `${usd(inp.periodPayment)}/${PER[inp.frequency]}`, onEdit: () => focusInputs('[aria-label="Period payment"]') },
          { label: 'Rate · length', value: `${pct(inp.ratePct, 3)} · ${lengthLabel(inp)}`, onEdit: () => focusInputs('[aria-label="Assumed rate"]') },
        ]}
        csv={csv}
        data={s}
        emailBody={`Investing ${usd(inp.lumpSum)} plus ${usd(inp.periodPayment)} ${FREQ_LABEL[inp.frequency].toLowerCase()} at ${pct(inp.ratePct, 3)} for ${lengthLabel(inp)} grows to about ${usd(r.endingBalance)} (${usd(r.interest)} of interest).`}
      />

      {committedErr && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">Client name is required — select a client and press Calculate.</div>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <HeroResult eyebrow="Ending balance" value={usd(r.endingBalance)} sub={`after ${lengthLabel(inp)} at ${pct(inp.ratePct, 3)} · ${FREQ_LABEL[inp.frequency].toLowerCase()} contributions`}>
          <ShareBar
            format={(v) => usd(v)}
            parts={[
              { label: 'Contributions', value: r.contributions, color: SERIES[0] },
              { label: 'Interest gained', value: Math.max(0, r.interest), color: SERIES[1] },
            ]}
          />
        </HeroResult>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-1">
          <StatTile label="Interest gained" value={usd(r.interest)} tone={r.interest >= 0 ? 'gain' : 'loss'} sub={r.contributions > 0 ? `${pct((r.interest / r.contributions) * 100, 1)} on contributions` : undefined} />
          <StatTile label="Contributions" value={usd(r.contributions)} sub={`${usd(inp.lumpSum)} + ${usd(inp.periodPayment)} × ${r.periods}`} />
        </div>
      </div>

      <ChartCard
        title="Growth over time"
        subtitle={both ? 'Balance = contributions + interest' : s.showBalance ? 'Balance' : s.showContrib ? 'Contributions' : 'Select a series to display'}
        action={
          <div className="flex gap-3">
            <Checkbox checked={s.showBalance} onChange={(showBalance) => setS((p) => ({ ...p, showBalance }))} label="Balance" />
            <Checkbox checked={s.showContrib} onChange={(showContrib) => setS((p) => ({ ...p, showContrib }))} label="Contributions" />
          </div>
        }
        legend={
          both
            ? [
                { label: 'Contributions', color: SERIES[0] },
                { label: 'Interest gained', color: SERIES[1] },
              ]
            : undefined
        }
        table={{ head: ['', 'Contributions', 'Interest', 'Balance'], rows: r.yearly.map((p) => [p.label, usd(p.contributions), usd(p.interest), usd(p.balance)]) }}
      >
        {s.showBalance || s.showContrib ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={20} />
              <YAxis {...axisProps} tickFormatter={axisUsdFine} width={60} />
              <Tooltip content={<ChartTooltip format={(v) => usd(v)} />} />
              {s.showContrib && <Area type="monotone" dataKey="contributions" name="Contributions" stackId={both ? 'a' : undefined} stroke={SERIES[0]} fill={SERIES[0]} fillOpacity={0.25} strokeWidth={2} isAnimationActive={false} />}
              {both && <Area type="monotone" dataKey="interest" name="Interest gained" stackId="a" stroke={SERIES[1]} fill={SERIES[1]} fillOpacity={0.25} strokeWidth={2} isAnimationActive={false} />}
              {s.showBalance && !both && <Area type="monotone" dataKey="balance" name="Balance" stroke={SERIES[0]} fill={SERIES[0]} fillOpacity={0.2} strokeWidth={2} isAnimationActive={false} />}
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">Check Balance or Contributions to show the chart.</div>
        )}
      </ChartCard>

      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader title="Year by year" />
        </div>
        <DataTable
          head={['', 'Contributions', 'Interest gained', 'Balance']}
          rows={r.yearly.map((p) => [p.label, usd(p.contributions), usd(p.interest), <strong key="b">{usd(p.balance)}</strong>])}
          dense
          className="max-h-[440px] overflow-y-auto"
        />
      </Card>

      <TalkTrack>
        “If you invest {usd(inp.lumpSum)} and add {usd(inp.periodPayment)} {inp.frequency === 'monthly' ? 'a month' : inp.frequency === 'quarterly' ? 'a quarter' : 'a year'}
        {inp.periodPayment > 0 ? ' — that’s your refinance savings —' : ''} at {pct(inp.ratePct, 3)}, in {lengthLabel(inp)} you’d have about <strong>{usd(r.endingBalance)}</strong>. You put in {usd(r.contributions)}; <strong>{usd(r.interest)}</strong> is growth.”
      </TalkTrack>

      <ReportFooter note="Investment returns are hypothetical and not guaranteed." />
    </CalculatorShell>
  );
}
