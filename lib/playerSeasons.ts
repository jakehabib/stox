import { prisma } from './db';
import { readJson, writeJson } from './json';
import { mergeStats } from './stats';
import type { BoxScore, SeasonStats } from './types';

/**
 * ===========================================================================
 * YEAR-BY-YEAR PLAYER STATS
 * ===========================================================================
 * "The player stats should show the year by year stat lines like real nfl
 * shows by season."
 *
 * WHAT THE DATABASE ACTUALLY KNOWS, and what it doesn't
 * ----------------------------------------------------
 * Player.seasonStats is one merged blob for the season in progress, cleared
 * every year. Player.careerStats is one merged blob of everything before it
 * — no season on it, no team on it. Neither can be decomposed. There has
 * never been a per-season record.
 *
 * But the seasons the LEAGUE has actually played are not lost, they were
 * just never indexed: every played Game keeps its full BoxScore, and a box
 * score carries a per-player stat line filed under the home or away side.
 * `Game.seasonYear` says which year, `homeTeamId`/`awayTeamId` say which
 * club. So the true decomposition — year, team, games, stats — is
 * reconstructable by replaying the box scores, and it is reconstructable for
 * saves that predate this feature too, because nothing in the codebase ever
 * deletes a Game. That is what buildSeasonLines() below does, and it is the
 * ONLY source this module will accept for a season row.
 *
 * WHAT IS NOT KNOWABLE, and is therefore never invented
 * -----------------------------------------------------
 * Two kinds of career predate any box score:
 *
 *   1. A save that rolled seasons over before PlayerSeason existed and whose
 *      Games were... still there, actually — so those DO decompose. Good.
 *   2. Careers seeded at league creation. lib/gen/leagueHistory.ts gives every
 *      veteran on a roster the career he "would have had", walking backward
 *      one fictional season at a time — but it persists only the merged
 *      total. The per-season walk is gone the moment generation returns (the
 *      Rng stream is not stored), and that module's own comment is explicit
 *      that "nothing in the schema records where a generated veteran was in
 *      2019". The team-that-year — the entire point of this table — was
 *      never decided, for any of those seasons, by anything.
 *
 * So a 33-year-old at league creation has a true career total and no
 * recoverable seasons. Splitting it into plausible-looking yearly rows would
 * be inventing history: a different fiction from the one that produced the
 * total, forced to sum to it, attached to clubs picked out of the air. This
 * module refuses. Everything that cannot be attributed to a real played
 * season collapses into ONE row, labelled for what it is — "Before 2026" —
 * carrying the true merged remainder. See residualBeforeRow().
 *
 * (The seeded FRANCHISE backstory is a different case and stays as it is:
 * TeamSeasonRecord rows, titles and award winners are persisted as league
 * canon at creation. They imply that players existed and had seasons, but
 * they never say which players, and the synthetic legends who won those
 * awards are not Player rows at all — they exist only as denormalized names
 * on Transaction/LeagueRecord. Nothing there can produce a player-season.)
 *
 * MID-SEASON TRADES: TWO ROWS, PLUS A COMBINED ONE
 * ------------------------------------------------
 * A season row is keyed on (player, year, TEAM), not (player, year). A back
 * traded in week 9 gets one row for each club, because "which club did he
 * produce for" is the question a year-by-year table exists to answer, and
 * one row averaged across two jerseys answers it wrongly while looking
 * authoritative. The display then adds a combined row above the pair —
 * exactly the "2TM" convention every real football reference uses — so the
 * season total is still readable at a glance. The split is free: the box
 * scores already file each game under the club he played it for.
 * ===========================================================================
 */

/** One real, played, attributable season with one club. */
export interface SeasonLine {
  seasonYear: number;
  /** Null only if the club row has since been deleted; `teamAbbr` still stands. */
  teamId: string | null;
  teamAbbr: string;
  /** His age that season, or null when it isn't knowable — see ageInSeason(). */
  age: number | null;
  gp: number;
  stats: SeasonStats;
  /** Sort key within a season — where his first game for this club fell. */
  firstSeen: number;
}

const GAME_SELECT = { seasonYear: true, week: true, kind: true, homeTeamId: true, awayTeamId: true, boxScore: true } as const;
type GameRow = { seasonYear: number; week: number; kind: string; homeTeamId: string; awayTeamId: string; boxScore: string };

/**
 * A sortable position in the season. Playoff weeks restart at 1, so a
 * conference final would otherwise sort ahead of a week-5 game and put a
 * traded player's clubs in the wrong order on his row.
 */
function seasonOrder(g: { week: number; kind: string }): number {
  return (g.kind === 'REGULAR' ? 0 : 100) + g.week;
}

/**
 * Replay a set of played games into per-(player, year, team) stat lines.
 * Pure — takes rows in, gives lines out — so the same code serves the
 * season rollover, the backfill of an old save, and the single-player
 * lookup on the player page.
 */
export function buildSeasonLines(
  games: GameRow[],
  abbrByTeamId: Map<string, string>,
): Map<string, SeasonLine[]> {
  // key: playerId | year | teamId
  const acc = new Map<string, { playerId: string; seasonYear: number; teamId: string; firstSeen: number; stats: SeasonStats }>();

  for (const g of games) {
    const box = readJson<BoxScore | null>(g.boxScore, null);
    if (!box?.lines) continue;
    for (const [side, teamId] of [['home', g.homeTeamId], ['away', g.awayTeamId]] as const) {
      for (const line of box.lines[side] ?? []) {
        const key = `${line.playerId}|${g.seasonYear}|${teamId}`;
        const cur = acc.get(key);
        if (cur) {
          cur.stats = mergeStats(cur.stats, line.stats);
          cur.firstSeen = Math.min(cur.firstSeen, seasonOrder(g));
        } else {
          acc.set(key, {
            playerId: line.playerId, seasonYear: g.seasonYear, teamId,
            firstSeen: seasonOrder(g), stats: { ...line.stats },
          });
        }
      }
    }
  }

  const out = new Map<string, SeasonLine[]>();
  for (const entry of acc.values()) {
    const list = out.get(entry.playerId) ?? out.set(entry.playerId, []).get(entry.playerId)!;
    list.push({
      seasonYear: entry.seasonYear,
      teamId: entry.teamId,
      teamAbbr: abbrByTeamId.get(entry.teamId) ?? '—',
      age: null,
      gp: entry.stats.gp ?? 0,
      stats: entry.stats,
      firstSeen: entry.firstSeen,
    });
  }
  // Oldest season first, and within a season the clubs in the order he
  // actually played for them — a player traded in week 9 reads "old club,
  // then new club", not "whichever club got more games out of him".
  for (const list of out.values()) {
    list.sort((a, b) => a.seasonYear - b.seasonYear || a.firstSeen - b.firstSeen);
  }
  return out;
}

/**
 * Every attributable season in a league, for every player who ever recorded a
 * stat in it. One query, one pass. A full league-season is ~285 games at
 * ~4.5KB of box score each — about 1.3MB, measured at ~60ms to load and
 * ~55ms to parse for a four-year save, which is why this runs as a single
 * sweep at rollover rather than being maintained incrementally.
 */
export async function reconstructLeagueSeasons(
  leagueId: string,
  opts: { throughYear?: number; years?: number[] } = {},
): Promise<Map<string, SeasonLine[]>> {
  const [games, teams] = await Promise.all([
    prisma.game.findMany({
      where: {
        leagueId,
        played: true,
        ...(opts.years != null ? { seasonYear: { in: opts.years } } : {}),
        ...(opts.throughYear != null ? { seasonYear: { lte: opts.throughYear } } : {}),
      },
      select: GAME_SELECT,
    }),
    prisma.team.findMany({ where: { leagueId }, select: { id: true, abbr: true } }),
  ]);
  return buildSeasonLines(games, new Map(teams.map((t) => [t.id, t.abbr])));
}

/**
 * Every attributable season for ONE player, oldest first — completed years and
 * the one in progress together, in a single query.
 *
 * The filter is a LIKE on the box score text, which sounds alarming and
 * isn't: a league-season of box scores is ~1.3MB, Postgres scans it in a
 * couple of milliseconds, and it returns only the ~17 games a year the player
 * actually appeared in instead of all 285. Player ids are fixed-length cuids,
 * so a substring match cannot collide with another id.
 *
 * This is the fallback path for the player page. Once a league has been
 * through a rollover with PlayerSeason rows in place, the completed years are
 * read from that table instead — the same numbers with an index in front of
 * them — and only the season in progress still comes from here. A save that
 * hasn't rolled over since the table landed keeps a correct table rather than
 * an empty one, which is the whole reason this stays.
 */
export async function reconstructPlayerSeasons(
  leagueId: string,
  playerId: string,
  /** Restrict to one season — used for the year in progress, which has no rows yet. */
  seasonYear?: number,
): Promise<SeasonLine[]> {
  const [games, teams] = await Promise.all([
    prisma.$queryRaw<GameRow[]>`
      SELECT "seasonYear", "week", "kind", "homeTeamId", "awayTeamId", "boxScore"
      FROM "Game"
      WHERE "leagueId" = ${leagueId} AND "played" = true
        AND (${seasonYear ?? null}::int IS NULL OR "seasonYear" = ${seasonYear ?? null}::int)
        AND "boxScore" LIKE ${`%${playerId}%`}
    `,
    prisma.team.findMany({ where: { leagueId }, select: { id: true, abbr: true } }),
  ]);
  const byPlayer = buildSeasonLines(games, new Map(teams.map((t) => [t.id, t.abbr])));
  return byPlayer.get(playerId) ?? [];
}

// ---------------------------------------------------------------------------
// Age
// ---------------------------------------------------------------------------

/**
 * How old he was in season `year`.
 *
 * Player.age is a single number with no date attached, so it only means
 * anything relative to the league year it was last incremented for — call
 * that his BASIS year. Aging happens exactly once a league year, in the
 * offseason PROGRESS step (progressAllPlayers for rostered players,
 * progressFreeAgents for unsigned ones), so counting backwards from the
 * basis is exact rather than an estimate.
 *
 * The basis is not the same for everyone, which is the whole reason this is a
 * function and not a subtraction at the call site:
 *
 *   - Anyone still playing: the caller's `basisYear`. During REGULAR/PLAYOFFS
 *     that is simply League.seasonYear. In the one-step window between
 *     PROGRESS and RESET_STANDINGS — which is exactly when the rollover runs
 *     — PROGRESS has already bumped him for the season about to start, so the
 *     caller passes seasonYear + 1.
 *   - RETIRED: PROGRESS deliberately does not age him, so his number froze
 *     the year he walked away. `retiredBasisYear` carries that year (his last
 *     played season, plus any offseasons he spent unsigned first, which
 *     Player.yearsUnsigned records).
 *
 * Returns null rather than a wrong number when the arithmetic lands outside
 * anything a football player can be — a save that skipped steps, or a
 * career that predates the box scores entirely. A dash is honest; a
 * fabricated 24 is not.
 */
export function ageInSeason(currentAge: number, basisYear: number, year: number): number | null {
  const age = currentAge - (basisYear - year);
  if (!Number.isFinite(age) || age < 18 || age > 50) return null;
  return age;
}

/**
 * The league year Player.age is stated in for a player still in football.
 * See ageInSeason() — the offset exists only in the single offseason step
 * between aging and the season-year increment.
 */
export function ageBasisYear(league: { seasonYear: number; phase: string; week: number }): number {
  return league.phase === 'OFFSEASON' && league.week === 2 ? league.seasonYear + 1 : league.seasonYear;
}

/**
 * Stamp each line with how old he was that year. Split out from
 * reconstruction because the basis (see ageInSeason) is a property of the
 * player, not of the box score.
 */
export function withAges(
  lines: SeasonLine[],
  player: { age: number; status: string; yearsUnsigned: number },
  basisYear: number,
): SeasonLine[] {
  const lastPlayed = lines.reduce((m, l) => Math.max(m, l.seasonYear), -Infinity);
  // A retired player stopped aging the year he walked away — the offseason
  // PROGRESS step skips him on purpose. That year is his last played season
  // plus however many offseasons he spent unsigned before hanging it up.
  const basis = player.status === 'RETIRED' && Number.isFinite(lastPlayed)
    ? lastPlayed + player.yearsUnsigned
    : basisYear;
  return lines.map((l) => ({ ...l, age: ageInSeason(player.age, basis, l.seasonYear) }));
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** How many rows go in one INSERT. Same order as the other bulk writes here. */
const WRITE_CHUNK = 500;

/**
 * Bring PlayerSeason up to date for a league, through `throughYear`.
 *
 * Called once a year from rollSeasonStatsIntoCareer(). It does NOT assume it
 * is only ever writing the season that just ended: it asks which years already
 * have rows and replays only the ones that don't. So the ordinary case is one
 * season's ~285 games, and a save that predates this table pays a single
 * catch-up sweep of its whole played history the first time it advances —
 * which is the entire backfill story, with no separate script to remember to
 * run and nothing invented, because every row still comes from a game that was
 * actually played.
 *
 * Cost is a sweep, not a per-player round trip. One SELECT for the games, one
 * for the roster, then chunked createMany — about five statements for a full
 * league-season. rollSeasonStatsIntoCareer is already the slowest step in the
 * game and this deliberately does not add 1,900 writes to it.
 *
 * `skipDuplicates` against the (playerId, seasonYear, teamAbbr) unique key
 * makes a re-run a no-op rather than a doubling, which matters because the
 * offseason step around it can be re-entered on a restored save.
 */
export async function syncPlayerSeasons(
  leagueId: string,
  throughYear: number,
  basisYear: number,
): Promise<{ years: number[]; rows: number }> {
  const [havePlayerSeasons, havePlayedGames] = await Promise.all([
    prisma.playerSeason.groupBy({ by: ['seasonYear'], where: { leagueId } }),
    prisma.game.groupBy({
      by: ['seasonYear'],
      where: { leagueId, played: true, seasonYear: { lte: throughYear } },
    }),
  ]);
  const done = new Set(havePlayerSeasons.map((r) => r.seasonYear));
  const missing = havePlayedGames.map((r) => r.seasonYear).filter((y) => !done.has(y)).sort((a, b) => a - b);
  if (missing.length === 0) return { years: [], rows: 0 };

  const [byPlayer, roster] = await Promise.all([
    reconstructLeagueSeasons(leagueId, { years: missing }),
    prisma.player.findMany({
      where: { leagueId },
      select: { id: true, age: true, status: true, yearsUnsigned: true },
    }),
  ]);
  const rosterById = new Map(roster.map((p) => [p.id, p]));

  const rows: {
    leagueId: string; playerId: string; seasonYear: number;
    teamId: string | null; teamAbbr: string; age: number | null; gp: number;
    firstSeen: number; stats: string;
  }[] = [];
  for (const [playerId, lines] of byPlayer) {
    // A box score can name a player the Player table no longer has (a save
    // restored mid-write). The foreign key would reject the row anyway; skip
    // it rather than fail the whole offseason step over one orphan.
    const p = rosterById.get(playerId);
    if (!p) continue;
    for (const line of withAges(lines, p, basisYear)) {
      rows.push({
        leagueId, playerId,
        seasonYear: line.seasonYear,
        teamId: line.teamId,
        teamAbbr: line.teamAbbr,
        age: line.age,
        gp: line.gp,
        firstSeen: line.firstSeen,
        stats: writeJson(line.stats),
      });
    }
  }

  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    await prisma.playerSeason.createMany({ data: rows.slice(i, i + WRITE_CHUNK), skipDuplicates: true });
  }
  return { years: missing, rows: rows.length };
}

/**
 * One player's completed seasons, oldest first — the indexed read, served by
 * the (playerId, seasonYear, teamAbbr) unique index as a prefix scan.
 *
 * Returns null, rather than an empty array, when this league has no rows yet:
 * "not synced" and "played but never recorded a stat" are different answers
 * and only the first one should send the caller to the box-score replay.
 */
export async function loadPlayerSeasons(
  leagueId: string,
  playerId: string,
): Promise<SeasonLine[] | null> {
  // The dev server caches its PrismaClient on globalThis, so between a
  // `prisma generate` and the next restart this delegate can genuinely be
  // undefined. Falling back to the replay is correct behaviour there, not a
  // workaround: the page shows the same numbers either way.
  if (!prisma.playerSeason) return null;

  const rows = await prisma.playerSeason.findMany({
    where: { playerId },
    // Oldest season first, and within a season the clubs in the order he
    // actually played for them — see PlayerSeason.firstSeen in the schema.
    orderBy: [{ seasonYear: 'asc' }, { firstSeen: 'asc' }],
  });
  if (rows.length === 0) {
    const any = await prisma.playerSeason.findFirst({ where: { leagueId }, select: { id: true } });
    if (!any) return null;
  }
  return rows.map((r) => ({
    seasonYear: r.seasonYear,
    teamId: r.teamId,
    teamAbbr: r.teamAbbr,
    age: r.age,
    gp: r.gp,
    stats: readJson<SeasonStats>(r.stats, {}),
    firstSeen: r.firstSeen,
  }));
}

// ---------------------------------------------------------------------------
// Display model
// ---------------------------------------------------------------------------

export interface CareerTableRow {
  kind: 'season' | 'combined' | 'split' | 'before' | 'career';
  /** "2029", "Before 2026", "Career" — already resolved, the table renders it verbatim. */
  seasonLabel: string;
  /** Suppressed on the second and later rows of a traded season, the way a real stat page does. */
  showSeasonLabel: boolean;
  teamId: string | null;
  /** "BOS", "2TM", or null when there is genuinely no club to name. */
  teamAbbr: string | null;
  age: number | null;
  stats: SeasonStats;
  /** The season currently being played — its numbers are not final. */
  inProgress: boolean;
  /** Why a row carries no team crest, when that needs saying out loud. */
  note?: string;
}

export interface CareerTable {
  rows: CareerTableRow[];
  /** True when any part of the career could not be attributed to a played season. */
  hasUndecomposed: boolean;
  /** Nothing at all to show — not even a career total. */
  empty: boolean;
}

function sumStats(lines: { stats: SeasonStats }[]): SeasonStats {
  let out: SeasonStats = {};
  for (const l of lines) out = mergeStats(out, l.stats);
  return out;
}

/**
 * careerStats minus everything we can attribute to a real season. Whatever is
 * left is a career that happened before this league kept per-season records —
 * seeded history, almost always. It is shown as one row and never split.
 *
 * Clamped at zero per key. A negative remainder would mean the box scores
 * claim more than the career total does, which is a corruption rather than a
 * career, and the table would rather under-claim than print a negative.
 */
function residualBeforeRow(careerStats: SeasonStats, attributed: SeasonStats): SeasonStats | null {
  const out: SeasonStats = {};
  let any = false;
  for (const key of Object.keys(careerStats) as (keyof SeasonStats)[]) {
    const diff = (careerStats[key] ?? 0) - (attributed[key] ?? 0);
    if (diff > 0) { out[key] = diff; any = true; }
  }
  return any ? out : null;
}

/**
 * Assemble the rendered table. The career row is summed from the rows above
 * it rather than read from Player.careerStats — by construction they are the
 * same number (the "before" row is defined as the difference), and summing
 * the visible rows means the total on screen is always the total of the
 * table on screen. A stat page whose bottom line doesn't match its own
 * column is the exact failure this project keeps writing down.
 */
export function buildCareerTable(args: {
  position: string;
  /** Persisted, attributable seasons — completed years only. */
  seasons: SeasonLine[];
  /** The season not yet rolled into careerStats, reconstructed live. */
  live: SeasonLine[];
  /** Whether that season is still actually being played, or merely un-rolled. */
  liveInProgress: boolean;
  /** Player.careerStats: every completed season, merged, undecomposable. */
  careerStats: SeasonStats;
  /** League founding year — the label for anything older than the record. */
  startYear: number;
}): CareerTable {
  const { seasons, live, liveInProgress, careerStats, startYear } = args;

  const rows: CareerTableRow[] = [];

  const attributed = sumStats(seasons);
  const before = residualBeforeRow(careerStats, attributed);
  const earliestKnown = seasons.length > 0 ? seasons[0].seasonYear : (live[0]?.seasonYear ?? startYear);

  if (before) {
    rows.push({
      kind: 'before',
      seasonLabel: `Before ${earliestKnown}`,
      showSeasonLabel: true,
      teamId: null,
      teamAbbr: null,
      age: null,
      stats: before,
      inProgress: false,
      note: 'Career total carried into this league — the individual seasons behind it were never recorded.',
    });
  }

  const byYear = new Map<number, SeasonLine[]>();
  for (const line of [...seasons, ...live]) {
    (byYear.get(line.seasonYear) ?? byYear.set(line.seasonYear, []).get(line.seasonYear)!).push(line);
  }
  const liveYear = liveInProgress ? (live[0]?.seasonYear ?? null) : null;

  for (const year of [...byYear.keys()].sort((a, b) => a - b)) {
    const group = byYear.get(year)!;
    const inProgress = year === liveYear;
    if (group.length === 1) {
      rows.push({
        kind: 'season',
        seasonLabel: String(year),
        showSeasonLabel: true,
        teamId: group[0].teamId,
        teamAbbr: group[0].teamAbbr,
        age: group[0].age,
        stats: group[0].stats,
        inProgress,
      });
      continue;
    }
    // Traded mid-season. The combined line first — the "2TM" convention —
    // then one row per club so the split is visible rather than averaged away.
    rows.push({
      kind: 'combined',
      seasonLabel: String(year),
      showSeasonLabel: true,
      teamId: null,
      teamAbbr: `${group.length}TM`,
      age: group.find((g) => g.age != null)?.age ?? null,
      stats: sumStats(group),
      inProgress,
    });
    for (const line of group) {
      rows.push({
        kind: 'split',
        seasonLabel: String(year),
        showSeasonLabel: false,
        teamId: line.teamId,
        teamAbbr: line.teamAbbr,
        age: line.age,
        stats: line.stats,
        inProgress,
      });
    }
  }

  const totalled = rows.filter((r) => r.kind !== 'split');
  if (totalled.length === 0) return { rows: [], hasUndecomposed: false, empty: true };

  rows.push({
    kind: 'career',
    seasonLabel: 'Career',
    showSeasonLabel: true,
    teamId: null,
    teamAbbr: null,
    age: null,
    stats: sumStats(totalled),
    inProgress: liveYear != null,
  });

  return { rows, hasUndecomposed: before != null, empty: false };
}
