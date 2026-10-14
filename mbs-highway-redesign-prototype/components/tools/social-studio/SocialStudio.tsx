'use client';

import clsx from 'clsx';
import { Calendar, Check, ChevronUp, Clapperboard, Copy, Download, Film, Pencil, Play, RotateCcw, ScrollText, Star, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CoBrandingEditor } from '@/components/calc/ReportFooter';
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Segmented, Select, Tabs, TextArea, TextInput } from '@/components/ui';
import { CUSTOM_TOPIC_SUGGESTIONS, FRAME_TEMPLATES, RECORDED_VIDEOS, SCRIPT_CATEGORIES, VIDEO_SCRIPTS, scriptCategories, type VideoScript } from '@/data/mock/socialStudio';
import {
  AUDIENCE_LABEL,
  TONE_LABEL,
  assembleCustomScript,
  countByCategory,
  fillTemplate,
  filterItems,
  formatDuration,
  readSeconds,
  wordCount,
  type ScriptAudience,
  type ScriptLength,
  type ScriptTone,
} from '@/lib/calculations/marketingFilters';
import { downloadText } from '@/lib/exportCsv';
import { date, num } from '@/lib/format';
import { useStore } from '@/lib/store';
import { CategoryChips, FilterMenu, HelpButtons, SearchBox } from './Controls';
import { frameSvg } from './frameSvg';
import { DemoVideoPlayer, copyText, svgDataUrl, useLocalList } from './shared';
import { Teleprompter } from './Teleprompter';

type Tab = 'scripts' | 'frames' | 'videos' | 'custom';

const TUTORIAL_STEPS = [
  'Search for a topic or filter by category to find a script.',
  'Click View More to read the full script — it’s already written in your voice with your name.',
  'Edit any line inline, then Save. Your edits stay with the script.',
  'Hit Record with teleprompter: the script scrolls while you look at the camera.',
  'Add your branded intro/outro frame and share the finished video.',
];

const GUIDE = [
  { title: 'Keep it short', body: 'Aim for 45–75 seconds. Viewers decide in the first three seconds whether to keep watching, so lead with the hook.' },
  { title: 'Light and framing', body: 'Face a window or a soft light, camera at eye level, and leave a little space above your head. A clean background beats a fancy one.' },
  { title: 'Talk to one person', body: 'Picture a single client while you read. Slow the teleprompter down until it feels conversational rather than recited.' },
  { title: 'Always end with a next step', body: 'Every script ends with a call to action — keep it. A direct, low-pressure ask ("send me a message") outperforms a generic sign-off.' },
  { title: 'Consistency beats perfection', body: 'Two videos a week for three months will do more for your pipeline than one perfect video a quarter. Batch-record on one day.' },
];

export function SocialStudio() {
  const [tab, setTab] = useState<Tab>('scripts');
  const [categories, setCategories] = useState<string[]>([]);
  const [teleprompter, setTeleprompter] = useState<{ title: string; text: string } | null>(null);
  const [customs, setCustoms] = useLocalList<VideoScript>('mbsh-social-studio-custom-v1');

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'frames' || t === 'videos' || t === 'custom' || t === 'scripts') setTab(t);
  }, []);

  return (
    <div>
      <PageHeader
        eyebrow="Marketing"
        title="Social Studio"
        subtitle="Ready-to-record video scripts written in your voice, branded intro/outro frames and your video library."
        actions={<HelpButtons tool="Social Studio" steps={TUTORIAL_STEPS} guide={GUIDE} />}
      />
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-6"
        tabs={[
          { value: 'scripts', label: 'Scripts' },
          { value: 'frames', label: 'Intro/Outro Frames' },
          { value: 'videos', label: 'Videos' },
          { value: 'custom', label: 'Create Custom Script' },
        ]}
      />
      {tab === 'scripts' && <ScriptsTab customs={customs} setCustoms={setCustoms} categories={categories} setCategories={setCategories} onRecord={setTeleprompter} />}
      {tab === 'frames' && <FramesTab />}
      {tab === 'videos' && <VideosTab onRecordNew={() => setTab('scripts')} />}
      {tab === 'custom' && (
        <CustomTab
          onRecord={setTeleprompter}
          onSave={(s) => {
            setCustoms((list) => [s, ...list]);
            setCategories(['Custom']);
            setTab('scripts');
          }}
        />
      )}
      <Teleprompter open={!!teleprompter} onClose={() => setTeleprompter(null)} title={teleprompter?.title ?? ''} text={teleprompter?.text ?? ''} />
    </div>
  );
}

/* ================================================================== Scripts */

function useScriptVars() {
  const { cobranding } = useStore();
  return useMemo(() => ({ name: cobranding.name, company: cobranding.company, phone: cobranding.cell }), [cobranding]);
}

function ScriptsTab({
  customs,
  setCustoms,
  categories,
  setCategories,
  onRecord,
}: {
  customs: VideoScript[];
  setCustoms: (f: (l: VideoScript[]) => VideoScript[]) => void;
  categories: string[];
  setCategories: (c: string[]) => void;
  onRecord: (t: { title: string; text: string }) => void;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const vars = useScriptVars();

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('mbsh-social-studio-edits-v1');
      if (raw) setEdits(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);
  const saveEdits = (next: Record<string, string>) => {
    setEdits(next);
    try {
      window.localStorage.setItem('mbsh-social-studio-edits-v1', JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const all = useMemo(() => [...customs, ...VIDEO_SCRIPTS], [customs]);
  const counts = useMemo(() => countByCategory(all, scriptCategories), [all]);
  const textOf = (s: VideoScript) => edits[s.id] ?? fillTemplate(s.body, vars);
  const list = filterItems(all, { query, categories, text: (s) => [s.title, s.category, ...s.tags, textOf(s)], cats: scriptCategories });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <SearchBox value={query} onChange={setQuery} placeholder="Search for topic" className="flex-1" />
        <FilterMenu categories={SCRIPT_CATEGORIES} selected={categories} onChange={setCategories} counts={counts} />
      </div>
      <CategoryChips categories={SCRIPT_CATEGORIES} selected={categories} onChange={setCategories} counts={counts} />
      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>
          <span className="font-semibold text-slate-900">{list.length}</span> of {all.length} scripts
          {categories.length > 0 && <> · {categories.join(', ')}</>}
        </span>
        <span className="hidden sm:inline">Written in first person as {vars.name}</span>
      </div>
      {list.length === 0 ? (
        <EmptyState
          title="No scripts match"
          icon={<ScrollText className="h-8 w-8" />}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setQuery('');
                setCategories([]);
              }}
            >
              Clear search & filters
            </Button>
          }
        >
          Try a broader topic like “rates”, “equity” or “first-time buyer”.
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((s) => (
            <ScriptCard
              key={s.id}
              script={s}
              text={textOf(s)}
              edited={edits[s.id] !== undefined}
              expanded={expanded === s.id}
              onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
              onSave={(t) => saveEdits({ ...edits, [s.id]: t })}
              onReset={() => {
                const n = { ...edits };
                delete n[s.id];
                saveEdits(n);
              }}
              onDelete={s.id.startsWith('mine-') ? () => setCustoms((l) => l.filter((x) => x.id !== s.id)) : undefined}
              onRecord={() => onRecord({ title: s.title, text: textOf(s) })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ScriptCard({
  script: s,
  text,
  edited,
  expanded,
  onToggle,
  onSave,
  onReset,
  onDelete,
  onRecord,
}: {
  script: VideoScript;
  text: string;
  edited: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSave: (t: string) => void;
  onReset: () => void;
  onDelete?: () => void;
  onRecord: () => void;
}) {
  const { toast } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  useEffect(() => {
    if (!expanded) setEditing(false);
  }, [expanded]);

  return (
    <Card className={clsx('flex flex-col transition-shadow', expanded && 'shadow-lift ring-1 ring-brand-200 md:col-span-2 xl:col-span-3')}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Badge tone={s.category === 'Custom' ? 'blue' : 'brand'}>{s.category}</Badge>
        {s.featured && (
          <Badge tone="amber">
            <Star className="h-3 w-3" fill="currentColor" /> Featured
          </Badge>
        )}
        {edited && <Badge tone="green">Edited</Badge>}
        <span className="ml-auto text-xs tabular-nums text-slate-400">~{formatDuration(readSeconds(text))}</span>
      </div>
      <h3 className="text-[15px] font-semibold leading-snug text-slate-900">{s.title}</h3>
      {!expanded ? (
        <p className="mt-2 line-clamp-3 flex-1 text-sm leading-relaxed text-slate-600">{text}</p>
      ) : editing ? (
        <div className="mt-3">
          <TextArea aria-label="Edit script" rows={12} value={draft} onChange={(e) => setDraft(e.target.value)} className="text-[15px] leading-relaxed" />
          <div className="mt-1 text-xs text-slate-500">
            {wordCount(draft)} words · ~{formatDuration(readSeconds(draft))} on camera
          </div>
        </div>
      ) : (
        <div className="mt-3 whitespace-pre-line rounded-lg bg-slate-50 p-4 text-[15px] leading-relaxed text-slate-800">{text}</div>
      )}
      {expanded && !editing && (
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Published</dt>
            <dd className="mt-0.5 inline-flex items-center gap-1.5 text-slate-800">
              <Calendar className="h-3.5 w-3.5 text-slate-400" />
              {date(s.published + 'T12:00:00Z', 'long')}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Tags</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {s.tags.map((t) => (
                <span key={t} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  #{t}
                </span>
              ))}
            </dd>
          </div>
        </dl>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {expanded && editing ? (
          <>
            <Button
              size="sm"
              icon={<Check className="h-4 w-4" />}
              onClick={() => {
                onSave(draft);
                setEditing(false);
                toast('Script saved');
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </>
        ) : expanded ? (
          <>
            <Button size="sm" icon={<Clapperboard className="h-4 w-4" />} onClick={onRecord}>
              Record with teleprompter
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<Pencil className="h-4 w-4" />}
              onClick={() => {
                setDraft(text);
                setEditing(true);
              }}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<Copy className="h-4 w-4" />}
              onClick={async () => toast((await copyText(`${s.title}\n\n${text}`)) ? 'Script copied to clipboard' : 'Copy failed — select the text manually', 'info')}
            >
              Copy
            </Button>
            {edited && (
              <Button size="sm" variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={onReset}>
                Reset to original
              </Button>
            )}
            {onDelete && (
              <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={onDelete}>
                Delete
              </Button>
            )}
            <Button size="sm" variant="ghost" className="ml-auto" icon={<ChevronUp className="h-4 w-4" />} onClick={onToggle}>
              View Less
            </Button>
          </>
        ) : (
          <Button size="sm" variant="subtle" onClick={onToggle}>
            View More
          </Button>
        )}
      </div>
    </Card>
  );
}

/* ================================================================== Frames */

function FramesTab() {
  const { cobranding, toast } = useStore();
  const [kind, setKind] = useState<'intro' | 'outro'>('intro');
  const [selected, setSelected] = useState<{ intro: string; outro: string }>({ intro: 'classic', outro: 'classic' });
  const [editBrand, setEditBrand] = useState(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('mbsh-social-studio-frames-v1');
      if (raw) setSelected(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);
  const choose = (id: string) => {
    const next = { ...selected, [kind]: id };
    setSelected(next);
    try {
      window.localStorage.setItem('mbsh-social-studio-frames-v1', JSON.stringify(next));
    } catch {
      /* ignore */
    }
    toast(`${kind === 'intro' ? 'Intro' : 'Outro'} frame set to ${FRAME_TEMPLATES.find((f) => f.id === id)?.name}`);
  };
  const current = FRAME_TEMPLATES.find((f) => f.id === selected[kind]) ?? FRAME_TEMPLATES[0];
  const svg = frameSvg(current, cobranding, kind);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented value={kind} onChange={setKind} options={[{ value: 'intro', label: 'Intro frame' }, { value: 'outro', label: 'Outro frame' }]} ariaLabel="Frame type" />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditBrand(true)}>
            Edit co-branding
          </Button>
          <Button icon={<Download className="h-4 w-4" />} onClick={() => downloadText(`${kind}-frame-${current.id}.svg`, svg, 'image/svg+xml')}>
            Download SVG
          </Button>
        </div>
      </div>
      <Card padded={false} className="overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={svgDataUrl(svg)} alt={`${current.name} ${kind} frame preview`} className="block aspect-video w-full" />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-sm">
          <span>
            <span className="font-semibold text-slate-900">{current.name}</span> <span className="text-slate-500">· {current.description}</span>
          </span>
          <span className="text-xs text-slate-500">Rendered live from your co-branding · 1280×720</span>
        </div>
      </Card>
      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Choose a {kind} template</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {FRAME_TEMPLATES.map((f) => {
            const on = f.id === selected[kind];
            return (
              <button key={f.id} type="button" onClick={() => choose(f.id)} aria-pressed={on} className={clsx('overflow-hidden rounded-xl border bg-white text-left transition-shadow hover:shadow-lift', on ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-slate-200')}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={svgDataUrl(frameSvg(f, cobranding, kind))} alt="" className="block aspect-video w-full" />
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="truncate text-sm font-medium text-slate-800">{f.name}</span>
                  {on && (
                    <Badge tone="brand">
                      <Check className="h-3 w-3" /> Selected
                    </Badge>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <CoBrandingEditor open={editBrand} onClose={() => setEditBrand(false)} />
    </div>
  );
}

/* ================================================================== Videos */

function VideosTab({ onRecordNew }: { onRecordNew: () => void }) {
  const { cobranding, toast } = useStore();
  const vars = useScriptVars();
  const [playing, setPlaying] = useState<string | null>(null);
  const v = RECORDED_VIDEOS.find((x) => x.id === playing);
  const script = v?.scriptId ? VIDEO_SCRIPTS.find((s) => s.id === v.scriptId) : undefined;
  const captions = script ? fillTemplate(script.body, vars).split(/(?<=[.!?])\s+/) : undefined;
  const frame = (id: string) => FRAME_TEMPLATES.find((f) => f.id === id) ?? FRAME_TEMPLATES[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          <span className="font-semibold text-slate-900">{RECORDED_VIDEOS.length}</span> recorded videos · demo library (player UI only)
        </p>
        <Button
          icon={<Clapperboard className="h-4 w-4" />}
          onClick={() => {
            onRecordNew();
            toast('Pick a script, open it and choose “Record with teleprompter”', 'info');
          }}
        >
          Record new video
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {RECORDED_VIDEOS.map((x) => (
          <Card key={x.id} padded={false} className="overflow-hidden">
            <button type="button" onClick={() => setPlaying(x.id)} className="group relative block w-full" aria-label={`Play ${x.title}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={svgDataUrl(frameSvg(frame(x.frameId), cobranding, 'intro'))} alt="" className="block aspect-video w-full" />
              <span className="absolute inset-0 m-auto flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-brand-700 shadow-lift transition-transform group-hover:scale-110">
                <Play className="ml-0.5 h-5 w-5" fill="currentColor" />
              </span>
              <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">{formatDuration(x.durationSec)}</span>
            </button>
            <div className="p-4">
              <div className="mb-1 flex items-center gap-2">
                <Badge tone={x.status === 'Published' ? 'green' : 'neutral'}>{x.status}</Badge>
                <span className="text-xs text-slate-400">{date(x.recorded + 'T12:00:00Z')}</span>
              </div>
              <div className="line-clamp-2 text-sm font-semibold text-slate-900">{x.title}</div>
              <div className="mt-1 text-xs text-slate-500">{num(x.views)} views</div>
            </div>
          </Card>
        ))}
      </div>
      <Modal
        open={!!v}
        onClose={() => setPlaying(null)}
        title={v?.title ?? ''}
        description={v ? `Recorded ${date(v.recorded + 'T12:00:00Z', 'long')} · ${num(v.views)} views` : undefined}
        size="xl"
        footer={
          <>
            <Button
              variant="secondary"
              icon={<Copy className="h-4 w-4" />}
              onClick={async () => {
                await copyText(`${window.location.origin}/members/social-studio?tab=videos&v=${v?.id}`);
                toast('Video link copied — Prototype — nothing was sent', 'info');
              }}
            >
              Copy share link
            </Button>
            <Button onClick={() => setPlaying(null)}>Done</Button>
          </>
        }
      >
        {v && <DemoVideoPlayer key={v.id} title={v.title} subtitle={`${cobranding.name} · ${cobranding.company}`} durationSec={v.durationSec} from={frame(v.frameId).from} to={frame(v.frameId).to} captions={captions} autoPlay />}
        <p className="mt-3 text-xs text-slate-500">Prototype: no media file is stored — the player shows timing and captions from the script.</p>
      </Modal>
    </div>
  );
}

/* ================================================================== Create Custom Script */

function CustomTab({ onSave, onRecord }: { onSave: (s: VideoScript) => void; onRecord: (t: { title: string; text: string }) => void }) {
  const { cobranding, toast } = useStore();
  const [topic, setTopic] = useState('buying before spring');
  const [audience, setAudience] = useState<ScriptAudience>('first-time-buyers');
  const [tone, setTone] = useState<ScriptTone>('friendly');
  const [length, setLength] = useState<ScriptLength>(60);
  const [points, setPoints] = useState<string[]>(['', '', '']);
  const [title, setTitle] = useState('');
  const script = assembleCustomScript({ topic, audience, tone, length, name: cobranding.name, company: cobranding.company, phone: cobranding.cell, keyPoints: points });
  const autoTitle = title.trim() || (topic.trim() ? topic.trim().replace(/^./, (c) => c.toUpperCase()) : 'My custom script');
  const words = wordCount(script);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <Card>
        <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          <Wand2 className="h-4 w-4 text-brand-600" /> Script builder
        </div>
        <div className="space-y-4">
          <Field label="Topic" hint="What is the video about?">
            <TextInput value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. today’s mortgage rates" />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {CUSTOM_TOPIC_SUGGESTIONS.map((t) => (
              <button key={t} type="button" onClick={() => setTopic(t)} className={clsx('rounded-full border px-2.5 py-1 text-xs', topic === t ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>
                {t}
              </button>
            ))}
          </div>
          <Field label="Audience">
            <Select value={audience} onChange={setAudience} options={(Object.keys(AUDIENCE_LABEL) as ScriptAudience[]).map((a) => ({ value: a, label: AUDIENCE_LABEL[a] }))} ariaLabel="Audience" />
          </Field>
          <Field label="Tone">
            <Select value={tone} onChange={setTone} options={(Object.keys(TONE_LABEL) as ScriptTone[]).map((t) => ({ value: t, label: TONE_LABEL[t] }))} ariaLabel="Tone" />
          </Field>
          <Field label="Length">
            <Segmented value={String(length) as '30' | '60' | '90'} onChange={(v) => setLength(Number(v) as ScriptLength)} options={[{ value: '30', label: '30 sec' }, { value: '60', label: '60 sec' }, { value: '90', label: '90 sec' }]} ariaLabel="Length" />
          </Field>
          <Field label="Key points (optional)" hint="Your own points are used first.">
            <div className="space-y-2">
              {points.map((p, i) => (
                <TextInput key={i} value={p} placeholder={`Key point ${i + 1}`} onChange={(e) => setPoints(points.map((x, j) => (j === i ? e.target.value : x)))} />
              ))}
            </div>
          </Field>
          <Field label="Script title">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder={autoTitle} />
          </Field>
        </div>
      </Card>
      <div className="space-y-4">
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge tone="blue">Custom</Badge>
            <Badge>{AUDIENCE_LABEL[audience]}</Badge>
            <Badge>{TONE_LABEL[tone]}</Badge>
            <span className="ml-auto text-xs tabular-nums text-slate-500">
              {words} words · ~{formatDuration(readSeconds(script))}
            </span>
          </div>
          <h3 className="text-lg font-semibold text-slate-900">{autoTitle}</h3>
          <div className="mt-3 whitespace-pre-line rounded-lg bg-slate-50 p-4 text-[15px] leading-relaxed text-slate-800">{script}</div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              icon={<Check className="h-4 w-4" />}
              onClick={() => {
                onSave({
                  id: `mine-${Date.now()}`,
                  title: autoTitle,
                  category: 'Custom',
                  published: new Date().toISOString().slice(0, 10),
                  tags: [topic.trim() || 'custom', AUDIENCE_LABEL[audience].toLowerCase(), TONE_LABEL[tone].toLowerCase()],
                  body: script,
                });
                toast('Saved to Custom scripts');
              }}
            >
              Save to Custom
            </Button>
            <Button variant="secondary" icon={<Clapperboard className="h-4 w-4" />} onClick={() => onRecord({ title: autoTitle, text: script })}>
              Open in teleprompter
            </Button>
            <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={async () => toast((await copyText(script)) ? 'Script copied to clipboard' : 'Copy failed', 'info')}>
              Copy
            </Button>
          </div>
        </Card>
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <Film className="h-3.5 w-3.5" /> Assembled from proven templates (deterministic — no AI). Same inputs always produce the same script.
        </p>
      </div>
    </div>
  );
}
