'use client';

/**
 * UI primitives. Every tool builds from these so the prototype reads as one product.
 * Inputs are controlled and numeric inputs emit numbers (never strings / NaN).
 */
import clsx from 'clsx';
import { ChevronDown, Info, X } from 'lucide-react';
import { forwardRef, useEffect, useId, useRef, useState, type ReactNode } from 'react';

export { clsx as cx };

/* ------------------------------------------------------------------ layout */

export function Card({ className, children, padded = true, ...rest }: React.HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return (
    <div className={clsx('rounded-xl border border-slate-200 bg-white shadow-card', padded && 'p-5', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx('mb-4 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-brand-600">{eyebrow}</div>}
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('text-[11px] font-semibold uppercase tracking-wider text-slate-500', className)}>{children}</div>;
}

/* ------------------------------------------------------------------ buttons */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type ButtonSize = 'sm' | 'md' | 'lg';

export const Button = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode }>(
  function Button({ variant = 'primary', size = 'md', icon, className, children, type = 'button', ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={clsx(
          'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
          size === 'sm' && 'h-8 px-3 text-[13px]',
          size === 'md' && 'h-9 px-4 text-sm',
          size === 'lg' && 'h-11 px-6 text-[15px]',
          variant === 'primary' && 'bg-brand-600 text-white hover:bg-brand-700',
          variant === 'secondary' && 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
          variant === 'ghost' && 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
          variant === 'subtle' && 'bg-brand-50 text-brand-700 hover:bg-brand-100',
          variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
          className,
        )}
        {...rest}
      >
        {icon}
        {children}
      </button>
    );
  },
);

/* ------------------------------------------------------------------ badges / stats */

type Tone = 'neutral' | 'brand' | 'green' | 'red' | 'amber' | 'blue';
const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  brand: 'bg-brand-50 text-brand-700',
  green: 'bg-emerald-50 text-emerald-700',
  red: 'bg-red-50 text-red-700',
  amber: 'bg-amber-50 text-amber-800',
  blue: 'bg-sky-50 text-sky-700',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', TONES[tone], className)}>{children}</span>;
}

/** Marks anything driven by mock data. Required on every view that shows demo market/real-estate data. */
export function DemoBadge({ className, label = 'Demo Data' }: { className?: string; label?: string }) {
  return (
    <span title="Synthetic data for the prototype. Plugs into a live feed via data/ adapters." className={clsx('inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800', className)}>
      {label}
    </span>
  );
}

export function Stat({ label, value, sub, tone, size = 'md', className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'gain' | 'loss' | 'brand'; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <div className={clsx('min-w-0', className)}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div
        className={clsx(
          'mt-1 font-semibold tabular-nums tracking-tight',
          size === 'sm' && 'text-lg',
          size === 'md' && 'text-2xl',
          size === 'lg' && 'text-4xl',
          tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : tone === 'brand' ? 'text-brand-700' : 'text-slate-900',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

/** Highlighted stat tile. */
export function StatTile(props: React.ComponentProps<typeof Stat> & { highlight?: boolean }) {
  const { highlight, className, ...rest } = props;
  return (
    <div className={clsx('rounded-xl border p-4', highlight ? 'border-brand-200 bg-brand-50/60' : 'border-slate-200 bg-white', className)}>
      <Stat {...rest} />
    </div>
  );
}

/* ------------------------------------------------------------------ form fields */

export function Field({ label, hint, error, children, className, htmlFor, right }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string; htmlFor?: string; right?: ReactNode }) {
  return (
    <div className={clsx('min-w-0', className)}>
      {(label || right) && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          {label && (
            <label htmlFor={htmlFor} className="text-[13px] font-medium text-slate-700">
              {label}
            </label>
          )}
          {right}
        </div>
      )}
      {children}
      {error ? <p className="mt-1 text-xs font-medium text-red-600">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

const inputBase =
  'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50 disabled:text-slate-500';

export const TextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function TextInput({ className, invalid, ...rest }, ref) {
  return <input ref={ref} className={clsx(inputBase, invalid && 'border-red-400 focus:border-red-500 focus:ring-red-500/20', className)} {...rest} />;
});

export function TextArea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(inputBase, 'h-auto min-h-[96px] py-2', className)} {...rest} />;
}

function fmtNumber(v: number, decimals: number) {
  if (!Number.isFinite(v)) return '';
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

/**
 * Numeric input. Shows thousands separators when not focused, emits a number on every keystroke.
 * Use `prefix="$"` for currency, `suffix="%"` for rates.
 */
export function NumberInput({
  value,
  onChange,
  prefix,
  suffix,
  decimals = 3,
  min,
  max,
  id,
  disabled,
  invalid,
  className,
  placeholder,
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  min?: number;
  max?: number;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(fmtNumber(value, decimals));
  useEffect(() => {
    if (!focused) setText(fmtNumber(value, decimals));
  }, [value, focused, decimals]);
  return (
    <div className={clsx('relative flex items-center', className)}>
      {prefix && <span className="pointer-events-none absolute left-3 text-sm text-slate-500">{prefix}</span>}
      <input
        id={id}
        aria-label={ariaLabel}
        inputMode="decimal"
        disabled={disabled}
        placeholder={placeholder}
        className={clsx(inputBase, 'tabular-nums', prefix && 'pl-7', suffix && 'pr-12', invalid && 'border-red-400')}
        value={focused ? text : fmtNumber(value, decimals)}
        onFocus={(e) => {
          // Keep the displayed text identical on focus so the selection survives the re-render.
          setFocused(true);
          setText(e.target.value);
          e.target.select();
        }}
        onBlur={() => {
          setFocused(false);
          let v = Number(text.replace(/[^0-9.-]/g, ''));
          if (!Number.isFinite(v)) v = 0;
          if (min !== undefined && v < min) v = min;
          if (max !== undefined && v > max) v = max;
          onChange(v);
        }}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          const v = Number(t.replace(/[^0-9.-]/g, ''));
          if (t.trim() !== '' && t !== '-' && Number.isFinite(v)) onChange(v);
        }}
      />
      {suffix && <span className="pointer-events-none absolute right-3 text-sm text-slate-500">{suffix}</span>}
    </div>
  );
}

export function Select<T extends string>({ value, onChange, options, id, className, disabled, ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] | readonly T[]; id?: string; className?: string; disabled?: boolean; ariaLabel?: string }) {
  const opts = (options as (T | { value: T; label: string })[]).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  return (
    <div className={clsx('relative', className)}>
      <select id={id} aria-label={ariaLabel} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value as T)} className={clsx(inputBase, 'appearance-none pr-9')}>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

/** Pill toggle group (Monthly / Annual, Fee / Percentage, 1D 5D 1M ...). */
export function Segmented<T extends string>({ value, onChange, options, size = 'md', className, ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] | readonly T[]; size?: 'sm' | 'md'; className?: string; ariaLabel?: string }) {
  const opts = (options as (T | { value: T; label: ReactNode })[]).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={clsx('inline-flex rounded-lg bg-slate-100 p-0.5', className)}>
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded-md font-medium transition-colors',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-[13px]',
            value === o.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean; id?: string }) {
  return (
    <label className={clsx('inline-flex items-center gap-2 text-sm text-slate-700', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-brand-600' : 'bg-slate-300')}
      >
        <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </button>
      {label}
    </label>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx('inline-flex items-center gap-2 text-sm text-slate-700', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-brand-600" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function RadioGroup<T extends string>({ value, onChange, options, name, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; hint?: ReactNode }[]; name?: string; className?: string }) {
  const auto = useId();
  return (
    <div role="radiogroup" className={clsx('flex flex-wrap gap-2', className)}>
      {options.map((o) => (
        <label
          key={o.value}
          className={clsx(
            'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
            value === o.value ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
          )}
        >
          <input type="radio" name={name ?? auto} className="accent-brand-600" checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>
            {o.label}
            {o.hint && <span className="ml-1 text-xs text-slate-500">{o.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

export function Slider({ value, onChange, min, max, step = 1, label, format, ariaLabel }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; label?: ReactNode; format?: (v: number) => ReactNode; ariaLabel?: string }) {
  const pctFill = ((value - min) / (max - min || 1)) * 100;
  return (
    <div>
      {(label || format) && (
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium text-slate-700">{label}</span>
          <span className="font-semibold tabular-nums text-brand-700">{format ? format(value) : value}</span>
        </div>
      )}
      <input
        type="range"
        aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="range-brand w-full"
        style={{ background: `linear-gradient(to right, #6a2ff2 ${pctFill}%, #e2e8f0 ${pctFill}%)` }}
      />
      <div className="mt-1 flex justify-between text-[11px] text-slate-400">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ tabs */

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" className={clsx('flex gap-1 overflow-x-auto border-b border-slate-200', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            value === t.value ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ overlays */

export function Modal({ open, onClose, title, children, footer, size = 'md', description }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; description?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 !m-0 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={clsx(
          'flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-lift outline-none sm:rounded-2xl',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-lg',
          size === 'lg' && 'sm:max-w-2xl',
          size === 'xl' && 'sm:max-w-4xl',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Accordion({ title, children, defaultOpen = false, action, count }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; action?: ReactNode; count?: number }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-200 last:border-b-0">
      <div className="flex items-center justify-between gap-2 py-3">
        <button type="button" onClick={() => setOpen(!open)} className="flex flex-1 items-center gap-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-600" aria-expanded={open}>
          <ChevronDown className={clsx('h-4 w-4 transition-transform', !open && '-rotate-90')} />
          {title}
          {count !== undefined && <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-600">{count}</span>}
        </button>
        {action}
      </div>
      {open && <div className="pb-4">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ feedback */

export function Callout({ tone = 'info', title, children, className }: { tone?: 'info' | 'warning' | 'success' | 'error'; title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        'flex gap-3 rounded-lg border px-4 py-3 text-sm',
        tone === 'info' && 'border-sky-200 bg-sky-50 text-sky-900',
        tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-900',
        tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-900',
        className,
      )}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ title, children, icon, action }: { title: ReactNode; children?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-12 text-center">
      {icon && <div className="mb-3 text-slate-400">{icon}</div>}
      <div className="font-semibold text-slate-800">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ tables */

export function DataTable({ head, rows, className, dense, footer, align }: { head: ReactNode[]; rows: ReactNode[][]; className?: string; dense?: boolean; footer?: ReactNode[]; align?: ('left' | 'right' | 'center')[] }) {
  const a = (i: number) => (align?.[i] ?? (i === 0 ? 'left' : 'right'));
  return (
    <div className={clsx('overflow-x-auto', className)}>
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-slate-200">
            {head.map((h, i) => (
              <th key={i} className={clsx('px-3 font-semibold text-slate-500', dense ? 'py-2 text-xs' : 'py-2.5 text-xs', `text-${a(i)}`)}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/60">
              {r.map((c, ci) => (
                <td key={ci} className={clsx('px-3 tabular-nums text-slate-800', dense ? 'py-1.5' : 'py-2.5', `text-${a(ci)}`, ci === 0 && 'font-medium')}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr className="border-t-2 border-slate-200 font-semibold">
              {footer.map((c, ci) => (
                <td key={ci} className={clsx('px-3 py-2.5 tabular-nums text-slate-900', `text-${a(ci)}`)}>
                  {c}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
