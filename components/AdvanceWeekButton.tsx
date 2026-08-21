'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { advanceWeekAction, getLeaguePhaseAction, AdvanceMode } from '@/app/actions/league';
import { formatMoney } from '@/lib/cap';
import type { WeekReport, TrophyMoment as TrophyData, CoachPayload } from '@/lib/weekReport';
import { WeekReportPanel, WeekReportSpan } from '@/components/ds/WeekReportPanel';
import { TrophyMoment } from '@/components/ds/TrophyMoment';

/**
 * A refusal to advance, plus the sentence explaining it. The salary-cap gate
 * was the only one when this component was written, so the panel hard-coded
 * its heading and its "Open Cap Sheet" link; cut-down day now refuses too
 * (see trimRostersToLimit in lib/season.ts), and a roster-limit block reading
 * "Over the salary cap" would be a lie. Title and link travel with the block.
 */
interface CapBlock {
  teamAbbr: string;
  shortfall: number;
  path: { playerId: string; name: string; position: string; frees: number; deadMoney: number }[];
  summary: string;
  title?: string;
  href?: string;
  linkLabel?: string;
}

/** Phases that need the user to actually do something before the sim keeps going. */
const GATE_PHASES = new Set(['RESIGN', 'DRAFT', 'FANTASY_DRAFT']);

/**
 * Builds the ONE report a multi-week advance is allowed to show.
 *
 * This is the hard rule from the interruption budget: "a player who asked to
 * skip to the playoffs has explicitly asked not to be stopped." Seventeen
 * reports for one click would be intolerable, so every intermediate report is
 * collected and folded into a span strip — real per-week results, the record
 * at both ends of the run — while the panel itself renders the LAST week,
 * which is where the league actually now stands.
 */
/** "Weeks 8-10", or "Week 17 - The Final" when the span crosses into January. */
function spanLabel(first: string, last: string): string {
  if (first === last) return last;
  const a = /^Week (\d+)$/.exec(first);
  const b = /^Week (\d+)$/.exec(last);
  if (a && b) return `Weeks ${a[1]}\u2013${b[1]}`;
  return `${first} \u2013 ${last}`;
}

function foldSpan(reports: WeekReport[]): WeekReportSpan | null {
  if (reports.length < 2) return null;
  const first = reports[0];
  const last = reports[reports.length - 1];
  const withChange = reports.filter((r) => r.changed);
  return {
    weeks: reports.length,
    label: spanLabel(first.weekLabel, last.weekLabel),
    results: reports.map((r) => {
      if (!r.result) return { label: r.weekLabel, outcome: '—' as const, mine: null, theirs: null, oppAbbr: null };
      const me = r.result.userIsHome ? r.result.home : r.result.away;
      const them = r.result.userIsHome ? r.result.away : r.result.home;
      return { label: r.weekLabel, outcome: r.result.outcome, mine: me.score, theirs: them.score, oppAbbr: them.abbr };
    }),
    recordFrom: withChange[0]?.changed?.recordBefore ?? null,
    recordTo: withChange[withChange.length - 1]?.changed?.recordAfter ?? null,
    gamesPlayed: reports.reduce((n, r) => n + r.gamesPlayed, 0),
  };
}
const MAX_ITERATIONS = 60; // safety backstop, not a real target

/**
 * Normalize whichever refusal came back into the one shape the panel renders.
 * `capBlock` carries the cap gate's shortfall + escape path; `block` carries
 * any other gate's heading and its route to a fix.
 */
function blockShape(result: {
  capBlock?: { teamAbbr: string; shortfall: number; path: CapBlock['path'] } | null;
  block?: { title: string; href: string; linkLabel: string } | null;
}): Omit<CapBlock, 'summary'> | null {
  if (result.capBlock) return { ...result.capBlock, title: 'Over the salary cap', href: 'cap', linkLabel: 'Open Cap Sheet' };
  if (result.block) return { teamAbbr: '', shortfall: 0, path: [], ...result.block };
  return null;
}

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
  // The week report and the Tier-0 moment. Both are transient results of an
  // advance, not standing conditions, and both are dismissible without a
  // decision — so neither blocks anything the user wants to do next.
  const [report, setReport] = useState<{ report: WeekReport; span: WeekReportSpan | null; coach: (CoachPayload | null)[] } | null>(null);
  const [trophy, setTrophy] = useState<TrophyData | null>(null);
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
      if (result.blocked) { showBlock(result.summary, blockShape(result)); return; }
      finish(result.summary, result.report ? [result.report] : [], result.trophy ?? null);
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
      // Every week's report is collected and NONE of them are shown as they
      // arrive — the interruption budget's hardest rule. One report at the
      // end, covering the span.
      const reports: WeekReport[] = [];
      let earnedTrophy: TrophyData | null = null;
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
          showBlock(result.summary, blockShape(result));
          return;
        }
        lastSummary = result.summary;
        if (result.report) reports.push(result.report);
        // A season can only end once, so the first Tier-0 in the span is the
        // one — a run that passes through a title game and keeps going into
        // the offseason still shows exactly one.
        if (result.trophy && !earnedTrophy) earnedTrophy = result.trophy;
        phase = result.phase;
        week = result.week;
        iterations++;
        if (stopAfter(phase, week, mode, midseasonWeek, startPhase, iterations)) break;
      }
      setProgress(null);
      finish(
        iterations > 1 ? `Advanced ${iterations} week${iterations === 1 ? '' : 's'}. ${lastSummary}` : lastSummary,
        reports,
        earnedTrophy,
      );
    });
  };

  /**
   * One exit point for every advance that actually moved time.
   *
   * A report replaces the toast when there is one; a phase with nothing to
   * report (an offseason step, the preseason roll) still gets exactly the
   * toast it got before, unchanged. The Tier-0 moment supersedes both — but
   * only ever one of them is on screen at a time.
   */
  const finish = (text: string, reports: WeekReport[], earned: TrophyData | null) => {
    setCapBlock(null);
    router.refresh();
    if (earned) {
      setToast(null);
      setReport(null);
      setTrophy(earned);
      return;
    }
    if (reports.length > 0) {
      setToast(null);
      setTrophy(null);
      // Every week's coach payload travels, not just the last one. The
      // panel renders the final week's standings and the WHOLE span's
      // comments — "who carried the stretch" has no meaning inside one game.
      setReport({ report: reports[reports.length - 1], span: foldSpan(reports), coach: reports.map((r) => r.coach) });
      return;
    }
    showToast(text);
  };

  const showToast = (text: string) => {
    setToast(text);
    setCapBlock(null);
    setReport(null);
    setTrophy(null);
    router.refresh();
    setTimeout(() => setToast(null), 7000);
  };

  const showBlock = (summary: string, block: Omit<CapBlock, 'summary'> | null) => {
    setToast(null);
    setReport(null);
    setTrophy(null);
    setCapBlock(block ? { ...block, summary } : { teamAbbr: '', shortfall: 0, path: [], summary });
    router.refresh();
  };

  return (
    <div className="relative" ref={ref}>
      {trophy && <TrophyMoment data={trophy} leagueId={leagueId} onClose={() => setTrophy(null)} />}
      {!trophy && report && (
        <WeekReportPanel
          report={report.report}
          span={report.span}
          coach={report.coach}
          leagueId={leagueId}
          onClose={() => setReport(null)}
        />
      )}
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
            <div className="label-sm text-bad">{capBlock.title ?? 'Over the salary cap'}</div>
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
          <Link href={`/league/${leagueId}/${capBlock.href ?? 'cap'}`} onClick={() => setCapBlock(null)} className="btn-secondary w-full text-xs">
            {capBlock.linkLabel ?? 'Open Cap Sheet'}
          </Link>
        </div>
      )}
    </div>
  );
}
