'use server';

import { revalidatePath } from 'next/cache';
import { Rng } from '@/lib/rng';
import { prisma } from '@/lib/db';
import { readJson, writeJson } from '@/lib/json';
import { attrsForPosition } from '@/lib/ratings';
import type { AttrMap } from '@/lib/ratings';
import {
  DYNASTY, SKILL_BY_ID, buildDynastyState, fullScoutMax, loadDynastyProfile, parseSkills,
  rankOf, serializeSkills, type DynastySkillId,
} from '@/lib/dynasty';

/**
 * Every Dynasty spend goes through this file. Two scarce things exist —
 * skill points and per-season ability charges — and the rules the UI
 * advertises for both are enforced HERE, never in the component. A client
 * that lies about its remaining Full Scout charges gets the same answer as
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
// Full Scout
// ---------------------------------------------------------------------------

export interface FullScoutResult extends DynastyActionResult {
  remaining?: number;
  max?: number;
}

/**
 * FULL SCOUT — the one sanctioned hole in the fog of war.
 *
 * Every GM gets DYNASTY.FULL_SCOUT_BASE_USES of these at the start of each
 * league year with no skill tree involvement; the Scouting Network upgrade
 * adds more. Spending one writes ScoutingReport.fullyRevealed, which
 * buildScoutedView reads to return the player's true ratings and exact
 * ceiling.
 *
 * The charge is decremented on DynastyProfile in the SAME transaction as the
 * reveal, keyed to the current league year, which is what makes both of the
 * properties the spec demands true:
 *   - reloading the page cannot restore a use (the counter is in Postgres,
 *     not in a component's state);
 *   - the counter resets on a new season with no hook in lib/season.ts,
 *     because a counter stamped with last year's `fullScoutYear` is read as
 *     zero the moment League.seasonYear moves.
 *
 * The reveal itself is permanent. You bought a complete evaluation; it does
 * not expire when the calendar turns.
 */
export async function fullScoutAction(leagueId: string, teamId: string, playerId: string): Promise<FullScoutResult> {
  const state = await buildDynastyState(leagueId);
  if (state.fullScout.remaining <= 0) {
    return {
      ok: false,
      max: state.fullScout.max,
      remaining: 0,
      message: `No Full Scouts left this season. ${state.fullScout.max} reset when the new league year starts.`,
    };
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
    return { ok: false, message: 'Your file on him is already complete — that would waste a use.', remaining: state.fullScout.remaining, max: state.fullScout.max };
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
    notes: 'Full Scout: a complete, exact evaluation. Nothing left to learn about this player.',
  };

  const profile = await loadDynastyProfile(leagueId);
  const max = fullScoutMax(parseSkills(profile.skills));
  const usedThisYear = profile.fullScoutYear === league.seasonYear ? profile.fullScoutUsed : 0;
  if (usedThisYear >= max) return { ok: false, message: 'No Full Scouts left this season.', remaining: 0, max };

  await prisma.$transaction([
    prisma.scoutingReport.upsert({
      where: { playerId_teamId: { playerId, teamId } },
      create: { playerId, teamId, scoutedOvr: 0, ovrLow: 0, ovrHigh: 99, ...payload },
      update: payload,
    }),
    prisma.dynastyProfile.update({
      where: { id: profile.id },
      data: { fullScoutYear: league.seasonYear, fullScoutUsed: usedThisYear + 1 },
    }),
  ]);

  revalidatePath(`/league/${leagueId}`, 'layout');
  const remaining = max - (usedThisYear + 1);
  return {
    ok: true,
    remaining,
    max,
    message: `${player.firstName} ${player.lastName} fully evaluated. Full Scout — ${remaining}/${max} remaining.`,
  };
}

export interface FullScoutTarget {
  id: string;
  name: string;
  position: string;
  age: number;
  /** "Draft prospect", "Free agent", or the team abbreviation. */
  where: string;
  alreadyRevealed: boolean;
}

export interface FullScoutPanelData {
  remaining: number;
  max: number;
  used: number;
  seasonYear: number;
  targets: FullScoutTarget[];
}

/**
 * Candidate list + live charge count for the Full Scout widget. Search is
 * server-side because a draft class runs to several hundred players and
 * shipping the whole pool to the client just to filter it would be silly.
 */
export async function fullScoutPanelAction(leagueId: string, teamId: string, query: string): Promise<FullScoutPanelData> {
  const state = await buildDynastyState(leagueId);
  const q = query.trim();

  const where: Record<string, unknown> = { leagueId, status: { not: 'RETIRED' } };
  if (q.length >= 2) {
    where.OR = [
      { lastName: { contains: q, mode: 'insensitive' } },
      { firstName: { contains: q, mode: 'insensitive' } },
    ];
  } else {
    // No query: default to the incoming draft class, which is where a perfect
    // evaluation is worth the most.
    where.isDraftee = true;
  }

  const players = await prisma.player.findMany({
    where: where as never,
    orderBy: [{ trueOvr: 'desc' }],
    take: 25,
    select: { id: true, firstName: true, lastName: true, position: true, age: true, isDraftee: true, teamId: true, team: { select: { abbr: true } } },
  });
  const reports = await prisma.scoutingReport.findMany({
    where: { teamId, playerId: { in: players.map((p) => p.id) }, fullyRevealed: true },
    select: { playerId: true },
  });
  const revealed = new Set(reports.map((r) => r.playerId));

  return {
    remaining: state.fullScout.remaining,
    max: state.fullScout.max,
    used: state.fullScout.used,
    seasonYear: state.seasonYear,
    targets: players.map((p) => ({
      id: p.id,
      name: `${p.firstName} ${p.lastName}`,
      position: p.position,
      age: p.age,
      where: p.isDraftee ? 'Draft prospect' : p.team?.abbr ?? 'Free agent',
      alreadyRevealed: revealed.has(p.id),
    })),
  };
}

// ---------------------------------------------------------------------------
// Market Knowledge
// ---------------------------------------------------------------------------

export interface ContractEstimate {
  /** Center of the staff's estimate, in dollars per year. */
  center: number;
  low: number;
  high: number;
  rank: number;
}

/**
 * MARKET KNOWLEDGE. Returns null — render nothing — unless the skill is owned.
 *
 * The number a free agent actually signs for is derived from his TRUE rating
 * (lib/freeagency.ts evaluateOffer prices off trueOvr), while the suggestion
 * the offer form already shows is priced off the SCOUTED rating. The gap
 * between those two is the fog. This does not remove the fog: it quotes a
 * band around the real threshold, deliberately off-centre by a seeded amount,
 * so a GM with rank 2 is well-informed and still capable of lowballing.
 *
 * Read-only. It does not change what the player will accept.
 */
export async function contractEstimateAction(leagueId: string, playerId: string, years: number): Promise<ContractEstimate | null> {
  const state = await buildDynastyState(leagueId);
  const rank = rankOf(state.skills, 'MARKET_KNOWLEDGE');
  const pct = DYNASTY.MARKET_BAND_PCT[rank];
  if (pct == null) return null;

  const { marketValue } = await import('@/lib/cap');
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { leagueId: true, trueOvr: true, position: true, age: true, potential: true },
  });
  if (!player || player.leagueId !== leagueId) return null;

  const market = marketValue({ ovr: player.trueOvr, position: player.position as never, age: player.age, potential: player.potential });
  // Mirrors lib/freeagency.ts evaluateOffer's 0.9-of-market acceptance bar. If
  // that constant moves, this estimate silently drifts — it is the one number
  // here that lives in a file this system does not own.
  const threshold = market * 0.9;
  // Seeded off the player, not the clock, so re-opening the form does not
  // re-roll the estimate into a different answer.
  const rng = new Rng(`${leagueId}:${playerId}:market`);
  const center = Math.round(threshold * (1 + rng.normal(0, pct * 0.35)));
  const half = Math.round(center * pct);
  return { center, low: Math.max(0, center - half), high: center + half, rank };
}

// ---------------------------------------------------------------------------
// Insider
// ---------------------------------------------------------------------------

export interface TradeIntelRead {
  unlocked: boolean;
  /** What the AI values the assets it would SEND at. */
  theirValue: number;
  /** What the AI values your offer at. */
  yourValue: number;
  /** Value still needed to clear their bar. 0 when the deal already clears. */
  shortfall: number;
}

/**
 * TRADE INTEL. Turns the normalized acceptance bar the Trade screen already
 * draws into the actual numbers behind it. Pure reporting — `evaluateTrade`
 * is run exactly as the accept/reject path runs it, and the AI's required
 * ratio is untouched.
 */
export async function tradeIntelAction(
  leagueId: string, aiTeamId: string,
  give: { type: 'PLAYER' | 'PICK'; id: string }[],
  get: { type: 'PLAYER' | 'PICK'; id: string }[],
): Promise<TradeIntelRead> {
  const state = await buildDynastyState(leagueId);
  if (rankOf(state.skills, 'TRADE_INTEL') === 0) {
    return { unlocked: false, theirValue: 0, yourValue: 0, shortfall: 0 };
  }
  const { evaluateTrade } = await import('@/lib/trade');
  const { parseSettings } = await import('@/lib/settings');
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const e = await evaluateTrade({
    aiTeamId, give: give as never, get: get as never,
    currentYear: league.seasonYear,
    settings: { aiAcceptsLopsided: settings.aiAcceptsLopsided },
  });
  return {
    unlocked: true,
    theirValue: Math.round(e.sendValue),
    yourValue: Math.round(e.receiveValue),
    shortfall: Math.max(0, Math.round(e.sendValue * e.requiredRatio - e.receiveValue)),
  };
}

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
