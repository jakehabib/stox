'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertLeagueOwner, assertTeamOwner } from '@/lib/owner';
import { cutPlayer as cutPlayerLib, extendContract, restructureContract, applyFranchiseTag, fillRosterForTeam, resolveNegotiationSession, negotiateOffer } from '@/lib/freeagency';
import { decideOffer, type DealStructure, type NegotiationOutcome, type NegotiationSession, type Offer } from '@/lib/negotiation';
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

/**
 * Open contract talks. Resolves the hidden half of the negotiation —
 * personality, reservation price, patience, who else is bidding, how much cap
 * room the deal has to fit inside — ONCE, so the client can re-run
 * `decideOffer` on every drag of a slider without a request per pixel.
 *
 * Nothing secret leaks: the reservation price is in the payload because the
 * meter is computed from it, but the panel never renders it. Hiding it from
 * the client entirely would mean a server round trip per frame, which is the
 * one thing that would kill the feel this feature exists for.
 */
export async function openNegotiationAction(
  leagueId: string, playerId: string, teamId: string,
): Promise<NegotiationSession> {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  return resolveNegotiationSession({
    leagueId, playerId, teamId, seasonYear: league.seasonYear, settings, incumbent: false,
  });
}

/**
 * Put an offer on the table for real.
 *
 * The client already knows what this will say — it ran the same
 * `decideOffer` to draw the meter. It is re-run here anyway, against a
 * session re-resolved from the database, because a client-computed acceptance
 * is not evidence of anything.
 *
 * Note what is NOT in this signature: how much patience the user has spent.
 * It used to be an argument, and a reload set it back to zero, which handed
 * anyone with an F5 key an unlimited supply of lowballs. The count now lives
 * in the database and the server reads it for itself (see negotiateOffer);
 * there is deliberately no parameter here for a client to get wrong or to lie
 * about.
 */
export async function submitOfferAction(
  leagueId: string, playerId: string, teamId: string,
  offer: Offer, structure: DealStructure, fingerprint: string,
): Promise<NegotiationOutcome> {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const outcome = await negotiateOffer({
    leagueId, playerId, teamId, seasonYear: league.seasonYear, week: league.week,
    settings, incumbent: false, offer, structure, fingerprint,
  });
  // Only a SIGNING revalidates. Losing him to a rival changes the league too,
  // but revalidating on that path tears the panel out from under the user at
  // the exact moment it is telling them what just happened — the page
  // re-renders him as another team's player and the explanation goes with it.
  // The wire and the pool are correct on the next navigation, which is a
  // second later and after they have read the bad news.
  if (outcome.ok) revalidatePath(`/league/${leagueId}`, 'layout');
  return outcome;
}

/**
 * Mid-deal extension — a player with years left on his contract, reached from
 * his own page. Left as it was, deliberately: this is not the re-sign
 * negotiation, and ContractActions/ExtendContractForm have no meter on them.
 *
 * The ONE thing added is the hole this would otherwise leave open. A player
 * whose contract is actually expiring is exactly the player the re-sign
 * minigame governs, and reaching him through this form instead of that panel
 * used to hand you the old rubber stamp — sign anything, at any number, no
 * argument. So an expiring deal is refused here and pointed at the window
 * that negotiates it. Every other extension behaves exactly as before.
 */
export async function extendContractAction(
  leagueId: string, playerId: string, apy: number, years: number, escalation: number, voidYears: number,
) {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const existing = await prisma.contract.findUnique({ where: { playerId }, select: { yearsRemaining: true } });
  if (existing && existing.yearsRemaining <= 1) {
    return {
      ok: false,
      message: "His deal is up — that's a re-sign, and he negotiates it. Open the Re-sign window and make him an offer there.",
    };
  }
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
