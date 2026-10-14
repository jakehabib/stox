'use client';

import clsx from 'clsx';
import { Download, FileText, Moon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, CardHeader, DemoBadge, EmptyState, PageHeader, StatTile } from '@/components/ui';
import { getMarketWraps, wrapToMarkdown } from '@/data/mock/articles';
import { filterByMonth, paginate, readingMinutes } from '@/lib/calculations/markets';
import { useStore } from '@/lib/store';
import { ArchiveRow, ArticleSections, downloadText, fmtDate, MonthFilter } from '@/components/tools/morning-update/content';

const PER_PAGE = 10;

export function MarketWrap() {
  const all = useMemo(() => getMarketWraps(), []);
  const { toast } = useStore();
  const [selectedId, setSelectedId] = useState(all[0].id);
  const [month, setMonth] = useState('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get('d');
    const hit = d && all.find((w) => w.date === d);
    if (hit) setSelectedId(hit.id);
  }, [all]);

  const w = all.find((x) => x.id === selectedId) ?? all[0];
  const filtered = useMemo(() => filterByMonth(all, month), [all, month]);
  const view = paginate(filtered, page, PER_PAGE);
  const md = wrapToMarkdown(w);

  const download = (fmt: 'md' | 'txt') => {
    const text = fmt === 'md' ? md : md.replace(/^#+\s/gm, '').replace(/^- /gm, '• ');
    downloadText(`market-wrap-${w.date}.${fmt}`, text, fmt === 'md' ? 'text/markdown' : 'text/plain');
    toast(`Downloaded market-wrap-${w.date}.${fmt}`);
  };

  const select = (id: string) => {
    setSelectedId(id);
    const x = all.find((y) => y.id === id);
    if (x) window.history.replaceState(null, '', `?d=${x.date}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const up = w.mbsChangeBp >= 0;

  return (
    <div>
      <PageHeader
        eyebrow="Market Analysis"
        title="Market Wrap"
        subtitle="End-of-day recap of bonds, data and what’s ahead — published after the 4:00 PM ET close. Today’s wrap posts this afternoon."
        actions={
          <>
            <DemoBadge label="Demo content" />
            <Button variant="secondary" icon={<FileText className="h-4 w-4" />} onClick={() => download('txt')}>
              .txt
            </Button>
            <Button icon={<Download className="h-4 w-4" />} onClick={() => download('md')}>
              Download
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0 self-start sm:p-7">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {w.id === all[0].id && (
              <Badge tone="brand">
                <Moon className="h-3 w-3" /> Latest close
              </Badge>
            )}
            <span>{fmtDate(w.date, 'long')}</span>
            <span aria-hidden>·</span>
            <span>{readingMinutes(md)} min read</span>
          </div>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{w.title}</h2>
          <p className="mt-3 text-[15px] leading-7 text-slate-600">{w.summary}</p>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile label="UMBS 30YR 6.5% close" value={w.mbsClose.toFixed(2)} size="sm" />
            <StatTile
              label="Day change"
              value={
                <span className={clsx(up ? 'text-gain' : 'text-loss')}>
                  {up ? '▲ +' : '▼ '}
                  {w.mbsChangeBp}bp
                </span>
              }
              sub={up ? 'Better for rates' : 'Worse for rates'}
              size="sm"
            />
            <StatTile label="10-Year Treasury" value={`${w.tenYear.toFixed(3)}%`} size="sm" />
          </div>

          <hr className="my-6 border-slate-100" />
          <ArticleSections sections={w.sections} />
          <p className="mt-6 text-xs text-slate-400">Synthetic commentary written for the prototype. Not investment advice.</p>
        </Card>

        <aside className="min-w-0">
          <Card className="lg:sticky lg:top-20">
            <CardHeader title="Archive" subtitle={`${filtered.length} wrap${filtered.length === 1 ? '' : 's'}`} />
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
              <EmptyState title="No wraps this month" />
            ) : (
              <div className="-mx-2 space-y-0.5">
                {view.items.map((x) => (
                  <ArchiveRow
                    key={x.id}
                    date={x.date}
                    title={x.title}
                    meta={
                      <span className="tabular-nums">
                        MBS {x.mbsClose.toFixed(2)}{' '}
                        <span className={x.mbsChangeBp >= 0 ? 'text-gain' : 'text-loss'}>
                          {x.mbsChangeBp >= 0 ? '+' : ''}
                          {x.mbsChangeBp}bp
                        </span>
                      </span>
                    }
                    active={x.id === w.id}
                    onClick={() => select(x.id)}
                  />
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
