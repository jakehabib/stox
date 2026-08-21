import { TeamLogo } from '@/components/TeamLogo';
import { careerColumns, leadColumnKey } from '@/lib/statLabels';
import type { CareerTable, CareerTableRow } from '@/lib/playerSeasons';

/**
 * The stat table every football reference site carries: one row per season,
 * with the year, the club he played for THAT year, his age, his games and the
 * numbers that matter at his position — then a career total across the bottom.
 *
 * Three row kinds are not seasons and are drawn so nobody mistakes them for
 * one:
 *
 *   - "Before <year>" — a career that arrived with the player and was never
 *     recorded season by season (see lib/playerSeasons.ts for why it can't
 *     be recovered and won't be invented). It carries the true remainder,
 *     wears no crest, and says what it is in the footnote.
 *   - "2TM" — a season split across clubs by a mid-season trade. The combined
 *     line reads as the season; the per-club rows sit under it, indented and
 *     dimmed, because they are a breakdown of the row above, not two extra
 *     seasons.
 *   - "Career" — summed from the visible rows, so the bottom line is always
 *     the total of the table above it.
 */
export function CareerStatTable({ position, table }: { position: string; table: CareerTable }) {
  const cols = careerColumns(position);

  if (cols.length === 0) {
    return (
      <p className="text-sm text-muted p-5">
        Box scores don&apos;t track individual production at {position} — there is no honest season
        line to draw here, so the game doesn&apos;t draw one.
      </p>
    );
  }
  if (table.empty) {
    return (
      <p className="text-sm text-muted p-5">
        No season on the books yet. Rows appear here the moment he records a stat, one per year and
        per club.
      </p>
    );
  }

  // The number that defines the position — bolded down the column the way a
  // stat page leads with a back's yards rather than his carries.
  const leadKey = leadColumnKey(position);
  const liveRow = table.rows.find((r) => r.inProgress && r.kind !== 'career' && r.showSeasonLabel);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="table-clean">
          <thead>
            <tr>
              <th>Season</th>
              <th>Team</th>
              <th className="text-right">Age</th>
              {cols.map((c) => (
                <th key={c.key} className="text-right">{c.short}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <Row key={`${row.kind}-${row.seasonLabel}-${row.teamAbbr ?? i}`} row={row} cols={cols} leadKey={leadKey} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-3 border-t border-line/60 space-y-1">
        {table.hasUndecomposed && (
          <p className="text-xs text-muted">
            <span className="text-chalk font-semibold">Before {beforeYear(table)}</span> is a real
            career total that arrived with him — everything he did before this league started
            keeping season-by-season records. The seasons behind it were never recorded, and the
            game will not guess at a split it doesn&apos;t have.
          </p>
        )}
        {table.rows.some((r) => r.teamAbbr?.endsWith('TM')) && (
          <p className="text-xs text-muted">
            <span className="text-chalk font-semibold">2TM</span> is a season split by a mid-season
            trade — the combined line, with each club&apos;s share beneath it.
          </p>
        )}
        {liveRow && (
          <p className="text-xs text-muted">
            <span className="text-accent2 font-semibold uppercase tracking-wide">Live</span> marks
            the {liveRow.seasonLabel} season, which is still being played.
          </p>
        )}
      </div>
    </>
  );
}

function beforeYear(table: CareerTable): string {
  const row = table.rows.find((r) => r.kind === 'before');
  return row ? row.seasonLabel.replace('Before ', '') : '';
}

function Row({
  row,
  cols,
  leadKey,
}: {
  row: CareerTableRow;
  cols: { key: string; short: string }[];
  leadKey?: string;
}) {
  const isSplit = row.kind === 'split';
  const isCareer = row.kind === 'career';
  const isBefore = row.kind === 'before';

  const tone = isCareer
    ? 'bg-raised/40 font-semibold text-chalk'
    : isSplit
      ? 'text-muted'
      : isBefore
        ? 'text-muted'
        : '';
  const topRule = isCareer ? 'border-t-2 border-line' : '';

  return (
    <tr className={tone}>
      <td className={`${topRule} whitespace-nowrap`}>
        {row.showSeasonLabel ? (
          <span className="flex items-baseline gap-1.5">
            <span className={isCareer ? 'uppercase tracking-wide text-xs' : 'font-mono tabular-nums'}>
              {row.seasonLabel}
            </span>
            {row.inProgress && !isCareer && (
              <span className="text-[9px] uppercase tracking-wide text-accent2" title="Season still being played">
                live
              </span>
            )}
          </span>
        ) : null}
      </td>
      <td className={topRule}>
        {row.teamAbbr == null ? (
          <span className="text-muted">—</span>
        ) : row.teamId ? (
          <span className={`flex items-center gap-1.5 ${isSplit ? 'pl-3' : ''}`}>
            <TeamLogo seed={row.teamId} abbr={row.teamAbbr} size={18} />
            <span className="font-semibold text-xs">{row.teamAbbr}</span>
          </span>
        ) : (
          <span className="font-semibold text-xs">{row.teamAbbr}</span>
        )}
      </td>
      <td className={`${topRule} text-right font-mono tabular-nums text-muted`}>
        {row.age ?? '—'}
      </td>
      {cols.map((c) => {
        const v = (row.stats as Record<string, number | undefined>)[c.key] ?? 0;
        const lead = c.key === leadKey && !isSplit;
        return (
          <td
            key={c.key}
            className={`${topRule} text-right font-mono tabular-nums ${lead ? 'font-semibold text-chalk' : ''} ${isSplit ? 'text-muted' : ''}`}
          >
            {v === 0 && !isCareer ? <span className="text-muted/50">0</span> : v.toLocaleString()}
          </td>
        );
      })}
    </tr>
  );
}
