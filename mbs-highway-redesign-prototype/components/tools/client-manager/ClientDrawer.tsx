'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, FileText, Mail, Pencil, Phone, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { EmailModal } from '@/components/calc/ResultsHeader';
import { ToolIcon } from '@/components/icons';
import { Badge, Button, Field, NumberInput, SectionLabel, Select, TextInput } from '@/components/ui';
import { DisplayOnly } from '@/components/tools/strike-rate/DisplayOnly';
import { FICO_BANDS, type Client, type FicoBand } from '@/data/mock/clients';
import { date, usd } from '@/lib/format';
import { useStore } from '@/lib/store';
import { findTool } from '@/lib/tools';
import { Drawer } from './Drawer';

const schema = z.object({
  name: z.string().trim().min(1, 'Client name is required'),
  primaryEmail: z.union([z.literal(''), z.string().email('Enter a valid email')]),
  secondaryEmail: z.union([z.literal(''), z.string().email('Enter a valid email')]),
  phone: z.string(),
  fico: z.enum(FICO_BANDS as [FicoBand, ...FicoBand[]]),
  monthlyIncome: z.number().min(0),
  dti: z.number().min(0).max(100, 'DTI must be 0–100%'),
});
type FormValues = z.infer<typeof schema>;

const QUICK_ACTIONS = ['loan-compare', 'buy-vs-rent', 'purchase-analysis', 'cost-of-waiting', 'affordability', 'strike-rate'];

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

export function ClientDrawer({ client, onClose }: { client: Client | undefined; onClose: () => void }) {
  const { scenarios, updateClient, toast, cobranding } = useStore();
  const [editing, setEditing] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  useEffect(() => setEditing(false), [client?.id]);

  const { register, handleSubmit, control, formState, reset } = useForm<FormValues>({ resolver: zodResolver(schema) });
  useEffect(() => {
    if (client)
      reset({
        name: client.name,
        primaryEmail: client.primaryEmail ?? '',
        secondaryEmail: client.secondaryEmail ?? '',
        phone: client.phone ?? '',
        fico: client.fico,
        monthlyIncome: client.monthlyIncome ?? 0,
        dti: client.dti ?? 0,
      });
  }, [client, reset, editing]);

  if (!client) return null;
  const saved = scenarios.filter((s) => s.clientId === client.id);

  const save = handleSubmit((v) => {
    updateClient(client.id, {
      name: v.name.trim(),
      primaryEmail: v.primaryEmail,
      secondaryEmail: v.secondaryEmail || undefined,
      phone: v.phone.trim() || undefined,
      fico: v.fico,
      monthlyIncome: v.monthlyIncome || undefined,
      dti: v.dti || undefined,
    });
    toast(`${v.name.trim()} updated`);
    setEditing(false);
  });

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">{initials(client.name)}</span>
          <span className="truncate">{client.name}</span>
        </span>
      }
      subtitle={<span className="ml-[52px] block truncate">Updated {date(client.updatedAt)}</span>}
      footer={
        editing ? (
          <>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button onClick={save}>Save changes</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" icon={<Mail className="h-4 w-4" />} onClick={() => setEmailOpen(true)} disabled={!client.primaryEmail}>
              Email
            </Button>
            <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
              Edit client
            </Button>
          </>
        )
      }
    >
      {editing ? (
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name *" error={formState.errors.name?.message} className="sm:col-span-2" htmlFor="ec-name">
            <TextInput id="ec-name" autoFocus invalid={!!formState.errors.name} {...register('name')} />
          </Field>
          <Field label="Primary Email" error={formState.errors.primaryEmail?.message} htmlFor="ec-pe">
            <TextInput id="ec-pe" type="email" {...register('primaryEmail')} />
          </Field>
          <Field label="Secondary Email" error={formState.errors.secondaryEmail?.message} htmlFor="ec-se">
            <TextInput id="ec-se" type="email" placeholder="Optional" {...register('secondaryEmail')} />
          </Field>
          <Field label="Phone" htmlFor="ec-ph">
            <TextInput id="ec-ph" type="tel" placeholder="Optional" {...register('phone')} />
          </Field>
          <Field label="FICO">
            <Controller control={control} name="fico" render={({ field }) => <Select ariaLabel="FICO" value={field.value} onChange={field.onChange} options={FICO_BANDS} />} />
          </Field>
          <Field label="Monthly Qualifying Income">
            <Controller control={control} name="monthlyIncome" render={({ field }) => <NumberInput ariaLabel="Monthly Qualifying Income" prefix="$" decimals={0} min={0} value={field.value ?? 0} onChange={field.onChange} />} />
          </Field>
          <Field label="Debt-to-Income" error={formState.errors.dti?.message}>
            <Controller control={control} name="dti" render={({ field }) => <NumberInput ariaLabel="Debt-to-Income" suffix="%" decimals={2} min={0} value={field.value ?? 0} onChange={field.onChange} />} />
          </Field>
          <button type="submit" className="hidden" />
        </form>
      ) : (
        <div className="space-y-7">
          <section>
            <SectionLabel className="mb-3">Details</SectionLabel>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Detail label="Primary email" value={client.primaryEmail || '—'} wide />
              {client.secondaryEmail && <Detail label="Secondary email" value={client.secondaryEmail} wide />}
              <Detail label="Phone" value={client.phone ? <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5 text-slate-400" />{client.phone}</span> : '—'} />
              <Detail label="FICO" value={<Badge tone="brand">{client.fico}</Badge>} />
              <Detail label="Monthly qualifying income" value={client.monthlyIncome ? usd(client.monthlyIncome) : '—'} />
              <Detail label="Debt-to-income" value={client.dti ? `${client.dti}%` : '—'} />
            </dl>
          </section>

          <section>
            <SectionLabel className="mb-3">Activity</SectionLabel>
            <div className="grid grid-cols-3 gap-2">
              <Tile label="Updated" value={date(client.updatedAt)} />
              <Tile label="Last sent" value={client.lastSent ? date(client.lastSent) : 'Never'} />
              <Tile label="Last activity" value={client.lastActivity ? date(client.lastActivity) : 'None yet'} />
            </div>
          </section>

          <section>
            <SectionLabel className="mb-3">Saved scenarios · {saved.length}</SectionLabel>
            {saved.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 px-4 py-5 text-center text-sm text-slate-500">No saved scenarios yet. Run a tool below and click Save on the results.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {saved.map((s) => {
                  const tool = findTool(s.toolId);
                  return (
                    <li key={s.id}>
                      <Link href={s.href} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                          {tool ? <ToolIcon name={tool.icon} className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-900">{tool?.name ?? s.toolId}</span>
                          <span className="block truncate text-xs text-slate-500">
                            {s.title} · {date(s.savedAt)}
                          </span>
                        </span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <SectionLabel className="mb-3">Quick actions</SectionLabel>
            <div className="grid gap-2 sm:grid-cols-2">
              {QUICK_ACTIONS.map((id) => findTool(id))
                .filter((t): t is NonNullable<typeof t> => !!t)
                .map((t) => (
                  <Link key={t.id} href={t.href} className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-brand-300 hover:bg-brand-50/60 hover:text-brand-800">
                    <ToolIcon name={t.icon} className="h-4 w-4 text-brand-600" />
                    {t.id === 'strike-rate' ? 'Check Strike Rate' : `Run ${t.name}`}
                  </Link>
                ))}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <div className="font-medium text-slate-800">Delete client</div>
                <div className="text-xs text-slate-500">Deleting clients is out of scope for the prototype (destructive).</div>
              </div>
              <DisplayOnly reason="Not available in prototype">
                <Button variant="secondary" size="sm" disabled icon={<Trash2 className="h-4 w-4" />}>
                  Delete
                </Button>
              </DisplayOnly>
            </div>
          </section>
        </div>
      )}
      {emailOpen && (
        <EmailModal
          open
          onClose={() => setEmailOpen(false)}
          to={client.primaryEmail}
          subject={`Following up, ${client.name.split(' ')[0]}`}
          body={`Hi ${client.name.split(' ')[0]},\n\nThanks for your time — I put together a few numbers for you to review.\n\n${cobranding.name}\n${cobranding.company} · NMLS# ${cobranding.nmls}`}
        />
      )}
    </Drawer>
  );
}

function Detail({ label, value, wide }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 min-w-0' : 'min-w-0'}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mt-0.5 text-[13px] font-semibold text-slate-900">{value}</div>
    </div>
  );
}
