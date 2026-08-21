import Link from 'next/link';
import { TeamLogo } from '../TeamLogo';
import type { PowerRankingBoard, PowerRow } from '@/lib/powerRankings';

/**
 * The published table. Everything on it is a number this league actually
 * produced: the rank is the position in the ordering lib/powerRankings.ts
 * computed, the OVR is buildLeagueRatings()'s figure — the same one the
 * dashboard and the handover screen show — and REC# is where the same club
 * sits on win percentage alone. The gap between the first column and the last
 * is the reason the screen exists, so both are on every row rather than one
 * being implied.
 */

function teamHref(leagueId: string, r: PowerRow): string {
  return r.isUser ? `/league/${leagueId}/roster` : `/league/${leagueId}/history?team=${r.teamId}#franchise`;
}

/**
 * Movement, or an honest absence of it.
 *
 * A team with no stored prior week renders nothing at all — not a zero. Before
 * the first snapshot exists nobody knows what last week's ranking was (team
 * ratings move with the roster, so it cannot be recomputed after the fact),
 * and "0" would claim a stability that was never measured. A team that IS on
 * record and did not move gets a dash, which is a measured result.
 */
export function MoveChip({ move }: { move: PowerRow['move'] }) {
  if (!move) return null;
  if (move.delta === 0) {
    return <span className="font-mono text-[11px] text-muted" title={`Held #${move.fromRank} from week ${move.fromWeek}`}>—</span>;
  }
  const up = move.delta > 0;
  return (
    <span
      className={`font-mono text-[11px] font-semibold ${up ? 'text-accent' : 'text-bad'}`}
      title={`${up ? 'Up' : 'Down'} ${Math.abs(move.delta)} from #${move.fromRank} in week ${move.fromWeek}`}
    >
      {up ? '▲' : '▼'}{Math.abs(move.delta)}
    </span>
  );
}

function FormStrip({ form }: { form: PowerRow['recentForm'] }) {
  if (form.length === 0) return <span className="text-muted text-[11px]">—</span>;
  return (
    <span className="inline-flex gap-0.5">
      {form.map((r, i) => (
        <span
          key={i}
          className={`inline-flex items-center justify-center w-4 h-4 rounded-sm text-[9px] font-bold ${
            r === 'W' ? 'bg-accent/20 text-accent' : r === 'L' ? 'bg-bad/20 text-bad' : 'bg-raised text-muted'
          }`}
        >
          {r}
        </span>
      ))}
    </span>
  );
}

/**
 * How far this club sits from where its record alone would put it. Blank
 * before any game has been played: with every club 0-0 there is no record to
 * be above or below, and a number there would be measuring a tiebreak.
 */
function SwingCell({ row }: { row: PowerRow }) {
  if (row.recordRank === null) return <span className="text-muted text-[11px]">—</span>;
  const swing = row.recordRank - row.rank;
  if (swing === 0) return <span className="text-muted text-[11px]">even</span>;
  return (
    <span
      className={`font-mono text-[11px] ${swing > 0 ? 'text-accent2' : 'text-gold'}`}
      title={swing > 0 ? `Ranked ${swing} places above its record` : `Ranked ${Math.abs(swing)} places below its record`}
    >
      {swing > 0 ? '+' : ''}{swing}
    </span>
  );
}

export function PowerRankingsTable({ leagueId, board }: { leagueId: string; board: PowerRankingBoard }) {
  const showMove = board.hasMovement;
  return (
    <div className="panel overflow-x-auto">
      <table className="table-clean">
        <thead>
          <tr>
            <th className="w-10 px-2 text-right">#</th>
            {showMove && <th className="w-10 px-1.5 text-right">MOV</th>}
            <th className="w-full">Team</th>
            <th className="text-right w-16 px-1.5">Rec</th>
            <th className="text-right w-12 px-1.5" title="Where this club sits on record alone (win pct, then point differential)">Rec#</th>
            <th className="text-right w-12 px-1.5" title="Places above (+) or below (−) its record">Δ</th>
            <th className="text-right w-14 px-1.5" title="Team rating from the roster — the same OVR the dashboard shows, with its league rank">OVR</th>
            <th className="text-right w-14 px-1.5 hidden sm:table-cell" title="Point differential per game">Net</th>
            <th className="text-right w-14 px-1.5 hidden md:table-cell" title="Scoring margin adjusted for the strength of the teams played">Adj</th>
            <th className="text-right w-20 px-1.5 hidden md:table-cell">Last 4</th>
            <th className="text-right w-14 px-1.5" title="Power index — league average is 50">Idx</th>
          </tr>
        </thead>
        <tbody>
          {board.rows.map((r) => (
            <tr key={r.teamId} className={r.isUser ? 'bg-accent/[0.06]' : ''}>
              <td className="px-2 text-right align-top">
                <span className={`stat-value text-stat-sm ${r.rank <= 4 ? 'text-accent' : r.rank >= 29 ? 'text-muted' : ''}`}>{r.rank}</span>
              </td>
              {showMove && <td className="px-1.5 text-right align-top"><MoveChip move={r.move} /></td>}
              <td className="align-top">
                <div className="flex items-center gap-2 min-w-0">
                  <TeamLogo seed={r.teamId} abbr={r.abbr} size={22} />
                  <Link href={teamHref(leagueId, r)} className={`truncate hover:text-accent2 ${r.isUser ? 'font-semibold' : ''}`}>
                    {r.city} {r.nickname}
                  </Link>
                  {r.isUser && <span className="pill border-accent/40 text-accent text-[10px] shrink-0">You</span>}
                </div>
                {r.note && <div className="text-xs text-muted mt-1 leading-snug max-w-2xl">{r.note}</div>}
              </td>
              <td className="font-mono text-xs text-right px-1.5 align-top">
                {r.wins}-{r.losses}{r.ties ? `-${r.ties}` : ''}
              </td>
              <td className="font-mono text-xs text-right px-1.5 align-top text-muted">{r.recordRank ?? '—'}</td>
              <td className="text-right px-1.5 align-top"><SwingCell row={r} /></td>
              <td className="text-right px-1.5 align-top">
                <span className="stat-value text-stat-sm">{r.rating}</span>
                <span className="text-[10px] text-muted ml-1">#{r.ratingRank}</span>
              </td>
              <td className={`font-mono text-xs text-right px-1.5 align-top hidden sm:table-cell ${r.netPerGame > 0 ? 'text-accent' : r.netPerGame < 0 ? 'text-bad' : 'text-muted'}`}>
                {r.netPerGame >= 0 ? '+' : ''}{r.netPerGame.toFixed(1)}
              </td>
              <td className="font-mono text-xs text-right px-1.5 align-top hidden md:table-cell text-muted">
                {r.srs >= 0 ? '+' : ''}{r.srs.toFixed(1)}
              </td>
              <td className="text-right px-1.5 align-top hidden md:table-cell"><FormStrip form={r.recentForm} /></td>
              <td className="font-mono text-xs text-right px-1.5 align-top">{r.index.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The standings-page capsule: the top of the table, the user's own club if it
 * is not in it, and a way through to the whole thing. Deliberately not the
 * full 32 — the standings screen answers a different question, and a second
 * 32-row table underneath it would bury the one the page is named after.
 */
export function PowerRankingsCapsule({ leagueId, board, take = 5 }: { leagueId: string; board: PowerRankingBoard; take?: number }) {
  const top = board.rows.slice(0, take);
  const user = board.rows.find((r) => r.isUser);
  const shown = user && !top.includes(user) ? [...top, user] : top;

  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-line/70 flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="label-sm">{board.weekLabel} Power Rankings</div>
          <div className="text-xs text-muted mt-0.5">
            Record, opponent-adjusted margin, roster rating and recent form — so it can, and does, disagree with the table below.
          </div>
        </div>
        <Link href={`/league/${leagueId}/power-rankings`} className="btn-tertiary text-xs">All 32 →</Link>
      </div>
      <div className="divide-y divide-line/50">
        {shown.map((r, i) => (
          <div key={r.teamId} className={`flex items-center gap-3 px-4 py-2 ${r.isUser ? 'bg-accent/[0.06]' : ''} ${i === take ? 'border-t border-line' : ''}`}>
            <span className={`stat-value text-stat-sm w-7 shrink-0 text-right ${r.rank <= 3 ? 'text-accent' : ''}`}>{r.rank}</span>
            <span className="w-8 shrink-0 text-right"><MoveChip move={r.move} /></span>
            <TeamLogo seed={r.teamId} abbr={r.abbr} size={22} />
            <div className="flex-1 min-w-0">
              <Link href={teamHref(leagueId, r)} className={`truncate hover:text-accent2 ${r.isUser ? 'font-semibold' : ''}`}>
                {r.city} {r.nickname}
              </Link>
            </div>
            <span className="font-mono text-xs text-muted shrink-0">
              {r.wins}-{r.losses}{r.ties ? `-${r.ties}` : ''}
            </span>
            <span className="text-[11px] text-muted w-24 text-right shrink-0 hidden sm:block whitespace-nowrap" title="Team rating and its league rank">
              {r.rating} ovr · #{r.ratingRank}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
