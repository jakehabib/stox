'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Scenario state mirrored into the URL (`?s=<base64 json>`), so Share links reopen the
 * exact scenario. Reads the URL once on mount; writes with replaceState (no history spam).
 */
export function useUrlState<T extends object>(defaults: T, key = 's'): [T, (next: T | ((prev: T) => T)) => void, boolean] {
  const [state, setState] = useState<T>(defaults);
  const [hydrated, setHydrated] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    try {
      const raw = new URLSearchParams(window.location.search).get(key);
      if (raw) {
        const parsed = JSON.parse(decodeURIComponent(escape(atob(raw))));
        setState((d) => ({ ...d, ...parsed }));
      }
    } catch {
      /* bad link — keep defaults */
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set(key, btoa(unescape(encodeURIComponent(JSON.stringify(state)))));
        window.history.replaceState(window.history.state, '', url.toString());
      } catch {
        /* ignore */
      }
    }, 250);
  }, [state, hydrated, key]);

  const set = useCallback((next: T | ((prev: T) => T)) => setState((prev) => (typeof next === 'function' ? (next as (p: T) => T)(prev) : next)), []);
  return [state, set, hydrated];
}
