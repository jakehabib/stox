import { NextRequest, NextResponse } from 'next/server';
import {
  FILE_LIMITS,
  LeagueFileError,
  estimateWriteCost,
  leagueFileName,
  serializeLeagueFile,
} from '@/lib/leagueFile';
import { CSV_LIMITS, CsvBundle, leagueFileFromCsv } from '@/lib/leagueCsv';
import { ensureOwnerKey, currentViewer } from '@/lib/owner';
import { assertCostBudget, CostLimitError, costCeiling } from '@/lib/costLimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * ===========================================================================
 * CSV -> LEAGUE FILE — the converter, and nothing else
 * ===========================================================================
 *
 * Takes the three spreadsheets an author built their league in and hands back
 * the league file they describe, as a download. IT WRITES NOTHING. Importing
 * is still /api/league/import and still takes JSON, which means:
 *
 *   - there is one import path and one validator, not two;
 *   - the author gets the actual document before anything is created, can read
 *     it, diff it, keep it, and send it to the eight people who filled in the
 *     sheet with them;
 *   - every limit and every bound that guards the import guards this too,
 *     because this route's output is that route's input.
 *
 * A refusal here is the author's file, not our fault: 400, with the message
 * written to be shown verbatim. lib/leagueCsv.ts rewrites every document path
 * into the CSV row that produced it before it gets here.
 *
 * AND IT IS METERED, BECAUSE "WRITES NOTHING" IS NOT "COSTS NOTHING". This
 * route is unauthenticated and buffers a multipart upload of up to
 * FILE_LIMITS.MAX_BYTES before it can look at it, then runs the whole CSV
 * parse and parseLeagueFile over what arrived. No league, no rows — so it is
 * priced like the other endpoint that cuts a file (EXPORT) rather than like a
 * founding, under its own CSV_CONVERT ceiling: sixty an hour per owner. An
 * author iterating on a 1,700-row spreadsheet converts it a dozen times in an
 * afternoon and must not be stopped by the thing that exists to stop a loop,
 * which is exactly why it is NOT held to CREATE's twelve. See lib/costLimit.ts.
 *
 * THE CEILING SITS BEHIND THE CONTENT-LENGTH CHECK, not in front of it. A
 * claimed size over the cap is refused without reading a body or touching the
 * database, and spending two writes on the counter to answer it would make the
 * cheapest refusal on the route the most expensive one.
 *
 * MULTIPART, AND THE SIZE CHECK COMES FIRST. `req.formData()` buffers the
 * whole upload before it returns, so the Content-Length check above it is
 * load-bearing in a way it is not on the import route (which streams and
 * counts bytes itself — see readCapped there). Three CSVs of a full league
 * measure well under half what the JSON they become does, so the same ceiling
 * is generous here.
 */
export async function POST(req: NextRequest) {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > CSV_LIMITS.MAX_BYTES) {
    return NextResponse.json(
      {
        error:
          `That upload is ${(declared / 1_048_576).toFixed(1)}MB; the limit is ` +
          `${CSV_LIMITS.MAX_BYTES / 1_048_576}MB. A full 32-team league's CSVs are well under 1MB.`,
      },
      { status: 413 },
    );
  }

  // Minted before the count, so the bucket this call is counted in is the
  // bucket the next one will be — same mint-then-count sequence as the create
  // and import routes. Without it every cookieless browser shares one counter.
  const ownerKey = ensureOwnerKey();
  try {
    await assertCostBudget('CSV_CONVERT', { ...(await currentViewer()), ownerKey });
  } catch (err) {
    if (err instanceof CostLimitError) {
      return NextResponse.json(
        { error: err.message },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(costCeiling('CSV_CONVERT').windowMs / 1000)) } },
      );
    }
    throw err;
  }

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

  try {
    const teams = await read('teams');
    if (teams === undefined) {
      return NextResponse.json(
        {
          error:
            'No teams.csv was attached, and a league file cannot be built without one — it is the file that ' +
            `names the ${FILE_LIMITS.TEAM_COUNT} franchises, their conferences and their divisions. ` +
            'players.csv and prospects.csv are optional; leave them off and rosters and the draft class are generated.',
        },
        { status: 400 },
      );
    }

    const url = new URL(req.url);
    const intOrUndefined = (key: string): number | undefined => {
      const raw = url.searchParams.get(key);
      if (raw === null || raw.trim() === '') return undefined;
      const n = Number(raw);
      // Bounds are parseLeagueFile's; this only refuses what is not a number,
      // so a garbage query string cannot reach the document as NaN.
      return Number.isFinite(n) && Number.isInteger(n) ? n : undefined;
    };

    const bundle: CsvBundle = {
      teams,
      players: await read('players'),
      prospects: await read('prospects'),
      name: url.searchParams.get('name') ?? undefined,
      draftYear: intOrUndefined('draftYear'),
      classStrength: intOrUndefined('classStrength'),
    };

    const file = leagueFileFromCsv(bundle);
    const body = serializeLeagueFile(file);
    const cost = estimateWriteCost(file);
    console.info(
      `CSV converted: ${cost.teams} teams, ${cost.players} players, ` +
        `${(Buffer.byteLength(body, 'utf8') / 1_048_576).toFixed(2)}MB league file.`,
    );

    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${leagueFileName(file.name)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    if (err instanceof LeagueFileError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('CSV conversion failed', err);
    return NextResponse.json(
      { error: 'The league file could not be built from those CSVs. Nothing was saved — check the files and try again.' },
      { status: 500 },
    );
  }
}
