import Link from 'next/link';
import { positionBadgeClass } from './positionColor';

export interface InjuryEntry {
  id: string;
  name: string;
  position: string;
  ovr: number;
  weeks: number;
  type: string | null;
  /** Sits atop their position group — losing them actually changes the lineup. */
  isStarter: boolean;
}

/**
 * The header already says "54 (3 inj)". A count with no names is a tease —
 * the whole reason a GM cares is *which* three, and whether any of them
 * start. Starters lead the list and are flagged, because that's the
 * difference between a roster note and a lineup problem.
 */
export function InjuryReport({ leagueId, entries }: { leagueId: string; entries: InjuryEntry[] }) {
  if (entries.length === 0) {
    return <div className="panel p-4 text-sm text-muted">Everyone's healthy.</div>;
  }

  return (
    <div className="panel divide-y divide-line/50">
      {entries.map((e) => (
        <Link
          key={e.id}
          href={`/league/${leagueId}/player/${e.id}`}
          className="flex items-center gap-2.5 px-3 py-2 hover:bg-raised/50 transition-colors"
        >
          <span className={`text-[11px] font-semibold w-9 shrink-0 ${positionBadgeClass(e.position)}`}>{e.position}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm truncate">{e.name}</span>
              {/* 10px, matching the identical Starter tag on the roster
                  table. 9px was the smallest type in the application and the
                  only place this one label wore a different size. */}
              {e.isStarter && <span className="text-[10px] uppercase tracking-wider font-semibold text-warn shrink-0">Starter</span>}
            </div>
            <div className="text-[11px] text-muted truncate">{e.type ?? 'Undisclosed'}</div>
          </div>
          <span className="stat-value text-stat-sm text-bad shrink-0">{e.weeks}<span className="text-[10px] font-normal">w</span></span>
        </Link>
      ))}
    </div>
  );
}
