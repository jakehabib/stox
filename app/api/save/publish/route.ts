import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { currentViewer, ownsLeague } from '@/lib/owner';
import { assertCostBudget, CostLimitError, costCeiling } from '@/lib/costLimit';
import { SAVE_LIMITS } from '@/lib/saveFile';
import { exportSaveFile } from '@/lib/saveExport';
import {
  ChallengePublishError,
  MAX_CHALLENGES_PER_USER,
  PUBLICATION_RETENTION_MONTHS,
  deleteChallenge,
  publishChallenge,
} from '@/lib/savePublication';
import { sweepExpiredPublications } from '@/lib/publication';
import { formatShareCode } from '@/lib/shareCode';

export const dynamic = 'force-dynamic';
/**
 * A publish reads twenty-two tables, serialises up to 48MB and gzips it.
 * Measured on a three-season save: 785ms to read and build the document,
 * 2.1MB stored from 17.8MB. The platform default of ten seconds is not a
 * margin, it is a coin toss.
 *
 * SIXTY, NOT MORE, and the reason is the deploy rather than the work. Every
 * other route in this app declares 60, which is the ceiling some Vercel plans
 * enforce — a build that asks for 300 on such a plan is REJECTED, so a bigger
 * number here would be a feature that cannot ship in exchange for headroom
 * the measurement says is not needed. The residual is named in the handover:
 * a challenge an order of magnitude deeper than anything measured could run
 * out of time here, and the honest answer for that save is that it is too big
 * to publish.
 */
export const maxDuration = 60;

/**
 * ===========================================================================
 * PUBLISH A CHALLENGE — turn a save into a code, and withdraw one again
 * ===========================================================================
 *
 * POST issues a code for a save the caller owns. DELETE withdraws a code the
 * caller published. Both are POST-shaped mutations on a public URL, so neither
 * trusts anything about the request except what it proves here.
 *
 * AN ACCOUNT IS REQUIRED TO PUBLISH AND NOTHING IS REQUIRED TO REDEEM, the
 * same asymmetry the league-file path uses and for the same reason: the
 * recipient is the person whose patience is scarce, and the publisher is the
 * person who has to be attributable if what they published is a problem. A
 * challenge makes that argument stronger rather than weaker — it is twenty
 * times the disk.
 *
 * TWO IDS ARRIVE AND BOTH ARE PROVEN. The league id is proven through
 * `ownsLeague`, the predicate every other guard in this app routes through, so
 * a save this browser's cookie happens to hold but which belongs to another
 * account is refused. On DELETE the code is proven by deleting on
 * (code, userId, kind) in one statement, so there is no gap between the proof
 * and the act.
 *
 * REFUSALS DO NOT CONFIRM WHICH IDS EXIST. A save that is not yours is 404,
 * identically to one that does not exist.
 *
 * WHAT THE PUBLISHER CHOOSES, and why each is here rather than inferred:
 *   `title` and `brief` — the framing. A challenge is not "my dynasty", it is
 *     "you are 2-9 with no cap room". Nothing can infer that sentence.
 *   `history` — whether the retrospective tables travel. It is most of the
 *     file size and it is the publisher's call, not a default.
 * ===========================================================================
 */
export async function POST(req: NextRequest) {
  // 1. An account, before anything else is read. The gate the whole tier hangs
  //    on, and the cheapest check on the route.
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      {
        error:
          'Publishing a challenge under a code needs an account — the office has to know whose save it is '
          + 'holding, and who to go to if it has to come down.',
      },
      { status: 401 },
    );
  }

  // 2. What was asked for. A body that is not JSON is the caller's error.
  let leagueId: unknown;
  let title: unknown;
  let brief: unknown;
  let history: unknown;
  try {
    const body = await req.json();
    leagueId = (body as { leagueId?: unknown })?.leagueId;
    title = (body as { title?: unknown })?.title;
    brief = (body as { brief?: unknown })?.brief;
    history = (body as { history?: unknown })?.history;
  } catch {
    return NextResponse.json({ error: 'That request was not readable. Try again.' }, { status: 400 });
  }
  if (typeof leagueId !== 'string' || leagueId.length === 0 || leagueId.length > 64) {
    return NextResponse.json({ error: 'No save was named.' }, { status: 400 });
  }
  // The two strings are BOUNDED HERE as well as trimmed by the exporter, for
  // the reason every other public endpoint bounds its inputs: a 10MB title is
  // not a typo, and the work of reading it should not be done at all.
  if (typeof title !== 'string' || typeof brief !== 'string'
    || title.length > SAVE_LIMITS.MAX_CHALLENGE_TITLE * 4
    || brief.length > SAVE_LIMITS.MAX_CHALLENGE_BRIEF * 4) {
    return NextResponse.json(
      { error: 'A challenge needs a title and a brief — what the situation is, and what the job is.' },
      { status: 400 },
    );
  }
  const titled = title.replace(/\s+/g, ' ').trim();
  if (titled.length === 0) {
    return NextResponse.json(
      { error: 'A challenge needs a title. Name the situation: "2-9, no cap room, no first-rounder".' },
      { status: 400 },
    );
  }

  // 3. Is the save theirs? Read the ownership columns and apply THE predicate.
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, ownerKey: true, userId: true },
  });
  const viewer = await currentViewer();
  if (!league || !ownsLeague(league, viewer)) {
    return NextResponse.json({ error: 'Save not found.' }, { status: 404 });
  }

  // 3b. IS IT A CHALLENGE AT ALL? A challenge is a specific job — this club,
  //     this record, this cap sheet — so a save with no club flagged as the
  //     GM's is not one. That state is reachable (a harness league, a save
  //     mid-repair), it exports as a null club, and the recipient's card would
  //     have nothing to put in the one field the whole offer is about.
  const hasClub = await prisma.team.count({ where: { leagueId: league.id, isUser: true } });
  if (hasClub !== 1) {
    return NextResponse.json(
      {
        error: hasClub === 0
          ? 'No club in that save is yours to hand over, so there is no job to offer. Open the save and take a '
            + 'club first.'
          : `That save has ${hasClub} clubs flagged as yours, which is not a situation anybody can be handed.`,
      },
      { status: 400 },
    );
  }

  // 4. The hourly ceiling, AFTER the 404 so a stranger walking ids cannot burn
  //    somebody else's budget, and BEFORE the export, which is the expensive
  //    part. Same ordering as /api/league/publish.
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
    const file = await exportSaveFile(league.id, {
      includeHistory: history !== false,
      title: titled,
      brief,
    });
    const { code, fileBytes, storedBytes } = await publishChallenge({
      file,
      userId: user.id,
      sourceLeagueId: league.id,
    });

    // The sweep rides on the write path rather than a scheduler this
    // deployment does not have (see lib/publication.ts). After the publish, so
    // a slow sweep cannot cost the publisher their code, and shared with the
    // league-file path because retention is a property of a row.
    const swept = await sweepExpiredPublications().catch(() => 0);
    console.info(
      `Challenge published: ${league.id} -> code, ${fileBytes} bytes stored as ${storedBytes}`
      + (swept > 0 ? `; swept ${swept} expired publication(s)` : ''),
    );

    return NextResponse.json({
      code,
      display: formatShareCode(code),
      path: `/c/${code}`,
      fileBytes,
      storedBytes,
      carriesHistory: file.history != null,
      retentionMonths: PUBLICATION_RETENTION_MONTHS,
      heldLimit: MAX_CHALLENGES_PER_USER,
    });
  } catch (err) {
    if (err instanceof ChallengePublishError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    console.error('Challenge publish failed', err);
    return NextResponse.json(
      { error: 'The challenge could not be filed. Nothing was published — try again shortly.' },
      { status: 500 },
    );
  }
}

/**
 * Withdraws a challenge code. The publisher's own lifecycle control.
 *
 * A code that was not this account's, a code of the other kind, and a code
 * that never existed all get the same answer — so this cannot be used to find
 * out whether a code is real.
 */
export async function DELETE(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to manage the challenges you have published.' }, { status: 401 });
  }

  let code: unknown;
  try {
    const body = await req.json();
    code = (body as { code?: unknown })?.code;
  } catch {
    return NextResponse.json({ error: 'That request was not readable. Try again.' }, { status: 400 });
  }

  // Metered as a lookup: this is a second way to test whether a code exists,
  // and it must not be the cheap one.
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

  const gone = await deleteChallenge(typeof code === 'string' ? code : '', user.id);
  if (!gone) {
    return NextResponse.json({ error: 'No challenge of yours matches that. Nothing was changed.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
