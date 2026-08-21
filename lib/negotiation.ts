import { Rng } from './rng';

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
 * you brute-forcing the hidden number by spamming offers.
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
  /** How many rejected offers before he stops taking calls. */
  patience: number;
  /**
   * Rival interest, 0..1. Free agency has it and it rises as the window runs;
   * a re-sign before the market opens has none, which is the whole reason to
   * get ahead of it.
   */
  competition: number;
  /** True for a re-sign — unlocks the loyalty discount. */
  incumbent: boolean;
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
  marketApy: number;
  incumbent: boolean;
  /** 0..1 — how good the team is. A contender is cheaper for some players. */
  teamStrength: number;
  /** Seasons already spent with this club. Feeds the loyalty discount. */
  yearsWithTeam: number;
  /** 0..1 rival interest. Free agency should raise this as the window runs. */
  competition: number;
  rng: Rng;
}): NegotiationContext {
  const personality = opts.rng.weighted<Personality>({
    MERCENARY: 34,
    LOYAL: opts.incumbent ? 30 : 18,
    WINNER: 22,
    PROVE_IT: opts.age <= 27 ? 22 : 12,
  });

  let multiplier = 1;

  // A player who wants to stay will take less to do it, and the longer he has
  // been here the bigger that discount — but it is capped, because "he loves
  // it here" is not a licence to pay him nothing.
  if (personality === 'LOYAL' && opts.incumbent) {
    multiplier -= Math.min(0.14, 0.04 + opts.yearsWithTeam * 0.02);
  }
  // Ring-chasers discount a contender and charge a rebuild a premium.
  if (personality === 'WINNER') multiplier -= (opts.teamStrength - 0.5) * 0.20;
  // He thinks he is better than his tape. That costs money.
  if (personality === 'PROVE_IT') multiplier += 0.10;
  // Mercenaries simply hold the line, and rival interest hardens everyone.
  multiplier += opts.competition * 0.12;

  // Seeded wobble so two 78-overall guards don't want the identical deal.
  multiplier *= 1 + opts.rng.float(-0.05, 0.05);

  const reservationApy = Math.max(1, Math.round(opts.marketApy * multiplier));

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
  };
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
  const interest = Math.round(Math.max(0, Math.min(100, raw * 100)));

  // A serious lowball is remembered. Below 70% of what he wants, an agent
  // stops negotiating and starts taking offence.
  const insulting = moneyRatio < 0.7;

  let verdict: Verdict;
  if (interest >= 82) verdict = 'ACCEPT';
  else if (interest >= 68) verdict = 'CLOSE';
  else if (interest >= 45) verdict = 'CONSIDERING';
  else if (insulting) verdict = 'INSULTED';
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
 * The cheapest offer he would actually sign, used server-side to sanity-check
 * an incoming acceptance and to let AI teams negotiate against the same model
 * the user faces. Solved by bisection because `evaluateOffer` is not trivially
 * invertible once personality weighting is applied.
 */
export function minimumAcceptableApy(ctx: NegotiationContext, years: number, guaranteePct: number): number {
  let lo = 0;
  let hi = ctx.reservationApy * 3;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (evaluateOffer(ctx, { apy: mid, years, guaranteePct }).accepted) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi);
}
