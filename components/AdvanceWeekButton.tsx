'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { advanceWeekAction, getLeaguePhaseAction, AdvanceMode } from '@/app/actions/league';
import { formatMoney } from '@/lib/cap';
import type { WeekReport, TrophyMoment as TrophyData, CoachPayload } from '@/lib/weekReport';
import { WeekReportPanel, WeekReportSpan } from '@/components/ds/WeekReportPanel';
import { TrophyMoment } from '@/components/ds/TrophyMoment';
import { SeasonEndCard } from '@/components/ds/SeasonEndCard';
import { foldSeasonEnd, SeasonEndSummary } from '@/lib/seasonEndCard';

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
  PRESEASON: 'preseason week', REGULAR: 'week', PLAYOFFS: 'playoff round', OFFSEASON: 'offseason step',
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
    // No "Advance 3 Weeks" here any more: free agency is FREE_AGENCY.WEEKS
    // long and that is now three, so the option was a second button that did
    // exactly what "Advance to Draft" does — two ways to spell one jump.
    return [
      { mode: 'week', label: 'Advance 1 Week' },
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
  // The third artifact, and the narrowest: a long advance that ended in the
  // postseason. It is not a trophy with a report behind it — see finish().
  const [seasonEnd, setSeasonEnd] = useState<{ data: TrophyData; season: SeasonEndSummary } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  /**
   * IS AN ADVANCE ALREADY IN FLIGHT FROM THIS BUTTON?
   *
   * `disabled={pending}` looks like it answers that and does not. `pending`
   * comes from useTransition, and on React 18.3 it goes false at the FIRST
   * `await` inside the transition — so the button re-enables the instant the
   * server action is dispatched and stays enabled for the whole two or three
   * seconds the advance actually takes. A double click sends two.
   *
   * A ref, not state: it has to be readable and writable synchronously inside
   * the same click handler, and a state update would not be visible until the
   * next render — which is exactly the window being closed.
   *
   * THIS IS THE OPTIMISATION, NOT THE GUARANTEE. It saves a wasted round trip
   * and a refusal the user did not need to see. It cannot speak for a second
   * tab, a phone, or a page left open since yesterday, so the server takes a
   * lease of its own and refuses the second press outright — see advanceWeek
   * in lib/season.ts. Never one instead of the other.
   */
  const inFlight = useRef(false);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const runSingle = () => {
    setMenuOpen(false);
    if (inFlight.current) return;
    inFlight.current = true;
    startTransition(async () => {
      try {
        setProgress('Working…');
        const result = await advanceWeekAction(leagueId);
        setProgress(null);
        if (result.blocked) { refuse(result); return; }
        finish(result.summary, result.report ? [result.report] : [], result.trophy ?? null);
      } finally {
        // In a finally so a server action that throws does not leave the
        // button dead for the rest of the page's life.
        inFlight.current = false;
      }
    });
  };

  const runMultiple = (mode: AdvanceMode) => {
    setMenuOpen(false);
    // AFTER the delegation, never before: runSingle takes the flag itself, and
    // taking it here first would make it refuse the click it was handed.
    if (mode === 'week') return runSingle();
    if (inFlight.current) return;
    inFlight.current = true;
    startTransition(async () => {
      try {
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
        // "Working through week 3…" — instead of a single static spinner label
        // for however long the whole batch takes.
        while (iterations < MAX_ITERATIONS) {
          setProgress(`Working through ${PHASE_NOUN[phase] ?? 'step'} ${week}…`);
          const result = await advanceWeekAction(leagueId);
          // The cap gate refused to move time — stop the batch immediately
          // rather than spinning MAX_ITERATIONS times against a closed door.
          if (result.blocked) {
            setProgress(null);
            refuse(result);
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
      } finally {
        inFlight.current = false;
      }
    });
  };

  /**
   * A refusal to advance. Two shapes, and the difference is whether there is
   * anything for the user to DO about it.
   *
   * The cap gate and the roster-limit gate are standing conditions with a
   * screen behind them, so they get the sticky panel and its link. "The last
   * advance is still being played out" is neither — it is a busy signal that
   * clears itself, with nowhere to send anybody — so it gets a toast, the same
   * as any other passing sentence. Rendering it in the block panel would put a
   * red heading and an "Open Cap Sheet" button on a league with nothing wrong
   * with it.
   */
  const refuse = (result: { summary: string } & Parameters<typeof blockShape>[0]) => {
    const shape = blockShape(result);
    if (shape) showBlock(result.summary, shape);
    else showToast(result.summary);
  };

  /**
   * One exit point for every advance that actually moved time.
   *
   * A report replaces the toast when there is one; a phase with nothing to
   * report (an offseason step, the preseason roll) still gets exactly the
   * toast it got before, unchanged. A Tier-0 moment supersedes both.
   *
   * There are now THREE artifacts this can raise and the rule has not moved:
   * only ever ONE of them is on screen at a time. The third is not a fourth
   * tier and it is not two artifacts queued — it is the one screen that owns
   * the intersection where a Tier-0 moment and a whole stretch of season
   * arrive on the same press. See the gate below.
   */
  const finish = (text: string, reports: WeekReport[], earned: TrophyData | null) => {
    setCapBlock(null);
    router.refresh();
    // Every week's coach payload travels, not just the last one. The panel
    // renders the final week's standings and the WHOLE span's comments — "who
    // carried the stretch" has no meaning inside one game.
    //
    // `span` is null for a single advance and non-null the moment two or more
    // weeks were folded together, so it is also the honest test for "did this
    // press cover a stretch" — see foldSpan, which returns null under two
    // reports. A multi-advance that only got one step in (Advance to Offseason
    // pressed on the final itself) has no stretch and is not treated as one.
    const span = foldSpan(reports);
    const staged = reports.length > 0
      ? { report: reports[reports.length - 1], span, coach: reports.map((r) => r.coach) }
      : null;

    if (earned) {
      setToast(null);
      setReport(null);
      /*
       * THE GATE. Four combinations, and this branch owns two of them.
       *
       * THE BUG IT REPLACES: this branch used to call setReport(null) and
       * raise the trophy, full stop. So a club that missed the playoffs and
       * jumped twenty-two weeks got the whole span strip — every result, both
       * records, every injury — and a club that WON THE TITLE on the same
       * press got the ring and had those twenty-two weeks discarded. The
       * season you would most want the record of was the one that threw it
       * away.
       *
       * The fix is NOT to queue the span behind the trophy. The interruption
       * budget's rule is that the Tier-0 moment supersedes both and only ever
       * one of them is on screen at a time, and two artifacts back to back is
       * that rule with the corner filed off. Instead the intersection —
       * a long stretch AND a season that ended — is its own event and gets its
       * own single artifact, which tells the season and the title as one
       * thing. Nothing is stacked and nothing is thrown away.
       *
       *   single advance, no trophy  → the week report      (below)
       *   single advance, trophy     → the trophy moment    (here, span null)
       *   multi advance,  no trophy  → the span strip       (below)
       *   multi advance,  trophy     → the season-end card  (here, span set)
       *
       * `earned` is at most one per run however far the batch travelled —
       * runMultiple keeps the FIRST Tier-0 it sees, so a jump that passes
       * through the title game and carries on into the offseason still arrives
       * here with exactly one. Both its kinds are handled: CHAMPION and the
       * elimination that ends everyone else's January are the same event from
       * the card's point of view, which is that the year is over, and the
       * twenty-two weeks were being destroyed for both of them.
       */
      if (span) {
        setTrophy(null);
        setSeasonEnd({ data: earned, season: foldSeasonEnd(reports) });
        return;
      }
      setSeasonEnd(null);
      setTrophy(earned);
      return;
    }
    if (staged) {
      setToast(null);
      setTrophy(null);
      setSeasonEnd(null);
      setReport(staged);
      return;
    }
    showToast(text);
  };

  const showToast = (text: string) => {
    setToast(text);
    setCapBlock(null);
    setReport(null);
    setTrophy(null);
    setSeasonEnd(null);
    router.refresh();
    setTimeout(() => setToast(null), 7000);
  };

  const showBlock = (summary: string, block: Omit<CapBlock, 'summary'> | null) => {
    setToast(null);
    setReport(null);
    setTrophy(null);
    setSeasonEnd(null);
    setCapBlock(block ? { ...block, summary } : { teamAbbr: '', shortfall: 0, path: [], summary });
    router.refresh();
  };

  return (
    <div className="relative" ref={ref}>
      {/* Exactly one of these three is ever set — finish() clears the other
          two on every path — but the guards are kept anyway, because the cost
          of being wrong here is two full-screen overlays at once. */}
      {seasonEnd && (
        <SeasonEndCard
          data={seasonEnd.data}
          season={seasonEnd.season}
          leagueId={leagueId}
          onClose={() => setSeasonEnd(null)}
        />
      )}
      {!seasonEnd && trophy && <TrophyMoment data={trophy} leagueId={leagueId} onClose={() => setTrophy(null)} />}
      {!trophy && !seasonEnd && report && (
        <WeekReportPanel
          report={report.report}
          span={report.span}
          coach={report.coach}
          leagueId={leagueId}
          onClose={() => setReport(null)}
          // The panel covers this button while it is open (see the footer
          // comment in WeekReportPanel), so the loop has to be able to
          // continue from inside it. Same handler the header button runs.
          onAdvance={runSingle}
        />
      )}
      <div className="flex">
        <button onClick={runSingle} disabled={pending} className={`btn-primary ${OPTIONS.length > 0 ? 'rounded-r-none' : ''}`}>
          {pending ? (progress ?? 'Working…') : 'Advance ▸'}
        </button>
        {OPTIONS.length > 0 && (
          /* THIS STAYS A BARE ▾ ON PURPOSE, and it was briefly not one.
             It carried a "Jump ahead" label for a while on the grounds that a
             playtester never found the menu. But the cadence has been ruled
             on: watching a season go past one week at a time IS the game, and
             the offseason is already the truncated part. A word on this
             control advertises the skip next to the button whose whole job is
             not to be skipped. The menu keeps its accessible name and its
             expanded state for anyone navigating by keyboard or screen
             reader; what it does not get is a poster. */
          <button
            onClick={() => setMenuOpen((v) => !v)}
            disabled={pending}
            className="btn-primary rounded-l-none border-l border-black/20 px-2"
            aria-label="More advance options"
            aria-expanded={menuOpen}
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
