'use client';

import type { ReactNode } from 'react';

/**
 * Wraps an intentionally disabled control and shows why on hover / focus (disabled buttons
 * don't fire mouse events, so the wrapper owns the tooltip). Also exposes the reason to screen readers.
 */
export function DisplayOnly({ reason = 'Display only in prototype', children, className }: { reason?: string; children: ReactNode; className?: string }) {
  return (
    <span className={`group relative inline-flex ${className ?? ''}`} tabIndex={0} aria-label={reason} title={reason}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-ink-900 px-2 py-1 text-[11px] font-medium text-white shadow-lift group-hover:block group-focus:block"
      >
        {reason}
      </span>
    </span>
  );
}
