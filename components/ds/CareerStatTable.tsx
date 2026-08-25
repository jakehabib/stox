import { TeamLogo } from '@/components/TeamLogo';
import { careerColumns, leadColumnKey, formatColumn, isDerived, type StatColumn } from '@/lib/statLabels';
import type { CareerTable, CareerTableRow } from '@/lib/playerSeasons';
import type { CareerEvent, CareerRecordRow } from '@/lib/careerRecord';

/**
 * THE CAREER RECORD. One row per season — the year, the club he played for
 * THAT year, his age, his games, the numbers that matter at his position, and
 * what he was rated when it ended — with everything that HAPPENED to him that
 * year hanging off it in the last column. A career total across the bottom.
 *
 * The season table is the spine and that is the point of it. The app owner
 * sketched a career as a list of years with a sentence beside each, and picked
 * this shape over three others precisely because it survives a quiet career:
 * the longest career in the database is a twenty-season punter whose entire
 * event list is four re-signings, and twenty honest season rows with a mostly
 * empty right-hand column read as a quiet career rather than as a page that
 * failed to load.
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
 *     seasons. The year's events hang off the combined line, never off one of
 *     the halves.
 *   - "Career" — summed from the visible rows, so the bottom line is always
 *     the total of the table above it.
 *
 * A YEAR CAN HAVE EVENTS AND NO SEASON LINE, and then it still gets a row —
 * the draft year of a man who did not play as a rookie, a title older than the
 * seasons this league recorded, and every single year of an offensive
 * lineman's career, since the sim writes him no box line ever. Those rows say
 * "no line recorded" across the stat columns rather than claiming he did not
 * play, because the two are different facts and only the first one is known.
 *
 * `table.scope` says which half of the year these rows are, and the table
 * never mixes them. An empty POSTSEASON table is a real answer — twenty of
 * thirty-two clubs finish every year without a playoff game — so it is
 * written out in words instead of being drawn as a grid of zeroes or left as
 * a blank panel. The record column is a REGULAR-season fixture only: the
 * postseason view drops the years he had no playoff game in, and a career's
 * events cannot hang off years that aren't drawn.
 */
export function CareerStatTable({ position, table, record, showOvr = false }: {
  position: string;
  table: CareerTable;
  /**
   * The same rows, folded together with his career events. Omitted on the
   * postseason view, which renders the table alone.
   */
  record?: CareerRecordRow[];
  /**
   * Whether the end-of-season overall may be printed. It is a RATING, so it
   * goes through the same gate as the overall on the hero — the caller passes
   * `view.revealed` and nothing else. Career production is public knowledge;
   * what a man is worth is not, and a record page printing a true overall
   * behind the fog would be a second channel out of it.
   */
  showOvr?: boolean;
}) {
  // Box-score columns only. An efficiency rate belongs in the analytics view,
  // not beside receptions and yards — see `advanced` in lib/statLabels.ts. The
  // FULL set is still what `careerColumns` returns, because performance
  // grading walks it and lib/coachRoom.ts is tuned to its exact shape.
  const cols = careerColumns(position).filter((c) => !c.advanced);
  const rows: CareerRecordRow[] = record ?? table.rows.map((r) => ({
    season: r, year: null, events: [], honored: false, eventTeamId: null, eventTeamAbbr: null,
  }));
  const playoffs = table.scope === 'PLAYOFFS';

  const hasEvents = rows.some((r) => r.events.length > 0);
  // Drawn only when a row actually carries one. Every season played before the
  // column existed has a null here, and so does every save that has not rolled
  // a season over since — a column of dashes would be clutter that says
  // nothing.
  const ovrCol = showOvr && rows.some((r) => r.season?.endOvr != null);
  // Same rule: an offensive lineman has no season row at all, so his record is
  // all event rows and an Age column would be dashes end to end.
  const ageCol = rows.some((r) => r.season?.age != null);

  if (cols.length === 0 && !hasEvents) {
    return (
      <p className="text-sm text-muted p-5">
        Box scores don&apos;t track individual production at {position} — there is no honest season
        line to draw here, so the game doesn&apos;t draw one.
      </p>
    );
  }
  if (table.empty && !hasEvents) {
    return (
      <div className="p-5 space-y-2">
        <p className="text-sm text-muted">
          {playoffs
            ? 'No postseason games. He has never played one here — so there is nothing to show, rather than a table of zeroes.'
            : 'No season on the books yet. Rows appear here the moment he records a stat, one per year and per club.'}
        </p>
        {playoffs && table.hasPreLeagueCareer && (
          <p className="text-xs text-muted">
            His career before this league arrived as one merged total with no postseason recorded in it —
            see the note on the Regular Season view. The game will not guess at a split it was never given.
          </p>
        )}
      </div>
    );
  }

  // The number that defines the position — bolded down the column the way a
  // stat page leads with a back's yards rather than his carries.
  const leadKey = leadColumnKey(position);

  /**
   * A quarterback's line is twelve stat columns before the record column is
   * added, and measured in the card at 1440 the table then ran 1,109px inside
   * a 980px pane — putting the events off the right edge, behind a scroll, on
   * the one position most likely to have any. Tightening the cell padding from
   * 12px to 8px gives back 128px across sixteen columns and the table fits.
   * Applied ONLY when the record column is drawn, so the postseason view and
   * every table without events keeps the standard density. `!` because
   * `.table-clean td` out-specifies a bare utility.
   */
  const dense = hasEvents ? '!px-2' : '';

  return (
    <>
      <div className="overflow-x-auto">
        <table className="table-clean">
          <thead>
            <tr>
              <th className={dense}>Season</th>
              <th className={dense}>Team</th>
              {ageCol && <th className={`text-right ${dense}`}>Age</th>}
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={`text-right ${dense}`}
                  title={c.key === 'gp'
                    ? (playoffs
                        ? 'Playoff games only \u2014 wild card through the final.'
                        : 'Regular-season games only. Playoff games are counted on the Playoffs view.')
                    : undefined}
                >{c.short}</th>
              ))}
              {/* The two notes that used to sit under this table are now hover
                  titles on the headers they describe. The owner's rule: text
                  must be useful without reading as an explainer, and a
                  paragraph restating what the view toggle and a column header
                  already say is clutter. The facts are still one hover away. */}
              {ovrCol && (
                <th className={`text-right ${dense}`} title="What he was rated when that season finished. Blank for a year with no rating on record.">OVR</th>
              )}
              {hasEvents && (
                // Unlabelled on purpose: the column is sentences, and a header
                // over them would name what they already say.
                <th className={`min-w-[10rem] ${cols.length === 0 ? 'w-full' : ''} ${dense}`}>
                  <span className="sr-only">Career events</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <Row
                key={`${row.season?.kind ?? 'event'}-${row.season?.seasonLabel ?? row.year}-${row.season?.teamAbbr ?? i}`}
                row={row} cols={cols} leadKey={leadKey}
                ageCol={ageCol} ovrCol={ovrCol} eventCol={hasEvents} dense={dense}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* The strip only exists when it has something to say. Every note left
          here explains data that is ABSENT -- without them a card with no
          numbers reads as broken. The notes that merely restated a label or a
          column header are gone; those facts are titles on the labels now. */}
      {(cols.length === 0 || (playoffs && table.hasPreLeagueCareer) || table.hasUndecomposed) && (
      <div className="px-4 py-3 border-t border-line/60 space-y-1">
        {cols.length === 0 && (
          <p className="text-xs text-muted">
            Box scores don&apos;t track individual production at {position}.
          </p>
        )}
        {playoffs && table.hasPreLeagueCareer && (
          <p className="text-xs text-muted">
            The career he arrived with carries no postseason split; those years are on the Regular Season view.
          </p>
        )}
        {table.hasUndecomposed && (
          <p className="text-xs text-muted">
            <span className="text-chalk font-semibold">Before {beforeYear(table)}</span> is a real
            career total he arrived with, never recorded season by season.
          </p>
        )}
      </div>
      )}
    </>
  );
}

function beforeYear(table: CareerTable): string {
  const row = table.rows.find((r) => r.kind === 'before');
  return row ? row.seasonLabel.replace('Before ', '') : '';
}

const DOT_CLASS: Record<CareerEvent['tone'], string> = {
  honor: 'bg-gold',
  move: 'bg-accent2',
  plain: 'bg-muted',
};
const TITLE_CLASS: Record<CareerEvent['tone'], string> = {
  honor: 'text-gold',
  move: 'text-accent2/90',
  plain: 'text-chalk',
};

/** The right-hand column: what happened that year, oldest first. */
function EventList({ events }: { events: CareerEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="space-y-1">
      {events.map((e, i) => (
        <div key={`${e.week}-${e.title}-${i}`} className="flex items-baseline gap-2">
          <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASS[e.tone]}`} />
          <span className="text-xs leading-snug">
            <span className={`font-medium ${TITLE_CLASS[e.tone]}`}>{e.title}</span>
            {/* The row's own words about the terms, verbatim. Nothing here
                re-totals a contract — see lib/careerRecord.ts. */}
            {e.detail && <span className="text-muted"> — {e.detail}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function Row({
  row, cols, leadKey, ageCol, ovrCol, eventCol, dense,
}: {
  row: CareerRecordRow;
  cols: StatColumn[];
  leadKey?: string;
  ageCol: boolean;
  ovrCol: boolean;
  eventCol: boolean;
  /** Tighter horizontal padding, so the record column fits beside a QB's twelve. */
  dense: string;
}) {
  const season = row.season;
  const isSplit = season?.kind === 'split';
  const isCareer = season?.kind === 'career';
  const isBefore = season?.kind === 'before';

  const tone = isCareer
    ? 'bg-raised/40 font-semibold text-chalk'
    : isSplit || isBefore
      ? 'text-muted'
      : '';
  const topRule = isCareer ? 'border-t-2 border-line' : '';
  // A year he won something is marked as well as dotted — the honour is the
  // headline of that season and the row it belongs to should read that way.
  const tint = row.honored ? 'bg-gold/[0.06]' : '';
  const cell = `${topRule} ${tint} ${dense}`;

  // How many stat cells a year with no season line has to cover.
  const spanned = cols.length + (ovrCol ? 1 : 0);

  return (
    <tr className={tone}>
      <td className={`${cell} whitespace-nowrap`}>
        {season == null ? (
          <span className="font-mono tabular-nums">{row.year}</span>
        ) : season.showSeasonLabel ? (
          <span className="flex items-baseline gap-1.5">
            <span className={isCareer ? 'uppercase tracking-wide text-xs' : 'font-mono tabular-nums'}>
              {season.seasonLabel}
            </span>
            {season.inProgress && !isCareer && (
              <span className="text-[9px] uppercase tracking-wide text-accent2" title="Season still being played">
                live
              </span>
            )}
          </span>
        ) : null}
      </td>
      <Club
        className={cell}
        // A row with no season line takes its club from the transaction that
        // put it there, which is the only club such a row knows about.
        teamId={season ? season.teamId : row.eventTeamId}
        teamAbbr={season ? season.teamAbbr : row.eventTeamAbbr}
        indent={isSplit}
      />
      {ageCol && (
        <td className={`${cell} text-right font-mono tabular-nums text-muted`}>
          {season?.age ?? '—'}
        </td>
      )}

      {season == null ? (
        spanned > 0 && (
          <td colSpan={spanned} className={`${cell} text-xs text-muted/70`}>
            no line recorded
          </td>
        )
      ) : (
        <>
          {cols.map((c) => {
            // Derived columns compute from THIS row's components. The career row
            // and the "Before <year>" row carry the sum of their components, so a
            // career passer rating comes out of the summed attempts rather than as
            // the mean of the season ratings. See lib/statLabels.ts.
            const text = formatColumn(c, season.stats);
            const lead = c.key === leadKey && !isSplit;
            const zero = !isDerived(c) && ((season.stats as Record<string, number | undefined>)[c.key] ?? 0) === 0;
            return (
              <td
                key={c.key}
                className={`${cell} text-right font-mono tabular-nums ${lead ? 'font-semibold text-chalk' : ''} ${isSplit ? 'text-muted' : ''}`}
              >
                {text == null
                  // No denominator — he has no rate, which is a different fact
                  // from a rate of zero. A dash says so; "0.0" would not.
                  ? <span className="text-muted/50" title="No attempts to compute this from">—</span>
                  : zero && !isCareer
                    ? <span className="text-muted/50">0</span>
                    : text}
              </td>
            );
          })}
          {ovrCol && (
            <td className={`${cell} text-right font-mono tabular-nums`}>
              {season.endOvr == null
                ? <span className="text-muted/50" title="Nobody wrote his rating down that season">—</span>
                : season.endOvr}
            </td>
          )}
        </>
      )}

      {eventCol && (
        <td className={`${cell} align-top`}>
          <EventList events={row.events} />
        </td>
      )}
    </tr>
  );
}

/** The club cell — crest and abbreviation, or an honest dash. */
function Club({ className, teamId, teamAbbr, indent }: {
  className: string; teamId: string | null; teamAbbr: string | null; indent: boolean;
}) {
  // An event row names its club by id only; the abbreviation is on the crest.
  if (teamAbbr == null && teamId == null) {
    return <td className={className}><span className="text-muted">—</span></td>;
  }
  if (teamId == null) {
    // "2TM" and friends explain themselves on hover rather than in a footnote
    // under the table -- see the note on the OVR header.
    const multi = teamAbbr?.endsWith('TM')
      ? 'A season split by a mid-season trade. The combined line, with each club\u2019s share beneath it.'
      : undefined;
    return <td className={className}><span className="font-semibold text-xs" title={multi}>{teamAbbr}</span></td>;
  }
  return (
    <td className={className}>
      <span className={`flex items-center gap-1.5 ${indent ? 'pl-2' : ''}`}>
        {/* The crest is decorative HERE and only here: the abbreviation it
            labels is the very next node, so leaving TeamLogo's own
            aria-label in makes the cell announce "CLT logo CLT". */}
        <span aria-hidden="true" className="flex">
          <TeamLogo seed={teamId} abbr={teamAbbr ?? ''} size={18} />
        </span>
        {teamAbbr && <span className="font-semibold text-xs">{teamAbbr}</span>}
      </span>
    </td>
  );
}
