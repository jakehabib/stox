'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { readJson, writeJson } from '@/lib/json';
import { attrsForPosition } from '@/lib/ratings';
import type { AttrMap } from '@/lib/ratings';
import {
  DYNASTY, SKILL_BY_ID, buildDynastyState, loadDynastyProfile, parseSkills,
  rankOf, serializeSkills, type DynastySkillId,
} from '@/lib/dynasty';

/**
 * Every Dynasty spend goes through this file. Two scarce things exist —
 * skill points and per-season ability charges — and the rules the UI
 * advertises for both are enforced HERE, never in the component. A client
 * that lies about its remaining Scout Now charges gets the same answer as
 * one that does not, because the count is re-derived from the database on
 * every call.
 */

export interface DynastyActionResult {
  ok: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Skill points
// ---------------------------------------------------------------------------

export async function purchaseSkillAction(leagueId: string, skillId: DynastySkillId): Promise<DynastyActionResult> {
  const def = SKILL_BY_ID[skillId];
  if (!def) return { ok: false, message: 'Unknown upgrade.' };

  const state = await buildDynastyState(leagueId);
  const current = rankOf(state.skills, skillId);
  if (current >= def.ranks.length) {
    return { ok: false, message: `${def.name} is already fully upgraded.` };
  }
  const cost = def.ranks[current].cost;
  if (state.pointsAvailable < cost) {
    return {
      ok: false,
      message: `${def.name} rank ${current + 1} costs ${cost} skill point${cost === 1 ? '' : 's'} — you have ${state.pointsAvailable}.`,
    };
  }

  const profile = await loadDynastyProfile(leagueId);
  // Re-read and re-check inside the write so two rapid clicks cannot both
  // spend the same point. buildDynastyState above is the friendly message;
  // this is the one that actually guards the ledger.
  const fresh = parseSkills(profile.skills);
  if (rankOf(fresh, skillId) !== current) {
    return { ok: false, message: 'That upgrade already went through — reload to see it.' };
  }
  const next = { ...fresh, [skillId]: current + 1 };
  await prisma.dynastyProfile.update({ where: { id: profile.id }, data: { skills: serializeSkills(next) } });

  revalidatePath(`/league/${leagueId}`, 'layout');
  return { ok: true, message: `${def.name} upgraded to rank ${current + 1}.` };
}

// ---------------------------------------------------------------------------
// Scout Now
// ---------------------------------------------------------------------------

export interface ScoutNowResult extends DynastyActionResult {
  remaining?: number;
}

/**
 * SCOUT NOW — the one sanctioned hole in the fog of war.
 *
 * Writes ScoutingReport.fullyRevealed, which buildScoutedView reads to return
 * the player's true ratings and exact ceiling. The charge is decremented on
 * DynastyProfile in the SAME transaction, keyed to the current league year,
 * which is what makes the two properties the spec demands both true:
 *   - reloading the page cannot restore a use (the counter is in Postgres,
 *     not in a component's state);
 *   - the counter resets on a new season without a hook in lib/season.ts,
 *     because a counter stamped with last year's `scoutNowYear` is treated
 *     as zero the moment League.seasonYear moves.
 *
 * The reveal itself is permanent. You bought a complete evaluation; it does
 * not expire when the calendar turns.
 */
export async function scoutNowAction(leagueId: string, teamId: string, playerId: string): Promise<ScoutNowResult> {
  const state = await buildDynastyState(leagueId);
  if (!state.scoutNow.unlocked) {
    return { ok: false, message: 'Scout Now is not unlocked. Buy it on the Dynasty screen.' };
  }
  if (state.scoutNow.remaining <= 0) {
    return { ok: false, message: `No Scout Now uses left this season. ${DYNASTY.SCOUT_NOW_USES_PER_SEASON} reset when the new league year starts.` };
  }

  const [league, player, team] = await Promise.all([
    prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { seasonYear: true } }),
    prisma.player.findUnique({ where: { id: playerId }, select: { id: true, leagueId: true, firstName: true, lastName: true, position: true, trueAttrs: true, potential: true } }),
    prisma.team.findUnique({ where: { id: teamId }, select: { id: true, leagueId: true } }),
  ]);
  if (!player || player.leagueId !== leagueId) return { ok: false, message: 'That player is not in this league.' };
  if (!team || team.leagueId !== leagueId) return { ok: false, message: 'That team is not in this league.' };

  const existing = await prisma.scoutingReport.findUnique({ where: { playerId_teamId: { playerId, teamId } } });
  if (existing?.fullyRevealed) {
    return { ok: false, message: 'Your file on him is already complete — that would waste a use.', remaining: state.scoutNow.remaining };
  }

  const trueAttrs = readJson<AttrMap>(player.trueAttrs, {});
  const keys = attrsForPosition(player.position as never);
  // The report is written to look exactly like a maxed-out one rather than
  // relying on a single boolean everywhere: any surface that reads
  // confidence, attrsRevealed or the stored observation (list views, the
  // scouting department page, AI-facing code) sees a complete file too, not
  // a stale low-confidence one contradicting the player page.
  const observed: AttrMap = {};
  for (const k of keys) observed[k] = trueAttrs[k] ?? 50;
  observed['_POTENTIAL'] = player.potential;

  const payload = {
    confidence: 100,
    potConfidence: 100,
    observed: writeJson(observed),
    attrsRevealed: writeJson(keys),
    devRevealed: true,
    fullyRevealed: true,
    revealedYear: league.seasonYear,
    notes: 'Scout Now: a complete, exact evaluation. Nothing left to learn about this player.',
  };

  const profile = await loadDynastyProfile(leagueId);
  const usedThisYear = profile.scoutNowYear === league.seasonYear ? profile.scoutNowUsed : 0;
  if (usedThisYear >= DYNASTY.SCOUT_NOW_USES_PER_SEASON) {
    return { ok: false, message: 'No Scout Now uses left this season.' };
  }

  await prisma.$transaction([
    prisma.scoutingReport.upsert({
      where: { playerId_teamId: { playerId, teamId } },
      create: { playerId, teamId, scoutedOvr: 0, ovrLow: 0, ovrHigh: 99, ...payload },
      update: payload,
    }),
    prisma.dynastyProfile.update({
      where: { id: profile.id },
      data: { scoutNowYear: league.seasonYear, scoutNowUsed: usedThisYear + 1 },
    }),
  ]);

  revalidatePath(`/league/${leagueId}`, 'layout');
  const remaining = DYNASTY.SCOUT_NOW_USES_PER_SEASON - (usedThisYear + 1);
  return {
    ok: true,
    remaining,
    message: `${player.firstName} ${player.lastName} fully evaluated. Scout Now — ${remaining}/${DYNASTY.SCOUT_NOW_USES_PER_SEASON} remaining.`,
  };
}

// ---------------------------------------------------------------------------
// Insider
// ---------------------------------------------------------------------------

export interface InsiderResult extends DynastyActionResult {
  remaining?: number;
  /** Populated on success: a concrete read on what the deal would take. */
  report?: string;
}

/**
 * INSIDER — the Negotiation branch's scarce ability. Spends a charge to turn
 * the AI's vague "not enough here" into a specific, quantified asking price
 * for THIS proposal.
 *
 * It reports; it does not persuade. `evaluateTrade` is called read-only and
 * the AI's required ratio is unchanged — the user learns exactly how far
 * short they are and still has to go find the value.
 */
export async function insiderReadAction(
  leagueId: string,
  aiTeamId: string,
  give: { type: 'PLAYER' | 'PICK'; id: string }[],
  get: { type: 'PLAYER' | 'PICK'; id: string }[],
): Promise<InsiderResult> {
  const state = await buildDynastyState(leagueId);
  if (!state.insider.unlocked) return { ok: false, message: 'Insider is not unlocked. Buy it on the Dynasty screen.' };
  if (state.insider.remaining <= 0) {
    return { ok: false, message: `No Insider calls left this season. ${DYNASTY.INSIDER_USES_PER_SEASON} reset when the new league year starts.` };
  }
  if (give.length === 0 && get.length === 0) return { ok: false, message: 'Build a proposal first — there is nothing to ask about.' };

  const { evaluateTrade } = await import('@/lib/trade');
  const { parseSettings } = await import('@/lib/settings');
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const evaluation = await evaluateTrade({
    aiTeamId, give: give as never, get: get as never,
    currentYear: league.seasonYear,
    settings: { aiAcceptsLopsided: settings.aiAcceptsLopsided },
  });

  const needed = Math.max(0, Math.round(evaluation.sendValue * evaluation.requiredRatio - evaluation.receiveValue));
  const report = evaluation.accepted
    ? `They'd sign off on this today — you are about ${Math.round((evaluation.ratio - evaluation.requiredRatio) * 100)}% clear of their bar. Anything you add is money left on the table.`
    : `They value what you're asking for at ${Math.round(evaluation.sendValue)} and your offer at ${Math.round(evaluation.receiveValue)}. To get to yes you need roughly ${needed} more points of value — about ${describeValue(needed)}.`;

  const profile = await loadDynastyProfile(leagueId);
  const usedThisYear = profile.insiderYear === league.seasonYear ? profile.insiderUsed : 0;
  if (usedThisYear >= DYNASTY.INSIDER_USES_PER_SEASON) return { ok: false, message: 'No Insider calls left this season.' };

  await prisma.dynastyProfile.update({
    where: { id: profile.id },
    data: { insiderYear: league.seasonYear, insiderUsed: usedThisYear + 1 },
  });
  revalidatePath(`/league/${leagueId}`, 'layout');

  const remaining = DYNASTY.INSIDER_USES_PER_SEASON - (usedThisYear + 1);
  return { ok: true, remaining, report, message: `Insider — ${remaining}/${DYNASTY.INSIDER_USES_PER_SEASON} remaining.` };
}

/** Translate a raw trade-value gap into something a GM can act on. */
function describeValue(v: number): string {
  if (v <= 0) return 'nothing';
  if (v < 120) return 'a late-round pick';
  if (v < 350) return 'a third-rounder';
  if (v < 700) return 'a second-rounder';
  if (v < 1400) return 'a late first';
  return 'a premium first-round pick, or a starter';
}
