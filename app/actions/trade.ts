'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertLeagueOwner } from '@/lib/owner';
import { evaluateTrade, executeTrade, rankTradePartners, isTradeDeadlinePassed, TradeAsset } from '@/lib/trade';
import { parseSettings } from '@/lib/settings';
import { readJson } from '@/lib/json';

export async function evaluateTradeAction(leagueId: string, aiTeamId: string, give: TradeAsset[], get: TradeAsset[]) {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  return evaluateTrade({ aiTeamId, give, get, currentYear: league.seasonYear, settings: { aiAcceptsLopsided: settings.aiAcceptsLopsided } });
}

export async function rankTradePartnersAction(leagueId: string, position: string, excludeTeamId: string) {
  await assertLeagueOwner(leagueId);
  return rankTradePartners(leagueId, position, excludeTeamId);
}

export interface TradeActionResult { ok: boolean; message: string }

/**
 * A rejected trade — deadline passed, or the salary cap won't take it on one
 * side or the other — is a foreseeable, user-recoverable outcome, not a bug.
 * It comes back as a message rather than escaping the Server Action as an
 * uncaught throw, which in Next blanks the whole page instead of explaining
 * what happened (same reasoning as offerContractAction in roster.ts).
 */
export async function executeTradeAction(
  leagueId: string, teamA: string, teamB: string, aToB: TradeAsset[], bToA: TradeAsset[],
): Promise<TradeActionResult> {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  if (settings.tradeDeadlineEnabled && isTradeDeadlinePassed(league.phase, league.week, settings.tradeDeadlineWeek)) {
    return { ok: false, message: 'The trade deadline has passed for this league year.' };
  }
  try {
    await executeTrade({ leagueId, teamA, teamB, aToB, bToA, seasonYear: league.seasonYear, week: league.week });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Trade failed.' };
  }
  revalidatePath(`/league/${leagueId}`, 'layout');
  return { ok: true, message: 'Trade completed.' };
}

export async function respondToTradeOfferAction(leagueId: string, offerId: string, accept: boolean): Promise<TradeActionResult> {
  await assertLeagueOwner(leagueId);
  const offer = await prisma.tradeOffer.findUniqueOrThrow({ where: { id: offerId } });
  if (offer.status !== 'PENDING') return { ok: false, message: 'That offer is no longer on the table.' };

  if (accept) {
    const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
    const settings = parseSettings(league.settings);
    if (settings.tradeDeadlineEnabled && isTradeDeadlinePassed(league.phase, league.week, settings.tradeDeadlineWeek)) {
      return { ok: false, message: 'The trade deadline has passed for this league year.' };
    }
    try {
      await executeTrade({
        leagueId, teamA: offer.fromTeamId, teamB: offer.toTeamId,
        aToB: readJson<TradeAsset[]>(offer.give, []),
        bToA: readJson<TradeAsset[]>(offer.request, []),
        seasonYear: league.seasonYear, week: league.week,
      });
    } catch (err) {
      // The offer stays PENDING so the user can clear cap room and accept it
      // before it expires, rather than losing it to a failed acceptance.
      return { ok: false, message: err instanceof Error ? err.message : 'Trade failed.' };
    }
  }

  await prisma.tradeOffer.update({ where: { id: offerId }, data: { status: accept ? 'ACCEPTED' : 'DECLINED' } });
  revalidatePath(`/league/${leagueId}`, 'layout');
  return { ok: true, message: accept ? 'Trade completed.' : 'Offer declined.' };
}
