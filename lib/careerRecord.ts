import type { CareerTableRow } from './playerSeasons';
import { AWARD_LABEL } from './awardTypes';
import { ordinal } from './combineRank';

/**
 * ===========================================================================
 * THE CAREER RECORD — what happened to a man, filed against the season it
 * happened in.
 * ===========================================================================
 * The app owner's sketch was a list of years with a sentence beside each —
 * drafted, breakout, first All-Pro, traded, championship, tagged, extended —
 * and of the four mockups he picked the one where THE SEASON TABLE IS THE
 * SPINE and the sentences hang off it in a right-hand column: *"Option A, the
 * record is what we need to add to the player cards"*.
 *
 * That choice is the whole design constraint. A timeline of events alone is a
 * page that fails on a quiet career, and quiet careers are the common case
 * here — measured over the whole development database, the LONGEST career on
 * record is a twenty-season punter with exactly four recorded events, all of
 * them re-signings, and no draft row at all. Four pips down a long spine reads
 * as a page that failed to load. Twenty season rows with an empty right-hand
 * column reads as a quiet career, which is what it is.
 *
 * WHAT THIS MODULE IS. Pure assembly, no I/O, no React. It takes rows that
 * have already been loaded and turns them into the list the table renders. It
 * lives in lib/ rather than beside the component on purpose: importing a
 * helper out of a `'use client'` module into a Server Component compiles
 * cleanly and then 500s at request time, and this codebase has shipped that
 * bug once already.
 *
 * WHERE EVERY LINE COMES FROM, AND WHERE NONE OF IT COMES FROM
 * ------------------------------------------------------------
 * Every event is one stored row restated, never a fact computed about him:
 *
 *   - the draft line       Player.draftYear / draftRound / draftPickNo — all
 *                          three numbers off the one record, so the pick this
 *                          prints is the pick the game stored.
 *   - moves and money      Transaction (DRAFT, TRADE, SIGN, RESIGN, CUT, TAG,
 *                          OPTION, POSITION). The verb comes from `type`; the
 *                          terms are the row's own `detail`, verbatim. Nothing
 *                          here re-derives a contract: a signing row records
 *                          "5-yr deal, ~$40.1M/yr" and that string is what is
 *                          shown, because re-adding it into a total value
 *                          would be this project's oldest bug — a displayed
 *                          number that is not the number the system used.
 *   - trophies             The award transactions the card has ALREADY loaded
 *                          for its honours pill, handed straight in. One
 *                          query, two views: the pill and the record cannot
 *                          disagree about what he won.
 *   - All-Star seasons     Likewise — the same years the pill counts.
 *   - championships        Likewise `resolveRingYears`.
 *
 * WHAT IS DELIBERATELY ABSENT, having been measured rather than guessed:
 *
 *   - INJURIES. 82,440 injury rows in the database and NOT ONE carries a
 *     playerId, so "missed three — hamstring" cannot be attributed to the man
 *     it happened to. The games-played column already tells the reader he was
 *     short a year; inventing a cause for it would not.
 *   - WEEKLY NEWS and DEVELOPMENT NOTES. Real rows, correctly attributed, and
 *     far too many of them — one career carries 95 development notes and
 *     another 83 game recaps. A record book is not a feed.
 *   - A NARRATIVE. No "breakout", no "rookie season", no "led the club in
 *     sacks". Those are sentences about numbers that are already in the row,
 *     and the second telling is the one that eventually contradicts the first.
 *
 * TRADES AND TAGS ARE WIRED AND CURRENTLY SILENT. There are 25 trades in the
 * entire database and none carries a playerId, and two franchise tags in
 * total. Both are being fixed elsewhere. Nothing here needs to change when
 * they land: the rows are already read, and until they exist their absence is
 * a season table with a quieter column, not a hole.
 * ===========================================================================
 */

/** What the coloured dot in front of a line means. */
export type EventTone =
  /** He won something. The season row is tinted for it. */
  | 'honor'
  /** He changed hands, or his contract did. */
  | 'move'
  /** Everything else on the record. */
  | 'plain';

/** One line in the right-hand column, already resolved to display text. */
export interface CareerEvent {
  /** The season it belongs against. */
  year: number;
  /**
   * Sort key inside a year — the league week the row was written, so a career
   * reads in the order it happened. Two synthetic events carry a sentinel
   * instead of a stored week and say so: the draft (-1, it precedes every
   * transaction of its year) and a championship (98, the final ends the
   * season).
   */
  week: number;
  tone: EventTone;
  /** The line itself: "Drafted 2nd overall", "MVP", "Re-signed". */
  title: string;
  /**
   * The row's own words about terms, verbatim, or null when there is nothing
   * to add — including every honour, whose numbers are the season row it sits
   * on and would be a second copy of the same figures.
   */
  detail: string | null;
  /** The club the row names, when it names one. Null on rows that don't. */
  teamId: string | null;
  /** That club's abbreviation, resolved at build time so the view needs no lookup. */
  teamAbbr: string | null;
}

/** One printed line of the record: a season, or a year that only has events. */
export interface CareerRecordRow {
  /** The stat row for this year, or null for a year with nothing but events. */
  season: CareerTableRow | null;
  /**
   * The year this row is about. Null on the two rows that aren't a year — the
   * pre-league residual and the career total.
   */
  year: number | null;
  events: CareerEvent[];
  /** Any honour among them, which tints the row. */
  honored: boolean;
  /**
   * The club for a row with no season line — the club its events name, but
   * ONLY when they all name the same one. A year in which he was released by
   * one club and signed by another has no single club to head it with, so it
   * gets none rather than the first of the two under a column that reads as
   * "who he was with that year". Always null when there IS a season line: the
   * season's own club is on it already, off the games he played.
   */
  eventTeamId: string | null;
  eventTeamAbbr: string | null;
}

/** The transaction fields this module reads. Nothing else is loaded for it. */
export interface RecordTransaction {
  type: string;
  seasonYear: number;
  week: number;
  teamId: string | null;
  headline: string;
  detail: string;
}

/** Transaction types the record restates. Everything else is filtered out. */
export const RECORD_TX_TYPES = [
  'DRAFT', 'TRADE', 'SIGN', 'RESIGN', 'CUT', 'TAG', 'OPTION', 'POSITION',
] as const;

/**
 * The verb, from the row's `type` — not from its headline.
 *
 * A headline is a sentence written for the league wire and it opens with the
 * man's own name ("Re-signed Camden Scarborough"), which on Camden
 * Scarborough's own page is his name printed once per line for twenty years.
 * The type is the fact. Three types genuinely carry more in the sentence than
 * the type does, and only those three are read: a SIGN is a signing or an
 * extension, an OPTION was picked up or turned down, and a POSITION change
 * names the two positions.
 */
function moveTitle(tx: RecordTransaction): string {
  switch (tx.type) {
    case 'DRAFT': return 'Drafted';
    case 'TRADE': return 'Traded';
    // A RESTRUCTURE IS NOT A SIGNING. `restructureContract` writes its row as
    // type SIGN (lib/freeagency.ts), so before this case existed a man who had
    // his base converted to bonus read "Signed" on his own record -- a move he
    // never made, in a year he was already under contract. Reported by the app
    // owner: "this player restructured instead of signed".
    case 'SIGN':
      if (tx.headline.startsWith('Extended')) return 'Extended';
      if (tx.headline.startsWith('Restructured')) return 'Restructured';
      return 'Signed';
    case 'RESIGN': return 'Re-signed';
    case 'CUT': return 'Released';
    case 'TAG': return 'Franchise tag';
    case 'OPTION':
      return tx.headline.includes('declined')
        ? 'Fifth-year option declined'
        : 'Fifth-year option picked up';
    case 'POSITION': {
      const m = /moves from (\S+) to (\S+)/.exec(tx.headline);
      return m ? `Moved from ${m[1]} to ${m[2]}` : 'Position change';
    }
    default: return tx.type;
  }
}

/** A position change is a coaching decision, not a transfer of his rights. */
const PLAIN_TYPES = new Set(['POSITION']);

/**
 * The terms, verbatim, for the types that record any — and nothing at all for
 * the ones whose detail is either empty (a release) or a copy of numbers the
 * season row beside it already prints (an award's stat line, a position
 * change's two ratings).
 */
function moveDetail(tx: RecordTransaction): string | null {
  if (tx.type === 'POSITION' || tx.type === 'DRAFT') return null;
  // A restructure says everything it needs to in its title. Its stored detail
  // ("Converted $XM of base salary to bonus for cap relief") is bookkeeping
  // about the club's books rather than anything that happened to him, and the
  // owner asked for it gone: it should "just say restructured". The row is
  // untouched in the database -- the cap page is where that money is read.
  if (tx.type === 'SIGN' && tx.headline.startsWith('Restructured')) return null;
  const d = tx.detail.trim();
  if (d.length > 0) return d;
  // A trade row's headline names the two clubs and is the only thing it has
  // to say once its detail is empty. Every other type falls through to null.
  return tx.type === 'TRADE' ? tx.headline : null;
}

/**
 * HOW HE ENTERED FOOTBALL, from the one record that stores it.
 *
 * Round and pick come off the Player row together, so the line can never
 * report a pick from one place and a round from another. A DRAFT transaction
 * is used for two things only: the club, which the Player row does not store,
 * and — when the Player row has no draft year at all, which is every seeded
 * veteran and the twenty-season punter this design was tested against — as the
 * sole evidence a draft happened, in which case the line says he was drafted
 * and stops rather than inventing a slot for him.
 */
function draftEvent(
  player: { isDraftee: boolean; draftYear: number | null; draftRound: number | null; draftPickNo: number | null },
  draftTx: RecordTransaction | undefined,
): CareerEvent | null {
  // A man still in the pool carries the year of the class he is IN, not a year
  // anybody picked him. "Drafted 2035" on a prospect's card would be the page
  // announcing a pick that has not happened.
  if (player.isDraftee) return null;
  const year = player.draftYear ?? draftTx?.seasonYear ?? null;
  if (year == null) return null;
  let title = 'Drafted';
  if (player.draftYear != null) {
    if (player.draftPickNo != null) title = `Drafted ${ordinal(player.draftPickNo)} overall`;
    else if (player.draftRound != null) title = `Drafted in round ${player.draftRound}`;
  }
  return {
    year, week: -1, tone: 'move', title, detail: null,
    teamId: draftTx?.teamId ?? null, teamAbbr: null,
  };
}

/**
 * Every line of the right-hand column, in the order a career happened.
 *
 * Callers hand in rows they have already loaded for other parts of the card —
 * the award transactions behind the honours pill, the All-Star years behind
 * its count, the ring years behind its trophies. That is the point: a second
 * query for the same honour is how a count and the cabinet under it end up
 * disagreeing, and this page has fixed that bug before.
 */
export function buildCareerEvents(args: {
  player: {
    /** Still in the rookie pool — he has no draft line yet, whatever year he carries. */
    isDraftee: boolean;
    draftYear: number | null; draftRound: number | null; draftPickNo: number | null;
  };
  /** DRAFT/TRADE/SIGN/RESIGN/CUT/TAG/OPTION/POSITION rows for this man. */
  transactions: RecordTransaction[];
  /** The award rows the honours pill is drawn from — type and year, as stored. */
  awards: { type: string; seasonYear: number }[];
  /** The seasons he was selected, as the pill counts them. */
  allStarYears: number[];
  /** The seasons he was on the champion's roster, as the pill lists them. */
  ringYears: number[];
  /** Club id to abbreviation, for the clubs of this league. */
  clubAbbr: Record<string, string>;
}): CareerEvent[] {
  const out: CareerEvent[] = [];

  const abbrOf = (id: string | null) => (id == null ? null : args.clubAbbr[id] ?? null);

  const draft = draftEvent(args.player, args.transactions.find((t) => t.type === 'DRAFT'));
  if (draft) out.push({ ...draft, teamAbbr: abbrOf(draft.teamId) });

  for (const tx of args.transactions) {
    // The draft is already on the record, built from the Player row above.
    if (tx.type === 'DRAFT') continue;
    out.push({
      year: tx.seasonYear,
      week: tx.week,
      tone: PLAIN_TYPES.has(tx.type) ? 'plain' : 'move',
      title: moveTitle(tx),
      detail: moveDetail(tx),
      teamId: tx.teamId,
      teamAbbr: abbrOf(tx.teamId),
    });
  }

  for (const a of args.awards) {
    out.push({
      year: a.seasonYear,
      // Awards are filed at the top of the wire cycle that follows the season
      // they belong to; the stored week is used as it stands rather than
      // second-guessed, so this line sorts where the row says it happened.
      week: 1,
      tone: 'honor',
      title: AWARD_LABEL[a.type] ?? a.type,
      detail: null,
      teamId: null,
      teamAbbr: null,
    });
  }

  for (const y of args.allStarYears) {
    out.push({ year: y, week: 17, tone: 'honor', title: 'All-Star', detail: null, teamId: null, teamAbbr: null });
  }

  for (const y of args.ringYears) {
    out.push({ year: y, week: 98, tone: 'honor', title: 'Champion', detail: null, teamId: null, teamAbbr: null });
  }

  out.sort((a, b) => (a.year - b.year) || (a.week - b.week));
  return out;
}

/** The year a table row is about, or null for the two rows that aren't years. */
function rowYear(row: CareerTableRow): number | null {
  if (row.kind !== 'season' && row.kind !== 'combined' && row.kind !== 'split') return null;
  const n = Number(row.seasonLabel);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fold the events into the season table.
 *
 * Events land on the FIRST row of their year, which is the season line — or,
 * for a year split by a mid-season trade, the combined "2TM" line that reads
 * as the season, never on one of the per-club rows beneath it.
 *
 * A year with events and no season line still gets a row. That is not an edge
 * case, it is a whole position: the sim writes no box line for an offensive
 * lineman, so he has no season row in any year of his career, and a record
 * that only printed years he was named in a box score would be blank for every
 * one of them. It is also the draft year of anyone who did not play as a
 * rookie, and any title year older than the seasons this league has recorded.
 *
 * Order is by year throughout, with the pre-league residual pinned above
 * everything and the career total pinned below it — they summarise the rows
 * between them and belong at the ends.
 */
export function mergeCareerRecord(
  rows: CareerTableRow[],
  events: CareerEvent[],
): CareerRecordRow[] {
  const byYear = new Map<number, CareerEvent[]>();
  for (const e of events) {
    const list = byYear.get(e.year);
    if (list) list.push(e);
    else byYear.set(e.year, [e]);
  }

  const out: CareerRecordRow[] = [];
  const claimed = new Set<number>();
  let careerRow: CareerRecordRow | null = null;

  for (const row of rows) {
    const year = rowYear(row);
    // The first row of a year takes that year's events; a `split` row is a
    // breakdown of the line above it and takes none.
    const take = year != null && row.kind !== 'split' && !claimed.has(year);
    if (take) claimed.add(year);
    const evs = take ? (byYear.get(year!) ?? []) : [];
    const record: CareerRecordRow = {
      season: row,
      year,
      events: evs,
      honored: evs.some((e) => e.tone === 'honor'),
      eventTeamId: null,
      eventTeamAbbr: null,
    };
    if (row.kind === 'career') careerRow = record;
    else out.push(record);
  }

  for (const [year, evs] of byYear) {
    if (claimed.has(year)) continue;
    const named = evs.filter((e) => e.teamId != null);
    const unanimous = named.length > 0 && named.every((e) => e.teamId === named[0].teamId);
    out.push({
      season: null,
      year,
      events: evs,
      honored: evs.some((e) => e.tone === 'honor'),
      eventTeamId: unanimous ? named[0].teamId : null,
      eventTeamAbbr: unanimous ? named[0].teamAbbr : null,
    });
  }

  // A stable order: the residual first, then years oldest to newest, then the
  // total. `before` is the only remaining null-year row and it sorts above
  // every dated one.
  out.sort((a, b) => (a.year ?? Number.NEGATIVE_INFINITY) - (b.year ?? Number.NEGATIVE_INFINITY));
  if (careerRow) out.push(careerRow);
  return out;
}
