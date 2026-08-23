'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import type { TrophyMoment as TrophyData, TrophyPlayerLine } from '@/lib/weekReport';
import type { SeasonEndSummary, SeasonEndWeek } from '@/lib/seasonEndCard';
import { TeamLogo } from '../TeamLogo';
import { PlayerAvatar } from '../PlayerAvatar';
import { positionBadgeClass } from './positionColor';

/**
 * ===========================================================================
 * TIER 0 — THE SEASON-END CARD
 * ===========================================================================
 * ONE screen for one specific thing that happens to one specific player: he
 * pressed Advance once, a long stretch of season went past, and it ended in
 * the postseason.
 *
 * WHY IT IS NOT THE TROPHY WITH THE SPAN STACKED BEHIND IT. Winning the title
 * on a multi-week advance used to destroy the span report outright —
 * `finish()` cleared it before raising the trophy — so the player who missed
 * the playoffs and jumped twenty-two weeks kept every score, both records and
 * every injury, and the player who WON THE TITLE on the same press kept none
 * of it. Queueing the two artifacts back to back would have fixed the loss and
 * broken the rule that pays for the whole interruption budget: the Tier-0
 * moment supersedes both, and only ever one of them is on screen at a time.
 *
 * So the intersection is treated as its own event, and this is its own
 * artifact. It is not TrophyMoment plus WeekReportPanel. The spine is the
 * SEASON — one unbroken ribbon from the first week of the stretch through the
 * final — and the title is what the ribbon ends in. Everything else on the
 * screen is chosen against one question: what does a GM want to remember
 * about a year he watched go by in a single press? The record. The run. The
 * week it turned. Who he was missing when it mattered. Who won it for him.
 *
 * BUDGET. Same as TrophyMoment's and for the same reason: at most once a
 * season, only when the user's own season ended, dismissible on Escape, on
 * the ✕, on Continue and on any link out. It replaces the trophy on this
 * path — it never follows it — so the count of full-screen interruptions in a
 * season is unchanged by this file existing.
 *
 * EVERY FIGURE IS STORED. The ribbon is the per-week results the sim wrote;
 * the win chances are the pre-kickoff estimates the user was actually shown,
 * never recomputed against a result they already know; the turn is picked by
 * lib/seasonEndCard.ts from those same rows; the trophy half is the Tier-0
 * payload verbatim. Nothing here is generated prose about a game.
 * ===========================================================================
 */
export function SeasonEndCard({ data, season, onClose, leagueId }: {
  data: TrophyData;
  season: SeasonEndSummary;
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

  const accent = data.color;
  const textColor = `color-mix(in srgb, ${accent} 60%, white 40%)`;

  // Portalled for the same reason the other two overlays are: the league
  // header carries backdrop-blur, and a backdrop-filter makes its element the
  // containing block for every fixed-position descendant below it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const glow = champion ? 34 : 11;

  return createPortal(
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={champion
        ? `${data.city} ${data.nickname} are ${data.seasonYear} champions`
        : `${data.seasonYear} season over`}
      className="fixed inset-0 z-[60] overflow-y-auto outline-none season-stage"
      style={{
        ['--team-accent' as never]: accent,
        background: '#0b0708',
        backgroundImage: [
          `radial-gradient(ellipse 70% 55% at 50% -8%, color-mix(in srgb, var(--team-accent) ${glow}%, transparent), transparent 72%)`,
          'repeating-linear-gradient(to bottom, rgba(255,255,255,.02) 0, rgba(255,255,255,.02) 1px, transparent 1px, transparent 84px)',
        ].join(', '),
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes season-rise { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
        @keyframes season-glow { from { opacity: 0 } to { opacity: 1 } }
        @keyframes season-chip { from { opacity: 0; transform: scale(.82) } to { opacity: 1; transform: none } }
        .season-stage { animation: season-glow .4s ease-out both; }
        .season-inner { animation: season-rise .5s ease-out both; }
        .season-chip { animation: season-chip .34s ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .season-stage, .season-inner, .season-chip { animation: none; }
        }
      ` }} />

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

      <div aria-hidden className="absolute left-1/2 top-[30%] -translate-x-1/2 -translate-y-1/2 opacity-[0.055] pointer-events-none">
        <TeamLogo seed={data.teamId} abbr={data.abbr} size={340} />
      </div>

      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-5 text-muted hover:text-chalk text-sm z-10"
      >
        ✕
      </button>

      <div className="season-inner relative min-h-full flex items-center justify-center px-4 sm:px-5 py-6">
        <div className="w-full max-w-5xl">

          {/* ---- The headline -------------------------------------------
              Deliberately shorter than TrophyMoment's. That screen has one
              thing to say and the whole viewport to say it in; this one has a
              year to get through, so the title takes the top and then gets
              out of the way of the ribbon. */}
          <div className="text-center">
            <div className="font-mono text-[11px] tracking-[0.34em] uppercase text-muted">
              {data.seasonYear} · {champion ? 'League Champions' : data.roundLabel}
            </div>
            <h1
              className="stat-value uppercase mt-2 leading-[0.9] text-[clamp(2.1rem,7.5vw,3.4rem)]"
              style={{ color: champion ? textColor : '#d8d5cc' }}
            >
              {champion ? 'Champions' : 'Season Over'}
            </h1>
            <div className="font-display font-bold uppercase tracking-[0.3em] text-sm text-chalk mt-2">
              {data.city} {data.nickname}
            </div>
            {data.finalScore && (
              <div className="mt-3 flex items-center justify-center gap-3 flex-wrap">
                <span className="stat-value text-stat-md">
                  <span style={{ color: champion ? textColor : '#93939c' }}>{data.finalScore.mine}</span>
                  <span className="text-muted mx-1.5">–</span>
                  <span style={{ color: champion ? '#93939c' : '#f87171' }}>{data.finalScore.theirs}</span>
                </span>
                <span className="font-display font-bold uppercase tracking-widest text-[11px] text-muted">
                  {champion ? 'over' : 'to'} the {data.finalScore.oppCity} {data.finalScore.oppNickname}
                </span>
              </div>
            )}
          </div>

          {/* ---- THE SPINE: the whole stretch, in one line ---------------
              This is the part that used to be thrown in the bin, so it is not
              a footnote here — it is the middle of the screen and it runs
              unbroken from the first week of the advance into the final. */}
          <section className="mt-6">
            <Rule label={season.label} accent={champion} />
            <div className="panel p-4">
              {season.weeks.length > 0 && (
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {season.weeks.map((w, i) => <WeekChip key={i} w={w} delay={i * 0.022} />)}
                </div>
              )}

              {data.road.length > 0 && (
                <>
                  {season.weeks.length > 0 && (
                    <div className="flex items-center gap-3 my-3">
                      <div className="h-px flex-1 bg-line/60" />
                      <span className="label-sm shrink-0">{champion ? 'and then' : 'the run'}</span>
                      <div className="h-px flex-1 bg-line/60" />
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 justify-center">
                    {/* A bye is something the bracket handed them, not a
                        missing game — the wild card round happened without
                        them. Same rule TrophyMoment uses. */}
                    {data.bye && data.seed !== null && (
                      <div className="season-chip rounded px-3 py-1.5 min-w-[92px] text-center border border-line/70 bg-white/[0.02]">
                        <div className="text-[9px] tracking-[0.14em] uppercase font-bold text-muted">Wild Card</div>
                        <div className="stat-value text-sm mt-0.5 text-muted">BYE</div>
                      </div>
                    )}
                    {data.road.map((leg, i) => {
                      const lastLeg = i === data.road.length - 1;
                      return (
                        <div
                          key={i}
                          className="season-chip rounded px-3 py-1.5 min-w-[92px] text-center border"
                          style={{
                            animationDelay: `${season.weeks.length * 0.022 + i * 0.07}s`,
                            background: lastLeg && champion ? 'color-mix(in srgb, var(--team-accent) 12%, transparent)' : 'rgba(255,255,255,.025)',
                            borderColor: lastLeg ? (champion ? 'var(--team-accent)' : 'rgba(248,113,113,.55)') : '#33262a',
                          }}
                        >
                          <div className="text-[9px] tracking-[0.14em] uppercase font-bold text-muted truncate">{leg.round}</div>
                          <div className="stat-value text-sm mt-0.5">
                            <span className={leg.won ? '' : 'text-bad'}>{leg.myScore}</span>
                            <span className="text-muted">-</span>
                            <span className="text-muted">{leg.theirScore}</span>
                          </div>
                          <div className="font-mono text-[10px] text-muted">{leg.atHome ? 'vs' : '@'} {leg.oppAbbr}</div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* The numbers that describe the line above it, on the same
                  panel as the line. Split out into their own block they would
                  be a second scoreboard about the same season. */}
              <div className="mt-4 pt-3 border-t border-line/60 flex flex-wrap gap-x-8 gap-y-3 justify-center text-center">
                <Fact k="Regular season" v={data.record} sub={season.recordFrom && season.recordTo && season.recordFrom !== season.recordTo ? `from ${season.recordFrom}` : undefined} />
                {data.seed !== null && <Fact k="Seed" v={`${data.seed}${suffix(data.seed)}`} />}
                <Fact
                  k="Point diff"
                  v={`${data.pointDiff > 0 ? '+' : ''}${data.pointDiff}`}
                  tone={champion && data.pointDiff > 0 ? 'text-accent' : undefined}
                />
                {season.longestWinStreak >= 2 && (
                  <Fact k="Longest run" v={`${season.longestWinStreak} straight`} tone={champion ? 'text-team' : undefined} />
                )}
                <Fact k="Postseason" v={`${data.roundsWon}-${data.road.length - data.roundsWon}`} />
              </div>
            </div>
          </section>

          {/* ---- The week it turned, and who he was missing ---------------
              Side by side because they are the same question asked twice: what
              actually decided this, as opposed to what the table says. */}
          <section className="mt-5 grid md:grid-cols-2 gap-4 items-start">
            {season.turn && (
              <div>
                <Rule label={season.turn.kind === 'streak' ? 'The turn' : 'The best win'} />
                <div className="panel p-4">
                  <div className="font-display font-extrabold uppercase tracking-wide text-lg leading-none">
                    {season.turn.week.label}
                    <span className="text-muted"> · {season.turn.week.atHome ? 'vs' : 'at'} {season.turn.week.oppAbbr}</span>
                  </div>
                  <div className="stat-value text-stat-sm mt-2" style={{ color: textColor }}>
                    {season.turn.week.mine}–{season.turn.week.theirs}
                  </div>
                  <p className="text-sm text-muted mt-2 leading-relaxed">
                    {turnLine(season)}
                  </p>
                  {season.turn.week.gameId && (
                    <Link
                      href={`/league/${leagueId}/game/${season.turn.week.gameId}`}
                      onClick={onClose}
                      className="btn-secondary text-xs mt-3 inline-block"
                    >
                      Open box score
                    </Link>
                  )}
                </div>
              </div>
            )}

            <div className={season.turn ? '' : 'md:col-span-2'}>
              <Rule label="The room" />
              <div className="panel p-4">
                {season.injuries.length === 0 ? (
                  <p className="text-sm text-muted">
                    {/* The report's injury rows are men who WENT DOWN in that
                        week's box score, not a headcount of the training room,
                        so this says what it can actually see. */}
                    Nobody went down in the whole stretch.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-chalk/90">
                      {season.injuredMen} {season.injuredMen === 1 ? 'man went' : 'men went'} down.
                      {/* Counted, not assumed off the first row — the sort puts
                          postseason first, but "one of them" would be a lie the
                          moment two men went down in January. */}
                      {postseasonHurt(season) > 0 && ` ${postseasonHurt(season)} of them once the bracket started.`}
                    </p>
                    <div className="mt-2.5 space-y-1.5">
                      {season.injuries.slice(0, 5).map((inj) => (
                        <div key={inj.playerId || inj.name} className="flex items-baseline justify-between gap-3 text-[13px]">
                          <span className="min-w-0 truncate">
                            {inj.playerId ? (
                              <Link
                                href={`/league/${leagueId}/player/${inj.playerId}`}
                                onClick={onClose}
                                className="font-medium hover:text-accent2 transition-colors"
                              >
                                {inj.name}
                              </Link>
                            ) : <span className="font-medium">{inj.name}</span>}
                            {inj.position && <span className="text-muted"> {inj.position}</span>}
                          </span>
                          <span className={`font-mono text-[11.5px] shrink-0 ${inj.postseason ? 'text-bad' : 'text-muted'}`}>
                            {inj.weekLabel} · {inj.weeks}w
                          </span>
                        </div>
                      ))}
                      {season.injuries.length > 5 && (
                        <div className="text-[11px] text-muted pt-0.5">
                          and {season.injuries.length - 5} more
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>

          {/* ---- Who won it ---------------------------------------------- */}
          {(champion && data.mvp) || data.runLeaders.length > 0 ? (
            <section className="mt-5">
              <Rule label={champion ? 'Who won it' : 'Who carried the run'} accent={champion} />
              <div className="grid md:grid-cols-2 gap-4 items-start">
                {champion && data.mvp && (
                  <div
                    className="panel p-4 flex items-center gap-4"
                    style={{
                      borderColor: 'color-mix(in srgb, var(--team-accent) 45%, transparent)',
                      background: 'linear-gradient(120deg, color-mix(in srgb, var(--team-accent) 15%, transparent), transparent 78%)',
                    }}
                  >
                    {data.mvp.age !== null && (
                      <div className="shrink-0 rounded-lg p-1" style={{ background: 'color-mix(in srgb, var(--team-accent) 16%, transparent)' }}>
                        <PlayerAvatar
                          seed={data.mvp.playerId}
                          age={data.mvp.age}
                          size={72}
                          teamColor={accent}
                          weightLb={data.mvp.weightLb ?? undefined}
                          heightIn={data.mvp.heightIn ?? undefined}
                          position={data.mvp.position}
                        />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="label-sm">Championship MVP</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`pill border ${positionBadgeClass(data.mvp.position)}`}>{data.mvp.position}</span>
                        <span className="font-display font-extrabold uppercase tracking-wide text-lg leading-none truncate">
                          {data.mvp.name}
                        </span>
                      </div>
                      {/* The cells and the award transaction's own sentence
                          are the same numbers off the same box line, so only
                          one is shown — the same rule TrophyMoment follows. */}
                      {data.mvp.stats.length > 0 ? (
                        <div className="font-mono text-[11.5px] text-muted mt-2">
                          {data.mvp.stats.map((s) => `${s.value} ${s.label}`).join(' · ')}
                        </div>
                      ) : data.mvpAward && (
                        <p className="font-mono text-[11.5px] text-muted mt-2">{data.mvpAward}</p>
                      )}
                      <p className="text-[10.5px] text-muted mt-1.5">His line in the final itself.</p>
                    </div>
                  </div>
                )}
                {data.runLeaders.length > 0 && (
                  /* With no MVP beside them these three had half the card and
                     every name came out as "Land…". They take the whole width
                     when nothing is sharing it.

                     The scope label sits INSIDE this block, not under the
                     section: these lines cover the whole run and the MVP's
                     cover one game, and a caption spanning both would be
                     attached to two different spans of football at once. */
                  <div className={champion && data.mvp ? '' : 'md:col-span-2'}>
                    <div className="label-sm mb-2">
                      Across {data.road.length} postseason game{data.road.length === 1 ? '' : 's'}
                    </div>
                    <div className={champion && data.mvp ? 'space-y-2' : 'grid sm:grid-cols-3 gap-3'}>
                      {data.runLeaders.map((p) => <RunLeader key={p.playerId} p={p} accent={accent} />)}
                    </div>
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {/* ---- What it means -------------------------------------------
              Counted off TeamSeasonRecord, never asserted, and the GM's own
              share of it bounded on his hire year — a title won before he was
              hired belongs to the club. */}
          <section className="mt-5">
            <Rule label={champion ? 'What it means' : 'Where that leaves you'} />
            <div className="panel p-4 flex flex-wrap gap-x-9 gap-y-4 justify-center text-center">
              {meaning(data).map((m) => (
                <Fact key={m.k} k={m.k} v={m.v} sub={m.sub} tone={m.team ? 'text-team' : undefined} />
              ))}
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

/**
 * One week of the stretch.
 *
 * The score is on the chip, not behind a tooltip, because the whole complaint
 * this screen answers is that the scores were being thrown away. The opponent
 * and the week number ride under it so the ribbon reads left to right as a
 * season rather than as a bag of results.
 */
function WeekChip({ w, delay }: { w: SeasonEndWeek; delay: number }) {
  const tone = w.outcome === 'W'
    ? 'border-accent/45 text-accent bg-accent/10'
    : w.outcome === 'L'
      ? 'border-bad/40 text-bad bg-bad/10'
      : 'border-line/70 text-muted bg-white/[0.02]';
  return (
    <div
      className={`season-chip rounded border px-1.5 py-1 text-center min-w-[58px] ${tone}`}
      style={{ animationDelay: `${delay}s` }}
      title={w.oppAbbr
        ? `${w.label} — ${w.atHome ? 'vs' : 'at'} ${w.oppAbbr}${w.winChancePre !== null ? `, ${w.winChancePre}% to win` : ''}`
        : `${w.label} — no game`}
    >
      <div className="font-mono text-[11px] tabular-nums leading-none font-bold">
        {w.mine !== null ? `${w.mine}-${w.theirs}` : '—'}
      </div>
      {/* The week number rides with the opponent rather than being left to the
          tooltip. A stretch that starts in week 9 is unreadable without it —
          the chips are in order, but nothing on them says where the order
          began, and "which week was that" is the first thing asked of a strip
          of scores. */}
      <div className="font-mono text-[9px] leading-none mt-1 text-muted truncate">
        {w.oppAbbr ? `${w.short} ${w.atHome ? '' : '@'}${w.oppAbbr}` : `${w.short} bye`}
      </div>
    </div>
  );
}

/**
 * The sentence under the turn.
 *
 * Assembled from figures that are already on the payload and nothing else. No
 * adjective the sim did not earn: the margin is the margin, the win chance is
 * the one the user was shown before kickoff, and the streak length is counted.
 */
function turnLine(season: SeasonEndSummary): string {
  const t = season.turn;
  if (!t) return '';
  // Both candidates are wins by construction (see pickTurn), so there is no
  // draw case to spell — writing one would be a branch describing a state
  // this function cannot be handed.
  const parts: string[] = [`Won by ${t.margin}`];
  if (t.week.winChancePre !== null) parts.push(`${t.week.winChancePre}% to win going in`);
  const head = `${parts.join(' · ')}.`;
  if (t.kind !== 'streak') return head;
  // Spelled out because the clause opens on it and "The first of 9 straight"
  // sets a digit where the sentence wants a word.
  const n = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][t.streakLength] ?? String(t.streakLength);
  return `${head} The first of ${n} straight.`;
}

/** How many of them went down after the regular season was over. */
function postseasonHurt(season: SeasonEndSummary): number {
  return season.injuries.filter((i) => i.postseason).length;
}

function RunLeader({ p, accent }: { p: TrophyPlayerLine; accent: string }) {
  return (
    <div className="panel p-2.5 flex items-center gap-3">
      {p.age !== null && (
        <PlayerAvatar
          seed={p.playerId}
          age={p.age}
          size={38}
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
        <div className="font-mono text-[11px] text-muted mt-0.5 truncate">
          {p.stats.map((s) => `${s.value} ${s.label}`).join(' · ')}
        </div>
      </div>
    </div>
  );
}

/**
 * The franchise-history block, counted rather than asserted, with the club's
 * clock and the GM's clock kept apart — TeamSeasonRecord holds every season
 * on the books including the backstory seeds, and the GM was hired in
 * `gmHiredIn`. Same rule as TrophyMoment, and it is duplicated rather than
 * shared on purpose: these are two screens that will drift apart, and a
 * shared helper would quietly force one to follow the other's edits.
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
      <div className="h-px flex-1" style={{ background: accent ? 'color-mix(in srgb, var(--team-accent) 40%, transparent)' : '#2d2d32' }} />
      <div className="label-sm shrink-0 text-center">{label}</div>
      <div className="h-px flex-1" style={{ background: accent ? 'color-mix(in srgb, var(--team-accent) 40%, transparent)' : '#2d2d32' }} />
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
