'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import type { WeekReport, ReportSide } from '@/lib/weekReport';
import { ordinal } from '@/lib/standingsOrder';
import { marginPhrase } from '@/lib/gameShape';
import { TeamLogo } from '../TeamLogo';
import { PlayerAvatar } from '../PlayerAvatar';
import { GameShapePath, ArchetypeTag } from './GameShapePath';
import { QuarterLinescore } from './QuarterLinescore';
import { ResultKicker } from './ResultWeight';

/**
 * ===========================================================================
 * THE WEEK REPORT PANEL — what Advance ▸ produces now
 * ===========================================================================
 * This replaces a 320px toast that read "Week 8 complete: 16 games played."
 * for seven seconds and did not contain the user's own score.
 *
 * INTERRUPTION BUDGET (see docs/design-research/moments/findings.md, Part 3).
 * This is Tier 1, and Tier 1's whole licence is that it costs zero extra
 * clicks. So it closes on Escape, on a click anywhere outside it, on any
 * link inside it, and on the Continue button — four ways out, none of them
 * mandatory. Getting that wrong turns it into a required click seventeen
 * times a season, which is the single most likely way this fails.
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

export function WeekReportPanel({ report, span, onClose, leagueId }: {
  report: WeekReport;
  span?: WeekReportSpan | null;
  onClose: () => void;
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

  return (
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
              <span className="text-muted font-semibold"> {multi ? 'is behind you' : 'is in the books'}</span>
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
                <div className="text-center min-w-[92px]">
                  {r.shape && <ArchetypeTag shape={r.shape} />}
                  <div className="font-mono text-[11px] text-muted mt-1">
                    {r.outcome === 'T' ? 'tied' : marginPhrase(r.margin)}
                    {r.overtime && <span className="text-accent2"> · OT</span>}
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
                  <div className="flex justify-between px-2 font-mono text-[10px] text-muted">
                    <span>Q1</span><span>Q2</span><span>HALF</span><span>Q3</span><span>Q4</span>
                  </div>
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
          <div className="grid md:grid-cols-2 gap-3">
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
                      <div className="font-mono text-[11px] text-muted mt-1 truncate">{report.gameBall.line}</div>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <h3 className="label-sm mb-2">The room</h3>
                <div className="space-y-1.5">
                  {report.injuries.map((inj, i) => (
                    <RoomRow key={`inj-${i}`} dot="bg-bad">
                      <b>{inj.name}</b>{inj.position ? ` (${inj.position})` : ''} — {inj.type.toLowerCase()}, out {inj.weeks} week{inj.weeks === 1 ? '' : 's'}
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

          {/* --- footer -------------------------------------------------- */}
          <div className="flex items-center gap-3 pt-3 border-t border-line">
            <button onClick={onClose} className="btn-primary">Continue</button>
            {r && (
              <Link href={`/league/${leagueId}/game/${r.gameId}`} onClick={onClose} className="btn-secondary text-xs">
                Open box score
              </Link>
            )}
            <span className="ml-auto text-[11px] text-muted hidden sm:inline">Esc, or a click outside, also closes this</span>
          </div>

          {/* Linescore last: it is reference, not headline. */}
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
        </div>
      </div>
    </div>
  );
}

function ScoreSide({ side, align }: { side: ReportSide; align: 'left' | 'right' }) {
  const textColor = `color-mix(in srgb, ${side.color} 60%, white 40%)`;
  return (
    <div className={`flex items-center gap-2.5 sm:gap-3.5 min-w-0 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
      <TeamLogo seed={side.teamId} abbr={side.abbr} size={46} className="shrink-0" />
      <div className="min-w-0 hidden sm:block">
        <div className="font-display font-bold uppercase tracking-wide leading-none truncate" style={{ color: textColor }}>
          {side.city} {side.nickname}
        </div>
        <div className="font-mono text-[11px] text-muted mt-1">{side.record}</div>
      </div>
      <span
        className="stat-value text-stat-lg sm:text-stat-xl shrink-0"
        style={{ color: side.won ? textColor : undefined }}
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
      <Kv
        k="Playoff position"
        v={<>
          <span className="text-muted">{ordinal(c.seedBefore)}</span> → <b className={seedUp ? 'text-accent' : seedDown ? 'text-bad' : ''}>{ordinal(c.seedAfter)}</b>
          {c.gamesBack !== null && <span className="text-muted"> · {c.gamesBack.toFixed(1)} GB</span>}
        </>}
      />
      <Kv k="Point differential" v={<span className={c.pointDiff > 0 ? 'text-accent' : c.pointDiff < 0 ? 'text-bad' : ''}>{c.pointDiff > 0 ? '+' : ''}{c.pointDiff}</span>} />
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

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between items-baseline gap-3 py-1.5 border-b border-line/50 last:border-b-0 text-[13px]">
      <span className="text-muted">{k}</span>
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
