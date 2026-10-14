'use client';

import clsx from 'clsx';
import { Check } from 'lucide-react';

/** Wizard stepper. Completed steps are clickable to go back. */
export function Stepper({ steps, current, onStep, className }: { steps: string[]; current: number; onStep?: (i: number) => void; className?: string }) {
  return (
    <ol className={clsx('flex flex-wrap items-center gap-x-2 gap-y-2', className)}>
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!done || !onStep}
              onClick={() => onStep?.(i)}
              className={clsx(
                'flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-[11px] font-semibold uppercase tracking-wider transition-colors',
                active && 'bg-brand-600 text-white',
                done && 'bg-brand-50 text-brand-700 hover:bg-brand-100',
                !active && !done && 'bg-slate-100 text-slate-500',
              )}
              aria-current={active ? 'step' : undefined}
            >
              <span className={clsx('flex h-5 w-5 items-center justify-center rounded-full text-[10px]', active ? 'bg-white/20' : done ? 'bg-brand-600 text-white' : 'bg-white text-slate-500')}>
                {done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {s}
            </button>
            {i < steps.length - 1 && <span className="h-px w-4 bg-slate-300 sm:w-6" />}
          </li>
        );
      })}
    </ol>
  );
}
