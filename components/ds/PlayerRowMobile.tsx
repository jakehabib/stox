import { PlayerAvatar } from '../PlayerAvatar';
import { ratingColor } from '@/lib/ratings';

/**
 * The same roster-row information as the desktop table, reflowed for a
 * narrow screen instead of shrunk into unreadable columns.
 */
export function PlayerRowMobile({
  playerId, position, name, age, ovr, potentialLow, potentialHigh, capHit, yearsRemaining, weightLb, heightIn,
}: {
  playerId: string; position: string; name: string; age: number; ovr: number;
  potentialLow: number; potentialHigh: number; capHit: string; yearsRemaining: number;
  /** Optional — without a weight the portrait falls back to this position's average build. */
  weightLb?: number; heightIn?: number;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-line/60 last:border-0">
      <PlayerAvatar seed={playerId} age={age} size={36} weightLb={weightLb} heightIn={heightIn} position={position} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold truncate">{position} · {name}</div>
        <div className="text-xs text-muted mt-0.5">Age {age} · Potential {potentialLow}–{potentialHigh}</div>
        <div className="text-xs text-muted">{capHit} · {yearsRemaining} yr{yearsRemaining === 1 ? '' : 's'}</div>
      </div>
      <span className={`stat-value text-stat-sm ${ratingColor(ovr)}`}>{ovr}</span>
    </div>
  );
}
