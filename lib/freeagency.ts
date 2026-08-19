import { prisma } from './db';
import { Rng, clamp } from './rng';
import { CAP } from './tuning';
import { LeagueSettings } from './settings';
import { readJson, writeJson } from './json';
import { buildContract, marketValue, suggestedYears, capHit } from './cap';
import { maxOffer, parseGmProfile, teamNeeds, RosterPlayer } from './ai/gm';
import { teamCapSummary } from './cap-summary';

/**
 * ===========================================================================
 * FREE AGENCY (design doc section 11)
 * ===========================================================================
 * The user negotiates directly (offer -> accept/counter/reject). AI teams run
 * a simple sealed-bid loop each time `runAiFreeAgencyWave` is called: every AI
 * team looks at its needs, decides a max offer per free agent it wants, and
 * the highest bidder above the player's asking price signs him. Called once
 * per offseason week during the FREE_AGENCY phase, and can also be invoked
 * on demand to fast-forward.
 * ===========================================================================
 */

export async function evaluateOffer(playerId: string, teamId: string, apy: number, years: number) {
  const player = await prisma.player.findUniqueOrThrow({ where: { id: playerId } });
  const market = marketValue({ ovr: player.trueOvr, position: player.position as any, age: player.age, potential: player.potential });
  // [TUNE] player accepts anything >= 90% of market; below that, a soft counter.
  const ratio = apy / market;
  if (ratio >= 0.9) return { accepted: true, ratio, market };
  return { accepted: false, ratio, market, counterApy: Math.round(market * 0.97) };
}

export async function signFreeAgent(opts: {
  leagueId: string;
  playerId: string;
  teamId: string;
  apy: number;
  years: number;
  seasonYear: number;
  capMode: LeagueSettings['capMode'];
  week: number;
}) {
  const { playerId, teamId, apy, years, seasonYear, capMode, week } = opts;

  const summary = await teamCapSummary(teamId, seasonYear, capMode);
  const contract = buildContract({ apy, years, signedYear: seasonYear });
  const hit = capHit({ ...contract, baseSalaries: writeJson(contract.baseSalaries) }, capMode);
  if (capMode !== 'OFF' && hit > summary.capSpace + 1) {
    throw new Error(`Signing would exceed the cap by ${Math.round((hit - summary.capSpace) / 1000)}K.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.player.update({ where: { id: playerId }, data: { teamId, status: 'ACTIVE' } });
    await tx.contract.deleteMany({ where: { playerId } });
    await tx.contract.create({
      data: {
        playerId,
        teamId,
        years: contract.years,
        yearsRemaining: contract.yearsRemaining,
        signedYear: contract.signedYear,
        baseSalaries: writeJson(contract.baseSalaries),
        signingBonus: contract.signingBonus,
        guaranteed: contract.guaranteed,
        isRookieDeal: false,
      },
    });
    const player = await tx.player.findUniqueOrThrow({ where: { id: playerId } });
    await tx.transaction.create({
      data: {
        leagueId: opts.leagueId,
        seasonYear,
        week,
        type: 'SIGN',
        teamId,
        headline: `Signed ${player.firstName} ${player.lastName}`,
        detail: `${years}-yr deal, ~$${(apy / 1_000_000).toFixed(1)}M/yr`,
      },
    });
  });
}

/**
 * Re-negotiate an existing rostered player's deal — a full replacement
 * contract, same idea as signFreeAgent but for a player who's already on
 * the roster (extension, not a new signing). The cap check compares the
 * NEW hit against space with the OLD contract's hit added back, since the
 * old deal is going away the instant this one is signed.
 */
export async function extendContract(opts: {
  leagueId: string;
  playerId: string;
  apy: number;
  years: number;
  seasonYear: number;
  capMode: LeagueSettings['capMode'];
  week: number;
  escalation?: number; // <1 front-loaded, >1 back-loaded
  voidYears?: number;
  bonusPct?: number;
}) {
  const { playerId, apy, years, seasonYear, capMode, week } = opts;
  const { capHit } = await import('./cap');

  const player = await prisma.player.findUniqueOrThrow({ where: { id: playerId }, include: { contract: true } });
  if (!player.teamId) throw new Error('Player is not on a roster.');
  const teamId = player.teamId;

  const summary = await teamCapSummary(teamId, seasonYear, capMode);
  const oldHit = player.contract ? capHit(player.contract, capMode) : 0;
  const availableSpace = summary.capSpace + oldHit;

  const contract = buildContract({ apy, years, signedYear: seasonYear, escalation: opts.escalation, bonusPct: opts.bonusPct });
  const newHit = capHit({ ...contract, baseSalaries: writeJson(contract.baseSalaries) }, capMode);
  if (capMode !== 'OFF' && newHit > availableSpace + 1) {
    throw new Error(`Extension would exceed the cap by ${Math.round((newHit - availableSpace) / 1000)}K.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.contract.deleteMany({ where: { playerId } });
    await tx.contract.create({
      data: {
        playerId,
        teamId,
        years: contract.years,
        yearsRemaining: contract.yearsRemaining,
        signedYear: contract.signedYear,
        baseSalaries: writeJson(contract.baseSalaries),
        signingBonus: contract.signingBonus,
        guaranteed: contract.guaranteed,
        isRookieDeal: false,
        voidYears: Math.max(0, opts.voidYears ?? 0),
      },
    });
    await tx.transaction.create({
      data: {
        leagueId: opts.leagueId, seasonYear, week, type: 'SIGN', teamId,
        headline: `Extended ${player.firstName} ${player.lastName}`,
        detail: `${years}-yr extension, ~$${(apy / 1_000_000).toFixed(1)}M/yr`,
      },
    });
  });
}

/**
 * Restructure the CURRENT contract in place — converts base salary into
 * signing bonus for immediate cap relief, at the cost of higher future cap
 * hits (and more dead money if cut later). Unlike extendContract this
 * doesn't change the player's total real years or pay — it only reshapes
 * WHEN the money hits the cap.
 */
export async function restructureContract(opts: {
  leagueId: string;
  playerId: string;
  convertAmount: number;
  addVoidYears?: number;
  seasonYear: number;
  capMode: LeagueSettings['capMode'];
  week: number;
}) {
  const { restructureContract: computeRestructure, capHit } = await import('./cap');

  const player = await prisma.player.findUniqueOrThrow({ where: { id: opts.playerId }, include: { contract: true } });
  if (!player.contract) throw new Error('Player has no contract to restructure.');
  if (opts.capMode !== 'REALISTIC') throw new Error('Restructuring only applies in Realistic cap mode.');
  if (player.contract.yearsRemaining < 1) throw new Error('Nothing left on this deal to restructure.');

  const next = computeRestructure(player.contract, opts.convertAmount, { addVoidYears: opts.addVoidYears, nowYear: opts.seasonYear });
  if (next.signingBonus === player.contract.signingBonus) {
    throw new Error('That conversion amount is too small to change anything — the base salary floor was already hit.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.contract.update({
      where: { playerId: opts.playerId },
      data: {
        years: next.years,
        yearsRemaining: next.yearsRemaining,
        signedYear: next.signedYear,
        baseSalaries: writeJson(next.baseSalaries),
        signingBonus: next.signingBonus,
        voidYears: next.voidYears,
      },
    });
    await tx.transaction.create({
      data: {
        leagueId: opts.leagueId, seasonYear: opts.seasonYear, week: opts.week, type: 'SIGN', teamId: player.teamId,
        headline: `Restructured ${player.firstName} ${player.lastName}'s contract`,
        detail: `Converted $${(opts.convertAmount / 1_000_000).toFixed(1)}M of base salary to bonus for cap relief.`,
      },
    });
  });

  return { newCapHit: capHit({ ...next, baseSalaries: writeJson(next.baseSalaries) }, opts.capMode) };
}

export async function cutPlayer(opts: {
  leagueId: string; playerId: string; capMode: LeagueSettings['capMode']; seasonYear: number; week: number;
}) {
  const player = await prisma.player.findUniqueOrThrow({ where: { id: opts.playerId }, include: { contract: true } });
  if (!player.teamId) throw new Error('Player is not on a roster.');

  await prisma.$transaction(async (tx) => {
    if (player.contract && opts.capMode === 'REALISTIC') {
      const { deadMoneyOnCut } = await import('./cap');
      const dead = deadMoneyOnCut(player.contract, opts.capMode);
      if (dead > 0) {
        await tx.capCharge.create({
          data: { teamId: player.teamId!, year: opts.seasonYear, amount: dead, label: `Dead money — ${player.firstName} ${player.lastName}` },
        });
      }
    }
    if (player.contract) await tx.contract.delete({ where: { playerId: player.id } });
    await tx.player.update({ where: { id: player.id }, data: { teamId: null, status: 'FREE_AGENT' } });
    await tx.transaction.create({
      data: {
        leagueId: opts.leagueId, seasonYear: opts.seasonYear, week: opts.week, type: 'CUT', teamId: player.teamId,
        headline: `Released ${player.firstName} ${player.lastName}`,
      },
    });
  });
}

/**
 * One AI free-agency pass: every non-user team with cap room + a real need
 * bids on the best available fits; highest bidder wins each contested player.
 * Deliberately simple — no multi-round bidding wars, one shot per call.
 */
export async function runAiFreeAgencyWave(leagueId: string, seasonYear: number, week: number, settings: LeagueSettings, rng: Rng) {
  const teams = await prisma.team.findMany({ where: { leagueId, isUser: false } });
  const freeAgents = await prisma.player.findMany({
    where: { leagueId, status: 'FREE_AGENT', teamId: null },
    orderBy: { trueOvr: 'desc' },
    take: 60,
  });
  if (freeAgents.length === 0 || teams.length === 0) return { signings: 0 };

  const bids: { playerId: string; teamId: string; offer: number }[] = [];

  for (const team of teams) {
    const roster = await prisma.player.findMany({ where: { teamId: team.id }, select: { id: true, position: true, trueOvr: true, age: true, potential: true } });
    const needs = teamNeeds(roster as RosterPlayer[]);
    const summary = await teamCapSummary(team.id, seasonYear, settings.capMode);
    const profile = parseGmProfile(team.gmProfile, rng);

    // Bid on the 3 highest-need positions among top available talent.
    const ranked = [...freeAgents].sort((a, b) => (needs[b.position] ?? 0) - (needs[a.position] ?? 0) || b.trueOvr - a.trueOvr);
    let budget = Math.max(0, summary.capSpace - 4_000_000);
    for (const fa of ranked.slice(0, 8)) {
      if (budget <= 0) break;
      const offer = maxOffer(fa as any, { profile, needs, capSpace: budget, rng });
      if (offer >= CAP.MIN_SALARY && (needs[fa.position] ?? 0) > 0.15) {
        bids.push({ playerId: fa.id, teamId: team.id, offer });
        budget -= offer;
      }
    }
  }

  // Resolve: highest bid per player wins, if it clears market floor.
  let signings = 0;
  const byPlayer = new Map<string, typeof bids>();
  for (const b of bids) {
    if (!byPlayer.has(b.playerId)) byPlayer.set(b.playerId, []);
    byPlayer.get(b.playerId)!.push(b);
  }
  for (const [playerId, offers] of byPlayer) {
    const player = freeAgents.find((f) => f.id === playerId)!;
    const market = marketValue({ ovr: player.trueOvr, position: player.position as any, age: player.age, potential: player.potential });
    const best = offers.sort((a, b) => b.offer - a.offer)[0];
    if (best.offer >= market * 0.85) {
      const years = suggestedYears(player.trueOvr, player.age);
      try {
        await signFreeAgent({
          leagueId, playerId, teamId: best.teamId, apy: Math.round(best.offer), years, seasonYear, capMode: settings.capMode, week,
        });
        signings += 1;
      } catch {
        /* cap edge case — skip this signing */
      }
    }
  }
  return { signings };
}
