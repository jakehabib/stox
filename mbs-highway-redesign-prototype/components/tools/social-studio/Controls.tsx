'use client';

import clsx from 'clsx';
import { BookOpen, Check, GraduationCap, ListFilter, Search, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Modal } from '@/components/ui';
import { toggleInList } from '@/lib/calculations/marketingFilters';
import { DemoVideoPlayer } from './shared';

/** Search box with a leading icon and a clear button. */
export function SearchBox({ value, onChange, placeholder, className, ariaLabel }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string; ariaLabel?: string }) {
  return (
    <div className={clsx('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        aria-label={ariaLabel ?? placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** "Filter" button with a multi-select category popover. */
export function FilterMenu({ categories, selected, onChange, counts, label = 'Filter' }: { categories: readonly string[]; selected: string[]; onChange: (v: string[]) => void; counts?: Record<string, number>; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <Button variant="secondary" icon={<ListFilter className="h-4 w-4" />} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="true" className="h-10">
        {label}
        {selected.length > 0 && <span className="ml-0.5 rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold text-white">{selected.length}</span>}
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lift">
          <div className="max-h-80 overflow-y-auto">
            {categories.map((c) => {
              const on = selected.includes(c);
              return (
                <button key={c} type="button" role="menuitemcheckbox" aria-checked={on} onClick={() => onChange(toggleInList(selected, c))} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                  <span className={clsx('flex h-4 w-4 items-center justify-center rounded border', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300')}>{on && <Check className="h-3 w-3" />}</span>
                  <span className="flex-1">{c}</span>
                  {counts && <span className="text-xs tabular-nums text-slate-400">{counts[c] ?? 0}</span>}
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between border-t border-slate-100 px-1 pt-1.5">
            <button type="button" className="rounded px-2 py-1 text-xs font-medium text-slate-500 hover:text-slate-800" onClick={() => onChange([])}>
              Clear all
            </button>
            <button type="button" className="rounded px-2 py-1 text-xs font-semibold text-brand-700 hover:underline" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Horizontally scrolling single-tap category chips (tap again to clear). */
export function CategoryChips({ categories, selected, onChange, counts }: { categories: readonly string[]; selected: string[]; onChange: (v: string[]) => void; counts?: Record<string, number> }) {
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      <button type="button" onClick={() => onChange([])} className={clsx('shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors', selected.length === 0 ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')}>
        All
      </button>
      {categories.map((c) => {
        const on = selected.includes(c);
        return (
          <button key={c} type="button" aria-pressed={on} onClick={() => onChange(on ? selected.filter((x) => x !== c) : [c])} className={clsx('shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors', on ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')}>
            {c}
            {counts && <span className="ml-1 font-normal text-slate-400">{counts[c] ?? 0}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Tutorial (video + steps) and Guide (written best practices) buttons + modals. */
export function HelpButtons({ tool, steps, guide, durationSec = 96 }: { tool: string; steps: string[]; guide: { title: string; body: ReactNode }[]; durationSec?: number }) {
  const [which, setWhich] = useState<'tutorial' | 'guide' | null>(null);
  return (
    <>
      <Button variant="secondary" icon={<GraduationCap className="h-4 w-4" />} onClick={() => setWhich('tutorial')}>
        Tutorial
      </Button>
      <Button variant="secondary" icon={<BookOpen className="h-4 w-4" />} onClick={() => setWhich('guide')}>
        Guide
      </Button>
      <Modal open={which === 'tutorial'} onClose={() => setWhich(null)} title={`${tool} tutorial`} description="A two-minute walkthrough of the tool." size="lg">
        <DemoVideoPlayer title={`Getting started with ${tool}`} subtitle="Tutorial" durationSec={durationSec} captions={steps} />
        <ol className="mt-4 space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm text-slate-700">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{i + 1}</span>
              <span className="pt-0.5">{s}</span>
            </li>
          ))}
        </ol>
      </Modal>
      <Modal open={which === 'guide'} onClose={() => setWhich(null)} title={`${tool} guide`} description="Best practices from top-producing loan officers." size="lg">
        <div className="space-y-4">
          {guide.map((g) => (
            <section key={g.title}>
              <h3 className="text-sm font-semibold text-slate-900">{g.title}</h3>
              <div className="mt-1 text-sm leading-relaxed text-slate-600">{g.body}</div>
            </section>
          ))}
        </div>
      </Modal>
    </>
  );
}
