'use client';

import { Palette, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalculatorShell } from '@/components/calc/CalculatorShell';
import { ChartCard, ChartTooltip } from '@/components/calc/ChartCard';
import { LocationPicker } from '@/components/calc/LocationPicker';
import { CoBrandingEditor, ReportFooter } from '@/components/calc/ReportFooter';
import { ResultsHeader } from '@/components/calc/ResultsHeader';
import { TalkTrack } from '@/components/calc/TalkTrack';
import { Accordion, Badge, Button, Card, CardHeader, Callout, Field, NumberInput, Segmented, Select, cx } from '@/components/ui';
import { FICO_BANDS, type FicoBand } from '@/data/mock/clients';
import { getLocation } from '@/data/mock/locations';
import { conventionalMiRatePct } from '@/data/mock/mi';
import {
  AFFORDABILITY_DEFAULTS,
  calcAffordability,
  MIN_DOWN_PCT,
  priceByDti,
  zoneScenarios,
  type AffordabilityInput,
  type AffordProgram,
  type CostUnit,
  type TaxInsMode,
} from '@/lib/calculations/affordability';
import { SERIES, axisProps, axisUsd, gridProps } from '@/lib/chartTheme';
import { pct, usd } from '@/lib/format';
import { useUrlState } from '@/lib/useUrlState';
import { DtiGauge, ZONE_COLORS } from './DtiGauge';
import { focusField, HeroCard, Row, ShareBar, Toggle } from './kit';

const TERMS = [30, 25, 20, 15, 10].map((y) => ({ value: String(y), label: `${y} years` }));
const PROGRAMS: { value: AffordProgram; label: string }[] = [
  { value: 'Conventional', label: 'Conventional' },
  { value: 'FHA', label: 'FHA' },
  { value: 'VA', label: 'VA' },
];

function CostField({ label, unit, value, price, onChange }: { label: string; unit: CostUnit; value: number; price: number; onChange: (unit: CostUnit, value: number) => void }) {
  const dollars = unit === 'pct' ? (price * value) / 100 : value;
  return (
    <Field
      label={label}
      right={
        <Segmented
          size="sm"
          ariaLabel={`${label} unit`}
          value={unit}
          onChange={(u) => onChange(u, u === unit ? value : u === 'pct' ? (price > 0 ? Math.round((value / price) * 100000) / 1000 : 0) : Math.round(dollars))}
          options={[
            { value: 'fee', label: '$' },
            { value: 'pct', label: '%' },
          ]}
        />
      }
      hint={unit === 'pct' ? `${usd(dollars)} at this price` : price > 0 ? `${pct((value / price) * 100, 2)} of price` : undefined}
    >
      <NumberInput ariaLabel={label} prefix={unit === 'fee' ? '$' : undefined} suffix={unit === 'pct' ? '%' : undefined} decimals={unit === 'pct' ? 3 : 0} min={0} value={value} onChange={(v) => onChange(unit, v)} />
    </Field>
  );
}

export function AffordabilityTool() {
  const [s, setS] = useUrlState<AffordabilityInput>(AFFORDABILITY_DEFAULTS);
  const set = (patch: Partial<AffordabilityInput>) => setS((p) => ({ ...p, ...patch }));
  const [cobrandOpen, setCobrandOpen] = useState(false);

  const r = useMemo(() => calcAffordability(s), [s]);
  const curve = useMemo(() => (s.annualIncome > 0 ? priceByDti(s, 25, 50, 0.5) : []), [s]);
  const zones = useMemo(() => (s.annualIncome > 0 ? zoneScenarios(s) : []), [s]);
  const loc = getLocation(s.locationId);
  const incomeMode = s.mode === 'income';
  const zc = ZONE_COLORS[r.zone];
  const autoMiRate = s.program === 'Conventional' ? conventionalMiRatePct(r.ltvPct, s.fico) : r.miRatePct;

  const taxInsHint =
    s.taxInsMode === 'estimate'
      ? `${pct(s.taxInsRatePct, 3)}/yr of price, rounded monthly (live-tool default)`
      : s.taxInsMode === 'location'
        ? `${loc.county} avg tax ${pct(loc.taxRatePct, 2)} + ${usd(loc.insuranceMonthly)}/mo insurance`
        : 'Fixed monthly amount';

  const inputs = (
    <>
      <Segmented
        className="w-full [&>button]:flex-1"
        ariaLabel="Mode"
        value={s.mode}
        onChange={(mode) => set({ mode })}
        options={[
          { value: 'income', label: 'Income' },
          { value: 'payment', label: 'Payment' },
        ]}
      />
      <LocationPicker value={s.locationId} onChange={(locationId) => set({ locationId })} />
      {incomeMode ? (
        <Field label="Annual Income" hint={`${usd(s.annualIncome / 12)}/mo gross`}>
          <NumberInput ariaLabel="Annual Income" prefix="$" decimals={0} min={0} max={100_000_000} value={s.annualIncome} onChange={(annualIncome) => set({ annualIncome })} />
        </Field>
      ) : (
        <>
          <Field label="Desired Monthly Payment" hint="Total: P&I + MI + taxes & insurance + HOA">
            <NumberInput ariaLabel="Desired Monthly Payment" prefix="$" suffix="/mo" decimals={0} min={0} max={1_000_000} value={s.targetPayment} onChange={(targetPayment) => set({ targetPayment })} />
          </Field>
          <Field label="Annual Income (optional)" hint="Used only to show DTI">
            <NumberInput ariaLabel="Annual Income" prefix="$" decimals={0} min={0} max={100_000_000} value={s.annualIncome} onChange={(annualIncome) => set({ annualIncome })} />
          </Field>
        </>
      )}
      <Field label="Down Payment" hint={r.price > 0 ? `${pct(r.downPct, 2)} of the max price` : undefined}>
        <NumberInput ariaLabel="Down Payment" prefix="$" decimals={0} min={0} max={100_000_000} value={s.downPayment} onChange={(downPayment) => set({ downPayment })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Term">
          <Select ariaLabel="Term" value={String(s.termYears)} onChange={(v) => set({ termYears: Number(v) })} options={TERMS} />
        </Field>
        <Field label="Program">
          <Select ariaLabel="Program" value={s.program} onChange={(program) => set({ program })} options={PROGRAMS} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Rate">
          <NumberInput ariaLabel="Rate" suffix="%" decimals={3} min={0} max={30} value={s.ratePct} onChange={(ratePct) => set({ ratePct })} />
        </Field>
        <Field label="APR" hint="Disclosure only">
          <NumberInput ariaLabel="APR" suffix="%" decimals={3} min={0} max={30} value={s.aprPct} onChange={(aprPct) => set({ aprPct })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <CostField label="Closing" unit={s.closingUnit} value={s.closingValue} price={r.price} onChange={(closingUnit, closingValue) => set({ closingUnit, closingValue })} />
        <CostField label="Prepaid" unit={s.prepaidUnit} value={s.prepaidValue} price={r.price} onChange={(prepaidUnit, prepaidValue) => set({ prepaidUnit, prepaidValue })} />
      </div>
      <Field
        label={s.program === 'FHA' ? 'MIP (monthly)' : 'MI (monthly)'}
        right={<Toggle checked={s.miMode === 'manual'} onChange={(m) => set({ miMode: m ? 'manual' : 'auto', miMonthlyManual: m ? Math.round(r.mi) : s.miMonthlyManual })} label={<span className="text-xs">Manual</span>} />}
        hint={
          s.miMode === 'manual'
            ? 'Fixed monthly MI'
            : s.program === 'VA'
              ? 'VA loans have no monthly MI (funding fee financed)'
              : `${usd(r.mi)}/mo · ${pct(autoMiRate, 2)}/yr at ${pct(r.ltvPct, 1)} LTV${s.program === 'Conventional' ? ` · FICO ${s.fico}` : ' · FHA annual MIP'}`
        }
      >
        {s.miMode === 'manual' ? (
          <NumberInput ariaLabel="MI" prefix="$" suffix="/mo" decimals={0} min={0} value={s.miMonthlyManual} onChange={(miMonthlyManual) => set({ miMonthlyManual })} />
        ) : s.program === 'Conventional' ? (
          <Select ariaLabel="FICO" value={s.fico} onChange={(fico) => set({ fico: fico as FicoBand })} options={FICO_BANDS.map((f) => ({ value: f, label: `FICO ${f}` }))} />
        ) : (
          <div className="flex h-10 items-center rounded-lg border border-dashed border-slate-300 px-3 text-sm text-slate-600">{usd(r.mi)}/mo</div>
        )}
      </Field>

      <div className="rounded-lg border border-slate-200 px-3">
        <Accordion title={<span className="inline-flex items-center gap-1.5"><SlidersHorizontal className="h-3.5 w-3.5" />Advanced (optional)</span>}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Monthly debts" hint="Car, cards, loans">
                <NumberInput ariaLabel="Monthly debts" prefix="$" decimals={0} min={0} value={s.monthlyDebts} onChange={(monthlyDebts) => set({ monthlyDebts })} />
              </Field>
              <Field label="Max DTI" hint={incomeMode ? 'Back-end target' : 'Income mode only'}>
                <NumberInput ariaLabel="Max DTI" suffix="%" decimals={2} min={0} max={80} disabled={!incomeMode} value={s.maxDtiPct} onChange={(maxDtiPct) => set({ maxDtiPct })} />
              </Field>
            </div>
            <Field label="Taxes & insurance" hint={taxInsHint}>
              <Select<TaxInsMode>
                ariaLabel="Taxes and insurance source"
                value={s.taxInsMode}
                onChange={(taxInsMode) => set({ taxInsMode })}
                options={[
                  { value: 'estimate', label: 'Estimate (% of price)' },
                  { value: 'location', label: `Location average (${loc.city})` },
                  { value: 'custom', label: 'Custom $ / month' },
                ]}
              />
            </Field>
            {s.taxInsMode === 'estimate' && (
              <Field label="Taxes & insurance rate">
                <NumberInput ariaLabel="Taxes and insurance rate" suffix="%/yr" decimals={3} min={0} max={10} value={s.taxInsRatePct} onChange={(taxInsRatePct) => set({ taxInsRatePct })} />
              </Field>
            )}
            {s.taxInsMode === 'custom' && (
              <Field label="Taxes & insurance">
                <NumberInput ariaLabel="Taxes and insurance monthly" prefix="$" suffix="/mo" decimals={0} min={0} value={s.taxInsMonthly} onChange={(taxInsMonthly) => set({ taxInsMonthly })} />
              </Field>
            )}
            <Field label="HOA">
              <NumberInput ariaLabel="HOA" prefix="$" suffix="/mo" decimals={0} min={0} value={s.hoaMonthly} onChange={(hoaMonthly) => set({ hoaMonthly })} />
            </Field>
          </div>
        </Accordion>
      </div>
      <Button variant="secondary" className="w-full" icon={<Palette className="h-4 w-4" />} onClick={() => setCobrandOpen(true)}>
        Co-branding
      </Button>
      <Button variant="ghost" size="sm" className="w-full" onClick={() => setS(AFFORDABILITY_DEFAULTS)}>
        Reset to example
      </Button>
      <CoBrandingEditor open={cobrandOpen} onClose={() => setCobrandOpen(false)} />
    </>
  );

  const csv = () => [
    ['Item', 'Value'],
    ['Mode', incomeMode ? 'Income' : 'Payment'],
    ['Location', loc.label],
    ['Annual income', s.annualIncome],
    ['Down payment', s.downPayment],
    ['Program', s.program],
    ['Term (yrs)', s.termYears],
    ['Rate %', s.ratePct],
    ['APR %', s.aprPct],
    ['Max price', r.price],
    ['Loan amount', r.loanAmount],
    ['P&I', r.pi],
    ['MI', r.mi],
    ['Taxes & insurance', r.taxIns],
    ['HOA', r.hoa],
    ['Total monthly', r.total],
    ['DTI %', r.dtiPct],
    ['Zone', r.zone],
    ['Closing', r.closing],
    ['Prepaid', r.prepaid],
    ['Cash to close', r.cashToClose],
    [],
    ['DTI %', 'Max price'],
    ...curve.filter((c) => Number.isInteger(c.dti)).map((c) => [c.dti, c.price]),
  ];

  const talk = incomeMode
    ? `On ${usd(s.annualIncome)} a year with ${usd(s.downPayment)} down, you can comfortably afford about ${usd(r.price)} at ${pct(s.ratePct, 3)} — a total payment of ${usd(r.total)}/mo (P&I ${usd(r.pi)} + taxes, insurance & MI ${usd(r.taxInsMi)}), which keeps your debt-to-income at ${pct(r.dtiPct, 1)}, the ${r.zone.toLowerCase()} zone. You’d need about ${usd(r.cashToClose)} to close.${zones[1] ? ` If you’re willing to stretch to 43% DTI, that goes to ${usd(zones[1].price)} — but I’d rather you stay comfortable.` : ''}`
    : `To keep your total payment at ${usd(s.targetPayment)}/mo with ${usd(s.downPayment)} down, you’re shopping up to about ${usd(r.price)} at ${pct(s.ratePct, 3)}.${r.hasIncome ? ` That puts your debt-to-income at ${pct(r.dtiPct, 1)} — ${r.zone.toLowerCase()}.` : ''} Cash to close is about ${usd(r.cashToClose)}.`;

  return (
    <CalculatorShell toolId="affordability" subtitle="How much home an income (or a monthly payment) buys — updates live as you type." inputs={inputs}>
      <ResultsHeader
        toolId="affordability"
        scenarioTitle={`${incomeMode ? `${usd(s.annualIncome)} income` : `${usd(s.targetPayment)}/mo`} · ${usd(s.downPayment)} down · ${pct(s.ratePct, 3)}`}
        chips={[
          incomeMode
            ? { label: 'Income', value: `${usd(s.annualIncome)}/yr`, onEdit: () => focusField('[aria-label="Annual Income"]') }
            : { label: 'Target payment', value: `${usd(s.targetPayment)}/mo`, onEdit: () => focusField('[aria-label="Desired Monthly Payment"]') },
          { label: 'Property', value: loc.label, onEdit: () => focusField('[aria-label="Location"]') },
          { label: 'Loan', value: `${s.program} ${s.termYears}yr · ${pct(s.ratePct, 3)}`, onEdit: () => focusField('[aria-label="Rate"]') },
          { label: 'Down', value: usd(s.downPayment), onEdit: () => focusField('[aria-label="Down Payment"]') },
        ]}
        csv={csv}
        data={s}
        emailBody={talk}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <HeroCard
          eyebrow={incomeMode ? 'You can afford' : 'Your payment buys'}
          badge={r.hasIncome ? <Badge tone={zc.tone}>{r.zone}</Badge> : undefined}
          value={usd(r.price)}
          sub={
            <>
              {usd(r.loanAmount)} {s.program} loan · {pct(r.downPct, 2)} down · {s.termYears}-yr at {pct(s.ratePct, 3)} (APR {pct(s.aprPct, 3)})
            </>
          }
        >
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-sm font-medium text-slate-600">Total monthly payment</span>
            <span className="text-2xl font-bold tabular-nums text-slate-900">{usd(r.total)}</span>
          </div>
          <ShareBar
            format={(v) => usd(v)}
            parts={[
              { label: 'Principal & interest', value: r.pi, color: SERIES[0] },
              { label: s.program === 'FHA' ? 'MIP' : 'Mortgage insurance', value: r.mi, color: SERIES[1] },
              { label: 'Taxes & insurance', value: r.taxIns, color: SERIES[2] },
              { label: 'HOA', value: r.hoa, color: SERIES[3] },
            ]}
          />
        </HeroCard>
        <Card className="flex flex-col items-center justify-center">
          <DtiGauge dti={r.dtiPct} zone={r.zone} empty={!r.hasIncome} />
          <div className="mt-4 grid w-full grid-cols-3 gap-1 text-center text-[11px]">
            {(['Comfortable', 'Stretch', 'Aggressive'] as const).map((z, k) => (
              <div key={z} className={cx('rounded-md px-1 py-1.5', r.hasIncome && r.zone === z ? 'font-semibold text-slate-900' : 'text-slate-500')} style={{ background: r.hasIncome && r.zone === z ? ZONE_COLORS[z].tint : undefined }}>
                <div>{z}</div>
                <div className="tabular-nums">{['≤ 36%', '36–43%', '> 43%'][k]}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {r.limitedByDown && (
        <Callout tone="warning" title="Limited by down payment">
          {s.program} requires at least {MIN_DOWN_PCT[s.program]}% down, so {usd(s.downPayment)} caps the price at {usd(r.price)} even though income would support more.
        </Callout>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Monthly payment" subtitle={`At ${usd(r.price)}`} />
          <Row label="Principal & interest" value={usd(r.pi)} />
          <Row label="Taxes, insurance & MI" sub="as shown on the live tool" value={usd(r.taxInsMi)} />
          <div className="ml-4 border-l border-slate-200 pl-3">
            <Row label={s.program === 'FHA' ? 'MIP' : 'Mortgage insurance'} sub={r.miRatePct ? `${pct(r.miRatePct, 2)}/yr` : s.miMode === 'manual' ? 'manual' : 'none'} value={usd(r.mi)} />
            <Row label="Taxes & insurance" value={usd(r.taxIns)} />
          </div>
          {r.hoa > 0 && <Row label="HOA" value={usd(r.hoa)} />}
          <Row strong label="Total monthly" value={usd(r.total)} />
          {r.hasIncome && (
            <p className="mt-2 text-xs text-slate-500">
              DTI = ({usd(r.total)} housing + {usd(s.monthlyDebts)} debts) ÷ {usd(r.monthlyIncome)} income = {pct(r.dtiPct, 1)}
            </p>
          )}
        </Card>
        <Card>
          <CardHeader title="Cash to close" subtitle="Down payment + closing costs + prepaids" />
          <Row label="Down payment" sub={pct(r.downPct, 2)} value={usd(Math.min(s.downPayment, r.price))} />
          <Row label="Closing costs" sub={s.closingUnit === 'pct' ? pct(s.closingValue, 3) : undefined} value={usd(r.closing)} />
          <Row label="Prepaids" sub={s.prepaidUnit === 'pct' ? pct(s.prepaidValue, 3) : undefined} value={usd(r.prepaid)} />
          {r.upfrontFee > 0 && <Row label={s.program === 'FHA' ? 'Upfront MIP (financed)' : 'VA funding fee (financed)'} sub={pct(r.upfrontFeePct, 2)} value={usd(r.upfrontFee)} />}
          <Row strong label="Cash to close" value={usd(r.cashToClose)} />
        </Card>
      </div>

      {curve.length > 0 ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {zones.map((z) => {
              const active = incomeMode && Math.abs(s.maxDtiPct - z.dti) < 0.01;
              return (
                <button
                  key={z.zone}
                  type="button"
                  onClick={() => set({ mode: 'income', maxDtiPct: z.dti })}
                  className={cx('rounded-xl border bg-white p-4 text-left shadow-card transition-colors hover:border-brand-300', active ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-slate-200')}
                >
                  <div className="flex items-center justify-between">
                    <Badge tone={ZONE_COLORS[z.zone].tone}>{z.zone}</Badge>
                    <span className="text-xs text-slate-500">{z.dti}% DTI</span>
                  </div>
                  <div className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{usd(z.price)}</div>
                  <div className="text-xs text-slate-500">
                    {usd(z.total)}/mo · {usd(z.cashToClose)} to close
                  </div>
                </button>
              );
            })}
          </div>
          <ChartCard
            title="Price vs. DTI"
            subtitle={`Max price at each back-end DTI on ${usd(s.annualIncome)} income — shaded by zone`}
            height={300}
            table={{ head: ['DTI', 'Max price', 'Zone'], rows: curve.filter((c) => Number.isInteger(c.dti)).map((c) => [pct(c.dti, 0), usd(c.price), c.zone]) }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curve} margin={{ top: 16, right: 16, bottom: 4, left: 4 }}>
                <CartesianGrid {...gridProps} />
                <ReferenceArea x1={25} x2={36} fill={ZONE_COLORS.Comfortable.fill} fillOpacity={0.07} label={{ value: 'Comfortable', position: 'insideTop', fill: '#475569', fontSize: 11 }} />
                <ReferenceArea x1={36} x2={43} fill={ZONE_COLORS.Stretch.fill} fillOpacity={0.09} label={{ value: 'Stretch', position: 'insideTop', fill: '#475569', fontSize: 11 }} />
                <ReferenceArea x1={43} x2={50} fill={ZONE_COLORS.Aggressive.fill} fillOpacity={0.07} label={{ value: 'Aggressive', position: 'insideTop', fill: '#475569', fontSize: 11 }} />
                <XAxis dataKey="dti" type="number" domain={[25, 50]} ticks={[25, 30, 36, 43, 50]} tickFormatter={(v) => `${v}%`} {...axisProps} />
                <YAxis tickFormatter={axisUsd} width={56} {...axisProps} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTooltip format={(v) => usd(v)} labelFormat={(l) => `${l}% DTI`} />} />
                <Line type="monotone" dataKey="price" name="Max price" stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                {r.hasIncome && r.dtiPct >= 25 && r.dtiPct <= 50 && <ReferenceDot x={Math.round(r.dtiPct * 2) / 2} y={r.price} r={5} fill={SERIES[0]} stroke="#fff" strokeWidth={2} />}
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </>
      ) : (
        <Callout tone="info" title="Price vs. DTI">
          Add an annual income to compare Comfortable, Stretch and Aggressive price points.
        </Callout>
      )}

      <TalkTrack>{talk}</TalkTrack>
      <ReportFooter note="MI rates are demo rate-card values (FICO × LTV). Taxes & insurance default to the live tool’s estimate; switch to the location average under Advanced." />
    </CalculatorShell>
  );
}
