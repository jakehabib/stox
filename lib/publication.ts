/**
 * ===========================================================================
 * PUBLISHING A LEAGUE — the storage, the caps and the four lifecycle rules
 * ===========================================================================
 *
 * TWO TIERS, AND THE FILE TIER IS NOT THE FALLBACK.
 *
 *   A FILE is the whole of the first tier. Export it, send it however you
 *   like, the recipient uploads it. Nothing is stored here, so there is
 *   nothing to expire, nothing to cap and nothing to take down. That path is
 *   untouched by this module and remains first-class.
 *
 *   A CODE is the second tier, and the entire difference is that this
 *   deployment now holds the bytes. Everything in this file exists because of
 *   that one fact: a publisher must be identifiable, a publisher must be able
 *   to withdraw what they published, an operator must be able to take
 *   something down, files nobody wants must go away by themselves, and one
 *   account must not be able to fill the disk.
 *
 * FRICTION IS ASYMMETRIC ON PURPOSE. Publishing needs an account; redeeming
 * needs nothing at all. The recipient is the person whose patience is scarce
 * — they were handed a code by a friend and have no reason to trust this site
 * yet — and the publisher is the person who has to be attributable if what
 * they published is a problem.
 *
 * THE FOUR LIFECYCLE RULES, all enforced here rather than by convention:
 *
 *   1. THE PUBLISHER CAN DELETE.     `deletePublication` — hard delete, by
 *                                    code, proving the row is theirs first.
 *   2. AN OPERATOR CAN TAKE DOWN.    `takeDownPublication` — marks the row and
 *                                    keeps it, so the code is burned rather
 *                                    than recycled. `npm run codes:takedown`.
 *   3. UNOPENED CODES EXPIRE.        `publicationExpiryCutoff` and
 *                                    `sweepExpiredPublications` — six months
 *                                    since the code was last opened, or since
 *                                    it was published if it never was.
 *   4. STORAGE IS CAPPED PER ACCOUNT. `assertCanPublish` — a count of live
 *                                     codes, and a cap on the bytes behind
 *                                     them.
 *
 * WHY SIX MONTHS. A code is shared the day it is minted: it goes into a
 * Discord message and is either opened that week or never. Six months is far
 * past any honest "I'll get to it", and it is the shortest window that still
 * survives the one real seasonal pattern this game has — a league published
 * at the start of one NFL season is still live at the start of the next
 * off-season, so the code somebody put in their league's pinned message in
 * September still works in February. Anything shorter breaks that; anything
 * longer is storing files for people who are not coming back. The clock is
 * reset by being OPENED, not by being redeemed, so a code that is still
 * being handed around never expires however long ago it was published.
 * ===========================================================================
 */
import { gunzipSync, gzipSync } from 'zlib';
import { prisma } from './db';
import { FILE_LIMITS, LeagueFile, parseLeagueFile, serializeLeagueFile } from './leagueFile';
import { generateShareCode, normalizeShareCode } from './shareCode';

/**
 * How long a code lives without being opened. Months, not days — see the
 * header for the argument, and nothing else in the app may restate it.
 */
export const PUBLICATION_RETENTION_MONTHS = 6;

/**
 * ===========================================================================
 * THIS MODULE IS THE LEAGUE-FILE HALF OF ONE TABLE
 * ===========================================================================
 * `PublishedLeague` now holds two kinds of thing: a league file published from
 * here, and a CHALLENGE — a whole save — published from lib/savePublication.ts.
 * The argument for one table rather than two is in the model comment in
 * prisma/schema.prisma; the consequence for this file is that every query
 * which asks "what has this account got" or "what is behind this code" must
 * say WHICH KIND it means, or a save code would resolve here as a league file
 * and be handed to a reader that cannot parse it.
 *
 * So `PUBLICATION_KIND_LEAGUE` appears in every such `where` below. The two
 * places it deliberately does NOT appear are the expiry sweep and the operator
 * takedown: retention and takedown are properties of a published thing, not of
 * what kind of thing it is, and splitting them would be two sets of rules that
 * could drift. `deletePublication` is also kind-agnostic, because it is keyed
 * on (code, userId) and a publisher withdrawing their own code means it
 * whichever kind it is.
 * ===========================================================================
 */
export const PUBLICATION_KIND_LEAGUE = 'LEAGUE';

/**
 * How many live codes one account may hold, and how many uncompressed bytes
 * they may describe between them.
 *
 * TWELVE, measured against the thing next to it: an account may hold eight
 * saves (maxLeaguesPerOwner, lib/owner.ts), so twelve is every save published
 * at once with room to re-publish a few after a change of mind, and it is a
 * cap a real person cannot reach by accident. The BYTE cap is the one that
 * actually bounds the disk — twelve codes is 12MB of file at the largest
 * thing the app writes, which gzips to roughly 1.5MB stored — and it is
 * stated in uncompressed bytes so it is the same unit as FILE_LIMITS
 * .MAX_BYTES and cannot be gamed by a file that happens to compress well.
 */
export const MAX_PUBLICATIONS_PER_USER = 12;
export const MAX_PUBLISHED_BYTES_PER_USER = 24 * 1024 * 1024;

/**
 * THE ONE SENTENCE FOR A CODE THAT DOES NOT RESOLVE, wherever that is said.
 *
 * The redeem route and the /l/[code] page both show this, and they must show
 * the SAME words for all four of the reasons a code can fail: it was typed
 * wrong, nobody ever published it, it was taken down, or it expired unopened.
 * Four sentences would be four oracles — an attacker who can tell "real but
 * withdrawn" from "no such code" has turned guessing into mapping. One
 * constant is the only way two screens cannot drift into saying different
 * things about the same miss.
 */
export const CODE_NOT_FOUND =
  'No league is filed under that code. Check the characters, or ask whoever shared it for the code again — '
  + 'codes expire if nobody opens them, and a publisher can withdraw one at any time.';

/** The four facts a recipient is shown, and the only ones. */
export interface PublicationSummary {
  leagueName: string;
  teamCount: number;
  rosteredPlayers: number;
  freeAgents: number;
  hasDraftClass: boolean;
}

/** What `resolvePublication` hands back: the preview, never the payload. */
export interface PublicationPreview extends PublicationSummary {
  code: string;
  publisher: string;
  publishedAt: Date;
  fileBytes: number;
  formatVersion: number;
  /** When this code goes away if nobody opens it again. */
  expiresAt: Date;
}

/**
 * A refusal a person can act on, told apart from a database fault for the
 * same reason `LeagueLimitError` is — "you are holding enough files" and "the
 * database fell over" want different words on screen. Route handlers answer
 * it 400 or 429 depending on which one it is; see each call site.
 */
export class PublicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicationError';
  }
}

/**
 * THE ONE PLACE THE PREVIEW NUMBERS ARE COUNTED.
 *
 * Both the publish path (which stores them) and any screen that wants to
 * describe a file in hand (which has not stored anything) call this, so the
 * "28 rostered players" on a recipient's card is the same count the publisher
 * was shown. Pure, and counted off the parsed file rather than off the
 * database, because the file is the thing being described.
 */
export function summarizeLeagueFile(file: LeagueFile): PublicationSummary {
  return {
    leagueName: file.name,
    teamCount: file.teams.length,
    rosteredPlayers: file.teams.reduce((n, t) => n + (t.players?.length ?? 0), 0),
    freeAgents: file.freeAgents?.length ?? 0,
    hasDraftClass: (file.draftClasses?.length ?? 0) > 0,
  };
}

/**
 * The instant before which a publication has gone stale. One function, called
 * by the sweep, by the resolver's own staleness check and by the screen that
 * tells a publisher when their code expires — so the date shown is the date
 * enforced.
 */
export function publicationExpiryCutoff(now = new Date()): Date {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - PUBLICATION_RETENTION_MONTHS);
  return cutoff;
}

/** When a given publication expires if nobody opens it again. */
export function publicationExpiresAt(row: { createdAt: Date; lastOpenedAt: Date | null }): Date {
  const from = new Date(row.lastOpenedAt ?? row.createdAt);
  from.setMonth(from.getMonth() + PUBLICATION_RETENTION_MONTHS);
  return from;
}

/**
 * The rows the sweep deletes: last opened (or, never opened, published) before
 * the cutoff. Exported so a probe can prove the predicate rather than trusting
 * the sweep's own report of what it did.
 */
export function expiredPublicationWhere(now = new Date()) {
  const cutoff = publicationExpiryCutoff(now);
  return {
    OR: [
      { lastOpenedAt: null, createdAt: { lt: cutoff } },
      { lastOpenedAt: { lt: cutoff } },
    ],
  };
}

/**
 * Deletes every expired publication. Returns how many went.
 *
 * Run opportunistically from the publish path rather than from a cron, which
 * is the same bargain lib/auth.ts strikes for its attempt ledger: this
 * deployment has no scheduler, the sweep is one indexed DELETE, and the work
 * lands on the person adding to the table rather than on a recipient who is
 * waiting for a page. A taken-down row is swept too — it has been dead since
 * the day it was marked, and six months is long enough to have kept the
 * record.
 */
export async function sweepExpiredPublications(now = new Date()): Promise<number> {
  const { count } = await prisma.publishedLeague.deleteMany({ where: expiredPublicationWhere(now) });
  return count;
}

/**
 * Refuses a publish that would put this account over its storage caps.
 *
 * Two COUNT-shaped queries and no lock, for the reason `assertCanCreateLeague`
 * gives: two simultaneous publishes from one account can both pass and land
 * one file over the cap, the overshoot is bounded by the caller's own
 * concurrency, and serialising every publish costs more than being off by one
 * 24MB cap. The PUBLISH hourly ceiling (lib/costLimit.ts) is what bounds the
 * loop; this bounds the stock.
 */
export async function assertCanPublish(userId: string, incomingBytes: number): Promise<void> {
  const rows = await prisma.publishedLeague.aggregate({
    // Counted against LEAGUE FILES only. Challenges are twenty times the size
    // and hold their own count and byte caps (lib/savePublication.ts); one
    // shared stock would let a single challenge consume an account's entire
    // allowance for league files.
    where: { userId, kind: PUBLICATION_KIND_LEAGUE, takenDownAt: null },
    _count: { _all: true },
    _sum: { fileBytes: true },
  });
  const held = rows._count._all;
  const bytes = rows._sum.fileBytes ?? 0;

  if (held >= MAX_PUBLICATIONS_PER_USER) {
    throw new PublicationError(
      `You have ${held} leagues published, which is the limit (${MAX_PUBLICATIONS_PER_USER}). `
      + 'Delete a code you are no longer sharing and this one can go up.',
    );
  }
  if (bytes + incomingBytes > MAX_PUBLISHED_BYTES_PER_USER) {
    const mb = (MAX_PUBLISHED_BYTES_PER_USER / 1_048_576).toFixed(0);
    throw new PublicationError(
      `Your published leagues already come to ${(bytes / 1_048_576).toFixed(1)}MB and this one is `
      + `${(incomingBytes / 1_048_576).toFixed(1)}MB, which is over the ${mb}MB this office will hold for one `
      + 'account. Delete a code you are no longer sharing.',
    );
  }
}

/**
 * Stores a league file under a fresh code and hands the code back.
 *
 * THE CALLER PROVES OWNERSHIP, NOT THIS FUNCTION. It takes the file and the
 * publisher's account id, because it is called from one route that has already
 * established both — see app/api/league/publish/route.ts. Nothing here reads
 * a cookie.
 *
 * THE CODE IS RETRIED, NOT CHECKED FOR FIRST. At 50 bits a collision is a
 * one-in-a-quadrillion event, so looking one up before inserting would be a
 * wasted round trip on every publish that also has a race in it; the unique
 * index is the authority and P2002 is the retry signal. Three attempts, and a
 * fourth failure is a real fault rather than bad luck.
 */
export async function publishLeagueFile(args: {
  file: LeagueFile;
  userId: string;
  sourceLeagueId: string | null;
}): Promise<{ code: string; fileBytes: number; storedBytes: number }> {
  const text = serializeLeagueFile(args.file);
  const fileBytes = Buffer.byteLength(text, 'utf8');

  // The same ceiling an upload is held to, applied to what we are about to
  // store. An export cannot normally exceed it, and "cannot normally" is not
  // a reason to store something the reader would later refuse.
  if (fileBytes > FILE_LIMITS.MAX_BYTES) {
    throw new PublicationError(
      `This league serialises to ${(fileBytes / 1_048_576).toFixed(1)}MB, over the `
      + `${FILE_LIMITS.MAX_BYTES / 1_048_576}MB a league file may be. Export it and send the file instead.`,
    );
  }

  await assertCanPublish(args.userId, fileBytes);

  const summary = summarizeLeagueFile(args.file);
  const payload = gzipSync(Buffer.from(text, 'utf8'));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = generateShareCode();
    try {
      await prisma.publishedLeague.create({
        data: {
          code,
          kind: PUBLICATION_KIND_LEAGUE,
          payload,
          fileBytes,
          formatVersion: args.file.formatVersion,
          userId: args.userId,
          sourceLeagueId: args.sourceLeagueId,
          ...summary,
        },
      });
      return { code, fileBytes, storedBytes: payload.byteLength };
    } catch (err) {
      const taken = err instanceof Error && (err as { code?: string }).code === 'P2002';
      if (!taken) throw err;
    }
  }
  throw new PublicationError('A code could not be issued for this league. Try again.');
}

/**
 * Looks a code up and stamps it as opened. Returns null for anything that is
 * not a live publication.
 *
 * NULL IS THE ONLY NEGATIVE ANSWER THIS FUNCTION HAS, and that is the whole
 * design of it. A malformed code, a well-formed code nobody published, a code
 * that has been taken down, and a code that has sat unopened past the
 * retention window all come back null, so the caller has one refusal to word
 * and an attacker learns nothing from which one they hit. There is no variant
 * that says "that code existed once".
 *
 * OPENING IS WHAT RESETS THE EXPIRY CLOCK, so the stamp is a write on a read
 * path and that is deliberate: it is one indexed UPDATE, and without it a code
 * people are actively sharing would expire underneath them.
 *
 * It does NOT return the payload. A preview is a page render; the bytes are
 * only ever read by the redeem path, which asks for them by name.
 */
export async function resolvePublication(rawCode: unknown): Promise<PublicationPreview | null> {
  const code = normalizeShareCode(rawCode);
  if (code == null) return null;

  const row = await prisma.publishedLeague.findUnique({
    where: { code },
    select: {
      kind: true,
      code: true, leagueName: true, teamCount: true, rosteredPlayers: true, freeAgents: true,
      hasDraftClass: true, fileBytes: true, formatVersion: true, createdAt: true,
      lastOpenedAt: true, takenDownAt: true,
      user: { select: { username: true } },
    },
  });
  // A CHALLENGE CODE IS NOT A LEAGUE-FILE CODE, and it answers here exactly as
  // a code nobody published does — same null, same one sentence. Not because
  // it is a secret: because this resolver's caller is about to hand the
  // payload to `parseLeagueFile`, and "that code is real but it is the other
  // kind" is a sentence only a developer could act on. The challenge resolver
  // (lib/savePublication.ts) is the mirror image. Each of the two pages they
  // feed carries a STATIC line pointing at the other door — static, because a
  // line that appeared only for a code of the other kind would be exactly the
  // oracle this null exists to avoid.
  if (!row || row.kind !== PUBLICATION_KIND_LEAGUE || row.takenDownAt != null) return null;

  // Expired but not yet swept. The sweep is opportunistic, so the retention
  // window has to be enforced on the way out as well or a code would keep
  // working for however long it took somebody else to publish something.
  const cutoff = publicationExpiryCutoff();
  if ((row.lastOpenedAt ?? row.createdAt) < cutoff) return null;

  await prisma.publishedLeague.update({
    where: { code },
    data: { lastOpenedAt: new Date(), openCount: { increment: 1 } },
  });

  return {
    code: row.code,
    leagueName: row.leagueName,
    teamCount: row.teamCount,
    rosteredPlayers: row.rosteredPlayers,
    freeAgents: row.freeAgents,
    hasDraftClass: row.hasDraftClass,
    fileBytes: row.fileBytes,
    formatVersion: row.formatVersion,
    publisher: row.user.username,
    publishedAt: row.createdAt,
    // Computed from the stamp this call has just written, so the date on the
    // card is the date the sweep would act on from here.
    expiresAt: publicationExpiresAt({ createdAt: row.createdAt, lastOpenedAt: new Date() }),
  };
}

/**
 * The stored file itself, validated on the way out.
 *
 * RE-PARSED THROUGH `parseLeagueFile`, EVERY TIME, and not because the bytes
 * might have rotted. Because the reader is where every limit in this app
 * lives, and a stored file is still a file a stranger wrote: it was accepted
 * by the reader this build shipped with, and it is being read by whatever
 * build is running now. Trusting it because we stored it once is how an old
 * file gets a free pass through a limit that was tightened since.
 */
export async function readPublishedFile(code: string): Promise<LeagueFile | null> {
  const row = await prisma.publishedLeague.findUnique({
    where: { code },
    select: { kind: true, payload: true, takenDownAt: true, createdAt: true, lastOpenedAt: true },
  });
  if (!row || row.kind !== PUBLICATION_KIND_LEAGUE || row.takenDownAt != null) return null;
  if ((row.lastOpenedAt ?? row.createdAt) < publicationExpiryCutoff()) return null;
  return parseLeagueFile(gunzipSync(row.payload).toString('utf8'));
}

/**
 * RULE 1: the publisher withdraws their own code.
 *
 * Deleted by (code, userId) in one statement rather than read-then-delete, so
 * there is no window between proving the row is theirs and removing it and no
 * way for the two to disagree. A delete that matches nothing is reported the
 * same way whether the code was somebody else's or never existed — the same
 * no-oracle rule the resolver follows.
 */
export async function deletePublication(code: string, userId: string): Promise<boolean> {
  const normalized = normalizeShareCode(code);
  if (normalized == null) return false;
  const { count } = await prisma.publishedLeague.deleteMany({ where: { code: normalized, userId } });
  return count > 0;
}

/**
 * RULE 2: an operator takes a code down.
 *
 * MARKS, DOES NOT DELETE. The row stays so the code is spent rather than
 * returned to the pool, and so there is a record of what was taken down and
 * why — which is the thing the owner would need if anybody ever asked. A
 * marked row resolves exactly as a code that was never published does.
 *
 * NO VIEWER AND NO ACCOUNT, deliberately: this is reached by
 * `npm run codes:takedown` from a shell that already has the database URL, and
 * there is no in-app administrator in this deployment to authenticate as. The
 * day there is one, the check goes at the call site rather than in here.
 */
export async function takeDownPublication(rawCode: string, reason: string): Promise<boolean> {
  const code = normalizeShareCode(rawCode);
  if (code == null) return false;
  const { count } = await prisma.publishedLeague.updateMany({
    where: { code, takenDownAt: null },
    data: { takenDownAt: new Date(), takedownReason: reason.slice(0, 500) },
  });
  return count > 0;
}

/**
 * The codes one account is holding, for that account's own screen. The only
 * query in this app that reads this table by anything other than a code, and
 * it is scoped to the caller — there is no listing of anybody else's.
 */
export async function listPublicationsForUser(userId: string) {
  const rows = await prisma.publishedLeague.findMany({
    where: { userId, kind: PUBLICATION_KIND_LEAGUE, takenDownAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      code: true, leagueName: true, teamCount: true, rosteredPlayers: true, openCount: true,
      createdAt: true, lastOpenedAt: true, sourceLeagueId: true,
    },
  });
  return rows.map((r) => ({ ...r, expiresAt: publicationExpiresAt(r) }));
}
