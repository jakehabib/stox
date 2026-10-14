'use client';

import { ArrowRight, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { CalculatorShell } from '@/components/calc/CalculatorShell';
import { ReportFooter } from '@/components/calc/ReportFooter';
import { ResultsHeader } from '@/components/calc/ResultsHeader';
import { TalkTrack } from '@/components/calc/TalkTrack';
import { Button, Card, CardHeader, Field, NumberInput, TextInput } from '@/components/ui';
import { MAX_DEBTS, blendedRate, type BlendedDebt } from '@/lib/calculations/blendedRate';
import { SERIES } from '@/lib/chartTheme';
import { pct, usd } from '@/lib/format';
import { useUrlState } from '@/lib/useUrlState';
import { HeroResult, INPUTS_ID, ShareBar, focusInputs } from '../payment/kit';

const EXAMPLE: BlendedDebt[] = [
  { name: 'Mortgage', balance: 400000, ratePct: 6.5, payment: 0 },
  { name: 'Credit card', balance: 8000, ratePct: 22, payment: 0 },
  { name: 'Auto loan', balance: 15000, ratePct: 8, payment: 0 },
];
const EMPTY: BlendedDebt = { name: '', balance: 0, ratePct: 0, payment: 0 };

export function BlendedRate() {
  const [s, setS] = useUrlState({ debts: EXAMPLE });
  const debts = s.debts.slice(0, MAX_DEBTS);
  const r = useMemo(() => blendedRate(debts), [debts]);
  const setDebt = (i: number, patch: Partial<BlendedDebt>) => setS((p) => ({ debts: p.debts.map((d, j) => (j === i ? { ...d, ...patch } : d)) }));
  const label = (d: BlendedDebt, i: number) => d.name.trim() || `Debt ${i + 1}`;
  const top = r.contributions.reduce((best, c, i) => (c.balance > 0 && c.ratePct > (r.contributions[best]?.ratePct ?? -1) ? i : best), 0);
  const topC = r.contributions[top];

  const csv = () => [
    ['Debt', 'Balance', 'Rate %', 'Monthly payment', 'Annual interest', 'Share of balance %', 'Share of interest %'],
    ...r.contributions.map((c, i) => [label(debts[i], i), c.balance, c.ratePct, debts[i].payment, c.annualInterest, c.balanceShare * 100, c.interestShare * 100]),
    ['Total', r.totalBalance, Number(r.blendedRatePct.toFixed(3)), r.totalPayment, r.annualInterest, 100, 100],
  ];

  return (
    <CalculatorShell toolId="blended-rate" subtitle="Balance-weighted interest rate across up to three debts.">
      <ResultsHeader
        toolId="blended-rate"
        scenarioTitle={`Blended ${pct(r.blendedRatePct, 3)} on ${usd(r.totalBalance)}`}
        chips={[
          { label: 'Debts', value: debts.map(label).join(' · ') || 'None', onEdit: () => focusInputs() },
          { label: 'Total amount', value: usd(r.totalBalance) },
          { label: 'Blended rate', value: pct(r.blendedRatePct, 3) },
        ]}
        csv={csv}
        data={s}
        emailBody={`Your blended rate across ${debts.length} debt${debts.length === 1 ? '' : 's'} (${usd(r.totalBalance)} total) is ${pct(r.blendedRatePct, 3)}.`}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card id={INPUTS_ID} className="scroll-mt-32">
          <CardHeader
            title="Debts"
            subtitle={`Up to ${MAX_DEBTS}. Monthly payment is optional — it’s only totaled, not used in the rate.`}
            action={
              <Button variant="ghost" size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setS({ debts: [{ ...EMPTY }] })}>
                Reset
              </Button>
            }
          />
          <div className="space-y-3">
            {debts.map((d, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[i] }} />
                    Debt {i + 1}
                  </span>
                  {debts.length > 1 && (
                    <button type="button" aria-label={`Remove debt ${i + 1}`} onClick={() => setS((p) => ({ debts: p.debts.filter((_, j) => j !== i) }))} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Field label="Debt name" className="col-span-2 lg:col-span-1">
                    <TextInput aria-label={`Debt ${i + 1} name`} value={d.name} placeholder={`Debt ${i + 1}`} onChange={(e) => setDebt(i, { name: e.target.value })} />
                  </Field>
                  <Field label="Balance">
                    <NumberInput ariaLabel={`Debt ${i + 1} balance`} prefix="$" decimals={0} min={0} max={100_000_000} value={d.balance} onChange={(balance) => setDebt(i, { balance })} />
                  </Field>
                  <Field label="Rate">
                    <NumberInput ariaLabel={`Debt ${i + 1} rate`} suffix="%" decimals={3} min={0} max={100} value={d.ratePct} onChange={(ratePct) => setDebt(i, { ratePct })} />
                  </Field>
                  <Field label="Monthly payment" className="col-span-2 lg:col-span-1">
                    <NumberInput ariaLabel={`Debt ${i + 1} monthly payment`} prefix="$" decimals={2} min={0} value={d.payment} onChange={(payment) => setDebt(i, { payment })} placeholder="Optional" />
                  </Field>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              variant="subtle"
              icon={<Plus className="h-4 w-4" />}
              disabled={debts.length >= MAX_DEBTS}
              title={debts.length >= MAX_DEBTS ? `Maximum of ${MAX_DEBTS} debts` : undefined}
              onClick={() => setS((p) => ({ debts: [...p.debts, { ...EMPTY }] }))}
            >
              Add debt
            </Button>
            {debts.length >= MAX_DEBTS && <span className="text-xs text-slate-500">Maximum of {MAX_DEBTS} debts reached.</span>}
            <button type="button" className="ml-auto text-xs font-medium text-brand-700 hover:underline" onClick={() => setS({ debts: EXAMPLE })}>
              Load example
            </button>
          </div>
        </Card>

        <div className="space-y-4">
          <HeroResult eyebrow="Blended rate" value={pct(r.blendedRatePct, 3, { trim: false })} sub={`Weighted by balance across ${debts.length} debt${debts.length === 1 ? '' : 's'}`}>
            <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4">
              <div>
                <div className="text-xs font-medium text-slate-500">Total amount</div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{usd(r.totalBalance)}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500">Total monthly payment</div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{usd(r.totalPayment)}</div>
              </div>
            </div>
          </HeroResult>
          {r.running.length > 1 && (
            <Card>
              <CardHeader title="How each debt moves the rate" />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {r.running.map((x, i) => (
                  <span key={i} className="inline-flex items-center gap-2">
                    {i > 0 && <ArrowRight className="h-4 w-4 text-slate-300" />}
                    <span className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                      <span className="block text-[11px] text-slate-500">{i === 0 ? label(debts[0], 0) : `+ ${label(debts[i], i)}`}</span>
                      <span className="font-semibold tabular-nums text-slate-900">{pct(x, 3, { trim: false })}</span>
                    </span>
                  </span>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardHeader title="Contribution" subtitle={`Share of total balance vs share of the ${usd(r.annualInterest)} yearly interest`} />
        <div className="space-y-5">
          <div>
            <div className="mb-2 text-sm font-medium text-slate-700">Share of balance</div>
            <ShareBar format={(v) => pct(v * 100, 1)} height={14} parts={r.contributions.map((c, i) => ({ label: label(debts[i], i), value: c.balanceShare, color: SERIES[i] }))} />
          </div>
          <div>
            <div className="mb-2 text-sm font-medium text-slate-700">Share of interest</div>
            <ShareBar format={(v) => pct(v * 100, 1)} height={14} parts={r.contributions.map((c, i) => ({ label: label(debts[i], i), value: c.interestShare, color: SERIES[i] }))} />
          </div>
        </div>
      </Card>

      <TalkTrack>
        {debts.length > 1 && topC ? (
          <>
            “Across {usd(r.totalBalance)} of debt you’re paying a blended <strong>{pct(r.blendedRatePct, 3)}</strong>. {label(debts[top], top)} is only {pct(topC.balanceShare * 100, 1)} of the balance but {pct(topC.interestShare * 100, 1)} of the interest — rolling the high-rate balances into one lower-rate loan is where the savings are.”
          </>
        ) : (
          <>“Your blended rate is {pct(r.blendedRatePct, 3)} on {usd(r.totalBalance)}. Add the other debts to see how they pull the rate up.”</>
        )}
      </TalkTrack>

      <ReportFooter />
    </CalculatorShell>
  );
}
