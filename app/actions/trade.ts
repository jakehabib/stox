'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { evaluateTrade, executeTrade, rankTradePartners, TradeAsset } from '@/lib/trade';
import { parseSettings } from '@/lib/settings';
import { readJson } from '@/lib/json';

export async function evaluateTradeAction(leagueId: string, aiTeamId: string, give: TradeAsset[], get: TradeAsset[]) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  return evaluateTrade({ aiTeamId, give, get, currentYear: league.seasonYear, settings: { aiAcceptsLopsided: settings.aiAcceptsLopsided } });
}

export async function rankTradePartnersAction(leagueId: string, position: string, excludeTeamId: string) {
  return rankTradePartners(leagueId, position, excludeTeamId);
}

export async function executeTradeAction(leagueId: string, teamA: string, teamB: string, aToB: TradeAsset[], bToA: TradeAsset[]) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  await executeTrade({ leagueId, teamA, teamB, aToB, bToA, seasonYear: league.seasonYear, week: league.week });
  revalidatePath(`/league/${leagueId}`, 'layout');
}

export async function respondToTradeOfferAction(leagueId: string, offerId: string, accept: boolean) {
  const offer = await prisma.tradeOffer.findUniqueOrThrow({ where: { id: offerId } });
  if (offer.status !== 'PENDING') return;

  if (accept) {
    const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
    await executeTrade({
      leagueId, teamA: offer.fromTeamId, teamB: offer.toTeamId,
      aToB: readJson<TradeAsset[]>(offer.give, []),
      bToA: readJson<TradeAsset[]>(offer.request, []),
      seasonYear: league.seasonYear, week: league.week,
    });
  }

  await prisma.tradeOffer.update({ where: { id: offerId }, data: { status: accept ? 'ACCEPTED' : 'DECLINED' } });
  revalidatePath(`/league/${leagueId}`, 'layout');
}
