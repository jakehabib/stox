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
 * Same model, same function, same meter as free agency — the only differences
 * are resolved inside `resolveNegotiationSession`: he is an incumbent (so a
 * player who wants to stay will take a discount to do it, and the longer he
 * has been here the bigger it is), and nobody else is bidding yet, which is
 * the entire argument for getting this done before the market opens.
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

/** Make the offer. Re-resolved and re-decided server-side; see negotiateOffer. */
export async function submitResignOfferAction(
  leagueId: string, playerId: string,
  offer: Offer, structure: DealStructure, patienceSpent: number, fingerprint: string,
): Promise<NegotiationOutcome> {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const team = await prisma.team.findFirstOrThrow({ where: { leagueId, isUser: true } });
  const outcome = await negotiateOffer({
    leagueId, playerId, teamId: team.id, seasonYear: league.seasonYear, week: league.week,
    settings, incumbent: true, offer, structure, patienceSpent, fingerprint,
  });
  if (outcome.ok) revalidatePath(`/league/${leagueId}`, 'layout');
  return outcome;
}
