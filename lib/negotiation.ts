import { Rng } from './rng';
import { buildContract, capHitSchedule, deadMoneyOnCut, formatMoney } from './cap';
import { CAP } from './tuning';
import { CapMode } from './types';

/**
 * Contract negotiation.
 *
 * Before this, there was no acceptance model at all: `extendContract` checked
 * the salary cap and nothing else, so a $900K offer against a $9.60M market
 * rate was signed instantly, four years, no argument. A GM sim is a series of
 * "can I get this, and what does it cost me" — when the answer is always yes,
 * every other system stops mattering.
 *
 * Two design rules drive everything here.
 *
 * FIRST: the model is PURE. The server resolves a NegotiationContext once —
 * reservation price, personality, patience, competing offers — and hands it to
 * the client, which re-runs `evaluateOffer` on every keystroke. That is what
 * makes the interest meter move as you drag a slider instead of lagging a
 * round trip behind. Every random draw is resolved when the context is built,
 * never inside the evaluation, so the same offer always reads the same way.
 *
 * SECOND: the player's number is never shown. You get qualitative feedback and
 * have to probe for it. A visible reservation price would turn this into
 * arithmetic; hiding it is what makes it a negotiation. Patience is what stops
 * you brute-forcing the hidden number by spamming offers — and patience is
 * PERSISTED (prisma NegotiationTalks, keyed on team + player + league year),
 * because a resource that resets on F5 is not a resource. The client is told
 * what it has spent and is never asked.
 *
 * THIRD: both screens are the same negotiation, and both have a rival. The
 * re-sign window used to have none, which quietly made it a different and
 * lesser game: with nobody else bidding, the only question left was how far
 * you overpaid. It now resolves the same real, checkable suitor free agency
 * does — the same function, the same seed, the same cap-and-need test the AI
 * bids on — with the leverage scaled by how close he is to actually reaching
 * the market (`RESIGN_LEVERAGE`), and a loyalty discount that decays as that
 * window closes (`LOYALTY_WINDOW`). Both are stated in the panel before you
 * commit; neither is a hidden roll.
 */

export type Personality = 'MERCENARY' | 'LOYAL' | 'WINNER' | 'PROVE_IT';

export const PERSONALITY_LABEL: Record<Personality, string> = {
  MERCENARY: 'Business-first',
  LOYAL: 'Wants to stay',
  WINNER: 'Chasing a ring',
  PROVE_IT: 'Betting on himself',
};

export const PERSONALITY_BLURB: Record<Personality, string> = {
  MERCENARY: 'His agent talks about the market and nothing else. Money moves him; sentiment does not.',
  LOYAL: 'He wants to finish what he started here. There is a discount in that — but it is not unlimited.',
  WINNER: 'He has been asking about the roster, not the money. A contender can pay him less.',
  PROVE_IT: 'He thinks he is worth more than his tape says. Short deal, big number, and he will bet on next year.',
};

export type Verdict = 'ACCEPT' | 'CLOSE' | 'CONSIDERING' | 'COLD' | 'INSULTED';

/**
 * Where a re-sign sits on its own clock. Not flavour — it is read off the
 * contract (`yearsRemaining`), it moves the price, and the panel states which
 * one you are in before you commit.
 *
 *   WALK_YEAR   — his deal still has this season to run. Nobody may sign him,
 *                 the market is a forecast rather than a bid, and the loyalty
 *                 discount is at its largest. This is the cheap window.
 *   FINAL_CALL  — his deal is up. He is one Advance away from free agency, his
 *                 agent is already taking calls, and the discount for staying
 *                 has mostly gone.
 *
 * Free agency has no clock of this kind (he is already on the market), so it
 * is null there.
 */
export type ResignWindow = 'WALK_YEAR' | 'FINAL_CALL';

/**
 * A rival club with a real, checkable interest in this player.
 *
 * The point of this type is that every field is evidence rather than
 * atmosphere. `capSpace` and `need` come out of the same `teamCapSummary` and
 * `teamNeeds` the AI's own bidding uses, and `apy` is the number
 * `leadingCompetingBid` produces from that team's GM profile at the same seed
 * the free-agency wave will use — so a suitor named in the re-sign window is
 * the club that actually pursues him if he reaches the market, at roughly the
 * number quoted. Anything shown about a suitor must come from this object; a
 * team named without one of these behind it would be exactly the invented
 * "someone is interested" line the README's sixth design principle forbids.
 */
export interface Suitor {
  teamId: string;
  teamName: string;
  teamAbbr: string;
  /** What they would actually put on him. Their real bid, not a guess. */
  apy: number;
  /** Their room this league year, off teamCapSummary. */
  capSpace: number;
  /** Their need at his position, 0..1, off teamNeeds — the same score the AI bids on. */
  need: number;
  /** Best man they currently have there, or null if the cupboard is bare. */
  starterOvr: number | null;
}

export interface NegotiationContext {
  playerId: string;
  playerName: string;
  position: string;
  age: number;
  /** Open, honest market estimate — the same number the UI already shows. */
  marketApy: number;
  personality: Personality;
  /**
   * The APY he will actually sign for, hidden from the user. Derived from
   * market value, personality, his read of the team, and a seeded wobble so
   * two identical players don't want identical deals.
   */
  reservationApy: number;
  /** Years he wants. Age-driven: a 34-year-old is not chasing a five-year deal. */
  desiredYears: number;
  /** Share of the deal he wants guaranteed, 0..1. */
  desiredGuarantee: number;
  /**
   * How many rejected offers before he stops taking calls. How many he has
   * ALREADY had is not here — it is on the session, because it is a fact about
   * the save rather than about the man, and it is read from the database
   * rather than from the browser (see NegotiationSession.patienceSpent).
   */
  patience: number;
  /**
   * Rival interest, 0..1. Free agency has it and it rises as the window runs;
   * a re-sign before the market opens has none, which is the whole reason to
   * get ahead of it.
   */
  competition: number;
  /** True for a re-sign — unlocks the loyalty discount. */
  incumbent: boolean;
  /** Which half of the re-sign window this is. Null in free agency. */
  resignWindow: ResignWindow | null;
  /**
   * The share he is knocking off his own price to stay, 0..1, AFTER the
   * window has been applied to it. Carried on the context so the panel can
   * say out loud that the discount exists and that it is shrinking — the
   * whole "talk to him early" lesson is unlearnable if the discount is only
   * ever visible as a slightly lower hidden number.
   *
   * Deliberately reported as a BAND in the UI, never as the exact figure:
   * quoting it precisely next to the market estimate would hand over most of
   * the reservation price, and the reservation price is the thing you are
   * supposed to have to probe for.
   */
  loyaltyDiscount: number;
}

export interface Offer {
  apy: number;
  years: number;
  /** 0..1 share of total value guaranteed. */
  guaranteePct: number;
}

export interface OfferEvaluation {
  /** 0..100. What the meter shows. */
  interest: number;
  verdict: Verdict;
  /** One line in the player's voice. */
  headline: string;
  /** Concrete, actionable, and deliberately non-numeric. */
  demands: string[];
  /** True when this offer would be accepted right now. */
  accepted: boolean;
  /** Costs patience — an offer this far below is remembered. */
  insulting: boolean;
}

// --- Context construction (server side, once) -------------------------------

const PERSONALITY_WEIGHTS: Record<Personality, { money: number; years: number; guarantee: number }> = {
  // Weights sum to 1 within each row so `interest` stays on a 0-100 scale
  // whatever the personality.
  MERCENARY: { money: 0.72, years: 0.10, guarantee: 0.18 },
  LOYAL: { money: 0.50, years: 0.30, guarantee: 0.20 },
  WINNER: { money: 0.48, years: 0.22, guarantee: 0.30 },
  PROVE_IT: { money: 0.62, years: 0.26, guarantee: 0.12 },
};

/** Years a player of this age is actually chasing. */
function desiredYearsFor(age: number, personality: Personality): number {
  if (personality === 'PROVE_IT') return age >= 30 ? 1 : 2;
  if (age >= 34) return 1;
  if (age >= 32) return 2;
  if (age >= 30) return 3;
  if (age >= 27) return 4;
  return 5;
}

export function buildNegotiationContext(opts: {
  playerId: string;
  playerName: string;
  position: string;
  age: number;
  ovr: number;
  /** What the USER can see him being worth — the public estimate, scouted. */
  marketApy: number;
  /**
   * What he is ACTUALLY worth, off true ratings. Defaults to `marketApy`.
   * Split out because the reservation price has to be priced off the player
   * rather than off the buyer's read of him: a badly scouted free agent
   * should be able to want more (or less) than the number on your screen,
   * which is the whole point of having a scouting department.
   */
  trueMarketApy?: number;
  incumbent: boolean;
  /** 0..1 — how good the team is. A contender is cheaper for some players. */
  teamStrength: number;
  /** Seasons already spent with this club. Feeds the loyalty discount. */
  yearsWithTeam: number;
  /** 0..1 rival interest. Free agency should raise this as the window runs. */
  competition: number;
  /**
   * Which half of the re-sign window this is, or null in free agency. It is
   * the clock the loyalty discount decays on — see LOYALTY_WINDOW below.
   */
  resignWindow?: ResignWindow | null;
  rng: Rng;
}): NegotiationContext {
  const personality = opts.rng.weighted<Personality>({
    MERCENARY: 34,
    LOYAL: opts.incumbent ? 30 : 18,
    WINNER: 22,
    PROVE_IT: opts.age <= 27 ? 22 : 12,
  });

  let multiplier = 1;

  // --- The loyalty discount, and the clock it runs down on -----------------
  //
  // A player who is already here will take less to stay, and the longer he
  // has been here the bigger that discount — capped, because "he loves it
  // here" is not a licence to pay him nothing. A man who actively wants to
  // stay knocks off more again.
  //
  // What is new is that it DECAYS. The re-sign window used to be a flat
  // discount with no clock on it, which made "when do I do this" a question
  // with no answer: the offer you could make in week 1 of his walk year was
  // the identical offer you could make on the last screen before free agency,
  // so there was nothing to be early for and nothing to be late about. Now
  // the discount is at its full size while his deal still has a season to run
  // and mostly gone once it has actually expired, which is both what happens
  // in real football and a thing the panel can state in front of the user
  // BEFORE he commits (see NegotiationPanel's loyalty line).
  const resignWindow = opts.incumbent ? (opts.resignWindow ?? 'FINAL_CALL') : null;
  const loyaltyDiscount = opts.incumbent
    ? (Math.min(LOYALTY_TENURE_CAP, LOYALTY_BASE + opts.yearsWithTeam * LOYALTY_PER_YEAR)
        + (personality === 'LOYAL' ? LOYALTY_WANTS_TO_STAY : 0))
      * LOYALTY_WINDOW[resignWindow ?? 'FINAL_CALL']
    : 0;
  multiplier -= loyaltyDiscount;
  // Ring-chasers discount a contender and charge a rebuild a premium.
  if (personality === 'WINNER') multiplier -= (opts.teamStrength - 0.5) * 0.20;
  // He thinks he is better than his tape. That costs money.
  if (personality === 'PROVE_IT') multiplier += 0.10;
  // Mercenaries simply hold the line, and rival interest hardens everyone.
  multiplier += opts.competition * 0.12;

  // Seeded wobble so two 78-overall guards don't want the identical deal.
  multiplier *= 1 + opts.rng.float(-0.05, 0.05);

  const reservationApy = Math.max(
    CAP.MIN_SALARY,
    Math.round((opts.trueMarketApy ?? opts.marketApy) * multiplier),
  );

  // Patience: stars and contested free agents have less of it. This is the
  // resource that stops a user probing for the hidden number by spamming
  // lowballs until something sticks.
  const patience = Math.max(
    2,
    Math.round(5 - opts.competition * 2 - (opts.ovr >= 85 ? 1 : 0) + (personality === 'LOYAL' ? 1 : 0)),
  );

  return {
    playerId: opts.playerId,
    playerName: opts.playerName,
    position: opts.position,
    age: opts.age,
    marketApy: opts.marketApy,
    personality,
    reservationApy,
    desiredYears: desiredYearsFor(opts.age, personality),
    desiredGuarantee: personality === 'MERCENARY' ? 0.6 : personality === 'PROVE_IT' ? 0.35 : 0.5,
    patience,
    competition: opts.competition,
    incumbent: opts.incumbent,
    resignWindow,
    loyaltyDiscount,
  };
}

/**
 * Loyalty discount tuning. [TUNE]
 *
 * Every incumbent gets something (LOYALTY_BASE, growing with tenure to
 * LOYALTY_TENURE_CAP); a player whose personality is "wants to stay" gets
 * LOYALTY_WANTS_TO_STAY on top. LOYALTY_WINDOW is the decay: full value while
 * his contract still has a season on it, well under half of it once the deal
 * has actually expired and his agent has started taking calls.
 *
 * FINAL_CALL is not zero on purpose. He would still rather stay than move his
 * family; what he will no longer do is fund the difference himself.
 */
const LOYALTY_BASE = 0.03;
const LOYALTY_PER_YEAR = 0.015;
const LOYALTY_TENURE_CAP = 0.10;
const LOYALTY_WANTS_TO_STAY = 0.06;
export const LOYALTY_WINDOW: Record<ResignWindow, number> = { WALK_YEAR: 1, FINAL_CALL: 0.45 };

/**
 * How much of a rumoured suitor's interest actually reaches the table in a
 * re-sign, by window. [TUNE]
 *
 * Never 1: a club that cannot legally sign him today does not have the
 * leverage over you that a club bidding against you in an open market does.
 * In his walk year it is a forecast his agent files away; once his deal is up
 * it is very nearly a bid. Applied in resolveNegotiationSession, which is
 * also where the suitor is resolved.
 */
export const RESIGN_LEVERAGE: Record<ResignWindow, number> = { WALK_YEAR: 0.4, FINAL_CALL: 0.85 };

/**
 * The discount stated in words, because stating it as a percentage next to
 * the public market estimate would hand over most of the hidden reservation
 * price. A band is honest — it is derived from the real number — without
 * turning the negotiation back into arithmetic.
 */
export function loyaltyBand(discount: number): 'NONE' | 'SLIGHT' | 'REAL' | 'LARGE' {
  if (discount < 0.02) return 'NONE';
  if (discount < 0.055) return 'SLIGHT';
  if (discount < 0.10) return 'REAL';
  return 'LARGE';
}

// --- Evaluation (pure; runs on the client on every keystroke) ---------------

/**
 * Maps a ratio around 1.0 onto 0..1.
 *
 * The shortfall branch is a power curve rather than a clipped parabola, and
 * that is a UI decision as much as a modelling one. The first version used
 * `max(0, 1 - shortfall^2)`, which reaches zero at roughly two thirds of the
 * asking price and stays there — so dragging the salary slider from $2M to
 * $7M against an $11M ask moved the meter not at all. A third of the
 * control's travel was dead, which reads as a broken widget rather than as a
 * hopeless offer. A power curve never quite reaches zero, so every drag
 * produces visible movement while still making a lowball obviously hopeless.
 *
 * `tolerance` is folded into the exponent: a tighter tolerance is a steeper
 * curve, so money can stay strict while term and guarantee stay forgiving.
 */
function satisfaction(ratio: number, tolerance: number): number {
  if (ratio >= 1) return Math.min(1, 1 + (ratio - 1) * 0.25);
  const exponent = 1 + 0.6 / tolerance;
  return Math.pow(Math.max(0, ratio), exponent);
}

export function evaluateOffer(ctx: NegotiationContext, offer: Offer): OfferEvaluation {
  const w = PERSONALITY_WEIGHTS[ctx.personality];

  const moneyRatio = offer.apy / ctx.reservationApy;
  const moneyScore = satisfaction(moneyRatio, 0.35);

  // Years cut both ways: too few reads as a lack of commitment, too many is
  // fine for most and actively unwanted by a prove-it player.
  const yearsRatio = offer.years / ctx.desiredYears;
  const yearsScore =
    ctx.personality === 'PROVE_IT' && offer.years > ctx.desiredYears
      ? Math.max(0, 1 - (offer.years - ctx.desiredYears) * 0.28)
      : satisfaction(Math.min(yearsRatio, 1.15), 0.55);

  const guaranteeScore = satisfaction(offer.guaranteePct / ctx.desiredGuarantee, 0.7);

  const raw = moneyScore * w.money + yearsScore * w.years + guaranteeScore * w.guarantee;

  // A serious lowball is remembered. Below 70% of what he wants, an agent
  // stops negotiating and starts taking offence.
  const insulting = moneyRatio < 0.7;

  // An insulted player reads INSULTED, whatever the other two sliders say.
  // Without this cap, seven years and a 100% guarantee could drag a
  // 60%-of-asking offer up to a gold "Close" — with "his agent stopped
  // listening" printed directly underneath it and a two-pip price on the
  // button. Term and guarantee cannot buy their way past the money being an
  // insult, so the bar is not allowed to say they can. The cap also gives the
  // salary slider a real edge to find: the bar jumps the moment his agent
  // starts listening again.
  const interest = Math.min(
    insulting ? 44 : 100,
    Math.round(Math.max(0, Math.min(100, raw * 100))),
  );

  let verdict: Verdict;
  if (insulting) verdict = 'INSULTED';
  else if (interest >= 82) verdict = 'ACCEPT';
  else if (interest >= 68) verdict = 'CLOSE';
  else if (interest >= 45) verdict = 'CONSIDERING';
  else verdict = 'COLD';

  const demands: string[] = [];
  if (moneyScore < 0.9) {
    demands.push(
      moneyRatio < 0.7 ? 'The money is not close. His agent stopped listening.'
        : moneyRatio < 0.88 ? 'He wants noticeably more per year.'
        : 'He is looking for a little more per year.',
    );
  }
  if (yearsScore < 0.85) {
    demands.push(
      ctx.personality === 'PROVE_IT' && offer.years > ctx.desiredYears
        ? 'He does not want to be tied down this long — keep it short.'
        : offer.years < ctx.desiredYears
          ? 'He wants a longer commitment than this.'
          : 'The term is not what he had in mind.',
    );
  }
  if (guaranteeScore < 0.85) demands.push('He wants more of it guaranteed.');
  if (ctx.competition > 0.5 && interest < 82) demands.push('Other teams are calling. This will not sit on the table long.');
  if (demands.length === 0 && interest < 82) demands.push('He is close. Something small is still missing.');

  const headline =
    verdict === 'ACCEPT' ? `${ctx.playerName} will sign this.`
      : verdict === 'CLOSE' ? 'His agent says they are one small step away.'
      : verdict === 'CONSIDERING' ? 'They will take it to him, but they are not excited.'
      : verdict === 'INSULTED' ? 'His agent asked if you were serious.'
      : 'They are not engaging with this.';

  return { interest, verdict, headline, demands, accepted: verdict === 'ACCEPT', insulting };
}

/**
 * The cheapest offer he would actually sign at this length, or NULL when no
 * amount of money closes it — which is a real answer, not an edge case: a
 * prove-it player offered five years is refusing the TERM, and there is no
 * salary that fixes that. The old version bisected regardless and returned
 * three times his asking price as if that would do it, which is a number
 * nobody should ever be quoted (the Market Knowledge band is priced off this).
 *
 * Bisection because `evaluateOffer` is not trivially invertible once
 * personality weighting is applied. Monotonic in salary, so bisection is
 * sound: more money never lowers interest.
 */
export function minimumAcceptableApy(ctx: NegotiationContext, years: number, guaranteePct: number): number | null {
  let lo = 0;
  let hi = ctx.reservationApy * 3;
  if (!evaluateOffer(ctx, { apy: hi, years, guaranteePct }).accepted) return null;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (evaluateOffer(ctx, { apy: mid, years, guaranteePct }).accepted) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi);
}

// --- The gate: everything about the DEAL that isn't about the player --------

/**
 * The rules the offer has to clear that have nothing to do with whether he
 * likes it: your cap sheet, the league's term limits, and whoever else is
 * bidding. Resolved server-side alongside the context and handed to the
 * client with it, so `decideOffer` reaches the same answer in the browser as
 * it does in the Server Action — including the refusals.
 */
export interface NegotiationGate {
  capMode: CapMode;
  /** Room this deal's YEAR-1 cap hit has to fit inside. */
  capSpace: number;
  minSalary: number;
  /** Slider ceiling. Not a rule — just where the control stops. */
  maxSalary: number;
  /** Hard term limit for his age (see maxYearsForAge). */
  maxYears: number;
  /** Leading rival offer, 0 when nobody else is bidding. */
  competingApy: number;
  competingTeam: string | null;
}

/**
 * Cap accounting the user controls and the PLAYER DOES NOT JUDGE. Front- or
 * back-loading and void years change what the deal does to your books, not
 * what it pays him, so they stay out of `evaluateOffer` entirely and only
 * ever move the ledger.
 */
export interface DealStructure {
  /** <1 front-loaded, 1 flat, >1 back-loaded. */
  escalation: number;
  voidYears: number;
}

export const DEFAULT_STRUCTURE: DealStructure = { escalation: 1.12, voidYears: 0 };

/**
 * How the guarantee slider becomes a real contract.
 *
 * Guaranteed money in this schema is carried by the signing bonus, which is
 * prorated — so promising more of the deal is not free: it lowers the year-1
 * cap hit and raises the dead money you eat if you ever cut him. That is the
 * cost that stops "drag guarantee to 100%" from being the dominant move, and
 * it is the same accounting `deadMoneyOnCut` already charges everywhere else.
 */
export function contractShapeFor(offer: Offer): { bonusPct: number; guaranteedPct: number } {
  const g = Math.max(0, Math.min(1, offer.guaranteePct));
  return { bonusPct: Math.min(0.57, 0.12 + g * 0.45), guaranteedPct: g };
}

/** Why an offer can't be signed right now, other than him not wanting it. */
export type Block = 'FLOOR' | 'TERM' | 'CAP';

export interface OfferDecision {
  evaluation: OfferEvaluation;
  /** Year-1 cap hit this exact offer would carry. The number the cap gate uses. */
  year1CapHit: number;
  capHitSchedule: number[];
  totalValue: number;
  guaranteedMoney: number;
  /** What releasing him in year 1 would leave on the books. */
  deadMoneyIfCut: number;
  /** Bonus proration void years push past the end of the deal. */
  strandedVoidMoney: number;
  blocked: Block | null;
  /** A rival is offering more per year. He signs THERE, not here. */
  outbid: boolean;
  /** True only when submitting this right now signs him. */
  accepted: boolean;
  /**
   * True when a refusal is the PLAYER's — including losing the auction, since
   * his agent still had to take your offer to him to find that out. A deal
   * that busts the cap or breaks the term limit never reached him, so it
   * costs nothing.
   */
  costsPatience: boolean;
  /**
   * What submitting this costs, in pips. Lives on the decision rather than
   * being re-derived at each site because the button LABEL states the price
   * and the server CHARGES it — two places, and they may never differ.
   */
  patienceCost: number;
  /** Stated reason this can't be signed, or null when it can. */
  reason: string | null;
}

/**
 * THE decision. One function, called in exactly two places: the browser, on
 * every drag of a slider, to draw the meter; and the Server Action, on
 * submit, to decide what actually happens.
 *
 * That is the entire point of this module. Before it there were two
 * evaluators — this file's model, which nothing called, and a four-line
 * `apy >= 0.9 * market` test in lib/freeagency.ts, which the server used —
 * so the product had no negotiation in it at all. Anything that answers "will
 * he sign this?" has to come through here, or the meter starts lying.
 */
export function decideOffer(
  ctx: NegotiationContext,
  offer: Offer,
  gate: NegotiationGate,
  structure: DealStructure = DEFAULT_STRUCTURE,
): OfferDecision {
  const evaluation = evaluateOffer(ctx, offer);

  const shape = contractShapeFor(offer);
  const c = buildContract({
    apy: offer.apy,
    years: offer.years,
    signedYear: 0,
    escalation: structure.escalation,
    bonusPct: shape.bonusPct,
    guaranteedPct: shape.guaranteedPct,
  });
  const priced = { ...c, baseSalaries: JSON.stringify(c.baseSalaries), voidYears: structure.voidYears };
  const schedule = capHitSchedule(priced, gate.capMode);
  const year1CapHit = schedule[0] ?? 0;
  const totalValue = c.baseSalaries.reduce((a, b) => a + b, 0) + c.signingBonus;
  const prorationYears = Math.min(offer.years + structure.voidYears, 5);
  const strandedVoidMoney = structure.voidYears > 0
    ? Math.max(0, c.signingBonus - Math.round(c.signingBonus / prorationYears) * offer.years)
    : 0;

  let blocked: Block | null = null;
  let reason: string | null = null;
  if (offer.apy < gate.minSalary) {
    blocked = 'FLOOR';
    reason = `No contract may pay under the league minimum of ${formatMoney(gate.minSalary)}.`;
  } else if (offer.years < 1 || offer.years > gate.maxYears) {
    blocked = 'TERM';
    reason = `At ${ctx.age} the longest deal anyone may be handed is ${gate.maxYears} year${gate.maxYears === 1 ? '' : 's'}.`;
  } else if (gate.capMode !== 'OFF' && year1CapHit > gate.capSpace) {
    blocked = 'CAP';
    reason = `Year 1 costs ${formatMoney(year1CapHit)} against ${formatMoney(gate.capSpace)} of room — clear space or lower the deal.`;
  }

  // Losing an auction is not the same as being turned down. He would sign
  // this; he just has something better in front of him, which is a fact the
  // user can see (the rival's number is on screen) rather than a hidden roll.
  const outbid = !blocked && gate.competingApy > offer.apy;
  if (!reason && outbid) {
    reason = `${gate.competingTeam ?? 'Another team'} is at ${formatMoney(gate.competingApy)}/yr. Beat it or he signs there.`;
  }
  if (!reason && !evaluation.accepted) reason = evaluation.headline;

  return {
    evaluation,
    year1CapHit,
    capHitSchedule: schedule,
    totalValue,
    guaranteedMoney: c.guaranteed,
    deadMoneyIfCut: deadMoneyOnCut(priced, gate.capMode),
    strandedVoidMoney,
    blocked,
    outbid,
    accepted: evaluation.accepted && !blocked && !outbid,
    costsPatience: !blocked && !(evaluation.accepted && !outbid),
    // A lowball is remembered whether or not somebody else is bidding.
    patienceCost: !blocked && !(evaluation.accepted && !outbid) ? (evaluation.insulting ? 2 : 1) : 0,
    reason,
  };
}

/**
 * Context plus gate: everything `decideOffer` needs, resolved once on the
 * server and shipped to the client whole. The client never assembles one of
 * these itself — it could not, since the reservation price is derived from
 * ratings the user is not allowed to see.
 */
export interface NegotiationSession {
  ctx: NegotiationContext;
  gate: NegotiationGate;
  /**
   * Pips already burned against this player, this league year, by this team —
   * read from the database, not from the browser. This is what makes the loss
   * condition survive a reload: the panel opens showing what you have already
   * spent, and a negotiation you walked out of is still over when you come
   * back to it. See the NegotiationTalks model in prisma/schema.prisma.
   */
  patienceSpent: number;
  /**
   * The rival who actually wants him, or null when nobody in the league has
   * both the room and the need. In free agency this is the same club as
   * `gate.competingApy`/`competingTeam` with its evidence attached; in a
   * re-sign it is the pressure the window used to lack — a real team, checkable
   * against the rest of the league, that will be there when he hits the market.
   */
  suitor: Suitor | null;
}

/**
 * Everything about a session that can change the answer.
 *
 * The client decides against the session it was handed at page load; the
 * server re-resolves from the database at submit. Usually identical — but an
 * AI wave can move a rival's cap space, or a trade can move yours, between
 * the two. When that happens the honest move is not to quietly apply the new
 * terms (the user would be acting on a meter that was describing a different
 * negotiation) — it is to refuse, hand back the fresh session, and let the
 * meter say so. No lying metrics: README, design principle 6.
 */
export function sessionFingerprint(s: NegotiationSession): string {
  return [
    s.ctx.playerId, s.ctx.personality, s.ctx.reservationApy, s.ctx.desiredYears,
    s.ctx.desiredGuarantee.toFixed(3), s.ctx.patience, s.ctx.resignWindow ?? '-',
    s.gate.capMode, s.gate.capSpace, s.gate.minSalary, s.gate.maxYears, s.gate.competingApy,
    // The suitor is named on screen and it moves his asking price, so a suitor
    // that changed under the user is a session that moved under the user.
    s.suitor?.teamId ?? '-', s.suitor?.apy ?? 0,
  ].join('|');
  // NOT fingerprinted: `patienceSpent`. It is a ledger, not a term — it never
  // changes what `decideOffer` answers, and it necessarily differs between the
  // session the client is holding and the one the server resolves the instant
  // an offer is charged. Putting it in here would make every second offer
  // refuse itself as "the terms moved".
}

/** What a submitted offer did. Returned by both negotiation Server Actions. */
export interface NegotiationOutcome {
  ok: boolean;
  message: string;
  /**
   * Total patience burned so far, decided AND STORED by the server. The client
   * renders this rather than its own count — it has no count of its own to
   * render — so the pips and the rules never drift, and a reload cannot roll
   * them back.
   */
  patienceSpent: number;
  /** He is done talking. */
  walkedAway: boolean;
  /** He signed somewhere else. Free agency only, and it is permanent. */
  lostTo?: { teamName: string; apy: number };
  /** Fresh terms, so the meter re-syncs on every refusal. */
  session: NegotiationSession;
  /** The server's read of the offer that was just submitted. */
  decision: OfferDecision;
}
