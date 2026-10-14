import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { ToolIcon } from '@/components/icons';
import { Badge, PageHeader } from '@/components/ui';
import { toolsIn, type Section, type ToolStatus } from '@/lib/tools';

const STATUS_LABEL: Partial<Record<ToolStatus, { label: string; tone: 'amber' | 'blue' | 'neutral' }>> = {
  reimagined: { label: 'Reimagined', tone: 'blue' },
  inferred: { label: 'Partly inferred', tone: 'amber' },
  'display-only': { label: 'Display only', tone: 'neutral' },
};

/** Grid of tool cards for a sidebar section. */
export function SectionHub({ section, subtitle }: { section: Section; subtitle?: string }) {
  const tools = toolsIn(section);
  return (
    <div>
      <PageHeader title={section} subtitle={subtitle} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tools.map((t) => {
          const st = STATUS_LABEL[t.status];
          return (
            <Link key={t.id} href={t.href} className="group flex gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-card transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lift">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 group-hover:bg-brand-600 group-hover:text-white">
                <ToolIcon name={t.icon} className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-semibold text-slate-900">
                  {t.name}
                  <ArrowUpRight className="h-4 w-4 text-slate-300 group-hover:text-brand-600" />
                </span>
                <span className="mt-0.5 block text-sm text-slate-500">{t.blurb}</span>
                {st && (
                  <Badge tone={st.tone} className="mt-2">
                    {st.label}
                  </Badge>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
