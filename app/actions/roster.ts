'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertLeagueOwner, assertTeamOwner } from '@/lib/owner';
import { cutPlayer as cutPlayerLib, signFreeAgentWithCompetition, evaluateOffer, extendContract, restructureContract, applyFranchiseTag, leadingCompetingBid, fillRosterForTeam } from '@/lib/freeagency';
import { parseSettings } from '@/lib/settings';
import { teamCapSummary } from '@/lib/cap-summary';
import { capHit, deadMoneyOnCut, capSavingsOnCut } from '@/lib/cap';
import { autoDepthChart } from '@/lib/gen/league';
import { Rng } from '@/lib/rng';

export async function cutPlayerAction(leagueId: string, playerId: string) {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  await cutPlayerLib({ leagueId, playerId, capMode: settings.capMode, seasonYear: league.seasonYear, week: league.week });
  revalidatePath(`/league/${leagueId}`, 'layout');
}

export interface CutImpact {
  /** False in OFF mode — the UI then shows no dollar figures at all. */
  capEnabled: boolean;
  playerName: string;
  /** This year's cap hit that goes away. */
  currentHit: number;
  /** Accelerated signing-bonus proration that stays on the books. */
  deadMoney: number;
  /** currentHit - deadMoney. NEGATIVE means the release costs you cap space. */
  savings: number;
  capSpaceBefore: number;
  capSpaceAfter: number;
  /** Release leaves the team over the ceiling. */
  leavesOverCap: boolean;
  /** Dead money exceeds the hit — the "restructured, now trapped" shape. */
  costsMoreThanKeeping: boolean;
}

/**
 * What releasing this player actually does, for the confirm step.
 *
 * A cut is the one move whose real cost is invisible at the point of
 * decision: in REALISTIC mode every remaining dollar of prorated signing
 * bonus (void years included) accelerates onto THIS year's cap the moment
 * he's gone, so a heavily-restructured contract can cost more to release
 * than to keep. Nothing said so before you clicked.
 */
export async function cutImpactAction(leagueId: string, playerId: string): Promise<CutImpact> {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const player = await prisma.player.findUniqueOrThrow({ where: { id: playerId }, include: { contract: true } });
  const name = `${player.firstName} ${player.lastName}`;

  if (settings.capMode === 'OFF' || !player.contract || !player.teamId) {
    return {
      capEnabled: false, playerName: name, currentHit: 0, deadMoney: 0, savings: 0,
      capSpaceBefore: 0, capSpaceAfter: 0, leavesOverCap: false, costsMoreThanKeeping: false,
    };
  }

  const summary = await teamCapSummary(player.teamId, league.seasonYear, settings.capMode);
  const currentHit = capHit(player.contract, settings.capMode);
  const dead = deadMoneyOnCut(player.contract, settings.capMode);
  const savings = capSavingsOnCut(player.contract, settings.capMode);
  const after = summary.capSpace + savings;

  return {
    capEnabled: true,
    playerName: name,
    currentHit,
    deadMoney: dead,
    savings,
    capSpaceBefore: summary.capSpace,
    capSpaceAfter: after,
    leavesOverCap: after < 0,
    costsMoreThanKeeping: dead > currentHit,
  };
}

export async function fillRosterAction(leagueId: string, teamId: string) {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const rng = new Rng(`fill-roster-${teamId}-${league.seasonYear}-${league.week}`);
  const result = await fillRosterForTeam({ leagueId, teamId, seasonYear: league.seasonYear, week: league.week, settings, rng });
  revalidatePath(`/league/${leagueId}`, 'layout');
  return result;
}

export async function offerContractAction(
  leagueId: string, playerId: string, teamId: string, apy: number, years: number,
  escalation?: number, voidYears?: number,
) {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  // The player judges the deal on money and length only — structure and void
  // years are cap accounting on your side of the table, not something he
  // weighs, so they're deliberately not part of the acceptance check.
  const evaluation = await evaluateOffer(playerId, teamId, apy, years);
  if (!evaluation.accepted) {
    return { ok: false, message: `He's looking for closer to $${(evaluation.market / 1_000_000).toFixed(1)}M/yr. Try again around $${(evaluation.counterApy! / 1_000_000).toFixed(1)}M.` };
  }
  // signFreeAgent throws when the deal would bust the cap — a foreseeable,
  // user-recoverable outcome (not a bug), so it must never escape a Server
  // Action uncaught: an unhandled throw here blanks the whole page instead
  // of showing a message.
  try {
    await signFreeAgentWithCompetition({
      leagueId, playerId, teamId, apy, years, seasonYear: league.seasonYear,
      capMode: settings.capMode, week: league.week, escalation, voidYears,
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Signing failed.' };
  }
  revalidatePath(`/league/${leagueId}`, 'layout');
  return { ok: true, message: 'Deal signed.' };
}

/** Live "who else is bidding" check for the frenzy UI — what the leading AI offer actually is right now, if any. */
export async function checkCompetingBidAction(leagueId: string, playerId: string, teamId: string) {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  return leadingCompetingBid(leagueId, playerId, teamId, league.seasonYear, settings.capMode);
}

export async function extendContractAction(
  leagueId: string, playerId: string, apy: number, years: number, escalation: number, voidYears: number,
) {
  await assertLeagueOwner(leagueId);
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

export async function applyFranchiseTagAction(leagueId: string, playerId: string) {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  if (!settings.franchiseTagEnabled) return { ok: false, message: 'Franchise tags are disabled in league settings.' };
  if (league.phase !== 'RESIGN') return { ok: false, message: 'The franchise tag can only be used during the Re-sign window.' };
  try {
    const result = await applyFranchiseTag({ leagueId, playerId, seasonYear: league.seasonYear, capMode: settings.capMode, week: league.week });
    revalidatePath(`/league/${leagueId}`, 'layout');
    return { ok: true, message: `Tagged — 1-yr, fully guaranteed at $${(result.tagValue / 1_000_000).toFixed(1)}M.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Franchise tag failed.' };
  }
}

export async function restructureContractAction(leagueId: string, playerId: string, convertAmount: number, addVoidYears: number) {
  await assertLeagueOwner(leagueId);
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
  await assertTeamOwner(teamId);
  await prisma.depthChartSlot.deleteMany({ where: { teamId, position } });
  await prisma.depthChartSlot.createMany({
    data: orderedPlayerIds.map((playerId, rank) => ({ teamId, playerId, position, rank })),
  });
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
  revalidatePath(`/league/${team.leagueId}/depth-chart`);
}

export async function autoSortDepthChartAction(teamId: string) {
  await assertTeamOwner(teamId);
  await autoDepthChart(teamId);
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
  revalidatePath(`/league/${team.leagueId}/depth-chart`);
}

export async function setTeamSchemeAction(teamId: string, offScheme?: string, defScheme?: string) {
  await assertTeamOwner(teamId);
  const data: any = {};
  if (offScheme) data.offScheme = offScheme;
  if (defScheme) data.defScheme = defScheme;
  await prisma.team.update({ where: { id: teamId }, data });
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
  revalidatePath(`/league/${team.leagueId}`, 'layout');
}
