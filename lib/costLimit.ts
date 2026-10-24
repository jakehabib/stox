import { createHash } from 'crypto';
import { headers } from 'next/headers';
import { prisma } from './db';
import { currentViewer, Viewer } from './owner';

/**
 * ===========================================================================
 * WHAT ONE ACCOUNT MAY SPEND, PER HOUR
 * ===========================================================================
 * The locks already in this codebase stop two of something happening AT ONCE.
 * `League.advanceStartedAt` (lib/season.ts) and `DraftState.runStartedAt`
 * (app/actions/draft.ts) are both compare-and-set leases, and both of them are
 * perfectly happy to be taken four thousand times in a row by one caller
 * waiting politely for each release. Concurrency and repetition are different
 * attacks and only the first one was closed.
 *
 * REPETITION IS A BILL, NOT AN OUTAGE. This deployment is serverless and
 * metered by wall-clock, and the database is metered by row and by byte, so a
 * loop against an expensive endpoint does not take the site down — it spends
 * the owner's money and goes on spending it. Measured on this app, against a
 * local Postgres (the numbers over a network pooler are strictly worse):
 *
 *   advanceWeek          231 Prisma round trips, 331 ms      per in-season week
 *   createLeague         143 round trips, 1,676 ms, ~5,300 rows, ~20 MB on disk
 *   exportLeagueFile       3 round trips, 60 ms, 0.75 MB of response body on a
 *                          first-season league and more every season played
 *   runDraftChunk        one AI selection at a time, bounded per call but not
 *                          per hour
 *
 * The ceilings below are therefore in units of CALLS PER HOUR, counted twice:
 *
 *   PER OWNER — the account when there is one, the `dgm_owner` cookie
 *               otherwise. Catches the honest runaway (a held-down button, a
 *               wedged client loop) and the lazy attacker.
 *   PER IP    — the backstop for the same attacker rotating cookies or
 *               accounts, which walks straight through a per-owner count.
 *               Deliberately looser, because a household or a campus NAT is
 *               one address and several real players.
 *
 * STORAGE, NOT JUST TIME. `assertCanCreateLeague` in lib/owner.ts caps how
 * many saves may EXIST (8 per owner, 500 per deployment). That is a stock
 * limit and it does not bound a create/delete/create loop at all: each turn of
 * that loop writes ~5,300 rows and leaves the count where it started. The
 * CREATE ceiling here is the flow limit that stock cap was missing.
 *
 * WHERE THE COUNTER LIVES. `AuthAttempt`, the table lib/auth.ts already counts
 * sign-ins and sign-ups in — same shape (scope, kind, timestamp), same
 * `@@index([scope, kind, at])`, same opportunistic 24-hour sweep, and no
 * second stateful dependency in this deployment. The `kind` values here are
 * distinct from SIGNIN/SIGNUP, so neither module's counts or sweeps can see
 * the other's rows. The long argument for Postgres over Redis is written out
 * above SIGNIN_WINDOW_MS in lib/auth.ts and is not repeated here.
 *
 * WHY THE NUMBERS ARE WHERE THEY ARE — measured, not guessed. One full league
 * year from PRESEASON to the next PRESEASON takes 28 `advanceWeekAction`
 * calls (17 regular weeks, 4 playoff rounds, 1 offseason step, 2 re-sign, 3
 * free agency, 1 into the draft), and one press of "Advance to the offseason"
 * can legitimately fire up to MAX_ITERATIONS = 60 of them in a row from
 * components/AdvanceWeekButton.tsx. A player going flat out at a second a week
 * manages six or seven league years in an hour, which is under 200 calls. The
 * ADVANCE ceiling is three times that, so it is not reachable by anybody
 * playing — and it still holds a single account to roughly ten minutes of
 * database time an hour instead of sixty.
 * ===========================================================================
 */

export type CostKind =
  | 'ADVANCE' | 'CREATE' | 'EXPORT' | 'DRAFT_RUN' | 'CSV_CONVERT' | 'VALIDATE'
  | 'PUBLISH' | 'CODE_LOOKUP';

interface Ceiling {
  /** Rolling window the calls are counted over. */
  windowMs: number;
  perOwner: number;
  perIp: number;
  /** Shown to the player. Front office, not system diagnostics. */
  refusal: string;
  /**
   * Whether a caller with NEITHER an account NOR an owner cookie is counted in
   * the shared `own:anonymous` bucket. True everywhere it is not stated,
   * which is the stricter answer and the right one for every endpoint a
   * player reaches after they already have a save.
   *
   * CODE_LOOKUP sets it false, and that is not a loosening for its own sake.
   * Redeeming a share code is the one path in this app designed to be walked
   * by somebody who has never been here — no account, no cookie, nothing —
   * and `ownerScope` files every one of those callers under one key. At a
   * ceiling of 40 an hour, the forty-first stranger to open a code would be
   * refused because of the first forty, which turns the limit into a lockout
   * on exactly the audience the feature exists for. Their requests are still
   * counted per address, which is the bucket that actually bounds a guesser.
   */
  countsAnonymousOwner?: boolean;
}

const HOUR = 60 * 60 * 1000;

const CEILINGS: Record<CostKind, Ceiling> = {
  ADVANCE: {
    windowMs: HOUR,
    perOwner: 600,
    perIp: 1500,
    refusal:
      'This franchise has run further through the calendar this hour than the league office will stamp. '
      + 'The schedule is still there — come back to it shortly.',
  },
  CREATE: {
    // Eight saves is the ceiling on how many may EXIST (lib/owner.ts); twelve
    // foundings an hour is the ceiling on how fast they may be churned. A
    // player who deletes a save and starts over four times in an hour is
    // nowhere near it; a create/delete loop hits it on the thirteenth pass.
    windowMs: HOUR,
    perOwner: 12,
    perIp: 24,
    refusal:
      'The league has expanded as far as it will this hour. Your existing franchises are untouched.',
  },
  EXPORT: {
    // A save file is something a person downloads when they want a backup or
    // want to hand the league to someone else — a handful of times a day, not
    // a stream. Sixty an hour leaves room for a retried download on a bad
    // connection and still caps one account's egress.
    windowMs: HOUR,
    perOwner: 60,
    perIp: 150,
    refusal: 'The records office has cut you enough copies of this league for now.',
  },
  CSV_CONVERT: {
    // POST /api/league/csv buffers a multipart upload of up to FILE_LIMITS
    // .MAX_BYTES and runs the whole CSV parse plus parseLeagueFile over it.
    // It WRITES NOTHING — no league, no rows — so it is priced like the other
    // file-cutting endpoint rather than like a founding, and nowhere near
    // CREATE's twelve: an author iterating on a 1,700-row spreadsheet
    // converts it a dozen times in an afternoon and must not be stopped by
    // the thing that exists to stop a loop. Measured, one full-league
    // conversion is 36ms of CPU and zero round trips, so sixty an hour is
    // about two seconds of work; the ceiling is here for the 8MB of buffering
    // each one costs, not the parse.
    windowMs: HOUR,
    perOwner: 60,
    perIp: 150,
    refusal:
      'The records office has converted enough spreadsheets for you this hour. Your files are untouched — '
      + 'come back to them shortly.',
  },
  VALIDATE: {
    // POST /api/league/validate is the cheapest of the three file endpoints
    // and the most often called: it reads a league file or a CSV bundle,
    // runs the REAL parseLeagueFile over it, and answers with the refusal or
    // with what the file would produce. It writes nothing — no league, no
    // rows, not even a download to cut — so the only cost is up to
    // FILE_LIMITS.MAX_BYTES of buffering plus a parse measured at ~36ms of
    // CPU and zero round trips. Metered anyway, because an unauthenticated
    // endpoint that buffers 8MB is worth a loop to somebody whatever it
    // answers, and because the two counter rows are the only thing here that
    // touches the database at all.
    //
    // TWICE CSV_CONVERT's ceiling, deliberately. Checking a file is the loop
    // the whole authoring path exists to serve — an author fixing a 1,700-row
    // spreadsheet one refusal at a time checks far more often than they
    // convert, and the thing that exists to stop a runaway must not be the
    // thing that stops them iterating. It is still a ceiling: 120 an hour is
    // one check every thirty seconds, sustained, for an hour.
    windowMs: HOUR,
    perOwner: 120,
    perIp: 300,
    refusal:
      'The records office has checked enough files for you this hour. Nothing you have uploaded was saved or '
      + 'changed — come back to it shortly.',
  },
  PUBLISH: {
    // Publishing cuts a full export (the EXPORT read, ~0.75MB serialised),
    // gzips it and writes it to a row this deployment then stores. An account
    // is required, so a publisher is attributable, and the number of files one
    // account may be HOLDING is capped separately in lib/publication.ts —
    // that is the stock limit. This is the flow limit beside it, and it is the
    // one that bounds a publish/delete/publish loop, which leaves the stock
    // count where it started while writing a megabyte every turn.
    //
    // Twelve an hour, the same as founding a league, because it costs about
    // the same and is wanted about as often: somebody sharing a league they
    // have been building publishes it once, re-publishes it when they change
    // their mind about a roster, and is nowhere near twelve.
    windowMs: HOUR,
    perOwner: 12,
    perIp: 24,
    refusal:
      'The records office has filed enough leagues for you this hour. The codes you already have still work.',
  },
  CODE_LOOKUP: {
    // THE BRUTE-FORCE CEILING. A code is 50 bits (lib/shareCode.ts) and it is
    // the only thing standing between a stranger and a published league, so
    // the rate at which codes may be TRIED is part of that security argument
    // rather than a cost control. Everything else here meters work; this
    // meters guesses.
    //
    // 40 per owner and 120 per address an hour. A legitimate redemption spends
    // two — the page that shows what the code contains, and the request that
    // starts the league — so 40 is twenty redemptions an hour by one person,
    // which nobody does by hand. For a guesser, 120 an hour is about a million
    // tries a year from one address; against a million published codes that is
    // a one-in-a-billion chance of landing on any of them, and the per-address
    // bucket is the one that holds because the owner bucket can be reset by
    // clearing a cookie.
    //
    // A REFUSAL HERE MUST NOT BE AN ORACLE. It is returned for a well-formed
    // code and a malformed one alike, before either is looked up, so an
    // attacker cannot learn from the shape of the answer which guesses were
    // even eligible for a lookup.
    windowMs: HOUR,
    perOwner: 40,
    perIp: 120,
    countsAnonymousOwner: false,
    refusal:
      'The records office has pulled enough files for you this hour. Codes keep — come back to this one shortly.',
  },
  DRAFT_RUN: {
    // One chunk is a few AI selections. A whole seven-round board run down in
    // chunks is a few hundred calls across a season, and LiveDraftTicker asks
    // for the next chunk the instant the last one lands.
    windowMs: HOUR,
    perOwner: 900,
    perIp: 2000,
    refusal: 'The war room has been run down enough times this hour. The board keeps.',
  },
};

/**
 * Thrown when an hourly ceiling is reached. A distinct class for the same
 * reason `LeagueLimitError` is one: "you have asked for this enough times" and
 * "the database fell over" want different words on screen and different
 * severities in the log. Route handlers answer it 429.
 *
 * NOTE, and it is the same note LeagueLimitError carries: Next redacts Server
 * Action error messages in production builds. The sentence below reads
 * correctly in development and through a Route Handler; a Server Action that
 * wants to show it to a production user has to return it as data rather than
 * throw it. `advanceWeekAction` does exactly that.
 */
export class CostLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CostLimitError';
  }
}

/**
 * The client address, as far as it can be known — the same derivation
 * lib/auth.ts uses for its sign-in throttle, and the same caveat applies: this
 * is a throttling key, not an identity. On Vercel the FIRST entry of
 * `x-forwarded-for` is set by the platform edge and the rest are whatever the
 * client claimed, so only the first is read.
 *
 * NULL WHEN THERE IS NO FORWARDING HEADER AT ALL, and the per-address bucket
 * is then skipped rather than filled under a shared "unknown" key. lib/auth.ts
 * uses the literal "unknown" there, which is right for its purpose — a
 * sign-in throttle that fails closed is a sign-in throttle — and wrong for
 * this one. Measured: a run of the local verification scripts put 17 CREATE
 * calls into `ip:unknown`, and at 24 the next caller on that machine, any
 * caller, is refused a league it is nowhere near the ceiling for. One shared
 * bucket over every request that arrives without a proxy in front of it is a
 * lockout waiting to happen, not a limit.
 *
 * It costs nothing in production: the platform edge sets `x-forwarded-for` on
 * every request and a client cannot suppress it, so this branch is only
 * reachable off-platform — a local `next dev`, a script, or a self-hosted run
 * with no reverse proxy. The per-OWNER bucket still applies on all of them.
 * A self-hosted deployment with nothing in front of it therefore has no
 * per-address ceiling, which is a deployment note rather than a code one; see
 * docs/deployment.md for what has to be in front of this app.
 */
function clientIp(): string | null {
  const h = headers();
  const fwd = h.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0].trim().slice(0, 64);
    if (first) return first;
  }
  const real = h.get('x-real-ip')?.trim().slice(0, 64);
  return real && real.length > 0 ? real : null;
}

/**
 * The bucket this caller's calls are counted in. The ACCOUNT when there is
 * one, so clearing a cookie does not reset the counter for exactly the people
 * it applies to; the cookie otherwise. Same precedence as
 * `assertCanCreateLeague`, deliberately — a caller must not be able to pick
 * whichever of the two is emptier.
 *
 * A caller with neither is still counted, under one shared key. That is
 * stricter than letting them through unmetered, and it is only reachable by a
 * request that carries no cookie at all, which no browser playing the game
 * ever sends twice.
 */
function ownerScope(viewer: Viewer): string {
  if (viewer.userId != null) return `own:u:${viewer.userId}`;
  if (viewer.ownerKey != null) return `own:k:${viewer.ownerKey}`;
  return 'own:anonymous';
}

/**
 * A scope, in a form that is safe to write into a log: the bucket KIND in
 * clear, the identity as the first 12 hex of its SHA-256. See the note at the
 * call site for why the raw value may not be logged.
 */
function bucketLabel(scope: string): string {
  const cut = scope.lastIndexOf(':');
  const kind = scope.slice(0, cut);
  const id = scope.slice(cut + 1);
  return `${kind}:${createHash('sha256').update(id).digest('hex').slice(0, 12)}`;
}

/**
 * COUNT AND WRITE AS ONE STEP, OR THE CEILING IS NOT A CEILING.
 *
 * The first version of this read the counts and then wrote the rows, with no
 * lock, on the same reasoning `assertCanCreateLeague` gives about being off by
 * one under concurrency. Measured, that reasoning is wrong HERE, because this
 * is the only thing standing in front of the expensive endpoints and a caller
 * chooses its own concurrency. Fired at an owner bucket one call short of a
 * 60-call ceiling:
 *
 *   1 simultaneous call  ->  1 allowed   (exact)
 *   8 simultaneous calls ->  7 allowed
 *  32 simultaneous calls -> 32 allowed   (every single one)
 *
 * Every caller read the same count, every caller found it under the limit.
 * The ceiling was not "off by one", it was "multiply by however many requests
 * you send at once" — and a serverless host will happily run thirty-two of
 * them in parallel. So the whole check is one transaction holding a Postgres
 * ADVISORY LOCK per bucket:
 *
 *   - `pg_advisory_xact_lock`, not the session-scoped `pg_advisory_lock`. A
 *     transaction-scoped lock is released by COMMIT or ROLLBACK, so a request
 *     that dies mid-check cannot hold a bucket shut, and it is the only one of
 *     the two that is correct behind a transaction-mode pooler, which is what
 *     this deployment runs (see DIRECT_URL in .env.example).
 *   - Locks are taken in SORTED order. One call locks two buckets (the owner's
 *     and the address's), two callers can share one of them and not the other,
 *     and a consistent order is what stops that being a deadlock.
 *   - The locks are per BUCKET, so two different players never wait on each
 *     other. The only caller this serialises is one hammering its own bucket,
 *     which is exactly the caller it is for.
 *   - A refusal THROWS out of the transaction, which rolls it back, so a call
 *     refused by the second bucket does not leave a row counted against the
 *     first.
 *
 * ~7 round trips against the 231 one week advance already costs: 3%.
 */
async function takeBudget(
  buckets: { scope: string; limit: number }[],
  kind: CostKind,
  windowMs: number,
  refusal: string,
): Promise<void> {
  const ordered = [...buckets].sort((a, b) => (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0));
  const since = new Date(Date.now() - windowMs);

  await prisma.$transaction(async (tx) => {
    for (const b of ordered) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${b.scope}|${kind}`}, 0))`;
    }
    for (const b of ordered) {
      const count = await tx.authAttempt.count({ where: { scope: b.scope, kind, at: { gte: since } } });
      if (count >= b.limit) {
        // Server-side only, and the bucket goes in HASHED. An hourly ceiling
        // being reached is information the owner wants in the log; the identity
        // that reached it is not. `own:k:<ownerKey>` carries the raw value of
        // the httpOnly `dgm_owner` cookie, which is what proves a signed-out
        // browser owns a save — writing it into a log would put a working
        // credential there, where it is read by anyone with log access and kept
        // for as long as the platform keeps logs. The digest is still stable
        // enough to tell "one caller, four hundred times" from "four hundred
        // callers once", which is the only thing the log is for.
        //
        // Not an error, so it is a warn.
        console.warn(`Cost ceiling reached: kind=${kind} bucket=${bucketLabel(b.scope)} count=${count} limit=${b.limit}`);
        // Rolls the transaction back, so nothing above has been counted.
        throw new CostLimitError(refusal);
      }
    }
    // One row per bucket: the owner row and the address row are separate
    // scopes, so both are written. `success` is not read by anything here —
    // the column exists for lib/auth.ts, which filters on it — so these rows
    // are written true and counted regardless of it.
    await tx.authAttempt.createMany({
      data: ordered.map((b) => ({ scope: b.scope, kind, success: true })),
    });
  });
}

/**
 * Refuses an expensive call that is over its hourly ceiling, and otherwise
 * records that it happened.
 *
 * COUNTED ON ENTRY, NOT ON SUCCESS. A call that gets part way through an
 * advance and throws has already spent the round trips, so it has to count —
 * otherwise the cheapest way through this gate is to make every call fail.
 *
 * Transactional and per-bucket locked, so the ceiling is EXACT however many
 * requests a caller sends at once — see takeBudget, and the measurement of
 * what it was before.
 */
export async function assertCostBudget(kind: CostKind, viewer?: Viewer): Promise<void> {
  const ceiling = CEILINGS[kind];
  const who = viewer ?? (await currentViewer());
  const ip = clientIp();
  const buckets: { scope: string; limit: number }[] = [];
  const scope = ownerScope(who);
  // See `countsAnonymousOwner`: the shared anonymous bucket is a lockout
  // rather than a limit on the one path strangers are meant to walk.
  if (scope !== 'own:anonymous' || ceiling.countsAnonymousOwner !== false) {
    buckets.push({ scope, limit: ceiling.perOwner });
  }
  if (ip != null) buckets.push({ scope: `ip:${ip}`, limit: ceiling.perIp });
  // Never unmetered. A caller with no account, no cookie AND no forwarding
  // header clears both branches above, which off-platform is a script or a
  // local `next dev` — so the shared anonymous bucket comes back as the last
  // one standing rather than the call going uncounted.
  if (buckets.length === 0) buckets.push({ scope, limit: ceiling.perOwner });
  await takeBudget(buckets, kind, ceiling.windowMs, ceiling.refusal);
}

/** The ceiling itself, for anything that wants to state the number it enforced. */
export function costCeiling(kind: CostKind): Readonly<Ceiling> {
  return CEILINGS[kind];
}
