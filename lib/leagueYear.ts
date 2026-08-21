import { prisma } from './db';

/**
 * ===========================================================================
 * LEAGUE START YEAR
 * ===========================================================================
 * `capForYear(seasonYear, leagueStartYear)` grows the salary cap by
 * CAP.CAP_GROWTH_PER_YEAR for every year elapsed since the league was
 * founded. Both of its call sites used to pass the league's CURRENT season
 * as the start year, so `elapsed` was always 0 and the ceiling was pinned at
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

  const [tx, rec] = await Promise.all([
    prisma.transaction.aggregate({ where: { leagueId: league.id }, _min: { seasonYear: true } }),
    prisma.teamSeasonRecord.aggregate({ where: { leagueId: league.id }, _min: { year: true } }),
  ]);

  const candidates = [tx._min.seasonYear, rec._min.year].filter((v): v is number => typeof v === 'number');
  let derived = candidates.length > 0 ? Math.min(...candidates) : league.seasonYear;

  // A start year in the future, or absurdly far in the past, is a corrupt
  // read — a wrong start year is worse than none, because it compounds at
  // 7%/yr. Fall back to "founded this season" (which reproduces the old
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
