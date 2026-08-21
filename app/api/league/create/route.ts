import { NextRequest, NextResponse } from 'next/server';
import { createLeague } from '@/lib/gen/league';
import { DEFAULT_SETTINGS, LeagueSettings } from '@/lib/settings';
import { TEAM_SEEDS } from '@/lib/gen/names';
import { prisma } from '@/lib/db';
import { assertCanCreateLeague, ensureOwnerKey, LeagueLimitError } from '@/lib/owner';

/**
 * Programmatic league creation. Nothing in the app calls this — the UI goes
 * through createLeagueAction — but it is a public POST endpoint on a public
 * deployment, so it is a real surface whether or not anything uses it.
 *
 * It previously did the full ~5,300-row generation with no owner key and no
 * limit of any kind. That was worse than an unguarded action in two ways:
 * the leagues it created had ownerKey NULL, which in production makes them
 * invisible to every browser AND undeletable by anyone (see lib/owner.ts), so
 * each call left permanent garbage; and it bypassed the creation caps
 * entirely, which made those caps decorative — a caller who wanted a thousand
 * leagues simply posted here instead.
 *
 * It now goes through exactly the same gate as the UI path and stamps the
 * result, so the route is subject to the same ceilings and its output is a
 * save someone can actually see and delete.
 */
export async function POST(req: NextRequest) {
  try {
    // Route Handlers may write cookies, so the same mint-then-count-then-stamp
    // sequence the server action uses works unchanged here.
    const ownerKey = ensureOwnerKey();
    await assertCanCreateLeague(ownerKey);

    const body = await req.json().catch(() => ({}));
    const userTeamAbbr: string = body.userTeamAbbr || TEAM_SEEDS[0].abbr;
    const leagueName: string = String(body.name || 'My League').slice(0, 60);
    const settings: Partial<LeagueSettings> = { ...DEFAULT_SETTINGS, ...(body.settings ?? {}) };

    const leagueId = await createLeague({ name: leagueName, userTeamAbbr, settings });
    await prisma.league.update({ where: { id: leagueId }, data: { ownerKey } });
    return NextResponse.json({ leagueId });
  } catch (err: any) {
    // A refused creation is a 429, not a 500 — it is the expected answer to a
    // caller asking for more than it may have, and logging it as a server
    // fault would bury the real ones.
    if (err instanceof LeagueLimitError) {
      console.warn('League creation refused by limit:', err.message);
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    console.error('League creation failed', err);
    return NextResponse.json({ error: err?.message ?? 'League creation failed' }, { status: 500 });
  }
}
