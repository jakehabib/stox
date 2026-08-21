'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertLeagueOwner } from '@/lib/owner';
import { parseSettings } from '@/lib/settings';
import { resignDecisionsForTeam } from '@/lib/season';
import { Rng } from '@/lib/rng';
import { resolveNegotiationSession, negotiateOffer } from '@/lib/freeagency';
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
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const team = await prisma.team.findFirstOrThrow({ where: { leagueId, isUser: true } });
  const outcome = await negotiateOffer({
    leagueId, playerId, teamId: team.id, seasonYear: league.seasonYear, week: league.week,
    settings, incumbent: true, offer, structure, fingerprint,
  });
  if (outcome.ok) revalidatePath(`/league/${leagueId}`, 'layout');
  return outcome;
}
