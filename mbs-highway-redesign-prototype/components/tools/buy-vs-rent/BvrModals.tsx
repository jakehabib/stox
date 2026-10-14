'use client';

import { RotateCcw } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { ClientPicker } from '@/components/calc/ClientPicker';
import { LocationPicker } from '@/components/calc/LocationPicker';
import { CoBrandingEditor } from '@/components/calc/ReportFooter';
import { Button, Field, Modal, NumberInput, RadioGroup, Select, Switch } from '@/components/ui';
import { BAH_AREAS, BAH_GRADES, bahAllowance, stateIncomeTaxPct, type BahGrade } from '@/data/mock/buyVsRent';
import { getLocation } from '@/data/mock/locations';
import { displayedRate, type AppreciationMode } from '@/lib/calculations/appreciation';
import { calcBuyVsRent, defaultRepairsMonthly, FEDERAL_RATES, federalMarginalRate, FILING_STATUS_LABELS, STANDARD_DEDUCTION, TERM_OPTIONS, type FilingStatus } from '@/lib/calculations/buyVsRent';
import { countyTaxAnnual } from '@/lib/calculations/property';
import { pct, usd } from '@/lib/format';
import type { BvrState } from './state';

type EditProps = { open: boolean; onClose: () => void; value: BvrState; onSave: (patch: Partial<BvrState>) => void };

/** Draft-then-save modal shell: edits stay local until Save. */
function useDraft(open: boolean, value: BvrState) {
  const [d, setD] = useState<BvrState>(value);
  useEffect(() => {
    if (open) setD(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (patch: Partial<BvrState>) => setD((x) => ({ ...x, ...patch }));
  return [d, set] as const;
}

function Footer({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  return (
    <>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button onClick={onSave}>Save</Button>
    </>
  );
}

function ResetLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
      <RotateCcw className="h-3 w-3" /> {children}
    </button>
  );
}

export function PropertyEditModal({ open, onClose, value, onSave }: EditProps) {
  const [d, set] = useDraft(open, value);
  const [cobrand, setCobrand] = useState(false);
  const loc = getLocation(d.locationId);
  const county = countyTaxAnnual(d.locationId, d.price);
  const repairsDefault = defaultRepairsMonthly(d.price);
  return (
    <Modal open={open} onClose={onClose} title="Edit property" size="lg" footer={<Footer onClose={onClose} onSave={() => (onSave(d), onClose())} />}>
      <div className="grid gap-4 sm:grid-cols-2">
        <LocationPicker
          value={d.locationId}
          onChange={(id) => {
            if (id === d.locationId) return;
            const l = getLocation(id);
            set({ locationId: id, taxAnnual: countyTaxAnnual(id, d.price), insuranceMonthly: l.insuranceMonthly, statePct: stateIncomeTaxPct(l.state) });
          }}
        />
        <Field label="Purchase Price">
          <NumberInput ariaLabel="Purchase Price" prefix="$" decimals={0} value={d.price} onChange={(price) => set({ price, appraisedValue: d.useAppraised ? d.appraisedValue : price })} />
        </Field>
        <div className="flex flex-col justify-end gap-2 sm:col-span-2 sm:flex-row sm:items-center">
          <Switch checked={d.useAppraised} onChange={(useAppraised) => set({ useAppraised, appraisedValue: d.appraisedValue || d.price })} label="Appraised value differs from price" />
          {d.useAppraised && (
            <div className="sm:ml-auto sm:w-48">
              <NumberInput ariaLabel="Appraised Value" prefix="$" decimals={0} value={d.appraisedValue} onChange={(appraisedValue) => set({ appraisedValue })} />
            </div>
          )}
        </div>
        <Field
          label="Property Tax (Annual)"
          hint={`County average ${usd(county)} · ${pct(loc.taxRatePct, 2)} ${loc.city}`}
          right={Math.abs(d.taxAnnual - county) >= 1 && <ResetLink onClick={() => set({ taxAnnual: county })}>Reset to county average</ResetLink>}
        >
          <NumberInput ariaLabel="Property Tax Annual" prefix="$" suffix="/yr" decimals={0} value={d.taxAnnual} onChange={(taxAnnual) => set({ taxAnnual })} />
        </Field>
        <Field label="Annual tax increase">
          <NumberInput ariaLabel="Annual tax increase" suffix="%" decimals={2} value={d.taxIncreasePct} onChange={(taxIncreasePct) => set({ taxIncreasePct })} />
        </Field>
        <Field
          label="Home Insurance (Monthly)"
          hint={`Default for ${loc.city}: ${usd(loc.insuranceMonthly)}/mo`}
          right={d.insuranceMonthly !== loc.insuranceMonthly && <ResetLink onClick={() => set({ insuranceMonthly: loc.insuranceMonthly })}>Reset to default</ResetLink>}
        >
          <NumberInput ariaLabel="Home Insurance Monthly" prefix="$" suffix="/mo" decimals={2} value={d.insuranceMonthly} onChange={(insuranceMonthly) => set({ insuranceMonthly })} />
        </Field>
        <Field label="Association Fee (Monthly)">
          <NumberInput ariaLabel="Association Fee" prefix="$" suffix="/mo" decimals={2} value={d.hoaMonthly} onChange={(hoaMonthly) => set({ hoaMonthly })} />
        </Field>
        <Field
          label="Repairs & Maintenance (Monthly)"
          hint="Default 0.5% of price per year"
          right={Math.abs(d.repairsMonthly - repairsDefault) > 0.5 && <ResetLink onClick={() => set({ repairsMonthly: repairsDefault })}>Reset to 0.5%</ResetLink>}
        >
          <NumberInput ariaLabel="Repairs Monthly" prefix="$" suffix="/mo" decimals={2} value={d.repairsMonthly} onChange={(repairsMonthly) => set({ repairsMonthly })} />
        </Field>
        <Field label="Cost to Sell" hint="Commissions + seller closing, % of sale value">
          <NumberInput ariaLabel="Cost to Sell" suffix="%" decimals={2} value={d.costToSellPct} onChange={(costToSellPct) => set({ costToSellPct })} />
        </Field>
        <Field label="Appreciation" className="sm:col-span-2" hint={`Using ${pct(displayedRate(loc, d.appreciation), 3)} per year · Demo forecast data`}>
          <div className="flex flex-wrap items-center gap-3">
            <RadioGroup<AppreciationMode>
              value={d.appreciation.mode}
              onChange={(mode) => set({ appreciation: { mode, customPct: d.appreciation.customPct ?? 4 } })}
              options={[
                { value: 'forecast', label: 'Forecast', hint: pct(loc.forecastDisplayPct, 3) },
                { value: 'historical', label: 'Historical', hint: pct(loc.historicalPct, 3) },
                { value: 'custom', label: 'Custom' },
              ]}
            />
            {d.appreciation.mode === 'custom' && (
              <div className="w-32">
                <NumberInput ariaLabel="Custom appreciation" suffix="%/yr" decimals={3} value={d.appreciation.customPct ?? 4} onChange={(customPct) => set({ appreciation: { mode: 'custom', customPct } })} />
              </div>
            )}
          </div>
        </Field>
        <div className="sm:col-span-2">
          <Button variant="subtle" size="sm" onClick={() => setCobrand(true)}>
            Add co-branding
          </Button>
        </div>
      </div>
      <CoBrandingEditor open={cobrand} onClose={() => setCobrand(false)} />
    </Modal>
  );
}

export function LoanEditModal({ open, onClose, value, onSave }: EditProps) {
  const [d, set] = useDraft(open, value);
  return (
    <Modal open={open} onClose={onClose} title="Edit loan" size="lg" footer={<Footer onClose={onClose} onSave={() => (onSave(d), onClose())} />}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Loan Amount" hint={`Down payment ${usd(Math.max(0, d.price - d.loanAmount))} (${pct(d.price > 0 ? ((d.price - d.loanAmount) / d.price) * 100 : 0, 1)})`}>
          <NumberInput ariaLabel="Loan Amount" prefix="$" decimals={0} value={d.loanAmount} onChange={(loanAmount) => set({ loanAmount })} />
        </Field>
        <Field label="Program">
          <Select ariaLabel="Program" value={d.program} onChange={(program) => set({ program })} options={['Conventional', 'FHA', 'VA', 'Jumbo'] as const} />
        </Field>
        <Field label="Term">
          <Select ariaLabel="Term" value={String(d.termYears)} onChange={(t) => set({ termYears: Number(t) })} options={TERM_OPTIONS.map((t) => ({ value: String(t), label: `${t} years` }))} />
        </Field>
        <Field label="Rate">
          <NumberInput ariaLabel="Rate" suffix="%" decimals={3} value={d.ratePct} onChange={(ratePct) => set({ ratePct })} />
        </Field>
        <Field label="APR">
          <NumberInput ariaLabel="APR" suffix="%" decimals={3} value={d.aprPct} onChange={(aprPct) => set({ aprPct })} />
        </Field>
        <Field label="Purchase Closing Costs">
          <NumberInput ariaLabel="Closing Costs" prefix="$" decimals={0} value={d.closingCosts} onChange={(closingCosts) => set({ closingCosts })} />
        </Field>
        <Field label="Points" hint={d.pointsPct > 0 ? `${usd((d.loanAmount * d.pointsPct) / 100)} added to closing` : 'Percent of loan amount'}>
          <NumberInput ariaLabel="Points" suffix="%" decimals={3} value={d.pointsPct} onChange={(pointsPct) => set({ pointsPct })} />
        </Field>
        <Field label="Mortgage Insurance (Monthly)">
          <NumberInput ariaLabel="Mortgage Insurance" prefix="$" suffix="/mo" decimals={2} value={d.miMonthly} onChange={(miMonthly) => set({ miMonthly })} />
        </Field>
      </div>
    </Modal>
  );
}

export function RentEditModal({ open, onClose, value, onSave }: EditProps) {
  const [d, set] = useDraft(open, value);
  return (
    <Modal open={open} onClose={onClose} title="Edit renting" footer={<Footer onClose={onClose} onSave={() => (onSave(d), onClose())} />}>
      <div className="grid gap-4">
        <Field label="Monthly Rent">
          <NumberInput ariaLabel="Monthly Rent" prefix="$" suffix="/mo" decimals={0} value={d.rentMonthly} onChange={(rentMonthly) => set({ rentMonthly })} />
        </Field>
        <Field label="Renters Insurance (Monthly)">
          <NumberInput ariaLabel="Renters Insurance" prefix="$" suffix="/mo" decimals={2} value={d.rentersInsuranceMonthly} onChange={(rentersInsuranceMonthly) => set({ rentersInsuranceMonthly })} />
        </Field>
        <Field label="Annual Rent Increase" hint="Also applied to renters insurance">
          <NumberInput ariaLabel="Annual Rent Increase" suffix="%" decimals={2} value={d.rentIncreasePct} onChange={(rentIncreasePct) => set({ rentIncreasePct })} />
        </Field>
      </div>
    </Modal>
  );
}

export function TaxEditModal({ open, onClose, value, onSave }: EditProps) {
  const [d, set] = useDraft(open, value);
  const preview = calcBuyVsRent(d, 1).years[0];
  return (
    <Modal open={open} onClose={onClose} title="Edit tax" description="Mortgage interest + property tax above the standard deduction, at your marginal rate." size="lg" footer={<Footer onClose={onClose} onSave={() => (onSave(d), onClose())} />}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Filing Status">
          <Select<FilingStatus>
            ariaLabel="Filing Status"
            value={d.filingStatus}
            onChange={(filingStatus) => set({ filingStatus, standardDeduction: STANDARD_DEDUCTION[filingStatus], federalPct: federalMarginalRate(d.taxableIncome, filingStatus) })}
            options={(Object.keys(FILING_STATUS_LABELS) as FilingStatus[]).map((k) => ({ value: k, label: FILING_STATUS_LABELS[k] }))}
          />
        </Field>
        <Field label="Taxable Income" hint={`Bracket: ${federalMarginalRate(d.taxableIncome, d.filingStatus)}% federal (2026)`}>
          <NumberInput ariaLabel="Taxable Income" prefix="$" decimals={0} value={d.taxableIncome} onChange={(taxableIncome) => set({ taxableIncome, federalPct: federalMarginalRate(taxableIncome, d.filingStatus) })} />
        </Field>
        <Field label="Federal marginal rate">
          <Select ariaLabel="Federal rate" value={String(d.federalPct)} onChange={(v) => set({ federalPct: Number(v) })} options={FEDERAL_RATES.map((r) => ({ value: String(r), label: `${r}%` }))} />
        </Field>
        <Field label="State marginal rate" hint={`${getLocation(d.locationId).stateName} default ${pct(stateIncomeTaxPct(getLocation(d.locationId).state), 2)}`}>
          <NumberInput ariaLabel="State rate" suffix="%" decimals={2} value={d.statePct} onChange={(statePct) => set({ statePct })} />
        </Field>
        <Field label="Standard Deduction" hint={`2026 ${FILING_STATUS_LABELS[d.filingStatus]}: ${usd(STANDARD_DEDUCTION[d.filingStatus])}`}>
          <NumberInput ariaLabel="Standard Deduction" prefix="$" decimals={0} value={d.standardDeduction} onChange={(standardDeduction) => set({ standardDeduction })} />
        </Field>
        <Field label="Tax Benefit">
          <div className="flex h-10 items-center">
            <Switch checked={d.includeTaxBenefit} onChange={(includeTaxBenefit) => set({ includeTaxBenefit })} label="Include in results" />
          </div>
        </Field>
      </div>
      <div className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Year 1: interest {usd(preview.interestPaid)} + property tax {usd(preview.propertyTaxAnnual)} − deduction {usd(d.standardDeduction)} →{' '}
        <span className="font-semibold text-slate-900">{usd(preview.taxBenefit)} tax benefit</span>
      </div>
    </Modal>
  );
}

export function ClientEditModal({ open, onClose, value, onSave }: EditProps) {
  const [d, set] = useDraft(open, value);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit client"
      footer={
        <Footer
          onClose={onClose}
          onSave={() => {
            if (!d.clientId) return setErr('Client name is required');
            onSave({ clientId: d.clientId });
            onClose();
          }}
        />
      }
    >
      <ClientPicker value={d.clientId} onChange={(clientId) => (set({ clientId }), setErr(null))} error={err} />
    </Modal>
  );
}

/** Mock BAH lookup by military housing area + pay grade. */
export function BahLookupModal({ open, onClose, onUse }: { open: boolean; onClose: () => void; onUse: (v: number) => void }) {
  const [areaId, setAreaId] = useState(BAH_AREAS[0].id);
  const [grade, setGrade] = useState<BahGrade>('E-5');
  const [deps, setDeps] = useState(true);
  const amount = bahAllowance(areaId, grade, deps);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Find allowance"
      description="Demo BAH rates by military housing area and pay grade."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => (onUse(amount), onClose())}>Use {usd(amount)}/mo</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Location" className="sm:col-span-2">
          <Select ariaLabel="BAH location" value={areaId} onChange={setAreaId} options={BAH_AREAS.map((a) => ({ value: a.id, label: `${a.label} · ${a.installation}` }))} />
        </Field>
        <Field label="Rank">
          <Select<BahGrade> ariaLabel="Rank" value={grade} onChange={setGrade} options={BAH_GRADES} />
        </Field>
      </div>
      <div className="mt-3">
        <Switch checked={deps} onChange={setDeps} label="With dependents" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {BAH_GRADES.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGrade(g)}
            className={`rounded-lg border px-2 py-2 text-left transition-colors ${g === grade ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-slate-300'}`}
          >
            <div className="text-[11px] font-semibold text-slate-500">{g}</div>
            <div className="text-sm font-semibold tabular-nums text-slate-900">{usd(bahAllowance(areaId, g, deps))}</div>
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">Demo Data — production plugs into the DoD BAH rate lookup by duty-station ZIP.</p>
    </Modal>
  );
}
