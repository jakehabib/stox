'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { cutPlayer as cutPlayerLib, signFreeAgentWithCompetition, evaluateOffer, extendContract, restructureContract, leadingCompetingBid } from '@/lib/freeagency';
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
  // signFreeAgent throws when the deal would bust the cap — a foreseeable,
  // user-recoverable outcome (not a bug), so it must never escape a Server
  // Action uncaught: an unhandled throw here blanks the whole page instead
  // of showing a message.
  try {
    await signFreeAgentWithCompetition({ leagueId, playerId, teamId, apy, years, seasonYear: league.seasonYear, capMode: settings.capMode, week: league.week });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Signing failed.' };
  }
  revalidatePath(`/league/${leagueId}`, 'layout');
  return { ok: true, message: 'Deal signed.' };
}

/** Live "who else is bidding" check for the frenzy UI — what the leading AI offer actually is right now, if any. */
export async function checkCompetingBidAction(leagueId: string, playerId: string, teamId: string) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  return leadingCompetingBid(leagueId, playerId, teamId, league.seasonYear, settings.capMode);
}

export async function extendContractAction(
  leagueId: string, playerId: string, apy: number, years: number, escalation: number, voidYears: number,
) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  try {
    await extendContract({
      leagueId, playerId, apy, years, seasonYear: league.seasonYear, capMode: settings.capMode, week: league.week,
      escalation, voidYears,
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Extension failed.' };
  }
  revalidatePath(`/league/${leagueId}`, 'layout');
  return { ok: true, message: 'Extension signed.' };
}

export async function restructureContractAction(leagueId: string, playerId: string, convertAmount: number, addVoidYears: number) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  try {
    const result = await restructureContract({
      leagueId, playerId, convertAmount, addVoidYears, seasonYear: league.seasonYear, capMode: settings.capMode, week: league.week,
    });
    revalidatePath(`/league/${leagueId}`, 'layout');
    return { ok: true, message: `Restructured — new cap hit this year: $${(result.newCapHit / 1_000_000).toFixed(2)}M.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Restructure failed.' };
  }
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
