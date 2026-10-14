'use client';

import clsx from 'clsx';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export interface ComboOption {
  value: string;
  label: string;
  sub?: string;
  group?: string;
}

/**
 * Accessible searchable select. Type to filter, arrows + Enter to pick, Esc to close.
 * `footer` renders below the list (e.g. "+ Add new client").
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Search…',
  id,
  invalid,
  footer,
  icon,
  className,
  ariaLabel,
  filter,
  emptyText = 'No matches',
  disabled,
}: {
  value: string | null;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  id?: string;
  invalid?: boolean;
  footer?: (close: () => void, query: string) => ReactNode;
  icon?: ReactNode;
  className?: string;
  ariaLabel?: string;
  filter?: (o: ComboOption, q: string) => boolean;
  emptyText?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => (filter ? filter(o, q) : `${o.label} ${o.sub ?? ''}`.toLowerCase().includes(q)));
  }, [options, query, filter]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => setActive(0), [query]);

  const pick = (o: ComboOption) => {
    onChange(o.value);
    setOpen(false);
    setQuery('');
    input.current?.blur();
  };

  return (
    <div ref={wrap} className={clsx('relative', className)}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{icon ?? <Search className="h-4 w-4" />}</span>
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-autocomplete="list"
          disabled={disabled}
          autoComplete="off"
          className={clsx(
            'h-10 w-full rounded-lg border bg-white pl-9 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 disabled:bg-slate-50',
            invalid ? 'border-red-400 focus:ring-red-500/20' : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500/20',
          )}
          placeholder={selected ? selected.label : placeholder}
          value={open ? query : selected?.label ?? ''}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (filtered[active]) pick(filtered[active]);
            } else if (e.key === 'Escape') {
              setOpen(false);
              input.current?.blur();
            }
          }}
        />
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>
      {open && (
        <div className="absolute z-40 mt-1 w-full min-w-[240px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lift">
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">{emptyText}</li>}
            {filtered.map((o, i) => {
              const showGroup = o.group && (i === 0 || filtered[i - 1].group !== o.group);
              return (
                <li key={o.value}>
                  {showGroup && <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{o.group}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.value === value}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(o)}
                    className={clsx('flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm', i === active ? 'bg-brand-50 text-brand-900' : 'text-slate-700')}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{o.label}</span>
                      {o.sub && <span className="block truncate text-xs text-slate-500">{o.sub}</span>}
                    </span>
                    {o.value === value && <Check className="h-4 w-4 shrink-0 text-brand-600" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {footer && <div className="border-t border-slate-100">{footer(() => setOpen(false), query)}</div>}
        </div>
      )}
    </div>
  );
}
