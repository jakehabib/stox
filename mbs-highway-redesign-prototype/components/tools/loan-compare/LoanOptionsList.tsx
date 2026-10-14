'use client';

/**
 * Loan options list: Edit / Duplicate / Delete, Add, drag-to-reorder (native HTML5 drag)
 * with up/down buttons as the keyboard-accessible alternative. Shared by Loan Comparison
 * and Purchase Analysis.
 */
import { ArrowDown, ArrowUp, Copy, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button, cx } from '@/components/ui';
import { SERIES } from '@/lib/chartTheme';
import { loanAmountOf, newLoanOption, optionLabel, type LoanOption } from '@/lib/calculations/loanCompare';
import { monthlyPayment } from '@/lib/calculations/core';
import { pct, usd, usdCompact } from '@/lib/format';
import { LoanOptionModal } from './LoanOptionModal';

export const MAX_LOAN_OPTIONS = 4;

export function loanSummary(o: LoanOption, price: number) {
  return `${o.termYears}-yr ${o.loanType} ${pct(o.ratePct, 3)} · ${o.pointsPct ? `${o.pointsPct} pts` : '0 pts'} · ${usd(loanAmountOf(price, o))}`;
}

export function LoanOptionsList({
  options,
  onChange,
  price,
  compact = false,
  max = MAX_LOAN_OPTIONS,
}: {
  options: LoanOption[];
  onChange: (next: LoanOption[]) => void;
  price: number;
  compact?: boolean;
  max?: number;
}) {
  const [editing, setEditing] = useState<LoanOption | null>(null);
  const [adding, setAdding] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const full = options.length >= max;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= options.length || from === to) return;
    const next = [...options];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    onChange(next);
  };
  const duplicate = (i: number) => {
    if (full) return;
    const src = options[i];
    const copy = newLoanOption({ ...src, id: undefined, label: src.label ? `${src.label} (copy)` : undefined });
    const next = [...options];
    next.splice(i + 1, 0, copy);
    onChange(next);
  };

  return (
    <div>
      <ul className="space-y-2" aria-label="Loan options">
        {options.map((o, i) => (
          <li
            key={o.id}
            draggable
            onDragStart={(e) => {
              setDragIdx(i);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(i));
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOverIdx(i);
            }}
            onDragLeave={() => setOverIdx((x) => (x === i ? null : x))}
            onDrop={(e) => {
              e.preventDefault();
              const from = Number(e.dataTransfer.getData('text/plain'));
              if (Number.isFinite(from)) move(from, i);
              setDragIdx(null);
              setOverIdx(null);
            }}
            onDragEnd={() => {
              setDragIdx(null);
              setOverIdx(null);
            }}
            className={cx(
              'group flex items-center gap-2 rounded-lg border bg-white transition-shadow',
              compact ? 'px-2 py-2' : 'px-3 py-3',
              overIdx === i && dragIdx !== i ? 'border-brand-400 ring-2 ring-brand-500/20' : 'border-slate-200',
              dragIdx === i && 'opacity-50',
            )}
          >
            <span className="cursor-grab text-slate-300 group-hover:text-slate-500" title="Drag to reorder" aria-hidden>
              <GripVertical className="h-4 w-4" />
            </span>
            <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: SERIES[i % SERIES.length] }} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-semibold text-slate-900">{optionLabel(o, i)}</span>
                {!compact && <span className="text-xs text-slate-500">{o.program}</span>}
              </div>
              <div className="truncate text-xs text-slate-500">{compact ? `${pct(o.ratePct, 3)} · ${o.pointsPct || 0} pts · ${usdCompact(loanAmountOf(price, o))}` : loanSummary(o, price)}</div>
              {!compact && <div className="text-xs text-slate-500">P&amp;I {usd(monthlyPayment(loanAmountOf(price, o), o.ratePct, o.termYears * 12), { cents: true })}/mo · APR {pct(o.aprPct, 3)}</div>}
            </div>
            <div className={cx('flex shrink-0 items-center', compact && '-mr-1 [&>button]:p-1')}>
              <IconBtn label={`Move ${optionLabel(o, i)} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                <ArrowUp className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn label={`Move ${optionLabel(o, i)} down`} disabled={i === options.length - 1} onClick={() => move(i, i + 1)}>
                <ArrowDown className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn label={`Edit ${optionLabel(o, i)}`} onClick={() => setEditing(o)}>
                <Pencil className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn label={full ? `Maximum ${max} options` : `Duplicate ${optionLabel(o, i)}`} disabled={full} onClick={() => duplicate(i)}>
                <Copy className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn label={options.length <= 1 ? 'At least one option is required' : `Delete ${optionLabel(o, i)}`} disabled={options.length <= 1} danger onClick={() => onChange(options.filter((x) => x.id !== o.id))}>
                <Trash2 className="h-3.5 w-3.5" />
              </IconBtn>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="subtle" size="sm" icon={<Plus className="h-4 w-4" />} disabled={full} onClick={() => setAdding(true)}>
          Add loan
        </Button>
        <span className="text-xs text-slate-500">{full ? `Maximum of ${max} options` : `${options.length} of ${max} · drag or use arrows to reorder`}</span>
      </div>
      <LoanOptionModal
        open={adding || !!editing}
        initial={editing}
        price={price}
        nextLabel={editing ? optionLabel(editing, options.indexOf(editing)) : `Option ${options.length + 1}`}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        onSave={(o) => {
          if (editing) onChange(options.map((x) => (x.id === editing.id ? { ...o, id: editing.id } : x)));
          else onChange([...options, { ...o, id: newLoanOption().id }]);
        }}
      />
    </div>
  );
}

function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cx('rounded-md p-1.5 text-slate-400 transition-colors disabled:cursor-not-allowed disabled:opacity-30', danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-slate-100 hover:text-slate-700')}
    >
      {children}
    </button>
  );
}
