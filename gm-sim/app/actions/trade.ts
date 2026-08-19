'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { evaluateTrade, executeTrade, TradeAsset } from '@/lib/trade';
import { parseSettings } from '@/lib/settings';

export async function evaluateTradeAction(leagueId: string, aiTeamId: string, give: TradeAsset[], get: TradeAsset[]) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  return evaluateTrade({ aiTeamId, give, get, currentYear: league.seasonYear, settings: { aiAcceptsLopsided: settings.aiAcceptsLopsided } });
}

export async function executeTradeAction(leagueId: string, teamA: string, teamB: string, aToB: TradeAsset[], bToA: TradeAsset[]) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  await executeTrade({ leagueId, teamA, teamB, aToB, bToA, seasonYear: league.seasonYear, week: league.week });
  revalidatePath(`/league/${leagueId}`, 'layout');
}
