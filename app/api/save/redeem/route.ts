import { NextRequest, NextResponse } from 'next/server';
import { assertCanCreateLeague, currentViewer, ensureOwnerKey, LeagueLimitError } from '@/lib/owner';
import { assertCostBudget, CostLimitError, costCeiling } from '@/lib/costLimit';
import { SAVE_LIMITS, SaveFileError } from '@/lib/saveFile';
/**
 * THE NAME SANITISER IS SHARED, NOT COPIED. A save's name is rendered by the
 * same components in the same places as a league file's, so it is held to the
 * same rules by the same function rather than by a second one that would drift
 * from it. This is the only thing the challenge path borrows from the
 * league-file path, and it is a pure string function with no reader attached.
 */
import { sanitiseDisplayName } from '@/lib/leagueFile';
import { SaveImportError, importSaveFile } from '@/lib/saveImport';
import { CHALLENGE_NOT_FOUND, readPublishedChallenge, resolveChallenge } from '@/lib/savePublication';

export const dynamic = 'force-dynamic';
/**
 * A redemption decompresses up to 48MB, validates it, writes roughly fifty
 * thousand rows and runs the full invariant suite — all inside one
 * transaction. Measured on a three-season save: 150ms to parse, 2.4-3.0s
 * inside the transaction, gate included. The platform default of ten seconds
 * would fail the feature on any save worth sharing.
 *
 * SIXTY, NOT MORE, for the reason given on /api/save/publish: 60 is what every
 * other route here declares and what some Vercel plans will accept, and a
 * build that asks for more is rejected outright on those plans. The
 * transaction's own timeout (lib/saveImport.ts) is longer, deliberately — if
 * the request is cut off the transaction is rolled back, which is the same
 * outcome as any other failure on this path: nothing written.
 */
export const maxDuration = 60;

/**
 * ===========================================================================
 * REDEEM — take the job
 * ===========================================================================
 *
 * NO ACCOUNT IS REQUIRED, the same decision the league-file path makes and for
 * the same reason: the recipient was handed a code by a friend and has no
 * reason to trust this site yet, so a sign-up wall in front of them is the
 * whole cost of the feature and none of its benefit. Publishing is where the
 * account is required (/api/save/publish), so everything this deployment is
 * holding is attributable even though nothing about redeeming is.
 *
 * SO WHAT GUARDS IT. Five things, and none of them is an identity:
 *
 *   1. THE CODE. Fifty bits from a CSPRNG (lib/shareCode.ts). There is no
 *      gallery and no listing, by decision, so being told the code is the only
 *      way to a published challenge.
 *   2. CODE_LOOKUP, per address and per owner (lib/costLimit.ts). This is what
 *      makes the fifty bits mean something: it bounds how fast codes may be
 *      TRIED, and it is spent on a malformed code exactly as on a real one so
 *      the ceiling cannot be probed for free.
 *   3. THE CREATION CAPS. `assertCanCreateLeague` — the same stock cap every
 *      other way of founding a save is held to.
 *   4. THE CREATE CEILING. The same hourly flow limit /api/league/create and
 *      /api/league/import spend. This path writes MORE rows than either, so if
 *      it were missing the ceiling next door would be decorative and a
 *      create/delete loop would simply come through this door.
 *   5. THE INVARIANT GATE, inside the import's own transaction
 *      (lib/saveImport.ts). This is the one guard that is about the FILE
 *      rather than the caller, and it is the reason a challenge cannot be used
 *      to put an unplayable league into the database.
 *
 * A WRONG CODE AND A CODE THAT NEVER EXISTED GET THE SAME SENTENCE, from one
 * constant (CHALLENGE_NOT_FOUND), with the same status — as do a withdrawn
 * one, an expired one, and a league-file code handed to the challenge door.
 * An attacker who can tell "real but withdrawn" from "no such code" has an
 * oracle that turns fifty bits of guessing into a map of what exists.
 * ===========================================================================
 */
export async function POST(req: NextRequest) {
  // 1. Who is asking. Minted first so the creation count and the ownership
  //    stamp agree, exactly as in /api/league/create and /api/league/redeem.
  const ownerKey = ensureOwnerKey();
  const viewer = { ...(await currentViewer()), ownerKey };

  let code: unknown;
  let wantedName: unknown;
  let wantedTeam: unknown;
  try {
    const body = await req.json();
    code = (body as { code?: unknown })?.code;
    wantedName = (body as { name?: unknown })?.name;
    wantedTeam = (body as { team?: unknown })?.team;
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

  // 3. May they create a save at all? Before the file is decompressed, so a
  //    caller who is at their stock cap does not cost us the gunzip of fifteen
  //    megabytes.
  try {
    await assertCanCreateLeague(viewer);
  } catch (err) {
    if (err instanceof LeagueLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }

  // 4. The code. `resolveChallenge` has exactly one negative answer.
  const preview = await resolveChallenge(code);
  if (!preview) {
    return NextResponse.json({ error: CHALLENGE_NOT_FOUND }, { status: 404 });
  }

  // 5. The club. A challenge is a specific job, so the file's own choice is
  //    the default and an override is only honoured if it names a real club.
  //    A number arriving from a browser is held to being a real index rather
  //    than trusted to be one.
  const team = typeof wantedTeam === 'number' && Number.isInteger(wantedTeam)
    && wantedTeam >= 0 && wantedTeam < SAVE_LIMITS.TEAM_COUNT
    ? wantedTeam
    : null;

  try {
    // The stored bytes, re-validated through the same reader and the same
    // migration chain an upload would go through — see readPublishedChallenge
    // for why storing it once is not a reason to trust it twice.
    const file = await readPublishedChallenge(preview.code);
    if (!file) {
      // Withdrawn or swept between the resolve and here. Same sentence.
      return NextResponse.json({ error: CHALLENGE_NOT_FOUND }, { status: 404 });
    }

    // 6. The flow ceiling, spent only once there is a real save to write.
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

    const { leagueId, warnings } = await importSaveFile({
      file,
      name: sanitiseDisplayName(wantedName, SAVE_LIMITS.MAX_LEAGUE_NAME) ?? file.league.name,
      userTeam: team,
      viewer,
      ownerKey,
      source: 'redeemed',
    });
    return NextResponse.json({ leagueId, warnings: warnings.map((w) => w.id) });
  } catch (err) {
    // THE GATE'S OWN REFUSAL, passed through rather than swallowed into a 500.
    // It names the invariants that failed, because the only person who can fix
    // the file is whoever published it, and it says plainly that nothing was
    // written — which is the first thing anybody wants to know.
    if (err instanceof SaveImportError) {
      return NextResponse.json({ error: err.message, violations: err.violations.map((v) => v.id) }, { status: 422 });
    }
    if (err instanceof SaveFileError) {
      // A stored challenge this build will no longer read. The recipient
      // cannot act on the detail; the publisher can, so it is named.
      return NextResponse.json(
        {
          error:
            'That challenge was published in a format this version can no longer read. Ask whoever shared it '
            + `to publish it again. (${err.message})`,
        },
        { status: 400 },
      );
    }
    if (err instanceof LeagueLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    console.error('Challenge redeem failed', err);
    return NextResponse.json(
      { error: 'The save could not be created. Nothing was written — try the code again shortly.' },
      { status: 500 },
    );
  }
}
