'use client';

/** Small pieces shared by Loan Comparison, Purchase Analysis and Cost of Waiting. */
import { Building2, Plus, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ClientPicker, type SavedClientData } from '@/components/calc/ClientPicker';
import { CoBrandingBlock, CoBrandingEditor } from '@/components/calc/ReportFooter';
import { Button, Modal, TextArea, cx } from '@/components/ui';
import { DEMO_AGENTS } from '@/data/mock/cobranding';

/** Encode a scenario the same way useUrlState does, so links open a tool pre-filled. */
export function encodeScenario(state: unknown): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(state))));
}

export function ClientEditModal({
  open,
  onClose,
  value,
  onChange,
  current,
  onUseSaved,
}: {
  open: boolean;
  onClose: () => void;
  value: string | null;
  onChange: (id: string | null) => void;
  current?: Partial<SavedClientData>;
  onUseSaved?: (s: SavedClientData) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Client" description="Choose who this report is for." footer={<Button onClick={onClose}>Done</Button>}>
      <ClientPicker value={value} onChange={onChange} current={current} onUseSaved={onUseSaved} error={value ? null : 'Client name is required'} />
    </Modal>
  );
}

/** Custom message editor (shown as an LO quote at the top of the report). */
export function MessageModal({ open, onClose, value, onSave }: { open: boolean; onClose: () => void; value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Custom message"
      description="A personal note shown at the top of the client’s report."
      footer={
        <>
          {value && (
            <Button
              variant="ghost"
              onClick={() => {
                onSave('');
                onClose();
              }}
            >
              Remove
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(draft.slice(0, 600));
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <TextArea
        autoFocus
        rows={5}
        maxLength={600}
        value={draft}
        placeholder="e.g. Great meeting today! Here are the two options we discussed — Option 2 saves you about $100 a month."
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="mt-1 text-right text-xs text-slate-400">{draft.length}/600</div>
    </Modal>
  );
}

/**
 * Co-branding section: the LO's card (Edit) plus an optional partner (agent) co-brand (Add).
 */
export function CoBrandingSection({ partnerIdx, onPartnerChange, compact, hideOwn }: { partnerIdx: number | null; onPartnerChange: (i: number | null) => void; compact?: boolean; hideOwn?: boolean }) {
  const [edit, setEdit] = useState(false);
  const [picking, setPicking] = useState(false);
  const partner = partnerIdx != null ? DEMO_AGENTS[partnerIdx] : null;
  return (
    <div className="space-y-3">
      {!hideOwn && <CoBrandingBlock compact={compact} onEdit={() => setEdit(true)} />}
      {partner && !hideOwn ? (
        <div className="relative">
          <CoBrandingBlock cobranding={partner} compact={compact} />
          <button type="button" aria-label="Remove partner co-branding" onClick={() => onPartnerChange(null)} className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : partner ? (
        <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} onClick={() => onPartnerChange(null)}>
          Remove partner co-branding
        </Button>
      ) : (
        <Button variant="subtle" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setPicking(true)}>
          Add partner co-branding
        </Button>
      )}
      <CoBrandingEditor open={edit} onClose={() => setEdit(false)} />
      <Modal open={picking} onClose={() => setPicking(false)} title="Add partner co-branding" description="Demo agents — the partner appears on the report next to you.">
        <div className="space-y-2">
          {DEMO_AGENTS.map((a, i) => (
            <button
              key={a.email}
              type="button"
              onClick={() => {
                onPartnerChange(i);
                setPicking(false);
              }}
              className="flex w-full items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-left hover:border-brand-300 hover:bg-brand-50/50"
            >
              <Building2 className="h-5 w-5 text-slate-400" />
              <span>
                <span className="block text-sm font-semibold text-slate-900">{a.name}</span>
                <span className="block text-xs text-slate-500">
                  {a.title} · {a.company}
                </span>
              </span>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

/** Partner card shown on the report (above the standard footer). */
export function PartnerBlock({ partnerIdx }: { partnerIdx: number | null }) {
  if (partnerIdx == null || !DEMO_AGENTS[partnerIdx]) return null;
  return (
    <div className="mt-8">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Presented with</div>
      <CoBrandingBlock cobranding={DEMO_AGENTS[partnerIdx]} />
    </div>
  );
}

/** Step card frame used by the multi-step tools. */
export function StepCard({ title, subtitle, children, footer, className }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <div className={cx('rounded-xl border border-slate-200 bg-white shadow-card', className)}>
      <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      <div className="px-5 py-5 sm:px-6">{children}</div>
      {footer && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-3 sm:px-6">{footer}</div>}
    </div>
  );
}
