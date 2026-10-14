'use client';

import clsx from 'clsx';
import { Bookmark, Copy, Download, Globe, Heart, ImageIcon, MessageCircle, MoreHorizontal, Repeat2, Send, Share2, ThumbsUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Callout, Card, DemoBadge, EmptyState, Modal, PageHeader, Tabs } from '@/components/ui';
import { CategoryChips, FilterMenu, HelpButtons, SearchBox } from '@/components/tools/social-studio/Controls';
import { NOTHING_SENT, copyText, initials, svgDataUrl } from '@/components/tools/social-studio/shared';
import type { CoBranding } from '@/data/mock/cobranding';
import { SHARE_CARDS, SHARE_CATEGORIES, type ShareCard } from '@/data/mock/socialShare';
import { countByCategory, filterItems, fitToLimit } from '@/lib/calculations/marketingFilters';
import { downloadText } from '@/lib/exportCsv';
import { date } from '@/lib/format';
import { useStore } from '@/lib/store';
import { shareCardSvg } from './cardSvg';

type Platform = 'linkedin' | 'facebook' | 'instagram' | 'x';

const fullCaption = (c: ShareCard) => `${c.caption}\n\n${c.hashtags.map((h) => `#${h}`).join(' ')}`;

const STEPS = [
  'Search by keyword or tap a category chip to browse ready-made graphics.',
  'Every graphic is branded with your name, NMLS# and phone automatically.',
  'Copy the caption, download the graphic, and post it from your own account.',
  'Use Share preview to see how the post will look on LinkedIn, Facebook, Instagram and X.',
];
const GUIDE = [
  { title: 'Post consistently', body: 'Three posts a week beats ten in one day. Pick a rhythm — e.g. market update Monday, tip Wednesday, homeownership Friday.' },
  { title: 'Make the caption yours', body: 'Add one sentence about a real client conversation (no personal details) — personal context lifts engagement.' },
  { title: 'Match the platform', body: 'LinkedIn rewards insight, Instagram rewards visuals, X rewards brevity, Facebook rewards community. The preview shows how each one crops.' },
  { title: 'Stay compliant', body: 'Keep your NMLS# visible (it’s on every graphic) and avoid promising specific rates or approvals in captions.' },
];

export function SocialShare() {
  const { cobranding, toast } = useStore();
  const [query, setQuery] = useState('');
  const [cats, setCats] = useState<string[]>([]);
  const [sharing, setSharing] = useState<ShareCard | null>(null);
  const counts = useMemo(() => countByCategory(SHARE_CARDS, (c) => [c.category]), []);
  const list = filterItems(SHARE_CARDS, { query, categories: cats, text: (c) => [c.headline, c.caption, c.stat, c.statLabel, c.category, ...c.hashtags], cats: (c) => [c.category] });

  const download = (c: ShareCard) => {
    downloadText(`${c.id}-${c.headline.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.svg`, shareCardSvg(c, cobranding), 'image/svg+xml');
    toast('Graphic downloaded (SVG)');
  };
  const copyCaption = async (c: ShareCard) => toast((await copyText(fullCaption(c))) ? 'Caption copied to clipboard' : 'Copy failed', 'info');

  return (
    <div>
      <PageHeader
        eyebrow="Marketing"
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            Social Share <DemoBadge />
          </span>
        }
        subtitle="Branded, ready-to-post graphics with captions. Nothing posts automatically — copy, download and share from your own accounts."
        actions={<HelpButtons tool="Social Share" steps={STEPS} guide={GUIDE} />}
      />
      <Card className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Browse shareable content</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <SearchBox value={query} onChange={setQuery} placeholder="Keywords" ariaLabel="Keywords" className="flex-1" />
          <FilterMenu categories={SHARE_CATEGORIES} selected={cats} onChange={setCats} counts={counts} />
        </div>
        <div className="mt-3">
          <CategoryChips categories={SHARE_CATEGORIES} selected={cats} onChange={setCats} counts={counts} />
        </div>
      </Card>
      <p className="mb-3 text-sm text-slate-500">
        <span className="font-semibold text-slate-900">{list.length}</span> of {SHARE_CARDS.length} graphics
      </p>
      {list.length === 0 ? (
        <EmptyState
          title="No content matches"
          icon={<ImageIcon className="h-8 w-8" />}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setQuery('');
                setCats([]);
              }}
            >
              Clear search & filters
            </Button>
          }
        >
          Try “rates”, “equity”, “credit” or “down payment”.
        </EmptyState>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((c) => (
            <Card key={c.id} padded={false} className="flex flex-col overflow-hidden">
              <button type="button" onClick={() => setSharing(c)} className="block" aria-label={`Preview ${c.headline}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={svgDataUrl(shareCardSvg(c, cobranding))} alt={`${c.headline} — ${c.stat} ${c.statLabel}`} className="block aspect-square w-full" />
              </button>
              <div className="flex flex-1 flex-col p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Badge tone="brand">{c.category}</Badge>
                  <span className="ml-auto text-xs text-slate-400">{date(c.published + 'T12:00:00Z')}</span>
                </div>
                <p className="line-clamp-3 text-sm leading-relaxed text-slate-700">{c.caption}</p>
                <p className="mt-1 truncate text-xs text-brand-700">{c.hashtags.map((h) => `#${h}`).join(' ')}</p>
                <div className="mt-auto flex flex-wrap gap-2 pt-4">
                  <Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => copyCaption(c)}>
                    Copy caption
                  </Button>
                  <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => download(c)}>
                    Download
                  </Button>
                  <Button size="sm" icon={<Share2 className="h-4 w-4" />} onClick={() => setSharing(c)}>
                    Share
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {sharing && <SharePreview card={sharing} cobranding={cobranding} onClose={() => setSharing(null)} onCopy={() => copyCaption(sharing)} onDownload={() => download(sharing)} />}
    </div>
  );
}

function SharePreview({ card, cobranding: c, onClose, onCopy, onDownload }: { card: ShareCard; cobranding: CoBranding; onClose: () => void; onCopy: () => void; onDownload: () => void }) {
  const { toast } = useStore();
  const [p, setP] = useState<Platform>('linkedin');
  const img = svgDataUrl(shareCardSvg(card, c));
  const cap = fullCaption(card);
  const x = fitToLimit(cap, 280);
  const avatar = <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-800 text-sm font-bold text-white">{initials(c.name)}</div>;
  // eslint-disable-next-line @next/next/no-img-element
  const image = <img src={img} alt="" className="block aspect-square w-full" />;

  return (
    <Modal
      open
      onClose={onClose}
      title="Share preview"
      description={card.headline}
      size="lg"
      footer={
        <>
          <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={onCopy}>
            Copy caption
          </Button>
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={onDownload}>
            Download
          </Button>
          <Button
            icon={<Send className="h-4 w-4" />}
            onClick={() => {
              toast(`${NOTHING_SENT} — copy & download to post`, 'info');
              onClose();
            }}
          >
            Mark as shared
          </Button>
        </>
      }
    >
      <Tabs
        value={p}
        onChange={setP}
        className="mb-4"
        tabs={[
          { value: 'linkedin', label: 'LinkedIn' },
          { value: 'facebook', label: 'Facebook' },
          { value: 'instagram', label: 'Instagram' },
          { value: 'x', label: 'X' },
        ]}
      />
      <div className="mx-auto max-w-[440px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
        {p === 'instagram' ? (
          <>
            <div className="flex items-center gap-2.5 px-3 py-2.5">
              <div className="rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 p-[2px]">
                <div className="rounded-full bg-white p-[2px]">{avatar}</div>
              </div>
              <div className="text-sm font-semibold text-slate-900">{c.name.toLowerCase().replace(/\s+/g, '.')}</div>
              <MoreHorizontal className="ml-auto h-5 w-5 text-slate-500" />
            </div>
            {image}
            <div className="flex gap-4 px-3 pt-3 text-slate-800">
              <Heart className="h-6 w-6" />
              <MessageCircle className="h-6 w-6" />
              <Send className="h-6 w-6" />
              <Bookmark className="ml-auto h-6 w-6" />
            </div>
            <p className="whitespace-pre-line px-3 pb-4 pt-2 text-sm text-slate-800">
              <span className="font-semibold">{c.name.toLowerCase().replace(/\s+/g, '.')}</span> {cap}
            </p>
          </>
        ) : (
          <>
            <div className="flex items-start gap-2.5 px-4 pt-4">
              {avatar}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 text-sm">
                  <span className="font-semibold text-slate-900">{c.name}</span>
                  {p === 'x' && <span className="truncate text-slate-500">@{c.name.toLowerCase().replace(/\s+/g, '')} · now</span>}
                </div>
                {p === 'linkedin' && <div className="truncate text-xs text-slate-500">{`${c.title ?? 'Loan Officer'} at ${c.company} · NMLS# ${c.nmls}`}</div>}
                {p !== 'x' && (
                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    now · <Globe className="h-3 w-3" />
                  </div>
                )}
              </div>
              <MoreHorizontal className="h-5 w-5 text-slate-400" />
            </div>
            <p className="whitespace-pre-line px-4 pb-3 pt-2 text-sm leading-relaxed text-slate-800">{p === 'x' ? x.text : cap}</p>
            <div className={clsx(p === 'x' && 'mx-4 overflow-hidden rounded-2xl border border-slate-200')}>{image}</div>
            <div className={clsx('flex justify-around border-t border-slate-100 px-2 py-2 text-xs font-medium text-slate-500', p === 'x' && 'mt-2 border-t-0')}>
              {p === 'x' ? (
                <>
                  <MessageCircle className="h-4 w-4" />
                  <Repeat2 className="h-4 w-4" />
                  <Heart className="h-4 w-4" />
                  <Bookmark className="h-4 w-4" />
                </>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1">
                    <ThumbsUp className="h-4 w-4" /> Like
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MessageCircle className="h-4 w-4" /> Comment
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Share2 className="h-4 w-4" /> Share
                  </span>
                </>
              )}
            </div>
          </>
        )}
      </div>
      {p === 'x' && (
        <p className={clsx('mt-2 text-center text-xs tabular-nums', x.truncated ? 'text-amber-700' : 'text-slate-500')}>
          {x.length}/280 characters{x.truncated ? ' — caption trimmed to fit X' : ''}
        </p>
      )}
      <Callout className="mt-4" tone="info">
        Prototype — nothing is posted. Copy the caption and download the graphic to post from your own account.
      </Callout>
    </Modal>
  );
}
