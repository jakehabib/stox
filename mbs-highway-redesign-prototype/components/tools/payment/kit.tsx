'use client';

/**
 * Small pieces shared by the Payment, ARM vs Fixed, Blended Rate, Refi Risk of Waiting and
 * Reinvestment tools (same owner). Kept local so the shared component library stays untouched.
 */
import { Calculator, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, cx } from '@/components/ui';

export const INPUTS_ID = 'calc-inputs';

/** Scroll the inputs panel into view and focus its first field (used by results-header Edit chips). */
export function focusInputs(selector?: string) {
  const el = document.getElementById(INPUTS_ID);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const target = (selector ? el.querySelector<HTMLElement>(selector) : null) ?? el.querySelector<HTMLElement>('input, select, button');
  setTimeout(() => target?.focus({ preventScroll: true }), 350);
}

/**
 * Draft inputs that only take effect on Calculate / Continue. `committed` is the URL-backed scenario.
 * The draft re-syncs once the URL state hydrates (shared links).
 */
export function useDraft<T>(committed: T, hydrated: boolean): [T, (patch: Partial<T>) => void, boolean, (next: T) => void] {
  const [draft, setDraft] = useState<T>(committed);
  const synced = useRef(false);
  useEffect(() => {
    if (hydrated && !synced.current) {
      synced.current = true;
      setDraft(committed);
    }
  }, [hydrated, committed]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(committed);
  return [draft, (patch) => setDraft((d) => ({ ...d, ...patch })), dirty, setDraft];
}

/** Calculate / Continue footer for the inputs column. */
export function CalcFooter({ label = 'Calculate', onClick, dirty, error, onReset }: { label?: string; onClick: () => void; dirty: boolean; error?: string | null; onReset?: () => void }) {
  return (
    <div className="space-y-2 border-t border-slate-100 pt-4">
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      {!error && dirty && <p className="text-xs font-medium text-amber-700">Inputs changed — {label.toLowerCase()} to update the results.</p>}
      <div className="flex gap-2">
        <Button type="submit" size="lg" className="flex-1" icon={<Calculator className="h-4 w-4" />} onClick={onClick}>
          {label}
        </Button>
        {onReset && (
          <Button type="button" variant="secondary" size="lg" aria-label="Reset to example" title="Reset to the example scenario" onClick={onReset}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

/** Large headline result card. */
export function HeroResult({ eyebrow, value, sub, children, tone, className }: { eyebrow: ReactNode; value: ReactNode; sub?: ReactNode; children?: ReactNode; tone?: 'gain' | 'loss'; className?: string }) {
  return (
    <div className={cx('rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6', className)}>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{eyebrow}</div>
      <div className={cx('mt-1 text-4xl font-bold tabular-nums tracking-tight sm:text-5xl', tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-slate-900')}>{value}</div>
      {sub && <div className="mt-1 text-sm text-slate-500">{sub}</div>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}

/** Horizontal stacked share bar with a legend. */
export function ShareBar({ parts, format, height = 12 }: { parts: { label: string; value: number; color: string }[]; format: (v: number) => ReactNode; height?: number }) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  return (
    <div>
      <div className="flex w-full overflow-hidden rounded-full bg-slate-100" style={{ height }}>
        {total > 0 &&
          parts.map((p) => (
            <div key={p.label} title={`${p.label}: ${format(p.value)}`} style={{ width: `${(Math.max(0, p.value) / total) * 100}%`, background: p.color }} className="h-full border-r-2 border-white last:border-r-0" />
          ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
            {p.label}
            <span className="font-semibold tabular-nums text-slate-900">{format(p.value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Axis $ formatter that keeps one decimal for small thousands ($4.5K) so ticks never read as uneven. */
export function axisUsdFine(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1_000_000) return `${s}$${(a / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (a >= 1_000) return `${s}$${(a / 1_000).toFixed(a < 100_000 ? 1 : 0).replace(/\.0$/, '')}K`;
  return `${s}$${Math.round(a)}`;
}
