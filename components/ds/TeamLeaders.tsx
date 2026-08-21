import Link from 'next/link';
import { positionBadgeClass } from './positionColor';

export interface LeaderEntry {
  /** e.g. "Passing", "Rushing" — the category, not the stat name. */
  category: string;
  id: string;
  name: string;
  position: string;
  /** Pre-formatted, because each category counts a different thing. */
  line: string;
}

/**
 * Who is actually producing for you this season, one name per phase of the
 * game. Deliberately not a stats table — the Stats page owns depth. This is
 * the four names a GM would recite from memory, so it stays to four rows and
 * links straight to the player card.
 */
export function TeamLeaders({ leagueId, leaders }: { leagueId: string; leaders: LeaderEntry[] }) {
  if (leaders.length === 0) {
    return <div className="panel p-4 text-sm text-muted">No games played yet this season.</div>;
  }

  return (
    <div className="panel divide-y divide-line/50">
      {leaders.map((l) => (
        <Link
          key={l.category}
          href={`/league/${leagueId}/player/${l.id}`}
          className="flex items-center gap-2.5 px-3 py-2 hover:bg-raised/50 transition-colors"
        >
          <div className="min-w-0 flex-1">
            <div className="label-sm text-[10px]">{l.category}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`text-[11px] font-semibold shrink-0 ${positionBadgeClass(l.position)}`}>{l.position}</span>
              <span className="text-sm truncate">{l.name}</span>
            </div>
          </div>
          <span className="font-mono text-[11px] text-muted shrink-0 text-right">{l.line}</span>
        </Link>
      ))}
    </div>
  );
}
