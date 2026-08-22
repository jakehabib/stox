import { PlayerAvatar } from '../PlayerAvatar';
import { TeamLogo } from '../TeamLogo';
import { SectionHeading } from './SectionHeading';
import { positionBadgeClass } from './positionColor';

export interface RecapSelection {
  playerId: string;
  overall: number;
  round: number;
  firstName: string;
  lastName: string;
  position: string;
  age: number;
  college: string;
  heightIn: number;
  weightLb: number;
  /** The public board's read on him, as it stood over the whole class. */
  boardRank?: number;
  boardGrade?: number;
  bandLabel?: string;
  /** The club whose pick this originally was, when it wasn't yours. */
  from?: { teamId: string; abbr: string };
}

export interface RecapLeaguePick {
  overall: number;
  teamId: string;
  teamAbbr: string;
  isUser: boolean;
  firstName: string;
  lastName: string;
  position: string;
  boardRank?: number;
}

/** One fact about how the room went. Never a verdict on whether a pick worked. */
export interface RecapNote {
  label: string;
  value: string;
  detail?: string;
}

/**
 * WHAT THE ROOM ACTUALLY DID.
 *
 * The draft used to end with the board simply emptying out. This is the
 * event's own record: the club's class in the order it was taken, the top of
 * the first round, and the handful of things that were true on the night.
 *
 * Deliberately confined to what was knowable in the room — where a player
 * went against where the public board had him, which positions ran, whose
 * picks were whose. Nothing here grades a class against a career that has not
 * been played yet.
 */
export function DraftRecap({ year, teamAbbr, teamId, selections, roundOne, notes }: {
  year: number;
  teamAbbr: string;
  teamId: string;
  selections: RecapSelection[];
  roundOne: RecapLeaguePick[];
  notes: RecapNote[];
}) {
  return (
    <div className="section">
      <SectionHeading
        eyebrow={`${year} Rookie Draft`}
        title="Draft Recap"
        action={
          <span className="text-xs text-muted">
            {selections.length} selection{selections.length === 1 ? '' : 's'} by {teamAbbr}
          </span>
        }
      />

      {notes.length > 0 && (
        <div className="panel grid grid-cols-2 lg:grid-cols-4 divide-x divide-line/40">
          {notes.map((n) => (
            <div key={n.label} className="px-4 py-3">
              <div className="label-sm">{n.label}</div>
              <div className="text-sm font-semibold text-chalk mt-1 leading-tight">{n.value}</div>
              {n.detail && <div className="text-[11px] text-muted mt-1">{n.detail}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr] items-start">
        <div className="panel overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line/60">
            <TeamLogo seed={teamId} abbr={teamAbbr} size={20} />
            <h3 className="section-title">Your Class</h3>
          </div>
          {selections.length === 0 ? (
            <p className="text-sm text-muted px-4 py-3">No selections — every pick was traded away.</p>
          ) : (
            <table className="table-clean">
              <thead>
                <tr>
                  <th>Pick</th>
                  <th>Player</th>
                  <th>Age</th>
                  <th>Board</th>
                  <th>Grade</th>
                </tr>
              </thead>
              <tbody>
                {selections.map((s) => (
                  <tr key={s.playerId}>
                    <td className="whitespace-nowrap">
                      <span className="stat-value text-stat-sm text-chalk">#{s.overall}</span>
                      <span className="text-[11px] text-muted font-mono ml-1.5">R{s.round}</span>
                      {s.from && (
                        <span className="flex items-center gap-1 mt-0.5" title={`Acquired from ${s.from.abbr}`}>
                          <TeamLogo seed={s.from.teamId} abbr={s.from.abbr} size={14} />
                          <span className="text-[10px] text-accent2">from {s.from.abbr}</span>
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <PlayerAvatar seed={s.playerId} age={s.age} size={26} weightLb={s.weightLb} heightIn={s.heightIn} position={s.position} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`font-semibold text-xs ${positionBadgeClass(s.position)}`}>{s.position}</span>
                            <span className="font-medium truncate">{s.firstName} {s.lastName}</span>
                          </div>
                          <div className="text-[11px] text-muted">{s.college}</div>
                        </div>
                      </div>
                    </td>
                    <td className="text-muted">{s.age}</td>
                    <td className="whitespace-nowrap">
                      {s.boardRank !== undefined ? (
                        <>
                          <span className="font-mono text-sm text-chalk">#{s.boardRank}</span>
                          <div className="text-[10px] text-muted">{boardGap(s.boardRank, s.overall)}</div>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {s.boardGrade !== undefined && <span className="stat-value text-stat-sm text-chalk">{s.boardGrade}</span>}
                      {s.bandLabel && <div className="text-[10px] text-muted leading-none mt-0.5">{s.bandLabel}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line/60">
            <h3 className="section-title">Round One</h3>
          </div>
          <div className="divide-y divide-line/40">
            {roundOne.map((p) => (
              <div key={p.overall} className={`flex items-center gap-2 px-3 py-1.5 ${p.isUser ? 'bg-accent2/10' : ''}`}>
                <span className="w-7 shrink-0 text-right font-mono text-[11px] text-muted">{p.overall}</span>
                <TeamLogo seed={p.teamId} abbr={p.teamAbbr} size={18} />
                <span className="font-mono text-[11px] w-8 shrink-0">{p.teamAbbr}</span>
                <span className={`text-[10px] font-semibold w-9 shrink-0 ${positionBadgeClass(p.position)}`}>{p.position}</span>
                <span className="text-xs truncate flex-1">{p.firstName} {p.lastName}</span>
                {p.boardRank !== undefined && <span className="text-[10px] text-muted font-mono shrink-0">bd #{p.boardRank}</span>}
              </div>
            ))}
            {roundOne.length === 0 && <p className="text-sm text-muted px-4 py-3">No selections recorded.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function boardGap(boardRank: number, overall: number): string {
  if (boardRank === overall) return 'on the board';
  return boardRank > overall ? `${boardRank - overall} early` : `+${overall - boardRank} slide`;
}
