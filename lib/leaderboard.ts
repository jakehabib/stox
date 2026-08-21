import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { resolveStartYear } from './leagueYear';
import {
  AWARD_TYPES,
  computeDynastyXp,
  levelFromXp,
  type LevelProgress,
} from './dynasty';

/**
 * ===========================================================================
 * THE PUBLIC LEADERBOARD
 * ===========================================================================
 * A shareable board of GM progression. Four decisions carry the whole design,
 * and the uncomfortable one is last.
 *
 * 1. WHO CAN BE ON IT. Only an account. A cookie-owned save is anonymous by
 *    construction — there is no durable identity to hang a rank on and no way
 *    to tell two browsers apart from one person clearing cookies twice — so
 *    signing out is not "hidden from the board", it is "not rankable". The
 *    board says so in as many words, because it is the honest reason to make
 *    an account and it is better said out loud than discovered.
 *
 * 2. OPT-IN, DEFAULT OFF. `User.leaderboardOptIn` defaults to false. Somebody
 *    who signed up an hour ago to stop losing their saves did not agree to
 *    have their username and their franchise's record published. Opting out
 *    DELETES the rows rather than filtering them, so "not listed" means the
 *    public table does not contain you.
 *
 * 3. ONE ROW PER GM, NOT PER SAVE. A GM is represented by their BEST
 *    franchise under whichever metric is being sorted on — a peak, not a
 *    total. A total across saves would rank "made eight leagues" above "built
 *    one dynasty", which is the opposite of what the board is for.
 *
 * 4. WHAT IT ACTUALLY MEASURES, AND WHAT IT CANNOT.
 *
 *    Dynasty XP comes out of a single-player simulation the player controls
 *    completely. There is no server-side notion of a "legitimately played"
 *    save and this file does not invent one. Someone can hold Advance for an
 *    afternoon, sim twenty seasons, and outrank a person who played every
 *    week carefully. Nothing here makes that untrue, so nothing here pretends
 *    to. What this file does instead:
 *
 *      * SHOWS THE DENOMINATOR ON EVERY ROW. "Level 22 · 31 seasons · 2 titles"
 *        is honest in a way "Level 22" is not. `seasons` is never optional,
 *        never truncated away on mobile, and never behind a toggle.
 *      * OFFERS A RATE, NOT ONLY A TOTAL. The PER_SEASON sort ranks on XP per
 *        completed season, where simming twenty 8-9 years actively HURTS you.
 *        It is the closest thing to a grind-resistant measure available, and
 *        it is one click from the default.
 *      * LABELS THE BOARD FOR WHAT IT IS. See LEADERBOARD_CAVEAT.
 *
 *    None of that is anti-cheat. It is disclosure. Real anti-cheat needs
 *    server-authoritative simulation, which this game does not have and is not
 *    getting today.
 *
 * MULTI-SPORT. `DynastyRank.sport` is the discriminator and `saveKey` is an
 * opaque string, so baseball and basketball write their own rows into the same
 * table against the same `User`. Nothing below hardcodes 'FOOTBALL' except the
 * football REFRESH — which is football's job, because this app is football's
 * writer. The read path takes a sport (or all of them) as an argument and the
 * tab list is derived from the sports actually present in the data.
 * ===========================================================================
 */

/** This app's sport. The only value this app's writer ever produces. */
export const FOOTBALL = 'FOOTBALL';

/** Human labels for sports that may show up in the table. */
export const SPORT_LABEL: Record<string, string> = {
  FOOTBALL: 'Football',
  BASEBALL: 'Baseball',
  BASKETBALL: 'Basketball',
};

export function sportLabel(sport: string): string {
  return SPORT_LABEL[sport] ?? sport.charAt(0) + sport.slice(1).toLowerCase();
}

/**
 * The sentence the board leads with. Kept here rather than in the page so the
 * claim and the code that backs it live together — if the ranking changes and
 * this string does not, the diff is in one file and obvious.
 */
export const LEADERBOARD_CAVEAT =
  'Every number here comes from a single-player simulation the player controls. ' +
  'Seasons can be simulated as fast as you can click, so a bigger total often means more time spent advancing, ' +
  'not better front-office work. That is why every row shows how many seasons it took, and why "Per Season" is one tab away.';

/**
 * How many rows the board will hold at once. A ceiling on work, not on
 * ambition: the deployment already caps the whole League table (see
 * maxLeaguesTotal in lib/owner.ts), so at beta scale this is never reached.
 * Rows are ordered by xp in SQL, so if it ever IS reached the board loses its
 * tail rather than an arbitrary slice.
 */
const MAX_ROWS = 1000;

/** A completed season must be on the board before a RATE means anything. */
export const PER_SEASON_MIN_SEASONS = 3;

export type LeaderboardSort = 'LEVEL' | 'TITLES' | 'PER_SEASON';

export const SORTS: { id: LeaderboardSort; label: string; blurb: string }[] = [
  {
    id: 'LEVEL',
    label: 'Dynasty Level',
    blurb: 'Career XP, the same total the Dynasty screen shows. Rewards everything a franchise has ever done, which also means it rewards time.',
  },
  {
    id: 'TITLES',
    label: 'Championships',
    blurb: 'Rings first, then level. The only line on the board that a losing season cannot pad.',
  },
  {
    id: 'PER_SEASON',
    label: 'Per Season',
    blurb: `XP per completed season, minimum ${PER_SEASON_MIN_SEASONS} seasons. Simming a decade of .500 football moves you DOWN this one.`,
  },
];

export function parseSort(raw: string | null | undefined): LeaderboardSort {
  return SORTS.some((s) => s.id === raw) ? (raw as LeaderboardSort) : 'LEVEL';
}

// ---------------------------------------------------------------------------
// The refresh — football's writer
// ---------------------------------------------------------------------------

/**
 * A league is eligible for the board when ALL of:
 *   - it belongs to an ACCOUNT (`userId` set), because a cookie is not an
 *     identity;
 *   - that account has opted in;
 *   - it has a user team, because a save with no franchise has no record.
 *
 * Everything that stops being true here — a deleted league, an account that
 * opted back out, a user deleted outright — is handled by ONE mechanism: the
 * sweep at the bottom of refreshFootballRanks() deletes every football row
 * whose saveKey is not in this set. There is no second code path to forget.
 */
function eligibleLeagueWhere(): Prisma.LeagueWhereInput {
  return {
    userId: { not: null },
    userTeamId: { not: null },
    user: { is: { leaderboardOptIn: true } },
  };
}

export interface RefreshResult {
  scanned: number;
  written: number;
  removed: number;
}

/** One franchise's freshly derived standing, before it is stored or ranked. */
export interface ComputedEntry {
  saveKey: string;
  userId: string;
  xp: number;
  seasons: number;
  wins: number;
  losses: number;
  championships: number;
  teamName: string;
  teamAbbr: string;
  crestSeed: string;
}

/**
 * Derive the board figures for every football league matching `where`.
 *
 * THIS IS THE ONLY PLACE THE BOARD'S XP IS COMPUTED. The refresh writes what
 * it returns; the /account preview shows what it returns without writing
 * anything, which is how an opted-OUT account can be shown the row it would
 * post without a row existing anywhere. One function, so a preview and a
 * published rank can never quote different numbers for the same franchise.
 *
 * THE ARITHMETIC IS DELIBERATELY IDENTICAL TO buildDynastyState in
 * lib/dynasty.ts: same tenure-start filter, same in-progress-season rule, same
 * award list (imported, not copied), same pure computeDynastyXp. The
 * difference is only that the four per-league queries are BATCHED across every
 * league at once, so the cost is a constant number of round trips no matter
 * how many franchises are on the board. Verification asserted equality
 * league-for-league against buildDynastyState; if this ever drifts, the board
 * and the Dynasty screen start disagreeing about one franchise, which is the
 * exact bug class README principle 6 exists for.
 */
export async function computeFootballEntries(
  where: Prisma.LeagueWhereInput,
): Promise<ComputedEntry[]> {
  const leagues = await prisma.league.findMany({
    where,
    select: { id: true, seasonYear: true, startYear: true, userTeamId: true, userId: true },
  });

  const teamIds = leagues.map((l) => l.userTeamId).filter((id): id is string => !!id);
  if (teamIds.length === 0) return [];

  // Four batched reads, mirroring buildDynastyState's four per-league reads.
  // The tenure-start cut-off is applied in JS below rather than in SQL,
  // because it differs per league and a per-league WHERE would put us straight
  // back to one query each.
  const [teams, records, awards, picks] = await Promise.all([
    prisma.team.findMany({
      where: { id: { in: teamIds } },
      select: { id: true, city: true, nickname: true, abbr: true, wins: true, losses: true },
    }),
    prisma.teamSeasonRecord.findMany({
      where: { teamId: { in: teamIds } },
      select: { teamId: true, year: true, wins: true, losses: true, ties: true, playoffResult: true },
      orderBy: { year: 'asc' },
    }),
    prisma.transaction.findMany({
      where: { teamId: { in: teamIds }, type: { in: AWARD_TYPES } },
      select: { teamId: true, seasonYear: true },
    }),
    prisma.draftPick.findMany({
      where: { ownerTeamId: { in: teamIds }, used: true, playerId: { not: null } },
      select: { ownerTeamId: true, round: true, year: true, player: { select: { trueOvr: true } } },
    }),
  ]);

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const recordsByTeam = groupBy(records, (r) => r.teamId);
  const awardsByTeam = groupBy(awards, (a) => a.teamId);
  const picksByTeam = groupBy(picks, (p) => p.ownerTeamId ?? '');

  const out: ComputedEntry[] = [];

  for (const league of leagues) {
    const teamId = league.userTeamId;
    const team = teamId ? teamById.get(teamId) : undefined;
    // A league whose userTeamId points at nothing is a corrupt save, not a
    // zero-XP GM. Leave it off the board entirely rather than publishing a row
    // that describes a franchise that is not there.
    if (!teamId || !team || !league.userId) continue;

    // The same resolver the Dynasty screen uses, so the two decades of
    // FICTIONAL backstory a new league is seeded with are excluded here
    // exactly as they are there. Memoised per process, and a no-op for any
    // save that already has startYear set.
    const tenureStartYear = await resolveStartYear(league);

    const seasons = (recordsByTeam.get(teamId) ?? [])
      .filter((r) => r.year >= tenureStartYear)
      .map((r) => ({ year: r.year, wins: r.wins, losses: r.losses, ties: r.ties, playoffResult: r.playoffResult }));

    const hasCurrentRow = seasons.some((s) => s.year === league.seasonYear);
    const played = team.wins + team.losses;

    const breakdown = computeDynastyXp({
      seasons,
      inProgress: !hasCurrentRow && played > 0 ? { wins: team.wins, losses: team.losses } : null,
      awards: (awardsByTeam.get(teamId) ?? []).filter((a) => a.seasonYear >= tenureStartYear).length,
      picks: (picksByTeam.get(teamId) ?? [])
        .filter((p) => p.year >= tenureStartYear && p.player)
        .map((p) => ({ round: p.round, trueOvr: p.player!.trueOvr })),
    });

    out.push({
      saveKey: league.id,
      userId: league.userId,
      xp: breakdown.total,
      seasons: breakdown.seasons,
      wins: breakdown.wins,
      losses: breakdown.losses,
      championships: seasons.filter((s) => s.playoffResult === 'CHAMPION').length,
      teamName: `${team.city} ${team.nickname}`,
      teamAbbr: team.abbr,
      crestSeed: team.id,
    });
  }

  return out;
}

/**
 * Recompute every eligible football franchise and write it to DynastyRank,
 * then delete the rows that no longer belong.
 *
 * WHY THIS RUNS ON THE BOARD'S OWN RENDER rather than on a cron or a hook in
 * lib/season.ts: XP is derived from franchise history, so a stored copy can
 * only be trusted if it was derived recently enough that nothing could have
 * changed since — and the only moment that is guaranteed is the moment the
 * board is about to be read. A background job puts a window between "the save
 * changed" and "the board is right", and a window is where a lying metric
 * lives.
 */
export async function refreshFootballRanks(): Promise<RefreshResult> {
  const entries = await computeFootballEntries(eligibleLeagueWhere());

  // Read the published rows once and write back only the ones that actually
  // moved. Every franchise is RE-DERIVED on every board load — that is what
  // makes the numbers trustworthy — but a save nobody has touched derives to
  // the same figures it already has, and a page view should not cost one
  // UPDATE per listed GM to discover that. In the steady state this loop
  // writes nothing at all.
  const existing = new Map(
    (await prisma.dynastyRank.findMany({
      where: { sport: FOOTBALL },
      select: { saveKey: true, userId: true, xp: true, seasons: true, wins: true, losses: true, championships: true, teamName: true, teamAbbr: true, crestSeed: true },
    })).map((r) => [r.saveKey, r]),
  );

  let written = 0;
  for (const e of entries) {
    const { saveKey, ...data } = e;
    const prev = existing.get(saveKey);
    const unchanged = prev != null && (Object.keys(data) as (keyof typeof data)[]).every((k) => prev[k] === data[k]);
    if (unchanged) continue;
    await prisma.dynastyRank.upsert({
      where: { sport_saveKey: { sport: FOOTBALL, saveKey } },
      create: { sport: FOOTBALL, saveKey, ...data },
      update: data,
    });
    written++;
  }

  // THE SWEEP, and it is the whole answer to "what happens when a league is
  // deleted". A rank that outlives its own franchise is the board lying about
  // a dynasty that no longer exists, so instead of a delete hook on every path
  // that can remove a save — deleteLeagueAction, a cascade, an account
  // opting out, a claim being undone — there is one statement here that keeps
  // the published set equal to the eligible set. Whatever stopped being
  // eligible, for whatever reason, stops being published on the next read.
  const keptKeys = entries.map((e) => e.saveKey);
  const { count: removed } = await prisma.dynastyRank.deleteMany({
    where: { sport: FOOTBALL, saveKey: { notIn: keptKeys.length > 0 ? keptKeys : ['__none__'] } },
  });

  return { scanned: entries.length, written, removed };
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

export interface LeaderboardRow {
  rank: number;
  userId: string;
  username: string;
  sport: string;
  saveKey: string;
  /**
   * Computed HERE from `xp` by the same levelFromXp the Dynasty screen calls.
   * Never read from the database, because there is no level column to read —
   * see the schema comment on DynastyRank. If this says 22, levelFromXp(xp)
   * returned 22.
   */
  level: LevelProgress;
  xp: number;
  seasons: number;
  wins: number;
  losses: number;
  championships: number;
  /** XP per completed season, or null with no completed season to divide by. */
  xpPerSeason: number | null;
  teamName: string;
  teamAbbr: string;
  crestSeed: string;
  updatedAt: Date;
}

export interface LeaderboardView {
  sort: LeaderboardSort;
  /** The sport being shown, or null for the combined board. */
  sport: string | null;
  rows: LeaderboardRow[];
  /** Every sport with at least one published row. Drives the tabs. */
  sports: string[];
  /** Totals across the rows shown — the masthead facts. */
  totals: { gms: number; seasons: number; championships: number };
}

/**
 * Read the published board.
 *
 * `sport: null` is the COMBINED board, which is the point of the sport column:
 * one GM, their best franchise in any sport. With one sport in the table it is
 * identical to the football board, which is why the page only offers it once a
 * second sport has actually published a row — a tab implying baseball exists
 * before baseball exists is a lying metric of a different kind.
 */
export async function readLeaderboard(opts: {
  sort: LeaderboardSort;
  sport?: string | null;
}): Promise<LeaderboardView> {
  const sport = opts.sport ?? null;

  const rows = await prisma.dynastyRank.findMany({
    where: {
      ...(sport ? { sport } : {}),
      // Belt and braces with the sweep: even if a row somehow outlived an
      // opt-out, it is not readable. The board must not depend on a write
      // having happened for a privacy setting to hold.
      user: { is: { leaderboardOptIn: true } },
    },
    orderBy: { xp: 'desc' },
    take: MAX_ROWS,
    select: {
      sport: true, saveKey: true, userId: true, xp: true, seasons: true,
      wins: true, losses: true, championships: true, teamName: true,
      teamAbbr: true, crestSeed: true, updatedAt: true,
      user: { select: { username: true } },
    },
  });

  const sports = Array.from(new Set(rows.map((r) => r.sport))).sort();

  const candidates = rows.map((r) => ({
    rank: 0,
    userId: r.userId,
    username: r.user.username,
    sport: r.sport,
    saveKey: r.saveKey,
    level: levelFromXp(r.xp),
    xp: r.xp,
    seasons: r.seasons,
    wins: r.wins,
    losses: r.losses,
    championships: r.championships,
    xpPerSeason: r.seasons > 0 ? r.xp / r.seasons : null,
    teamName: r.teamName,
    teamAbbr: r.teamAbbr,
    crestSeed: r.crestSeed,
    updatedAt: r.updatedAt,
  }));

  // PER_SEASON needs a floor, or the board's top is whoever won a title in
  // their first year and stopped. Applied before the one-row-per-GM reduction
  // so a GM with one short save and one long one is represented by the long
  // one rather than dropped.
  const eligible = opts.sort === 'PER_SEASON'
    ? candidates.filter((c) => c.seasons >= PER_SEASON_MIN_SEASONS)
    : candidates;

  const ordered = eligible.sort(comparatorFor(opts.sort));

  // ONE ROW PER GM: their best save under this metric. The list is already
  // sorted, so the first row a user appears in is their best one.
  const seen = new Set<string>();
  const best: LeaderboardRow[] = [];
  for (const row of ordered) {
    if (seen.has(row.userId)) continue;
    seen.add(row.userId);
    best.push({ ...row, rank: best.length + 1 });
  }

  return {
    sort: opts.sort,
    sport,
    rows: best,
    sports,
    totals: {
      gms: best.length,
      seasons: best.reduce((a, r) => a + r.seasons, 0),
      championships: best.reduce((a, r) => a + r.championships, 0),
    },
  };
}

/**
 * The orderings, each with a full tiebreak chain so the board is stable —
 * two GMs on the same XP must not swap places between reloads, which reads as
 * the board being made up.
 */
function comparatorFor(sort: LeaderboardSort): (a: LeaderboardRow, b: LeaderboardRow) => number {
  switch (sort) {
    case 'TITLES':
      return (a, b) =>
        b.championships - a.championships ||
        b.xp - a.xp ||
        a.seasons - b.seasons ||
        a.saveKey.localeCompare(b.saveKey);
    case 'PER_SEASON':
      return (a, b) =>
        (b.xpPerSeason ?? 0) - (a.xpPerSeason ?? 0) ||
        b.championships - a.championships ||
        b.xp - a.xp ||
        a.saveKey.localeCompare(b.saveKey);
    case 'LEVEL':
    default:
      // Fewer seasons wins a tie: same XP in less simulated time is the more
      // impressive of the two, and it is the one tiebreak that pushes against
      // the grind rather than with it.
      return (a, b) =>
        b.xp - a.xp ||
        b.championships - a.championships ||
        a.seasons - b.seasons ||
        a.saveKey.localeCompare(b.saveKey);
  }
}

/**
 * The row an account WOULD post, whether or not it is published, plus where
 * that row would land on the current board.
 *
 * This is what makes the opt-in toggle an informed choice rather than a
 * shrug: /account can show somebody exactly what strangers would see about
 * them — the franchise, the level, the seasons, the position — BEFORE they
 * agree to publish it. It computes from the leagues directly rather than
 * reading DynastyRank, because an opted-out account has no rows to read.
 *
 * `rank` is null when the account is not published, because a private GM does
 * not occupy a position on a public board; the field next to it says what the
 * position WOULD be, which is a different and honest claim.
 */
export interface OwnStanding {
  /** Their best franchise by XP, or null if they have no rankable save. */
  best: LeaderboardRow | null;
  /** Their live position on the public board, or null when not published. */
  rank: number | null;
  /** Where they would land if they published right now. */
  wouldBeRank: number | null;
  /** How many of their saves are eligible to be considered. */
  eligibleSaves: number;
}

export async function ownStanding(userId: string): Promise<OwnStanding> {
  const [entries, published] = await Promise.all([
    // Their own saves, opt-in irrelevant: a preview must work while private.
    computeFootballEntries({ userId, userTeamId: { not: null } }),
    readLeaderboard({ sort: 'LEVEL', sport: FOOTBALL }),
  ]);

  if (entries.length === 0) {
    return { best: null, rank: null, wouldBeRank: null, eligibleSaves: 0 };
  }

  const rows = entries
    .map((e, i) => toRow(e, i + 1))
    .sort(comparatorFor('LEVEL'));
  const best = { ...rows[0], rank: 0 };

  const rank = published.rows.find((r) => r.userId === userId)?.rank ?? null;

  // Where this XP would slot in among the GMs already published. Counted
  // against OTHER accounts only, so an account that is already listed does not
  // count itself and read one place worse than it is.
  const ahead = published.rows.filter((r) => r.userId !== userId && comparatorFor('LEVEL')(r, best) < 0).length;

  return { best, rank, wouldBeRank: ahead + 1, eligibleSaves: entries.length };
}

/** ComputedEntry -> LeaderboardRow. The level is derived here and only here. */
function toRow(e: ComputedEntry, rank: number): LeaderboardRow {
  return {
    rank,
    userId: e.userId,
    username: '',
    sport: FOOTBALL,
    saveKey: e.saveKey,
    level: levelFromXp(e.xp),
    xp: e.xp,
    seasons: e.seasons,
    wins: e.wins,
    losses: e.losses,
    championships: e.championships,
    xpPerSeason: e.seasons > 0 ? e.xp / e.seasons : null,
    teamName: e.teamName,
    teamAbbr: e.teamAbbr,
    crestSeed: e.crestSeed,
    updatedAt: new Date(),
  };
}
