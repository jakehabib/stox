'use client';

import { MessageSquareQuote } from 'lucide-react';
import { useState, type ReactNode } from 'react';

/**
 * LO talk track: the sentence the loan officer says to the client, built from the live
 * numbers on screen. Collapsible; hidden when printing (it's for the LO, not the client).
 */
export function TalkTrack({ children, title = 'LO talk track' }: { children: ReactNode; title?: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="no-print rounded-xl border border-brand-200 bg-brand-50/70 px-4 py-3">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left text-xs font-semibold uppercase tracking-wider text-brand-700" aria-expanded={open}>
        <MessageSquareQuote className="h-4 w-4" />
        {title}
        <span className="ml-auto text-[10px] font-medium normal-case tracking-normal text-brand-500">{open ? 'Hide' : 'Show'} · not printed</span>
      </button>
      {open && <div className="mt-2 text-sm leading-relaxed text-brand-950">{children}</div>}
    </div>
  );
}
