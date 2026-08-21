import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { canViewLeague } from '@/lib/owner';
import { exportLeagueFile, leagueFileName, serializeLeagueFile } from '@/lib/leagueFile';

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
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const league = await prisma.league.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, ownerKey: true, userId: true },
  });
  if (!league || !(await canViewLeague(league))) {
    return NextResponse.json({ error: 'League not found.' }, { status: 404 });
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
