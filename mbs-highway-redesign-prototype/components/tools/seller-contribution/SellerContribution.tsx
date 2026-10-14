'use client';

import clsx from 'clsx';
import { Award, Download, FilePlus, FolderOpen, Palette, PlayCircle, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartCard, ChartTooltip } from '@/components/calc/ChartCard';
import { ClientPicker } from '@/components/calc/ClientPicker';
import { ComparisonTable } from '@/components/calc/ComparisonTable';
import { LocationPicker } from '@/components/calc/LocationPicker';
import { CoBrandingEditor, ReportFooter } from '@/components/calc/ReportFooter';
import { ResultsHeader } from '@/components/calc/ResultsHeader';
import { TalkTrack } from '@/components/calc/TalkTrack';
import { Badge, Button, Callout, Card, EmptyState, Field, Modal, NumberInput, PageHeader, Select } from '@/components/ui';
import { MiWorksheet } from '@/components/tools/open-house-flyers/MiWorksheet';
import { Toolbar, ToolbarButton, ToolbarDivider } from '@/components/tools/open-house-flyers/Toolbar';
import { Toggle, useLocalList } from '@/components/tools/social-studio/shared';
import { getLocation } from '@/data/mock/locations';
import { MI_FICO_BANDS } from '@/lib/calculations/flyer';
import { countyTaxAnnual } from '@/lib/calculations/property';
import {
  ALEX_SELLER_DEFAULTS,
  CONCESSION_USES,
  compareSellerContribution,
  cumulativeOutOfPocket,
  type ConcessionOption,
  type ConcessionUse,
  type SellerContributionInput,
} from '@/lib/calculations/sellerContribution';
import { SERIES, axisProps, axisUsd, gridProps } from '@/lib/chartTheme';
import { downloadCsv } from '@/lib/exportCsv';
import { date, num, pct, usd } from '@/lib/format';
import { useStore } from '@/lib/store';
import { useUrlState } from '@/lib/useUrlState';

interface State extends SellerContributionInput {
  clientId: string | null;
  locationId: string;
}

const DEMO: State = { ...ALEX_SELLER_DEFAULTS, clientId: 'c-alex-rivera', locationId: 'dallas-tx-75201' };
const BLANK: State = { ...ALEX_SELLER_DEFAULTS, clientId: null, locationId: 'dallas-tx-75201', price: 0, concession: 0, closingCosts: 0, taxAnnual: 0, insuranceMonthly: 0 };

interface Saved {
  id: string;
  savedAt: string;
  title: string;
  state: State;
}

const DESCRIPTIONS: Record<ConcessionUse, string> = {
  none: '',
  price: 'Seller lowers the price; your down payment and loan shrink.',
  credit: 'Seller pays your closing costs; less cash needed at closing.',
  permanent: 'Seller buys discount points; lower rate for the life of the loan.',
  temporary: 'Seller funds a 2-1 buydown; rate is 2% lower in year 1, 1% lower in year 2.',
};

export function SellerContribution() {
  const { getClient, toast, saveScenario } = useStore();
  const [s, setS] = useUrlState<State>(DEMO);
  const [modal, setModal] = useState<'mi' | 'load' | 'cobrand' | 'loan' | 'property' | 'client' | null>(null);
  const [saved, setSaved] = useLocalList<Saved>('mbsh-seller-contribution-v1');
  const set = <K extends keyof State>(k: K, v: State[K]) => setS((p) => ({ ...p, [k]: v }));
  const cmp = useMemo(() => compareSellerContribution(s), [s]);
  const client = getClient(s.clientId);
  const loc = getLocation(s.locationId);
  const years = Math.min(30, Math.max(5, Math.round(s.holdingYears) || 5));
  const chartData = useMemo(() => {
    const base = cumulativeOutOfPocket(s, 'none', years);
    const series = CONCESSION_USES.map((u) => cumulativeOutOfPocket(s, u, years));
    return Array.from({ length: years }, (_, y) => {
      const row: Record<string, number> = { year: y + 1 };
      CONCESSION_USES.forEach((u, i) => (row[u] = base[y] - series[i][y]));
      return row;
    });
  }, [s, years]);
  const opt = (u: ConcessionUse) => cmp.options.find((o) => o.use === u)!;

  const changeLocation = (id: string) => {
    const l = getLocation(id);
    setS((p) => ({ ...p, locationId: l.id, taxAnnual: countyTaxAnnual(l.id, p.price), insuranceMonthly: l.insuranceMonthly }));
    toast(`${l.label}: tax & insurance set to county defaults`, 'info');
  };

  const toggleSecond = (on: boolean) => {
    setS((p) => ({ ...p, secondLoan: on, downPct: on && p.downPct >= 100 - p.firstLienPct ? Math.max(0, 100 - p.firstLienPct - 10) : p.downPct }));
    if (on && s.downPct >= 100 - s.firstLienPct) toast('Down payment set to 10% for an 80/10/10 piggyback', 'info');
  };

  const title = `${usd(s.concession)} concession · ${usd(s.price)}`;
  const csv = () => [
    ['Metric', 'Baseline', ...cmp.options.map((o) => o.label)],
    ['Price', cmp.baseline.price, ...cmp.options.map((o) => o.price)],
    ['First loan', cmp.baseline.firstLoan, ...cmp.options.map((o) => o.firstLoan)],
    ['Second loan', cmp.baseline.secondLoan, ...cmp.options.map((o) => o.secondLoan)],
    ['Note rate %', cmp.baseline.noteRate, ...cmp.options.map((o) => o.noteRate)],
    ['Points', 0, ...cmp.options.map((o) => o.points)],
    ['Buydown cost', 0, ...cmp.options.map((o) => o.buydownCost)],
    ['Monthly year 1', cmp.baseline.monthlyYear1, ...cmp.options.map((o) => o.monthlyYear1)],
    ['Monthly year 2', cmp.baseline.monthlyYear2, ...cmp.options.map((o) => o.monthlyYear2)],
    ['Monthly long term', cmp.baseline.monthly, ...cmp.options.map((o) => o.monthly)],
    ['Cash to close', cmp.baseline.cashToClose, ...cmp.options.map((o) => o.cashToClose)],
    [`Total cost over ${s.holdingYears} yrs`, cmp.baseline.totalCost, ...cmp.options.map((o) => o.totalCost)],
  ];

  const badges = (u: ConcessionUse) => {
    const b: string[] = [];
    if (cmp.best.payment === u) b.push('Lowest payment');
    if (cmp.best.year1 === u && cmp.best.payment !== u) b.push('Lowest year-1 payment');
    if (cmp.best.cash === u) b.push('Least cash to close');
    if (cmp.best.total === u) b.push(`Lowest ${s.holdingYears}-yr cost`);
    return b;
  };

  const loanFields = (
    <>
      <Field label="Purchase price">
        <NumberInput value={s.price} onChange={(v) => set('price', v)} prefix="$" min={0} ariaLabel="Purchase price" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Down payment" hint={usd((s.price * s.downPct) / 100)}>
          <NumberInput value={s.downPct} onChange={(v) => set('downPct', v)} suffix="%" min={0} max={100} ariaLabel="Down payment percent" />
        </Field>
        <Field label="Rate">
          <NumberInput value={s.ratePct} onChange={(v) => set('ratePct', v)} suffix="%" min={0} max={30} ariaLabel="Interest rate" />
        </Field>
        <Field label="Term">
          <Select value={String(s.termYears)} onChange={(v) => set('termYears', Number(v))} options={[{ value: '30', label: '30 years' }, { value: '20', label: '20 years' }, { value: '15', label: '15 years' }]} ariaLabel="Term" />
        </Field>
        <Field label="Credit score">
          <Select value={s.fico} onChange={(v) => set('fico', v)} options={MI_FICO_BANDS} ariaLabel="Credit score" />
        </Field>
      </div>
    </>
  );
  const propertyFields = (
    <>
      <LocationPicker value={s.locationId} onChange={changeLocation} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Property tax / yr">
          <NumberInput value={s.taxAnnual} onChange={(v) => set('taxAnnual', v)} prefix="$" min={0} ariaLabel="Property tax per year" />
        </Field>
        <Field label="Insurance / mo">
          <NumberInput value={s.insuranceMonthly} onChange={(v) => set('insuranceMonthly', v)} prefix="$" min={0} ariaLabel="Insurance per month" />
        </Field>
        <Field label="HOA / mo">
          <NumberInput value={s.hoaMonthly} onChange={(v) => set('hoaMonthly', v)} prefix="$" min={0} ariaLabel="HOA per month" />
        </Field>
      </div>
    </>
  );

  const inputs = (
    <>
      <ClientPicker value={s.clientId} onChange={(id) => set('clientId', id)} required={false} />
      {loanFields}
      <div className="border-t border-slate-100 pt-4">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Seller concession</div>
        <div className="space-y-3">
          <Field label="Concession amount" hint={`${pct(cmp.concessionPct, 2)} of price · max ${cmp.maxConcessionPct}% at this LTV`}>
            <NumberInput value={s.concession} onChange={(v) => set('concession', v)} prefix="$" min={0} ariaLabel="Seller concession" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Closing costs">
              <NumberInput value={s.closingCosts} onChange={(v) => set('closingCosts', v)} prefix="$" min={0} ariaLabel="Closing costs" />
            </Field>
            <Field label="Rate drop per point" hint="1 point = 1% of loan">
              <NumberInput value={s.rateDropPerPoint} onChange={(v) => set('rateDropPerPoint', v)} suffix="%" min={0} max={2} ariaLabel="Rate drop per point" />
            </Field>
            <Field label="Holding period">
              <NumberInput value={s.holdingYears} onChange={(v) => set('holdingYears', Math.max(1, Math.round(v)))} suffix="yrs" min={1} max={30} ariaLabel="Holding period years" />
            </Field>
          </div>
        </div>
      </div>
      <div className="border-t border-slate-100 pt-4">
        <Toggle checked={s.secondLoan} onChange={toggleSecond} label={<span className="font-medium">Second loan (piggyback)</span>} />
        {s.secondLoan && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="First lien">
              <NumberInput value={s.firstLienPct} onChange={(v) => set('firstLienPct', v)} suffix="%" min={0} max={100} ariaLabel="First lien percent" />
            </Field>
            <Field label="2nd rate">
              <NumberInput value={s.secondRatePct} onChange={(v) => set('secondRatePct', v)} suffix="%" min={0} max={30} ariaLabel="Second loan rate" />
            </Field>
            <Field label="2nd term">
              <Select value={String(s.secondTermYears)} onChange={(v) => set('secondTermYears', Number(v))} options={[{ value: '30', label: '30 years' }, { value: '20', label: '20 years' }, { value: '15', label: '15 years' }, { value: '10', label: '10 years' }]} ariaLabel="Second loan term" />
            </Field>
            <div className="self-end pb-2 text-xs text-slate-500">
              {pct(s.firstLienPct, 2)}/{pct(Math.max(0, 100 - s.firstLienPct - s.downPct), 2)}/{pct(s.downPct, 2)}
            </div>
          </div>
        )}
      </div>
      <div className="border-t border-slate-100 pt-4">{propertyFields}</div>
    </>
  );

  return (
    <div>
      <PageHeader
        eyebrow="Real Estate"
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            Seller Contribution <Badge tone="blue">Reimagined</Badge>
          </span>
        }
        subtitle="Reimagined — the original is a legacy iframe tool. Compare how a seller concession works hardest: price cut, closing credit, permanent buydown or 2-1 buydown."
      />
      <Toolbar>
        <ToolbarButton
          icon={<FilePlus className="h-4 w-4" />}
          onClick={() => {
            setS(BLANK);
            toast('New scenario started', 'info');
          }}
        >
          Create New
        </ToolbarButton>
        <ToolbarButton icon={<FolderOpen className="h-4 w-4" />} onClick={() => setModal('load')}>
          Load
        </ToolbarButton>
        <ToolbarButton
          icon={<PlayCircle className="h-4 w-4" />}
          onClick={() => {
            setS(DEMO);
            toast('Demo loaded: Alex Rivera · $500,000 · 20% down · 6.5%', 'info');
          }}
        >
          Demo
        </ToolbarButton>
        <div className="w-48 sm:w-56">
          <LocationPicker value={s.locationId} onChange={changeLocation} label="" />
        </div>
        <ToolbarButton icon={<ShieldCheck className="h-4 w-4" />} onClick={() => setModal('mi')}>
          MI Worksheet
        </ToolbarButton>
        <span className="inline-flex h-9 items-center rounded-lg px-3 hover:bg-slate-50">
          <Toggle checked={s.secondLoan} onChange={toggleSecond} label={<span className="text-[13px] font-medium">Second Loan</span>} />
        </span>
        <ToolbarButton
          icon={<Save className="h-4 w-4" />}
          onClick={() => {
            setSaved((l) => [{ id: `sc-${Date.now()}`, savedAt: new Date().toISOString(), title: `${client?.name ? `${client.name} · ` : ''}${title}`, state: s }, ...l].slice(0, 30));
            saveScenario({ toolId: 'seller-contribution', title, clientId: s.clientId ?? undefined, clientName: client?.name, href: window.location.pathname + window.location.search });
            toast('Scenario saved');
          }}
        >
          Save Scenario
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton disabled title="Legacy — not carried over">
          Migrate
        </ToolbarButton>
        <ToolbarButton
          icon={<Download className="h-4 w-4" />}
          onClick={() => downloadCsv(`seller-contribution-${new Date().toISOString().slice(0, 10)}.csv`, csv())}
        >
          Export
        </ToolbarButton>
        <ToolbarButton icon={<Palette className="h-4 w-4" />} onClick={() => setModal('cobrand')}>
          Co-Brand
        </ToolbarButton>
      </Toolbar>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="no-print h-fit rounded-xl border border-slate-200 bg-white p-5 shadow-card">
          <div className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Inputs</div>
          <div className="space-y-4">{inputs}</div>
        </aside>
        <section className="min-w-0 space-y-6">
        <ResultsHeader
          toolId="seller-contribution"
          scenarioTitle={title}
          clientId={s.clientId}
          csv={csv}
          data={s}
          emailSubject={`How to use your ${usd(s.concession)} seller credit`}
          emailBody={`Here's how a ${usd(s.concession)} seller concession compares on ${usd(s.price)}:\n${cmp.options.map((o) => `• ${o.label}: ${usd(o.monthly)}/mo, ${usd(o.cashToClose)} cash to close`).join('\n')}`}
          chips={[
            { label: 'Client', value: client?.name ?? 'Optional', onEdit: () => setModal('client') },
            { label: 'Property', value: `${usd(s.price)} · ${loc.city}, ${loc.state}`, onEdit: () => setModal('property') },
            { label: 'Loan', value: `${usd(cmp.baseline.firstLoan + cmp.baseline.secondLoan)} · ${pct(s.ratePct, 3)} · ${s.termYears}yr`, onEdit: () => setModal('loan') },
          ]}
        />

        {cmp.overLimit && (
          <Callout tone="warning" title="Concession exceeds the typical limit">
            {usd(s.concession)} is {pct(cmp.concessionPct, 2)} of the price; conventional loans at this LTV usually cap seller contributions at {cmp.maxConcessionPct}%. Any excess would typically need to come off the price.
          </Callout>
        )}

        <Card className="bg-gradient-to-br from-white to-brand-50/40">
          <div className="text-xs font-medium text-slate-500">Baseline — no concession</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-2xl font-semibold tabular-nums text-slate-900">
              {usd(cmp.baseline.monthly)}
              <span className="text-sm font-normal text-slate-500">/mo</span>
            </span>
            <span className="text-sm text-slate-600">
              P&amp;I {usd(cmp.baseline.piFirst, { cents: true })}
              {cmp.baseline.piSecond > 0 && ` + 2nd ${usd(cmp.baseline.piSecond, { cents: true })}`}
              {cmp.baseline.mi > 0 && ` + MI ${usd(cmp.baseline.mi, { cents: true })}`} + escrow {usd(cmp.baseline.escrow)}
            </span>
            <span className="text-sm text-slate-600">Cash to close {usd(cmp.baseline.cashToClose)}</span>
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
          {cmp.options.map((o, i) => (
            <OptionCard key={o.use} o={o} baseline={cmp.baseline} color={SERIES[i]} badges={badges(o.use)} description={DESCRIPTIONS[o.use]} holdingYears={s.holdingYears} />
          ))}
        </div>

        <Card>
          <h3 className="mb-3 text-[15px] font-semibold text-slate-900">Side-by-side</h3>
          <ComparisonTable
            columns={cmp.options.map((o) => o.short)}
            colors={cmp.options.map((_, i) => SERIES[i])}
            rows={[
              { label: 'Purchase price', values: cmp.options.map((o) => usd(o.price)) },
              { label: 'Loan amount', values: cmp.options.map((o) => usd(o.firstLoan + o.secondLoan)) },
              { label: 'Note rate', values: cmp.options.map((o) => pct(o.noteRate, 3)) },
              { label: 'Points bought', sub: true, values: cmp.options.map((o) => (o.points > 0 ? num(o.points, 3) : '—')) },
              { label: '2-1 buydown cost', sub: true, values: cmp.options.map((o) => (o.buydownCost > 0 ? usd(o.buydownCost, { cents: true }) : '—')) },
              { label: 'Monthly — year 1', values: cmp.options.map((o) => usd(o.monthlyYear1)), best: idxMin(cmp.options, (o) => o.monthlyYear1) },
              { label: 'Monthly — year 2', values: cmp.options.map((o) => usd(o.monthlyYear2)), best: idxMin(cmp.options, (o) => o.monthlyYear2) },
              { label: 'Monthly — long term', strong: true, values: cmp.options.map((o) => usd(o.monthly)), best: idxMin(cmp.options, (o) => o.monthly) },
              { label: 'Cash to close', strong: true, values: cmp.options.map((o) => usd(o.cashToClose)), best: idxMin(cmp.options, (o) => o.cashToClose) },
              { label: `Payments over ${s.holdingYears} yrs`, sub: true, values: cmp.options.map((o) => usd(o.paymentsOverHold)) },
              { label: `Balance owed at year ${s.holdingYears}`, sub: true, values: cmp.options.map((o) => usd(o.balanceAtHold)) },
              { label: `Total cost over ${s.holdingYears} yrs`, strong: true, values: cmp.options.map((o) => usd(o.totalCost)), best: idxMin(cmp.options, (o) => o.totalCost) },
            ]}
          />
          <p className="mt-3 text-xs text-slate-500">
            Total cost = cash to close + P&amp;I/MI payments + loan balance still owed at the end of the holding period (taxes and insurance excluded — the same for every option). Monthly figures include {usd(cmp.baseline.escrow)} escrow.
          </p>
        </Card>

        <ChartCard
          title="Cumulative savings vs. no concession"
          subtitle="Out-of-pocket saved (cash to close + payments) by year — higher is better"
          legend={cmp.options.map((o, i) => ({ label: o.label, color: SERIES[i] }))}
          table={{ head: ['Year', ...cmp.options.map((o) => o.short)], rows: chartData.map((r) => [r.year, ...CONCESSION_USES.map((u) => usd(r[u]))]) }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="year" {...axisProps} tickFormatter={(v) => `Yr ${v}`} />
              <YAxis {...axisProps} tickFormatter={axisUsd} width={64} />
              <Tooltip content={<ChartTooltip format={(v) => usd(v)} labelFormat={(l) => `Year ${l}`} />} />
              {CONCESSION_USES.map((u, i) => (
                <Line key={u} type="linear" dataKey={u} name={opt(u).label} stroke={SERIES[i]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <TalkTrack>
          {client ? `${client.name.split(' ')[0]}, ` : ''}the seller is offering {usd(s.concession)}. Used as a <b>permanent buydown</b> it buys {num(opt('permanent').points, 2)} points and drops your rate to {pct(opt('permanent').noteRate, 3)} — {usd(cmp.baseline.monthly - opt('permanent').monthly)}/mo less for the life of the loan. A <b>2-1 buydown</b> costs {usd(opt('temporary').buydownCost)} and makes year one {usd(opt('temporary').monthlyYear1)}/mo. As a <b>closing credit</b> it cuts your cash to close to {usd(opt('credit').cashToClose)}, and as a <b>price cut</b> it lowers the loan by {usd(cmp.baseline.firstLoan + cmp.baseline.secondLoan - opt('price').firstLoan - opt('price').secondLoan)}. If you keep the home {s.holdingYears} years, the {opt(cmp.best.total).label.toLowerCase()} costs you the least overall.
        </TalkTrack>
        <ReportFooter />
        </section>
      </div>

      <MiWorksheet
        open={modal === 'mi'}
        onClose={() => setModal(null)}
        fico={s.fico}
        onFico={(v) => set('fico', v)}
        rows={[cmp.baseline, ...cmp.options].map((o) => ({ label: o.use === 'none' ? 'Baseline' : o.label, ltv: o.price > 0 ? (o.firstLoan / o.price) * 100 : 0, loan: o.firstLoan, mi: o.mi, ratePct: o.firstLoan > 0 && o.mi > 0 ? ((o.mi * 12) / o.firstLoan) * 100 : 0 }))}
      />
      <CoBrandingEditor open={modal === 'cobrand'} onClose={() => setModal(null)} />
      <Modal open={modal === 'loan'} onClose={() => setModal(null)} title="Edit loan" footer={<Button onClick={() => setModal(null)}>Done</Button>}>
        <div className="space-y-4">{loanFields}</div>
      </Modal>
      <Modal open={modal === 'property'} onClose={() => setModal(null)} title="Edit property" footer={<Button onClick={() => setModal(null)}>Done</Button>}>
        <div className="space-y-4">{propertyFields}</div>
      </Modal>
      <Modal open={modal === 'client'} onClose={() => setModal(null)} title="Edit client" footer={<Button onClick={() => setModal(null)}>Done</Button>}>
        <ClientPicker value={s.clientId} onChange={(id) => set('clientId', id)} required={false} />
      </Modal>
      <Modal open={modal === 'load'} onClose={() => setModal(null)} title="Load a saved scenario" size="lg">
        {saved.length === 0 ? (
          <EmptyState title="No saved scenarios yet" icon={<FolderOpen className="h-8 w-8" />} action={<Button variant="secondary" onClick={() => { setS(DEMO); setModal(null); }}>Load the demo instead</Button>}>
            Use Save Scenario to keep one here (saved in this browser).
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {saved.map((x) => (
              <li key={x.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900">{x.title}</div>
                  <div className="text-xs text-slate-500">Saved {date(x.savedAt)}</div>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setS(x.state);
                    setModal(null);
                    toast('Scenario loaded');
                  }}
                >
                  Load
                </Button>
                <button type="button" aria-label="Delete saved scenario" onClick={() => setSaved((l) => l.filter((y) => y.id !== x.id))} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}

function idxMin(opts: ConcessionOption[], key: (o: ConcessionOption) => number): number {
  let b = 0;
  opts.forEach((o, i) => key(o) < key(opts[b]) - 0.005 && (b = i));
  return b;
}

function OptionCard({ o, baseline, color, badges, description, holdingYears }: { o: ConcessionOption; baseline: ConcessionOption; color: string; badges: string[]; description: string; holdingYears: number }) {
  const save = baseline.monthly - o.monthly;
  return (
    <Card className={clsx('relative flex flex-col', badges.length > 0 && 'ring-1 ring-emerald-200')}>
      <div className="mb-1 flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
        <span className="text-sm font-semibold text-slate-900">{o.label}</span>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-slate-500">{description}</p>
      <div className="text-xs font-medium text-slate-500">{o.use === 'temporary' ? 'Year-1 monthly payment' : 'Monthly payment'}</div>
      <div className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900">{usd(o.use === 'temporary' ? o.monthlyYear1 : o.monthly)}</div>
      <div className={clsx('mt-0.5 text-xs font-medium', (o.use === 'temporary' ? baseline.monthly - o.monthlyYear1 : save) > 0.5 ? 'text-gain' : 'text-slate-500')}>
        {o.use === 'temporary'
          ? `Yr 2 ${usd(o.monthlyYear2)} · Yr 3+ ${usd(o.monthly)}`
          : save > 0.5
            ? `${usd(save)}/mo less than baseline`
            : 'Same payment as baseline'}
      </div>
      <dl className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Rate</dt>
          <dd className="font-medium tabular-nums text-slate-800">{o.use === 'temporary' ? `${pct(o.year1Rate, 3)} → ${pct(o.year2Rate, 3)} → ${pct(o.noteRate, 3)}` : pct(o.noteRate, 3)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Cash to close</dt>
          <dd className="font-medium tabular-nums text-slate-800">{usd(o.cashToClose)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">{holdingYears}-yr total cost</dt>
          <dd className="font-medium tabular-nums text-slate-800">{usd(o.totalCost)}</dd>
        </div>
        {o.unused > 0.5 && (
          <div className="text-xs text-amber-700">{usd(o.unused)} of the concession can’t be used (exceeds closing costs).</div>
        )}
        {o.shortfall > 0.5 && <div className="text-xs text-amber-700">Concession is {usd(o.shortfall)} short of the buydown cost — buyer covers it at closing.</div>}
        {o.use === 'temporary' && o.creditApplied > 0.5 && <div className="text-xs text-slate-500">Leftover {usd(o.creditApplied)} applied to closing costs.</div>}
      </dl>
      {badges.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {badges.map((b) => (
            <Badge key={b} tone="green">
              <Award className="h-3 w-3" /> {b}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}

