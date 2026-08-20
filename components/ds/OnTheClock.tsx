import { TeamLogo } from '../TeamLogo';
import { IconClock } from './icons';

/**
 * Draft day's one genuinely "event" moment — this should look and feel
 * different from browsing prospects in Week 6: a broadcast-style status
 * tag, a scoreboard-style clock readout (not a plain number), full
 * team-color treatment, an elevated shadow.
 */
export function OnTheClock({ teamId, abbr, city, round, pick, clock }: {
  teamId: string; abbr: string; city: string; round: number; pick: number; clock: string;
}) {
  const [mm, ss] = clock.split(':');

  return (
    <div
      className="relative overflow-hidden rounded-lg border-2 shadow-elevated px-6 py-7 text-center"
      style={{
        borderColor: 'var(--team-accent)',
        background: 'radial-gradient(ellipse 140% 100% at 50% -20%, color-mix(in srgb, var(--team-accent) 18%, transparent), transparent 65%)',
      }}
    >
      {/* Corner placement, not centered — a centered watermark this large
          always collides with something in a vertically-stacked, centered
          layout (its bottom point, or the abbreviation baked into its
          middle). Same proven placement as TeamHeader's watermark. */}
      <TeamLogo seed={teamId} abbr={abbr} size={240} className="watermark-logo opacity-[0.06] -right-16 -top-16" />
      <div className="relative">
        <div
          className="pill inline-flex items-center gap-1.5"
          style={{
            borderColor: 'var(--team-accent)',
            color: 'var(--team-accent)',
            background: 'color-mix(in srgb, var(--team-accent) 16%, transparent)',
          }}
        >
          <IconClock size={12} /> ON THE CLOCK
        </div>

        <div className="label-sm mt-3">ROUND {round} · PICK {pick}</div>
        <div className="flex items-center justify-center gap-3 mt-2">
          <TeamLogo seed={teamId} abbr={abbr} size={40} />
          <div className="font-display font-extrabold text-2xl uppercase tracking-wide">{city}</div>
        </div>

        <div className="scoreboard-digits mt-4">
          <span className="stat-value text-stat-lg" style={{ color: 'var(--team-accent)' }}>{mm}</span>
          <span className="stat-value text-stat-lg text-muted">:</span>
          <span className="stat-value text-stat-lg" style={{ color: 'var(--team-accent)' }}>{ss}</span>
        </div>
      </div>
    </div>
  );
}
