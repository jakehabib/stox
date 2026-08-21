import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * ===========================================================================
 * PASSWORD HASHING
 * ===========================================================================
 * scrypt from Node's own `crypto`, at N=2^16, r=8, p=1 — ~200ms and ~64MB of
 * memory per verification on this hardware, measured, not guessed.
 *
 * WHY scrypt AND NOT bcrypt OR argon2, since those were the two named:
 *
 *   - `bcryptjs` is pure JavaScript. A cost-12 bcrypt in JS is well over a
 *     second of *blocking* CPU on the single-threaded serverless function that
 *     is also serving every other request. Dropping the cost to make it
 *     tolerable is exactly the "sane cost" this was supposed to have.
 *   - native `bcrypt` and `@node-rs/argon2` are prebuilt binaries that have to
 *     match Vercel's runtime. This repo has already been bitten by precisely
 *     that class of problem — the Prisma generator carries an explicit
 *     `rhel-openssl-3.0.x` binary target because without it the deployed app
 *     failed at request time while local dev and the build both passed. Taking
 *     that risk again on the afternoon of the beta, for a dependency in the
 *     login path, is the wrong trade.
 *   - scrypt is memory-hard, is in the standard library (zero new runtime
 *     dependencies, nothing to build, nothing to pin), is native C, and is
 *     listed by OWASP as an acceptable password hash. It is emphatically not a
 *     "bare SHA": the whole point of the N parameter is that a GPU cannot
 *     parallelise it cheaply.
 *
 * The stored format is versioned and self-describing, so this is not a
 * one-way door. Moving to argon2id later means adding a branch to `verify()`
 * for the `argon2id$` prefix and re-hashing on next successful login — the
 * `needsRehash` hook below already exists for that. No migration, no lockout.
 * ===========================================================================
 */

const N = 1 << 16;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;
// 128 * N * r = 64MiB for the parameters above. Node's default maxmem is 32MiB
// and would simply throw; the headroom is deliberate, not padding.
const MAXMEM = 128 * N * R * 2;

const ALGO = 'scrypt';

/**
 * Minimum length, enforced HERE — that is, server-side, in the one function
 * every caller has to go through. The `minLength` on the input is a courtesy
 * to someone typing; a server action is a public POST endpoint and the form is
 * not the only thing that can call it.
 *
 * Ten rather than eight. This is a game account whose only recovery path is
 * "ask the operator", so the cost of a weak one is higher than usual, and
 * nobody is being asked to type it more than once a month.
 */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * A ceiling, because an unbounded password is an unbounded request body and a
 * free denial-of-service against a deliberately expensive function. Well above
 * any real passphrase.
 */
export const MAX_PASSWORD_LENGTH = 256;

/** null when acceptable, otherwise the sentence to show the person. */
export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  // Length is the only rule. Composition rules ("must contain a symbol") push
  // people toward Passw0rd! and are no longer recommended by anyone; length is
  // the thing that actually costs an attacker.
  return null;
}

/**
 * `algo$N$r$p$saltB64$hashB64`. Every parameter travels with the hash, so
 * raising N later does not invalidate a single existing password — old hashes
 * keep verifying at the N they were made with and get upgraded on next login.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return [ALGO, N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

/**
 * Constant-time compare against a stored hash. Returns false rather than
 * throwing on a malformed record: a corrupt row must read as "wrong password",
 * not as a 500 that tells a caller something interesting about the database.
 *
 * NOTHING IN HERE IS EVER LOGGED. Not the password, not the hash, not the
 * salt, not a truncated prefix of any of them.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6) return false;
  const [algo, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  if (algo !== ALGO) return false;

  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  // Bounds, not just parseability. These numbers come out of the database and
  // go straight into a memory allocation; a row saying N=2^30 is a way to make
  // one login attempt eat the whole function.
  if (!Number.isInteger(n) || n < 1024 || n > (1 << 20)) return false;
  if (!Number.isInteger(r) || r < 1 || r > 32) return false;
  if (!Number.isInteger(p) || p < 1 || p > 16) return false;

  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(hashB64, 'base64');
    const salt = Buffer.from(saltB64, 'base64');
    if (expected.length === 0 || salt.length === 0) return false;
    actual = await scrypt(password, salt, expected.length, { N: n, r, p, maxmem: 128 * n * r * 2 });
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** True when a stored hash was made with weaker parameters than we use now. */
export function needsRehash(stored: string | null): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6) return true;
  return !(parts[0] === ALGO && Number(parts[1]) >= N && Number(parts[2]) >= R);
}

/**
 * A real hash of a value nobody knows, used to spend the same ~200ms verifying
 * a password for a username that does not exist as for one that does.
 *
 * Without this, "no such user" returns in under a millisecond and "wrong
 * password" returns in 200 — which is a username oracle any script can read
 * off the clock, no matter how carefully the error text is worded. Built once
 * per process, lazily, so it costs nothing until the first failed login.
 */
let decoyHash: Promise<string> | null = null;
export function decoyPasswordHash(): Promise<string> {
  if (!decoyHash) decoyHash = hashPassword(randomBytes(32).toString('base64'));
  return decoyHash;
}
