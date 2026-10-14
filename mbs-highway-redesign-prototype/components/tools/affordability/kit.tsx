'use client';

/**
 * Small presentational pieces shared by the Affordability, Buying Power, Debt Consolidation
 * and Investment Property tools (local to these tools — not part of the shared UI kit).
 */
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui';

/** Scroll the inputs panel into view and focus a field (chips' "Edit" on live calculators). */
export function focusField(selector?: string) {
  if (typeof document === 'undefined') return;
  const el = (selector ? document.querySelector<HTMLElement>(selector) : null) ?? document.querySelector<HTMLElement>('aside input, aside select, aside button');
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => el?.focus(), 250);
}

export function HeroCard({ eyebrow, value, sub, badge, children, className }: { eyebrow: ReactNode; value: ReactNode; sub?: ReactNode; badge?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={clsx('relative overflow-hidden rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 via-white to-white p-5 shadow-card sm:p-6', className)}>
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-700">
        {eyebrow}
        {badge}
      </div>
      <div className="mt-2 text-4xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-5xl">{value}</div>
      {sub && <div className="mt-1.5 text-sm text-slate-600">{sub}</div>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}

/** Horizontal share bar with a legend (payment breakdowns). Segments separated by 2px gaps. */
export function ShareBar({ parts, format }: { parts: { label: string; value: number; color: string }[]; format: (v: number) => string }) {
  const shown = parts.filter((p) => p.value > 0.005);
  const total = shown.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-slate-100">
        {shown.map((p) => (
          <div key={p.label} title={`${p.label}: ${format(p.value)}`} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} className="h-full first:rounded-l-full last:rounded-r-full" />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        {parts.filter((p) => p.value > 0.005 || parts.length <= 2).map((p) => (
          <div key={p.label} className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="whitespace-nowrap">{p.label}</span>
            </div>
            <div className="text-sm font-semibold tabular-nums text-slate-900">{format(p.value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Label / value rows used in breakdown cards. */
export function Row({ label, value, sub, strong, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; strong?: boolean; tone?: 'gain' | 'loss' }) {
  return (
    <div className={clsx('flex items-baseline justify-between gap-3 py-2', strong ? 'border-t border-slate-200 pt-3 font-semibold text-slate-900' : 'text-slate-700')}>
      <span className="min-w-0 text-sm">
        {label}
        {sub && <span className="ml-1.5 text-xs font-normal text-slate-500">{sub}</span>}
      </span>
      <span className={clsx('shrink-0 text-sm tabular-nums', tone === 'gain' && 'text-gain', tone === 'loss' && 'text-loss')}>{value}</span>
    </div>
  );
}

export function InferredBadge({ children = 'Inferred — Step 2+ not fully observed in the live session' }: { children?: ReactNode }) {
  return (
    <span title="The live session only reached Step 1. These steps use standard rental-analysis definitions." className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
      {children}
    </span>
  );
}

export function BuiltToSpecBadge() {
  return (
    <span title="The live session never reached results — no live numbers to verify against." className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
      Built to spec — results not observed live
    </span>
  );
}

export function ToneBadge({ tone, children }: { tone: 'green' | 'amber' | 'red'; children: ReactNode }) {
  return <Badge tone={tone}>{children}</Badge>;
}
