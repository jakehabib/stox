'use client';

import clsx from 'clsx';
import { BookOpen, ChevronLeft, ChevronRight, Clock, ListOrdered } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, CardHeader, DemoBadge, EmptyState, PageHeader } from '@/components/ui';
import { MAULDIN_ISSUES, type MauldinIssue } from '@/data/mock/articles';
import { filterByMonth, readingMinutes } from '@/lib/calculations/markets';
import { ArchiveRow, fmtDate, MonthFilter } from '@/components/tools/morning-update/content';

function Toc({ issue, className }: { issue: MauldinIssue; className?: string }) {
  return (
    <nav aria-label="In this issue" className={className}>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        <ListOrdered className="h-3.5 w-3.5" /> In this issue
      </div>
      <ol className="space-y-1">
        {issue.sections.map((s, i) => (
          <li key={s.heading}>
            <a href={`#tf-sec-${i}`} className="flex gap-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 hover:text-brand-700">
              <span className="w-4 shrink-0 tabular-nums text-slate-400">{i + 1}</span>
              <span className="min-w-0">{s.heading}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Mauldin() {
  const issues = useMemo(() => filterByMonth(MAULDIN_ISSUES, 'all'), []);
  const [selectedId, setSelectedId] = useState(issues[0].id);
  const [month, setMonth] = useState('all');

  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get('d');
    const hit = d && issues.find((x) => x.date === d);
    if (hit) setSelectedId(hit.id);
  }, [issues]);

  const issue = issues.find((x) => x.id === selectedId) ?? issues[0];
  const idx = issues.indexOf(issue);
  const filtered = useMemo(() => filterByMonth(issues, month), [issues, month]);
  const words = [issue.dek, ...issue.sections.flatMap((s) => [s.heading, ...s.body])].join(' ');

  const select = (id: string) => {
    setSelectedId(id);
    const x = issues.find((y) => y.id === id);
    if (x) window.history.replaceState(null, '', `?d=${x.date}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div>
      <PageHeader
        eyebrow="Market Analysis"
        title="Mauldin: Thoughts from the Frontline"
        subtitle="Weekly long-form macroeconomic newsletter — the big-picture context behind rates, inflation and housing."
        actions={<DemoBadge label="Synthetic summaries" />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <article className="min-w-0">
          <Card className="sm:px-10 sm:py-9">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {idx === 0 && <Badge tone="brand">Latest issue</Badge>}
              <span>{fmtDate(issue.date, 'long')}</span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> {readingMinutes(words)} min read
              </span>
            </div>
            <h2 className="mt-3 font-serif text-3xl font-bold leading-tight tracking-tight text-slate-900 sm:text-[34px]">{issue.title}</h2>
            <p className="mt-3 font-serif text-lg italic leading-8 text-slate-600">{issue.dek}</p>

            <Toc issue={issue} className="mt-6 rounded-xl border border-slate-200 bg-slate-50/60 p-4 lg:hidden" />

            <div className="mt-8 space-y-9">
              {issue.sections.map((s, i) => (
                <section key={s.heading} id={`tf-sec-${i}`} className="scroll-mt-24">
                  <h3 className="flex items-baseline gap-3 text-lg font-semibold text-slate-900">
                    <span className="text-sm font-bold tabular-nums text-brand-600">{String(i + 1).padStart(2, '0')}</span>
                    {s.heading}
                  </h3>
                  <div className="mt-3 space-y-4 font-serif text-[17px] leading-8 text-slate-800">
                    {s.body.map((p, j) => (
                      <p key={j} className={clsx(i === 0 && j === 0 && 'first-letter:float-left first-letter:mr-2 first-letter:text-5xl first-letter:font-bold first-letter:leading-[0.9] first-letter:text-brand-700')}>
                        {p}
                      </p>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <p className="mt-10 border-t border-slate-100 pt-4 text-xs text-slate-400">
              Original synthetic summary written for the prototype to illustrate the reader experience. It does not reproduce the actual newsletter. Not investment advice.
            </p>

            <div className="mt-6 flex flex-wrap justify-between gap-2">
              <Button variant="secondary" icon={<ChevronLeft className="h-4 w-4" />} disabled={idx >= issues.length - 1} onClick={() => select(issues[idx + 1].id)}>
                Older issue
              </Button>
              <Button variant="secondary" disabled={idx <= 0} onClick={() => select(issues[idx - 1].id)}>
                Newer issue <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        </article>

        <aside className="min-w-0 space-y-6 lg:sticky lg:top-20 lg:self-start">
          <Card className="hidden lg:block">
            <Toc issue={issue} />
          </Card>
          <Card>
            <CardHeader title="Archive" subtitle={`${filtered.length} issue${filtered.length === 1 ? '' : 's'}`} action={<BookOpen className="h-4 w-4 text-slate-400" />} />
            <MonthFilter items={issues} value={month} onChange={setMonth} className="mb-3 sm:w-full" />
            {filtered.length === 0 ? (
              <EmptyState title="No issues this month" />
            ) : (
              <div className="-mx-2 space-y-0.5">
                {filtered.map((x) => (
                  <ArchiveRow key={x.id} date={x.date} title={x.title} meta={`${x.sections.length} sections`} active={x.id === issue.id} onClick={() => select(x.id)} />
                ))}
              </div>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
