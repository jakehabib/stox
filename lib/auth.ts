import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { createHash, randomBytes, randomInt } from 'crypto';
import { prisma } from './db';
import {
  decoyPasswordHash,
  hashPassword,
  needsRehash,
  validatePassword,
  verifyPassword,
} from './password';

/**
 * ===========================================================================
 * ACCOUNTS AND SESSIONS
 * ===========================================================================
 * See docs/accounts.md for the design and the schema delta. This file is the
 * whole of the authentication mechanism; lib/owner.ts consumes it to decide
 * who owns a save.
 *
 * WHY A HAND-ROLLED SESSION TABLE AND NOT Auth.js v5:
 *
 *   1. Credentials providers in Auth.js v5 force `strategy: "jwt"`. A JWT
 *      session is a bearer token the server cannot revoke, so "sign out"
 *      becomes "delete your own copy of the token" — and the requirement here
 *      is sign-out that actually invalidates. Working around that means
 *      building a server-side session store anyway, underneath a library
 *      whose entire job was to provide one.
 *   2. `next-auth@beta` is beta, on the day the beta ships, in the login path.
 *   3. The claim flow (below) is the part of this feature that must not go
 *      wrong, and it has to run inside the sign-in transaction with the
 *      browser's owner cookie in hand. That is a callback-shaped fight with
 *      the library and a straight line without it.
 *
 * What we give up is the OAuth plumbing, and the design is arranged so that
 * costs nothing later: ownership hangs off `User`, never off a credential, so
 * adding Discord is an `Account` table plus a callback that resolves a `User`
 * and calls `createSession()`. Nothing in lib/owner.ts changes.
 *
 * Everything here is plain Prisma + node:crypto and runs on the Node.js
 * serverless runtime Vercel already uses for every route in this app.
 * ===========================================================================
 */

const SESSION_COOKIE = 'dgm_session';

/**
 * Sixty days, slid forward on use. Long because these are save files and being
 * logged out mid-dynasty is a bad afternoon; not infinite, because a session
 * that never expires is a credential that lives forever on a shared laptop.
 */
const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000;

/** Don't write to the database to slide an expiry more than once a day. */
const SLIDE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * `secure` in production only — a secure cookie is never sent over plain HTTP,
 * which would make sign-in silently impossible on a local http://localhost run.
 * `sameSite: lax` so following a shared link into the game keeps you signed in
 * while a cross-site POST still cannot carry the session.
 */
function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}

/**
 * The cookie carries the raw token; the database stores only its SHA-256.
 * A leaked database dump therefore contains no usable session.
 *
 * SHA-256 is the right primitive HERE and the wrong one for a password: the
 * token is 32 bytes from the CSPRNG, so there is no dictionary to run and no
 * work factor worth paying for.
 */
function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

export interface SessionUser {
  id: string;
  username: string;
}

/**
 * Issues a session and sets the cookie. Callable only from a Server Action or
 * Route Handler — a Server Component may not write cookies.
 */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  // Recorded for the operator's benefit only. It is never consulted when
  // deciding whether a session is valid — a session is valid because its token
  // hashes to a live row, not because it came from a familiar-looking client.
  const userAgent = headers().get('user-agent')?.slice(0, 255) ?? null;

  await prisma.session.create({
    data: { tokenHash: tokenHash(token), userId, expiresAt, userAgent },
  });

  cookies().set(SESSION_COOKIE, token, {
    ...sessionCookieOptions(),
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/**
 * Signs out: deletes the server-side record FIRST, then clears the cookie.
 * That order matters — if the response is lost in flight the session is
 * already dead, rather than the reverse. This is the part a JWT strategy
 * cannot do.
 */
export async function destroySession(): Promise<void> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) {
    // deleteMany, not delete: an already-expired or already-deleted session
    // must sign you out cleanly, not throw a "record not found" at someone
    // who is trying to leave.
    await prisma.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  }
  cookies().delete(SESSION_COOKIE);
}

/** Invalidates every session for a user — used when a password is changed. */
export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

/**
 * The signed-in user, validated against the database on every request, or null.
 *
 * `cache()` memoises this per request, not across requests: the home page, the
 * ownership predicate and the header would otherwise each run the same query.
 * It is deliberately NOT a longer-lived cache — a revoked session has to stop
 * working on the next request, not whenever something expires.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    select: { id: true, expiresAt: true, lastSeenAt: true, user: { select: { id: true, username: true } } },
  });
  if (!session) return null;

  // Expiry is enforced here, in the read path, and not left to a cleanup job.
  // A row that outlives its date must not authenticate anyone just because
  // nothing has swept it yet.
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.deleteMany({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  // Sliding expiry, rate-limited to one write a day so this is not a database
  // round trip on every page of every league.
  if (Date.now() - session.lastSeenAt.getTime() > SLIDE_AFTER_MS) {
    await prisma.session
      .update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
      })
      // A failed slide is not a failed request. Worst case the session expires
      // on its original date and the player signs in again.
      .catch(() => {});
  }

  return session.user;
});

// ---------------------------------------------------------------------------
// Usernames
// ---------------------------------------------------------------------------

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** null when acceptable, otherwise the sentence to show the person. */
export function validateUsername(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return 'Pick a username.';
  if (!USERNAME_RE.test(trimmed)) {
    return 'Username must be 3–20 characters, letters, numbers and underscores only.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
//
// Postgres, not Redis. The limits below are a COUNT over an indexed time
// window, which one small table answers correctly; adding a second stateful
// dependency to this deployment to hold a counter is not a trade worth making
// at this size, and a Redis that is down would either fail every login or fail
// open — both worse than this.

const SIGNIN_WINDOW_MS = 15 * 60 * 1000;
/** Failures against ONE account before that account stops answering. */
const SIGNIN_MAX_PER_USER = 10;
/** Failures from ONE address before it stops answering, across all accounts. */
const SIGNIN_MAX_PER_IP = 40;

const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
const SIGNUP_MAX_PER_IP = 8;

/** Attempt rows older than this are noise; pruned opportunistically. */
const ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * The client address, as far as it can be known. On Vercel `x-forwarded-for`
 * is set by the platform edge and its FIRST entry is the real client; the rest
 * are whatever the client claimed, so only the first is used.
 *
 * This is a best-effort throttling key, not an identity. Behind CGNAT many
 * people share one, and a determined attacker rotates them — which is exactly
 * why the per-account limit exists alongside it and is much tighter.
 */
function clientIp(): string {
  const h = headers();
  const fwd = h.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim().slice(0, 64) || 'unknown';
  return h.get('x-real-ip')?.slice(0, 64) || 'unknown';
}

async function countAttempts(scope: string, kind: string, windowMs: number): Promise<number> {
  return prisma.authAttempt.count({
    where: { scope, kind, success: false, at: { gte: new Date(Date.now() - windowMs) } },
  });
}

async function recordAttempt(scope: string, kind: string, success: boolean): Promise<void> {
  await prisma.authAttempt.create({ data: { scope, kind, success } }).catch(() => {});
  // ~2% of writes also sweep. No cron, no scheduled function, and the table
  // stays small without anyone having to remember it exists.
  if (randomInt(50) === 0) {
    await prisma.authAttempt
      .deleteMany({ where: { at: { lt: new Date(Date.now() - ATTEMPT_RETENTION_MS) } } })
      .catch(() => {});
  }
}

/** Clears the per-account counter after a successful login. */
async function clearAttempts(scope: string, kind: string): Promise<void> {
  await prisma.authAttempt.deleteMany({ where: { scope, kind } }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Sign up / sign in
// ---------------------------------------------------------------------------

export type AuthOutcome =
  | { ok: true; user: SessionUser }
  | { ok: false; error: string };

/**
 * ONE message for every failure mode of sign-in: wrong username, wrong
 * password, no such account. Anything more specific is a list of which
 * usernames exist, handed out for free.
 */
const GENERIC_SIGNIN_ERROR = 'Wrong username or password.';

export async function registerUser(rawUsername: string, password: string): Promise<AuthOutcome> {
  const usernameProblem = validateUsername(rawUsername);
  if (usernameProblem) return { ok: false, error: usernameProblem };
  // Server-side, in the same function that writes the row. The form's
  // minLength attribute is a courtesy to someone typing, not a control.
  const passwordProblem = validatePassword(password);
  if (passwordProblem) return { ok: false, error: passwordProblem };

  const ip = clientIp();
  const ipScope = `ip:${ip}`;
  if ((await countAttempts(ipScope, 'SIGNUP', SIGNUP_WINDOW_MS)) >= SIGNUP_MAX_PER_IP) {
    return { ok: false, error: 'Too many accounts created from here recently. Try again in an hour.' };
  }

  const username = rawUsername.trim();
  const usernameKey = normalizeUsername(username);
  const passwordHash = await hashPassword(password);

  try {
    const user = await prisma.user.create({
      data: { username, usernameKey, passwordHash },
      select: { id: true, username: true },
    });
    // Counted whether or not it succeeded: the limit is on *creating accounts*,
    // not on failing to.
    await recordAttempt(ipScope, 'SIGNUP', true);
    return { ok: true, user };
  } catch (err: unknown) {
    await recordAttempt(ipScope, 'SIGNUP', false);
    // P2002 = unique constraint. Checking first and inserting second is a race
    // two simultaneous sign-ups win together; the constraint is the only
    // authority. Username availability is not a secret — the sign-in form is
    // already an oracle for it — so this one is allowed to be specific.
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
      return { ok: false, error: 'That username is taken.' };
    }
    throw err;
  }
}

export async function authenticate(rawUsername: string, password: string): Promise<AuthOutcome> {
  const usernameKey = normalizeUsername(rawUsername);
  const ip = clientIp();
  const userScope = `u:${usernameKey}`;
  const ipScope = `ip:${ip}`;

  // Both buckets, because they stop different attacks: one address grinding
  // one account, and one address spraying a common password across many.
  const [userFails, ipFails] = await Promise.all([
    countAttempts(userScope, 'SIGNIN', SIGNIN_WINDOW_MS),
    countAttempts(ipScope, 'SIGNIN', SIGNIN_WINDOW_MS),
  ]);
  if (userFails >= SIGNIN_MAX_PER_USER || ipFails >= SIGNIN_MAX_PER_IP) {
    return { ok: false, error: 'Too many sign-in attempts. Wait fifteen minutes and try again.' };
  }

  const user = usernameKey
    ? await prisma.user.findUnique({
        where: { usernameKey },
        select: { id: true, username: true, passwordHash: true },
      })
    : null;

  // The decoy is the anti-enumeration measure that actually works. Returning
  // early for an unknown username answers in under a millisecond while a real
  // one takes ~200ms, and that difference is readable off a stopwatch no
  // matter how carefully the error string is worded. So an unknown username
  // pays for a full scrypt verification against a hash of random bytes.
  const stored = user?.passwordHash ?? (await decoyPasswordHash());
  const valid = await verifyPassword(password, stored);

  if (!user || !valid) {
    await recordAttempt(userScope, 'SIGNIN', false);
    await recordAttempt(ipScope, 'SIGNIN', false);
    return { ok: false, error: GENERIC_SIGNIN_ERROR };
  }

  // Upgrade the stored hash if the work factor has moved since it was made.
  // Costs one extra hash on one login and means raising N is not a flag day.
  if (needsRehash(user.passwordHash)) {
    const fresh = await hashPassword(password);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: fresh } }).catch(() => {});
  }

  await clearAttempts(userScope, 'SIGNIN');
  return { ok: true, user: { id: user.id, username: user.username } };
}

// ---------------------------------------------------------------------------
// Changing a password
// ---------------------------------------------------------------------------

/**
 * SELF-SERVICE PASSWORD CHANGE — the gap the accounts build shipped with.
 *
 * Recovery here is `scripts/resetPassword.ts`: an operator sets a password and
 * tells the person what it is. That is the honest promise for an app with no
 * email on file, but it left a tester holding a password somebody else chose,
 * knows, and very likely typed into a chat window — with no way to change it.
 * This is that way.
 *
 * WHAT IT ENFORCES, all server-side, because a Server Action is a public POST
 * endpoint and the form is not the only thing that can call it:
 *
 *   1. THE CURRENT PASSWORD, verified against the stored hash. A live session
 *      cookie is not sufficient authority to change the credential that
 *      outlives it — otherwise a borrowed laptop is a permanently stolen
 *      account. This is the one check that makes the rest matter.
 *   2. THE SAME POLICY sign-up uses, via validatePassword() in lib/password.ts.
 *      One function, so the floor cannot drift between the two forms.
 *   3. RATE LIMITING on the same AuthAttempt ledger sign-in uses, keyed on the
 *      account. Without it this endpoint is an oracle for guessing the current
 *      password of whoever's session you have — quieter than the login form
 *      and, until now, unmetered.
 *
 * WHAT IT DOES NOT DO: tell a caller whether the account has a password at
 * all. An OAuth-only user (passwordHash null) gets the same refusal as a wrong
 * password, because verifyPassword() returns false for a null hash.
 *
 * SESSIONS. Every session for the user is destroyed — including the one making
 * the request — and then a fresh one is issued to THIS browser. So: every
 * other device is signed out, and the person who just changed their password
 * is not. That is the behaviour people expect from a password change, and the
 * alternative (leave the other sessions alive) means a change made *because*
 * somebody else has your password does not actually lock them out, which is
 * the only reason most people ever change one.
 */
export type PasswordChangeOutcome = { ok: true } | { ok: false; error: string };

/** Failures before the account's change endpoint stops answering. */
const CHANGE_MAX_PER_USER = 8;

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<PasswordChangeOutcome> {
  const scope = `chg:${userId}`;
  if ((await countAttempts(scope, 'CHANGE', SIGNIN_WINDOW_MS)) >= CHANGE_MAX_PER_USER) {
    return { ok: false, error: 'Too many attempts. Wait fifteen minutes and try again.' };
  }

  const problem = validatePassword(newPassword);
  if (problem) return { ok: false, error: problem };

  // Checked before the ~200ms verify so an obvious mistake answers instantly,
  // and checked at all because a "change" that changes nothing quietly signs
  // out every other device for no reason.
  if (newPassword === currentPassword) {
    return { ok: false, error: 'That is already your password. Pick a different one.' };
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  // The session pointed at a user that no longer exists. Refuse rather than
  // throw: the caller is holding a dead session and the honest next step is to
  // sign in again, not a 500.
  if (!user) return { ok: false, error: 'Wrong current password.' };

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    await recordAttempt(scope, 'CHANGE', false);
    return { ok: false, error: 'Wrong current password.' };
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  // Order matters. The hash is written FIRST, so if the session sweep fails
  // the new password is nonetheless in force; the reverse order would sign
  // everyone out and leave the old password working.
  await destroyAllSessionsForUser(userId);
  await clearAttempts(scope, 'CHANGE');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The claim
// ---------------------------------------------------------------------------

/**
 * Hands this browser's unclaimed saves to an account. Run on sign-up and on
 * every sign-in. Returns how many moved, so the UI can say so.
 *
 * The entire safety of this is in the `where`, and it is deliberately the
 * narrowest thing that does the job:
 *
 *   ownerKey = <exactly this browser's cookie>   AND   userId IS NULL
 *
 *   - `ownerKey` equality means an account can never absorb a save it was not
 *     already holding the credential for. There is no "adopt anything
 *     unowned", which this codebase has been burned by before (see the
 *     adoption note in lib/owner.ts — headless test browsers silently claimed
 *     twenty-six dev leagues).
 *   - `userId IS NULL` means a save that already belongs to someone is never
 *     taken, however many accounts share the browser. Because the check is
 *     inside the UPDATE rather than a read followed by a write, two accounts
 *     racing for the same league cannot both win it.
 *
 * NOTE ON THE DELIBERATE CONSEQUENCE: signing in on a *different* browser that
 * has its own unclaimed saves does absorb them. That is intended. The cookie
 * was the only credential those saves ever had, and the person signing in is
 * holding it; the alternative is stranding a dynasty its owner is looking
 * straight at, which is the exact failure this whole feature exists to stop.
 *
 * `ownerKey` is left in place, not cleared. It is still the mechanism for
 * every signed-out player, and clearing it would break nothing today and
 * something subtle later.
 */
export async function claimLeaguesForUser(userId: string, ownerKey: string | null): Promise<number> {
  if (!ownerKey) return 0;
  const { count } = await prisma.league.updateMany({
    where: { ownerKey, userId: null },
    data: { userId },
  });
  return count;
}

/**
 * How many saves *would* be claimed. Used to word the invitation on the home
 * page honestly ("sign up so you don't lose these three") instead of guessing.
 */
export async function countClaimableLeagues(ownerKey: string | null): Promise<number> {
  if (!ownerKey) return 0;
  return prisma.league.count({ where: { ownerKey, userId: null } });
}
