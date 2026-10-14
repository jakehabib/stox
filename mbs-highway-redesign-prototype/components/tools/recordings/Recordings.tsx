'use client';

import { ArrowRight, Clock, Film, Folder, FolderInput, FolderOpen, Pencil, Play, RotateCcw, Search, User, Video } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Button, cx, DemoBadge, EmptyState, Field, Modal, PageHeader, RadioGroup, Select, TextInput } from '@/components/ui';
import { RECORDINGS_SEED, RECORDING_FOLDERS } from '@/data/mock/recordings';
import { filterRecordings, folderCounts, formatDuration, moveRecording, renameRecording, totalDuration, type Recording, type RecordingSort } from '@/lib/calculations/recordings';
import { date } from '@/lib/format';
import { useStore } from '@/lib/store';
import { DemoPlayer } from './DemoPlayer';

type Tone = 'brand' | 'ink' | 'emerald' | 'sky' | 'amber';
const FOLDER_TONE: Record<string, Tone> = { general: 'ink', 'buy-vs-rent': 'emerald', 'loan-comparison': 'brand', 'markets-overview': 'sky', rerc: 'amber' };
const FOLDER_TOOL: Record<string, { label: string; href: string }> = {
  general: { label: 'Open Meet', href: '/members/meet' },
  'buy-vs-rent': { label: 'Open Buy vs Rent', href: '/members/buy-vs-rent' },
  'loan-comparison': { label: 'Open Loan Comparison', href: '/members/loan-compare' },
  'markets-overview': { label: 'Open Markets Overview', href: '/members/markets' },
  rerc: { label: 'Open Real Estate Report Card', href: '/members/rerc' },
};
const THUMB: Record<Tone, string> = {
  brand: 'from-brand-500 to-brand-900',
  ink: 'from-ink-700 to-ink-950',
  emerald: 'from-emerald-500 to-emerald-900',
  sky: 'from-sky-500 to-sky-900',
  amber: 'from-amber-400 to-amber-800',
};
const STORAGE_KEY = 'mbsh-recordings-v1';
const folderName = (id: string) => RECORDING_FOLDERS.find((f) => f.id === id)?.name ?? 'General';

export function Recordings() {
  const { toast } = useStore();
  const [recs, setRecs] = useState<Recording[]>(RECORDINGS_SEED);
  const [loaded, setLoaded] = useState(false);
  const [folder, setFolder] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<RecordingSort>('newest');
  const [playing, setPlaying] = useState<Recording | null>(null);
  const [renaming, setRenaming] = useState<Recording | null>(null);
  const [moving, setMoving] = useState<Recording | null>(null);

  // Local-only persistence (per browser) so renames / moves survive a reload.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Recording[];
        if (Array.isArray(parsed) && parsed.length) setRecs(parsed);
      }
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(recs));
    } catch {
      /* ignore */
    }
  }, [recs, loaded]);

  const counts = useMemo(() => folderCounts(RECORDING_FOLDERS, recs), [recs]);
  const visible = useMemo(() => filterRecordings(recs, folder, query, sort), [recs, folder, query, sort]);
  const modified = JSON.stringify(recs) !== JSON.stringify(RECORDINGS_SEED);

  const folders = [{ id: 'all', name: 'All recordings', count: recs.length }, ...RECORDING_FOLDERS.map((f) => ({ ...f, count: counts[f.id] ?? 0 }))];

  return (
    <div>
      <PageHeader
        eyebrow="Clients"
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            Recordings <DemoBadge />
          </span>
        }
        subtitle="Replay client meetings and tool walkthroughs recorded in Highway Meeting. Organize them into folders by topic."
        actions={
          <>
            {modified && (
              <Button
                variant="ghost"
                icon={<RotateCcw className="h-4 w-4" />}
                onClick={() => {
                  setRecs(RECORDINGS_SEED);
                  toast('Demo library restored', 'info');
                }}
              >
                Reset demo library
              </Button>
            )}
            <Link href="/members/meet" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Video className="h-4 w-4" /> Highway Meeting
            </Link>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="Folders" className="min-w-0">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0">
            {folders.map((f) => {
              const active = folder === f.id;
              const Icon = f.id === 'all' ? Film : active ? FolderOpen : Folder;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => setFolder(f.id)}
                  className={cx(
                    'flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg border px-3 py-2 text-left text-sm transition-colors lg:border-transparent',
                    active ? 'border-brand-200 bg-brand-50 font-semibold text-brand-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 lg:bg-transparent',
                  )}
                >
                  <Icon className={cx('h-4 w-4', active ? 'text-brand-600' : 'text-slate-400')} />
                  <span className="flex-1">{f.name}</span>
                  <span className={cx('rounded-full px-1.5 text-[11px] tabular-nums', active ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500')}>{f.count}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-4 hidden rounded-lg bg-slate-100/70 px-3 py-2.5 text-xs text-slate-500 lg:block">
            {recs.length} recordings · {formatDuration(totalDuration(recs))} total
          </div>
        </nav>

        <section className="min-w-0">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <TextInput aria-label="Search recordings" placeholder="Search by title or client…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
            </div>
            <Select
              ariaLabel="Sort recordings"
              className="sm:w-44"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'newest', label: 'Newest first' },
                { value: 'oldest', label: 'Oldest first' },
                { value: 'title', label: 'Title A–Z' },
                { value: 'longest', label: 'Longest first' },
              ]}
            />
          </div>
          <div className="mb-3 text-sm text-slate-500">
            <span className="font-semibold text-slate-800">{folder === 'all' ? 'All recordings' : folderName(folder)}</span> · {visible.length} {visible.length === 1 ? 'recording' : 'recordings'}
            {query && ` matching “${query.trim()}”`}
          </div>

          {visible.length === 0 ? (
            <EmptyState title={query ? 'No recordings match your search' : 'This folder is empty'} icon={<Film className="h-8 w-8" />}>
              {query ? 'Try a different title or client name.' : 'Move a recording here from another folder.'}
            </EmptyState>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((r) => {
                const tone = FOLDER_TONE[r.folderId] ?? 'ink';
                return (
                  <li key={r.id} className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card transition-shadow hover:shadow-lift">
                    <button type="button" onClick={() => setPlaying(r)} aria-label={`Play ${r.title}`} className={cx('relative aspect-video w-full bg-gradient-to-br text-left text-white', THUMB[tone])}>
                      <span className="absolute left-3 top-3 rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">{r.toolLabel}</span>
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/25 backdrop-blur transition-transform group-hover:scale-110">
                          <Play className="ml-0.5 h-5 w-5" />
                        </span>
                      </span>
                      <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums">{formatDuration(r.durationSec)}</span>
                    </button>
                    <div className="flex flex-1 flex-col p-4">
                      <button type="button" onClick={() => setPlaying(r)} className="text-left text-sm font-semibold leading-snug text-slate-900 hover:text-brand-700">
                        {r.title}
                      </button>
                      <div className="mt-1.5 space-y-0.5 text-xs text-slate-500">
                        <div className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5" /> {r.clientName}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" /> {date(r.recordedAt)} · {formatDuration(r.durationSec)}
                        </div>
                      </div>
                      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                          <Folder className="h-3.5 w-3.5" /> {folderName(r.folderId)}
                        </span>
                        <span className="flex gap-1">
                          <Button variant="ghost" size="sm" aria-label={`Rename ${r.title}`} title="Rename" onClick={() => setRenaming(r)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" aria-label={`Move ${r.title}`} title="Move to folder" onClick={() => setMoving(r)}>
                            <FolderInput className="h-3.5 w-3.5" />
                          </Button>
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {playing && (
        <Modal
          open
          onClose={() => setPlaying(null)}
          title={playing.title}
          description={`${playing.clientName} · ${date(playing.recordedAt, 'long')}`}
          size="xl"
          footer={
            <>
              <Button
                variant="secondary"
                icon={<Pencil className="h-4 w-4" />}
                onClick={() => {
                  setRenaming(playing);
                  setPlaying(null);
                }}
              >
                Rename
              </Button>
              <Link href={FOLDER_TOOL[playing.folderId]?.href ?? '/members/meet'} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
                {FOLDER_TOOL[playing.folderId]?.label ?? 'Open tool'} <ArrowRight className="h-4 w-4" />
              </Link>
            </>
          }
        >
          <DemoPlayer title={playing.title} subtitle={`${playing.toolLabel} · ${playing.clientName}`} durationSec={playing.durationSec} tone={FOLDER_TONE[playing.folderId] ?? 'ink'} />
        </Modal>
      )}

      {renaming && (
        <RenameModal
          rec={renaming}
          onClose={() => setRenaming(null)}
          onSave={(title) => {
            setRecs((list) => renameRecording(list, renaming.id, title));
            toast('Recording renamed');
            setRenaming(null);
          }}
        />
      )}

      {moving && (
        <MoveModal
          rec={moving}
          onClose={() => setMoving(null)}
          onSave={(folderId) => {
            setRecs((list) => moveRecording(list, moving.id, folderId));
            toast(`Moved to ${folderName(folderId)}`);
            setMoving(null);
          }}
        />
      )}
    </div>
  );
}

function RenameModal({ rec, onClose, onSave }: { rec: Recording; onClose: () => void; onSave: (t: string) => void }) {
  const [title, setTitle] = useState(rec.title);
  const error = title.trim() ? undefined : 'Title is required';
  const submit = () => !error && onSave(title);
  return (
    <Modal
      open
      onClose={onClose}
      title="Rename recording"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!!error}>
            Save
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Title" error={error} htmlFor="rec-title">
          <TextInput id="rec-title" autoFocus value={title} invalid={!!error} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

function MoveModal({ rec, onClose, onSave }: { rec: Recording; onClose: () => void; onSave: (f: string) => void }) {
  const [target, setTarget] = useState(rec.folderId);
  return (
    <Modal
      open
      onClose={onClose}
      title="Move to folder"
      description={rec.title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(target)} disabled={target === rec.folderId}>
            Move
          </Button>
        </>
      }
    >
      <RadioGroup className="flex-col" value={target} onChange={setTarget} options={RECORDING_FOLDERS.map((f) => ({ value: f.id, label: f.name, hint: f.id === rec.folderId ? '(current)' : undefined }))} />
    </Modal>
  );
}
