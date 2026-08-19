import { prisma } from './db';
import { teamNeeds, RosterPlayer } from './ai/gm';
import { marketValue, formatMoney, capSavingsOnCut } from './cap';
import { teamCapSummary } from './cap-summary';
import { CapMode } from './types';
import { Position } from './tuning';

/**
 * ===========================================================================
 * FRONT OFFICE INTELLIGENCE
 * ===========================================================================
 * A weekly digest that surfaces what a competent front-office staff would
 * bring to a GM's desk — roster holes, scouting progress, contracts worth
 * getting ahead of, who in the league actually wants what you're deep at,
 * and cap trouble with a concrete suggested fix. Every line here is derived
 * from systems that already exist; this module just decides what's worth
 * saying out loud and to whom, per the brief's "quality-of-life
 * intelligence" idea — the game acting like staff, not doing the GM's job.
 * ===========================================================================
 */

export interface BriefItem {
  category: 'Roster' | 'Scouting' | 'Contracts' | 'Trade Market' | 'Cap' | 'Trade Offers';
  text: string;
  /** League-relative path, e.g. "/roster" — caller prefixes with /league/{id}. */
  href?: string;
}

export async function buildFrontOfficeBrief(
  leagueId: string,
  teamId: string,
  seasonYear: number,
  capMode: CapMode,
): Promise<BriefItem[]> {
  const items: BriefItem[] = [];

  const roster = await prisma.player.findMany({
    where: { teamId },
    select: { id: true, firstName: true, lastName: true, position: true, trueOvr: true, age: true, potential: true },
  });
  const needs = teamNeeds(roster as RosterPlayer[]);

  // --- Roster -----------------------------------------------------------
  const worstNeed = Object.entries(needs).sort((a, b) => b[1] - a[1])[0];
  if (worstNeed && worstNeed[1] > 0.4) {
    items.push({
      category: 'Roster',
      text: `${worstNeed[0]} is your thinnest position right now — worth addressing before it costs you a game.`,
      href: '/roster',
    });
  }

  // --- Scouting -----------------------------------------------------------
  const bestScouted = await prisma.scoutingReport.findFirst({
    where: { teamId, confidence: { gte: 55 }, player: { isDraftee: true } },
    orderBy: { confidence: 'desc' },
    include: { player: true },
  });
  if (bestScouted) {
    items.push({
      category: 'Scouting',
      text: `Our film department has the deepest book on ${bestScouted.player.firstName} ${bestScouted.player.lastName} among this year's prospects — ${bestScouted.confidence}% confidence, range ${bestScouted.ovrLow}-${bestScouted.ovrHigh}.`,
      href: '/draft',
    });
  }

  // --- Contracts -----------------------------------------------------------
  const expiring = await prisma.player.findFirst({
    where: { teamId, contract: { yearsRemaining: { lte: 1 } }, status: 'ACTIVE' },
    orderBy: { trueOvr: 'desc' },
  });
  if (expiring) {
    const mv = marketValue({ ovr: expiring.trueOvr, position: expiring.position as Position, age: expiring.age });
    items.push({
      category: 'Contracts',
      text: `${expiring.firstName} ${expiring.lastName}'s contract expires soon. Market rate is around ${formatMoney(mv)}/yr — get ahead of it before he hits the open market.`,
      href: `/player/${expiring.id}`,
    });
  }

  // --- Trade market ---------------------------------------------------------
  const surplusPositions = Object.entries(needs).filter(([, n]) => n < 0.05).map(([pos]) => pos);
  if (surplusPositions.length > 0) {
    const aiTeams = await prisma.team.findMany({ where: { leagueId, id: { not: teamId }, isUser: false } });
    const aiRosters = await prisma.player.findMany({
      where: { leagueId, teamId: { in: aiTeams.map((t) => t.id) } },
      select: { id: true, teamId: true, position: true, trueOvr: true, age: true, potential: true },
    });
    const byTeam = new Map<string, typeof aiRosters>();
    for (const p of aiRosters) {
      if (!p.teamId) continue;
      if (!byTeam.has(p.teamId)) byTeam.set(p.teamId, []);
      byTeam.get(p.teamId)!.push(p);
    }
    let best: { team: (typeof aiTeams)[number]; pos: string; need: number } | null = null;
    for (const t of aiTeams) {
      const tNeeds = teamNeeds((byTeam.get(t.id) ?? []) as RosterPlayer[]);
      for (const pos of surplusPositions) {
        const need = tNeeds[pos] ?? 0;
        if (need > 0.4 && (!best || need > best.need)) best = { team: t, pos, need };
      }
    }
    if (best) {
      items.push({
        category: 'Trade Market',
        text: `${best.team.city} is short at ${best.pos} — a position you're deep at. Worth a call.`,
        href: '/trade',
      });
    }
  }

  // --- Cap -----------------------------------------------------------
  if (capMode !== 'OFF') {
    const summary = await teamCapSummary(teamId, seasonYear, capMode);
    if (summary.capSpace < 0) {
      const contracts = await prisma.player.findMany({
        where: { teamId, status: 'ACTIVE', contract: { isNot: null } },
        include: { contract: true },
      });
      let bestCut: { name: string; savings: number } | null = null;
      for (const p of contracts) {
        if (!p.contract) continue;
        const savings = capSavingsOnCut(p.contract, capMode);
        if (savings > 0 && (!bestCut || savings > bestCut.savings)) bestCut = { name: `${p.firstName} ${p.lastName}`, savings };
      }
      items.push({
        category: 'Cap',
        text: bestCut
          ? `You're over the cap by ${formatMoney(-summary.capSpace)}. Cutting ${bestCut.name} would clear ${formatMoney(bestCut.savings)}.`
          : `You're over the cap by ${formatMoney(-summary.capSpace)} with no easy cuts — a restructure or trade may be the only way out.`,
        href: '/cap',
      });
    }
  }

  // --- Trade offers -----------------------------------------------------------
  const offerCount = await prisma.tradeOffer.count({ where: { leagueId, toTeamId: teamId, status: 'PENDING' } });
  if (offerCount > 0) {
    items.push({
      category: 'Trade Offers',
      text: `${offerCount} team${offerCount > 1 ? 's are' : ' is'} waiting on a response to a trade offer.`,
      href: '/trade',
    });
  }

  return items;
}
