import { CAP } from './tuning';
import { positionSalaryBand } from './cap';

/**
 * ===========================================================================
 * THE FIFTH-YEAR OPTION — THE RULE, THE PRICE, AND THE ONE REASON IT IS OFF
 * ===========================================================================
 * A first-round pick's rookie contract carries a club option on a fifth
 * season. It is decided after his third year and before his fourth, it costs a
 * price set by his position and by what he has actually done, and taking it
 * guarantees the year. Declining it is free today and costs the club a year of
 * him: he plays out his fourth season and reaches free agency twelve months
 * earlier than he otherwise would.
 *
 * Until now every drafted man in this game signed the identical four-year deal
 * — `CAP.ROOKIE_DEAL_YEARS`, flat, through `rookieDealForPick` — so the #1
 * pick and the #32 pick differed in price and in nothing else, and the AI's
 * pick valuation had no idea that a first-rounder is FIVE years of control
 * rather than four. This module is the rule half of closing that.
 *
 * ---------------------------------------------------------------------------
 * IT IS A LEAF, AND THAT IS DELIBERATE
 * ---------------------------------------------------------------------------
 * Same reason lib/franchiseTag.ts is: four surfaces have to agree about
 * whether the decision is live and what it costs — the player card, the
 * front-office brief, the impact preview and the server action — and three
 * copies of a six-branch rule is three chances to grey a control for a reason
 * the server does not hold. It imports lib/cap.ts (arithmetic, safe on both
 * sides of the wire) and nothing else, so a client component can render the
 * same sentence the server refuses with.
 *
 * The half that needs a database — which men are eligible, what the position
 * is paying this year, which tier he has earned — is `fifthYearOptionQuote` in
 * lib/freeagency.ts, beside the write path it prices.
 *
 * ---------------------------------------------------------------------------
 * WHO GETS ONE: ROUND ONE, AND NOBODY ELSE
 * ---------------------------------------------------------------------------
 * That is the real rule and it is also the whole point of building it. The
 * draft-value chart prices round one over round two on talent alone; in the
 * real sport a first-rounder is also a year of extra control, and that year is
 * a large part of what the pick is worth.
 *
 * REJECTED: extending it to round two, which the real CBA does not do and
 * which would delete the distinction this exists to create. REJECTED: making
 * it a league setting the way the franchise tag is. The tag is a discretionary
 * power a club may or may not be given; the option is a TERM OF THE CONTRACT a
 * first-round pick signs. Switching it off would not disable a tool, it would
 * change what a first-round pick is, and it would leave the draft-value chart
 * and the AI's pick pricing describing a contract that league does not use.
 * ===========================================================================
 */

/** Stored on `Contract.fifthYearOption`. Null means nobody has decided yet. */
export type FifthYearOptionDecision = 'EXERCISED' | 'DECLINED';

/**
 * ---------------------------------------------------------------------------
 * THE THREE TIERS, AND THE REAL RULE EACH ONE IS
 * ---------------------------------------------------------------------------
 * The 2020 CBA prices the option off the player's position and what he has
 * done with his three seasons, in three tiers, and each tier is literally an
 * average of a band of that position's salaries:
 *
 *   two Pro Bowls or more                    -> the FRANCHISE TAG number
 *                                               (average of the top 5)
 *   one Pro Bowl, or 75% of the snaps in two
 *   of three years, or 50% across all three  -> the TRANSITION TAG number
 *                                               (average of the top 10)
 *   everyone else                            -> average of the 3rd to 20th
 *
 * This game already computes the first of those — `franchiseTagValue` is the
 * top-5 average — so the tiers are ranks into one shared band function
 * (`positionSalaryBand`, lib/cap.ts) rather than a second pricing model. The
 * bands below are the real ones, unchanged.
 *
 * WHAT THE TIER TESTS HAD TO BE INSTEAD, and why they are not a fudge:
 *
 *   ALL_STAR  This game names All-Stars off what players actually DID
 *             (lib/allStars.ts), which is its Pro Bowl. One selection rather
 *             than the real rule's two, because the window is three seasons
 *             long and this roster is a tighter honour than a Pro Bowl — it is
 *             the top 12.5% of starters at every position by construction.
 *
 *   STARTER   There are no snap counts in this game, so the real rule's
 *             playing-time leg cannot be transcribed. What it is a proxy FOR
 *             is "he has been a starter", and this game has exactly one
 *             definition of who starts — lib/lineup.ts, the best men at each
 *             position on the roster. A first-rounder who holds a starting
 *             slot has cleared it.
 *
 *             REJECTED: reading his rank on the DEPTH CHART instead. That is a
 *             free click. A GM could drop his own first-rounder to second
 *             string in the re-sign window, exercise a tier cheaper, and move
 *             him back before a snap was played — no games are played in that
 *             window, so the demotion would cost him literally nothing.
 *             `lib/lineup.ts` reads the best man at the position regardless of
 *             chart order, which is the same reason the sim reads it.
 *
 *             REJECTED: games played. `PlayerSeason` is reconstructed from box
 *             scores, and a box score names no offensive linemen at all — 0 of
 *             10 on a measured champion's roster (INV-24). A playing-time test
 *             built on it would put every first-round tackle in the cheapest
 *             tier by construction and call it performance.
 *
 *   BASE      Everyone else, on the real rule's own band.
 * ---------------------------------------------------------------------------
 */
export type FifthYearOptionTier = 'ALL_STAR' | 'STARTER' | 'BASE';

interface TierSpec {
  /** 1-based, inclusive, into the position's cap hits sorted biggest first. */
  from: number;
  to: number;
  /** What he did to earn it, in the second person, for the preview. */
  earned: string;
  /** What the price IS, so a GM can go and check it against real contracts. */
  band: string;
}

/**
 * [TUNE] The bands, and they are the real CBA's bands rather than tuned ones.
 * `CAP.FRANCHISE_TAG_TOP_N` is the top rung on purpose: an All-Star's option
 * year costs exactly what tagging him would, which is the real rule and also
 * keeps this game from having two different answers to "what does the best man
 * at this position cost for one season".
 */
export const FIFTH_YEAR_OPTION_TIERS: Record<FifthYearOptionTier, TierSpec> = {
  ALL_STAR: {
    from: 1,
    to: CAP.FRANCHISE_TAG_TOP_N,
    earned: 'He has been named an All-Star inside his first three seasons',
    band: `the average of the ${CAP.FRANCHISE_TAG_TOP_N} biggest cap hits at the position — the same number a franchise tag on him would cost`,
  },
  STARTER: {
    from: 1,
    to: 10,
    earned: 'He has started for you',
    band: 'the average of the 10 biggest cap hits at the position',
  },
  BASE: {
    from: 3,
    to: 20,
    earned: 'He has not started, and no All-Star roster has had him on it',
    band: 'the average of the 3rd through 20th biggest cap hits at the position',
  },
};

/** The tier a man has earned, from the two facts the game can honestly answer. */
export function fifthYearOptionTier(opts: { allStarSelections: number; isStarter: boolean }): FifthYearOptionTier {
  if (opts.allStarSelections > 0) return 'ALL_STAR';
  return opts.isStarter ? 'STARTER' : 'BASE';
}

/**
 * The option salary. One band average over the position's cap hits, exactly as
 * the franchise tag is priced, with the tier choosing the band.
 *
 * THE FLOOR IS NOT DECORATION. The whole point of the option is that it costs
 * real money — an option a club could take for less than the man's own fourth
 * year is not a decision, it is free. The base tier at a shallow position can
 * reach down into backup money, so the price is never allowed below his own
 * fourth-year cap hit times `CAP.FIFTH_YEAR_OPTION_MIN_PREMIUM`. Measured
 * league-wide before this floor existed, see lib/tuning.ts.
 */
export function fifthYearOptionValue(opts: {
  positionSalaries: number[];
  tier: FifthYearOptionTier;
  /** His cap hit in the fourth year the option sits on top of. */
  fourthYearHit: number;
}): number {
  const spec = FIFTH_YEAR_OPTION_TIERS[opts.tier];
  const banded = positionSalaryBand(opts.positionSalaries, spec.from, spec.to);
  const floor = Math.round(opts.fourthYearHit * CAP.FIFTH_YEAR_OPTION_MIN_PREMIUM);
  return Math.max(CAP.MIN_SALARY, banded, floor);
}

/**
 * ===========================================================================
 * WHY THIS CLUB CANNOT DECIDE ON THIS MAN — one answer, every screen
 * ===========================================================================
 * Written in the same order `fifthYearOptionAction` refuses in, for the same
 * reason `franchiseTagBlockReason` is: a greyed control that names a reason the
 * server does not hold teaches a rule the game does not have.
 *
 * Returns null when the decision is live. A man who is simply not a
 * first-rounder gets `null` back from `fifthYearOptionApplies` FIRST and never
 * reaches this — there is no control to grey on a seventh-round pick's card,
 * because "you cannot exercise an option he was never given" is not a rule
 * worth teaching on every player page in the game.
 * ===========================================================================
 */
export function fifthYearOptionBlockReason(opts: {
  phase: string;
  /** PHASE_LABELS[phase] — so the sentence can say where the league actually is. */
  phaseLabel: string;
  /** Years left on his rookie deal. 1 is the decision year: three played, one to go. */
  yearsRemaining: number;
  /** What is already on the contract row, if his club has answered. */
  decided: FifthYearOptionDecision | null;
}): string | null {
  if (opts.decided === 'EXERCISED') {
    return 'You have already picked up his option — he is under contract for a fifth season.';
  }
  if (opts.decided === 'DECLINED') {
    return 'You have turned his option down. He plays out this deal and reaches free agency when it ends.';
  }
  if (opts.phase !== 'RESIGN') {
    return `The option is answered in the re-sign window, after his third season. Right now: ${opts.phaseLabel}.`;
  }
  if (opts.yearsRemaining > 1) {
    const seasons = `${opts.yearsRemaining} seasons`;
    return `Too early. He has ${seasons} of his rookie deal still to play, and the option is answered after his third.`;
  }
  if (opts.yearsRemaining < 1) {
    return 'Too late. His rookie deal is up, and an option year had to be picked up before his fourth season, not after it.';
  }
  return null;
}

/**
 * IS THERE AN OPTION ON THIS CONTRACT AT ALL — the outer gate, asked before
 * the block reason and read by every surface.
 *
 * Three facts, and each of them is a real rule rather than a convenience:
 *
 *   round one          the option only ever existed on a first-round pick.
 *   still his rookie
 *   deal               `signExtension` clears `isRookieDeal` the moment new
 *                      money goes on top ("the fifth-year option and the
 *                      rookie-scale rules stop applying"), which was written
 *                      before this feature existed and is exactly right: a man
 *                      who has signed an extension has no option year to pick
 *                      up, he has a contract.
 *   a club holds it    the option travels with the deal, so a first-rounder
 *                      traded in year two carries it to his new club. That is
 *                      the real rule and it falls out of reading the contract
 *                      rather than his draft club.
 *
 * A restructured rookie deal keeps its option deliberately. `restructureContract`
 * rebases onto the years that are LEFT and preserves `yearsRemaining`, so the
 * calendar test below still lands on the same offseason; taking the option away
 * because a GM moved money around would be a rule with nothing behind it and
 * nothing on screen to warn him.
 */
export function fifthYearOptionApplies(opts: {
  draftRound: number | null | undefined;
  isRookieDeal: boolean;
}): boolean {
  return opts.draftRound === 1 && opts.isRookieDeal;
}
