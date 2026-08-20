import { PlayerAvatar } from '../PlayerAvatar';
import { RatingBadge } from './RatingBadge';
import { ScoutingRange } from './ScoutingRange';

interface Attribute { label: string; value: number }

export function PlayerHero({
  playerId, name, position, jersey, age, ovr, potentialLow, potentialHigh, confidence, contract, attributes, teamColor,
}: {
  playerId: string; name: string; position: string; jersey?: number; age: number; ovr: number;
  potentialLow: number; potentialHigh: number; confidence: number;
  contract?: string;
  attributes: Attribute[];
  teamColor?: string;
}) {
  return (
    <div className="flex flex-wrap items-start gap-6">
      <PlayerAvatar seed={playerId} age={age} size={112} teamColor={teamColor} />

      <div className="flex-1 min-w-[220px]">
        <div className="font-display font-bold text-3xl uppercase tracking-wide leading-none">{name}</div>
        <div className="text-sm text-muted mt-1.5">
          {position}{jersey ? ` · #${jersey}` : ''} · Age {age}
        </div>
        {contract && <div className="text-sm font-medium mt-3">{contract}</div>}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 mt-4 max-w-md">
          {attributes.map((a) => (
            <div key={a.label}>
              <div className="flex items-baseline justify-between">
                <span className="label-sm">{a.label}</span>
                <span className="font-mono text-xs text-chalk">{a.value}</span>
              </div>
              <div className="h-1 rounded-full bg-raised overflow-hidden mt-1">
                <div className="h-full bg-accent2/70 rounded-full" style={{ width: `${a.value}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-start gap-6">
        <RatingBadge value={ovr} label="OVERALL" size="lg" />
        <ScoutingRange low={potentialLow} high={potentialHigh} confidence={confidence} label="POTENTIAL" />
      </div>
    </div>
  );
}
