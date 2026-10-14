'use client';

/**
 * Add / Edit Loan modal — MANUAL entry (no pricing engine). Shared by Loan Comparison and
 * Purchase Analysis. Validated with Zod; down payment is stored as a percent of price.
 */
import { ChevronDown, Calculator } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { Button, Field, Modal, NumberInput, Segmented, Select, TextInput, cx } from '@/components/ui';
import { cashToClose, downPaymentOf, downPctFromLoan, estimateApr, loanAmountOf, newLoanOption, pointsCost, type LoanOption, type LoanProgram } from '@/lib/calculations/loanCompare';
import { monthlyPayment } from '@/lib/calculations/core';
import { pct, usd } from '@/lib/format';

const schema = z.object({
  downPct: z.number().min(0, 'Down payment can’t be negative').max(99.99, 'Down payment must be less than the price'),
  termYears: z.number().min(1).max(40),
  ratePct: z.number().gt(0, 'Enter a rate').max(25, 'Rate must be 25% or less'),
  aprPct: z.number().min(0).max(30, 'APR must be 30% or less'),
  pointsPct: z.number().min(0).max(10, 'Points must be 10 or less'),
  miMonthly: z.number().min(0),
  closingCosts: z.number().min(0),
  credits: z.number().min(0),
  prepaid: z.number().min(0),
});

const PROGRAMS: LoanProgram[] = ['Conventional', 'FHA', 'VA', 'USDA', 'Jumbo'];
const TERMS = ['30', '25', '20', '15', '10'] as const;

export function LoanOptionModal({
  open,
  onClose,
  onSave,
  price,
  initial,
  title,
  nextLabel,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (o: LoanOption) => void;
  price: number;
  /** Option to edit; omit to add a new one. */
  initial?: LoanOption | null;
  title?: string;
  /** Default label shown as placeholder ("Option 3"). */
  nextLabel?: string;
}) {
  const [draft, setDraft] = useState<LoanOption>(() => initial ?? newLoanOption());
  const [downUnit, setDownUnit] = useState<'fee' | 'percentage'>('percentage');
  const [showCosts, setShowCosts] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setDraft(initial ?? newLoanOption());
    setErrors({});
    setShowCosts(!!initial && (initial.closingCosts > 0 || initial.credits > 0 || initial.prepaid > 0 || initial.pointsPct > 0));
  }, [open, initial]);

  const set = (patch: Partial<LoanOption>) => setDraft((d) => ({ ...d, ...patch }));
  const loan = loanAmountOf(price, draft);
  const down = downPaymentOf(price, draft);
  const pi = monthlyPayment(loan, draft.ratePct, draft.termYears * 12);
  const editing = !!initial;

  const submit = () => {
    const r = schema.safeParse(draft);
    if (!r.success) {
      const e: Record<string, string> = {};
      r.error.issues.forEach((i) => (e[String(i.path[0])] = i.message));
      setErrors(e);
      return;
    }
    onSave({ ...draft, label: draft.label?.trim() || undefined });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={title ?? (editing ? 'Edit loan' : 'Add new loan')}
      description="Manual entry — enter the terms from your quote. No pricing engine is used."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>{editing ? 'Save changes' : 'Add'}</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Option name" hint="Optional — shown on the report">
            <TextInput value={draft.label ?? ''} placeholder={nextLabel ?? 'Option'} onChange={(e) => set({ label: e.target.value })} />
          </Field>
          <Field
            label="Down Payment"
            error={errors.downPct}
            right={<Segmented size="sm" ariaLabel="Down payment unit" value={downUnit} onChange={setDownUnit} options={[{ value: 'fee', label: '$ Fee' }, { value: 'percentage', label: '% Percentage' }]} />}
            hint={downUnit === 'fee' ? `${pct(draft.downPct, 2)} of ${usd(price)}` : `${usd(down)} of ${usd(price)}`}
          >
            {downUnit === 'percentage' ? (
              <NumberInput ariaLabel="Down payment percent" suffix="%" decimals={3} value={draft.downPct} onChange={(v) => set({ downPct: v })} invalid={!!errors.downPct} />
            ) : (
              <NumberInput ariaLabel="Down payment amount" prefix="$" decimals={0} value={Math.round(down)} onChange={(v) => set({ downPct: price > 0 ? (v / price) * 100 : 0 })} invalid={!!errors.downPct} />
            )}
          </Field>
          <Field label="Term">
            <Select ariaLabel="Term" value={String(draft.termYears) as (typeof TERMS)[number]} onChange={(v) => set({ termYears: Number(v) })} options={TERMS.map((t) => ({ value: t, label: `${t} years` }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Program">
              <Select ariaLabel="Program" value={draft.program} onChange={(program) => set({ program })} options={PROGRAMS} />
            </Field>
            <Field label="Loan Type">
              <Select ariaLabel="Loan type" value={draft.loanType} onChange={(loanType) => set({ loanType })} options={[{ value: 'Fixed', label: 'Fixed' }]} />
            </Field>
          </div>
          <Field label="Rate" error={errors.ratePct}>
            <NumberInput ariaLabel="Rate" suffix="%" decimals={3} value={draft.ratePct} onChange={(ratePct) => set({ ratePct, aprPct: draft.aprPct === draft.ratePct ? ratePct : draft.aprPct })} invalid={!!errors.ratePct} />
          </Field>
          <Field
            label="APR"
            error={errors.aprPct}
            right={
              <button type="button" onClick={() => set({ aprPct: estimateApr(price, draft) })} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                <Calculator className="h-3 w-3" /> Estimate from costs
              </button>
            }
          >
            <NumberInput ariaLabel="APR" suffix="%" decimals={3} value={draft.aprPct} onChange={(aprPct) => set({ aprPct })} invalid={!!errors.aprPct} />
          </Field>
          <Field label="Points" error={errors.pointsPct} hint={`${usd(pointsCost(loan, draft.pointsPct))} at closing`}>
            <NumberInput ariaLabel="Points" suffix="pts" decimals={3} value={draft.pointsPct} onChange={(pointsPct) => set({ pointsPct })} invalid={!!errors.pointsPct} />
          </Field>
          <Field label="Monthly MI">
            <NumberInput ariaLabel="Monthly MI" prefix="$" suffix="/mo" decimals={2} value={draft.miMonthly} onChange={(miMonthly) => set({ miMonthly })} />
          </Field>
          <Field label="Total Loan Amount" hint="Editing this adjusts the down payment" className="sm:col-span-2">
            <NumberInput ariaLabel="Total loan amount" prefix="$" decimals={0} value={Math.round(loan)} onChange={(v) => set({ downPct: downPctFromLoan(price, v) })} />
          </Field>
        </div>

        <div className="rounded-lg border border-slate-200">
          <button type="button" onClick={() => setShowCosts(!showCosts)} className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-slate-700" aria-expanded={showCosts}>
            Edit Closing Costs / Credits / Prepaid / Points Buydown
            <ChevronDown className={cx('h-4 w-4 transition-transform', showCosts && 'rotate-180')} />
          </button>
          {showCosts && (
            <div className="grid gap-4 border-t border-slate-100 px-4 py-4 sm:grid-cols-2">
              <Field label="Closing costs">
                <NumberInput ariaLabel="Closing costs" prefix="$" decimals={0} value={draft.closingCosts} onChange={(closingCosts) => set({ closingCosts })} />
              </Field>
              <Field label="Credits (lender/seller)">
                <NumberInput ariaLabel="Credits" prefix="$" decimals={0} value={draft.credits} onChange={(credits) => set({ credits })} />
              </Field>
              <Field label="Prepaid (escrows, interest)">
                <NumberInput ariaLabel="Prepaid" prefix="$" decimals={0} value={draft.prepaid} onChange={(prepaid) => set({ prepaid })} />
              </Field>
              <Field label="Points buydown" hint="Dollar cost of the points above">
                <NumberInput ariaLabel="Points buydown" prefix="$" decimals={0} value={Math.round(pointsCost(loan, draft.pointsPct))} onChange={(v) => set({ pointsPct: loan > 0 ? Math.round((v / loan) * 100 * 1000) / 1000 : 0 })} />
              </Field>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 rounded-lg bg-slate-50 px-4 py-3 text-center">
          <div>
            <div className="text-[11px] font-medium text-slate-500">Loan amount</div>
            <div className="font-semibold tabular-nums text-slate-900">{usd(loan)}</div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-500">P&amp;I</div>
            <div className="font-semibold tabular-nums text-slate-900">{usd(pi, { cents: true })}</div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-500">Cash to close</div>
            <div className="font-semibold tabular-nums text-slate-900">{usd(cashToClose(price, draft))}</div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
