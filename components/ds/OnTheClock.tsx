import { TeamLogo } from '../TeamLogo';

/**
 * Draft day's one genuinely "event" moment — this is the state that should
 * look different from browsing prospects in Week 6. Elevated shadow, full
 * team-color treatment (not just an accent line), a running clock.
 */
export function OnTheClock({ teamId, abbr, city, round, pick, clock }: {
  teamId: string; abbr: string; city: string; round: number; pick: number; clock: string;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-lg border-2 shadow-elevated px-6 py-6 text-center"
      style={{
        borderColor: 'var(--team-accent)',
        background: 'radial-gradient(ellipse 140% 100% at 50% -20%, color-mix(in srgb, var(--team-accent) 16%, transparent), transparent 65%)',
      }}
    >
      <TeamLogo seed={teamId} abbr={abbr} size={320} className="watermark-logo opacity-[0.12] left-1/2 -top-24 -translate-x-1/2" />
      <div className="relative">
        <div className="label-sm">ROUND {round} · PICK {pick}</div>
        <div className="flex items-center justify-center gap-3 mt-2">
          <TeamLogo seed={teamId} abbr={abbr} size={40} />
          <div className="font-display font-extrabold text-2xl uppercase tracking-wide">{city}</div>
        </div>
        <div className="font-display font-bold text-sm uppercase tracking-[0.2em] text-muted mt-1">is on the clock</div>
        <div className="stat-value text-stat-xl mt-3" style={{ color: 'var(--team-accent)' }}>{clock}</div>
      </div>
    </div>
  );
}
