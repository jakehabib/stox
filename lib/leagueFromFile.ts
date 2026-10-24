/**
 * ===========================================================================
 * A VALIDATED LEAGUE FILE -> A PLAYABLE SAVE
 * ===========================================================================
 *
 * The step between "this file is legal" (lib/leagueFile.ts, which is pure and
 * writes nothing) and "here is a league id". It is the same sequence
 * /api/league/import performs on an upload, lifted out so the redeem route
 * does not carry a second copy of the part that is easy to get wrong: the
 * cleanup.
 *
 * PARTIAL FAILURE IS THE WHOLE REASON THIS IS A FUNCTION. `createLeague` is
 * ~236 round trips and is not transactional; a timeout part way through leaves
 * a half-written league that lists on the home page and breaks when opened.
 * Wrapping it in one interactive transaction trades a rare broken save for a
 * routinely-exceeded transaction timeout on a small Postgres and leaves the
 * same debris when the transaction itself gives up. So the league id is caught
 * the moment the League row exists and any throw below deletes it — every
 * dependent table cascades from League, so one delete removes the whole
 * partial save. The cleanup is best-effort and logged if it fails, because a
 * failed cleanup must not replace the real error with a second one.
 * ===========================================================================
 */
import { prisma } from './db';
import { Rng } from './rng';
import { createLeague } from './gen/league';
import { DEFAULT_SETTINGS } from './settings';
import { Viewer } from './owner';
import { FILE_LIMITS, LeagueFile, estimateWriteCost, planFromLeagueFile, sanitiseDisplayName } from './leagueFile';

/**
 * Which of the file's own franchises the player is taking.
 *
 * An unknown abbreviation is NOT worth refusing an import over — createLeague
 * already falls back to the first team and flags it properly — but resolving
 * it here means the fallback is a team from THIS file rather than from the
 * default league.
 */
export function resolveUserTeamAbbr(file: LeagueFile, wanted: unknown): string {
  const want = (typeof wanted === 'string' ? wanted : '').trim().toUpperCase();
  return file.teams.some((t) => t.abbr === want) ? want : file.teams[0].abbr;
}

/**
 * The league's name: the one the player typed, held to the same rules as a
 * name that came out of the file (it is rendered by the same components in the
 * same places), or the file's own.
 */
export function resolveLeagueName(file: LeagueFile, typed: unknown): string {
  return sanitiseDisplayName(typed, FILE_LIMITS.MAX_LEAGUE_NAME) ?? file.name;
}

/**
 * Builds the save. Throws whatever createLeague throws, having first removed
 * anything it managed to write.
 *
 * The caller is responsible for every check that comes before this: who is
 * asking, whether they may create a league at all, and whether they are inside
 * their hourly ceiling. This function spends no budget and refuses nobody — it
 * is the expensive part, and it runs only once a caller has earned it.
 */
export async function createLeagueFromFile(args: {
  file: LeagueFile;
  name: string;
  userTeamAbbr: string;
  viewer: Viewer;
  ownerKey: string;
  /** Appears in the log line, so one can tell an upload from a redemption. */
  source: string;
}): Promise<string> {
  const cost = estimateWriteCost(args.file);
  const seed = `${args.source}-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const plan = planFromLeagueFile(args.file, new Rng(seed));

  let createdId: string | null = null;
  try {
    const leagueId = await createLeague({
      name: args.name,
      userTeamAbbr: args.userTeamAbbr,
      seed,
      // A file always starts with the rosters the plan produced. A fantasy
      // draft would be drafting players who already have teams.
      settings: { ...DEFAULT_SETTINGS, leagueStart: 'RANDOM_ROSTERS' },
      plan,
      onLeagueCreated: (id) => { createdId = id; },
    });
    await prisma.league.update({
      where: { id: leagueId },
      data: { ownerKey: args.ownerKey, userId: args.viewer.userId },
    });
    console.info(`League ${args.source}: ${cost.teams} teams, ${cost.players} players -> ${leagueId}`);
    return leagueId;
  } catch (err) {
    if (createdId) {
      try {
        await prisma.league.delete({ where: { id: createdId } });
        console.warn(`League ${args.source} failed; deleted the partial league ${createdId}.`);
      } catch (cleanupErr) {
        console.error(`League ${args.source} failed AND its partial league ${createdId} could not be deleted.`, cleanupErr);
      }
    }
    throw err;
  }
}
