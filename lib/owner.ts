import { cookies } from 'next/headers';
import { randomUUID } from 'crypto';
import { cache } from 'react';
import { prisma } from './db';
import { getSessionUser } from './auth';

/**
 * ===========================================================================
 * SAVE OWNERSHIP
 * ===========================================================================
 * A save is owned by an ACCOUNT once it has been claimed, and by a BROWSER
 * before that. Both mechanisms are live at once, on purpose: this is a
 * single-player game, and a wall in front of someone who wants to try it costs
 * more than it protects. Signed out, everything works exactly as it did — an
 * opaque random id in an httpOnly cookie (`dgm_owner`), stamped onto
 * `League.ownerKey` at creation. Signing up turns that cookie-owned save into
 * an account-owned one (see claimLeaguesForUser in lib/auth.ts), and from then
 * on it survives a cleared cookie and follows the person to a second device.
 *
 * Why the cookie ever existed: the home page used to list EVERY league in the
 * database and `deleteLeagueAction` deleted any id it was handed, so two
 * testers on one deployment saw each other's franchises and either could
 * destroy the other's twenty-season dynasty with one click. That is fixed by
 * the boundary below, not by the accounts on top of it.
 *
 * THE PREDICATE — `ownsLeague` is the only place this is decided, and every
 * enforcement point below routes through it or through a `where` clause that
 * mirrors it clause for clause:
 *
 *   1. A save with NO owner at all (both columns null) is a legacy row from
 *      before ownership existed. Visible in development so a developer's old
 *      saves don't vanish; invisible and undeletable in production, where an
 *      unowned save is precisely the thing nobody should be able to claim.
 *   2. A SIGNED-IN viewer is matched on the account and nothing else.
 *   3. A SIGNED-OUT viewer cannot reach a claimed save, even from the browser
 *      that created it.
 *   4. Otherwise: the cookie, as before.
 *
 * Rules 2 and 3 are strictly TIGHTER than what shipped before. Previously the
 * cookie was sufficient for any league carrying it; now, once a league belongs
 * to an account, the cookie alone is not enough. That is what makes a shared
 * browser safe in both directions: after Alice signs up on the family laptop,
 * signing out does not leave her dynasty reachable by whoever sits down next,
 * and Bob signing up cannot absorb it.
 *
 * LEGACY SAVES (both columns NULL) keep the old development-only allowance.
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

/** Who is asking. `userId` null means signed out. */
export interface Viewer {
  userId: string | null;
  username: string | null;
  ownerKey: string | null;
}

/** The rows of a league this module needs in order to decide ownership. */
export interface LeagueOwnership {
  ownerKey: string | null;
  userId: string | null;
}

/**
 * The current viewer. Memoised per request via React `cache()` — the home
 * page, the header and several ownership checks all want it and it must not be
 * several round trips. NOT cached across requests: a revoked session has to
 * stop working on the very next one.
 */
export const currentViewer = cache(async (): Promise<Viewer> => {
  const user = await getSessionUser();
  return { userId: user?.id ?? null, username: user?.username ?? null, ownerKey: readOwnerKey() };
});

/**
 * THE predicate. Everything else in this file is a way of applying it — either
 * directly, or as the Prisma `where` in ownedLeagueWhere(), which is written to
 * mirror these branches exactly so a list and a guard can never disagree.
 */
export function ownsLeague(league: LeagueOwnership, viewer: Viewer): boolean {
  // 1. Legacy row, no owner of any kind. Development only.
  if (league.userId == null && league.ownerKey == null) return adoptsUnowned();
  // 2. Signed in: the account, and only the account.
  if (viewer.userId != null) return league.userId === viewer.userId;
  // 3. Signed out: a claimed save is out of reach. Sign in to get it back.
  if (league.userId != null) return false;
  // 4. Signed out, unclaimed save: the cookie, as it has always been.
  return viewer.ownerKey != null && league.ownerKey === viewer.ownerKey;
}

/**
 * The `where` clause selecting the leagues this viewer may see. Mirrors
 * ownsLeague() branch for branch:
 *
 *   signed in  ->  userId = me            (+ fully-unowned rows in dev)
 *   signed out ->  userId IS NULL AND ownerKey = my cookie   (+ ditto)
 *
 * Note the `userId: null` on the cookie clause. Without it a signed-out
 * browser would still list a save it had already handed to an account — which
 * is the shared-laptop leak this design exists to close.
 */
export async function ownedLeagueWhere() {
  const viewer = await currentViewer();
  const clauses: { userId?: string | null; ownerKey?: string | null }[] = [];

  if (viewer.userId != null) {
    clauses.push({ userId: viewer.userId });
  } else if (viewer.ownerKey != null) {
    clauses.push({ userId: null, ownerKey: viewer.ownerKey });
  }
  if (adoptsUnowned()) clauses.push({ userId: null, ownerKey: null });

  // Neither an account nor a key nor a legacy allowance: match nothing rather
  // than everything. `OR: []` is not a "match all" in Prisma, but being
  // explicit here means a future edit can't turn an empty list into an
  // unfiltered query by accident.
  return clauses.length > 0 ? { OR: clauses } : { id: '__no_owner__' };
}

/**
 * Throws unless this viewer owns the league. Every server action that reads or
 * writes league state calls this first — a guard on the page render alone
 * protects nothing, because actions are POST endpoints anyone can hit directly
 * with a league id. Signature and behaviour on refusal are unchanged, so all
 * ~33 call sites are untouched by the accounts work; what changed is that the
 * rule it applies is stricter.
 *
 * DELIBERATELY DOES NOT ADOPT. An earlier version stamped an unowned league
 * with the caller's key on first touch, on the theory that a legacy save
 * should become someone's. It made every unowned save claimable by whoever
 * loaded it first — and in development that is not a person, it is whichever
 * headless browser or test run happened to hit the page. Twenty-six leagues in
 * the dev database were silently claimed by throwaway Playwright sessions,
 * each with its own cookie, and every one of them started returning 404 to
 * every other client including the developer's own browser.
 *
 * The claim flow is the deliberate, explicit version of that idea and it lives
 * in lib/auth.ts, where it runs once, on an action a person took, against
 * exactly the leagues that person's browser was already holding.
 */
export async function assertLeagueOwner(leagueId: string): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { ownerKey: true, userId: true },
  });
  // A missing league is reported the same way as one you don't own, on
  // purpose: "no such league" vs "not yours" tells a stranger which ids are
  // real, and there is nothing a caller can do differently either way.
  if (!league) throw new Error('League not found.');

  const viewer = await currentViewer();
  if (!ownsLeague(league, viewer)) throw new Error('This save belongs to another account.');
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

/** The saves this viewer may see, newest first, with the user's team joined. */
export async function listOwnedLeagues() {
  return prisma.league.findMany({
    where: await ownedLeagueWhere(),
    orderBy: { createdAt: 'desc' },
    include: { teams: { where: { isUser: true } } },
  });
}

/**
 * Read-only view permission, for Server Components. Same rule as
 * assertLeagueOwner but it never adopts and never mints a cookie — a Server
 * Component may not write one, and Next throws if it tries.
 *
 * Now takes the league's ownership columns rather than a bare ownerKey, and is
 * async, because deciding this requires knowing who is signed in.
 */
export async function canViewLeague(league: LeagueOwnership): Promise<boolean> {
  return ownsLeague(league, await currentViewer());
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
 *                dynasties. Counted against the ACCOUNT when there is one and
 *                the cookie otherwise; both are still UX limits rather than
 *                security controls, since anyone may sign up again.
 *
 *   GLOBAL     — the deliberate case, and the one that actually protects the
 *                database. A scripted caller rotating cookies or accounts walks
 *                straight through the per-owner cap; it cannot walk through a
 *                ceiling on the whole table. This is the backstop that keeps a
 *                bad afternoon from becoming a full database.
 *
 * Both are env-tunable so the ceiling can be raised without a redeploy of
 * logic — see docs/deployment.md.
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
 * Called with the viewer that will own the league, so the count and the stamp
 * can never disagree.
 *
 * Deliberately two cheap COUNT queries rather than a lock or a transaction.
 * Two simultaneous requests from the same browser can both pass and land one
 * league over the cap; the overshoot is bounded by concurrency and the cost of
 * preventing it (serialising every creation) is worse than the cost of being
 * off by one.
 */
export async function assertCanCreateLeague(viewer: Viewer): Promise<void> {
  const perOwner = maxLeaguesPerOwner();
  const total = maxLeaguesTotal();

  // Signed in, the account is the identity that counts — otherwise a player
  // could reset the counter by clearing a cookie they are no longer using for
  // anything, and the cap would mean nothing to exactly the people it applies
  // to. Signed out, the cookie is all there is.
  const mineWhere = viewer.userId != null
    ? { userId: viewer.userId }
    : { userId: null, ownerKey: viewer.ownerKey };

  const [mine, everyone] = await Promise.all([
    prisma.league.count({ where: mineWhere }),
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
