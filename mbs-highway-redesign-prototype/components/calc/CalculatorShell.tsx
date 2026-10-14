'use client';

import type { ReactNode } from 'react';
import { DemoBadge, PageHeader } from '@/components/ui';
import { findTool } from '@/lib/tools';

/**
 * Standard calculator page frame: header + (optional) inputs column + results.
 * Pass `inputs` for a live two-column calculator; omit it for wizard/full-width tools.
 */
export function CalculatorShell({
  toolId,
  title,
  subtitle,
  actions,
  inputs,
  children,
  demo = false,
  inputsTitle = 'Inputs',
}: {
  toolId: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  inputs?: ReactNode;
  children: ReactNode;
  demo?: boolean;
  inputsTitle?: string;
}) {
  const tool = findTool(toolId);
  return (
    <div>
      <PageHeader
        eyebrow={tool?.section}
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {title ?? tool?.name}
            {demo && <DemoBadge />}
          </span>
        }
        subtitle={subtitle ?? tool?.blurb}
        actions={actions}
      />
      {inputs ? (
        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="no-print h-fit rounded-xl border border-slate-200 bg-white p-5 shadow-card lg:sticky lg:top-[7.5rem]">
            <div className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{inputsTitle}</div>
            <div className="space-y-4">{inputs}</div>
          </aside>
          <section className="min-w-0 space-y-6">{children}</section>
        </div>
      ) : (
        <div className="space-y-6">{children}</div>
      )}
    </div>
  );
}
