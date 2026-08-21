import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { Rng } from '@/lib/rng';
import { createLeague } from '@/lib/gen/league';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { assertCanCreateLeague, currentViewer, ensureOwnerKey, LeagueLimitError } from '@/lib/owner';
import {
  FILE_LIMITS,
  LeagueFileError,
  estimateWriteCost,
  parseLeagueFile,
  planFromLeagueFile,
  sanitiseDisplayName,
} from '@/lib/leagueFile';

export const dynamic = 'force-dynamic';
/**
 * Generation is ~5,300 rows over 236 round trips (docs/deployment.md). The
 * platform default of 10s is not enough on a cold connection, and a timeout
 * here is the exact failure the cleanup below exists to survive.
 */
export const maxDuration = 60;

/**
 * ===========================================================================
 * IMPORT — the one endpoint in this app that turns a stranger's file into
 * thousands of database rows
 * ===========================================================================
 *
 * The body is the league file itself as raw JSON text; the league name and
 * chosen franchise ride in the query string. That is not an aesthetic choice.
 * `req.formData()` buffers the entire upload before returning, so a
 * multipart endpoint has already allocated a 50MB body by the time it can look
 * at it — the size limit would be a lie. Reading `req.body` as a stream and
 * counting bytes means an oversized upload is DROPPED MID-FLIGHT, which is the
 * only version of "refuse cheaply" that is actually cheap. It also sidesteps
 * the 1MB default body limit on Server Actions, which would have refused a
 * legitimate 1.5MB league with an opaque framework error.
 *
 * ORDER OF OPERATIONS, cheapest refusal first:
 *   1. Creation caps (two COUNT queries) — a caller who may not create a
 *      league is refused before we read a single byte of their upload.
 *   2. Content-Length — a claimed size over the cap is refused before the
 *      body is read.
 *   3. The stream itself, byte-counted — because a header is a claim, not a
 *      fact.
 *   4. Parse and validate (lib/leagueFile.ts) — pure, no writes.
 *   5. Only then, generation.
 *
 * PARTIAL FAILURE. `createLeague` is not transactional and never has been; a
 * timeout part way through leaves a half-written league that lists on the home
 * page and breaks when opened. This route DOES NOT make that better by wrapping
 * 236 round trips in one interactive transaction — that trades a rare broken
 * save for a routinely-exceeded transaction timeout and a long-held connection
 * on a small Postgres, and it would still leave the same debris when the
 * transaction itself times out. It CLEANS UP INSTEAD: the league id is handed
 * back the moment the League row exists, and any throw below deletes it. Every
 * dependent table cascades from League (see prisma/schema.prisma), so one
 * delete removes the entire partial save. The cleanup is best-effort and
 * logged if it fails, because a failure to clean up must not replace the real
 * error with a second one.
 */
export async function POST(req: NextRequest) {
  // 1. Who is asking, and may they? Minted first so the count and the stamp
  //    agree, exactly as in app/api/league/create/route.ts.
  const ownerKey = ensureOwnerKey();
  const viewer = { ...(await currentViewer()), ownerKey };
  try {
    await assertCanCreateLeague(viewer);
  } catch (err) {
    if (err instanceof LeagueLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }

  // 2. The claimed size.
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > FILE_LIMITS.MAX_BYTES) {
    return NextResponse.json({ error: tooBig(declared) }, { status: 413 });
  }

  // 3. The actual bytes.
  const text = await readCapped(req, FILE_LIMITS.MAX_BYTES);
  if (text === null) {
    return NextResponse.json({ error: tooBig(null) }, { status: 413 });
  }

  // 4. Validation. Everything from here to the generation call is pure.
  try {
    const file = parseLeagueFile(text);

    const url = new URL(req.url);
    // The typed league name overrides the file's, but is held to the same
    // rules as a name that came out of the file — it is rendered in the same
    // places by the same components.
    const name = sanitiseDisplayName(url.searchParams.get('name'), FILE_LIMITS.MAX_LEAGUE_NAME) ?? file.name;

    // The chosen franchise must be one of the file's own teams. An unknown
    // abbreviation is not an error worth refusing an entire import over —
    // createLeague already falls back to the first team and flags it properly
    // — but resolving it here means the fallback is a team from THIS file.
    const wanted = (url.searchParams.get('team') ?? '').trim().toUpperCase();
    const userTeamAbbr = file.teams.some((t) => t.abbr === wanted) ? wanted : file.teams[0].abbr;

    const cost = estimateWriteCost(file);
    const seed = `import-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const plan = planFromLeagueFile(file, new Rng(seed));

    // 5. Generation, with a cleanup handle.
    let createdId: string | null = null;
    try {
      const leagueId = await createLeague({
        name,
        userTeamAbbr,
        seed,
        // Import always starts with the rosters the plan produced. A fantasy
        // draft would be drafting players who already have teams.
        settings: { ...DEFAULT_SETTINGS, leagueStart: 'RANDOM_ROSTERS' },
        plan,
        onLeagueCreated: (id) => { createdId = id; },
      });
      await prisma.league.update({
        where: { id: leagueId },
        data: { ownerKey, userId: viewer.userId },
      });
      console.info(`League imported: ${cost.teams} teams, ${cost.players} players -> ${leagueId}`);
      return NextResponse.json({ leagueId });
    } catch (err) {
      if (createdId) {
        try {
          await prisma.league.delete({ where: { id: createdId } });
          console.warn(`Import failed; deleted the partial league ${createdId}.`);
        } catch (cleanupErr) {
          // Do not let a failed cleanup mask the failure that caused it.
          console.error(`Import failed AND its partial league ${createdId} could not be deleted.`, cleanupErr);
        }
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof LeagueFileError) {
      // The author's file, not our fault: 400, and the message is written to
      // be shown to them verbatim.
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof LeagueLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    console.error('League import failed', err);
    return NextResponse.json(
      { error: 'The league could not be created. Nothing was saved — try again, or export the file again from the source league.' },
      { status: 500 },
    );
  }
}

function tooBig(actual: number | null): string {
  const mb = (FILE_LIMITS.MAX_BYTES / 1_048_576).toFixed(0);
  const seen = actual == null ? '' : ` (this one is ${(actual / 1_048_576).toFixed(1)}MB)`;
  return `That file is too large${seen}. The limit is ${mb}MB — a full 32-team league with complete rosters is under 1.5MB.`;
}

/**
 * Reads the request body, giving up the moment it exceeds `max`. Returns null
 * rather than throwing, because "too big" is an answer, not a fault.
 *
 * The counting is on the raw bytes as they arrive, so nothing larger than the
 * cap is ever held in memory — a 50MB upload is abandoned after the first 4MB
 * and the connection is cancelled.
 */
async function readCapped(req: NextRequest, max: number): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return '';

  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } catch {
    // A dropped or malformed upload reads as an empty file, which the parser
    // already has a clear message for.
    return '';
  }
  return Buffer.concat(chunks).toString('utf8');
}
