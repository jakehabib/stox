'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

/** Right-side drawer (full-screen sheet on phones). Esc / backdrop click closes. */
export function Drawer({ open, onClose, title, subtitle, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
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
    <div className="fixed inset-0 z-50 !m-0 flex justify-end bg-slate-900/40 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" className="flex h-full w-full flex-col bg-white shadow-lift outline-none sm:max-w-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-slate-900">{title}</h2>
            {subtitle && <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div>}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
