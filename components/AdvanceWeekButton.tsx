'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { advanceWeekAction, getLeaguePhaseAction, AdvanceMode } from '@/app/actions/league';
import { formatMoney } from '@/lib/cap';

/** The salary-cap compliance refusal, plus the sentence explaining it. */
interface CapBlock {
  teamAbbr: string;
  shortfall: number;
  path: { playerId: string; name: string; position: string; frees: number; deadMoney: number }[];
  summary: string;
}

/** Phases that need the user to actually do something before the sim keeps going. */
const GATE_PHASES = new Set(['RESIGN', 'DRAFT', 'FANTASY_DRAFT']);
const MAX_ITERATIONS = 60; // safety backstop, not a real target

const PHASE_NOUN: Record<string, string> = {
  PRESEASON: 'preseason', REGULAR: 'week', PLAYOFFS: 'playoff round', OFFSEASON: 'offseason step',
  FREE_AGENCY: 'free agency week',
};

/**
 * The dropdown used to show the same five options ("Advance to Midseason",
 * "Advance to Playoffs", ...) no matter what phase the league was actually
 * in — once you were already past the regular season those targets either
 * did nothing or silently collapsed to a 1-step advance, which read as
 * broken. Options are now built from the phase actually on screen.
 */
function optionsFor(phase: string): { mode: AdvanceMode; label: string }[] {
  if (GATE_PHASES.has(phase)) return []; // nothing to multi-advance into — resolve this stage first
  if (phase === 'OFFSEASON') {
    return [
      { mode: 'week', label: 'Advance 1 Step' },
      { mode: 'nextstage', label: 'Advance to Re-sign Window' },
    ];
  }
  if (phase === 'FREE_AGENCY') {
    return [
      { mode: 'week', label: 'Advance 1 Week' },
      { mode: '3weeks', label: 'Advance 3 Weeks' },
      { mode: 'nextstage', label: 'Advance to Draft' },
    ];
  }
  if (phase === 'PLAYOFFS') {
    return [
      { mode: 'week', label: 'Advance 1 Round' },
      { mode: 'offseason', label: 'Advance to Offseason' },
    ];
  }
  // PRESEASON / REGULAR
  return [
    { mode: 'week', label: 'Advance 1 Week' },
    { mode: '3weeks', label: 'Advance 3 Weeks' },
    { mode: 'midseason', label: 'Advance to Midseason' },
    { mode: 'playoffs', label: 'Advance to Playoffs' },
    { mode: 'offseason', label: 'Advance to Offseason' },
  ];
}

function stopBefore(phase: string, week: number, mode: AdvanceMode, midseasonWeek: number): boolean {
  if (GATE_PHASES.has(phase)) return true;
  if (mode === 'midseason' && phase === 'REGULAR' && week >= midseasonWeek) return true;
  if (mode === 'playoffs' && phase === 'PLAYOFFS') return true;
  if (mode === 'offseason' && phase === 'OFFSEASON') return true;
  return false;
}

function stopAfter(phase: string, week: number, mode: AdvanceMode, midseasonWeek: number, startPhase: string, iterations: number): boolean {
  if (GATE_PHASES.has(phase)) return true;
  if (mode === '3weeks' && (iterations >= 3 || phase !== startPhase)) return true;
  if (mode === 'midseason' && (phase !== 'REGULAR' || week >= midseasonWeek)) return true;
  if (mode === 'playoffs' && phase !== 'REGULAR' && phase !== 'PRESEASON') return true;
  if (mode === 'offseason' && phase === 'OFFSEASON') return true;
  if (mode === 'nextstage' && phase !== startPhase) return true;
  return false;
}

export function AdvanceWeekButton({ leagueId, currentPhase }: { leagueId: string; currentPhase: string }) {
  const OPTIONS = optionsFor(currentPhase);
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  // A cap block isn't a transient result — it's a standing condition the user
  // has to act on — so it gets its own sticky panel instead of a toast that
  // disappears after 7 seconds and leaves a button that just doesn't work.
  const [capBlock, setCapBlock] = useState<CapBlock | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
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
      setProgress('Simulating…');
      const result = await advanceWeekAction(leagueId);
      setProgress(null);
      if (result.blocked) { showBlock(result.summary, result.capBlock ?? null); return; }
      showToast(result.summary);
    });
  };

  const runMultiple = (mode: AdvanceMode) => {
    setMenuOpen(false);
    if (mode === 'week') return runSingle();
    startTransition(async () => {
      const initial = await getLeaguePhaseAction(leagueId);
      const midseasonWeek = Math.ceil(initial.seasonLength / 2);
      const startPhase = initial.phase;

      if (stopBefore(initial.phase, initial.week, mode, midseasonWeek)) {
        showToast('Nothing to advance right now — handle what\'s in front of you first.');
        return;
      }

      let iterations = 0;
      let lastSummary = '';
      let phase = initial.phase;
      let week = initial.week;
      // Driving this one week at a time from the client (instead of one
      // opaque server-side loop) is what makes real progress visible —
      // "Simulating Week 3…" — instead of a single static spinner label
      // for however long the whole batch takes.
      while (iterations < MAX_ITERATIONS) {
        setProgress(`Simulating ${PHASE_NOUN[phase] ?? 'step'} ${week}…`);
        const result = await advanceWeekAction(leagueId);
        // The cap gate refused to move time — stop the batch immediately
        // rather than spinning MAX_ITERATIONS times against a closed door.
        if (result.blocked) {
          setProgress(null);
          showBlock(result.summary, result.capBlock ?? null);
          return;
        }
        lastSummary = result.summary;
        phase = result.phase;
        week = result.week;
        iterations++;
        if (stopAfter(phase, week, mode, midseasonWeek, startPhase, iterations)) break;
      }
      setProgress(null);
      showToast(iterations > 1 ? `Advanced ${iterations} week${iterations === 1 ? '' : 's'}. ${lastSummary}` : lastSummary);
    });
  };

  const showToast = (text: string) => {
    setToast(text);
    setCapBlock(null);
    router.refresh();
    setTimeout(() => setToast(null), 7000);
  };

  const showBlock = (summary: string, block: Omit<CapBlock, 'summary'> | null) => {
    setToast(null);
    setCapBlock(block ? { ...block, summary } : { teamAbbr: '', shortfall: 0, path: [], summary });
    router.refresh();
  };

  return (
    <div className="relative" ref={ref}>
      <div className="flex">
        <button onClick={runSingle} disabled={pending} className={`btn-primary ${OPTIONS.length > 0 ? 'rounded-r-none' : ''}`}>
          {pending ? (progress ?? 'Simulating…') : 'Advance ▸'}
        </button>
        {OPTIONS.length > 0 && (
          <button
            onClick={() => setMenuOpen((v) => !v)}
            disabled={pending}
            className="btn-primary rounded-l-none border-l border-black/20 px-2"
            aria-label="More advance options"
          >
            ▾
          </button>
        )}
      </div>
      {menuOpen && OPTIONS.length > 0 && (
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
      {pending && progress && (
        <div className="absolute right-0 top-full mt-2 w-72 card card-pad text-sm z-30 animate-fadeUp shadow-lg flex items-center gap-2.5">
          <span className="w-3.5 h-3.5 rounded-full border-2 border-accent/30 border-t-accent animate-spin shrink-0" />
          {progress}
        </div>
      )}
      {!pending && toast && (
        <div className="absolute right-0 top-full mt-2 w-80 card card-pad text-sm z-30 animate-fadeUp shadow-lg">
          {toast}
        </div>
      )}
      {!pending && capBlock && (
        <div className="absolute right-0 top-full mt-2 w-[22rem] card card-pad z-30 animate-fadeUp shadow-lg border-bad/40 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="label-sm text-bad">Over the salary cap</div>
            <button onClick={() => setCapBlock(null)} className="text-muted hover:text-chalk text-xs leading-none" aria-label="Dismiss">✕</button>
          </div>
          {capBlock.shortfall > 0 && (
            <div className="stat-value text-stat-md text-bad">{formatMoney(capBlock.shortfall)} over</div>
          )}
          <p className="text-sm text-muted">{capBlock.summary}</p>
          {capBlock.path.length > 0 && (
            <div className="panel p-3 space-y-1.5">
              <div className="label-sm">Fastest route back</div>
              {capBlock.path.map((c) => (
                <div key={c.playerId} className="flex justify-between gap-3 text-xs">
                  <span className="truncate">Cut {c.name} <span className="text-muted">({c.position})</span></span>
                  <span className="font-mono text-accent shrink-0">+{formatMoney(c.frees)}</span>
                </div>
              ))}
            </div>
          )}
          <Link href={`/league/${leagueId}/cap`} onClick={() => setCapBlock(null)} className="btn-secondary w-full text-xs">
            Open Cap Sheet
          </Link>
        </div>
      )}
    </div>
  );
}
