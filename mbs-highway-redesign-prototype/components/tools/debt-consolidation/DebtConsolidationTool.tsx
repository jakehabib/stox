'use client';

import { ArrowLeft, ArrowRight, Calculator, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { CalculatorShell } from '@/components/calc/CalculatorShell';
import { ClientPicker, requireClient } from '@/components/calc/ClientPicker';
import { LocationPicker } from '@/components/calc/LocationPicker';
import { Stepper } from '@/components/calc/Stepper';
import { Button, Callout, Card, Checkbox, Field, NumberInput, Select, Tabs, TextInput, cx } from '@/components/ui';
import { FICO_BANDS, type FicoBand } from '@/data/mock/clients';
import { getLocation } from '@/data/mock/locations';
import { countyTaxAnnual } from '@/lib/calculations/property';
import {
  calcDebtConsolidation,
  CASH_OUT_MAX_LTV,
  DEBT_CONSOLIDATION_DEFAULTS,
  DEBT_TYPES,
  existingStatus,
  newDebt,
  summarizeDebts,
  type DcProgram,
  type DcTab,
  type Debt,
  type DebtConsolidationInput,
  type DebtType,
} from '@/lib/calculations/debtConsolidation';
import { pct, usd, yearsMonths } from '@/lib/format';
import { useUrlState } from '@/lib/useUrlState';
import { BuiltToSpecBadge } from '../affordability/kit';
import { DcResults } from './DcResults';

type DcState = DebtConsolidationInput & { step: number };
const DEFAULTS: DcState = { ...DEBT_CONSOLIDATION_DEFAULTS, step: 0 };
const STEPS = ['Debts', 'Existing', 'Property/Loan', 'Proposed Loan', 'Results'];
const PROGRAMS: { value: DcProgram; label: string }[] = [
  { value: 'Conventional', label: 'Conventional' },
  { value: 'FHA', label: 'FHA' },
  { value: 'VA', label: 'VA' },
];
const TERMS = [30, 25, 20, 15, 10].map((y) => ({ value: String(y), label: `${y} years` }));

function Computed({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'gain' | 'loss' }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cx('mt-0.5 text-lg font-semibold tabular-nums', tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-slate-900')}>{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function Money({ label, value, onChange, suffix, hint, decimals = 0 }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; hint?: ReactNode; decimals?: number }) {
  return (
    <Field label={label} hint={hint}>
      <NumberInput ariaLabel={label} prefix="$" suffix={suffix} decimals={decimals} min={0} max={100_000_000} value={value} onChange={onChange} />
    </Field>
  );
}

function Percent({ label, value, onChange, hint, max = 100 }: { label: string; value: number; onChange: (v: number) => void; hint?: ReactNode; max?: number }) {
  return (
    <Field label={label} hint={hint}>
      <NumberInput ariaLabel={label} suffix="%" decimals={3} min={0} max={max} value={value} onChange={onChange} />
    </Field>
  );
}

export function DebtConsolidationTool() {
  const [s, setS] = useUrlState<DcState>(DEFAULTS);
  const set = (patch: Partial<DcState>) => setS((p) => ({ ...p, ...patch }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const asOf = useMemo(() => new Date(), []);

  const ex = existingStatus(s.existing, asOf);
  const debtsSum = summarizeDebts(s.debts);
  const result = useMemo(() => calcDebtConsolidation(s, asOf), [s, asOf]);

  const setDebt = (id: string, patch: Partial<Debt>) => set({ debts: s.debts.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  const setExisting = (patch: Partial<DcState['existing']>) => set({ existing: { ...s.existing, ...patch } });
  const setRefi = (patch: Partial<DcState['refi']>) => set({ refi: { ...s.refi, ...patch } });
  const setMoveUp = (patch: Partial<DcState['moveUp']>) => set({ moveUp: { ...s.moveUp, ...patch } });
  const setProposed = (patch: Partial<DcState['proposed']>) => set({ proposed: { ...s.proposed, ...patch } });

  const validate = (step: number): Record<string, string> => {
    const e: Record<string, string> = {};
    if (step === 0) {
      const c = requireClient(s.clientId);
      if (c) e.client = c;
      if (!(s.monthlyIncome > 0)) e.income = 'Monthly qualifying income is required';
      if (!s.debts.some((d) => d.include && d.balance > 0)) e.debts = 'Add at least one debt with a balance to consolidate';
      s.debts.forEach((d) => {
        if (!d.name.trim()) e[`name-${d.id}`] = 'Name required';
      });
    }
    if (step === 1) {
      if (!(s.existing.estValue > 0)) e.estValue = 'Estimated home value is required';
      if (s.existing.loanAmount > 0 && !(s.existing.ratePct > 0)) e.rate = 'Rate is required';
    }
    if (step === 2) {
      if (s.tab === 'refinance' && !((s.refi.appraisedValue || s.existing.estValue) > 0)) e.appraised = 'Value is required';
      if (s.tab === 'moveup' && !(s.moveUp.newPrice > 0)) e.newPrice = 'New home price is required';
    }
    if (step === 3 && !(s.proposed.ratePct > 0)) e.proposedRate = 'Rate is required';
    return e;
  };

  const goTo = (target: number) => {
    // Moving forward validates every step in between.
    for (let st = s.step; st < target; st++) {
      const e = validate(st);
      if (Object.keys(e).length) {
        setErrors(e);
        set({ step: st });
        return;
      }
    }
    setErrors({});
    set({ step: target });
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const tabs = (
    <Tabs<DcTab>
      value={s.tab}
      onChange={(tab) => set({ tab })}
      tabs={[
        { value: 'refinance', label: 'Refinance' },
        { value: 'moveup', label: 'Move-Up Purchase' },
      ]}
    />
  );

  if (s.step >= 4) {
    return (
      <CalculatorShell toolId="debt-consolidation" title={<>Debt Consolidation <BuiltToSpecBadge /></>} subtitle="Roll high-interest debts into a refinance or a move-up purchase.">
        {tabs}
        <DcResults s={s} r={result} onStep={(step) => set({ step })} setReinvest={(reinvest) => set({ reinvest })} />
      </CalculatorShell>
    );
  }

  const loc = getLocation(s.existing.locationId);
  const newLoc = getLocation(s.moveUp.newLocationId);
  const newCountyTax = countyTaxAnnual(s.moveUp.newLocationId, s.moveUp.newPrice);

  return (
    <CalculatorShell toolId="debt-consolidation" subtitle="Roll high-interest debts into a refinance or a move-up purchase.">
      {tabs}
      <Stepper steps={STEPS} current={s.step} onStep={(i) => goTo(i)} />

      <Card className="p-5 sm:p-6">
        {s.step === 0 && (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <ClientPicker value={s.clientId} onChange={(clientId) => set({ clientId })} error={errors.client} />
              <Field label="Monthly Qualifying Income *" error={errors.income} hint={s.monthlyIncome > 0 ? `${usd(s.monthlyIncome * 12)}/yr` : undefined}>
                <NumberInput ariaLabel="Monthly Qualifying Income" prefix="$" suffix="/mo" decimals={0} min={0} invalid={!!errors.income} value={s.monthlyIncome} onChange={(monthlyIncome) => set({ monthlyIncome })} />
              </Field>
            </div>

            <div>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="text-[15px] font-semibold text-slate-900">Debts</h3>
                  <p className="text-sm text-slate-500">Check the debts to roll into the new loan.</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => set({ debts: [{ ...newDebt(1), name: 'Debt 1' }], monthlyIncome: 0 })}>
                    Clear form
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => set({ debts: DEBT_CONSOLIDATION_DEFAULTS.debts, monthlyIncome: DEBT_CONSOLIDATION_DEFAULTS.monthlyIncome })}>
                    Load example
                  </Button>
                </div>
              </div>
              {errors.debts && <p className="mb-2 text-xs font-medium text-red-600">{errors.debts}</p>}
              <div className="space-y-3">
                {s.debts.map((d, idx) => (
                  <div key={d.id} className={cx('rounded-xl border p-3 sm:p-4', d.include ? 'border-brand-200 bg-brand-50/30' : 'border-slate-200 bg-white')}>
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <Checkbox checked={d.include} onChange={(include) => setDebt(d.id, { include })} label={<span className="font-medium">Include in consolidation</span>} />
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">Debt {idx + 1}</span>
                        <Button variant="ghost" size="sm" aria-label={`Remove ${d.name || `debt ${idx + 1}`}`} disabled={s.debts.length <= 1} onClick={() => set({ debts: s.debts.filter((x) => x.id !== d.id) })}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
                      <Field label="Debt name" error={errors[`name-${d.id}`]}>
                        <TextInput aria-label={`Debt ${idx + 1} name`} value={d.name} invalid={!!errors[`name-${d.id}`]} onChange={(e) => setDebt(d.id, { name: e.target.value })} />
                      </Field>
                      <Field label="Type">
                        <Select<DebtType> ariaLabel={`Debt ${idx + 1} type`} value={d.type} onChange={(type) => setDebt(d.id, { type })} options={DEBT_TYPES} />
                      </Field>
                      <Field label="Balance">
                        <NumberInput ariaLabel={`Debt ${idx + 1} balance`} prefix="$" decimals={0} min={0} value={d.balance} onChange={(balance) => setDebt(d.id, { balance })} />
                      </Field>
                      <Field label="Monthly payment">
                        <NumberInput ariaLabel={`Debt ${idx + 1} monthly payment`} prefix="$" decimals={0} min={0} value={d.payment} onChange={(payment) => setDebt(d.id, { payment })} />
                      </Field>
                      <Field label="Rate">
                        <NumberInput ariaLabel={`Debt ${idx + 1} rate`} suffix="%" decimals={3} min={0} max={99} value={d.ratePct} onChange={(ratePct) => setDebt(d.id, { ratePct })} />
                      </Field>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <Button variant="subtle" icon={<Plus className="h-4 w-4" />} disabled={s.debts.length >= 12} onClick={() => set({ debts: [...s.debts, newDebt(s.debts.length + 1)] })}>
                  Add new debt
                </Button>
                <div className="text-sm text-slate-600">
                  {debtsSum.all.count} debt{debtsSum.all.count === 1 ? '' : 's'} · {usd(debtsSum.all.balance)} · {usd(debtsSum.all.payment)}/mo
                  <span className="ml-2 font-semibold text-brand-700">
                    Consolidating {usd(debtsSum.included.balance)} ({usd(debtsSum.included.payment)}/mo)
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {s.step === 1 && (
          <div className="space-y-5">
            <Callout tone="info" title="Demo defaults">
              The live session never reached this step with data, so the existing home is illustrative: bought mid-2023 for {usd(460000)} with 20% down at 7.25%, now worth about {usd(500000)}. Edit anything.
            </Callout>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <LocationPicker value={s.existing.locationId} onChange={(locationId) => setExisting({ locationId })} />
              <Money label="Original purchase price" value={s.existing.originalPrice} onChange={(originalPrice) => setExisting({ originalPrice })} />
              <Field label="Purchase date">
                <TextInput aria-label="Purchase date" type="date" value={s.existing.purchaseDate} max={asOf.toISOString().slice(0, 10)} onChange={(e) => setExisting({ purchaseDate: e.target.value })} />
              </Field>
              <Money label="Property tax (annual)" suffix="/yr" value={s.existing.taxAnnual} onChange={(taxAnnual) => setExisting({ taxAnnual })} hint={`County avg ${pct(loc.taxRatePct, 2)} · ${usd(s.existing.taxAnnual / 12)}/mo`} />
              <Money label="Home insurance (monthly)" suffix="/mo" value={s.existing.insuranceMonthly} onChange={(insuranceMonthly) => setExisting({ insuranceMonthly })} />
              <Money label="Association (monthly)" suffix="/mo" value={s.existing.hoaMonthly} onChange={(hoaMonthly) => setExisting({ hoaMonthly })} />
              <Field label="Estimated home value" error={errors.estValue}>
                <NumberInput ariaLabel="Estimated home value" prefix="$" decimals={0} min={0} invalid={!!errors.estValue} value={s.existing.estValue} onChange={(estValue) => set({ existing: { ...s.existing, estValue }, refi: { ...s.refi, appraisedValue: estValue } })} />
              </Field>
              <Money label="Existing loan amount" value={s.existing.loanAmount} onChange={(loanAmount) => setExisting({ loanAmount })} hint="Original amount" />
              <Field label="Term">
                <Select ariaLabel="Existing term" value={String(s.existing.termYears)} onChange={(v) => setExisting({ termYears: Number(v) })} options={TERMS} />
              </Field>
              <Field label="Program">
                <Select<DcProgram> ariaLabel="Existing program" value={s.existing.program} onChange={(program) => setExisting({ program })} options={PROGRAMS} />
              </Field>
              <Field label="Type">
                <Select ariaLabel="Existing loan type" value="Fixed" onChange={() => {}} options={[{ value: 'Fixed', label: 'Fixed' }]} />
              </Field>
              <Field label="Rate" error={errors.rate}>
                <NumberInput ariaLabel="Existing rate" suffix="%" decimals={3} min={0} max={30} invalid={!!errors.rate} value={s.existing.ratePct} onChange={(ratePct) => setExisting({ ratePct })} />
              </Field>
              <Money label="MI (monthly)" suffix="/mo" value={s.existing.miMonthly} onChange={(miMonthly) => setExisting({ miMonthly })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Computed label="Monthly payment (P&I)" value={usd(ex.pi)} sub={`${usd(ex.housing)}/mo with taxes, insurance, HOA & MI`} />
              <Computed label="Remaining balance" value={usd(ex.balance)} sub={`After ${ex.monthsPaid} payments · ${yearsMonths(ex.remainingMonths)} left`} />
              <Computed label="Total equity" value={usd(ex.equity)} sub={`${pct(ex.equityPct, 1)} of value`} tone={ex.equity >= 0 ? 'gain' : 'loss'} />
            </div>
          </div>
        )}

        {s.step === 2 && s.tab === 'refinance' && (
          <div className="space-y-5">
            <div>
              <h3 className="text-[15px] font-semibold text-slate-900">Refinance property & loan limits</h3>
              <p className="text-sm text-slate-500">Cash-out refinance on {loc.label}. The new loan pays off the existing mortgage and the checked debts.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Field label="Value for refinance" error={errors.appraised} hint={s.refi.appraisedValue !== s.existing.estValue ? <button type="button" className="text-brand-700 hover:underline" onClick={() => setRefi({ appraisedValue: s.existing.estValue })}>Use estimated value ({usd(s.existing.estValue)})</button> : 'Estimated value'}>
                <NumberInput ariaLabel="Value for refinance" prefix="$" decimals={0} min={0} value={s.refi.appraisedValue} onChange={(appraisedValue) => setRefi({ appraisedValue })} />
              </Field>
              <Percent label="Max cash-out LTV" value={s.refi.maxLtvPct} onChange={(maxLtvPct) => setRefi({ maxLtvPct })} hint={`${s.proposed.program} guideline ${CASH_OUT_MAX_LTV[s.proposed.program]}%`} />
              <Money label="Closing costs" value={s.refi.closingCosts} onChange={(closingCosts) => setRefi({ closingCosts })} hint="Financed into the new loan" />
              <Money label="Additional cash out" value={s.refi.additionalCashOut} onChange={(additionalCashOut) => setRefi({ additionalCashOut })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Computed label="Payoff existing" value={usd(ex.balance)} />
              <Computed label="Debts consolidated" value={usd(debtsSum.included.balance)} />
              <Computed label="New loan" value={usd(result.newLoan.amount)} sub={`${pct(result.newLoan.ltvPct, 1)} LTV`} tone={result.newLoan.exceedsMaxLtv ? 'loss' : undefined} />
              <Computed label="Max loan" value={usd(result.newLoan.maxLoan)} sub={`Room for ${usd(result.newLoan.roomForDebts)} of debts`} />
            </div>
            {result.newLoan.exceedsMaxLtv && <Callout tone="warning">{result.warnings[0]}</Callout>}
          </div>
        )}

        {s.step === 2 && s.tab === 'moveup' && (
          <div className="space-y-5">
            <div>
              <h3 className="text-[15px] font-semibold text-slate-900">Sell & buy</h3>
              <p className="text-sm text-slate-500">Sell the current home, pay off the checked debts from the proceeds, and put the rest down on the new home.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Percent label="Cost to sell current home" value={s.moveUp.costToSellPct} onChange={(costToSellPct) => setMoveUp({ costToSellPct })} hint={`${usd((s.existing.estValue * s.moveUp.costToSellPct) / 100)} on ${usd(s.existing.estValue)}`} max={20} />
              <LocationPicker
                label="New home location"
                value={s.moveUp.newLocationId}
                onChange={(newLocationId) => setMoveUp({ newLocationId, newTaxAnnual: countyTaxAnnual(newLocationId, s.moveUp.newPrice), newInsuranceMonthly: getLocation(newLocationId).insuranceMonthly })}
              />
              <Field label="New home price" error={errors.newPrice}>
                <NumberInput
                  ariaLabel="New home price"
                  prefix="$"
                  decimals={0}
                  min={0}
                  invalid={!!errors.newPrice}
                  value={s.moveUp.newPrice}
                  onChange={(newPrice) => setMoveUp({ newPrice, newTaxAnnual: Math.abs(s.moveUp.newTaxAnnual - newCountyTax) < 1 ? countyTaxAnnual(s.moveUp.newLocationId, newPrice) : s.moveUp.newTaxAnnual })}
                />
              </Field>
              <Money
                label="Property tax (annual)"
                suffix="/yr"
                value={s.moveUp.newTaxAnnual}
                onChange={(newTaxAnnual) => setMoveUp({ newTaxAnnual })}
                hint={
                  Math.abs(s.moveUp.newTaxAnnual - newCountyTax) < 1 ? (
                    `County avg ${pct(newLoc.taxRatePct, 2)} · ${newLoc.county}`
                  ) : (
                    <button type="button" className="text-brand-700 hover:underline" onClick={() => setMoveUp({ newTaxAnnual: newCountyTax })}>
                      Reset to county average ({usd(newCountyTax)})
                    </button>
                  )
                }
              />
              <Money label="Home insurance (monthly)" suffix="/mo" value={s.moveUp.newInsuranceMonthly} onChange={(newInsuranceMonthly) => setMoveUp({ newInsuranceMonthly })} />
              <Money label="Association (monthly)" suffix="/mo" value={s.moveUp.newHoaMonthly} onChange={(newHoaMonthly) => setMoveUp({ newHoaMonthly })} />
              <Percent label="Purchase closing costs" value={s.moveUp.purchaseClosingPct} onChange={(purchaseClosingPct) => setMoveUp({ purchaseClosingPct })} hint={`${usd((s.moveUp.newPrice * s.moveUp.purchaseClosingPct) / 100)} paid from proceeds`} max={20} />
            </div>
            {result.moveUp && (
              <div className="grid gap-3 sm:grid-cols-4">
                <Computed label="Net sale proceeds" value={usd(result.moveUp.netProceeds)} sub={`${usd(s.existing.estValue)} − ${usd(result.moveUp.costToSell)} − ${usd(ex.balance)}`} tone={result.moveUp.netProceeds < 0 ? 'loss' : undefined} />
                <Computed label="Debts paid at closing" value={usd(debtsSum.included.balance)} />
                <Computed label="Down payment" value={usd(result.moveUp.down)} sub={`${pct(result.moveUp.downPct, 2)} of price`} />
                <Computed label="New loan" value={usd(result.newLoan.amount)} sub={`${pct(result.newLoan.ltvPct, 1)} LTV`} tone={result.newLoan.exceedsMaxLtv ? 'loss' : undefined} />
              </div>
            )}
            {result.warnings.filter((w) => !/never pays off/.test(w)).map((w) => (
              <Callout key={w} tone="warning">
                {w}
              </Callout>
            ))}
          </div>
        )}

        {s.step === 3 && (
          <div className="space-y-5">
            <div>
              <h3 className="text-[15px] font-semibold text-slate-900">Proposed loan</h3>
              <p className="text-sm text-slate-500">{s.tab === 'refinance' ? 'Cash-out refinance' : 'Purchase loan on the new home'} — manual entry, no pricing engine.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Field label="Program">
                <Select<DcProgram> ariaLabel="Proposed program" value={s.proposed.program} onChange={(program) => set({ proposed: { ...s.proposed, program }, refi: { ...s.refi, maxLtvPct: CASH_OUT_MAX_LTV[program] } })} options={PROGRAMS} />
              </Field>
              <Field label="Term">
                <Select ariaLabel="Proposed term" value={String(s.proposed.termYears)} onChange={(v) => setProposed({ termYears: Number(v) })} options={TERMS} />
              </Field>
              <Field label="Type">
                <Select ariaLabel="Proposed loan type" value="Fixed" onChange={() => {}} options={[{ value: 'Fixed', label: 'Fixed' }]} />
              </Field>
              <Field label="Rate" error={errors.proposedRate}>
                <NumberInput ariaLabel="Proposed rate" suffix="%" decimals={3} min={0} max={30} invalid={!!errors.proposedRate} value={s.proposed.ratePct} onChange={(ratePct) => setProposed({ ratePct })} />
              </Field>
              <Field label="MI" hint={s.proposed.miMode === 'auto' ? (result.newLoan.miRatePct ? `${pct(result.newLoan.miRatePct, 2)}/yr at ${pct(result.newLoan.ltvPct, 1)} LTV` : 'None at this LTV') : 'Fixed monthly MI'}>
                <Select
                  ariaLabel="MI mode"
                  value={s.proposed.miMode}
                  onChange={(miMode) => setProposed({ miMode: miMode as 'auto' | 'manual', miMonthly: Math.round(result.newLoan.mi) })}
                  options={[
                    { value: 'auto', label: 'Auto (rate card)' },
                    { value: 'manual', label: 'Manual $' },
                  ]}
                />
              </Field>
              {s.proposed.miMode === 'auto' ? (
                <Field label="FICO (for MI)">
                  <Select ariaLabel="FICO" value={s.proposed.fico} onChange={(fico) => setProposed({ fico: fico as FicoBand })} options={FICO_BANDS.map((f) => ({ value: f, label: f }))} />
                </Field>
              ) : (
                <Money label="MI (monthly)" suffix="/mo" value={s.proposed.miMonthly} onChange={(miMonthly) => setProposed({ miMonthly })} />
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Computed label="Loan amount" value={usd(result.newLoan.amount)} sub={`${pct(result.newLoan.ltvPct, 1)} LTV`} />
              <Computed label="P&I" value={usd(result.newLoan.pi)} />
              <Computed label="MI" value={usd(result.newLoan.mi)} />
              <Computed label="New total monthly" value={usd(result.after.total)} sub={`vs ${usd(result.before.total)} today`} />
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} disabled={s.step === 0} onClick={() => set({ step: Math.max(0, s.step - 1) })}>
            Back
          </Button>
          {Object.keys(errors).length > 0 && <span className="text-sm font-medium text-red-600">{errors.client ?? Object.values(errors)[0]}</span>}
          {s.step < 3 ? (
            <Button onClick={() => goTo(s.step + 1)}>
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button icon={<Calculator className="h-4 w-4" />} onClick={() => goTo(4)}>
              See results
            </Button>
          )}
        </div>
      </Card>
    </CalculatorShell>
  );
}
