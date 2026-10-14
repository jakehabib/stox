'use client';

import { ArrowLeft, ArrowRight, Calculator, CheckCircle2, XCircle } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalculatorShell } from '@/components/calc/CalculatorShell';
import { ChartCard, ChartTooltip } from '@/components/calc/ChartCard';
import { ClientPicker } from '@/components/calc/ClientPicker';
import { LocationPicker } from '@/components/calc/LocationPicker';
import { ReportFooter } from '@/components/calc/ReportFooter';
import { ResultsHeader } from '@/components/calc/ResultsHeader';
import { Stepper } from '@/components/calc/Stepper';
import { TalkTrack } from '@/components/calc/TalkTrack';
import { Button, Card, CardHeader, DataTable, Field, NumberInput, RadioGroup, Segmented, Select, StatTile, cx } from '@/components/ui';
import { getLocation } from '@/data/mock/locations';
import { displayedRate, type AppreciationMode } from '@/lib/calculations/appreciation';
import { calcInvestment, INVESTMENT_DEFAULTS, type InvestmentInput } from '@/lib/calculations/investmentProperty';
import { countyTaxAnnual } from '@/lib/calculations/property';
import { SERIES, axisProps, axisUsd, gridProps } from '@/lib/chartTheme';
import { num, pct, usd } from '@/lib/format';
import { useStore } from '@/lib/store';
import { useUrlState } from '@/lib/useUrlState';
import { HeroCard, InferredBadge, Row } from '../affordability/kit';

type IpState = InvestmentInput & { step: number };
const DEFAULTS: IpState = { ...INVESTMENT_DEFAULTS, step: 0 };
const STEPS = ['Property', 'Financing', 'Income & Expenses', 'Results'];
const TERMS = [30, 25, 20, 15].map((y) => ({ value: String(y), label: `${y} years` }));

function Money({ label, value, onChange, suffix, hint }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; hint?: ReactNode }) {
  return (
    <Field label={label} hint={hint}>
      <NumberInput ariaLabel={label} prefix="$" suffix={suffix} decimals={0} min={0} max={100_000_000} value={value} onChange={onChange} />
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

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5">
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-gain" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-loss" />}
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-900">
          {label} <span className={cx('text-xs font-semibold', ok ? 'text-gain' : 'text-loss')}>{ok ? 'Pass' : 'Fail'}</span>
        </div>
        <div className="text-xs text-slate-500">{detail}</div>
      </div>
    </div>
  );
}

export function InvestmentPropertyTool() {
  const [s, setS] = useUrlState<IpState>(DEFAULTS);
  const set = (patch: Partial<IpState>) => setS((p) => ({ ...p, ...patch }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [horizon, setHorizon] = useState<'5' | '10'>('10');
  const { getClient } = useStore();
  const r = useMemo(() => calcInvestment(s), [s]);
  const loc = getLocation(s.locationId);
  const countyTax = countyTaxAnnual(s.locationId, s.price);
  const taxIsCounty = Math.abs(s.taxAnnual - countyTax) < 1;
  const client = getClient(s.clientId);

  const validate = (step: number) => {
    const e: Record<string, string> = {};
    if (step === 0) {
      if (!s.locationId) e.location = 'Location is required';
      if (!(s.price > 0)) e.price = 'Price is required';
    }
    if (step === 2 && !(s.monthlyRent > 0)) e.rent = 'Monthly rent is required';
    return e;
  };
  const goTo = (target: number) => {
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

  const shownProjection = r.projection.slice(0, horizon === '5' ? 5 : 10);
  const lastShown = shownProjection[shownProjection.length - 1];
  const cfTone = r.cashFlowMonthly >= 0 ? 'text-gain' : 'text-loss';

  if (s.step >= 3) {
    const talk = `At ${usd(s.price)} with ${pct(s.downPct, 2)} down at ${pct(s.ratePct, 3)}, ${usd(s.monthlyRent)}/mo rent gives a ${pct(r.capRatePct, 2)} cap rate and ${r.cashFlowMonthly >= 0 ? `${usd(r.cashFlowMonthly)}/mo of positive cash flow` : `${usd(-r.cashFlowMonthly)}/mo of negative cash flow in year one`} (cash-on-cash ${pct(r.cashOnCashPct, 2)}, DSCR ${num(r.dscr, 2)}). ${r.cashFlowMonthly < 0 ? `It breaks even at about ${usd(r.breakEvenRent)}/mo rent. ` : ''}The real return is the long game: over ${lastShown.year} years, appreciation, principal paydown and rent growth add up to ${usd(lastShown.totalReturn)} of total return on your ${usd(r.cashInvested)}${r.irrPct !== null && horizon === '10' && r.projection.length >= 10 ? ` — about a ${pct(r.irrPct, 1)} IRR` : ''}.`;
    const csv = () => [
      ['Year', 'Value', 'Rent/mo', 'NOI', 'Debt service', 'Cash flow', 'Cumulative cash flow', 'Loan balance', 'Equity', 'Net if sold', 'Total return'],
      ...r.projection.map((p) => [p.year, p.value, p.rentMonthly, p.noi, p.debtService, p.cashFlow, p.cumulativeCashFlow, p.loanBalance, p.equity, p.saleNet, p.totalReturn]),
      [],
      ['Metric', 'Value'],
      ['NOI', r.noi],
      ['Cap rate %', r.capRatePct],
      ['Cash flow / yr', r.cashFlowAnnual],
      ['Cash-on-cash %', r.cashOnCashPct],
      ['DSCR', r.dscr],
      ['GRM', r.grm],
      ['1% rule', r.onePercent ? 'Pass' : 'Fail'],
      ['Break-even rent', r.breakEvenRent],
      ['IRR %', r.irrPct ?? ''],
    ];
    const chartData = [{ year: 0, value: s.price, loanBalance: r.loanAmount }, ...r.projection.map((p) => ({ year: p.year, value: Math.round(p.value), loanBalance: Math.round(p.loanBalance) }))];
    const y1 = r.year1;
    return (
      <CalculatorShell toolId="investment-property-analyzer" demo title={<>Investment Property Analyzer <InferredBadge /></>} subtitle="Cap rate, cash flow and cash-on-cash return for a rental.">
        <ResultsHeader
          toolId="investment-property-analyzer"
          scenarioTitle={`${usd(s.price)} rental · ${loc.city}`}
          clientId={s.clientId}
          onBack={() => set({ step: 2 })}
          chips={[
            { label: 'Client', value: client?.name ?? 'None (optional)', onEdit: () => set({ step: 0 }) },
            { label: 'Property', value: `${usd(s.price)} · ${loc.label}`, onEdit: () => set({ step: 0 }) },
            { label: 'Loan', value: `${usd(r.loanAmount)} · ${pct(s.ratePct, 3)} ${s.termYears}yr`, onEdit: () => set({ step: 1 }) },
            { label: 'Rent', value: `${usd(s.monthlyRent)}/mo`, onEdit: () => set({ step: 2 }) },
          ]}
          csv={csv}
          data={s}
          emailBody={talk}
        />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <HeroCard eyebrow="Monthly cash flow · year 1" value={<span className={cfTone}>{`${r.cashFlowMonthly < 0 ? '−' : '+'}${usd(Math.abs(r.cashFlowMonthly))}/mo`}</span>} sub={`${usd(r.noi)} NOI − ${usd(r.annualDebtService)} debt service = ${usd(r.cashFlowAnnual)} a year`}>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <div className="text-xs text-slate-500">Cap rate</div>
                <div className="text-lg font-semibold tabular-nums text-slate-900">{pct(r.capRatePct, 2)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Cash-on-cash</div>
                <div className={cx('text-lg font-semibold tabular-nums', r.cashOnCashPct >= 0 ? 'text-slate-900' : 'text-loss')}>{pct(r.cashOnCashPct, 2)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">DSCR</div>
                <div className="text-lg font-semibold tabular-nums text-slate-900">{num(r.dscr, 2)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">{r.projection.length}-yr IRR</div>
                <div className="text-lg font-semibold tabular-nums text-slate-900">{r.irrPct === null ? 'n/a' : pct(r.irrPct, 2)}</div>
              </div>
            </div>
          </HeroCard>
          <div className="grid grid-cols-1 gap-2.5">
            <Check ok={r.onePercent} label="1% rule" detail={`Rent is ${pct(r.rentToPricePct, 2)} of price (target ≥ 1% → ${usd(s.price * 0.01)}/mo)`} />
            <Check ok={r.dscr >= 1.25} label="DSCR ≥ 1.25" detail={`NOI covers debt service ${num(r.dscr, 2)}× — typical DSCR-loan minimum is 1.0–1.25`} />
            <Check ok={r.cashFlowAnnual >= 0} label="Positive cash flow" detail={r.cashFlowAnnual >= 0 ? `${usd(r.cashFlowMonthly)}/mo after debt service` : `Breaks even at ${usd(r.breakEvenRent)}/mo rent (+${usd(r.breakEvenRent - s.monthlyRent)})`} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile size="sm" label="NOI" value={usd(r.noi)} sub="per year" />
          <StatTile size="sm" label="GRM" value={num(r.grm, 2)} sub="price ÷ annual rent" />
          <StatTile size="sm" label="Break-even rent" value={`${usd(r.breakEvenRent)}/mo`} sub="year-1 cash flow = $0" />
          <StatTile size="sm" label="Equity multiple" value={`${num(r.equityMultiple, 2)}×`} sub={`over ${r.projection.length} yrs`} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Year-1 operating statement" subtitle={`Expense ratio ${pct(r.expenseRatioPct, 1)} of EGI`} />
            <Row label="Gross scheduled rent" value={usd(y1.grossRent)} />
            {y1.grossOther > 0 && <Row label="Other income" value={usd(y1.grossOther)} />}
            <Row label="Vacancy" sub={pct(s.vacancyPct, 2)} value={`−${usd(y1.vacancyLoss)}`} />
            <Row strong label="Effective gross income" value={usd(y1.egi)} />
            <Row label="Property tax" value={`−${usd(y1.tax)}`} />
            <Row label="Insurance" value={`−${usd(y1.insurance)}`} />
            {y1.hoa > 0 && <Row label="HOA" value={`−${usd(y1.hoa)}`} />}
            {y1.utilities > 0 && <Row label="Utilities" value={`−${usd(y1.utilities)}`} />}
            <Row label="Management" sub={`${pct(s.managementPct, 2)} of EGI`} value={`−${usd(y1.management)}`} />
            <Row label="Maintenance" sub={`${pct(s.maintenancePct, 2)} of rent`} value={`−${usd(y1.maintenance)}`} />
            <Row label="CapEx reserve" sub={`${pct(s.capexPct, 2)} of rent`} value={`−${usd(y1.capex)}`} />
            <Row strong label="Net operating income" value={usd(r.noi)} />
            <Row label="Debt service" sub={`${usd(r.monthlyPI)}/mo P&I`} value={`−${usd(r.annualDebtService)}`} />
            <Row strong label="Cash flow" value={usd(r.cashFlowAnnual)} tone={r.cashFlowAnnual >= 0 ? 'gain' : 'loss'} />
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader title="Cash invested" />
              <Row label="Down payment" sub={pct(s.downPct, 2)} value={usd(r.downPayment)} />
              <Row label="Closing costs" sub={pct(s.closingPct, 2)} value={usd(r.closingCosts)} />
              <Row strong label="Total cash invested" value={usd(r.cashInvested)} />
              <Row label="Loan amount" sub={`${pct(s.ratePct, 3)} · ${s.termYears} yrs`} value={usd(r.loanAmount)} />
            </Card>
            <ChartCard
              title="Annual cash flow"
              subtitle={`Rent +${pct(s.rentGrowthPct, 2)}/yr, fixed expenses +${pct(s.expenseGrowthPct, 2)}/yr`}
              height={200}
              table={{ head: ['Year', 'Cash flow'], rows: r.projection.map((p) => [p.year, usd(p.cashFlow)]) }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={r.projection.map((p) => ({ year: p.year, cashFlow: Math.round(p.cashFlow) }))} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="year" tickFormatter={(v) => `Yr ${v}`} {...axisProps} />
                  <YAxis tickFormatter={axisUsd} width={52} {...axisProps} />
                  <ReferenceLine y={0} stroke="#94a3b8" />
                  <Tooltip cursor={{ fill: '#f1f5f9' }} content={<ChartTooltip format={(v) => usd(v)} labelFormat={(l) => `Year ${l}`} />} />
                  <Bar dataKey="cashFlow" name="Cash flow" maxBarSize={40} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {r.projection.map((p) => (
                      <Cell key={p.year} fill={p.cashFlow >= 0 ? SERIES[2] : SERIES[1]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </div>

        <ChartCard
          title="Value, loan balance & equity"
          subtitle={`${loc.label} · ${s.appreciation.mode === 'forecast' ? 'Forecast curve' : s.appreciation.mode === 'historical' ? 'Historical' : 'Custom'} ${pct(displayedRate(loc, s.appreciation), 3)}/yr — equity is the gap`}
          legend={[
            { label: 'Property value', color: SERIES[0] },
            { label: 'Loan balance', color: SERIES[1] },
          ]}
          table={{ head: ['Year', 'Value', 'Loan', 'Equity'], rows: chartData.map((d) => [d.year, usd(d.value), usd(d.loanBalance), usd(d.value - d.loanBalance)]) }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="year" tickFormatter={(v) => `Yr ${v}`} {...axisProps} />
              <YAxis tickFormatter={axisUsd} width={56} domain={[0, 'auto']} {...axisProps} />
              <Tooltip content={<ChartTooltip format={(v) => usd(v)} labelFormat={(l) => `Year ${l}`} />} />
              <Line type="monotone" dataKey="value" name="Property value" stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="loanBalance" name="Loan balance" stroke={SERIES[1]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <Card>
          <CardHeader
            title={`${lastShown.year}-year projection`}
            subtitle={`Sale at year ${lastShown.year} nets ${usd(lastShown.saleNet)} after ${pct(s.sellingCostPct, 2)} selling costs and loan payoff`}
            action={
              r.projection.length >= 10 ? (
                <Segmented
                  size="sm"
                  ariaLabel="Projection horizon"
                  value={horizon}
                  onChange={setHorizon}
                  options={[
                    { value: '5', label: '5 yr' },
                    { value: '10', label: '10 yr' },
                  ]}
                />
              ) : undefined
            }
          />
          <DataTable
            dense
            head={['Year', 'Value', 'Rent/mo', 'NOI', 'Cash flow', 'Loan', 'Equity', 'Total return']}
            rows={shownProjection.map((p) => [p.year, usd(p.value), usd(p.rentMonthly), usd(p.noi), <span key="cf" className={p.cashFlow < 0 ? 'text-loss' : undefined}>{usd(p.cashFlow)}</span>, usd(p.loanBalance), usd(p.equity), <span key="tr" className={p.totalReturn < 0 ? 'text-loss' : 'text-gain'}>{usd(p.totalReturn)}</span>])}
          />
          <p className="mt-3 text-xs text-slate-500">Total return = cumulative cash flow + net sale proceeds − {usd(r.cashInvested)} invested. Ignores taxes and depreciation.</p>
        </Card>

        <TalkTrack>{talk}</TalkTrack>
        <ReportFooter note="Investment Property Analyzer Step 2+ is inferred — the live session only observed Step 1 (Location, Price). Appreciation uses demo forecast data." />
      </CalculatorShell>
    );
  }

  return (
    <CalculatorShell toolId="investment-property-analyzer" demo subtitle="Cap rate, cash flow and cash-on-cash return for a rental.">
      <Stepper steps={STEPS} current={s.step} onStep={(i) => goTo(i)} />
      <Card className="p-5 sm:p-6">
        {s.step > 0 && (
          <div className="mb-4">
            <InferredBadge />
          </div>
        )}

        {s.step === 0 && (
          <div className="space-y-5">
            <div>
              <h3 className="text-[15px] font-semibold text-slate-900">Property</h3>
              <p className="text-sm text-slate-500">Where is the rental and what does it cost?</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <LocationPicker
                value={s.locationId}
                error={errors.location}
                onChange={(locationId) => set({ locationId, taxAnnual: taxIsCounty ? countyTaxAnnual(locationId, s.price) : s.taxAnnual })}
              />
              <Field label="Price" error={errors.price}>
                <NumberInput ariaLabel="Price" prefix="$" decimals={0} min={0} max={100_000_000} invalid={!!errors.price} value={s.price} onChange={(price) => set({ price, taxAnnual: taxIsCounty ? countyTaxAnnual(s.locationId, price) : s.taxAnnual })} />
              </Field>
              <ClientPicker value={s.clientId} onChange={(clientId) => set({ clientId })} required={false} />
            </div>
          </div>
        )}

        {s.step === 1 && (
          <div className="space-y-5">
            <div>
              <h3 className="text-[15px] font-semibold text-slate-900">Financing</h3>
              <p className="text-sm text-slate-500">Investment-property loan on {usd(s.price)}.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Percent label="Down payment" value={s.downPct} onChange={(downPct) => set({ downPct })} hint={`${usd((s.price * s.downPct) / 100)} · investors typically 15–25%`} />
              <Percent label="Rate" value={s.ratePct} onChange={(ratePct) => set({ ratePct })} max={30} hint="Investment rates run above owner-occupied" />
              <Field label="Term">
                <Select ariaLabel="Term" value={String(s.termYears)} onChange={(v) => set({ termYears: Number(v) })} options={TERMS} />
              </Field>
              <Percent label="Closing costs" value={s.closingPct} onChange={(closingPct) => set({ closingPct })} hint={usd((s.price * s.closingPct) / 100)} max={20} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile size="sm" label="Loan amount" value={usd(r.loanAmount)} />
              <StatTile size="sm" label="P&I" value={`${usd(r.monthlyPI)}/mo`} />
              <StatTile size="sm" label="Cash invested" value={usd(r.cashInvested)} />
            </div>
          </div>
        )}

        {s.step === 2 && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-3 text-[15px] font-semibold text-slate-900">Rental income</h3>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Monthly rent" error={errors.rent} hint={s.price > 0 ? `${pct((s.monthlyRent / s.price) * 100, 2)} of price` : undefined}>
                  <NumberInput ariaLabel="Monthly rent" prefix="$" suffix="/mo" decimals={0} min={0} invalid={!!errors.rent} value={s.monthlyRent} onChange={(monthlyRent) => set({ monthlyRent })} />
                </Field>
                <Money label="Other income" suffix="/mo" value={s.otherIncome} onChange={(otherIncome) => set({ otherIncome })} hint="Parking, laundry, storage" />
                <Percent label="Vacancy" value={s.vacancyPct} onChange={(vacancyPct) => set({ vacancyPct })} hint={`≈ ${num((s.vacancyPct / 100) * 52, 1)} weeks a year`} />
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-[15px] font-semibold text-slate-900">Expenses</h3>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Money
                  label="Property tax"
                  suffix="/yr"
                  value={s.taxAnnual}
                  onChange={(taxAnnual) => set({ taxAnnual })}
                  hint={
                    taxIsCounty ? (
                      `County avg ${pct(loc.taxRatePct, 2)}`
                    ) : (
                      <button type="button" className="text-brand-700 hover:underline" onClick={() => set({ taxAnnual: countyTax })}>
                        Reset to county average
                      </button>
                    )
                  }
                />
                <Money label="Insurance" suffix="/mo" value={s.insuranceMonthly} onChange={(insuranceMonthly) => set({ insuranceMonthly })} hint="Landlord policy" />
                <Money label="HOA" suffix="/mo" value={s.hoaMonthly} onChange={(hoaMonthly) => set({ hoaMonthly })} />
                <Money label="Utilities" suffix="/mo" value={s.utilitiesMonthly} onChange={(utilitiesMonthly) => set({ utilitiesMonthly })} hint="Owner-paid" />
                <Percent label="Management" value={s.managementPct} onChange={(managementPct) => set({ managementPct })} hint="% of collected rent" />
                <Percent label="Maintenance" value={s.maintenancePct} onChange={(maintenancePct) => set({ maintenancePct })} hint="% of gross rent" />
                <Percent label="CapEx reserve" value={s.capexPct} onChange={(capexPct) => set({ capexPct })} hint="Roof, HVAC, appliances" />
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-[15px] font-semibold text-slate-900">Projection</h3>
              <div className="space-y-4">
                <Field label="Appreciation">
                  <div className="flex flex-wrap items-center gap-3">
                    <RadioGroup<AppreciationMode>
                      value={s.appreciation.mode}
                      onChange={(mode) => set({ appreciation: { mode, customPct: s.appreciation.customPct ?? 3 } })}
                      options={[
                        { value: 'forecast', label: 'Forecast', hint: pct(loc.forecastDisplayPct, 3) },
                        { value: 'historical', label: 'Historical', hint: pct(loc.historicalPct, 3) },
                        { value: 'custom', label: 'Custom' },
                      ]}
                    />
                    {s.appreciation.mode === 'custom' && (
                      <div className="w-32">
                        <NumberInput ariaLabel="Custom appreciation" suffix="%/yr" decimals={3} min={-20} max={30} value={s.appreciation.customPct ?? 3} onChange={(customPct) => set({ appreciation: { mode: 'custom', customPct } })} />
                      </div>
                    )}
                  </div>
                </Field>
                <div className="grid gap-4 md:grid-cols-4">
                  <Percent label="Rent growth" value={s.rentGrowthPct} onChange={(rentGrowthPct) => set({ rentGrowthPct })} hint="per year" max={30} />
                  <Percent label="Expense growth" value={s.expenseGrowthPct} onChange={(expenseGrowthPct) => set({ expenseGrowthPct })} hint="Tax, insurance, HOA, utilities" max={30} />
                  <Field label="Hold period" hint="Years before sale">
                    <NumberInput ariaLabel="Hold period" suffix="yrs" decimals={0} min={1} max={30} value={s.holdYears} onChange={(holdYears) => set({ holdYears })} />
                  </Field>
                  <Percent label="Selling costs" value={s.sellingCostPct} onChange={(sellingCostPct) => set({ sellingCostPct })} max={20} />
                </div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <StatTile size="sm" label="NOI" value={usd(r.noi)} />
              <StatTile size="sm" label="Cap rate" value={pct(r.capRatePct, 2)} />
              <StatTile size="sm" label="Cash flow" value={`${usd(r.cashFlowMonthly)}/mo`} tone={r.cashFlowMonthly >= 0 ? 'gain' : 'loss'} />
              <StatTile size="sm" label="Cash-on-cash" value={pct(r.cashOnCashPct, 2)} />
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} disabled={s.step === 0} onClick={() => set({ step: Math.max(0, s.step - 1) })}>
            Back
          </Button>
          {Object.keys(errors).length > 0 && <span className="text-sm font-medium text-red-600">{Object.values(errors)[0]}</span>}
          {s.step < 2 ? (
            <Button onClick={() => goTo(s.step + 1)}>
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button icon={<Calculator className="h-4 w-4" />} onClick={() => goTo(3)}>
              Analyze
            </Button>
          )}
        </div>
      </Card>
    </CalculatorShell>
  );
}
