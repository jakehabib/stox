import { prisma } from './db';
import { Rng, clamp } from './rng';
import { CAP, LEAGUE, FREE_AGENCY, ROSTER_TARGETS, Position, rosterMinFor } from './tuning';
import { LeagueSettings } from './settings';
import { readJson, writeJson } from './json';
import { buildContract, marketValue, suggestedYears, capHit, capSavingsOnCut, formatMoney, maxYearsForAge } from './cap';
import { buildScoutedView } from './scouting';
import { loadScoutMods } from './dynasty';
import {
  buildNegotiationContext, contractShapeFor, decideOffer, sessionFingerprint,
  DEFAULT_STRUCTURE,
  type DealStructure, type NegotiationGate, type NegotiationOutcome,
  type NegotiationSession, type Offer,
} from './negotiation';
import { maxOffer, parseGmProfile, teamNeeds, RosterPlayer } from './ai/gm';
import { teamCapSummary } from './cap-summary';
import { assertCapRoom } from './capEnforcement';

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

/**
 * ---------------------------------------------------------------------------
 * WHERE `evaluateOffer` WENT
 * ---------------------------------------------------------------------------
 * There used to be a second acceptance model here:
 *
 *     const ratio = apy / market;
 *     if (ratio >= 0.9) return { accepted: true, ... };
 *
 * — four lines, no personality, no term, no guarantee, no patience, no rival.
 * That was the function the server actually used, while lib/negotiation.ts's
 * full model (interest meter, personalities, reservation price, patience) sat
 * unimported. Two evaluators is one more than a game may have: the meter can
 * only be honest if the thing it draws is the thing that decides.
 *
 * So this one is gone. Acceptance now lives in exactly one place —
 * `decideOffer` in lib/negotiation.ts — and both the browser (per drag) and
 * the Server Action (on submit) call it. `resolveNegotiationSession` below
 * builds the input from the database; `negotiateOffer` is the only path that
 * signs anything a user negotiated.
 * ---------------------------------------------------------------------------
 */

export interface CompetingBid { teamId: string; teamName: string; teamAbbr: string; apy: number }

/**
 * The "auction" side of free agency: what's the single best offer an AI
 * team would actually put on this player RIGHT NOW, using the exact same
 * need/cap-space/aggression logic that decides their real sealed-bid wave —
 * so what the user sees here is a real threat, not flavor text. Seeded off
 * (player, team) rather than the clock, so re-checking the same matchup
 * mid-negotiation returns a stable number instead of re-rolling every call.
 */
export async function leadingCompetingBid(
  leagueId: string, playerId: string, excludeTeamId: string, seasonYear: number, capMode: LeagueSettings['capMode'],
): Promise<CompetingBid | null> {
  const player = await prisma.player.findUniqueOrThrow({ where: { id: playerId } });
  const teams = await prisma.team.findMany({ where: { leagueId, isUser: false, id: { not: excludeTeamId } } });

  let best: CompetingBid | null = null;
  for (const team of teams) {
    const roster = await prisma.player.findMany({ where: { teamId: team.id }, select: { id: true, position: true, trueOvr: true, age: true, potential: true } });
    const needs = teamNeeds(roster as RosterPlayer[]);
    if ((needs[player.position] ?? 0) < 0.15) continue; // no real interest — wouldn't actually bid

    const summary = await teamCapSummary(team.id, seasonYear, capMode);
    const rng = new Rng(`fa-bid-${playerId}-${team.id}`);
    const profile = parseGmProfile(team.gmProfile, rng);
    const offer = maxOffer(player as unknown as RosterPlayer, { profile, needs, capSpace: Math.max(0, summary.capSpace - 4_000_000), rng });
    if (offer >= CAP.MIN_SALARY && (!best || offer > best.apy)) {
      best = { teamId: team.id, teamName: `${team.city} ${team.nickname}`, teamAbbr: team.abbr, apy: Math.round(offer) };
    }
  }
  return best;
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
  /** <1 front-loaded, >1 back-loaded. Same structuring the extension path allows. */
  escalation?: number;
  /** Share of total value paid as signing bonus — what the guarantee slider buys. */
  bonusPct?: number;
  guaranteedPct?: number;
  /** Cap-only trailing years. Settled as a cap charge when the deal expires (see lib/season.ts). */
  voidYears?: number;
}) {
  const { playerId, teamId, apy, years, seasonYear, capMode, week } = opts;
  const voidYears = Math.max(0, opts.voidYears ?? 0);

  const contract = buildContract({
    apy, years, signedYear: seasonYear, escalation: opts.escalation,
    bonusPct: opts.bonusPct, guaranteedPct: opts.guaranteedPct,
  });
  // Void years widen the proration divisor, so they change the year-1 hit the
  // cap check has to clear — build the check off the same shape that gets stored.
  const hit = capHit({ ...contract, baseSalaries: writeJson(contract.baseSalaries), voidYears }, capMode);
  await assertCapRoom({ action: 'Signing', seasonYear, capMode, charges: [{ teamId, delta: hit }] });

  await prisma.$transaction(async (tx) => {
    // yearsUnsigned resets the moment somebody signs him — it only counts
    // CONSECUTIVE years on the street (see progressFreeAgents in
    // lib/development.ts, which rolls attrition off it).
    await tx.player.update({ where: { id: playerId }, data: { teamId, status: 'ACTIVE', yearsUnsigned: 0 } });
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
        voidYears,
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
  guaranteedPct?: number;
  /**
   * True when this is a team keeping its OWN expiring player rather than
   * tearing up a deal with years left on it. Writes a RESIGN transaction
   * instead of a SIGN one — both the news-wire type filter
   * (app/league/[id]/layout.tsx) and lib/newsCategory.ts already handle
   * RESIGN, but until now nothing in the codebase ever produced one, so
   * "kept his own guy" and "extended a player under contract" were
   * indistinguishable on the wire.
   *
   * Defaults to whether the current deal is actually expiring, so the user's
   * own re-signs read the same way on the wire as the AI's without every
   * call site having to remember to say so.
   */
  reSign?: boolean;
}) {
  const { playerId, apy, years, seasonYear, capMode, week } = opts;
  const { capHit } = await import('./cap');

  const player = await prisma.player.findUniqueOrThrow({ where: { id: playerId }, include: { contract: true } });
  if (!player.teamId) throw new Error('Player is not on a roster.');
  const teamId = player.teamId;

  const oldHit = player.contract ? capHit(player.contract, capMode) : 0;
  const reSign = opts.reSign ?? (player.contract ? player.contract.yearsRemaining <= 1 : false);
  const contract = buildContract({
    apy, years, signedYear: seasonYear, escalation: opts.escalation,
    bonusPct: opts.bonusPct, guaranteedPct: opts.guaranteedPct,
  });
  const newHit = capHit({ ...contract, baseSalaries: writeJson(contract.baseSalaries) }, capMode);
  // The old deal is torn up the instant this one is signed, so its hit is
  // credited back before the new one is measured against the ceiling.
  await assertCapRoom({
    action: 'Extension', seasonYear, capMode,
    charges: [{ teamId, delta: newHit, creditBack: oldHit }],
  });

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
        leagueId: opts.leagueId, seasonYear, week,
        type: reSign ? 'RESIGN' : 'SIGN', teamId,
        headline: reSign
          ? `Re-signed ${player.firstName} ${player.lastName}`
          : `Extended ${player.firstName} ${player.lastName}`,
        detail: reSign
          ? `${years}-yr deal, ~$${(apy / 1_000_000).toFixed(1)}M/yr`
          : `${years}-yr extension, ~$${(apy / 1_000_000).toFixed(1)}M/yr`,
      },
    });
  });
}

/**
 * Franchise tag: a 1-year, fully guaranteed contract at the average of the
 * top-N salaries at the position league-wide (franchiseTagValue in
 * lib/cap.ts), keeping a player off the open market without a negotiated
 * long-term deal. Real-NFL simplification for now — one tag per team per
 * season, no exclusive/non-exclusive split, no escalating value for a
 * second consecutive tag on the same player (that needs contract-history
 * tracking this schema doesn't keep once a contract is replaced) — see
 * README's Known Simplifications.
 */
export async function applyFranchiseTag(opts: {
  leagueId: string;
  playerId: string;
  seasonYear: number;
  capMode: LeagueSettings['capMode'];
  week: number;
}) {
  const { franchiseTagValue } = await import('./cap');
  const { playerId, seasonYear, capMode } = opts;

  const player = await prisma.player.findUniqueOrThrow({ where: { id: playerId }, include: { contract: true } });
  if (!player.teamId) throw new Error('Player is not on a roster.');
  const teamId = player.teamId;

  const alreadyTagged = await prisma.contract.findFirst({ where: { teamId, isFranchiseTag: true, signedYear: seasonYear } });
  if (alreadyTagged) throw new Error('Already used your franchise tag this offseason — one per team, per year.');

  const positionPeers = await prisma.player.findMany({
    where: { leagueId: opts.leagueId, position: player.position, status: 'ACTIVE' },
    include: { contract: true },
  });
  const positionSalaries = positionPeers.map((p) => capHit(p.contract, capMode)).filter((v) => v > 0);
  const tagValue = franchiseTagValue(positionSalaries);

  const oldHit = player.contract ? capHit(player.contract, capMode) : 0;
  await assertCapRoom({
    action: 'Franchise tag', seasonYear, capMode,
    charges: [{ teamId, delta: tagValue, creditBack: oldHit }],
  });

  await prisma.$transaction(async (tx) => {
    await tx.contract.deleteMany({ where: { playerId } });
    await tx.contract.create({
      data: {
        playerId, teamId,
        years: 1, yearsRemaining: 1, signedYear: seasonYear,
        baseSalaries: writeJson([tagValue]),
        signingBonus: 0,
        guaranteed: tagValue,
        isRookieDeal: false,
        isFranchiseTag: true,
      },
    });
    await tx.transaction.create({
      data: {
        leagueId: opts.leagueId, seasonYear, week: opts.week, type: 'TAG', teamId,
        headline: `${player.firstName} ${player.lastName} franchise-tagged`,
        detail: `1-yr, fully guaranteed at ${formatMoney(tagValue)}`,
      },
    });
  });

  return { tagValue };
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

  // A restructure normally FREES room, but not always: rebasing re-prorates
  // the whole (old + newly converted) bonus over just the years that are
  // left, so restructuring a bonus-heavy deal late in its life can raise
  // this year's hit instead of lowering it. Same gate as every other move,
  // and a no-op in the common cap-relief direction since delta <= 0 there.
  const oldHit = capHit(player.contract, opts.capMode);
  const newHit = capHit({ ...next, baseSalaries: writeJson(next.baseSalaries) }, opts.capMode);
  if (player.teamId) {
    await assertCapRoom({
      action: 'Restructure', seasonYear: opts.seasonYear, capMode: opts.capMode,
      charges: [{ teamId: player.teamId, delta: newHit - oldHit }],
    });
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

/**
 * The user's side of the "frenzy": before locking in a signing, check
 * whether an AI team would actually beat this exact offer. If so, that
 * rival team signs him right now (using their own real max offer) instead
 * of the user — a real loss with real stakes, not just a UI warning — and
 * the user finds out immediately rather than discovering it days later.
 */
export async function signFreeAgentWithCompetition(opts: {
  leagueId: string; playerId: string; teamId: string; apy: number; years: number;
  seasonYear: number; capMode: LeagueSettings['capMode']; week: number;
  escalation?: number; voidYears?: number; bonusPct?: number; guaranteedPct?: number;
}) {
  const competing = await leadingCompetingBid(opts.leagueId, opts.playerId, opts.teamId, opts.seasonYear, opts.capMode);
  if (competing && competing.apy > opts.apy) {
    const player = await prisma.player.findUniqueOrThrow({ where: { id: opts.playerId } });
    await signFreeAgent({
      leagueId: opts.leagueId, playerId: opts.playerId, teamId: competing.teamId,
      apy: competing.apy, years: suggestedYears(player.trueOvr, player.age),
      seasonYear: opts.seasonYear, capMode: opts.capMode, week: opts.week,
    }).catch(() => { /* rival couldn't actually close it either — player just stays in free agency */ });
    throw new Error(`Outbid — the ${competing.teamName} swooped in at ~$${(competing.apy / 1_000_000).toFixed(1)}M/yr before you closed the deal.`);
  }
  return signFreeAgent(opts);
}

export async function cutPlayer(opts: {
  leagueId: string; playerId: string; capMode: LeagueSettings['capMode']; seasonYear: number; week: number;
}) {
  const player = await prisma.player.findUniqueOrThrow({ where: { id: opts.playerId }, include: { contract: true } });
  if (!player.teamId) throw new Error('Player is not on a roster.');
  // Read the phase here rather than making every caller pass it: which league
  // year the dead money lands in depends on where in the offseason roll the
  // cut happens (see capChargeYear), and getting that wrong made cuts free.
  const league = await prisma.league.findUniqueOrThrow({
    where: { id: opts.leagueId }, select: { phase: true, week: true, seasonYear: true },
  });

  await prisma.$transaction(async (tx) => {
    if (player.contract && opts.capMode === 'REALISTIC') {
      const { deadMoneyOnCut, capChargeYear } = await import('./cap');
      const dead = deadMoneyOnCut(player.contract, opts.capMode);
      if (dead > 0) {
        await tx.capCharge.create({
          data: {
            teamId: player.teamId!,
            year: capChargeYear({ phase: league.phase, week: league.week, seasonYear: opts.seasonYear }),
            amount: dead,
            label: `Dead money — ${player.firstName} ${player.lastName}`,
          },
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
 *
 * UPGRADE-AND-DISPLACE. This used to `continue` past any team with no open
 * roster slot, which read as reasonable and was in fact a permanent sink: at
 * a steady-state roster of 50-52 essentially every team was excluded every
 * week, so nobody bid on anybody. Measured over 13 simulated seasons the
 * unsigned pool grew 140 -> 4,411 and ended up holding 593 players rated 80+
 * and 151 rated 90+ — including 97-overall players — in a 32-team league,
 * while league-wide SIGN transactions fell to single digits per year.
 *
 * A real front office at a full roster does not stop reading the wire. It
 * signs the better player and releases the man he beats. So a team with no
 * open slot now still bids, on the condition that the free agent is a clear
 * upgrade on the WORST player it has at that position — guarded by
 * FREE_AGENCY.MIN_UPGRADE_DELTA (no churning for a rounding error), by the
 * rule that only depth beyond what ROSTER_TARGETS asks for may be displaced
 * (so an upgrade can never open a hole), and by
 * MAX_DISPLACE_PER_TEAM_PER_WAVE (no rebuilding a roster in one click). The
 * displaced player's release runs through the ordinary cut path, dead money
 * and all, and the signing runs through the ordinary assertCapRoom path, so
 * upgrading is a cap decision like every other.
 */
/** Share of market value a free agent will actually sign for. [TUNE] */
const MARKET_FLOOR = 0.85;

export async function runAiFreeAgencyWave(leagueId: string, seasonYear: number, week: number, settings: LeagueSettings, rng: Rng) {
  const teams = await prisma.team.findMany({ where: { leagueId, isUser: false } });
  // isDraftee players aren't real free agents yet — they're this year's
  // rookie class waiting for the draft. Without excluding them, AI teams
  // were signing undrafted prospects off the board before the draft ever
  // happened, quietly draining the draft pool.
  const freeAgents = await prisma.player.findMany({
    where: { leagueId, status: 'FREE_AGENT', teamId: null, isDraftee: false },
    orderBy: [{ trueOvr: 'desc' }, { id: 'asc' }],
    take: FREE_AGENCY.WAVE_BOARD_SIZE,
  });
  if (freeAgents.length === 0 || teams.length === 0) return { signings: 0, displaced: 0 };

  interface Bid { playerId: string; teamId: string; offer: number; displacePlayerId?: string }
  const bids: Bid[] = [];

  for (const team of teams) {
    const roster = await prisma.player.findMany({
      where: { teamId: team.id, status: 'ACTIVE' },
      select: { id: true, position: true, trueOvr: true, age: true, potential: true, contract: true },
      orderBy: [{ trueOvr: 'asc' }, { id: 'asc' }],
    });
    const needs = teamNeeds(roster as RosterPlayer[]);
    const summary = await teamCapSummary(team.id, seasonYear, settings.capMode);
    const profile = parseGmProfile(team.gmProfile, rng);

    // Leave room for the rookie class. This wave only ever runs during
    // FREE_AGENCY, and the draft lands immediately after it, so filling all
    // the way to rosterMax here just means cutting those same players again
    // on cut-down day (see trimRostersToLimit in lib/season.ts). Reserve only
    // the share of the class that realistically sticks, not the whole class.
    const rosterMax = settings.rosterMax ?? LEAGUE.ROSTER_MAX;
    const rookieReserve = Math.ceil(settings.draftRounds * LEAGUE.ROOKIE_ROSTER_HIT_RATE);
    let openSlots = Math.max(0, rosterMax - roster.length - rookieReserve);
    let displacesLeft = FREE_AGENCY.MAX_DISPLACE_PER_TEAM_PER_WAVE;

    // The worst man at each position — the one a genuine upgrade would push
    // off the roster. `roster` is already sorted worst-first, so the first
    // hit per position is the answer.
    const worstAtPosition = new Map<string, { id: string; trueOvr: number; frees: number }>();
    const countAtPosition = new Map<string, number>();
    for (const p of roster) {
      if (!worstAtPosition.has(p.position)) {
        worstAtPosition.set(p.position, {
          id: p.id, trueOvr: p.trueOvr,
          // Releasing him frees this year's hit less the dead money he leaves
          // behind. Sizing the offer WITHOUT it (as this first did) prices
          // every upgrade as if the roster spot were free but the money were
          // not, which is exactly backwards.
          frees: capSavingsOnCut(p.contract, settings.capMode),
        });
      }
      countAtPosition.set(p.position, (countAtPosition.get(p.position) ?? 0) + 1);
    }
    const alreadyDisplaced = new Set<string>();

    // Bid on the highest-need positions among top available talent.
    const ranked = [...freeAgents].sort((a, b) => (needs[b.position] ?? 0) - (needs[a.position] ?? 0) || b.trueOvr - a.trueOvr);
    let budget = Math.max(0, summary.capSpace - 4_000_000);
    for (const fa of ranked) {
      if (openSlots <= 0 && displacesLeft <= 0) break;
      if (budget <= 0) break;

      let displace: { id: string; trueOvr: number; frees: number } | null = null;
      if (openSlots <= 0) {
        // No room — this only happens if he beats somebody already here.
        const worst = worstAtPosition.get(fa.position);
        if (!worst || alreadyDisplaced.has(worst.id)) continue;
        if (fa.trueOvr - worst.trueOvr < FREE_AGENCY.MIN_UPGRADE_DELTA) continue;
        // Only depth BEYOND what the position spec asks for is displaceable,
        // so an upgrade can never open a hole the roster is required to fill.
        // Structural on purpose: a rating threshold stops meaning anything the
        // moment league-wide ratings move.
        if ((countAtPosition.get(fa.position) ?? 0) <= (ROSTER_TARGETS[fa.position as Position]?.min ?? 1)) continue;
        displace = worst;
      } else if ((needs[fa.position] ?? 0) <= 0.15) {
        continue; // no real need and no upgrade case — not a bid
      }

      // A displacement pays for part of itself: the man going out stops
      // counting against the cap the moment he is released.
      const freed = displace?.frees ?? 0;
      const offer = maxOffer(fa as any, { profile, needs, capSpace: budget + freed, rng });
      if (offer < CAP.MIN_SALARY) continue;
      // Don't commit budget to a bid that cannot possibly win. maxOffer caps
      // the offer at what the team can afford, and the resolution step below
      // throws out anything under 85% of market — so a team facing a free
      // agent it cannot afford used to bid its entire remaining budget on him,
      // have that bid rejected, and then `break` on an exhausted budget
      // without having signed anyone. Because the board is sorted best-first
      // once needs flatten out, every team in the league did this to the same
      // unaffordable player, every week: measured 17 signings league-wide in
      // the final year of a 13-season run while 350 free agents rated 80+ sat
      // unsigned. Applying the same floor here, before the money is committed,
      // lets a team walk down the board to somebody it can actually sign.
      const market = marketValue({ ovr: fa.trueOvr, position: fa.position as any, age: fa.age, potential: fa.potential });
      if (offer < market * MARKET_FLOOR) continue;

      bids.push({ playerId: fa.id, teamId: team.id, offer, displacePlayerId: displace?.id });
      budget -= offer - freed;
      if (displace) {
        alreadyDisplaced.add(displace.id);
        displacesLeft--;
      } else {
        openSlots--;
      }
    }
  }

  // Resolve: highest bid per player wins, if it clears market floor.
  let signings = 0;
  let displaced = 0;
  const byPlayer = new Map<string, Bid[]>();
  for (const b of bids) {
    if (!byPlayer.has(b.playerId)) byPlayer.set(b.playerId, []);
    byPlayer.get(b.playerId)!.push(b);
  }
  // A player can only be displaced once across the whole wave, and only by the
  // bid that actually lands.
  const releasedThisWave = new Set<string>();
  for (const [playerId, offers] of byPlayer) {
    const player = freeAgents.find((f) => f.id === playerId)!;
    const market = marketValue({ ovr: player.trueOvr, position: player.position as any, age: player.age, potential: player.potential });
    const best = offers.sort((a, b) => b.offer - a.offer || a.teamId.localeCompare(b.teamId))[0];
    if (best.offer < market * MARKET_FLOOR) continue;

    const years = suggestedYears(player.trueOvr, player.age);
    try {
      if (best.displacePlayerId) {
        if (releasedThisWave.has(best.displacePlayerId)) continue;
        // Check the swap fits BEFORE anyone is released, so a failed signing
        // can never leave a team a body short for nothing. The release frees
        // this year's hit minus the dead money it leaves behind, which is
        // exactly capSavingsOnCut.
        const outgoing = await prisma.player.findUnique({ where: { id: best.displacePlayerId }, include: { contract: true } });
        if (!outgoing || outgoing.teamId !== best.teamId) continue;
        const preview = buildContract({ apy: Math.round(best.offer), years, signedYear: seasonYear });
        const incomingHit = capHit({ ...preview, baseSalaries: writeJson(preview.baseSalaries) }, settings.capMode);
        const freed = capSavingsOnCut(outgoing.contract, settings.capMode);
        const summary = await teamCapSummary(best.teamId, seasonYear, settings.capMode);
        if (incomingHit > summary.capSpace + freed) continue;

        await cutPlayer({ leagueId, playerId: best.displacePlayerId, capMode: settings.capMode, seasonYear, week });
        releasedThisWave.add(best.displacePlayerId);
        displaced += 1;
      }
      await signFreeAgent({
        leagueId, playerId, teamId: best.teamId, apy: Math.round(best.offer), years, seasonYear, capMode: settings.capMode, week,
      });
      signings += 1;
    } catch {
      /* cap edge case — skip this signing */
    }
  }
  return { signings, displaced };
}

/**
 * Every AI team below a legal roster signs minimum-salary bodies until it
 * isn't. Recovery, not strategy — it exists because a team that had a bad
 * re-sign year used to stay short forever: nothing in the game ever measured
 * a roster against ROSTER_MIN, and the free-agency wave (which might have
 * fixed it) was itself gated on having open slots the short team did have but
 * never used, because its remaining needs scored below the bid threshold.
 * Measured on 19 of 22 pre-existing saves: minimum roster 27, median 33, and
 * one save with all 32 teams under the minimum.
 *
 * Deliberately blunt: best available body at the least-covered position,
 * league minimum, one year. A short team is not in a position to be picky,
 * and every one of these deals expires immediately so it costs the franchise
 * nothing beyond this season. User teams are never touched — filling the
 * human's roster is the "Fill Roster" button's job, on his own click.
 */
export async function fillTeamsToRosterMinimum(
  leagueId: string, seasonYear: number, week: number, settings: LeagueSettings, rng: Rng,
): Promise<number> {
  const rosterMax = settings.rosterMax ?? LEAGUE.ROSTER_MAX;
  const rosterMin = rosterMinFor(rosterMax);
  const teams = await prisma.team.findMany({ where: { leagueId, isUser: false }, select: { id: true }, orderBy: { id: 'asc' } });

  let signed = 0;
  const taken = new Set<string>();

  for (const team of teams) {
    let roster = await prisma.player.findMany({
      where: { teamId: team.id, status: 'ACTIVE' },
      select: { id: true, position: true, trueOvr: true, age: true, potential: true },
    });
    if (roster.length >= rosterMin) continue;

    const pool = await prisma.player.findMany({
      where: { leagueId, status: 'FREE_AGENT', teamId: null, isDraftee: false },
      orderBy: [{ trueOvr: 'desc' }, { id: 'asc' }],
      take: (rosterMin - roster.length) * 8 + 120,
    });

    while (roster.length < rosterMin) {
      const needs = teamNeeds(roster as RosterPlayer[]);
      const wanted = Object.entries(needs).sort((a, b) => b[1] - a[1]).map(([pos]) => pos);
      const pick = pool.find((c) => !taken.has(c.id) && c.position === wanted[0])
        ?? pool.find((c) => !taken.has(c.id) && wanted.slice(0, 5).includes(c.position))
        ?? pool.find((c) => !taken.has(c.id));
      if (!pick) break; // the market is genuinely empty

      const ok = await signFreeAgent({
        leagueId, playerId: pick.id, teamId: team.id,
        apy: CAP.MIN_SALARY, years: 1, seasonYear, capMode: settings.capMode, week,
      }).then(() => true).catch(() => false);
      taken.add(pick.id);
      if (!ok) break; // no cap room even for the minimum — nothing more to try
      signed += 1;
      roster = [...roster, { id: pick.id, position: pick.position, trueOvr: pick.trueOvr, age: pick.age, potential: pick.potential }];
    }
  }
  return signed;
}

/**
 * "Fill Roster" — sign free agents for the user's own understaffed
 * positions, using the exact same market-value offer and cap-enforcing
 * signFreeAgent() path as every other signing in the game (AI waves and
 * user negotiation alike). One pass = at most one signing per position
 * that still shows a notable need, most severe first — click again for
 * another pass if bodies or cap room remain.
 */
export async function fillRosterForTeam(opts: {
  leagueId: string;
  teamId: string;
  seasonYear: number;
  week: number;
  settings: LeagueSettings;
  rng: Rng;
}): Promise<{ signed: { name: string; position: string; apy: number }[] }> {
  const { leagueId, teamId, seasonYear, week, settings, rng } = opts;
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
  const profile = parseGmProfile(team.gmProfile, rng);
  const signed: { name: string; position: string; apy: number }[] = [];

  const roster = await prisma.player.findMany({ where: { teamId }, select: { id: true, position: true, trueOvr: true, age: true, potential: true } });
  const needs = teamNeeds(roster as RosterPlayer[]);
  let openSlots = Math.max(0, (settings.rosterMax ?? LEAGUE.ROSTER_MAX) - roster.length);
  const neededPositions = Object.entries(needs)
    .filter(([, v]) => v >= 0.15) // same "Notable" floor as the Roster Needs widget
    .sort((a, b) => b[1] - a[1]);

  const takenIds = new Set<string>();
  for (const [position, needScore] of neededPositions) {
    if (openSlots <= 0) break; // a legal roster tops out at rosterMax
    const summary = await teamCapSummary(teamId, seasonYear, settings.capMode);
    const budget = Math.max(0, summary.capSpace - 3_000_000);
    if (budget < CAP.MIN_SALARY) break; // no room left at all — stop trying

    const candidates = await prisma.player.findMany({
      where: { leagueId, status: 'FREE_AGENT', teamId: null, isDraftee: false, position },
      orderBy: { trueOvr: 'desc' },
      take: 10,
    });
    const pick = candidates.find((c) => !takenIds.has(c.id));
    if (!pick) continue; // nobody left at this position this pass

    const offer = maxOffer(pick as unknown as RosterPlayer, { profile, needs: { [position]: needScore }, capSpace: budget, rng });
    if (offer < CAP.MIN_SALARY) continue;

    const apy = Math.round(offer);
    const years = suggestedYears(pick.trueOvr, pick.age);
    try {
      await signFreeAgent({ leagueId, playerId: pick.id, teamId, apy, years, seasonYear, capMode: settings.capMode, week });
      takenIds.add(pick.id);
      openSlots--;
      signed.push({ name: `${pick.firstName} ${pick.lastName}`, position, apy });
    } catch {
      /* cap edge case — try the next position */
    }
  }

  return { signed };
}

/**
 * ===========================================================================
 * NEGOTIATION (the user's side of the table)
 * ===========================================================================
 * Two entry points, both used by both screens (free agency and the re-sign
 * window):
 *
 *   resolveNegotiationSession  — read the world once, resolve every random
 *                                draw, hand the client a NegotiationSession.
 *   negotiateOffer             — re-resolve, re-decide, and act.
 *
 * The client re-runs `decideOffer` on the session it was given for every
 * pixel of every slider, which is the only reason the interest meter can move
 * without a request per frame. Nothing it computes is trusted: the session is
 * resolved again here from the database, the decision is taken again with the
 * same function, and a session that has MOVED under the user (a rival's cap
 * space changed, your own cap changed) is refused outright rather than
 * silently re-priced — acting on terms the meter was not describing is the
 * lying-metric failure this whole exercise exists to remove.
 * ===========================================================================
 */

export async function resolveNegotiationSession(opts: {
  leagueId: string;
  playerId: string;
  teamId: string;
  seasonYear: number;
  settings: LeagueSettings;
  /** True when this is your own expiring player, not an outside free agent. */
  incumbent: boolean;
}): Promise<NegotiationSession> {
  const { leagueId, playerId, teamId, seasonYear, settings, incumbent } = opts;
  const capMode = settings.capMode;

  const player = await prisma.player.findUniqueOrThrow({ where: { id: playerId }, include: { contract: true } });
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });

  // The market number the user SEES is priced off what they know of him —
  // the same scouted view the free-agency table and the player page render,
  // so the panel never quotes a different estimate than the row you clicked.
  const report = await prisma.scoutingReport.findUnique({
    where: { playerId_teamId: { playerId, teamId } },
  });
  const view = buildScoutedView({
    position: player.position as Position,
    trueAttrs: readJson(player.trueAttrs, {}),
    trueOvr: player.trueOvr,
    potential: player.potential,
    report,
    settings,
    isOwnRoster: incumbent,
    isUserView: true,
    dynasty: await loadScoutMods(leagueId),
  });
  const marketApy = marketValue({ ovr: view.scoutedOvr, position: player.position as Position, age: player.age });
  const trueMarketApy = marketValue({
    ovr: player.trueOvr, position: player.position as Position, age: player.age, potential: player.potential,
  });

  // Rival interest. A free agent is being shopped by his agent; your own
  // expiring player is not on the market yet, which is precisely the reason
  // to get ahead of it — see the re-sign window's own copy.
  const competing = incumbent
    ? null
    : await leadingCompetingBid(leagueId, playerId, teamId, seasonYear, capMode);
  const competition = competing ? clamp(competing.apy / Math.max(1, trueMarketApy), 0.3, 1) : 0;

  const played = team.wins + team.losses + team.ties;
  const winPct = played > 0 ? (team.wins + team.ties * 0.5) / played : team.prestige / 100;
  const teamStrength = clamp(winPct * 0.5 + (team.prestige / 100) * 0.5, 0, 1);

  const ctx = buildNegotiationContext({
    playerId,
    playerName: `${player.firstName} ${player.lastName}`,
    position: player.position,
    age: player.age,
    ovr: player.trueOvr,
    marketApy,
    trueMarketApy,
    incumbent,
    teamStrength,
    yearsWithTeam: incumbent && player.contract ? Math.max(0, seasonYear - player.contract.signedYear) : 0,
    competition,
    // Seeded on the matchup and the league year — NOT the clock. Re-opening
    // the panel, refreshing the page or submitting an offer all rebuild the
    // identical man with the identical asking price; only the season rolling
    // over gives him a new read on himself.
    rng: new Rng(`nego-${playerId}-${teamId}-${seasonYear}`),
  });

  // Cap room. An extension credits back the deal it replaces, exactly as
  // assertCapRoom will when it runs for real — the gate has to measure
  // against the same number the enforcement does or the meter would refuse
  // deals the server would have allowed.
  const oldHit = incumbent && player.contract ? capHit(player.contract, capMode) : 0;
  const capSpace = capMode === 'OFF'
    ? Number.MAX_SAFE_INTEGER
    : (await teamCapSummary(teamId, seasonYear, capMode)).capSpace + oldHit;

  const maxYears = maxYearsForAge(player.age);
  const ceilingFloor = Math.max(CAP.MIN_SALARY * 2, Math.round(marketApy * 2.5));
  const gate: NegotiationGate = {
    capMode,
    capSpace,
    minSalary: CAP.MIN_SALARY,
    // The ceiling has to clear a rival's bid, or the one control that could
    // win the auction would stop short of the number that wins it.
    maxSalary: Math.max(ceilingFloor, competing ? Math.round(competing.apy * 1.15) : 0),
    maxYears,
    competingApy: competing?.apy ?? 0,
    competingTeam: competing?.teamName ?? null,
  };

  return { ctx, gate };
}

/**
 * Submit an offer for real.
 *
 * `patienceSpent` is what the client believes it has burned so far. It is not
 * trusted for anything except pacing: the server recomputes the COST of this
 * offer itself, and every consequence that touches the database (he signs
 * elsewhere) is decided here. A client that lied about it can only give
 * itself a negotiation that never ends, which is the behaviour this feature
 * replaced.
 */
export async function negotiateOffer(opts: {
  leagueId: string;
  playerId: string;
  teamId: string;
  seasonYear: number;
  week: number;
  settings: LeagueSettings;
  incumbent: boolean;
  offer: Offer;
  structure?: DealStructure;
  patienceSpent: number;
  /** Fingerprint of the session the user was actually looking at. */
  fingerprint?: string;
}): Promise<NegotiationOutcome> {
  const { leagueId, playerId, teamId, seasonYear, week, settings, incumbent } = opts;
  const structure = opts.structure ?? DEFAULT_STRUCTURE;
  const session = await resolveNegotiationSession({ leagueId, playerId, teamId, seasonYear, settings, incumbent });
  const decision = decideOffer(session.ctx, opts.offer, session.gate, structure);
  const spentBefore = clamp(Math.round(opts.patienceSpent) || 0, 0, session.ctx.patience);

  const base = { session, decision, patienceSpent: spentBefore, walkedAway: spentBefore >= session.ctx.patience };

  // The world moved between opening the panel and pressing the button. The
  // meter was describing a negotiation that no longer exists, so nothing is
  // charged and nothing is signed — the fresh session goes back and the meter
  // re-reads in front of the user.
  if (opts.fingerprint && opts.fingerprint !== sessionFingerprint(session)) {
    return {
      ...base,
      ok: false,
      message: 'The terms moved while you were deciding — the meter has been re-read. Look again before you offer.',
    };
  }

  if (base.walkedAway) {
    return { ...base, ok: false, message: 'His agent is no longer taking your calls.' };
  }

  // --- He would sign it -----------------------------------------------------
  if (decision.accepted) {
    const shape = contractShapeFor(opts.offer);
    try {
      if (incumbent) {
        await extendContract({
          leagueId, playerId, apy: opts.offer.apy, years: opts.offer.years, seasonYear,
          capMode: settings.capMode, week, escalation: structure.escalation, voidYears: structure.voidYears,
          bonusPct: shape.bonusPct, guaranteedPct: shape.guaranteedPct, reSign: true,
        });
      } else {
        // Still goes through the competition path: between resolving the
        // session and this line an AI team can have moved, and if it has, the
        // player leaves with them. That is the drama of an open market and it
        // is not something the user's click may override.
        await signFreeAgentWithCompetition({
          leagueId, playerId, teamId, apy: opts.offer.apy, years: opts.offer.years, seasonYear,
          capMode: settings.capMode, week, escalation: structure.escalation, voidYears: structure.voidYears,
          bonusPct: shape.bonusPct, guaranteedPct: shape.guaranteedPct,
        });
      }
    } catch (err) {
      // Cap refusals and last-second outbids are foreseeable, user-recoverable
      // outcomes, not bugs — they must never escape a Server Action uncaught.
      return { ...base, ok: false, message: err instanceof Error ? err.message : 'The deal fell through.' };
    }
    return {
      ...base,
      ok: true,
      message: incumbent
        ? `${session.ctx.playerName} is staying — ${opts.offer.years} year${opts.offer.years === 1 ? '' : 's'} at ${formatMoney(opts.offer.apy)}/yr.`
        : `${session.ctx.playerName} signs — ${opts.offer.years} year${opts.offer.years === 1 ? '' : 's'} at ${formatMoney(opts.offer.apy)}/yr.`,
    };
  }

  // --- The ledger said no, not the player ----------------------------------
  // Never reached him, so it costs nothing but the click.
  if (decision.blocked) {
    return { ...base, ok: false, message: decision.reason ?? 'This offer cannot be made.' };
  }

  // --- He turned it down ---------------------------------------------------
  // Being outbid is a refusal like any other and is charged like one. It used
  // to end the negotiation outright — you offered a dollar under the rival's
  // number and he was gone on the spot — which read as brutal and, worse,
  // made patience meaningless for exactly the players patience is for: with a
  // rival at the table every negotiation was a single shot. Now his agent
  // takes your offer, shops it, and comes back; you lose him when the pips
  // run out, which is a thing the panel has been counting down in front of
  // you the whole time.
  const cost = decision.patienceCost;
  const patienceSpent = Math.min(session.ctx.patience, spentBefore + cost);
  const walkedAway = patienceSpent >= session.ctx.patience;

  if (walkedAway && !incumbent) {
    // Out of patience on the open market is not a soft ending: he takes the
    // best offer on the table and he is gone. This is the one part of the
    // patience mechanic that survives a page reload, and it is the part that
    // matters — the counter is pacing, the loss is the consequence.
    const lost = await loseToCompetingBid({
      leagueId, playerId, teamId, seasonYear, capMode: settings.capMode, week,
    });
    if (lost) {
      return {
        ...base, ok: false, patienceSpent, walkedAway, lostTo: lost,
        message: `He is done with you — signed with the ${lost.teamName} at ${formatMoney(lost.apy)}/yr.`,
      };
    }
    return {
      ...base, ok: false, patienceSpent, walkedAway,
      message: 'His agent has stopped returning your calls. He will wait for a better offer than yours.',
    };
  }

  return {
    ...base,
    ok: false,
    patienceSpent,
    walkedAway,
    message: walkedAway
      ? `${session.ctx.playerName} has ended talks. He will test the market.`
      : decision.outbid
        ? `They shopped it — ${session.gate.competingTeam ?? 'another club'} is still at ${formatMoney(session.gate.competingApy)}/yr and he is not signing for less.`
        : decision.evaluation.insulting
          ? `${decision.evaluation.headline} That one cost you.`
          : decision.evaluation.headline,
  };
}

/**
 * Hand the player to the leading rival, for real. Used both when the user
 * submits into a losing auction and when he runs out of patience with them
 * still bidding. Returns null when nobody could actually close it — the
 * player simply stays on the market, same as `signFreeAgentWithCompetition`.
 */
async function loseToCompetingBid(opts: {
  leagueId: string; playerId: string; teamId: string; seasonYear: number;
  capMode: LeagueSettings['capMode']; week: number;
}): Promise<{ teamName: string; apy: number } | null> {
  const competing = await leadingCompetingBid(opts.leagueId, opts.playerId, opts.teamId, opts.seasonYear, opts.capMode);
  if (!competing) return null;
  const player = await prisma.player.findUniqueOrThrow({ where: { id: opts.playerId } });
  try {
    await signFreeAgent({
      leagueId: opts.leagueId, playerId: opts.playerId, teamId: competing.teamId,
      apy: competing.apy, years: suggestedYears(player.trueOvr, player.age),
      seasonYear: opts.seasonYear, capMode: opts.capMode, week: opts.week,
    });
  } catch {
    return null; // rival couldn't fit it either — he stays on the market
  }
  return { teamName: competing.teamName, apy: competing.apy };
}
