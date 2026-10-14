'use client';

import { ChevronDown, ChevronRight, TableProperties } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalculatorShell } from '@/components/calc/CalculatorShell';
import { ChartCard, ChartTooltip } from '@/components/calc/ChartCard';
import { ReportFooter } from '@/components/calc/ReportFooter';
import { ResultsHeader } from '@/components/calc/ResultsHeader';
import { TalkTrack } from '@/components/calc/TalkTrack';
import { Button, Card, CardHeader, Field, NumberInput, Select, StatTile, Switch } from '@/components/ui';
import { paymentSchedule, piti, type PaymentLoanType } from '@/lib/calculations/payment';
import { SERIES, axisProps, axisUsd, gridProps } from '@/lib/chartTheme';
import { pct, usd } from '@/lib/format';
import { useUrlState } from '@/lib/useUrlState';
import { HeroResult, INPUTS_ID, ShareBar, focusInputs } from './kit';

const DEFAULTS = {
  loanAmount: 400000,
  termYears: 30,
  ratePct: 6.5,
  loanType: 'fixed' as PaymentLoanType,
  ioYears: 10,
  addEscrow: false,
  taxMonthly: 700,
  insMonthly: 150,
  showSchedule: false,
};

const TERMS = [40, 30, 25, 20, 15, 10].map((y) => ({ value: String(y), label: `${y} years` }));
const IO_TERMS = [5, 7, 10].map((y) => ({ value: String(y), label: `${y} years` }));

export function PaymentCalculator() {
  const [s, setS] = useUrlState(DEFAULTS);
  const set = (patch: Partial<typeof DEFAULTS>) => setS((p) => ({ ...p, ...patch }));
  const r = useMemo(() => paymentSchedule(s), [s]);
  const isIO = s.loanType === 'interest-only' && r.ioMonths > 0;
  const total = piti(r.payment, s.taxMonthly, s.insMonthly);
  const [open, setOpen] = useState<number | null>(null);

  const y9 = r.years[Math.min(8, r.years.length - 1)];
  const last = r.years[r.years.length - 1];
  const chartData = r.years.map((y) => ({ year: `Yr ${y.year}`, balance: y.balance, interest: y.interest, principal: y.principal }));

  const csv = () => [
    ['Year', 'Month', 'Payment', 'Interest', 'Principal', 'Balance', 'Paid to date', 'Interest to date', 'Principal to date'],
    ...r.years.flatMap((y) => [
      ...y.months.map((m) => [y.year, m.month, m.payment, m.interest, m.principal, m.balance, '', '', '']),
      [`Year ${y.year} total`, '', y.yearPaid, y.yearInterest, y.yearPrincipal, y.balance, y.paid, y.interest, y.principal],
    ]),
  ];

  const inputs = (
    <div id={INPUTS_ID} className="space-y-4 scroll-mt-32">
      <Field label="Loan Amount">
        <NumberInput ariaLabel="Loan Amount" prefix="$" decimals={0} min={0} max={100_000_000} value={s.loanAmount} onChange={(loanAmount) => set({ loanAmount })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Term">
          <Select ariaLabel="Term" value={String(s.termYears)} onChange={(v) => set({ termYears: Number(v) })} options={TERMS} />
        </Field>
        <Field label="Rate">
          <NumberInput ariaLabel="Rate" suffix="%" decimals={3} min={0} max={30} value={s.ratePct} onChange={(ratePct) => set({ ratePct })} />
        </Field>
      </div>
      <Field label="Loan Type">
        <Select
          ariaLabel="Loan Type"
          value={s.loanType}
          onChange={(loanType) => set({ loanType })}
          options={[
            { value: 'fixed', label: 'Fixed' },
            { value: 'interest-only', label: 'Interest-Only' },
          ]}
        />
      </Field>
      {s.loanType === 'interest-only' && (
        <Field label="Interest-only period" hint="Interest only, then fully amortizing over the remaining term.">
          <Select ariaLabel="Interest-only period" value={String(s.ioYears)} onChange={(v) => set({ ioYears: Number(v) })} options={IO_TERMS} />
        </Field>
      )}
      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        <Switch checked={s.addEscrow} onChange={(addEscrow) => set({ addEscrow })} label="Add taxes & insurance" />
        {s.addEscrow && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Property tax">
              <NumberInput ariaLabel="Monthly property tax" prefix="$" suffix="/mo" decimals={2} min={0} value={s.taxMonthly} onChange={(taxMonthly) => set({ taxMonthly })} />
            </Field>
            <Field label="Insurance">
              <NumberInput ariaLabel="Monthly insurance" prefix="$" suffix="/mo" decimals={2} min={0} value={s.insMonthly} onChange={(insMonthly) => set({ insMonthly })} />
            </Field>
          </div>
        )}
      </div>
      <Button className="w-full" size="lg" variant={s.showSchedule ? 'secondary' : 'primary'} icon={<TableProperties className="h-4 w-4" />} onClick={() => set({ showSchedule: !s.showSchedule })}>
        {s.showSchedule ? 'Hide Schedule' : 'View Schedule'}
      </Button>
    </div>
  );

  return (
    <CalculatorShell toolId="payment" subtitle="Monthly principal & interest with a full amortization schedule." inputs={inputs}>
      <ResultsHeader
        toolId="payment"
        scenarioTitle={`${usd(s.loanAmount)} · ${pct(s.ratePct, 3)} · ${s.termYears}yr`}
        chips={[
          { label: 'Loan', value: `${usd(s.loanAmount)} · ${s.termYears} yr`, onEdit: () => focusInputs() },
          { label: 'Rate', value: `${pct(s.ratePct, 3)} ${isIO ? 'Interest-Only' : 'Fixed'}`, onEdit: () => focusInputs('[aria-label="Rate"]') },
          { label: 'Monthly Payment', value: usd(s.addEscrow ? total : r.payment, { cents: true }) },
        ]}
        csv={csv}
        data={s}
        emailBody={`Your estimated principal & interest payment on ${usd(s.loanAmount)} at ${pct(s.ratePct, 3)} for ${s.termYears} years is ${usd(r.payment, { cents: true })}/mo${s.addEscrow ? ` (${usd(total, { cents: true })}/mo with taxes & insurance)` : ''}.`}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <HeroResult
          eyebrow={s.addEscrow ? 'Monthly Payment (PITI)' : isIO ? 'Monthly Payment (interest-only)' : 'Monthly Payment (P&I)'}
          value={usd(s.addEscrow ? total : r.payment, { cents: true })}
          sub={
            isIO
              ? `Interest-only for ${r.ioMonths / 12} years, then ${usd(r.amortizingPayment, { cents: true })}/mo P&I for ${(r.termMonths - r.ioMonths) / 12} years`
              : `${usd(s.loanAmount)} at ${pct(s.ratePct, 3)} for ${s.termYears} years`
          }
        >
          {s.addEscrow ? (
            <ShareBar
              format={(v) => usd(v, { cents: true })}
              parts={[
                { label: isIO ? 'Interest' : 'Principal & interest', value: r.payment, color: SERIES[0] },
                { label: 'Taxes', value: s.taxMonthly, color: SERIES[1] },
                { label: 'Insurance', value: s.insMonthly, color: SERIES[2] },
              ]}
            />
          ) : (
            <button type="button" onClick={() => set({ addEscrow: true })} className="text-sm font-medium text-brand-700 hover:underline">
              + Add taxes & insurance to see PITI
            </button>
          )}
        </HeroResult>
        <div className="grid grid-cols-2 gap-3">
          <StatTile size="sm" label="Total interest" value={usd(r.totalInterest)} sub={`over ${s.termYears} years`} />
          <StatTile size="sm" label="Total of payments" value={usd(r.totalPaid)} sub="principal + interest" />
          {isIO ? (
            <StatTile size="sm" label="After IO period" value={usd(r.amortizingPayment, { cents: true })} sub={`+${usd(r.amortizingPayment - r.payment)}/mo payment step-up`} />
          ) : (
            <StatTile size="sm" label="First payment interest" value={usd(r.months[0]?.interest ?? 0, { cents: true })} sub={`${usd(r.months[0]?.principal ?? 0, { cents: true })} goes to principal`} />
          )}
          <StatTile size="sm" label={`Balance after ${y9?.year ?? 0} yrs`} value={usd(y9?.balance ?? 0)} sub={`${usd(y9?.principal ?? 0)} paid down`} />
        </div>
      </div>

      {s.showSchedule && r.years.length > 0 && (
        <>
          <ChartCard
            title="Balance & cumulative interest vs principal"
            subtitle="Where each dollar goes over the life of the loan"
            height={300}
            legend={[
              { label: 'Loan balance', color: SERIES[0] },
              { label: 'Interest paid to date', color: SERIES[1] },
              { label: 'Principal paid to date', color: SERIES[2] },
            ]}
            table={{ head: ['Year', 'Balance', 'Interest to date', 'Principal to date'], rows: r.years.map((y) => [`Yr ${y.year}`, usd(y.balance), usd(y.interest), usd(y.principal)]) }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="year" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
                <YAxis {...axisProps} tickFormatter={axisUsd} width={56} />
                <Tooltip content={<ChartTooltip format={(v) => usd(v)} />} />
                <Line type="monotone" dataKey="balance" name="Loan balance" stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                <Line type="monotone" dataKey="interest" name="Interest paid to date" stroke={SERIES[1]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                <Line type="monotone" dataKey="principal" name="Principal paid to date" stroke={SERIES[2]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <Card padded={false}>
            <div className="px-5 pt-5">
              <CardHeader title="Amortization schedule" subtitle="Click a year to see its monthly payments." />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] whitespace-nowrap text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="px-4 py-2.5 text-left font-semibold">Year</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Paid to date</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Interest to date</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Principal to date</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Interest this yr</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Principal this yr</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {r.years.map((y) => {
                    const isOpen = open === y.year;
                    return (
                      <Fragment key={y.year}>
                        <tr className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${isOpen ? 'bg-brand-50/50' : ''}`} onClick={() => setOpen(isOpen ? null : y.year)}>
                          <td className="px-4 py-2.5 font-medium text-slate-900">
                            <button type="button" aria-expanded={isOpen} className="inline-flex items-center gap-1.5">
                              {isOpen ? <ChevronDown className="h-4 w-4 text-brand-600" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                              Year {y.year}
                            </button>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{usd(y.paid)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{usd(y.interest)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{usd(y.principal)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{usd(y.yearInterest)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{usd(y.yearPrincipal)}</td>
                          <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">{usd(y.balance)}</td>
                        </tr>
                        {isOpen &&
                          y.months.map((m) => (
                            <tr key={m.month} className="border-b border-slate-100 bg-slate-50/70 text-[13px] text-slate-600">
                              <td className="py-1.5 pl-10 pr-4">Month {m.month}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{usd(m.payment, { cents: true })} <span className="text-[11px] text-slate-400">pmt</span></td>
                              <td className="px-3 py-1.5 text-right text-xs text-slate-400" colSpan={2}>
                                {m.interestOnly ? 'interest-only' : ''}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{usd(m.interest, { cents: true })}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{usd(m.principal, { cents: true })}</td>
                              <td className="px-4 py-1.5 text-right tabular-nums">{usd(m.balance, { cents: true })}</td>
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
              “Paid to date” uses the payment rounded to whole dollars ({usd(isIO ? r.amortizingPayment : r.payment)}) × months, as shown on MBS Highway; interest and principal use the exact payment. Export includes every month.
            </p>
          </Card>
        </>
      )}

      <TalkTrack>
        “On {usd(s.loanAmount)} at {pct(s.ratePct, 3)} over {s.termYears} years, your principal and interest is <strong>{usd(r.payment, { cents: true })}</strong> a month
        {s.addEscrow ? (
          <>
            {' '}— about <strong>{usd(total, { cents: true })}</strong> once taxes and insurance are included
          </>
        ) : null}
        .{' '}
        {isIO ? (
          <>
            That’s interest-only for {r.ioMonths / 12} years, so the balance doesn’t drop — then the payment steps up to {usd(r.amortizingPayment, { cents: true })}.{' '}
          </>
        ) : y9 ? (
          <>
            By year {y9.year} you’ll have paid {usd(y9.principal)} of principal and owe {usd(y9.balance)}.{' '}
          </>
        ) : null}
        Over the full term that’s {usd(last?.interest ?? 0)} of interest.”
      </TalkTrack>

      <ReportFooter />
    </CalculatorShell>
  );
}
