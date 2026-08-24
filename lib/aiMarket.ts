import { prisma } from './db';
import { Rng } from './rng';
import { AI, TRADE_VALUE, LEAGUE, PICK_VALUE_CHART } from './tuning';
import type { LeagueSettings } from './settings';
import type { CapMode } from './types';
import { readJson } from './json';
import {
  evaluateTrade, executeTrade, isTradeDeadlinePassed, effectiveSlot,
  TradeAssetError, type TradeAsset,
} from './trade';
import {
  playerValueDetailed, pickValue, parseGmProfile, teamNeeds, leagueScarcity,
  rosterFit, philosophySummary, type RosterPlayer,
} from './ai/gm';
import { draftOrderContext, type DraftOrderContext } from './draft';
import { teamCapSummary } from './cap-summary';
import type { TradeAssetSnapshot } from './tradeRetro';

/**
 * ===========================================================================
 * THE LEAGUE TRADES WITHOUT YOU
 * ===========================================================================
 * Until this module the league re-signed, signed, cut and drafted on its own
 * and never traded: 25 TRADE rows across 272 leagues, about one deal per nine
 * leagues ever. Every other market in the game ran whether the player was
 * watching or not; the trade market only existed while he had the screen open.
 * So there was no trade market — there was a trade screen.
 *
 * What this buys is the thing the standings, the cap sheets, the draft board
 * and a man's own career page all sit downstream of: a contender that got
 * stronger in week 9 without asking, a rebuild that turned a 31-year-old into
 * two picks, a target that is gone by the time you go looking for him.
 *
 * ---------------------------------------------------------------------------
 * ONE VALUATION MODEL. THIS FILE DOES NOT CONTAIN ONE.
 * ---------------------------------------------------------------------------
 * Read this before adding anything to `shortlist` below.
 *
 * Every accept/reject decision here is made by `evaluateTrade` in lib/trade.ts
 * — the same function, with the same arguments, that the player's own Propose
 * button calls. There is no cheaper "is this fair for an AI" test anywhere in
 * this module, and there must never be one. This codebase has already shipped
 * that bug once: lib/negotiation.ts had a four-line `apy >= 0.9 * market`
 * check in one file and a real model in another, the two disagreed, and the
 * product had no negotiation in it at all.
 *
 * WHAT THIS FILE DOES CONTAIN IS A SEARCH HEURISTIC, WHICH IS A DIFFERENT
 * THING. Something has to decide WHICH deals are worth putting in front of the
 * adjudicator, because asking it about every pair of clubs and every asset is
 * 496 pairs times a roster, and one call measures 30.8ms. So `shortlist` picks
 * plausible pairs and assembles a plausible package — a club that wants to
 * sell, a club that wants to buy, a man one has and the other needs, and
 * enough picks to plausibly cover it. It is allowed to be wrong. When it is
 * wrong the adjudicator says no and the tick moves on; it is never allowed to
 * say YES on its own. A candidate generator that gets it wrong is slow. A
 * second acceptance model that gets it wrong is a lie.
 *
 * The distinction, in one line: nothing in this file may decide a trade is
 * good enough. It may only decide a trade is worth asking about.
 *
 * ---------------------------------------------------------------------------
 * AND NOTHING HERE SKIPS A RULE THE PLAYER IS HELD TO
 * ---------------------------------------------------------------------------
 * Deals are written by `executeTrade` with `force` unset, so `assertCapRoom`
 * gates both clubs, the roster limit holds, signing-bonus proration
 * accelerates onto the club giving a man up, `capChargeYear` dates the charge,
 * picks genuinely change owner and the depth charts on both sides are
 * reconciled. The trade deadline closes this market on exactly the week it
 * closes the player's.
 * ===========================================================================
 */

const M = AI.MARKET;

/**
 * The least a man may be worth and still be worth a trade — the value of the
 * LAST pick of MIN_ASSET_ROUND, read off the chart rather than written down, so
 * it stays true if the league ever changes size. See AI.MARKET.MIN_ASSET_ROUND.
 */
const MIN_ASSET_VALUE = PICK_VALUE_CHART(M.MIN_ASSET_ROUND * LEAGUE.TEAM_COUNT);

export type MarketWindow = 'REGULAR' | 'FREE_AGENCY' | 'DRAFT';

export interface MarketResult {
  executed: number;
  /** The wire sentence for each deal written, strongest first — for the advance summary. */
  headlines: string[];
  /** How much of the per-tick adjudication budget was spent. Reported, never guessed. */
  evalCalls: number;
  /**
   * WHY THE TICK DID NOT DO MORE. Carried because a market that quietly
   * produces nothing is indistinguishable from a market that is switched off,
   * and the difference matters when tuning: a shortlist that never finds a
   * pairing is a different defect from one whose packages the buyer always
   * refuses. Counts only — no verdict is stored, and nothing reads these to
   * decide anything.
   */
  diagnostics: {
    candidates: number;
    refusedBySeller: number;
    refusedByBuyer: number;
    refusedByBoth: number;
    capOrRosterBlocked: number;
  };
}

const NOTHING: MarketResult = {
  executed: 0, headlines: [], evalCalls: 0,
  diagnostics: { candidates: 0, refusedBySeller: 0, refusedByBuyer: 0, refusedByBoth: 0, capOrRosterBlocked: 0 },
};

/**
 * THE WEEKLY SHARE, AS A FUNCTION AND NOT A TABLE, so a probe can print the
 * intended histogram and hold the measured one against it. A hand-written
 * table of weekly counts would be a second statement of the same policy, and
 * the two would drift the first time the deadline week moved — it is a league
 * setting, not a constant.
 */
export function expectedDealsThisWeek(week: number, deadlineWeek: number): number {
  if (week < 1 || week > deadlineWeek) return 0;
  const w = (x: number) => Math.exp((x - deadlineWeek) / M.DEADLINE_TIGHTNESS);
  let total = 0;
  for (let x = 1; x <= deadlineWeek; x++) total += w(x);
  return M.SEASON_TARGET * (w(week) / total);
}

/** Expected -> a whole number of deals, with the fraction taken as a probability. */
function integerise(expected: number, rng: Rng): number {
  const whole = Math.floor(expected);
  return whole + (rng.next() < expected - whole ? 1 : 0);
}

// ---------------------------------------------------------------------------
// The league, read once
// ---------------------------------------------------------------------------

interface Club {
  id: string;
  abbr: string;
  city: string;
  profile: ReturnType<typeof parseGmProfile>;
  window: 'Rebuilding' | 'Retooling' | 'Win-Now Contender';
  roster: RosterPlayer[];
  needs: Record<string, number>;
  picks: { id: string; year: number; round: number; slot: number; originalTeamId: string }[];
  /** The roster again, with contracts — what pricing a man actually needs. */
  priceable: (RosterPlayer & { contract: { yearsRemaining: number } | null })[];
}

interface MarketContext {
  leagueId: string;
  seasonYear: number;
  week: number;
  capMode: CapMode;
  scarcity: Record<string, number>;
  draft: DraftOrderContext;
  clubs: Club[];
  /**
   * Cap space, read ON DEMAND and remembered for the tick.
   *
   * This was 32 `teamCapSummary` calls fired concurrently at the top of every
   * tick, one per club, and each of them re-reads the league and every
   * contract on it. On a box already serving other work it exhausted the
   * connection pool outright ("too many clients"), and it was doing that to
   * price clubs the tick was never going to look at. A tick considers a
   * handful of pairings, so it needs a handful of books.
   */
  capSpaceByClub: Map<string, number | undefined>;
  /** Guard-rail state, read from the record of what has already happened. */
  tradedThisYear: Set<string>;
  dealsByClub: Map<string, number>;
  recentPair: Set<string>;
  eliteMoves: number;
}

const pairKey = (a: string, b: string) => [a, b].sort().join('|');

async function loadContext(leagueId: string, seasonYear: number, week: number, settings: LeagueSettings): Promise<MarketContext | null> {
  const teams = await prisma.team.findMany({
    where: { leagueId, isUser: false },
    select: { id: true, abbr: true, city: true, gmProfile: true },
    orderBy: { id: 'asc' },
  });
  if (teams.length < 2) return null;

  const capMode = settings.capMode;
  const [allPlayers, rosterRows, pickRows, draft, history] = await Promise.all([
    prisma.player.findMany({ where: { leagueId, status: 'ACTIVE' }, select: { position: true, trueOvr: true } }),
    // WITH CONTRACTS, ONCE. This used to be re-queried inside the shortlist
    // for whichever club had just been drawn, which is one round trip per
    // attempt — seventeen of them on a deadline tick, for data that does not
    // change while the tick runs.
    prisma.player.findMany({
      where: { leagueId, status: 'ACTIVE', teamId: { in: teams.map((t) => t.id) } },
      select: { id: true, teamId: true, position: true, trueOvr: true, age: true, potential: true, contract: true },
      orderBy: { id: 'asc' },
    }),
    prisma.draftPick.findMany({
      where: { leagueId, used: false, ownerTeamId: { in: teams.map((t) => t.id) } },
      select: { id: true, ownerTeamId: true, year: true, round: true, slot: true, originalTeamId: true },
      orderBy: { id: 'asc' },
    }),
    draftOrderContext(leagueId),
    // Everything the guard rails need is already on the record of what this
    // league has actually done — no new column, no counter to keep in step.
    prisma.tradeRecord.findMany({ where: { leagueId, seasonYear }, orderBy: { createdAt: 'asc' } }),
  ]);

  const byTeam = new Map<string, Club['priceable']>();
  for (const r of rosterRows) {
    if (!r.teamId) continue;
    const list = byTeam.get(r.teamId) ?? [];
    list.push(r as unknown as Club['priceable'][number]);
    byTeam.set(r.teamId, list);
  }
  const picksByTeam = new Map<string, Club['picks']>();
  for (const p of pickRows) {
    const list = picksByTeam.get(p.ownerTeamId) ?? [];
    list.push({ id: p.id, year: p.year, round: p.round, slot: p.slot, originalTeamId: p.originalTeamId });
    picksByTeam.set(p.ownerTeamId, list);
  }

  const clubs: Club[] = teams.map((t) => {
    const roster = byTeam.get(t.id) ?? [];
    const profile = parseGmProfile(t.gmProfile, new Rng(`gm-${t.id}-${seasonYear}`));
    return {
      id: t.id, abbr: t.abbr, city: t.city, profile,
      // The SAME thresholds the trade screen prints beside this club's name.
      // Deriving a second idea of "who is rebuilding" here would let the
      // market treat a club as a seller while the screen calls it Retooling.
      window: philosophySummary(profile).windowLabel,
      roster,
      needs: teamNeeds(roster),
      picks: picksByTeam.get(t.id) ?? [],
      priceable: roster,
    };
  });

  const tradedThisYear = new Set<string>();
  const dealsByClub = new Map<string, number>();
  const recentPair = new Set<string>();
  let eliteMoves = 0;
  for (const rec of history) {
    dealsByClub.set(rec.teamAId, (dealsByClub.get(rec.teamAId) ?? 0) + 1);
    dealsByClub.set(rec.teamBId, (dealsByClub.get(rec.teamBId) ?? 0) + 1);
    if (week - rec.week < M.PAIR_COOLDOWN_WEEKS) recentPair.add(pairKey(rec.teamAId, rec.teamBId));
    for (const side of [readJson<TradeAssetSnapshot[]>(rec.aToB, []), readJson<TradeAssetSnapshot[]>(rec.bToA, [])]) {
      for (const a of side) {
        if (a.type !== 'PLAYER') continue;
        tradedThisYear.add(a.id);
        if ((a.ovr ?? 0) >= M.ELITE_OVR) eliteMoves++;
      }
    }
  }

  return {
    leagueId, seasonYear, week, capMode,
    scarcity: leagueScarcity(allPlayers),
    draft, clubs, capSpaceByClub: new Map(), tradedThisYear, dealsByClub, recentPair, eliteMoves,
  };
}

// ---------------------------------------------------------------------------
// Pricing, in memory — the SHORTLIST's arithmetic, never a verdict
// ---------------------------------------------------------------------------

/** One club's books, fetched at most once per tick. See MarketContext.capSpaceByClub. */
async function capSpaceFor(club: Club, ctx: MarketContext): Promise<number | undefined> {
  if (ctx.capMode === 'OFF') return undefined;
  if (ctx.capSpaceByClub.has(club.id)) return ctx.capSpaceByClub.get(club.id);
  const space = await teamCapSummary(club.id, ctx.seasonYear, ctx.capMode)
    .then((c) => c.capSpace)
    .catch(() => undefined);
  ctx.capSpaceByClub.set(club.id, space);
  return space;
}

/** What this club thinks a man on its own roster is worth, before any spread. */
function priceFor(club: Club, p: RosterPlayer & { contract?: unknown }, ctx: MarketContext, capSpace: number | undefined): number {
  return playerValueDetailed(p, {
    profile: club.profile,
    needs: club.needs,
    rng: new Rng(`trade-${club.id}-${ctx.seasonYear}-PLAYER:${p.id}`),
    capMode: ctx.capMode,
    scarcity: ctx.scarcity,
    roster: club.roster,
    capSpace,
  }).total;
}

function priceOfPick(club: Club, pick: Club['picks'][number], ctx: MarketContext): number {
  return pickValue(pick.round, effectiveSlot(pick, ctx.draft), club.profile, pick.year, ctx.seasonYear, ctx.draft.imminentYear);
}

/**
 * The pile discount the adjudicator will apply, reused rather than re-guessed.
 * See TRADE_VALUE.PACKAGE.CONCENTRATION — the shortlist has to know that four
 * picks are worth less than the sum of four picks, or it under-offers on every
 * multi-piece package and the tick spends its whole budget on refusals.
 */
function pileValue(values: number[]): number {
  return [...values].sort((a, b) => b - a)
    .reduce((sum, v, i) => sum + v * (TRADE_VALUE.PACKAGE.CONCENTRATION[i] ?? TRADE_VALUE.PACKAGE.CONCENTRATION_TAIL), 0);
}

// ---------------------------------------------------------------------------
// The shortlist
// ---------------------------------------------------------------------------

interface Candidate {
  seller: Club;
  buyer: Club;
  /** What the seller sends. */
  out: TradeAsset[];
  /** What the buyer sends back. */
  back: TradeAsset[];
  /** Picks the buyer still holds, best first, for one sweetener if the seller is close. */
  spare: { id: string; value: number }[];
  headlineOvr: number;
}

function eligibleSeller(c: Club, ctx: MarketContext): boolean {
  return (ctx.dealsByClub.get(c.id) ?? 0) < M.CLUB_SEASON_CAP;
}

/**
 * Who is shopping and who is buying. Driven by the club's competitive window
 * rather than filtered by it afterwards: a REBUILDING club with an ageing man
 * on an expiring deal and a WIN-NOW club with a hole at his position is the
 * shape this market exists to produce, so it is the shape the generator starts
 * from. Retooling clubs play both sides, less often.
 */
function sellerWeight(c: Club): number {
  return c.window === 'Rebuilding' ? 3 : c.window === 'Retooling' ? 1 : 0.25;
}
function buyerWeight(c: Club): number {
  return c.window === 'Win-Now Contender' ? 3 : c.window === 'Retooling' ? 1 : 0.25;
}

function weightedPick<T>(items: T[], weight: (t: T) => number, rng: Rng): T | null {
  const total = items.reduce((s, t) => s + weight(t), 0);
  if (total <= 0) return null;
  let r = rng.next() * total;
  for (const t of items) { r -= weight(t); if (r <= 0) return t; }
  return items[items.length - 1] ?? null;
}

/**
 * Build one deal worth asking about. Returns null when this pairing has
 * nothing to talk about, which is the common case and is cheap.
 */
async function shortlist(ctx: MarketContext, rng: Rng, window: MarketWindow): Promise<Candidate | null> {
  const sellers = ctx.clubs.filter((c) => eligibleSeller(c, ctx));
  const seller = weightedPick(sellers, sellerWeight, rng);
  if (!seller) return null;
  const buyers = ctx.clubs.filter((c) =>
    c.id !== seller.id
    && eligibleSeller(c, ctx)
    && !ctx.recentPair.has(pairKey(seller.id, c.id)));
  const buyer = weightedPick(buyers, buyerWeight, rng);
  if (!buyer) return null;

  if (window === 'DRAFT') return pickSwap(seller, buyer, ctx, rng);

  // Only now, with a pairing actually in hand, are these two clubs' books
  // worth reading — and only once each per tick.
  const sellerCap = await capSpaceFor(seller, ctx);

  // Which of the seller's men the buyer would actually want.
  const contracts = seller.priceable;
  const countAtPosition = new Map<string, number>();
  for (const p of seller.roster) countAtPosition.set(p.position, (countAtPosition.get(p.position) ?? 0) + 1);

  const scored = contracts
    .filter((p) => !ctx.tradedThisYear.has(p.id))
    .filter((p) => (countAtPosition.get(p.position) ?? 0) > M.MIN_KEPT_AT_POSITION)
    .filter((p) => p.trueOvr < M.ELITE_OVR || ctx.eliteMoves < M.ELITE_MOVES_PER_SEASON)
    .map((p) => {
      const fit = rosterFit(p as unknown as RosterPlayer, buyer.roster);
      const need = buyer.needs[p.position] ?? 0;
      // Wanting him is the buyer's business; being willing to lose him is the
      // seller's. Both have to be true or there is no conversation.
      const wanted = Math.max(need, fit.score);
      const expiringVeteran = p.age >= M.VETERAN_MIN_AGE && (p.contract?.yearsRemaining ?? 9) <= M.VETERAN_MAX_YEARS_LEFT;
      const sellerLean = seller.window === 'Rebuilding' ? (expiringVeteran ? 2.5 : 1) : expiringVeteran ? 1.2 : 0.5;
      return { p, score: wanted * sellerLean * (fit.starts ? 1.4 : 1) };
    })
    .filter((c) => c.score > 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  if (scored.length === 0) return null;

  const man = weightedPick(scored, (c) => c.score, rng)?.p;
  if (!man) return null;
  const sellerPrice = priceFor(seller, man as unknown as RosterPlayer, ctx, sellerCap);
  // Not everybody on a roster is a trade. See MIN_ASSET_ROUND.
  if (sellerPrice < MIN_ASSET_VALUE) return null;

  // What the seller will want for him, in the seller's own currency, before
  // the adjudicator is asked. Deliberately the seller's number: he is the one
  // who has to be talked into it.
  const ask = sellerPrice * (1 + TRADE_VALUE.SPREAD.POACH_PREMIUM.NORMAL) * AI.TRADE_ACCEPT_RATIO;
  if (ask <= 0) return null;

  // The CHEAPEST pile of the buyer's picks that covers it, priced the way the
  // SELLER prices picks — a rebuilder pays over the chart for paper, and that
  // gap between two clubs' readings of the same pick is exactly why a deal can
  // clear in both directions at once.
  //
  // SMALLEST FIRST, AND THIS IS NOT A DETAIL. Accumulating the buyer's BEST
  // picks until the seller is satisfied overshoots by most of a round-one pick
  // on any ordinary player — the first asset offered is a first-rounder — and
  // the buyer then refuses a deal he was never being asked a fair price for.
  // Measured on the first pass, that ordering cleared 3 deals in 68 candidates
  // and every one of them was a 95-overall; the middle of the market, which is
  // where a trade market actually lives, produced nothing at all.
  const priced = buyer.picks
    .map((pk) => ({ id: pk.id, value: priceOfPick(seller, pk, ctx) }))
    .sort((a, b) => a.value - b.value);
  const chosen: { id: string; value: number }[] = [];
  for (let i = priced.length - 1; i >= 0; i--) {
    // Walk up from the cheapest pick that could matter: take the largest
    // single pick still under the outstanding ask, then fill the remainder the
    // same way. That lands on "a second and a fourth" where the descending
    // walk landed on "a first".
    const outstanding = ask - pileValue(chosen.map((c) => c.value));
    if (outstanding <= 0) break;
    const remaining = priced.filter((pk) => !chosen.some((c) => c.id === pk.id));
    const fit = remaining.filter((pk) => pk.value <= outstanding).pop() ?? remaining[0];
    if (!fit) break;
    // A piece too small to matter is not a piece. Without this the filler
    // closed a forty-point gap with three seventh-rounders and the wire read
    // like a bag of receipts.
    if (chosen.length > 0 && fit.value < ask * M.MIN_PIECE_SHARE) break;
    chosen.push(fit);
    if (chosen.length >= M.MAX_PACKAGE_PICKS) break;
  }
  if (chosen.length === 0) return null;
  // If everything the buyer owns still does not reach the ask, there is no
  // deal here — offering him anyway spends two adjudications on a certain no.
  if (pileValue(chosen.map((c) => c.value)) < ask * 0.75) return null;

  return {
    seller, buyer,
    out: [{ type: 'PLAYER', id: man.id }],
    back: chosen.map((c) => ({ type: 'PICK' as const, id: c.id })),
    spare: priced.filter((p) => !chosen.some((c) => c.id === p.id)).sort((a, b) => a.value - b.value),
    headlineOvr: man.trueOvr,
  };
}

/**
 * Draft day: a club moves up. Pure pick-for-pick, which is most of the real
 * volume on that weekend and the cheapest thing in this file to price.
 *
 * It clears both ways for a reason that is already in the model rather than
 * invented here: `pickValue` discounts a future draft by the club's own window
 * (SPREAD.FUTURE_DISCOUNT_*), so a contender genuinely values this year's
 * selection above a rebuilder's reading of it and a rebuilder genuinely values
 * next year's above the contender's. Trading across that gap makes both books
 * better, which is why "this year's second for next year's first" is a routine
 * trade in the sport and needed no special case here.
 */
function pickSwap(a: Club, b: Club, ctx: MarketContext, rng: Rng): Candidate | null {
  const imminent = ctx.draft.imminentYear;
  if (imminent === null) return null;
  const nowPicks = a.picks.filter((p) => p.year === imminent);
  const futurePicks = b.picks.filter((p) => p.year > imminent);
  if (nowPicks.length === 0 || futurePicks.length === 0) return null;

  const up = weightedPick(nowPicks, (p) => 1 / p.round, rng);
  if (!up) return null;
  const askB = priceOfPick(b, up, ctx) * AI.TRADE_ACCEPT_RATIO;
  const priced = futurePicks.map((p) => ({ id: p.id, value: priceOfPick(b, p, ctx) })).sort((x, y) => y.value - x.value);
  const chosen: { id: string; value: number }[] = [];
  for (const pk of priced) {
    if (pileValue(chosen.map((c) => c.value)) >= askB) break;
    if (chosen.length > 0 && pk.value < askB * M.MIN_PIECE_SHARE) break;
    chosen.push(pk);
    if (chosen.length >= M.MAX_PACKAGE_PICKS) break;
  }
  if (chosen.length === 0) return null;
  return {
    seller: a, buyer: b,
    out: [{ type: 'PICK', id: up.id }],
    back: chosen.map((c) => ({ type: 'PICK' as const, id: c.id })),
    spare: priced.filter((p) => !chosen.some((c) => c.id === p.id)),
    headlineOvr: 0,
  };
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

export async function runAiTradeMarket(opts: {
  leagueId: string;
  seasonYear: number;
  week: number;
  window: MarketWindow;
  settings: LeagueSettings;
  rng: Rng;
}): Promise<MarketResult> {
  const { leagueId, seasonYear, week, window, settings, rng } = opts;
  if (!settings.tradesEnabled) return NOTHING;
  // The market closes on exactly the week it closes for the player. One rule,
  // one function, asked the same way lib/season.ts asks it.
  if (window === 'REGULAR' && settings.tradeDeadlineEnabled
    && isTradeDeadlinePassed('REGULAR', week, settings.tradeDeadlineWeek)) return NOTHING;

  const wanted = integerise(
    window === 'REGULAR' ? expectedDealsThisWeek(week, settings.tradeDeadlineWeek)
      : window === 'FREE_AGENCY' ? M.OFFSEASON_TARGET
        : M.DRAFT_TARGET,
    rng,
  );
  if (wanted <= 0) return NOTHING;

  const ctx = await loadContext(leagueId, seasonYear, week, settings);
  if (!ctx) return NOTHING;

  const headlines: string[] = [];
  const diagnostics = { candidates: 0, refusedBySeller: 0, refusedByBuyer: 0, refusedByBoth: 0, capOrRosterBlocked: 0 };
  let executed = 0;
  let evalCalls = 0;
  const maxAttempts = wanted * M.ATTEMPTS_PER_DEAL;

  for (let attempt = 0; attempt < maxAttempts && executed < wanted; attempt++) {
    if (evalCalls + 2 > M.MAX_EVAL_CALLS_PER_TICK) break;
    const cand = await shortlist(ctx, rng, window);
    if (!cand) continue;
    diagnostics.candidates++;

    let back = cand.back;
    let verdict: { ok: boolean } | null = null;

    for (let round = 0; round <= M.SWEETENER_TRIES; round++) {
      if (evalCalls + 2 > M.MAX_EVAL_CALLS_PER_TICK) break;
      /*
       * BOTH SIDES, AND THE SAME FUNCTION BOTH TIMES.
       *
       * `evaluateTrade` answers for ONE club — the `aiTeamId` it is handed —
       * so a single call can only ever say that one of these two is not being
       * robbed. Between two AI clubs that is not enough: nobody here is
       * choosing to be generous, so a deal that clears for the seller and
       * merely does not offend the buyer is a gift the buyer never agreed to
       * make. Two calls, one from each side, and both must clear.
       *
       * `give` is what flows TO the club being asked, `get` is what flows
       * FROM it — see the header on evaluateTrade. The seller receives the
       * picks and sends the man; the buyer is the mirror of that.
       */
      const sellerSide = await evaluateTrade({
        aiTeamId: cand.seller.id, give: back, get: cand.out,
        currentYear: seasonYear, settings: { aiAcceptsLopsided: false },
      });
      const buyerSide = await evaluateTrade({
        aiTeamId: cand.buyer.id, give: cand.out, get: back,
        currentYear: seasonYear, settings: { aiAcceptsLopsided: false },
      });
      evalCalls += 2;

      if (sellerSide.accepted && buyerSide.accepted) { verdict = { ok: true }; break; }
      if (!sellerSide.accepted && !buyerSide.accepted) diagnostics.refusedByBoth++;
      else if (!sellerSide.accepted) diagnostics.refusedBySeller++;
      else diagnostics.refusedByBuyer++;
      // One phone call. If the seller is short but inside his own counter
      // window, add the next pick and ask once more — and only if the buyer
      // was not the side saying no, because sweetening a deal the buyer
      // already thinks is too rich makes it worse.
      const sellerClose = !sellerSide.accepted
        && sellerSide.ratio >= sellerSide.requiredRatio - AI.TRADE_COUNTER_WINDOW;
      if (!sellerClose || !buyerSide.accepted || cand.spare.length === 0) break;
      const sweetener = cand.spare.shift()!;
      back = [...back, { type: 'PICK', id: sweetener.id }];
    }

    if (!verdict?.ok) continue;

    let wire: { headline: string } | null = null;
    try {
      wire = await executeTrade({
        leagueId, teamA: cand.seller.id, teamB: cand.buyer.id,
        aToB: cand.out, bToA: back, seasonYear, week,
      });
    } catch (e) {
      // A club that cannot fit the deal on its cap, or is at its roster limit,
      // is refused here exactly as the player would be — no force, no retry.
      if (e instanceof TradeAssetError) { diagnostics.capOrRosterBlocked++; continue; }
      throw e;
    }

    executed++;
    // Guard-rail state moves with the league, in memory, so two deals in one
    // tick cannot both spend the same allowance.
    ctx.dealsByClub.set(cand.seller.id, (ctx.dealsByClub.get(cand.seller.id) ?? 0) + 1);
    ctx.dealsByClub.set(cand.buyer.id, (ctx.dealsByClub.get(cand.buyer.id) ?? 0) + 1);
    ctx.recentPair.add(pairKey(cand.seller.id, cand.buyer.id));
    for (const a of cand.out) if (a.type === 'PLAYER') ctx.tradedThisYear.add(a.id);
    if (cand.headlineOvr >= M.ELITE_OVR) ctx.eliteMoves++;
    /*
     * AND THE LEAGUE THIS PASS IS HOLDING IN MEMORY MOVED TOO. `ctx` was read
     * once at the top of the tick; without this, a second deal in the same
     * tick can be built from a pick that has already changed owner or a man
     * who has already been traded. executeTrade would refuse it — ownership is
     * claimed there, which is why this is a waste rather than a corruption —
     * but it spends two adjudications on a certain no and reports the refusal
     * as a cap block, which is a lie about why.
     */
    const movedPicks = new Set(back.filter((a) => a.type === 'PICK').map((a) => a.id));
    const movedMen = new Set(cand.out.filter((a) => a.type === 'PLAYER').map((a) => a.id));
    const movedOutPicks = new Set(cand.out.filter((a) => a.type === 'PICK').map((a) => a.id));
    for (const club of ctx.clubs) {
      club.picks = club.picks.filter((p) => !movedPicks.has(p.id) && !movedOutPicks.has(p.id));
      club.roster = club.roster.filter((p) => !movedMen.has(p.id));
    }

    if (wire) headlines.push(wire.headline);
  }

  return { executed, headlines, evalCalls, diagnostics };
}
