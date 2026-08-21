import { TeamLogo } from '../TeamLogo';

/**
 * Draft day's one genuinely "event" moment — a horizontal split (state +
 * identity on the left, the countdown and the actual decision on the
 * right) rather than everything stacked and centered, so it reads as a
 * control panel for the moment, not a poster you just look at. Full
 * team-color treatment, a stadium-light texture, an elevated shadow.
 */
export function OnTheClock({ teamId, abbr, city, round, pick, clock }: {
  teamId: string; abbr: string; city: string; round: number; pick: number; clock: string;
}) {
  const [mm, ss] = clock.split(':');

  return (
    <div
      className="relative overflow-hidden rounded-lg border-2 shadow-elevated"
      style={{
        borderColor: 'var(--team-accent)',
        background: 'radial-gradient(ellipse 120% 140% at 0% 50%, color-mix(in srgb, var(--team-accent) 18%, transparent), transparent 70%)',
      }}
    >
      {/* Stadium-light hash texture — same device as the app's own page
          background, tinted to the team color for this one "event" moment. */}
      <div
        className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{ backgroundImage: 'repeating-linear-gradient(115deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 14px)', color: 'var(--team-accent)' }}
      />
      <TeamLogo seed={teamId} abbr={abbr} size={240} className="watermark-logo opacity-[0.06] -right-16 -top-16" />

      <div className="relative flex flex-wrap items-center gap-6 px-6 py-6">
        <div className="flex items-center gap-4 flex-1 min-w-[260px]">
          <TeamLogo seed={teamId} abbr={abbr} size={56} />
          <div>
            <div className="label-sm">Round {round} · Pick {pick} · {city}</div>
            <div className="font-display font-extrabold text-3xl uppercase tracking-wide leading-none mt-1 text-team">
              On The Clock
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6 shrink-0">
          <div className="text-center">
            <div className="label-sm">Time Remaining</div>
            <div className="scoreboard-digits mt-1.5">
              <span className="stat-value text-stat-xl text-team">{mm}</span>
              <span className="stat-value text-stat-xl text-muted">:</span>
              <span className="stat-value text-stat-xl text-team">{ss}</span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button className="btn-primary">Make Selection</button>
            <button className="btn-secondary">Pause</button>
          </div>
        </div>
      </div>
    </div>
  );
}
