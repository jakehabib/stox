import { PlayerAvatar } from '../PlayerAvatar';
import { ScoutingRange } from './ScoutingRange';
import { IconStar } from './icons';
import { positionBadgeClass } from './positionColor';

export function ProspectRow({
  playerId, rank, position, name, college, ovrLow, ovrHigh, confidence, potentialTag, shortlisted, topN, onClock,
}: {
  playerId: string; rank: number; position: string; name: string; college: string;
  ovrLow: number; ovrHigh: number; confidence: number; potentialTag: string;
  shortlisted?: boolean; topN?: boolean;
  /** Show the Draft action — only meaningful during a live draft, not the year-round board. */
  onClock?: boolean;
}) {
  return (
    <div className="flex items-center gap-4 py-2.5 border-b border-line/60 last:border-0">
      <div className="stat-value text-stat-sm text-muted w-8 text-right shrink-0">{rank}</div>
      <PlayerAvatar seed={playerId} age={21} size={40} />
      <div className="min-w-0 flex-1">
        {/* Name gets its own full-width line — tags/position/college live
            below rather than fighting the name for horizontal space, which
            was truncating names mid-word once the Draft button was added. */}
        <div className="font-semibold truncate">{name}</div>
        <div className="text-xs mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span className={`font-semibold ${positionBadgeClass(position)}`}>{position}</span>
          <span className="text-muted">{college}</span>
          {topN && <span className="pill border-gold/40 text-gold">TOP 10</span>}
          <span className="pill border-line text-muted">{potentialTag}</span>
        </div>
      </div>
      <ScoutingRange low={ovrLow} high={ovrHigh} confidence={confidence} className="w-28 hidden sm:block" />
      <button
        className={`btn-icon shrink-0 ${shortlisted ? 'text-gold' : ''}`}
        aria-label={shortlisted ? 'Remove from shortlist' : 'Add to shortlist'}
      >
        <IconStar size={16} filled={shortlisted} />
      </button>
      {onClock && <button className="btn-secondary text-xs shrink-0">Draft</button>}
    </div>
  );
}
