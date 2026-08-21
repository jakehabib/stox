import { cookies } from 'next/headers';
import { randomUUID } from 'crypto';
import { prisma } from './db';

/**
 * ===========================================================================
 * SAVE OWNERSHIP
 * ===========================================================================
 * There is no sign-in, and for a single-player game there shouldn't have to
 * be. But the moment this is served to more than one browser, "no sign-in"
 * and "no owner" stop being the same thing: the home page listed EVERY
 * league in the database, and `deleteLeagueAction` deleted any id it was
 * handed. Two testers on the same deployment saw each other's franchises,
 * and either could destroy the other's twenty-season dynasty with one click.
 *
 * The fix is a per-browser owner key: an opaque random id in an httpOnly
 * cookie, stamped onto a league when it is created. It is not authentication
 * — anyone holding the cookie value is the owner, and clearing cookies loses
 * the saves — but it is the correct boundary for a game with no accounts,
 * and it is the piece that has to exist before this is served publicly.
 *
 * LEGACY SAVES (ownerKey IS NULL) — leagues created before this column
 * existed. In development they stay visible and are adopted by the first
 * browser to open them, so a developer's existing saves don't vanish. In
 * production they are invisible and undeletable: on a shared deployment an
 * unowned save is precisely the thing nobody should be able to claim.
 * ===========================================================================
 */

const COOKIE = 'dgm_owner';
/** Ten years. These are save files; an expiring cookie is a deleted dynasty. */
const MAX_AGE = 60 * 60 * 24 * 365 * 10;

/** Unowned saves are only reachable off a production deployment. */
export function adoptsUnowned(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/**
 * This browser's owner key, or null if it has never been given one.
 * Read-only: safe from a Server Component, which cannot set cookies.
 */
export function readOwnerKey(): string | null {
  return cookies().get(COOKIE)?.value ?? null;
}

/**
 * This browser's owner key, minting and setting one if absent. Only callable
 * from a Server Action or Route Handler — Next throws if a Server Component
 * tries to write a cookie, which is why the read path above is separate.
 */
export function ensureOwnerKey(): string {
  const jar = cookies();
  const existing = jar.get(COOKIE)?.value;
  if (existing) return existing;
  const key = randomUUID();
  jar.set(COOKIE, key, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: MAX_AGE });
  return key;
}

/** The `where` clause selecting the leagues this browser may see. */
export function ownedLeagueWhere() {
  const key = readOwnerKey();
  const mine = key ? [{ ownerKey: key }] : [];
  const unowned = adoptsUnowned() ? [{ ownerKey: null }] : [];
  const clauses = [...mine, ...unowned];
  // No key and no legacy allowance: match nothing rather than everything.
  // `OR: []` is not a "match all" in Prisma, but being explicit here means a
  // future edit can't turn an empty list into an unfiltered query by accident.
  return clauses.length > 0 ? { OR: clauses } : { id: '__no_owner__' };
}

/**
 * Throws unless this browser owns the league. Every server action that reads
 * or writes league state calls this first — a guard on the page render alone
 * protects nothing, because actions are POST endpoints anyone can hit
 * directly with a league id.
 *
 * DELIBERATELY DOES NOT ADOPT. An earlier version stamped an unowned league
 * with the caller's key on first touch, on the theory that a legacy save
 * should become someone's. It made every unowned save claimable by whoever
 * loaded it first — and in development that is not a person, it is whichever
 * headless browser or test run happened to hit the page. Twenty-six leagues
 * in the dev database were silently claimed by throwaway Playwright sessions,
 * each with its own cookie, and every one of them started returning 404 to
 * every other client including the developer's own browser.
 *
 * Adoption bought nothing anyway: ownedLeagueWhere() already lists unowned
 * saves in development, and in production they are meant to stay invisible.
 * So an unowned league is simply allowed in development and refused in
 * production, and nothing writes an owner key except league creation.
 */
export async function assertLeagueOwner(leagueId: string): Promise<void> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { ownerKey: true } });
  // A missing league is reported the same way as one you don't own, on
  // purpose: "no such league" vs "not yours" tells a stranger which ids are
  // real, and there is nothing a caller can do differently either way.
  if (!league) throw new Error('League not found.');

  if (league.ownerKey == null) {
    if (!adoptsUnowned()) throw new Error('This save belongs to another browser.');
    return;
  }
  if (league.ownerKey !== readOwnerKey()) throw new Error('This save belongs to another browser.');
}

/**
 * Same guard for the three depth-chart/scheme actions, which are addressed by
 * team rather than by league. Resolves the team's league and defers.
 */
export async function assertTeamOwner(teamId: string): Promise<void> {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { leagueId: true } });
  if (!team) throw new Error('League not found.');
  await assertLeagueOwner(team.leagueId);
}

/** The saves this browser may see, newest first, with the user's team joined. */
export async function listOwnedLeagues() {
  return prisma.league.findMany({
    where: ownedLeagueWhere(),
    orderBy: { createdAt: 'desc' },
    include: { teams: { where: { isUser: true } } },
  });
}

/**
 * Read-only view permission, for Server Components. Same rule as
 * assertLeagueOwner but it never adopts and never mints a cookie — a Server
 * Component may not write one, and Next throws if it tries.
 */
export function canViewLeague(ownerKey: string | null): boolean {
  if (ownerKey == null) return adoptsUnowned();
  return ownerKey === readOwnerKey();
}

/**
 * ===========================================================================
 * CREATION LIMITS
 * ===========================================================================
 * Creating one league writes ~5,300 rows across 32 teams, ~1,500 players,
 * their contracts, a full schedule and a scouting report per player (measured,
 * not estimated: 236 database round trips). Nothing stopped a browser from
 * doing that on a loop. On a free-tier Postgres that is the entire row quota
 * spent by one bored tester leaning on the Create button, and the saves it
 * leaves behind cannot be reclaimed by anyone.
 *
 * Two ceilings, because they stop different things:
 *
 *   PER-OWNER  — the honest case. Someone clicks Create ten times because the
 *                first one felt slow. They get a clear refusal instead of ten
 *                dynasties. This is a UX limit, not a security control: the
 *                owner key lives in a cookie, so clearing cookies resets it.
 *
 *   GLOBAL     — the deliberate case, and the one that actually protects the
 *                database. A scripted caller rotating cookies walks straight
 *                through the per-owner cap; it cannot walk through a ceiling
 *                on the whole table. This is the backstop that keeps a bad
 *                afternoon from becoming a full database.
 *
 * Both are env-tunable so the ceiling can be raised without a redeploy of
 * logic — see docs/deployment.md. Neither is a substitute for authentication,
 * and this file has never claimed to be one.
 * ===========================================================================
 */

const DEFAULT_MAX_LEAGUES_PER_OWNER = 8;
const DEFAULT_MAX_LEAGUES_TOTAL = 500;

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  // A malformed limit must not silently become 0 (nobody can play) or NaN
  // (every comparison false, no limit at all). Fall back and keep going.
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function maxLeaguesPerOwner(): number {
  return positiveIntEnv('MAX_LEAGUES_PER_OWNER', DEFAULT_MAX_LEAGUES_PER_OWNER);
}

export function maxLeaguesTotal(): number {
  return positiveIntEnv('MAX_LEAGUES_TOTAL', DEFAULT_MAX_LEAGUES_TOTAL);
}

/**
 * Thrown when a creation limit is hit. A distinct class so a caller can tell
 * "you already have enough saves" apart from "the database fell over" — they
 * want very different words on screen.
 *
 * NOTE: Next redacts Server Action error messages in production builds and
 * replaces them with a generic string plus a digest. This message therefore
 * reads correctly in development and is NOT shown to a production user as
 * written; see the handoff in docs/deployment.md for the small client change
 * that surfaces it properly.
 */
export class LeagueLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeagueLimitError';
  }
}

/**
 * Refuses league creation before any of the expensive generation work starts.
 * Called with the key that will own the league, so the count and the stamp
 * can never disagree.
 *
 * Deliberately two cheap COUNT queries rather than a lock or a transaction.
 * Two simultaneous requests from the same browser can both pass and land one
 * league over the cap; the overshoot is bounded by concurrency and the cost
 * of preventing it (serialising every creation) is worse than the cost of
 * being off by one.
 */
export async function assertCanCreateLeague(ownerKey: string): Promise<void> {
  const perOwner = maxLeaguesPerOwner();
  const total = maxLeaguesTotal();

  const [mine, everyone] = await Promise.all([
    prisma.league.count({ where: { ownerKey } }),
    prisma.league.count(),
  ]);

  if (mine >= perOwner) {
    throw new LeagueLimitError(
      `You already have ${mine} saved leagues, which is the limit (${perOwner}). ` +
        'Delete one from the home page to start another.',
    );
  }
  if (everyone >= total) {
    throw new LeagueLimitError(
      'This deployment has reached its total league limit and cannot create new saves right now. ' +
        'Existing saves are unaffected.',
    );
  }
}
