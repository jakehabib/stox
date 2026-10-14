'use client';

import { ArrowLeft, Check, Copy, Download, Mail, Pencil, Printer, Save, Share2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, Modal, TextArea, TextInput, Field } from '@/components/ui';
import { downloadCsv } from '@/lib/exportCsv';
import { useStore } from '@/lib/store';
import { findTool } from '@/lib/tools';

export interface Chip {
  label: string;
  value: ReactNode;
  onEdit?: () => void;
  editLabel?: string;
}

/**
 * Common result header: Back / Print / Email / Save / Share (+ optional Export CSV)
 * and the Client / Property / Loan summary chips, each with Edit.
 */
export function ResultsHeader({
  toolId,
  scenarioTitle,
  clientId,
  chips,
  onBack,
  backLabel = 'Back',
  autoSaved,
  emailSubject,
  emailBody,
  csv,
  extraActions,
  data,
}: {
  toolId: string;
  scenarioTitle: string;
  clientId?: string | null;
  chips: Chip[];
  onBack?: () => void;
  backLabel?: string;
  autoSaved?: boolean;
  emailSubject?: string;
  emailBody?: string;
  csv?: () => (string | number)[][];
  extraActions?: ReactNode;
  data?: unknown;
}) {
  const { saveScenario, toast, getClient } = useStore();
  const [emailOpen, setEmailOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const client = getClient(clientId);
  const tool = findTool(toolId);

  const save = () => {
    saveScenario({ toolId, title: scenarioTitle, clientId: clientId ?? undefined, clientName: client?.name, href: typeof window !== 'undefined' ? window.location.pathname + window.location.search : tool?.href ?? '/', data });
    toast('Scenario saved');
  };

  return (
    <div className="no-print-border mb-6 rounded-xl border border-slate-200 bg-white shadow-card">
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        {onBack && (
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack}>
            {backLabel}
          </Button>
        )}
        {autoSaved && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
            <Check className="h-3.5 w-3.5" /> Scenario auto-saved
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-1">
          {extraActions}
          {csv && (
            <Button variant="ghost" size="sm" icon={<Download className="h-4 w-4" />} onClick={() => downloadCsv(`${toolId}-${new Date().toISOString().slice(0, 10)}.csv`, csv())}>
              Export
            </Button>
          )}
          <Button variant="ghost" size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
            Print
          </Button>
          <Button variant="ghost" size="sm" icon={<Mail className="h-4 w-4" />} onClick={() => setEmailOpen(true)}>
            Email
          </Button>
          <Button variant="ghost" size="sm" icon={<Save className="h-4 w-4" />} onClick={save}>
            Save
          </Button>
          <Button variant="secondary" size="sm" icon={<Share2 className="h-4 w-4" />} onClick={() => setShareOpen(true)}>
            Share
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap divide-x divide-slate-100">
        {chips.map((c) => (
          <div key={c.label} className="min-w-[140px] flex-1 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{c.label}</span>
              {c.onEdit && (
                <button type="button" onClick={c.onEdit} className="no-print inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                  <Pencil className="h-3 w-3" />
                  {c.editLabel ?? 'Edit'}
                </button>
              )}
            </div>
            <div className="mt-0.5 truncate text-sm font-semibold text-slate-900">{c.value}</div>
          </div>
        ))}
      </div>
      {emailOpen && <EmailModal open={emailOpen} onClose={() => setEmailOpen(false)} to={client?.primaryEmail ?? ''} subject={emailSubject ?? `${tool?.name ?? 'Your report'}${client ? ` for ${client.name}` : ''}`} body={emailBody ?? ''} />}
      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  );
}

export function EmailModal({ open, onClose, to, subject, body }: { open: boolean; onClose: () => void; to: string; subject: string; body: string }) {
  const { toast } = useStore();
  const [t, setT] = useState(to);
  const [s, setS] = useState(subject);
  const link = typeof window !== 'undefined' ? window.location.href : '';
  const [b, setB] = useState(`${body}\n\nView the full interactive report:\n${link}`);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Email report"
      description="Prototype: nothing is sent. Copy the message or open it in your mail app."
      size="lg"
      footer={
        <>
          <Button
            variant="secondary"
            icon={<Copy className="h-4 w-4" />}
            onClick={() => {
              navigator.clipboard?.writeText(`Subject: ${s}\n\n${b}`).catch(() => {});
              toast('Email copied to clipboard', 'info');
            }}
          >
            Copy
          </Button>
          <a className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700" href={`mailto:${encodeURIComponent(t)}?subject=${encodeURIComponent(s)}&body=${encodeURIComponent(b)}`} onClick={onClose}>
            Open in mail app
          </a>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="To">
          <TextInput value={t} onChange={(e) => setT(e.target.value)} placeholder="client@example.com" />
        </Field>
        <Field label="Subject">
          <TextInput value={s} onChange={(e) => setS(e.target.value)} />
        </Field>
        <Field label="Message">
          <TextArea rows={10} value={b} onChange={(e) => setB(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function ShareModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useStore();
  const link = typeof window !== 'undefined' ? window.location.href : '';
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Share this scenario"
      description="The link reopens this exact scenario — every input is encoded in the URL."
      footer={
        <Button
          icon={<Copy className="h-4 w-4" />}
          onClick={() => {
            navigator.clipboard?.writeText(link).catch(() => {});
            toast('Link copied', 'info');
            onClose();
          }}
        >
          Copy link
        </Button>
      }
    >
      <TextInput readOnly value={link} onFocus={(e) => e.target.select()} />
    </Modal>
  );
}
