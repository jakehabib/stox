import { NextRequest, NextResponse } from 'next/server';
import { assertCanCreateLeague, currentViewer, ensureOwnerKey, LeagueLimitError } from '@/lib/owner';
import { assertCostBudget, CostLimitError, costCeiling } from '@/lib/costLimit';
import { LeagueFileError } from '@/lib/leagueFile';
import { createLeagueFromFile, resolveLeagueName, resolveUserTeamAbbr } from '@/lib/leagueFromFile';
import { CODE_NOT_FOUND, readPublishedFile, resolvePublication } from '@/lib/publication';

export const dynamic = 'force-dynamic';
/** Generation is ~236 round trips. The platform default of 10s is not enough. */
export const maxDuration = 60;

/**
 * ===========================================================================
 * REDEEM — start a league from a share code
 * ===========================================================================
 *
 * NO ACCOUNT IS REQUIRED, and that is a decision rather than an oversight.
 * The recipient was handed a code by a friend and has no reason to trust this
 * site yet; a sign-up wall in front of them is the whole cost of the feature
 * and none of its benefit. Publishing is where the account is required
 * (/api/league/publish), so everything this deployment is holding is
 * attributable even though nothing about redeeming is.
 *
 * SO WHAT GUARDS IT. Four things, and none of them is an identity:
 *
 *   1. THE CODE. 50 bits from a CSPRNG (lib/shareCode.ts) is the access
 *      control, because there is no gallery and no listing — being told the
 *      code is the only way to this league.
 *   2. CODE_LOOKUP, per address and per owner (lib/costLimit.ts). This is what
 *      makes the 50 bits mean something: it bounds how fast codes may be
 *      TRIED, and it is spent on a malformed code exactly as on a real one so
 *      the ceiling cannot be probed for free.
 *   3. THE CREATION CAPS. `assertCanCreateLeague` — the same stock cap every
 *      other way of founding a league is held to.
 *   4. THE CREATE CEILING. The same hourly flow limit /api/league/create and
 *      /api/league/import spend, because this writes the same ~8,830 rows. If
 *      it were missing, the ceiling next door would be decorative and a
 *      create/delete loop would simply come through this door.
 *
 * A WRONG CODE AND A CODE THAT NEVER EXISTED GET THE SAME SENTENCE, from one
 * constant (CODE_NOT_FOUND), with the same status. A code that was taken down
 * and one that expired get it too. An attacker who can tell "that code is real
 * but withdrawn" from "no such code" has an oracle that turns 50 bits of
 * guessing into a map of what exists, and the refusal is the only place that
 * oracle could leak.
 * ===========================================================================
 */
export async function POST(req: NextRequest) {
  // 1. Who is asking. Minted first so the creation count and the ownership
  //    stamp agree, exactly as in /api/league/create and /api/league/import.
  const ownerKey = ensureOwnerKey();
  const viewer = { ...(await currentViewer()), ownerKey };

  let code: unknown;
  let wantedTeam: unknown;
  let wantedName: unknown;
  try {
    const body = await req.json();
    code = (body as { code?: unknown })?.code;
    wantedTeam = (body as { team?: unknown })?.team;
    wantedName = (body as { name?: unknown })?.name;
  } catch {
    return NextResponse.json({ error: 'That request was not readable. Try again.' }, { status: 400 });
  }

  // 2. The guess ceiling, spent BEFORE the lookup and before the code is even
  //    checked for shape. A malformed code costs the same as a real one; if it
  //    were free, an attacker could filter their guesses against this endpoint
  //    for nothing and only spend budget on the ones that got past the parser.
  try {
    await assertCostBudget('CODE_LOOKUP', viewer);
  } catch (err) {
    if (err instanceof CostLimitError) {
      return NextResponse.json(
        { error: err.message },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(costCeiling('CODE_LOOKUP').windowMs / 1000)) } },
      );
    }
    throw err;
  }

  // 3. May they create a league at all? Before the file is decompressed, so a
  //    caller who is at their stock cap does not cost us the gunzip.
  try {
    await assertCanCreateLeague(viewer);
  } catch (err) {
    if (err instanceof LeagueLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }

  // 4. The code. `resolvePublication` has exactly one negative answer.
  const preview = await resolvePublication(code);
  if (!preview) {
    return NextResponse.json({ error: CODE_NOT_FOUND }, { status: 404 });
  }

  try {
    // The stored bytes, re-validated through the same reader an upload goes
    // through — see readPublishedFile for why storing it once is not a reason
    // to trust it twice.
    const file = await readPublishedFile(preview.code);
    if (!file) {
      // Withdrawn or swept between the resolve and here. Same sentence.
      return NextResponse.json({ error: CODE_NOT_FOUND }, { status: 404 });
    }

    // 5. The flow ceiling, spent only once there is a real league to write.
    try {
      await assertCostBudget('CREATE', viewer);
    } catch (err) {
      if (err instanceof CostLimitError) {
        return NextResponse.json(
          { error: err.message },
          { status: 429, headers: { 'Retry-After': String(Math.ceil(costCeiling('CREATE').windowMs / 1000)) } },
        );
      }
      throw err;
    }

    const leagueId = await createLeagueFromFile({
      file,
      name: resolveLeagueName(file, wantedName),
      userTeamAbbr: resolveUserTeamAbbr(file, wantedTeam),
      viewer,
      ownerKey,
      source: 'redeemed',
    });
    return NextResponse.json({ leagueId });
  } catch (err) {
    if (err instanceof LeagueFileError) {
      // A stored file this build will no longer read. The recipient cannot act
      // on the detail, but the publisher can, so it is named rather than
      // swallowed into a 500.
      return NextResponse.json(
        {
          error:
            'That league was published in a format this version can no longer read. Ask whoever shared it to '
            + `publish it again. (${err.message})`,
        },
        { status: 400 },
      );
    }
    if (err instanceof LeagueLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    console.error('Redeem failed', err);
    return NextResponse.json(
      { error: 'The league could not be created. Nothing was saved — try the code again shortly.' },
      { status: 500 },
    );
  }
}
