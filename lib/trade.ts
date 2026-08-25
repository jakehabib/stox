import type { Player, Contract, DraftPick } from '@prisma/client';
import { prisma } from './db';
import { Rng } from './rng';
import { AI, LEAGUE, TRADE_VALUE, PICK_VALUE_CHART } from './tuning';
import { parseSettings } from './settings';
import { parseGmProfile, playerValueDetailed, pickValue, teamNeeds, rosterFit, philosophySummary, leagueScarcity, RosterPlayer } from './ai/gm';
import { draftOrderContext, type DraftOrderContext } from './draft';
import { CapMode } from './types';
import { recordTrade, type TradeAssetSnapshot } from './tradeRetro';
import { unamortizedBonus, formatMoney, capChargeYear } from './cap';
import { teamCapSummary } from './cap-summary';
import { reconcileDepthChart } from './gen/league';
import { assertCapRoom, tradeCapDeltas, autoTrimRosterToLimit } from './capEnforcement';
import { describeValue } from './tradeWords';

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

/**
 * Real NFL trades run all the way through the regular season up to a fixed
 * week (the Tuesday after week 9 in the current CBA), then freeze until the
 * new league year opens back up around free agency. Mapped onto this game's
 * phase machine: closed for the rest of REGULAR once you're past the
 * deadline week, and for PLAYOFFS/OFFSEASON/RESIGN (still the same league
 * year) — reopening the moment FREE_AGENCY starts, since that's this game's
 * equivalent of the new league year beginning.
 */
export function isTradeDeadlinePassed(phase: string, week: number, deadlineWeek: number): boolean {
  if (phase === 'REGULAR') return week > deadlineWeek;
  return phase === 'PLAYOFFS' || phase === 'OFFSEASON' || phase === 'RESIGN';
}

export interface TradeEvaluation {
  accepted: boolean;
  sendValue: number;
  receiveValue: number;
  ratio: number;
  /** The ratio the offer needed to clear to be accepted — lets the UI render a score bar, not just accept/reject text. */
  requiredRatio: number;
  /**
   * Value still needed to clear the club's bar, in the same points as
   * `sendValue`/`receiveValue`. 0 once the offer clears.
   *
   * IT LIVES HERE BECAUSE THE BAR MOVED. Callers used to re-derive it as
   * `sendValue * requiredRatio - receiveValue`, which is only the bar when the
   * club is actually giving something up — with nothing (or nothing but
   * burdens) going out the bar is the plain net, and a second copy of the rule
   * would have had Trade Intel quoting a figure the verdict was not using.
   */
  shortfall: number;
  counter?: { message: string };
  /** Why the AI valued things this way — the strongest 1-3 notes across all assets on each side. */
  explanation: { give: string[]; receive: string[] };
  philosophy: ReturnType<typeof philosophySummary>;
  /**
   * Set when the AI's own cap sheet cannot take the deal on, whatever the
   * value. Present so the UI can style a cap refusal differently from a value
   * refusal — `counter.message` already states it in words either way.
   */
  capBlock?: { shortfall: number; added: number; available: number };
}

/**
 * How much of a club's projected finish survives each further year into the
 * future. [TUNE] 0.65: a club two drafts out keeps about two thirds of the
 * gap between where it is projected to pick and the middle of the round, one
 * three drafts out about four ninths, and so on toward the middle.
 *
 * SIZED SO THAT A FURTHER-OUT PICK IS NEVER WORTH MORE THAN A NEARER ONE
 * FROM THE SAME CLUB, which the old "everything past the next draft is a
 * mid-rounder" rule got badly wrong. Measured on the probe save before this
 * change: Jacksonville's first in the next draft priced at 495 and its first
 * the year after at 713 — the further-away pick was worth 44% MORE, because
 * a club projected to pick 32nd had its future firsts revalued as if it
 * picked 16th, and the 15%-per-year time discount could not cover a 1.6x jump
 * in slot. Atlanta's was 693 against 950, San Diego's 570 against 808. That
 * inversion is the mechanism behind the app owner's screenshot: a future
 * first from a good club was being charged for as a mid-first.
 *
 * Full regression to the middle is not the honest answer either. Clubs
 * regress, but not instantly and not completely, and a front office plainly
 * does not treat a contender's future first the way it treats a bad club's.
 * At 0.65 the worst residual inversion across the league is under 1%, inside
 * the valuation noise, and the ordering everywhere else is strict.
 */
const FUTURE_SLOT_REGRESSION = 0.65;

/**
 * WHAT SELECTION THE AI IS ACTUALLY BUYING — the in-round slot pickValue
 * prices off, which is the same number the screen shows the GM.
 *
 * THE SEEDED ORDER WINS OVER EVERY PROJECTION. Once reseedDraftOrder has run
 * for that year (see seededDraftYear), DraftPick.slot is the running order the
 * room is being conducted by, per round. Pricing a projection against it was
 * not merely stale but backwards: during a live draft RESET_STANDINGS has
 * already wiped the live rows, so the projection collapsed to database row
 * order and the club holding the 32nd selection was charged for the 1st —
 * a Jimmy Johnson gap of 3000 points against 590 on the exact same pick the
 * board was calling #32.
 *
 * Before the reseed the stored slot is only the placeholder assigned at
 * generation time, unrelated to performance, so the projection is the honest
 * read: a 0-5 club's first prices like a first. Every year after the next one,
 * that same projection regresses toward the middle of the round — see
 * FUTURE_SLOT_REGRESSION — because a club's standing decays toward average as
 * you look further out, but does not get there in one season.
 *
 * A NOTE ON WHY THIS IS NOT pickNumbers(). The screen refuses to print a
 * number it cannot source, so in the gap between a draft ending and the next
 * kickoff — where the imminent draft has jumped a year ahead of the last
 * season on file — a chip shows nothing. A valuation cannot refuse: every
 * asset in a proposal has to have a price. So where the screen goes quiet this
 * still leans on the most recent finish, which is a stale read of a club but a
 * far better one than the generation-time placeholder it would otherwise use.
 * The two agree exactly wherever a number is shown at all.
 *
 * "The next draft" is deliberately identified by `imminentYear` (the
 * smallest year with any unused pick), not by comparing `pick.year` to
 * `currentYear` directly — DraftPick.year for the upcoming draft is
 * pre-generated as `seasonYear + 1` and stays that way for the whole
 * season, but RESET_STANDINGS bumps seasonYear to match it partway through
 * the offseason, before that draft actually runs — so which one is "this
 * season's pick" depends on where in the phase machine the league sits.
 */
export function effectiveSlot(pick: { year: number; slot: number; originalTeamId: string }, draft: DraftOrderContext): number {
  if (draft.seededYear !== null && pick.year === draft.seededYear) return pick.slot;
  const imminentYear = draft.imminentYear;
  if (imminentYear === null) return pick.slot;
  const projected = draft.projection?.order.get(pick.originalTeamId) ?? pick.slot;
  if (pick.year === imminentYear) return projected;
  if (pick.year < imminentYear) return pick.slot;
  const middle = Math.ceil(LEAGUE.TEAM_COUNT / 2);
  const yearsBeyond = pick.year - imminentYear;
  const kept = Math.pow(FUTURE_SLOT_REGRESSION, yearsBeyond);
  return Math.min(LEAGUE.TEAM_COUNT, Math.max(1, Math.round(middle + (projected - middle) * kept)));
}

/**
 * ===========================================================================
 * WHAT A VALUATION NEEDS THAT IS NOT THE ASSET
 * ===========================================================================
 * Who the GM is, what his roster is short of, how scarce the position is
 * league-wide, which draft is next, the bid/ask spread the difficulty sets,
 * the noise seed, and the club's books. Every one of these is a fact about
 * the CLUB and the SEASON, and none of them depends on which assets are on
 * the table — which is why one of these is built per evaluation and shared by
 * every asset on both sides.
 *
 * It is exported so lib/tradeClosers.ts can build it ONCE and hand the same
 * object to every candidate package it tries. That is sound precisely because
 * of the paragraph above: the context a fresh evaluateTrade would construct
 * for the same club in the same season is this object, field for field. If a
 * field is ever added here that varies with the offer, it does not belong in
 * this interface.
 */
export interface TradeContext {
  aiTeamId: string;
  leagueId: string;
  seasonYear: number;
  /** The draft year picks are priced against — evaluateTrade's `currentYear`. */
  currentYear: number;
  settings: ReturnType<typeof parseSettings>;
  capMode: CapMode;
  spread: { poach: number; haircut: number; badContractTax: number };
  noisePrefix: string;
  profile: ReturnType<typeof parseGmProfile>;
  needs: Record<string, number>;
  scarcity: Record<string, number>;
  draft: DraftOrderContext;
  club: { roster: RosterPlayer[]; capSpace?: number };
  /** The club's live room, or null when the league has the cap switched off. */
  capSpace: number | null;
}

/** One asset priced on its own, before any package weighting. See priceAsset. */
export interface PricedAsset {
  label: string;
  /** In the club's own value points, after the bid/ask spread for this side. */
  value: number;
  isPlayer: boolean;
  /** Dollars this contract runs over market, only ever set on the receive side. */
  overMarket: number;
  reasons: { text: string; weight: number }[];
}

/** A row already in hand, so a caller pricing many assets can fetch in bulk. */
export type LoadedAsset =
  | { type: 'PLAYER'; player: Player & { contract: Contract | null } }
  | { type: 'PICK'; pick: DraftPick };

/**
 * ONE ASSET, PRICED THE WAY THIS CLUB PRICES IT.
 *
 * Lifted out of assetValues' loop so that the trade closers (lib/tradeClosers.ts)
 * can narrow a 53-man roster down to the handful of men who could plausibly
 * cover a gap without re-deriving a single line of this. A second copy of the
 * spread rules is exactly how this app has shipped a screen quoting a figure
 * it was not using.
 *
 * `loaded` lets a caller that has already fetched the row in bulk hand it
 * over; without it the row is fetched here, one asset at a time, which is
 * what an ordinary evaluation does.
 */
export async function priceAsset(
  a: TradeAsset,
  ctx: TradeContext,
  side: 'receive' | 'send',
  loaded?: LoadedAsset,
): Promise<PricedAsset> {
  const { profile, needs, capMode, scarcity, club, spread, draft, noisePrefix, currentYear } = ctx;
  if (a.type === 'PLAYER') {
    const p = loaded?.type === 'PLAYER'
      ? loaded.player
      : await prisma.player.findUniqueOrThrow({ where: { id: a.id }, include: { contract: true } });
    const v = playerValueDetailed(p as unknown as RosterPlayer, {
      profile, needs, rng: new Rng(`${noisePrefix}-${a.type}:${a.id}`), capMode, scarcity,
      roster: club.roster, capSpace: club.capSpace,
    });
    const name = `${p.firstName} ${p.lastName}`;
    /*
     * THE SPREAD IS A PRICE FOR A MAN. IT IS NOT A DISCOUNT ON A BILL.
     *
     * `v.total` can now come back NEGATIVE — see the contract block in
     * lib/ai/gm.ts — and multiplying a negative by (1 - haircut) marks the
     * burden DOWN, which is a club handing itself a discount on a debt it is
     * about to be handed. The other direction is just as wrong: a poach
     * premium on a liability would say prising an albatross loose costs
     * MORE than he is worth. So the spread is applied to the talent, and the
     * money owed rides through at face value on both sides.
     */
    const talent = Math.max(0, v.total);
    const owed = Math.min(0, v.total);
    let value = side === 'send'
      ? talent * (1 + spread.poach) + owed
      : talent * (1 - spread.haircut) + owed;
    let overMarket = 0;
    if (side === 'receive') {
      // What the bad contract already cost him, charged again as the price
      // of the favour: the club taking a burden on wants paying for it, and
      // how much depends on the difficulty. Zero on any fair deal.
      //
      // NO FLOOR. This used to end in `Math.max(1, ...)`, which is one of
      // the two floors that made a liability impossible: however toxic the
      // deal, the man came out of here worth at least a point, and a point
      // is a positive asset.
      value -= v.contractBurden * spread.badContractTax;
      overMarket = v.contractOverMarket;
    }
    return {
      label: name, value, isPlayer: true, overMarket,
      reasons: v.reasons.map((r) => ({ text: `${name}: ${r.text}`, weight: r.weight })),
    };
  }
  const pick = loaded?.type === 'PICK'
    ? loaded.pick
    : await prisma.draftPick.findUniqueOrThrow({ where: { id: a.id } });
  return {
    label: `${pick.year} Round ${pick.round}`,
    value: pickValue(pick.round, effectiveSlot(pick, draft), profile, pick.year, currentYear, draft.imminentYear),
    isPlayer: false,
    overMarket: 0,
    reasons: [],
  };
}

/**
 * A whole side of a proposed deal, priced. `side` is which way the pile is
 * travelling, and it decides the club's bid/ask spread — see
 * TRADE_VALUE.SPREAD: prying a man loose costs a premium, handing one over
 * meets a haircut, and picks are exempt from both because a spread on
 * everything is just a stricter acceptance threshold wearing a costume.
 */
async function assetValues(assets: TradeAsset[], ctx: TradeContext, side: 'receive' | 'send'): Promise<AssetSide> {
  const each: { label: string; value: number; isPlayer: boolean }[] = [];
  const weighted: { text: string; weight: number }[] = [];
  let worstDeal: { label: string; overMarket: number } | null = null;
  for (const a of assets) {
    const priced = await priceAsset(a, ctx, side);
    each.push({ label: priced.label, value: priced.value, isPlayer: priced.isPlayer });
    for (const r of priced.reasons) weighted.push(r);
    if (side === 'receive' && priced.overMarket > (worstDeal?.overMarket ?? 0)) {
      worstDeal = { label: priced.label, overMarket: priced.overMarket };
    }
  }
  // Sort ACROSS every asset on this side of the deal, not just within one —
  // otherwise a minor note about asset #1 could outrank the actual dominant
  // factor on asset #2 just by having been evaluated first.
  const reasons = weighted.sort((a, b) => b.weight - a.weight).map((r) => r.text);

  /*
   * A pile is worth less than the sum of its parts — see TRADE_VALUE.PACKAGE.
   *
   * ONLY THE ASSETS ARE WEIGHTED. A liability is not made smaller by standing
   * in a crowd: the weighting exists because a roster fields eleven men and
   * the fifth piece of a package genuinely does less for the club receiving
   * it, and none of that reasoning survives being pointed at a contract. Left
   * on the same footing, an albatross sorted to the back of a five-man pile
   * would have had 45% of its bill weighted away — a fresh way to launder the
   * same exploit, one asset removed.
   */
  const ranked = [...each].sort((a, b) => b.value - a.value);
  const pieces = ranked.filter((a) => a.value > 0);
  const bills = ranked.filter((a) => a.value <= 0);
  const total = pieces.reduce(
    (sum, asset, i) => sum + asset.value * (TRADE_VALUE.PACKAGE.CONCENTRATION[i] ?? TRADE_VALUE.PACKAGE.CONCENTRATION_TAIL),
    0,
  ) + bills.reduce((sum, asset) => sum + asset.value, 0);
  // "First-round quality" is read off the chart itself rather than written
  // down, so it stays true if the league ever changes size.
  const premiumLine = PICK_VALUE_CHART(LEAGUE.TEAM_COUNT);
  return { total, reasons, best: ranked[0] ?? null, premiumCount: ranked.filter((a) => a.value >= premiumLine).length, worstDeal };
}

/** One side of a proposed trade, priced. See assetValues and TRADE_VALUE.PACKAGE. */
interface AssetSide {
  /** What the pile is worth AFTER the concentration weighting — the number the verdict uses. */
  total: number;
  reasons: string[];
  /** The single most valuable asset on this side, which is what the headline rule tests. */
  best: { label: string; value: number; isPlayer: boolean } | null;
  /** How many assets here are worth a first-round pick or more — the headline rule's second clause. */
  premiumCount: number;
  /**
   * The single worst contract coming AT the club and what it is over market
   * by, in dollars — what the salary-dump refusal names. Only ever set on the
   * pile the AI would be receiving: a burden it is handing away is a saving,
   * not a bill it can be charged for.
   */
  worstDeal: { label: string; overMarket: number } | null;
}

/**
 * THE HEADLINE RULE: a cornerstone may not be bought with depth.
 *
 * Returns the refusal when the AI is being asked to give up a genuine pillar
 * and nothing coming back is a real piece — see TRADE_VALUE.PACKAGE. This is
 * checked BEFORE the value comparison, because it is not a statement about
 * value: a package can clear the ratio comfortably and still be six backups,
 * and the answer to six backups is not "we need a bit more".
 */
function headlineShortfall(receive: AssetSide, send: AssetSide): { wanted: number; best: number; name: string; isPlayer: boolean } | null {
  const pillar = send.best;
  if (!pillar || pillar.value < TRADE_VALUE.PACKAGE.HEADLINE_THRESHOLD) return null;
  // Either one piece is big enough on its own...
  const wanted = pillar.value * TRADE_VALUE.PACKAGE.HEADLINE_SHARE;
  const best = receive.best?.value ?? 0;
  if (best >= wanted) return null;
  // ...or enough of the package is first-round quality (see premiumCount).
  if (receive.premiumCount >= TRADE_VALUE.PACKAGE.HEADLINE_PREMIUM_COUNT) return null;
  return { wanted, best, name: pillar.label, isPlayer: pillar.isPlayer };
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
/**
 * Build the club-and-season half of a valuation — see TradeContext. Every
 * comment below is about a decision that belongs to the CLUB, which is why
 * none of it takes the offer as an argument.
 */
export async function buildTradeContext(aiTeamId: string, currentYear: number): Promise<TradeContext> {
  const team = await prisma.team.findUniqueOrThrow({ where: { id: aiTeamId } });
  const league = await prisma.league.findUniqueOrThrow({ where: { id: team.leagueId } });
  const settings = parseSettings(league.settings);
  const capMode: CapMode = settings.capMode;

  /**
   * DIFFICULTY IS READ OFF THE LEAGUE, not passed in. Every caller already
   * hands us the league by id and the setting has always lived on it, so
   * threading it through three call sites would only have created a way for
   * one of them to pass the wrong thing. The spread it selects is the one
   * place difficulty touches trades at all — see TRADE_VALUE.SPREAD for why
   * it is a spread and not a stricter acceptance threshold.
   */
  const S = TRADE_VALUE.SPREAD;
  const spread = {
    poach: S.POACH_PREMIUM[settings.difficulty] ?? S.POACH_PREMIUM.NORMAL,
    haircut: S.DUMP_HAIRCUT[settings.difficulty] ?? S.DUMP_HAIRCUT.NORMAL,
    badContractTax: S.BAD_CONTRACT_TAX[settings.difficulty] ?? S.BAD_CONTRACT_TAX.NORMAL,
  };

  /**
   * ==========================================================================
   * THE VERDICT IS A JUDGEMENT, NOT A DRAW
   * ==========================================================================
   * The seed was `trade-${aiTeamId}-${Date.now()}`, so every submission of the
   * SAME offer re-rolled the ~9%-per-asset valuation noise. A user who kept
   * hitting Propose was rolling dice until the variance fell his way, and a
   * borderline "no" was only ever a few clicks from a "yes" — the whole value
   * model defeated by a button. Same bug class as the negotiation panel's,
   * fixed the same way: lib/negotiation.ts seeds its `acceptanceRoll` on the
   * player, the league year and the offer and on nothing else, so re-offering
   * an identical deal gives an identical answer.
   *
   * SEEDED PER ASSET, not per deal. Both kill the re-roll, but the finer grain
   * is strictly better and the difference is measurable. A deal-level
   * fingerprint re-rolls EVERY asset the moment any one of them changes, so
   * adding a seventh-round pick to an offer moved a measured deal from 1.058
   * to 0.951 — the sweetener made the AI want it 10% LESS, because the fresh
   * draw swamped the pick. Seeded per asset, a club's read on a given player
   * is a property of that player (as it should be: it is that club's scouting
   * being imperfect, not its mood), so adding to an offer can only ever add,
   * and negotiating behaves the way the screen implies it does.
   *
   * The three things in the seed are the three that may legitimately change
   * the answer:
   *
   *   the club   — a different front office may read the same player
   *                differently, and does
   *   the year   — a package refused this season can be revisited next
   *                season; a "no" that never expires is its own bug
   *   the asset  — a genuinely different piece is a genuinely different offer
   *
   * What is deliberately NOT in it: the clock, the order the Trade screen's
   * Set happened to iterate in, and the rest of the package.
   * ==========================================================================
   */
  const noisePrefix = `trade-${aiTeamId}-${league.seasonYear}`;

  /**
   * A GM's character belongs to the franchise, not to the proposal in front
   * of him. This used to draw from the shared evaluation rng, which meant a
   * club whose stored profile was missing or partial was handed a brand new
   * personality on every submission — and, even with a complete profile, the
   * four draws it consumed shifted the noise stream underneath the
   * valuations. Seeded per club per season, so a Rebuilding conservative GM
   * is still one on the tenth proposal.
   */
  const profile = parseGmProfile(team.gmProfile, new Rng(`gm-${aiTeamId}-${league.seasonYear}`));

  const [roster, allPlayers, draft, capSummary] = await Promise.all([
    prisma.player.findMany({
      where: { teamId: aiTeamId },
      select: { id: true, position: true, trueOvr: true, age: true, potential: true },
    }),
    // One league-wide fetch reused for scarcity across every asset in this
    // trade, not queried per player — see leagueScarcity()'s cost note.
    prisma.player.findMany({ where: { leagueId: team.leagueId, status: 'ACTIVE' }, select: { position: true, trueOvr: true } }),
    draftOrderContext(team.leagueId),
    capMode === 'OFF' ? Promise.resolve(null) : teamCapSummary(aiTeamId, league.seasonYear, capMode),
  ]);
  const needs = teamNeeds(roster as RosterPlayer[]);
  const scarcity = leagueScarcity(allPlayers);
  // Fetched once and shared by every asset on both sides, like `needs` and
  // `scarcity` — the club's roster and its books are facts about the club,
  // not about the asset being priced.
  const club = { roster: roster as RosterPlayer[], capSpace: capSummary?.capSpace };

  return {
    aiTeamId, leagueId: team.leagueId, seasonYear: league.seasonYear, currentYear,
    settings, capMode, spread, noisePrefix, profile, needs, scarcity, draft, club,
    capSpace: capSummary?.capSpace ?? null,
  };
}

export async function evaluateTrade(opts: {
  aiTeamId: string;
  give: TradeAsset[];
  get: TradeAsset[];
  currentYear: number;
  settings: { aiAcceptsLopsided: boolean };
  /** An already-built context for this club and season — see the note below. */
  ctx?: TradeContext;
}): Promise<TradeEvaluation> {
  /*
   * The context is REUSED when one is handed in, and built when it is not.
   * That is not a shortcut past the evaluation: TradeContext holds only facts
   * about the club and the season (see its own note), so an injected one is
   * identical to the one this line would otherwise construct. It exists so
   * the trade closers can try a dozen candidate packages against the same
   * club without re-reading its roster, its books and the draft order a dozen
   * times — every candidate still goes through this whole function.
   */
  const ctx = opts.ctx ?? await buildTradeContext(opts.aiTeamId, opts.currentYear);
  const { capMode, profile, capSpace } = ctx;

  // opts.give flows TO the AI => that's what the AI receives.
  // opts.get flows FROM the AI => that's what the AI sends away.
  const receive = await assetValues(opts.give, ctx, 'receive');
  const send = await assetValues(opts.get, ctx, 'send');
  const sendValue = send.total;
  const receiveValue = receive.total;
  const philosophy = philosophySummary(profile);
  // "give" reasons describe the assets flowing to the AI (why it wants/
  // discounts them); "receive" reasons describe what the AI would give up.
  const explanation = { give: receive.reasons.slice(0, 3), receive: send.reasons.slice(0, 3) };

  const requiredRatio = opts.settings.aiAcceptsLopsided ? 0.9 : AI.TRADE_ACCEPT_RATIO;

  /**
   * ==========================================================================
   * WHEN THEIR SIDE IS EMPTY THE QUESTION IS NOT A RATIO
   * ==========================================================================
   * This line was `sendValue === 0 ? Infinity : receiveValue / sendValue`, and
   * that Infinity was the worst exploit in the game. A club being asked to
   * give up nothing cleared any threshold ever set, so the pile coming AT it
   * was never priced at all: a 62-overall corner owed $135.4M went to thirty
   * of the league's thirty-one clubs for nothing, and they thanked you for it.
   *
   * A ratio needs a denominator. With nothing going out there isn't one, and
   * the honest question is the plain one — is what we are being handed worth
   * more than nothing? So the bar is stated as a NET: at a positive ask it is
   * the same `sendValue x requiredRatio` it always was, and at a zero or
   * negative ask it is simply `sendValue`, which is the point where the club
   * is no worse off than if it had said no.
   *
   * A NEGATIVE ASK IS NOT A TYPO. `sendValue` can now come out below zero, and
   * it should: a club asked to hand over an albatross is being done a favour,
   * and the deal it will accept for that is correspondingly cheaper. Note the
   * bar is NOT `sendValue x requiredRatio` there — multiplying a negative by
   * 1.04 moves the bar the wrong way and would have the club demanding LESS
   * the more toxic the contract it is shedding.
   *
   * WHAT THIS DELIBERATELY DOES NOT CHANGE is the gift. An offer of a 91
   * receiver for nothing is one the AI genuinely accepts and should — see the
   * note in app/actions/trade.ts, which reasons about exactly this and is
   * right. `receiveValue >= 0` is true of every real asset and false only of a
   * liability, which is the whole distinction the old line could not draw.
   */
  const netBar = sendValue > 0 ? sendValue * requiredRatio : sendValue;
  const clears = receiveValue >= netBar;

  /**
   * `ratio` is the meter's number (see AcceptanceMeter) and every consumer
   * divides it by `requiredRatio` to get "how far to yes", so it has to stay
   * one number with one meaning on every path. Where a ratio exists it is the
   * ratio, unchanged. Where it does not, the gap to the bar is measured
   * against the size of what is actually on the table and mapped onto the same
   * scale, so 100% still means yes and the meter never has to render Infinity,
   * NaN, or a division by a negative.
   *
   * Floored at a cornerstone's worth so that a trivial offer of nothing much
   * for nothing much cannot read as a landslide either way.
   */
  const netScale = Math.max(Math.abs(receiveValue), Math.abs(netBar), TRADE_VALUE.PACKAGE.HEADLINE_THRESHOLD);
  const ratio = sendValue > 0
    ? receiveValue / sendValue
    : requiredRatio * Math.max(0, Math.min(1.5, 1 + (receiveValue - netBar) / netScale));

  /**
   * HOW MUCH MORE, STATED SO THAT DOING IT ACTUALLY CLOSES THE DEAL.
   *
   * There were two of these and they disagreed. The cap-blocked message
   * divided (`requiredRatio / ratio - 1`), which is the real answer; the plain
   * value refusal subtracted (`requiredRatio - ratio`), which is not a
   * percentage of anything. At a ratio of 0.70 against a required 1.04 the
   * subtraction says "34% short" when the offer actually has to grow by 49% —
   * so a user who added exactly what he was told was still refused, and the
   * screen looked like it was moving the goalposts. One derivation, used by
   * both messages.
   *
   * Floored at 1% because every branch that prints this number is a refusal.
   * A gap under half a percent rounded to a flat "we're about 0% short on
   * value" — a club turning down a deal while saying it needs nothing more,
   * which reads as broken rather than close.
   *
   * ONLY MEANINGFUL WITH A POSITIVE ASK. A percentage of what the club is
   * giving up is not a number at all when it is giving up nothing, and the
   * branches that fire on that path say the shortfall in points and dollars
   * instead — the same vocabulary the Insider report already uses.
   */
  const shortPct = Math.max(1, Math.round((requiredRatio / Math.max(ratio, 0.01) - 1) * 100));
  /** What the offer is still missing, in value points. Zero once it clears. */
  const shortfallPoints = Math.max(0, netBar - receiveValue);

  /**
   * A deal the club has no room for is not a deal, however good the value.
   * `assertCapRoom` will refuse to write it at Confirm — so without this the
   * screen said "Deal accepted! Click confirm to execute", and then the
   * Confirm died on the cap. Checking the same numbers here, with the same
   * `tradeCapDeltas` the executor uses, turns a bait-and-switch into a
   * sentence a GM can act on. Only the AI's own side is judged; the user's
   * cap is his own business and is still reported at execution.
   */
  const capBlock = capSpace !== null ? await aiCapShortfall(opts, capSpace, capMode) : null;
  if (capBlock) {
    /*
     * THE TWO ASKS MUST NOT CONTRADICT EACH OTHER.
     *
     * This used to say "take a contract back the other way and we'll talk",
     * and then, when the value was also short, "we'd want about N% more
     * coming back". The app owner spotted that those are opposite
     * instructions: taking a contract back means WE send another player, so
     * it fixes our cap and simultaneously widens the value gap we just asked
     * him to close. Following the advice literally makes the deal worse and
     * demands yet more from him — his words, that it "requires more value
     * from the player".
     *
     * THEN THE FIX FOR THAT WAS ITSELF HALF WRONG. It said picks "do both at
     * once", which is only true of the value half. `added` above is a pure
     * salary number — picks contribute nothing to it (see tradeCapDeltas), so
     * ADDING picks cannot move the cap figure by a cent. Measured: piling on
     * one, two, four, eight and sixteen first-round picks left the same
     * "adds $39.4M against $29.4M of room" sentence on screen every time,
     * because the cap gate returns before value is ever considered. A user
     * following that advice could add the entire draft and never get past it.
     *
     * The move that genuinely satisfies both is to SWAP the salary for picks —
     * take an expensive man off your side, which is the only thing that lowers
     * what lands on our cap, and make the value back up in picks, which cost
     * us nothing. That is one instruction, and it is the one that works.
     */
    /*
     * ...AND THE CAP IS NOT ALWAYS THE ONLY THING WRONG WITH IT. "We like the
     * deal otherwise" is a sentence about a deal the club would take if it had
     * the room, and it is a lie about a salary dump: those fail the cap AND
     * the value, and telling a user to send someone cheaper implies the rest
     * of it is fine. Each of the three cases now gets the instruction that
     * actually applies to it.
     */
    const valueShort = !clears;
    const ask = !valueShort
      ? ` Take a contract back the other way, or send someone cheaper, and we'll talk — we like the deal otherwise.`
      : sendValue > 0
        ? ` The value is short too, by about ${shortPct}%. Adding picks won't move the cap number — only less salary coming at us will. Swap an expensive man for picks and you fix both at once.`
        : ` And the room isn't the only problem — you're asking us to take a contract on and hand nothing back, which we wouldn't do at any cap number.`;
    return {
      accepted: false, sendValue, receiveValue, ratio, requiredRatio, shortfall: shortfallPoints, explanation, philosophy, capBlock,
      counter: {
        message: `We can't fit this on our cap — it adds ${formatMoney(capBlock.added)} against ${formatMoney(capBlock.available)} of room, ${formatMoney(capBlock.shortfall)} more than we have.${ask}`,
      },
    };
  }

  /**
   * The package-quality test explains a refusal. IT NO LONGER CAUSES ONE.
   *
   * It used to sit here as a hard veto, and the app owner caught what that
   * does: a meter reading 102% — over the club's own line — above the words
   * TURNED DOWN. That is the same defect as a green "he will sign this" over
   * a dead button, which this codebase fixed on the negotiation panel the
   * same day. A number the game shows as the answer cannot be overruled by a
   * rule the number knows nothing about.
   *
   * And the veto was very nearly redundant. CONCENTRATION already discounts a
   * pile — the second asset counts 0.95, the fourth 0.70, the rest 0.55 — and
   * `total` is computed AFTER that weighting, so the junk-pile case this rule
   * was written for is already refused on value: the audit's own "four
   * quarters for a dollar" probe (five starters plus a 2nd, 3rd and 4th for a
   * 99 receiver) scores 0.52, less than half the bar, before this test runs
   * at all. What was left was a second penalty on top of the first, and the
   * only offers it could actually change were ones that had already cleared
   * the line — which is exactly the frustrating case, and it lands hardest on
   * a rebuilder trying to turn real players into picks.
   *
   * Gated to offers that have NOT cleared the bar, it keeps everything it was
   * good for: a pile of depth still gets a reason that names the shape of the
   * problem instead of "we're 12% short", which would send a user off to add
   * more of the same. It just cannot contradict the meter any more.
   */
  const headline = !clears ? headlineShortfall(receive, send) : null;
  if (headline) {
    return {
      accepted: false, sendValue, receiveValue, ratio, requiredRatio, shortfall: shortfallPoints, explanation, philosophy,
      counter: {
        /*
         * TWO PERCENTAGES ON ONE CARD HAD TO STOP LOOKING LIKE ONE.
         *
         * The owner's screenshot: the meter read 68% and this sentence read
         * "91% of what that would take". Both were true and they measure
         * different things — the meter is the whole offer against the club's
         * bar, this is the BEST SINGLE PIECE against the cornerstone bar — but
         * nothing said so, and "whatever the totals say" actively implied the
         * totals were fine when they were 32% short. So the piece figure now
         * says what it is counting, and when the value is short as well, the
         * sentence says that too instead of sending the user off to fix the
         * wrong problem.
         *
         * And it said "we're not moving HIM" about a 2027 first-round pick.
         *
         * THE "THE TOTALS ARE FINE" HALF IS GONE, because it could not happen.
         * This test is gated on the offer NOT clearing (see `headline` above,
         * which is the fix that stopped a 102% meter sitting over the word
         * TURNED DOWN), so the value is short every time this sentence is
         * printed. A branch the gate above makes unreachable is a claim the
         * screen can never make, and leaving it in reads as though it can.
         */
        message: `${headline.name} is a cornerstone for us — we're not moving ${headline.isPlayer ? 'him' : 'it'} for depth. `
          + `At least one piece coming back has to be a real asset in its own right, and the best single piece `
          + `you've offered is worth about ${Math.round((headline.best / Math.max(headline.wanted, 1)) * 100)}% of what that alone would take.`
          + ` The overall value is short too — the meter is what to watch for that.`,
      },
    };
  }

  /*
   * NOTHING FOR NOTHING IS NOT A TRADE. Both piles empty prices at 0 against a
   * bar of 0, which clears — the old Infinity accepted it too. The Trade
   * screen refuses to submit it (see TradeBuilder), but a server action is a
   * public endpoint and this one would have written a Transaction row and a
   * retrospective for a deal in which nothing moved.
   */
  if (opts.give.length === 0 && opts.get.length === 0) {
    return {
      accepted: false, sendValue, receiveValue, ratio, requiredRatio, shortfall: shortfallPoints, explanation, philosophy,
      counter: { message: `There's nothing on the table. Put something in the offer and we'll look at it.` },
    };
  }

  if (clears) {
    return { accepted: true, sendValue, receiveValue, ratio, requiredRatio, shortfall: shortfallPoints, explanation, philosophy };
  }

  /**
   * THE SALARY DUMP, REFUSED IN WORDS A GM CAN ACT ON.
   *
   * `receiveValue < 0` means the pile coming at this club is worth less than
   * nothing to it — the money owed on it outruns the football in it. There is
   * no percentage to quote (a percentage of nothing is nothing) and "we're
   * about 12% short" would send the user off to add another backup, so this
   * says what the actual obstacle is: the contract, by name and by dollar,
   * and what closing the gap would take.
   */
  if (receiveValue < 0) {
    const worst = receive.worstDeal;
    return {
      accepted: false, sendValue, receiveValue, ratio, requiredRatio, shortfall: shortfallPoints, explanation, philosophy,
      counter: {
        message: worst
          ? `It isn't ${worst.label} we have a problem with, it's his contract — it runs ${formatMoney(worst.overMarket)} past a fair price for a player at his level, and you're asking us to carry that. `
            + `We'd need real compensation to do you that favour: ${describeValue(shortfallPoints)} on top, or take some of that money back the other way.`
          : `What you're offering costs us more than it's worth once the contracts are counted. `
            + `We'd need ${describeValue(shortfallPoints)} on top before this is worth a conversation.`,
      },
    };
  }

  if (ratio >= requiredRatio - AI.TRADE_COUNTER_WINDOW) {
    return {
      accepted: false, sendValue, receiveValue, ratio, requiredRatio, shortfall: shortfallPoints, explanation, philosophy,
      counter: { message: `Close, but we need a bit more. Try sweetening the offer — we're about ${shortPct}% short on value.` },
    };
  }
  return {
    accepted: false, sendValue, receiveValue, ratio, requiredRatio, shortfall: shortfallPoints, explanation, philosophy,
    counter: { message: `Not enough here for us to consider it.` },
  };
}

/**
 * Net current-season cap this trade puts on the AI club, against the room it
 * actually has. Built from `tradeCapDeltas` — the same function
 * `executeTrade` runs before it writes — rather than a second derivation of
 * the "bonus stays behind, base salary travels" rule, because two copies of
 * that rule is how a screen ends up promising a deal the executor refuses.
 *
 * Returns null when there is room (the overwhelmingly common case).
 */
async function aiCapShortfall(
  opts: { aiTeamId: string; give: TradeAsset[]; get: TradeAsset[] },
  capSpace: number,
  capMode: CapMode,
): Promise<{ shortfall: number; added: number; available: number } | null> {
  if (capMode === 'OFF') return null;
  // The user's team id isn't known here and isn't needed: only the AI-side
  // rows are read, and those depend on which assets move, not on who the
  // counterparty is. A stable placeholder keeps the other side's rows
  // distinguishable.
  const OTHER = `${opts.aiTeamId}-counterparty`;
  const deltas = [
    ...(await tradeCapDeltas(opts.give, OTHER, opts.aiTeamId, capMode)),
    ...(await tradeCapDeltas(opts.get, opts.aiTeamId, OTHER, capMode)),
  ];
  const added = deltas.filter((d) => d.teamId === opts.aiTeamId).reduce((sum, d) => sum + d.delta, 0);
  // Mirrors assertCapRoom exactly, including both of its escapes: a move that
  // frees room (or is cap-neutral, e.g. picks only) is never blocked even for
  // a club already over the ceiling, and the same 1-dollar rounding slack
  // applies. Any divergence here would either promise a deal the executor
  // refuses or refuse one it would have written.
  if (added <= 0) return null;
  if (added <= capSpace + 1) return null;
  return { shortfall: added - capSpace, added, available: capSpace };
}

/**
 * ===========================================================================
 * NOBODY TRADES WHAT THEY DON'T HAVE
 * ===========================================================================
 * executeTrade used to move whatever ids it was handed. It checked the salary
 * cap and nothing else — so an offer naming a player on a third club's
 * roster, a pick that had already been spent, a free agent, or a retired
 * player moved him anyway. Every server action is a public HTTP endpoint, so
 * "the screen would never build that offer" was never a guarantee.
 *
 * And one of these was reachable in ordinary play with no tampering at all:
 * an AI offer sits on the table for a week, the club cuts the player it had
 * offered, and accepting the stale offer hands the user a free agent with no
 * contract — a permanent, free roster spot. Trading a retired player
 * manufactured INV-02, an error-level invariant violation.
 *
 * This is the up-front half of the fix: it refuses an impossible trade before
 * recordTrade() writes a retrospective for a deal that never happened, and it
 * is where the player-facing explanation comes from. The half that actually
 * guarantees the rule is the claim inside the transaction below — a read
 * here, however careful, is only advice by the time the write lands.
 */
export class TradeAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TradeAssetError';
  }
}

type TradeSide = { assets: TradeAsset[]; fromTeam: string };

async function assertAssetsTradable(leagueId: string, sides: TradeSide[]): Promise<void> {
  const seen = new Set<string>();
  for (const side of sides) {
    for (const a of side.assets) {
      /*
       * The same asset listed twice — on one side, or on both sides of the
       * same offer — would be moved twice and land wherever the last write
       * put it, which for a both-sides listing means a club "trades" a player
       * and keeps him.
       */
      const key = `${a.type}:${a.id}`;
      if (seen.has(key)) throw new TradeAssetError('That offer lists the same asset twice.');
      seen.add(key);

      if (a.type === 'PLAYER') {
        const p = await prisma.player.findUnique({
          where: { id: a.id },
          select: { leagueId: true, teamId: true, status: true, firstName: true, lastName: true },
        });
        if (!p || p.leagueId !== leagueId) throw new TradeAssetError('That offer includes a player who is not in this league.');
        const name = `${p.firstName} ${p.lastName}`;
        if (p.status === 'RETIRED') throw new TradeAssetError(`${name} has retired — he can't be part of a trade.`);
        if (p.teamId !== side.fromTeam) {
          const club = await prisma.team.findUnique({ where: { id: side.fromTeam }, select: { city: true, nickname: true } });
          const where = club ? `${club.city} ${club.nickname}` : 'the club offering him';
          throw new TradeAssetError(
            p.teamId === null
              ? `${name} is a free agent now — ${where} can't trade a player they don't have under contract.`
              : `${name} isn't on ${where}'s roster any more — this deal is off the table.`,
          );
        }
      } else {
        const pick = await prisma.draftPick.findUnique({
          where: { id: a.id },
          select: { leagueId: true, ownerTeamId: true, used: true, year: true, round: true },
        });
        if (!pick || pick.leagueId !== leagueId) throw new TradeAssetError('That offer includes a draft pick that is not in this league.');
        const label = `the ${pick.year} round-${pick.round} pick`;
        if (pick.used) throw new TradeAssetError(`${label} has already been spent — it can't be traded.`);
        if (pick.ownerTeamId !== side.fromTeam) throw new TradeAssetError(`${label} doesn't belong to the club offering it any more.`);
      }
    }
  }
}

/**
 * ===========================================================================
 * WHAT THE LEAGUE WIRE SAYS ABOUT A TRADE
 * ===========================================================================
 * One sentence a football person would recognise, built from the SAME priced
 * snapshot the retrospective is written from — never a second pass over the
 * assets. The headline names the man the deal is about and what it cost; the
 * detail carries the whole ledger, both directions, so nothing that moved is
 * missing from the record even though only one row is written.
 *
 * "BLOCKBUSTER" is not a mood. It fires at PACKAGE.HEADLINE_THRESHOLD — the
 * same 800 points that makes a man a cornerstone everywhere else in this file,
 * about a mid-first — so the word means one checkable thing and the trade
 * screen's own idea of a pillar is what decides it.
 */
const ORDINALS = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th'];

/** "2028 Round 2" -> "a 2028 2nd". Falls back to the stored label rather than guessing. */
function pickPhrase(label: string): string {
  const m = /^(\d{4}) Round (\d+)$/.exec(label);
  if (!m) return label;
  const round = Number(m[2]);
  return `a ${m[1]} ${ORDINALS[round] ?? `${round}th`}`;
}

function assetPhrase(a: TradeAssetSnapshot): string {
  if (a.type === 'PICK') return pickPhrase(a.label);
  const rating = a.ovr === undefined ? '' : `${a.ovr} OVR `;
  return `${rating}${a.position ?? ''} ${a.label}`.replace(/\s+/g, ' ').trim();
}

/** "a 1st", "a 1st and a 2nd", "a 1st, a 2nd and a 3rd". */
function joinPhrases(parts: string[]): string {
  if (parts.length === 0) return 'nothing';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

type ClubInfo = { city: string; nickname: string; abbr: string };

/** The sentence written on the wire for one deal, and the man it is about. */
export interface TradeWireLine {
  headline: string;
  detail: string;
  headlinePlayerId: string | null;
}

export function describeTrade(
  snapshot: { aToB: TradeAssetSnapshot[]; bToA: TradeAssetSnapshot[] },
  teamA: ClubInfo,
  teamB: ClubInfo,
): TradeWireLine {
  const detail =
    `${teamA.abbr} sends ${joinPhrases(snapshot.aToB.map(assetPhrase))}. `
    + `${teamB.abbr} sends ${joinPhrases(snapshot.bToA.map(assetPhrase))}.`;

  // The headline asset: the most valuable MAN moving in either direction. A
  // pick can never be the headline — "Chicago acquires a 2029 1st" is not the
  // sentence a wire leads with, and the pick-only case is worded separately.
  const players = [
    ...snapshot.aToB.filter((x) => x.type === 'PLAYER').map((x) => ({ x, toB: true })),
    ...snapshot.bToA.filter((x) => x.type === 'PLAYER').map((x) => ({ x, toB: false })),
  ].sort((p, q) => q.x.value - p.x.value);

  if (players.length === 0) {
    return {
      headline: `${teamA.city} and ${teamB.city} swap draft picks`,
      detail,
      headlinePlayerId: null,
    };
  }

  const head = players[0];
  const buyer = head.toB ? teamB : teamA;
  const seller = head.toB ? teamA : teamB;
  // What the buyer gave up for him — the other side of the deal, whole.
  const paid = head.toB ? snapshot.bToA : snapshot.aToB;
  const blockbuster = head.x.value >= TRADE_VALUE.PACKAGE.HEADLINE_THRESHOLD ? 'BLOCKBUSTER — ' : '';
  return {
    headline: `${blockbuster}${buyer.city} acquires ${assetPhrase(head.x)} from ${seller.city} for ${joinPhrases(paid.map(assetPhrase))}`,
    detail,
    headlinePlayerId: head.x.id,
  };
}

export async function executeTrade(opts: {
  leagueId: string; teamA: string; teamB: string; aToB: TradeAsset[]; bToA: TradeAsset[]; seasonYear: number; week: number;
  /**
   * THE OVERRIDE. Set only by forceTradeAction, and only after it has read
   * `forceTradeEnabled` off the league row for itself.
   *
   * It suspends the two refusals that are POLICY — the salary cap and the
   * roster limit — and nothing else. Everything that protects the integrity
   * of the save still runs: a club cannot trade a player it does not own, a
   * retired man, a spent pick or the same asset twice, and the money is still
   * booked exactly as it is for an ordinary trade (bonus accelerates onto the
   * seller, base salary travels, the charge is dated by capChargeYear).
   *
   * That distinction is the whole design. Skipping a rule leaves a legal save
   * in an illegal STATE the player asked for and can see; skipping an
   * ownership claim leaves a save with contracts pointing at nobody, which is
   * not an override, it is corruption.
   */
  force?: boolean;
}): Promise<TradeWireLine | null> {
  const [league, teamAInfo, teamBInfo] = await Promise.all([
    prisma.league.findUniqueOrThrow({ where: { id: opts.leagueId } }),
    prisma.team.findUniqueOrThrow({ where: { id: opts.teamA } }),
    prisma.team.findUniqueOrThrow({ where: { id: opts.teamB } }),
  ]);
  const capMode: CapMode = JSON.parse(league.settings).capMode ?? 'REALISTIC';

  /**
   * WHICH LEAGUE YEAR THE ACCELERATION BELONGS TO, ASKED RATHER THAN ASSUMED.
   *
   * The charge below was written with `year: opts.seasonYear`, hard-coded, and
   * it was right only by accident. `capChargeYear()` exists because the
   * offseason bumps League.seasonYear at the RESET_STANDINGS step and
   * expireStaleCapCharges() then deletes every charge filed against the year
   * that just ended — so a charge booked in OFFSEASON weeks 1-2 under the OLD
   * year is swept away before anybody pays it. That is the bug that made an
   * in-season release free, and this is the same class of it.
   *
   * It has never fired here for one reason: isTradeDeadlinePassed() closes
   * trading through OFFSEASON and RESIGN, so the only phases that reach this
   * line are ones where capChargeYear() returns seasonYear anyway. That is an
   * accident of the deadline rule, not a guard — the deadline is a league
   * SETTING (`tradeDeadlineEnabled`) and a league with it switched off can
   * execute a trade in OFFSEASON week 1 today. Routed through the one function
   * that knows the answer, so it stays right whatever the deadline does.
   */
  const chargeYear = capChargeYear({ phase: league.phase, week: league.week, seasonYear: opts.seasonYear });

  // Before anything is charged, recorded or moved: does either club actually
  // have what it is offering? See NOBODY TRADES WHAT THEY DON'T HAVE above.
  const sides: TradeSide[] = [
    { assets: opts.aToB, fromTeam: opts.teamA },
    { assets: opts.bToA, fromTeam: opts.teamB },
  ];
  await assertAssetsTradable(opts.leagueId, sides);

  /**
   * A trade can be comfortably legal for the side shedding salary and
   * illegal for the side taking it on, so BOTH teams are checked — one net
   * position per team across both directions, since a two-way deal can have
   * a team sending and receiving contracts at the same time. Deltas come
   * from tradeCapDeltas(), which mirrors exactly what the move() below
   * writes (bonus accelerates onto the seller, base salary travels).
   */
  const deltas = [
    ...(await tradeCapDeltas(opts.aToB, opts.teamA, opts.teamB, capMode)),
    ...(await tradeCapDeltas(opts.bToA, opts.teamB, opts.teamA, capMode)),
  ];
  /*
   * The GATE still asks about `opts.seasonYear` while the acceleration CHARGE
   * above is dated by capChargeYear(), and in the one window where those can
   * differ — OFFSEASON weeks 1-2 with the trade deadline switched off — they
   * are answering different questions on purpose. `tradeCapDeltas` returns
   * this season's salary movement, so this season's sheet is the right thing
   * to test it against; the accelerated bonus is a new charge and belongs to
   * whichever year will actually be billed for it. Passing chargeYear here
   * would check next year's ceiling against this year's salaries, which is
   * neither. Flagged rather than silently reconciled: lib/capEnforcement.ts
   * belongs to the cap workstream and this is its call to make.
   */
  // The cap is a rule of the league, and a forced trade is the player
  // overruling the league on purpose — so this is the first of the two gates
  // `force` suspends. The charges themselves are still computed and still
  // written below; what is skipped is the REFUSAL, not the accounting, so the
  // cap sheet afterwards tells the truth about how far over he now is.
  if (!opts.force) {
    await assertCapRoom({ action: 'Trade', seasonYear: opts.seasonYear, capMode, charges: deltas });
  }

  /*
   * A 53-MAN LIMIT THAT ONLY EXISTED ON CUT-DOWN DAY.
   *
   * Nothing on the trade path had ever read rosterMax, so a club could take
   * on twelve players for nothing and carry 58 into week one — measured. The
   * limit did get enforced, but not until the following offseason's final
   * cuts (trimRostersToLimit), which means the overflow survives a whole
   * season and is then resolved by the game waiving five men on the user's
   * behalf. That is a worse experience than being told no.
   *
   * Counted on `status: 'ACTIVE'` because that is exactly what
   * trimRostersToLimit counts. If the two disagreed, the screen would refuse
   * trades cut-down day would have allowed, or allow ones it later punished.
   */
  const rosterLimit = parseSettings(league.settings).rosterMax || LEAGUE.ROSTER_MAX;
  const playerCount = (assets: TradeAsset[]) => assets.filter((a) => a.type === 'PLAYER').length;
  for (const [teamId, info, sends, gets] of [
    [opts.teamA, teamAInfo, opts.aToB, opts.bToA],
    [opts.teamB, teamBInfo, opts.bToA, opts.aToB],
  ] as const) {
    const after = await prisma.player.count({ where: { teamId, status: 'ACTIVE' } })
      - playerCount(sends) + playerCount(gets);
    if (after <= rosterLimit) continue;

    /*
     * ONLY THE USER IS BLOCKED, BECAUSE ONLY THE USER CAN ACT ON IT.
     *
     * This threw for whichever club was over, which meant a five-for-one died
     * on "Charlotte Pumas would carry 54 players against a 53-man limit.
     * Release 1 before making this deal." — an instruction the user cannot
     * follow, since he cannot release another club's player. A refusal that
     * names no action he can take is a dead end, not a decision.
     *
     * An AI club makes room the way it makes cap room: it sheds its least
     * valuable man first, on the same ranking cut-down day uses, so a club
     * does not lose one player here and a different one in September. The
     * user's own roster stays his to manage, and his message still names a
     * thing he can do.
     */
    if (info.isUser) {
      // The second gate `force` suspends. He is over the limit and he chose to
      // be; final cuts will square it, and until then the roster screen shows
      // the real count. The AI branch below is NOT skipped — an AI club still
      // makes room the ordinary way, because the alternative is silently
      // handing another club an illegal roster the player never sees.
      if (opts.force) continue;
      throw new TradeAssetError(
        `${info.city} ${info.nickname} would carry ${after} players against a ${rosterLimit}-man limit. `
        + `Release ${after - rosterLimit} before making this deal.`,
      );
    }
    await autoTrimRosterToLimit({
      leagueId: opts.leagueId,
      teamId,
      // The limit they must be under ONCE the deal lands: they are about to
      // take on `gets` and lose `sends`, and none of that has happened yet.
      limit: rosterLimit - playerCount(gets) + playerCount(sends),
      seasonYear: opts.seasonYear,
      capMode,
      week: opts.week,
    });
  }

  // Snapshot what's being traded (and what it's worth right now) BEFORE
  // ownership changes — the only record of asset identity a trade
  // retrospective (lib/tradeRetro.ts) can grade later, and now also what the
  // League Wire reads to name the deal (see `wire` below).
  const snapshot = await recordTrade({
    leagueId: opts.leagueId, seasonYear: opts.seasonYear, week: opts.week,
    teamAId: opts.teamA, teamBId: opts.teamB, teamAAbbr: teamAInfo.abbr, teamBAbbr: teamBInfo.abbr,
    aToB: opts.aToB, bToA: opts.bToA, capMode,
  });

  let written: TradeWireLine | null = null;
  await prisma.$transaction(async (tx) => {
    /**
     * Trading a player away does NOT hand his signing-bonus proration to the
     * team acquiring him — in real football the whole remaining bonus (void
     * years included) accelerates onto the cap of the team giving him up, and
     * the new team inherits base salary only. Without this, dumping a
     * bonus-heavy contract was a way to escape it entirely.
     */
    const move = async (assets: TradeAsset[], fromTeam: string, toTeam: string) => {
      for (const a of assets) {
        if (a.type === 'PLAYER') {
          /*
           * THE CLAIM, and it is the first write for this asset on purpose.
           *
           * `updateMany` with the current owner in the WHERE is an atomic
           * compare-and-set, which is the only thing that actually enforces
           * ownership here. The read in assertAssetsTradable() cannot: this
           * transaction runs at READ COMMITTED, so two confirms of the same
           * trade both read a valid roster and both proceed, and the second
           * update would simply set teamId to a value it already had. Matching
           * on `teamId: fromTeam` means exactly one of them writes a row; the
           * loser matches zero and throws, rolling the whole thing back.
           *
           * That is what stops a double-clicked Confirm from filing the
           * accelerated bonus twice (measured: two CapCharge rows for one
           * player), and it is why the charge below is written AFTER the
           * claim rather than before it.
           */
          const claimed = await tx.player.updateMany({
            where: { id: a.id, leagueId: opts.leagueId, teamId: fromTeam },
            data: { teamId: toTeam },
          });
          if (claimed.count === 0) {
            throw new TradeAssetError('That trade has already gone through, or one of the players in it has moved.');
          }

          const contract = await tx.contract.findUnique({ where: { playerId: a.id } });
          if (contract && capMode === 'REALISTIC') {
            // The BONUS accelerates, not what a release would cost. His
            // guaranteed salary is not escaped by trading him — it travels
            // with the contract below and becomes the acquiring club's bill.
            const accelerated = unamortizedBonus(contract, capMode);
            if (accelerated > 0) {
              const p = await tx.player.findUniqueOrThrow({ where: { id: a.id } });
              await tx.capCharge.create({
                data: {
                  teamId: fromTeam,
                  year: chargeYear,
                  amount: accelerated,
                  label: `Traded away — ${p.firstName} ${p.lastName}`,
                },
              });
            }
          }
          // Bonus stays behind with the old team as the charge above, so the
          // contract that travels carries base salary and nothing else.
          //
          // `guaranteed` has to be restated at the same time, because it is
          // stored bonus-inclusive (see lib/cap.ts) and the bonus has just
          // been zeroed out of this row. Left alone, every dollar of bonus
          // guarantee would be re-read as guaranteed BASE salary and the
          // acquiring club would inherit a dead-money bill for money the
          // selling club had already been charged for.
          await tx.contract.updateMany({
            where: { playerId: a.id },
            data: capMode === 'REALISTIC'
              ? {
                  teamId: toTeam,
                  signingBonus: 0,
                  voidYears: 0,
                  guaranteed: Math.max(0, contract ? contract.guaranteed - contract.signingBonus : 0),
                }
              : { teamId: toTeam },
          });
        } else {
          // Same claim, same reason — plus `used: false`, so a pick that was
          // spent between building the offer and confirming it can't move.
          const claimed = await tx.draftPick.updateMany({
            where: { id: a.id, leagueId: opts.leagueId, ownerTeamId: fromTeam, used: false },
            data: { ownerTeamId: toTeam },
          });
          if (claimed.count === 0) {
            throw new TradeAssetError('That trade has already gone through, or one of the picks in it has moved.');
          }
        }
      }
    };
    await move(opts.aToB, opts.teamA, opts.teamB);
    await move(opts.bToA, opts.teamB, opts.teamA);

    /**
     * Moving the roster spot is only half of arriving. Nothing here used to
     * touch either club's depth chart, and lib/sim/units.ts ranks a player his
     * chart doesn't name behind every player it does — so the man you traded
     * for lined up behind the entire position group and took no snaps at all
     * for the rest of the season, while the man you traded away kept a rank on
     * the chart he had left. Both sides are reconciled, in the same
     * transaction as the move, so a trade can never half-land.
     */
    await reconcileDepthChart(opts.teamA, tx);
    await reconcileDepthChart(opts.teamB, tx);

    /*
     * =====================================================================
     * THE DEAL, SAID AS FOOTBALL — AND ATTACHED TO A MAN
     * =====================================================================
     * This row used to read `Trade: ATL <-> BUF` over `ATL sends 2 asset(s),
     * receives 2 asset(s).`, with no `playerId` at all. Measured across the
     * whole Transaction table: 25 TRADE rows in 272 leagues and ZERO of them
     * carrying a player. Every other kind of move in this game is
     * attributable — DRAFT 42,917 of 43,528, RESIGN 39,724 of 51,778 — so a
     * trade was the one thing that could happen to a career and leave no
     * trace on it. The wire could not report it and a player's own page
     * could not show it.
     *
     * ONE ROW PER DEAL, NOT ONE PER PLAYER. A four-man swap is one event, and
     * four rows would read as four trades on the wire. `playerId` therefore
     * names the HEADLINE asset — the most valuable man moving in either
     * direction, which is the one the wire leads with.
     *
     * THE OTHER MEN IN THE DEAL ARE NOT LOST, and this is the reason one row
     * is safe: `TradeRecord` (written immediately above) carries the complete
     * per-player ledger of both directions, each entry keyed by real
     * `playerId`, with the club abbreviations and the league year on the row.
     * So "2031 — Traded to New York" is answerable for the second, third or
     * fourth piece of a deal as readily as for the headline: find the record
     * whose `aToB` or `bToA` names him, and the side he is on says which club
     * he went to. This row is the announcement; that row is the ledger.
     */
    const wire = describeTrade(snapshot, teamAInfo, teamBInfo);
    await tx.transaction.create({
      data: {
        leagueId: opts.leagueId, seasonYear: opts.seasonYear, week: opts.week, type: 'TRADE',
        headline: wire.headline,
        detail: wire.detail,
        playerId: wire.headlinePlayerId,
      },
    });
    written = wire;
  });
  /*
   * HANDED BACK RATHER THAN LOOKED UP AGAIN. lib/aiMarket.ts wants the
   * sentence for the advance summary, and re-reading "the most recent TRADE
   * row for this league and week" to find it is a query that can return a
   * different deal than the one just written the moment two land in one tick.
   * Callers that do not want it are unaffected — this used to return nothing.
   */
  return written;
}

export interface TradePartnerSuggestion {
  teamId: string;
  teamName: string;
  teamAbbr: string;
  /**
   * 0..1 interest at the shopped position. With `ovr` supplied this is the
   * same blended roster-fit the valuation uses — hole OR upgrade — so a club
   * that is set at the position but would still be improved by THIS player
   * appears. Without it, it degrades to the raw hole-need.
   */
  need: number;
  needLabel: 'Severe' | 'High' | 'Moderate' | 'Low';
  philosophy: ReturnType<typeof philosophySummary>;
}

/**
 * "Best trade partners" for a position you're shopping — the QoL feature the
 * brief specifically calls out: instead of the user opening all 31 rosters
 * and cap sheets by hand, the game just tells them who's actually interested.
 *
 * `ovr` is how good the man you're shopping actually is, and it matters
 * enormously: ranked on hole-need alone, a club starting an 84 right tackle
 * reads 0.00 and never appears, even though it would obviously take a 91.
 * That is the same "do I have a hole?" / "is he better than what I have?"
 * confusion that made the AI discount the player in the first place, showing
 * up a second time in the list that is supposed to tell the user WHO TO CALL.
 * Optional so existing callers keep the old hole-only behaviour rather than
 * silently changing meaning.
 */
export async function rankTradePartners(leagueId: string, position: string, excludeTeamId: string, ovr?: number): Promise<TradePartnerSuggestion[]> {
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
    const teamRoster = (byTeam.get(t.id) ?? []) as RosterPlayer[];
    const needs = teamNeeds(teamRoster);
    // Same blend, same order of arguments, as playerValueDetailed's fit term
    // — the list and the valuation must not disagree about who wants him.
    const fit = ovr === undefined
      ? 0
      : rosterFit({ id: '__shopped__', position, trueOvr: ovr, age: 26, potential: ovr }, teamRoster).score;
    const need = Math.max(needs[position] ?? 0, fit);
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

  const roster = await prisma.player.findMany({ where: { teamId: aiTeam.id }, include: { contract: true } });
  if (roster.length < 4) return null;
  const needs = teamNeeds(roster as RosterPlayer[]);
  const profile = parseGmProfile(aiTeam.gmProfile, rng);
  const philosophy = philosophySummary(profile);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const capMode: CapMode = JSON.parse(league.settings).capMode ?? 'REALISTIC';

  // Offer from a position with real depth (need near 0) and a player who
  // isn't a core starter — the AI's own logic wouldn't shop its best guy.
  const depthPositions = Object.entries(needs).filter(([, n]) => n < 0.15).map(([pos]) => pos);
  const candidates = roster.filter((p) => depthPositions.includes(p.position) && p.trueOvr >= 67 && p.trueOvr <= 89);
  const surplus = candidates.length > 0 ? rng.pick(candidates) : rng.pick(roster.filter((p) => p.trueOvr >= 65 && p.trueOvr <= 83));
  if (!surplus) return null;

  // `roster` matters here even though he's the club's own man: it's what
  // makes the ask reflect that he is SURPLUS. Without it the AI priced its
  // fourth receiver as though he were about to start somewhere.
  const askValue = playerValueDetailed(surplus as unknown as RosterPlayer, { profile, needs, rng, capMode, roster: roster as RosterPlayer[] }).total;

  /*
   * A CLUB DOES NOT SHOP A MAN IT WOULD HAVE TO PAY SOMEONE TO TAKE.
   *
   * `total` can now be negative — a contract worth more than the player on it
   * is a cost, not an asset (see the contract block in lib/ai/gm.ts). Left
   * unguarded, the ask below would have gone looking for the cheapest pick
   * worth at least 0.8x a NEGATIVE number, matched the user's last seventh,
   * and put an albatross on his desk described only by rating and position.
   * Worse, respondToTradeOfferAction executes an accepted offer without
   * re-evaluating it, so nothing downstream would have caught it. Shopping
   * surplus and dumping salary are different moves; this function is the
   * first one.
   */
  if (askValue <= 0) return null;

  const userPicks = await prisma.draftPick.findMany({ where: { ownerTeamId: userTeamId, used: false }, orderBy: [{ year: 'asc' }, { round: 'asc' }] });
  // Find the cheapest pick (by this team's own pick-value scale) that still
  // roughly covers what it's asking — keeps the ask honest rather than
  // reaching for the user's best future first-rounder every time.
  const currentYear = league.seasonYear;
  const draft = await draftOrderContext(leagueId);
  const priced = userPicks
    .map((p) => ({ pick: p, value: pickValue(p.round, effectiveSlot(p, draft), profile, p.year, currentYear, draft.imminentYear) }))
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
