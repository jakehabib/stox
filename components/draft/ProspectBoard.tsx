import { PlayerAvatar } from '../PlayerAvatar';
import { ShortlistStar } from '../ShortlistStar';
import { DraftSelectionButton } from '../DraftSelectionButton';
import { positionBadgeClass } from '../ds/positionColor';
import { Tooltip } from '../Tooltip';
import { SectionHeading } from '../ds/SectionHeading';
import { ratingColor } from '@/lib/ratings';
import { define, tip } from '@/lib/glossary';

export type BoardSortKey = 'consensus' | 'ours' | 'pos' | 'ovr' | 'age' | 'potential';

export interface BoardRow {
  playerId: string;
  firstName: string;
  lastName: string;
  position: string;
  college: string;
  age: number;
  heightIn: number;
  weightLb: number;
  /** Public board. */
  boardRank?: number;
  boardGrade?: number;
  bandLabel?: string;
  /** The room's line, or ours where we disagree with it. */
  boardNote?: string;
  rankBadge?: { label: string; className: string };
  /** Our own board — absent under a real file. */
  ourRank?: number;
  /** Our grade on the room's own scale, quoted only when it means something. */
  ourGrade?: number;
  /** Our fogged read. Never a true rating. */
  ovrLow: number;
  ovrHigh: number;
  revealed: boolean;
  scoutedOvr: number;
  potLow: number;
  potHigh: number;
  potentialRevealed: boolean;
  potential: number;
  confidence: number;
  label: string;
  labelClass: string;
  shortlisted: boolean;
}

/**
 * THE BOARD ITSELF — unchanged in substance from the draft page, because it is
 * the best thing on it.
 *
 * The scouted range, the potential range, the room's grade with ours beside it
 * and the projection language are the whole fog-of-war, and a broadcast that
 * dropped them would be a prettier screen that knew less. What is added is one
 * column: where the man sits on OUR board, next to where he sits on theirs.
 * That is the comparison the rest of this page is built around, and until now
 * you could only make it a row at a time in your head.
 */
export function ProspectBoard({
  leagueId, teamId, rows, positions, activePos, shortlistOnly, shortlistCount,
  sortKey, dir, sortHref, posHref, shortlistHref, availableCount, scoutingEnabled, onClock,
}: {
  leagueId: string;
  teamId: string;
  rows: BoardRow[];
  positions: string[];
  activePos?: string;
  shortlistOnly: boolean;
  shortlistCount: number;
  sortKey: BoardSortKey;
  dir: number;
  sortHref: (key: BoardSortKey) => string;
  posHref: (pos?: string) => string;
  shortlistHref: () => string;
  availableCount: number;
  scoutingEnabled: boolean;
  /** Present only while this club is the one on the clock. */
  onClock?: { year: number; round: number; overall: number; team: { id: string; abbr: string; city: string; nickname: string } };
}) {
  const arrow = (key: BoardSortKey) => (sortKey === key ? (dir === -1 ? ' ▾' : ' ▴') : '');

  return (
    <div className="section">
      <SectionHeading
        title="Still On The Board"
        tip={tip('consensusBoard')}
        action={
          <div className="flex gap-2 flex-wrap items-center justify-end">
            <span className="text-[11px] font-mono text-muted mr-1">{availableCount} undrafted</span>
            <a href={posHref()} className={`pill ${!activePos ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted'}`}>All</a>
            {positions.map((pos) => (
              <a key={pos} href={posHref(pos)} className={`pill ${activePos === pos ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted'}`}>{pos}</a>
            ))}
            <a href={shortlistHref()} className={`pill ${shortlistOnly ? 'border-gold text-gold bg-gold/10' : 'border-line text-muted'}`}>
              ★ Shortlist {shortlistCount > 0 && `(${shortlistCount})`}
            </a>
          </div>
        }
      />

      <div className="panel overflow-hidden">
        <table className="table-clean">
          <thead>
            <tr>
              <th></th>
              <th className="text-right">
                <span className="inline-flex items-center gap-1">
                  <a href={sortHref('ours')} className="hover:text-chalk">Ours{arrow('ours')}</a>
                  <Tooltip placement="bottom" align="start" text="Where this club's own scouts have him, ranked by our grade against the same blend of present and ceiling the room uses. Only men we have a real file on are on it." />
                </span>
              </th>
              <th className="text-right"><a href={sortHref('consensus')} className="hover:text-chalk">Board{arrow('consensus')}</a></th>
              <th><a href={sortHref('pos')} className="hover:text-chalk">Pos{arrow('pos')}</a></th>
              <th>Name</th>
              <th><a href={sortHref('age')} className="hover:text-chalk">Age{arrow('age')}</a></th>
              <th>
                <span className="inline-flex items-center gap-1">
                  <a href={sortHref('ovr')} className="hover:text-chalk">{scoutingEnabled ? 'Scouted' : 'OVR'}{arrow('ovr')}</a>
                  <Tooltip placement="bottom" text={scoutingEnabled ? tip('scoutedRange') : tip('overall')} />
                </span>
              </th>
              <th>
                <span className="inline-flex items-center gap-1">
                  <a href={sortHref('potential')} className="hover:text-chalk">Potential{arrow('potential')}</a>
                  <Tooltip placement="bottom" text={tip('potential')} />
                </span>
              </th>
              <th>
                <span className="inline-flex items-center gap-1">
                  Board Grade
                  <Tooltip placement="bottom" text={`${tip('boardGrade')} ${define('draftBand')}`} />
                </span>
              </th>
              <th>
                <span className="inline-flex items-center gap-1">
                  Projection
                  <Tooltip placement="bottom" align="end" text={tip('prospectProjection')} />
                </span>
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.playerId}>
                <td><ShortlistStar leagueId={leagueId} teamId={teamId} playerId={r.playerId} initial={r.shortlisted} /></td>
                <td className={`stat-value text-stat-sm text-right ${r.ourRank !== undefined ? 'text-accent2' : 'text-muted/50'}`}>
                  {r.ourRank ?? '—'}
                </td>
                <td className="stat-value text-stat-sm text-muted text-right">{r.boardRank ?? '—'}</td>
                <td><span className={`font-semibold text-xs ${positionBadgeClass(r.position)}`}>{r.position}</span></td>
                <td className="font-medium">
                  <div className="flex items-center gap-2">
                    <a href={`/league/${leagueId}/player/${r.playerId}`} className="flex items-center gap-2 hover:text-accent2">
                      <PlayerAvatar seed={r.playerId} age={r.age} size={26} weightLb={r.weightLb} heightIn={r.heightIn} position={r.position} />
                      {r.firstName} {r.lastName}
                      <span className="text-xs text-muted">{r.college}</span>
                    </a>
                    {r.rankBadge && (
                      <span className={`pill text-[10px] px-1.5 py-0.5 border-current ${r.rankBadge.className}`}>{r.rankBadge.label}</span>
                    )}
                  </div>
                </td>
                <td className="text-muted">{r.age}</td>
                <td className={`stat-value text-stat-sm ${ratingColor(r.scoutedOvr)}`}>
                  {r.revealed ? r.scoutedOvr : `${r.ovrLow}-${r.ovrHigh}`}
                </td>
                <td className="text-muted font-mono">{r.potentialRevealed ? r.potential : `${r.potLow}-${r.potHigh}`}</td>
                <td>
                  {r.boardGrade !== undefined && (
                    <div className="flex items-baseline gap-1.5 whitespace-nowrap" title={r.boardNote}>
                      <span className="stat-value text-stat-sm text-chalk">{r.boardGrade}</span>
                      {r.ourGrade !== undefined && Math.abs(r.ourGrade - r.boardGrade) >= 4 && (
                        <span className={`text-[11px] font-mono ${r.ourGrade > r.boardGrade ? 'text-accent' : 'text-warn'}`}>
                          us {r.ourGrade}
                        </span>
                      )}
                    </div>
                  )}
                  {r.bandLabel && <div className="text-[10px] text-muted leading-none mt-0.5">{r.bandLabel}</div>}
                </td>
                <td><span className={`text-xs font-medium ${r.labelClass}`}>{r.label}</span></td>
                <td>
                  {onClock && (
                    <DraftSelectionButton
                      leagueId={leagueId}
                      teamId={teamId}
                      moment={{
                        team: onClock.team,
                        pick: { year: onClock.year, round: onClock.round, overall: onClock.overall },
                        player: {
                          id: r.playerId,
                          firstName: r.firstName,
                          lastName: r.lastName,
                          position: r.position,
                          age: r.age,
                          college: r.college,
                          heightIn: r.heightIn,
                          weightLb: r.weightLb,
                          // The file this pick was MADE on. Drafting clears
                          // Player.isDraftee, which is buildScoutedView's scope
                          // gate, so a view rebuilt a moment later would print
                          // his true rating on the one screen that exists to
                          // celebrate not knowing yet.
                          ovrLow: r.ovrLow,
                          ovrHigh: r.ovrHigh,
                          ovrExact: r.revealed ? r.scoutedOvr : undefined,
                          potLow: r.potLow,
                          potHigh: r.potHigh,
                          potExact: r.potentialRevealed ? r.potential : undefined,
                          confidence: r.confidence,
                          label: r.label,
                          labelClass: r.labelClass,
                          boardRank: r.boardRank,
                          boardGrade: r.boardGrade,
                          bandLabel: r.bandLabel,
                          boardNote: r.boardNote,
                        },
                      }}
                    />
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="text-muted text-sm py-6 text-center">
                  Nobody left matching that filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
