import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { canViewLeague } from '@/lib/owner';
import { exportLeagueFile, leagueFileName, serializeLeagueFile } from '@/lib/leagueFile';
import { assertCostBudget, CostLimitError, costCeiling } from '@/lib/costLimit';

export const dynamic = 'force-dynamic';

/**
 * Downloads a league as a shareable league file (see lib/leagueFile.ts).
 *
 * A GET, not a Server Action, for one reason: a browser has to be able to save
 * the response to disk. A Server Action returns a value into React, and turning
 * a 1.5MB string into a Blob and an <a download> in the client is a worse
 * version of what Content-Disposition already does natively.
 *
 * OWNERSHIP IS ENFORCED HERE, not on some page that links to it. This is a
 * public GET endpoint carrying a league id, and an id is guessable in exactly
 * the way `assertLeagueOwner`'s doc comment warns about — without this check
 * anyone could dump anyone's rosters by walking ids. A league that is not
 * yours is answered 404, identically to a league that does not exist, so the
 * endpoint never confirms which ids are real.
 *
 * AND IT IS METERED, because ownership bounds WHO may ask and not HOW OFTEN.
 * A whole league is serialised per call — 0.75 MB of response body on a
 * first-season save, more every season played, and the read grows with it —
 * and nothing about this endpoint changes state, so a caller holding one
 * legitimate league id can ask for that payload as fast as the platform will
 * answer, for as long as they like, and every answer is billed. See
 * lib/costLimit.ts for the ceiling and for why repetition is a separate
 * problem from the concurrency the leases already cover.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const league = await prisma.league.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, ownerKey: true, userId: true },
  });
  if (!league || !(await canViewLeague(league))) {
    return NextResponse.json({ error: 'League not found.' }, { status: 404 });
  }

  // AFTER the 404, so a stranger walking ids cannot burn somebody else's
  // export budget, and BEFORE the serialisation, which is the expensive part.
  try {
    await assertCostBudget('EXPORT');
  } catch (err) {
    if (err instanceof CostLimitError) {
      return NextResponse.json(
        { error: err.message },
        {
          status: 429,
          // The number the refusal was decided by, not a second one written
          // out here by hand.
          headers: { 'Retry-After': String(Math.ceil(costCeiling('EXPORT').windowMs / 1000)) },
        },
      );
    }
    throw err;
  }

  const file = await exportLeagueFile(league.id);
  const body = serializeLeagueFile(file);

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${leagueFileName(league.name)}"`,
      // A save file is a snapshot of a live league; caching it anywhere would
      // hand back a stale roster after the next trade.
      'Cache-Control': 'no-store',
    },
  });
}
