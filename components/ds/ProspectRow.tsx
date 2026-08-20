import { PlayerAvatar } from '../PlayerAvatar';
import { ScoutingRange } from './ScoutingRange';
import { IconStar } from './icons';

export function ProspectRow({
  playerId, rank, position, name, college, ovrLow, ovrHigh, confidence, potentialTag, shortlisted, topN,
}: {
  playerId: string; rank: number; position: string; name: string; college: string;
  ovrLow: number; ovrHigh: number; confidence: number; potentialTag: string;
  shortlisted?: boolean; topN?: boolean;
}) {
  return (
    <div className="flex items-center gap-4 py-2.5 border-b border-line/60 last:border-0">
      <div className="stat-value text-stat-sm text-muted w-8 text-right shrink-0">{rank}</div>
      <PlayerAvatar seed={playerId} age={21} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold truncate">{name}</span>
          {topN && <span className="pill border-gold/40 text-gold">TOP 10</span>}
          <span className="pill border-line text-muted">{potentialTag}</span>
        </div>
        <div className="text-xs text-muted mt-0.5">{position} · {college}</div>
      </div>
      <ScoutingRange low={ovrLow} high={ovrHigh} confidence={confidence} />
      <button
        className={`btn-icon shrink-0 ${shortlisted ? 'text-gold' : ''}`}
        aria-label={shortlisted ? 'Remove from shortlist' : 'Add to shortlist'}
      >
        <IconStar size={16} filled={shortlisted} />
      </button>
    </div>
  );
}
