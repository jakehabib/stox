'use client';

/**
 * Small pieces shared by the Appreciation, Equity Gained and Bid Over Ask tools
 * (same owner). Kept local so the shared component library stays untouched.
 */
import { Calculator } from 'lucide-react';
import type { ReactNode } from 'react';
import { ClientPicker } from '@/components/calc/ClientPicker';
import { Button, Card, Modal, NumberInput, cx } from '@/components/ui';

/** Centered input form card with a Calculate footer. */
export function ToolFormCard({ title, subtitle, children, onCalculate, error, calcLabel = 'Calculate' }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; onCalculate: () => void; error?: string | null; calcLabel?: string }) {
  return (
    <Card padded={false} className="mx-auto max-w-3xl">
      <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onCalculate();
        }}
      >
        <div className="space-y-5 px-5 py-5 sm:px-6">{children}</div>
        <div className="flex flex-col-reverse items-stretch gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          {error && <p className="text-sm font-medium text-red-600 sm:mr-auto">{error}</p>}
          <Button type="submit" size="lg" icon={<Calculator className="h-4 w-4" />}>
            {calcLabel}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Client edit modal used by the results header's Client chip. */
export function ClientEditModal({ open, onClose, clientId, onChange }: { open: boolean; onClose: () => void; clientId: string | null; onChange: (id: string | null) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Client" footer={<Button onClick={onClose} disabled={!clientId}>Done</Button>}>
      <ClientPicker value={clientId} onChange={onChange} error={clientId ? null : 'Client name is required'} />
    </Modal>
  );
}

/** Small inline custom-rate input shown next to the Custom option. */
export function CustomRateInput({ value, onChange, invalid }: { value: number; onChange: (v: number) => void; invalid?: boolean }) {
  return (
    <div className="w-28">
      <NumberInput ariaLabel="Custom appreciation rate" suffix="%" decimals={3} value={value} onChange={onChange} invalid={invalid} min={-20} max={25} />
    </div>
  );
}

/** Option card for an appreciation type (checkbox or radio). */
export function ModeOption({
  type,
  checked,
  disabled,
  onChange,
  title,
  rate,
  hint,
  children,
  name,
}: {
  type: 'checkbox' | 'radio';
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  title: ReactNode;
  rate?: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  name?: string;
}) {
  return (
    <div
      className={cx(
        'flex min-w-0 flex-col gap-2 rounded-xl border p-3 transition-colors',
        checked ? 'border-brand-500 bg-brand-50/70 ring-1 ring-brand-500/20' : 'border-slate-200 bg-white hover:border-slate-300',
        disabled && 'opacity-50',
      )}
      title={disabled ? 'You can compare up to 2 appreciation types' : undefined}
    >
      <label className={cx('flex items-start gap-2', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
        <input
          type={type}
          name={name}
          className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="text-sm font-semibold text-slate-900">{title}</span>
            {rate && <span className="text-sm font-semibold tabular-nums text-brand-700">{rate}</span>}
          </span>
          {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
        </span>
      </label>
      {children && <div className="pl-6">{children}</div>}
    </div>
  );
}

/** Dot + label used in result cards to tie numbers to a chart series. */
export function SeriesDot({ color }: { color: string }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />;
}
