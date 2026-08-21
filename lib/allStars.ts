import { prisma } from './db';
import { readJson } from './json';
import { SeasonStats } from './types';
import { Position, POSITIONS, canonicalPosition } from './tuning';
import { STARTERS_AT_POSITION, startersAt } from './lineup';
import { careerColumns, statLabel } from './statLabels';
import {
  PositionDistribution,
  buildPositionDistributions,
  isRankablePosition,
  positionRelativeScore,
} from './performanceScore';

/**
 * ===========================================================================
 * ALL-STARS — AN HONOUR YOU HAVE TO EARN
 * ===========================================================================
 * The one place in the app that decides who is an All-Star, and it decides it
 * from what players actually DID this season. Nothing here reads a rating.
 *
 * That is the entire point. `ratingTier` used to print "Pro Bowl" next to
 * anyone whose overall was high enough, which asserts an honour nobody
 * awarded. A rating is a scouting opinion about how good a player is; an
 * All-Star selection is a fact about a season that happened. The two are not
 * interchangeable, and the app must not say one when it means the other.
 *
 * It is a sibling of lib/awards.ts, not a bolt-on: same input (this year's
 * accumulated Player.seasonStats), same durability (Transaction rows), same
 * place in the calendar loop. The difference is scope — awards.ts names five
 * players, this names a roster.
 *
 * ---------------------------------------------------------------------------
 * WHEN IT RUNS, AND WHY THAT IS NOT A DETAIL
 * ---------------------------------------------------------------------------
 * At the end of the REGULAR SEASON, not after the final. That is when the real
 * thing is named, but there is a harder reason: `simulateAndSaveGame` gates
 * only the STANDINGS on `kind === 'REGULAR'` — seasonStats keep accumulating
 * straight through the postseason. Selecting after the final would fold two to
 * four playoff games into the totals of the twelve teams that made it and none
 * of the twenty that did not, and then rank those totals against each other.
 * The stat line printed under a selection has to be the stat line that earned
 * it, so selection happens at the last moment those totals are purely regular
 * season. See the call site in lib/season.ts's simulateWeek().
 *
 * ---------------------------------------------------------------------------
 * ROSTER SHAPE — DERIVED, NOT INVENTED
 * ---------------------------------------------------------------------------
 * Per conference, per position, fixed slots. That shape IS the meaning: it is
 * what makes a selection scarce, and it is what lets a huge year at a crowded
 * position miss out. A near-miss is a story in its own right, so
 * `AllStarPositionResult.nearMiss` keeps the first man out rather than
 * throwing him away.
 *
 * Slot counts come from lib/lineup.ts — `STARTERS_AT_POSITION`, the single
 * shared definition of the starting eleven — times ALL_STAR_DEPTH. A real
 * all-star roster is not one lineup, it is a lineup plus its reserves, which
 * is why AFC and NFC rosters run to roughly twice a starting eleven. Deriving
 * it rather than typing out a table has a property worth stating out loud:
 *
 *      slots(pos)         DEPTH x starters(pos)          2 x DEPTH
 *   ------------------ = ------------------------- = ----------------
 *   starters in a conf    (teams/2) x starters(pos)        teams
 *
 * The starters(pos) term cancels. Every position is therefore the SAME
 * percentile of its own starters — the top 12.5% in a 32-team league, at
 * quarterback and at safety alike. No position is a soft touch and none is a
 * lottery, and that falls out of the arithmetic instead of out of a table
 * somebody hand-tuned.
 *
 * ---------------------------------------------------------------------------
 * THE OFFENSIVE LINE IS NOT SELECTED, DELIBERATELY
 * ---------------------------------------------------------------------------
 * The sim writes no box line for LT/LG/C/RG/RT — `CAREER_COLUMNS` in
 * lib/statLabels.ts is empty for all five, for exactly that reason. There is
 * no production to rank them on, so there is no way to EARN the honour, so
 * they are not selected and the roster does not pretend otherwise. The
 * alternative is picking linemen by rating, which is precisely the lie this
 * feature exists to delete. A missing lineman is honest; a lineman named
 * All-Star because his overall is 88 is not.
 * ===========================================================================
 */

/**
 * Slots per conference = this many times the starting lineup. Two, because an
 * all-star roster carries a reserve behind each starter. Per the arithmetic
 * above this number IS the selection rate: 2 makes it the top (2 x 2)/teams of
 * every position's starters.
 */
export const ALL_STAR_DEPTH = 2;

/** Transaction.type for one player's selection. */
export const ALL_STAR_TYPE = 'ALL_STAR';
/** Transaction.type for the single league-wide announcement row. */
export const ALL_STAR_ANNOUNCEMENT_TYPE = 'ALL_STAR_ROSTER';
/**
 * Transaction.type for the user club's best near-miss, at most one a season.
 *
 * It is written down rather than recomputed on demand, and that is not an
 * optimisation. seasonStats keep accumulating through the playoffs, so asking
 * "who just missed?" in February gets a different answer than asking it in
 * January — the near-miss has to be frozen at the same instant the selection
 * was, or a page would quietly change its mind about who was snubbed. Only
 * the user's club gets one: "somebody in the league just missed" is not a
 * story, and seventy-six of them would be a directory. Written only when he
 * had nobody selected at all — see recordAllStars.
 */
export const ALL_STAR_SNUB_TYPE = 'ALL_STAR_SNUB';

/** Separates the stat line from the placement note in a snub row's detail. */
const SNUB_DETAIL_SEP = ' · ';

/**
 * How many are selected at each position, per conference. Zero for anyone the
 * sim records no statistics for — see the offensive line note above.
 */
export const ALL_STAR_SLOTS: Record<Position, number> = (() => {
  const out = {} as Record<Position, number>;
  for (const pos of POSITIONS) {
    out[pos] = isRankablePosition(pos) ? STARTERS_AT_POSITION[pos] * ALL_STAR_DEPTH : 0;
  }
  return out;
})();

/** Positions an All-Star can be selected at, in lineup-card order. */
export const ALL_STAR_POSITIONS: Position[] = POSITIONS.filter((p) => ALL_STAR_SLOTS[p] > 0);

/** Selections per conference — 38 under the shipped lineup, 76 league-wide. */
export const ALL_STAR_SLOTS_PER_CONFERENCE = ALL_STAR_POSITIONS.reduce((n, p) => n + ALL_STAR_SLOTS[p], 0);

/**
 * You have to have been out there. One rule, applied to everyone: a selection
 * is an honour for a season, and half a season is the floor for having had
 * one. It doubles as the sample guard for the rate stats in
 * lib/performanceScore.ts — it is what stops a kicker who went 4-for-4 in two
 * September games from leading the league in field-goal percentage.
 */
export const MIN_APPEARANCE_SHARE = 0.5;

/**
 * The floor under a selection. A candidate must be at or above an ordinary
 * season at his own position — the score is in standard deviations, so zero IS
 * the positional average.
 *
 * This almost never binds: slots are the top 12.5% of a position's starters
 * and the pool includes every backup who played, so a genuine All-Star sits
 * one to three standard deviations clear. It binds exactly when it should — a
 * position so thin in a conference that filling every slot would mean handing
 * the honour to a below-average season. Then the slot goes empty and the
 * roster says so, because an All-Star nobody could justify from a stat line is
 * worse than an All-Star who isn't there.
 */
export const MIN_SELECTION_SCORE = 0;

/**
 * The stat line that earned it, written the way that position's numbers are
 * read. Built from CAREER_COLUMNS so an edge rusher gets sacks and forced
 * fumbles and a corner gets interceptions and passes defended, rather than
 * everyone getting the same three columns.
 */
export function allStarStatLine(position: string, s: SeasonStats): string {
  const pos = canonicalPosition(position);
  // Two positions are earned on a RATE (lib/performanceScore.ts), and printing
  // only the counting columns would show a stat line that does not contain the
  // reason he was picked — a punter's 3,531 yards is a fact about how often his
  // offense went three-and-out, and a kicker chosen over a bigger-volume rival
  // was chosen for the misses he didn't have. The line has to show the number
  // that did the work.
  if (pos === 'K') {
    return `${s.fgm ?? 0}/${s.fga ?? 0} FG${(s.fga ?? 0) > 0 ? ` (${Math.round(((s.fgm ?? 0) / (s.fga ?? 1)) * 100)}%)` : ''}, ${s.xpm ?? 0} XP`;
  }
  if (pos === 'P') {
    const avg = (s.punts ?? 0) > 0 ? (s.puntYds ?? 0) / (s.punts ?? 1) : 0;
    return `${avg.toFixed(1)} yds/punt on ${s.punts ?? 0} punts`;
  }
  const cols = careerColumns(pos)
    .filter((c) => c.lead != null)
    .sort((a, b) => a.lead! - b.lead!);
  return cols
    .map((c) => {
      const v = (s as Record<string, number | undefined>)[c.key] ?? 0;
      const shown = Number.isInteger(v) ? String(v) : v.toFixed(1);
      return `${shown} ${SHORT_STAT_WORD[c.key] ?? statLabel(c.key)}`;
    })
    .join(', ');
}

/** Terse stat words for a one-line résumé — "14 sacks", not "14 Sacks". */
const SHORT_STAT_WORD: Record<string, string> = {
  passYds: 'pass yds', passTd: 'pass TD', int: 'INT',
  rushYds: 'rush yds', rushTd: 'rush TD',
  recYds: 'rec yds', recTd: 'rec TD', rec: 'rec',
  tackles: 'tkl', sacks: 'sacks', ff: 'FF', defInt: 'INT', pd: 'PD',
  fgm: 'FG', xpm: 'XP', puntYds: 'punt yds',
};

export interface AllStarCandidate {
  playerId: string;
  name: string;
  position: Position;
  teamId: string | null;
  teamAbbr: string;
  conference: string;
  /** Standard deviations above an ordinary season at his position. */
  score: number;
  statLine: string;
  gp: number;
}

export interface AllStarPositionResult {
  conference: string;
  position: Position;
  slots: number;
  selected: AllStarCandidate[];
  /**
   * The first man out — a real near-miss, not a decoration. The highest scorer
   * at his position in his conference who did not get a slot, and he only
   * exists when somebody actually missed. A crowded position produces one with
   * a monstrous line; a position that did not fill its slots produces none.
   */
  nearMiss: AllStarCandidate | null;
  /**
   * Slots left empty because too few players at this position cleared the bar.
   * A thin position sends nobody rather than sending somebody undeserving.
   */
  unfilled: number;
}

export interface AllStarSelection {
  seasonYear: number;
  positions: AllStarPositionResult[];
  selected: AllStarCandidate[];
}

/**
 * Select the All-Star rosters from this season's accumulated statistics.
 *
 * Read-only: works out who made it and hands the answer back. Writing it down
 * is `recordAllStars` below, so a roster can be inspected without changing
 * anything.
 *
 * Deterministic by construction — there is no randomness in here at all, which
 * is why it takes no Rng. Every input is a number already in the database and
 * every comparison is a total order (score, then player id, so two identical
 * seasons always break the same way). A re-render or a re-read cannot move a
 * selection, and selecting the same season twice selects the same men.
 */
export async function selectAllStars(
  leagueId: string,
  seasonYear: number,
  gamesInSeason: number,
): Promise<AllStarSelection> {
  const players = await prisma.player.findMany({
    where: { leagueId, status: 'ACTIVE', seasonStats: { not: '{}' }, teamId: { not: null } },
    select: {
      id: true, firstName: true, lastName: true, position: true, seasonStats: true, teamId: true,
      team: { select: { abbr: true, conference: true } },
    },
  });

  const minGames = Math.max(1, Math.ceil(gamesInSeason * MIN_APPEARANCE_SHARE));

  const rows = players
    .map((p) => {
      const stats = readJson<SeasonStats>(p.seasonStats, {});
      return { player: p, pos: canonicalPosition(p.position), stats, gp: stats.gp ?? 0 };
    })
    .filter((r) => ALL_STAR_SLOTS[r.pos] > 0);

  // The yardstick is the whole league — everyone who played the position this
  // year, in both conferences. The ROSTER is per-conference; the standard a
  // player is measured against is not, or the two conferences would be marking
  // to different curves and a selection would mean two different things.
  const dists: Map<string, PositionDistribution> = buildPositionDistributions(
    rows.filter((r) => r.gp > 0).map((r) => ({ position: r.pos, stats: r.stats })),
  );

  const candidates: AllStarCandidate[] = rows
    .filter((r) => r.gp >= minGames && dists.has(r.pos))
    .map((r) => ({
      playerId: r.player.id,
      name: `${r.player.firstName} ${r.player.lastName}`,
      position: r.pos,
      teamId: r.player.teamId,
      teamAbbr: r.player.team?.abbr ?? 'FA',
      conference: r.player.team?.conference ?? '',
      score: positionRelativeScore(r.pos, r.stats, dists.get(r.pos)!),
      statLine: allStarStatLine(r.pos, r.stats),
      gp: r.gp,
    }))
    .filter((c) => c.conference !== '');

  const conferences = [...new Set(candidates.map((c) => c.conference))].sort();
  const positions: AllStarPositionResult[] = [];

  for (const conference of conferences) {
    for (const position of ALL_STAR_POSITIONS) {
      const slots = ALL_STAR_SLOTS[position];
      const ranked = candidates
        .filter((c) => c.conference === conference && c.position === position)
        // Score descending, player id as the tiebreak — so two identical
        // seasons resolve the same way on every run rather than however the
        // database happened to return them that time.
        .sort((a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId));

      const qualified = ranked.filter((c) => c.score >= MIN_SELECTION_SCORE);
      const selected = qualified.slice(0, slots);
      positions.push({
        conference, position, slots, selected,
        nearMiss: qualified[slots] ?? null,
        unfilled: slots - selected.length,
      });
    }
  }

  return { seasonYear, positions, selected: positions.flatMap((p) => p.selected) };
}

/**
 * Write the selection down.
 *
 * One Transaction per selection — the durable record the player card, the GM
 * career page and league history all read back — plus exactly ONE announcement
 * row. Both, because they do different jobs: seventy-odd individual rows are
 * the record but they would bury a week's wire, and one summary row is the
 * occasion but it cannot tell a player card that he made it in 2029.
 *
 * lib/wireRank.ts weights them accordingly: the announcement is a headline, an
 * individual selection is quiet — until it is one of YOUR players, at which
 * point the wire's own user-team bonus lifts it clear of everything else on
 * the page. Finding out your guy made it is the whole point of the feature.
 *
 * Idempotent: re-running a season's selection replaces that season's rows
 * rather than doubling them, so the announcement appears once.
 */
export async function recordAllStars(
  leagueId: string,
  seasonYear: number,
  week: number,
  gamesInSeason: number,
): Promise<AllStarSelection> {
  const selection = await selectAllStars(leagueId, seasonYear, gamesInSeason);
  if (selection.selected.length === 0) return selection;

  const userTeam = await prisma.team.findFirst({
    where: { leagueId, isUser: true },
    select: { id: true, abbr: true },
  });

  const mine = userTeam ? selection.selected.filter((c) => c.teamId === userTeam.id) : [];
  // The best near-miss on the user's own roster. A snub is only worth printing
  // when it is his — "somebody in the league just missed" is not a story.
  const mySnub = userTeam
    ? selection.positions
        .map((p) => p.nearMiss)
        .filter((c): c is AllStarCandidate => c !== null && c.teamId === userTeam.id)
        .sort((a, b) => b.score - a.score)[0] ?? null
    : null;
  // ...and only when he had NOBODY selected. A first man out is a consolation
  // for a shut-out roster; next to two players who actually made it he is a
  // footnote, and a footnote that is a Transaction row does not stay a
  // footnote — every generic reader in the app (the League Wire, the week
  // report) picks rows up by type and lifts the user's own to the top, so a
  // GM with six All-Stars got "and this one just missed" ranked above his
  // selections. Not writing it is the fix, because it is the same condition
  // the dashboard panel already reads it under.
  const snubToRecord = mine.length === 0 ? mySnub : null;

  const detail = !userTeam
    ? `${selection.selected.length} players honored.`
    : mine.length > 0
      ? `${userTeam.abbr}: ${mine.map((c) => `${c.name} (${c.position})`).join(', ')}`
      : mySnub
        ? `No ${userTeam.abbr} players selected. Closest: ${mySnub.name} (${mySnub.position}) — ${mySnub.statLine} — first man out at ${mySnub.position} in the ${mySnub.conference}.`
        : `No ${userTeam.abbr} players selected this year.`;

  await prisma.$transaction(async (tx) => {
    await tx.transaction.deleteMany({
      where: { leagueId, seasonYear, type: { in: [ALL_STAR_TYPE, ALL_STAR_ANNOUNCEMENT_TYPE, ALL_STAR_SNUB_TYPE] } },
    });
    if (snubToRecord) {
      await tx.transaction.create({
        data: {
          leagueId, seasonYear, week, type: ALL_STAR_SNUB_TYPE, teamId: snubToRecord.teamId,
          headline: `${snubToRecord.name} (${snubToRecord.position})`,
          detail: `${snubToRecord.statLine}${SNUB_DETAIL_SEP}first man out at ${snubToRecord.position} in the ${snubToRecord.conference}`,
        },
      });
    }
    await tx.transaction.create({
      data: {
        leagueId, seasonYear, week, type: ALL_STAR_ANNOUNCEMENT_TYPE, teamId: null,
        headline: `The ${seasonYear} All-Star rosters are out — ${selection.selected.length} selections`,
        detail,
      },
    });
    await tx.transaction.createMany({
      data: selection.selected.map((c) => ({
        leagueId, seasonYear, week, type: ALL_STAR_TYPE, teamId: c.teamId,
        // The same "Name (POS)" shape every award row uses, because the player
        // page matches a man's honours by that prefix. The honour's NAME is
        // not in here: it is the row's `type`, and every reader derives it.
        headline: `${c.name} (${c.position})`,
        detail: c.statLine,
      })),
    });
  });

  return selection;
}

/**
 * ===========================================================================
 * READING IT BACK
 * ===========================================================================
 */

/**
 * The years a player was selected, oldest first. Empty for most of a roster,
 * which is the point — an honour everyone has is not an honour.
 *
 * Matched by name for the same reason lib/awards.ts's are: Transaction has no
 * player relation, and lib/gen/names.ts's NameRegistry guarantees no two
 * players in a league ever share one.
 */
export async function allStarYearsFor(leagueId: string, firstName: string, lastName: string): Promise<number[]> {
  const rows = await prisma.transaction.findMany({
    where: { leagueId, type: ALL_STAR_TYPE, headline: { startsWith: `${firstName} ${lastName} (` } },
    select: { seasonYear: true },
    orderBy: { seasonYear: 'asc' },
  });
  return rows.map((r) => r.seasonYear);
}

export interface GmAllStarTally {
  /**
   * DISTINCT players who earned a selection — the headline figure on the GM
   * page. A five-time All-Star quarterback is one All-Star player.
   */
  players: number;
  /** Selections earned. Always >= players; the two tell different stories. */
  selections: number;
  /** One row per selection, newest first. */
  entries: { year: number; name: string; position: string; statLine: string }[];
}

/**
 * All-Star selections earned by players on a team, bounded to a window — the
 * GM career page passes his hire year, because a total that counted honours
 * won before he was hired would not be his career. Same bound, same reason, as
 * every other number on that page (lib/gmCareer.ts, resolveStartYear).
 *
 * `teamId` on the row is the club the player was on the day he was selected,
 * which is the honest attribution: a GM gets credit for the All-Star seasons
 * his roster produced, and stops getting it the year the player produces one
 * somewhere else.
 */
export async function allStarTallyForTeam(leagueId: string, teamId: string, sinceYear: number): Promise<GmAllStarTally> {
  const rows = await prisma.transaction.findMany({
    where: { leagueId, teamId, type: ALL_STAR_TYPE, seasonYear: { gte: sinceYear } },
    orderBy: [{ seasonYear: 'desc' }, { headline: 'asc' }],
    select: { seasonYear: true, headline: true, detail: true },
  });

  const entries = rows.map((r) => {
    const m = /^(.*) \(([^)]+)\)$/.exec(r.headline);
    return { year: r.seasonYear, name: m?.[1] ?? r.headline, position: m?.[2] ?? '', statLine: r.detail };
  });

  return {
    players: new Set(entries.map((e) => e.name)).size,
    selections: entries.length,
    entries,
  };
}

export interface AllStarSnub { name: string; position: string; statLine: string; note: string }

/**
 * The frozen near-miss for a team in a season, or null. Reads the row written
 * at selection time — it never re-ranks anybody, which is the entire reason
 * the row exists (see ALL_STAR_SNUB_TYPE).
 */
export async function allStarSnubFor(leagueId: string, teamId: string, seasonYear: number): Promise<AllStarSnub | null> {
  const row = await prisma.transaction.findFirst({
    where: { leagueId, teamId, seasonYear, type: ALL_STAR_SNUB_TYPE },
    select: { headline: true, detail: true },
  });
  if (!row) return null;
  const m = /^(.*) \(([^)]+)\)$/.exec(row.headline);
  const [statLine, note] = row.detail.split(SNUB_DETAIL_SEP);
  return {
    name: m?.[1] ?? row.headline,
    position: m?.[2] ?? '',
    statLine: statLine ?? row.detail,
    note: note ?? '',
  };
}

/** The slot table, for anything that wants to show the roster's shape. */
export function allStarSlotSummary(): { position: Position; slots: number; starters: number }[] {
  return ALL_STAR_POSITIONS.map((p) => ({ position: p, slots: ALL_STAR_SLOTS[p], starters: startersAt(p) }));
}
