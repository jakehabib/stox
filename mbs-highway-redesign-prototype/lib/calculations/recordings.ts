/** Recordings library helpers — pure functions (search, folder counts, rename/move, duration format). */

export interface RecordingFolder {
  id: string;
  name: string;
}

export interface Recording {
  id: string;
  title: string;
  folderId: string;
  clientName: string;
  durationSec: number;
  recordedAt: string; // ISO
  toolLabel: string;
}

/** 194 → "3:14", 3725 → "1:02:05". */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(sec) ? sec : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}

export function folderCounts(folders: RecordingFolder[], recs: Recording[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(folders.map((f) => [f.id, 0]));
  for (const r of recs) if (r.folderId in out) out[r.folderId] += 1;
  return out;
}

export type RecordingSort = 'newest' | 'oldest' | 'title' | 'longest';

/** Filter by folder ('all' = every folder) and a case-insensitive query over title + client; then sort. */
export function filterRecordings(recs: Recording[], folderId: string, query: string, sort: RecordingSort = 'newest'): Recording[] {
  const q = query.trim().toLowerCase();
  const list = recs.filter((r) => (folderId === 'all' || r.folderId === folderId) && (!q || `${r.title} ${r.clientName} ${r.toolLabel}`.toLowerCase().includes(q)));
  const by: Record<RecordingSort, (a: Recording, b: Recording) => number> = {
    newest: (a, b) => b.recordedAt.localeCompare(a.recordedAt),
    oldest: (a, b) => a.recordedAt.localeCompare(b.recordedAt),
    title: (a, b) => a.title.localeCompare(b.title),
    longest: (a, b) => b.durationSec - a.durationSec,
  };
  return [...list].sort(by[sort]);
}

export function renameRecording(recs: Recording[], id: string, title: string): Recording[] {
  const t = title.trim();
  if (!t) return recs;
  return recs.map((r) => (r.id === id ? { ...r, title: t } : r));
}

export function moveRecording(recs: Recording[], id: string, folderId: string): Recording[] {
  return recs.map((r) => (r.id === id ? { ...r, folderId } : r));
}

export function totalDuration(recs: Recording[]): number {
  return recs.reduce((a, r) => a + Math.max(0, r.durationSec || 0), 0);
}
