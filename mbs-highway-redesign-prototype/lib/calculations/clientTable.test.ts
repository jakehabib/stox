import { describe, expect, it } from 'vitest';
import { buildDemoClients, type Client } from '@/data/mock/clients';
import { clientStats, pageList, paginate, rangeLabel, searchClients, sortClients } from './clientTable';

const demo = buildDemoClients();
const mk = (name: string, p: Partial<Client> = {}): Client => ({ id: name, name, primaryEmail: `${name.toLowerCase()}@example.com`, fico: '720–739', updatedAt: '2026-01-01T00:00:00Z', ...p });

describe('paginate — 15 per page', () => {
  it('101 demo clients → 7 pages, "1–15 of 101"', () => {
    expect(demo.length).toBe(101);
    const p = paginate(demo, 1, 15);
    expect(p.pageCount).toBe(7);
    expect(p.items.length).toBe(15);
    expect(rangeLabel(p)).toBe('1–15 of 101');
  });
  it('last page holds 11 rows: "91–101 of 101"', () => {
    const p = paginate(demo, 7, 15);
    expect(p.items.length).toBe(11);
    expect(rangeLabel(p)).toBe('91–101 of 101');
  });
  it('clamps out-of-range pages', () => {
    expect(paginate(demo, 99).page).toBe(7);
    expect(paginate(demo, 0).page).toBe(1);
    expect(paginate(demo, NaN).page).toBe(1);
  });
  it('empty list → page 1 of 1, "0–0 of 0"', () => {
    const p = paginate([], 1);
    expect(p.pageCount).toBe(1);
    expect(rangeLabel(p)).toBe('0–0 of 0');
  });
});

describe('searchClients', () => {
  it('matches name case-insensitively', () => {
    expect(searchClients(demo, 'alex riv').map((c) => c.name)).toEqual(['Alex Rivera']);
    expect(searchClients(demo, 'ALEX RIVERA').length).toBe(1);
  });
  it('matches email; blank returns all', () => {
    expect(searchClients(demo, 'alex.rivera.test@').length).toBe(1);
    expect(searchClients(demo, '   ').length).toBe(101);
    expect(searchClients(demo, 'zzzz').length).toBe(0);
  });
});

describe('sortClients', () => {
  const list = [mk('Charlie', { updatedAt: '2026-03-01T00:00:00Z', lastSent: '2026-03-02T00:00:00Z' }), mk('alice', { updatedAt: '2026-05-01T00:00:00Z' }), mk('Bob', { updatedAt: '2026-04-01T00:00:00Z', lastSent: '2026-04-02T00:00:00Z' })];
  it('by name asc/desc (case-insensitive)', () => {
    expect(sortClients(list, 'name', 'asc').map((c) => c.name)).toEqual(['alice', 'Bob', 'Charlie']);
    expect(sortClients(list, 'name', 'desc').map((c) => c.name)).toEqual(['Charlie', 'Bob', 'alice']);
  });
  it('by updated desc', () => {
    expect(sortClients(list, 'updatedAt', 'desc').map((c) => c.name)).toEqual(['alice', 'Bob', 'Charlie']);
  });
  it('missing dates sort last in both directions', () => {
    expect(sortClients(list, 'lastSent', 'desc').map((c) => c.name)).toEqual(['Bob', 'Charlie', 'alice']);
    expect(sortClients(list, 'lastSent', 'asc').map((c) => c.name)).toEqual(['Charlie', 'Bob', 'alice']);
  });
  it('demo: Alex Rivera (updated today) sorts first by Updated desc', () => {
    expect(sortClients(demo, 'updatedAt', 'desc')[0].name).toBe('Alex Rivera');
  });
});

describe('pageList', () => {
  it('7 pages → all shown', () => {
    expect(pageList(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('many pages → ellipses', () => {
    expect(pageList(5, 12)).toEqual([1, '…', 4, 5, 6, '…', 12]);
    expect(pageList(1, 12)).toEqual([1, 2, '…', 12]);
  });
});

describe('clientStats', () => {
  it('counts recent sends / activity / never sent', () => {
    const now = new Date('2026-10-14T16:00:00Z');
    const l = [mk('a', { lastSent: '2026-10-01T00:00:00Z', lastActivity: '2026-10-02T00:00:00Z' }), mk('b', { lastSent: '2026-01-01T00:00:00Z' }), mk('c')];
    expect(clientStats(l, now)).toEqual({ total: 3, sentRecently: 1, activeRecently: 1, neverSent: 1 });
  });
  it('demo totals are consistent', () => {
    const s = clientStats(demo, new Date('2026-10-14T16:00:00Z'));
    expect(s.total).toBe(101);
    expect(s.neverSent).toBe(demo.filter((c) => !c.lastSent).length);
  });
});
