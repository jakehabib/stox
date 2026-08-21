import { prisma } from './db';
import { Rng, clamp } from './rng';
import { AI, CAP, LEAGUE, FREE_AGENCY, ROSTER_TARGETS, Position, rosterMinFor } from './tuning';
import { LeagueSettings } from './settings';
import { readJson, writeJson } from './json';
import { buildContract, marketValue, suggestedYears, capHit, capSavingsOnCut, formatMoney, maxYearsForAge } from './cap';
import { buildScoutedView } from './scouting';
import { loadScoutMods } from './dynasty';
import {
  buildNegotiationContext, contractShapeFor, decideOffer, sessionFingerprint,
  DEFAULT_STRUCTURE, RESIGN_LEVERAGE, extensionLeverage, clampOffer,
  type DealStructure, type NegotiationGate, type NegotiationMode, type NegotiationOutcome,
  type NegotiationSession, type Offer, type ResignWindow, type Suitor,
} from './negotiation';
import { maxOffer, parseGmProfile, teamNeeds, RosterPlayer } from './ai/gm';
import { teamCapSummary } from './cap-summary';
import { assertCapRoom } from './capEnforcement';
import { reconcileDepthChart } from './gen/league';

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

/**
 * The leading rival, with the evidence for it attached. `Suitor` (in
 * lib/negotiation.ts) is the shape; this alias is kept because the free-agency
 * side of the file has always called it a competing bid, and in free agency
 * that is exactly what it is.
 */
export type CompetingBid = Suitor;

/**
 * ---------------------------------------------------------------------------
 * IS THERE A BIDDER AT ALL?
 * ---------------------------------------------------------------------------
 * This function answers "who is the leading rival for this man", and for a
 * long time it was also being asked "is anybody bidding" — which it could
 * only ever answer yes to. It scanned all 31 AI clubs and returned the best
 * offer from any of them whose need at the position cleared 0.15, and across
 * 31 rosters SOMEBODY always scores over 0.15 somewhere. Measured: of the top
 * 40 free agents in a real league, 38 carried a competing bid, and both of the
 * two that did not were punters. Every position that still exists had a
 * guaranteed rival, in every league, in every week.
 *
 * A market is not that. It is crowded at the top and thin underneath, and it
 * thins further as the window runs and clubs spend their room and their roster
 * spots. So the test is no longer "does one club have a need" — it is the
 * question the sealed-bid wave itself answers: WOULD THIS CLUB ACTUALLY GET TO
 * HIM? Three gates, all of them the wave's own:
 *
 *   1. HE IS ON THE BOARD. The wave only ever looks at the top
 *      FREE_AGENCY.WAVE_BOARD_SIZE free agents. A man below that line is
 *      genuinely never bid on by anybody, and saying "nobody is circling" about
 *      him is a fact rather than a threshold. (An incumbent is not in the pool
 *      at all, so he is inserted as the hypothetical entrant he is: the re-sign
 *      rumour has always been "if he reached the market".)
 *   2. THEY REACH HIM. Each club walks its own board in its own order — the
 *      same `planTeamBids` the wave runs — spending its real roster slots and
 *      its real budget on the men it wants MORE. If it runs out of either
 *      before it gets to him, it is not chasing him, whatever its need score
 *      says. This is what makes an elite player universally wanted and a
 *      67-overall backup guard, sitting behind eleven better guards on
 *      everybody's board, ignored.
 *   3. THEIR NUMBER IS A REAL BID. What their GM would actually put on him has
 *      to clear MARKET_FLOOR — the same line the wave's resolution throws bids
 *      out under. A club named at a number the wave would discard is a rumour
 *      about nothing.
 *
 * WHAT DID NOT CHANGE, because it is the property that makes the rumour
 * honest: the club named still genuinely has the room and the reason — its cap
 * space off the same `teamCapSummary` its own AI budgets against, and either a
 * need at his position over the same 0.15 bar it bids at or the upgrade case
 * the wave lets a full roster bid on — and the figure quoted is still
 * `maxOffer` at the stable `fa-bid-<player>-<team>` seed. Nothing here is a fresh roll: every input is a fact in the database,
 * so the same matchup re-read on every render, every keystroke and every
 * submit returns the same club at the same number.
 *
 * The reachability walk is priced at the MARKET FLOOR rather than at each
 * rival's own random draw, and that is deliberate in the club's favour: the
 * floor is the cheapest bid that could possibly win, so charging the men ahead
 * of him no more than that only ever rules a club out when it plainly could
 * not have afforded to get down to him. A forecast that errs toward "yes, they
 * would be there" cannot manufacture a suitor out of nothing.
 */
export async function leadingCompetingBid(
  leagueId: string, playerId: string, excludeTeamId: string, seasonYear: number, settings: LeagueSettings,
): Promise<CompetingBid | null> {
  const capMode = settings.capMode;
  const player = await prisma.player.findUniqueOrThrow({ where: { id: playerId } });

  // The board the wave actually reads, and nothing wider. `take` is the same
  // WAVE_BOARD_SIZE, the same order.
  const pool = await prisma.player.findMany({
    where: { leagueId, status: 'FREE_AGENT', teamId: null, isDraftee: false },
    orderBy: [{ trueOvr: 'desc' }, { id: 'asc' }],
    take: FREE_AGENCY.WAVE_BOARD_SIZE,
    select: { id: true, position: true, trueOvr: true, age: true, potential: true },
  });
  const onBoard = pool.some((p) => p.id === playerId);
  if (!onBoard && player.status === 'FREE_AGENT') {
    // He is on the market and below every club's board. Nobody is bidding on
    // him — not in this function, and not in the wave either.
    return null;
  }
  const board: BoardPlayer[] = onBoard
    ? pool
    : [...pool, { id: player.id, position: player.position, trueOvr: player.trueOvr, age: player.age, potential: player.potential }]
        .sort((a, b) => b.trueOvr - a.trueOvr || a.id.localeCompare(b.id));

  const teams = await prisma.team.findMany({ where: { leagueId, isUser: false, id: { not: excludeTeamId } } });
  const rosterMax = settings.rosterMax ?? LEAGUE.ROSTER_MAX;
  const rookieReserve = Math.ceil(settings.draftRounds * LEAGUE.ROOKIE_ROSTER_HIT_RATE);
  const playerMarket = marketValue({
    ovr: player.trueOvr, position: player.position as Position, age: player.age, potential: player.potential,
  });

  let best: CompetingBid | null = null;
  for (const team of teams) {
    const roster = await prisma.player.findMany({
      where: { teamId: team.id, status: 'ACTIVE' },
      select: { id: true, position: true, trueOvr: true, age: true, potential: true, contract: true },
      orderBy: [{ trueOvr: 'asc' }, { id: 'asc' }],
    });
    const needs = teamNeeds(roster as RosterPlayer[]);
    const summary = await teamCapSummary(team.id, seasonYear, capMode);
    // NOTE THE ABSENCE OF A NEED PRE-FILTER. There used to be one here — skip
    // any club scoring under 0.15 at his position — and it was subtly wrong in
    // BOTH directions. Over 0.15 it let a club through that would never have
    // reached him; under it, it excluded the club that would have signed him
    // anyway, because a team with no open roster spot bids on an UPGRADE
    // regardless of need (see planTeamBids' displacement branch, which is the
    // wave's own rule). Measured on a fresh league: the wave signed seven of
    // the top forty free agents whom the need test had ruled out entirely.
    // The need test still applies — inside planTeamBids, exactly where and
    // only where the wave applies it.
    const state = bidderState({ roster: roster as RosterPlayer[], needs, capSpace: summary.capSpace, capMode, rosterMax, rookieReserve });
    // WOULD THEY GET TO HIM. Same walk, same order, same slots and budget the
    // wave spends — priced at the floor, so this only ever says no when the
    // club could not have afforded to reach him even paying the minimum that
    // counts. Deterministic: no draw, nothing to re-roll between renders.
    const plan = planTeamBids(board, state, (fa, capSpace) => Math.min(
      // The cheapest bid that could count: the market floor, but never under
      // the league minimum, because nobody signs anybody for less than that and
      // a price below it would make `planTeamBids` skip a man the wave bids on.
      // (Measured: pricing depth players under the minimum silently dropped
      // them out of a club's plan, its roster spots therefore never filled, the
      // upgrade-and-displace branch never opened, and three of the top forty
      // free agents in a fresh league were reported as unwanted and then signed
      // by the very next wave.)
      Math.max(marketValue({ ovr: fa.trueOvr, position: fa.position as Position, age: fa.age, potential: fa.potential }) * MARKET_FLOOR, CAP.MIN_SALARY),
      Math.max(0, capSpace - AI.CAP_RESERVE),
    ));
    if (!plan.some((b) => b.playerId === playerId)) continue;

    // What their GM would actually put on him, at the seed this has always
    // used — stable per matchup, so the number does not move under the user.
    const rng = new Rng(`fa-bid-${playerId}-${team.id}`);
    const profile = parseGmProfile(team.gmProfile, rng);
    const offer = maxOffer(player as unknown as RosterPlayer, { profile, needs, capSpace: Math.max(0, summary.capSpace - AI.CAP_RESERVE), rng });
    // A bid the wave's own resolution would throw out is not a bid.
    if (offer < CAP.MIN_SALARY || offer < playerMarket * MARKET_FLOOR) continue;
    if (!best || offer > best.apy) {
      // The evidence travels with the bid. A club is only ever NAMED on screen
      // out of one of these, and the two figures beside its name are the two
      // figures its own AI bid on: the room it really has and the need it
      // really has. That is what stops "Chicago is interested" from being
      // decoration — you can go and look at Chicago.
      const atPosition = (roster as RosterPlayer[])
        .filter((p) => p.position === player.position)
        .sort((a, b) => b.trueOvr - a.trueOvr);
      best = {
        teamId: team.id,
        teamName: `${team.city} ${team.nickname}`,
        teamAbbr: team.abbr,
        apy: Math.round(offer),
        capSpace: summary.capSpace,
        need: needs[player.position] ?? 0,
        starterOvr: atPosition[0]?.trueOvr ?? null,
      };
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
    // Signing ENDS every negotiation about him, including the ones he is not
    // party to. This is one of the two things that reset persisted patience
    // (the other is the league year rolling over): if he is later cut and
    // comes back onto the market, that is a genuinely new negotiation and it
    // starts with a full set of pips. See the NegotiationTalks model.
    await tx.negotiationTalks.deleteMany({ where: { playerId } });
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
    // A roster spot is not a place on the field. This is the single funnel
    // for EVERY signing in the game — AI waves, roster-minimum fills, the
    // user's own offers — and none of it touched a depth chart, so a man
    // signed in week 8 took no snaps for the rest of the season.
    await reconcileDepthChart(teamId, tx);
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
    // Same rule as signFreeAgent: putting his name on a deal ends the talks,
    // so the persisted patience for him goes with it.
    await tx.negotiationTalks.deleteMany({ where: { playerId } });
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
 * Sign an EXTENSION — years appended to the deal he is already on.
 *
 * Distinct from `extendContract` above, which replaces a contract outright:
 * that is what a re-sign is and what the AI's own re-sign wave does. This is
 * the real-football move the app owner asked for — *"it should add a year on
 * top, as it does it real life"* — so the years he is already owed survive at
 * the salaries he was already promised, the new years go on the end, and a new
 * signing bonus is paid now. All the arithmetic is `buildExtension`; this
 * function is the database half.
 *
 * The cap check is the same one `extendContract` runs and for the same reason:
 * the OLD deal's hit is credited back before the new one is measured, because
 * the old hit is not charged twice. What differs is that the new hit here is
 * the appended contract's year-1 number, which is exactly what `decideOffer`
 * showed the user on the panel — the gate and the meter read the same figure.
 */
export async function signExtension(opts: {
  leagueId: string;
  playerId: string;
  /** APY of the NEW years only. */
  newMoneyApy: number;
  addYears: number;
  seasonYear: number;
  capMode: LeagueSettings['capMode'];
  week: number;
  escalation?: number;
  voidYears?: number;
  bonusPct?: number;
  guaranteedPct?: number;
}) {
  const { playerId, seasonYear, capMode, week } = opts;
  const { capHit, buildExtension } = await import('./cap');

  const player = await prisma.player.findUniqueOrThrow({ where: { id: playerId }, include: { contract: true } });
  if (!player.teamId) throw new Error('Player is not on a roster.');
  if (!player.contract) throw new Error('He has no contract to extend.');
  const teamId = player.teamId;

  const oldHit = capHit(player.contract, capMode);
  const next = buildExtension({
    current: player.contract,
    newMoneyApy: opts.newMoneyApy,
    addYears: opts.addYears,
    signedYear: seasonYear,
    escalation: opts.escalation,
    bonusPct: opts.bonusPct,
    guaranteedPct: opts.guaranteedPct,
    voidYears: opts.voidYears,
  });
  const newHit = capHit({ ...next, baseSalaries: writeJson(next.baseSalaries) }, capMode);
  await assertCapRoom({
    action: 'Extension', seasonYear, capMode,
    charges: [{ teamId, delta: newHit, creditBack: oldHit }],
  });

  await prisma.$transaction(async (tx) => {
    await tx.contract.update({
      where: { playerId },
      data: {
        years: next.years,
        yearsRemaining: next.yearsRemaining,
        signedYear: next.signedYear,
        baseSalaries: writeJson(next.baseSalaries),
        signingBonus: next.signingBonus,
        guaranteed: next.guaranteed,
        voidYears: next.voidYears,
        // An extended deal is not a rookie deal any more, whatever it started
        // as — the fifth-year option and the rookie-scale rules stop applying
        // the moment new money is added on top.
        isRookieDeal: false,
      },
    });
    // Same rule as everywhere else: putting his name on a deal ends the talks.
    await tx.negotiationTalks.deleteMany({ where: { playerId } });
    await tx.transaction.create({
      data: {
        leagueId: opts.leagueId, seasonYear, week, type: 'SIGN', teamId,
        headline: `Extended ${player.firstName} ${player.lastName}`,
        detail: `+${opts.addYears} yr${opts.addYears === 1 ? '' : 's'} of new money at ~$${(opts.newMoneyApy / 1_000_000).toFixed(1)}M/yr — under contract through ${seasonYear + next.years - 1}`,
      },
    });
  });

  return { newHit, contract: next };
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
  seasonYear: number; settings: LeagueSettings; week: number;
  escalation?: number; voidYears?: number; bonusPct?: number; guaranteedPct?: number;
}) {
  const capMode = opts.settings.capMode;
  const competing = await leadingCompetingBid(opts.leagueId, opts.playerId, opts.teamId, opts.seasonYear, opts.settings);
  if (competing && competing.apy > opts.apy) {
    const player = await prisma.player.findUniqueOrThrow({ where: { id: opts.playerId } });
    await signFreeAgent({
      leagueId: opts.leagueId, playerId: opts.playerId, teamId: competing.teamId,
      apy: competing.apy, years: suggestedYears(player.trueOvr, player.age),
      seasonYear: opts.seasonYear, capMode, week: opts.week,
    }).catch(() => { /* rival couldn't actually close it either — player just stays in free agency */ });
    throw new Error(`Outbid — the ${competing.teamName} swooped in at ~$${(competing.apy / 1_000_000).toFixed(1)}M/yr before you closed the deal.`);
  }
  return signFreeAgent({ ...opts, capMode });
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
    // Drop the slot he left behind, or it holds a rank forever against
    // a man who is gone.
    await reconcileDepthChart(player.teamId!, tx);
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
/**
 * Share of market value a free agent will actually sign for. [TUNE]
 *
 * Exported because it is the threshold a bid has to clear to be a real bid,
 * and scripts/checkNegotiationAgreement.ts checks a named suitor against the
 * same number the wave resolves on — a rumour that names a club which would
 * not survive this line would be a rumour about nothing.
 */
export const MARKET_FLOOR = 0.85;

/**
 * ---------------------------------------------------------------------------
 * ONE CLUB'S BIDS, IN ITS OWN ORDER
 * ---------------------------------------------------------------------------
 * The walk down a front office's board: highest-need positions first, best
 * player first inside a position, spending roster slots and cap room as it
 * goes, stopping when either runs out. It is the whole of the AI's free-agency
 * behaviour and it now has exactly one implementation, because two things ask
 * the same question and may never answer it differently:
 *
 *   `runAiFreeAgencyWave` — what the club actually bids, this week, for real.
 *   `leadingCompetingBid` — whether the club named in a negotiation panel as
 *                           chasing this player would in fact get to him.
 *
 * They differ only in `price`, which is what that club would put on a man
 * given the room it has left: the wave prices with `maxOffer` off its GM
 * profile and the wave's own seeded rng, the rumour prices at MARKET_FLOOR
 * (see leadingCompetingBid for why the forecast is deliberately the cheap,
 * deterministic one). Everything that decides WHETHER a bid happens — the
 * order, the need threshold, the roster-slot rule, the upgrade-and-displace
 * rule, the market floor — is here, once.
 */
export interface BoardPlayer {
  id: string;
  position: string;
  trueOvr: number;
  age: number;
  potential: number;
}

export interface BidderState {
  needs: Record<string, number>;
  /** Room to spend this league year, already net of the AI's reserve. */
  budget: number;
  openSlots: number;
  displacesLeft: number;
  /** Worst man at each position, and what releasing him would free. */
  worstAtPosition: Map<string, { id: string; trueOvr: number; frees: number }>;
  countAtPosition: Map<string, number>;
  alreadyDisplaced: Set<string>;
}

export interface PlannedBid { playerId: string; offer: number; displacePlayerId?: string }

/** The club's snapshot, read the same way on both sides. */
export function bidderState(opts: {
  roster: (RosterPlayer & { contract?: unknown })[];
  needs: Record<string, number>;
  capSpace: number;
  capMode: LeagueSettings['capMode'];
  rosterMax: number;
  rookieReserve: number;
}): BidderState {
  const worstAtPosition = new Map<string, { id: string; trueOvr: number; frees: number }>();
  const countAtPosition = new Map<string, number>();
  // `roster` arrives worst-first, so the first hit per position is the answer.
  for (const p of opts.roster) {
    if (!worstAtPosition.has(p.position)) {
      worstAtPosition.set(p.position, {
        id: p.id, trueOvr: p.trueOvr,
        // Releasing him frees this year's hit less the dead money he leaves
        // behind. Sizing the offer WITHOUT it (as this first did) prices
        // every upgrade as if the roster spot were free but the money were
        // not, which is exactly backwards.
        frees: capSavingsOnCut((p as { contract?: Parameters<typeof capSavingsOnCut>[0] }).contract ?? null, opts.capMode),
      });
    }
    countAtPosition.set(p.position, (countAtPosition.get(p.position) ?? 0) + 1);
  }
  return {
    needs: opts.needs,
    budget: Math.max(0, opts.capSpace - AI.CAP_RESERVE),
    // Leave room for the rookie class. This wave only ever runs during
    // FREE_AGENCY, and the draft lands immediately after it, so filling all
    // the way to rosterMax here just means cutting those same players again
    // on cut-down day (see trimRostersToLimit in lib/season.ts). Reserve only
    // the share of the class that realistically sticks, not the whole class.
    openSlots: Math.max(0, opts.rosterMax - opts.roster.length - opts.rookieReserve),
    displacesLeft: FREE_AGENCY.MAX_DISPLACE_PER_TEAM_PER_WAVE,
    worstAtPosition,
    countAtPosition,
    alreadyDisplaced: new Set<string>(),
  };
}

/**
 * Pure. Mutates only the state object it is handed, and only in the ways the
 * wave already did (slots, budget, displacements spent).
 */
export function planTeamBids(
  board: BoardPlayer[],
  state: BidderState,
  price: (fa: BoardPlayer, capSpace: number) => number,
): PlannedBid[] {
  // Bid on the highest-need positions among top available talent.
  const ranked = [...board].sort(
    (a, b) => (state.needs[b.position] ?? 0) - (state.needs[a.position] ?? 0) || b.trueOvr - a.trueOvr,
  );
  const out: PlannedBid[] = [];
  for (const fa of ranked) {
    if (state.openSlots <= 0 && state.displacesLeft <= 0) break;
    if (state.budget <= 0) break;

    let displace: { id: string; trueOvr: number; frees: number } | null = null;
    if (state.openSlots <= 0) {
      // No room — this only happens if he beats somebody already here.
      const worst = state.worstAtPosition.get(fa.position);
      if (!worst || state.alreadyDisplaced.has(worst.id)) continue;
      if (fa.trueOvr - worst.trueOvr < FREE_AGENCY.MIN_UPGRADE_DELTA) continue;
      // Only depth BEYOND what the position spec asks for is displaceable,
      // so an upgrade can never open a hole the roster is required to fill.
      // Structural on purpose: a rating threshold stops meaning anything the
      // moment league-wide ratings move.
      if ((state.countAtPosition.get(fa.position) ?? 0) <= (ROSTER_TARGETS[fa.position as Position]?.min ?? 1)) continue;
      displace = worst;
    } else if ((state.needs[fa.position] ?? 0) <= 0.15) {
      continue; // no real need and no upgrade case — not a bid
    }

    // A displacement pays for part of itself: the man going out stops
    // counting against the cap the moment he is released.
    const freed = displace?.frees ?? 0;
    const offer = price(fa, state.budget + freed);
    if (offer < CAP.MIN_SALARY) continue;
    // Don't commit budget to a bid that cannot possibly win. The price is
    // capped at what the team can afford, and the resolution step throws out
    // anything under 85% of market — so a team facing a free agent it cannot
    // afford used to bid its entire remaining budget on him, have that bid
    // rejected, and then `break` on an exhausted budget without having signed
    // anyone. Because the board is sorted best-first once needs flatten out,
    // every team in the league did this to the same unaffordable player, every
    // week: measured 17 signings league-wide in the final year of a 13-season
    // run while 350 free agents rated 80+ sat unsigned. Applying the same
    // floor here, before the money is committed, lets a team walk down the
    // board to somebody it can actually sign.
    const market = marketValue({ ovr: fa.trueOvr, position: fa.position as Position, age: fa.age, potential: fa.potential });
    if (offer < market * MARKET_FLOOR) continue;

    out.push({ playerId: fa.id, offer, displacePlayerId: displace?.id });
    state.budget -= offer - freed;
    if (displace) {
      state.alreadyDisplaced.add(displace.id);
      state.displacesLeft--;
    } else {
      state.openSlots--;
    }
  }
  return out;
}

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

  const rosterMax = settings.rosterMax ?? LEAGUE.ROSTER_MAX;
  const rookieReserve = Math.ceil(settings.draftRounds * LEAGUE.ROOKIE_ROSTER_HIT_RATE);

  for (const team of teams) {
    const roster = await prisma.player.findMany({
      where: { teamId: team.id, status: 'ACTIVE' },
      select: { id: true, position: true, trueOvr: true, age: true, potential: true, contract: true },
      orderBy: [{ trueOvr: 'asc' }, { id: 'asc' }],
    });
    const needs = teamNeeds(roster as RosterPlayer[]);
    const summary = await teamCapSummary(team.id, seasonYear, settings.capMode);
    const profile = parseGmProfile(team.gmProfile, rng);

    // The walk down this club's board — order, slots, budget, the upgrade
    // rule, the market floor. Shared with `leadingCompetingBid`, which is how
    // a suitor named in a negotiation panel is the club that actually comes
    // for him here. See planTeamBids.
    const state = bidderState({
      roster: roster as RosterPlayer[], needs, capSpace: summary.capSpace,
      capMode: settings.capMode, rosterMax, rookieReserve,
    });
    for (const bid of planTeamBids(freeAgents, state, (fa, capSpace) => maxOffer(fa as unknown as RosterPlayer, { profile, needs, capSpace, rng }))) {
      bids.push({ ...bid, teamId: team.id });
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
  /** True when this is your own player, not an outside free agent. */
  incumbent: boolean;
  /**
   * THE THIRD SCREEN. An extension is a negotiation with a man who is still
   * under contract with real years left — nobody may bid on him, and those
   * years are leverage a re-sign does not give you. Defaults to the old
   * two-way reading of `incumbent`, so every existing call site behaves
   * exactly as it did.
   */
  mode?: NegotiationMode;
}): Promise<NegotiationSession> {
  const { leagueId, playerId, teamId, seasonYear, settings, incumbent } = opts;
  const mode: NegotiationMode = opts.mode ?? (incumbent ? 'RESIGN' : 'FREE_AGENT');
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

  // --- Who else wants him ---------------------------------------------------
  //
  // THE SAME QUESTION IS NOW ASKED ON BOTH SCREENS, and that is the change
  // that gives the re-sign window a contest.
  //
  // Free agency was a minigame because it put three unknowns in front of you —
  // his number, his term, and the rival's bid — two of them hidden, against a
  // resource that runs out. Re-signing your own player had the first two and
  // no rival at all, so the only live question was how far you overpaid: a
  // cost-efficiency puzzle, not a negotiation.
  //
  // So `leadingCompetingBid` runs for an incumbent too. It is the identical
  // function, at the identical seed (`fa-bid-<player>-<team>`), over the same
  // cap summaries and the same `teamNeeds` the sealed-bid wave uses — which is
  // what makes the club it names honest rather than atmospheric: if he reaches
  // the market, that is the team with the room and the hole, and that is
  // roughly the number. Nothing about the rumour is invented for the panel.
  //
  // What differs is LEVERAGE, and it differs for a reason the user can state.
  // Nobody may sign a player who is under contract to you, so a suitor in the
  // re-sign window is not bidding against you — he is a fact about next spring
  // that his agent already knows. In his walk year that is a distant forecast
  // (RESIGN_LEVERAGE.WALK_YEAR); once his deal has actually expired and he is
  // one Advance from the open market it is very nearly a bid
  // (RESIGN_LEVERAGE.FINAL_CALL). Hence: it moves his ASKING PRICE and his
  // patience, and it never touches `gate.competingApy`, because you cannot be
  // outbid today by a team that cannot sign him today. Claiming otherwise
  // would be exactly the lying metric the README forbids.
  const controlYears = player.contract?.yearsRemaining ?? 0;
  const resignWindow: ResignWindow | null = mode === 'RESIGN'
    ? (controlYears <= 0 ? 'FINAL_CALL' : 'WALK_YEAR')
    : null;
  const suitor = await leadingCompetingBid(leagueId, playerId, teamId, seasonYear, settings);
  const rawCompetition = suitor ? clamp(suitor.apy / Math.max(1, trueMarketApy), 0.3, 1) : 0;
  // How much of that rival's interest actually reaches this table. Nobody may
  // sign a man who is under contract, so on both incumbent screens it is
  // leverage on his ASKING PRICE and never a bid — and it is weakest of all
  // in an extension, where you still hold him for years.
  const competition = resignWindow
    ? rawCompetition * RESIGN_LEVERAGE[resignWindow]
    : mode === 'EXTENSION'
      ? rawCompetition * extensionLeverage(controlYears)
      : rawCompetition;
  /** Bidding against you RIGHT NOW. Only ever true on the open market. */
  const competing = incumbent ? null : suitor;

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
    resignWindow,
    mode,
    seasonYear,
    controlYears,
    // Only an extension prices against the existing deal — everywhere else
    // the offer IS the whole contract and this stays null.
    currentContract: mode === 'EXTENSION' ? player.contract : null,
    // The same confidence figure that decides how wide his rating range is
    // drawn decides how wide the "he might sign" band is. Scouting pays at
    // the table, and the fog is one fog rather than two.
    scoutConfidence: view.confidence,
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

  // The LEAGUE's ceiling is flat now (12, see maxYearsForAge) and the age
  // ladder that used to be here belongs to the player — `ctx.willingYears`,
  // which refuses in his own voice. On an extension the control sets how many
  // years are ADDED, so what is left of the ceiling is what the ceiling minus
  // his existing years allows.
  const leagueMaxYears = maxYearsForAge(player.age);
  const maxYears = mode === 'EXTENSION'
    ? Math.max(1, leagueMaxYears - controlYears)
    : leagueMaxYears;
  const ceilingFloor = Math.max(CAP.MIN_SALARY * 2, Math.round(marketApy * 2.5));
  const gate: NegotiationGate = {
    capMode,
    capSpace,
    minSalary: CAP.MIN_SALARY,
    // The ceiling has to clear a rival's bid, or the one control that could
    // win the auction would stop short of the number that wins it. A re-sign
    // is not an auction, but the same reasoning applies to the rumour: if the
    // panel says a club will go to $18M, the salary slider has to reach $18M.
    maxSalary: Math.max(ceilingFloor, suitor ? Math.round(suitor.apy * 1.15) : 0),
    maxYears,
    competingApy: competing?.apy ?? 0,
    competingTeam: competing?.teamName ?? null,
  };

  return { ctx, gate, patienceSpent: await readPatienceSpent(teamId, playerId, seasonYear), suitor };
}

/**
 * ---------------------------------------------------------------------------
 * PATIENCE, PERSISTED
 * ---------------------------------------------------------------------------
 * The count of pips burned is read and written HERE and nowhere else, and it
 * is never taken from the client. `negotiateOffer` used to accept a
 * `patienceSpent` argument from the browser; that argument no longer exists,
 * because there was no verifying it — a reload sent zero, and zero was
 * indistinguishable from an honest zero. The loss condition, and with it the
 * entire cost of a lowball, was defeated by F5.
 *
 * The bookkeeping rules, all three of them, are in one place so they can be
 * checked against each other:
 *
 *   READ   is free and creates nothing. Opening the panel writes no row.
 *   CHARGE upserts, and only ever on a refusal the PLAYER made (a cap-illegal
 *          or term-illegal offer never reached him and costs nothing — see
 *          `decideOffer`'s `costsPatience`).
 *   PRUNE  runs on every charge and drops this league's rows from earlier
 *          league years. A new league year is a new negotiation — new asking
 *          price, new market, fresh pips — so those rows can never be read
 *          again, and leaving them would grow the table forever.
 * ---------------------------------------------------------------------------
 */
async function readPatienceSpent(teamId: string, playerId: string, seasonYear: number): Promise<number> {
  const row = await prisma.negotiationTalks.findUnique({
    where: { teamId_playerId_seasonYear: { teamId, playerId, seasonYear } },
    select: { patienceSpent: true },
  });
  return row?.patienceSpent ?? 0;
}

/**
 * SET ASIDE — the re-sign list's "not now", written here rather than in the
 * Server Action for one reason: this row is the patience ledger, and every
 * write to it belongs in the same file as the rules above so the three of them
 * can be read together. This is the fourth rule.
 *
 *   PARK   sets (or clears) `dismissedAt` and touches NOTHING else. It is not
 *          a negotiation event: it costs no pips, it does not reach the player,
 *          and `decideOffer` has never heard of this column. The zero written
 *          on create is the same zero `readPatienceSpent` already returns when
 *          there is no row, so parking a man he has not spoken to yet cannot
 *          give or take a pip either.
 *
 * It expires with the league year, because the key does — which is exactly the
 * scope the app owner asked for: *"(and re visit during the offseason re-sign
 * phase)"*. Whoever is still parked when the phase ends is named in the advance
 * warning first; see lib/season.ts.
 */
export async function setResignSetAside(opts: {
  leagueId: string; teamId: string; playerId: string; seasonYear: number; aside: boolean;
}): Promise<{ aside: boolean }> {
  const { leagueId, teamId, playerId, seasonYear } = opts;
  const dismissedAt = opts.aside ? new Date() : null;
  await prisma.negotiationTalks.upsert({
    where: { teamId_playerId_seasonYear: { teamId, playerId, seasonYear } },
    create: { leagueId, teamId, playerId, seasonYear, patienceSpent: 0, dismissedAt },
    // patienceSpent is DELIBERATELY absent. An upsert that wrote it would be a
    // second author for the one number the whole minigame rests on.
    update: { dismissedAt },
  });
  return { aside: opts.aside };
}

async function chargePatience(opts: {
  leagueId: string; teamId: string; playerId: string; seasonYear: number; cost: number;
}): Promise<number> {
  const { leagueId, teamId, playerId, seasonYear, cost } = opts;
  // `increment` rather than a read-then-write so two submits racing each other
  // cannot both read the same number and charge one pip between them.
  const row = await prisma.negotiationTalks.upsert({
    where: { teamId_playerId_seasonYear: { teamId, playerId, seasonYear } },
    create: { leagueId, teamId, playerId, seasonYear, patienceSpent: cost },
    update: { patienceSpent: { increment: cost } },
    select: { patienceSpent: true },
  });
  await prisma.negotiationTalks.deleteMany({ where: { leagueId, seasonYear: { lt: seasonYear } } });
  return row.patienceSpent;
}

/**
 * Submit an offer for real.
 *
 * THE SERVER OWNS THE PATIENCE COUNT. There is deliberately no
 * `patienceSpent` parameter: the count is read from NegotiationTalks, keyed on
 * (team, player, league year), and written back here. The browser is told what
 * it has spent; it never says.
 *
 * It used to be an argument, and that was an exploit rather than a rough edge.
 * A reload reset the client's counter to zero, the server had nothing to check
 * it against, and so a GM could lowball the same free agent an unlimited
 * number of times by pressing F5 between offers — which is precisely the
 * "they accept everything" behaviour the whole minigame exists to remove, just
 * with more clicks. Persisting it is what makes a lowball cost something.
 */
export async function negotiateOffer(opts: {
  leagueId: string;
  playerId: string;
  teamId: string;
  seasonYear: number;
  week: number;
  settings: LeagueSettings;
  incumbent: boolean;
  /** Which screen. Defaults to the old two-way reading of `incumbent`. */
  mode?: NegotiationMode;
  offer: Offer;
  structure?: DealStructure;
  /** Fingerprint of the session the user was actually looking at. */
  fingerprint?: string;
}): Promise<NegotiationOutcome> {
  const { leagueId, playerId, teamId, seasonYear, week, settings, incumbent } = opts;
  const mode: NegotiationMode = opts.mode ?? (incumbent ? 'RESIGN' : 'FREE_AGENT');
  const structure = opts.structure ?? DEFAULT_STRUCTURE;
  const session = await resolveNegotiationSession({ leagueId, playerId, teamId, seasonYear, settings, incumbent, mode });
  // THE OFFER IS CLAMPED BEFORE IT IS JUDGED, and it is clamped by the same
  // pure function the panel's typed fields clamp with, against the same gate.
  // A number field can carry things a slider cannot — empty, negative, 1e9 —
  // and the two sides have to agree about what such a thing MEANS, not merely
  // both refuse it.
  const offer = clampOffer(opts.offer, session.gate);
  const decision = decideOffer(session.ctx, offer, session.gate, structure);
  // Straight off the row `resolveNegotiationSession` just read. Clamped only
  // because his patience can legitimately have SHRUNK since the pips were
  // burned (rival interest moves it), and a count above the ceiling should
  // read as "out", not as a negative number of pips left.
  const spentBefore = clamp(session.patienceSpent, 0, session.ctx.patience);

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
    const shape = contractShapeFor(offer);
    // Measured BEFORE the write so the confirmation can state the change and
    // not merely the new number. Both halves come from teamCapSummary, which
    // is the same figure the cap page prints.
    const capBefore = settings.capMode === 'OFF'
      ? 0
      : (await teamCapSummary(teamId, seasonYear, settings.capMode)).capSpace;
    try {
      if (mode === 'EXTENSION') {
        // APPENDED, not replaced. See buildExtension in lib/cap.ts and the
        // owner's ruling quoted there.
        await signExtension({
          leagueId, playerId, newMoneyApy: offer.apy, addYears: offer.years, seasonYear,
          capMode: settings.capMode, week, escalation: structure.escalation, voidYears: structure.voidYears,
          bonusPct: shape.bonusPct, guaranteedPct: shape.guaranteedPct,
        });
      } else if (incumbent) {
        await extendContract({
          leagueId, playerId, apy: offer.apy, years: offer.years, seasonYear,
          capMode: settings.capMode, week, escalation: structure.escalation, voidYears: structure.voidYears,
          // An EXTENSION is not a re-sign and must not report as one on the
          // wire: he was never going to be a free agent, and "Re-signed" over
          // a man with three years left is a small lie in the news feed.
          bonusPct: shape.bonusPct, guaranteedPct: shape.guaranteedPct, reSign: mode === 'RESIGN',
        });
      } else {
        // Still goes through the competition path: between resolving the
        // session and this line an AI team can have moved, and if it has, the
        // player leaves with them. That is the drama of an open market and it
        // is not something the user's click may override.
        await signFreeAgentWithCompetition({
          leagueId, playerId, teamId, apy: offer.apy, years: offer.years, seasonYear,
          settings, week, escalation: structure.escalation, voidYears: structure.voidYears,
          bonusPct: shape.bonusPct, guaranteedPct: shape.guaranteedPct,
        });
      }
    } catch (err) {
      // Cap refusals and last-second outbids are foreseeable, user-recoverable
      // outcomes, not bugs — they must never escape a Server Action uncaught.
      return { ...base, ok: false, message: err instanceof Error ? err.message : 'The deal fell through.' };
    }
    // READ BACK WHAT LANDED. Not what was offered, not what the panel drew —
    // the contract row that now exists, priced with the same functions the cap
    // page prices it with. See SignedDeal.
    const written = await prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      include: { contract: true, team: true },
    });
    const capAfter = settings.capMode === 'OFF'
      ? 0
      : (await teamCapSummary(teamId, seasonYear, settings.capMode)).capSpace;
    const writtenBases = written.contract ? readJson<number[]>(written.contract.baseSalaries, []) : [];
    const signed = written.contract && written.team
      ? {
          playerName: session.ctx.playerName,
          position: written.position,
          playerId,
          teamAbbr: written.team.abbr,
          teamId: written.team.id,
          mode,
          years: written.contract.years,
          totalValue: writtenBases.reduce((a, b) => a + b, 0) + written.contract.signingBonus,
          newMoneyValue: decision.newMoneyValue,
          apy: offer.apy,
          guaranteed: written.contract.guaranteed,
          capHitThisYear: capHit(written.contract, settings.capMode),
          capSpaceBefore: capBefore,
          capSpaceAfter: capAfter,
          // You only beat somebody if somebody was actually bidding and you
          // went past them. Both figures are off the gate the meter used.
          beat: session.gate.competingApy > 0 && offer.apy > session.gate.competingApy && session.gate.competingTeam
            ? { teamName: session.gate.competingTeam, apy: session.gate.competingApy }
            : null,
        }
      : undefined;

    return {
      ...base,
      ok: true,
      signed,
      message: mode === 'EXTENSION'
        ? `${session.ctx.playerName} is extended — his old deal is torn up and replaced by ${offer.years} year${offer.years === 1 ? '' : 's'} at ${formatMoney(offer.apy)}/yr.`
        : incumbent
          ? `${session.ctx.playerName} is staying — ${offer.years} year${offer.years === 1 ? '' : 's'} at ${formatMoney(offer.apy)}/yr.`
          : `${session.ctx.playerName} signs — ${offer.years} year${offer.years === 1 ? '' : 's'} at ${formatMoney(offer.apy)}/yr.`,
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
  const patienceSpent = cost > 0
    ? Math.min(session.ctx.patience, await chargePatience({ leagueId, teamId, playerId, seasonYear, cost }))
    : spentBefore;
  const walkedAway = patienceSpent >= session.ctx.patience;
  // The session goes back to the client on every refusal so the meter
  // re-reads. It has to carry the count the pips are about to be drawn from,
  // or a reload would silently correct a panel that had been rendering the
  // pre-charge number.
  const charged = { ...base, session: { ...session, patienceSpent }, patienceSpent, walkedAway };

  if (walkedAway && !incumbent) {
    // Out of patience on the open market is not a soft ending: he takes the
    // best offer on the table and he is gone. It is also, now, unreachable by
    // reloading — the pips that got you here are in the database, so the
    // counter is real pacing and the loss is a real consequence of it.
    const lost = await loseToCompetingBid({
      leagueId, playerId, teamId, seasonYear, settings, week,
    });
    if (lost) {
      return {
        ...charged, ok: false, lostTo: lost,
        message: `He is done with you — signed with the ${lost.teamName} at ${formatMoney(lost.apy)}/yr.`,
      };
    }
    return {
      ...charged, ok: false,
      message: 'His agent has stopped returning your calls. He will wait for a better offer than yours.',
    };
  }

  return {
    ...charged,
    ok: false,
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
  settings: LeagueSettings; week: number;
}): Promise<{ teamName: string; apy: number } | null> {
  const capMode = opts.settings.capMode;
  const competing = await leadingCompetingBid(opts.leagueId, opts.playerId, opts.teamId, opts.seasonYear, opts.settings);
  if (!competing) return null;
  const player = await prisma.player.findUniqueOrThrow({ where: { id: opts.playerId } });
  try {
    await signFreeAgent({
      leagueId: opts.leagueId, playerId: opts.playerId, teamId: competing.teamId,
      apy: competing.apy, years: suggestedYears(player.trueOvr, player.age),
      seasonYear: opts.seasonYear, capMode, week: opts.week,
    });
  } catch {
    return null; // rival couldn't fit it either — he stays on the market
  }
  return { teamName: competing.teamName, apy: competing.apy };
}
