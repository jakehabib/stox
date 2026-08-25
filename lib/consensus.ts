import { Rng, clamp } from './rng';
import { testingAthleticism } from './combineRank';
import { readJson } from './json';
import type { AttrMap } from './ratings';
import { AI, CONSENSUS, GENERATION } from './tuning';
import { bendToCeiling, bendToFloor } from './gen/players';
import type { Position } from './tuning';
import { BASE_40 } from './gen/prospectProfile';
import type { CollegeProfile, CombineTesting, CompetitionGrade } from './gen/prospectProfile';

/**
 * ===========================================================================
 * THE CONSENSUS BOARD — free, public, and wrong on purpose
 * ===========================================================================
 * Nobody should have to spend anything to learn that the consensus number one
 * pick is the consensus number one pick. That information is free in every
 * real front office (it is on television), and charging for it only ever
 * taxed the player for finding out what the room already knew.
 *
 * So every prospect carries a public grade and a public rank from the day the
 * class is generated, at no cost, identical for every team. The GM's edge is
 * NOT having information. It is knowing where the room is WRONG.
 *
 * That only works if the room is wrong in ways that can be learned. So the
 * consensus is built as
 *
 *     grade = a blend of WHAT THE ROOM THINKS HE IS
 *                    and WHAT THE ROOM THINKS HE BECOMES
 *           + a set of NAMED BIASES, each driven by something public
 *           + a small amount of honest disagreement
 *
 * Every bias is exported as machine-readable data (id, direction, delta, and
 * the public signal that caused it), so a UI can say "the board is high on him
 * because he tested well" and a scouting report can disagree with a reason
 * instead of a shrug.
 *
 * Those first two terms are READS, not ratings — see THE ROOM GRADES A READ,
 * NOT A PLAYER below. The room is a few points off on what a prospect is, a
 * long way off on what he becomes, and occasionally has him flatly wrong. That
 * is where a steal in the fifth and a bust at 1.01 both come from, and it is
 * the difference between a fog and a sorted column.
 *
 * WHAT THIS FILE MAY NOT DO. It reads true ratings, because an opinion has
 * to be an opinion ABOUT something — but it never returns them and never
 * narrows anybody's scouted range. buildScoutedView (lib/scouting.ts) remains
 * the only thing that decides what the user may see about a player, potential
 * always comes back from there as a range, and nothing here writes a
 * ScoutingReport. The consensus is talk. It is allowed to be badly wrong, and
 * on the prospects that matter most it usually is.
 *
 * TUNING. Every constant this file reads lives in lib/tuning.ts's CONSENSUS
 * block, with the rest of the game's tunables — the one exception being
 * CONSENSUS_EVAL below, which belongs there too and is defined here only
 * because tuning.ts was held by another agent when it landed. The move is a
 * cut-and-paste and a `CONSENSUS.` prefix. The positional 40 baselines
 * come from lib/gen/prospectProfile.ts's exported BASE_40 — the generator's
 * own table — because publicAthleticism() below inverts that generator's
 * formulas exactly and a second copy drifting would misread testing silently.
 *
 * DETERMINISM. Seeded off the player id alone (never Math.random), so the
 * same prospect grades identically on every render, in every process, for the
 * whole life of the save. Each random draw gets its OWN seeded stream rather
 * than sharing one — adding a fifth bias later must not reshuffle the four
 * that already exist in players' saves.
 * ===========================================================================
 */

export type ConsensusBandId = (typeof CONSENSUS.BANDS)[number]['id'];

/**
 * The draft the bands are measured against. Defaults to this project's
 * standard 32-team, 7-round rookie draft (lib/tuning.ts LEAGUE / settings
 * draftRounds); pass the league's real numbers when a page has them.
 */
export interface BoardShape {
  teams: number;
  rounds: number;
}

const DEFAULT_SHAPE: BoardShape = { teams: 32, rounds: 7 };

/**
 * Pick number each band runs through. Derived, not hard-coded, so the labels
 * stay true in a league with a different draft length: blue chips are the top
 * handful, first round is round one, Day 2 is rounds two and three, Day 3 runs
 * to the end of the draft, and the late-flier band covers the undrafted names
 * teams still call about.
 */
export function bandCutoffs(shape: BoardShape = DEFAULT_SHAPE) {
  const round = Math.max(1, shape.teams);
  const draftSize = round * Math.max(1, shape.rounds);
  return {
    BLUE_CHIP: Math.max(3, Math.round(round * 0.16)),
    FIRST_ROUND: round,
    DAY_TWO: Math.min(draftSize, round * 3),
    DAY_THREE: draftSize,
    LATE_FLIER: Math.round(draftSize * 1.35),
  };
}

// ---------------------------------------------------------------------------
// Public athleticism read
// ---------------------------------------------------------------------------

/**
 * 0..1 "how did he test", 1 = best, position-adjusted. Recovered by inverting
 * each of generateCombineTesting's per-measurable formulas back to the single
 * 20..99 quality proxy they were all generated from, then averaging.
 *
 * Deliberately NOT a percentile against the current class. A percentile moves
 * every time a prospect is drafted out of the pool, which would quietly
 * re-grade everyone still on the board mid-draft — a number that changes
 * because someone else got picked is the sort of lying metric this codebase
 * keeps having to fix. This read depends on nothing but the player's own
 * public testing numbers.
 */
export function publicAthleticism(position: string, testing: Partial<CombineTesting>): number | null {
  /**
   * -------------------------------------------------------------------------
   * POSITION MUST NOT DECIDE HOW ATHLETIC A MAN LOOKS.
   * -------------------------------------------------------------------------
   * This used to invert the generator's formulas by hand, and it anchored only
   * the forty. The other four drills were scored against FLAT league-wide
   * constants — 28in vertical, 100in broad, 7.00s three-cone, 14 bench reps —
   * which were correct for exactly as long as every position in football tested
   * identically. They no longer do: the combine is anchored per position now
   * (a corner's vertical means 35.7in, a left guard's means 27.1in), and
   * measuring both against 28 told the room the corner was a freak and the
   * guard was a plodder for no reason but where they line up.
   *
   * Measured over 40 freshly generated classes, 16,000 prospects, walked in
   * generation order:
   *
   *                    spread across positions    sd within a position
   *   hand-inverted           0.271                      0.173
   *     CB 0.648 ... LG 0.377
   *   z against the anchor    0.031                      0.288
   *     every position 0.506-0.537
   *
   * Both halves of that matter. The spread across positions is the bias itself
   * — a silent, permanent grade shift of over two points, up for the skill
   * positions and down for the line. The sd WITHIN a position is what the
   * stopwatch bias has to work with at all, and flattening it to 0.173 quietly
   * switched most of the effect off.
   *
   * So it reads the same per-position anchor table the numbers were generated
   * from, rather than a second hand-written copy of it that can go stale the
   * next time the combine moves. That is the whole lesson: one table, one
   * reader.
   *
   * ONE CONSEQUENCE, STATED PLAINLY. A draft class already sitting in a save
   * was generated before the combine was anchored, so its numbers are in the
   * old flat shape and this reads them a little generously for linemen — the
   * same measurement on stored classes gives a 0.276 spread the other way.
   * That is a board-grade artefact on one class, not a property of any player,
   * and it clears the moment that class is drafted. Nothing is backfilled.
   */
  return testingAthleticism(position, testing);
}

/**
 * ---------------------------------------------------------------------------
 * WHAT THE ROOM ACTUALLY REACTS TO IS NOT THE WHOLE WORKOUT
 * ---------------------------------------------------------------------------
 * publicAthleticism() above is the six-drill read the draft board's Athletic
 * column publishes. This is the narrower thing the consensus grade moves on:
 * the same drills against the same anchors, with the forty carrying
 * CONSENSUS.FORTY_FIXATION of the weight and the other five splitting the
 * rest.
 *
 * It is the difference between these two reads that makes the stopwatch worth
 * looking at. When the room priced the whole workout, the public grade already
 * contained everything the Athletic column could tell a GM, and testing added
 * almost nothing on top of a board rank sitting two columns away — see the
 * partial correlations in lib/combineRank.ts. Now the five drills the room
 * skims over stay unpriced, and a man who is ordinary in the forty and
 * excellent everywhere else is genuinely undersold by the board.
 *
 * It is also simply what draft rooms do. The forty is the number that gets
 * read out on television; the three-cone is the number the position coach
 * cares about.
 */
export function roomStopwatchRead(position: string, testing: Partial<CombineTesting>): number | null {
  const f = CONSENSUS.FORTY_FIXATION;
  const rest = (1 - f) / 5;
  return testingAthleticism(position, testing, {
    fortyYard: f,
    vertical: rest,
    broadJump: rest,
    threeCone: rest,
    shuttle: rest,
    benchReps: rest,
  });
}

// ---------------------------------------------------------------------------
// What the room is actually looking at
// ---------------------------------------------------------------------------

/**
 * ===========================================================================
 * THE ROOM GRADES A READ, NOT A PLAYER  [TUNE]
 * ===========================================================================
 * Everything above was true except for one thing: the grade was computed from
 * `trueOvr` and `potential` directly. The room could see, with no error at
 * all, both what a 22-year-old is TODAY and exactly how good he will ever be.
 * The named biases then pushed that perfect read around and a small noise term
 * wobbled it — but the thing being wobbled was the truth.
 *
 * Measured over 200 generated classes — 80,000 prospects, career peaks rolled
 * through the game's own lib/progression.ts (scripts/_bust_measure.ts) — that
 * made the board very nearly a lookup table for the answer:
 *
 *     Spearman(board rank, career peak)               -0.815
 *     consensus 1.01 who never became a starter        0 of 200
 *     worst 1.01 in 200 classes                        peaked at 83
 *     a top-5 prospect peaking below a day-three one   0.7% of pairs
 *     a Superstar (peak 95+) found in round four       once every 100 drafts
 *
 * A fog you can beat by sorting one column is not a fog. Since scouting was
 * confined to draft prospects, this board is the ONLY place left in the game
 * where the user does not know what he is looking at, so "the board is
 * sometimes wrong" has to be load-bearing rather than decorative. README
 * principle 0: *"we took a flyer in the fifth and he became the best player on
 * the team"* is one of the best stories this genre has and it could not happen
 * here, because the fifth-rounder was fifth for a reason the game had already
 * checked.
 *
 * So the room now grades a READ. Two private numbers, both derived from the
 * truth, neither equal to it:
 *
 *   NOW      what the tape says he is. Wrong by a few points, either way.
 *   CEILING  what the room thinks he becomes. Wrong by much more, and wrong
 *            in a particular direction: a room with no crystal ball projects
 *            off the player it can see plus a standard allowance for being
 *            22. CEILING_TRUST is how much of a prospect's real remaining
 *            headroom it actually detects. It is not 1 and it is not 0.
 *
 * WHY HERE AND NOT A BIGGER NOISE_SD. Noise on the finished grade moves
 * everyone a little and models nothing. The real failure is that evaluating a
 * college player and projecting a 22-year-old are two different hard problems
 * that fail independently — a man can be read right and projected wrong, which
 * is the most common way a first-round pick goes bad. Feeding the error in at
 * the inputs also fixes something that was quietly wrong: the biases are now
 * applied to the number the room BELIEVES. "Called a project" is measured
 * against the gap the room thinks it sees, and the stopwatch bias against the
 * ability the room thinks he has. Before this both read the truth — a room
 * that already knows the answer and marks it down is not biased, it is
 * discounting.
 *
 * THREE REGIMES, NOT ONE BELL CURVE. A single Gaussian spreads the board
 * evenly and still cannot produce the two events this mechanic exists for: the
 * fifth-rounder who is genuinely a star, and the first pick who cannot play.
 * Both live in the tail, so the tail is modelled rather than left to a wide SD
 * that would also blur every ordinary prospect into mush:
 *
 *   READ      the ordinary case. The room is a few points off.
 *   MISFILED  the room has him wrong — the man playing behind an
 *             All-American, the scheme that hid him, the two bad games
 *             everybody happened to watch.
 *   BLIND     nobody got a real look. One tape, a small school, an injury
 *             year. The room is guessing and does not know it is guessing.
 *
 * The regime scales BOTH errors together, so a misfiled prospect is misfiled
 * as one story rather than as two independent dice.
 *
 * SYMMETRIC WHERE THE ROOM HAS LOOKED, SKEWED WHERE IT HAS NOT. Both halves
 * are real and both are wanted: a first pick that can bust is the only thing
 * that makes a first pick worth having, and a seventh-rounder who is genuinely
 * a star is the best story this genre has. But run flat and symmetric over
 * four hundred names, the tails stopped being stories and became the ordinary
 * case at the top of the board: 47% of consensus number ones were MISFILED or
 * BLIND reads against a 21% class-wide rate, and the median board #1 was an
 * 80 overall in classes whose best men rated 88 — a room that had never
 * watched a man deciding he was the best player in the country, every other
 * draft. So the error is now scaled by EXPOSURE, and its UPWARD half is
 * damped on the men nobody watched. The downside is untouched, and that is
 * deliberate: every named story above is a story about a man being UNDERSOLD,
 * and that half is where the late-round steal comes from. It still costs a
 * first pick — rolled through lib/progression.ts over 40 classes, the
 * consensus 1.01 peaks below 78 one year in ten and somebody outside the top
 * 96 out-peaks him in half of them.
 *
 * WHAT THIS STILL MAY NOT DO. None of these numbers is returned. The room's
 * private read is exactly as unpublishable as trueOvr: `grade` is the number
 * the board actually believes, `boardScore` is the number it actually sorts
 * by, every bias delta is the number actually added, and buildScoutedView
 * remains the only thing that decides what the user may see. The board is
 * allowed to be wrong. It is not allowed to be quoted wrong.
 *
 * DETERMINISM. Three more named streams seeded off the player id, like every
 * other draw in this file, so a prospect reads identically in every process
 * for the life of the save — and so that adding a fourth later cannot
 * reshuffle the three that exist.
 * ===========================================================================
 */
export const CONSENSUS_EVAL = {
  /**
   * Ordinary evaluation error on CURRENT ability, in overall points. The room
   * is TIGHT in the ordinary case on purpose, because the variance that makes
   * this mechanic work belongs in the two named tails below rather than
   * smeared over everybody: a flat wide SD blurs the whole board equally,
   * leaves it uninformative in the middle, and STILL will not produce the
   * fifth-rounder who is genuinely a star, because that event lives four SDs
   * out. Pooled over all three regimes, and after EXPOSURE below scales it,
   * the room's read lands within 10 points on 83% of a class and within 20 on
   * 95%, with a median miss of 4.2 — and the 3% it misses by more than 25 is
   * the whole mechanic. On the men rated 86 and better the median miss is
   * 3.2, which is EXPOSURE doing its job and not a second constant.
   */
  EVAL_SD: 7,
  /**
   * MISFILED: the room has him wrong — read at three times the ordinary
   * error (SD 21). One in six of the men nobody has watched, which sounds
   * high until you count how much of any real class turns out to have been
   * badly misjudged; EXPOSURE below thins it toward the top of the board, so
   * across a whole class it is drawn about one time in seven (15.1%).
   */
  MISFILE_ODDS: 0.16,
  MISFILE_MULT: 3.0,
  /**
   * BLIND: one in twenty of the men nobody watched — about one in
   * twenty-one across a whole class once EXPOSURE thins it — read at four
   * times (SD 28 — about the full width of
   * the range a prospect is generated across, GENERATION.DRAFT_OVR_MIN..MAX,
   * which is the honest meaning of "the room's opinion of him is worth no more
   * than a name pulled out of the class at random"). Deliberately bounded
   * there: an earlier pass ran this at 5.5 and produced reads thirty-six
   * points off, which is not "nobody scouted him", it is a random number
   * generator wearing a scouting report.
   */
  BLINDSPOT_ODDS: 0.05,
  BLINDSPOT_MULT: 4.0,
  /**
   * The standard allowance the room adds for "he is twenty-two", in points.
   * It IS GENERATION.ROOKIE_POTENTIAL_BONUS_MEAN — the generator's own
   * statement of a rookie's typical headroom — read rather than copied.
   *
   * IT USED TO BE A COPY, AND THE COPY WENT STALE. This was a literal 14 with
   * a comment saying it was deliberately equal to the generator's number; the
   * generator's number then moved twice and this did not, so the room spent
   * two changes adding nine points of headroom no rookie in the game had, to
   * every prospect on the board, while the comment describing the policy was
   * the only place the policy still existed. Reading the constant is the fix
   * that cannot go stale again. Change it — over there — and every grade on
   * this board shifts with it.
   */
  CEILING_ANCHOR: GENERATION.ROOKIE_POTENTIAL_BONUS_MEAN,
  /**
   * How much of a prospect's REAL remaining headroom the room detects, 0..1.
   * At 0 the board is a pure function of current ability; at 1 it reads the
   * future exactly, which is what it used to do. 0.35 says the room picks up
   * some of it — frame, age, raw traits are real tells — and misses most.
   *
   * THIS IS NOW THE FLOOR OF A RANGE, NOT A FLAT NUMBER. It is what the room
   * detects about a man it has barely seen; CEILING_TRUST_WATCHED below is
   * what it detects about one it has watched everything of, and EXPOSURE
   * slides between them. 0.35 flat was measured as a weak lever and it was
   * one — sweeping it across its ENTIRE range moved Spearman(board rank,
   * career peak) by 0.025 — precisely BECAUSE it was flat: a number applied
   * equally to four hundred names cannot separate any of them. The pair does
   * what the single constant could not.
   */
  CEILING_TRUST: 0.35,
  /** Spread of the projection error, in points. Larger than EVAL_SD because a ceiling is a forecast and a rating is an observation. See the note above on how little it moves. */
  CEILING_SD: 7,

  /**
   * =========================================================================
   * EXPOSURE — the room has not watched everybody the same amount
   * =========================================================================
   * Everything above applies the SAME error to every name in the class. That
   * is the one part of "the room is wrong" that is not football. A room is
   * wrong about the redshirt sophomore at a directional school; it is not
   * wrong in the same way about the man who has started thirty-nine games on
   * national television, tested in front of every club at the combine, and
   * been argued about on a set every Saturday for three years. Applied flat,
   * the two named tails above — MISFILED and BLIND, "nobody got a real look"
   * — landed on the consensus best player in the country one time in five.
   *
   * So the read is scaled by EXPOSURE: 0 is a name on a list, 1 is three
   * years of Saturday nights. A logistic in the man's real ability, because
   * that is what gets a player watched — the good ones play at the programmes
   * that are on television, in the all-star games, at the top of every
   * position board. It is smooth and it never reaches either end: the most
   * scouted prospect alive still carries error, and the most obscure one is
   * still occasionally seen clearly. No wall, a curve.
   *
   * IT DOES TWO THINGS, AND THEY ARE THE SAME THING. A watched man is read
   * more tightly (ERROR_RELIEF, and the two tails get rarer by TAIL_RELIEF),
   * and his UPSIDE is understood better (CEILING_TRUST rises toward
   * CEILING_TRUST_WATCHED). Both are the same sentence: you cannot miss on a
   * player you have seen a hundred times, in either direction.
   *
   * WHAT IT DELIBERATELY DOES NOT DO. Exposure is 0.01 on a 62-overall, 0.07
   * on a 71, 0.31 on an 80 and 0.77 on a 90 — near nothing over most of a
   * class, so the fog across the middle and back of the board barely moves.
   * The relief factors are fractions, not switches: a blue chip can still be
   * misfiled, just at the rate a blue chip actually is.
   *
   * WHAT IT COSTS, MEASURED, because it is not free. Over 250 classes it
   * takes a Generational prospect's median board rank from 24 to 15, his
   * share of top-five slots from 14.8% to 22.7%, his share of first rounds
   * from 60.4% to 75.7%, and the share of drafts whose consensus #1 is
   * Generational from 5.6% to 10.4%. Over 40 classes rolled through
   * lib/progression.ts it also takes Spearman(board rank, career peak) from
   * -0.670 to -0.722, and it thins the seventh round's Star-or-better count
   * from 1.55 a draft to 1.12. The board is a better
   * board and the late rounds are a little quieter for it; that trade is the
   * reason the relief factors are fractions and not 1, and it is the number
   * to watch if anyone pushes them further.
   * =========================================================================
   */
  /** True overall at which the room has watched half of what there is to watch. */
  EXPOSURE_MID: 84,
  /** Points of true overall the logistic takes to go from barely-seen to seen. */
  EXPOSURE_WIDTH: 5,
  /** Share of the ordinary read error a fully-watched man is spared. */
  EXPOSURE_ERROR_RELIEF: 0.45,
  /** Share of the MISFILED and BLIND odds a fully-watched man is spared. */
  EXPOSURE_TAIL_RELIEF: 0.85,
  /** CEILING_TRUST for a man the room has watched everything of. */
  CEILING_TRUST_WATCHED: 0.95,
  /**
   * How much of an UPWARD read error survives on a man nobody has watched.
   * Below 1 this is deliberately asymmetric, and it is the half of exposure
   * that actually cleans up the top of the board.
   *
   * Both named tails are stories about a man being UNDERSOLD — the one
   * playing behind an All-American, the scheme that hid him, the small school,
   * the injury year. Run symmetrically they also say the opposite: that a room
   * which never watched a man can be certain he is the best player in the
   * country. Measured over 150 classes, that is not a rare accident but the
   * ordinary case — 47% of consensus number ones were MISFILED or BLIND reads
   * against a 21% class-wide rate, and the median board #1 was an 80 overall
   * in classes whose best men rate 88. The extreme of a fat-tailed error over
   * four hundred names is the fat tail, every single time.
   *
   * So the downside stays exactly as wide as it was — the fifth-round steal is
   * that half and it is untouched — and the upside is damped in proportion to
   * how little the room has seen. A room that has not watched a man does not
   * put him at the top of its board; it leaves him off it.
   */
  UNSEEN_UPSIDE: 0.6,
  /**
   * Where the room's PERCEIVED ceiling starts bending toward the top of the
   * scale instead of being chopped off at it. 37% of the men rated 88 and
   * better used to come back with a perceived ceiling of exactly 99 — the one
   * term in the grade that is supposed to separate the top of a class, not
   * separating precisely there.
   */
  CEILING_READ_KNEE: 93,
  /**
   * Where the finished GRADE starts bending toward the ends of its own scale
   * instead of being chopped off at them.
   *
   * `clamp(base + delta + noise, 20, 99)` used to close this file, and it was
   * the most expensive wall of the lot because everything this board is FOR
   * happens at the top of it. Measured over 120 classes, 639 prospects came
   * back graded exactly 99 against 248 at 98 — five and a third men a class
   * tied at the very top of the board, separated by nothing but positional
   * value, in a draft whose whole question is who goes first. The bottom did
   * the same on a smaller scale: 90 men on exactly 20 against 26 on 21.
   *
   * Bent, the order survives to the sort. The knee is HIGH on purpose: the
   * bend squeezes everything above it into the points that are left, so a low
   * knee would buy a flat histogram by flattening the very discrimination
   * this is here to protect.
   */
  GRADE_SOFT_KNEE_HI: 96,
  GRADE_SOFT_KNEE_LO: 28,

  /**
   * =========================================================================
   * SCRUTINY — the top of a board is the most examined place in the sport
   * =========================================================================
   * EXPOSURE above is how much football the room watched BEFORE it had an
   * opinion. This is the other half: what happens to a man BECAUSE it has one.
   *
   * The consensus number one is the most scrutinised player in football. Every
   * club sends its area scout, then its coordinator, then its general manager;
   * he is dissected on television for four months; a workout warrior with
   * nothing behind him gets found out well before draft day, because the whole
   * industry goes looking. That is not true of the man the board has 140th,
   * and it is exactly why a sleeper misjudged in the fifth round is football
   * and a nobody crowned first overall is not.
   *
   * Measured over 600 generated classes on the shipped board BEFORE this: the
   * board's number one carried a sub-Star ceiling in 24.2% of drafts, and the
   * worst one seen was a 57 overall with a 58 ceiling, graded 94. The centre
   * of the board was healthy — median #1 was an 83 overall with a 90 ceiling —
   * so this is a tail, and the tail is the part a user actually looks at.
   *
   * HOW IT WORKS, AND WHY IT IS TWO PASSES. Scrutiny follows the board, and
   * the board follows the grade, so the grade has to exist before scrutiny can
   * be applied to it. consensusGradeFor therefore grades a prospect once with
   * no scrutiny, reads how high that provisional grade sits, and grades him
   * again with the room's error narrowed in proportion. It is two evaluations
   * of a pure function, not a fixed point: the second pass never feeds a
   * third, so there is nothing to converge and nothing to oscillate. Below the
   * knee the second pass is skipped entirely, which is most of any class.
   *
   * WHAT IT NARROWS, AND WHAT IT DELIBERATELY DOES NOT. It narrows the room's
   * MISS — the width of its error about what a man is today — and NOTHING
   * ELSE. It does not touch CEILING_SD and it does not touch CEILING_TRUST,
   * so nobody's crystal ball gets better for being looked at:
   * the room can still be certain what a prospect IS and badly wrong about
   * what he BECOMES, which is the ordinary way a first pick goes bad and the
   * reason the 1.01 still busts. It does not touch the bias stack either — a
   * blue chip still slides on a medical flag, which happens every real April.
   *
   * WHAT IT ACTUALLY DID, over 600 classes for the board numbers and 40 rolled
   * through lib/progression.ts for the rest:
   *
   *                                          before      after
   *   board #1 with a sub-Star ceiling        24.2%       2.8%
   *   board #1 with a sub-Day-One ceiling      7.5%       0.3%
   *   worst board #1 seen                  57ovr/58pot  72ovr/77pot
   *   board #1 rated below his class mean      2.7%       0.0%
   *   board #1 rating   median / MIN            83 / 53    87 / 69
   *   board #1 ceiling  median / MIN            90 / 58    95 / 77
   *   ceiling gap, class best minus #1     mean 9.7/max 41  mean 4.9/max 22
   *   a Generational prospect goes #1          5.6%      22.0%
   *   ... in the top five                     14.8%      34.5%
   *   ... in the first round                  60.4%      81.7%
   *
   * WHAT IT COSTS. It makes the very top of the board a better ordering, and
   * that is a real cost against a fog this file exists to protect. It is aimed
   * as narrowly as it can be: SCRUTINY_KNEE sits above the 98th percentile of
   * the grade distribution, so the middle and the back of the board — where
   * the fifth-round steal lives — do not move at all. Measured, the fog rails
   * hold: Spearman(board rank, career peak) -0.692 -> -0.688 against the
   * -0.815 lookup-table state this mechanic exists to avoid, and somebody
   * outside the top 96 still out-peaks the consensus 1.01 in 45% of drafts.
   *
   * IT COULD ONLY LAND AFTER THE BUST WAS REHOMED, and that ordering was not
   * optional. Before PROGRESSION.DEV_ARC_* existed, every bust in the game was
   * this defect: the 1.01 "busted" 10% of the time purely because the board
   * sometimes crowned a man who could not play, so cleaning the top of the
   * board deleted busts along with the frauds. Development now fails players
   * on its own and the first pick can be wrong for a football reason.
   * =========================================================================
   */
  /** Provisional grade at which the room is giving a man half the extra looks. */
  SCRUTINY_KNEE: 88,
  /** Grade points the logistic takes to go from barely-examined to examined. */
  SCRUTINY_WIDTH: 4,
  /** Share of the room's remaining read error a fully scrutinised man loses. */
  SCRUTINY_RELIEF: 0.95,
} as const;

/**
 * The room's private read of one prospect. NEVER returned from this module —
 * it is an input to an opinion, in exactly the way trueOvr is.
 */
interface RoomRead {
  /** What the tape says he is today. */
  now: number;
  /** What the room projects he becomes. */
  ceiling: number;
}

/** How much football the room has watched, 0..1 — see EXPOSURE above. */
function roomExposure(trueOvr: number): number {
  return 1 / (1 + Math.exp(-(trueOvr - CONSENSUS_EVAL.EXPOSURE_MID) / CONSENSUS_EVAL.EXPOSURE_WIDTH));
}

function roomReadOf(p: ConsensusInput, scrutiny: number): RoomRead {
  const E = CONSENSUS_EVAL;

  // How much football the room has actually watched — see EXPOSURE above.
  // Logistic, so it is a curve rather than a bracket and reaches neither end.
  const exposure = roomExposure(p.trueOvr);

  // Which regime this prospect falls in. Its own stream, so widening the tail
  // in a later patch cannot reshuffle the ordinary reads already in a save.
  // The two tails are STORIES ABOUT OBSCURITY, so their odds shrink with
  // exposure rather than being flat across the class; the relief is partial,
  // so the blue chip nobody had a real read on still exists.
  const roll = new Rng(`consensus-regime-${p.id}`).float(0, 1);
  const unseen = 1 - E.EXPOSURE_TAIL_RELIEF * exposure;
  const blindOdds = E.BLINDSPOT_ODDS * unseen;
  const misfileOdds = E.MISFILE_ODDS * unseen;
  const regime =
    roll < blindOdds ? E.BLINDSPOT_MULT
      : roll < blindOdds + misfileOdds ? E.MISFILE_MULT
        : 1;
  const spread = regime * (1 - E.EXPOSURE_ERROR_RELIEF * exposure);
  // SCRUTINY NARROWS ONE OF THE TWO ERRORS AND NOT THE OTHER, and that split
  // is the whole of why it is safe. Extra looks tell a room what a man IS —
  // more tape, more interviews, a second and third opinion on the same
  // Saturdays. They do not tell it what he BECOMES; no amount of examination
  // is a crystal ball. So the read of today narrows and the projection keeps
  // its full width, which is what leaves the consensus 1.01 able to be exactly
  // the player everyone thought he was and still never get there.
  //
  // Applied to both (the first version of this did), the number one pick
  // stopped busting at all: 10% of 1.01s peaked below 78 before, 0% after,
  // and the share of classes where somebody outside the top 96 out-peaked him
  // fell from 70% to 30%. That is the fog this file exists to protect, undone
  // by a fix aimed at something else.


  // The read itself. The miss is symmetric for a man the room has watched and
  // skewed to the downside for one it has not — see UNSEEN_UPSIDE.
  const readSpread = spread * (1 - E.SCRUTINY_RELIEF * scrutiny);
  const miss = new Rng(`consensus-read-${p.id}`).normal(0, E.EVAL_SD * readSpread);
  const skewed = miss > 0 ? miss * (E.UNSEEN_UPSIDE + (1 - E.UNSEEN_UPSIDE) * exposure) : miss;
  const now = clamp(p.trueOvr + skewed, 20, 99);

  // The projection. Anchored on the standard allowance and pulled only
  // partway toward the headroom he actually has, then missed by CEILING_SD.
  // How far it is pulled is the same exposure: the upside of a man the room
  // has watched a hundred times is not a guess, and the upside of a man it
  // has one tape of is almost entirely one.
  const trust = E.CEILING_TRUST + (E.CEILING_TRUST_WATCHED - E.CEILING_TRUST) * exposure;
  const trueGap = p.potential - p.trueOvr;
  const seenGap =
    E.CEILING_ANCHOR +
    trust * (trueGap - E.CEILING_ANCHOR) +
    new Rng(`consensus-project-${p.id}`).normal(0, E.CEILING_SD * spread);

  // BENT, NOT CHOPPED. This was clamp(now + max(0, seenGap), now, 99), and a
  // clamp does not remove the reads past the bound, it stacks them ON it:
  // 37% of the men rated 88 and better came back with a perceived ceiling of
  // exactly 99, so the one term in the grade that is supposed to separate the
  // top of a class stopped separating precisely there. Same decaying
  // exponential lib/gen/players.ts bends a prospect's real ceiling with —
  // imported rather than copied, because two ceilings in one game free to
  // drift apart is how this keeps happening.
  //
  // The lower bound stays: a ceiling below what he already is would be
  // incoherent — nobody in the room says "he is a 78 and he tops out at 74" —
  // and it now also catches the case where the bend itself would push a
  // very high read below its own current number.
  const seen = bendToCeiling(now + Math.max(0, seenGap), E.CEILING_READ_KNEE, GENERATION.POTENTIAL_CEILING);
  return { now, ceiling: Math.max(now, seen) };
}

// ---------------------------------------------------------------------------
// Biases
// ---------------------------------------------------------------------------

export type ConsensusBiasId =
  | 'TESTING_DARLING'
  | 'TESTING_FADED'
  | 'BLUE_BLOOD'
  | 'SMALL_SCHOOL'
  | 'DEVELOPMENTAL_DISCOUNT'
  | 'MEDICAL_DISCOUNT';

export interface ConsensusBias {
  id: ConsensusBiasId;
  /** Short name for a chip or a tag. */
  label: string;
  /** Which way this pushed the grade. */
  direction: 'UP' | 'DOWN';
  /** Grade points this bias contributed. Signed, and it is the number actually added. */
  delta: number;
  /** The PUBLIC signal that caused it — what a scout would point at. */
  because: string;
  /** How a report that disagrees would put it. */
  counter: string;
}

const BIAS_LABEL: Record<ConsensusBiasId, string> = {
  TESTING_DARLING: 'Testing darling',
  TESTING_FADED: 'Tested poorly',
  BLUE_BLOOD: 'Big program',
  SMALL_SCHOOL: 'Small school',
  DEVELOPMENTAL_DISCOUNT: 'Called a project',
  MEDICAL_DISCOUNT: 'Medical flag',
};

/**
 * ===========================================================================
 * A DISCOUNT AND A PREMIUM ARE OPPOSITE KINDS OF NEWS
 * ===========================================================================
 * Four of the six biases mark a prospect DOWN and two push him UP, and to a
 * GM those are not one list. A discount is where a steal comes from — the
 * room has taken points off a man for something public, and if the tape
 * disagrees you can have him later than he should go. A premium is where a
 * bust comes from — the room has ADDED points for something public, so the
 * grade in front of you is inflated and you are being asked to pay for a
 * stopwatch.
 *
 * The direction is not a UI opinion: it is the sign of the delta each block
 * in consensusGradeFor() actually adds, and the four constant-driven ones are
 * checked against tuning at module load (see below) so that flipping a sign in
 * lib/tuning.ts cannot leave a screen filing a markdown under the men the room
 * reaches for. The two testing biases need no check — they are pushed from
 * inside `if (d > 0)` / `else` branches, so their direction is structural.
 * A screen that wants to split the two —
 * app/league/[id]/scouting/page.tsx does — reads this rather than keeping a
 * second copy of which is which, because a second copy is exactly how a
 * "Medical flag" ends up filed under the men the room reaches for.
 *
 * ORDER IS THE READING ORDER: discounts first (the exploitable half), each
 * group heaviest-handed first, so a filter bar built off this list puts the
 * biggest markdown at the left.
 * ===========================================================================
 */
export interface ConsensusBiasMeta {
  id: ConsensusBiasId;
  label: string;
  direction: 'UP' | 'DOWN';
  /** What a GM does with it, in one clause. Not an explanation of the model. */
  soWhat: string;
}

export const CONSENSUS_BIASES: readonly ConsensusBiasMeta[] = [
  { id: 'MEDICAL_DISCOUNT', label: BIAS_LABEL.MEDICAL_DISCOUNT, direction: 'DOWN', soWhat: 'the same flat markdown on everyone flagged, whatever the actual prognosis' },
  { id: 'SMALL_SCHOOL', label: BIAS_LABEL.SMALL_SCHOOL, direction: 'DOWN', soWhat: 'production against weak competition, discounted past the point of fairness' },
  { id: 'TESTING_FADED', label: BIAS_LABEL.TESTING_FADED, direction: 'DOWN', soWhat: 'timed slow for the position by a room that never watched him play' },
  { id: 'DEVELOPMENTAL_DISCOUNT', label: BIAS_LABEL.DEVELOPMENTAL_DISCOUNT, direction: 'DOWN', soWhat: 'unfinished, and a board ranks what it can defend to an owner in April' },
  { id: 'TESTING_DARLING', label: BIAS_LABEL.TESTING_DARLING, direction: 'UP', soWhat: 'the room moved him up on workout numbers nobody plays a down in' },
  { id: 'BLUE_BLOOD', label: BIAS_LABEL.BLUE_BLOOD, direction: 'UP', soWhat: 'a big programme taken at its word, supporting cast included' },
] as const;

const BIAS_META_BY_ID: Record<ConsensusBiasId, ConsensusBiasMeta> =
  Object.fromEntries(CONSENSUS_BIASES.map((b) => [b.id, b])) as Record<ConsensusBiasId, ConsensusBiasMeta>;

// The four constant-driven directions, checked against the tuning that
// produces them. Cheap enough to run at import; loud enough that a sign flip
// in lib/tuning.ts is caught by whoever flipped it rather than by a GM reading
// "Medical flag" in the column of things the room is high on.
for (const [id, positive] of [
  ['BLUE_BLOOD', CONSENSUS.PROGRAM_PULL.A > 0],
  ['SMALL_SCHOOL', CONSENSUS.PROGRAM_PULL.F > 0],
  // Both of these are SUBTRACTED at their push site, so a positive constant is a DOWN bias.
  ['DEVELOPMENTAL_DISCOUNT', CONSENSUS.DEVELOPMENTAL_PULL < 0],
  ['MEDICAL_DISCOUNT', CONSENSUS.MEDICAL_PULL < 0],
] as [ConsensusBiasId, boolean][]) {
  const declared = BIAS_META_BY_ID[id].direction === 'UP';
  if (declared !== positive) {
    throw new Error(
      `lib/consensus.ts: CONSENSUS_BIASES declares ${id} as ${BIAS_META_BY_ID[id].direction}, `
      + 'but the tuning constant behind it has the opposite sign. Fix one of the two.',
    );
  }
}

export function consensusBiasMeta(id: string): ConsensusBiasMeta | undefined {
  return BIAS_META_BY_ID[id as ConsensusBiasId];
}

/** Narrow a URL query parameter to a real bias id. Anything else is not a filter. */
export function isConsensusBiasId(value: string | undefined | null): value is ConsensusBiasId {
  return !!value && value in BIAS_META_BY_ID;
}

// ---------------------------------------------------------------------------
// The grade
// ---------------------------------------------------------------------------

/** The Player columns this needs, named exactly as the schema stores them so a prisma row can be passed straight in. */
export interface ConsensusInput {
  id: string;
  position: string;
  trueOvr: number;
  potential: number;
  /** JSON string, as stored. */
  trueAttrs: string;
  /** JSON string, as stored (CollegeProfile). */
  collegeStats: string;
  /** JSON string, as stored (CombineTesting). */
  combineTesting: string;
  injuryWeeks?: number;
}

export interface ConsensusGrade {
  playerId: string;
  position: string;
  /** 0..99 public grade. An opinion, not a rating — it is NOT trueOvr and must never be rendered as one. */
  grade: number;
  /**
   * What the board actually SORTS by, and therefore what `rank` ranks: the
   * unrounded grade plus positional value. Published rather than hidden — a
   * rank whose ordering number is not on the page is exactly the sort of lying
   * metric this codebase keeps having to fix.
   */
  boardScore: number;
  /** Board-score points positional value moved him. Moves his SLOT, never his grade. */
  positionPull: number;
  /** Plain-language note when positional value moved him enough to notice, else null. */
  positionNote: string | null;
  /** Every named bias that moved the GRADE, strongest first. */
  biases: ConsensusBias[];
  /** Public medical flag. Surfaced separately because the flag itself is news even before the grade moves. */
  medicalFlag: boolean;
  /** 0..1 position-adjusted public testing read, or null if he never tested. */
  athleticism: number | null;
}

/** The ends of the public grade scale. Asymptotes now, not walls — see GRADE_SOFT_KNEE_HI. */
const GRADE_MAX = 99;
const GRADE_MIN = 20;

/**
 * One prospect's public grade. Pure, deterministic, and free — no database,
 * no team, no scouting report, no cost.
 */
export function consensusGradeFor(p: ConsensusInput): ConsensusGrade {
  // ONE PASS TO FORM AN OPINION, ONE TO EXAMINE IT — see SCRUTINY. The first
  // grade is what the room thinks before anybody goes looking; how high it
  // lands is what decides how hard the industry then looks. A man the first
  // pass leaves in the middle of the board is returned untouched, which is
  // most of a class.
  const provisional = gradeOnce(p, 0);
  const E = CONSENSUS_EVAL;
  const scrutiny = 1 / (1 + Math.exp(-(provisional.boardScore - provisional.positionPull - E.SCRUTINY_KNEE) / E.SCRUTINY_WIDTH));
  return scrutiny < 1e-3 ? provisional : gradeOnce(p, scrutiny);
}

function gradeOnce(p: ConsensusInput, scrutiny: number): ConsensusGrade {
  const trueAttrs = readJson<AttrMap>(p.trueAttrs, {});
  const college = readJson<Partial<CollegeProfile>>(p.collegeStats, {});
  const testing = readJson<Partial<CombineTesting>>(p.combineTesting, {});

  // THE ONE PLACE THE TRUTH ENTERS. Everything below grades `room`, not `p`.
  const room = roomReadOf(p, scrutiny);
  const base =
    CONSENSUS.CURRENT_WEIGHT * room.now +
    CONSENSUS.POTENTIAL_WEIGHT * room.ceiling;

  const biases: ConsensusBias[] = [];
  let delta = 0;

  // --- 1. The stopwatch ----------------------------------------------------
  // The room over-weights testing, so the pull is the GAP between how a
  // prospect tested and how good he actually is. That is precisely what makes
  // the generator's workout-warrior and bad-tester archetypes matter: the
  // warrior's numbers are public and genuinely lift him here even though the
  // tape never saw it coming, and the good player who ran a 4.8 gets marked
  // down by a room that never watched him play.
  const athleticism = publicAthleticism(p.position, testing);
  // NOT the same read. The published Athletic column is the whole workout;
  // what moves a grade is the room's forty-first skim of it — see
  // roomStopwatchRead, and the paragraph above it for why the gap between the
  // two is the whole reason a GM should look at testing at all.
  const stopwatch = roomStopwatchRead(p.position, testing);
  // The room's own read, not the truth — a bias is a distortion of what an
  // evaluator believes. Reading trueOvr here meant the stopwatch markdown was
  // applied by a room that already knew exactly how good he was.
  const ability = clamp((room.now - 40) / 55, 0, 1);
  if (stopwatch != null) {
    const d = CONSENSUS.TESTING_PULL * (stopwatch - ability);
    delta += d;
    if (Math.abs(d) >= CONSENSUS.BIAS_REPORT_THRESHOLD) {
      const up = d > 0;
      biases.push({
        id: up ? 'TESTING_DARLING' : 'TESTING_FADED',
        label: BIAS_LABEL[up ? 'TESTING_DARLING' : 'TESTING_FADED'],
        direction: up ? 'UP' : 'DOWN',
        delta: d,
        because: up
          ? 'He tested near the top of his position group and the board moved him up for it.'
          : 'He tested badly for the position and the board moved him down for it.',
        counter: up
          ? 'Workout numbers are not tape. Nothing about how he tested says he can play.'
          : 'The stopwatch is not the position. Plenty of good players time out slow.',
      });
    }
  }

  // --- 2. Where he played --------------------------------------------------
  // Production against A-tier competition gets taken at face value; the same
  // production against F-tier gets discounted past the point of fairness,
  // which is where small-school steals come from.
  const grade = (college.competitionGrade ?? 'C') as CompetitionGrade;
  const programD = CONSENSUS.PROGRAM_PULL[grade] ?? 0;
  if (programD !== 0) {
    delta += programD;
    if (Math.abs(programD) >= CONSENSUS.BIAS_REPORT_THRESHOLD) {
      const up = programD > 0;
      biases.push({
        id: up ? 'BLUE_BLOOD' : 'SMALL_SCHOOL',
        label: BIAS_LABEL[up ? 'BLUE_BLOOD' : 'SMALL_SCHOOL'],
        direction: up ? 'UP' : 'DOWN',
        delta: programD,
        because: up
          ? `He put his numbers up against ${grade}-grade competition and the board trusts them.`
          : `He put his numbers up against ${grade}-grade competition and the board discounts them.`,
        counter: up
          ? 'A good program covers a lot. The supporting cast is not coming with him.'
          : 'Nobody he lined up against is the reason he wins. The traits travel.',
      });
    }
  }

  // --- 3. Ready now over ready later --------------------------------------
  // A board is a ranking of players teams have to justify to an owner in
  // April. A raw prospect with a huge ceiling is the hardest thing to defend
  // in that room, so he slides — even when the ceiling is real.
  // Again the perceived gap: "he is unfinished" is a statement about what the
  // room sees, and the room does not see a real ceiling.
  const gap = room.ceiling - room.now;
  if (gap > CONSENSUS.DEVELOPMENTAL_GAP_MIN) {
    const d = -CONSENSUS.DEVELOPMENTAL_PULL * clamp((gap - CONSENSUS.DEVELOPMENTAL_GAP_MIN) / 20, 0, 1);
    delta += d;
    if (Math.abs(d) >= CONSENSUS.BIAS_REPORT_THRESHOLD) {
      biases.push({
        id: 'DEVELOPMENTAL_DISCOUNT',
        label: BIAS_LABEL.DEVELOPMENTAL_DISCOUNT,
        direction: 'DOWN',
        delta: d,
        because: 'He is unfinished, and the room grades what it can see today.',
        counter: 'The gap between what he is and what he could be is the reason to take him, not the reason to pass.',
      });
    }
  }

  // --- 4. The medical ------------------------------------------------------
  // A flag is public the moment it exists and the board applies the same flat
  // markdown to every flagged player, whatever the actual prognosis. Flags
  // correlate with true durability but not tightly — the exploitable case is
  // the flagged prospect whose shoulder is genuinely fine, and it has to come
  // up often enough to be worth scouting for.
  const durability = trueAttrs.durability ?? 62;
  const flagOdds = clamp(
    CONSENSUS.MEDICAL_BASE_ODDS + (70 - durability) / 300,
    CONSENSUS.MEDICAL_MIN_ODDS,
    CONSENSUS.MEDICAL_MAX_ODDS,
  );
  const medicalFlag = (p.injuryWeeks ?? 0) > 0 || new Rng(`consensus-medical-${p.id}`).bool(flagOdds);
  if (medicalFlag) {
    delta -= CONSENSUS.MEDICAL_PULL;
    biases.push({
      id: 'MEDICAL_DISCOUNT',
      label: BIAS_LABEL.MEDICAL_DISCOUNT,
      direction: 'DOWN',
      delta: -CONSENSUS.MEDICAL_PULL,
      because: 'Teams flagged him at the medical recheck and the board took the same points off everyone who got flagged.',
      counter: 'A flag is not a prognosis. Our people would want to see the imaging before we move him.',
    });
  }

  // Honest disagreement between evaluators, on top of the systematic error.
  // Its own stream so a future bias cannot reshuffle existing saves.
  const noise = new Rng(`consensus-noise-${p.id}`).normal(0, CONSENSUS.NOISE_SD);

  const raw = bendToFloor(
    bendToCeiling(base + delta + noise, CONSENSUS_EVAL.GRADE_SOFT_KNEE_HI, GRADE_MAX),
    CONSENSUS_EVAL.GRADE_SOFT_KNEE_LO,
    GRADE_MIN,
  );

  // --- 5. What the position is worth --------------------------------------
  // Deliberately NOT folded into the grade. The room's grade is a football
  // opinion; where a player comes off the board is that opinion plus what the
  // position is worth in April, and those are two different numbers that a
  // front office keeps two different columns for. Splitting them is what lets
  // a page say "same grade as the quarterback, twenty picks later" — which is
  // the most exploitable thing on the whole board.
  const posValue = AI.DRAFT_POSITION_VALUE[p.position as Position] ?? 1;
  const positionPull = CONSENSUS.POSITION_PULL * (posValue - 1);

  biases.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  return {
    playerId: p.id,
    position: p.position,
    grade: Math.round(raw),
    boardScore: raw + positionPull,
    positionPull,
    positionNote: positionNoteFor(p.position, positionPull),
    biases,
    medicalFlag,
    athleticism,
  };
}

function positionNoteFor(position: string, pull: number): string | null {
  if (Math.abs(pull) < 1) return null;
  return pull > 0
    ? `The board pushes him up regardless of grade — ${position} is a position teams reach for.`
    : `The board pushes him down regardless of grade — nobody spends early capital on a ${position}.`;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

export interface ConsensusRead extends ConsensusGrade {
  /** 1 = top of the board. Unique: this is the position in the boardScore ordering. */
  rank: number;
  /** Size of the board this rank was taken against. */
  outOf: number;
  band: ConsensusBandId;
  bandLabel: string;
  bandBlurb: string;
  /** One line of plain language: why the board sits where it sits. */
  headline: string;
}

/**
 * Grade a whole class and rank it.
 *
 * WHAT RANKS WHAT. The rank is the position in the `boardScore` ordering, and
 * boardScore is returned on every row — nothing sorts by a number the caller
 * cannot see. boardScore is the unrounded grade plus positional value, so two
 * prospects showing the same rounded grade can sit a dozen slots apart, and
 * `positionNote` says why on the row itself.
 *
 * Grades are set-independent: passing a filtered list (one position, the
 * shortlist) still returns each prospect's real grade. The RANK is then a rank
 * within that list, so pass the WHOLE class — drafted prospects included —
 * when the number has to read as "the consensus #4 prospect". A rank that
 * changes because somebody else came off the board is a lie.
 */
export function buildConsensusBoard(prospects: ConsensusInput[], shape?: BoardShape): ConsensusRead[] {
  const cuts = bandCutoffs(shape);
  const graded = prospects.map(consensusGradeFor).map((g) => ({ ...g }));
  applyScarcity(graded);
  // Player id breaks an exact boardScore tie purely so the order is stable
  // across processes. Float ties are vanishingly rare; this is determinism
  // insurance, not a ranking rule.
  const sorted = [...graded].sort((a, b) => b.boardScore - a.boardScore || (a.playerId < b.playerId ? -1 : 1));
  const outOf = sorted.length;
  return sorted.map((g, i) => {
    const rank = i + 1;
    const band = bandForRank(rank, cuts);
    return {
      ...g,
      rank,
      outOf,
      band: band.id,
      bandLabel: band.label,
      bandBlurb: band.blurb,
      headline: headlineFor(g, band.label),
    };
  });
}

/**
 * ===========================================================================
 * POSITIONAL VALUE IS SCARCITY, NOT A PER-POSITION BONUS
 * ===========================================================================
 * consensusGradeFor() gives every player at a position the same positional
 * pull, because it is pure and sees one player at a time. Applied flat, a
 * +4.0 quarterback bonus put SIX quarterbacks in the top ten of a measured
 * class and EIGHT in the top thirty-two — a first round with eight
 * quarterbacks in it, every single year, forever.
 *
 * That is not how a board works. Positional value is about scarcity at the
 * top: teams reach for the best quarterback in a class, not for the fifth
 * one. The premium therefore decays with rank WITHIN the position — the QB1
 * keeps the full reach, QB2 most of it, QB5 almost none.
 *
 * The penalty on a cheap position does NOT decay. A punter is not a high
 * pick however good the punter is, which is the whole point of the number
 * being negative, and the measured class had a punter at board #49.
 *
 * CLASS-TO-CLASS VARIANCE. Real drafts differ: some years three
 * quarterbacks go in the first ten picks and some years none are worth
 * taking. A modifier seeded off the class itself scales each position's
 * reach, so a save's 2029 class is quarterback-rich and its 2030 class is
 * barren, and the GM has to read which one he is in.
 * ===========================================================================
 */
function applyScarcity(graded: ConsensusGrade[]): void {
  if (graded.length === 0) return;

  // Seeded off the set of prospects, so the same class always produces the
  // same year — and two different classes reliably produce different ones.
  const classSeed = [...graded.map((g) => g.playerId)].sort()[0] ?? 'empty';

  const byPosition = new Map<string, ConsensusGrade[]>();
  for (const g of graded) {
    if (!byPosition.has(g.position)) byPosition.set(g.position, []);
    byPosition.get(g.position)!.push(g);
  }

  for (const [position, group] of byPosition) {
    // Rank within the position on the football grade alone — the pull is
    // what we are about to compute, so it cannot be an input to itself.
    group.sort((a, b) => b.grade - a.grade || (a.playerId < b.playerId ? -1 : 1));

    // How much this class thinks of this position, this year. Centred on 1.
    const mood = 1 + new Rng(`class-mood-${classSeed}-${position}`).normal(0, CONSENSUS.CLASS_MOOD_SD);

    group.forEach((g, i) => {
      const flat = g.positionPull;
      if (flat <= 0) {
        // Cheap positions keep their whole penalty AND get it amplified. The
        // plain -5.2 on a kicker was not enough: a 99-grade kicker still
        // landed at board #28, a first-round kicker, which no room has ever
        // produced. Amplified, he sits where kickers actually go.
        const deep = flat * CONSENSUS.CHEAP_POSITION_MULT;
        g.positionPull = deep;
        g.boardScore = g.boardScore - flat + deep;
        g.positionNote = positionNoteFor(position, deep);
        return;
      }
      // 1.0 for the best at the position, decaying toward 0 down the group.
      const decay = 1 / (1 + i / CONSENSUS.SCARCITY_HALF_LIFE);
      const pull = flat * decay * Math.max(0, mood);
      g.positionPull = pull;
      g.boardScore = g.boardScore - flat + pull;
      g.positionNote = positionNoteFor(position, pull);
    });
  }
}

function bandForRank(rank: number, cuts: ReturnType<typeof bandCutoffs>) {
  const byId = (id: ConsensusBandId) => CONSENSUS.BANDS.find((b) => b.id === id)!;
  if (rank <= cuts.BLUE_CHIP) return byId('BLUE_CHIP');
  if (rank <= cuts.FIRST_ROUND) return byId('FIRST_ROUND');
  if (rank <= cuts.DAY_TWO) return byId('DAY_TWO');
  if (rank <= cuts.DAY_THREE) return byId('DAY_THREE');
  if (rank <= cuts.LATE_FLIER) return byId('LATE_FLIER');
  return byId('PRIORITY_FA');
}

function headlineFor(g: ConsensusGrade, bandLabel: string): string {
  const top = g.biases[0];
  if (!top) {
    return g.positionNote
      ? `${bandLabel}. Nothing about the grade splits the room. ${g.positionNote}`
      : `${bandLabel}. Nothing about him splits the room.`;
  }
  return top.direction === 'UP'
    ? `${bandLabel}. The board is high on him: ${lower(top.because)}`
    : `${bandLabel}. The board is down on him: ${lower(top.because)}`;
}

/** Board keyed by player id, for pages that already have their own row order. */
export function consensusBoardMap(prospects: ConsensusInput[], shape?: BoardShape): Map<string, ConsensusRead> {
  return new Map(buildConsensusBoard(prospects, shape).map((r) => [r.playerId, r]));
}

// ---------------------------------------------------------------------------
// Disagreeing with the room
// ---------------------------------------------------------------------------

/** What lib/scouting.ts's buildScoutedView hands back, narrowed to what a comparison needs. */
export interface OwnRead {
  scoutedOvr: number;
  potLow: number;
  potHigh: number;
  confidence: number;
}

/**
 * The user's own file expressed on the consensus's scale, so the two numbers
 * are actually comparable.
 *
 * This matters more than it looks. A consensus grade blends current and
 * ceiling; a scouted OVR is current only, and every prospect's ceiling is
 * above his current rating. Comparing the two raw would report the user as
 * "below the consensus" on literally every player in the class — a difference
 * that is an artefact of the two numbers measuring different things, which is
 * precisely the bug class this project keeps having to fix. So the user's read
 * gets blended by the SAME weights before anything is subtracted, using the
 * midpoint of his own scouted potential range (never a true potential).
 */
export function ownGradeFor(view: OwnRead): number {
  return Math.round(
    CONSENSUS.CURRENT_WEIGHT * view.scoutedOvr +
    CONSENSUS.POTENTIAL_WEIGHT * ((view.potLow + view.potHigh) / 2),
  );
}

/**
 * Where the user's own read sits against the room, in plain language. This is
 * the payoff of the whole file: not "he is a 78", but "we are four points
 * higher than the board is, and here is why they are low."
 */
export function disagreementNote(read: ConsensusRead, view: OwnRead): string | null {
  // Under a real file of your own there is nothing to disagree WITH — quoting
  // a gap off a near-empty report would be inventing an opinion the staff
  // does not have.
  if (view.confidence < 25) return null;
  const gap = ownGradeFor(view) - read.grade;
  if (Math.abs(gap) < 4) return null;
  const against = read.biases.find((b) => (gap > 0 ? b.direction === 'DOWN' : b.direction === 'UP'));
  const lead = gap > 0
    ? `Our file has him ${gap} points above the consensus.`
    : `Our file has him ${-gap} points below the consensus.`;
  return against ? `${lead} ${against.counter}` : lead;
}
