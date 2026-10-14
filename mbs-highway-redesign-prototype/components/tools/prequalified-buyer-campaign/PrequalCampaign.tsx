'use client';

import clsx from 'clsx';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarClock, Check, ExternalLink, GripVertical, Mail, Rocket, Sparkles, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ClientPicker, requireClient } from '@/components/calc/ClientPicker';
import { LocationPicker } from '@/components/calc/LocationPicker';
import { Stepper } from '@/components/calc/Stepper';
import { Badge, Button, Callout, Card, CardHeader, EmptyState, Field, Modal, NumberInput, PageHeader, Select, Stat, TextInput } from '@/components/ui';
import { Toggle, useLocalList } from '@/components/tools/social-studio/shared';
import { CADENCE_OPTIONS, CAMPAIGN_REPORTS, DEFAULT_REPORT_IDS } from '@/data/mock/prequalCampaign';
import { getLocation } from '@/data/mock/locations';
import { flyerScenario } from '@/lib/calculations/flyer';
import { MAX_REPORTS, campaignSchedule, fillTemplate, moveItem, shortDate, toggleReport } from '@/lib/calculations/marketingFilters';
import { date, pct, usd } from '@/lib/format';
import { useStore } from '@/lib/store';

const STEPS = ['Report Selection', 'Scenario Specifics', 'Campaign Settings'];
const report = (id: string) => CAMPAIGN_REPORTS.find((r) => r.id === id)!;

interface SavedCampaign {
  id: string;
  clientId: string;
  clientName: string;
  location: string;
  price: number;
  reports: string[];
  sends: { date: string; reportId: string; subject: string }[];
  cadenceDays: number;
  createdAt: string;
}

export function PrequalCampaign() {
  const { getClient, toast } = useStore();
  const [welcome, setWelcome] = useState(false);
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<string[]>(DEFAULT_REPORT_IDS);
  const [selError, setSelError] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>('c-alex-rivera');
  const [clientError, setClientError] = useState<string | null>(null);
  const [locationId, setLocationId] = useState('dallas-tx-75201');
  const [price, setPrice] = useState(500000);
  const [downPct, setDownPct] = useState(20);
  const [ratePct, setRatePct] = useState(6.5);
  const [termYears, setTermYears] = useState(30);
  const [cadence, setCadence] = useState(3);
  const [start, setStart] = useState('2026-10-15');
  const [sendTime, setSendTime] = useState('09:00');
  const [skipWeekends, setSkipWeekends] = useState(false);
  const [subjects, setSubjects] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [viewing, setViewing] = useState<SavedCampaign | null>(null);
  const [campaigns, setCampaigns] = useLocalList<SavedCampaign>('mbsh-prequal-campaigns-v1');
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem('mbsh-prequal-welcome-seen')) setWelcome(true);
    } catch {
      setWelcome(true);
    }
  }, []);
  const closeWelcome = () => {
    setWelcome(false);
    try {
      window.localStorage.setItem('mbsh-prequal-welcome-seen', '1');
    } catch {
      /* ignore */
    }
  };

  const client = getClient(clientId);
  const loc = getLocation(locationId);
  const vars = { first: client?.name.split(' ')[0] ?? 'there', city: loc.city };
  const subjectOf = (id: string) => subjects[id] ?? report(id).subject;
  const scen = flyerScenario({ price, downPct, program: 'conventional', ratePct, termYears, taxAnnual: 0, insuranceMonthly: 0, hoaMonthly: 0, fico: '720–739' });
  const schedule = useMemo(() => campaignSchedule(start, cadence, selected.length, skipWeekends), [start, cadence, selected.length, skipWeekends]);

  const toggle = (id: string) => {
    const r = toggleReport(selected, id);
    setSelected(r.selected);
    setSelError(r.error);
  };
  const move = (from: number, to: number) => setSelected((s) => moveItem(s, from, to));

  const next = () => {
    if (step === 0 && selected.length === 0) {
      setSelError('Select at least one report.');
      return;
    }
    if (step === 1) {
      const e = requireClient(clientId);
      setClientError(e);
      if (e) return;
    }
    setStep(step + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const launch = () => {
    const c: SavedCampaign = {
      id: `camp-${Date.now()}`,
      clientId: clientId!,
      clientName: client?.name ?? 'Client',
      location: loc.label,
      price,
      reports: selected,
      cadenceDays: cadence,
      sends: schedule.map((s, i) => ({ date: s.date, reportId: selected[i], subject: fillTemplate(subjectOf(selected[i]), vars) })),
      createdAt: new Date().toISOString(),
    };
    setCampaigns((l) => [c, ...l]);
    setConfirm(false);
    toast('Campaign saved — Prototype — nothing was sent');
    setStep(0);
    setTimeout(() => document.getElementById('your-campaigns')?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Marketing"
        title="Prequalified Buyer Campaign"
        subtitle="Build a personalized report kit for a prequalified buyer and drip it by email on a schedule."
        actions={
          <Button variant="secondary" icon={<Sparkles className="h-4 w-4" />} onClick={() => setWelcome(true)}>
            Customize your kit
          </Button>
        }
      />
      <Card className="mb-6">
        <Stepper steps={STEPS} current={step} onStep={setStep} />
      </Card>

      {step === 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Your report kit"
              subtitle="Drag to reorder — reports are sent in this order."
              action={
                <Badge tone={selected.length === MAX_REPORTS ? 'brand' : 'neutral'}>
                  {selected.length}/{MAX_REPORTS} selected
                </Badge>
              }
            />
            {selected.length === 0 ? (
              <EmptyState title="No reports selected">Choose up to 9 reports from the list.</EmptyState>
            ) : (
              <ol className="space-y-2">
                {selected.map((id, i) => (
                  <li
                    key={id}
                    draggable
                    onDragStart={(e) => {
                      setDragFrom(i);
                      dragRef.current = i;
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(i));
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(i);
                    }}
                    onDragLeave={() => setDragOver((o) => (o === i ? null : o))}
                    onDrop={(e) => {
                      e.preventDefault();
                      const raw = e.dataTransfer.getData('text/plain');
                      const from = dragRef.current ?? (raw === '' ? NaN : Number(raw));
                      if (Number.isFinite(from)) move(from, i);
                      dragRef.current = null;
                      setDragFrom(null);
                      setDragOver(null);
                    }}
                    onDragEnd={() => {
                      dragRef.current = null;
                      setDragFrom(null);
                      setDragOver(null);
                    }}
                    className={clsx(
                      'flex items-center gap-2 rounded-lg border bg-white px-2 py-2 transition-colors',
                      dragOver === i && dragFrom !== i ? 'border-brand-400 bg-brand-50' : 'border-slate-200',
                      dragFrom === i && 'opacity-50',
                    )}
                  >
                    <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-slate-400" aria-hidden />
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900">{report(id).name}</div>
                      <div className="truncate text-xs text-slate-500">{report(id).description}</div>
                    </div>
                    <button type="button" aria-label={`Move ${report(id).name} up`} disabled={i === 0} onClick={() => move(i, i - 1)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30">
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label={`Move ${report(id).name} down`} disabled={i === selected.length - 1} onClick={() => move(i, i + 1)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30">
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label={`Remove ${report(id).name}`} onClick={() => toggle(id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600">
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <Card>
            <CardHeader title="Available reports" subtitle={`Select up to ${MAX_REPORTS}.`} action={selected.length > 0 && <Button size="sm" variant="ghost" onClick={() => { setSelected([]); setSelError(null); }}>Clear all</Button>} />
            {selError && <Callout tone="warning" className="mb-3">{selError}</Callout>}
            <ul className="divide-y divide-slate-100">
              {CAMPAIGN_REPORTS.map((r) => {
                const on = selected.includes(r.id);
                const full = !on && selected.length >= MAX_REPORTS;
                return (
                  <li key={r.id}>
                    <label title={full ? `Maximum of ${MAX_REPORTS} reports — deselect one first` : undefined} className={clsx('flex items-start gap-3 py-2.5', full ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')}>
                      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={on} disabled={full} onChange={() => toggle(r.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate-900">{r.name}</span>
                        <span className="block text-xs text-slate-500">{r.description}</span>
                      </span>
                      {on && <span className="text-xs font-semibold tabular-nums text-brand-700">#{selected.indexOf(r.id) + 1}</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      )}

      {step === 1 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card>
            <CardHeader title="Scenario specifics" subtitle="Every report in the kit is personalized with these numbers." />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <ClientPicker
                  value={clientId}
                  onChange={(id) => {
                    setClientId(id);
                    if (id) setClientError(null);
                  }}
                  error={clientError}
                />
              </div>
              <div className="sm:col-span-2">
                <LocationPicker value={locationId} onChange={setLocationId} />
              </div>
              <Field label="Purchase price">
                <NumberInput value={price} onChange={setPrice} prefix="$" min={0} ariaLabel="Purchase price" />
              </Field>
              <Field label="Down payment" hint={usd(scen.downPayment)}>
                <NumberInput value={downPct} onChange={setDownPct} suffix="%" min={0} max={100} ariaLabel="Down payment percent" />
              </Field>
              <Field label="Interest rate">
                <NumberInput value={ratePct} onChange={setRatePct} suffix="%" min={0} max={30} ariaLabel="Interest rate" />
              </Field>
              <Field label="Term">
                <Select value={String(termYears)} onChange={(v) => setTermYears(Number(v))} options={[{ value: '30', label: '30 years' }, { value: '20', label: '20 years' }, { value: '15', label: '15 years' }]} ariaLabel="Term" />
              </Field>
            </div>
          </Card>
          <Card className="h-fit bg-gradient-to-br from-white to-brand-50/50">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Scenario summary</div>
            <div className="mt-3 space-y-4">
              <Stat label="Loan amount" value={usd(scen.loan)} sub={`${pct(100 - downPct, 2)} LTV · ${usd(scen.downPayment)} down`} />
              <Stat label="Principal & interest" value={usd(scen.pi, { cents: true })} sub={`${pct(ratePct, 3)} · ${termYears}-yr fixed`} size="lg" tone="brand" />
              {scen.mi > 0 && <Stat size="sm" label="Est. mortgage insurance" value={`${usd(scen.mi)}/mo`} />}
              <div className="text-xs text-slate-500">
                For {client?.name ?? '—'} · {loc.label}
              </div>
            </div>
          </Card>
        </div>
      )}

      {step === 2 && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-6">
            <Card>
              <CardHeader title="Campaign settings" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Cadence">
                  <Select value={String(cadence)} onChange={(v) => setCadence(Number(v))} options={CADENCE_OPTIONS.map((d) => ({ value: String(d), label: d === 1 ? 'Every day' : d === 7 ? 'Every week' : `Every ${d} days` }))} ariaLabel="Cadence" />
                </Field>
                <Field label="Start date">
                  <TextInput type="date" value={start} onChange={(e) => setStart(e.target.value || '2026-10-15')} aria-label="Start date" />
                </Field>
                <Field label="Send time">
                  <TextInput type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value || '09:00')} aria-label="Send time" />
                </Field>
                <Field label="Channel" hint="Email is the only channel in this kit.">
                  <Select value="email" onChange={() => {}} options={[{ value: 'email', label: 'Email' }]} ariaLabel="Channel" />
                </Field>
                <div className="sm:col-span-2">
                  <Toggle checked={skipWeekends} onChange={setSkipWeekends} label="Skip weekends (move to Monday)" />
                </div>
              </div>
            </Card>
            <Card>
              <CardHeader title="Subject lines" subtitle="One email per report. {first} and {city} are filled in automatically." />
              <div className="space-y-3">
                {selected.map((id, i) => (
                  <Field key={id} label={`${i + 1}. ${report(id).name}`} hint={`Preview: ${fillTemplate(subjectOf(id), vars)}`}>
                    <TextInput value={subjectOf(id)} onChange={(e) => setSubjects({ ...subjects, [id]: e.target.value })} />
                  </Field>
                ))}
              </div>
            </Card>
          </div>
          <Card className="h-fit xl:sticky xl:top-[7.5rem]">
            <CardHeader
              title="Email sequence preview"
              subtitle={`${selected.length} emails to ${client?.primaryEmail || client?.name || '—'} · ${schedule.length ? `${shortDate(schedule[0].date)} → ${shortDate(schedule[schedule.length - 1].date)}` : ''}`}
            />
            <Timeline sends={schedule.map((s, i) => ({ date: s.date, day: s.day, reportId: selected[i], subject: fillTemplate(subjectOf(selected[i]), vars) }))} time={sendTime} />
          </Card>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} disabled={step === 0} onClick={() => setStep(step - 1)}>
          Back
        </Button>
        {step < 2 ? (
          <Button size="lg" onClick={next}>
            Next <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button size="lg" icon={<Rocket className="h-4 w-4" />} onClick={() => setConfirm(true)}>
            Launch campaign
          </Button>
        )}
      </div>

      <section id="your-campaigns" className="mt-10">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Your campaigns</h2>
        {campaigns.length === 0 ? (
          <EmptyState title="No campaigns yet" icon={<Mail className="h-8 w-8" />}>
            Launch a campaign above — it’s saved here (in this browser). Prototype: no emails are ever scheduled or sent.
          </EmptyState>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {campaigns.map((c) => (
              <Card key={c.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-900">{c.clientName}</div>
                    <div className="truncate text-xs text-slate-500">
                      {usd(c.price)} · {c.location}
                    </div>
                  </div>
                  <Badge tone="amber">Prototype · not sent</Badge>
                </div>
                <div className="mt-3 text-sm text-slate-600">
                  {c.sends.length} emails · every {c.cadenceDays} day{c.cadenceDays > 1 ? 's' : ''} · {shortDate(c.sends[0]?.date ?? '')} → {shortDate(c.sends[c.sends.length - 1]?.date ?? '')}
                </div>
                <div className="mt-1 text-xs text-slate-400">Saved {date(c.createdAt)}</div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="secondary" icon={<CalendarClock className="h-4 w-4" />} onClick={() => setViewing(c)}>
                    View sequence
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setCampaigns((l) => l.filter((x) => x.id !== c.id))}>
                    Delete
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Modal
        open={welcome}
        onClose={closeWelcome}
        title="Customize your kit"
        description="Welcome to the Prequalified Buyer Campaign."
        footer={<Button onClick={closeWelcome}>Get started</Button>}
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>Turn a prequalification into a steady, helpful conversation. In three steps:</p>
          {[
            ['Report selection', 'Pick up to 9 reports and drag them into the order you want them sent. A proven 9-report kit is selected for you.'],
            ['Scenario specifics', 'Choose the client and their price, down payment, rate and location — every report is personalized.'],
            ['Campaign settings', 'Set the cadence, start date and subject lines, then preview the full email timeline.'],
          ].map(([t, d], i) => (
            <div key={t} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{i + 1}</span>
              <div>
                <div className="font-semibold text-slate-900">{t}</div>
                {d}
              </div>
            </div>
          ))}
          <Callout tone="info">Prototype — campaigns are saved locally; no emails are scheduled or sent.</Callout>
        </div>
      </Modal>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Launch campaign?"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button icon={<Check className="h-4 w-4" />} onClick={launch}>
              Save campaign
            </Button>
          </>
        }
      >
        <Callout tone="warning" title="Prototype — no emails are scheduled or sent">
          Confirming saves this campaign to the list on this page so you can demo the flow.
        </Callout>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Client</dt>
            <dd className="font-semibold text-slate-900">{client?.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Scenario</dt>
            <dd className="font-semibold text-slate-900">
              {usd(price)} · {pct(downPct, 2)} down · {pct(ratePct, 3)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Emails</dt>
            <dd className="font-semibold text-slate-900">
              {selected.length} · every {cadence} day{cadence > 1 ? 's' : ''}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Window</dt>
            <dd className="font-semibold text-slate-900">
              {shortDate(schedule[0]?.date ?? start)} → {shortDate(schedule[schedule.length - 1]?.date ?? start)}
            </dd>
          </div>
        </dl>
      </Modal>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={`Sequence for ${viewing?.clientName ?? ''}`} description="Prototype — nothing was sent" size="lg">
        {viewing && <Timeline sends={viewing.sends.map((s, i) => ({ ...s, day: i * viewing.cadenceDays + 1 }))} />}
      </Modal>
    </div>
  );
}

function Timeline({ sends, time }: { sends: { date: string; day: number; reportId: string; subject: string }[]; time?: string }) {
  return (
    <ol className="relative ml-3 border-l border-slate-200">
      {sends.map((s, i) => {
        const r = report(s.reportId);
        return (
          <li key={`${s.reportId}-${i}`} className="relative mb-4 pl-6 last:mb-0">
            <span className="absolute -left-[11px] top-0.5 flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-white bg-brand-600 text-[10px] font-bold text-white">{i + 1}</span>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Day {s.day} · {shortDate(s.date)}
              {time ? ` · ${time}` : ''}
            </div>
            <div className="mt-0.5 text-sm font-semibold text-slate-900">{s.subject}</div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
              <Mail className="h-3.5 w-3.5" /> {r?.name}
              {r?.toolHref && (
                <Link href={r.toolHref} className="inline-flex items-center gap-0.5 text-brand-700 hover:underline">
                  open report <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
