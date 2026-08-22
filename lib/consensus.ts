import { Rng, clamp } from './rng';
import { readJson } from './json';
import type { AttrMap } from './ratings';
import { AI, CONSENSUS } from './tuning';
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
  const base40 = BASE_40[position as Position] ?? 4.9;
  const proxies: number[] = [];
  if (testing.fortyYard != null) proxies.push(50 + (base40 - testing.fortyYard) * 160);
  if (testing.vertical != null) proxies.push(50 + (testing.vertical - 28) * 3.2);
  if (testing.broadJump != null) proxies.push(50 + (testing.broadJump - 100) * 2.3);
  if (testing.threeCone != null) proxies.push(50 + (7.0 - testing.threeCone) * 55);
  if (testing.benchReps != null) proxies.push(50 + (testing.benchReps - 14) * 3.5);
  if (proxies.length === 0) return null;
  const proxy = proxies.reduce((a, b) => a + b, 0) / proxies.length;
  return clamp((proxy - 20) / 79, 0, 1);
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
 * SYMMETRIC ON PURPOSE, and both halves are real. In one measured 200-class
 * sample the same mechanism produced Rowan Pemberton, an 87-overall edge with
 * a 99 ceiling who graded 66 and sat at board #171 and peaked at 98; and
 * Joaquin Zuniga, a 58-overall corner with a 63 ceiling who graded 97, went
 * #1 on the board and peaked at 59. That is not a side effect to be tuned
 * away: a first pick that can bust is the only thing that makes a first pick
 * worth having. One mechanism, both stories, no second system.
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
   * out. Pooled over all three regimes the room's read lands within 10 points
   * on 74% of a class and within 20 on 92%, with a median miss of 5.6 — and
   * the 6% it misses by more than 25 is the whole mechanic.
   */
  EVAL_SD: 7,
  /**
   * MISFILED: the room has him wrong — about one prospect in six, read at
   * three times the ordinary error (SD 21). One in six sounds high until you
   * count how much of any real class turns out to have been badly misjudged.
   */
  MISFILE_ODDS: 0.16,
  MISFILE_MULT: 3.0,
  /**
   * BLIND: one in twenty, read at four times (SD 28 — about the full width of
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
   * Deliberately equal to GENERATION.ROOKIE_POTENTIAL_BONUS_MEAN — the
   * generator's own statement of a rookie's typical headroom — so the grade
   * SCALE does not move when the board stops reading real ceilings. Measured
   * over 200 classes: mean grade 67.44 before this change, 67.3 after. Change
   * this and every grade on the board shifts with it.
   */
  CEILING_ANCHOR: 14,
  /**
   * How much of a prospect's REAL remaining headroom the room detects, 0..1.
   * At 0 the board is a pure function of current ability; at 1 it reads the
   * future exactly, which is what it used to do. 0.35 says the room picks up
   * some of it — frame, age, raw traits are real tells — and misses most.
   *
   * BOTH CEILING KNOBS ARE WEAK LEVERS, AND THAT IS NOT A BUG TO TUNE AROUND.
   * Measured over 150 classes, sweeping this across its ENTIRE range (0.0 to
   * 1.0) moves Spearman(board rank, career peak) by 0.025 and moves not one
   * hit rate by a full point; CEILING_SD 0 to 14 moves it by 0.016. Three
   * things stack up to that: POTENTIAL_WEIGHT is only 0.38 of the grade, a
   * class's real spread in remaining headroom is about eight points either
   * way against a thirty-point spread in current ability, and
   * DEVELOPMENTAL_PULL then deliberately cancels most of what survives (-6
   * over a 20-point gap is -0.3 per point against base's +0.38). If someone
   * wants the board to care more about ceilings, the knob is
   * CONSENSUS.DEVELOPMENTAL_PULL or CONSENSUS.POTENTIAL_WEIGHT, not these.
   * They are here because the read has to be a coherent pair of numbers, not
   * because they are where the variance lives — that is EVAL_SD and the two
   * tails above.
   */
  CEILING_TRUST: 0.35,
  /** Spread of the projection error, in points. Larger than EVAL_SD because a ceiling is a forecast and a rating is an observation. See the note above on how little it moves. */
  CEILING_SD: 7,
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

function roomReadOf(p: ConsensusInput): RoomRead {
  const E = CONSENSUS_EVAL;

  // Which regime this prospect falls in. Its own stream, so widening the tail
  // in a later patch cannot reshuffle the ordinary reads already in a save.
  const roll = new Rng(`consensus-regime-${p.id}`).float(0, 1);
  const spread =
    roll < E.BLINDSPOT_ODDS ? E.BLINDSPOT_MULT
      : roll < E.BLINDSPOT_ODDS + E.MISFILE_ODDS ? E.MISFILE_MULT
        : 1;

  const now = clamp(p.trueOvr + new Rng(`consensus-read-${p.id}`).normal(0, E.EVAL_SD * spread), 20, 99);

  // The projection. Anchored on the standard allowance and pulled only
  // partway toward the headroom he actually has, then missed by CEILING_SD.
  const trueGap = p.potential - p.trueOvr;
  const seenGap =
    E.CEILING_ANCHOR +
    E.CEILING_TRUST * (trueGap - E.CEILING_ANCHOR) +
    new Rng(`consensus-project-${p.id}`).normal(0, E.CEILING_SD * spread);

  // A ceiling below what he already is would be incoherent — nobody in the
  // room says "he is a 78 and he tops out at 74".
  return { now, ceiling: clamp(now + Math.max(0, seenGap), now, 99) };
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

/**
 * One prospect's public grade. Pure, deterministic, and free — no database,
 * no team, no scouting report, no cost.
 */
export function consensusGradeFor(p: ConsensusInput): ConsensusGrade {
  const trueAttrs = readJson<AttrMap>(p.trueAttrs, {});
  const college = readJson<Partial<CollegeProfile>>(p.collegeStats, {});
  const testing = readJson<Partial<CombineTesting>>(p.combineTesting, {});

  // THE ONE PLACE THE TRUTH ENTERS. Everything below grades `room`, not `p`.
  const room = roomReadOf(p);
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
  // The room's own read, not the truth — a bias is a distortion of what an
  // evaluator believes. Reading trueOvr here meant the stopwatch markdown was
  // applied by a room that already knew exactly how good he was.
  const ability = clamp((room.now - 40) / 55, 0, 1);
  if (athleticism != null) {
    const d = CONSENSUS.TESTING_PULL * (athleticism - ability);
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

  const raw = clamp(base + delta + noise, 20, 99);

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
