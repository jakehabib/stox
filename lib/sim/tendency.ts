import { Rng } from '../rng';

/**
 * ===========================================================================
 * HOW OFTEN A CLUB THROWS IT
 * ===========================================================================
 * Every club in this league is a balanced offense. None of them is balanced in
 * exactly the same way, and none of them is the same balanced offense two years
 * running — which is what real football looks like.
 *
 * WHAT THIS REPLACED, AND WHY IT HAD TO GO. There used to be five named
 * schemes — Air Raid, West Coast, Balanced, Spread Option, Power Run — picked
 * by `rng.pick` at league creation and never changed again. Two things were
 * wrong with it and only one of them was the naming.
 *
 *   1. THE ENVELOPE WAS FICTION. Those five carried pass rates from 0.46 to
 *      0.68. Measured across 192 real team-seasons (nflverse aggregates, 2019
 *      and 2021-2025; 2020 excluded as the empty-stadium year), the real
 *      play-call pass rate runs mean 0.573, sd 0.0464, min 0.438, max 0.670 —
 *      and NOT ONE of those 192 team-seasons reached 0.68. Only 2.1% sat at or
 *      below 0.46. The game put a fifth of its clubs at each. The league-wide
 *      spread was sd 0.0714, which is 1.54x the real one, and an Air Raid club
 *      ran the ball 19.1 times a game where the most pass-happy real season on
 *      record ran 21.1. That is what made a 90-overall back read as broken: his
 *      club's lead back took 154 carries for 684 yards against a real lead
 *      back's 217, and caught 48 balls for 489 yards to make up for it.
 *
 *   2. IT WAS FROZEN AT CREATION. A club that drafted a generational back was
 *      stuck in whatever offense a coin flip gave it, forever. Real clubs move:
 *      the decomposition below says three quarters of the real spread is a club
 *      having a particular season, not a club being a particular thing.
 *
 * THE SHAPE OF THE REAL THING, measured by one-way ANOVA over 32 franchises
 * observed for 6 seasons each (scripts/_sc_variance.ts):
 *
 *     total sd (all team-seasons)      0.0466   <- what the league must match
 *     within-club sd (this season)     0.0403   unbiased, from mean squares
 *     between-club sd (club identity)  0.0236   unbiased, from mean squares
 *     sqrt(0.0236^2 + 0.0403^2)        0.0467   reconstructs the total
 *
 * So 25% of the spread is a club being what it is and 75% is the season it is
 * having. The real extremes bear that out: Baltimore averaged 0.493 over the
 * six years and Cincinnati 0.627, but Atlanta's own year-to-year sd was 0.076
 * while Denver's was 0.013.
 *
 * WHY A CENTRE PLUS A SEASONAL DRAW, AND NOT THE TWO SIMPLER OPTIONS. Both were
 * built and measured over three seed-sets x 12 seasons (scripts/_sc_new.ts):
 *
 *     design                          league sd   club year-to-year sd
 *     A  drawn once per club, fixed      0.0504         0.0000
 *     B  drawn fresh every season        0.0479         0.0681
 *     C  centre + seasonal drift         0.0486         0.0589
 *     REAL                               0.0466         0.0570
 *
 *   A was rejected because its year-to-year figure is 0.0000 against a real
 *   0.0570. It is the same "frozen at creation" property that made the old
 *   system unfair, and it is the larger of the two real components — a club
 *   that never varies is less like football than one with no identity at all.
 *   B was rejected because 0.0681 is 1.19x too volatile AND it throws away the
 *   quarter of the real spread that is persistent club identity: under B,
 *   Baltimore and Cincinnati are the same franchise with different dice.
 *   C lands 1.04x on league spread and 1.03x on year-to-year. It is the only
 *   one that is right about both halves, because it is the only one that has
 *   both halves.
 *
 * (All three read ~1.04x rather than 1.00x on league spread for the same
 * reason: 96 clubs is a small sample of centres, and this particular sample
 * came out 8% wide. Measured at 40 seasons the generator itself lands 1.036x
 * with a centre sd of 0.0255 against the 0.0236 asked for. That is sampling,
 * not bias — the generator was checked separately over 20,000 draws and lands
 * 1.002x.)
 *
 * NO PLAYER EVER SEES THIS. It is background, deliberately: nothing renders it,
 * nothing lets a GM choose it, and there is no scheme name anywhere in the game
 * any more. The app owner's ruling: *"Lets just have everyone balanced, no
 * indications needed to the player it's just background. And it shouldn't be
 * exactly the same across the league, there should be variance."*
 * ===========================================================================
 */
export const PASS_TENDENCY = {
  /**
   * [TUNE] League mean play-call pass rate. Real: 0.5725 over 192 team-seasons.
   * The old five-scheme table averaged 0.572, so this does not move the league.
   */
  LEAGUE_MEAN: 0.5725,
  /** [TUNE] Persistent club identity, sd. Real: 0.0236 (ANOVA, bias-corrected). */
  CLUB_SD: 0.0236,
  /** [TUNE] A club's own season-to-season movement, sd. Real: 0.0403. */
  SEASON_SD: 0.0403,
  /**
   * A SAFETY RAIL, NOT A SHAPING DEVICE — and the distinction is the app
   * owner's standing rule on outliers: *"make it less likely that those really
   * crazy outliers occur, and they get increasingly less and less likely"*.
   * Shape the distribution, never clamp it.
   *
   * The realised draw is a normal with sd 0.0466 about 0.5725, so these bounds
   * sit past six standard deviations and are not reached in play — measured
   * over 20,000 draws, none came within 0.10 of either. They exist so that a
   * pathological value can never hand `allocateStats` a rate outside (0,1),
   * which would produce negative rush attempts. Real football's own six-season
   * extremes were 0.438 and 0.670, both far inside.
   */
  RAIL_LO: 0.25,
  RAIL_HI: 0.85,
};

/**
 * The pass rate a club plays to in a given season.
 *
 * Derived from the club's id rather than stored, which is what lets an existing
 * save pick this up with no migration of its own and no new column: every club
 * that already exists has an id, so every club already has a tendency. It is
 * deterministic, so replaying a season reproduces it exactly, which the sim
 * relies on everywhere else too.
 *
 * THE TWO DRAWS USE SEPARATE SEED NAMESPACES ON PURPOSE. The obvious form —
 * `tend:<id>` for the centre and `tend:<id>:<year>` for the season — shares a
 * prefix, and a shared prefix through `hashString` is exactly the kind of thing
 * that produces correlated draws and therefore a league whose spread is wider
 * than the constants above ask for. It was measured rather than assumed
 * (scripts/_sc_corr.ts, 20,000 ids): the shared-prefix form is in fact clean
 * (r = -0.015), but the namespaced form is equally cheap and does not depend on
 * a property of the hash that nothing else guarantees.
 *
 * Omitting `seasonYear` returns the club's centre — its identity with no
 * particular season attached. Used only as a fallback where no year is in
 * scope; every live path passes one.
 */
export function passTendency(teamId: string, seasonYear?: number): number {
  const centre = PASS_TENDENCY.LEAGUE_MEAN
    + new Rng(`offTendencyCentre:${teamId}`).normal(0, PASS_TENDENCY.CLUB_SD);
  const rate = seasonYear === undefined
    ? centre
    : centre + new Rng(`offTendencySeason:${seasonYear}:${teamId}`).normal(0, PASS_TENDENCY.SEASON_SD);
  return Math.min(PASS_TENDENCY.RAIL_HI, Math.max(PASS_TENDENCY.RAIL_LO, rate));
}

/**
 * ===========================================================================
 * HOW A CLUB SPREADS THE BALL AROUND
 * ===========================================================================
 * The second half of "none of them is balanced in exactly the same way".
 * `passTendency` above says how often a club throws it; this says who it throws
 * it to, and who it hands it to.
 *
 * WHAT THIS FIXES. lib/sim/engine.ts shared out targets and carries from ONE
 * league-wide vector — TARGET_SHARE and CARRY_SHARE — tilted only by rating.
 * Every club in the league therefore fed its lead back the same share of its
 * carries and its number one receiver the same share of its targets, give or
 * take how good they were. Measured over 24 replayed league-seasons, that is
 * what it did to the record book:
 *
 *   leader                 median    p90     max     real NFL
 *   rush attempts             260    266     272     300-380
 *   rushing yards           1,373  1,505   1,515     1,700-2,000
 *   TE receiving yards        749    823     824     1,000-1,200
 *
 * Look at the spread, not the level: 260 / 266 / 272 is a five per cent gap
 * between the median league-year's leading rusher and the best of twenty-four.
 * A real leader board has a long tail because a real league has workhorses —
 * clubs built around one back or one tight end — and this league had none. The
 * leading rusher was simply "the best club's starter", every single year.
 *
 * The level follows from the spread and cannot be fixed without it. In 2022
 * Josh Jacobs carried 340 times for 1,653 yards, which was 82% of the Raiders'
 * rushing yardage; the flat vector's best case is a back on 57% of his own
 * backfield's carries. No amount of raising the league-wide share reaches an
 * 82% workhorse without making every club in the league one.
 *
 * THE SHAPE. One draw per club per season per axis, lognormal about 1, applied
 * as an EXPONENT on the depth prior (`focus`) or as a MULTIPLIER on one
 * position's slice of it (`teEmphasis`). Lognormal because the exponent has to
 * stay positive: at 0 the prior flattens to an even committee, which is a real
 * offence, and below 0 it would invert the depth chart, which is not. It
 * therefore shapes the distribution instead of clamping it, which is the app
 * owner's standing rule on outliers.
 *
 * THE SPREADS ARE FITTED TO REAL SHARES, one per axis:
 *   BACKFIELD  a lead back's share of his backfield's carries. Real clubs run
 *              about 0.40 to 0.88 with sd ~0.13; sigma 0.50 puts the league's
 *              leading rusher on 379 carries for 1,668 yards against a real
 *              300-380 and 1,700-2,000.
 *   TE         a club's tight ends' share of its targets. Real clubs run 0.12
 *              to 0.30 about a mean of 0.21; sigma 0.32 puts the leading tight
 *              end on 1,022 receiving yards against a real 1,000-1,200, from
 *              749 before.
 *
 * THERE IS NO THIRD AXIS FOR THE NUMBER ONE RECEIVER, AND THAT IS MEASURED
 * RATHER THAN OVERLOOKED. A `targetFocus` exponent on the receiving prior was
 * built and swept alongside these two, over 12 replayed league-seasons:
 *
 *   sigma   leader receptions   leader receiving yards   real
 *   0.00                  133                    1,727   110-135 / 1,700-1,900
 *   0.05                  137                    1,722
 *   0.10                  145                    1,782
 *   0.12                  147                    1,807
 *   0.30                  199                    2,280
 *
 * It was rejected at every non-zero value because the number it moves is the
 * one number on the receiving line that was already right. The engine's WR1
 * takes 30% of his club's targets before any of this, which is already the top
 * of the real range — CeeDee Lamb led the NFL in 2023 on 30.7% — so the club-
 * to-club spread the exponent adds has nowhere to go but past it, and at three
 * standard deviations over 384 club-seasons it produces a 199-catch season.
 * The receiving record book needed yards per catch, not more catches, and that
 * is REC_YPC_PRIOR in lib/sim/engine.ts rather than anything here.
 * ===========================================================================
 */
export const ROLE_TENDENCY = {
  /** [TUNE] Workhorse-vs-committee backfield, lognormal sigma. */
  BACKFIELD_SIGMA: 0.50,
  /** [TUNE] How tight-end-centric the club is, lognormal sigma. */
  TE_SIGMA: 0.32,
};

/** A club's role profile for one season. Both are multipliers about 1. */
export interface RoleTendency {
  /** Exponent on the backfield carry prior. Above 1 is a workhorse. */
  carryFocus: number;
  /** Multiplier on the tight ends' slice of the target prior. */
  teEmphasis: number;
}

/**
 * The role profile a club plays to in a given season.
 *
 * `seasonKey` rather than a season year, and that is a compromise worth stating
 * plainly. lib/sim/engine.ts has no idea what year it is — see the note on
 * `SimTeamInput.passRate`, which exists for exactly that reason — and the one
 * season-varying number already in its hands is that pass rate, which is
 * `passTendency(id, year)`: a club centre plus a seasonal draw, and therefore a
 * fingerprint of the pair. Hashing it gives a role draw that moves with the
 * season and is statistically independent of the rate's VALUE, because the hash
 * destroys the ordering.
 *
 * If a season year is ever plumbed into `SimTeamInput`, pass it here instead;
 * nothing else has to change. What must NOT change is that the key varies by
 * season, or every club is frozen into one role forever — the defect
 * `passTendency` documents as design A and rejects.
 *
 * The two draws use separate seed namespaces for the same reason
 * `passTendency`'s two do.
 */
export function roleTendency(teamId: string, seasonKey: string | number): RoleTendency {
  const draw = (axis: string, sigma: number) =>
    Math.exp(new Rng(`role${axis}:${seasonKey}:${teamId}`).normal(0, sigma));
  return {
    carryFocus: draw('Backfield', ROLE_TENDENCY.BACKFIELD_SIGMA),
    teEmphasis: draw('TightEnd', ROLE_TENDENCY.TE_SIGMA),
  };
}
