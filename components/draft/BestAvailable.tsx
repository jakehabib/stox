import { positionBadgeClass } from '../ds/positionColor';
import { Tooltip } from '../Tooltip';
import { tip } from '@/lib/glossary';

export interface AvailableRow {
  playerId: string;
  firstName: string;
  lastName: string;
  position: string;
  college: string;
  /** Rank on OUR board — absent when the department never wrote him up. */
  ourRank?: number;
  boardRank?: number;
  bandLabel?: string;
  /** Our own fogged read. A prospect's overall is a range, always. */
  ovrLow: number;
  ovrHigh: number;
  revealed: boolean;
  confidence: number;
  shortlisted: boolean;
  /**
   * How far past his own board rank he is already sitting — the selection now
   * on the clock minus where the room graded him. Positive means the slot the
   * board said he would go in has been and gone and he is still here.
   */
  slid?: number;
}

/**
 * A STEAL, AND WHY THE BAR IS THIS HIGH.
 *
 * A first-round grade still on the board a round's worth of picks past his
 * own slot is the thing a GM leans forward for. Two rounds of names sliding
 * three or four picks is not — that is a board thinning, and painting it gold
 * would spend the colour on nothing.
 *
 * THE NUMBERS ARE MEASURED, NOT CHOSEN. Run out against a live save: through
 * the first thirty-eight selections the most-slid top-thirty-two man on the
 * board reached fourteen picks past his grade, and nobody else got past
 * eleven. So a bar of twelve fires somewhere in the thirties in a draft where
 * the room disagrees with itself, and never at all in one where it does not.
 *
 * AND ONLY ONE ROW EVER CARRIES IT. Both conditions can be true of three men
 * at once, and three gold rows is a colour scheme rather than a moment — so
 * the page marks the single most-slid of them and leaves the rest to their
 * ordinary rows. The window closes on its own, too: once the room's top
 * thirty-two are gone, usually somewhere in the fifties, nothing on this page
 * can qualify again for the rest of the night.
 */
const STEAL_BOARD_CUT = 32;
const STEAL_SLIDE = 12;

/** The one man on either board who should not still be there, or nobody. */
function stealOf(rows: AvailableRow[]): string | undefined {
  let best: AvailableRow | undefined;
  for (const r of rows) {
    if (r.boardRank === undefined || r.boardRank > STEAL_BOARD_CUT) continue;
    if ((r.slid ?? 0) < STEAL_SLIDE) continue;
    if (!best || (r.slid ?? 0) > (best.slid ?? 0)) best = r;
  }
  return best?.playerId;
}

function Row({ leagueId, row, side, steal = false }: {
  leagueId: string; row: AvailableRow; side: 'ours' | 'room';
  /** He is the steal. The glow runs once; the gold edge is what is left of it. */
  steal?: boolean;
}) {
  const gap = row.ourRank !== undefined && row.boardRank !== undefined ? row.boardRank - row.ourRank : undefined;

  return (
    <div className={`flex items-center gap-3 px-4 py-2 border-b border-line/40 last:border-0 ${steal ? 'moment-steal' : ''}`}>
      <span className={`stat-value text-sm w-8 shrink-0 text-right ${side === 'ours' ? 'text-accent2' : 'text-chalk'}`}>
        {side === 'ours' ? row.ourRank : row.boardRank}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 min-w-0">
          <a href={`/league/${leagueId}/player/${row.playerId}`} className="text-sm font-semibold truncate hover:text-accent2">
            {row.firstName} {row.lastName}
          </a>
          <span className={`text-[11px] font-semibold shrink-0 ${positionBadgeClass(row.position)}`}>{row.position}</span>
          {row.shortlisted && <span className="text-gold text-[11px] shrink-0">★</span>}
        </div>
        <div className="text-[11px] text-muted truncate mt-0.5">
          {row.college}
          {side === 'room' && row.bandLabel ? ` · ${row.bandLabel}` : ''}
          {steal && <span className="text-gold"> · still here {row.slid} picks past his grade</span>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-xs font-mono text-chalk">
          {row.revealed ? row.ovrLow : `${row.ovrLow}–${row.ovrHigh}`}
        </div>
        <div className="text-[11px] font-mono mt-0.5">
          {side === 'ours' ? (
            row.boardRank === undefined ? (
              <span className="text-muted">unranked</span>
            ) : (
              <span className={gap !== undefined && gap >= 15 ? 'text-accent' : 'text-muted'}>
                board #{row.boardRank}
              </span>
            )
          ) : row.ourRank === undefined ? (
            <span className="text-muted">no file</span>
          ) : (
            <span className={gap !== undefined && gap >= 15 ? 'text-accent' : gap !== undefined && gap <= -15 ? 'text-warn' : 'text-muted'}>
              ours #{row.ourRank}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * THE TWO BOARDS, SIDE BY SIDE.
 *
 * The public board is free and every club in the league has it. Your own board
 * costs a season of scouting. Putting them next to each other is the only way
 * to see what that season bought — and on a save where nothing was scouted, it
 * is the only way to see that it bought nothing.
 *
 * Neither column shows a rating. The left is our own fogged range and our own
 * ordering of it; the right is the room's rank and its band. A true overall
 * appears nowhere, because the whole draft is the argument about what it is.
 */
export function BestAvailable({ leagueId, ours, room, verdict }: {
  leagueId: string;
  /** Best still on the board by OUR grade. Empty when there are no files. */
  ours: AvailableRow[];
  /** Best still on the board by the public board's rank. */
  room: AvailableRow[];
  /** The single sharpest disagreement, in one line. */
  verdict?: string;
}) {
  // One steal on the page, or none. Worked out across both columns together —
  // the same man often sits in both, and he is one moment, not two.
  const stealId = stealOf([...ours, ...room]);

  return (
    <div className="section">
      <div className="section-head">
        <div>
          <h2 className="section-title inline-flex items-center gap-2">
            Best Available
            <Tooltip text={tip('consensusBoard')} />
          </h2>
          {verdict && <p className="text-xs text-muted mt-1.5">{verdict}</p>}
        </div>
      </div>

      {/* items-start, so the column with nothing in it stays the height of its
          own message instead of being stretched to match eight rows beside it. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="panel overflow-hidden">
          <div className="flex items-baseline justify-between px-4 py-2.5 border-b border-line/70 bg-accent2/[0.06]">
            <h3 className="section-title text-accent2">Our Board</h3>
            <span className="text-[11px] font-mono text-muted">by our own grade</span>
          </div>
          {ours.length === 0 ? (
            <div className="px-4 py-6 space-y-2">
              <p className="text-sm text-chalk/85">
                Our scouts have not filed on anybody in this class.
              </p>
              <p className="text-xs text-muted leading-relaxed">
                Everything on this page is the room&apos;s read, and the room is wrong in ways nobody can
                see from the outside. Star a prospect and the department works him every week of the
                season — the gap between his grade and theirs is the only edge in this building.
              </p>
            </div>
          ) : (
            ours.map((r) => <Row key={r.playerId} leagueId={leagueId} row={r} side="ours" steal={r.playerId === stealId} />)
          )}
        </div>

        <div className="panel overflow-hidden">
          <div className="flex items-baseline justify-between px-4 py-2.5 border-b border-line/70">
            <h3 className="section-title">The Room</h3>
            <span className="text-[11px] font-mono text-muted">public consensus</span>
          </div>
          {room.length === 0 ? (
            <p className="text-sm text-muted px-4 py-6">The board is empty. Everybody has been called.</p>
          ) : (
            room.map((r) => <Row key={r.playerId} leagueId={leagueId} row={r} side="room" steal={r.playerId === stealId} />)
          )}
        </div>
      </div>
    </div>
  );
}
