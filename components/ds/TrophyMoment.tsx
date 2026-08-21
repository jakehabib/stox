'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import type { TrophyMoment as TrophyData, TrophyPlayerLine } from '@/lib/weekReport';
import { TeamLogo } from '../TeamLogo';
import { PlayerAvatar } from '../PlayerAvatar';
import { positionBadgeClass } from './positionColor';
import { QuarterLinescore } from './QuarterLinescore';
import { GameShapePath } from './GameShapePath';

/**
 * ===========================================================================
 * TIER 0 — the only full-screen interruption in the game
 * ===========================================================================
 * Winning the championship used to return the string 'The championship game
 * is complete! Welcome to the offseason.' in the same 320px corner card, in
 * the same typeface, for the same seven seconds, as "Week 3 complete". That
 * was the whole payoff of a season.
 *
 * The budget is the design. This fires only when the user's own season ends
 * in the postseason — they won it, or they lost the game that knocked them
 * out — which is at most twice in a season and usually once. lib/season.ts
 * guards it on the round actually just played, so an elimination in the wild
 * card round cannot re-fire on each of the three rounds that follow, and
 * lib/weekReport.ts guards it on `Team.isUser`, so another club winning it
 * all stays a wire story.
 *
 * Everything on it is a stored fact: the playoff Game rows and their box
 * scores (linescore, drive-by-drive silhouette), the TeamSeasonRecord the
 * snapshot just wrote, the postseason stat bucket replayed by
 * lib/playerSeasons.ts, and the AWARD_SBMVP transaction `recordSeasonAwards`
 * computes one step earlier. No confetti, no particles, no screen shake —
 * nothing celebratory that isn't attached to a true fact. The franchise-
 * history line is COUNTED off TeamSeasonRecord, never asserted, and the GM's
 * own share of it is bounded on his hire year the way lib/gmCareer.ts bounds
 * everything: a title won in 2011 belongs to the club, not to him.
 *
 * DEFEAT IS NOT THE WIN SCREEN IN RED. The elimination state deliberately
 * spends less: the stage barely glows, the headline is chalk rather than a
 * shouting colour, there is no trophy language, no green tone on any figure
 * and no primary-green button. The one red thing on it is the scoreline of
 * the game that ended the year. A season that ends in the divisional round
 * should feel quiet, not alarmed.
 * ===========================================================================
 */
export function TrophyMoment({ data, onClose, leagueId }: {
  data: TrophyData;
  onClose: () => void;
  leagueId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const champion = data.kind === 'CHAMPION';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Win or lose it is still your club's screen, so the club's own colour
  // drives it either way — what changes is how much of it there is.
  const accent = data.color;
  const textColor = `color-mix(in srgb, ${accent} 60%, white 40%)`;

  // Portalled for the same reason as the week report: the header's
  // backdrop-filter would otherwise be this overlay's containing block.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const glow = champion ? 38 : 12;

  return createPortal(
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={champion ? `${data.city} ${data.nickname} are champions` : 'Season over'}
      className="fixed inset-0 z-[60] overflow-y-auto outline-none trophy-stage"
      style={{
        ['--team-accent' as never]: accent,
        background: '#0b0708',
        backgroundImage: [
          `radial-gradient(ellipse 70% 55% at 50% -8%, color-mix(in srgb, var(--team-accent) ${glow}%, transparent), transparent 72%)`,
          `radial-gradient(ellipse 34% 26% at 50% 2%, color-mix(in srgb, var(--team-accent) ${Math.round(glow * 0.68)}%, transparent), transparent 76%)`,
          'repeating-linear-gradient(to bottom, rgba(255,255,255,.02) 0, rgba(255,255,255,.02) 1px, transparent 1px, transparent 84px)',
        ].join(', '),
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes trophy-rise { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: none } }
        @keyframes trophy-glow { from { opacity: 0 } to { opacity: 1 } }
        .trophy-stage { animation: trophy-glow .4s ease-out both; }
        .trophy-inner { animation: trophy-rise .5s ease-out both; }
        .trophy-leg { animation: trophy-rise .5s ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .trophy-stage, .trophy-inner, .trophy-leg { animation: none; }
        }
      ` }} />

      {/* Stadium lights — the same device Draft Day and the Cap hero use.
          Lit for a title; left off when the year just ended. */}
      {champion && (
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background: [
              'radial-gradient(circle 90px at 16% 6%, rgba(255,255,255,.09), transparent 70%)',
              'radial-gradient(circle 90px at 84% 6%, rgba(255,255,255,.09), transparent 70%)',
            ].join(', '),
          }}
        />
      )}

      <div aria-hidden className="absolute left-1/2 top-[36%] -translate-x-1/2 -translate-y-1/2 opacity-[0.06] pointer-events-none">
        <TeamLogo seed={data.teamId} abbr={data.abbr} size={340} />
      </div>

      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-5 text-muted hover:text-chalk text-sm z-10"
      >
        ✕
      </button>

      <div className="trophy-inner relative min-h-full flex items-center justify-center px-5 py-6">
        <div className="w-full max-w-4xl">

          {/* ---- The headline -------------------------------------------- */}
          <div className="text-center">
            <div className="font-mono text-[11px] tracking-[0.34em] uppercase text-muted">
              {data.seasonYear} · {champion ? 'League Champions' : data.roundLabel}
            </div>
            <h1
              className="stat-value uppercase mt-2 leading-[0.9] text-[clamp(2.5rem,9vw,4rem)]"
              style={{ color: champion ? textColor : '#d8d5cc' }}
            >
              {champion ? 'Champions' : 'Season Over'}
            </h1>
            <div className="font-display font-bold uppercase tracking-[0.3em] text-sm text-chalk mt-2">
              {data.city} {data.nickname}
            </div>

            {data.finalScore && (
              <div className="mt-5">
                <div className="stat-value text-stat-lg">
                  <span style={{ color: champion ? textColor : '#93939c' }}>{data.finalScore.mine}</span>
                  <span className="text-muted mx-2">–</span>
                  <span style={{ color: champion ? '#93939c' : '#f87171' }}>{data.finalScore.theirs}</span>
                </div>
                <div className="font-display font-bold uppercase tracking-widest text-xs text-muted mt-2">
                  {champion ? 'over' : 'to'} the {data.finalScore.oppCity} {data.finalScore.oppNickname}
                </div>
              </div>
            )}

            {/* One true sentence naming what happened. The champion's score
                and opponent are already three lines up, so this is spent only
                where it adds something: on the year that just ended. */}
            {!champion && <p className="text-sm text-muted mt-4 max-w-xl mx-auto">{verdict(data)}</p>}
          </div>

          {/* ---- The MVP, and how the game was actually won -------------- */}
          <section className="mt-5 grid md:grid-cols-2 gap-4 items-start">
            {champion && data.mvp && (
              <div>
                <Rule label="Championship MVP" accent />
                <div
                  className="panel p-5 flex flex-wrap items-center gap-x-5 gap-y-4"
                  style={{
                    borderColor: 'color-mix(in srgb, var(--team-accent) 45%, transparent)',
                    background: 'linear-gradient(120deg, color-mix(in srgb, var(--team-accent) 16%, transparent), transparent 78%)',
                  }}
                >
                  {data.mvp.age !== null && (
                    <div className="shrink-0 rounded-lg p-1.5" style={{ background: 'color-mix(in srgb, var(--team-accent) 16%, transparent)' }}>
                      <PlayerAvatar
                        seed={data.mvp.playerId}
                        age={data.mvp.age}
                        size={96}
                        teamColor={accent}
                        weightLb={data.mvp.weightLb ?? undefined}
                        heightIn={data.mvp.heightIn ?? undefined}
                        position={data.mvp.position}
                      />
                    </div>
                  )}
                  <div className="flex-1 min-w-[210px]">
                    <span className={`pill border ${positionBadgeClass(data.mvp.position)}`}>{data.mvp.position}</span>
                    <div className="font-display font-extrabold uppercase tracking-wide text-[1.65rem] leading-none mt-2">
                      {data.mvp.name}
                    </div>
                    {/* The cells and the award transaction's own sentence are the
                        same numbers off the same box line, so only one is shown:
                        the cells when the line could be matched back, the stored
                        sentence when it couldn't. */}
                    {data.mvp.stats.length > 0 ? (
                      <div className="flex gap-6 mt-3">
                        {data.mvp.stats.map((st) => (
                          <div key={st.label}>
                            <div className="stat-value text-stat-md" style={{ color: textColor }}>{st.value}</div>
                            <div className="label-sm">{st.label}</div>
                          </div>
                        ))}
                      </div>
                    ) : data.mvpAward && (
                      <p className="font-mono text-xs text-muted mt-3">{data.mvpAward}</p>
                    )}
                    <p className="text-[11px] text-muted mt-3">Scored off his line in the final itself, winning roster only.</p>
                  </div>
                </div>
              </div>
            )}

            {data.final && (
              <div className={champion && data.mvp ? '' : 'md:col-span-2'}>
                <Rule label={champion ? 'The final' : 'The game that ended it'} />
                <div className={`panel p-4 ${champion && data.mvp ? '' : 'md:grid md:grid-cols-2 md:gap-5'}`}>
                  <QuarterLinescore
                    away={{ teamId: data.final.away.teamId, abbr: data.final.away.abbr, score: data.final.away.score }}
                    home={{ teamId: data.final.home.teamId, abbr: data.final.home.abbr, score: data.final.home.score }}
                    quarters={data.final.quarters}
                    overtime={data.final.overtime}
                    emphasis={champion ? 'winner' : 'none'}
                  />
                  {data.final.shape && (
                    <div className={champion && data.mvp ? 'mt-2.5 pt-2.5 border-t border-line/50' : 'mt-3 md:mt-0'}>
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="label-sm">{data.final.shape.archetype}</div>
                        <div className="text-[11px] text-muted">{data.final.shape.note}</div>
                      </div>
                      <GameShapePath
                        shape={data.final.shape}
                        variant="full"
                        width={420}
                        height={84}
                        color={champion ? accent : '#93939c'}
                        animate
                        className="mt-1"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* ---- The road there ------------------------------------------ */}
          {data.road.length > 0 && (
            <section className="mt-5">
              <Rule label={champion ? 'The road there' : 'The run'} />
              <div className="flex gap-2 justify-center flex-wrap">
                {/* A bye is something the bracket gave them, not a missing
                    game — the wild card round happened without them. */}
                {data.bye && data.seed !== null && (
                  <div className="trophy-leg rounded-md px-3.5 py-2 min-w-[116px] border border-line/70 bg-white/[0.025]">
                    <div className="text-[9px] tracking-[0.15em] uppercase font-bold text-muted">Wild Card</div>
                    <div className="stat-value text-base mt-0.5 text-muted">BYE</div>
                    <div className="font-mono text-[10px] text-muted">{data.seed}{suffix(data.seed)} seed</div>
                  </div>
                )}
                {data.road.map((leg, i) => {
                  const finalLeg = i === data.road.length - 1;
                  return (
                    <div
                      key={i}
                      className="trophy-leg rounded-md px-3.5 py-2 min-w-[116px] border"
                      style={{
                        animationDelay: `${0.15 + i * 0.08}s`,
                        background: finalLeg && champion ? 'color-mix(in srgb, var(--team-accent) 10%, transparent)' : 'rgba(255,255,255,.025)',
                        borderColor: finalLeg ? (champion ? 'var(--team-accent)' : 'rgba(248,113,113,.55)') : '#33262a',
                      }}
                    >
                      <div className="text-[9px] tracking-[0.15em] uppercase font-bold text-muted">{leg.round}</div>
                      <div className="stat-value text-base mt-0.5">
                        <span className={leg.won ? '' : 'text-bad'}>{leg.myScore}</span>
                        <span className="text-muted">-</span>
                        <span className="text-muted">{leg.theirScore}</span>
                      </div>
                      <div className="font-mono text-[10px] text-muted">{leg.atHome ? 'vs' : '@'} {leg.oppAbbr}</div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ---- Who carried it ------------------------------------------- */}
          {data.runLeaders.length > 0 && (
            <section className="mt-5">
              <Rule label={`Across the postseason · ${postseasonGames(data)} game${postseasonGames(data) === 1 ? '' : 's'}`} />
              <div className="grid sm:grid-cols-3 gap-3">
                {data.runLeaders.map((p) => <RunLeader key={p.playerId} p={p} accent={accent} />)}
              </div>
            </section>
          )}

          {/* ---- What it means, and the season underneath it --------------- */}
          <section className="mt-5">
            <Rule label={champion ? 'What it means' : 'Where that leaves you'} />
            <div className="panel p-4 flex flex-wrap gap-x-9 gap-y-4 justify-center text-center">
              {meaning(data).map((m) => (
                <Fact key={m.k} k={m.k} v={m.v} sub={m.sub} tone={m.team ? 'text-team' : undefined} />
              ))}
              <div aria-hidden className="w-px self-stretch bg-line/70 hidden sm:block" />
              <Fact k="Regular season" v={data.record} />
              {data.seed !== null && <Fact k="Seed" v={`${data.seed}${suffix(data.seed)}`} />}
              <Fact
                k="Point diff"
                v={`${data.pointDiff > 0 ? '+' : ''}${data.pointDiff}`}
                tone={champion && data.pointDiff > 0 ? 'text-accent' : undefined}
              />
              <Fact k="Postseason" v={`${data.roundsWon}-${data.road.length - data.roundsWon}`} />
            </div>
          </section>

          {!champion && data.nextPick && (
            <p className="text-sm text-muted mt-4 text-center">{data.nextPick}</p>
          )}

          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              href={`/league/${leagueId}/history`}
              onClick={onClose}
              className={champion ? 'btn-primary' : 'btn-secondary'}
            >
              {champion ? 'Raise the banner' : 'Look at the damage'}
            </Link>
            <button onClick={onClose} className="btn-secondary text-xs">Continue</button>
          </div>
          <p className="text-[11px] text-muted mt-4 text-center">Esc closes this.</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function RunLeader({ p, accent }: { p: TrophyPlayerLine; accent: string }) {
  return (
    <div className="panel p-3 flex items-center gap-3">
      {p.age !== null && (
        <PlayerAvatar
          seed={p.playerId}
          age={p.age}
          size={44}
          teamColor={accent}
          weightLb={p.weightLb ?? undefined}
          heightIn={p.heightIn ?? undefined}
          position={p.position}
          className="shrink-0"
        />
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`pill border ${positionBadgeClass(p.position)}`}>{p.position}</span>
          <span className="font-medium text-sm truncate">{p.name}</span>
        </div>
        <div className="font-mono text-[11px] text-muted mt-1 truncate">
          {p.stats.map((s) => `${s.value} ${s.label}`).join(' · ')}
        </div>
      </div>
    </div>
  );
}

/**
 * One sentence naming what actually happened, built only from figures on the
 * payload. Shown on defeat only — the champion's own score, opponent and
 * margin are already the three biggest things on his screen, so a sentence
 * restating them would be filler. This one never softens the result and never
 * inflates it: rounds won are stated because they happened, and the wall is
 * stated because it is where the season stopped.
 */
function verdict(d: TrophyData): string {
  const opp = d.finalScore ? `the ${d.finalScore.oppCity} ${d.finalScore.oppNickname}` : 'the field';
  const margin = d.finalScore ? Math.abs(d.finalScore.mine - d.finalScore.theirs) : 0;
  const wall = `Knocked out in the ${d.roundLabel.toLowerCase()} by ${opp}, by ${margin}.`;
  if (d.roundsWon === 0) return `${wall} One game, and it was over.`;
  return `${wall} ${d.roundsWon} round${d.roundsWon === 1 ? '' : 's'} won before it.`;
}

/** How many postseason games the club actually played. A bye is not a game. */
function postseasonGames(d: TrophyData): number {
  return d.road.length;
}

/**
 * The franchise-history block. Every string here is derived from a count, and
 * the two clocks are kept apart: the club's whole record (which includes the
 * two decades of backstory league creation seeds) and the GM's tenure, which
 * starts at his hire year. A title from before he was hired is never his.
 */
function meaning(d: TrophyData): { k: string; v: string; sub?: string; team?: boolean }[] {
  const h = d.history;
  const out: { k: string; v: string; sub?: string; team?: boolean }[] = [];

  if (d.kind === 'CHAMPION') {
    out.push(h.franchiseTitles === 1
      ? { k: 'Franchise', v: 'First ever', sub: `${h.seasonsOnRecord} seasons on the books`, team: true }
      : {
        k: 'Franchise',
        v: `Title No. ${h.franchiseTitles}`,
        sub: h.previousTitleYear === d.seasonYear - 1
          ? 'Back to back'
          : h.previousTitleYear !== null ? `First since ${h.previousTitleYear}` : undefined,
        team: true,
      });
    out.push({
      k: 'Your tenure',
      v: h.gmTitles === 1 ? 'First' : `No. ${h.gmTitles}`,
      sub: `Season ${h.gmSeasons} on the job`,
    });
  } else {
    out.push(h.franchiseTitles === 0
      ? { k: 'Franchise', v: 'Still none', sub: `${h.seasonsOnRecord} seasons on the books` }
      : { k: 'Last title', v: `${h.previousTitleYear}`, sub: `${d.seasonYear - (h.previousTitleYear ?? d.seasonYear)} seasons ago` });
    out.push({
      k: 'Your tenure',
      v: h.gmTitles === 0 ? 'No titles' : `${h.gmTitles}`,
      sub: `${h.gmSeasons} season${h.gmSeasons === 1 ? '' : 's'} since ${h.gmHiredIn}`,
    });
  }
  return out;
}

function Rule({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div
        className="h-px flex-1"
        style={{ background: accent ? 'color-mix(in srgb, var(--team-accent) 40%, transparent)' : '#2d2d32' }}
      />
      <div className="label-sm shrink-0">{label}</div>
      <div
        className="h-px flex-1"
        style={{ background: accent ? 'color-mix(in srgb, var(--team-accent) 40%, transparent)' : '#2d2d32' }}
      />
    </div>
  );
}

function Fact({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: string }) {
  return (
    <div className="text-center">
      <div className="text-[10px] tracking-[0.14em] uppercase text-muted font-bold">{k}</div>
      <div className={`stat-value mt-1 text-stat-sm ${tone ?? ''}`}>{v}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function suffix(n: number): string {
  const m = n % 100;
  if (m >= 11 && m <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}
