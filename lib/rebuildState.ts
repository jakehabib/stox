import { prisma } from './db';
import { parseSettings } from './settings';
import { resolveStartYear } from './leagueYear';
import { rebuildState, seasonsToFirstTitle, type RebuildState } from './rebuild';

/**
 * ===========================================================================
 * WHERE A SAVE STANDS IN THE REBUILD STATE MACHINE — THE SERVER'S ANSWER
 * ===========================================================================
 * lib/rebuild.ts holds the RULES and is deliberately pure: it touches no
 * database, so the create screen (a client component) can import the mode's
 * name and its pitch without dragging a Prisma client into a browser bundle.
 * This module is the half that reads.
 *
 * IT IS THE ONLY AUTHORITY ON WHETHER A SAVE IS LOCKED. Every gate — the
 * settings write, the abandon door, what the Settings screen renders — asks
 * this, and this asks the database. A request never gets a vote: the form can
 * be forged, the URL can be typed, and a server action is a public POST
 * endpoint like any other. Hiding a control is presentation; refusing the
 * write is the rule.
 * ===========================================================================
 */
export interface RebuildStanding {
  state: RebuildState;
  /** Are this save's rules frozen right now? */
  ironman: boolean;
  /** The founding season, so a caller can say "season 3 of the rebuild". */
  tenureStartYear: number;
  /** The season the first title was won in, or null. */
  firstTitleYear: number | null;
  /** Seasons taken to the first title — the leaderboard number, or null. */
  seasonsToTitle: number | null;
  /** How many seasons are on the books so far, from the tenure start. */
  seasonsPlayed: number;
  abandonedAt: Date | null;
}

export async function loadRebuildStanding(leagueId: string): Promise<RebuildStanding> {
  const league = await prisma.league.findUniqueOrThrow({
    where: { id: leagueId },
    select: {
      id: true, seasonYear: true, startYear: true, settings: true,
      userTeamId: true, rebuildAbandonedAt: true,
    },
  });
  const leagueStart = parseSettings(league.settings).leagueStart;
  const tenureStartYear = await resolveStartYear(league);

  // A save that is not a REBUILD needs no history read at all, and this is
  // called on every settings write and every render of the settings screen.
  if (leagueStart !== 'REBUILD') {
    return {
      state: 'NONE', ironman: false, tenureStartYear,
      firstTitleYear: null, seasonsToTitle: null, seasonsPlayed: 0,
      abandonedAt: league.rebuildAbandonedAt,
    };
  }

  const records = league.userTeamId
    ? await prisma.teamSeasonRecord.findMany({
      where: { teamId: league.userTeamId, year: { gte: tenureStartYear } },
      select: { year: true, playoffResult: true },
      orderBy: { year: 'asc' },
    })
    : [];

  const seasonsToTitle = seasonsToFirstTitle(records, tenureStartYear);
  const firstTitleYear = seasonsToTitle === null ? null : tenureStartYear + seasonsToTitle - 1;
  const state = rebuildState({
    leagueStart,
    rebuildAbandonedAt: league.rebuildAbandonedAt,
    hasChampionship: seasonsToTitle !== null,
  });

  return {
    state,
    ironman: state === 'LOCKED',
    tenureStartYear,
    firstTitleYear,
    seasonsToTitle,
    seasonsPlayed: records.length,
    abandonedAt: league.rebuildAbandonedAt,
  };
}
