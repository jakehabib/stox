'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { cutPlayer as cutPlayerLib, signFreeAgent, evaluateOffer } from '@/lib/freeagency';
import { parseSettings } from '@/lib/settings';
import { autoDepthChart } from '@/lib/gen/league';

export async function cutPlayerAction(leagueId: string, playerId: string) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  await cutPlayerLib({ leagueId, playerId, capMode: settings.capMode, seasonYear: league.seasonYear, week: league.week });
  revalidatePath(`/league/${leagueId}`, 'layout');
}

export async function offerContractAction(leagueId: string, playerId: string, teamId: string, apy: number, years: number) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const evaluation = await evaluateOffer(playerId, teamId, apy, years);
  if (!evaluation.accepted) {
    return { ok: false, message: `He's looking for closer to $${(evaluation.market / 1_000_000).toFixed(1)}M/yr. Try again around $${(evaluation.counterApy! / 1_000_000).toFixed(1)}M.` };
  }
  await signFreeAgent({ leagueId, playerId, teamId, apy, years, seasonYear: league.seasonYear, capMode: settings.capMode, week: league.week });
  revalidatePath(`/league/${leagueId}`, 'layout');
  return { ok: true, message: 'Deal signed.' };
}

export async function setDepthChartAction(teamId: string, position: string, orderedPlayerIds: string[]) {
  await prisma.depthChartSlot.deleteMany({ where: { teamId, position } });
  await prisma.depthChartSlot.createMany({
    data: orderedPlayerIds.map((playerId, rank) => ({ teamId, playerId, position, rank })),
  });
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
  revalidatePath(`/league/${team.leagueId}/depth-chart`);
}

export async function autoSortDepthChartAction(teamId: string) {
  await autoDepthChart(teamId);
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
  revalidatePath(`/league/${team.leagueId}/depth-chart`);
}

export async function setTeamSchemeAction(teamId: string, offScheme?: string, defScheme?: string) {
  const data: any = {};
  if (offScheme) data.offScheme = offScheme;
  if (defScheme) data.defScheme = defScheme;
  await prisma.team.update({ where: { id: teamId }, data });
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
  revalidatePath(`/league/${team.leagueId}`, 'layout');
}
