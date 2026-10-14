'use client';

import { Clock, Link2, Lightbulb, Sunrise } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, CardHeader, DemoBadge, EmptyState, PageHeader } from '@/components/ui';
import { getMorningUpdates } from '@/data/mock/articles';
import { clock, filterByMonth, paginate, readingMinutes } from '@/lib/calculations/markets';
import { useStore } from '@/lib/store';
import { ArchiveRow, ArticleSections, fmtDate, MonthFilter } from './content';
import { VideoPlayer } from './VideoPlayer';

const PER_PAGE = 8;

export function MorningUpdate() {
  const all = useMemo(() => getMorningUpdates(), []);
  const { toast } = useStore();
  const [selectedId, setSelectedId] = useState(all[0].id);
  const [month, setMonth] = useState('all');
  const [page, setPage] = useState(1);

  // Deep link: ?d=yyyy-mm-dd
  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get('d');
    const hit = d && all.find((u) => u.date === d);
    if (hit) setSelectedId(hit.id);
  }, [all]);

  const current = all.find((u) => u.id === selectedId) ?? all[0];
  const filtered = useMemo(() => filterByMonth(all, month), [all, month]);
  const view = paginate(filtered, page, PER_PAGE);
  const words = current.sections.flatMap((s) => s.body).join(' ') + ' ' + current.summary;

  const select = (id: string) => {
    setSelectedId(id);
    const u = all.find((x) => x.id === id);
    if (u) window.history.replaceState(null, '', `?d=${u.date}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div>
      <PageHeader
        eyebrow="Market Analysis"
        title="Morning Update"
        subtitle="The daily mortgage market briefing — watch the video, skim the article, and share the takeaway with clients before your first call."
        actions={
          <>
            <DemoBadge label="Demo content" />
            <Button
              variant="secondary"
              icon={<Link2 className="h-4 w-4" />}
              onClick={() => {
                const url = `${window.location.origin}/members/morning-update?d=${current.date}`;
                navigator.clipboard?.writeText(url).catch(() => undefined);
                toast('Link to this update copied');
              }}
            >
              Copy link
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <VideoPlayer key={current.id} title={current.title} eyebrow="Daily Mortgage Market Update" durationSec={current.durationSec} seed={Number(current.date.slice(-2))} />

          <Card className="sm:p-7">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {current.id === all[0].id && (
                <Badge tone="brand">
                  <Sunrise className="h-3 w-3" /> Today
                </Badge>
              )}
              <span>{fmtDate(current.date, 'long')}</span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> {readingMinutes(words)} min read · {clock(current.durationSec)} video
              </span>
            </div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{current.title}</h2>
            <p className="mt-3 text-[15px] leading-7 text-slate-600">{current.summary}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {current.tags.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
            <hr className="my-6 border-slate-100" />
            <ArticleSections sections={current.sections} />
            <div className="mt-7 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-emerald-800">LO takeaway</div>
                <p className="mt-0.5 text-sm text-emerald-950">{current.takeaway}</p>
              </div>
            </div>
            <p className="mt-6 text-xs text-slate-400">Synthetic commentary written for the prototype. Not investment advice.</p>
          </Card>
        </div>

        <aside className="min-w-0">
          <Card className="lg:sticky lg:top-20">
            <CardHeader title="Past Daily Updates" subtitle={`${filtered.length} update${filtered.length === 1 ? '' : 's'}`} />
            <MonthFilter
              items={all}
              value={month}
              onChange={(m) => {
                setMonth(m);
                setPage(1);
              }}
              className="mb-3 sm:w-full"
            />
            {view.items.length === 0 ? (
              <EmptyState title="No updates this month" />
            ) : (
              <div className="-mx-2 space-y-0.5">
                {view.items.map((u) => (
                  <ArchiveRow key={u.id} date={u.date} title={u.title} meta={`${fmtDate(u.date, 'short')} · ${clock(u.durationSec)} video`} active={u.id === current.id} onClick={() => select(u.id)} />
                ))}
              </div>
            )}
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
              <span>
                Showing {view.shown} of {view.total}
              </span>
              {view.hasMore && (
                <Button size="sm" variant="subtle" onClick={() => setPage(page + 1)}>
                  View more
                </Button>
              )}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
