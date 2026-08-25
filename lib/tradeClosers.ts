import { prisma } from './db';
import { LEAGUE } from './tuning';
import { parseSettings } from './settings';
import { tradeCapEffect, formatMoney, CAP_GATE_TOLERANCE } from './cap';
import { assertCapRoom, tradeCapDeltas, CapViolationError } from './capEnforcement';
import {
  buildTradeContext, evaluateTrade, priceAsset,
  type TradeAsset, type TradeContext, type PricedAsset, type TradeEvaluation,
} from './trade';
import type { PhilosophySummary } from './ai/gm';

/**
 * ===========================================================================
 * WHAT WOULD IT TAKE TO CLOSE THIS
 * ===========================================================================
 * A club has said no. This works out the single changes to the offer that
 * would turn that into a yes, and it works them out the only way this
 * codebase permits: by re-running the REAL evaluation on each candidate
 * package and keeping the ones that come back accepted. Nothing here
 * estimates, interpolates or reasons about what the engine "would probably"
 * say. If a suggestion is on screen, the engine has already said yes to it.
 *
 * AND IT NEVER PRINTS A PRICE. The club's value points are the engine's
 * currency and they stay behind Trade Intel; a panel that said "add 280 more"
 * would hand the GM the price list the AI is running on. So the numbers here
 * do two jobs and neither of them is display: they NARROW the candidate set
 * before anything expensive runs, and they ORDER the survivors cheapest
 * first. What reaches the screen is an action, a football reason, and a
 * qualitative band.
 * ===========================================================================
 */

/** Which single change to the offer this is. */
export type CloserMove =
  /** Put one more of your own assets on the table. */
  | 'ADD_YOURS'
  /** Stop asking for one of theirs. */
  | 'DROP_ASK'
  /** Cap refusals only: take one of their contracts back the other way. */
  | 'ADD_THEIR_CONTRACT'
  /** Cap refusals only: keep one of your own contracts off their books. */
  | 'DROP_YOUR_CONTRACT';

export interface TradeCloser {
  move: CloserMove;
  /** The asset the change is about, for the UI's own lookups. */
  asset: TradeAsset;
  /** The complete selection this produces — what a one-click apply sets. */
  give: TradeAsset[];
  get: TradeAsset[];
  /** The move itself: "Add Jaylen Ost". */
  action: string;
  /** Why it moves them, in football. Never a value figure. */
  reason: string;
  /**
   * How the verified package sits against the club's line. Qualitative on
   * purpose, and read off the evaluation that accepted it — see band().
   */
  band: 'ONLY_JUST' | 'COMFORTABLY' | 'ROOM_TO_SPARE';
}

export interface TradeClosersResult {
  /** What the club actually refused on — decides the candidates and the wording. */
  block: 'VALUE' | 'CAP' | 'NONE';
  closers: TradeCloser[];
  /** Candidate packages actually put through evaluateTrade. Reported for the perf budget. */
  examined: number;
  /**
   * True when more assets cleared the narrowing than the evaluation budget
   * allowed. Only ever changes the wording of the empty state — never a claim
   * that something works.
   */
  truncated: boolean;
}

/**
 * HOW MANY REAL EVALUATIONS ONE PRESS OF PROPOSE MAY SPEND.
 *
 * evaluateTrade is a database call per asset on top of the club-level reads,
 * and a roster is 53 men plus picks. Everything below exists to make sure the
 * ones we spend are spent on assets that could actually work — see
 * narrowAdditions.
 */
const EVALUATION_BUDGET = 24;
/** How many verified closers reach the screen. Three actions is a decision; ten is a list. */
const SHOWN = 3;
/** Of the budget, the share spent on the cheapest qualifying assets. See narrowAdditions. */
const CHEAP_SHARE = 0.6;
/**
 * The narrowing thresholds below are exact necessary conditions, so the only
 * way they can go wrong is by a hair. Both are slackened by this before they
 * filter anything: a slightly wide net costs one wasted verification, and a
 * net a rounding error too tight silently loses the one asset that worked.
 * In points for a value gap and in dollars for a cap one — in both cases a
 * quantity far too small to change which assets are genuinely in the band.
 */
const NARROW_SLACK = 1 + CAP_GATE_TOLERANCE;

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
const ordinal = (round: number) => ORDINALS[round] ?? `round ${round}`;

/** "2029 third-round pick" — the way the board and the deal sheet name one. */
function pickLabel(pick: { year: number; round: number }): string {
  return `${pick.year} ${ordinal(pick.round)}-round pick`;
}

/**
 * The strongest note this club made about the asset, IN ITS OWN VOICE — these
 * sentences are written first-person ("he starts for us at LT"), which is why
 * the panel attributes them to the club rather than narrating them.
 *
 * They are the same sentences the verdict already prints under "What we'd be
 * getting", and none of them quotes a value point: they quote cap dollars and
 * rating gaps, both of which are already on this screen. A closer never adds
 * a figure of its own.
 *
 * IT IS THE STRONGEST NOTE, NOT THE MOST FLATTERING ONE. A club's dominant
 * read on a man it will nonetheless accept is often what it dislikes about
 * him — his money, usually — and printing that is the honest answer to "why
 * this closes it and what they think of the piece". Reasons arrive
 * weight-sorted from playerValueDetailed and carry a "Firstname Lastname: "
 * prefix, which the action line has already said.
 */
function topReason(priced: PricedAsset): string | null {
  /*
   * ...WITH ONE EXCLUSION, AND IT IS THE WHOLE POINT OF THIS PANEL. One of
   * the fit notes quotes a rating differential — "19 points a snap better
   * than the man he'd replace". That is a scouting number and not the trade
   * engine's currency, and it is fine where it already lives, in the columns
   * under the verdict. Here it is not: this panel exists to answer "what
   * would close the value gap", and a figure ending in the word "points"
   * sitting in that answer reads as the club's price for the man, which is
   * exactly the thing the GM is not shown. The next-strongest note says the
   * same thing about him without the number.
   */
  const usable = priced.reasons.find((r) => !/\d+\s*points?\b/i.test(r.text));
  if (!usable) return null;
  const i = usable.text.indexOf(': ');
  return i > 0 && i <= 32 ? usable.text.slice(i + 2) : usable.text;
}

/**
 * A pick carries no scouting notes — assetValues writes reasons for men, not
 * for selections — so its line is built from the two things about this club
 * that decide whether capital moves it: where it is in its cycle and how it
 * treats picks. Both come off the GM profile the evaluation itself ran on.
 */
function pickReason(philosophy: PhilosophySummary, mine: boolean): string {
  if (!mine) return `We weren't moving that pick at this price. Off the ask, the deal closes.`;
  if (philosophy.pickPreference === 'Hoards picks') return `We hoard picks here, and that is the piece that gets it done.`;
  switch (philosophy.windowLabel) {
    case 'Rebuilding':
      return `We're tearing it down — draft capital is the currency that moves us, and that covers it.`;
    case 'Building':
      return `We're still assembling a roster, and a pick like that is worth more to us than another body.`;
    default:
      return `We're built to win now, and that is the piece that balances the deal.`;
  }
}

/** Where the verified package landed against the club's line. */
function band(ev: TradeEvaluation): TradeCloser['band'] {
  const pct = (ev.ratio / ev.requiredRatio) * 100;
  /*
   * 108 is the acceptance meter's own overpay mark (see AcceptanceMeter): a
   * few points of slack, because nobody lands exactly on the line. Past 125
   * the club is being handed materially more than it asked for, which is a
   * thing a GM should be told before he clicks — in the same words the meter
   * uses, not in points.
   */
  if (pct < 108) return 'ONLY_JUST';
  return pct <= 125 ? 'COMFORTABLY' : 'ROOM_TO_SPARE';
}

/**
 * ===========================================================================
 * NARROWING WITHOUT HIDING THE ONE THAT WORKS
 * ===========================================================================
 * Adding an asset to your side can only move the club's receive total by the
 * asset's own priced value AT BEST. Every piece in a pile is weighted by
 * TRADE_VALUE.PACKAGE.CONCENTRATION, the first at 1.0 and falling from there,
 * and a newcomer both takes a weighted slot and pushes everything below it
 * onto a smaller weight — so the gain is at most `value x 1.0`, never more.
 * The club's bar does not move when you add to your own side (it is priced off
 * what IT gives up, which is untouched), so the gain has to cover `shortfall`
 * exactly.
 *
 * That makes `value >= shortfall` a NECESSARY condition, not a guess: an
 * asset below it cannot close the deal however the rest of the package falls,
 * so skipping it can never hide a working suggestion. Assets above it may
 * still fail — on the weighting, on the cornerstone rule, or on either club's
 * cap — which is what the verification pass is for.
 *
 * The per-asset price is the SAME priceAsset the evaluation runs, on the same
 * context, with the same per-asset noise seed, so the number this filters on
 * is the number that will be used. It is a filter and a sort key; it is never
 * displayed.
 *
 * WHAT THE BUDGET SPENDS ITSELF ON. Cheapest-first is what a GM wants, but a
 * refusal can also be the cornerstone rule — "no quantity of depth buys this
 * man" — where the only thing that works is a big piece. So the budget is
 * split: most of it on the cheapest qualifying assets, the rest spread evenly
 * across the range up to and including the largest, which keeps the big-piece
 * answer reachable on a deep roster.
 */
function narrowAdditions(priced: { asset: TradeAsset; priced: PricedAsset }[], shortfall: number, budget: number) {
  const qualify = priced.filter((c) => c.priced.value >= shortfall - NARROW_SLACK).sort((a, b) => a.priced.value - b.priced.value);
  if (qualify.length <= budget) return { chosen: qualify, truncated: false };
  const cheapCount = Math.floor(budget * CHEAP_SHARE);
  const chosen = qualify.slice(0, cheapCount);
  const rest = qualify.slice(cheapCount);
  const step = (rest.length - 1) / Math.max(1, budget - cheapCount - 1);
  for (let i = 0; i < budget - cheapCount; i++) chosen.push(rest[Math.round(i * step)]);
  return { chosen: [...new Set(chosen)], truncated: true };
}

/** The user-side gates executeTrade runs that evaluateTrade does not — his cap and his roster limit. */
async function passesExecutorGate(opts: {
  give: TradeAsset[]; get: TradeAsset[];
  userTeamId: string; aiTeamId: string; ctx: TradeContext;
  rosterLimit: number; userActiveCount: number;
}): Promise<boolean> {
  const players = (a: TradeAsset[]) => a.filter((x) => x.type === 'PLAYER').length;
  if (opts.userActiveCount - players(opts.give) + players(opts.get) > opts.rosterLimit) return false;
  /*
   * The AI's own books are already settled — a candidate only reaches here
   * having come back accepted, and evaluateTrade refuses on the club's cap
   * before it ever gets to value. What that check deliberately does not cover
   * is the USER's cap, which executeTrade tests at Confirm. Suggesting a deal
   * that dies on that button is worse than suggesting nothing, so the same
   * gate runs here, on the same deltas, from the same function.
   */
  const charges = [
    ...(await tradeCapDeltas(opts.give, opts.userTeamId, opts.aiTeamId, opts.ctx.capMode)),
    ...(await tradeCapDeltas(opts.get, opts.aiTeamId, opts.userTeamId, opts.ctx.capMode)),
  ];
  try {
    await assertCapRoom({ action: 'Trade', seasonYear: opts.ctx.seasonYear, capMode: opts.ctx.capMode, charges });
    return true;
  } catch (err) {
    if (err instanceof CapViolationError) return false;
    throw err;
  }
}

/** A candidate package, before anything has been verified about it. */
interface Candidate {
  move: CloserMove;
  asset: TradeAsset;
  give: TradeAsset[];
  get: TradeAsset[];
  action: string;
  reason: string;
  /**
   * Ordering key only — "how much this costs you", in the club's points for a
   * value refusal and in cap dollars for a cap one. Never rendered.
   */
  cost: number;
}

const sameAsset = (a: TradeAsset, b: TradeAsset) => a.type === b.type && a.id === b.id;
const without = (list: TradeAsset[], a: TradeAsset) => list.filter((x) => !sameAsset(x, a));

/**
 * Work out what would close a refused trade.
 *
 * `give`/`get` are the user's own perspective, exactly as the Trade screen
 * builds them and exactly as evaluateTrade takes them: `give` flows to the AI
 * club, `get` comes back from it.
 */
export async function findTradeClosers(opts: {
  leagueId: string;
  userTeamId: string;
  aiTeamId: string;
  give: TradeAsset[];
  get: TradeAsset[];
}): Promise<TradeClosersResult> {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: opts.leagueId } });
  const settings = parseSettings(league.settings);
  const aiSettings = { aiAcceptsLopsided: settings.aiAcceptsLopsided };
  const ctx = await buildTradeContext(opts.aiTeamId, league.seasonYear);

  /*
   * THE REFUSAL IS RE-ASKED, NOT PASSED IN. The screen has a verdict, but a
   * verdict travelling over the wire is a claim about a package rather than
   * the package itself — and this function's entire promise is that every
   * suggestion was checked against the live engine. It starts by checking the
   * offer it was handed.
   */
  const base = await evaluateTrade({ ...opts, currentYear: league.seasonYear, settings: aiSettings, ctx });
  let examined = 1;
  if (base.accepted) return { block: 'NONE', closers: [], examined, truncated: false };
  if (opts.give.length === 0 && opts.get.length === 0) return { block: 'NONE', closers: [], examined, truncated: false };

  const candidates: Candidate[] = [];
  let truncated = false;

  if (base.capBlock) {
    /*
     * A CAP REFUSAL IS A MONEY PROBLEM, SO THE CLOSERS ARE MONEY MOVES.
     *
     * What lands on the club's cap is the base salary travelling with the men
     * it RECEIVES, less what it frees by sending its own out (tradeCapDeltas).
     * Picks weigh nothing at all, so no amount of draft capital can move this
     * number — which leaves exactly two single-asset changes: take one of
     * their contracts back the other way, or keep one of yours off their
     * books. Both are filtered on the same `frees`/`takesOn` the gate itself
     * uses, and the threshold is exact: a move that covers less than the
     * shortfall cannot clear it alone.
     */
    const need = base.capBlock.shortfall;
    const [theirs, mine] = await Promise.all([
      prisma.player.findMany({
        where: { teamId: opts.aiTeamId, status: 'ACTIVE' },
        include: { contract: true },
      }),
      prisma.player.findMany({
        where: { id: { in: opts.give.filter((a) => a.type === 'PLAYER').map((a) => a.id) } },
        include: { contract: true },
      }),
    ]);
    const asked = new Set(opts.get.filter((a) => a.type === 'PLAYER').map((a) => a.id));
    for (const p of theirs) {
      if (asked.has(p.id)) continue;
      const frees = tradeCapEffect(p.contract, ctx.capMode).frees;
      if (frees < need - NARROW_SLACK) continue;
      const asset: TradeAsset = { type: 'PLAYER', id: p.id };
      candidates.push({
        move: 'ADD_THEIR_CONTRACT', asset,
        give: opts.give, get: [...opts.get, asset],
        action: `Ask for ${p.firstName} ${p.lastName} to come back the other way`,
        reason: `${formatMoney(frees)} of his deal leaves our books with him, and that is the room this trade is missing.`,
        cost: frees,
      });
    }
    for (const p of mine) {
      const takesOn = tradeCapEffect(p.contract, ctx.capMode).takesOn;
      if (takesOn < need - NARROW_SLACK) continue;
      const asset: TradeAsset = { type: 'PLAYER', id: p.id };
      candidates.push({
        move: 'DROP_YOUR_CONTRACT', asset,
        give: without(opts.give, asset), get: opts.get,
        action: `Take ${p.firstName} ${p.lastName} off your side`,
        reason: `His ${formatMoney(takesOn)} is the salary we have no room for — without it the deal fits.`,
        cost: takesOn,
      });
    }
    // Least disruption first: the smallest money move that actually clears it.
    candidates.sort((a, b) => a.cost - b.cost);
  } else {
    /*
     * A VALUE REFUSAL. `shortfall` is how far the offer is from the club's
     * bar in its own points — see the derivation in evaluateTrade — and it is
     * the budget every candidate has to cover. See narrowAdditions for why
     * pricing each asset first can never hide one that would have worked.
     */
    const inGive = new Set(opts.give.map((a) => `${a.type}:${a.id}`));
    const [roster, picks] = await Promise.all([
      prisma.player.findMany({ where: { teamId: opts.userTeamId, status: 'ACTIVE' }, include: { contract: true } }),
      prisma.draftPick.findMany({ where: { ownerTeamId: opts.userTeamId, used: false } }),
    ]);
    const priceable: { asset: TradeAsset; priced: PricedAsset }[] = [];
    for (const p of roster) {
      if (inGive.has(`PLAYER:${p.id}`)) continue;
      const asset: TradeAsset = { type: 'PLAYER', id: p.id };
      priceable.push({ asset, priced: await priceAsset(asset, ctx, 'receive', { type: 'PLAYER', player: p }) });
    }
    for (const k of picks) {
      if (inGive.has(`PICK:${k.id}`)) continue;
      const asset: TradeAsset = { type: 'PICK', id: k.id };
      priceable.push({ asset, priced: await priceAsset(asset, ctx, 'receive', { type: 'PICK', pick: k }) });
    }

    const additions = narrowAdditions(priceable, base.shortfall, EVALUATION_BUDGET);
    truncated = additions.truncated;
    for (const c of additions.chosen) {
      const isPlayer = c.asset.type === 'PLAYER';
      const pick = isPlayer ? null : picks.find((k) => k.id === c.asset.id)!;
      candidates.push({
        move: 'ADD_YOURS', asset: c.asset,
        give: [...opts.give, c.asset], get: opts.get,
        action: isPlayer ? `Add ${c.priced.label}` : `Add your ${pickLabel(pick!)}`,
        reason: (isPlayer ? topReason(c.priced) : pickReason(base.philosophy, true))
          ?? `He's the piece that gets us there.`,
        cost: c.priced.value,
      });
    }

    /*
     * ...AND ASKING FOR LESS IS A WAY TO CLOSE A DEAL TOO. Only offered when
     * there is more than one asset on their side: dropping the only thing you
     * asked for does not make a cheaper trade, it makes a donation.
     *
     * No pre-filter here, and none needed — the candidate set is whatever the
     * user has actually put on their side of the sheet, which is a handful.
     */
    if (opts.get.length > 1) {
      const [theirPlayers, theirPicks] = await Promise.all([
        prisma.player.findMany({ where: { id: { in: opts.get.filter((a) => a.type === 'PLAYER').map((a) => a.id) } }, include: { contract: true } }),
        prisma.draftPick.findMany({ where: { id: { in: opts.get.filter((a) => a.type === 'PICK').map((a) => a.id) } } }),
      ]);
      for (const a of opts.get) {
        const player = a.type === 'PLAYER' ? theirPlayers.find((p) => p.id === a.id) : null;
        const pick = a.type === 'PICK' ? theirPicks.find((k) => k.id === a.id) : null;
        if (!player && !pick) continue;
        const priced = await priceAsset(a, ctx, 'send', player ? { type: 'PLAYER', player } : { type: 'PICK', pick: pick! });
        candidates.push({
          move: 'DROP_ASK', asset: a,
          give: opts.give, get: without(opts.get, a),
          action: `Drop your ask for ${player ? priced.label : `their ${pickLabel(pick!)}`}`,
          reason: (player ? topReason(priced) : pickReason(base.philosophy, false))
            ?? `We weren't moving him at this price. Off the ask, the deal closes.`,
          cost: priced.value,
        });
      }
    }
    // Cheapest first, in the club's own ordering — the least you can give up.
    candidates.sort((a, b) => a.cost - b.cost);
  }

  /*
   * VERIFICATION. Every candidate goes through the real evaluateTrade, and
   * only an `accepted: true` survives. The two user-side gates executeTrade
   * runs are checked on top, and only for the ones about to be shown — a
   * suggestion the Confirm button would refuse is worse than no suggestion.
   */
  const rosterLimit = settings.rosterMax || LEAGUE.ROSTER_MAX;
  const userActiveCount = await prisma.player.count({ where: { teamId: opts.userTeamId, status: 'ACTIVE' } });
  const closers: TradeCloser[] = [];
  for (const c of candidates.slice(0, EVALUATION_BUDGET)) {
    const ev = await evaluateTrade({
      aiTeamId: opts.aiTeamId, give: c.give, get: c.get,
      currentYear: league.seasonYear, settings: aiSettings, ctx,
    });
    examined++;
    if (!ev.accepted) continue;
    const ok = await passesExecutorGate({
      give: c.give, get: c.get, userTeamId: opts.userTeamId, aiTeamId: opts.aiTeamId,
      ctx, rosterLimit, userActiveCount,
    });
    if (!ok) continue;
    closers.push({ move: c.move, asset: c.asset, give: c.give, get: c.get, action: c.action, reason: c.reason, band: band(ev) });
    if (closers.length === SHOWN) break;
  }
  if (candidates.length > EVALUATION_BUDGET) truncated = true;

  return { block: base.capBlock ? 'CAP' : 'VALUE', closers, examined, truncated };
}
