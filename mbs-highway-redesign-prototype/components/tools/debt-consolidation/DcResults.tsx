'use client';

import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartCard, ChartTooltip } from '@/components/calc/ChartCard';
import { ComparisonTable, type ComparisonRow } from '@/components/calc/ComparisonTable';
import { ReportFooter } from '@/components/calc/ReportFooter';
import { ResultsHeader } from '@/components/calc/ResultsHeader';
import { TalkTrack } from '@/components/calc/TalkTrack';
import { Badge, Callout, Card, CardHeader, DataTable, Field, NumberInput, Segmented } from '@/components/ui';
import { getLocation } from '@/data/mock/locations';
import { dtiZone } from '@/lib/calculations/affordability';
import { balanceSeries, type DebtConsolidationInput, type DebtConsolidationResult, type PaymentSide, type Reinvest } from '@/lib/calculations/debtConsolidation';
import { SERIES, axisProps, axisUsd, gridProps } from '@/lib/chartTheme';
import { pct, usd, yearsMonths } from '@/lib/format';
import { useStore } from '@/lib/store';
import { ZONE_COLORS } from '../affordability/DtiGauge';
import { HeroCard, Row } from '../affordability/kit';

const signed = (n: number) => `${n > 0.5 ? '+' : n < -0.5 ? '−' : ''}${usd(Math.abs(n))}`;

function DtiCell({ dti }: { dti: number }) {
  const z = dtiZone(dti);
  return (
    <span className="inline-flex items-center gap-1.5">
      {pct(dti, 1)} <Badge tone={ZONE_COLORS[z].tone}>{z}</Badge>
    </span>
  );
}

export function DcResults({ s, r, onStep, setReinvest }: { s: DebtConsolidationInput; r: DebtConsolidationResult; onStep: (step: number) => void; setReinvest: (r: Reinvest) => void }) {
  const { getClient } = useStore();
  const client = getClient(s.clientId);
  const [mode, setMode] = useState<'principal' | 'invest'>('principal');
  const isRefi = r.tab === 'refinance';
  const mu = r.moveUp;
  const series = useMemo(() => balanceSeries(r), [r]);

  const sides: { label: string; short: string; side: PaymentSide }[] = isRefi
    ? [
        { label: 'Today', short: 'Today', side: r.before },
        { label: 'After refinance', short: 'After refi', side: r.after },
      ]
    : [
        { label: 'Today', short: 'Today', side: r.before },
        { label: 'Move up, keep debts', short: 'Keep debts', side: mu!.alt },
        { label: 'Move up + consolidate', short: 'Consolidate', side: r.after },
      ];
  const best = (vals: number[]) => vals.indexOf(Math.min(...vals));

  const rows: ComparisonRow[] = [
    { label: 'Principal & interest', values: sides.map((x) => usd(x.side.pi)) },
    { label: 'Taxes & insurance', values: sides.map((x) => usd(x.side.taxIns)), sub: true },
    { label: 'Mortgage insurance', values: sides.map((x) => usd(x.side.mi)), sub: true },
    { label: 'HOA', values: sides.map((x) => usd(x.side.hoa)), sub: true },
    { label: 'Housing payment', values: sides.map((x) => usd(x.side.housing)) },
    { label: 'Other debt payments', values: sides.map((x) => usd(x.side.debts)) },
    { label: 'Total monthly', values: sides.map((x) => usd(x.side.total)), strong: true, best: isRefi ? best(sides.map((x) => x.side.total)) : 1 + best(sides.slice(1).map((x) => x.side.total)) },
    { label: 'Debt-to-income', values: sides.map((x) => <DtiCell key={x.label} dti={x.side.dtiPct} />) },
  ];

  const chart = sides.map((x) => ({ name: x.short, Housing: Math.round(x.side.housing), Debts: Math.round(x.side.debts) }));
  const loc = getLocation(isRefi ? s.existing.locationId : s.moveUp.newLocationId);
  const savings = isRefi ? r.monthlySavings : mu!.savingsVsAlt;
  const savingsTone = savings >= 0 ? 'text-gain' : 'text-loss';
  const reinvestDesc = isRefi ? 'monthly savings' : 'monthly savings vs. moving up without consolidating';

  const talk = isRefi
    ? `Right now you’re paying ${usd(r.before.total)} a month between your mortgage and ${r.debts.included.count} debts. Rolling ${usd(r.debts.included.balance)} of debt into a ${pct(r.newLoan.ratePct, 3)} refinance takes that to ${usd(r.after.total)} — ${savings >= 0 ? `${usd(savings)} a month back in your pocket` : `${usd(-savings)} more a month`}, and your DTI goes from ${pct(r.before.dtiPct, 1)} to ${pct(r.after.dtiPct, 1)}. To be straight with you: stretching those debts over 30 years costs ${usd(Math.abs(r.interest.lifetimeDiff))} ${r.interest.lifetimeDiff > 0 ? 'more' : 'less'} in total interest${r.interest.lifetimeDiff > 0 ? ' — unless you put the savings to work' : ''}. If you keep paying the extra ${usd(r.reinvest.amount)} toward principal, you’re mortgage-free in ${yearsMonths(r.reinvest.principal.payoffMonths)} and save ${usd(r.reinvest.principal.interestSaved)} of interest.`
    : `Selling nets about ${usd(mu!.netProceeds)}. If we use part of it to wipe out ${usd(r.debts.included.balance)} of debt and put ${usd(mu!.down)} down on the ${usd(s.moveUp.newPrice)} home, your total monthly is ${usd(r.after.total)} — ${usd(Math.abs(mu!.savingsVsAlt))} ${mu!.savingsVsAlt >= 0 ? 'less' : 'more'} than moving up and keeping the debts (${usd(mu!.alt.total)}), and your DTI is ${pct(r.after.dtiPct, 1)} instead of ${pct(mu!.alt.dtiPct, 1)}. The tradeoff: those debts now sit in a 30-year loan, so their interest is about ${usd(r.interest.debtShareOfNewInterest)} over the life of the loan versus ${usd(r.interest.keepDebts)} if paid on schedule — keep paying the ${usd(r.reinvest.amount)} difference toward principal and you’re done in ${yearsMonths(r.reinvest.principal.payoffMonths)}.`;

  const csv = () => [
    ['Line', ...sides.map((x) => x.label)],
    ['P&I', ...sides.map((x) => x.side.pi)],
    ['Taxes & insurance', ...sides.map((x) => x.side.taxIns)],
    ['MI', ...sides.map((x) => x.side.mi)],
    ['HOA', ...sides.map((x) => x.side.hoa)],
    ['Debt payments', ...sides.map((x) => x.side.debts)],
    ['Total monthly', ...sides.map((x) => x.side.total)],
    ['DTI %', ...sides.map((x) => x.side.dtiPct)],
    [],
    ['Debt', 'Type', 'Balance', 'Payment', 'Rate %', 'Included', 'Months to payoff', 'Interest if paid on schedule'],
    ...s.debts.map((d) => {
      const p = r.debts.payoffs.find((x) => x.id === d.id);
      return [d.name, d.type, d.balance, d.payment, d.ratePct, d.include ? 'Yes' : 'No', p?.months ?? '', p?.interest ?? ''];
    }),
    [],
    ['New loan', r.newLoan.amount],
    ['Rate %', r.newLoan.ratePct],
    ['LTV %', r.newLoan.ltvPct],
    ['Lifetime interest — baseline', r.interest.keepTotal],
    ['Lifetime interest — new loan (+ closing for refi)', r.interest.newTotalWithClosing],
  ];

  return (
    <div className="space-y-6">
      <ResultsHeader
        toolId="debt-consolidation"
        scenarioTitle={`${isRefi ? 'Refinance' : 'Move-Up'} · ${usd(r.debts.included.balance)} consolidated`}
        clientId={s.clientId}
        onBack={() => onStep(3)}
        chips={[
          { label: 'Client', value: client?.name ?? '—', onEdit: () => onStep(0) },
          { label: 'Debts', value: `${r.debts.included.count} · ${usd(r.debts.included.balance)}`, onEdit: () => onStep(0) },
          { label: 'Existing', value: `${usd(s.existing.estValue)} · ${pct(s.existing.ratePct, 3)}`, onEdit: () => onStep(1) },
          { label: 'Property', value: isRefi ? `${loc.label}` : `${usd(s.moveUp.newPrice)} · ${loc.city}`, onEdit: () => onStep(2) },
          { label: 'Loan', value: `${usd(r.newLoan.amount)} · ${pct(r.newLoan.ratePct, 3)} ${s.proposed.termYears}yr`, onEdit: () => onStep(3) },
        ]}
        csv={csv}
        data={s}
        emailBody={talk}
      />

      <Callout tone="info" title="Built to spec">
        The live session could not add Debt 2 (UI bug), never reached Proposed Loan, and produced no savings figure — these results follow the spec’s model and can’t be checked against live numbers.
      </Callout>
      {r.warnings.map((w) => (
        <Callout key={w} tone="warning">
          {w}
        </Callout>
      ))}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <HeroCard
          eyebrow={isRefi ? 'Monthly savings' : 'Consolidating saves'}
          value={<span className={savingsTone}>{`${savings < 0 ? '−' : ''}${usd(Math.abs(savings))}/mo`}</span>}
          sub={isRefi ? `${usd(r.before.total)} today → ${usd(r.after.total)} after refinancing · ${usd(savings * 12)} a year` : `vs. moving up without consolidating (${usd(mu!.alt.total)} → ${usd(r.after.total)}/mo)`}
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <div className="text-xs text-slate-500">New loan</div>
              <div className="text-lg font-semibold tabular-nums text-slate-900">{usd(r.newLoan.amount)}</div>
              <div className="text-xs text-slate-500">{pct(r.newLoan.ltvPct, 1)} LTV · max {pct(r.newLoan.maxLtvPct, 1)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">DTI</div>
              <div className="text-lg font-semibold tabular-nums text-slate-900">
                {pct((isRefi ? r.before : mu!.alt).dtiPct, 1)} → {pct(r.after.dtiPct, 1)}
              </div>
              <div className="text-xs text-slate-500">{isRefi ? 'today → after' : 'keep debts → consolidate'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Debts paid off</div>
              <div className="text-lg font-semibold tabular-nums text-slate-900">{usd(r.debts.included.balance)}</div>
              <div className="text-xs text-slate-500">
                {usd(r.debts.included.payment)}/mo · avg {pct(r.debts.includedAvgRatePct, 2)}
              </div>
            </div>
          </div>
        </HeroCard>
        {isRefi ? (
          <Card>
            <CardHeader title="Cash-out refinance" subtitle={`${usd(s.refi.appraisedValue || s.existing.estValue)} value`} />
            <Row label="Existing balance payoff" value={usd(r.existing.balance)} />
            <Row label="Debts consolidated" value={usd(r.debts.included.balance)} />
            <Row label="Closing costs (financed)" value={usd(r.newLoan.closing)} />
            {s.refi.additionalCashOut > 0 && <Row label="Additional cash out" value={usd(s.refi.additionalCashOut)} />}
            <Row strong label="New loan" value={usd(r.newLoan.amount)} />
            <p className="mt-1 text-xs text-slate-500">Equity after refinance {usd((s.refi.appraisedValue || s.existing.estValue) - r.newLoan.amount)}</p>
          </Card>
        ) : (
          <Card>
            <CardHeader title="Sale & purchase" subtitle={`Sell ${usd(mu!.salePrice)} → buy ${usd(s.moveUp.newPrice)}`} />
            <Row label="Sale price" value={usd(mu!.salePrice)} />
            <Row label="Cost to sell" sub={pct(s.moveUp.costToSellPct, 2)} value={`−${usd(mu!.costToSell)}`} />
            <Row label="Mortgage payoff" value={`−${usd(mu!.payoff)}`} />
            <Row strong label="Net proceeds" value={usd(mu!.netProceeds)} />
            <Row label="Purchase closing costs" value={`−${usd(mu!.purchaseClosing)}`} />
            <Row label="Debts paid off" value={`−${usd(r.debts.included.balance)}`} />
            <Row strong label="Down payment" sub={pct(mu!.downPct, 2)} value={usd(mu!.down)} />
          </Card>
        )}
      </div>

      <div className={isRefi ? 'grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]' : 'grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]'}>
        <Card>
          <CardHeader title="Monthly: before vs. after" subtitle="Mortgage plus all debt payments" />
          <ComparisonTable columns={sides.map((x) => x.label)} rows={rows} />
        </Card>
        <ChartCard title="Total monthly outlay" subtitle="Housing + other debts" legend={[{ label: 'Housing', color: SERIES[0] }, { label: 'Other debts', color: SERIES[1] }]} height={260} table={{ head: ['Scenario', 'Housing', 'Debts', 'Total'], rows: chart.map((c) => [c.name, usd(c.Housing), usd(c.Debts), usd(c.Housing + c.Debts)]) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="name" {...axisProps} interval={0} tick={{ ...axisProps.tick, fontSize: 11 }} />
              <YAxis tickFormatter={axisUsd} width={52} {...axisProps} />
              <Tooltip cursor={{ fill: '#f1f5f9' }} content={<ChartTooltip format={(v) => usd(v)} />} />
              <Bar dataKey="Housing" stackId="a" fill={SERIES[0]} maxBarSize={56} isAnimationActive={false} stroke="#fff" strokeWidth={1} />
              <Bar dataKey="Debts" name="Other debts" stackId="a" fill={SERIES[1]} maxBarSize={56} radius={[4, 4, 0, 0]} isAnimationActive={false} stroke="#fff" strokeWidth={1} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <Card>
        <CardHeader title="The honest tradeoff: total interest" subtitle="Lower payment today vs. more years of interest" />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="text-xs font-medium text-slate-500">{isRefi ? 'Keep current loan + pay debts on schedule' : 'Move up, keep debts on schedule'}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{usd(r.interest.keepTotal)}</div>
            <div className="mt-1 text-xs text-slate-500">
              {isRefi ? `Mortgage ${usd(r.interest.keepMortgage)} over ${yearsMonths(r.existing.remainingMonths)}` : `Move-up loan ${usd(r.interest.keepMortgage)} over ${s.proposed.termYears} yrs`} + debts {usd(r.interest.keepDebts)} over {yearsMonths(r.interest.debtsPayoffMonths)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="text-xs font-medium text-slate-500">{isRefi ? 'New consolidated loan' : 'Move up + consolidate'}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{usd(r.interest.newTotalWithClosing)}</div>
            <div className="mt-1 text-xs text-slate-500">
              {usd(r.interest.newLoan)} interest over {s.proposed.termYears} yrs{isRefi ? ` + ${usd(r.newLoan.closing)} closing` : ''}
            </div>
          </div>
          <div className={`rounded-xl border p-4 ${r.interest.lifetimeDiff > 0 ? 'border-red-200 bg-red-50/60' : 'border-emerald-200 bg-emerald-50/60'}`}>
            <div className="text-xs font-medium text-slate-600">Lifetime difference</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${r.interest.lifetimeDiff > 0 ? 'text-loss' : 'text-gain'}`}>{signed(r.interest.lifetimeDiff)}</div>
            <div className="mt-1 text-xs text-slate-600">{r.interest.lifetimeDiff > 0 ? 'more interest if you only make the minimum payment' : 'less interest over the life of the loan'}</div>
          </div>
        </div>
        <p className="mt-4 text-sm text-slate-600">
          On their own, the consolidated debts would cost <strong className="text-slate-900">{usd(r.interest.keepDebts)}</strong> of interest and be gone in {yearsMonths(r.interest.debtsPayoffMonths)}. Inside a {s.proposed.termYears}-year loan, their share of interest is about <strong className="text-slate-900">{usd(r.interest.debtShareOfNewInterest)}</strong> — unless the monthly savings go back to work.
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card>
          <CardHeader title="Savings reinvested" subtitle={`Put the ${usd(r.reinvest.amount)} ${reinvestDesc} to work`} />
          {r.reinvest.amount > 0 ? (
            <>
              <Segmented
                ariaLabel="Reinvest mode"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'principal', label: 'Into principal' },
                  { value: 'invest', label: 'Invest it' },
                ]}
              />
              {mode === 'principal' ? (
                <div className="mt-4 space-y-1">
                  <Row label="Paid off in" value={yearsMonths(r.reinvest.principal.payoffMonths)} sub={`instead of ${s.proposed.termYears} yrs`} />
                  <Row label="Total interest" value={usd(r.reinvest.principal.interest)} />
                  <Row label="Interest saved vs. minimum payments" value={usd(r.reinvest.principal.interestSaved)} tone="gain" />
                  <Row strong label={isRefi ? 'vs. keeping today’s loan + debts' : 'vs. moving up and keeping the debts'} value={signed(r.reinvest.principal.interest + (isRefi ? r.newLoan.closing : 0) - r.interest.keepTotal)} tone={r.reinvest.principal.interest + (isRefi ? r.newLoan.closing : 0) - r.interest.keepTotal <= 0 ? 'gain' : 'loss'} />
                  <p className="pt-1 text-xs text-slate-500">Same total monthly outlay as {isRefi ? 'today' : 'moving up without consolidating'}, pointed at principal.</p>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Return">
                      <NumberInput ariaLabel="Reinvest return" suffix="%/yr" decimals={2} min={0} max={30} value={s.reinvest.ratePct} onChange={(ratePct) => setReinvest({ ...s.reinvest, ratePct })} />
                    </Field>
                    <Field label="Years">
                      <NumberInput ariaLabel="Reinvest years" suffix="yrs" decimals={0} min={1} max={40} value={s.reinvest.years} onChange={(years) => setReinvest({ ...s.reinvest, years })} />
                    </Field>
                  </div>
                  <Row label="Contributions" value={usd(r.reinvest.invest.contributions)} />
                  <Row label="Growth" value={usd(r.reinvest.invest.growth)} tone="gain" />
                  <Row strong label={`Value after ${s.reinvest.years} yrs`} value={usd(r.reinvest.invest.futureValue)} />
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500">No monthly savings to reinvest in this scenario.</p>
          )}
        </Card>
        <ChartCard
          title="New loan balance"
          subtitle="Minimum payments vs. savings applied to principal"
          legend={[
            { label: 'Minimum payment', color: SERIES[0] },
            { label: 'Savings into principal', color: SERIES[2] },
          ]}
          height={260}
          table={{ head: ['Year', 'Minimum payment', 'Savings into principal'], rows: series.filter((x) => x.year % 5 === 0).map((x) => [x.year, usd(x.standard), usd(x.accelerated)]) }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="year" {...axisProps} tickFormatter={(v) => `Yr ${v}`} interval={4} />
              <YAxis tickFormatter={axisUsd} width={52} {...axisProps} />
              <Tooltip content={<ChartTooltip format={(v) => usd(v)} labelFormat={(l) => `Year ${l}`} />} />
              <Line type="monotone" dataKey="standard" name="Minimum payment" stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="accelerated" name="Savings into principal" stroke={SERIES[2]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <Card>
        <CardHeader title="Debts" subtitle="Paid on their own schedule" />
        <DataTable
          head={['Debt', 'Type', 'Balance', 'Payment', 'Rate', 'Payoff', 'Interest', 'Consolidated']}
          rows={s.debts.map((d) => {
            const p = r.debts.payoffs.find((x) => x.id === d.id);
            return [
              d.name || '—',
              d.type,
              usd(d.balance),
              `${usd(d.payment)}/mo`,
              pct(d.ratePct, 3),
              p ? (p.neverPaysOff ? 'Never' : yearsMonths(p.months)) : '—',
              p ? usd(p.interest) : '—',
              d.include ? <Badge tone="green">Yes</Badge> : <Badge>No</Badge>,
            ];
          })}
          footer={['Total', '', usd(r.debts.all.balance), `${usd(r.debts.all.payment)}/mo`, '', '', usd(r.interest.keepDebts), `${r.debts.included.count} of ${r.debts.all.count}`]}
        />
      </Card>

      <TalkTrack>{talk}</TalkTrack>
      <ReportFooter note="Debt Consolidation results are built to spec; the live session never reached this screen. Existing-home values are demo defaults." />
    </div>
  );
}
