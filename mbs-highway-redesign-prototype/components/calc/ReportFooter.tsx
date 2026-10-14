'use client';

import { Mail, MapPin, Phone, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { Button, Field, Modal, TextInput } from '@/components/ui';
import type { CoBranding } from '@/data/mock/cobranding';
import { date } from '@/lib/format';
import { useStore } from '@/lib/store';

export const STANDARD_DISCLAIMER =
  'This report is for illustrative purposes only and is not a commitment to lend or an offer of credit. Rates, payments, values and projections are estimates based on the information provided and on demo market data, and are subject to change. Actual loan terms depend on credit, property, program guidelines and market conditions at the time of lock. Appreciation forecasts are not guaranteed. Consult a tax advisor regarding deductibility of mortgage interest and property taxes.';

/** LO co-branding card. */
export function CoBrandingBlock({ cobranding, onEdit, compact }: { cobranding?: CoBranding; onEdit?: () => void; compact?: boolean }) {
  const { cobranding: mine } = useStore();
  const c = cobranding ?? mine;
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-gradient-to-br from-white to-brand-50/40 p-4 sm:flex-row sm:items-center">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-800 text-base font-bold text-white">
          {c.name
            .split(' ')
            .map((p) => p[0])
            .join('')
            .slice(0, 2)}
        </div>
        <div>
          <div className="font-semibold text-slate-900">{c.name}</div>
          <div className="text-xs text-slate-500">
            {c.title ? `${c.title} · ` : ''}NMLS# {c.nmls} · {c.company}
          </div>
        </div>
      </div>
      {!compact && (
        <div className="grid flex-1 gap-x-6 gap-y-1 text-xs text-slate-600 sm:grid-cols-2">
          <span className="inline-flex items-center gap-1.5"><Smartphone className="h-3.5 w-3.5 text-slate-400" />Cell {c.cell}</span>
          <span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-slate-400" />Direct {c.direct}</span>
          <span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-slate-400" />{c.email}</span>
          <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-slate-400" />{c.address}</span>
        </div>
      )}
      {onEdit && (
        <Button variant="secondary" size="sm" className="no-print" onClick={onEdit}>
          Edit
        </Button>
      )}
    </div>
  );
}

export function CoBrandingEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { cobranding, setCobranding, toast } = useStore();
  const [draft, setDraft] = useState<CoBranding>(cobranding);
  const f = (k: keyof CoBranding, label: string) => (
    <Field label={label}>
      <TextInput value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
    </Field>
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Co-branding"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              setCobranding(draft);
              toast('Co-branding saved');
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {f('name', 'Name')}
        {f('title', 'Title')}
        {f('nmls', 'NMLS#')}
        {f('company', 'Company')}
        {f('cell', 'Cell')}
        {f('direct', 'Direct')}
        {f('email', 'Email')}
        {f('address', 'Address')}
      </div>
    </Modal>
  );
}

/** Co-branding + "Current as of" + standard disclaimer. Goes at the bottom of every report. */
export function ReportFooter({ editable = true, note }: { editable?: boolean; note?: string }) {
  const [edit, setEdit] = useState(false);
  return (
    <div className="mt-8 space-y-3">
      <CoBrandingBlock onEdit={editable ? () => setEdit(true) : undefined} />
      <p className="text-xs leading-relaxed text-slate-500">
        <span className="font-medium text-slate-600">Current as of {date(new Date(), 'long')}. Disclaimer goes here.</span> {note ? `${note} ` : ''}
        {STANDARD_DISCLAIMER}
      </p>
      {editable && <CoBrandingEditor open={edit} onClose={() => setEdit(false)} />}
    </div>
  );
}
