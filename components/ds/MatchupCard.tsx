import { TeamLogo } from '../TeamLogo';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';

interface Side { teamId: string; abbr: string; city: string; wins: number; losses: number; ties?: number }

export function MatchupCard({ away, home, weekLabel, score }: {
  away: Side; home: Side; weekLabel: string;
  /** Present once the game's been played. */
  score?: { away: number; home: number };
}) {
  return (
    <div className="card overflow-hidden">
      <div className="label-sm text-center pt-4">{weekLabel}</div>
      <div className="flex items-center justify-between px-5 py-3 gap-2">
        <MatchupSide side={away} score={score?.away} align="left" />
        <div className="font-display text-muted text-sm px-1 shrink-0">@</div>
        <MatchupSide side={home} score={score?.home} align="right" />
      </div>
      {/* Split identity bar — each side's own team color, not a shared accent. */}
      <div className="h-[3px] w-full flex">
        <div className="flex-1" style={{ background: generateTeamLogoParams(away.abbr).primary }} />
        <div className="flex-1" style={{ background: generateTeamLogoParams(home.abbr).primary }} />
      </div>
    </div>
  );
}

function MatchupSide({ side, score, align }: { side: Side; score?: number; align: 'left' | 'right' }) {
  const record = `${side.wins}-${side.losses}${side.ties ? `-${side.ties}` : ''}`;
  // Curated team colors are deliberately dark for use as fills/borders —
  // several fail contrast as small text on this near-black background, so
  // lighten at render time rather than using the raw primary hex.
  const textColor = `color-mix(in srgb, ${generateTeamLogoParams(side.abbr).primary} 60%, white 40%)`;
  const row = (
    <>
      <TeamLogo seed={side.teamId} abbr={side.abbr} size={36} className="shrink-0" />
      <div className="min-w-0">
        <div className="font-display font-bold uppercase tracking-wide leading-none truncate" style={{ color: textColor }}>{side.city}</div>
        <div className="text-xs text-muted mt-1">{record}</div>
      </div>
    </>
  );
  return (
    <div className={`flex items-center gap-2 flex-1 min-w-0 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
      {row}
      {score !== undefined && <span className="stat-value text-stat-lg shrink-0">{score}</span>}
    </div>
  );
}
