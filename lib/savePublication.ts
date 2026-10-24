/**
 * ===========================================================================
 * PUBLISHING A CHALLENGE — the storage, the caps and the shared code pool
 * ===========================================================================
 *
 * THE MECHANISM IS DELIBERATELY NOT A NEW ONE. A challenge code is the same
 * ten Crockford base32 symbols as a league code, out of the same generator,
 * stored in the same table, under the same four lifecycle rules, resolved
 * under the same rate limit, refused in the same words. None of that is
 * copied here: `lib/shareCode.ts` is imported, `PublishedLeague` is reused,
 * and the expiry sweep and the operator takedown in lib/publication.ts are
 * shared outright rather than reimplemented. What this file adds is the three
 * things that genuinely differ.
 *
 *   1. ITS OWN CAPS. A league file is 0.6-1.1MB. A measured three-season
 *      challenge is 14MB uncompressed and about 1.5MB stored. Sharing one
 *      count or one byte allowance between them would mean a single challenge
 *      eating an account's entire league-file quota, so the counts are
 *      separate and both are scoped by `kind`.
 *
 *   2. ITS OWN PREVIEW. A recipient of a league file wants to know how many
 *      franchises and whether the rosters are authored. A recipient of a
 *      challenge wants to know the year, the week, the club and the record —
 *      "CLE, 0-9, week 10 of 2029" — because that is the offer.
 *
 *   3. ITS OWN READER. `readPublishedSave` re-parses through
 *      `parseSaveFile`, never `parseLeagueFile`.
 *
 * ONE CODE POOL, WHICH IS THE POINT. `code` is unique across the whole table,
 * so a code resolves to exactly one thing and the two resolvers cannot
 * disagree. A code of the wrong kind comes back null from BOTH resolvers, with
 * each one's single refusal sentence and nothing that distinguishes it from a
 * code nobody ever published. The two cards each carry a STATIC line pointing
 * at the other door — static rather than conditional, because a line that
 * appeared only for a code of the other kind would sort a guesser's attempts
 * into three buckets, which is the whole thing the single sentence prevents.
 * `npm run audit:actions` tries both crossings and compares the bodies.
 * ===========================================================================
 */
import { gunzipSync, gzipSync } from 'zlib';
import { prisma } from './db';
import { SAVE_LIMITS, SaveFile, SaveSummary, parseSaveFile, serializeSaveFile, summarizeSaveFile } from './saveFile';
import { generateShareCode, normalizeShareCode } from './shareCode';
import { PUBLICATION_RETENTION_MONTHS, publicationExpiresAt, publicationExpiryCutoff } from './publication';

/** The discriminator, stated once. */
export const PUBLICATION_KIND_SAVE = 'SAVE';

/**
 * How many live challenge codes one account may hold, and how many
 * uncompressed bytes they may describe between them.
 *
 * FOUR, against the twelve a league file gets, and the ratio is the size
 * ratio: a measured challenge is roughly twenty times a league file, so four
 * challenges is already more disk than twelve league files. It is also the
 * right number for the thing itself — a challenge is a situation somebody
 * composed, not a save they happened to have, and an account holding four at
 * once is an author with a series going.
 *
 * THE BYTE CAP IS WHAT ACTUALLY BOUNDS THE DISK. Four at the largest challenge
 * this build will store is 192MB of uncompressed file, which gzips to roughly
 * 24MB held — so the cap below is the real constraint and the count is the
 * friendly one. Stated in UNCOMPRESSED bytes, the same unit as
 * SAVE_LIMITS.MAX_BYTES, so it cannot be gamed by a payload that happens to
 * compress well, and so no screen has to convert between two units.
 */
export const MAX_CHALLENGES_PER_USER = 4;
export const MAX_CHALLENGE_BYTES_PER_USER = 4 * SAVE_LIMITS.MAX_BYTES;

/**
 * THE ONE SENTENCE FOR A CHALLENGE CODE THAT DOES NOT RESOLVE.
 *
 * Mistyped, never published, withdrawn, taken down, expired unopened, or a
 * league-file code rather than a challenge code: one sentence for all six, for
 * the reason lib/publication.ts gives about oracles. Six sentences would be
 * six ways to tell a guesser which of their guesses were close.
 */
export const CHALLENGE_NOT_FOUND =
  'No challenge is filed under that code. Check the characters, or ask whoever shared it for the code again — '
  + 'codes expire if nobody opens them, and a publisher can withdraw one at any time.';

/** A refusal a person can act on, told apart from a database fault. */
export class ChallengePublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChallengePublishError';
  }
}

/** What `resolveChallenge` hands back: the card, never the payload. */
export interface ChallengePreview extends SaveSummary {
  code: string;
  publisher: string;
  publishedAt: Date;
  fileBytes: number;
  formatVersion: number;
  /** When this code goes away if nobody opens it again. */
  expiresAt: Date;
}

/**
 * Refuses a publish that would put this account over its challenge caps.
 *
 * Two aggregate reads and no lock, the same bargain `assertCanPublish` and
 * `assertCanCreateLeague` strike and for the same reason: two simultaneous
 * publishes from one account can both pass and land one file over the cap, the
 * overshoot is bounded by the caller's own concurrency, and serialising every
 * publish costs more than being off by one. The hourly PUBLISH ceiling
 * (lib/costLimit.ts) bounds the loop; this bounds the stock.
 */
export async function assertCanPublishChallenge(userId: string, incomingBytes: number): Promise<void> {
  const rows = await prisma.publishedLeague.aggregate({
    where: { userId, kind: PUBLICATION_KIND_SAVE, takenDownAt: null },
    _count: { _all: true },
    _sum: { fileBytes: true },
  });
  const held = rows._count._all;
  const bytes = rows._sum.fileBytes ?? 0;

  if (held >= MAX_CHALLENGES_PER_USER) {
    throw new ChallengePublishError(
      `You have ${held} challenges published, which is the limit (${MAX_CHALLENGES_PER_USER}). `
      + 'Withdraw one you are no longer sharing and this one can go up.',
    );
  }
  if (bytes + incomingBytes > MAX_CHALLENGE_BYTES_PER_USER) {
    throw new ChallengePublishError(
      `Your published challenges already come to ${(bytes / 1_048_576).toFixed(0)}MB and this one is `
      + `${(incomingBytes / 1_048_576).toFixed(0)}MB, which is over the `
      + `${(MAX_CHALLENGE_BYTES_PER_USER / 1_048_576).toFixed(0)}MB this office will hold for one account. `
      + 'Withdraw one you are no longer sharing.',
    );
  }
}

/**
 * Stores a challenge under a fresh code and hands the code back.
 *
 * THE CALLER PROVES OWNERSHIP, not this function: it takes the file and the
 * publisher's account id, because the route it is called from has already
 * established both.
 *
 * COMPRESSION IS NOT OPTIONAL HERE, unlike on the league-file path where it is
 * merely sensible. The measured ratio on this payload is roughly ten to one —
 * a save is mostly repeated JSON keys and box-score prose — so the difference
 * between storing it and not is the difference between a feature and a disk
 * bill. The UNCOMPRESSED length is what the caps and the reader are measured
 * in, so it is stored alongside rather than inferred.
 *
 * THE CODE IS RETRIED, NOT LOOKED UP FIRST. At fifty bits a collision is a
 * one-in-a-quadrillion event, so a pre-check would be a wasted round trip on
 * every publish that also has a race in it. The unique index is the authority
 * and P2002 is the retry signal.
 */
export async function publishChallenge(args: {
  file: SaveFile;
  userId: string;
  sourceLeagueId: string | null;
}): Promise<{ code: string; fileBytes: number; storedBytes: number }> {
  const text = serializeSaveFile(args.file);
  const fileBytes = Buffer.byteLength(text, 'utf8');

  // The ceiling the READER applies, applied to what we are about to store. An
  // export cannot normally exceed it, and "cannot normally" is not a reason to
  // store something that would be refused on the way back out.
  if (fileBytes > SAVE_LIMITS.MAX_BYTES) {
    throw new ChallengePublishError(
      `This save serialises to ${(fileBytes / 1_048_576).toFixed(0)}MB, over the `
      + `${SAVE_LIMITS.MAX_BYTES / 1_048_576}MB a challenge may be. Publish it without the history, which is `
      + 'most of the size.',
    );
  }

  await assertCanPublishChallenge(args.userId, fileBytes);

  const summary = summarizeSaveFile(args.file);
  const payload = gzipSync(Buffer.from(text, 'utf8'));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = generateShareCode();
    try {
      await prisma.publishedLeague.create({
        data: {
          code,
          kind: PUBLICATION_KIND_SAVE,
          payload,
          fileBytes,
          formatVersion: args.file.formatVersion,
          userId: args.userId,
          sourceLeagueId: args.sourceLeagueId,
          // The five columns the table has always had. A challenge is a league
          // too, so they are filled rather than left to mean nothing.
          leagueName: summary.leagueName,
          teamCount: summary.teamCount,
          rosteredPlayers: summary.rosteredPlayers,
          freeAgents: summary.freeAgents,
          hasDraftClass: summary.hasDraftClass,
          // The nine a challenge adds.
          saveSeasonYear: summary.seasonYear,
          savePhase: summary.phase,
          saveWeek: summary.week,
          saveTeamAbbr: summary.teamAbbr,
          saveTeamName: summary.teamName,
          saveRecord: summary.record,
          saveHistory: summary.carriesHistory,
          challengeTitle: summary.challengeTitle,
          challengeBrief: summary.challengeBrief,
        },
      });
      return { code, fileBytes, storedBytes: payload.byteLength };
    } catch (err) {
      const taken = err instanceof Error && (err as { code?: string }).code === 'P2002';
      if (!taken) throw err;
    }
  }
  throw new ChallengePublishError('A code could not be issued for this challenge. Try again.');
}

/**
 * Looks a challenge code up and stamps it as opened. Returns null for anything
 * that is not a live challenge — including a live LEAGUE-FILE code, which is
 * the one extra miss this resolver has over its sibling.
 *
 * NULL IS THE ONLY NEGATIVE ANSWER. Malformed, never published, wrong kind,
 * taken down, expired: one answer, so the caller has one refusal to word.
 *
 * OPENING RESETS THE EXPIRY CLOCK, so this read performs a write, exactly as
 * `resolvePublication` does and for the same reason: without it a code people
 * are actively sharing would expire underneath them.
 *
 * It does NOT return the payload. The card is a page render; the bytes are
 * read only by the redeem path, which asks for them by name.
 */
export async function resolveChallenge(rawCode: unknown): Promise<ChallengePreview | null> {
  const code = normalizeShareCode(rawCode);
  if (code == null) return null;

  const row = await prisma.publishedLeague.findUnique({
    where: { code },
    select: {
      kind: true, code: true, leagueName: true, teamCount: true, rosteredPlayers: true,
      freeAgents: true, hasDraftClass: true, fileBytes: true, formatVersion: true,
      saveSeasonYear: true, savePhase: true, saveWeek: true, saveTeamAbbr: true,
      saveTeamName: true, saveRecord: true, saveHistory: true,
      challengeTitle: true, challengeBrief: true,
      createdAt: true, lastOpenedAt: true, takenDownAt: true,
      user: { select: { username: true } },
    },
  });
  if (!row || row.kind !== PUBLICATION_KIND_SAVE || row.takenDownAt != null) return null;

  // Expired but not yet swept. The sweep is opportunistic (it rides on the
  // publish path, since this deployment has no scheduler), so the retention
  // window has to be enforced on the way out as well or a code would keep
  // working for however long it took somebody else to publish something.
  if ((row.lastOpenedAt ?? row.createdAt) < publicationExpiryCutoff()) return null;

  // OPENING RESETS THE EXPIRY CLOCK — one indexed UPDATE, and it deliberately
  // selects NOTHING back. An earlier version returned `payload` so the card
  // could show the stored size, which meant reading two megabytes of gzip on
  // every page view to print one number nobody had asked for.
  await prisma.publishedLeague.update({
    where: { code },
    data: { lastOpenedAt: new Date(), openCount: { increment: 1 } },
    select: { code: true },
  });

  return {
    code: row.code,
    publisher: row.user.username,
    publishedAt: row.createdAt,
    fileBytes: row.fileBytes,
    formatVersion: row.formatVersion,
    // Computed from the stamp this call has just written, so the date on the
    // card is the date the sweep would act on from here.
    expiresAt: publicationExpiresAt({ createdAt: row.createdAt, lastOpenedAt: new Date() }),
    // The summary, read back out of the columns the publish path wrote from
    // `summarizeSaveFile`. The nullable ones cannot be null on a SAVE row —
    // every one of them is written in the same statement as `kind` — but the
    // types say they can, so the fallbacks are honest rather than decorative.
    leagueName: row.leagueName,
    seasonYear: row.saveSeasonYear ?? 0,
    phase: row.savePhase ?? 'PRESEASON',
    week: row.saveWeek ?? 1,
    teamCount: row.teamCount,
    teamAbbr: row.saveTeamAbbr,
    teamName: row.saveTeamName,
    record: row.saveRecord,
    rosteredPlayers: row.rosteredPlayers,
    freeAgents: row.freeAgents,
    hasDraftClass: row.hasDraftClass,
    carriesHistory: row.saveHistory ?? false,
    challengeTitle: row.challengeTitle ?? '',
    challengeBrief: row.challengeBrief ?? '',
  };
}

/**
 * The stored challenge itself, validated on the way out.
 *
 * RE-PARSED THROUGH `parseSaveFile`, EVERY TIME, and not because the bytes
 * might have rotted. Because the reader is where every limit and every
 * migration step lives, and a stored file is still a file a stranger wrote: it
 * was accepted by the build that was running the day it went up, and it is
 * being read by whatever build is running now. A v1 challenge stored a year
 * ago comes back through the current chain here, which is the whole reason the
 * chain exists.
 */
export async function readPublishedChallenge(code: string): Promise<SaveFile | null> {
  const row = await prisma.publishedLeague.findUnique({
    where: { code },
    select: { kind: true, payload: true, takenDownAt: true, createdAt: true, lastOpenedAt: true },
  });
  if (!row || row.kind !== PUBLICATION_KIND_SAVE || row.takenDownAt != null) return null;
  if ((row.lastOpenedAt ?? row.createdAt) < publicationExpiryCutoff()) return null;
  return parseSaveFile(gunzipSync(row.payload).toString('utf8'));
}

/**
 * RULE 1, challenge side: the publisher withdraws their own code.
 *
 * Deleted by (code, userId, kind) in one statement rather than read-then-
 * delete, so there is no window between proving the row is theirs and removing
 * it. A delete that matches nothing is reported the same way whether the code
 * was somebody else's, the wrong kind, or never existed.
 */
export async function deleteChallenge(code: string, userId: string): Promise<boolean> {
  const normalized = normalizeShareCode(code);
  if (normalized == null) return false;
  const { count } = await prisma.publishedLeague.deleteMany({
    where: { code: normalized, userId, kind: PUBLICATION_KIND_SAVE },
  });
  return count > 0;
}

/**
 * The challenges one account is holding, for that account's own screen. The
 * only query here that reads this table by anything other than a code, and it
 * is scoped to the caller — there is no listing of anybody else's, by the same
 * decision that means there is no gallery.
 */
export async function listChallengesForUser(userId: string) {
  const rows = await prisma.publishedLeague.findMany({
    where: { userId, kind: PUBLICATION_KIND_SAVE, takenDownAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      code: true, leagueName: true, challengeTitle: true, saveSeasonYear: true,
      savePhase: true, saveWeek: true, saveTeamAbbr: true, saveRecord: true,
      saveHistory: true, fileBytes: true, openCount: true,
      createdAt: true, lastOpenedAt: true, sourceLeagueId: true,
    },
  });
  return rows.map((r) => ({ ...r, expiresAt: publicationExpiresAt(r) }));
}

/** Re-exported so a screen needs one import to say how long a code lives. */
export { PUBLICATION_RETENTION_MONTHS };
