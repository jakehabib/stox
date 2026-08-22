'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertLeagueOwner, assertPlayerOnUserTeam } from '@/lib/owner';
import { parseSettings } from '@/lib/settings';
import { resolveNegotiationSession, negotiateOffer } from '@/lib/freeagency';
import type { DealStructure, NegotiationOutcome, NegotiationSession, Offer } from '@/lib/negotiation';

/**
 * ===========================================================================
 * EXTENSIONS — the third contract screen, on the same evaluator as the others
 * ===========================================================================
 * Free agency and the re-sign window have run through `decideOffer` for a
 * while: a live interest meter, patience that costs something, a rival you can
 * actually lose to. Extending a player already under contract did not. It went
 * through `ExtendContractForm` and `extendContractAction`, which checked the
 * salary cap and signed whatever it was handed — the "they accept everything"
 * behaviour the whole minigame exists to remove, still alive on the screen a
 * GM spends most of his time on, because keeping your own good players is most
 * of the job.
 *
 * The app owner found it from the outside: *"Also the player interest slider
 * is missing for the player profile negotiate extension"*.
 *
 * So it is the same session, the same `decideOffer`, the same panel. What
 * differs is all context, resolved server-side:
 *
 *   - NOBODY MAY BID. He is under contract, so `gate.competingApy` stays 0
 *     exactly as it does in a re-sign. A rumoured suitor still appears,
 *     because a club with the room and the hole is a true fact about next
 *     spring, but it can only harden his asking price.
 *   - YEARS OF CONTROL ARE THE LEVERAGE that replaces the rival. A man owed
 *     three more seasons cannot go anywhere and prices himself accordingly;
 *     a man owed one is nearly a free agent. See `extensionLeverage` and the
 *     control discount in lib/negotiation.ts.
 *   - PATIENCE IS THE SAME STORE, keyed on (team, player, league year) like
 *     everywhere else. Lowballing him on an extension in March and again in
 *     the re-sign window in January does not hand him fresh pips.
 *
 * A player whose deal is actually expiring is NOT extended here — he is the
 * re-sign window's business, and being told so after negotiating a four-year
 * deal is the gotcha this codebase keeps removing. `ContractActions` does not
 * offer the button for him at all; these two functions refuse him anyway,
 * because a Server Action is a POST and a hidden button protects nothing.
 * ===========================================================================
 */

/** Shared by both entry points, so the UI and the signing path cannot disagree about who is extendable. */
async function assertExtendable(playerId: string) {
  const contract = await prisma.contract.findUnique({
    where: { playerId },
    select: { yearsRemaining: true },
  });
  if (!contract) {
    throw new Error('He has no contract to extend — sign him first.');
  }
  if (contract.yearsRemaining <= 1) {
    throw new Error("His deal is up — that's a re-sign, and he negotiates it in the Re-sign window.");
  }
  return contract;
}

export async function openExtensionNegotiationAction(
  leagueId: string, playerId: string,
): Promise<NegotiationSession> {
  await assertLeagueOwner(leagueId);
  await assertPlayerOnUserTeam(leagueId, playerId);
  await assertExtendable(playerId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const team = await prisma.team.findFirstOrThrow({ where: { leagueId, isUser: true } });
  const player = await prisma.player.findUniqueOrThrow({ where: { id: playerId }, select: { teamId: true } });
  if (player.teamId !== team.id) throw new Error('He is not on your roster.');

  return resolveNegotiationSession({
    leagueId, playerId, teamId: team.id, seasonYear: league.seasonYear,
    settings, incumbent: true, mode: 'EXTENSION',
  });
}

/**
 * Make the offer. Re-resolved and re-decided server-side by `negotiateOffer`,
 * which is also where the offer is clamped back into the legal range and where
 * patience is read from and written to the database. Nothing the browser sends
 * is trusted, including the numbers typed into the new salary/term fields.
 */
export async function submitExtensionOfferAction(
  leagueId: string, playerId: string,
  offer: Offer, structure: DealStructure, fingerprint: string,
): Promise<NegotiationOutcome> {
  await assertLeagueOwner(leagueId);
  await assertPlayerOnUserTeam(leagueId, playerId);
  await assertExtendable(playerId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const team = await prisma.team.findFirstOrThrow({ where: { leagueId, isUser: true } });
  const outcome = await negotiateOffer({
    leagueId, playerId, teamId: team.id, seasonYear: league.seasonYear, week: league.week,
    settings, incumbent: true, mode: 'EXTENSION', offer, structure, fingerprint,
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
