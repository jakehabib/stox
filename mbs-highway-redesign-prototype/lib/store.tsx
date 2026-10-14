'use client';

/**
 * Prototype app state: clients, saved scenarios, recent reports, co-branding.
 * Persisted to localStorage (per browser). Replace with your API in production —
 * every mutation goes through the functions on this context.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { buildDemoClients, type Client } from '@/data/mock/clients';
import { DEFAULT_COBRANDING, type CoBranding } from '@/data/mock/cobranding';
import { RECENT_REPORTS_SEED } from '@/data/mock/content';

export interface SavedScenario {
  id: string;
  toolId: string;
  title: string;
  clientId?: string;
  clientName?: string;
  savedAt: string;
  href: string;
  data?: unknown;
}

export interface Toast {
  id: number;
  message: string;
  tone?: 'success' | 'info' | 'warning';
}

interface StoreValue {
  ready: boolean;
  clients: Client[];
  addClient: (c: Omit<Client, 'id' | 'updatedAt'>) => Client;
  updateClient: (id: string, patch: Partial<Client>) => void;
  getClient: (id: string | undefined | null) => Client | undefined;
  scenarios: SavedScenario[];
  saveScenario: (s: Omit<SavedScenario, 'id' | 'savedAt'>) => SavedScenario;
  cobranding: CoBranding;
  setCobranding: (c: CoBranding) => void;
  toasts: Toast[];
  toast: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
}

const StoreContext = createContext<StoreValue | null>(null);
const KEY = 'mbsh-prototype-v1';

interface Persisted {
  clients: Client[];
  scenarios: SavedScenario[];
  cobranding: CoBranding;
}

function load(): Persisted | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [clients, setClients] = useState<Client[]>(() => buildDemoClients());
  const [scenarios, setScenarios] = useState<SavedScenario[]>(RECENT_REPORTS_SEED);
  const [cobranding, setCobranding] = useState<CoBranding>(DEFAULT_COBRANDING);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ready, setReady] = useState(false);
  const toastId = useRef(1);

  useEffect(() => {
    const p = load();
    if (p) {
      if (p.clients?.length) setClients(p.clients);
      if (p.scenarios) setScenarios(p.scenarios);
      if (p.cobranding) setCobranding(p.cobranding);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ clients, scenarios, cobranding } satisfies Persisted));
    } catch {
      /* storage unavailable — state still works for the session */
    }
  }, [ready, clients, scenarios, cobranding]);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (message: string, tone: Toast['tone'] = 'success') => {
      const id = toastId.current++;
      setToasts((t) => [...t, { id, message, tone }]);
      setTimeout(() => dismissToast(id), 3200);
    },
    [dismissToast],
  );

  const addClient = useCallback((c: Omit<Client, 'id' | 'updatedAt'>) => {
    const client: Client = { ...c, id: `c-${Date.now()}`, updatedAt: new Date().toISOString() };
    setClients((list) => [client, ...list]);
    return client;
  }, []);

  const updateClient = useCallback((id: string, patch: Partial<Client>) => {
    setClients((list) => list.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c)));
  }, []);

  const getClient = useCallback((id: string | undefined | null) => clients.find((c) => c.id === id), [clients]);

  const saveScenario = useCallback((s: Omit<SavedScenario, 'id' | 'savedAt'>) => {
    const sc: SavedScenario = { ...s, id: `s-${Date.now()}`, savedAt: new Date().toISOString() };
    setScenarios((list) => [sc, ...list.filter((x) => !(x.toolId === s.toolId && x.clientId === s.clientId && x.title === s.title))].slice(0, 60));
    return sc;
  }, []);

  const value = useMemo<StoreValue>(
    () => ({ ready, clients, addClient, updateClient, getClient, scenarios, saveScenario, cobranding, setCobranding, toasts, toast, dismissToast }),
    [ready, clients, addClient, updateClient, getClient, scenarios, saveScenario, cobranding, toasts, toast, dismissToast],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(StoreContext);
  if (!v) throw new Error('useStore must be used inside <StoreProvider>');
  return v;
}
