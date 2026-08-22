import { TeamLogo } from '../TeamLogo';
import { positionBadgeClass } from '../ds/positionColor';

export interface FeedRow {
  pickId: string;
  round: number;
  overall: number;
  team: { id: string; abbr: string };
  isUser: boolean;
  player: { id: string; firstName: string; lastName: string; position: string; college: string };
  /** Where the public board had him. */
  boardRank?: number;
  /** Where OUR board had him — absent when the department never wrote him up. */
  ourRank?: number;
  shortlisted: boolean;
  /** Set when his position is one of the holes this club came here to fill. */
  atOurNeed?: string;
  /** Positive: he waited past the board. Negative: taken ahead of it. */
  slide?: number;
  /** Nth man at his position off the board in this draft. */
  positionCount?: number;
}

interface Chip { text: string; className: string }

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/**
 * At most two per row, in the order a GM would notice them: a man we were
 * personally watching, then our own disagreement with the room, then the
 * room's disagreement with itself, then the run, then the hole somebody else
 * just filled ahead of us. Four chips on a row is a row nobody reads.
 */
function chipsFor(row: FeedRow): Chip[] {
  const chips: Chip[] = [];
  const push = (text: string, className: string) => { if (chips.length < 2) chips.push({ text, className }); };

  if (row.shortlisted) push('★ Our shortlist', 'border-gold/50 text-gold bg-gold/10');
  if (row.ourRank !== undefined && row.boardRank !== undefined && row.boardRank - row.ourRank >= 15) {
    push(`We had him #${row.ourRank}`, 'border-accent2/50 text-accent2 bg-accent2/10');
  }
  if ((row.slide ?? 0) >= 12) push(`Slid ${row.slide} picks`, 'border-line text-muted');
  if ((row.slide ?? 0) <= -100) {
    // Past a hundred places the arithmetic stops being the story. The room did
    // not rate him low, it was not looking at him at all, and "310 picks early"
    // reads like a broken number rather than a club backing its own tape.
    push('Off the board’s radar', 'border-warn/40 text-warn bg-warn/5');
  } else if ((row.slide ?? 0) <= -12) {
    push(`${-(row.slide ?? 0)} picks early`, 'border-warn/40 text-warn bg-warn/5');
  }
  if ((row.positionCount ?? 0) >= 3) {
    push(`${ordinal(row.positionCount!)} ${row.player.position} gone`, 'border-line text-muted');
  }
  if (row.atOurNeed) push(`Our need · ${row.atOurNeed}`, 'border-bad/40 text-bad bg-bad/5');
  return chips;
}

/**
 * EVERY PICK, NEWEST FIRST, WITH THE ONE THING THAT MAKES IT LAND.
 *
 * What this replaced was the transaction headline — a line of grey text per
 * pick, in the order they were written. That tells you a name and a club. It
 * does not tell you the thing you are actually watching for: that the man you
 * had sixth just went thirty-first, that the club two picks ahead of you took
 * the tackle, that the run is on.
 *
 * So every row carries the pick AND what it did to your draft. The chips are
 * capped at two — this is a feed to be scanned during a five-second clock, not
 * a report to be studied.
 */
export function SelectionFeed({ rows, made, total, leagueId }: {
  rows: FeedRow[];
  made: number;
  total: number;
  leagueId: string;
}) {
  return (
    // Capped to the viewport rather than to the content, so the rail can be
    // made sticky beside a much taller column of analysis without the feed's
    // own length deciding how tall this row of the page is.
    <div className="panel flex flex-col min-h-0 xl:max-h-[calc(100vh-12rem)]">
      <div className="flex items-baseline justify-between px-4 py-2.5 border-b border-line/70 shrink-0">
        <h2 className="section-title">Selection Feed</h2>
        <span className="text-[11px] font-mono text-muted">{made} of {total} in</span>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted px-4 py-6">
          Nobody is off the board yet. The first name goes in when the clock starts.
        </p>
      ) : (
        <div
          className="flex-1 min-h-0 overflow-y-auto scroll-shadow-y"
          style={{ ['--scroll-bg' as never]: 'rgba(24,24,27,0.6)' }}
        >
          {rows.map((row, i) => {
            const chips = chipsFor(row);
            return (
              <div
                key={row.pickId}
                className={`flex items-start gap-3 px-4 py-2 border-b border-line/50 last:border-0 ${
                  row.isUser ? 'bg-accent/[0.07] border-l-2 border-l-accent' : ''
                } ${i === 0 ? 'commit-flash' : ''}`}
              >
                <div className="w-9 shrink-0 pt-0.5 text-right">
                  <div className="stat-value text-sm text-chalk leading-none">{row.overall}</div>
                  <div className="text-[10px] text-muted font-mono mt-1">R{row.round}</div>
                </div>
                <TeamLogo seed={row.team.id} abbr={row.team.abbr} size={24} className="shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <a
                      href={`/league/${leagueId}/player/${row.player.id}`}
                      className="text-sm font-semibold truncate hover:text-accent2"
                    >
                      {row.player.firstName} {row.player.lastName}
                    </a>
                    <span className={`text-[11px] font-semibold shrink-0 ${positionBadgeClass(row.player.position)}`}>
                      {row.player.position}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 mt-0.5">
                    <span className="text-[11px] text-muted truncate">
                      {row.team.abbr} · {row.player.college}
                    </span>
                    {row.boardRank !== undefined && (
                      <span className="text-[11px] text-muted font-mono shrink-0">board #{row.boardRank}</span>
                    )}
                  </div>
                  {chips.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {chips.map((c) => (
                        <span key={c.text} className={`pill text-[10px] px-1.5 py-0 ${c.className}`}>{c.text}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
