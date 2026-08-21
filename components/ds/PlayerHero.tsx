import { PlayerAvatar } from '../PlayerAvatar';
import { RatingBadge } from './RatingBadge';
import { ScoutingRange } from './ScoutingRange';
import { StatNumber } from './StatNumber';
import { positionBadgeClass } from './positionColor';

interface KeyStat { value: string; label: string }

/**
 * A signed player's hero — full-bleed, team-tinted, built to feel like a
 * card, not a form. Attributes live in their own section below (see the
 * Ratings section on the player page) — the hero's job is identity + the
 * two or three numbers that actually define this player at a glance.
 */
export function PlayerHero({
  playerId, name, position, jersey, age, ovr, potentialLow, potentialHigh, confidence, contract, keyStats, tags, teamColor,
}: {
  playerId: string; name: string; position: string; jersey?: number; age: number; ovr: number;
  potentialLow: number; potentialHigh: number; confidence: number;
  contract?: string;
  keyStats?: KeyStat[];
  tags?: string[];
  teamColor?: string;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-lg border border-line/70"
      style={{
        ['--team-accent' as never]: teamColor,
        background: teamColor ? `radial-gradient(ellipse 90% 130% at 0% 50%, color-mix(in srgb, ${teamColor} 20%, transparent), transparent 70%)` : undefined,
      }}
    >
      <div className="flex flex-wrap items-center gap-6 p-6">
        <div className="relative shrink-0 rounded-lg p-3" style={{ background: teamColor ? `color-mix(in srgb, ${teamColor} 14%, transparent)` : undefined }}>
          <PlayerAvatar seed={playerId} age={age} size={112} teamColor={teamColor} />
        </div>

        <div className="flex-1 min-w-[240px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`pill border ${positionBadgeClass(position)}`}>{position}</span>
            {jersey && <span className="text-sm text-muted">#{jersey}</span>}
            <span className="text-sm text-muted">Age {age}</span>
            {tags?.map((t) => <span key={t} className="pill border-gold/40 text-gold">{t}</span>)}
          </div>
          <div className="font-display font-extrabold text-4xl uppercase tracking-wide leading-none mt-2">{name}</div>
          {contract && <div className="text-sm text-muted mt-2">{contract}</div>}

          {keyStats && keyStats.length > 0 && (
            <div className="flex items-baseline gap-6 mt-4">
              {keyStats.map((s) => (
                <StatNumber key={s.label} value={s.value} label={s.label} size="sm" />
              ))}
            </div>
          )}
        </div>

        <div className="flex items-start gap-6 shrink-0">
          <RatingBadge value={ovr} label="OVERALL" size="lg" filled />
          <ScoutingRange low={potentialLow} high={potentialHigh} confidence={confidence} label="POTENTIAL" />
        </div>
      </div>
    </div>
  );
}
