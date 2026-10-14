'use client';

/**
 * Purchase Analysis wizard: PROPERTY INFO > LOAN OPTIONS > COST OF WAITING > CO-BRAND, then a
 * saved summary that reuses the Loan Comparison results and links to the standalone Cost of
 * Waiting with the selected loan. The wizard's COST OF WAITING step is only a loan selector.
 */
import { ArrowLeft, ArrowRight, CheckCircle2, Hourglass, Save } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { CalculatorShell } from '@/components/calc/CalculatorShell';
import { ClientPicker, requireClient } from '@/components/calc/ClientPicker';
import { PropertyEditor } from '@/components/calc/PropertyEditor';
import { ReportFooter } from '@/components/calc/ReportFooter';
import { ResultsHeader } from '@/components/calc/ResultsHeader';
import { Stepper } from '@/components/calc/Stepper';
import { Button, Card, RadioGroup } from '@/components/ui';
import { getLocation } from '@/data/mock/locations';
import { compareLoans, loanAmountOf, newLoanOption, optionLabel, type LoanOption } from '@/lib/calculations/loanCompare';
import { defaultProperty, type PropertyInput } from '@/lib/calculations/property';
import { pct, usd } from '@/lib/format';
import { useStore } from '@/lib/store';
import { useUrlState } from '@/lib/useUrlState';
import { costOfWaitingHref } from '../cost-of-waiting/state';
import { ComparisonResults, comparisonCsv } from '../loan-compare/ComparisonResults';
import { loanSummary, LoanOptionsList } from '../loan-compare/LoanOptionsList';
import { ClientEditModal, CoBrandingSection, PartnerBlock, StepCard } from '../loan-compare/shared';

interface PaState {
  step: 0 | 1 | 2 | 3 | 4;
  clientId: string | null;
  property: PropertyInput;
  options: LoanOption[];
  cowLoanId: string;
  holdingYears: number;
  partnerIdx: number | null;
}

const DEFAULTS: PaState = {
  step: 0,
  clientId: 'c-alex-rivera',
  // Live wizard showed the auto county tax ($9,206/yr, 1.84%) — the LO can type $8,400 (1.68%).
  property: defaultProperty('dallas-tx-75201', 500000),
  options: [newLoanOption({ id: 'opt-1', ratePct: 6.5, aprPct: 6.5 })],
  cowLoanId: 'opt-1',
  holdingYears: 7,
  partnerIdx: null,
};

const STEPS = ['Property info', 'Loan options', 'Cost of waiting', 'Co-brand'];

export function PurchaseAnalysisTool() {
  const [s, setS] = useUrlState<PaState>(DEFAULTS);
  const { getClient, saveScenario, toast } = useStore();
  const [clientError, setClientError] = useState<string | null>(null);
  const [clientOpen, setClientOpen] = useState(false);
  const set = (patch: Partial<PaState>) => setS((p) => ({ ...p, ...patch }));
  const client = getClient(s.clientId);
  const loc = getLocation(s.property.locationId);
  const cowLoan = s.options.find((o) => o.id === s.cowLoanId) ?? s.options[0];
  const cowIdx = cowLoan ? s.options.indexOf(cowLoan) : 0;
  const go = (step: PaState['step']) => {
    set({ step });
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cowHref = cowLoan
    ? costOfWaitingHref({
        step: 2,
        clientId: s.clientId,
        property: { ...s.property, appreciation: { mode: 'custom', customPct: 4 }, alternatePrices: [], extraLocationIds: [] },
        loan: { downPct: cowLoan.downPct, termYears: cowLoan.termYears, ratePct: cowLoan.ratePct, aprPct: cowLoan.aprPct, miMonthly: cowLoan.miMonthly, closingCosts: cowLoan.closingCosts },
        partnerIdx: s.partnerIdx,
      })
    : '/members/cost-of-waiting';

  const save = () => {
    saveScenario({ toolId: 'purchase-analysis', title: `Purchase Analysis · ${usd(s.property.price)} · ${loc.label}`, clientId: s.clientId ?? undefined, clientName: client?.name, href: typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/members/purchase-analysis', data: s });
    toast('Purchase Analysis saved');
    go(4);
  };

  /* ------------------------------------------------------------ summary */
  if (s.step === 4) {
    const c = compareLoans(s.property, s.options, s.holdingYears);
    return (
      <CalculatorShell toolId="purchase-analysis" title="Purchase Analysis" subtitle={`${client?.name ?? 'No client'} · ${usd(s.property.price)} · ${loc.label}`}>
        <Stepper steps={STEPS} current={4} onStep={(i) => go(i as PaState['step'])} />
        <ResultsHeader
          toolId="purchase-analysis"
          scenarioTitle={`Purchase Analysis · ${usd(s.property.price)} · ${loc.label}`}
          clientId={s.clientId}
          autoSaved
          onBack={() => go(3)}
          data={s}
          csv={() => comparisonCsv(s.property, s.options, s.holdingYears)}
          emailBody={`Hi ${client?.name ?? 'there'},\n\nHere is your purchase analysis for a ${usd(s.property.price)} home in ${loc.label}:\n${c.options.map((o) => `• ${o.label}: ${pct(o.ratePct, 3)} — ${usd(o.totalMonthly)}/mo, ${usd(o.cashToClose)} to close`).join('\n')}`}
          chips={[
            { label: 'Client', value: client?.name ?? 'Client name is required', onEdit: () => setClientOpen(true) },
            { label: 'Property', value: `${usd(s.property.price)} · ${loc.label}`, onEdit: () => go(0) },
            { label: 'Loans', value: `${s.options.length} option${s.options.length === 1 ? '' : 's'} · ${s.options.map((o) => pct(o.ratePct, 3)).join(' vs ')}`, onEdit: () => go(1) },
            { label: 'Cost of waiting', value: cowLoan ? optionLabel(cowLoan, cowIdx) : '—', onEdit: () => go(2) },
          ]}
        />
        <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
              <Hourglass className="h-5 w-5" />
            </span>
            <div>
              <div className="font-semibold text-slate-900">Cost of Waiting with {cowLoan ? optionLabel(cowLoan, cowIdx) : 'your loan'}</div>
              <div className="text-sm text-slate-500">
                Run the standalone Cost of Waiting pre-filled with this property and {cowLoan ? `${pct(cowLoan.ratePct, 3)} on ${usd(loanAmountOf(s.property.price, cowLoan))}` : 'the selected loan'}.
              </div>
            </div>
          </div>
          <Link href={cowHref} className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
            Run Cost of Waiting <ArrowRight className="h-4 w-4" />
          </Link>
        </Card>
        <ComparisonResults property={s.property} locationLabel={loc.label} options={s.options} holdingYears={s.holdingYears} onHoldingChange={(holdingYears) => set({ holdingYears })} clientName={client?.name} onEditOption={() => go(1)} />
        <PartnerBlock partnerIdx={s.partnerIdx} />
        <ReportFooter />
        <ClientEditModal open={clientOpen} onClose={() => setClientOpen(false)} value={s.clientId} onChange={(clientId) => set({ clientId })} />
      </CalculatorShell>
    );
  }

  /* ------------------------------------------------------------ wizard */
  const back = s.step > 0 && (
    <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => go((s.step - 1) as PaState['step'])}>
      Back
    </Button>
  );

  return (
    <CalculatorShell toolId="purchase-analysis" subtitle="A guided purchase conversation: property, loan options, cost of waiting and your co-branded report.">
      <Stepper steps={STEPS} current={s.step} onStep={(i) => go(i as PaState['step'])} />

      {s.step === 0 && (
        <StepCard
          title="Property info"
          subtitle="Taxes and insurance fill in from the county average — override them if you know the actual numbers."
          footer={
            <>
              <span className="text-xs text-slate-500">Step 1 of 4</span>
              <Button
                icon={<ArrowRight className="h-4 w-4" />}
                className="flex-row-reverse"
                onClick={() => {
                  const err = requireClient(s.clientId);
                  setClientError(err);
                  if (!err) go(1);
                }}
              >
                Next
              </Button>
            </>
          }
        >
          <div className="space-y-6">
            <div className="max-w-md">
              <ClientPicker
                value={s.clientId}
                error={clientError}
                onChange={(clientId) => {
                  set({ clientId });
                  if (clientId) setClientError(null);
                }}
              />
            </div>
            <PropertyEditor value={s.property} onChange={(property) => set({ property })} showAlternates={false} />
          </div>
        </StepCard>
      )}

      {s.step === 1 && (
        <StepCard
          title="Loan options"
          subtitle={`Manual entry · ${usd(s.property.price)} in ${loc.label}`}
          footer={
            <>
              {back}
              <Button icon={<ArrowRight className="h-4 w-4" />} className="flex-row-reverse" disabled={!s.options.length} onClick={() => go(2)}>
                Next
              </Button>
            </>
          }
        >
          <LoanOptionsList
            options={s.options}
            price={s.property.price}
            onChange={(options) => set({ options, cowLoanId: options.some((o) => o.id === s.cowLoanId) ? s.cowLoanId : options[0]?.id ?? '' })}
          />
        </StepCard>
      )}

      {s.step === 2 && (
        <StepCard
          title="Cost of waiting"
          subtitle="Select loan to compare"
          footer={
            <>
              {back}
              <Button icon={<ArrowRight className="h-4 w-4" />} className="flex-row-reverse" onClick={() => go(3)}>
                Next
              </Button>
            </>
          }
        >
          <RadioGroup
            className="flex-col"
            value={cowLoan?.id ?? ''}
            onChange={(cowLoanId) => set({ cowLoanId })}
            options={s.options.map((o, i) => ({ value: o.id, label: <span className="font-semibold uppercase tracking-wide">{`Option${i + 1}`}</span>, hint: o.label ? `${o.label} · ${loanSummary(o, s.property.price)}` : loanSummary(o, s.property.price) }))}
          />
          <p className="mt-4 text-xs text-slate-500">The selected loan is carried into the standalone Cost of Waiting from your saved report.</p>
        </StepCard>
      )}

      {s.step === 3 && (
        <StepCard
          title="Co-brand"
          subtitle="Your details appear on the client’s report. Add a partner agent if you’re co-marketing."
          footer={
            <>
              {back}
              <Button icon={<Save className="h-4 w-4" />} onClick={save}>
                Save
              </Button>
            </>
          }
        >
          <CoBrandingSection partnerIdx={s.partnerIdx} onPartnerChange={(partnerIdx) => set({ partnerIdx })} />
          <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-slate-500">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Save stores the scenario under {client?.name ?? 'the client'} and opens the report.
          </p>
        </StepCard>
      )}
    </CalculatorShell>
  );
}
