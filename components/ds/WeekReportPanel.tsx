'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import type { WeekReport, ReportSide, CoachPayload } from '@/lib/weekReport';
import { ordinal } from '@/lib/standingsOrder';
import { marginPhrase } from '@/lib/gameShape';
import { TeamLogo } from '../TeamLogo';
import { PlayerAvatar } from '../PlayerAvatar';
import { GameShapePath, ArchetypeTag, QuarterAxis } from './GameShapePath';
import { QuarterLinescore } from './QuarterLinescore';
import { ResultKicker } from './ResultWeight';
import { CoachComments } from './CoachComments';

/**
 * ===========================================================================
 * THE WEEK REPORT PANEL — what Advance ▸ produces now
 * ===========================================================================
 * This replaces a 320px toast that read "Week 8 complete: 16 games played."
 * for seven seconds and did not contain the user's own score.
 *
 * INTERRUPTION BUDGET (see docs/design-research/moments/findings.md, Part 3).
 * This is Tier 1, and Tier 1's whole licence is that it costs zero extra
 * clicks. So it closes on Escape, on a click anywhere outside it, on any link
 * inside it, and on Close — four ways out, none of them mandatory. Getting
 * that wrong turns it into a required click seventeen times a season, which
 * is the single most likely way this fails.
 *
 * "Zero extra clicks" was a claim, and it was false for the one press that
 * matters most: taking the NEXT week. This overlay covers the league header,
 * so the Advance button the reader just used is underneath it and a click
 * aimed at it only dismisses the panel. That is why the pinned action bar at
 * the bottom of this file carries its own Advance. See the comment there.
 *
 * It also has to visibly differ by outcome, or it becomes wallpaper: a
 * one-point win and a thirty-point loss produce different score weights,
 * different shape silhouettes, and a different archetype word.
 * ===========================================================================
 */

export interface WeekReportSpan {
  /** How many advances this report covers. 1 for a single week. */
  weeks: number;
  label: string;
  /** One chip per week of the span, oldest first. */
  results: { label: string; outcome: 'W' | 'L' | 'T' | '—'; mine: number | null; theirs: number | null; oppAbbr: string | null }[];
  recordFrom: string | null;
  recordTo: string | null;
  gamesPlayed: number;
}

export function WeekReportPanel({ report, span, coach, onClose, onAdvance, leagueId }: {
  report: WeekReport;
  span?: WeekReportSpan | null;
  /**
   * Every week of the advance, oldest first — not just the one being
   * rendered. Coach's Comments summarises a SPAN rather than repeating seven
   * single-week blocks, and it cannot do that from the last week alone.
   * Defaults to this report's own payload for a single advance.
   */
  coach?: (CoachPayload | null | undefined)[];
  onClose: () => void;
  /**
   * Take one more week without leaving the panel. Optional so the panel still
   * renders standalone (a screenshot harness, a story) — without it the footer
   * is exactly what it was, one dismiss button.
   */
  onAdvance?: () => void;
  leagueId: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const r = report.result;
  const multi = (span?.weeks ?? 1) > 1;

  // Portalled to <body>. The league header this button lives in carries
  // `backdrop-blur`, and a backdrop-filter makes its element the containing
  // block for every fixed-position descendant — so a full-viewport overlay
  // rendered in place gets pinned to, and clipped by, a 60px header strip.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-3 sm:p-6 report-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes report-in { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
        .report-panel { animation: report-in .22s ease-out both; }
        .report-backdrop { animation: report-in .18s ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .report-panel, .report-backdrop { animation: none; }
        }
      ` }} />

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${report.weekLabel} report`}
        className="report-panel card w-full max-w-3xl my-auto outline-none"
        style={{
          ['--team-accent' as never]: report.teamColor ?? undefined,
          backgroundImage: report.teamColor
            ? `radial-gradient(ellipse 90% 60% at 50% -10%, color-mix(in srgb, var(--team-accent) 14%, transparent), transparent 70%)`
            : undefined,
        }}
      >
        <div className="p-5 sm:p-6 space-y-4">

          {/* --- header ------------------------------------------------- */}
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-line">
            <h2 className="font-display font-extrabold uppercase tracking-wide text-lg sm:text-xl leading-none">
              {multi ? span!.label : report.weekLabel}
              <span className="text-muted font-semibold"> {multi ? 'are behind you' : 'is in the books'}</span>
            </h2>
            <div className="flex items-center gap-3 shrink-0">
              <span className="label-sm hidden sm:inline">{report.seasonYear} · {report.phaseLabel}</span>
              <button onClick={onClose} aria-label="Close report" className="text-muted hover:text-chalk text-sm leading-none px-1">✕</button>
            </div>
          </div>

          {/* --- multi-advance span strip -------------------------------- */}
          {multi && span && (
            <div className="panel px-3 py-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="label-sm shrink-0">{span.weeks} advances</span>
                {span.results.map((g, i) => (
                  <span
                    key={i}
                    className={`font-mono text-[11px] px-1.5 py-0.5 rounded border tabular-nums ${
                      g.outcome === 'W' ? 'border-accent/40 text-accent bg-accent/10'
                        : g.outcome === 'L' ? 'border-bad/40 text-bad bg-bad/10'
                        : 'border-line text-muted'
                    }`}
                    title={g.label}
                  >
                    {g.outcome}{g.mine !== null ? ` ${g.mine}-${g.theirs}` : ''}{g.oppAbbr ? ` ${g.oppAbbr}` : ''}
                  </span>
                ))}
                {span.recordFrom && span.recordTo && (
                  <span className="ml-auto font-mono text-xs text-muted">
                    {span.recordFrom} → <b className="text-chalk">{span.recordTo}</b>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* --- band 1: your result ------------------------------------ */}
          {r ? (
            <>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-5 pt-2">
                <ScoreSide side={r.away} align="left" />
                <div className="text-center min-w-[72px] sm:min-w-[92px]">
                  {r.shape && <ArchetypeTag shape={r.shape} />}
                  <div className="font-mono text-[11px] text-muted mt-1">
                    {r.outcome === 'T' ? 'tied' : marginPhrase(r.margin)}
                    {r.overtime && <span className="text-accent2"> · OT</span>}
                  </div>
                  <div className="label-sm mt-0.5">
                    {r.userIsHome ? 'at home' : 'on the road'}
                  </div>
                  <div className="mt-1.5 flex flex-col items-center gap-1">
                    {r.upset && r.winChancePre !== null && (
                      <ResultKicker label={`UPSET · ${r.winChancePre}% TO WIN`} />
                    )}
                    {!r.upset && r.winChancePre !== null && (
                      <span className="font-mono text-[10px] text-muted">was {r.winChancePre}% to win</span>
                    )}
                  </div>
                </div>
                <ScoreSide side={r.home} align="right" />
              </div>

              {r.shape && (
                <div>
                  <GameShapePath
                    shape={r.shape}
                    color={report.teamColor ?? undefined}
                    width={640}
                    height={120}
                    variant="full"
                    animate
                  />
                  <QuarterAxis shape={r.shape} width={640} />
                  <p className="text-[11px] text-muted mt-1.5">
                    Score differential across {r.shape.points.length - 1} drives · {r.shape.note}
                    {r.shape.leadChanges > 0 && ` · ${r.shape.leadChanges} lead change${r.shape.leadChanges === 1 ? '' : 's'}`}
                  </p>
                </div>
              )}

              {r.recap && (
                <p className="text-sm leading-relaxed text-chalk/90 border-l-2 pl-3.5 py-0.5"
                   style={{ borderColor: 'var(--team-accent, #38bdf8)' }}>
                  {r.recap}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted py-2">
              {report.gamesPlayed} game{report.gamesPlayed === 1 ? '' : 's'} played around the league.
              {report.nextNote ? ` ${report.nextNote}` : ' Your club was not on the slate.'}
            </p>
          )}

          {/* --- bands 2-4 ---------------------------------------------- */}
          {/* One column when there is no standings band — a postseason round
              does not move the standings, and a half-empty two-column grid
              reads as a rendering failure. */}
          <div className={`grid gap-3 ${report.changed ? 'md:grid-cols-2' : ''}`}>
            {report.changed && <ChangedBand report={report} />}
            <div className="panel p-4 space-y-3">
              {report.gameBall && (
                <div>
                  <h3 className="label-sm mb-2.5">Game ball</h3>
                  <div className="flex items-center gap-3">
                    <PlayerAvatar
                      seed={report.gameBall.playerId}
                      age={report.gameBall.age}
                      size={44}
                      teamColor={report.gameBall.teamColor}
                      weightLb={report.gameBall.weightLb}
                      heightIn={report.gameBall.heightIn}
                      position={report.gameBall.position}
                      className="shrink-0"
                    />
                    <div className="min-w-0">
                      <Link
                        href={`/league/${leagueId}/player/${report.gameBall.playerId}`}
                        onClick={onClose}
                        className="font-display font-bold text-base leading-none hover:text-accent2 transition-colors"
                      >
                        {report.gameBall.name}
                      </Link>
                      <span className="ml-2 text-[10px] font-extrabold tracking-wider text-muted border border-line rounded px-1 py-px align-middle">
                        {report.gameBall.position}
                      </span>
                      <div className="font-mono text-[11px] text-muted mt-1 leading-snug">{report.gameBall.line}</div>
                      {/* What the afternoon was worth to HIM. Kept to four
                          words because it is context on a stat line, not a
                          second headline. */}
                      {report.gameBall.contractYear && (
                        <div className="text-[11px] text-warn mt-0.5 leading-snug">Final year of his deal</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <h3 className="label-sm mb-2">The room</h3>
                <div className="space-y-1.5">
                  {/* THE REPORT NAMES A MAN AND USED TO OFFER NOTHING.
                      "Carter Hargrove left the game and is expected to miss 3
                      weeks" was a dead end: no way to look at him, no way to do
                      anything about it. Two links now, and deliberately no
                      third one — the depth chart is NOT offered here, because
                      lib/sim/units.ts drops unavailable players before depth
                      order is applied, so reordering around an injury changes
                      nothing on Sunday and telling a GM otherwise would be
                      inventing a chore. What is real is the wire. */}
                  {report.injuries.map((inj, i) => (
                    <RoomRow key={`inj-${i}`} dot="bg-bad">
                      <Link
                        href={`/league/${leagueId}/player/${inj.playerId}`}
                        onClick={onClose}
                        className="font-bold hover:text-accent2 transition-colors"
                      >
                        {inj.name}
                      </Link>
                      {inj.position ? ` (${inj.position})` : ''} — {inj.type.toLowerCase()}, out {inj.weeks} week{inj.weeks === 1 ? '' : 's'}
                      {/* A week or two is what a backup is for. Three is a
                          fifth of the season, which is the point at which
                          looking at the wire is a real move rather than a
                          twitch — so the offer appears then, and it is an
                          offer to LOOK, not an instruction to sign. */}
                      {inj.weeks >= 3 && inj.position && (
                        <Link
                          href={`/league/${leagueId}/free-agency?pos=${inj.position}`}
                          onClick={onClose}
                          className="block text-[11px] text-accent2 hover:underline mt-0.5"
                        >
                          See who is available at {inj.position} →
                        </Link>
                      )}
                    </RoomRow>
                  ))}
                  {report.headlines.map((h, i) => (
                    <RoomRow key={`hl-${i}`} dot={h.mine ? 'bg-accent' : 'bg-accent2'}>
                      {h.headline}
                      {h.detail && <span className="block text-muted text-[11px]">{h.detail}</span>}
                    </RoomRow>
                  ))}
                  {report.otherInjuryCount > 0 && (
                    <RoomRow dot="bg-muted">
                      <span className="text-muted">{report.otherInjuryCount} other injury report{report.otherInjuryCount === 1 ? '' : 's'} across the league</span>
                    </RoomRow>
                  )}
                  {report.injuries.length === 0 && report.headlines.length === 0 && report.otherInjuryCount === 0 && (
                    <p className="text-xs text-muted">A quiet week everywhere else.</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* --- Coach's comments (collapsed) --------------------------- */}
          {/* Expandable, and closed every time it is opened fresh: this panel
              sits on a path the user walks seventeen times a season, so
              nothing that is not mandatory may be on it by default. Nothing
              inside CoachComments runs until it is opened. */}
          <CoachComments
            payloads={coach && coach.length > 0 ? coach : [report.coach]}
            leagueId={leagueId}
            teamColor={report.teamColor}
            gameBallId={report.gameBall?.playerId ?? null}
            onNavigate={onClose}
          />

          {/* --- band 5: what's next ------------------------------------ */}
          {report.next ? (
            <div className="panel flex items-center gap-3 px-4 py-3">
              <span className="label-sm shrink-0 hidden sm:inline">Next up</span>
              <TeamLogo seed={report.next.oppId} abbr={report.next.oppAbbr} size={26} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-display font-bold text-sm leading-tight">
                  {report.next.atHome ? 'vs' : '@'} {report.next.oppCity} {report.next.oppNickname}
                  <span className="text-muted font-semibold font-mono text-xs ml-1.5">{report.next.oppRecord}</span>
                </div>
                {report.next.stakes && <div className="text-warn text-[11px] font-medium mt-0.5">{report.next.stakes}</div>}
              </div>
              {report.next.winChance !== null && (
                <span className="font-mono text-[11px] bg-raised border border-line rounded-full px-2.5 py-1 shrink-0"
                      title="Same estimate the dashboard shows — roster gap, unit matchups, form, home field.">
                  {report.next.winChance}% win
                </span>
              )}
            </div>
          ) : report.nextNote && r ? (
            <div className="panel px-4 py-3 text-sm text-muted">{report.nextNote}</div>
          ) : null}

          {/* Linescore last of the bands: it is reference, not headline. The
              action bar below it is pinned, so nothing is buried under this. */}
          {r?.quarters && (
            <details className="panel px-4 py-2.5">
              <summary className="label-sm cursor-pointer select-none">Linescore</summary>
              <div className="pt-2">
                <QuarterLinescore
                  away={{ teamId: r.away.teamId, abbr: r.away.abbr, score: r.away.score }}
                  home={{ teamId: r.home.teamId, abbr: r.home.abbr, score: r.home.score }}
                  quarters={r.quarters}
                  overtime={r.overtime}
                />
              </div>
            </details>
          )}

          {/* --- the action bar ------------------------------------------
              WHY ADVANCE LIVES IN HERE, AND WHY THIS BAR IS PINNED.

              The header comment above claims Tier 1 "costs zero extra clicks".
              It was not true. This panel is `fixed inset-0` over the whole
              viewport, so the league header's Advance button sits UNDER the
              backdrop while the report is up — measured, not assumed:
              elementFromPoint at that button's own coordinates returns
              `DIV.fixed inset-0 … report-backdrop`, and a click there dismisses
              the panel and leaves the week exactly where it was. Dismiss, then
              re-aim, then press. Twenty-one times a league year, paid by
              exactly the player who is enjoying pressing Advance.

              NOT FIXED BY LETTING THE CLICK FALL THROUGH. A modal whose
              backdrop secretly actuates a control the reader cannot see is a
              worse thing than the bug. The panel gets its own Advance instead,
              which is the honest reading of the moment anyway: this panel
              exists BECAUSE you pressed Advance, and the next thing you want
              is another week.

              AND IT IS STICKY BECAUSE PUTTING IT AT THE BOTTOM WAS NOT ENOUGH.
              A full report is taller than a laptop viewport — the button
              measured at y=1064 on a 1000px-tall window, below the fold, so
              "one click" was really a scroll and then a click. Pinned to the
              bottom of the scrollport it is on screen the instant the report
              opens, wherever the reader is in it. Close sits right beside it
              and every other exit — Esc, outside click, ✕, any link — is
              untouched.

              This bar is not a nudge to skip anything: it advances ONE week,
              which is the cadence the game is built on. The jump menu is not
              repeated here and never will be. */}
          {/* Bleeds sideways to the panel edge so the rule reads as a bar rather
              than a boxed row. NOT downwards: the parent's `space-y-4` sets
              margin-bottom on every child it touches and beats a `-mb-*`
              utility on specificity, so a negative bottom margin here would be
              a class that does nothing. */}
          <div className="sticky bottom-0 z-10 -mx-5 sm:-mx-6 px-5 sm:px-6 py-3 border-t border-line bg-card/95 backdrop-blur-sm flex flex-wrap items-center gap-3">
            {onAdvance && (
              <button onClick={() => { onClose(); onAdvance(); }} className="btn-primary">Advance ▸</button>
            )}
            <button onClick={onClose} className={onAdvance ? 'btn-secondary text-xs' : 'btn-primary'}>Close</button>
            {r && (
              <Link href={`/league/${leagueId}/game/${r.gameId}`} onClick={onClose} className="btn-secondary text-xs">
                Open box score
              </Link>
            )}
            <span className="ml-auto text-[11px] text-muted hidden sm:inline">Esc, or a click outside, also closes this</span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ScoreSide({ side, align }: { side: ReportSide; align: 'left' | 'right' }) {
  const textColor = `color-mix(in srgb, ${side.color} 60%, white 40%)`;
  return (
    <div className={`flex items-center gap-2 sm:gap-3.5 min-w-0 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
      <TeamLogo seed={side.teamId} abbr={side.abbr} size={46} className="shrink-0" />
      {/* The club is named at every width — the abbreviation is the franchise
          at phone size, not a placeholder for it, and the record travels with
          it either way. Nothing here is dropped to save space. */}
      <div className="min-w-0">
        <div className="font-display font-bold uppercase tracking-wide leading-none truncate text-xs sm:text-base" style={{ color: textColor }}>
          <span className="sm:hidden">{side.abbr}</span>
          <span className="hidden sm:inline">{side.city} {side.nickname}</span>
        </div>
        <div className="font-mono text-[10px] sm:text-[11px] text-muted mt-1">{side.record}</div>
      </div>
      {/* The winner carries the team colour, the beaten side drops back to
          muted — the same margin-weight rule the schedule rows use, so the
          result reads before the digits do. Several curated primaries are
          dark, hence the lightening mix rather than the raw hex. */}
      <span
        className={`stat-value text-stat-md sm:text-stat-xl shrink-0 ${side.won ? '' : 'text-muted'}`}
        style={side.won ? { color: textColor } : undefined}
      >
        {side.score}
      </span>
    </div>
  );
}

function ChangedBand({ report }: { report: WeekReport }) {
  const c = report.changed!;
  const divUp = c.divRankAfter < c.divRankBefore;
  const divDown = c.divRankAfter > c.divRankBefore;
  const seedUp = c.seedAfter < c.seedBefore;
  const seedDown = c.seedAfter > c.seedBefore;
  // A LOWER pick number is a better pick, so "up the board" is a shrinking
  // number — the opposite direction to every other row here, which is exactly
  // why it gets its own pair of names rather than being folded into seedUp.
  const pickUp = c.draftSlotAfter < c.draftSlotBefore;
  const pickDown = c.draftSlotAfter > c.draftSlotBefore;
  // AND IT IS ONLY GREEN ONCE THE RACE IS OVER. The board shows from the week
  // you fall outside the cut line, which is a week you probably lost — and
  // climbing it is the direct consequence of losing. Painting that in the same
  // accent the band uses for a division win would be the report congratulating
  // a club still chasing a playoff spot for dropping a game. Once elimination
  // is mathematical the pick genuinely is the thing that improved, and then it
  // gets the colour. Before that it is a number, printed plainly.
  const boardIsGain = c.playoffsOut;

  return (
    <div className="panel p-4">
      <h3 className="label-sm mb-2.5">What it changed</h3>
      <Kv k="Record" v={<><span className="text-muted">{c.recordBefore}</span> → <b>{c.recordAfter}</b></>} />
      <Kv
        k={c.divisionLabel}
        v={<>
          <span className="text-muted">{ordinal(c.divRankBefore)}</span> → <b className={divUp ? 'text-accent' : divDown ? 'text-bad' : ''}>{ordinal(c.divRankAfter)}</b>
          {divUp && <span className="text-accent"> ▲{c.divRankBefore - c.divRankAfter}</span>}
          {divDown && <span className="text-bad"> ▼{c.divRankAfter - c.divRankBefore}</span>}
        </>}
      />
      {/* THE ROW THAT STOPS MOVING, AND THE ONE THAT NEVER DOES.
          Measured on a losing week 7 and again across a whole 6-11 season:
          from about week 9 the seed row prints 13th → 13th, 12th → 12th,
          12th → 12th while the club's draft slot moves 13 → 9 → 6 → 10 → 9
          underneath it. The band was reporting the number that had frozen and
          hiding the number that was live.

          So the board appears the moment you are outside the cut line — where
          it is true and worth knowing alongside the chase — and REPLACES the
          seed once elimination is mathematical, because at that point a seed
          and a games-back figure describe a race that has finished. Inside the
          field it never shows at all: a team in the picture is not picking
          high and does not want to be told it is. */}
      {!c.playoffsOut && (
        <Kv
          k="Playoff position"
          v={<>
            <span className="text-muted">{ordinal(c.seedBefore)}</span> → <b className={seedUp ? 'text-accent' : seedDown ? 'text-bad' : ''}>{ordinal(c.seedAfter)}</b>
            {c.gamesBack !== null && <span className="text-muted"> · {c.gamesBack.toFixed(1)} GB</span>}
          </>}
        />
      )}
      {(c.playoffsOut || c.gamesBack !== null) && (
        <Kv
          k="Draft board"
          v={<>
            <span className="text-muted">{ordinal(c.draftSlotBefore)}</span> → <b className={pickUp && boardIsGain ? 'text-accent' : ''}>{ordinal(c.draftSlotAfter)}</b>
            {pickUp && <span className={boardIsGain ? 'text-accent' : 'text-muted'}> ▲{c.draftSlotBefore - c.draftSlotAfter}</span>}
            {pickDown && <span className="text-muted"> ▼{c.draftSlotAfter - c.draftSlotBefore}</span>}
          </>}
          title="Where you would pick if the season ended today. Worst record picks first."
        />
      )}
      <Kv
        k="Point differential"
        v={<>
          <span className="text-muted">{c.pointDiffBefore > 0 ? '+' : ''}{c.pointDiffBefore}</span> →{' '}
          <b className={c.pointDiff > c.pointDiffBefore ? 'text-accent' : c.pointDiff < c.pointDiffBefore ? 'text-bad' : ''}>
            {c.pointDiff > 0 ? '+' : ''}{c.pointDiff}
          </b>
        </>}
      />
      {(c.streakBefore || c.streakAfter) && (
        <Kv k="Streak" v={<><span className="text-muted">{c.streakBefore ?? '—'}</span> → <b className={c.streakAfter?.startsWith('W') ? 'text-accent' : 'text-bad'}>{c.streakAfter ?? '—'}</b></>} />
      )}
      {c.clinch && (
        <div
          className={`mt-2.5 rounded px-3 py-2 font-display font-bold uppercase tracking-wide text-xs border ${
            c.clinch.tone === 'good' ? 'bg-accent/10 border-accent/30 text-accent' : 'bg-bad/10 border-bad/30 text-bad'
          }`}
        >
          {c.clinch.label}
          {c.clinchFlipped && <span className="ml-1.5 opacity-80">— this week</span>}
        </div>
      )}
    </div>
  );
}

function Kv({ k, v, title }: { k: string; v: React.ReactNode; title?: string }) {
  return (
    <div className="flex justify-between items-baseline gap-3 py-1.5 border-b border-line/50 last:border-b-0 text-[13px]">
      <span className="text-muted" title={title}>{k}</span>
      <span className="font-mono text-[12.5px] text-right">{v}</span>
    </div>
  );
}

function RoomRow({ dot, children }: { dot: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 items-start text-[13px] leading-snug">
      <span className={`w-1.5 h-1.5 rounded-full mt-[7px] shrink-0 ${dot}`} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
