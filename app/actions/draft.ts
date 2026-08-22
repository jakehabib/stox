'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertLeagueOwner } from '@/lib/owner';
import { draftPlayer, runAiPicksUntilUser, draftOneAiPick } from '@/lib/draft';
import { Rng } from '@/lib/rng';

/**
 * Make the user's pick — HIS PICK, AND NOT ONE SELECTION MORE.
 *
 * The rookie contract is real cap money, so this can be refused by the salary
 * cap (see draftPlayer in lib/draft.ts) — a foreseeable, user-recoverable
 * outcome that must come back as a message rather than an uncaught throw,
 * which in Next blanks the draft screen instead of saying what happened.
 *
 * WHY THERE IS NO runAiPicksUntilUser CALL HERE ANY MORE.
 *
 * There used to be one, right after the pick landed, and the app owner
 * described exactly what it felt like: *"once again after i made my pick, it
 * just skipped to my next pick in the draft. HUGE glitch"*.
 *
 * It was doing precisely that. The user takes his man at #17 and the same
 * server round-trip runs every AI selection between there and his next turn —
 * so the board he came back to was already thirty-one picks later, and the
 * twenty-plus clubs that went in between never appeared on his screen at all.
 * The one night of the year that is supposed to be watched happened inside a
 * function call.
 *
 * LiveDraftTicker exists to pace those selections one at a time
 * (draftOneAiPickAction, one pick per tick), and this batch call was silently
 * overtaking it. The user's pick now advances the clock by exactly one
 * selection — DraftState is already advanced by draftPlayer — and the ticker
 * picks the draft back up from there. See the note about dismissal below: that
 * refresh is what re-arms it.
 *
 * "Skip ahead" is still available, but only where the owner asked for it: the
 * Fast Forward button on the ticker (advanceToUserPickAction), pressed on
 * purpose.
 */
export async function draftPlayerAction(leagueId: string, playerId: string, teamId: string) {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  try {
    await draftPlayer({ leagueId, playerId, teamId, seasonYear: league.seasonYear });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'That pick could not be made.' };
  }

  /*
   * NO revalidatePath HERE, AND THAT IS THE WHOLE FIX FOR THE VANISHING CARD.
   *
   * The app owner: *"the pick confirmation popup literally pops up for a
   * microsecond before disappearing"*.
   *
   * The card is raised from inside the drafted player's own board row, which
   * is the one row guaranteed to be gone a moment after the pick. The design
   * (see DraftMomentProvider, which is where the card is actually rendered)
   * holds the board refresh until the card is dismissed, precisely so nothing
   * unmounts underneath it.
   *
   * This line then did the refresh anyway. Inside the same startTransition as
   * the action call, the revalidation lands before the card can paint, the row
   * unmounts, and the card dies in a frame. The comment described a policy the
   * code did not follow, which is the same failure this codebase treats as a
   * bug in its own right.
   *
   * Nothing goes stale, and nothing stalls: dismissing the card calls
   * router.refresh(), which re-renders the layout and every server component
   * on it. That is also the moment LiveDraftTicker sees `isUserOnClock` go
   * false and starts the next club's clock, so the draft moves on without the
   * user pressing anything else. The refresh is deferred, not dropped.
   */
  return { ok: true, message: 'Pick is in.' };
}

/**
 * Open the rookie draft. Nothing on the draft page moves until this has been
 * called: startRookieDraft (lib/draft.ts) writes DraftState with
 * `started: false` when free agency closes, so the board, the order and the
 * GM's own picks are all set and visible while the clock is still stopped.
 *
 * The owner's report was *"it autostarted without me knowing"* — the phase
 * flipped on a week advance and the ticker began burning first-round picks the
 * instant the page rendered.
 *
 * COMPARE-AND-SET, not read-then-write. Two clicks on a button that sits under
 * a full-page render is the ordinary case, not the exotic one, and this app has
 * been bitten before by both halves of a double-submit passing the same read.
 * `updateMany` with `started: false` in the WHERE is the claim: exactly one
 * caller can see count 1. A zero count means somebody already opened this
 * draft, which is a fine outcome and not an error — the answer either way is
 * "the draft is open".
 */
export async function beginRookieDraftAction(leagueId: string) {
  await assertLeagueOwner(leagueId);
  const claimed = await prisma.draftState.updateMany({
    where: { leagueId, started: false },
    data: { started: true },
  });
  revalidatePath(`/league/${leagueId}`, 'layout');
  return { ok: true, alreadyStarted: claimed.count === 0 };
}

/**
 * Run every AI pick up to the user's next turn, in one go.
 *
 * THIS IS THE ONE PLACE SKIPPING AHEAD IS ALLOWED, and it is allowed because
 * the GM asked for it: it fires only from the Fast Forward button on
 * LiveDraftTicker, when he does not want to sit through the back half of round
 * four. Nothing else may call it — draftPlayerAction used to, which is how a
 * pick at #17 turned into a board sitting at #48 with nothing watched in
 * between (see the note there).
 */
export async function advanceToUserPickAction(leagueId: string, userTeamId: string) {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const rng = new Rng(`draft-skip-${leagueId}-${Date.now()}`);
  const picksMade = await runAiPicksUntilUser(leagueId, userTeamId, rng, league.seasonYear);
  revalidatePath(`/league/${leagueId}`, 'layout');
  return { picksMade };
}

/**
 * One visible AI pick at a time, for a paced/live draft-day feed the client
 * calls on a timer — a no-op returning null once the user is on the clock.
 */
export async function draftOneAiPickAction(leagueId: string, userTeamId: string) {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const rng = new Rng(`draft-tick-${leagueId}-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
  const result = await draftOneAiPick(leagueId, userTeamId, rng, league.seasonYear);
  revalidatePath(`/league/${leagueId}`, 'layout');
  return result;
}

export async function toggleShortlistAction(leagueId: string, teamId: string, playerId: string) {
  await assertLeagueOwner(leagueId);
  const existing = await prisma.shortlistEntry.findUnique({ where: { playerId_teamId: { playerId, teamId } } });
  if (existing) {
    await prisma.shortlistEntry.delete({ where: { id: existing.id } });
  } else {
    await prisma.shortlistEntry.create({ data: { playerId, teamId } });
  }
  revalidatePath(`/league/${leagueId}/draft`);
  return { shortlisted: !existing };
}
