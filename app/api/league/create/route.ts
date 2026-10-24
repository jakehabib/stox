import { NextRequest, NextResponse } from 'next/server';
import { createLeague } from '@/lib/gen/league';
import { DEFAULT_SETTINGS, sanitiseCreateSettings } from '@/lib/settings';
import { TEAM_SEEDS } from '@/lib/gen/names';
import { prisma } from '@/lib/db';
import { assertCanCreateLeague, currentViewer, ensureOwnerKey, LeagueLimitError } from '@/lib/owner';
import { assertCostBudget, CostLimitError, costCeiling } from '@/lib/costLimit';

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
 *
 * AND IT NO LONGER TAKES DICTATION ABOUT THE LEAGUE IT BUILDS. The `settings`
 * object in the body used to be spread over the defaults unvalidated, which
 * made every field of LeagueSettings caller-controlled on an endpoint that
 * needs no account — `seasonLength` among them, and that one is handed
 * straight to `buildSchedule`. See sanitiseCreateSettings in lib/settings.ts
 * for the four founding choices that survive and why the rest are dropped
 * rather than clamped. `userTeamAbbr` is held to the same standard: it has to
 * name a club that exists.
 */
export async function POST(req: NextRequest) {
  try {
    // Route Handlers may write cookies, so the same mint-then-count-then-stamp
    // sequence the server action uses works unchanged here.
    const ownerKey = ensureOwnerKey();
    const viewer = { ...(await currentViewer()), ownerKey };
    await assertCanCreateLeague(viewer);
    // The stock cap above says how many saves may exist; this says how fast
    // they may be churned, which a create/delete loop otherwise ignores
    // entirely. Same ceiling the UI path is held to — see lib/costLimit.ts.
    await assertCostBudget('CREATE', viewer);

    const body = await req.json().catch(() => ({}));
    // A club that is not in the table is not a choice. `createLeague` falls
    // back to the first seed on its own, but doing it here means the answer
    // is the same whether the body named nothing or named nonsense.
    const wanted = String(body.userTeamAbbr ?? '').trim().toUpperCase();
    const userTeamAbbr: string = TEAM_SEEDS.some((t) => t.abbr === wanted) ? wanted : TEAM_SEEDS[0].abbr;
    const leagueName: string = String(body.name || 'My League').slice(0, 60);
    const settings = { ...DEFAULT_SETTINGS, ...sanitiseCreateSettings(body.settings) };

    const leagueId = await createLeague({ name: leagueName, userTeamAbbr, settings });
    await prisma.league.update({ where: { id: leagueId }, data: { ownerKey, userId: viewer.userId } });
    return NextResponse.json({ leagueId });
  } catch (err: any) {
    // A refused creation is a 429, not a 500 — it is the expected answer to a
    // caller asking for more than it may have, and logging it as a server
    // fault would bury the real ones.
    // An hourly ceiling is the same KIND of answer as the stock cap next door
    // — "not this much, not from you" — so it gets the same 429, plus the
    // window it was decided by rather than a second number written by hand.
    if (err instanceof CostLimitError) {
      return NextResponse.json(
        { error: err.message },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(costCeiling('CREATE').windowMs / 1000)) } },
      );
    }
    if (err instanceof LeagueLimitError) {
      console.warn('League creation refused by limit:', err.message);
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    // THE SENTENCE THE CALLER GETS IS WRITTEN HERE, not taken off the error.
    // `err.message` on this path is a Prisma invocation — a rendered query and
    // an absolute file path — and it was returned verbatim. The operator gets
    // the detail in the log; the caller gets something true and useless.
    console.error('League creation failed', err);
    return NextResponse.json(
      { error: 'The league could not be created. Nothing was saved — try again in a moment.' },
      { status: 500 },
    );
  }
}
