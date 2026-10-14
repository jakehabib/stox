'use client';

import { Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalculatorShell } from '@/components/calc/CalculatorShell';
import { ChartCard, ChartTooltip } from '@/components/calc/ChartCard';
import { CoBrandingBlock, ReportFooter } from '@/components/calc/ReportFooter';
import { ResultsHeader } from '@/components/calc/ResultsHeader';
import { TalkTrack } from '@/components/calc/TalkTrack';
import { Button, Card, CardHeader, Field, NumberInput, Segmented, Select, cx } from '@/components/ui';
import { DEMO_AGENTS } from '@/data/mock/cobranding';
import { BUYING_POWER_DEFAULTS, buyingPowerCurve, calcBuyingPower, DEFAULT_RATE_COLUMNS, dollarsPerEighth, type BuyingPowerInput } from '@/lib/calculations/buyingPower';
import { SERIES, axisProps, axisUsd, gridProps } from '@/lib/chartTheme';
import { pct, usd } from '@/lib/format';
import { useUrlState } from '@/lib/useUrlState';
import { focusField, HeroCard, Toggle } from '../affordability/kit';

const TERMS = [30, 25, 20, 15].map((y) => ({ value: String(y), label: `${y} years` }));

/** Non-zero rates ascending; a 0% column (as observed live) stays last. */
const orderRates = (rates: number[]) => {
  const uniq = Array.from(new Set(rates.map((r) => Math.round(r * 1000) / 1000)));
  return [...uniq.filter((r) => r > 0).sort((a, b) => a - b), ...uniq.filter((r) => r === 0)];
};

const k = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : ''}$${Math.abs(Math.round(n / 1000))}k`;

export function BuyingPowerTool() {
  const [s, setS] = useUrlState<BuyingPowerInput>(BUYING_POWER_DEFAULTS);
  const set = (patch: Partial<BuyingPowerInput>) => setS((p) => ({ ...p, ...patch }));
  const [newRate, setNewRate] = useState(7.5);

  const r = useMemo(() => calcBuyingPower(s), [s]);
  const curve = useMemo(() => buyingPowerCurve(s, 5, 8, 0.125), [s]);
  const eighth = dollarsPerEighth(s);
  const agent = s.agentIndex >= 0 ? DEMO_AGENTS[s.agentIndex] : undefined;
  const cols = r.columns;
  const highest = cols.filter((c) => c.ratePct > 0).sort((a, b) => b.ratePct - a.ratePct)[0];

  const inputs = (
    <>
      <Field label="Loan Amount">
        <NumberInput ariaLabel="Loan Amount" prefix="$" decimals={0} min={0} max={100_000_000} value={s.loanAmount} onChange={(loanAmount) => set({ loanAmount })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Rate">
          <NumberInput ariaLabel="Rate" suffix="%" decimals={3} min={0} max={30} value={s.ratePct} onChange={(ratePct) => set({ ratePct, rates: orderRates(s.rates.includes(ratePct) ? s.rates : s.rates) })} />
        </Field>
        <Field label="Term">
          <Select ariaLabel="Term" value={String(s.termYears)} onChange={(v) => set({ termYears: Number(v) })} options={TERMS} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="APR" right={<Toggle checked={s.aprAuto} onChange={(aprAuto) => set({ aprAuto, aprPct: aprAuto ? s.aprPct : Math.round(r.baseApr * 1000) / 1000 })} label={<span className="text-xs">Auto</span>} />} hint={s.aprAuto ? 'From APR costs' : 'Manual'}>
          {s.aprAuto ? (
            <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm tabular-nums text-slate-700">{pct(r.baseApr, 3)}</div>
          ) : (
            <NumberInput ariaLabel="APR" suffix="%" decimals={3} min={0} max={30} value={s.aprPct} onChange={(aprPct) => set({ aprPct })} />
          )}
        </Field>
        <Field label="APR Costs" hint="Prepaid finance charges">
          <NumberInput ariaLabel="APR Costs" prefix="$" decimals={0} min={0} value={s.aprCosts} onChange={(aprCosts) => set({ aprCosts })} />
        </Field>
      </div>
      <Field label="Agent" hint="Co-brand the report with a real estate partner">
        <Select ariaLabel="Agent" value={String(s.agentIndex)} onChange={(v) => set({ agentIndex: Number(v) })} options={[{ value: '-1', label: 'None' }, ...DEMO_AGENTS.map((a, i) => ({ value: String(i), label: `${a.name} · ${a.company}` }))]} />
      </Field>
      <Field label="Display" hint={agent ? 'Which side the agent appears on' : 'Pick an agent to position the co-brand'}>
        <Segmented
          ariaLabel="Display"
          value={s.display}
          onChange={(display) => set({ display })}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'right', label: 'Right' },
          ]}
        />
      </Field>
      <Field label="Rate columns" hint="The 0% column is kept as observed in the live tool (P&I = loan ÷ 360).">
        <div className="flex flex-wrap gap-1.5">
          {s.rates.map((rate) => (
            <span key={rate} className={cx('inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-xs font-medium tabular-nums', rate === s.ratePct ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-700')}>
              {pct(rate, 3)}
              <button type="button" aria-label={`Remove ${rate}%`} disabled={s.rates.length <= 1} onClick={() => set({ rates: s.rates.filter((x) => x !== rate) })} className="rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <NumberInput ariaLabel="New rate column" className="flex-1" suffix="%" decimals={3} min={0} max={30} value={newRate} onChange={setNewRate} />
          <Button variant="subtle" icon={<Plus className="h-4 w-4" />} disabled={s.rates.length >= 10 || s.rates.includes(newRate)} onClick={() => set({ rates: orderRates([...s.rates, newRate]) })}>
            Add
          </Button>
        </div>
        <button type="button" className="mt-1 text-xs text-slate-500 hover:text-slate-800" onClick={() => set({ rates: DEFAULT_RATE_COLUMNS })}>
          Reset columns
        </button>
      </Field>
    </>
  );

  const csv = () => [
    ['Rate %', ...cols.map((c) => c.ratePct)],
    ['You: payment on ' + Math.round(s.loanAmount), ...cols.map((c) => c.payment)],
    ['You: change vs today', ...cols.map((c) => c.paymentDiff)],
    ['APR %', ...cols.map((c) => c.apr)],
    ['Buying power: loan at ' + Math.round(r.basePayment) + '/mo', ...cols.map((c) => c.supportedLoanRounded)],
    ['Buying power: change', ...cols.map((c) => c.loanDiff)],
  ];

  const talk = highest
    ? `Today your ${usd(r.basePayment)} payment buys a ${usd(s.loanAmount)} loan at ${pct(s.ratePct, 3)}. If rates rise to ${pct(highest.ratePct, 3)}, that same payment only supports about ${usd(highest.supportedLoanRounded)} — ${k(highest.loanDiff).replace('−', '')} ${highest.loanDiff < 0 ? 'less' : 'more'} house. Every 1/8 point costs you roughly ${usd(Math.round(eighth / 500) * 500)} of buying power, so locking in protects what you can buy.`
    : '';

  const head = ['', ...cols.map((c) => <span key={c.ratePct} className={cx(c.isBase && 'text-brand-700')}>{pct(c.ratePct, 3)}{c.isBase ? ' · today' : ''}</span>)];
  const hl = (c: (typeof cols)[number], v: React.ReactNode) => <span className={cx(c.isBase && 'rounded bg-brand-50 px-1.5 py-0.5 font-semibold text-brand-800')}>{v}</span>;
  const coBrands = [<CoBrandingBlock key="lo" compact />, agent ? <CoBrandingBlock key="agent" compact cobranding={agent} /> : null];
  if (s.display === 'left') coBrands.reverse();

  return (
    <CalculatorShell toolId="buying-power" subtitle="How rate moves change the loan amount the same payment supports." inputs={inputs}>
      <ResultsHeader
        toolId="buying-power"
        scenarioTitle={`${usd(s.loanAmount)} · ${pct(s.ratePct, 3)}`}
        chips={[
          { label: 'Loan', value: `${usd(s.loanAmount)} · ${s.termYears} yr`, onEdit: () => focusField('[aria-label="Loan Amount"]') },
          { label: 'Rate / APR', value: `${pct(s.ratePct, 3)} / ${pct(r.baseApr, 3)}`, onEdit: () => focusField('[aria-label="Rate"]') },
          { label: 'Agent', value: agent ? agent.name : 'None', onEdit: () => focusField('[aria-label="Agent"]') },
        ]}
        csv={csv}
        data={s}
        emailBody={talk}
      />

      <div className={cx('grid gap-3', agent && 'md:grid-cols-2')}>{coBrands.filter(Boolean)}</div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <HeroCard eyebrow="Your payment today" value={`${usd(r.basePayment)}/mo`} sub={`Principal & interest on ${usd(s.loanAmount)} at ${pct(s.ratePct, 3)} for ${s.termYears} years (APR ${pct(r.baseApr, 3)})`} />
        <Card className="flex flex-col justify-center">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Rate sensitivity</div>
          <div className="mt-2 text-3xl font-bold tabular-nums text-slate-900">≈ {usd(eighth)}</div>
          <div className="text-sm text-slate-600">of buying power per 1/8 point of rate</div>
          {highest && highest.ratePct > s.ratePct && (
            <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              At {pct(highest.ratePct, 3)} the same payment buys <strong>{usd(highest.supportedLoanRounded)}</strong> ({k(highest.loanDiff)}).
            </div>
          )}
        </Card>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900">You</h3>
            <p className="mt-0.5 text-sm text-slate-500">Your {usd(s.loanAmount)} loan at each rate</p>
          </div>
          <Toggle
            checked={false}
            disabled
            onChange={() => {}}
            title="Disabled in the live tool (as observed). Every rate column is already shown here."
            label={
              <span className="text-xs text-slate-500">
                Show all values <span className="text-slate-400">· disabled as observed — every column is already shown</span>
              </span>
            }
          />
        </div>
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                {head.map((h, i) => (
                  <th key={i} className={cx('px-3 py-2.5 text-xs font-semibold text-slate-500', i === 0 ? 'text-left' : 'text-right')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ['Monthly payment', (c: (typeof cols)[number]) => `${usd(c.payment)}/mo`],
                ['Change vs. today', (c: (typeof cols)[number]) => (c.isBase ? '—' : `${c.paymentDiff > 0 ? '+' : c.paymentDiff < 0 ? '−' : ''}${usd(Math.abs(c.paymentDiff))}`)],
                ['APR', (c: (typeof cols)[number]) => pct(c.apr, 3)],
              ].map(([label, fn]) => (
                <tr key={label as string} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-3 py-2.5 font-medium text-slate-700">{label as string}</td>
                  {cols.map((c) => (
                    <td key={c.ratePct} className="px-3 py-2.5 text-right tabular-nums text-slate-800">
                      {hl(c, (fn as (c: (typeof cols)[number]) => string)(c))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title="Buying Power" subtitle={`Loan amount your ${usd(r.basePayment)}/mo payment supports at each rate (nearest $1,000)`} />
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                {head.map((h, i) => (
                  <th key={i} className={cx('px-3 py-2.5 text-xs font-semibold text-slate-500', i === 0 ? 'text-left' : 'text-right')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-100">
                <td className="px-3 py-2.5 font-medium text-slate-700">Loan amount</td>
                {cols.map((c) => (
                  <td key={c.ratePct} className="px-3 py-2.5 text-right tabular-nums text-slate-900">
                    {hl(c, usd(c.supportedLoanRounded))}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-slate-100">
                <td className="px-3 py-2.5 font-medium text-slate-700">Change</td>
                {cols.map((c) => (
                  <td key={c.ratePct} className={cx('px-3 py-2.5 text-right font-medium tabular-nums', c.loanDiff < 0 ? 'text-loss' : c.loanDiff > 0 ? 'text-gain' : 'text-slate-500')}>
                    {c.isBase ? '—' : k(c.loanDiff)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-3 py-2.5 font-medium text-slate-700">Payment</td>
                {cols.map((c) => (
                  <td key={c.ratePct} className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                    {usd(r.basePayment)}/mo
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <ChartCard
        title="Loan amount supported vs. rate"
        subtitle={`What ${usd(r.basePayment)}/mo buys from 5% to 8%`}
        table={{ head: ['Rate', 'Loan supported'], rows: curve.filter((_, i) => i % 2 === 0).map((c) => [pct(c.rate, 3), usd(c.loan)]) }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={curve} margin={{ top: 16, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="rate" type="number" domain={[5, 8]} ticks={[5, 5.5, 6, 6.5, 7, 7.5, 8]} tickFormatter={(v) => `${v}%`} {...axisProps} />
            <YAxis tickFormatter={axisUsd} width={56} domain={['auto', 'auto']} {...axisProps} />
            <Tooltip content={<ChartTooltip format={(v) => usd(v)} labelFormat={(l) => `${l}% rate`} />} />
            {s.ratePct >= 5 && s.ratePct <= 8 && <ReferenceLine x={s.ratePct} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: 'Today', position: 'top', fill: '#475569', fontSize: 11 }} />}
            <Line type="monotone" dataKey="loan" name="Loan supported" stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            {cols
              .filter((c) => c.ratePct >= 5 && c.ratePct <= 8)
              .map((c) => (
                <ReferenceDot key={c.ratePct} x={c.ratePct} y={c.supportedLoan} r={c.isBase ? 6 : 4} fill={SERIES[0]} stroke="#fff" strokeWidth={2} />
              ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <TalkTrack>{talk}</TalkTrack>
      <ReportFooter />
    </CalculatorShell>
  );
}
