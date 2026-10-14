'use client';

/**
 * Loan Comparison — the core tool. Step 1 Property (client required) → Step 2 Loan options →
 * Results (True Cost Comparison). The whole scenario lives in the URL (?s=) so Share works.
 */
import { ArrowRight, MapPin, MessageSquareText, Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CalculatorShell } from '@/components/calc/CalculatorShell';
import { requireClient, ClientPicker } from '@/components/calc/ClientPicker';
import { PropertyEditor } from '@/components/calc/PropertyEditor';
import { ReportFooter } from '@/components/calc/ReportFooter';
import { ResultsHeader } from '@/components/calc/ResultsHeader';
import { Stepper } from '@/components/calc/Stepper';
import { Accordion, Button, Callout, Card, NumberInput, cx } from '@/components/ui';
import { getLocation } from '@/data/mock/locations';
import { alexLoanOptions, compareLoans, loanAmountOf, propertyVariants, type LoanOption } from '@/lib/calculations/loanCompare';
import { alexProperty, type PropertyInput } from '@/lib/calculations/property';
import { pct, usd } from '@/lib/format';
import { useStore } from '@/lib/store';
import { useUrlState } from '@/lib/useUrlState';
import { ComparisonResults, comparisonCsv, DEFAULT_REINVEST, type ReinvestSettings } from './ComparisonResults';
import { LoanOptionModal } from './LoanOptionModal';
import { LoanOptionsList } from './LoanOptionsList';
import { ClientEditModal, CoBrandingSection, encodeScenario, MessageModal, PartnerBlock, StepCard } from './shared';

export interface LoanCompareState {
  step: 0 | 1 | 2;
  clientId: string | null;
  property: PropertyInput;
  options: LoanOption[];
  holdingYears: number;
  reinvest: ReinvestSettings;
  message: string;
  partnerIdx: number | null;
  variant: string;
}

export const LC_DEFAULTS: LoanCompareState = {
  step: 0,
  clientId: 'c-alex-rivera',
  property: alexProperty(),
  options: alexLoanOptions(),
  holdingYears: 7,
  reinvest: DEFAULT_REINVEST,
  message: '',
  partnerIdx: null,
  variant: 'primary',
};

const STEPS = ['Property', 'Loan options', 'Results'];

export function loanCompareHref(state: Partial<LoanCompareState>) {
  return `/members/loan-compare?s=${encodeScenario({ ...LC_DEFAULTS, ...state })}`;
}

export function LoanCompareTool() {
  const [s, setS] = useUrlState<LoanCompareState>(LC_DEFAULTS);
  const { getClient } = useStore();
  const [clientError, setClientError] = useState<string | null>(null);
  const [clientOpen, setClientOpen] = useState(false);
  const [msgOpen, setMsgOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const set = (patch: Partial<LoanCompareState>) => setS((p) => ({ ...p, ...patch }));
  const client = getClient(s.clientId);

  const variants = useMemo(() => propertyVariants(s.property), [s.property]);
  const active = variants.find((v) => v.key === s.variant) ?? variants[0];
  const loc = getLocation(active.property.locationId);
  const opt1 = s.options[0];

  const goNext = () => {
    const err = requireClient(s.clientId);
    setClientError(err);
    if (!err) set({ step: 1 });
  };
  const gotoStep = (i: number) => set({ step: i as 0 | 1 | 2 });
  const scrollTop = () => typeof window !== 'undefined' && window.scrollTo({ top: 0, behavior: 'smooth' });

  const savedCurrent = { price: s.property.price, loanAmount: opt1 ? loanAmountOf(s.property.price, opt1) : 0, ratePct: opt1?.ratePct, locationId: s.property.locationId };
  const useSaved = (sv: { price: number; loanAmount: number; ratePct: number; locationId: string }) => {
    const l = getLocation(sv.locationId);
    setS((p) => ({
      ...p,
      property: { ...p.property, price: sv.price, locationId: sv.locationId, appraisedValue: sv.price, insuranceMonthly: l.insuranceMonthly, taxAnnual: Math.round((sv.price * l.taxRatePct) / 100) },
      options: p.options.map((o, i) => (i === 0 ? { ...o, ratePct: sv.ratePct, aprPct: sv.ratePct, downPct: sv.price > 0 ? ((sv.price - sv.loanAmount) / sv.price) * 100 : o.downPct } : o)),
    }));
  };

  /* ------------------------------------------------------------ steps 1 & 2 */
  if (s.step < 2) {
    return (
      <CalculatorShell toolId="loan-compare" subtitle="Compare up to four loan quotes on monthly payment, total cost and equity over the time your client will own the home.">
        <Stepper steps={STEPS} current={s.step} onStep={gotoStep} />
        {s.step === 0 ? (
          <StepCard
            title="Property"
            subtitle="Who is this for, and what are they buying?"
            footer={
              <>
                <span className="text-xs text-slate-500">Step 1 of 2 · taxes, insurance and appreciation feed every loan option</span>
                <Button onClick={goNext} icon={<ArrowRight className="h-4 w-4" />} className="flex-row-reverse">
                  Next
                </Button>
              </>
            }
          >
            <div className="space-y-6">
              <div className="max-w-md">
                <ClientPicker
                  value={s.clientId}
                  onChange={(id) => {
                    set({ clientId: id });
                    if (id) setClientError(null);
                  }}
                  error={clientError}
                  current={savedCurrent}
                  onUseSaved={useSaved}
                />
              </div>
              <PropertyEditor value={s.property} onChange={(property) => set({ property })} />
            </div>
          </StepCard>
        ) : (
          <StepCard
            title="Loan options"
            subtitle={`Enter each quote manually · ${usd(s.property.price)} in ${getLocation(s.property.locationId).label}`}
            footer={
              <>
                <Button variant="secondary" onClick={() => set({ step: 0 })}>
                  Back
                </Button>
                <Button
                  disabled={s.options.length === 0}
                  onClick={() => {
                    set({ step: 2 });
                    scrollTop();
                  }}
                >
                  Compare {s.options.length} option{s.options.length === 1 ? '' : 's'}
                </Button>
              </>
            }
          >
            <LoanOptionsList options={s.options} price={s.property.price} onChange={(options) => set({ options })} />
          </StepCard>
        )}
      </CalculatorShell>
    );
  }

  /* ------------------------------------------------------------ results */
  const c = compareLoans(active.property, s.options, s.holdingYears);
  const editingOpt = s.options.find((o) => o.id === editId) ?? null;
  const emailBody = [
    `Hi ${client?.name ?? 'there'},`,
    '',
    `Here is your True Cost Comparison for a ${usd(active.property.price)} home in ${loc.label}, assuming you own it ${s.holdingYears} years:`,
    ...c.options.map((o) => `• ${o.label}: ${pct(o.ratePct, 3)} — ${usd(o.totalMonthly)}/mo, ${usd(o.cashToClose)} to close, ${usd(o.totalCost)} total cost, ${usd(o.totalEquity)} equity`),
  ].join('\n');

  return (
    <CalculatorShell toolId="loan-compare" title="True Cost Comparison" subtitle={`${client?.name ?? 'No client'} · ${usd(active.property.price)} · ${loc.label}`}>
      <ResultsHeader
        toolId="loan-compare"
        scenarioTitle={`Loan Comparison · ${usd(active.property.price)} · ${loc.label}`}
        clientId={s.clientId}
        onBack={() => set({ step: 1 })}
        csv={() => comparisonCsv(active.property, s.options, s.holdingYears, s.reinvest)}
        emailBody={emailBody}
        data={s}
        chips={[
          { label: 'Client', value: client?.name ?? 'Client name is required', onEdit: () => setClientOpen(true) },
          { label: 'Property', value: `${usd(active.property.price)} · ${loc.label}`, onEdit: () => set({ step: 0 }) },
          { label: 'Loans', value: `${s.options.length} option${s.options.length === 1 ? '' : 's'} · ${s.options.map((o) => pct(o.ratePct, 3)).join(' vs ')}`, onEdit: () => set({ step: 1 }) },
        ]}
      />
      {!client && (
        <Callout tone="error" title="Client name is required">
          Pick a client so the report is addressed correctly.{' '}
          <button type="button" className="font-semibold underline" onClick={() => setClientOpen(true)}>
            Choose client
          </button>
        </Callout>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="no-print h-fit min-w-0 xl:sticky xl:top-[7.5rem]">
          <Card padded={false} className="px-4 py-1">
            <Accordion title="Locations" count={variants.length} defaultOpen={variants.length > 1}>
              <div className="space-y-1.5">
                {variants.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => set({ variant: v.key })}
                    className={cx('flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm', v.key === active.key ? 'border-brand-400 bg-brand-50/60' : 'border-slate-200 hover:border-slate-300')}
                  >
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-900">{v.label}</span>
                      <span className="block text-xs text-slate-500">
                        {usd(v.property.price)} · tax {usd(v.property.taxAnnual / 12)}/mo · ins {usd(v.property.insuranceMonthly)}/mo
                      </span>
                    </span>
                  </button>
                ))}
                <button type="button" onClick={() => set({ step: 0 })} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                  <Plus className="h-3 w-3" /> Add price or location
                </button>
              </div>
            </Accordion>
            <Accordion title="Loan options" count={s.options.length} defaultOpen>
              <LoanOptionsList compact options={s.options} price={active.property.price} onChange={(options) => set({ options })} />
            </Accordion>
            <Accordion
              title="Reinvestment strategy"
              defaultOpen={s.reinvest.enabled}
              action={
                !s.reinvest.enabled ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Plus className="h-3.5 w-3.5" />}
                    onClick={() => {
                      const worst = Math.max(...c.options.map((o) => o.totalMonthly));
                      set({ reinvest: { ...s.reinvest, enabled: true, ids: c.options.filter((o) => o.totalMonthly < worst - 0.5).map((o) => o.id) } });
                    }}
                  >
                    Add
                  </Button>
                ) : undefined
              }
            >
              {s.reinvest.enabled ? (
                <div className="space-y-3 text-sm">
                  <p className="text-slate-600">Invest each option’s monthly savings vs. the highest payment.</p>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-600">Return</span>
                    <NumberInput ariaLabel="Reinvestment return" className="w-28" suffix="%/yr" decimals={2} min={0} max={30} value={s.reinvest.ratePct} onChange={(ratePct) => set({ reinvest: { ...s.reinvest, ratePct } })} />
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => set({ reinvest: { ...s.reinvest, enabled: false, ids: [] } })}>
                    Remove strategy
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-slate-500">Show what the monthly savings grow to if invested.</p>
              )}
            </Accordion>
            <Accordion title="Co-branding" action={<span className="text-xs text-slate-400">{s.partnerIdx != null ? '2 on report' : 'You'}</span>}>
              <CoBrandingSection compact partnerIdx={s.partnerIdx} onPartnerChange={(partnerIdx) => set({ partnerIdx })} />
            </Accordion>
            <Accordion
              title="Custom message"
              action={
                <Button variant="ghost" size="sm" icon={s.message ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} onClick={() => setMsgOpen(true)}>
                  {s.message ? 'Edit' : 'Add'}
                </Button>
              }
            >
              {s.message ? <p className="whitespace-pre-line text-sm text-slate-600">“{s.message}”</p> : <p className="text-sm text-slate-500">Add a personal note to the top of the report.</p>}
            </Accordion>
          </Card>
        </aside>

        <div className="min-w-0">
          <ComparisonResults
            property={active.property}
            locationLabel={loc.label}
            options={s.options}
            holdingYears={s.holdingYears}
            onHoldingChange={(holdingYears) => set({ holdingYears })}
            clientName={client?.name}
            message={s.message}
            reinvest={s.reinvest}
            onReinvestChange={(reinvest) => set({ reinvest })}
            onEditOption={setEditId}
          />
          <PartnerBlock partnerIdx={s.partnerIdx} />
          <ReportFooter />
          <div className="no-print mt-6 flex flex-wrap gap-3">
            <Link href="/members/cost-of-waiting" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
              <MessageSquareText className="h-4 w-4" /> Next in the meeting: Cost of Waiting <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>

      <ClientEditModal open={clientOpen} onClose={() => setClientOpen(false)} value={s.clientId} onChange={(clientId) => set({ clientId })} current={savedCurrent} onUseSaved={useSaved} />
      {msgOpen && <MessageModal open onClose={() => setMsgOpen(false)} value={s.message} onSave={(message) => set({ message })} />}
      <LoanOptionModal
        open={!!editingOpt}
        initial={editingOpt}
        price={active.property.price}
        onClose={() => setEditId(null)}
        onSave={(o) => set({ options: s.options.map((x) => (x.id === editId ? { ...o, id: x.id } : x)) })}
      />
    </CalculatorShell>
  );
}
