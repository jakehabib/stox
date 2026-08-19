import { prisma } from './db';
import { Rng } from './rng';
import { AI } from './tuning';
import { parseGmProfile, playerValueDetailed, pickValue, teamNeeds, philosophySummary, RosterPlayer } from './ai/gm';

/**
 * ===========================================================================
 * TRADES (design doc section 11)
 * ===========================================================================
 * A trade offer is two lists of assets (players + picks) moving in opposite
 * directions. Value is computed with the SAME playerValue/pickValue functions
 * the AI uses for free agency and the draft, so a team's board is internally
 * consistent across every mode of acquiring talent.
 * ===========================================================================
 */

export interface TradeAsset {
  type: 'PLAYER' | 'PICK';
  id: string; // playerId or draftPickId
}

export interface TradeEvaluation {
  accepted: boolean;
  sendValue: number;
  receiveValue: number;
  ratio: number;
  counter?: { message: string };
  /** Why the AI valued things this way — the strongest 1-3 notes across all assets on each side. */
  explanation: { give: string[]; receive: string[] };
  philosophy: ReturnType<typeof philosophySummary>;
}

async function assetValues(
  assets: TradeAsset[],
  forTeamId: string,
  profile: ReturnType<typeof parseGmProfile>,
  needs: Record<string, number>,
  currentYear: number,
  rng: Rng,
): Promise<{ total: number; reasons: string[] }> {
  let total = 0;
  const weighted: { text: string; weight: number }[] = [];
  for (const a of assets) {
    if (a.type === 'PLAYER') {
      const p = await prisma.player.findUniqueOrThrow({ where: { id: a.id } });
      const v = playerValueDetailed(p as unknown as RosterPlayer, { profile, needs, rng });
      total += v.total;
      for (const r of v.reasons) weighted.push({ text: `${p.firstName} ${p.lastName}: ${r.text}`, weight: r.weight });
    } else {
      const pick = await prisma.draftPick.findUniqueOrThrow({ where: { id: a.id } });
      total += pickValue(pick.round, pick.slot, profile, pick.year, currentYear);
    }
  }
  // Sort ACROSS every asset on this side of the deal, not just within one —
  // otherwise a minor note about asset #1 could outrank the actual dominant
  // factor on asset #2 just by having been evaluated first.
  const reasons = weighted.sort((a, b) => b.weight - a.weight).map((r) => r.text);
  return { total, reasons };
}

/**
 * Evaluate a proposed trade. IMPORTANT — `give`/`get` are from the CALLER's
 * (non-AI side's) perspective, matching how the Trade screen's "You send" /
 * "You receive" panels populate them: `give` = assets the other side is
 * sending to the AI (so the AI RECEIVES these), `get` = assets the other
 * side would receive FROM the AI (so the AI SENDS these away). Getting this
 * backwards silently inverts every accept/reject decision — which is exactly
 * what happened here before this fix, so don't rename `give`/`get` without
 * also re-deriving which one feeds `sendValue` vs `receiveValue` below.
 */
export async function evaluateTrade(opts: {
  aiTeamId: string;
  give: TradeAsset[];
  get: TradeAsset[];
  currentYear: number;
  settings: { aiAcceptsLopsided: boolean };
}): Promise<TradeEvaluation> {
  const rng = new Rng(`trade-${opts.aiTeamId}-${Date.now()}`);
  const team = await prisma.team.findUniqueOrThrow({ where: { id: opts.aiTeamId } });
  const profile = parseGmProfile(team.gmProfile, rng);
  const roster = await prisma.player.findMany({
    where: { teamId: opts.aiTeamId },
    select: { id: true, position: true, trueOvr: true, age: true, potential: true },
  });
  const needs = teamNeeds(roster as RosterPlayer[]);

  // opts.give flows TO the AI => that's what the AI receives.
  // opts.get flows FROM the AI => that's what the AI sends away.
  const receive = await assetValues(opts.give, opts.aiTeamId, profile, needs, opts.currentYear, rng);
  const send = await assetValues(opts.get, opts.aiTeamId, profile, needs, opts.currentYear, rng);
  const sendValue = send.total;
  const receiveValue = receive.total;
  const philosophy = philosophySummary(profile);
  // "give" reasons describe the assets flowing to the AI (why it wants/
  // discounts them); "receive" reasons describe what the AI would give up.
  const explanation = { give: receive.reasons.slice(0, 3), receive: send.reasons.slice(0, 3) };

  const requiredRatio = opts.settings.aiAcceptsLopsided ? 0.9 : AI.TRADE_ACCEPT_RATIO;
  const ratio = sendValue === 0 ? Infinity : receiveValue / sendValue;

  if (ratio >= requiredRatio) {
    return { accepted: true, sendValue, receiveValue, ratio, explanation, philosophy };
  }
  if (ratio >= requiredRatio - AI.TRADE_COUNTER_WINDOW) {
    return {
      accepted: false, sendValue, receiveValue, ratio, explanation, philosophy,
      counter: { message: `Close, but we need a bit more. Try sweetening the offer — we're about ${Math.round((requiredRatio - ratio) * 100)}% short on value.` },
    };
  }
  return {
    accepted: false, sendValue, receiveValue, ratio, explanation, philosophy,
    counter: { message: `Not enough here for us to consider it.` },
  };
}

export async function executeTrade(opts: {
  leagueId: string; teamA: string; teamB: string; aToB: TradeAsset[]; bToA: TradeAsset[]; seasonYear: number; week: number;
}) {
  await prisma.$transaction(async (tx) => {
    const move = async (assets: TradeAsset[], toTeam: string) => {
      for (const a of assets) {
        if (a.type === 'PLAYER') {
          await tx.player.update({ where: { id: a.id }, data: { teamId: toTeam } });
          await tx.contract.updateMany({ where: { playerId: a.id }, data: { teamId: toTeam } });
        } else {
          await tx.draftPick.update({ where: { id: a.id }, data: { ownerTeamId: toTeam } });
        }
      }
    };
    await move(opts.aToB, opts.teamB);
    await move(opts.bToA, opts.teamA);

    const [teamA, teamB] = await Promise.all([
      tx.team.findUniqueOrThrow({ where: { id: opts.teamA } }),
      tx.team.findUniqueOrThrow({ where: { id: opts.teamB } }),
    ]);
    await tx.transaction.create({
      data: {
        leagueId: opts.leagueId, seasonYear: opts.seasonYear, week: opts.week, type: 'TRADE',
        headline: `Trade: ${teamA.abbr} <-> ${teamB.abbr}`,
        detail: `${teamA.abbr} sends ${opts.aToB.length} asset(s), receives ${opts.bToA.length} asset(s).`,
      },
    });
  });
}

export interface TradePartnerSuggestion {
  teamId: string;
  teamName: string;
  teamAbbr: string;
  need: number; // 0..1 at the shopped position
  needLabel: 'Severe' | 'High' | 'Moderate' | 'Low';
  philosophy: ReturnType<typeof philosophySummary>;
}

/**
 * "Best trade partners" for a position you're shopping — the QoL feature the
 * brief specifically calls out: instead of the user opening all 31 rosters
 * and cap sheets by hand, the game just tells them who's actually interested.
 * Ranked by need at that position; ties broken toward teams with an
 * aggressive trade tendency, since they're more likely to actually engage.
 */
export async function rankTradePartners(leagueId: string, position: string, excludeTeamId: string): Promise<TradePartnerSuggestion[]> {
  const teams = await prisma.team.findMany({ where: { leagueId, id: { not: excludeTeamId }, isUser: false } });
  const rosters = await prisma.player.findMany({
    where: { leagueId, teamId: { in: teams.map((t) => t.id) } },
    select: { id: true, teamId: true, position: true, trueOvr: true, age: true, potential: true },
  });
  const byTeam = new Map<string, typeof rosters>();
  for (const p of rosters) {
    if (!p.teamId) continue;
    if (!byTeam.has(p.teamId)) byTeam.set(p.teamId, []);
    byTeam.get(p.teamId)!.push(p);
  }

  const needLabel = (n: number): TradePartnerSuggestion['needLabel'] =>
    n >= 0.65 ? 'Severe' : n >= 0.4 ? 'High' : n >= 0.2 ? 'Moderate' : 'Low';

  const suggestions: TradePartnerSuggestion[] = teams.map((t) => {
    const needs = teamNeeds((byTeam.get(t.id) ?? []) as RosterPlayer[]);
    const need = needs[position] ?? 0;
    return {
      teamId: t.id,
      teamName: `${t.city} ${t.nickname}`,
      teamAbbr: t.abbr,
      need,
      needLabel: needLabel(need),
      philosophy: philosophySummary(parseGmProfile(t.gmProfile)),
    };
  });

  return suggestions.filter((s) => s.need >= 0.2).sort((a, b) => b.need - a.need).slice(0, 6);
}

/**
 * Occasionally an AI team proposes a trade to the user. Value-fair (it won't
 * lowball an ask you'd never accept, since it's using the same pickValue the
 * AI itself is judged by) and targeted: it offers from a position it's
 * genuinely deep at, in exchange for a pick or player at a position it
 * genuinely needs, so the offer is coherent rather than a random pairing.
 */
export async function maybeGenerateAiTradeOffer(leagueId: string, userTeamId: string, rng: Rng, frequency: number) {
  if (!rng.bool(frequency)) return null;
  const aiTeams = await prisma.team.findMany({ where: { leagueId, isUser: false } });
  if (aiTeams.length === 0) return null;
  const aiTeam = rng.pick(aiTeams);

  const roster = await prisma.player.findMany({ where: { teamId: aiTeam.id } });
  if (roster.length < 4) return null;
  const needs = teamNeeds(roster as RosterPlayer[]);
  const profile = parseGmProfile(aiTeam.gmProfile, rng);
  const philosophy = philosophySummary(profile);

  // Offer from a position with real depth (need near 0) and a player who
  // isn't a core starter — the AI's own logic wouldn't shop its best guy.
  const depthPositions = Object.entries(needs).filter(([, n]) => n < 0.15).map(([pos]) => pos);
  const candidates = roster.filter((p) => depthPositions.includes(p.position) && p.trueOvr >= 58 && p.trueOvr <= 84);
  const surplus = candidates.length > 0 ? rng.pick(candidates) : rng.pick(roster.filter((p) => p.trueOvr >= 55 && p.trueOvr <= 78));
  if (!surplus) return null;

  const askValue = playerValueDetailed(surplus as unknown as RosterPlayer, { profile, needs, rng }).total;

  const userPicks = await prisma.draftPick.findMany({ where: { ownerTeamId: userTeamId, used: false }, orderBy: [{ year: 'asc' }, { round: 'asc' }] });
  // Find the cheapest pick (by this team's own pick-value scale) that still
  // roughly covers what it's asking — keeps the ask honest rather than
  // reaching for the user's best future first-rounder every time.
  const currentYear = (await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })).seasonYear;
  const priced = userPicks
    .map((p) => ({ pick: p, value: pickValue(p.round, p.slot, profile, p.year, currentYear) }))
    .filter((x) => x.value >= askValue * 0.8)
    .sort((a, b) => a.value - b.value);
  const askPick = priced[0]?.pick ?? userPicks[userPicks.length - 1];
  if (!askPick) return null;

  return {
    fromTeamId: aiTeam.id,
    fromTeamName: `${aiTeam.city} ${aiTeam.nickname}`,
    philosophy,
    offer: { give: [{ type: 'PLAYER' as const, id: surplus.id }], get: [{ type: 'PICK' as const, id: askPick.id }] },
    blurb: `${aiTeam.city} (${philosophy.windowLabel.toLowerCase()}) is offering ${surplus.firstName} ${surplus.lastName} (${surplus.position}, ${surplus.trueOvr} OVR) for your ${askPick.year} Round ${askPick.round} pick.`,
  };
}
