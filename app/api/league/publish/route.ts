import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { currentViewer, ownsLeague } from '@/lib/owner';
import { assertCostBudget, CostLimitError, costCeiling } from '@/lib/costLimit';
import { exportLeagueFile } from '@/lib/leagueFile';
import {
  PUBLICATION_RETENTION_MONTHS,
  PublicationError,
  deletePublication,
  publishLeagueFile,
  sweepExpiredPublications,
} from '@/lib/publication';
import { formatShareCode } from '@/lib/shareCode';

export const dynamic = 'force-dynamic';
/** A publish cuts a full export and gzips it. The platform default is tight. */
export const maxDuration = 60;

/**
 * ===========================================================================
 * PUBLISH — turn a save into a share code, and withdraw one again
 * ===========================================================================
 *
 * POST issues a code for a league the caller owns. DELETE withdraws a code the
 * caller published. Both are POST-shaped mutations on a public URL, so neither
 * trusts a thing about the request except what it proves here.
 *
 * AN ACCOUNT IS REQUIRED TO PUBLISH, and this is where that is enforced.
 * Nothing about the mechanics needs one — a cookie-owned save is a save — but
 * a code puts this deployment in the position of hosting a stranger's file
 * under a name somebody can hand around, and the one thing that has to be true
 * of that is that there is an account to answer for it, to withdraw it, and to
 * count it against a cap that cannot be reset by clearing a cookie. See
 * lib/publication.ts for the asymmetry argument; redeeming requires nothing.
 *
 * TWO IDS ARRIVE AND BOTH ARE PROVEN. The league id is proven to be the
 * caller's through `ownsLeague`, the same predicate every other guard in the
 * app routes through — a signed-in viewer matches on the ACCOUNT, so a save
 * this browser's cookie happens to hold but which belongs to someone else's
 * account is refused. On DELETE the code is proven by deleting on (code,
 * userId) in one statement, so there is no gap between the proof and the act.
 *
 * REFUSALS DO NOT CONFIRM WHICH IDS EXIST. A league that is not yours is 404,
 * identically to a league that does not exist — the same answer
 * /api/league/export gives, and for the same reason: a cuid is not a secret
 * and without this an id walk would map the database.
 * ===========================================================================
 */
export async function POST(req: NextRequest) {
  // 1. An account, before anything else is read. This is the gate the whole
  //    tier hangs on, and it is the cheapest check on the route.
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      {
        error:
          'Publishing a league under a code needs an account — the office has to know whose file it is holding. '
          + 'Export the league file instead and send it however you like; nothing is stored for that.',
      },
      { status: 401 },
    );
  }

  // 2. What was asked for. A body that is not JSON is the caller's error.
  let leagueId: unknown;
  try {
    const body = await req.json();
    leagueId = (body as { leagueId?: unknown })?.leagueId;
  } catch {
    return NextResponse.json({ error: 'That request was not readable. Try again.' }, { status: 400 });
  }
  if (typeof leagueId !== 'string' || leagueId.length === 0 || leagueId.length > 64) {
    return NextResponse.json({ error: 'No league was named.' }, { status: 400 });
  }

  // 3. Is it theirs? Read the ownership columns and apply THE predicate.
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, ownerKey: true, userId: true },
  });
  const viewer = await currentViewer();
  if (!league || !ownsLeague(league, viewer)) {
    return NextResponse.json({ error: 'League not found.' }, { status: 404 });
  }

  // 4. The hourly ceiling, AFTER the 404 so a stranger walking ids cannot burn
  //    somebody else's budget, and BEFORE the export, which is the expensive
  //    part. Same ordering as /api/league/export.
  try {
    await assertCostBudget('PUBLISH', viewer);
  } catch (err) {
    if (err instanceof CostLimitError) {
      return NextResponse.json(
        { error: err.message },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(costCeiling('PUBLISH').windowMs / 1000)) } },
      );
    }
    throw err;
  }

  try {
    const file = await exportLeagueFile(league.id);
    const { code, fileBytes, storedBytes } = await publishLeagueFile({
      file,
      userId: user.id,
      sourceLeagueId: league.id,
    });

    // The sweep rides on the write path rather than a scheduler this
    // deployment does not have (see lib/publication.ts). After the publish, so
    // a slow sweep cannot cost the publisher their code.
    const swept = await sweepExpiredPublications().catch(() => 0);
    console.info(
      `League published: ${league.id} -> code, ${fileBytes} bytes stored as ${storedBytes}`
      + (swept > 0 ? `; swept ${swept} expired publication(s)` : ''),
    );

    return NextResponse.json({
      code,
      display: formatShareCode(code),
      path: `/l/${code}`,
      fileBytes,
      retentionMonths: PUBLICATION_RETENTION_MONTHS,
    });
  } catch (err) {
    if (err instanceof PublicationError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    console.error('League publish failed', err);
    return NextResponse.json(
      { error: 'The league could not be filed. Nothing was published — try again, or export the file instead.' },
      { status: 500 },
    );
  }
}

/**
 * Withdraws a code. The publisher's own lifecycle control (rule 1 of the four
 * in lib/publication.ts).
 *
 * A code that was not this account's, and a code that never existed, get the
 * same answer — so this cannot be used to find out whether a code is real.
 */
export async function DELETE(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to manage the codes you have published.' }, { status: 401 });
  }

  let code: unknown;
  try {
    const body = await req.json();
    code = (body as { code?: unknown })?.code;
  } catch {
    return NextResponse.json({ error: 'That request was not readable. Try again.' }, { status: 400 });
  }

  // Metered as a lookup: this is a second way to test whether a code exists,
  // and it must not be the cheap one. Counted against the caller's account,
  // which they have, so there is no anonymous bucket in play here.
  try {
    await assertCostBudget('CODE_LOOKUP');
  } catch (err) {
    if (err instanceof CostLimitError) {
      return NextResponse.json(
        { error: err.message },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(costCeiling('CODE_LOOKUP').windowMs / 1000)) } },
      );
    }
    throw err;
  }

  const gone = await deletePublication(typeof code === 'string' ? code : '', user.id);
  if (!gone) {
    return NextResponse.json({ error: 'No code of yours matches that. Nothing was changed.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
