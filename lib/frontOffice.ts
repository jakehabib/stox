import { prisma } from './db';
import { teamNeeds, RosterPlayer } from './ai/gm';
import { marketValue, formatMoney } from './cap';
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
  headline: string;
  detail: string;
  /** Short call-to-action label, e.g. "Browse Free Agents". */
  action: string;
  /** League-relative path, e.g. "/roster" — caller prefixes with /league/{id}. */
  href: string;
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
      headline: `${worstNeed[0]} is your thinnest position`,
      detail: 'Worth addressing before it costs you a game.',
      action: 'Browse Free Agents',
      href: '/free-agency',
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
      headline: `Deepest book on the board: ${bestScouted.player.firstName} ${bestScouted.player.lastName}`,
      detail: `${bestScouted.confidence}% confidence, range ${bestScouted.ovrLow}-${bestScouted.ovrHigh}.`,
      action: 'View Draft Board',
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
      headline: `${expiring.firstName} ${expiring.lastName}'s contract expires soon`,
      detail: `Market rate is around ${formatMoney(mv)}/yr — get ahead of it before he hits the open market.`,
      action: 'Open Extension',
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
        headline: `${best.team.city} is short at ${best.pos}`,
        detail: "A position you're deep at — worth a call.",
        action: 'Explore Trade',
        href: '/trade',
      });
    }
  }

  // --- Cap -----------------------------------------------------------
  // Reuses the same compliance report the standing over-cap banner and the
  // advancement block read, so the brief never contradicts either of them.
  if (capMode !== 'OFF') {
    const { capComplianceReport } = await import('./capEnforcement');
    const report = await capComplianceReport(teamId, seasonYear, capMode);
    if (!report.compliant) {
      const best = report.path[0] ?? report.relief.find((r) => r.kind === 'CUT');
      const blocks = capMode === 'REALISTIC' && report.fixable;
      items.push({
        category: 'Cap',
        headline: `You're over the cap by ${formatMoney(report.shortfall)}`,
        detail: [
          blocks ? 'The week will not advance until you\'re compliant.' : null,
          best ? `Cutting ${best.name} would clear ${formatMoney(best.frees)}.` : 'No easy cuts — a trade that sends salary out may be the only way back.',
        ].filter(Boolean).join(' '),
        action: 'Open Cap',
        href: '/cap',
      });
    }
  }

  // --- Trade offers -----------------------------------------------------------
  const offerCount = await prisma.tradeOffer.count({ where: { leagueId, toTeamId: teamId, status: 'PENDING' } });
  if (offerCount > 0) {
    items.push({
      category: 'Trade Offers',
      headline: `${offerCount} trade offer${offerCount > 1 ? 's' : ''} waiting on a response`,
      detail: offerCount > 1 ? 'A few teams are waiting to hear back.' : 'One team is waiting to hear back.',
      action: 'Review Offers',
      href: '/trade',
    });
  }

  return items;
}
