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

/**
 * MID-DEAL EXTENSIONS MOVED, AND THE OLD ENDPOINT IS GONE.
 *
 * `extendContractAction` used to live here: cap check, then sign whatever it
 * was handed, at any number, no argument. It was the last rubber stamp in the
 * game — free agency and the re-sign window had run through `decideOffer` for
 * a while, and extending your own player, which is most of a GM's job, had no
 * negotiation on it at all.
 *
 * It is `app/actions/extension.ts` now, on the same evaluator as the other
 * two. The old function is DELETED rather than left unused, deliberately: a
 * Server Action is a POST endpoint whether or not any button still points at
 * it, so leaving it here would have left a live route that signs contracts
 * without a meter, a patience charge, or a refusal. Moving the UI off it and
 * leaving it exported would have closed the door and left the window open.
 */

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
