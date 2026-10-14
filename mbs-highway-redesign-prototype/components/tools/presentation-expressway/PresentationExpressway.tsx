'use client';

import clsx from 'clsx';
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, MonitorPlay, Play, Presentation as PresentationIcon, Star } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Badge, Button, Card, EmptyState, Modal, PageHeader } from '@/components/ui';
import { SearchBox } from '@/components/tools/social-studio/Controls';
import { DemoVideoPlayer, esc, initials } from '@/components/tools/social-studio/shared';
import type { CoBranding } from '@/data/mock/cobranding';
import { PRESENTATIONS, type Presentation, type Slide } from '@/data/mock/presentations';
import { filterItems, formatDuration } from '@/lib/calculations/marketingFilters';
import { downloadText } from '@/lib/exportCsv';
import { useStore } from '@/lib/store';

const GRADS = ['from-ink-900 to-brand-700', 'from-brand-800 to-sky-600', 'from-ink-800 to-emerald-700', 'from-brand-900 to-pink-600', 'from-sky-900 to-brand-600'];

/** Stand-alone HTML slide outline (one slide per printed page), co-branded. */
export function slidesHtml(p: Presentation, c: CoBranding): string {
  const slide = (s: Slide, i: number) => `<section class="slide"><div class="num">${i + 1} / ${p.slides.length}</div><h2>${esc(s.title)}</h2>${s.stat ? `<div class="stat">${esc(s.stat)}</div><div class="label">${esc(s.statLabel ?? '')}</div>` : ''}<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul><footer>${esc(c.name)} · ${esc(c.company)} · NMLS# ${esc(c.nmls)} · ${esc(c.cell)}</footer></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.title)} — slides</title><style>
body{margin:0;font-family:Inter,Segoe UI,Arial,sans-serif;background:#eef0f5;color:#111833}
.slide{position:relative;box-sizing:border-box;width:min(960px,100%);aspect-ratio:16/9;margin:24px auto;padding:56px 64px;border-radius:16px;background:linear-gradient(135deg,#111833,#4b1db0);color:#fff;page-break-after:always;overflow:hidden}
h2{font-size:40px;margin:0 0 16px}.stat{font-size:84px;font-weight:800;line-height:1}.label{opacity:.8;margin-bottom:16px}
ul{font-size:22px;line-height:1.6;padding-left:24px}.num{position:absolute;top:20px;right:28px;opacity:.6;font-size:14px}
footer{position:absolute;left:64px;bottom:24px;font-size:14px;opacity:.75}
.notes{width:min(960px,100%);margin:24px auto;background:#fff;border-radius:12px;padding:24px 32px;box-sizing:border-box}
@media print{body{background:#fff}.slide{margin:0 auto;border-radius:0}}
</style></head><body>${p.slides.map(slide).join('')}<div class="notes"><h3>Talking points</h3><ul>${p.talkingPoints.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div></body></html>`;
}

export function PresentationExpressway() {
  const { cobranding, toast } = useStore();
  const [query, setQuery] = useState('');
  const [video, setVideo] = useState<Presentation | null>(null);
  const [viewer, setViewer] = useState<Presentation | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const list = filterItems(PRESENTATIONS, { query, text: (p) => [p.title, p.topic, p.summary, ...p.keywords, ...p.talkingPoints, p.related?.label ?? ''], cats: () => [] });
  const featured = list.find((p) => p.featured);
  const rest = list.filter((p) => !p.featured);

  const download = (p: Presentation) => {
    downloadText(`${p.id}-slides.html`, slidesHtml(p, cobranding), 'text/html;charset=utf-8');
    toast('Slides downloaded (HTML — open and print to PDF)');
  };

  const actions = (p: Presentation, big = false) => (
    <div className="flex flex-wrap gap-2">
      <Button size={big ? 'md' : 'sm'} icon={<Play className="h-4 w-4" />} onClick={() => setVideo(p)}>
        Watch video
      </Button>
      <Button size={big ? 'md' : 'sm'} variant="secondary" icon={<MonitorPlay className="h-4 w-4" />} onClick={() => setViewer(p)}>
        View slides
      </Button>
      <Button size={big ? 'md' : 'sm'} variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => download(p)}>
        Download slides
      </Button>
      <Button size={big ? 'md' : 'sm'} variant="ghost" icon={expanded === p.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />} onClick={() => setExpanded(expanded === p.id ? null : p.id)} aria-expanded={expanded === p.id}>
        {expanded === p.id ? 'View less' : 'View more'}
      </Button>
    </div>
  );

  const more = (p: Presentation) =>
    expanded === p.id && (
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/70 p-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Talking points</div>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700">
          {p.talkingPoints.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
        {p.related && (
          <Link href={p.related.href} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
            Open the {p.related.label} tool <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    );

  const thumb = (p: Presentation, i: number, className?: string) => (
    <button type="button" onClick={() => setVideo(p)} aria-label={`Play ${p.title}`} className={clsx('group relative block aspect-video w-full overflow-hidden bg-gradient-to-br text-left text-white', GRADS[i % GRADS.length], className)}>
      <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 85% 15%, #fff 0, transparent 35%)' }} />
      <div className="absolute left-4 top-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">{p.topic}</div>
      <div className="absolute bottom-4 left-4 right-16 text-lg font-bold leading-tight sm:text-xl">{p.title}</div>
      <span className="absolute bottom-4 right-4 rounded bg-black/40 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">{formatDuration(p.durationSec)}</span>
      <span className="absolute inset-0 m-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-brand-700 shadow-lift transition-transform group-hover:scale-110">
        <Play className="ml-0.5 h-5 w-5" fill="currentColor" />
      </span>
    </button>
  );

  return (
    <div>
      <PageHeader eyebrow="Marketing" title="Presentation Expressway" subtitle="Proven presentations by Barry Habib. Watch the video, use the slides, and present with confidence to clients, agents and referral partners." />
      <SearchBox value={query} onChange={setQuery} placeholder="Search for topic/tool" className="mb-6 max-w-xl" />
      {list.length === 0 && (
        <EmptyState title="No presentations match" icon={<PresentationIcon className="h-8 w-8" />} action={<Button variant="secondary" onClick={() => setQuery('')}>Clear search</Button>}>
          Try “rates”, “equity”, “leverage” or a tool name like “Bid Over Ask”.
        </EmptyState>
      )}
      {featured && (
        <Card padded={false} className="mb-6 overflow-hidden">
          <div className="grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            {thumb(featured, 0, 'md:aspect-auto md:h-full md:min-h-[280px]')}
            <div className="p-5 sm:p-6">
              <Badge tone="amber">
                <Star className="h-3 w-3" fill="currentColor" /> Featured
              </Badge>
              <h2 className="mt-2 text-xl font-bold tracking-tight text-slate-900">{featured.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{featured.summary}</p>
              <p className="mt-2 text-xs text-slate-500">
                {featured.slides.length} slides · {formatDuration(featured.durationSec)} video
              </p>
              <div className="mt-4">{actions(featured, true)}</div>
              {more(featured)}
            </div>
          </div>
        </Card>
      )}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {rest.map((p, i) => (
          <Card key={p.id} padded={false} className={clsx('flex flex-col overflow-hidden', expanded === p.id && 'ring-1 ring-brand-200')}>
            {thumb(p, i + 1)}
            <div className="flex flex-1 flex-col p-4">
              <h3 className="text-[15px] font-semibold text-slate-900">{p.title}</h3>
              <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-slate-600">{p.summary}</p>
              <p className="mb-3 mt-2 text-xs text-slate-500">
                {p.slides.length} slides{p.related ? ` · Tool: ${p.related.label}` : ''}
              </p>
              <div className="mt-auto">{actions(p)}</div>
              {more(p)}
            </div>
          </Card>
        ))}
      </div>

      <Modal open={!!video} onClose={() => setVideo(null)} title={video?.title ?? ''} description={video ? `${video.topic} · ${formatDuration(video.durationSec)}` : undefined} size="xl" footer={video && <Button variant="secondary" icon={<MonitorPlay className="h-4 w-4" />} onClick={() => { const v = video; setVideo(null); setViewer(v); }}>Open slides</Button>}>
        {video && <DemoVideoPlayer key={video.id} title={video.title} subtitle="Barry Habib · Presentation Expressway" durationSec={video.durationSec} captions={video.talkingPoints} autoPlay />}
        <p className="mt-3 text-xs text-slate-500">Demo player — the prototype has no media files; captions show the presentation’s talking points.</p>
      </Modal>
      {viewer && <SlideViewer pres={viewer} cobranding={cobranding} onClose={() => setViewer(null)} onDownload={() => download(viewer)} />}
    </div>
  );
}

function SlideViewer({ pres, cobranding: c, onClose, onDownload }: { pres: Presentation; cobranding: CoBranding; onClose: () => void; onDownload: () => void }) {
  const [i, setI] = useState(0);
  const n = pres.slides.length;
  const go = useCallback((d: number) => setI((x) => Math.max(0, Math.min(n - 1, x + d))), [n]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
      else if (e.key === 'Escape') onClose();
      else if (e.key === 'Home') setI(0);
      else if (e.key === 'End') setI(n - 1);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [go, n, onClose]);
  const s = pres.slides[i];
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-ink-950 text-white" role="dialog" aria-modal="true" aria-label={`${pres.title} slides`}>
      <div className="flex items-center gap-3 px-4 py-3 text-sm">
        <span className="truncate font-semibold">{pres.title}</span>
        <span className="shrink-0 tabular-nums text-white/60">
          {i + 1} / {n}
        </span>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onDownload} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-sm hover:bg-white/20">
            <Download className="h-4 w-4" /> <span className="hidden sm:inline">Download</span>
          </button>
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-lg bg-white/10 px-3 text-sm hover:bg-white/20">
            Close
          </button>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center gap-2 px-2 pb-2 sm:gap-4 sm:px-6">
        <button type="button" aria-label="Previous slide" disabled={i === 0} onClick={() => go(-1)} className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 sm:flex">
          <ChevronLeft className="h-6 w-6" />
        </button>
        <div className="relative aspect-video w-full max-w-5xl overflow-hidden rounded-2xl bg-gradient-to-br from-ink-900 via-ink-800 to-brand-800 shadow-2xl" style={{ containerType: 'inline-size' }}>
          <div className="absolute inset-0 opacity-25" style={{ backgroundImage: 'radial-gradient(circle at 90% 10%, #9b7eff 0, transparent 40%)' }} />
          <div className="absolute inset-0 flex flex-col p-[6%]">
            <div className="text-[1.6cqw] font-semibold uppercase tracking-[0.18em] text-brand-300">{i === 0 ? pres.topic : pres.title}</div>
            <h2 className={clsx('mt-[1.5%] font-bold leading-tight', i === 0 ? 'text-[5.6cqw]' : 'text-[4cqw]')}>{s.title}</h2>
            {s.stat && (
              <div className="mt-[2%]">
                <div className="text-[8cqw] font-extrabold leading-none text-white">{s.stat}</div>
                {s.statLabel && <div className="mt-[0.8%] text-[1.9cqw] text-white/70">{s.statLabel}</div>}
              </div>
            )}
            <ul className="mt-[3%] space-y-[1%] text-[2.4cqw] leading-snug text-white/90">
              {s.bullets.map((b) => (
                <li key={b} className="flex gap-[1.5%]">
                  <span className="mt-[1.1cqw] h-[0.8cqw] w-[0.8cqw] shrink-0 rounded-full bg-brand-400" />
                  {b}
                </li>
              ))}
            </ul>
            <div className="mt-auto flex items-center gap-[1.5%] text-[1.5cqw] text-white/70">
              <span className="flex h-[3.6cqw] w-[3.6cqw] items-center justify-center rounded-full bg-white/15 text-[1.4cqw] font-bold text-white">{initials(c.name)}</span>
              {c.name} · {c.company} · NMLS# {c.nmls} · {c.cell}
            </div>
          </div>
        </div>
        <button type="button" aria-label="Next slide" disabled={i === n - 1} onClick={() => go(1)} className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 sm:flex">
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>
      <div className="flex items-center justify-center gap-3 pb-5">
        <button type="button" aria-label="Previous slide" disabled={i === 0} onClick={() => go(-1)} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 disabled:opacity-30 sm:hidden">
          <ChevronLeft className="h-5 w-5" />
        </button>
        {pres.slides.map((_, k) => (
          <button key={k} type="button" aria-label={`Slide ${k + 1}`} onClick={() => setI(k)} className={clsx('h-2 rounded-full transition-all', k === i ? 'w-6 bg-brand-400' : 'w-2 bg-white/30 hover:bg-white/50')} />
        ))}
        <button type="button" aria-label="Next slide" disabled={i === n - 1} onClick={() => go(1)} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 disabled:opacity-30 sm:hidden">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      <div className="pb-3 text-center text-[11px] text-white/40">← → to navigate · Esc to close</div>
    </div>,
    document.body,
  );
}
