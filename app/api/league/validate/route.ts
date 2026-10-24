import { NextRequest, NextResponse } from 'next/server';
import {
  FILE_LIMITS,
  LeagueFileError,
  parseLeagueFile,
  summariseLeagueFile,
} from '@/lib/leagueFile';
import { CSV_LIMITS, CsvBundle, leagueFileFromCsv } from '@/lib/leagueCsv';
import { readCappedBody } from '@/lib/requestBody';
import { ensureOwnerKey, currentViewer } from '@/lib/owner';
import { assertCostBudget, CostLimitError, costCeiling } from '@/lib/costLimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * ===========================================================================
 * VALIDATE — the real refusal, and nothing created
 * ===========================================================================
 *
 * An author iterating on a league had exactly one way to find out what was
 * wrong with it: attempt a real import, spend a league slot and an hour of
 * CREATE budget, and read the refusal off a failed founding. For a 1,700-row
 * spreadsheet that is the wrong loop. This endpoint closes it: post the league
 * file, or the CSVs it is built from, and get back either the refusal the
 * import would have given you or a description of the league it would have
 * built. Nothing is written either way.
 *
 * IT RUNS THE REAL VALIDATOR. `parseLeagueFile` is the only thing in this
 * codebase that decides whether a league file is legal, and this route calls
 * it — the same function, the same bounds, the same sentences. A second,
 * friendlier copy here would be the worst possible version of this feature: it
 * would tell an author their file was fine and then let the import refuse it,
 * which is strictly less useful than having no validator at all. For the same
 * reason a CSV bundle goes through `leagueFileFromCsv`, which is the same
 * conversion /api/league/csv performs and which rewrites every document path
 * into the row that wrote it before the refusal leaves here.
 *
 * A REFUSAL IS A 400 AND IT IS THE POINT. The author's file is wrong; that is
 * an answer, not a server fault, and the message is written to be shown
 * verbatim. 200 carries `summariseLeagueFile` — the teams, the players the
 * file names, the players the import would actually write (the importer's own
 * `estimateWriteCost`, so the figure is the one the import logs), and the
 * re-serialised size against FILE_LIMITS.MAX_BYTES.
 *
 * AND IT IS METERED, BECAUSE "WRITES NOTHING" IS NOT "COSTS NOTHING" — the
 * same note /api/league/csv carries, for the same reason. Unauthenticated,
 * buffers up to FILE_LIMITS.MAX_BYTES, runs a full parse. Its own VALIDATE
 * ceiling, at twice CSV_CONVERT's, because checking is the loop the authoring
 * path exists to serve. See lib/costLimit.ts.
 *
 * ORDER OF OPERATIONS, CHEAPEST REFUSAL FIRST, and the order is the whole
 * design:
 *   1. Content-Length — a claimed size over the cap is refused without reading
 *      a body or touching the database.
 *   2. THEN the hourly ceiling. Behind the size check, never in front of it:
 *      spending two counter writes to answer an oversized upload would make
 *      the cheapest refusal on the route the most expensive one, and that is a
 *      bug this codebase has already fixed once — the import route checked its
 *      ceiling on arrival and an oversized upload cost a caller an hour of
 *      budget to be told 429 instead of 413.
 *   3. The bytes themselves, counted as they arrive (lib/requestBody.ts) for a
 *      raw file, or the form for a CSV bundle.
 *   4. The parse. Pure, no writes, no clock.
 */
export async function POST(req: NextRequest) {
  // 1. The claimed size. FILE_LIMITS.MAX_BYTES and CSV_LIMITS.MAX_BYTES are
  //    the same number by construction (CSV_LIMITS reads it), so one cap
  //    covers both shapes of upload.
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > FILE_LIMITS.MAX_BYTES) {
    return NextResponse.json({ error: tooBig(declared) }, { status: 413 });
  }

  // 2. The ceiling, behind the size check. Minted before the count so the
  //    bucket this call is counted in is the bucket the next one will be —
  //    same mint-then-count sequence as the csv, create and import routes.
  const ownerKey = ensureOwnerKey();
  try {
    await assertCostBudget('VALIDATE', { ...(await currentViewer()), ownerKey });
  } catch (err) {
    if (err instanceof CostLimitError) {
      return NextResponse.json(
        { error: err.message },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(costCeiling('VALIDATE').windowMs / 1000)) } },
      );
    }
    throw err;
  }

  const contentType = req.headers.get('content-type') ?? '';
  const isForm = contentType.includes('multipart/form-data');

  try {
    // 3. The bytes.
    let file;
    let receivedBytes: number;

    if (isForm) {
      // `req.formData()` buffers the whole upload before it returns, which is
      // why the Content-Length check above it is load-bearing here in a way it
      // is not for a raw body.
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        return NextResponse.json(
          { error: 'That upload could not be read. Attach teams.csv, and optionally players.csv and prospects.csv.' },
          { status: 400 },
        );
      }
      const read = async (field: string): Promise<string | undefined> => {
        const v = form.get(field);
        if (v === null) return undefined;
        if (typeof v === 'string') return v.trim().length > 0 ? v : undefined;
        // An empty file input posts a zero-byte file rather than nothing.
        if (v.size === 0) return undefined;
        if (v.size > CSV_LIMITS.MAX_BYTES) {
          throw new LeagueFileError(
            `${field}.csv is ${(v.size / 1_048_576).toFixed(1)}MB; the maximum is ` +
              `${CSV_LIMITS.MAX_BYTES / 1_048_576}MB.`,
          );
        }
        return v.text();
      };

      const teams = await read('teams');
      if (teams === undefined) {
        return NextResponse.json(
          {
            error:
              'No teams.csv was attached, and a league file cannot be checked without one — it is the file that ' +
              `names the ${FILE_LIMITS.TEAM_COUNT} franchises, their conferences and their divisions. ` +
              'players.csv and prospects.csv are optional.',
          },
          { status: 400 },
        );
      }
      const players = await read('players');
      const prospects = await read('prospects');
      receivedBytes =
        Buffer.byteLength(teams, 'utf8') +
        Buffer.byteLength(players ?? '', 'utf8') +
        Buffer.byteLength(prospects ?? '', 'utf8');

      const bundle: CsvBundle = { teams, players, prospects };
      // 4. The parse. leagueFileFromCsv ends in parseLeagueFile.
      file = leagueFileFromCsv(bundle);
    } else {
      const text = await readCappedBody(req, FILE_LIMITS.MAX_BYTES);
      if (text === null) {
        return NextResponse.json({ error: tooBig(null) }, { status: 413 });
      }
      receivedBytes = Buffer.byteLength(text, 'utf8');
      // 4. The parse.
      file = parseLeagueFile(text);
    }

    return NextResponse.json(
      { ok: true, report: summariseLeagueFile(file, receivedBytes) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    if (err instanceof LeagueFileError) {
      // The author's file, not our fault. This is the endpoint's main output,
      // not its error path, and the message is shown verbatim.
      return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    }
    console.error('League validation failed', err);
    return NextResponse.json(
      { error: 'The file could not be checked. Nothing was saved — try again, or export the file again from the source league.' },
      { status: 500 },
    );
  }
}

/**
 * The same sentence the import route refuses an oversized upload with, because
 * it is the same cap applied to the same file — see FILE_LIMITS.MAX_BYTES.
 */
function tooBig(actual: number | null): string {
  const mb = (FILE_LIMITS.MAX_BYTES / 1_048_576).toFixed(0);
  const seen = actual == null ? '' : ` (this one is ${(actual / 1_048_576).toFixed(1)}MB)`;
  return `That file is too large${seen}. The limit is ${mb}MB — a full 32-team league with complete rosters and a draft class is under 1.5MB.`;
}
