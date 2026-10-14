'use client';

import clsx from 'clsx';
import {
  ArrowLeft,
  Bath,
  BedDouble,
  Calculator,
  Download,
  FilePlus,
  FolderOpen,
  HelpCircle,
  House,
  ImagePlus,
  Link2,
  MapPin,
  Printer,
  Ruler,
  Save,
  Search,
  Share2,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Wrench,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { ReportFooter } from '@/components/calc/ReportFooter';
import { Badge, Button, Callout, Card, DemoBadge, EmptyState, Field, Modal, NumberInput, PageHeader, Select, TextArea, TextInput } from '@/components/ui';
import { NOTHING_SENT, Toggle, copyText, esc, initials, useLocalList } from '@/components/tools/social-studio/shared';
import type { CoBranding } from '@/data/mock/cobranding';
import { DEMO_LISTINGS, findListing } from '@/data/mock/openHouseListings';
import { MI_FICO_BANDS, flyerScenario, pricePerSqft, type FlyerScenarioResult, type MiFicoBand, type Program } from '@/lib/calculations/flyer';
import { downloadText } from '@/lib/exportCsv';
import { date, num, pct, usd } from '@/lib/format';
import { useStore } from '@/lib/store';
import { useUrlState } from '@/lib/useUrlState';
import { MiWorksheet } from './MiWorksheet';
import { Toolbar, ToolbarButton, ToolbarDivider, ToolbarLink, ToolbarMenu } from './Toolbar';

interface ScenarioCfg {
  enabled: boolean;
  program: Program;
  downPct: number;
  ratePct: number;
  termYears: number;
}

interface Flyer {
  mls: string;
  address: string;
  cityLine: string;
  listPrice: number;
  beds: number;
  baths: number;
  sqft: number;
  description: string;
  openDate: string;
  openTime: string;
  photo: number;
  taxAnnual: number;
  insuranceMonthly: number;
  hoaMonthly: number;
  fico: MiFicoBand;
  scenarios: ScenarioCfg[];
}

interface SavedFlyer {
  id: string;
  savedAt: string;
  flyer: Flyer;
}

const PHOTOS = [
  'linear-gradient(135deg,#c7d2fe 0%,#a5b4fc 40%,#6366f1 100%)',
  'linear-gradient(135deg,#bbf7d0 0%,#6ee7b7 45%,#0f9d6b 100%)',
  'linear-gradient(135deg,#fed7aa 0%,#fdba74 45%,#ea580c 100%)',
  'linear-gradient(135deg,#e0f2fe 0%,#7dd3fc 45%,#0369a1 100%)',
];

const DEFAULT_SCENARIOS: ScenarioCfg[] = [
  { enabled: true, program: 'conventional', downPct: 20, ratePct: 6.5, termYears: 30 },
  { enabled: true, program: 'conventional', downPct: 5, ratePct: 6.5, termYears: 30 },
  { enabled: true, program: 'fha', downPct: 3.5, ratePct: 6.25, termYears: 30 },
];

const L = DEMO_LISTINGS[0];
export const DEFAULT_FLYER: Flyer = {
  mls: L.mls,
  address: L.address,
  cityLine: L.cityLine,
  listPrice: L.price,
  beds: L.beds,
  baths: L.baths,
  sqft: L.sqft,
  description: L.description,
  openDate: '2026-10-18',
  openTime: '1:00 – 4:00 PM',
  photo: 0,
  taxAnnual: L.taxAnnual,
  insuranceMonthly: L.insuranceMonthly,
  hoaMonthly: L.hoaMonthly,
  fico: '720–739',
  scenarios: DEFAULT_SCENARIOS,
};

const BLANK_FLYER: Flyer = { ...DEFAULT_FLYER, mls: '', address: '', cityLine: '', listPrice: 0, beds: 0, baths: 0, sqft: 0, description: '', taxAnnual: 0, insuranceMonthly: 0, hoaMonthly: 0, photo: 1 };

const scenarioLabel = (s: ScenarioCfg) => `${s.program === 'fha' ? 'FHA' : 'Conventional'} · ${pct(s.downPct, 2)} down`;

function computeAll(f: Flyer) {
  return f.scenarios.map((s) => ({
    cfg: s,
    r: flyerScenario({ price: f.listPrice, downPct: s.downPct, program: s.program, ratePct: s.ratePct, termYears: s.termYears, taxAnnual: f.taxAnnual, insuranceMonthly: f.insuranceMonthly, hoaMonthly: f.hoaMonthly, fico: f.fico }),
  }));
}

/** Stand-alone printable HTML flyer. */
function flyerHtml(f: Flyer, rows: { cfg: ScenarioCfg; r: FlyerScenarioResult }[], c: CoBranding, photoUrl: string | null): string {
  const on = rows.filter((x) => x.cfg.enabled);
  const photo = photoUrl ? `background:url('${photoUrl}') center/cover` : `background:${PHOTOS[f.photo % PHOTOS.length]}`;
  const col = ({ cfg, r }: (typeof rows)[number]) => `<div class="sc"><div class="lab">${esc(scenarioLabel(cfg))}</div><div class="big">${usd(r.total)}<span>/mo</span></div><div class="row"><span>Down payment</span><b>${usd(r.downPayment)}</b></div><div class="row"><span>Principal &amp; interest</span><b>${usd(r.pi)}</b></div><div class="row"><span>${cfg.program === 'fha' ? 'FHA MIP' : 'Mortgage insurance'}</span><b>${usd(r.mi)}</b></div><div class="row"><span>Taxes</span><b>${usd(r.tax)}</b></div><div class="row"><span>Insurance</span><b>${usd(r.insurance)}</b></div>${r.hoa > 0 ? `<div class="row"><span>HOA</span><b>${usd(r.hoa)}</b></div>` : ''}<div class="rate">${pct(cfg.ratePct, 3)} · ${cfg.termYears}-yr fixed</div></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open House — ${esc(f.address)}</title><style>
body{margin:0;background:#eef0f5;font-family:Inter,Segoe UI,Arial,sans-serif;color:#111833}.page{max-width:816px;margin:24px auto;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.12)}
.photo{height:300px;${photo};position:relative}.ribbon{position:absolute;left:24px;top:24px;background:#6a2ff2;color:#fff;font-weight:800;letter-spacing:.12em;padding:10px 16px;border-radius:8px}.when{position:absolute;right:24px;top:24px;background:#fff;padding:8px 14px;border-radius:8px;font-weight:600;font-size:14px}
.body{padding:28px 36px}.price{font-size:40px;font-weight:800}.addr{font-size:20px;font-weight:600}.city{color:#64748b}.facts{display:flex;gap:24px;margin:14px 0;color:#334155;font-weight:600}.desc{color:#475569;line-height:1.6}
h3{margin:24px 0 10px;text-transform:uppercase;letter-spacing:.12em;font-size:12px;color:#6a2ff2}.grid{display:grid;grid-template-columns:repeat(${Math.max(1, on.length)},1fr);gap:12px}.sc{border:1px solid #e2e8f0;border-radius:12px;padding:14px}.lab{font-size:12px;font-weight:700;color:#5a21d6}.big{font-size:28px;font-weight:800;margin:6px 0 10px}.big span{font-size:13px;color:#64748b;font-weight:500}.row{display:flex;justify-content:space-between;font-size:12px;padding:3px 0;color:#475569}.rate{margin-top:8px;font-size:11px;color:#94a3b8}
.lo{display:flex;align-items:center;gap:14px;background:#111833;color:#fff;padding:18px 36px}.av{width:48px;height:48px;border-radius:50%;background:#6a2ff2;display:flex;align-items:center;justify-content:center;font-weight:800}.lo small{display:block;color:#bcadff}.ct{margin-left:auto;text-align:right;font-size:13px}.disc{font-size:10px;color:#94a3b8;padding:12px 36px 20px}
@media print{body{background:#fff}.page{margin:0;box-shadow:none}}</style></head><body><div class="page"><div class="photo"><div class="ribbon">OPEN HOUSE</div><div class="when">${esc(f.openDate ? date(f.openDate + 'T12:00:00Z', 'long') : '')} · ${esc(f.openTime)}</div></div><div class="body"><div class="price">${usd(f.listPrice)}</div><div class="addr">${esc(f.address)}</div><div class="city">${esc(f.cityLine)}${f.mls ? ` · MLS# ${esc(f.mls)}` : ''}</div><div class="facts"><span>${num(f.beds)} beds</span><span>${num(f.baths, f.baths % 1 ? 1 : 0)} baths</span><span>${num(f.sqft)} sq ft</span></div><div class="desc">${esc(f.description)}</div><h3>Your monthly payment options</h3><div class="grid">${on.map(col).join('')}</div></div><div class="lo"><div class="av">${esc(initials(c.name))}</div><div><b>${esc(c.name)}</b><small>${esc(c.title ?? 'Loan Officer')} · NMLS# ${esc(c.nmls)} · ${esc(c.company)}</small></div><div class="ct">Cell ${esc(c.cell)}<br>${esc(c.email)}</div></div><div class="disc">Payments are estimates for illustration only and are not a commitment to lend. Rates, MI and taxes are examples and subject to change; actual terms depend on credit, property and program guidelines.</div></div></body></html>`;
}

export function OpenHouseFlyers() {
  const router = useRouter();
  const { cobranding, toast, saveScenario } = useStore();
  const [f, setF] = useUrlState<Flyer>(DEFAULT_FLYER);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [lookup, setLookup] = useState('');
  const [modal, setModal] = useState<'load' | 'mi' | 'help' | 'new' | null>(null);
  const [saved, setSaved] = useLocalList<SavedFlyer>('mbsh-open-house-flyers-v1');
  const fileRef = useRef<HTMLInputElement>(null);
  const rows = useMemo(() => computeAll(f), [f]);
  const on = rows.filter((x) => x.cfg.enabled);
  const set = <K extends keyof Flyer>(k: K, v: Flyer[K]) => setF((p) => ({ ...p, [k]: v }));
  const setScenario = (i: number, patch: Partial<ScenarioCfg>) => setF((p) => ({ ...p, scenarios: p.scenarios.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));

  const doLookup = () => {
    const l = findListing(lookup);
    if (!l) {
      toast('No demo listing found — try #20481234 or “Bayberry”', 'warning');
      return;
    }
    setF((p) => ({ ...p, mls: l.mls, address: l.address, cityLine: l.cityLine, listPrice: l.price, beds: l.beds, baths: l.baths, sqft: l.sqft, description: l.description, taxAnnual: l.taxAnnual, insuranceMonthly: l.insuranceMonthly, hoaMonthly: l.hoaMonthly }));
    setLookup('');
    toast(`Loaded MLS# ${l.mls} — ${l.address}`);
  };

  const save = () => {
    const title = f.address || 'Untitled flyer';
    setSaved((l) => [{ id: `fly-${Date.now()}`, savedAt: new Date().toISOString(), flyer: f }, ...l.filter((x) => x.flyer.address !== f.address || !f.address)].slice(0, 30));
    saveScenario({ toolId: 'open-house-flyers', title: `${title} · ${usd(f.listPrice)}`, href: window.location.pathname + window.location.search });
    toast('Flyer saved');
  };

  const exportHtml = () => {
    downloadText(`open-house-${(f.address || 'flyer').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.html`, flyerHtml(f, rows, cobranding, photoUrl), 'text/html;charset=utf-8');
    toast('Flyer downloaded (HTML — print to PDF from your browser)');
  };

  const shareLink = async () => {
    await copyText(window.location.href);
    toast(`Flyer link copied — ${NOTHING_SENT}`, 'info');
  };

  const onPhoto = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Please choose an image file', 'warning');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhotoUrl(String(reader.result));
    reader.readAsDataURL(file);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Real Estate"
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            Open House Flyers <Badge tone="blue">Reimagined</Badge> <DemoBadge />
          </span>
        }
        subtitle="Reimagined — the original is a legacy iframe tool; rebuilt here as a modern flyer builder with live payment scenarios."
      />
      <Toolbar>
        <ToolbarButton icon={<FilePlus className="h-4 w-4" />} onClick={() => setModal('new')}>
          Create New
        </ToolbarButton>
        <ToolbarButton icon={<FolderOpen className="h-4 w-4" />} onClick={() => setModal('load')}>
          Load
        </ToolbarButton>
        <form
          className="flex items-center"
          onSubmit={(e) => {
            e.preventDefault();
            doLookup();
          }}
        >
          <div className="relative">
            <MapPin className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input aria-label="Location: #MLS or Address" value={lookup} onChange={(e) => setLookup(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doLookup(); } }} placeholder="#MLS or Address" list="ohf-listings" className="h-9 w-44 rounded-lg border border-slate-300 bg-white pl-8 pr-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:w-52" />
            <datalist id="ohf-listings">
              {DEMO_LISTINGS.map((l) => (
                <option key={l.mls} value={`#${l.mls}`}>{`${l.address}, ${l.cityLine}`}</option>
              ))}
            </datalist>
          </div>
          <button type="submit" aria-label="Find listing" className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100">
            <Search className="h-4 w-4" />
          </button>
        </form>
        <ToolbarButton icon={<ShieldCheck className="h-4 w-4" />} onClick={() => setModal('mi')}>
          MI Worksheet
        </ToolbarButton>
        <ToolbarButton icon={<Save className="h-4 w-4" />} onClick={save}>
          Save Scenario
        </ToolbarButton>
        <ToolbarMenu
          icon={<Download className="h-4 w-4" />}
          label="Export"
          items={[
            { label: 'Download flyer (HTML)', icon: <Download className="h-4 w-4" />, onClick: exportHtml },
            { label: 'Print / Save as PDF', icon: <Printer className="h-4 w-4" />, onClick: () => window.print() },
          ]}
        />
        <ToolbarButton icon={<Share2 className="h-4 w-4" />} onClick={shareLink}>
          Save &amp; Share
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton disabled title="Legacy — not carried over">
          Migrate
        </ToolbarButton>
        <ToolbarButton disabled title="Legacy — not carried over">
          Retire
        </ToolbarButton>
        <ToolbarLink icon={<Calculator className="h-4 w-4" />} href="/members/payment">
          Payment
        </ToolbarLink>
        <ToolbarLink icon={<TrendingUp className="h-4 w-4" />} href="/members/investment-property-analyzer">
          Invest
        </ToolbarLink>
        <ToolbarMenu
          icon={<Wrench className="h-4 w-4" />}
          label="Quick Tools"
          items={[
            { label: 'Payment Calculator', href: '/members/payment' },
            { label: 'Affordability', href: '/members/affordability' },
            { label: 'Buying Power', href: '/members/buying-power' },
            { label: 'Seller Contribution', href: '/members/seller-contribution' },
            { label: 'Blended Rate', href: '/members/blended-rate' },
          ]}
        />
        <ToolbarButton icon={<HelpCircle className="h-4 w-4" />} onClick={() => setModal('help')}>
          Help
        </ToolbarButton>
        <ToolbarButton icon={<ArrowLeft className="h-4 w-4" />} onClick={() => (window.history.length > 1 ? router.back() : router.push('/members/real-estate'))}>
          Return
        </ToolbarButton>
      </Toolbar>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="no-print space-y-4">
          <Card>
            <div className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Listing</div>
            <div className="space-y-4">
              <Field label="Address">
                <TextInput value={f.address} onChange={(e) => set('address', e.target.value)} placeholder="Street address" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="City, State ZIP">
                  <TextInput value={f.cityLine} onChange={(e) => set('cityLine', e.target.value)} placeholder="Dallas, TX 75201" />
                </Field>
                <Field label="MLS #">
                  <TextInput value={f.mls} onChange={(e) => set('mls', e.target.value)} placeholder="Optional" />
                </Field>
              </div>
              <Field label="List price">
                <NumberInput value={f.listPrice} onChange={(v) => set('listPrice', v)} prefix="$" min={0} ariaLabel="List price" />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Beds">
                  <NumberInput value={f.beds} onChange={(v) => set('beds', v)} min={0} ariaLabel="Beds" />
                </Field>
                <Field label="Baths">
                  <NumberInput value={f.baths} onChange={(v) => set('baths', v)} min={0} decimals={1} ariaLabel="Baths" />
                </Field>
                <Field label="Sq ft">
                  <NumberInput value={f.sqft} onChange={(v) => set('sqft', v)} min={0} ariaLabel="Square feet" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Open house date">
                  <TextInput type="date" value={f.openDate} onChange={(e) => set('openDate', e.target.value)} />
                </Field>
                <Field label="Time">
                  <TextInput value={f.openTime} onChange={(e) => set('openTime', e.target.value)} />
                </Field>
              </div>
              <Field label="Description">
                <TextArea rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} />
              </Field>
              <Field label="Photo" hint={photoUrl ? 'Uploaded photo stays in this browser (not in the share link).' : 'Pick a placeholder or upload a listing photo.'}>
                <div className="flex flex-wrap items-center gap-2">
                  {PHOTOS.map((p, i) => (
                    <button key={i} type="button" aria-label={`Placeholder photo ${i + 1}`} aria-pressed={!photoUrl && f.photo === i} onClick={() => { setPhotoUrl(null); set('photo', i); }} className={clsx('h-9 w-12 rounded-md border-2', !photoUrl && f.photo === i ? 'border-brand-600' : 'border-transparent')} style={{ background: p }} />
                  ))}
                  <Button size="sm" variant="secondary" icon={<ImagePlus className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
                    Upload
                  </Button>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
                </div>
              </Field>
            </div>
          </Card>
          <Card>
            <div className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Monthly costs</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Property tax / yr">
                <NumberInput value={f.taxAnnual} onChange={(v) => set('taxAnnual', v)} prefix="$" min={0} ariaLabel="Property tax per year" />
              </Field>
              <Field label="Insurance / mo">
                <NumberInput value={f.insuranceMonthly} onChange={(v) => set('insuranceMonthly', v)} prefix="$" min={0} ariaLabel="Insurance per month" />
              </Field>
              <Field label="HOA / mo">
                <NumberInput value={f.hoaMonthly} onChange={(v) => set('hoaMonthly', v)} prefix="$" min={0} ariaLabel="HOA per month" />
              </Field>
              <Field label="Credit score">
                <Select value={f.fico} onChange={(v) => set('fico', v)} options={MI_FICO_BANDS} ariaLabel="Credit score" />
              </Field>
            </div>
          </Card>
          <Card>
            <div className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Payment scenarios (up to 3)</div>
            <div className="space-y-4">
              {f.scenarios.map((s, i) => (
                <div key={i} className={clsx('rounded-lg border p-3', s.enabled ? 'border-slate-200' : 'border-dashed border-slate-200 bg-slate-50/60')}>
                  <div className="mb-2 flex items-center justify-between">
                    <Toggle checked={s.enabled} onChange={(v) => setScenario(i, { enabled: v })} label={<span className="text-sm font-semibold text-slate-800">Scenario {i + 1}</span>} />
                    <span className="text-xs text-slate-500">{scenarioLabel(s)}</span>
                  </div>
                  {s.enabled && (
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Program">
                        <Select
                          value={s.program}
                          onChange={(v) => setScenario(i, { program: v, downPct: v === 'fha' ? Math.max(3.5, s.downPct) : s.downPct })}
                          options={[{ value: 'conventional', label: 'Conventional' }, { value: 'fha', label: 'FHA' }]}
                          ariaLabel={`Scenario ${i + 1} program`}
                        />
                      </Field>
                      <Field label="Down">
                        <NumberInput value={s.downPct} onChange={(v) => setScenario(i, { downPct: v })} suffix="%" min={0} max={100} ariaLabel={`Scenario ${i + 1} down payment percent`} />
                      </Field>
                      <Field label="Rate">
                        <NumberInput value={s.ratePct} onChange={(v) => setScenario(i, { ratePct: v })} suffix="%" min={0} max={30} ariaLabel={`Scenario ${i + 1} rate`} />
                      </Field>
                      <Field label="Term">
                        <Select value={String(s.termYears)} onChange={(v) => setScenario(i, { termYears: Number(v) })} options={[{ value: '30', label: '30 yr' }, { value: '20', label: '20 yr' }, { value: '15', label: '15 yr' }]} ariaLabel={`Scenario ${i + 1} term`} />
                      </Field>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </aside>

        <section className="min-w-0 space-y-6">
          <FlyerPreview f={f} rows={on} photoUrl={photoUrl} cobranding={cobranding} />
          <Card className="no-print">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-slate-900">Scenario breakdown</h3>
              <span className="text-xs text-slate-500">{f.sqft > 0 ? `${usd(pricePerSqft(f.listPrice, f.sqft))}/sq ft` : ''}</span>
            </div>
            {on.length === 0 ? (
              <EmptyState title="All scenarios are off">Turn on at least one payment scenario.</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-max text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                      <th className="px-3 py-2 text-left font-semibold" />
                      {on.map(({ cfg }, i) => (
                        <th key={i} className="px-3 py-2 text-right font-semibold text-slate-700">
                          {scenarioLabel(cfg)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        ['Down payment', (r: FlyerScenarioResult) => usd(r.downPayment)],
                        ['Loan amount', (r: FlyerScenarioResult) => usd(r.loan)],
                        ['LTV', (r: FlyerScenarioResult) => pct(r.ltv, 2)],
                        ['Principal & interest', (r: FlyerScenarioResult) => usd(r.pi, { cents: true })],
                        ['Mortgage insurance', (r: FlyerScenarioResult) => (r.mi > 0 ? `${usd(r.mi, { cents: true })} (${pct(r.miRatePct, 2, { trim: false })})` : '—')],
                        ['Taxes', (r: FlyerScenarioResult) => usd(r.tax, { cents: true })],
                        ['Insurance', (r: FlyerScenarioResult) => usd(r.insurance, { cents: true })],
                        ['HOA', (r: FlyerScenarioResult) => usd(r.hoa, { cents: true })],
                      ] as const
                    ).map(([label, fn]) => (
                      <tr key={label} className="border-b border-slate-100">
                        <td className="px-3 py-2 font-medium text-slate-700">{label}</td>
                        {on.map(({ r }, i) => (
                          <td key={i} className="px-3 py-2 text-right tabular-nums text-slate-800">
                            {fn(r)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr className="bg-slate-50/80 font-semibold">
                      <td className="px-3 py-2.5 text-slate-900">Total monthly</td>
                      {on.map(({ r }, i) => (
                        <td key={i} className="px-3 py-2.5 text-right tabular-nums text-slate-900">
                          {usd(r.total, { cents: true })}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {on.some((x) => x.cfg.program === 'fha') && <p className="mt-2 text-xs text-slate-500">FHA includes a 1.75% upfront MIP financed into the loan and annual MIP of 0.55% (0.50% at ≤ 95% LTV).</p>}
          </Card>
          <ReportFooter />
        </section>
      </div>

      <MiWorksheet
        open={modal === 'mi'}
        onClose={() => setModal(null)}
        fico={f.fico}
        onFico={(v) => set('fico', v)}
        rows={on.map(({ cfg, r }) => ({ label: scenarioLabel(cfg), ltv: r.ltv, loan: r.baseLoan, mi: r.mi, ratePct: r.miRatePct, note: cfg.program === 'fha' ? '(FHA MIP)' : undefined }))}
      />
      <Modal
        open={modal === 'new'}
        onClose={() => setModal(null)}
        title="Create a new flyer?"
        description="Clears the listing details. Save first if you want to keep this flyer."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setF({ ...BLANK_FLYER, scenarios: DEFAULT_SCENARIOS });
                setPhotoUrl(null);
                setModal(null);
                toast('New flyer started', 'info');
              }}
            >
              Create new
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">Tip: use the Location box to pull a demo listing by #MLS or address.</p>
      </Modal>
      <Modal open={modal === 'load'} onClose={() => setModal(null)} title="Load a saved flyer" size="lg">
        {saved.length === 0 ? (
          <EmptyState title="No saved flyers yet" icon={<FolderOpen className="h-8 w-8" />}>
            Use Save Scenario to keep a flyer here (saved in this browser). Or load a demo listing:
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {DEMO_LISTINGS.slice(0, 3).map((l) => (
                <Button
                  key={l.mls}
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setF((p) => ({ ...p, mls: l.mls, address: l.address, cityLine: l.cityLine, listPrice: l.price, beds: l.beds, baths: l.baths, sqft: l.sqft, description: l.description, taxAnnual: l.taxAnnual, insuranceMonthly: l.insuranceMonthly, hoaMonthly: l.hoaMonthly }));
                    setModal(null);
                  }}
                >
                  #{l.mls}
                </Button>
              ))}
            </div>
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {saved.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <div className="flex h-10 w-12 shrink-0 items-center justify-center rounded-md text-white" style={{ background: PHOTOS[s.flyer.photo % PHOTOS.length] }}>
                  <House className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900">{s.flyer.address || 'Untitled flyer'}</div>
                  <div className="truncate text-xs text-slate-500">
                    {usd(s.flyer.listPrice)} · {s.flyer.cityLine || '—'} · saved {date(s.savedAt)}
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setF(s.flyer);
                    setModal(null);
                    toast('Flyer loaded');
                  }}
                >
                  Load
                </Button>
                <button type="button" aria-label="Delete saved flyer" onClick={() => setSaved((l) => l.filter((x) => x.id !== s.id))} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
      <Modal open={modal === 'help'} onClose={() => setModal(null)} title="Open House Flyers — help" footer={<Button onClick={() => setModal(null)}>Got it</Button>}>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
          <li>Find the listing with <b>Location</b> (#MLS or address) or type the details on the left.</li>
          <li>Set up to three payment scenarios — conventional or FHA, any down payment, rate and term.</li>
          <li>Open the <b>MI Worksheet</b> to see how credit score and LTV drive mortgage insurance.</li>
          <li><b>Export</b> a print-ready HTML flyer or print straight to PDF. <b>Save &amp; Share</b> copies a link that reopens this flyer.</li>
        </ol>
        <Callout className="mt-4" tone="info">
          Migrate and Retire were legacy-only actions and are not carried over to this rebuild.
        </Callout>
      </Modal>
    </div>
  );
}

function FlyerPreview({ f, rows, photoUrl, cobranding: c }: { f: Flyer; rows: { cfg: ScenarioCfg; r: FlyerScenarioResult }[]; photoUrl: string | null; cobranding: CoBranding }) {
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="relative h-48 sm:h-64" style={photoUrl ? { background: `url('${photoUrl}') center/cover` } : { background: PHOTOS[f.photo % PHOTOS.length] }}>
        {!photoUrl && <House className="absolute inset-0 m-auto h-20 w-20 text-white/50" strokeWidth={1.25} />}
        <span className="absolute left-4 top-4 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-extrabold tracking-[0.14em] text-white shadow-lift sm:text-sm">OPEN HOUSE</span>
        {(f.openDate || f.openTime) && (
          <span className="absolute right-4 top-4 rounded-lg bg-white/95 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-card">
            {f.openDate ? date(f.openDate + 'T12:00:00Z') : ''} {f.openTime && `· ${f.openTime}`}
          </span>
        )}
      </div>
      <div className="p-5 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{usd(f.listPrice)}</div>
            <div className="mt-1 text-lg font-semibold text-slate-800">{f.address || <span className="text-slate-400">Add an address</span>}</div>
            <div className="text-sm text-slate-500">
              {f.cityLine || 'City, State ZIP'}
              {f.mls && ` · MLS# ${f.mls}`}
            </div>
          </div>
          <div className="flex gap-4 text-sm font-semibold text-slate-700">
            <span className="inline-flex items-center gap-1.5">
              <BedDouble className="h-4 w-4 text-slate-400" />
              {num(f.beds)} bd
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Bath className="h-4 w-4 text-slate-400" />
              {num(f.baths, f.baths % 1 ? 1 : 0)} ba
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Ruler className="h-4 w-4 text-slate-400" />
              {num(f.sqft)} sqft
            </span>
          </div>
        </div>
        {f.description && <p className="mt-4 text-sm leading-relaxed text-slate-600">{f.description}</p>}
        <div className="mb-3 mt-6 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-700">Your monthly payment options</div>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">Turn on a payment scenario to show it here.</p>
        ) : (
          <div className={clsx('grid gap-3', rows.length === 2 && 'sm:grid-cols-2', rows.length >= 3 && 'sm:grid-cols-3')}>
            {rows.map(({ cfg, r }, i) => (
              <div key={i} className={clsx('rounded-xl border p-4', i === 0 ? 'border-brand-200 bg-brand-50/50' : 'border-slate-200')}>
                <div className="text-xs font-bold text-brand-700">{scenarioLabel(cfg)}</div>
                <div className="mt-1 text-2xl font-extrabold tabular-nums text-slate-900">
                  {usd(r.total)}
                  <span className="text-sm font-medium text-slate-500">/mo</span>
                </div>
                <dl className="mt-2 space-y-1 text-xs text-slate-600">
                  {(
                    [
                      ['Down payment', usd(r.downPayment)],
                      ['Principal & interest', usd(r.pi)],
                      [cfg.program === 'fha' ? 'FHA MIP' : 'Mortgage insurance', r.mi > 0 ? usd(r.mi) : '$0'],
                      ['Taxes + insurance', usd(r.tax + r.insurance)],
                      ...(r.hoa > 0 ? [['HOA', usd(r.hoa)]] : []),
                    ] as [string, string][]
                  ).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <dt>{k}</dt>
                      <dd className="font-semibold tabular-nums text-slate-800">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-2 text-[11px] text-slate-400">
                  {pct(cfg.ratePct, 3)} · {cfg.termYears}-yr fixed
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-3 bg-ink-900 px-5 py-4 text-white sm:flex-row sm:items-center sm:px-7">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 font-bold">{initials(c.name)}</div>
          <div>
            <div className="font-semibold">{c.name}</div>
            <div className="text-xs text-brand-200">
              {c.title ?? 'Loan Officer'} · NMLS# {c.nmls} · {c.company}
            </div>
          </div>
        </div>
        <div className="text-xs text-white/80 sm:ml-auto sm:text-right">
          Cell {c.cell}
          <br />
          {c.email}
        </div>
      </div>
      <p className="px-5 py-3 text-[10px] leading-relaxed text-slate-400 sm:px-7">Payments are estimates for illustration only and are not a commitment to lend. Rates, MI and taxes are examples and subject to change.</p>
      <div className="no-print flex items-center gap-1.5 border-t border-slate-100 px-5 py-2 text-[11px] text-slate-400 sm:px-7">
        <Link2 className="h-3 w-3" /> Live preview — every edit updates the flyer and the share link.
      </div>
    </Card>
  );
}
