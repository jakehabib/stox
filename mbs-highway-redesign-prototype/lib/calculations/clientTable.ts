/** Client Manager table helpers — search, sort, paginate, stats. Pure functions. */
import type { Client } from '@/data/mock/clients';

export type ClientSortKey = 'name' | 'updatedAt' | 'lastSent' | 'lastActivity';
export type SortDir = 'asc' | 'desc';

export const CLIENTS_PER_PAGE = 15;

/** Case-insensitive match on name or either email. Whitespace-only query returns everything. */
export function searchClients(clients: Client[], query: string): Client[] {
  const q = query.trim().toLowerCase();
  if (!q) return clients;
  return clients.filter((c) => `${c.name} ${c.primaryEmail ?? ''} ${c.secondaryEmail ?? ''}`.toLowerCase().includes(q));
}

const time = (s?: string) => {
  if (!s) return NaN;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
};

/** Stable sort. Missing dates always sort last (both directions), name ties broken alphabetically. */
export function sortClients(clients: Client[], key: ClientSortKey, dir: SortDir): Client[] {
  const sign = dir === 'asc' ? 1 : -1;
  return clients
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      if (key === 'name') {
        const d = a.c.name.localeCompare(b.c.name, 'en', { sensitivity: 'base' });
        return d !== 0 ? sign * d : a.i - b.i;
      }
      const ta = time(a.c[key]);
      const tb = time(b.c[key]);
      const na = Number.isNaN(ta);
      const nb = Number.isNaN(tb);
      if (na && nb) return a.c.name.localeCompare(b.c.name) || a.i - b.i;
      if (na) return 1;
      if (nb) return -1;
      return ta !== tb ? sign * (ta - tb) : a.i - b.i;
    })
    .map((x) => x.c);
}

export interface Page<T> {
  items: T[];
  page: number; // 1-based, clamped
  pageCount: number;
  total: number;
  from: number; // 1-based index of first item (0 when empty)
  to: number;
}

export function paginate<T>(items: T[], page: number, perPage = CLIENTS_PER_PAGE): Page<T> {
  const size = Math.max(1, Math.floor(perPage) || 1);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const p = Math.min(pageCount, Math.max(1, Math.floor(Number.isFinite(page) ? page : 1)));
  const start = (p - 1) * size;
  const slice = items.slice(start, start + size);
  return { items: slice, page: p, pageCount, total, from: total ? start + 1 : 0, to: start + slice.length };
}

/** "1–15 of 101" */
export function rangeLabel(p: Pick<Page<unknown>, 'from' | 'to' | 'total'>): string {
  return `${p.from}–${p.to} of ${p.total}`;
}

/** Compact page list with ellipses: [1, 2, 3, '…', 7]. */
export function pageList(page: number, pageCount: number): (number | '…')[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const set = new Set([1, pageCount, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pageCount));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push('…');
    out.push(n);
  });
  return out;
}

/** Summary tiles: totals and 30-day engagement. */
export function clientStats(clients: Client[], now: Date, windowDays = 30) {
  const cutoff = now.getTime() - windowDays * 86_400_000;
  const within = (s?: string) => {
    const t = time(s);
    return !Number.isNaN(t) && t >= cutoff;
  };
  return {
    total: clients.length,
    sentRecently: clients.filter((c) => within(c.lastSent)).length,
    activeRecently: clients.filter((c) => within(c.lastActivity)).length,
    neverSent: clients.filter((c) => !c.lastSent).length,
  };
}
