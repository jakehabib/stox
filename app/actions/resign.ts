'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertLeagueOwner, assertPlayerOnUserTeam } from '@/lib/owner';
import { parseSettings } from '@/lib/settings';
import { resignDecisionsForTeam } from '@/lib/season';
import { Rng } from '@/lib/rng';
import { resolveNegotiationSession, negotiateOffer, setResignSetAside } from '@/lib/freeagency';
import type { DealStructure, NegotiationOutcome, NegotiationSession, Offer } from '@/lib/negotiation';

/** Delegate every pending re-sign decision on the user's own team — expired and walk-year alike — to the same AI logic that runs each AI team's offseason. */
export async function letAiResignAction(leagueId: string) {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const team = await prisma.team.findFirstOrThrow({ where: { leagueId, isUser: true } });
  const rng = new Rng(`resign-delegate-${leagueId}-${league.seasonYear}-${league.week}`);
  const result = await resignDecisionsForTeam(leagueId, team.id, league.seasonYear, league.week, settings.capMode, rng);
  revalidatePath(`/league/${leagueId}`, 'layout');
  return result;
}

/**
 * THE MIRROR OF THE EXTENSION GUARD. A man with real years left on his deal is
 * an EXTENSION, not a re-sign — he is not on the clock, his loyalty discount
 * is not decaying, and re-signing him here would hand him the wrong context
 * and the wrong price. The re-sign page only ever lists players at
 * `yearsRemaining <= 1`, so this is unreachable through the UI; it is here
 * because the extension screen refuses the opposite case at the same boundary
 * and both of these are POST endpoints.
 */
async function assertResignable(playerId: string) {
  const contract = await prisma.contract.findUnique({
    where: { playerId },
    select: { yearsRemaining: true },
  });
  if (contract && contract.yearsRemaining > 1) {
    throw new Error(
      `He is under contract for ${contract.yearsRemaining} more years — that is an extension, and you negotiate it from his player page.`,
    );
  }
}

/**
 * Open re-sign talks with one of your own expiring players.
 *
 * Same model, same function, same meter as free agency. The differences are
 * all resolved inside `resolveNegotiationSession`, and they are what give this
 * window its own kind of pressure rather than a weaker version of the market's:
 *
 *   - He is an INCUMBENT, so he knocks something off his price to stay — and
 *     that discount DECAYS as his deal runs out (lib/negotiation.ts,
 *     LOYALTY_WINDOW). Talking to him in his walk year is cheaper than talking
 *     to him on the last screen before free agency, and the panel says so.
 *   - Somebody else already wants him. The same `leadingCompetingBid` free
 *     agency uses names a real club with real room and a real hole at his
 *     position — the club that will actually pursue him if he gets there. It
 *     cannot sign him today, so it never appears as a bid you can lose to; it
 *     appears as leverage, and it hardens his number.
 */
export async function openResignNegotiationAction(
  leagueId: string, playerId: string,
): Promise<NegotiationSession> {
  await assertLeagueOwner(leagueId);
  await assertPlayerOnUserTeam(leagueId, playerId);
  await assertResignable(playerId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const team = await prisma.team.findFirstOrThrow({ where: { leagueId, isUser: true } });
  return resolveNegotiationSession({
    leagueId, playerId, teamId: team.id, seasonYear: league.seasonYear, settings, incumbent: true,
  });
}

/**
 * Make the offer. Re-resolved and re-decided server-side; see negotiateOffer.
 * No patience argument, on purpose — the count is the server's, read from
 * NegotiationTalks, so it survives a reload of this page exactly as it does on
 * the free-agency one.
 */
export async function submitResignOfferAction(
  leagueId: string, playerId: string,
  offer: Offer, structure: DealStructure, fingerprint: string,
): Promise<NegotiationOutcome> {
  await assertLeagueOwner(leagueId);
  await assertPlayerOnUserTeam(leagueId, playerId);
  await assertResignable(playerId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const team = await prisma.team.findFirstOrThrow({ where: { leagueId, isUser: true } });
  const outcome = await negotiateOffer({
    leagueId, playerId, teamId: team.id, seasonYear: league.seasonYear, week: league.week,
    settings, incumbent: true, offer, structure, fingerprint,
  });
  // NO revalidatePath ON SUCCESS, and this is the whole reason the signing
  // confirmation can exist.
  //
  // A Server Action that revalidates hands the client a fresh RSC payload for
  // the current route as part of its own response, so the screen re-renders
  // the instant the deal closes — and a signed player is no longer in the
  // re-sign list, no longer a free agent, no longer whatever the panel was
  // mounted inside. The panel unmounts in the same frame as the answer
  // arrives, taking any record of what was just agreed with it. That is
  // measured behaviour, not theory: `ActionButton` documents 746ms from action
  // to unmount on one league, which is why its done beat so often never
  // painted.
  //
  // So the refresh is the USER's, at the moment they dismiss the confirmation
  // (see NegotiationPanel and SigningConfirmation). `router.refresh()` there
  // re-renders this route from the server and invalidates the client router
  // cache, so nothing is stale once they are done reading. Nothing that
  // matters is stale before then either: every figure on the confirmation was
  // read back off the contract row after it was written.
  return outcome;
}

/**
 * ===========================================================================
 * SET ASIDE — "not now", on the re-sign list
 * ===========================================================================
 * The app owner: *"On the re-sign page have a dismiss button also that players
 * can dismiss a player (and re visit during the offseason re-sign phase)"*.
 *
 * Triage, so a twenty-deep list can be worked top to bottom. Three things
 * about it are load-bearing and none of them are cosmetic:
 *
 *   IT IS NOT "LET HIM WALK". That decision already exists on the row, it is
 *     confirmed, and it releases him on the spot. This one parks him where he
 *     can be found again, and every word on screen says so.
 *   IT COSTS NO PATIENCE. Nothing in lib/negotiation.ts reads `dismissedAt`;
 *     it is not in the session, not in the fingerprint and not in
 *     `decideOffer`. Setting a man aside and picking him back up leaves him
 *     wanting exactly what he wanted before, with exactly the pips he had.
 *     `patienceSpent` is written by ONE function (chargePatience, in
 *     lib/freeagency.ts) and this action is not it — the upsert below
 *     writes a zero only when there is no row at all, which is the same zero
 *     `readPatienceSpent` already returns for a missing row.
 *   IT EXPIRES BY ITSELF. The row is keyed on the league year, so next
 *     offseason's re-sign window opens with nobody set aside. That is exactly
 *     "revisit during the offseason re-sign phase" and nothing beyond it.
 *
 * The trap this could have been — set twelve men aside, advance, and they all
 * walk having done what the button implied was safe — is closed in
 * lib/season.ts, which counts and NAMES them in the advance warning before
 * anybody is released.
 */
export async function setAsideResignAction(leagueId: string, playerId: string, aside: boolean) {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const team = await prisma.team.findFirstOrThrow({ where: { leagueId, isUser: true } });
  // The write itself lives beside the patience bookkeeping it shares a row
  // with (lib/freeagency.ts, setResignSetAside), so this stays what a Server
  // Action should be: ownership, then the call.
  const result = await setResignSetAside({
    leagueId, teamId: team.id, playerId, seasonYear: league.seasonYear, aside,
  });
  revalidatePath(`/league/${leagueId}/resign`);
  return { ok: true, aside: result.aside };
}
