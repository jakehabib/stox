import { prisma } from './db';
import { teamNeeds, RosterPlayer } from './ai/gm';
import { marketValue, formatMoney } from './cap';
import { CapMode } from './types';
import { Position, rosterMinFor } from './tuning';
import { parseSettings } from './settings';
import { startersAt, lineupUnit } from './lineup';

/** Position codes as a person would say them in a sentence. */
const POSITION_NOUN: Record<string, string> = {
  QB: 'quarterback', RB: 'running back', WR: 'receiver', TE: 'tight end',
  LT: 'left tackle', LG: 'left guard', C: 'center', RG: 'right guard', RT: 'right tackle',
  EDGE: 'edge rusher', DT: 'defensive tackle', LB: 'linebacker', CB: 'cornerback', S: 'safety',
  K: 'kicker', P: 'punter',
};

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

/**
 * THE BRIEF WAS ORDERED BY LINE NUMBER.
 *
 * Items were pushed in the order the checks happen to be written in this file
 * and returned unsorted, so "3 trade offers waiting on a response" and "you
 * are $12M over the cap" both ranked BELOW "TE is your thinnest position" —
 * a standing condition with no deadline, no counterparty and no clock. A desk
 * brief that leads with the least urgent thing on it is a list, not a brief.
 *
 * The ordering principle is WHO IS WAITING AND ON WHAT CLOCK:
 *
 *   1. Cap — it can block the week from advancing outright. Nothing else here
 *      can stop the game.
 *   2. Trade Offers — somebody else is waiting on YOUR answer, and offers
 *      expire. It is the only item with a person on the other end of it.
 *   3. Contracts — a man walks at a date, and the discount for getting ahead
 *      of it disappears before he does.
 *   4. Trade Market — a real opportunity, but nothing is lost by reading it
 *      next week.
 *   5. Roster — true all season and fixable all season.
 *   6. Scouting — the longest clock in the game; the draft is months out.
 *
 * Ties keep their original order, because within one category the checks
 * already emit their own best-first.
 */
const CATEGORY_URGENCY: Record<BriefItem['category'], number> = {
  Cap: 0,
  'Trade Offers': 1,
  Contracts: 2,
  'Trade Market': 3,
  Roster: 4,
  Scouting: 5,
};

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
  /**
   * BEING SHORT OF BODIES OUTRANKS BEING THIN AT A POSITION, and until now
   * nothing player-facing said it at all. `LEAGUE.ROSTER_MIN` is read by no
   * signing, cut, draft or advance path, and INV-20 is a developer's warning
   * on a screen a GM never opens — so a club could sit twenty-two men short
   * of the legal minimum, bank the salary, and be told only that its safeties
   * were a bit thin.
   *
   * There is no gate here on purpose. Measured on two leagues off the same
   * seed, same schedule, same opponents, with the club stripped to its best
   * 24 men: offense 83.7 -> 79.7, defense 83.9 -> 77.6, a 12-5 season turned
   * into 7-10, and a point differential of +114 turned into -55. The game
   * already charges for this, on the field, at about five wins — which is a
   * far better answer than a button that refuses to advance. What it did not
   * do was TELL anyone, and a cost a GM cannot see is a cost he cannot decide
   * against.
   *
   * Silent through OFFSEASON and RESIGN for the reason INV-20 is: every
   * expiring deal has just come off and free agency has not opened, so
   * essentially every club in the league is briefly under the line by design.
   */
  const league = await prisma.league.findUniqueOrThrow({
    where: { id: leagueId }, select: { phase: true, settings: true },
  });
  const rosterMin = rosterMinFor(parseSettings(league.settings).rosterMax);
  const active = await prisma.player.count({ where: { teamId, status: 'ACTIVE' } });
  if (active < rosterMin && league.phase !== 'OFFSEASON' && league.phase !== 'RESIGN') {
    const short = rosterMin - active;
    items.push({
      category: 'Roster',
      headline: `You are ${short} player${short === 1 ? '' : 's'} short of a legal roster`,
      detail: `${active} men against a ${rosterMin}-man minimum. Every empty slot is filled on Sunday by whoever `
        + `is standing there, and an injury has nobody behind it — that lands on the scoreboard long before it `
        + `shows up on the depth chart.`,
      action: 'Browse Free Agents',
      href: '/free-agency',
    });
  }

  const worstNeed = Object.entries(needs).sort((a, b) => b[1] - a[1])[0];
  if (worstNeed && worstNeed[1] > 0.4) {
    items.push({
      category: 'Roster',
      headline: `${worstNeed[0]} is your thinnest position`,
      detail: 'Worth addressing before it costs you a game.',
      // Label unchanged. A position code does not pluralise in English — "Browse
      // Ss" for a safety, "Browse Cs" for a centre — and the headline directly
      // above already names the position, so the button only has to say where
      // it goes.
      action: 'Browse Free Agents',
      // The position is right there in `worstNeed[0]` and the headline already
      // names it — sending the GM to an unfiltered market and asking him to
      // re-select the position the brief just told him about was the brief
      // knowing the answer and making him type it back.
      href: `/free-agency?pos=${worstNeed[0]}`,
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
      // NOT 'Open Extension'. This query is yearsRemaining <= 1, and a man in
      // the last year of his deal is a re-sign, not an extension — his card
      // shows a Re-sign button and no extension form at all. The brief was
      // naming a button that is never on the screen it links to.
      action: 'Re-sign him',
      // ...and land on the money. The button says "Re-sign him"; without
      // ?view=contract the card opens on his receiving yards and the GM has
      // to find the contract tab himself to do the thing he just clicked.
      href: `/player/${expiring.id}?view=contract`,
    });
  }

  // --- Trade market ---------------------------------------------------------
  /**
   * WHAT "DEEP" HAS TO MEAN BEFORE THIS SAYS IT.
   *
   * This used to be "need score under 0.05", which is not depth — it is the
   * absence of a hole. A club with exactly one punter scores ~0 at P, because
   * one punter is all anybody needs, and the brief duly told the app owner
   * "Chicago is short at P — a position you're deep at" when he had a single
   * punter on the roster. That is a lying metric of the plainest kind, and
   * the owner caught it on the live site.
   *
   * Depth is now counted in bodies against the starting eleven: you are deep
   * only with a starter's worth of cover BEYOND the men who take the field.
   *
   * SPECIALISTS ARE EXCLUDED OUTRIGHT, on the owner's call — "these positions
   * aren't exciting and have little value so prob shouldn't be counted". A
   * trade built around a backup kicker is not a story, and the brief has room
   * for four items.
   */
  const rosterCountAt = (pos: string) => roster.filter((p) => p.position === pos).length;
  const surplusPositions = Object.entries(needs)
    .filter(([pos, n]) => n < 0.05
      && lineupUnit(pos) !== 'SPECIAL'
      && rosterCountAt(pos) >= startersAt(pos) + 2)
    .map(([pos]) => pos);
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
        // The position spelled out. "Chicago is short at P" reads as a typo in
        // a sentence; a brief on a GM's desk says punter.
        headline: `${best.team.city} is short at ${POSITION_NOUN[best.pos] ?? best.pos}`,
        detail: `You carry ${rosterCountAt(best.pos)} — worth a call.`,
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
    const { capComplianceDueNow } = await import('./season');
    const report = await capComplianceReport(teamId, seasonYear, capMode);
    if (!report.compliant) {
      // Only ever suggest a cut that is part of a route that actually
      // arrives. capComplianceReport returns an empty path when no set of
      // cuts clears the shortfall, and in that state the honest advice is
      // "trade salary away", not "cut your third-best player".
      const best = report.fixable ? (report.path[0] ?? report.relief.find((r) => r.kind === 'CUT')) : null;
      const phase = league.phase;
      const blocks = capMode === 'REALISTIC' && report.fixable && capComplianceDueNow(phase);
      items.push({
        category: 'Cap',
        headline: `You're over the cap by ${formatMoney(report.shortfall)}`,
        detail: [
          blocks ? 'The week will not advance until you\'re compliant.' : null,
          !capComplianceDueNow(phase) ? 'Expiring contracts come off the books when free agency opens — be under the ceiling by then.' : null,
          best
            ? `Cutting ${best.name} would clear ${formatMoney(best.frees)}.`
            : report.fixable
              ? 'No easy cuts — a trade that sends salary out may be the only way back.'
              : `No combination of cuts gets you under the ceiling — cutting everyone who frees anything clears only ${formatMoney(report.maxCutRelief)}. A trade that sends salary out is the way back.`,
          // The brief is the one place a GM is told what a problem WILL do to
          // him if he leaves it, and leaving this one alone is no longer free:
          // the overage follows him into the next league year as dead money
          // (settleClosingYearCapOverage, lib/season.ts).
          !blocks ? 'Left unfixed, whatever you are over by when the season closes carries into next year as dead money.' : null,
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

  // Stable sort — Array.prototype.sort is spec-stable, so equal urgencies keep
  // the order the checks above emitted them in.
  return items.sort((a, b) => CATEGORY_URGENCY[a.category] - CATEGORY_URGENCY[b.category]);
}
