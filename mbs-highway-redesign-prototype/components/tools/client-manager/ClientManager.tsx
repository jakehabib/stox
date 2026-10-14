'use client';

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Search, UserPlus, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AddClientModal } from '@/components/calc/AddClientModal';
import { Button, Card, cx, EmptyState, PageHeader, Select, StatTile } from '@/components/ui';
import type { Client } from '@/data/mock/clients';
import { CLIENTS_PER_PAGE, clientStats, pageList, paginate, rangeLabel, searchClients, sortClients, type ClientSortKey, type SortDir } from '@/lib/calculations/clientTable';
import { downloadCsv } from '@/lib/exportCsv';
import { date } from '@/lib/format';
import { useStore } from '@/lib/store';
import { ClientDrawer, initials } from './ClientDrawer';

const COLUMNS: { key: ClientSortKey; label: string; className?: string }[] = [
  { key: 'name', label: 'Client' },
  { key: 'updatedAt', label: 'Updated' },
  { key: 'lastSent', label: 'Last Sent' },
  { key: 'lastActivity', label: 'Last Client Activity' },
];

const SORT_OPTIONS = [
  { value: 'updatedAt:desc', label: 'Updated (newest)' },
  { value: 'updatedAt:asc', label: 'Updated (oldest)' },
  { value: 'name:asc', label: 'Client (A–Z)' },
  { value: 'name:desc', label: 'Client (Z–A)' },
  { value: 'lastSent:desc', label: 'Last sent (newest)' },
  { value: 'lastActivity:desc', label: 'Last activity (newest)' },
];

export function ClientManager() {
  const { clients } = useStore();
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<ClientSortKey>('updatedAt');
  const [dir, setDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);

  const filtered = useMemo(() => sortClients(searchClients(clients, query), sortKey, dir), [clients, query, sortKey, dir]);
  const pg = paginate(filtered, page, CLIENTS_PER_PAGE);
  const stats = clientStats(clients, now);
  const open = clients.find((c) => c.id === openId);

  useEffect(() => setPage(1), [query, sortKey, dir]);

  const toggleSort = (k: ClientSortKey) => {
    if (k === sortKey) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(k);
      setDir(k === 'name' ? 'asc' : 'desc');
    }
  };

  const exportCsv = () =>
    downloadCsv('clients.csv', [
      ['Client', 'Primary Email', 'Secondary Email', 'FICO', 'Monthly Income', 'DTI %', 'Updated', 'Last Sent', 'Last Client Activity'],
      ...filtered.map((c) => [c.name, c.primaryEmail, c.secondaryEmail ?? '', c.fico, c.monthlyIncome ?? '', c.dti ?? '', date(c.updatedAt), c.lastSent ? date(c.lastSent) : '', c.lastActivity ? date(c.lastActivity) : '']),
    ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Clients"
        title="Client Manager"
        subtitle="Every client, the reports you’ve sent them and when they last engaged. Click a client to see saved scenarios and run a tool."
        actions={
          <>
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportCsv}>
              Export CSV
            </Button>
            <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setAddOpen(true)}>
              Add Client
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Clients" value={stats.total} sub="In your book" />
        <StatTile label="Sent in last 30 days" value={stats.sentRecently} sub="Received a report" />
        <StatTile highlight tone="brand" label="Active in last 30 days" value={stats.activeRecently} sub="Opened or interacted" />
        <StatTile label="Never sent" value={stats.neverSent} sub="Follow-up opportunities" />
      </div>

      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <ClientSearch clients={clients} query={query} onQuery={setQuery} onPick={(c) => setOpenId(c.id)} />
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <Select
              ariaLabel="Sort clients"
              className="w-48 md:hidden"
              value={`${sortKey}:${dir}`}
              onChange={(v) => {
                const [k, d] = v.split(':') as [ClientSortKey, SortDir];
                setSortKey(k);
                setDir(d);
              }}
              options={SORT_OPTIONS}
            />
          <div className="text-sm tabular-nums text-slate-500">{query ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}` : `${clients.length} clients`}</div>
          </div>
        </div>

        {pg.total === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No clients match your search"
              icon={<Users className="h-8 w-8" />}
              action={
                <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setAddOpen(true)}>
                  Add “{query.trim()}”
                </Button>
              }
            >
              Check the spelling or add them as a new client.
            </EmptyState>
          </div>
        ) : (
          <>
          <ul className="divide-y divide-slate-100 md:hidden">
            {pg.items.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setOpenId(c.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-brand-50/40">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{initials(c.name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-900">{c.name}</span>
                    <span className="block truncate text-xs text-slate-500">{c.primaryEmail || 'No email'}</span>
                    <span className="mt-1.5 grid grid-cols-3 gap-2 text-[11px] text-slate-500">
                      <span>Updated<span className="block font-medium text-slate-800">{date(c.updatedAt, 'short')}</span></span>
                      <span>Last sent<span className="block font-medium text-slate-800">{c.lastSent ? date(c.lastSent, 'short') : '—'}</span></span>
                      <span>Activity<span className="block font-medium text-slate-800">{c.lastActivity ? date(c.lastActivity, 'short') : '—'}</span></span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60">
                  {COLUMNS.map((col) => {
                    const active = sortKey === col.key;
                    const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
                    return (
                      <th key={col.key} scope="col" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 first:pl-5">
                        <button type="button" onClick={() => toggleSort(col.key)} className={cx('inline-flex items-center gap-1 hover:text-slate-900', active && 'text-slate-900')}>
                          {col.label}
                          <Icon className={cx('h-3.5 w-3.5', !active && 'opacity-40')} />
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {pg.items.map((c) => (
                  <tr
                    key={c.id}
                    tabIndex={0}
                    onClick={() => setOpenId(c.id)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpenId(c.id))}
                    className="cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-brand-50/40 focus:bg-brand-50/60 focus:outline-none"
                  >
                    <td className="py-3 pl-5 pr-4">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{initials(c.name)}</span>
                        <span className="min-w-0">
                          <span className="block font-medium text-slate-900">{c.name}</span>
                          <span className="block max-w-[240px] truncate text-xs text-slate-500">{c.primaryEmail || 'No email'}</span>
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700">{date(c.updatedAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700">{c.lastSent ? date(c.lastSent) : <span className="text-slate-400">—</span>}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700">{c.lastActivity ? <ActivityCell iso={c.lastActivity} now={now} /> : <span className="text-slate-400">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}

        <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row sm:px-5">
          <div className="text-sm tabular-nums text-slate-500">{rangeLabel(pg)}</div>
          <nav aria-label="Pagination" className="flex items-center gap-1">
            <Button variant="ghost" size="sm" aria-label="Previous page" disabled={pg.page <= 1} onClick={() => setPage(pg.page - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {pageList(pg.page, pg.pageCount).map((n, i) =>
              n === '…' ? (
                <span key={`e${i}`} className="px-1 text-slate-400">
                  …
                </span>
              ) : (
                <button
                  key={n}
                  type="button"
                  aria-current={n === pg.page ? 'page' : undefined}
                  onClick={() => setPage(n)}
                  className={cx('h-8 min-w-8 rounded-lg px-2 text-[13px] font-medium tabular-nums', n === pg.page ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}
                >
                  {n}
                </button>
              ),
            )}
            <Button variant="ghost" size="sm" aria-label="Next page" disabled={pg.page >= pg.pageCount} onClick={() => setPage(pg.page + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </nav>
        </div>
      </Card>

      <div className="contents">
      <AddClientModal open={addOpen} onClose={() => setAddOpen(false)} initialName={pg.total === 0 ? query.trim() : ''} onAdded={(c) => { setQuery(''); setOpenId(c.id); }} />
      <ClientDrawer client={open} onClose={() => setOpenId(null)} />
      </div>
    </div>
  );
}

function ActivityCell({ iso, now }: { iso: string; now: Date }) {
  const days = Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000);
  return (
    <span className="inline-flex items-center gap-2">
      {date(iso)}
      {days <= 7 && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">New</span>}
    </span>
  );
}

/** Client name search: filters the table as you type; suggestions open a client directly. */
function ClientSearch({ clients, query, onQuery, onPick }: { clients: Client[]; query: string; onQuery: (q: string) => void; onPick: (c: Client) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const suggestions = useMemo(() => (query.trim() ? searchClients(clients, query).slice(0, 6) : []), [clients, query]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  useEffect(() => setActive(0), [query]);

  const pick = (c: Client) => {
    setOpen(false);
    onPick(c);
  };

  return (
    <div ref={wrap} className="relative w-full sm:max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        role="combobox"
        aria-label="Search clients by name"
        aria-expanded={open && suggestions.length > 0}
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        placeholder="Search client name…"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, suggestions.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && suggestions[active]) {
            e.preventDefault();
            pick(suggestions[active]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
        className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />
      {query && (
        <button type="button" aria-label="Clear search" onClick={() => onQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700">
          <X className="h-4 w-4" />
        </button>
      )}
      {open && suggestions.length > 0 && (
        <ul role="listbox" className="absolute z-40 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lift">
          {suggestions.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
                className={cx('flex w-full items-center gap-2 px-3 py-2 text-left text-sm', i === active ? 'bg-brand-50 text-brand-900' : 'text-slate-700')}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">{initials(c.name)}</span>
                <span className="min-w-0">
                  <span className="block truncate">{c.name}</span>
                  <span className="block truncate text-xs text-slate-500">{c.primaryEmail}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
