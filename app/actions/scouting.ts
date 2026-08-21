'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertLeagueOwner } from '@/lib/owner';
import { readJson, writeJson } from '@/lib/json';
import { AttrMap } from '@/lib/ratings';
import { observe, scoutNote } from '@/lib/scouting';
import { parseSettings } from '@/lib/settings';
import { SCOUTING, SCOUT_TIERS, SCOUT_ECONOMY, ScoutTierKey } from '@/lib/tuning';
import {
  applyScoutingPass, passRng, periodKey, scoutCost, specialtyMatches,
  syncScoutingBudget, type ScoutingBudget,
} from '@/lib/scoutingEconomy';

/**
 * Every focus-point spend in the game goes through this file. The rules the
 * UI advertises are enforced here, not in the component: the balance, the
 * escalating cost of a repeat pass, and the per-period pass ceiling.
 */

export interface ScoutOption {
  tier: ScoutTierKey;
  label: string;
  cost: number;
  blurb: string;
  affordable: boolean;
  /** null when this tier is available; a reason string when it is not. */
  blocked: string | null;
}

export interface ScoutPanel {
  budget: ScoutingBudget;
  options: ScoutOption[];
  passes: number;
  periodPasses: number;
  maxPassesPerPeriod: number;
  confidence: number;
  /** True when the viewing team owns this player (Development Focus instead of scouting tiers). */
  isOwnRoster: boolean;
  devTrait: string | null;
}

async function loadContext(leagueId: string, teamId: string, playerId: string) {
  const [league, player, scouts] = await Promise.all([
    prisma.league.findUniqueOrThrow({ where: { id: leagueId } }),
    prisma.player.findUniqueOrThrow({ where: { id: playerId } }),
    prisma.scout.findMany({ where: { teamId } }),
  ]);
  const settings = parseSettings(league.settings);
  const bestScout = scouts.slice().sort((a, b) => b.accuracy - a.accuracy)[0]
    ?? { accuracy: 40, specialty: 'ALL' };
  return { league, settings, player, bestScout };
}

/**
 * Everything the scouting UI needs to render costs and the budget BEFORE the
 * user clicks anything. Also the place the lazy per-period replenishment
 * happens, so simply opening a player page brings an old save's allowance up
 * to date.
 */
export async function getScoutPanelAction(leagueId: string, teamId: string, playerId: string): Promise<ScoutPanel> {
  await assertLeagueOwner(leagueId);
  const { league, settings, player } = await loadContext(leagueId, teamId, playerId);
  const budget = await syncScoutingBudget(teamId, league, settings);
  const report = await prisma.scoutingReport.findUnique({ where: { playerId_teamId: { playerId, teamId } } });

  const key = periodKey(league);
  const periodPasses = report && report.lastWeek === key ? report.periodPasses : 0;
  const passes = report?.passes ?? 0;
  const isOwnRoster = player.teamId === teamId;
  const atPeriodCap = periodPasses >= SCOUT_ECONOMY.MAX_PASSES_PER_PERIOD;

  const tiers = (Object.keys(SCOUT_TIERS) as ScoutTierKey[])
    .filter((t) => SCOUT_TIERS[t].ownRosterOnly === isOwnRoster);

  const options: ScoutOption[] = tiers.map((tier) => {
    const cost = scoutCost(tier, passes);
    const affordable = budget.points >= cost;
    let blocked: string | null = null;
    if (atPeriodCap) blocked = `Your staff has already worked him ${periodPasses}x this period.`;
    else if (!affordable) blocked = `Costs ${cost} — you have ${budget.points}.`;
    return { tier, label: SCOUT_TIERS[tier].label, cost, blurb: SCOUT_TIERS[tier].blurb, affordable, blocked };
  });

  return {
    budget,
    options,
    passes,
    periodPasses,
    maxPassesPerPeriod: SCOUT_ECONOMY.MAX_PASSES_PER_PERIOD,
    confidence: Math.round(report?.confidence ?? SCOUTING.ROOKIE_BASE_CONFIDENCE),
    isOwnRoster,
    devTrait: report?.devRevealed ? player.devTrait : null,
  };
}

export interface ScoutResult {
  ok: boolean;
  message: string;
  /** Present on success. */
  spent?: number;
  remaining?: number;
  confidence?: number;
  confidenceGained?: number;
  revealed?: string[];
  devTrait?: string | null;
}

/**
 * Spend focus on one player. `tier` replaces the old raw `points` argument —
 * the caller can no longer name its own price.
 */
export async function scoutPlayerAction(
  leagueId: string, teamId: string, playerId: string, tier: ScoutTierKey,
): Promise<ScoutResult> {
  await assertLeagueOwner(leagueId);
  const spec = SCOUT_TIERS[tier];
  if (!spec) return { ok: false, message: 'Unknown scouting action.' };

  const { league, settings, player, bestScout } = await loadContext(leagueId, teamId, playerId);
  const isOwnRoster = player.teamId === teamId;
  if (spec.ownRosterOnly && !isOwnRoster) {
    return { ok: false, message: 'Development Focus is for players on your own roster.' };
  }
  if (!spec.ownRosterOnly && isOwnRoster) {
    return { ok: false, message: 'Use Development Focus on your own players.' };
  }

  const budget = await syncScoutingBudget(teamId, league, settings);
  const existing = await prisma.scoutingReport.findUnique({ where: { playerId_teamId: { playerId, teamId } } });

  const key = periodKey(league);
  const periodPasses = existing && existing.lastWeek === key ? existing.periodPasses : 0;
  // Replaces the old flat "one scout per player per week" lock. Repeat passes
  // are allowed — they just cost more and teach less — but not without limit
  // inside a single period.
  if (periodPasses >= SCOUT_ECONOMY.MAX_PASSES_PER_PERIOD) {
    return {
      ok: false,
      message: `Your staff has already worked this player ${periodPasses}x this period. Advance to free them up.`,
      remaining: budget.points,
      confidence: Math.round(existing?.confidence ?? 0),
    };
  }

  const passes = existing?.passes ?? 0;
  const cost = scoutCost(tier, passes);
  if (budget.points < cost) {
    return {
      ok: false,
      message: `${spec.label} costs ${cost} focus — you have ${budget.points} left this period.`,
      remaining: budget.points,
      confidence: Math.round(existing?.confidence ?? 0),
    };
  }

  const specialtyMatch = specialtyMatches(bestScout.specialty, player.position as any);
  const alreadyRevealed = readJson<string[]>(existing?.attrsRevealed ?? null, []);
  const rng = passRng(teamId, playerId, passes, settings.simSeed || league.id);

  const outcome = applyScoutingPass({
    tier,
    passes,
    confidence: existing?.confidence ?? SCOUTING.ROOKIE_BASE_CONFIDENCE,
    potConfidence: existing?.potConfidence ?? 0,
    alreadyRevealed,
    position: player.position as any,
    scoutAccuracy: bestScout.accuracy,
    specialtyMatch,
    devAlreadyRevealed: existing?.devRevealed ?? false,
    rng,
  });

  const trueAttrs = readJson<AttrMap>(player.trueAttrs, {});
  const observed = observe(
    rng, player.position as any, trueAttrs, outcome.confidence,
    bestScout.accuracy, specialtyMatch ? SCOUTING.SPECIALTY_BONUS : 0, player.potential,
  );

  const revealedAll = Array.from(new Set([...alreadyRevealed, ...outcome.newlyRevealed]));
  // The player detail page renders `report.notes` verbatim, so the surfaced
  // development trait rides along there rather than needing a new field the
  // page doesn't read.
  const notes = outcome.devRevealed
    ? `${scoutNote(outcome.confidence)} Our people have a firm read on his development curve: ${player.devTrait}.`
    : scoutNote(outcome.confidence);

  await prisma.$transaction([
    prisma.scoutingReport.upsert({
      where: { playerId_teamId: { playerId, teamId } },
      update: {
        confidence: outcome.confidence,
        potConfidence: outcome.potConfidence,
        observed: writeJson(observed),
        attrsRevealed: writeJson(revealedAll),
        devRevealed: outcome.devRevealed,
        notes,
        lastWeek: key,
        passes: passes + 1,
        periodPasses: periodPasses + 1,
      },
      create: {
        playerId, teamId,
        confidence: outcome.confidence,
        potConfidence: outcome.potConfidence,
        observed: writeJson(observed),
        attrsRevealed: writeJson(revealedAll),
        devRevealed: outcome.devRevealed,
        notes,
        lastWeek: key,
        passes: 1,
        periodPasses: 1,
      },
    }),
    prisma.team.update({
      where: { id: teamId },
      data: { scoutPoints: { decrement: cost }, scoutSpentSeason: { increment: cost } },
    }),
    // Development Focus buys a charge the next in-season development
    // checkpoint consumes (lib/development.ts), which is what makes spending
    // on your own roster compete with spending on the draft class.
    ...(tier === 'DEVELOP'
      ? [prisma.player.update({ where: { id: playerId }, data: { devFocus: { increment: 1 } } })]
      : []),
  ]);

  // revalidatePath needs a request store; balance-tuning scripts call this
  // action directly with no request in flight, and a missing cache tag must
  // not lose a spend that already committed to the database.
  try { revalidatePath(`/league/${leagueId}`, 'layout'); } catch { /* not in a request context */ }

  const revealedLabels = outcome.newlyRevealed;
  return {
    ok: true,
    message: `${spec.label}: −${cost} focus, confidence ${outcome.confidence}%`,
    spent: cost,
    remaining: budget.points - cost,
    confidence: outcome.confidence,
    confidenceGained: outcome.confidenceGained,
    revealed: revealedLabels,
    devTrait: outcome.devRevealed ? player.devTrait : null,
  };
}

/** Budget-only read for pages that show the allowance without a player in hand. */
export async function getScoutingBudgetAction(leagueId: string, teamId: string): Promise<ScoutingBudget> {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  return syncScoutingBudget(teamId, league, parseSettings(league.settings));
}
