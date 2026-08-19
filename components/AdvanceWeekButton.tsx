'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { advanceWeekAction, advanceMultipleAction, AdvanceMode } from '@/app/actions/league';

const OPTIONS: { mode: AdvanceMode; label: string }[] = [
  { mode: 'week', label: 'Advance 1 Week' },
  { mode: '3weeks', label: 'Advance 3 Weeks' },
  { mode: 'midseason', label: 'Advance to Midseason' },
  { mode: 'playoffs', label: 'Advance to Playoffs' },
  { mode: 'offseason', label: 'Advance to Offseason' },
];

export function AdvanceWeekButton({ leagueId }: { leagueId: string }) {
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const runSingle = () => {
    setMenuOpen(false);
    startTransition(async () => {
      const result = await advanceWeekAction(leagueId);
      showToast(result.summary);
    });
  };

  const runMultiple = (mode: AdvanceMode) => {
    setMenuOpen(false);
    if (mode === 'week') return runSingle();
    startTransition(async () => {
      const result = await advanceMultipleAction(leagueId, mode);
      showToast(
        result.weeksAdvanced > 1
          ? `Advanced ${result.weeksAdvanced} week${result.weeksAdvanced === 1 ? '' : 's'}. ${result.summary}`
          : result.summary,
      );
    });
  };

  const showToast = (text: string) => {
    setToast(text);
    router.refresh();
    setTimeout(() => setToast(null), 7000);
  };

  return (
    <div className="relative" ref={ref}>
      <div className="flex">
        <button onClick={runSingle} disabled={pending} className="btn-primary rounded-r-none">
          {pending ? 'Simulating…' : 'Advance ▸'}
        </button>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          disabled={pending}
          className="btn-primary rounded-l-none border-l border-black/20 px-2"
          aria-label="More advance options"
        >
          ▾
        </button>
      </div>
      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 w-56 card py-1 z-30 animate-fadeUp shadow-lg">
          {OPTIONS.map((o) => (
            <button
              key={o.mode}
              onClick={() => runMultiple(o.mode)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-raised transition-colors"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      {toast && (
        <div className="absolute right-0 top-full mt-2 w-80 card card-pad text-sm z-30 animate-fadeUp shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
