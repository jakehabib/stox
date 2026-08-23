import { prisma } from './db';
import { capForYear } from './cap';
import { capGrowthRate, parseSettings } from './settings';

/**
 * ===========================================================================
 * LEAGUE START YEAR
 * ===========================================================================
 * `capForYear(seasonYear, leagueStartYear, growthPerYear)` grows the salary
 * cap by the league's own capGrowth rate for every year elapsed since the
 * league was founded. Both of its call sites used to pass the league's
 * CURRENT season as the start year, so `elapsed` was always 0 and the ceiling was pinned at
 * CAP.BASE_CAP forever — CAP_GROWTH_PER_YEAR was dead code and a league in
 * its fifth year was playing under a first-year cap.
 *
 * League.startYear now records the founding season, but it is nullable (see
 * the schema comment: a required column cannot be pushed onto a database
 * that already has rows). So nothing reads the column directly — everything
 * goes through resolveStartYear(), which derives a value for saves that
 * predate the column and writes it back once.
 *
 * DERIVATION, in order:
 *   1. League.startYear, if already set.
 *   2. MIN(Transaction.seasonYear). createLeague() writes a week-0 "founded"
 *      transaction before it returns, and nothing in the codebase ever
 *      deletes transactions, so this is exact for every save.
 *   3. MIN(TeamSeasonRecord.year). Only written at season rollover, so it is
 *      missing for any league still in its first season — secondary only.
 *   4. League.seasonYear. A league with no transactions at all can only be
 *      brand new, where start == current.
 *
 * DELIBERATELY NOT USED:
 *   - MIN(Contract.signedYear): league generation backdates contracts by up
 *     to `years - 1` seasons (lib/gen/league.ts staggers them so deals expire
 *     on a curve), so this reads up to 4 years EARLY and would hand a
 *     brand-new league a fifth-year ceiling.
 *   - MIN(DraftPick.year): generation seeds picks at seasonYear + 1..3, so
 *     it reads a year LATE and depends on year-1 picks never being consumed.
 * ===========================================================================
 */

/** Derived values never change for a league, so one resolution per process is enough. */
const cache = new Map<string, number>();

export interface LeagueYearFields {
  id: string;
  seasonYear: number;
  startYear: number | null;
}

/**
 * The founding season of a league. Lazily derives and persists a value for
 * saves created before League.startYear existed, so an old save restored
 * months from now still gets a correct ceiling with no migration step.
 */
export async function resolveStartYear(league: LeagueYearFields): Promise<number> {
  if (league.startYear != null) return league.startYear;

  const cached = cache.get(league.id);
  if (cached != null) return cached;

  // Games are the primary signal, and this is not a stylistic preference.
  // League creation now seeds up to 24 years of FICTIONAL franchise backstory
  // — TeamSeasonRecord rows and championship/award Transactions dated decades
  // before the save begins. Those used to be the derivation inputs, so a save
  // with a null startYear would have been read as founded ~24 years early and
  // had its salary cap compounded over phantom seasons: at the 7% every league
  // grew at when this was found, 1.07^24 is more than a fivefold ceiling. A
  // Game row only exists for a season that was actually scheduled and
  // playable, so it is the one artefact backstory never produces.
  const [game, tx, rec] = await Promise.all([
    prisma.game.aggregate({ where: { leagueId: league.id }, _min: { seasonYear: true } }),
    prisma.transaction.aggregate({ where: { leagueId: league.id }, _min: { seasonYear: true } }),
    prisma.teamSeasonRecord.aggregate({ where: { leagueId: league.id }, _min: { year: true } }),
  ]);

  let derived: number;
  if (typeof game._min.seasonYear === 'number') {
    derived = game._min.seasonYear;
  } else {
    // No games at all: a save that has never been scheduled. Fall back to the
    // old inputs, which are still right for any league predating seeded
    // history, and let the clamp below catch anything absurd.
    const candidates = [tx._min.seasonYear, rec._min.year].filter((v): v is number => typeof v === 'number');
    derived = candidates.length > 0 ? Math.min(...candidates) : league.seasonYear;
  }

  // A start year in the future, or absurdly far in the past, is a corrupt
  // read — a wrong start year is worse than none, because every year of the
  // error compounds at whatever rate that league's ceiling grows at. Fall
  // back to "founded this season" (which reproduces the old
  // pinned-at-BASE_CAP behaviour) rather than inventing a ceiling.
  if (!Number.isFinite(derived) || derived > league.seasonYear || derived < league.seasonYear - 100) {
    derived = league.seasonYear;
  }

  cache.set(league.id, derived);
  await prisma.league.update({ where: { id: league.id }, data: { startYear: derived } }).catch(() => {
    /* read-only context or a concurrent writer got there first — the cache still serves this process */
  });
  return derived;
}

/** Test/maintenance hook: forget everything resolveStartYear has memoized. */
export function clearStartYearCache() {
  cache.clear();
}

/**
 * ===========================================================================
 * THE SINGLE DOOR TO A LEAGUE'S CEILING
 * ===========================================================================
 * A salary cap is two facts about one league — when it was founded, and how
 * fast its ceiling climbs — and they live in two different places (the
 * derived startYear above, and LeagueSettings.capGrowth). Every server-side
 * reader should ask for the ceiling here rather than fetching one fact,
 * remembering the other, and calling capForYear() itself: that is exactly how
 * a ceiling and a rate come to disagree, and a cap sheet that disagrees with
 * the cap the game enforces is the lying-metric bug class this project keeps
 * paying for.
 *
 * Server-side only, deliberately. It reads the database, and lib/cap.ts —
 * where the pure arithmetic lives — is imported by client components, so the
 * two cannot be one module. Same split, and the same reason, as
 * lib/capEnforcement.ts.
 */
export interface LeagueCapFields extends LeagueYearFields {
  /** The League row's settings JSON blob. */
  settings: string;
}

/**
 * The ceiling one league plays under in one season. Defaults to the season
 * the league is actually in, which is what nearly every caller wants; pass a
 * year for an outlook column or a next-year projection.
 */
export async function capForLeague(league: LeagueCapFields, seasonYear: number = league.seasonYear): Promise<number> {
  return capForYear(seasonYear, await resolveStartYear(league), capGrowthRate(parseSettings(league.settings)));
}
