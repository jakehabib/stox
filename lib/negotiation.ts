import { Rng } from './rng';
import {
  buildContract, buildExtension, capHit, capHitSchedule, CAP_GATE_TOLERANCE, deadMoneyOnCut, formatMoney,
  guaranteedMoney as totalGuaranteed,
  willingnessHorizon, strandedVoidBonus, TERM, type ContractLike,
} from './cap';
import { CAP, POSITION_AGE_PROFILE, DEFAULT_AGE_PROFILE, type Position } from './tuning';
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

/**
 * ===========================================================================
 * THE SAME MAN, AT A TABLE HE HAS NEVER SAT AT BEFORE
 * ===========================================================================
 * `PERSONALITY_BLURB` above is keyed on personality and nothing else, and one
 * of its four entries is a claim about a shared past: LOYAL reads *"He wants
 * to finish what he started here"*. Rendered over an outside free agent — a
 * man who has never played a down for this club, whose `incumbent` is false
 * and whose `loyaltyDiscount` is therefore exactly 0 — that is a sentence
 * about a relationship the save does not contain. Reproduced on a LOYAL free
 * agent in the scratch league: the panel opened with "he wants to finish what
 * he started here" over a WR the user had never employed.
 *
 * So the blurb is a function of the CONTEXT, not of the personality alone.
 * Only LOYAL differs, because only LOYAL made a claim about history; the
 * other three are facts about the man and travel unchanged.
 *
 * The incumbent line also loses its second sentence — *"There is a discount
 * in that — but it is not unlimited"* — because the panel's own discount line
 * is rendered three inches below it saying the same thing off the real
 * `loyaltyDiscount`, as a band rather than a hand-wave (NegotiationPanel's
 * EdgeLine). Two sentences about one discount, one of them measured: the
 * measured one stays. (README design principle 7.)
 */
export function personalityBlurb(ctx: Pick<NegotiationContext, 'personality' | 'incumbent'>): string {
  if (ctx.personality === 'LOYAL' && !ctx.incumbent) {
    // What LOYAL actually means about a man with no history here: he is
    // shopping for somewhere to stay, which is worth something to a club that
    // can offer it — and worth nothing yet, because he owes this one nothing.
    return 'He is looking for a place to settle rather than the highest bidder. None of that is owed to this club yet.';
  }
  if (ctx.personality === 'LOYAL') return 'He wants to finish what he started here.';
  return PERSONALITY_BLURB[ctx.personality];
}

/**
 * What the panel says about an offer.
 *
 * Two of these are DISPLAY states that `evaluateOffer` never returns, and
 * both exist for the same reason: the evaluation answers "what does he think
 * of this package", which is not the whole of "what happens if you offer it".
 *
 *   MAYBE  — inside the sign band. The evaluation would read ACCEPT or CLOSE;
 *            the band is what stops the meter promising an answer the hidden
 *            draw has not given yet.
 *   OUTBID — he likes your package and likes somebody else's more. Produced
 *            only by `decideOffer`, which is the only thing that knows a
 *            rival exists.
 */
export type Verdict = 'ACCEPT' | 'CLOSE' | 'CONSIDERING' | 'COLD' | 'MAYBE' | 'OUTBID' | 'INSULTED';

/**
 * Which of the three contract screens this negotiation is.
 *
 * All three run this same evaluator — that is the point of the type existing.
 * Extensions were the last holdout: `ExtendContractForm` had its own form and
 * `extendContract` signed whatever it was handed, so the one screen a GM
 * spends most of his time on (keeping his own good players) still had the
 * rubber stamp this module was written to remove. What differs between the
 * three is only ever the CONTEXT — who else may bid, what leverage he has,
 * what discount staying is worth — never the decision.
 *
 *   FREE_AGENT — the open market. A rival can outbid you today.
 *   RESIGN     — his deal is up or nearly up. Nobody may sign him yet, but
 *                the clock (ResignWindow) is running on your discount.
 *   EXTENSION  — he is under contract with real years left. Nobody can bid,
 *                and the years of control you hold are leverage that a man
 *                with one year left simply does not give you.
 */
export type NegotiationMode = 'FREE_AGENT' | 'RESIGN' | 'EXTENSION';

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
  /**
   * WHAT THEY WOULD ACTUALLY PUT ON HIM — the whole package, not a headline.
   *
   * A rival used to be a single number, and `decideOffer` used to compare it
   * with your salary and nothing else. That is the bug the app owner reported:
   * *"it says he WILL SIGN for X amount, but because another team is bidding,
   * he wont... maybe instead of a set $ amount, another team has a higher
   * trade score. but you can overcome that score with more guaranteed
   * money/years/salary. so it's not just raw salary"*.
   *
   * So a rival bid is an `Offer` like yours and it is SCORED like yours. All
   * three fields are what the simulation would really write if he signed
   * there: `apy` is `maxOffer` at the stable `fa-bid-<player>-<team>` seed,
   * `years` is the `suggestedYears` every AI signing uses, and `guaranteePct`
   * is the share `buildContract` locks in when the wave calls it. Nothing
   * here is invented for the panel — see lib/freeagency.ts.
   */
  apy: number;
  /** Term their signing would actually carry. `suggestedYears`, same as the wave. */
  years: number;
  /** Share of it guaranteed, 0..1. What the wave's own contract builder locks in. */
  guaranteePct: number;
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
  /**
   * What he will sign for, as far as the user can see — the same number the
   * UI already shows, and for a free agent that is his ASK rather than his
   * open-market worth (see askingPrice in lib/cap.ts). The two differ only
   * once he has been standing on the wire a while.
   */
  marketApy: number;
  /**
   * What he WAS worth before nobody called: `marketValue`, undiscounted. Equal
   * to `marketApy` for everybody under contract and for anybody just released,
   * and carried purely so the panel can say how far he has come down. A price
   * that falls silently is a mechanic the user never learns exists.
   */
  openMarketApy: number;
  personality: Personality;
  /**
   * The APY he will actually sign for, hidden from the user. Derived from
   * market value, personality, his read of the team, and a seeded wobble so
   * two identical players don't want identical deals.
   */
  reservationApy: number;
  /**
   * The term he is chasing, in seasons. Rating, the age his position makes
   * him, personality and a seeded taste — see `desiredTermFor`. It is a
   * PREFERENCE and not a limit: longer and shorter both cost money
   * (`termPremium`) and neither is refused. The only term that is refused is
   * `willingYears`, below.
   */
  desiredYears: number;
  /** Share of the deal he wants guaranteed, 0..1. */
  desiredGuarantee: number;
  /**
   * The share he will not go BELOW, 0..1 — the mirror of the money insult.
   * See `guaranteeFloorFor`. Always at or under `desiredGuarantee`: it is the
   * point at which he stops negotiating, not the point at which he is happy.
   */
  guaranteeFloor: number;
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
  /** Which screen this is. See NegotiationMode. */
  mode: NegotiationMode;
  /**
   * The league year. Part of the seed for the hidden acceptance draw, so a
   * negotiation reopened next season is genuinely a new one.
   */
  seasonYear: number;
  /**
   * Seasons still on his CURRENT deal. 0 in free agency, 0 or 1 in the
   * re-sign window, 2+ in an extension — where it is the whole of your
   * leverage, since a man you control for three more years cannot walk.
   */
  controlYears: number;
  /**
   * The deal he is already on, when there is one. Present so an EXTENSION can
   * be PRICED as what it actually is — years appended to this contract, with
   * its remaining salaries intact — rather than as a hypothetical fresh deal.
   * The cap gate and the ledger both read the appended contract, so the year-1
   * number the panel refuses on is the year-1 number the compliance check will
   * see once it is signed. Nothing secret is in here: it is the user's own
   * player's own contract.
   */
  currentContract: ContractLike | null;
  /**
   * The most seasons he will actually put his name to, and the age he does
   * not intend to play past. Derived from the retirement model the sim itself
   * rolls (lib/cap.ts willingnessHorizon) rather than invented here, because a
   * panel that says he will not play past 38 next to a sim that has him
   * playing at 41 is a lying metric. Stated in the panel BEFORE a term is
   * chosen; `decideOffer` refuses anything longer in his own voice.
   */
  willingYears: number;
  intendedFinalAge: number;
  /**
   * Half-width, in interest points, of the band around the signing threshold
   * inside which he MIGHT sign — see `signBandFor` and `bandHalfWidthFor`.
   * How narrow it is is what your front office has BOUGHT: every rank in the
   * Dynasty NEGOTIATION branch tightens it.
   */
  bandHalfWidth: number;
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
  /**
   * ===========================================================================
   * THE PART OF HIS PRICE THAT IS ABOUT *YOUR* CLUB
   * ===========================================================================
   * 0..1, and it can be NEGATIVE — a share of his asking price, positive when
   * your club is cheaper for him than a neutral one and negative when it is
   * dearer. Three things go in, and all three are already modelled:
   * `loyaltyDiscount` (he is yours and would rather stay), the extension
   * control discount (you own his next few seasons), and a WINNER's read on
   * your roster (a ring-chaser charges a rebuild a premium).
   *
   * It exists because the rival's package has to be scored on the same scale
   * as yours, and scoring it against `reservationApy` would hand the rival
   * YOUR discount: a hometown discount that a club in another state also gets
   * is not a hometown discount. So the rival is priced at
   * `reservationApy / (1 - clubDiscount)` — the neutral number, what he would
   * charge a league-average club — and the incumbent's edge in the contest
   * falls straight out of the price rather than out of a second loyalty term
   * bolted on beside it. See `rivalView`.
   *
   * Neutral rather than club-specific on the rival's side on purpose: we know
   * the suitor's cap room and its need (they are on `Suitor`), but "how much
   * would a ring-chaser knock off for THEIR roster" is a claim about a club
   * the panel is not showing a record for, and the honest default for a club
   * you are not being shown is the league average.
   * ===========================================================================
   */
  clubDiscount: number;
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
  /**
   * Less guaranteed than he will sign for. Caps interest below the band, so
   * no salary closes this offer — see `guaranteeFloorFor`. It is a refusal of
   * the STRUCTURE, not an insult, and it costs one pip rather than two.
   */
  underGuaranteed: boolean;
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

/**
 * ===========================================================================
 * WHAT THE ASK IS WORTH — THE ONE PRICE, ON BOTH SIDES OF THE TABLE
 * ===========================================================================
 * The free-agency board prints a number: "Asking $8.4M/yr" (askingPrice,
 * lib/cap.ts). Until this pass that number was an INPUT to the model and
 * nothing more — his reservation price was built off it and then pushed
 * around by personality, rival interest and a seeded wobble, and nothing
 * anywhere checked where it landed relative to the figure on screen. Measured
 * on a fresh league, across sixty free agents: offering EXACTLY the advertised
 * asking price signed 13 of 60 on the deal an AI club would write him, and 43
 * of 60 even when handed his own preferred term and the guarantee he wanted.
 * The median man wanted 1.04x the printed figure and the dearest wanted 1.44x.
 *
 * A board that quotes a price you cannot buy at is the lying-metric failure
 * this codebase treats as a bug class (README, design principle 6), so the ask
 * is now a number with a promise attached, and the promise is the strong one:
 *
 *   PAY THE ADVERTISED ASK, ON A DEAL HE HAS NO OTHER COMPLAINT ABOUT, AND HE
 *   SIGNS. Every free agent, every personality, every draw.
 *
 * That is enforced rather than hoped for. `ASK_CLOSES_AT` below divides the
 * reservation price so that the DEAREST man the draws can produce — the
 * prove-it premium, or a ring-chaser looking at a rebuild, on the top of the
 * wobble — reads exactly ACCEPT_INTEREST when handed the advertised figure.
 * Everybody else is cheaper than that, and how much cheaper is hidden, which
 * is the whole negotiation: the printed number is a price that WORKS, never a
 * price that is MINIMAL. Nothing here hands over the reservation price, and
 * the second design rule at the top of this file — the player's number is
 * never shown — is untouched.
 *
 * SO WHERE IS THE HAGGLE? Below the ask, and it is real money now rather than
 * a rounding error. A neutral free agent's certain yes lands around 0.87 of
 * the printed figure and the bottom of his "he might sign" band around 0.82,
 * so the whole stretch from about four fifths of the ask up to the ask itself
 * is a genuine gamble — which is what an agent shading his client's number
 * actually looks like, and it is where the AI's sealed-bid wave clears the
 * market. THAT IS THE POINT OF DOING IT HERE RATHER THAN IN `decideOffer`: a
 * "close enough" band bolted onto the acceptance test would be a second rule
 * about the same question, and this file already carries the scar of having
 * had two of those (see the note above `decideOffer`). Moving the ANCHOR
 * instead leaves one acceptance model, with the band it always had, sitting
 * where the number on screen says it should sit.
 *
 * AND IT IS THE SAME LINE THE AI USES. lib/freeagency.ts's wave used to throw
 * bids out under a hard-coded `market * 0.85` — a second acceptance model,
 * salary-only, with no personality, term, guarantee or band in it, which is
 * exactly the four-line test this module was written to delete. It asks
 * `leastAcceptableApy` now, which is this same curve read at the bottom of the
 * same band. Measured after the change: the 0.85 that was there for a year is
 * within a couple of points of where the model puts a neutral man's floor, so
 * the constant was never a CPU discount — it was the band bottom, written down
 * a second time, against a price that meant "what he asks" rather than "what
 * he takes".
 * ===========================================================================
 */

/** [TUNE] He thinks he is better than his tape. That costs money. */
const PROVE_IT_PREMIUM = 0.10;
/**
 * [TUNE] Full swing of a ring-chaser's read on your club, best to worst — so
 * half of it either way against a league-average roster.
 */
const WINNER_SWING = 0.20;
/**
 * [TUNE] What rival interest adds to his asking price, at full leverage. Only
 * ever applied where the rival cannot be a bid at the table — see the note at
 * the site in `buildNegotiationContext`.
 */
const COMPETITION_PREMIUM = 0.12;
/** [TUNE] Seeded wobble, either way, so two 78-overall guards differ. */
const PRICE_WOBBLE = 0.05;

/**
 * The dearest a FREE AGENT can come out of the draws above, as a share of his
 * advertised ask: the largest single premium (a prove-it man, or a ring-chaser
 * looking at the worst roster in the league — never both, they are different
 * personalities), on the high end of the wobble. Competition is absent because
 * it no longer moves an open-market price at all.
 *
 * Derived from the constants rather than typed in, so raising any of them
 * raises the headroom with it and the promise above stays true instead of
 * quietly becoming false.
 */
const ASK_HEADROOM = (1 + Math.max(PROVE_IT_PREMIUM, WINNER_SWING / 2)) * (1 + PRICE_WOBBLE);

/**
 * ===========================================================================
 * HOW LONG A DEAL HE ACTUALLY WANTS
 * ===========================================================================
 * The app owner: *"almost every player's interest declines when you offer a
 * deal over 5 years. That shouldn't be the case. I get some players want a
 * short term deal but others want long."*
 *
 * He was right, and the measurement was worse than the report. This was an
 * age ladder — 34+ wanted one year, 32 two, 30 three, 27 four, everybody else
 * five, with prove-it men on a fixed two — so five was the LONGEST TERM ANY
 * PLAYER IN THE GAME WANTED. Swept over 2,400 real players in fourteen saves,
 * offering each man his own advertised ask across terms from one to eight
 * years: 0 of 2,400 peaked above five, and all 76 of the twenty-four-year-old
 * business-first players in the sample peaked at exactly five — one answer,
 * seventy-six men. Not "almost every player": every player, and two men of the
 * same age were the same man. Re-swept after this change, 18.0% peak above
 * five, that same cell spreads across two to seven years, and no term inside a
 * man's own horizon is refused at any price — before or after.
 *
 * FOUR THINGS DECIDE IT NOW, and none of them is a ceiling.
 *
 *   QUALITY. A good player has the leverage to ask for years and a club has a
 *     reason to give them; a camp body wants to be back on the market next
 *     spring looking for a job that plays him. So the base term climbs with
 *     rating rather than sitting flat.
 *   HIS POSITION, THROUGH THE AGE HE EFFECTIVELY IS. Careers do not all bend
 *     at the same age, and this codebase already says how: POSITION_AGE_PROFILE
 *     (lib/tuning.ts) is the table the progression curve and `retirementChance`
 *     both read. A back peaks two years early and a quarterback three years
 *     late, so the same 29-year-old is 31 in one body and 26 in the other, and
 *     it is that number the appetite for years is measured against. Reusing the
 *     sim's own table rather than inventing a second one is the point: what he
 *     says he wants and what the simulation is going to do to him come from one
 *     place. `peakShift` also nudges the base directly and gently — a lean body
 *     at a technique position genuinely does sign longer deals — but the bulk
 *     of the effect is the age it makes him.
 *   WHO HE IS. A man betting on himself wants a short deal and a big number,
 *     which is the whole of that personality; a man who wants to stay reads a
 *     long deal as staying; a ring-chaser keeps his options open.
 *   TASTE. A seeded draw so two identical players differ, and — the owner's
 *     standing instruction on outliers — drawn as the average of three rolls
 *     rather than one, so it piles up near the middle and the crazy answers get
 *     less and less likely the further out they go. Nothing is truncated: a
 *     seven-year man is rare, not forbidden.
 *
 * NOT TO BE CONFUSED WITH `CONTRACT.MAX_DEAL_YEARS` (lib/tuning.ts), which is
 * still 5 and still right: that ladder is what a CLUB OFFERS — it feeds
 * `suggestedYears`, which league generation, the draft, the AI re-sign wave
 * and every AI free-agent signing write their terms from, and it is calibrated
 * to hold league-wide expiry near the real 27% a year. It does not bound what
 * a man WANTS and never reads this function.
 *
 * The gap between the two is a real lever, and a wider one than it was: 18% of
 * players are now after a term longer than five years, which no AI club will
 * ever write, and 80% want something other than the ladder's answer (65%
 * before). Handing a man his own term rather than the ladder's drops the
 * cheapest offer that closes him by a median 17% — measured over 2,400 players
 * in fourteen saves, 1,913 cheaper and not one dearer. That was already true
 * at 11% before this; the term was always worth money, it was just worth the
 * same money to everybody of the same age.
 *
 * THE ONE HARD CEILING IS HIS, NOT THE RULEBOOK'S. The result is clamped to
 * `willingnessHorizon` — the last season he means to play — because a panel
 * that says a 34-year-old is after six years while `decideOffer` refuses
 * anything past his horizon would be two sentences about one man that
 * contradict each other. There is no global maximum here on purpose: six years
 * is a hard sell for most players and an easy one for a few, which is what the
 * owner asked for, and what makes it hard is the PRICE (see `termPremium`),
 * never a rule.
 * ===========================================================================
 */
export const TERM_TASTE = {
  /**
   * [TUNE] The base term, as a function of rating: BASE at OVR_FLOOR and
   * BASE + QUALITY_SPAN at OVR_CEIL, flat outside. 3.3 to 6.3 — a fringe
   * roster player thinks in three-year deals and a star thinks in six.
   */
  BASE: 3.3,
  QUALITY_SPAN: 3.0,
  OVR_FLOOR: 55,
  OVR_CEIL: 88,
  /**
   * [TUNE] Where the appetite for years starts falling, measured on his
   * EFFECTIVE age (`age - peakShift`), and what each season past it costs.
   * 27 because that is where AGE_CURVE's growth has run out and the downslope
   * is next.
   */
  PEAK_EFFECTIVE_AGE: 27,
  PER_YEAR_PAST_PEAK: 0.6,
  /** [TUNE] The direct nudge from `peakShift`, on top of the age it makes him. */
  PER_PEAK_SHIFT: 0.15,
  /** [TUNE] What each personality adds. PROVE_IT is a multiplier instead. */
  PERSONALITY: {
    MERCENARY: 0.2,
    LOYAL: 0.7,
    WINNER: -0.45,
    PROVE_IT: 0,
  } as Record<Personality, number>,
  /**
   * [TUNE] A man betting on himself wants a fraction of the term anyone else
   * would take — and a narrower spread with it, because "short deal, big
   * number" is the whole of what he is chasing rather than a preference he
   * might land either side of.
   */
  PROVE_IT_MULT: 0.45,
  /**
   * [TUNE] Width of the per-player taste draw. Applied to the average of
   * three rolls, so this is the full span and the standard deviation is about
   * four tenths of it: a year either way is common, two is uncommon, three is
   * close to unheard of. That taper is the shape, not a clamp.
   */
  TASTE_SPREAD: 1.4,
} as const;

/**
 * The term this man is actually chasing, in seasons.
 *
 * Seeded on the player id alone — the same seed `willingnessHorizon` uses, and
 * for the same reason: what he wants out of a contract is a fact about him,
 * so the browser, the Server Action and a script have to reach the same answer
 * for the same man, and the club asking may not change it. His age moves the
 * deterministic half of it every season on its own.
 */
export function desiredTermFor(opts: {
  playerId: string;
  age: number;
  ovr: number;
  position: string;
  personality: Personality;
  /** `willingnessHorizon(...).years` — the last season he means to play. */
  horizonYears: number;
}): number {
  const T = TERM_TASTE;
  const profile = POSITION_AGE_PROFILE[opts.position as Position] ?? DEFAULT_AGE_PROFILE;

  const quality = Math.max(0, Math.min(1, (opts.ovr - T.OVR_FLOOR) / (T.OVR_CEIL - T.OVR_FLOOR)));
  const base = T.BASE + quality * T.QUALITY_SPAN;

  // The age he effectively is at this position — the same `age - peakShift`
  // the retirement roll uses, so the two agree about whose career is short.
  const effectiveAge = opts.age - profile.peakShift;
  const agePull = -Math.max(0, effectiveAge - T.PEAK_EFFECTIVE_AGE) * T.PER_YEAR_PAST_PEAK;
  const positionPull = profile.peakShift * T.PER_PEAK_SHIFT;

  const proveIt = opts.personality === 'PROVE_IT';
  const mult = proveIt ? T.PROVE_IT_MULT : 1;
  const rng = new Rng(`term-${opts.playerId}`);
  // Three rolls averaged rather than one: the middle is crowded and the tails
  // thin out, so a man who wants eight years is rare instead of impossible.
  const taste = ((rng.float(0, 1) + rng.float(0, 1) + rng.float(0, 1)) / 3 - 0.5) * 3 * T.TASTE_SPREAD * mult;

  const wanted = (base + agePull + positionPull + T.PERSONALITY[opts.personality]) * mult + taste;
  // His horizon is the ceiling, and the league rule is the ceiling on that.
  const ceiling = Math.max(1, Math.min(opts.horizonYears, TERM.MAX_CONTRACT_YEARS));
  return Math.max(1, Math.min(ceiling, Math.round(wanted)));
}

export function buildNegotiationContext(opts: {
  playerId: string;
  playerName: string;
  position: string;
  age: number;
  ovr: number;
  /** What the USER can see him signing for — the public estimate, scouted. */
  marketApy: number;
  /**
   * The same estimate WITHOUT the unsigned discount. Defaults to `marketApy`,
   * which is right for every caller whose player is on a roster — only a free
   * agent's two numbers ever differ.
   */
  openMarketApy?: number;
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
  /** Which screen. Defaults to the old two-way reading of `incumbent`. */
  mode?: NegotiationMode;
  /** League year — seeds the hidden acceptance draw. */
  seasonYear: number;
  /** Seasons still on his current deal. Leverage in an extension. */
  controlYears?: number;
  /** The deal being extended, for pricing the append. Null everywhere else. */
  currentContract?: ContractLike | null;
  /**
   * How well your staff actually know him, 0-100, straight off
   * `buildScoutedView`. It already decides how wide his rating range is
   * drawn; here it decides how wide the "he might sign" band is, so scouting
   * pays at the table as well as on the board.
   */
  scoutConfidence?: number;
  /**
   * Dynasty NEGOTIATION branch: `signBandMultFor(skills)` from lib/dynasty.ts.
   * 1 with no ranks bought. It is the ONLY thing that varies the band now —
   * see `bandHalfWidthFor`.
   */
  signBandMult?: number;
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
  const mode: NegotiationMode = opts.mode ?? (opts.incumbent ? 'RESIGN' : 'FREE_AGENT');
  // An extension is not on the re-sign clock — his deal is not ending, so
  // there is no window closing on the discount. It gets the full-size
  // loyalty figure and its own leverage term below.
  const resignWindow = mode === 'RESIGN' ? (opts.resignWindow ?? 'FINAL_CALL') : null;
  const loyaltyDiscount = opts.incumbent
    ? (Math.min(LOYALTY_TENURE_CAP, LOYALTY_BASE + opts.yearsWithTeam * LOYALTY_PER_YEAR)
        + (personality === 'LOYAL' ? LOYALTY_WANTS_TO_STAY : 0))
      * (mode === 'EXTENSION' ? 1 : LOYALTY_WINDOW[resignWindow ?? 'FINAL_CALL'])
    : 0;
  // YEARS OF CONTROL ARE LEVERAGE, and they are the only leverage an
  // extension gives you. A man with three seasons still owed cannot go
  // anywhere, cannot be bid on, and knows it; a man with one is nearly a free
  // agent. It comes off his price rather than out of his interest so it reads
  // the same way the loyalty discount does — a cheaper number, not a
  // mysteriously friendlier meter.
  const controlDiscount = mode === 'EXTENSION'
    ? Math.min(CONTROL_DISCOUNT_CAP, Math.max(0, (opts.controlYears ?? 0) - 1) * CONTROL_DISCOUNT_PER_YEAR)
    : 0;
  // Ring-chasers discount a contender and charge a rebuild a premium.
  const winnerAdjustment = personality === 'WINNER' ? (opts.teamStrength - 0.5) * WINNER_SWING : 0;
  // EVERY TERM ABOVE IS ABOUT THIS CLUB, and it is summed rather than applied
  // one at a time because the rival now has to be priced WITHOUT it — see
  // `clubDiscount` on the context and `rivalView` below. Subtracting them
  // separately, as this did, made "what would he charge somebody else" a
  // number nothing could reconstruct.
  const clubDiscount = loyaltyDiscount + controlDiscount + winnerAdjustment;
  multiplier -= clubDiscount;
  // He thinks he is better than his tape. That costs money.
  if (personality === 'PROVE_IT') multiplier += PROVE_IT_PREMIUM;
  // RIVAL INTEREST HARDENS HIM — BUT ONLY WHERE IT IS NOT ALREADY A BID.
  //
  // This used to be unconditional, and on the open market it was charged
  // twice. A contested free agent already faces `gate.rival`: a whole package
  // he SCORES on the same scale as yours (see THE CONTEST), which can and does
  // take him off you. Adding a premium to his asking price on top of that made
  // the same rival cost the user once in the price and again in the auction,
  // and it is the single biggest reason the free-agency board could print a
  // number that did not sign anybody — a man with three clubs calling wanted
  // 12% over the figure on screen AND could still be outbid at it.
  //
  // On the two incumbent screens there is no rival at the table — nobody may
  // sign a man who is under contract — so the price is the ONLY place a suitor
  // can register, which is exactly what RESIGN_LEVERAGE and `extensionLeverage`
  // scale (see resolveNegotiationSession). There it stays.
  if (mode !== 'FREE_AGENT') multiplier += opts.competition * COMPETITION_PREMIUM;

  // Seeded wobble so two 78-overall guards don't want the identical deal.
  multiplier *= 1 + opts.rng.float(-PRICE_WOBBLE, PRICE_WOBBLE);

  // ANCHORED TO THE NUMBER ON SCREEN. See WHAT THE ASK IS WORTH below.
  const reservationApy = Math.max(
    CAP.MIN_SALARY,
    Math.round((opts.trueMarketApy ?? opts.marketApy) * multiplier / ASK_CLOSES_AT),
  );

  // Patience: stars and contested free agents have less of it. This is the
  // resource that stops a user probing for the hidden number by spamming
  // lowballs until something sticks.
  const patience = Math.max(
    2,
    Math.round(5 - opts.competition * 2 - (opts.ovr >= 85 ? 1 : 0) + (personality === 'LOYAL' ? 1 : 0)),
  );

  // How long he is willing to play on for, off the same retirement model the
  // sim rolls every offseason. Not a negotiating position and not random
  // noise: it is what the simulation is going to do to him.
  const horizon = willingnessHorizon({
    playerId: opts.playerId, age: opts.age, trueOvr: opts.ovr, position: opts.position,
  });

  return {
    playerId: opts.playerId,
    playerName: opts.playerName,
    position: opts.position,
    age: opts.age,
    marketApy: opts.marketApy,
    openMarketApy: opts.openMarketApy ?? opts.marketApy,
    personality,
    reservationApy,
    desiredYears: desiredTermFor({
      playerId: opts.playerId,
      age: opts.age,
      ovr: opts.ovr,
      position: opts.position,
      personality,
      horizonYears: horizon.years,
    }),
    desiredGuarantee: personality === 'MERCENARY' ? 0.6 : personality === 'PROVE_IT' ? 0.35 : 0.5,
    guaranteeFloor: guaranteeFloorFor(opts.ovr, personality),
    patience,
    competition: opts.competition,
    incumbent: opts.incumbent,
    mode,
    seasonYear: opts.seasonYear,
    controlYears: opts.controlYears ?? 0,
    currentContract: opts.currentContract ?? null,
    willingYears: horizon.years,
    intendedFinalAge: horizon.finalAge,
    // Floored, because a band that can shrink to nothing is a solved
    // equation: at zero width the meter flips cleanly at 90 again and the
    // binary search the whole "HE MIGHT SIGN HERE" block exists to prevent is
    // back. The tree may buy you a tighter read; it may not buy you the
    // answer.
    bandHalfWidth: Math.max(
      SIGN_BAND_MIN,
      Math.round(bandHalfWidthFor(opts.scoutConfidence ?? 100) * (opts.signBandMult ?? 1)),
    ),
    resignWindow,
    loyaltyDiscount,
    clubDiscount,
  };
}

/**
 * ===========================================================================
 * GUARANTEED MONEY HAS A FLOOR
 * ===========================================================================
 * The app owner: *"guaranteed money seems to not really impact player favor
 * which it does in real life. It's fine if it's lower or higher for some but
 * it should have sooome impact"*.
 *
 * It already moved the meter — 18 to 30 points across a 0-to-100% sweep. The
 * problem was never the slope, it was the BASELINE. Measured at his exact
 * asking price with the term matched and NOTHING guaranteed, four
 * personalities read 70, 80, 82 and 88: comfortably signable. So guaranteeing
 * nothing was the optimal play and the slider was decoration, which is
 * backwards from the sport — a star does not put his name to a big deal with
 * no money locked in, at any salary.
 *
 * The fix is the mirror of the one money already had. A lowball is capped at
 * 44 interest however good the other terms are (`insulting`, below); a deal
 * with less locked in than he will accept is capped the same way, and for the
 * same reason: term and salary may not buy their way past a term he has
 * refused outright. Below his floor there is no price that signs him, which
 * `minimumAcceptableApy` reports honestly as "no price closes this" rather
 * than by quoting a number.
 *
 * WHOSE FLOOR IS WHAT. Two things move it, both of them the real ones:
 *
 *   QUALITY. Nobody guarantees a backup anything, and everybody guarantees a
 *     star something. It is zero up to GUARANTEE_FLOOR_DEPTH_OVR — which is 72
 *     because that is already this codebase's line for "an acceptable
 *     starter" (lib/ai/gm.ts, teamNeeds) rather than a number invented here —
 *     and climbs to GUARANTEE_FLOOR_ELITE by GUARANTEE_FLOOR_ELITE_OVR. So a
 *     67-overall depth guard has no floor at all and will still sign a deal
 *     with nothing locked in, and a 90 wants half of it in writing.
 *   PERSONALITY. A business-first player wants it in writing; a man betting on
 *     himself is the one who genuinely does not care, because his whole plan
 *     is to play this deal out and re-price himself. PROVE_IT caring least is
 *     the point.
 *
 * It is always at or below `desiredGuarantee` — the floor is where he stops
 * listening, not where he is happy — and never above GUARANTEE_FLOOR_CAP, so
 * an even split always clears it.
 *
 * AND THE COUNTERWEIGHT STAYS. `contractShapeFor` still turns guarantee into
 * signing bonus, which still prorates, which still becomes real dead money if
 * you cut him. Guarantee mattering MORE to him while costing MORE to you is
 * the tension a real contract has; making it matter more without the cost
 * would just move the dominant strategy rather than remove it.
 * ===========================================================================
 */
const GUARANTEE_FLOOR_ELITE = 0.45;
const GUARANTEE_FLOOR_ELITE_OVR = 85;
const GUARANTEE_FLOOR_DEPTH_OVR = 72;
const GUARANTEE_FLOOR_CAP = 0.5;
const GUARANTEE_FLOOR_PERSONALITY: Record<Personality, number> = {
  MERCENARY: 1.15,
  LOYAL: 0.9,
  WINNER: 1,
  PROVE_IT: 0.55,
};

/** The share he will not go below, 0..1. Pure, so the sweep can walk it. */
export function guaranteeFloorFor(ovr: number, personality: Personality): number {
  const quality = Math.max(0, Math.min(1,
    (ovr - GUARANTEE_FLOOR_DEPTH_OVR) / (GUARANTEE_FLOOR_ELITE_OVR - GUARANTEE_FLOOR_DEPTH_OVR)));
  const raw = quality * GUARANTEE_FLOOR_ELITE * GUARANTEE_FLOOR_PERSONALITY[personality];
  // Rounded to whole percent: the guarantee control is whole percent on both
  // the slider and the typed field, so a floor of 0.3162 would be a boundary
  // no control in the game can actually sit on.
  return Math.min(GUARANTEE_FLOOR_CAP, Math.round(raw * 100) / 100);
}

/**
 * What a deal under his floor is capped at, in interest points. [TUNE]
 *
 * Below the "he might sign" stretch at every scouting confidence — its floor
 * is ACCEPT_INTEREST - MAYBE_WIDTH_UNKNOWN = 65 at worst — because the claim
 * is that no salary signs this, and the meter may not imply otherwise. Above
 * the money insult's 44, because it is a smaller failing: the offer is real,
 * the structure is not.
 */
const UNDER_GUARANTEED_CAP = 62;

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
 * [TUNE] What a year of contractual control is worth off his asking price in
 * an extension, and the ceiling on it. Two years left is a small nudge; four
 * is the whole cap. It never applies in free agency or a re-sign, because in
 * neither of those do you hold anything over him.
 */
const CONTROL_DISCOUNT_PER_YEAR = 0.035;
const CONTROL_DISCOUNT_CAP = 0.10;

/**
 * How much of a rumoured suitor's interest reaches an EXTENSION table, given
 * you still hold him for `controlYears` seasons. [TUNE]
 *
 * Ceilinged at the walk-year figure and divided by the years you control:
 * with two seasons still owed a rival club is a rumour his agent files away,
 * with four it is barely worth mentioning. Same shape as RESIGN_LEVERAGE and
 * for the same reason — nobody may bid on a man under contract, so this can
 * only ever move his asking price, never `gate.rival`.
 */
export function extensionLeverage(controlYears: number): number {
  return RESIGN_LEVERAGE.WALK_YEAR / Math.max(1, controlYears);
}

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

/**
 * ===========================================================================
 * HAS HIS ASK ACTUALLY COME DOWN, OR HAS IT JUST ROUNDED DOWN
 * ===========================================================================
 * The panel used to decide this with `ctx.openMarketApy > ctx.marketApy` and
 * then tell a story: *"Asking $13.6M/yr, down from $13.7M"* — a story about
 * nobody returning a man's calls, over a $100K step.
 *
 * Measured on the scratch league's free agents: `unsignedAskMultiplier` is
 * 0.997 at one week on the wire, so a $13.7M ask becomes $13.7M — and once
 * `askingPrice` rounds to the nearest $100K, the first week produces either
 * no change at all or exactly one step of it, depending on where the
 * unrounded figure happened to sit. One tick of rounding is not a market
 * telling you something; it is the same number, printed twice, with a
 * sentence between them.
 *
 * So the claim has a size. It has to clear BOTH a share and a floor: 5% is
 * about four weeks unsigned (the multiplier is 0.95 there), and $500K is five
 * of the rounding steps that produced the false positive, so a minimum-salary
 * body cannot trip it on a rounding artefact either.
 *
 * REJECTED: keying it on `weeksUnsigned` instead. That is not on the context
 * — and it would answer a different question anyway. What the line claims is
 * that the number came down, so the test has to be that the number came down.
 * ===========================================================================
 */
export const ASK_FALL_SHARE = 0.05;
export const ASK_FALL_FLOOR = 500_000;

export function askHasFallen(ctx: Pick<NegotiationContext, 'marketApy' | 'openMarketApy'>): boolean {
  const fall = ctx.openMarketApy - ctx.marketApy;
  return fall >= ASK_FALL_FLOOR && fall >= ctx.openMarketApy * ASK_FALL_SHARE;
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
/**
 * BEATING HIS ASK HAS TO BE WORTH SOMETHING.
 *
 * This branch read `Math.min(1, 1 + (ratio - 1) * 0.25)`, which computes a
 * bonus for exceeding what he asked for and then clamps it straight back off:
 * the expression can never return anything but 1. Every axis saturated the
 * instant it met his number, so going past it did nothing at all.
 *
 * The app owner hit it on guarantee, and that is where it bites hardest:
 * `desiredGuarantee` is 0.5-0.6, well inside the slider's travel, so dragging
 * it past about half moved the meter not one point. Measured on a real free
 * agent, 60/75/90/100% guaranteed all read 81. Now they read 81/82/83/84.
 *
 * Salary and term saturate the same way, but at their own asks, so the dead
 * zone there starts higher: 110% of the asking price already reads 96 and 125%
 * reads 100. Worth fixing all the same — the interest number is what
 * `winsContest` compares, so any flat region is a stretch where paying more
 * cannot win a contested free agent. Note the ceiling is still 100 either way;
 * this widens where the meter responds, it does not remove the top.
 *
 * Capped rather than unbounded, because a man is not four times happier for
 * four times the money — this is the shape of a diminishing return, not a
 * removal of the ceiling. [TUNE] 1.2 means the very best offer he could be
 * handed is worth about a fifth more to him than simply meeting his number.
 */
const OVERSHOOT_CREDIT = 0.25;
const OVERSHOOT_MAX = 1.2;

/**
 * [TUNE] How forgiving each axis is below its own ask, as the exponent of the
 * shortfall curve. Money is the strict one; term and guarantee are looser
 * because the price already carries most of both preferences.
 *
 * MONEY_TOLERANCE is named rather than typed inline because it is now read
 * twice: here, to draw the curve, and by `askRatioForInterest` below, which
 * INVERTS it. The reservation price is anchored off that inversion, so a
 * change to this number moves what the advertised asking price buys — see
 * WHAT THE ASK IS WORTH, above `buildNegotiationContext`.
 */
const MONEY_TOLERANCE = 0.35;
const TERM_TOLERANCE = 0.55;
const GUARANTEE_TOLERANCE = 0.7;

function satisfaction(ratio: number, tolerance: number): number {
  if (ratio >= 1) return Math.min(OVERSHOOT_MAX, 1 + (ratio - 1) * OVERSHOOT_CREDIT);
  const exponent = 1 + 0.6 / tolerance;
  return Math.pow(Math.max(0, ratio), exponent);
}

/**
 * The inverse of the money curve: the share of what he is asking that reads
 * as exactly this much interest, on a deal he has no OTHER complaint about —
 * his own term, the guarantee he wants. `satisfaction` with those two at 1.0
 * leaves `interest = 100 * moneyScore`, so the whole meter reduces to the
 * money axis and this is a closed form rather than a search.
 *
 * It exists because two things in this codebase have to agree about what a
 * PRICE means, and they used to be written down separately:
 *
 *   - the reservation price, which is anchored so that the asking price the
 *     free-agency board prints reads a certain yes (see WHAT THE ASK IS
 *     WORTH); and
 *   - the least he will sign for, which lib/freeagency.ts's sealed-bid wave
 *     throws AI bids out under (`leastAcceptableApy`).
 *
 * Both are this function at a different interest level. Move ACCEPT_INTEREST
 * or MONEY_TOLERANCE and both move together, which is the property that was
 * missing when the wave carried its own hard-coded 0.85.
 */
export function askRatioForInterest(interest: number): number {
  const target = Math.max(0, Math.min(100, interest)) / 100;
  // 1 / exponent, where exponent = 1 + 0.6 / MONEY_TOLERANCE.
  return Math.pow(target, MONEY_TOLERANCE / (MONEY_TOLERANCE + 0.6));
}

/**
 * How many seasons this offer actually ties him to the club.
 *
 * The same number everywhere it matters — the player's own view of the term,
 * the league's 12-year ceiling and his willingness horizon — because those
 * three disagreeing about what "the term" is would be three different bugs.
 * On an extension it is the add-on plus the years already owed; everywhere
 * else the offer is the whole contract.
 */
export function committedTerm(ctx: NegotiationContext, offer: Offer): number {
  return offer.years + (ctx.mode === 'EXTENSION' ? ctx.controlYears : 0);
}

/**
 * The term the panel should open on: the offer that commits him for exactly
 * as long as he wants to be committed.
 *
 * The inverse of `committedTerm`, and it exists because the two were not
 * inverses. The panel opened on `ctx.desiredYears` flat, which on an EXTENSION
 * is the size of the ADD-ON — so a man with three seasons owed who wanted six
 * years of commitment was opened on a six-year add-on, nine years committed,
 * three past his own answer, and charged the term premium for it before the
 * user had touched a control. Harmless while nobody wanted more than five;
 * not harmless now that `desiredTermFor` can hand back eight.
 */
export function openingTermFor(ctx: NegotiationContext, maxYears: number): number {
  const owed = ctx.mode === 'EXTENSION' ? ctx.controlYears : 0;
  const ceiling = Math.max(1, Math.min(maxYears, ctx.willingYears - owed));
  return Math.max(1, Math.min(ceiling, ctx.desiredYears - owed));
}

/**
 * [TUNE] How far the term component can drag interest down on its own. The
 * price carries the preference now; this is the residue.
 */
const TERM_SCORE_FLOOR = 0.62;

/**
 * [TUNE] What a year away from his preferred term costs, as a share of his
 * asking price, per year, capped.
 *
 * Both directions, because both are real. Asking a man who wants a short
 * prove-it deal to lock in five years costs you a premium — he is selling the
 * upside of hitting the market again. Asking a man who wants five years to
 * take two costs you a premium too — he is giving up security, and the years
 * he does get have to be worth more.
 *
 * The owner's own figure: "if a player wants a short term deal you might need
 * to pay 5-10% more for a longer term and vice versa." LONGER_PER_YEAR is set
 * so the first extra year lands inside that range and the curve flattens,
 * because the third extra year is not three times the imposition of the first.
 */
const TERM_PREMIUM = {
  LONGER_PER_YEAR: 0.055,
  SHORTER_PER_YEAR: 0.045,
  MAX: 0.28,
} as const;

/**
 * The multiplier on his asking price for a term that is not the one he wants.
 * 1.0 at exactly his preferred term, rising in both directions, and steeper
 * for a prove-it player because getting back to the market sooner is the
 * whole point of the deal he is chasing.
 */
export function termPremium(ctx: NegotiationContext, committedYears: number): number {
  const off = committedYears - ctx.desiredYears;
  if (off === 0) return 1;
  const proveIt = ctx.personality === 'PROVE_IT' ? 1.6 : 1;
  const perYear = off > 0
    ? TERM_PREMIUM.LONGER_PER_YEAR * proveIt
    : TERM_PREMIUM.SHORTER_PER_YEAR;
  // Square-root taper: the first year away costs the most, and a man does not
  // ask for six times the money to go from two years to eight.
  const raw = perYear * Math.sqrt(Math.abs(off));
  return 1 + Math.min(TERM_PREMIUM.MAX, raw);
}

export function evaluateOffer(ctx: NegotiationContext, offer: Offer): OfferEvaluation {
  const w = PERSONALITY_WEIGHTS[ctx.personality];

  // AN EXTENSION IS JUDGED ON THE TOTAL. `offer.years` there is the size of
  // the ADD-ON — the number he negotiates — but what he is agreeing to is
  // being tied to this club for the add-on PLUS everything already on his
  // deal. A 33-year-old with two years left taking four more is committing
  // through 39, and it is that figure he has an opinion about.
  const committedYears = committedTerm(ctx, offer);

  // TERM IS A PREFERENCE WITH A PRICE, NOT A RULE.
  //
  // It used to be a rule, and the rule was unsignable. A prove-it player's
  // term score was `1 - (extraYears * 0.28)`, which hits ZERO four years past
  // what he wants — so his interest was capped by a term component no amount
  // of money could move. Measured on a real save: a 97-overall receiver
  // asking $31.1M over 2 years, offered the slider maximum of $51.0M over 12
  // years with 100% guaranteed, came out at interest 74 and REFUSED, while
  // the same money over his own 2 years read 100. Only 5.2% of the whole
  // slider grid closed him. That is the app owner's report exactly: "I
  // offered a maxed out contract to someone and they still wouldn't say yes
  // or no", and his diagnosis of it — "These should be player preferences and
  // not rules" — is the fix.
  //
  // So term now moves what he ASKS FOR rather than gating whether he can be
  // signed: a man who wants two years will do five for a raise, and a man who
  // wants five will take two if you make the years he does get worth it. His
  // own words: "if a player wants a short term deal you might need to pay
  // 5-10% more for a longer term and vice versa."
  //
  // WHICH ONLY MATTERS IF THE PREFERENCE ITSELF VARIES, and for a while it
  // did not: `desiredYears` was an age ladder that topped out at five, so
  // "the term he wants" was the same answer for every man of a given age and
  // the price rose past five years for all of them at once. It is a real
  // per-player draw now — see `desiredTermFor` — which is what makes this
  // paragraph true rather than merely intended.
  //
  // The one genuinely hard limit stays hard, and it is his, not the
  // rulebook's: `willingYears` — he does not intend to play past a certain
  // age, and no price buys a year he does not want to be alive for in this
  // sport. That refusal lives in `decideOffer` and is untouched.
  const askApy = ctx.reservationApy * termPremium(ctx, committedYears);
  const moneyRatio = offer.apy / askApy;
  const moneyScore = satisfaction(moneyRatio, MONEY_TOLERANCE);

  // What is LEFT for the term component to say, once the price has absorbed
  // the preference: a little, so the slider still reads as meaningful, but
  // never enough to refuse a deal on its own. Floored deliberately — this
  // component's job is now flavour, and a flavour component that can zero out
  // is a rule wearing a preference's clothes.
  //
  // SYMMETRIC, AND IT USED NOT TO BE. This was `satisfaction(min(ratio, 1.15))`,
  // which on the overshoot branch RETURNS A BONUS: a man who wanted two years
  // and was handed twelve scored 1.0375 on term — fractionally HAPPIER about
  // being locked up for a decade than about getting the deal he asked for. It
  // also made the "too long" demand line unreachable, because that line is
  // gated on `yearsScore < 0.85` and the score could never fall below 1 above
  // his own term. So the one direction the app owner reported on was the one
  // direction the model scored as a small positive and the panel never
  // mentioned. Distance from his term now reads the same either way, on the
  // same curve and against the same floor.
  const yearsRatio = committedYears / ctx.desiredYears;
  const termFit = yearsRatio <= 1 ? yearsRatio : Math.max(0, 2 - yearsRatio);
  const yearsScore = Math.max(TERM_SCORE_FLOOR, satisfaction(termFit, TERM_TOLERANCE));

  const guaranteeScore = satisfaction(offer.guaranteePct / ctx.desiredGuarantee, GUARANTEE_TOLERANCE);

  const raw = moneyScore * w.money + yearsScore * w.years + guaranteeScore * w.guarantee;

  // A serious lowball is remembered. Below 70% of what he wants, an agent
  // stops negotiating and starts taking offence.
  const insulting = moneyRatio < 0.7;

  // Less locked in than he will sign for. Not an insult — the money may be
  // perfectly good — but a refusal no salary answers. See the GUARANTEED
  // MONEY HAS A FLOOR block above.
  const underGuaranteed = offer.guaranteePct < ctx.guaranteeFloor;

  // An insulted player reads INSULTED, whatever the other two sliders say.
  // Without this cap, seven years and a 100% guarantee could drag a
  // 60%-of-asking offer up to a gold "Close" — with "his agent stopped
  // listening" printed directly underneath it and a two-pip price on the
  // button. Term and guarantee cannot buy their way past the money being an
  // insult, so the bar is not allowed to say they can. The cap also gives the
  // salary slider a real edge to find: the bar jumps the moment his agent
  // starts listening again.
  //
  // THE GUARANTEE FLOOR IS THE SAME DEVICE, one step milder. Under it the bar
  // is held below the "he might sign" band at every scouting confidence, so no
  // salary and no term can carry an offer he has refused on structure — and
  // the bar jumps the same way the moment the guarantee clears his floor.
  const interest = Math.min(
    insulting ? 44 : underGuaranteed ? UNDER_GUARANTEED_CAP : 100,
    Math.round(Math.max(0, Math.min(100, raw * 100))),
  );

  // Tied to ACCEPT_INTEREST rather than to a second copy of the number, which
  // is how the meter and the decision drift apart. ACCEPT here means CERTAIN:
  // an offer below it can still be signed on the draw inside the band.
  let verdict: Verdict;
  if (insulting) verdict = 'INSULTED';
  else if (interest >= ACCEPT_INTEREST) verdict = 'ACCEPT';
  else if (interest >= CLOSE_INTEREST) verdict = 'CLOSE';
  else if (interest >= CONSIDERING_INTEREST) verdict = 'CONSIDERING';
  else verdict = 'COLD';

  const demands: string[] = [];
  if (moneyScore < 0.9) {
    demands.push(
      moneyRatio < 0.7 ? 'The money is not close. His agent stopped listening.'
        : moneyRatio < 0.88 ? 'He wants noticeably more per year.'
        : 'He is looking for a little more per year.',
    );
  }
  // THE TERM SAYS SOMETHING IN BOTH DIRECTIONS NOW, and what it says is the
  // reason the model actually used. Dragging the term past what he wants moves
  // his asking price (`termPremium`) and nothing else, so for a whole release
  // the only feedback a user got for a deal that was too long was the MONEY
  // line — "he wants noticeably more per year" — over an offer whose salary he
  // had not complained about. Measured on a 25-year-old receiver at exactly his
  // reservation price: five years read 100 with no demands, twelve read 86 with
  // "He wants noticeably more per year" and not one word about the term that
  // caused it. That is the lying-metric failure this codebase treats as a bug
  // class (README design principle 6), and it is most of why the effect read as
  // inexplicable rather than as a price.
  if (yearsScore < 0.85) {
    demands.push(
      committedYears < ctx.desiredYears
        ? 'He wants a longer commitment than this. The years he does get have to be worth more.'
        : ctx.personality === 'PROVE_IT'
          ? 'He is betting on himself and wants back on the market. Tying him up this long costs a good deal more per year.'
          : 'That is more seasons than he asked to be tied up for. He will do it — the years past what he wanted have to be paid for.',
    );
  }
  // NOT A DEMAND WHEN HE IS UNDER HIS FLOOR, and that is a deletion rather
  // than an oversight. The panel already says that refusal twice at the point
  // where it can be acted on: the headline below reads "His agent wants it in
  // writing. He is not signing this on a handshake", and the line under the
  // guarantee control itself says what to do about it. A third copy in the
  // demand list — *"He will not sign a deal this size on a promise"* — was
  // the same claim a third time, in the one list on this panel that is
  // supposed to be the things he still wants MORE of.
  if (!underGuaranteed && guaranteeScore < 0.85) {
    demands.push('He wants more of it guaranteed.');
  }
  if (ctx.competition > 0.5 && interest < ACCEPT_INTEREST) demands.push('Other teams are calling. This will not sit on the table long.');
  // `!underGuaranteed`: an offer he has refused on structure is not "close",
  // and without this guard removing the demand above would have handed the
  // fallback to exactly the offer it is most wrong about.
  if (demands.length === 0 && !underGuaranteed && interest < ACCEPT_INTEREST) {
    demands.push('He is close. Something small is still missing.');
  }

  const headline =
    verdict === 'ACCEPT' ? `${ctx.playerName} will sign this.`
      : verdict === 'INSULTED' ? 'His agent asked if you were serious.'
      // In HIS voice, and it is the whole reason this offer cannot be signed —
      // so it is said instead of the generic line for the verdict, which would
      // read as "not excited" about a deal he has actually refused.
      : underGuaranteed ? 'His agent wants it in writing. He is not signing this on a handshake.'
      : verdict === 'CLOSE' ? 'His agent says they are one small step away.'
      : verdict === 'CONSIDERING' ? 'They will take it to him, but they are not excited.'
      : 'They are not engaging with this.';

  return { interest, verdict, headline, demands, accepted: verdict === 'ACCEPT', insulting, underGuaranteed };
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

/**
 * ===========================================================================
 * THE LEAST HE WILL PUT HIS NAME TO
 * ===========================================================================
 * The bottom of the "he might sign" band, in dollars, for a given package.
 * `minimumAcceptableApy` above is the TOP of the same band — the cheapest
 * CERTAIN yes — and the two are the same curve read at two interest levels.
 *
 * This exists because lib/freeagency.ts needs it. The AI's sealed-bid wave has
 * to answer "is this bid a real bid" a hundred times a week across thirty-one
 * clubs, and it used to answer with `market * 0.85`: a salary-only ratio with
 * no personality, no term, no guarantee and no band in it, sitting a file away
 * from the model that decides the identical question for the user. Two
 * evaluators is one more than a game may have — the note above `decideOffer`
 * says so, and it was true of the wave the whole time it said it. So the wave
 * asks this now, and the line an AI bid has to clear is the line the user's
 * meter draws.
 *
 * NULL IS A REAL ANSWER and it means what it does everywhere else in this
 * file: no salary closes this package. A deal under his guarantee floor is
 * capped below the band (see UNDER_GUARANTEED_CAP), so a club offering it is
 * not underbidding, it is offering a structure he has refused — and a caller
 * that treated null as "free" would have the AI signing men on terms the
 * user's own panel says are unsignable.
 *
 * Monotonic in salary, so bisection is sound, and pure in every input, so the
 * figure a wave enforces is the figure a panel would have drawn.
 * ===========================================================================
 */
export function leastAcceptableApy(ctx: NegotiationContext, years: number, guaranteePct: number): number | null {
  const bandBottom = ACCEPT_INTEREST - ctx.bandHalfWidth;
  const listens = (apy: number) => evaluateOffer(ctx, { apy, years, guaranteePct }).interest >= bandBottom;
  let lo = 0;
  let hi = ctx.reservationApy * 3;
  if (!listens(hi)) return null;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (listens(mid)) hi = mid; else lo = mid;
  }
  return Math.ceil(hi);
}

// --- The band: where "will he sign?" stops having a clean answer ------------

/**
 * ===========================================================================
 * "HE MIGHT SIGN HERE"
 * ===========================================================================
 * The meter used to be an oracle. `accepted` flipped at exactly 82 interest,
 * so the optimal play was to binary-search that number and pay it, every
 * time, forever. The app owner named it: *"The breakpoints on the contract
 * interest meter are great, but around the breakpoint to sign lets have some
 * mystery like 'he might sign here' so that way players can't always just pay
 * the bare minimum"*.
 *
 * So there are three regions instead of two — he will not, he might, he will
 * — and the middle one is REAL. This is the part that decides whether the
 * feature is a mechanic or a lie: `decideOffer` genuinely does not accept
 * every offer inside the band. If the band were a display state over a
 * deterministic yes, the panel would be over-stating its own uncertainty,
 * which is the same bug class as under-stating it (README, design principle
 * 6). The draw below is what the server actually acts on.
 *
 * IT CANNOT BE RE-ROLLED. The draw is seeded on the player, the league year
 * and the EXACT offer — nothing else. Three consequences, all deliberate:
 *
 *   - Submitting the identical offer twice gives the identical answer. There
 *     is no "refuse, resubmit, hope" strategy, which would have been a worse
 *     calculator than the one this replaces. He said no and he means it: the
 *     same money will not sign him again this league year, and no wording in
 *     the panel may imply that waiting might change that.
 *   - Moving the offer at all — a hundred thousand dollars, one point of
 *     guarantee — draws a fresh hidden value. Exploration is therefore
 *     possible but never free: every different offer he turns down costs a
 *     pip, and patience is the resource that was already there for exactly
 *     this.
 *   - Patience spent is deliberately NOT in the seed. It is a value that can
 *     legitimately differ between the session the client is holding and the
 *     row the server reads, and anything that can drift may not be allowed to
 *     decide acceptance, or the meter and the server would disagree for
 *     reasons neither can show the user.
 *
 * It survives a reload and a walk-out for free, because there is nothing to
 * survive: the answer is a pure function of facts already in the database.
 * ===========================================================================
 */
/**
 * The regions the panel draws.
 *
 * NO / MAYBE / YES are about the PLAYER and come out of `signBandFor`.
 * LOSING is about the CONTEST and is produced only by `decideOffer`, which is
 * the only thing that knows a rival exists — see THE CONTEST below. It is in
 * this union rather than in a second flag beside it because it is the same
 * question: what happens if you offer this. A screen that drew a band from
 * one answer and a warning from another is exactly the bug this replaces.
 */
export type SignBand = 'NO' | 'MAYBE' | 'YES' | 'LOSING' | 'BLOCKED';

/** The interest at which he used to flip from no to yes. Now the centre of the band. */
/**
 * WHERE A CERTAIN YES BEGINS, and it is deliberately expensive.
 *
 * The band used to be symmetric around 82, so a certain yes and a probable
 * one sat the same distance apart on both sides and the top of the meter was
 * hard to reach: at low scouting confidence YES needed 94, and a genuinely
 * generous offer could still read "might". The app owner asked for the shape
 * directly — *"maybe we make the 'might sign' from, for example, a score of
 * 65-85 on the meter?"*, then *"or maybe 65-90?"* — and gave the reason:
 * *"i want the user to have to pay a bit of a tax for getting the guaranteed
 * yes."*
 *
 * So the regions are asymmetric now. He MIGHT sign across a wide stretch, and
 * the gap between "he will probably take this" and "he will certainly take
 * this" is real money. Buying certainty is a choice with a price, which is
 * what a negotiation is.
 */
export const ACCEPT_INTEREST = 90;

/**
 * ===========================================================================
 * THE TICKS ON THE METER ARE THE DECISION'S OWN NUMBERS
 * ===========================================================================
 * `evaluateOffer` wrote `interest >= 72` and `interest >= 45` as literals, and
 * `InterestMeter` drew its three tick marks off `const THRESHOLDS = [45, 72,
 * 90]` under a comment claiming "these are the same numbers, and they move
 * together". They were not the same numbers — they were four literals and a
 * copy of ACCEPT_INTEREST in a different file, and nothing made either half
 * follow the other. Move CLOSE to 70 and the meter's tick stays at 72: the
 * bar changes colour a pixel and a half from where the mark says it will,
 * which is this project's recurring bug (a displayed number that is not the
 * number the system used) drawn at 1.5px.
 *
 * So there is one declaration and the meter reads it. Anything that draws the
 * scale must import INTEREST_TICKS rather than write the numbers down again.
 */
export const CONSIDERING_INTEREST = 45;
export const CLOSE_INTEREST = 72;
/** CONSIDERING, CLOSE and a certain yes, in the order they are crossed. */
export const INTEREST_TICKS: number[] = [CONSIDERING_INTEREST, CLOSE_INTEREST, ACCEPT_INTEREST];

/**
 * The divisor that makes the advertised asking price a price that signs him —
 * see WHAT THE ASK IS WORTH, above `buildNegotiationContext`, for the whole
 * argument. Two factors, and both have to be there:
 *
 *   ASK_HEADROOM      so the DEAREST draw still closes at the printed figure,
 *                     rather than the median one.
 *   the accept ratio  because meeting his reservation price exactly is not a
 *                     certain yes — ACCEPT_INTEREST is 90, not 100, and the
 *                     money curve says that is 96.2% of what he is asking.
 *
 * Declared down here, a long way from the constants it reads and the function
 * that uses it, for one boring reason: it is initialised from ACCEPT_INTEREST
 * and from MONEY_TOLERANCE, and a module-level const may not be built out of
 * one that has not been reached yet. `buildNegotiationContext` only ever reads
 * it when it is CALLED, by which time every declaration in the file has run.
 */
const ASK_CLOSES_AT = ASK_HEADROOM * askRatioForInterest(ACCEPT_INTEREST);

/**
 * [TUNE] What the salary control opens on, as a share of what a NEUTRAL free
 * agent would certainly sign for.
 *
 * The rule has not changed — a shade under his number, so the first drag is a
 * decision rather than a formality — but what "his number" MEANS has. It used
 * to be nine tenths of the public market estimate, which was fine while the
 * estimate sat somewhere above his real price and nothing checked where.
 * Anchoring the reservation to the advertised ask put the estimate above every
 * player's yes instead, and nine tenths of it became a certain YES for 62 of
 * 140 free agents on a fresh league — the rubber stamp this panel exists to
 * remove, wearing a slider. Measured at 0.90x the ask: 62 certain yes, 61 in
 * the band, 17 short.
 *
 * So it opens at nine tenths of the ANCHORED price instead — the same nine
 * tenths, applied to the number the model actually uses. Measured at the
 * resulting 0.78x the ask: 0 certain yes, 31 in the band, 109 short. Not a
 * lowball (nobody's agent is insulted by it; the insult line is well below),
 * and never a free signing.
 */
const OPENING_BID_SHARE = 0.9;

/**
 * Where the salary control opens for this man. Public in every input: his
 * advertised estimate and two constants. It may not be built out of
 * `reservationApy` however convenient that would be — the slider's starting
 * position is on screen, and a starting position derived from the hidden
 * number would hand the hidden number over.
 */
export function openingBidApy(ctx: NegotiationContext): number {
  return Math.round((ctx.marketApy * OPENING_BID_SHARE) / ASK_HEADROOM);
}

/**
 * [TUNE] How far below a certain yes the "he might sign" stretch reaches.
 *
 * ===========================================================================
 * WHAT NARROWS THE BAND — AND IT IS NO LONGER SCOUTING
 * ===========================================================================
 * This used to read "scouting still narrows it, because how well you know a
 * man is exactly how well you can price him", and it was true when scouting
 * fog covered everybody. It does not any more: fog is DRAFT PROSPECTS ONLY,
 * so every free agent and every incumbent arrives at `scoutConfidence = 100`
 * and this function returns MAYBE_WIDTH_SCOUTED — 12, a flat 78-90 — for the
 * entire league, for ever. The confidence parameter still exists because
 * prospects still have one, and because the two ends of the curve are what
 * the number 12 MEANS; it simply no longer varies at the negotiating table.
 *
 * The variation comes from the Dynasty NEGOTIATION branch instead, which is
 * where the app owner put it: *"the negotiating tree should be about
 * signings. Each point up to the 3 abilities narrows the uncertainty band."*
 * `signBandMultFor` in lib/dynasty.ts is keyed on TOTAL ranks bought in the
 * branch, so every purchase pays; `buildNegotiationContext` multiplies this
 * width by it and floors the result at SIGN_BAND_MIN.
 *
 *   0 ranks  78-90      3 ranks  81-90
 *   1 rank   79-90      4 ranks  82-90
 *   2 ranks  80-90      5 ranks  83-90
 *
 * A comment that still described the old mechanism would be exactly the
 * defect that hid a twelve-man defence in this codebase for months, so it is
 * written down here rather than left to be inferred from a constant.
 * ===========================================================================
 */
const MAYBE_WIDTH_SCOUTED = 12;
const MAYBE_WIDTH_UNKNOWN = 25;

/**
 * [TUNE] The narrowest the band may ever be, in interest points. A floor, not
 * a target: see the note in `buildNegotiationContext`.
 */
const SIGN_BAND_MIN = 5;

export function bandHalfWidthFor(scoutConfidence: number): number {
  const known = Math.max(0, Math.min(100, scoutConfidence)) / 100;
  return Math.round(MAYBE_WIDTH_UNKNOWN - (MAYBE_WIDTH_UNKNOWN - MAYBE_WIDTH_SCOUTED) * known);
}

/**
 * The three regions, as the meter draws them. `bandHalfWidth` is the width of
 * the MAYBE stretch BELOW the certain-yes line — it stopped being a half-width
 * when the band stopped being symmetric, and the name is kept only because it
 * is on the context and read in several places.
 */
export function signBandFor(ctx: NegotiationContext, interest: number): SignBand {
  // Never returns LOSING: it does not take a gate and therefore cannot know
  // there is anybody else at the table. `decideOffer` overrides it.
  if (interest >= ACCEPT_INTEREST) return 'YES';
  if (interest >= ACCEPT_INTEREST - ctx.bandHalfWidth) return 'MAYBE';
  return 'NO';
}

/** Where in the band this offer sits, 0..1. Never rendered as a number. */
export function maybeChance(ctx: NegotiationContext, interest: number): number {
  const lo = ACCEPT_INTEREST - ctx.bandHalfWidth;
  const span = Math.max(1, ctx.bandHalfWidth);
  return Math.max(0, Math.min(1, (interest - lo) / span));
}

/**
 * The hidden draw. Pure, seeded, and identical in the browser and in the
 * Server Action — see the block above for why it is seeded on exactly these
 * three things and on nothing else.
 */
function acceptanceRoll(ctx: NegotiationContext, offer: Offer): number {
  return new Rng([
    'sign', ctx.playerId, ctx.seasonYear,
    Math.round(offer.apy), Math.round(offer.years), Math.round(offer.guaranteePct * 1000),
  ].join('-')).next();
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
  /**
   * THE CLUB'S ROOM THIS SEASON, off `teamCapSummary`, with nothing folded
   * into it. NEGATIVE when the club is over the cap, and that sign is the
   * whole reason it is kept separate from the credit below — see
   * `capCreditBack`.
   */
  capSpace: number;
  /**
   * WHAT THIS SEASON ALREADY COSTS FOR THIS MAN — the cap hit on the contract
   * he is on right now, which the club stops paying the moment this deal
   * replaces or absorbs it. Zero on the open market, where there is no old
   * deal to credit.
   *
   * THIS USED TO BE ADDED INTO `capSpace` AND SHIPPED AS ONE NUMBER, and that
   * is the bug. `year1CapHit > capSpace + oldHit` is algebraically the right
   * test — it rearranges to `newHit - oldHit > room` — but written that way
   * the SIGN of the change is invisible at the place that has to test it, and
   * the sign is what decides. `assertCapRoom` lets any move through that adds
   * nothing (`if (delta <= 0) continue`); this gate could not, because over
   * the cap `room` is negative, so an extension that LOWERED a man's hit by
   * $9.56M still failed `-9.56M > -12.0M` and was refused — with the panel
   * beside it printing the saving. Measured on 20 clubs put $12.0M over: 3,803
   * of 3,990 offers that lower or hold the club's commitment were blocked.
   * That is the app owner's report exactly — *"trying to extend someone and it
   * not allowing it. Even tho the game says it will reduce his cap hit"*.
   *
   * Kept apart, `decideOffer` can ask the two questions the enforcement asks:
   * does this ADD money, and if so does the added money fit.
   */
  capCreditBack: number;
  /**
   * ---------------------------------------------------------------------
   * THE BONUS THE OLD DEAL LEAVES BEHIND WHEN THIS ONE TEARS IT UP.
   * ---------------------------------------------------------------------
   * Zero on the open market, zero on an extension, and zero on any deal that
   * APPENDS — every one of those either has no old contract or carries its
   * unamortised bonus forward into the new row (`buildExtension`). It is
   * non-zero on exactly one shape: a WALK-YEAR RE-SIGN, where the deal has
   * run out (`yearsRemaining === 0`), `extendContract` takes its replace
   * branch, and the bonus that no season ever billed accelerates onto this
   * season as a `CapCharge` the instant the new deal is signed.
   *
   * IT HAS TO BE HERE BECAUSE THE GATE IS A PROMISE. `decideOffer` refuses
   * on `year1CapHit - capCreditBack`, and the server refuses on
   * `newHit + stranded - oldHit`. Those were the same test only while the
   * stranded figure was zero — which is every deal WITHOUT void years on it,
   * which is why nothing surfaced this. Measured on a 3-year deal with two
   * void years and $18.0M of bonus, fully played:
   *
   *     the meter said the re-sign added   $833K
   *     the server charged                 $8.03M
   *     the difference                     $7.20M — the whole stranded bonus
   *
   * With the club's room squeezed between the two, the panel showed no cap
   * block at all and the submit came back "Re-signing blocked by the salary
   * cap — adds $7.97M against $4.43M of room": a refusal quoting a figure the
   * screen beside it had never shown. That is the lying metric in the one
   * place it costs a save — a GM planning his re-signs against a number the
   * game does not charge.
   *
   * The stranded bonus is what makes letting a man walk expensive, and it is
   * booked identically by every other exit from that contract — the tag, the
   * cut, the trade and the walk itself (see KEEPING HIM MUST NOT BE CHEAPER
   * THAN LOSING HIM, lib/freeagency.ts). The re-sign is the fourth, and this
   * is what puts it on the meter as well as on the ledger.
   */
  capAcceleratesOnReplace: number;
  minSalary: number;
  /** Slider ceiling. Not a rule — just where the control stops. */
  maxSalary: number;
  /**
   * The LEAGUE's term limit — flat 12 for everybody (see maxYearsForAge).
   * It used to be an age ladder; the age part of it belongs to the player now
   * and lives on the context as `willingYears`, so a refusal on term is his
   * refusal, in his voice, and not the rulebook's.
   */
  maxYears: number;
  /**
   * The club bidding against you today, with the PACKAGE it is offering —
   * null when nobody is. Only ever populated on the open market: nobody may
   * sign a player who is under contract to you, so a re-sign or an extension
   * gate carries null here and the suitor's pressure reaches those tables as
   * asking price and patience instead (RESIGN_LEVERAGE, extensionLeverage).
   *
   * It is an `Offer`, not a number, because the player scores it the way he
   * scores yours. See `Suitor` and `rivalView`.
   */
  rival: RivalBid | null;
}

/** A rival's live bid: who, and exactly what they are putting on the table. */
export interface RivalBid {
  teamName: string;
  offer: Offer;
}

/**
 * ===========================================================================
 * THE CONTEST — one decision, not two
 * ===========================================================================
 * The app owner, looking at a live panel that showed a red "Washington
 * Sentinels is in the mix at ~$12.7M/yr — you have to beat that", a "Beat
 * Sentinels — $13.1M/yr" chip, and directly underneath both of them an
 * interest meter reading 95 · WILL SIGN · "Dante Boone will sign this.":
 *
 *   *"this also contradicts itself as a bug. it says he WILL SIGN for X
 *   amount, but because another team is bidding, he wont. that should talk
 *   with each other, maybe instead of a set $ amount, another team has a
 *   higher trade score. but you can overcome that score with more guaranteed
 *   money/years/salary. so it's not just raw salary"*
 *
 * He is describing a defect with a precise shape, and the shape is the point.
 * The old line was:
 *
 *     const outbid = !blocked && gate.competingApy > offer.apy;
 *
 * A raw dollar comparison computed entirely independently of the meter. The
 * evaluation weighed salary, term, guarantee and personality and reached 95;
 * then a separate line compared two APY numbers and said he was going
 * elsewhere. Neither knew the other existed, so the panel printed both. That
 * is the same failure as a table contradicting its own footnote, and README
 * design principle 6 rules it out.
 *
 * WHAT REPLACES IT. A rival's bid is a PACKAGE the player scores, exactly the
 * way he scores yours:
 *
 *   1. `gate.rival.offer` is a real `Offer` — apy, years, guaranteePct — built
 *      in lib/freeagency.ts out of the same wave logic that would actually
 *      sign him (`maxOffer` at the `fa-bid-` seed, `suggestedYears`, the share
 *      `buildContract` locks in). Not invented in the panel, and not invented
 *      here.
 *   2. It goes through `evaluateOffer` and comes back as interest on the SAME
 *      0-100 scale as yours.
 *   3. You keep him when your interest clears his. One comparison, one
 *      answer, and the meter and the rival warning are now literally the same
 *      computation — so they cannot disagree.
 *
 * WHY IT IS NOT LITERALLY `evaluateOffer(ctx, rivalOffer)`. `ctx.reservationApy`
 * is HIS PRICE FOR YOU. It already carries the hometown discount, the years of
 * control you hold and a ring-chaser's read on your roster (`clubDiscount`).
 * Handing the rival that same price would hand the rival your hometown
 * discount, which is the one thing a hometown discount cannot be. So the rival
 * is scored against the neutral price — `rivalView` below — and the incumbent's
 * edge in the contest is nothing more than the discount that was already on
 * the context. There is exactly one loyalty concept in this file and this is
 * it.
 *
 * AND IT MAY NOT BECOME A NEW SOURCE OF VARIANCE. Everything here is
 * deterministic: the rival's package is a fact of the session (and is
 * fingerprinted, so a bid that moved under the user refuses rather than
 * re-prices), and none of it touches `acceptanceRoll`, whose seed is still the
 * player, the league year and your offer and nothing else. Read the "HE MIGHT
 * SIGN HERE" block above: a rival that entered the seed would make the hidden
 * draw re-rollable by waiting for the market to move, which is precisely what
 * that block exists to prevent.
 * ===========================================================================
 */

/**
 * [TUNE] How much better your package has to read than the rival's, in
 * interest points, before he actually chooses you.
 *
 * A dead heat is not a win. Two packages he cannot separate give him no
 * reason to pick you, and the alternative — tossing a coin — is exactly the
 * re-rollable variance the "HE MIGHT SIGN HERE" block above forbids, since it
 * would be a draw the user could re-run by nudging a slider and coming back.
 * So the rival holds the tie and you have to be visibly better.
 *
 * Small, though. The substantive incumbent edge is already in the PRICE
 * (`clubDiscount`), and stacking a second, invisible loyalty bonus on top of
 * it would make the contest unlosable for reasons the panel could not state.
 * Around here a point of interest is worth roughly 0.6% of his asking price,
 * so two points is a fraction of a percent of salary.
 */
export const CONTEST_MARGIN = 2;

/**
 * The player as a RIVAL club sees him: same man, same preferences, same
 * personality weights — neutral price.
 *
 * Only `reservationApy` and the flags that describe your relationship with him
 * move. Everything else is a fact about the player and travels unchanged,
 * which is what makes the two interest numbers comparable at all.
 *
 * The division is the exact inverse of the subtraction in
 * `buildNegotiationContext`: his price for you is the neutral price less
 * `clubDiscount`, so the neutral price is his price for you divided by
 * `1 - clubDiscount`. Clamped because `clubDiscount` is a share and a
 * denominator near zero would produce a number that is not a contract.
 */
export function rivalView(ctx: NegotiationContext): NegotiationContext {
  const neutral = Math.max(0.5, Math.min(1.5, 1 - ctx.clubDiscount));
  return {
    ...ctx,
    reservationApy: Math.max(CAP.MIN_SALARY, Math.round(ctx.reservationApy / neutral)),
    // He is not their incumbent either, and nobody holds contractual control
    // of him at a club he has not signed for. Both only matter to callers that
    // read the context; the evaluation itself reads neither.
    incumbent: false,
    loyaltyDiscount: 0,
    clubDiscount: 0,
    controlYears: 0,
    currentContract: null,
    // An extension is priced against a deal only YOU hold. What the rival is
    // putting on the table is a fresh contract, so the years in their offer
    // are the whole of the term he would be committing to.
    mode: 'FREE_AGENT',
  };
}

/** How the player reads the rival's package. Null when nobody is bidding. */
export function evaluateRival(
  ctx: NegotiationContext, gate: NegotiationGate,
): { teamName: string; offer: Offer; interest: number } | null {
  if (!gate.rival) return null;
  return {
    teamName: gate.rival.teamName,
    offer: gate.rival.offer,
    interest: evaluateOffer(rivalView(ctx), gate.rival.offer).interest,
  };
}

/**
 * THE comparison. Exported because the panel draws the rival's mark on the
 * same track as your bar, and a second copy of this arithmetic in the
 * component is how the two would drift apart again.
 *
 * NOTHING BEATS A PERFECT OFFER, and that clause is load-bearing rather than
 * flattering. Interest is clamped at 100, so a rival whose package he cannot
 * fault reads 100 — and so does yours, however far past his asking price you
 * go. Without this the margin above could never be cleared and the man would
 * be unsignable at any salary, any term and any guarantee, with the panel
 * unable to name a single thing that would help. That is the app owner's
 * older report exactly — *"I offered a maxed out contract to someone and they
 * still wouldn't say yes or no"* — and it was measured happening here: a free
 * agent reading 100 against a rival reading 100, with all three "what would
 * beat them" routes returning nothing.
 *
 * Monotone in your own interest either way, which the sweep requires: more
 * money can never turn a win into a loss.
 */
export function winsContest(yourInterest: number, rivalInterest: number): boolean {
  if (yourInterest >= 100) return true;
  return yourInterest >= rivalInterest + CONTEST_MARGIN;
}

/**
 * ===========================================================================
 * WHAT WOULD BEAT THEM
 * ===========================================================================
 * *"you can overcome that score with more guaranteed money/years/salary. so
 * it's not just raw salary"*.
 *
 * The old chip put `competingApy * 1.03` in the salary box, because salary
 * was the only thing the comparison looked at. Now that the rival is a score,
 * three different moves can win, they cost you completely different things,
 * and which one is cheapest depends on the man — a business-first player
 * weights guarantee at 0.18 and a ring-chaser at 0.30, so the same $1M of
 * locked-in money is worth nearly twice as much interest to one as the other.
 * Finding that is the front-office decision the panel was flattening into a
 * salary bump.
 *
 * So this returns the minimum move in EACH dimension, on its own, from the
 * offer currently on the table, that both wins the contest and closes the
 * deal outright — `signBand === 'YES'`, a certain yes, not a coin flip.
 * Anything weaker would put a chip on screen labelled "beat them" that leaves
 * him refusing, which is the contradiction this whole pass removes.
 *
 * Null in a dimension means that dimension alone cannot do it: 100%
 * guaranteed is still not enough, or no legal term is, or the salary slider
 * does not reach. That is a real answer and the panel prints nothing for it
 * rather than a chip that would not work.
 *
 * IT ANSWERS FOR THE PLAYER, NOT FOR YOUR CAP SHEET. Whether you can afford
 * the suggestion is the ledger's question and the panel already answers it in
 * two places the moment a chip is pressed — the salary control's "over your
 * room by X" and the button's "Not enough cap room". Folding the cap gate in
 * here would mean building a contract per probe, which is a hundred times the
 * work for an answer the next frame states anyway.
 *
 * PURE, and deliberately NOT part of `decideOffer`. It costs on the order of a
 * hundred evaluations and `decideOffer` runs a million times in the agreement
 * sweep and once per animation frame in the browser; the panel calls this from
 * a memo keyed on the offer instead.
 * ===========================================================================
 */
export interface BeatPlan {
  /** Rival interest this is measured against, on the player's own scale. */
  rivalInterest: number;
  /** Cheapest salary that closes it at the current term and guarantee. */
  apy: number | null;
  /** Cheapest guaranteed share that closes it at the current salary and term. */
  guaranteePct: number | null;
  /** Nearest term that closes it at the current salary and guarantee. */
  years: number | null;
  /**
   * Which of the three costs you least in cash committed over the deal, ties
   * broken toward the move that commits none. Guarantee usually wins that
   * test and it is not a free lunch — it becomes signing bonus, which
   * prorates, which is real dead money if you ever cut him. The panel says so
   * beside the chip.
   */
  cheapest: 'APY' | 'GUARANTEE' | 'YEARS' | null;
}

/** Does this exact offer both win the auction and close him outright? */
function closes(ctx: NegotiationContext, offer: Offer, rivalInterest: number): boolean {
  if (committedTerm(ctx, offer) > ctx.willingYears) return false;
  const interest = evaluateOffer(ctx, offer).interest;
  return signBandFor(ctx, interest) === 'YES' && winsContest(interest, rivalInterest);
}

export function beatRival(ctx: NegotiationContext, offer: Offer, gate: NegotiationGate): BeatPlan | null {
  const rival = evaluateRival(ctx, gate);
  if (!rival) return null;
  const r = rival.interest;

  // SALARY. Monotonic in money — more never reads worse — so bisection is
  // sound, and it is walked on the $100K grid the slider and the typed field
  // both snap to, because a suggestion the controls cannot express is not a
  // suggestion.
  let apy: number | null = null;
  if (closes(ctx, { ...offer, apy: gate.maxSalary }, r)) {
    let lo = gate.minSalary;
    let hi = gate.maxSalary;
    while (hi - lo > 100_000) {
      const mid = Math.round((lo + hi) / 2 / 100_000) * 100_000;
      if (mid <= lo || mid >= hi) break;
      if (closes(ctx, { ...offer, apy: mid }, r)) hi = mid; else lo = mid;
    }
    apy = closes(ctx, { ...offer, apy: lo }, r) ? lo : hi;
  }

  // GUARANTEE. Also monotonic, and the control is whole percent on both the
  // slider and the field, so the answer is walked in whole percent.
  let guaranteePct: number | null = null;
  for (let g = Math.ceil(offer.guaranteePct * 100); g <= 100; g++) {
    if (closes(ctx, { ...offer, guaranteePct: g / 100 }, r)) { guaranteePct = g / 100; break; }
  }

  // TERM. NOT monotonic in either direction — moving toward the term he wants
  // lowers his asking price (`termPremium`) and moving away from it raises
  // his asking price, so both a longer and a shorter deal can be the answer
  // and neither can be bisected. Twelve legal terms is a scan, and the one
  // that wins with the smallest change to what is on the table is the one
  // worth suggesting.
  let years: number | null = null;
  let bestShift = Infinity;
  for (let y = 1; y <= gate.maxYears; y++) {
    if (y === offer.years) continue;
    if (!closes(ctx, { ...offer, years: y }, r)) continue;
    const shift = Math.abs(y - offer.years);
    if (shift < bestShift) { bestShift = shift; years = y; }
  }

  // WHAT DOES IT COST YOU. Plain cash committed over the deal, against what
  // the offer already on the table commits. Guarantee moves no cash at all,
  // which is exactly why it is worth surfacing — and exactly why the panel
  // has to print the dead money beside it.
  const committed = offer.apy * offer.years;
  const options: { key: 'APY' | 'GUARANTEE' | 'YEARS'; cost: number }[] = [];
  if (guaranteePct !== null) options.push({ key: 'GUARANTEE', cost: 0 });
  if (apy !== null) options.push({ key: 'APY', cost: Math.max(0, apy * offer.years - committed) });
  if (years !== null) options.push({ key: 'YEARS', cost: Math.max(0, offer.apy * years - committed) });
  options.sort((a, b) => a.cost - b.cost);

  return { rivalInterest: r, apy, guaranteePct, years, cheapest: options[0]?.key ?? null };
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
  /**
   * ON A DEAL THAT APPENDS: how much of the salary he is ALREADY OWED this
   * season is turned into signing bonus, 0..1 of what may legally be moved
   * (`convertibleBase` — everything above the league minimum). Ignored
   * entirely on a fresh contract, where there is no owed salary to convert.
   *
   * THIS IS NOT THE GUARANTEE SLIDER, though both end up moving money into a
   * signing bonus. `contractShapeFor(offer).bonusPct` splits the NEW money he
   * is being promised; this moves money the club already owes him THIS SEASON
   * out of a year it cannot afford and into a bonus that prorates across the
   * years just added. Different money, different season, and only one of them
   * is why a club extends a man in the first place.
   *
   * OPTIONAL, and where it is absent `DEFAULT_CONVERT_PCT` applies — read in
   * exactly two places, `decideOffer` and `negotiateOffer`, which are the
   * meter and the write. Optional rather than required so the two screens that
   * build their own structure without knowing this exists (SignOfferForm,
   * ResignRow) keep compiling AND keep getting the same arithmetic on both
   * sides of the submit button.
   */
  convertPct?: number;
}

/**
 * WHAT A NEGOTIATED EXTENSION CONVERTS WHEN NOBODY SAYS OTHERWISE: all of it.
 *
 * This is the fix to the reported bug, and it is a constant rather than
 * `buildExtension`'s own default for a reason measured in sim:health — see the
 * conversion block above `buildExtension` in lib/cap.ts. The short version:
 * this default belongs to deals a GM negotiates on a screen that shows him the
 * later years and the dead money, not to the AI's re-sign budgeter, which
 * prices year one and nothing else and ran its clubs $21.5M over the cap two
 * seasons later when it was handed the same instrument.
 *
 * Read by `decideOffer` (the meter) and by `negotiateOffer` (the write). Those
 * two and no others, so a screen that has never heard of this — the re-sign
 * list, free agency — cannot end up drawing one contract and signing another.
 */
export const DEFAULT_CONVERT_PCT = 1;

export const DEFAULT_STRUCTURE: DealStructure = { escalation: 1.12, voidYears: 0, convertPct: DEFAULT_CONVERT_PCT };

/**
 * Force an offer into the legal range, whatever it arrived as.
 *
 * Exists because the panel grew typed number fields beside its sliders — the
 * app owner asked for them: *"on the contracts, allow us to type in the
 * numbers in case the sliders aren't granular enough"* — and a text field can
 * hold things a range input cannot: empty, negative, `1e9`, `NaN`, letters. A
 * slider could only ever produce a value between its ends; typing has to be
 * given the same guarantee explicitly, and it has to be the SAME guarantee,
 * or the meter would be drawn for one offer and the server handed another.
 *
 * Pure and exported rather than living in the component so the sweep in
 * scripts/checkNegotiationAgreement.ts can generate the widened state space
 * typed entry opens up and check the clamp is closed under it.
 */
export function clampOffer(offer: Offer, gate: NegotiationGate): Offer {
  const num = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
  const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    apy: Math.round(clampTo(num(offer.apy, gate.minSalary), gate.minSalary, gate.maxSalary)),
    years: Math.round(clampTo(num(offer.years, 1), 1, gate.maxYears)),
    guaranteePct: clampTo(num(offer.guaranteePct, 0), 0, 1),
  };
}

/**
 * How the guarantee slider becomes a real contract.
 *
 * It moves two things at once. More guarantee means a bigger share of the deal
 * paid as signing bonus, which lowers the year-1 cap hit — and it means more
 * of his base salary locked in, which the club owes whether he is on the
 * roster or not. Both land on `deadMoneyOnCut`, so promising more is never
 * free: it is precisely the cost that stops "drag guarantee to 100%" from
 * being the dominant move, and it is the same accounting charged everywhere
 * else in the game.
 *
 * The bonus floor is 12% at a zero guarantee, so even the meanest offer hands
 * over some cash the club cannot claw back — `buildContract` stores that as
 * the guarantee rather than letting the panel print "$0 guaranteed" over it.
 */
export function contractShapeFor(offer: Offer): { bonusPct: number; guaranteedPct: number } {
  const g = Math.max(0, Math.min(1, offer.guaranteePct));
  return { bonusPct: Math.min(0.57, 0.12 + g * 0.45), guaranteedPct: g };
}

/**
 * Why an offer can't be signed right now.
 *
 * FLOOR/TERM/CAP are the ledger's refusals — they never reached him and cost
 * nothing. WILLING is HIS refusal, and it is here rather than in the
 * evaluation because it is absolute: no amount of money buys a season he does
 * not intend to play. It is stated in the panel before the term is chosen, so
 * it is a limit the user can see rather than a rejection they walk into.
 */
export type Block = 'FLOOR' | 'TERM' | 'WILLING' | 'CAP';

export interface OfferDecision {
  evaluation: OfferEvaluation;
  /**
   * Year-1 cap hit this exact offer would carry. NOT the number the cap gate
   * uses on a man already on the books — see `capDelta`, which is.
   */
  year1CapHit: number;
  /**
   * ===========================================================================
   * WHAT THIS DEAL ADDS TO THIS SEASON — the one figure the cap turns on, and
   * the only one anything may subtract from the club's room.
   * ===========================================================================
   * `year1CapHit`, less the hit on the deal it replaces or absorbs, plus
   * whatever that deal STRANDS when it is torn up (`capCreditBack` and
   * `capAcceleratesOnReplace` on the gate). It is exactly the `delta`
   * `assertCapRoom` is handed on the way in, which is why it is computed once,
   * here, and carried out rather than reassembled by each screen.
   *
   * IT IS CARRIED BECAUSE A SCREEN REASSEMBLED IT AND GOT IT WRONG.
   * `useNegotiation` drew its "Cap space after" as
   * `gate.capSpace - decision.year1CapHit`, which was right for exactly as long
   * as `capSpace` had the incumbent's hit folded into it — and it stopped
   * having it the day the credit was split out into its own field (see
   * `capCreditBack`). After that the line charged the club the whole new hit
   * against room that no longer contained the old one: the incumbent's cap hit,
   * double-counted, on the primary contract screen in the game.
   *
   * MEASURED, on a man carrying a $22.8M hit with two years left, extended at
   * $24.0M/yr for three more, at a club with $72.7M of room:
   *
   *     "Cap space after" on the panel     $61.2M
   *     the ledger, after actually signing $84.0M
   *     -------------------------------------------
   *     wrong by                           $22.8M   — his whole cap hit
   *
   * And wrong in the direction that stops a GM making the move: the extension
   * FREES $11.3M, and the panel showed it costing $11.5M.
   */
  capDelta: number;
  capHitSchedule: number[];
  /** Everything the resulting contract is worth — on an extension, old years included. */
  totalValue: number;
  /**
   * The value of the years being ADDED. Identical to `totalValue` on a fresh
   * deal; on an extension it is the "4 years, $120M" figure he negotiated,
   * which is a different and smaller number than the contract's total. Both
   * are carried so neither screen has to guess which one it is holding.
   */
  newMoneyValue: number;
  /** Length of the resulting contract — add-on plus existing years on an extension. */
  contractYears: number;
  /**
   * ===========================================================================
   * WHERE THE YEARS YOU ARE BUYING START IN `capHitSchedule`
   * ===========================================================================
   * 0 on a fresh deal. On one that appends it is the index of the first NEW
   * year, and it comes straight off `buildExtension`, which is the function
   * that writes the contract.
   *
   * The panel used to mark the added years with `i >= ctx.controlYears`, which
   * is a SECOND rule for the same boundary. `buildExtension` computes its own
   * as `remainingBases.length` — the stored base salaries from the elapsed
   * year onward, PADDED up to `yearsRemaining` and never truncated to it. The
   * two agree on every deal this league generates, because a well-formed
   * contract row has one base salary per year. They are not the same rule: a
   * row carrying more bases than the years it has left (an older save, a
   * hand-edited row, any future path that shortens a deal without trimming the
   * array) appends after the extra ones, and the panel would highlight the
   * wrong pills — telling a GM he is buying a season he was already owed.
   *
   * One rule, computed by the writer, read by the reader.
   */
  firstNewYearIndex: number;
  guaranteedMoney: number;
  /**
   * ===========================================================================
   * WHAT THIS SEASON COSTS TODAY, SO THE PANEL CAN SHOW BEFORE AND AFTER
   * ===========================================================================
   * The cap hit the club is ALREADY carrying for him this year, off the
   * contract he is on — null when he is not on one (free agency, where there
   * is no "before" and the only honest figure is what the deal costs).
   *
   * It is on the decision rather than computed by the panel from
   * `ctx.currentContract` because `year1CapHit` beside it is computed here,
   * and a before/after pair assembled from two different places is how this
   * screen ships a delta that does not subtract. The pair is the whole point:
   * a beta tester extended a man to lower his cap hit, watched it rise, and
   * only found out after he had committed.
   *
   * NOT `gate.capSpace`, which is not the club's cap room — it adds the
   * incumbent's hit back because the signing replaces his deal (see
   * resolveNegotiationSession). This is his HIT, which that credit is made of,
   * and it is the same number `assertCapRoom` credits back on the way in.
   */
  currentYearHitBefore: number | null;
  /**
   * Base salary this deal moves out of THIS season and into the signing bonus,
   * and the most it could have moved. Both zero on a fresh contract and on a
   * man already on a league-minimum base — which is exactly the case where an
   * extension raises his hit and cannot lower it, and the case the panel has
   * to be able to explain BEFORE he signs.
   */
  salaryConverted: number;
  convertibleBase: number;
  /** What releasing him in year 1 would leave on the books. */
  deadMoneyIfCut: number;
  /** Bonus proration void years push past the end of the deal. */
  strandedVoidMoney: number;
  blocked: Block | null;
  /**
   * A rival's PACKAGE reads better to him than yours. He signs there, not
   * here. Not a salary comparison — see THE CONTEST above.
   */
  outbid: boolean;
  /**
   * What he thinks of the rival's package, 0-100, on the identical scale as
   * `evaluation.interest`. Null when nobody is bidding. On the decision rather
   * than re-derived in the panel because the meter draws the rival's mark on
   * the same track as your bar, and two copies of one number is how a screen
   * comes to contradict itself.
   */
  rivalInterest: number | null;
  /**
   * What happens if you offer this, as the panel draws it: he will not, he
   * might, he will — or LOSING, which is none of the three because it is not
   * about him at all. `accepted` below is the answer, and inside the band the
   * panel must not show it: that is the whole mechanic.
   *
   * LOSING outranks the other three deliberately. Drawing the band from his
   * opinion of your package while a separate flag said he was signing
   * elsewhere is exactly the contradiction this pass removes.
   */
  signBand: SignBand;
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
  /**
   * What it costs IF he turns it down — which is what the button may state
   * inside the band, since `patienceCost` there is 0 or 1 according to a
   * hidden draw and printing it would hand the answer over on the label.
   */
  maxPatienceCost: number;
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
  // THE CONTRACT THIS OFFER ACTUALLY PRODUCES. When he is STILL UNDER CONTRACT
  // that is the existing deal with years appended — its remaining salaries
  // untouched, its unamortized bonus carried — and not a hypothetical fresh
  // contract. It has to be the real one: the ledger below is drawn from this
  // and so is the cap gate, and the cap gate has to agree with the compliance
  // check that runs the instant it is signed.
  //
  // The test is his CONTRACT, not the screen. It used to be `mode ===
  // 'EXTENSION'`, which was right for as long as a re-sign replaced the deal
  // outright; `extendContract` (lib/freeagency.ts) appends a walk-year deal
  // now, and a flag keyed on the screen would have this quoting a year-1 cap
  // hit of a fresh contract the signing does not write. Both halves measured
  // on ATL's Kwame Swearingen with one season left at $7.70M: the fresh-deal
  // preview reads $5.73M, and the appended row that actually lands is $9.76M.
  const appending = ctx.currentContract !== null && ctx.controlYears > 0;
  const ext = appending
    ? buildExtension({
        current: ctx.currentContract!,
        newMoneyApy: offer.apy,
        addYears: offer.years,
        signedYear: ctx.currentContract!.signedYear,
        escalation: structure.escalation,
        bonusPct: shape.bonusPct,
        guaranteedPct: shape.guaranteedPct,
        voidYears: structure.voidYears,
        // THE HALF OF AN EXTENSION THAT LOWERS THIS YEAR. The `??` is the
        // rule, not a fallback: a structure that never heard of this field
        // still gets the negotiated default, and `negotiateOffer` resolves it
        // the same way on submit, so the meter and the row written agree on
        // every table.
        convertPct: structure.convertPct ?? DEFAULT_CONVERT_PCT,
      })
    : null;
  const c = ext ?? buildContract({
    apy: offer.apy,
    years: offer.years,
    signedYear: 0,
    escalation: structure.escalation,
    bonusPct: shape.bonusPct,
    guaranteedPct: shape.guaranteedPct,
    voidYears: structure.voidYears,
  });
  // `c.voidYears` — never `structure.voidYears`. Both builders clamp the request
  // down to what a deal of this length can actually amortise (see
  // usableVoidYears), and pricing the panel off the raw slider position would
  // put a number on screen that the contract written moments later does not
  // carry. The slider is capped at the same figure, so in practice the two
  // agree; reading it back off the contract is what KEEPS them agreeing.
  const priced = { ...c, baseSalaries: JSON.stringify(c.baseSalaries) };
  const schedule = capHitSchedule(priced, gate.capMode);
  const year1CapHit = schedule[0] ?? 0;
  // WHAT THIS DEAL CHANGES, which is not what it costs. The club is already
  // paying `gate.capCreditBack` for him this season and stops the moment this
  // is signed, so the only money the cap has to find is the difference — and
  // on an extension that converts salary into bonus the difference is
  // routinely NEGATIVE. See `capCreditBack` for what reading the gross figure
  // here cost. Same subtraction `assertCapRoom` performs on the way in.
  // ...PLUS whatever the old deal STRANDS when this one replaces it, which is
  // the third term `assertCapRoom` is handed on a walk-year re-sign and the
  // one this line used to be missing. See `capAcceleratesOnReplace`.
  const capDelta = year1CapHit - gate.capCreditBack + gate.capAcceleratesOnReplace;
  const totalValue = c.baseSalaries.reduce((a, b) => a + b, 0) + c.signingBonus;
  // What he is agreeing to, as against what the contract is worth in total.
  // On a fresh deal they are the same figure; on an extension they are not,
  // and the panel prints both under their own names.
  const newMoneyValue = ext ? ext.newMoneyTotal : totalValue;
  const contractYears = c.years;
  // THE SHARED FUNCTION, and this is the second time this line has been pulled
  // back onto one. It was `Math.min(contractYears + structure.voidYears, 5)` —
  // the five-year ceiling written out again, in a second file, against the raw
  // slider rather than the clamped contract — and then it was the whole
  // stranded-bonus formula written out again beside it. Both spellings agreed
  // with the ledger only by hand; `strandedVoidBonus` (lib/cap.ts) is what the
  // dead-money runway itemises, what the contract ledger draws, and what the
  // season actually writes when the deal runs out. The panel quotes that or it
  // quotes a number the game does not use.
  const strandedVoidMoney = strandedVoidBonus(priced);

  let blocked: Block | null = null;
  let reason: string | null = null;
  if (offer.apy < gate.minSalary) {
    blocked = 'FLOOR';
    reason = `No contract may pay under the league minimum of ${formatMoney(gate.minSalary)}.`;
  } else if (offer.years < 1 || offer.years > gate.maxYears) {
    blocked = 'TERM';
    // The rulebook's ceiling, and `gate.maxYears` already has the years he is
    // owed taken out of it whenever this appends (resolveNegotiationSession).
    reason = appending
      ? `He is already signed for ${ctx.controlYears} year${ctx.controlYears === 1 ? '' : 's'}, and no contract may run past ${TERM.MAX_CONTRACT_YEARS} — ${gate.maxYears} more is the most you may add.`
      : `No contract may run longer than ${TERM.MAX_CONTRACT_YEARS} years.`;
  } else if (committedTerm(ctx, offer) > ctx.willingYears) {
    // HIS refusal, not the rulebook's, and it is on screen beside the term
    // control before anybody drags it. Money does not move this.
    blocked = 'WILLING';
    // KEYED ON THE MODE, NOT ON `appending`, and deliberately: the test above
    // it is `committedTerm`, which folds the years he is already owed into
    // what he is committing to only on an EXTENSION. A re-sign is still priced
    // as a re-sign — the years offered are the years he weighs — so a sentence
    // here that counted his walk year would state a limit this block does not
    // enforce. The two have to be read together or one of them is a lie.
    reason = ctx.mode === 'EXTENSION' && ctx.currentContract !== null
      ? `He is ${ctx.age} and has no intention of playing past ${ctx.intendedFinalAge}. With ${ctx.controlYears} years already on his deal that is ${Math.max(0, ctx.willingYears - ctx.controlYears)} more at most, at any price.`
      : ctx.willingYears <= 1
        ? `He is ${ctx.age} and will only go year to year now — he does not intend to play past ${ctx.intendedFinalAge}.`
        : `He is ${ctx.age} and has no intention of playing past ${ctx.intendedFinalAge}. ${ctx.willingYears} years is as long as he will commit, at any price.`;
  } else if (gate.capMode !== 'OFF' && capDelta > 0 && capDelta > gate.capSpace + CAP_GATE_TOLERANCE) {
    // TWO QUESTIONS, IN THE ORDER `assertCapRoom` ASKS THEM. Does this deal
    // add money to this season at all, and if it does, is there room for what
    // it adds. A club that is already over the cap may still sign anything
    // that costs it nothing more — that is how a save that has gone wrong is
    // dug out of the hole, and refusing it was what trapped one.
    blocked = 'CAP';
    // "or lower the deal" is not advice when the deal is already at the league
    // minimum — there is nothing left to lower, and the only route is room.
    // THE THIRD WAY OUT, WHERE THERE IS ONE. "Clear space or lower the deal"
    // is incomplete advice on a deal that appends: salary he is already owed
    // this season can still be pushed into the bonus, the control for it is on
    // the same screen, and it moves year 1 without changing a dollar of what
    // he is being offered. Named only while there is genuinely room left to
    // convert — an offer already at 100% has no third option and being told it
    // had one would be worse than the shorter sentence.
    const leftToConvert = ext ? Math.max(0, ext.convertibleBase - ext.converted) : 0;
    // WHAT IT ADDS, not what it costs — the two are different numbers on any
    // deal with a man already on the books, and the one the cap is refusing is
    // the difference. Printing the gross year-1 figure here beside a panel
    // showing his hit coming down was the sentence that made no sense.
    const cost = gate.capCreditBack > 0
      ? `This adds ${formatMoney(capDelta)} to this season`
      : `Year 1 costs ${formatMoney(year1CapHit)}`;
    // And say where the club actually stands. "$-8.2M of room" is not a
    // sentence anybody reads twice.
    const room = gate.capSpace >= 0
      ? `against ${formatMoney(gate.capSpace)} of room`
      : `and you are already ${formatMoney(-gate.capSpace)} over the cap`;
    reason = offer.apy <= gate.minSalary
      ? `${cost} ${room}, and this is already the league minimum — the only way to sign him is to clear space.`
      : leftToConvert > 0
        ? `${cost} ${room} — clear space, lower the deal, or push more of the ${formatMoney(leftToConvert)} he is still owed this season into the bonus.`
        : `${cost} ${room} — clear space or lower the deal.`;
  }

  // THE CONTEST. One comparison, on one scale, against the same evaluation
  // that draws the meter — see THE CONTEST block above for why this used to be
  // `gate.competingApy > offer.apy` and why that was a bug rather than a
  // simplification. Deterministic in every input, so it adds no variance and
  // touches nothing the hidden draw is seeded on.
  const rival = evaluateRival(ctx, gate);
  const rivalInterest = rival?.interest ?? null;
  const playerBand = signBandFor(ctx, evaluation.interest);
  // A CONTEST IS BETWEEN TWO OFFERS HE WOULD TAKE. If yours is below the band
  // — an insult, or under his guarantee floor, or simply not enough — then
  // losing an auction is not what is wrong with it, and saying so would push
  // the user at the rival's number when the answer is that he has refused the
  // deal itself. His own refusal takes precedence, which is also what
  // `underGuaranteed`'s "no salary closes this" claim requires: a band reading
  // LOSING would imply money could fix it.
  const outbid = !blocked && playerBand !== 'NO' && rival !== null
    && !winsContest(evaluation.interest, rival.interest);

  // The three regions, and the hidden draw that resolves the middle one. See
  // the "HE MIGHT SIGN HERE" block above: same seed on both sides of the
  // wire, so the browser and the Server Action reach the same answer for the
  // same offer, and neither of them can re-roll it.
  //
  // LOSING OVERRIDES ALL THREE, and that is the whole fix. A band drawn from
  // his opinion of your package alone would read YES · "he will sign this"
  // over a screen also saying he is signing somewhere else. The band is what
  // HAPPENS, so when the rival's package reads better to him, the band says
  // so and the meter has nothing left to contradict.
  // BLOCKED OUTRANKS BOTH, for the reason directly above. `blocked` is not a
  // shade of his opinion either — a deal the cap, the rulebook or his own
  // willingness refuses is not a deal he can accept, however much he likes it.
  // Left out, the band read YES over a screen whose own button said "Not
  // enough cap room": big green meter, "he will sign this", a ledger showing
  // cap space after of -$84.2M, and the one sentence naming the shortfall
  // suppressed because the panel hides `reason` on a YES. Same defect as the
  // LOSING one, one axis over.
  const signBand: SignBand = blocked ? 'BLOCKED' : outbid ? 'LOSING' : playerBand;
  const wouldSign = playerBand === 'YES'
    || (playerBand === 'MAYBE' && acceptanceRoll(ctx, offer) < maybeChance(ctx, evaluation.interest));

  // ONE SENTENCE, and it is the same computation that drew the band. It names
  // what is actually wrong — their package, not their salary — because the
  // answer might be guaranteed money or a year, and a line that says "beat
  // their number" would send the user to the only control that was already
  // being compared.
  if (!reason && outbid && rival) {
    reason = `${rival.teamName} have ${formatMoney(rival.offer.apy)}/yr over ${rival.offer.years} year${rival.offer.years === 1 ? '' : 's'} with ${Math.round(rival.offer.guaranteePct * 100)}% guaranteed on the table, and he likes it better. Salary, years or guaranteed money — any of them can beat it.`;
  }

  // NOTE THE ABSENCE OF `wouldSign` IN THIS CONDITION. The reason line is
  // rendered on screen, so it may only ever depend on things the user is
  // allowed to know. Writing it only when the offer is going to be refused
  // would have leaked the hidden draw straight onto the panel — the band
  // would have said "he might" while the presence or absence of a sentence
  // underneath quietly told you the answer. It is null only when he is a
  // certainty, which is a thing the meter already says out loud.
  if (!reason) {
    if (signBand === 'MAYBE') {
      reason = 'His agent will not say either way at this number. It might get done — and finding out costs a pip if it does not.';
    } else if (signBand === 'NO') {
      reason = evaluation.headline;
    }
  }

  const signs = wouldSign && !blocked && !outbid;
  const refused = !blocked && !signs;

  return {
    evaluation,
    year1CapHit,
    capDelta,
    capHitSchedule: schedule,
    totalValue,
    newMoneyValue,
    contractYears,
    // The writer's own boundary, never a second reading of `controlYears`.
    firstNewYearIndex: ext ? ext.firstNewYearIndex : 0,
    // Read back off the contract this offer WRITES, floored at the signing
    // bonus, because that is the figure the club is held to — on a deal
    // signed today it is exactly `deadMoneyIfCut` below, and those two sitting
    // side by side in the panel disagreeing is the bug this closes.
    guaranteedMoney: totalGuaranteed(priced),
    // The same `capHit` the ledger, the cap page and `assertCapRoom` read, on
    // the row he is on right now. `year1CapHit` above is the same function on
    // the row this offer would write, so the pair really is one subtraction.
    currentYearHitBefore: ctx.currentContract ? capHit(ctx.currentContract, gate.capMode) : null,
    salaryConverted: ext ? ext.converted : 0,
    convertibleBase: ext ? ext.convertibleBase : 0,
    deadMoneyIfCut: deadMoneyOnCut(priced, gate.capMode),
    strandedVoidMoney,
    blocked,
    outbid,
    rivalInterest,
    signBand,
    accepted: signs,
    costsPatience: refused,
    // A lowball is remembered whether or not somebody else is bidding.
    patienceCost: refused ? (evaluation.insulting ? 2 : 1) : 0,
    // What a refusal WOULD cost, whether or not this one is going to be
    // refused. The button label prints this inside the band; printing the
    // real cost there would leak the hidden draw onto the screen.
    maxPatienceCost: blocked ? 0 : evaluation.insulting ? 2 : 1,
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
   * `gate.rival` with its evidence attached; in a
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
    s.ctx.desiredGuarantee.toFixed(3), s.ctx.guaranteeFloor.toFixed(3),
    s.ctx.patience, s.ctx.resignWindow ?? '-',
    // Everything the band and the term refusal are computed from. All four
    // are stable facts about the man and the year — but they decide answers
    // now, so a session where any of them moved is a session that moved.
    s.ctx.mode, s.ctx.seasonYear, s.ctx.controlYears, s.ctx.willingYears,
    s.ctx.intendedFinalAge, s.ctx.bandHalfWidth,
    // The deal being extended is an INPUT to the price now — a restructure
    // between opening the panel and pressing the button really does change
    // what the offer produces, so it is a session that moved.
    s.ctx.currentContract
      ? `${s.ctx.currentContract.years}/${s.ctx.currentContract.yearsRemaining}/${s.ctx.currentContract.signingBonus}/${s.ctx.currentContract.baseSalaries}`
      : '-',
    // Both halves of the cap gate. The credit is as much a term of the
    // negotiation as the room is — a restructure or a trade between opening
    // the panel and pressing the button moves it, and the meter was drawn
    // against the old one.
    // ...all THREE halves, now that a walk-year re-sign's stranded bonus is a
    // term of the gate: a restructure between opening the panel and pressing
    // the button moves it too.
    s.gate.capMode, s.gate.capSpace, s.gate.capCreditBack, s.gate.capAcceleratesOnReplace,
    s.gate.minSalary, s.gate.maxYears,
    // THE WHOLE RIVAL PACKAGE, not just its headline. It is scored now, so a
    // rival who dropped a year or moved his guarantee has changed the contest
    // the meter was describing every bit as much as one who raised his bid.
    s.gate.rival ? `${s.gate.rival.teamName}/${s.gate.rival.offer.apy}/${s.gate.rival.offer.years}/${s.gate.rival.offer.guaranteePct.toFixed(3)}` : '-',
    // The share of his price that is about YOUR club. It is what the rival is
    // priced against, so it decides the contest as surely as his own number.
    s.ctx.clubDiscount.toFixed(4),
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

/**
 * A DEAL THAT ACTUALLY EXISTS — read back off the contract row after it was
 * written, never assembled from what the panel had staged.
 *
 * The app owner asked for the moment to land: *"once a contract is signed -
 * free agent, re sign or extension - we need some sort of visual feedback that
 * the signing is done"*. What makes that honest rather than decorative is
 * where these numbers come from. The client's offer went through a clamp, a
 * contract builder, a bonus split and — on an extension — an append onto an
 * existing deal, and the server may have applied a structure the panel never
 * saw. Confirming the STAGED figures would be the easiest lying metric in the
 * game to ship and the hardest for anybody to notice, because it only differs
 * in the cases nobody checks.
 */
export interface SignedDeal {
  playerName: string;
  position: string;
  playerId: string;
  teamAbbr: string;
  teamId: string;
  mode: NegotiationMode;
  /** Length of the CONTRACT that now exists — when it appended, old years included. */
  years: number;
  /** Everything it is worth, off the stored base salaries and bonus. */
  totalValue: number;
  /** The years just added, where that differs. Equal to `totalValue` on a fresh deal. */
  newMoneyValue: number;
  /**
   * How many of `years` were just BOUGHT. Equal to `years` on a fresh contract;
   * fewer when the deal appended onto one he was already on.
   *
   * The partner of `newMoneyValue`, and the confirmation cannot tell the truth
   * without it. `apy` is the rate on the NEW years, `totalValue` is the WHOLE
   * contract, and with only `years` on hand the card printed the two beside
   * each other under "Per year" and "Total value" — $6.43M/yr and $34.82M over
   * 5 yrs, which do not multiply out, because 4 of those years were bought and
   * the fifth was already owed. Mode could not stand in for this: a walk-year
   * re-sign appends (see extendContract) and is not an EXTENSION.
   */
  newYears: number;
  /** APY he agreed to — the rate on the `newYears`, which is the whole deal only when nothing was appended. */
  apy: number;
  guaranteed: number;
  /** This season's charge, off the row that was written. */
  capHitThisYear: number;
  /** Cap room before and after, both off teamCapSummary. The delta is the difference. */
  capSpaceBefore: number;
  capSpaceAfter: number;
  /** The club you outbid, when you outbid one. Free agency only. */
  beat: { teamName: string; apy: number } | null;
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
  /** Present only when `ok` — the deal as it was actually written. */
  signed?: SignedDeal;
}
