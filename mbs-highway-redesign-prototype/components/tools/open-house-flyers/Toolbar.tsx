'use client';

import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Top action bar for the reimagined legacy tools (Open House Flyers, Seller Contribution). */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('no-print mb-6 flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-card', className)}>{children}</div>;
}

const itemCls = 'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

export function ToolbarButton({ icon, children, onClick, disabled, title, active }: { icon?: ReactNode; children: ReactNode; onClick?: () => void; disabled?: boolean; title?: string; active?: boolean }) {
  // Disabled buttons don't fire hover events, so the tooltip lives on a wrapper span.
  const btn = (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active} title={disabled ? undefined : title} className={clsx(itemCls, active && 'bg-brand-50 text-brand-700')}>
      {icon}
      {children}
    </button>
  );
  return disabled && title ? (
    <span title={title} className="inline-flex cursor-not-allowed" aria-label={`${typeof children === 'string' ? children : ''} — ${title}`}>
      {btn}
    </span>
  ) : (
    btn
  );
}

export function ToolbarLink({ icon, children, href }: { icon?: ReactNode; children: ReactNode; href: string }) {
  return (
    <Link href={href} className={itemCls}>
      {icon}
      {children}
    </Link>
  );
}

export function ToolbarDivider() {
  return <span className="mx-1 hidden h-6 w-px bg-slate-200 sm:inline-block" />;
}

export function ToolbarMenu({ icon, label, items }: { icon?: ReactNode; label: string; items: { label: string; onClick?: () => void; href?: string; icon?: ReactNode }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
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
      <button type="button" className={itemCls} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {icon}
        {label}
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 z-30 mt-1 min-w-[200px] rounded-xl border border-slate-200 bg-white p-1 shadow-lift">
          {items.map((it) =>
            it.href ? (
              <Link key={it.label} role="menuitem" href={it.href} onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                {it.icon}
                {it.label}
              </Link>
            ) : (
              <button
                key={it.label}
                role="menuitem"
                type="button"
                onClick={() => {
                  setOpen(false);
                  it.onClick?.();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                {it.icon}
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
