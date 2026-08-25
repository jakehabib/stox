import { prisma } from './db';
import { Rng, clamp } from './rng';
import { AI, CAP, LEAGUE, FREE_AGENCY, ROSTER_TARGETS, Position, rosterMinFor } from './tuning';
import { LeagueSettings } from './settings';
import { readJson, writeJson } from './json';
import { askingPrice, marketValue, buildContract, suggestedYears, capHit, capSavingsOnCut, deadMoneyOnCut, formatMoney, guaranteedMoney, maxYearsForAge } from './cap';
import { buildScoutedView } from './scouting';
import { loadDynastyProfile, parseSkills, scoutingModsFor, signBandMultFor } from './dynasty';
import {
  buildNegotiationContext, contractShapeFor, decideOffer, sessionFingerprint,
  DEFAULT_STRUCTURE, DEFAULT_CONVERT_PCT, RESIGN_LEVERAGE, extensionLeverage, clampOffer,
  evaluateOffer, rivalView, winsContest, leastAcceptableApy,
  type DealStructure, type NegotiationContext, type NegotiationGate, type NegotiationMode,
  type NegotiationOutcome, type NegotiationSession, type Offer, type ResignWindow, type Suitor,
} from './negotiation';
import { maxOffer, parseGmProfile, teamNeeds, RosterPlayer } from './ai/gm';
import type { FifthYearOptionDecision, FifthYearOptionTier } from './fifthYearOption';
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
 * the highest bidder signs him if that bid clears what the man will actually
 * sign for — the same model the user's panel runs, see WHAT A BID HAS TO
 * CLEAR below. Called once per offseason week during the FREE_AGENCY phase,
 * and can also be invoked on demand to fast-forward.
 *
 * THE MARKET DOES NOT CLOSE WHEN THAT WINDOW DOES. `runInSeasonSignings`
 * below is the same machinery run much more quietly through PRESEASON and the
 * regular season — one or two clubs a week, for a hole they actually have —
 * because a league where nobody can sign a free agent between April and April
 * accumulates unsigned stars nobody is able to reach. And what those clubs
 * bid against is `askingPrice` (lib/cap.ts), not `marketValue`: an unsigned
 * man's number falls the longer he stands there, which is the other half of
 * the same fix and the reason an in-season club can afford him at all.
 * ===========================================================================
 */

/**
 * ---------------------------------------------------------------------------
 * WHERE `evaluateOffer` WENT — AND WHERE IT DID NOT GO, FOR A YEAR
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
 * So the USER's path was fixed, and this block then said acceptance lived in
 * exactly one place. It did not. The four lines had moved a few hundred lines
 * down the file and taken a name:
 *
 *     export const MARKET_FLOOR = 0.85;
 *     if (best.offer < market * MARKET_FLOOR) continue;
 *
 * — the identical salary-only ratio, deciding the identical question for every
 * club that is not the user's. A comment claiming one model over a file
 * carrying two is the defect this codebase treats as seriously as a bad
 * number, so: acceptance now lives in exactly one place FOR EVERYBODY.
 *
 *   THE USER   `decideOffer` (lib/negotiation.ts), called by the browser on
 *              every drag and by the Server Action on submit.
 *   THE AI     `aiDealFor` below, which asks `leastAcceptableApy` — the bottom
 *              of the same band, off the same curve, about the same man.
 *
 * And the number the free-agency board prints is now the top of that band: pay
 * the advertised asking price on a deal he has no other complaint about and he
 * signs, whoever is asking. See WHAT THE ASK IS WORTH in lib/negotiation.ts.
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
 *      to clear the least he will sign for (`aiDealFor`) — the same line the
 *      wave's resolution throws bids out under, and the same bottom-of-the-band
 *      the user's own meter draws. A club named at a number the wave would
 *      discard is a rumour about nothing.
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
 * The reachability walk is the WAVE'S OWN WALK, at the wave's own prices: each
 * man ahead of him costs what this club's GM would really put on him, at the
 * stable `fa-bid-<player>-<team>` seed, so the forecast is a replay rather than
 * a sketch. It used to charge the men above him the cheapest bid that could
 * possibly count, on the reasoning that a forecast should err toward "yes, they
 * would be there". That reasoning ignored ROSTER SLOTS: a club priced cheaply
 * affords more of the men above him, spends its openings on them, and never
 * reaches him — so the generous pricing produced false NEGATIVES, which is the
 * one direction this rumour may never be wrong in. Measured: a 71-overall
 * receiver reported as uncircled, signed by the very next wave.
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
    select: { id: true, position: true, trueOvr: true, age: true, potential: true, weeksUnsigned: true },
  });
  const onBoard = pool.some((p) => p.id === playerId);
  if (!onBoard && player.status === 'FREE_AGENT') {
    // He is on the market and below every club's board. Nobody is bidding on
    // him — not in this function, and not in the wave either.
    return null;
  }
  const board: BoardPlayer[] = onBoard
    ? pool
    : [...pool, {
        id: player.id, position: player.position, trueOvr: player.trueOvr, age: player.age,
        potential: player.potential, weeksUnsigned: player.weeksUnsigned,
      }]
        .sort((a, b) => b.trueOvr - a.trueOvr || a.id.localeCompare(b.id));

  const teams = await prisma.team.findMany({ where: { leagueId, isUser: false, id: { not: excludeTeamId } } });
  const rosterMax = settings.rosterMax ?? LEAGUE.ROSTER_MAX;
  const rookieReserve = Math.ceil(settings.draftRounds * LEAGUE.ROOKIE_ROSTER_HIT_RATE);
  // WHAT IT TAKES TO SIGN EACH OF THEM, priced once for the whole walk. This
  // used to be `askingPrice * MARKET_FLOOR` — a share of his advertised price,
  // computed here and again in the wave. It is `leastAcceptableApy` now, the
  // bottom of the band the user's meter draws, so the number a club has to
  // clear to be NAMED in a panel is the number it has to clear to actually
  // sign him. See WHAT A BID HAS TO CLEAR.
  const deals = aiDealBook(board, seasonYear);
  const playerDeal = deals.get(playerId)!;

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
    const plan = planTeamBids(board, state, (fa, capSpace) => {
      // WHAT THIS CLUB WOULD REALLY PUT ON EACH MAN AHEAD OF HIM, at the same
      // `fa-bid-<player>-<team>` seed the target is priced at four lines below
      // — so the walk is the wave's own walk rather than a cheaper sketch of
      // it, and the answer is stable across every render of the panel.
      //
      // It used to price every man on the board at the cheapest bid that could
      // possibly count, on the reasoning that charging the men ahead of him as
      // little as possible errs toward "yes, that club would be there". That
      // reasoning was half right and the missing half is ROSTER SLOTS: a club
      // priced cheaply affords more of the men above him, fills its openings
      // on them, and never reaches him — so the "generous" pricing produced
      // false NEGATIVES. Measured after the market floor became per-player: a
      // 71-overall receiver the panel reported as uncircled was signed by the
      // very next wave, which is the one direction this rumour may never be
      // wrong in.
      // `capSpace` arrives already net of AI.CAP_RESERVE — `bidderState` takes
      // it off when it builds the budget, and `planTeamBids` hands that budget
      // straight through. Taking it off a second time here would walk a poorer
      // club down the board than the one the wave walks.
      const rng = new Rng(`fa-bid-${fa.id}-${team.id}`);
      const profile = parseGmProfile(team.gmProfile, rng);
      return maxOffer(fa as unknown as RosterPlayer, { profile, needs, capSpace, rng });
    }, deals);
    if (!plan.some((b) => b.playerId === playerId)) continue;

    // What their GM would actually put on him, at the seed this has always
    // used — stable per matchup, so the number does not move under the user.
    const rng = new Rng(`fa-bid-${playerId}-${team.id}`);
    const profile = parseGmProfile(team.gmProfile, rng);
    const offer = maxOffer(player as unknown as RosterPlayer, { profile, needs, capSpace: Math.max(0, summary.capSpace - AI.CAP_RESERVE), rng });
    // A bid the wave's own resolution would throw out is not a bid.
    if (offer < CAP.MIN_SALARY || offer < playerDeal.floor) continue;
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
        // THE REST OF THEIR PACKAGE, and it is not decoration: the player
        // SCORES a rival's offer now rather than having its headline compared
        // with yours (lib/negotiation.ts, THE CONTEST). So the term and the
        // guarantee have to be the ones this club would really put on paper,
        // which is why both are read off the signing path rather than chosen
        // here — `suggestedYears` is what every AI signing passes to
        // `signFreeAgent` (the wave, `loseToCompetingBid` and
        // `signFreeAgentWithCompetition` all do), and AI_GUARANTEE_PCT is the
        // share `buildContract` locks in when they call it with no override.
        // If the wave ever structures its deals differently, both move here
        // with it or the rumour stops being checkable.
        years: playerDeal.years,
        guaranteePct: playerDeal.guaranteePct,
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

  const contract = buildContract({
    apy, years, signedYear: seasonYear, escalation: opts.escalation,
    bonusPct: opts.bonusPct, guaranteedPct: opts.guaranteedPct,
    voidYears: opts.voidYears,
  });
  // ONE figure, read off the contract itself. This used to be a separate local
  // spliced in at both the pricing and the write, which worked only for as long
  // as nobody clamped anything: buildContract now drops void years that a deal
  // of this length cannot actually use, and a local copy would have gone on
  // writing the un-clamped number to the database — the row claiming void years
  // the cap arithmetic had already discarded.
  const voidYears = contract.voidYears;
  // Void years widen the proration divisor, so they change the year-1 hit the
  // cap check has to clear — build the check off the same shape that gets stored.
  const hit = capHit({ ...contract, baseSalaries: writeJson(contract.baseSalaries) }, capMode);
  await assertCapRoom({ action: 'Signing', seasonYear, capMode, charges: [{ teamId, delta: hit }] });

  await prisma.$transaction(async (tx) => {
    // BOTH unsigned clocks reset the moment somebody signs him, because both
    // only ever count CONSECUTIVE time on the street: yearsUnsigned feeds the
    // attrition roll (progressFreeAgents, lib/development.ts) and
    // weeksUnsigned feeds his asking price (askingPrice, lib/cap.ts). A man
    // cut again next year starts a fresh stint at a fresh price — his old
    // discount is not a property he carries around.
    /**
     * HE HAS TO STILL BE A FREE AGENT, AND THIS IS THE ONLY PLACE THAT CAN
     * PROVE IT.
     *
     * This was `player.update` by id, which signs whoever the id names — and
     * the very next line deletes his existing contract. Pointed at a man on
     * another club's roster it took him for nothing: no dead money, no CUT,
     * nothing on the wire, the old club simply lost him. The negotiation
     * fingerprint is not a guard against this, it is a one-click delay: it
     * refuses once and hands back a FRESH session, which the panel adopts, so
     * the second click goes through. Measured: 3 of 3 rostered players taken
     * that way, and the same defect aimed at your own club wrote two SIGN rows
     * for one man, the second tearing up the deal from seconds earlier.
     *
     * The WHERE is the free-agent pool's own definition (see the queries
     * above: FREE_AGENT / no team / not a draftee), so this claim is exactly
     * "is he still one of the men the market says are available", answered
     * atomically at the moment of the write rather than read minutes earlier
     * on a page that has since gone stale.
     */
    const claimed = await tx.player.updateMany({
      where: { id: playerId, leagueId: opts.leagueId, status: 'FREE_AGENT', teamId: null, isDraftee: false },
      data: { teamId, status: 'ACTIVE', yearsUnsigned: 0, weeksUnsigned: 0 },
    });
    if (claimed.count === 0) {
      const now = await tx.player.findUnique({
        where: { id: playerId },
        select: { firstName: true, lastName: true, team: { select: { city: true, nickname: true } } },
      });
      const name = now ? `${now.firstName} ${now.lastName}` : 'That player';
      throw new Error(now?.team
        ? `${name} signed with the ${now.team.city} ${now.team.nickname} while you were deciding.`
        : `${name} is no longer a free agent.`);
    }
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
        // THE MAN, NOT HIS NAME. A signing is the canonical player-shaped row,
        // and this column is why the wire, his own page and the GM's career
        // can link back to him instead of matching a string — see the doc on
        // Transaction.playerId in prisma/schema.prisma, which is explicit that
        // every row of this shape carries it. Every signing path in this file
        // now does; the ones that genuinely are not about one man (a
        // twelve-player cut-down, a trade between two clubs) still do not, and
        // that is what null MEANS.
        playerId,
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
 * ===========================================================================
 * KEEP A PLAYER WHO IS ALREADY ON THE ROSTER — APPEND IF HE IS STILL UNDER
 * CONTRACT, WRITE A FRESH DEAL IF HE IS NOT
 * ===========================================================================
 * WHICH OF THE TWO IS A FACT ABOUT HIS CONTRACT, NOT ABOUT THE SCREEN THE
 * USER OPENED, which is why the branch lives in here rather than as a second
 * route in `resolveNegotiationSession`: the user's re-sign panel and the AI's
 * own re-sign wave (lib/season.ts) both come through this function, and they
 * have to produce the same contract for the same player.
 *
 *   yearsRemaining > 0 — WALK YEAR. He is owed a season at a salary the club
 *     has already promised him. The new years go on the END: that season keeps
 *     its base salary, the unamortized bonus is carried and re-prorated, and a
 *     new bonus is paid now. That is `signExtension` below and it is exactly
 *     what the player card's Extend button already did.
 *   yearsRemaining === 0 — FINAL CALL. The deal has expired, there is nothing
 *     to append to, and this writes a fresh contract exactly as it always has.
 *
 * A live tester found the hole: *"I'm re-signing guys that still have one year
 * left on their deal, and it's lowering my Space for the current year."* He was
 * right, and replacing a walk-year deal was doing two things it had no right
 * to do. Both measured, on ATL in the 2030 offseason, re-signing Camden Achebe
 * (93 OVR QB, final year of his rookie deal at $6.60M, $15.10M bonus with
 * $3.77M still unamortized) at $30.91M/yr x 4:
 *
 *   IT ERASED THE OLD SIGNING BONUS. `deleteMany` took the contract row and
 *     with it the proration still owed to the cap, and nothing booked a dollar
 *     of dead money for it. Nothing else in this codebase lets a paid bonus
 *     vanish — `buildExtension` carries it, `restructureContract` re-prorates
 *     it, `deadMoneyOnCut` accelerates it — so this was the one path handing
 *     out free cap relief. Cut him the moment the ink dried: $42.63M of dead
 *     money before, $46.41M now, the difference being precisely the bonus that
 *     used to evaporate.
 *   IT OVERWROTE A SALARY THE CLUB HAD ALREADY PROMISED. His $6.60M for this
 *     season became the new deal's year-1 base of $16.90M, so this year's cap
 *     hit was $27.56M and his space fell $17.18M — the tester's complaint,
 *     exactly. Appended, this year is his own $6.60M with the new bonus
 *     prorating on top: $15.88M, and $5.51M off his space. The other $11.67M
 *     was the club being charged this year for years it had not reached yet.
 *
 * The cap check is unchanged in both branches: the NEW hit is measured against
 * space with the OLD hit credited back, because the old hit stops being
 * charged on its own the instant this one is written.
 * ===========================================================================
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
   * Passed straight through to `signExtension` on the APPEND branch, where it
   * decides how much of this season's owed salary becomes signing bonus. The
   * REPLACE branch ignores it and must: that deal has expired, there is no
   * salary still owed for this season to convert, and `buildContract` writes
   * the new one from scratch.
   */
  convertPct?: number;
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
  const { capHit, unamortizedBonus, capChargeYear } = await import('./cap');

  const player = await prisma.player.findUniqueOrThrow({ where: { id: playerId }, include: { contract: true } });
  if (!player.teamId) throw new Error('Player is not on a roster.');
  const teamId = player.teamId;

  const oldHit = player.contract ? capHit(player.contract, capMode) : 0;
  const reSign = opts.reSign ?? (player.contract ? player.contract.yearsRemaining <= 1 : false);

  // APPEND OR REPLACE IS A FACT ABOUT HIS CONTRACT, NOT ABOUT THE SCREEN.
  // See the block above this function for the two things replacing a
  // walk-year deal did that it had no right to do.
  if (player.contract && player.contract.yearsRemaining > 0) {
    await signExtension({
      leagueId: opts.leagueId, playerId, seasonYear, capMode, week,
      // `apy` IS THE NEW MONEY HERE, and conflating the two would silently
      // mis-price every re-sign. The offer prices the years being ADDED — the
      // ones he is already owed keep the salaries he was already promised —
      // which is the same reading `decideOffer` draws its preview from
      // (buildExtension's `newMoneyApy`) and the same one the extension screen
      // has always used. Fed in as a whole-deal APY it would re-price years
      // that are not for sale.
      newMoneyApy: apy, addYears: years,
      escalation: opts.escalation, voidYears: opts.voidYears,
      bonusPct: opts.bonusPct, guaranteedPct: opts.guaranteedPct,
      convertPct: opts.convertPct,
      // One implementation of appending, not two. `signExtension` already
      // carries the unamortized bonus, credits the old hit back at the cap
      // gate and writes the row; all this branch decides is which wire type
      // comes out of it.
      reSign,
    });
    return;
  }

  const contract = buildContract({
    apy, years, signedYear: seasonYear, escalation: opts.escalation,
    bonusPct: opts.bonusPct, guaranteedPct: opts.guaranteedPct,
    // The void years have to be IN the contract that gets priced, not spliced
    // on afterwards at the write. They were not, so this gate charged the
    // undiluted proration while the row written two lines below carried the
    // wider divisor — the check demanded more room than the deal would ever
    // cost, and re-signs that fit were refused at the door.
    voidYears: opts.voidYears,
  });
  const newHit = capHit({ ...contract, baseSalaries: writeJson(contract.baseSalaries) }, capMode);

  /**
   * -------------------------------------------------------------------------
   * KEEPING HIM MUST NOT BE CHEAPER THAN LOSING HIM.
   * -------------------------------------------------------------------------
   * The `deleteMany` below tears the old row up, and with it went every
   * dollar of signing bonus the club had already paid and not yet charged to
   * a cap. Void years are the shape that makes this large: they widen the
   * proration divisor to shrink the hit during the real years, stranding a
   * slice of bonus that no season ever bills — and in real football that
   * stranded proration accelerates the moment the deal ends. Every OTHER exit
   * from this contract charges it. Letting him walk books it
   * (releaseUnresignedExpiringContracts, below). Cutting him books it. Tagging
   * him books it (applyFranchiseTag, and see commit eb7d87b for the identical
   * hole on that path). Trading him accelerates it onto the club giving him
   * up. Re-signing him booked nothing.
   *
   * Measured, four exits from the SAME expired 3-year deal with 2 void years
   * and $13.5M of bonus, three seasons played:
   *
   *   walk $5.40M   cut $5.40M   tag $5.40M   RE-SIGN $0
   *
   * And the loop it opened: restructure his walk year with three void years
   * added — hit $28.2M down to $7.79M, $20.4M freed this season — then
   * re-sign him and the $20.4M is never repaid by anybody. That inverts the
   * one incentive the whole cap system exists to create: it made keeping a
   * man strictly cheaper than losing him, and made a void year free money
   * provided you remembered to re-sign the player it was borrowed against.
   *
   * So the stranded bonus is booked here, dated by capChargeYear for the same
   * reason the tag path reads the phase (a charge filed a year early sits in
   * a window where compliance is not enforced and is then deleted unbilled),
   * and priced into the gate below — because it is part of what re-signing
   * him ADDS, not a saving against it.
   *
   * THE BONUS, NOT THE FULL CUT CHARGE. Same split every other path makes:
   * the bonus is cash already handed over whose charge has to land somewhere,
   * while guaranteed salary is cash not yet paid and is not escaped here — it
   * is replaced by the new deal, which is charged in full on the new row.
   * -------------------------------------------------------------------------
   */
  const stranded = unamortizedBonus(player.contract, capMode);
  const league = await prisma.league.findUniqueOrThrow({
    where: { id: opts.leagueId }, select: { phase: true, week: true },
  });

  /*
   * THE DIFFERENCE, NOT THE GROSS — the same defect fixed at e573a85 one
   * function over, found again here by the offseason-cap probe.
   *
   * The old deal is torn up the instant this one is signed, so its hit comes
   * off; the bonus it strands is charged, so it goes on. Both true, and both
   * were already in the arithmetic. What was wrong is the SHAPE: stated as
   * `delta: newHit + stranded` with `creditBack: oldHit`, the delta is a gross
   * cap hit and therefore never <= 0, so assertCapRoom's `if (delta <= 0)
   * continue` — the escape for a move that frees room — could not fire.
   *
   * A club at -$10.0M extending a man from a $20.0M hit down to $12.0M was
   * refused, because the gate asked whether $12.0M fitted inside $10.0M rather
   * than whether -$8.0M did. The move it turned down leaves the club $8.0M
   * closer to legal. Stated as the difference it takes the escape and goes
   * through, and every decision for a club under the cap is unchanged, because
   * the two forms are the same inequality.
   */
  await assertCapRoom({
    action: reSign ? 'Re-signing' : 'Extension', seasonYear, capMode,
    charges: [{ teamId, delta: newHit + stranded - oldHit }],
  });

  await prisma.$transaction(async (tx) => {
    if (stranded > 0) {
      await tx.capCharge.create({
        data: {
          teamId,
          year: capChargeYear({ phase: league.phase, week: league.week, seasonYear }),
          amount: stranded,
          // Its own label rather than the cut path's "Dead money — Name", for
          // the reason applyFranchiseTag gives: the trade recap matches its
          // charges by exact label, so causes stay distinguishable, and a GM
          // reading the Cap page can tell a re-sign's legacy bonus from a
          // release.
          label: `Re-signed ${player.firstName} ${player.lastName} — old deal's bonus`,
        },
      });
    }
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
        // Off the contract that was just priced, so the stored row and the cap
        // gate above can never disagree about the proration window.
        voidYears: contract.voidYears,
      },
    });
    await tx.transaction.create({
      data: {
        leagueId: opts.leagueId, seasonYear, week,
        type: reSign ? 'RESIGN' : 'SIGN', teamId, playerId,
        headline: reSign
          ? `Re-signed ${player.firstName} ${player.lastName}`
          : `Extended ${player.firstName} ${player.lastName}`,
        // The wire is where a GM goes back to ask what a move actually cost
        // him, and a re-sign that accelerates a stranded bonus costs more
        // than its APY says. Same sentence the tag path writes.
        detail: (reSign
          ? `${years}-yr deal, ~$${(apy / 1_000_000).toFixed(1)}M/yr`
          : `${years}-yr extension, ~$${(apy / 1_000_000).toFixed(1)}M/yr`)
          + (stranded > 0 ? ` — plus ${formatMoney(stranded)} of dead money as his old deal's bonus accelerates` : ''),
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
  /**
   * How much of the salary he is already owed THIS SEASON is turned into
   * signing bonus, 0..1 of what may legally be moved — the real-football
   * reason a club extends a man at all. Undefined converts NOTHING, which is
   * `buildExtension`'s own default and the behaviour every caller had before
   * the option existed; a deal a GM negotiates arrives here carrying
   * `DEFAULT_CONVERT_PCT` from `negotiateOffer` instead. See the conversion
   * block above `buildExtension` in lib/cap.ts for the sim-health measurement
   * that split those two defaults apart.
   *
   * It rides through to `buildExtension` and nowhere else: the cap gate below
   * measures the row this produces, so the check and the write cannot disagree
   * about what the extension costs this year however this is set.
   */
  convertPct?: number;
  /**
   * True when this append is a club KEEPING ITS OWN EXPIRING PLAYER rather
   * than adding years to a deal that still had a future. Writes a RESIGN row
   * on the wire instead of a SIGN one, exactly as `extendContract`'s own flag
   * does — a walk-year re-sign arrives here now (see extendContract), and it
   * must not start reading as "Extended" on the news feed just because the
   * arithmetic it goes through changed.
   */
  reSign?: boolean;
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
    convertPct: opts.convertPct,
  });
  const newHit = capHit({ ...next, baseSalaries: writeJson(next.baseSalaries) }, capMode);
  /*
   * THE DIFFERENCE, NOT THE WHOLE NEW HIT — which is what made an extension
   * that FREES room get blocked for a club that was already over the cap.
   *
   * This passed `delta: newHit, creditBack: oldHit`. Arithmetically that is
   * the same test: `newHit > capSpace + oldHit` is `newHit - oldHit >
   * capSpace`. But assertCapRoom's first act is `if (delta <= 0) continue`,
   * the escape for a move that frees room or is neutral, and a delta stated
   * as the whole new hit is never <= 0 — a cap hit is a positive number. So
   * the escape could not fire here, and a club sitting at -$60.0M of space
   * extending a man from $20.0M down to $15.0M was refused: the gate asked
   * whether $15.0M fitted in -$40.0M, which nothing ever does. The move it
   * refused makes the club $5.0M LESS over the cap.
   *
   * Stated as the difference, the same club offers delta -$5.0M, takes the
   * escape, and the extension goes through. Every decision for a club UNDER
   * the cap is unchanged, because the two forms are the same inequality.
   *
   * It also stops the refusal message lying about the size of the move: it
   * now reads "adds $5.0M against -$60.0M of room" rather than "adds $25.0M
   * against -$40.0M", neither number of which the player would recognise.
   *
   * Same form as restructureContract's gate below — one meaning of `delta`
   * across both, so the two cannot drift apart again.
   */
  await assertCapRoom({
    action: opts.reSign ? 'Re-signing' : 'Extension', seasonYear, capMode,
    charges: [{ teamId, delta: newHit - oldHit }],
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
        // ...and the answer goes with the question. `buildExtension` rebases
        // the whole deal onto the years that are left plus the new ones, so
        // there is no longer a trailing year that bought no signing bonus —
        // leaving 'EXERCISED' on the row would hold `prorationYears` one year
        // short of the window this contract actually has (lib/cap.ts), and the
        // card would go on describing an option year inside a contract that no
        // longer has one. A declined answer goes too: it was about a deal that
        // has just been replaced.
        fifthYearOption: null,
      },
    });
    // Same rule as everywhere else: putting his name on a deal ends the talks.
    await tx.negotiationTalks.deleteMany({ where: { playerId } });
    await tx.transaction.create({
      data: {
        leagueId: opts.leagueId, seasonYear, week,
        type: opts.reSign ? 'RESIGN' : 'SIGN', teamId, playerId,
        headline: opts.reSign
          ? `Re-signed ${player.firstName} ${player.lastName}`
          : `Extended ${player.firstName} ${player.lastName}`,
        // The same sentence either way, because it is the same deal shape: the
        // years he was already owed, plus the ones just bought.
        detail: `+${opts.addYears} yr${opts.addYears === 1 ? '' : 's'} of new money at ~$${(opts.newMoneyApy / 1_000_000).toFixed(1)}M/yr — under contract through ${seasonYear + next.years - 1}`,
      },
    });
  });

  return { newHit, contract: next };
}

/**
 * ===========================================================================
 * FRANCHISE TAG: A NEW DEAL ON TOP OF AN OLD ONE'S BILL
 * ===========================================================================
 * A 1-year, fully guaranteed contract at the average of the top-N salaries at
 * the position league-wide (franchiseTagValue in lib/cap.ts), keeping a player
 * off the open market without a negotiated long-term deal. Real-NFL
 * simplification for now — one tag per team per season, no
 * exclusive/non-exclusive split, no escalating value for a second consecutive
 * tag on the same player (that needs contract-history tracking this schema
 * doesn't keep once a contract is replaced) — see README's Known
 * Simplifications.
 *
 * WHAT THIS USED TO DO WITH THE OLD DEAL: nothing. `deleteMany` took the
 * contract row and every dollar of signing bonus still prorating on it went
 * with it, unbilled. Measured on a throwaway league, in the Re-sign window,
 * with the cap REALISTIC:
 *
 *   3yr + 2 void, fully played, $12.0M bonus ($2.40M/yr over five years).
 *   $7.20M billed to the seasons he played, $4.80M still to come. Tag at
 *   $17.1M and the club's committed cap moved $5.70M — it should have moved
 *   $10.5M — and the $4.80M was never charged to anybody, ever.
 *
 *   5yr, two played, $25.0M bonus. Tagging a $25.0M cap hit at $11.5M did not
 *   cost the club $1.50M, it FREED $13.5M: the whole unamortised bonus
 *   vanished with the row.
 *
 * Nothing else in this game lets paid bonus evaporate — `deadMoneyOnCut`
 * accelerates it, `tradeCapEffect` accelerates it onto the club giving him up,
 * `buildExtension` and `restructureContract` carry it into the rewritten deal.
 * The tag was the cheapest way in the game to make a bad contract disappear,
 * which is the exact opposite of what a tag is: in real football tagging a man
 * does not retire his old deal's accounting at all. INV-21, clause two — total
 * charged equals money paid. Gated now by scripts/checkFranchiseTag.ts.
 *
 * WHY DEAD MONEY AND NOT A BONUS CARRIED ONTO THE TAG YEAR. The other rewrites
 * carry, and they are right to: `buildExtension` keeps the remaining years'
 * base salaries and appends to them, so the years the old bonus was amortising
 * over still exist to amortise over. The tag keeps nothing — it writes one
 * year over a deal that may have had three to run. A one-year contract's
 * proration window is one year (`prorationYears`), so "carry it forward" and
 * "charge it now" are the same number in the same league year, and the only
 * question left is which column it is filed in. Three things settle that:
 *
 *   - `franchiseTagValue` averages the top-N `capHit()`s at the position, so a
 *     tag row carrying a legacy bonus would price the NEXT tag at that
 *     position off it. The tag would inflate itself. Keeping the row at
 *     exactly `tagValue` keeps that input clean.
 *   - The row already says `signingBonus: 0`, `guaranteed: tagValue`, and the
 *     wire says "fully guaranteed at $X". Carrying would make all three false,
 *     and `guaranteed` would have to be restated in the same breath or the gap
 *     between it and the bonus re-reads as guaranteed salary still owed and
 *     lands on the cap a second time (lib/cap.ts, the guarantee-frame rule).
 *   - This path already does the first half of what `cutPlayer` does — it
 *     deletes the contract row. It just never did the second half.
 *
 * WHY THE BONUS AND NOT `deadMoneyOnCut`. Same split `tradeCapEffect` makes:
 * the bonus is cash already handed over whose charge has to land somewhere,
 * the guaranteed base salary is cash not yet paid. A cut owes both because the
 * club walks away owing him the rest. A tag owes only the bonus, because the
 * salary obligation is not escaped — it is REPLACED by the tag, which is
 * itself fully guaranteed and is being charged in full on the new row. Billing
 * both would charge the club two salaries for one player-season. On the only
 * shape that reaches this function — his deal is up, so `guaranteedSalaryOwed`
 * is already 0 — the two are the same figure anyway. The mid-deal case is
 * refused one level up now (applyFranchiseTagAction: a tag replaces a deal
 * that is up, and a Server Action that only the re-sign row's own gate stopped
 * was a way to walk out of a long contract). Pricing it correctly is still
 * this function's job for any caller that is ever handed one.
 * ===========================================================================
 */
export async function applyFranchiseTag(opts: {
  leagueId: string;
  playerId: string;
  seasonYear: number;
  capMode: LeagueSettings['capMode'];
  week: number;
}) {
  const { franchiseTagValue, unamortizedBonus, capChargeYear } = await import('./cap');
  const { playerId, seasonYear, capMode } = opts;

  const player = await prisma.player.findUniqueOrThrow({ where: { id: playerId }, include: { contract: true } });
  if (!player.teamId) throw new Error('Player is not on a roster.');
  const teamId = player.teamId;
  // Read the phase here for the same reason `cutPlayer` does rather than
  // making the caller pass it: which league year the accelerated bonus files
  // against depends on where in the offseason roll we are (capChargeYear). A
  // tag is a RESIGN-window move and RESIGN comes after RESET_STANDINGS, so it
  // lands on the league year that has just opened — which is also the year
  // teamCapSummary and the Cap page are reading. Filed a year early it would
  // be hard-deleted by expireStaleCapCharges without ever being charged.
  const league = await prisma.league.findUniqueOrThrow({
    where: { id: opts.leagueId }, select: { phase: true, week: true },
  });

  const alreadyTagged = await prisma.contract.findFirst({ where: { teamId, isFranchiseTag: true, signedYear: seasonYear } });
  if (alreadyTagged) throw new Error('Already used your franchise tag this offseason — one per team, per year.');

  const positionPeers = await prisma.player.findMany({
    where: { leagueId: opts.leagueId, position: player.position, status: 'ACTIVE' },
    include: { contract: true },
  });
  const positionSalaries = positionPeers.map((p) => capHit(p.contract, capMode)).filter((v) => v > 0);
  const tagValue = franchiseTagValue(positionSalaries);

  const oldHit = player.contract ? capHit(player.contract, capMode) : 0;
  const accelerated = unamortizedBonus(player.contract, capMode);
  await assertCapRoom({
    action: 'Franchise tag', seasonYear, capMode,
    // The acceleration is part of what the tag ADDS, not a saving against it.
    // Left out, a club with room for the tag alone would be waved through and
    // land over the ceiling the moment the charge was written — INV-19 says
    // every acquisition path is gated here, and this is what it has to be
    // gated on.
    //
    // Stated as the DIFFERENCE for the same reason as the extension gate above
    // and e573a85 before it: a gross figure with `creditBack` is arithmetically
    // the same test, but it can never be <= 0, so assertCapRoom's relief escape
    // is unreachable and a club already over the ceiling is refused a tag that
    // would cost it LESS than the deal it replaces.
    charges: [{ teamId, delta: tagValue + accelerated - oldHit }],
  });

  await prisma.$transaction(async (tx) => {
    if (accelerated > 0) {
      await tx.capCharge.create({
        data: {
          teamId,
          year: capChargeYear({ phase: league.phase, week: league.week, seasonYear }),
          amount: accelerated,
          // Its own label rather than the cut path's "Dead money — Name": the
          // trade recap matches its charges by exact label (app/league/[id]/
          // trade/page.tsx), so causes stay distinguishable on purpose.
          label: `Franchise tag — ${player.firstName} ${player.lastName}'s old deal`,
        },
      });
    }
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
        leagueId: opts.leagueId, seasonYear, week: opts.week, type: 'TAG', teamId, playerId,
        headline: `${player.firstName} ${player.lastName} franchise-tagged`,
        // The tag number alone was the whole story while the old deal
        // evaporated. It isn't any more, and the wire is where a GM goes back
        // to ask what a move actually cost him.
        detail: `1-yr, fully guaranteed at ${formatMoney(tagValue)}`
          + (accelerated > 0 ? ` — plus ${formatMoney(accelerated)} of dead money as his old deal's bonus accelerates` : ''),
      },
    });
  });

  return { tagValue, deadMoney: accelerated };
}

/**
 * ===========================================================================
 * THE FIFTH-YEAR OPTION — WHAT IT COSTS, AND THE TWO WAYS TO ANSWER IT
 * ===========================================================================
 * `lib/fifthYearOption.ts` holds the rule and the price; this is the half that
 * needs a database — which tier he has earned, what his position is actually
 * paying this league year, and the two writes. It sits beside
 * `applyFranchiseTag` because it is the same kind of move made out of the same
 * window on the same screen, and because the two are priced off one shared
 * band function (`positionSalaryBand`, lib/cap.ts) rather than two.
 *
 * WHEN IT IS ANSWERED, AND WHY THAT PHASE.
 * The real rule is "after his third season, before his fourth". In this
 * calendar that is the RESIGN step: the offseason roll has already run
 * PROGRESS, RESET_STANDINGS and AGE_CONTRACTS, so a man drafted in year Y has
 * `yearsRemaining === 1` — three seasons played, his fourth ahead of him — and
 * `League.seasonYear` is already Y+3, the year he is about to play. It is the
 * one window in the calendar where the game stops and asks a GM about
 * contracts, so the option does not need a press of its own.
 *
 * REJECTED: a step of its own in OFFSEASON_STEPS. Commit 50f9129 collapsed six
 * offseason presses into three precisely because a press with no decision in it
 * is a worse game, and this would have been a seventh — one that is a decision
 * for the two or three clubs with a first-rounder coming due that year and an
 * Advance for the other twenty-nine.
 *
 * REJECTED: putting these men on the re-sign LIST. That list is deliberately
 * pinned to `yearsRemaining === 0` during the offseason cycle (see
 * resignListCutoff, lib/contractClock.ts) because showing a man with a season
 * still to run beside men who walk in three clicks cost the app owner a
 * contract he did not need to give — *"i just gave a huge extension to someone
 * thinking they needed it but really i had 1 more year after to decide"*. A
 * first-rounder in the option window is exactly that man. So the decision
 * lives on his own card, where the rest of his contract does, and the
 * front-office brief is what tells a GM it is waiting.
 * ===========================================================================
 */

export interface FifthYearOptionQuote {
  /** False in OFF mode — the preview then shows the year and no dollar figures. */
  capEnabled: boolean;
  playerName: string;
  position: string;
  /** The league year he is about to play — the fourth of his rookie deal. */
  seasonYear: number;
  /** The league year the option would buy. */
  optionYear: number;
  tier: FifthYearOptionTier;
  /** What he did to earn that tier, and what the band is, for the preview. */
  tierEarned: string;
  tierBand: string;
  /** The one-year salary the option pays, fully guaranteed. */
  optionSalary: number;
  /** The cap hits that band was averaged over, biggest first — what it is MADE of. */
  bandSalaries: number[];
  /** What he already costs in the fourth year, which the option does NOT change. */
  fourthYearHit: number;
  /** Committed cap and room in the option year, as the Cap page's own outlook reads them. */
  optionYearCommitted: number;
  optionYearCap: number;
  optionYearRoomBefore: number;
  optionYearRoomAfter: number;
  /** The option would leave the club over the ceiling in the year it lands. */
  leavesOverCapThen: boolean;
  /** What releasing him would cost AFTER the option is picked up. */
  deadMoneyIfCutAfter: number;
  /** Non-null when the decision cannot be taken; the sentence the greyed control carries. */
  blocked: string | null;
  /** Null until his club answers. */
  decided: FifthYearOptionDecision | null;
}

/**
 * WHAT THE OPTION WOULD DO, BEFORE IT IS TAKEN.
 *
 * `franchiseTagImpactAction` for the option, and built the same way and for the
 * same reason: every figure is resolved server-side from the exact functions
 * the commit path writes with, so the preview cannot quote a number the action
 * does not charge. On a once-per-player, cannot-be-undone move that is the
 * worst possible place for a lying metric.
 *
 * THE COST LANDS IN A YEAR THE CAP GATE IS NOT LOOKING AT, and that is the
 * whole shape of this decision rather than a wrinkle in it. Exercising changes
 * nothing about the season in front of him — his fourth-year cap hit is
 * whatever his rookie deal already said, and `prorationYears` is held on the
 * four years the bonus was paid against (lib/cap.ts) — so `assertCapRoom` for
 * THIS year has nothing to refuse. The bill is a whole league year away. So
 * the preview reads the option year out of `capSheet`, the same multi-year
 * outlook the Cap page's Advanced view renders, rather than inventing a second
 * projection: it is the only honest way to show a GM what he is signing up for.
 */
export async function fifthYearOptionQuote(opts: {
  leagueId: string;
  playerId: string;
}): Promise<FifthYearOptionQuote | null> {
  const {
    fifthYearOptionApplies, fifthYearOptionBlockReason, fifthYearOptionTier, fifthYearOptionValue,
    FIFTH_YEAR_OPTION_TIERS,
  } = await import('./fifthYearOption');
  const { capHitSchedule, deadMoneyOnCut, positionSalaryBand, capChargeYear } = await import('./cap');
  const { allStarYearsFor } = await import('./allStars');
  const { capSheet } = await import('./cap-summary');
  const { PHASE_LABELS } = await import('./season');
  const { parseSettings } = await import('./settings');

  const player = await prisma.player.findUniqueOrThrow({
    where: { id: opts.playerId }, include: { contract: true },
  });
  // NOT A FIRST-ROUNDER ON HIS ROOKIE DEAL — null, and no control anywhere.
  // "You cannot exercise an option he was never given" is not a rule worth
  // greying a button for on every player page in the game.
  if (!player.contract || !player.teamId) return null;
  if (!fifthYearOptionApplies({ draftRound: player.draftRound, isRookieDeal: player.contract.isRookieDeal })) return null;

  const league = await prisma.league.findUniqueOrThrow({ where: { id: opts.leagueId } });
  const settings = parseSettings(league.settings);
  const capMode = settings.capMode;
  const decided = (player.contract.fifthYearOption as FifthYearOptionDecision | null) ?? null;

  const blocked = fifthYearOptionBlockReason({
    phase: league.phase,
    phaseLabel: PHASE_LABELS[league.phase] ?? league.phase,
    yearsRemaining: player.contract.yearsRemaining,
    decided,
  });

  // THE TIER, from the two facts this game can answer honestly for every
  // position on the field. See FIFTH_YEAR_OPTION_TIERS for what each one is
  // standing in for in the real rule and what was rejected.
  const allStarYears = await allStarYearsFor(opts.leagueId, player);
  // Bounded to the seasons of THIS contract. A veteran who was an All-Star at
  // 29 is not on a rookie deal; the bound only ever matters for a man traded
  // onto one, and a rule that reads a man's whole career would price an option
  // off seasons the option has nothing to do with.
  const rookieYears = new Set(
    Array.from({ length: player.contract.years }, (_, i) => player.contract!.signedYear + i),
  );
  const allStarSelections = allStarYears.filter((y) => rookieYears.has(y)).length;

  // "He starts" is lib/lineup.ts's answer and nobody else's: the best men at
  // the position on this roster, which is what the sim itself fields. Read off
  // trueOvr because that is what starterSlots ranks on, and because a man on
  // your own roster is never fogged anyway (lib/scouting.ts).
  const { startersAt } = await import('./lineup');
  const atPosition = await prisma.player.findMany({
    where: { teamId: player.teamId, status: 'ACTIVE', position: player.position },
    select: { id: true, trueOvr: true },
    orderBy: { trueOvr: 'desc' },
  });
  const isStarter = atPosition.slice(0, startersAt(player.position)).some((p) => p.id === player.id);

  const tier = fifthYearOptionTier({ allStarSelections, isStarter });
  const spec = FIFTH_YEAR_OPTION_TIERS[tier];

  const peers = await prisma.player.findMany({
    where: { leagueId: opts.leagueId, position: player.position, status: 'ACTIVE' },
    include: { contract: true },
  });
  const salaries = peers.map((p) => capHit(p.contract, capMode)).filter((v) => v > 0).sort((a, b) => b - a);

  // His fourth year, off the same schedule the ledger charges — index 0 of
  // what is left, which in the option window IS the fourth year.
  const schedule = capHitSchedule(player.contract, capMode);
  const fourthYearHit = schedule[0] ?? capHit(player.contract, capMode);
  const optionSalary = fifthYearOptionValue({ positionSalaries: salaries, tier, fourthYearHit });
  const bandSalaries = salaries.slice(Math.max(0, spec.from - 1), spec.to);

  // What he costs to walk away from once the year is guaranteed — priced on
  // the contract the write below actually produces, not on a description of it.
  //
  // ONLY SYNTHESISED WHILE THE ANSWER IS STILL OPEN. On a deal whose option has
  // already been picked up the extra year is on the row, so building a second
  // one here would price a SIXTH season nobody can buy — and this function is
  // read by the AI wave and by the card's standing state as well as by the
  // preview, so "the caller will not ask in that state" is not good enough.
  const after = decided === null
    ? {
      ...player.contract,
      years: player.contract.years + 1,
      yearsRemaining: player.contract.yearsRemaining + 1,
      baseSalaries: writeJson([...readJson<number[]>(player.contract.baseSalaries, []), optionSalary]),
      guaranteed: guaranteedAfterExercise(player.contract, optionSalary),
      fifthYearOption: 'EXERCISED',
    }
    : player.contract;
  const deadMoneyIfCutAfter = deadMoneyOnCut(after, capMode);

  // The season the option buys: the one after the last he is currently owed —
  // which on an already-exercised deal is the year sitting on the row. The same
  // arithmetic the player card does, so the preview, the standing status line
  // and the contract table can never name three different years.
  //
  // COUNTED FROM THE LEDGER, NOT FROM THE LEAGUE CLOCK. `yearsRemaining` is a
  // count on the contract ledger, and through OFFSEASON weeks 1-2 that ledger
  // is a year ahead of `League.seasonYear` (ageContractsForYear runs the
  // instant the season ends). Counting forward from `seasonYear` there named
  // the year he is CURRENTLY playing as the option year, and the `find` below
  // then priced the option against that year's column — capSheet's columns are
  // dated off the same ledger year, so the two have to be counted from the
  // same place. `fourthYearHit` above is already `capHitSchedule[0]`, i.e. the
  // ledger year, which is why `seasonYear` on the returned quote is that year
  // too: the card prints it as "his <year> cap hit" beside that figure.
  const ledgerYear = capChargeYear({ phase: league.phase, week: league.week, seasonYear: league.seasonYear });
  const optionYear = decided === 'EXERCISED'
    ? player.contract.signedYear + player.contract.years - 1
    : ledgerYear + Math.max(1, player.contract.yearsRemaining);
  const sheet = capMode === 'OFF' ? null : await capSheet(player.teamId, league, capMode);
  const nextYear = sheet?.years.find((y) => y.year === optionYear) ?? null;

  return {
    capEnabled: capMode !== 'OFF',
    playerName: `${player.firstName} ${player.lastName}`,
    position: player.position,
    seasonYear: ledgerYear,
    optionYear,
    tier,
    tierEarned: spec.earned,
    tierBand: spec.band,
    optionSalary,
    bandSalaries,
    fourthYearHit,
    optionYearCommitted: nextYear?.committed ?? 0,
    optionYearCap: nextYear?.capTotal ?? 0,
    optionYearRoomBefore: nextYear?.room ?? 0,
    optionYearRoomAfter: (nextYear?.room ?? 0) - optionSalary,
    leavesOverCapThen: nextYear != null && nextYear.room - optionSalary < 0,
    deadMoneyIfCutAfter,
    blocked,
    decided,
  };
}

/**
 * ---------------------------------------------------------------------------
 * WHAT EXERCISING GUARANTEES, AND WHY IT IS THE WHOLE REST OF THE DEAL
 * ---------------------------------------------------------------------------
 * The real rule guarantees the option year for injury the moment it is picked
 * up and in full at the start of the fifth league year. A first-round rookie
 * deal is fully guaranteed already, so once the option is taken the club is on
 * the hook for his fourth year and his fifth alike — and that is exactly what
 * this stores.
 *
 * `guaranteed` is bonus-INCLUSIVE and is only ever read by subtracting the
 * bonus back out and filling the years EARLIEST FIRST (`guaranteedBaseByYear`,
 * lib/cap.ts). So "guarantee the option year" cannot be expressed by adding the
 * option salary to whatever is stored: measured on pick 1.01's deal, adding
 * $20.0M to a stored $17.1M spreads earliest-first across bases of
 * [4.8, 5.3, 6.0, 6.7, 20.0] and leaves the FIFTH year holding nothing — dead
 * money on a cut in the option year would have read $0 against a fully
 * guaranteed $20.0M salary. Filling the frame completely is the only shape that
 * says what it means in the one direction that field is read.
 *
 * REJECTED: the real two-stage injury-then-full guarantee. This game has no
 * concept of releasing an injured man, so the first stage would be a rule with
 * no way to observe it, and a guarantee that depends on something the GM cannot
 * see is worse than a harsher one he can. Exercising is a commitment here, and
 * the preview says so before he presses.
 */
function guaranteedAfterExercise(
  contract: { baseSalaries: string; signingBonus: number; guaranteed: number },
  optionSalary: number,
): number {
  const bases = readJson<number[]>(contract.baseSalaries, []);
  const full = contract.signingBonus + bases.reduce((a, b) => a + b, 0) + optionSalary;
  // Never DOWN. A deal that somehow already promised more keeps its promise.
  return Math.max(contract.guaranteed, full);
}

/**
 * Pick the option up: a fifth contract year at the option salary, fully
 * guaranteed, carrying no signing-bonus proration (see `prorationYears`).
 *
 * NO CAP GATE FOR THIS SEASON, AND THAT IS NOT AN OVERSIGHT. Every other
 * acquisition path calls `assertCapRoom` because it adds money to the year
 * being enforced; this one adds none — the fourth year's hit is unchanged to
 * the dollar, which is checked rather than asserted
 * (scripts/checkFifthYearOption.ts). The bill lands a league year later, where
 * the ceiling is not enforced yet and where a club has a whole offseason of
 * cuts, trades and restructures to answer it with. Refusing the option today on
 * next year's books would be refusing a move real clubs make every April, and
 * it would be enforcing a ceiling the game does not enforce against anything
 * else. What the game does instead is SHOW him: the preview reads the option
 * year off `capSheet`, and the AI budgets against the same figure before it
 * commits (`decideFifthYearOptions`, lib/season.ts).
 */
export async function exerciseFifthYearOption(opts: {
  leagueId: string;
  playerId: string;
  seasonYear: number;
  capMode: LeagueSettings['capMode'];
  week: number;
}) {
  const quote = await fifthYearOptionQuote({ leagueId: opts.leagueId, playerId: opts.playerId });
  if (!quote) throw new Error('He has no fifth-year option — those belong to first-round picks on their rookie deal.');
  if (quote.blocked) throw new Error(quote.blocked);

  const player = await prisma.player.findUniqueOrThrow({ where: { id: opts.playerId }, include: { contract: true } });
  if (!player.contract || !player.teamId) throw new Error('He has no contract to add a year to.');
  const bases = readJson<number[]>(player.contract.baseSalaries, []);

  await prisma.$transaction(async (tx) => {
    // CONDITIONAL ON THE ROW STILL BEING UNDECIDED. This is the claim, and it
    // is why the update is a `updateMany` with the old value in the `where`:
    // two clicks, or a click racing the AI wave, would otherwise both read
    // null, both append a year, and leave a six-year rookie deal with two
    // option salaries on it and nothing on any screen saying so.
    const claimed = await tx.contract.updateMany({
      where: { playerId: opts.playerId, fifthYearOption: null },
      data: {
        years: player.contract!.years + 1,
        yearsRemaining: player.contract!.yearsRemaining + 1,
        baseSalaries: writeJson([...bases, quote.optionSalary]),
        guaranteed: guaranteedAfterExercise(player.contract!, quote.optionSalary),
        fifthYearOption: 'EXERCISED',
      },
    });
    if (claimed.count === 0) throw new Error('That option has already been answered.');
    await tx.transaction.create({
      data: {
        leagueId: opts.leagueId, seasonYear: opts.seasonYear, week: opts.week, type: 'OPTION',
        teamId: player.teamId, playerId: opts.playerId,
        headline: `${player.firstName} ${player.lastName}'s fifth-year option picked up`,
        // Both halves, because the year and its price are one fact and the
        // wire is where a GM goes back to ask what a move actually cost him.
        detail: `${quote.optionYear} at ${formatMoney(quote.optionSalary)}, fully guaranteed`,
      },
    });
  });

  return { optionSalary: quote.optionSalary, optionYear: quote.optionYear, tier: quote.tier };
}

/**
 * Turn it down. Nothing about the deal changes — that IS what declining is —
 * so the only write is the answer itself, and the cost is a year of him.
 *
 * IT IS STORED RATHER THAN INFERRED FROM SILENCE. Once the window shuts the
 * two are the same outcome, but inside it they are not: without a row the
 * control comes straight back after he has pressed it and the front-office
 * brief puts a decision he has already made back on his desk next week.
 */
export async function declineFifthYearOption(opts: {
  leagueId: string;
  playerId: string;
  seasonYear: number;
  week: number;
}) {
  const quote = await fifthYearOptionQuote({ leagueId: opts.leagueId, playerId: opts.playerId });
  if (!quote) throw new Error('He has no fifth-year option — those belong to first-round picks on their rookie deal.');
  if (quote.blocked) throw new Error(quote.blocked);

  const player = await prisma.player.findUniqueOrThrow({ where: { id: opts.playerId }, include: { contract: true } });
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.contract.updateMany({
      where: { playerId: opts.playerId, fifthYearOption: null },
      data: { fifthYearOption: 'DECLINED' },
    });
    if (claimed.count === 0) throw new Error('That option has already been answered.');
    await tx.transaction.create({
      data: {
        leagueId: opts.leagueId, seasonYear: opts.seasonYear, week: opts.week, type: 'OPTION',
        teamId: player.teamId, playerId: opts.playerId,
        headline: `${player.firstName} ${player.lastName}'s fifth-year option declined`,
        detail: `${formatMoney(quote.optionSalary)} turned down — he is a free agent after ${opts.seasonYear}`,
      },
    });
  });

  return { optionSalary: quote.optionSalary, tier: quote.tier };
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
        // `guaranteed` TRAVELS WITH THE BONUS, IN THE SAME WRITE.
        // It is stored bonus-inclusive, and every reader subtracts the bonus
        // back out to find the guaranteed BASE still owed
        // (guaranteedBaseByYear, lib/cap.ts). Store a rebased bonus beside the
        // OLD guarantee and the gap between them re-reads as salary the club
        // still owes, on a schedule that no longer contains the years it was
        // promised for. Measured on one restructure: stored $45.0M against a
        // computed $28.7M, and dead-money-on-cut went from $28.7M to $45.0M —
        // $16.3M invented out of an accounting move.
        //
        // The pure function computed this the whole time; this write simply
        // dropped it, and restructureContractAction patched it back in a
        // SECOND write outside this transaction. That made the defect latent
        // rather than fixed: any other caller reintroduced it in full, and a
        // failure between the two writes left a row broken in exactly this
        // way with nothing to say so. One write, one transaction, one row that
        // is never briefly wrong.
        guaranteed: next.guaranteed,
        voidYears: next.voidYears,
      },
    });
    await tx.transaction.create({
      data: {
        leagueId: opts.leagueId, seasonYear: opts.seasonYear, week: opts.week, type: 'SIGN', teamId: player.teamId,
        playerId: opts.playerId,
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
  /**
   * The man, as `decideOffer` was just holding him. THE SAME CONTEST HAS TO
   * BE RUN HERE, and it did not used to be: this line was
   * `competing.apy > opts.apy`, the identical raw dollar comparison the
   * negotiation panel has just stopped making. Left as it was, a deal the
   * meter had legitimately won on guaranteed money or on term would reach the
   * signing path and be thrown out at the door for paying less per year —
   * the same contradiction, one screen further on, and far harder to see
   * because it only fires on the offers the new model exists to allow.
   *
   * Optional so a caller with no negotiation behind it (there is none today)
   * still gets the old, blunter protection rather than none.
   */
  ctx?: NegotiationContext;
}) {
  const capMode = opts.settings.capMode;
  const competing = await leadingCompetingBid(opts.leagueId, opts.playerId, opts.teamId, opts.seasonYear, opts.settings);
  const yours: Offer = { apy: opts.apy, years: opts.years, guaranteePct: opts.guaranteedPct ?? 0 };
  const theirs: Offer = competing
    ? { apy: competing.apy, years: competing.years, guaranteePct: competing.guaranteePct }
    : yours;
  const lost = competing !== null && (opts.ctx
    ? !winsContest(
        evaluateOffer(opts.ctx, yours).interest,
        evaluateOffer(rivalView(opts.ctx), theirs).interest,
      )
    : competing.apy > opts.apy);
  if (competing && lost) {
    await signFreeAgent({
      leagueId: opts.leagueId, playerId: opts.playerId, teamId: competing.teamId,
      // THE PACKAGE THE PANEL QUOTED, not a second guess at it. `competing`
      // carries the term and the guaranteed share `leadingCompetingBid` read
      // off `aiDealFor`, which is the deal the rival's floor was priced for —
      // rebuilding either here would let the club that beat you sign a
      // contract the user was never shown.
      apy: competing.apy, years: competing.years, guaranteedPct: competing.guaranteePct,
      seasonYear: opts.seasonYear, capMode, week: opts.week,
    }).catch(() => { /* rival couldn't actually close it either — player just stays in free agency */ });
    throw new Error(`Outbid — the ${competing.teamName} swooped in with ~$${(competing.apy / 1_000_000).toFixed(1)}M/yr over ${competing.years} year${competing.years === 1 ? '' : 's'} before you closed the deal.`);
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
    // He reaches the wire TODAY, whatever he did before it. Zeroing the week
    // clock here means "weeks unsigned" always means weeks since this release
    // — a man cut, signed and cut again starts at his full price the second
    // time rather than inheriting the discount his last spell on the street
    // earned. signFreeAgent zeroes it on the way in for the same reason; this
    // is the way out.
    await tx.player.update({ where: { id: player.id }, data: { teamId: null, status: 'FREE_AGENT', weeksUnsigned: 0 } });
    await tx.transaction.create({
      data: {
        leagueId: opts.leagueId, seasonYear: opts.seasonYear, week: opts.week, type: 'CUT', teamId: player.teamId,
        playerId: player.id,
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
 * ===========================================================================
 * WHAT A BID HAS TO CLEAR — AND IT IS THE USER'S OWN MODEL NOW
 * ===========================================================================
 * There used to be a constant here:
 *
 *     export const MARKET_FLOOR = 0.85;   // share of market he will sign for
 *
 * and it was the second acceptance model this file was supposed to have
 * deleted. Read the block at the top of this file — WHERE `evaluateOffer`
 * WENT — and then read what the wave actually resolved on: a salary-only
 * ratio, no personality, no term, no guarantee, no band. The four lines that
 * block says are gone had simply moved down the file and put on a name.
 *
 * It also meant the free-agency board could not tell the truth. The board
 * advertises `askingPrice`; a CPU club signed at 0.85 of it while the user's
 * `decideOffer` wanted a median of 1.04 and as much as 1.44 — two different
 * answers to "what does this man sign for", both of them about the same
 * printed number. Measured across sixty free agents in a fresh league,
 * offering exactly the advertised price closed 13 of them.
 *
 * So the wave asks the model. `leastAcceptableApy` (lib/negotiation.ts) is
 * the bottom of the "he might sign" band in dollars — the same band the
 * user's meter draws, read at the same interest level — and a bid under it is
 * not a bid. What that costs, measured after the reservation price was
 * anchored to the advertised ask: the model puts a neutral free agent's floor
 * at a median of 0.89 of his ask, spread 0.73 to 1.00 by personality, term
 * and how much of the deal is guaranteed. The old flat 0.85 sat inside that
 * spread, which is the retrospective proof it was never a CPU discount — it
 * was the band bottom, hard-coded, against a price that meant "what he asks"
 * rather than "what he takes".
 *
 * WHAT THE CLUB IS ACTUALLY OFFERING has to be the package the floor is
 * priced for, or this is just a nicer-looking lie. `aiDealFor` below returns
 * all three together — term, guaranteed share, floor — and every AI signing
 * path writes the contract it describes.
 * ===========================================================================
 */

/**
 * The share of a deal an AI club guarantees, 0..1 — before his own floor is
 * applied. See `aiDealFor`.
 *
 * Not a tuning knob invented for the negotiation panel — it is
 * `buildContract`'s own default, which is what every AI signing in this file
 * takes unless it passes `guaranteedPct`. It is named and exported here
 * because a rival's guarantee is now a term the PLAYER SCORES: a
 * business-first man weights guaranteed money at 0.18 and a ring-chaser at
 * 0.30, so what a rival locks in decides contests. A constant the panel
 * invented would be the lying metric README design principle 6 rules out;
 * this one is checkable against the contract the wave actually writes, and
 * scripts/checkNegotiationAgreement.ts checks it.
 */
export const AI_GUARANTEE_PCT = 0.45;

/**
 * The man as the MARKET sees him — a negotiating context with no club
 * attached to it.
 *
 * Seeded on the player and the league year and NOTHING ELSE, which is the
 * same seed `resolveNegotiationSession` uses: a man's personality, the years
 * he wants and the wobble on his price are facts about HIM, so the club
 * asking may not change them. What a club does change is priced separately
 * and on purpose — loyalty, years of control, a ring-chaser's read on the
 * roster — and all three live in `clubDiscount` (lib/negotiation.ts), which
 * is exactly why they can be left out here without inventing a different man.
 *
 * `teamStrength` is the league average for the same reason `rivalView` uses a
 * neutral price: the wave is thirty-one clubs, not one, and the honest default
 * for a club nobody is being shown is the middle.
 */
export function marketContextFor(fa: BoardPlayer, seasonYear: number): NegotiationContext {
  const ask = askingPrice({
    ovr: fa.trueOvr, position: fa.position as Position, age: fa.age,
    potential: fa.potential, weeksUnsigned: fa.weeksUnsigned,
  });
  return buildNegotiationContext({
    playerId: fa.id,
    // Nothing in the wave ever renders his voice — no headline, no demand
    // line, no refusal sentence reaches a screen from here. The name is on
    // the transaction row the signing writes, off the player record.
    playerName: '',
    position: fa.position,
    age: fa.age,
    ovr: fa.trueOvr,
    marketApy: ask,
    trueMarketApy: ask,
    incumbent: false,
    teamStrength: 0.5,
    yearsWithTeam: 0,
    // The auction IS the competition here, and it is settled by the highest
    // bid a few lines below. Charging him a premium for it as well would be
    // the double-count `buildNegotiationContext` just stopped making on the
    // open market.
    competition: 0,
    mode: 'FREE_AGENT',
    seasonYear,
    rng: new Rng(`nego-${fa.id}-${seasonYear}`),
  });
}

/** The deal an AI club actually writes, and the least he will sign it for. */
export interface AiDeal {
  years: number;
  guaranteePct: number;
  /** The bottom of his "he might sign" band, in dollars. A bid under it is not a bid. */
  floor: number;
}

/**
 * What it takes to sign this man on a standard club deal.
 *
 * The guarantee is raised to HIS floor where it has to be, and that is not
 * tidying: `guaranteeFloorFor` caps interest below the band for a deal with
 * less locked in than he will accept, so an elite man offered the flat 45%
 * has refused the STRUCTURE and no salary closes him. A club that wrote him
 * that contract anyway — which is what every AI signing did — was signing a
 * deal the user's own panel would have said was unsignable.
 *
 * `term` overrides the length for callers that sign something other than a
 * standard deal; the in-season market writes one-year contracts, and a year
 * is not free (see `termPremium`), so its floor has to be priced for the year
 * it is actually offering.
 */
export function aiDealFor(fa: BoardPlayer, seasonYear: number, term?: number): AiDeal {
  const ctx = marketContextFor(fa, seasonYear);
  const years = Math.max(1, Math.min(term ?? suggestedYears(fa.trueOvr, fa.age), ctx.willingYears));
  const guaranteePct = Math.max(AI_GUARANTEE_PCT, ctx.guaranteeFloor);
  // Never null once the guarantee clears his floor — that is the only thing
  // that caps his interest below the band whatever the money — but the
  // fallback is stated rather than asserted, because a silent `!` here would
  // turn a future change to the interest caps into free players.
  const least = leastAcceptableApy(ctx, years, guaranteePct) ?? ctx.reservationApy;
  return { years, guaranteePct, floor: Math.max(CAP.MIN_SALARY, Math.round(least)) };
}

/**
 * One pass's worth of them, priced once. The wave asks the same question up to
 * thirty-one times per free agent — once per club walking its board — and the
 * answer does not depend on who is asking, so it is a lookup rather than a
 * bisection each time.
 */
export function aiDealBook(board: BoardPlayer[], seasonYear: number, term?: number): Map<string, AiDeal> {
  const book = new Map<string, AiDeal>();
  for (const fa of board) book.set(fa.id, aiDealFor(fa, seasonYear, term));
  return book;
}

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
 * They differ only in the SEED behind `price`. Both price with `maxOffer` off
 * the club's GM profile; the wave draws from the wave's own rng and the rumour
 * from the stable `fa-bid-<player>-<team>` one, so a panel re-read on every
 * keystroke returns the same club at the same number while a wave rolled twice
 * in one offseason does not. Everything that decides WHETHER a bid happens —
 * the order, the need threshold, the roster-slot rule, the upgrade-and-displace
 * rule, the line a bid has to clear — is here, once.
 */
export interface BoardPlayer {
  id: string;
  position: string;
  trueOvr: number;
  age: number;
  potential: number;
  /** Weeks on the wire — what his ask is discounted for. See askingPrice. */
  weeksUnsigned: number;
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
  /**
   * Roster spots held back for a draft class that has not happened yet. The
   * offseason wave reserves half a class; an in-season club reserves nothing,
   * because its rookies are already on the roster it just handed in.
   */
  rookieReserve: number;
  /** Defaults to the offseason wave's allowance. See FREE_AGENCY.IN_SEASON. */
  maxDisplace?: number;
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
    // Leave room for the rookie class, WHEN THERE IS ONE COMING. During
    // FREE_AGENCY the draft lands immediately afterwards, so filling all the
    // way to rosterMax just means cutting those same players again on
    // cut-down day (see trimRostersToLimit in lib/season.ts) — the caller
    // reserves the share of a class that realistically sticks. A club shopping
    // in October has no class to hold spots for and passes 0, which is why
    // this is the caller's number and not a constant read in here.
    openSlots: Math.max(0, opts.rosterMax - opts.roster.length - opts.rookieReserve),
    displacesLeft: opts.maxDisplace ?? FREE_AGENCY.MAX_DISPLACE_PER_TEAM_PER_WAVE,
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
  /**
   * The least each man on the board will sign for, priced once for the whole
   * pass — see `aiDealBook`. Every caller passes one: the line a bid has to
   * clear is the player's own, and a club that could only reach him at less
   * than that has not reached him.
   */
  deals: Map<string, AiDeal>,
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
    // anything the player would refuse — so a team facing a free agent it
    // cannot afford used to bid its entire remaining budget on him, have that
    // bid rejected, and then `break` on an exhausted budget without having
    // signed anyone. Because the board is sorted best-first once needs flatten
    // out, every team in the league did this to the same unaffordable player,
    // every week: measured 17 signings league-wide in the final year of a
    // 13-season run while 350 free agents rated 80+ sat unsigned. Applying the
    // same floor here, before the money is committed, lets a team walk down
    // the board to somebody it can actually sign.
    //
    // THE SAME FLOOR, and it is his rather than the file's: `aiDealBook` reads
    // it off `leastAcceptableApy`, the bottom of the band the user's own meter
    // draws. See WHAT A BID HAS TO CLEAR above.
    const deal = deals.get(fa.id);
    if (!deal || offer < deal.floor) continue;

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

/**
 * WHY THIS TAKES NO RNG ANY MORE.
 *
 * It used to take one and draw every club's bid out of it, while
 * `leadingCompetingBid` drew the same club's bid for the same man out of the
 * stable `fa-bid-<player>-<team>` seed. Two draws from one distribution are
 * still two different numbers, so the panel's "nobody is circling" was a
 * forecast of a DIFFERENT roll than the one the wave would make — and it was
 * wrong in the one direction that claim may never be wrong in. Measured on the
 * agreement harness: two of the top forty free agents reported as uncircled,
 * signed by the very next wave.
 *
 * lib/negotiation.ts has always described these as "the same function, the
 * same seed, the same cap-and-need test the AI bids on". They are now. A bid
 * is a pure function of the matchup and the board, so a rumour is not a
 * forecast of a roll — it is the roll, read early.
 */
export async function runAiFreeAgencyWave(leagueId: string, seasonYear: number, week: number, settings: LeagueSettings) {
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

  // WHAT EACH MAN WILL SIGN FOR, priced once for the whole wave off the same
  // model the user's panel runs. See WHAT A BID HAS TO CLEAR.
  const deals = aiDealBook(freeAgents as unknown as BoardPlayer[], seasonYear);

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

    // The walk down this club's board — order, slots, budget, the upgrade
    // rule, the signing floor. Shared with `leadingCompetingBid`, which is how
    // a suitor named in a negotiation panel is the club that actually comes
    // for him here. See planTeamBids.
    const state = bidderState({
      roster: roster as RosterPlayer[], needs, capSpace: summary.capSpace,
      capMode: settings.capMode, rosterMax, rookieReserve,
    });
    for (const bid of planTeamBids(freeAgents, state, (fa, capSpace) => {
      // One rng per matchup, feeding the profile fallback and then the bid
      // noise — the identical two lines `leadingCompetingBid` runs, so the
      // number a panel quotes is the number this wave puts on him.
      const rng = new Rng(`fa-bid-${fa.id}-${team.id}`);
      const profile = parseGmProfile(team.gmProfile, rng);
      return maxOffer(fa as unknown as RosterPlayer, { profile, needs, capSpace, rng });
    }, deals)) {
      bids.push({ ...bid, teamId: team.id });
    }
  }

  // Resolve: highest bid per player wins, if it clears what he will sign for.
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
    const deal = deals.get(playerId)!;
    const best = offers.sort((a, b) => b.offer - a.offer || a.teamId.localeCompare(b.teamId))[0];
    // THE ONE ACCEPTANCE TEST. Highest bid wins if it clears what HE will sign
    // for — `leastAcceptableApy`, the bottom of the band the user's own meter
    // draws — rather than a share of his advertised price written down here.
    if (best.offer < deal.floor) continue;

    const years = deal.years;
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
        // The share the floor above was priced for. A club that guaranteed
        // less than that would be writing the deal he refused.
        guaranteedPct: deal.guaranteePct,
      });
      signings += 1;
    } catch {
      /* cap edge case — skip this signing */
    }
  }
  return { signings, displaced };
}

/**
 * ===========================================================================
 * THE WIRE IS OPEN IN OCTOBER TOO — AI CLUBS SHOPPING DURING THE SEASON
 * ===========================================================================
 * `runAiFreeAgencyWave` above is called from exactly one place: the
 * FREE_AGENCY phase in lib/season.ts. That meant that from the moment a league
 * reached PRESEASON, nothing in the game could put a free agent on an AI
 * roster until the following spring. A 98-overall quarterback released in
 * April was unreachable for a full calendar year however far his price fell,
 * and the pool of unsigned stars the app owner kept finding on his free-agency
 * screen was the arithmetic result: an inflow every week, an outflow once a
 * year.
 *
 * This is the missing outflow, and it is deliberately NOT the offseason wave
 * run again. A wave is thirty-one clubs bidding on everybody at once, which in
 * week 1 of the regular season would strip the board clean before the GM had
 * read it. A season is not like that. Clubs sign a stranger when they have a
 * hole they cannot cover from inside the building and the man they want has
 * come down to what they can pay, and it happens to one or two clubs a week,
 * not thirty-one. So:
 *
 *   MOST WEEKS, NOBODY SIGNS ANYBODY (FREE_AGENCY.IN_SEASON.WEEK_CHANCE).
 *   AT MOST TWO CLUBS SHOP, one man each, and they are drawn from the clubs
 *     with the worst holes rather than from the league at large.
 *   A HOLE IS WHO CAN PLAY ON SUNDAY. Need is scored on the men who are
 *     actually available — injured players are dropped before `teamNeeds`
 *     runs — because in-season holes are injuries, and a club whose starting
 *     left tackle is out for six weeks is the club that reads the wire. The
 *     roster spot and the money are still counted off the WHOLE roster: an
 *     injured man occupies a place and a cap number whether he plays or not.
 *   THE PRICE HAS TO HAVE COME TO THEM. Nothing here discounts anybody — the
 *     ask is `askingPrice`, the same figure the free-agency board prints, and
 *     the reason a club can suddenly afford a 97 in November is that he has
 *     spent three months not signing anywhere. In-season cap space is thin, so
 *     this gate does most of the work on its own.
 *
 * WHAT IT MAY NOT DO. It never touches the user's club — his roster is his,
 * and the only signings that ever appear on it are the ones he made. It signs
 * through `signFreeAgent` like everything else in this file, so `assertCapRoom`
 * applies exactly as it does in the offseason and an in-season signing can
 * never be the cheap way around the cap. And it displaces at most one man per
 * club, through the ordinary cut path, dead money and all.
 *
 * TERM. A club signing in the regular season is buying the rest of THIS year:
 * one-year deal, and he is back on the market in the spring at whatever he is
 * then worth. Preseason is still really the offseason — camp signings are
 * ordinary contracts — so those get `suggestedYears` like any other.
 */
export async function runInSeasonSignings(opts: {
  leagueId: string;
  seasonYear: number;
  week: number;
  /** PRESEASON or REGULAR. Decides the term — see TERM above. */
  phase: string;
  settings: LeagueSettings;
}): Promise<{ signings: number; displaced: number }> {
  const { leagueId, seasonYear, week, phase, settings } = opts;
  const quiet = { signings: 0, displaced: 0 };
  /**
   * ITS OWN STREAM, AND THE SEASON YEAR IS IN THE SEED. This used to take the
   * week's rng — the one `simulateWeek` builds from
   * `<simSeed>-<phase>-<week>` and hands to the games — and that made the
   * quiet weeks a permanent property of the league rather than of the season:
   * the seed has no year in it and every week draws the same number of games,
   * so week 5 of 2029 landed on the identical roll as week 5 of 2027, and a
   * league that happened to be quiet in a given week was quiet in that week
   * for ever. Measured on a save that ran three seasons: one in-season
   * signing in the first year, none at all in the next two.
   *
   * Seeded rather than random, because a re-run of the same week must produce
   * the same market — replaying an advance is not supposed to reshuffle who
   * signed where.
   */
  const rng = new Rng(`in-season-${leagueId}-${seasonYear}-${week}`);
  // Most weeks the wire is quiet. Rolled FIRST so that on those weeks this
  // costs a random number and no database round trip at all — it runs on
  // every single week advance, and sim speed in this codebase is a real
  // constraint (see the batching note in lib/season.ts).
  if (!rng.bool(FREE_AGENCY.IN_SEASON.WEEK_CHANCE)) return quiet;

  const board = await prisma.player.findMany({
    where: { leagueId, status: 'FREE_AGENT', teamId: null, isDraftee: false },
    orderBy: [{ trueOvr: 'desc' }, { id: 'asc' }],
    take: FREE_AGENCY.IN_SEASON.BOARD_SIZE,
    select: { id: true, position: true, trueOvr: true, age: true, potential: true, weeksUnsigned: true },
  });
  if (board.length === 0) return quiet;

  // WHAT EACH OF THEM WILL SIGN FOR, once for the week. The TERM is passed in
  // rather than left to `suggestedYears`, because a regular-season deal runs
  // to the end of this year and no further (see TERM above) and a year away
  // from what a man wants has a price on it (`termPremium`) — a floor priced
  // for a four-year contract is not the floor for the one-year contract this
  // club is actually offering.
  const deals = aiDealBook(board, seasonYear, phase === 'REGULAR' ? 1 : undefined);

  // Every AI roster in one read, without contracts. This is the scan that
  // decides WHO has a hole; the two clubs that end up shopping are re-read
  // properly below. Thirty-one separate queries with the contract join — what
  // the offseason wave does, where it runs four times a year — would be the
  // wrong shape for something that runs on every week advance.
  const rosterMax = settings.rosterMax ?? LEAGUE.ROSTER_MAX;
  const rosterMin = rosterMinFor(rosterMax);
  const rostered = await prisma.player.findMany({
    where: { leagueId, status: 'ACTIVE', teamId: { not: null }, team: { isUser: false } },
    // Four columns, not the whole player: `teamNeeds` reads position and
    // rating, and this scan wants nothing else. Measured over ~1,630 rows it
    // is 11ms against 18ms for the wider select, on a query that runs on
    // every week advance in the game.
    select: { teamId: true, position: true, trueOvr: true, injuryWeeks: true },
  });
  const byTeam = new Map<string, typeof rostered>();
  for (const p of rostered) {
    const list = byTeam.get(p.teamId!) ?? [];
    list.push(p);
    byTeam.set(p.teamId!, list);
  }

  interface Candidate { teamId: string; needs: Record<string, number>; severity: number }
  const candidates: Candidate[] = [];
  for (const [teamId, roster] of byTeam) {
    // The hole is measured on who can actually play. See the block above.
    const available = roster.filter((p) => p.injuryWeeks === 0);
    const needs = teamNeeds(available);
    const severity = Object.values(needs).reduce((m, v) => Math.max(m, v), 0);
    // A club below the legal roster size is short of bodies whatever its need
    // scores say, and it is exactly the club a real front office would expect
    // to see making a signing this week.
    if (severity < FREE_AGENCY.IN_SEASON.NEED_FLOOR && roster.length >= rosterMin) continue;
    candidates.push({ teamId, needs, severity });
  }
  if (candidates.length === 0) return quiet;

  /**
   * WHICH OF THEM ACTUALLY SIGNS SOMEBODY THIS WEEK — drawn at random, weighted
   * by how bad the hole is, from EVERY club that has one.
   *
   * Taking the worst holes outright (what this did first) reads sensible and
   * measured terribly. `teamNeeds` scores a position below its roster minimum
   * at 1.00, and the positions that carry one man — kicker, punter — go below
   * their minimum the moment that one man is hurt. So the top of the list was
   * permanently a queue of clubs needing a kicker, the same two of them signed
   * a kicker every week, and the 97-overall left tackle three quarters of the
   * league would have wanted was never looked at by anybody. Measured on a
   * save at the end of a season: 29 of 31 clubs cleared the need floor and 12
   * of the top 12 were short a specialist.
   *
   * Weighted-random across the whole candidate list keeps the property that
   * mattered — a club with a real hole is likelier to be the one that moves —
   * without letting one kind of hole own the market.
   */
  // Sorted before the draw purely so the draw is reproducible: the roster read
  // above has no ORDER BY, and a weighted pick over an unordered list would
  // hand back a different club each time the same week was replayed.
  const remaining = [...candidates].sort((a, b) => a.teamId.localeCompare(b.teamId));
  const shopping: Candidate[] = [];
  while (shopping.length < FREE_AGENCY.IN_SEASON.MAX_CLUBS_PER_WEEK && remaining.length > 0) {
    const total = remaining.reduce((sum, c) => sum + c.severity, 0);
    let roll = rng.float(0, total);
    let idx = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      roll -= remaining[i].severity;
      if (roll <= 0) { idx = i; break; }
    }
    shopping.push(remaining.splice(idx, 1)[0]);
  }

  let signings = 0;
  let displaced = 0;
  const taken = new Set<string>();

  for (const candidate of shopping) {
    const team = await prisma.team.findUnique({ where: { id: candidate.teamId } });
    if (!team || team.isUser) continue; // his club is his — belt on top of the query filter
    const roster = await prisma.player.findMany({
      where: { teamId: team.id, status: 'ACTIVE' },
      select: { id: true, position: true, trueOvr: true, age: true, potential: true, contract: true },
      orderBy: [{ trueOvr: 'asc' }, { id: 'asc' }],
    });
    const summary = await teamCapSummary(team.id, seasonYear, settings.capMode);
    const state = bidderState({
      roster: roster as RosterPlayer[],
      needs: candidate.needs,
      capSpace: summary.capSpace,
      capMode: settings.capMode,
      rosterMax,
      // The draft is behind us — this club's rookies are already on this roster.
      rookieReserve: 0,
      maxDisplace: FREE_AGENCY.IN_SEASON.MAX_DISPLACE,
    });
    const open = board.filter((p) => !taken.has(p.id));
    const plan = planTeamBids(open, state, (fa, capSpace) => {
      // The same stable matchup seed the offseason wave and the panel's rumour
      // use. What a club would put on a man is a fact about the pair of them,
      // not about which of the three code paths happened to ask.
      const bidRng = new Rng(`fa-bid-${fa.id}-${team.id}`);
      return maxOffer(fa as unknown as RosterPlayer, {
        profile: parseGmProfile(team.gmProfile, bidRng), needs: candidate.needs, capSpace, rng: bidRng,
      });
    }, deals);
    // The top of ITS board, not the whole plan. A club fills a hole this week;
    // it does not run a wave of its own.
    for (const bid of plan.slice(0, FREE_AGENCY.IN_SEASON.MAX_SIGNINGS_PER_CLUB)) {
      // Term and guaranteed share off the same deal its floor was priced for.
      const deal = deals.get(bid.playerId)!;
      const years = deal.years;
      try {
        if (bid.displacePlayerId) {
          // Identical to the wave's own swap check, and for the same reason:
          // prove the money works BEFORE anybody is released, so a signing
          // that fails at the cap gate can never leave a club a body short
          // for nothing.
          const outgoing = await prisma.player.findUnique({ where: { id: bid.displacePlayerId }, include: { contract: true } });
          if (!outgoing || outgoing.teamId !== team.id) continue;
          const preview = buildContract({ apy: Math.round(bid.offer), years, signedYear: seasonYear });
          const incomingHit = capHit({ ...preview, baseSalaries: writeJson(preview.baseSalaries) }, settings.capMode);
          const freed = capSavingsOnCut(outgoing.contract, settings.capMode);
          if (incomingHit > summary.capSpace + freed) continue;
          await cutPlayer({ leagueId, playerId: bid.displacePlayerId, capMode: settings.capMode, seasonYear, week });
          displaced += 1;
        }
        await signFreeAgent({
          leagueId, playerId: bid.playerId, teamId: team.id, apy: Math.round(bid.offer),
          years, seasonYear, capMode: settings.capMode, week,
          guaranteedPct: deal.guaranteePct,
        });
        taken.add(bid.playerId);
        signings += 1;
      } catch {
        /* cap edge case, or somebody signed him first — the club simply misses out */
      }
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
 *
 * WHAT A MINIMUM-SALARY DEAL MAY BUY. This is still the one signing path in
 * the game that does not ask whether the man would accept — it offers
 * CAP.MIN_SALARY and takes whoever is best, so a short club used to buy the
 * best free agent in football for the league minimum. Because it also runs BEFORE the wave and before the user
 * ever sees the free-agency screen, it emptied the market from the top down:
 * measured, the first offseason's pool went 91 players to 15 and its best
 * available went 85 OVR to 57 in a single step, with nothing on screen in
 * between. Now it shops the tier a one-year minimum actually reaches
 * (FREE_AGENCY.FILL_MAX_MARKET_MULT), and only if that tier is exhausted does
 * it fall back to the CHEAPEST man left rather than the best — so no club is
 * ever stranded below the minimum, and no club ever gets a starter for free.
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
      take: (rosterMin - roster.length) * 8 + 400,
    });
    // Who would actually put his name on a one-year league-minimum deal.
    // Everyone else stays on the board for the wave and for the user.
    const affordable = pool.filter((c) => askingPrice({
      ovr: c.trueOvr, position: c.position as Position, age: c.age,
      potential: c.potential, weeksUnsigned: c.weeksUnsigned,
    }) <= CAP.MIN_SALARY * FREE_AGENCY.FILL_MAX_MARKET_MULT);
    // Last resort only, and cheapest-first: a club may not stay illegal, but
    // it does not get to raid the top of the market to avoid it.
    const fallback = [...pool].sort((a, b) => a.trueOvr - b.trueOvr || a.id.localeCompare(b.id));

    while (roster.length < rosterMin) {
      const needs = teamNeeds(roster as RosterPlayer[]);
      const wanted = Object.entries(needs).sort((a, b) => b[1] - a[1]).map(([pos]) => pos);
      const pick = affordable.find((c) => !taken.has(c.id) && c.position === wanted[0])
        ?? affordable.find((c) => !taken.has(c.id) && wanted.slice(0, 5).includes(c.position))
        ?? affordable.find((c) => !taken.has(c.id))
        ?? fallback.find((c) => !taken.has(c.id));
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
 * ===========================================================================
 * "FILL ROSTER" — CAMP BODIES, NOT SHOPPING
 * ===========================================================================
 * WHAT THIS BUTTON DID, in the app owner's words: *"the fill roster button by
 * default should fill with league minimum or close to league minimum salary
 * players on 1 year deals. my fill roster signed 3 backups to huge
 * contracts."* And then: *"it basically bricked my save cause i cant get out
 * of these contracts."*
 *
 * Four decisions compounded into that, and all four are gone:
 *
 *   1. `orderBy: { trueOvr: 'desc' }, take: 10` per needed position — it went
 *      after the BEST free agent on the board, not a body to reach 53.
 *   2. It priced him with `maxOffer` (lib/ai/gm.ts): askingPrice x overpay x
 *      noise, scaled by AI.FA_MAX_OVERPAY, GM aggression and need. That
 *      function exists to WIN a contested free agent — it bids deliberately
 *      ABOVE market, which is the last thing a roster-filling click should do.
 *   3. Term came from `suggestedYears`, so a good young man got
 *      CONTRACT.MAX_DEAL_YEARS and the money was locked in for years.
 *   4. It passed no `bonusPct`, so `buildContract` applied its 0.28 default:
 *      28% of the deal handed over as signing bonus, prorated. THAT is why he
 *      could not cut his way back out — releasing one accelerates the
 *      unamortised bonus onto the cap as dead money.
 *
 * THE TRAP IN FIXING IT, which is the whole difficulty of this function:
 * `signFreeAgent` runs no acceptance check on this path. Nobody says no. Drop
 * the price while still ordering the board by trueOvr and you have not fixed a
 * bad default, you have built the worst exploit in the game — a 90-overall on
 * a $1M deal, one click, no negotiation.
 *
 * So THE PRICE AND THE CANDIDATE LIST ARE THE SAME FILTER. A man is eligible
 * only if what he will already sign for today — `askingPrice`, the number
 * every free-agent price in the game goes through — is inside the tier a
 * one-year minimum deal actually reaches (FREE_AGENCY.FILL_MAX_MARKET_MULT),
 * and the offer written is that same number. We never underpay him and we
 * never reach above the tier, so there is nothing left for an acceptance check
 * to catch. Anyone pricier stays on the board, where signing him is a
 * negotiation like it is for every other club.
 *
 * NO FALLBACK TO THE CHEAPEST MAN LEFT, unlike `fillTeamsToRosterMinimum`
 * above. An AI club may not be left sitting below the legal roster minimum, so
 * that path takes the cheapest body rather than stay illegal. This one is a
 * button the user pressed, and "nobody at CB will play for the minimum" is a
 * true sentence he can act on — it beats quietly handing him a contract he did
 * not choose, which is the failure this whole rewrite is about.
 *
 * NOTHING HERE IS RANDOM ANY MORE. That fell out of removing `maxOffer`'s
 * noise, and it is worth keeping: the plan the confirm sheet showed and the
 * plan the commit re-derives are the same plan unless the world genuinely
 * moved between the two clicks.
 * ===========================================================================
 */

/** One deal the button proposes, priced exactly as it will be written. */
export interface FillRosterSigning {
  playerId: string;
  name: string;
  position: string;
  age: number;
  /** What he will already sign for today. Never a premium on top of it. */
  apy: number;
  years: number;
  /** Year-1 cap hit of the contract this actually produces, in the league's mode. */
  capHit: number;
  /**
   * What releasing him tomorrow would cost. Zero by construction — no signing
   * bonus, nothing guaranteed — and carried on the row because that promise is
   * the entire point of a minimum deal and the thing that was broken.
   */
  deadMoneyIfCut: number;
}

/** A position that needs a body and is being left empty anyway, and why. */
export interface FillRosterPass {
  position: string;
  reason: string;
}

export interface FillRosterPlan {
  /** Men on your books now, and the two lines this button works between. */
  rosterCount: number;
  rosterMin: number;
  rosterMax: number;
  /**
   * False only in OFF mode. `CapSummary.capSpace` is +Infinity there, so the
   * two figures below are zeroed rather than passed on — see the doc on
   * CapSummary.capSpace for why rendering it directly prints "$InfinityM".
   */
  capEnabled: boolean;
  capSpaceBefore: number;
  capSpaceAfter: number;
  totalCapHit: number;
  signings: FillRosterSigning[];
  passed: FillRosterPass[];
  /** Why the pass stopped before working through every need, if it did. */
  stoppedBy: string | null;
}

/**
 * Everything the button is about to do, decided and priced, with nothing
 * written. The confirm sheet renders this; the commit below re-derives it.
 *
 * Exported because the preview and the signing MUST come out of the same
 * function — a sheet that quoted a different plan than the one that ran would
 * be the lying metric this codebase keeps writing down (README principle 6).
 */
export async function planRosterFill(opts: {
  leagueId: string;
  teamId: string;
  seasonYear: number;
  settings: LeagueSettings;
}): Promise<FillRosterPlan> {
  const { leagueId, teamId, seasonYear, settings } = opts;
  const capMode = settings.capMode;
  const rosterMax = settings.rosterMax ?? LEAGUE.ROSTER_MAX;
  const rosterMin = rosterMinFor(rosterMax);

  const roster = await prisma.player.findMany({
    where: { teamId },
    select: { id: true, position: true, trueOvr: true, age: true, potential: true },
  });
  const needs = teamNeeds(roster as RosterPlayer[]);
  const neededPositions = Object.entries(needs)
    .filter(([, v]) => v >= 0.15) // same "Notable" floor as the Roster Needs widget
    .sort((a, b) => b[1] - a[1]);

  const summary = await teamCapSummary(teamId, seasonYear, capMode);
  // A BUTTON MAY NOT SPEND THE LAST OF YOUR ROOM. Kept from the original: it
  // leaves enough behind for the in-season moves a GM still has to make (an
  // injury replacement, a claim) rather than pinning the club at zero to fill
  // a bench spot. In OFF mode capSpace is +Infinity and this is a no-op.
  const reserve = 3_000_000;

  // THE WHOLE POOL, PRICED ONCE, AND DELIBERATELY UNBOUNDED. The eligible tier
  // is the BOTTOM of the board by definition, so a per-position `orderBy
  // trueOvr desc, take: 10` — what this used to run — hands back ten men who
  // are all too expensive and calls the position empty. Ordering the other way
  // and taking N would be a guess too: `askingPrice` carries position and age
  // multipliers, so it is not monotonic in trueOvr and the cheapest N by
  // rating is not the cheapest N by price. A few hundred narrow rows, once per
  // click, is the honest read.
  const pool = await prisma.player.findMany({
    where: { leagueId, status: 'FREE_AGENT', teamId: null, isDraftee: false },
    orderBy: [{ trueOvr: 'desc' }, { id: 'asc' }],
    select: {
      id: true, firstName: true, lastName: true, position: true,
      trueOvr: true, age: true, potential: true, weeksUnsigned: true,
    },
  });
  // PRICED OFF `trueOvr`, NOT off this club's scouting report. The eligibility
  // test and the offer are one number and that number has to be the man's real
  // one: price him through a fogged view and a bad scouting department turns
  // into a way to sign a 90-overall for the minimum — the same exploit by a
  // different door.
  const ceiling = CAP.MIN_SALARY * FREE_AGENCY.FILL_MAX_MARKET_MULT;
  const eligible = pool
    .map((p) => ({
      ...p,
      ask: askingPrice({
        ovr: p.trueOvr, position: p.position as Position, age: p.age,
        potential: p.potential, weeksUnsigned: p.weeksUnsigned,
      }),
    }))
    .filter((p) => p.ask <= ceiling);

  const signings: FillRosterSigning[] = [];
  const passed: FillRosterPass[] = [];
  const taken = new Set<string>();
  let openSlots = Math.max(0, rosterMax - roster.length);
  let spent = 0;
  let stoppedBy: string | null = null;

  for (const [position] of neededPositions) {
    if (openSlots <= 0) {
      stoppedBy = `You are at the ${rosterMax}-man limit — there is no spot left to sign anyone into.`;
      break;
    }
    const pick = eligible.find((c) => c.position === position && !taken.has(c.id));
    if (!pick) {
      passed.push({ position, reason: `nobody at ${position} will play for the minimum` });
      continue;
    }

    // The deal that would actually be written, built by the same call
    // `signFreeAgent` makes, so the cap hit quoted here is the cap hit charged.
    const contract = buildContract({
      apy: pick.ask,
      years: 1,
      signedYear: seasonYear,
      // NO BONUS, NOTHING GUARANTEED, and both are stated rather than
      // inherited. `buildContract` defaults to bonusPct 0.28 / guaranteedPct
      // 0.45, and those two defaults are what turned a bench signing into a
      // contract the owner could not release: the bonus accelerates on a cut
      // and the guaranteed base is owed for a season he will not play. A camp
      // body has to be free to cut the day after camp — that is what the deal
      // is FOR, and it is what would have saved the save.
      bonusPct: 0,
      guaranteedPct: 0,
    });
    const stored = { ...contract, baseSalaries: writeJson(contract.baseSalaries) };
    const hit = capHit(stored, capMode);

    if (hit > summary.capSpace - spent - reserve) {
      stoppedBy = 'Not enough cap room left for another minimum deal.';
      break;
    }

    signings.push({
      playerId: pick.id,
      name: `${pick.firstName} ${pick.lastName}`,
      position,
      age: pick.age,
      apy: pick.ask,
      years: contract.years,
      capHit: hit,
      // Read back off the contract rather than asserted to be zero. If a future
      // change to `buildContract` ever put money back into one of these, the
      // sheet says so instead of printing a promise the deal no longer keeps.
      deadMoneyIfCut: deadMoneyOnCut(stored, capMode),
    });
    taken.add(pick.id);
    openSlots -= 1;
    spent += hit;
  }

  return {
    rosterCount: roster.length,
    rosterMin,
    rosterMax,
    capEnabled: summary.capEnabled,
    capSpaceBefore: summary.capEnabled ? summary.capSpace : 0,
    capSpaceAfter: summary.capEnabled ? summary.capSpace - spent : 0,
    totalCapHit: spent,
    signings,
    passed,
    stoppedBy,
  };
}

/**
 * Sign the plan. One pass = at most one man per position that still shows a
 * notable need, most severe first — click again if bodies and room remain.
 *
 * IT RE-PLANS RATHER THAN TAKING A PLAN. A Server Action is a POST endpoint
 * whether or not a confirm sheet stands in front of it, so a list of player ids
 * and prices arriving from the client is a request, not a decision. Re-deriving
 * costs one read and makes the sheet unforgeable.
 */
export async function fillRosterForTeam(opts: {
  leagueId: string;
  teamId: string;
  seasonYear: number;
  week: number;
  settings: LeagueSettings;
  /**
   * Unused. Kept so existing call sites still compile: this path had a random
   * component only because it priced through `maxOffer`, and it does not any
   * more — see NOTHING HERE IS RANDOM ANY MORE above.
   */
  rng?: Rng;
}): Promise<{ plan: FillRosterPlan; signed: FillRosterSigning[]; missed: string[] }> {
  const { leagueId, teamId, seasonYear, week, settings } = opts;
  const plan = await planRosterFill({ leagueId, teamId, seasonYear, settings });

  const signed: FillRosterSigning[] = [];
  const missed: string[] = [];
  for (const s of plan.signings) {
    try {
      await signFreeAgent({
        leagueId, playerId: s.playerId, teamId, apy: s.apy, years: s.years,
        seasonYear, capMode: settings.capMode, week,
        // Same two arguments the plan priced with. Passing them again here
        // rather than defaulting is the point of the fix, not a formality.
        bonusPct: 0, guaranteedPct: 0,
      });
      signed.push(s);
    } catch (err) {
      // NAMED, NOT SWALLOWED. This used to be a bare `catch {}`, so a man who
      // signed elsewhere between the read and the write simply never appeared
      // and nothing said why.
      missed.push(`${s.name} (${s.position}) — ${err instanceof Error ? err.message : 'that signing could not be completed'}`);
    }
  }

  return { plan, signed, missed };
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
  // ONE READ OF THE TREE, TWO ANSWERS OUT OF IT. The GM's skills move both
  // halves of what this panel shows — how his ratings are drawn
  // (`scoutingModsFor`) and how wide the "he might sign" band is
  // (`signBandMultFor`) — and `loadScoutMods`/`loadSignBandMult` would each
  // fetch the identical profile row to answer one of them. Same row, same
  // parse, one query.
  const skills = parseSkills((await loadDynastyProfile(leagueId)).skills);
  const view = buildScoutedView({
    position: player.position as Position,
    trueAttrs: readJson(player.trueAttrs, {}),
    trueOvr: player.trueOvr,
    potential: player.potential,
    report,
    settings,
    isOwnRoster: incumbent,
    isUserView: true,
    dynasty: scoutingModsFor(skills),
  });
  // WHAT HE WILL TAKE TODAY, on both halves. `askingPrice` is `marketValue`
  // discounted for time on the wire, and it is identical to it for anybody
  // under contract (weeksUnsigned is 0 for every rostered player), so the
  // re-sign and extension screens are unaffected — but a free agent whose
  // number has come down must reserve against the number the board is
  // advertising and the number the AI wave will bid, or the panel would quote
  // a discount the table then refuses to honour.
  const marketApy = askingPrice({
    ovr: view.scoutedOvr, position: player.position as Position, age: player.age,
    weeksUnsigned: player.weeksUnsigned,
  });
  const trueMarketApy = askingPrice({
    ovr: player.trueOvr, position: player.position as Position, age: player.age,
    potential: player.potential, weeksUnsigned: player.weeksUnsigned,
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
  // patience, and it never touches `gate.rival`, because you cannot be
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
    // What the same rating was worth before he went unsigned. Only ever
    // different for a free agent whose ask has come down, and carried so the
    // panel can show him coming down rather than quietly quoting a smaller
    // number than the one the user remembers.
    openMarketApy: marketValue({ ovr: view.scoutedOvr, position: player.position as Position, age: player.age }),
    trueMarketApy,
    incumbent,
    teamStrength,
    yearsWithTeam: incumbent && player.contract ? Math.max(0, seasonYear - player.contract.signedYear) : 0,
    competition,
    resignWindow,
    mode,
    seasonYear,
    controlYears,
    // THE DEAL THE OFFER WILL BE APPENDED TO, on whichever screen he is under
    // contract. It used to be the extension screen's alone, which is what made
    // the meter quote a walk-year re-sign as a fresh contract while
    // `extendContract` has to append it (see the block above that function):
    // the panel drew a year-1 hit off a schedule the signing would not
    // produce. `decideOffer` keys its preview on exactly this — a contract
    // with years still to run — so what is drawn is what gets written.
    //
    // Still null on the open market whatever the row says: nobody appends to a
    // contract another club signed, and `negotiateOffer` never routes a free
    // agent through the append path.
    currentContract: incumbent && controlYears > 0 ? player.contract : null,
    // Still passed, and it is now a constant at this table: scouting fog is
    // draft prospects only, so every free agent and every incumbent comes
    // back at 100. What actually varies the band is the line below — see the
    // block above `bandHalfWidthFor` in lib/negotiation.ts.
    scoutConfidence: view.confidence,
    // THE NEGOTIATION BRANCH, at the table. The app owner: *"the negotiating
    // tree should be about signings. Each point up to the 3 abilities narrows
    // the uncertainty band."* Keyed on total ranks in the branch, so every
    // purchase pays. It rides on the context and therefore on
    // `sessionFingerprint`, which is what stops a rank bought between opening
    // the panel and pressing the button from silently re-pricing a
    // negotiation the meter had already described.
    signBandMult: signBandMultFor(skills),
    // Seeded on the MAN and the league year — not the clock, and no longer the
    // club. Re-opening the panel, refreshing the page or submitting an offer
    // all rebuild the identical man with the identical asking price; only the
    // season rolling over gives him a new read on himself.
    //
    // The team came out of this seed when the AI started asking the same model
    // (`marketContextFor`). His personality, the years he wants and the wobble
    // on his price are facts about HIM: a floor the sealed-bid wave enforces
    // and a meter the user's panel draws cannot be about two different men and
    // still be one acceptance model. What a club changes is priced separately
    // and always was — loyalty, years of control, a ring-chaser's read on the
    // roster all live in `clubDiscount` — so nothing club-specific is lost.
    rng: new Rng(`nego-${playerId}-${seasonYear}`),
  });

  // Cap room, and the credit an extension gets, AS TWO NUMBERS.
  //
  // The gate has to measure what the enforcement measures or the meter refuses
  // deals the server would have allowed. It does — but these used to be added
  // together here and shipped as a single `capSpace`, which hid the sign of
  // the change from the one place that had to test it and cost exactly that:
  // over the cap, a deal that LOWERED a man's hit was refused. The full
  // account, with the measurement, is on `capCreditBack` in lib/negotiation.ts.
  const oldHit = incumbent && player.contract ? capHit(player.contract, capMode) : 0;
  const capSpace = capMode === 'OFF'
    ? Number.MAX_SAFE_INTEGER
    : (await teamCapSummary(teamId, seasonYear, capMode)).capSpace;

  // The LEAGUE's ceiling is flat now (12, see maxYearsForAge) and the age
  // ladder that used to be here belongs to the player — `ctx.willingYears`,
  // which refuses in his own voice.
  //
  // On a deal that APPENDS the control sets how many years are being ADDED, so
  // what is left of the ceiling is the league's minus the ones he is already
  // owed. Keyed on the same "still under contract" test the signing path uses
  // rather than on which screen this is: now that a walk-year re-sign appends
  // too, twelve added years on top of the season he is owed would write a
  // thirteen-year contract, and TERM.MAX_CONTRACT_YEARS is the rule that no
  // contract, from anybody, to anybody, may exceed.
  const leagueMaxYears = maxYearsForAge(player.age);
  const maxYears = incumbent && controlYears > 0
    ? Math.max(1, leagueMaxYears - controlYears)
    : leagueMaxYears;
  const ceilingFloor = Math.max(CAP.MIN_SALARY * 2, Math.round(marketApy * 2.5));
  const gate: NegotiationGate = {
    capMode,
    capSpace,
    // Nothing to credit on the open market: he is not on your books, so the
    // whole year-1 hit is new money and the gate tests it gross.
    capCreditBack: capMode === 'OFF' ? 0 : oldHit,
    minSalary: CAP.MIN_SALARY,
    // The ceiling has to clear a rival's bid, or the one control that could
    // win the auction would stop short of the number that wins it. A re-sign
    // is not an auction, but the same reasoning applies to the rumour: if the
    // panel says a club will go to $18M, the salary slider has to reach $18M.
    maxSalary: Math.max(ceilingFloor, suitor ? Math.round(suitor.apy * 1.15) : 0),
    maxYears,
    // THE BID, WHOLE. It used to be a number and a name, which is all the old
    // dollar comparison in `decideOffer` could use; the player scores the
    // package now, so the package travels. Still null on both incumbent
    // screens for the reason above — nobody may bid on a man under contract.
    rival: competing
      ? {
          teamName: competing.teamName,
          offer: { apy: competing.apy, years: competing.years, guaranteePct: competing.guaranteePct },
        }
      : null,
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
    // Whether this deal will be APPENDED to one he is already on — the same
    // test `extendContract` branches on and `decideOffer` drew the preview
    // from, so the sentence at the bottom of this block describes the contract
    // that is about to exist rather than the offer that produced it.
    const appended = incumbent && session.ctx.controlYears > 0;
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
          // THE SETTING THE METER WAS DRAWN FROM, resolved the identical way.
          // `decideOffer` above priced this exact offer with
          // `structure.convertPct ?? DEFAULT_CONVERT_PCT`; handing the write a
          // different figure would make the year-1 number on the panel a
          // number about a contract nobody signed.
          convertPct: structure.convertPct ?? DEFAULT_CONVERT_PCT,
        });
      } else if (incumbent) {
        await extendContract({
          leagueId, playerId, apy: offer.apy, years: offer.years, seasonYear,
          capMode: settings.capMode, week, escalation: structure.escalation, voidYears: structure.voidYears,
          // Same figure the meter used, resolved the same way. A walk-year
          // re-sign APPENDS (see extendContract), so this reaches
          // `signExtension` on that path too. The re-sign screen sets the field
          // now — it has the slider the extension screen always had — but the
          // default stays here rather than in the builder, because an offer may
          // still arrive from a caller that never set it.
          convertPct: structure.convertPct ?? DEFAULT_CONVERT_PCT,
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
          // The same man the meter was just drawn from, so the last-second
          // re-check is the same contest and not a second, blunter one.
          ctx: session.ctx,
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
          // WHICH OF THOSE YEARS WERE BOUGHT. `offer.years` is the term he
          // agreed to, and on a deal that appended it is only part of the row
          // above it — the rest is the season he was already owed. The
          // confirmation needs both or it prints a per-year rate against a
          // term that rate was never quoted over; see SignedDeal.newYears.
          // The clamped offer, not the raw one, because that is the term that
          // was signed.
          newYears: appended ? offer.years : written.contract.years,
          apy: offer.apy,
          guaranteed: guaranteedMoney(written.contract),
          capHitThisYear: capHit(written.contract, settings.capMode),
          capSpaceBefore: capBefore,
          capSpaceAfter: capAfter,
          // You only beat somebody if somebody was actually bidding and the
          // man chose you over them — which is what `decision.outbid` being
          // false means now that a rival is a package rather than a number.
          // The old test was `offer.apy > competingApy`, so a deal won on
          // guaranteed money reported no rival beaten at all.
          beat: session.gate.rival && !decision.outbid
            ? { teamName: session.gate.rival.teamName, apy: session.gate.rival.offer.apy }
            : null,
        }
      : undefined;

    return {
      ...base,
      ok: true,
      signed,
      // WHAT THE CONTRACT ROW SAYS, in a sentence. A deal that APPENDS runs
      // longer than the term that was offered, and the confirmation beside
      // this line reads its year count straight off the row — so quoting the
      // offer's term as the length of the contract would have the two
      // disagreeing on screen. This used to say the extension's "old deal is
      // torn up and replaced", which had not been true since `signExtension`
      // started appending, and would now be untrue of a walk-year re-sign as
      // well.
      message: appended
        ? `${session.ctx.playerName} is ${mode === 'EXTENSION' ? 'extended' : 'staying'} — ${offer.years} more year${offer.years === 1 ? '' : 's'} at ${formatMoney(offer.apy)}/yr on top of the ${session.ctx.controlYears === 1 ? 'season' : `${session.ctx.controlYears} seasons`} he was already owed, ${decision.contractYears} in all.`
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
        ? `They shopped it — ${session.gate.rival?.teamName ?? 'another club'} still have the better package on the table and he is taking theirs over this.`
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
  try {
    await signFreeAgent({
      leagueId: opts.leagueId, playerId: opts.playerId, teamId: competing.teamId,
      // Read off the bid itself rather than rebuilt: this is the deal the panel
      // promised he would get if he walked — the term and the guaranteed share
      // `aiDealFor` priced his floor for — so it is written exactly as it was
      // quoted. Changing what a club offers now changes both.
      apy: competing.apy, years: competing.years, guaranteedPct: competing.guaranteePct,
      seasonYear: opts.seasonYear, capMode, week: opts.week,
    });
  } catch {
    return null; // rival couldn't fit it either — he stays on the market
  }
  return { teamName: competing.teamName, apy: competing.apy };
}
