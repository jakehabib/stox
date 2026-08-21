'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import type { TrophyMoment as TrophyData } from '@/lib/weekReport';
import { TeamLogo } from '../TeamLogo';

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
 * Everything on it is a stored fact: the playoff Game rows, the
 * TeamSeasonRecord the snapshot just wrote, and the AWARD_SBMVP transaction
 * `recordSeasonAwards` computes one step earlier. No confetti, no particles,
 * no screen shake — nothing celebratory that isn't attached to a true fact.
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

  const accent = champion ? data.color : '#f87171';
  const textColor = `color-mix(in srgb, ${accent} 60%, white 40%)`;

  // Portalled for the same reason as the week report: the header's
  // backdrop-filter would otherwise be this overlay's containing block.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

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
          `radial-gradient(ellipse 70% 55% at 50% -8%, color-mix(in srgb, var(--team-accent) 38%, transparent), transparent 72%)`,
          `radial-gradient(ellipse 34% 26% at 50% 2%, color-mix(in srgb, var(--team-accent) 26%, transparent), transparent 76%)`,
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

      {/* Stadium lights — the same device Draft Day and the Cap hero use. */}
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

      <div aria-hidden className="absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2 opacity-[0.07] pointer-events-none">
        <TeamLogo seed={data.teamId} abbr={data.abbr} size={340} />
      </div>

      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-5 text-muted hover:text-chalk text-sm z-10"
      >
        ✕
      </button>

      <div className="trophy-inner relative min-h-full flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-3xl text-center">
          <div className="font-mono text-[11px] tracking-[0.34em] uppercase text-muted">
            {data.seasonYear} · {champion ? 'League Champions' : data.roundLabel}
          </div>

          <h1
            className="stat-value uppercase mt-2 leading-[0.9] text-[clamp(3rem,11vw,4.75rem)]"
            style={{ color: champion ? textColor : '#f87171' }}
          >
            {champion ? 'Champions' : 'Season Over'}
          </h1>
          <div className="font-display font-bold uppercase tracking-[0.3em] text-sm text-chalk mt-2 mb-7">
            {data.city} {data.nickname}
          </div>

          {data.finalScore && (
            <div className="stat-value text-stat-md">
              <span
                className={data.finalScore.mine < data.finalScore.theirs ? 'text-muted' : ''}
                style={{ color: data.finalScore.mine > data.finalScore.theirs ? textColor : undefined }}
              >
                {data.finalScore.mine}
              </span>
              <span className="text-muted"> — </span>
              <span className={data.finalScore.theirs < data.finalScore.mine ? 'text-muted' : ''}>
                {data.finalScore.theirs}
              </span>
              <div className="font-display font-bold uppercase tracking-widest text-xs text-muted mt-2">
                {champion ? 'over' : 'to'} the {data.finalScore.oppCity} {data.finalScore.oppNickname}
              </div>
            </div>
          )}

          {/* The road there — every playoff Game row this team played. */}
          {data.road.length > 0 && (
            <div className="flex gap-2 justify-center flex-wrap mt-7 mb-6">
              {data.road.map((leg, i) => (
                <div
                  key={i}
                  className="trophy-leg rounded-md px-3.5 py-2 min-w-[112px] border"
                  style={{
                    animationDelay: `${0.15 + i * 0.08}s`,
                    background: i === data.road.length - 1 ? 'color-mix(in srgb, var(--team-accent) 10%, transparent)' : 'rgba(255,255,255,.045)',
                    borderColor: i === data.road.length - 1 ? 'var(--team-accent)' : '#33262a',
                  }}
                >
                  <div className="text-[9px] tracking-[0.15em] uppercase font-bold text-muted">{leg.round}</div>
                  <div className="stat-value text-base mt-0.5">
                    <span className={leg.won ? '' : 'text-muted'}>{leg.myScore}</span>
                    <span className="text-muted">-</span>
                    <span className={leg.won ? 'text-muted' : ''}>{leg.theirScore}</span>
                  </div>
                  <div className="font-mono text-[10px] text-muted">{leg.atHome ? 'vs' : '@'} {leg.oppAbbr}</div>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-x-8 gap-y-4 justify-center flex-wrap border-t pt-5" style={{ borderColor: '#33262a' }}>
            <Fact k="Regular season" v={data.record} />
            {data.seed !== null && <Fact k="Seed" v={`${data.seed}${suffix(data.seed)}`} />}
            <Fact k="Point diff" v={`${data.pointDiff > 0 ? '+' : ''}${data.pointDiff}`} tone={data.pointDiff > 0 ? 'text-accent' : data.pointDiff < 0 ? 'text-bad' : undefined} />
            {data.mvp && <Fact k={champion ? 'Final MVP' : 'League MVP'} v={data.mvp.name} small />}
          </div>

          {data.mvp?.statLine && (
            <p className="font-mono text-[11px] text-muted mt-3">{data.mvp.statLine}</p>
          )}
          {!champion && data.nextPick && (
            <p className="text-sm text-muted mt-5">{data.nextPick}</p>
          )}

          <div className="mt-8 flex items-center justify-center gap-3">
            <Link href={`/league/${leagueId}/history`} onClick={onClose} className="btn-primary">
              {champion ? 'Raise the banner' : 'Look at the damage'}
            </Link>
            <button onClick={onClose} className="btn-secondary text-xs">Continue</button>
          </div>
          <p className="text-[11px] text-muted mt-4">Esc closes this.</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Fact({ k, v, tone, small }: { k: string; v: string; tone?: string; small?: boolean }) {
  return (
    <div className="text-center">
      <div className="text-[10px] tracking-[0.14em] uppercase text-muted font-bold">{k}</div>
      <div className={`stat-value mt-1 ${small ? 'text-base' : 'text-stat-sm'} ${tone ?? ''}`}>{v}</div>
    </div>
  );
}

function suffix(n: number): string {
  const m = n % 100;
  if (m >= 11 && m <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}
