import { TeamLogo } from '../TeamLogo';

interface Side { teamId: string; abbr: string; city: string; wins: number; losses: number; ties?: number }

export function MatchupCard({ away, home, weekLabel, score }: {
  away: Side; home: Side; weekLabel: string;
  /** Present once the game's been played. */
  score?: { away: number; home: number };
}) {
  return (
    <div className="card px-5 py-4">
      <div className="label-sm text-center mb-3">{weekLabel}</div>
      <div className="flex items-center justify-between">
        <MatchupSide side={away} score={score?.away} align="left" />
        <div className="font-display text-muted text-sm px-3">@</div>
        <MatchupSide side={home} score={score?.home} align="right" />
      </div>
    </div>
  );
}

function MatchupSide({ side, score, align }: { side: Side; score?: number; align: 'left' | 'right' }) {
  const record = `${side.wins}-${side.losses}${side.ties ? `-${side.ties}` : ''}`;
  const row = (
    <>
      <TeamLogo seed={side.teamId} abbr={side.abbr} size={36} />
      <div>
        <div className="font-display font-bold uppercase tracking-wide leading-none">{side.city}</div>
        <div className="text-xs text-muted mt-1">{record}</div>
      </div>
    </>
  );
  return (
    <div className={`flex items-center gap-3 flex-1 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
      {row}
      {score !== undefined && <span className="stat-value text-stat-lg ml-2">{score}</span>}
    </div>
  );
}
