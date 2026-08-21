import { Rng, clamp } from './rng';
import { readJson } from './json';
import type { AttrMap } from './ratings';
import { AI } from './tuning';
import type { Position } from './tuning';
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
 * That only works if the room is wrong in ways that can be learned. Pure
 * noise around the truth would make finding a steal luck; a systematic,
 * publicly-signalled error makes it skill. So the consensus is built as
 *
 *     grade = a blend of what he is and what he could be
 *           + a small amount of noise
 *           + a set of NAMED BIASES, each driven by something public
 *
 * and the biases dominate the noise. Every bias is exported as machine-
 * readable data (id, direction, delta, and the public signal that caused it),
 * so a UI can say "the board is high on him because he tested well" and a
 * scouting report can disagree with a reason instead of a shrug.
 *
 * WHAT THIS FILE MAY NOT DO. It reads true ratings, because an opinion has
 * to be an opinion ABOUT something — but it never returns them and never
 * narrows anybody's scouted range. buildScoutedView (lib/scouting.ts) remains
 * the only thing that decides what the user may see about a player, potential
 * always comes back from there as a range, and nothing here writes a
 * ScoutingReport. The consensus is talk. It is allowed to be badly wrong, and
 * on the prospects that matter most it usually is.
 *
 * DETERMINISM. Seeded off the player id alone (never Math.random), so the
 * same prospect grades identically on every render, in every process, for the
 * whole life of the save. Each random draw gets its OWN seeded stream rather
 * than sharing one — adding a fifth bias later must not reshuffle the four
 * that already exist in players' saves.
 * ===========================================================================
 */

// ---------------------------------------------------------------------------
// TUNING [TUNE]
// ---------------------------------------------------------------------------

export const CONSENSUS = {
  /**
   * How the room blends "what he is" against "what he might become". Draft
   * boards are forward-looking, but not entirely — a polished 78 goes ahead
   * of a raw 64 with the same ceiling, every year.
   */
  CURRENT_WEIGHT: 0.62,
  POTENTIAL_WEIGHT: 0.38,

  /**
   * Random disagreement between evaluators, on the grade scale. Kept SMALL
   * relative to the bias pulls below — the whole design rests on the board's
   * error being learnable rather than random. If this ever grows past the
   * bias magnitudes, finding a steal becomes a coin flip.
   */
  NOISE_SD: 2.4,

  /** Max swing from the room over-indexing on the stopwatch. */
  TESTING_PULL: 9,
  /**
   * Grade adjustment by strength of competition faced. Only the two extremes
   * move the grade enough to be worth naming: a genuine blue blood and a
   * genuine small school. B and D are where most of a class plays and the room
   * has no strong feeling about either.
   */
  PROGRAM_PULL: { A: 4, B: 1.2, C: 0, D: -1.2, F: -4 } as Record<CompetitionGrade, number>,
  /** Max markdown applied to a raw, high-ceiling developmental player. */
  DEVELOPMENTAL_PULL: 6,
  /**
   * Ceiling-minus-current gap at which the room starts calling a player "a
   * project". Set above the class median gap on purpose — nearly every
   * prospect has SOME room to grow, and a tag that lands on half the board
   * tells the user nothing.
   */
  DEVELOPMENTAL_GAP_MIN: 16,
  /** Flat markdown the room applies to anyone carrying a medical flag. */
  MEDICAL_PULL: 6.5,
  /**
   * Odds a prospect picks up a public medical flag at all. Correlated with
   * true durability but floored well above zero: the exploitable case is the
   * flagged player whose shoulder is genuinely fine, and that case has to
   * exist often enough to be worth scouting for.
   */
  MEDICAL_BASE_ODDS: 0.06,
  MEDICAL_MIN_ODDS: 0.03,
  MEDICAL_MAX_ODDS: 0.3,

  /** A bias is only NAMED to the user once its pull clears this. Below it, it is rounding. */
  BIAS_REPORT_THRESHOLD: 2,

  /**
   * How far positional value moves a prospect's BOARD SLOT, in board-score
   * points, at AI.DRAFT_POSITION_VALUE's extremes. This does not touch the
   * grade — a guard and a quarterback who grade out the same are the same
   * football player, they just do not come off the board at the same pick.
   * It is the room's fifth bias and the most exploitable one: nothing stops a
   * GM taking the guard.
   */
  POSITION_PULL: 8,

  /**
   * Band cutoffs as PICK NUMBERS, so they mean what they say — a
   * "first-round grade" is a player the room expects inside the first round.
   * Scaled to the actual draft (teams x rounds) rather than hard-coded, so a
   * league running 4 rounds does not label a hundred players Day 3.
   */
  BANDS: [
    { id: 'BLUE_CHIP', label: 'Blue chip', blurb: 'Top of the board. The room does not expect him to get past the first handful of picks.' },
    { id: 'FIRST_ROUND', label: 'First-round grade', blurb: 'A consensus first rounder.' },
    { id: 'DAY_TWO', label: 'Day 2 grade', blurb: 'Second or third round on most boards.' },
    { id: 'DAY_THREE', label: 'Day 3 grade', blurb: 'A rotational bet in the middle rounds.' },
    { id: 'LATE_FLIER', label: 'Late flier', blurb: 'Last-day name. Special teams and a roster spot to win.' },
    { id: 'PRIORITY_FA', label: 'Priority free agent', blurb: 'Expected to go undrafted. Somebody signs him after the phones stop.' },
  ] as const,
};

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
 * Positional 40 baselines. DUPLICATED from generateCombineTesting's BASE_40 in
 * lib/gen/prospectProfile.ts, which keeps its table private. The inversion
 * below is exact against that generator, so if these two ever drift the board
 * starts misreading testing — see docs/scouting-pivot.md for the one-line
 * handoff that exports the table and deletes this copy.
 */
const BASE_40: Partial<Record<Position, number>> = {
  WR: 4.48, CB: 4.47, RB: 4.52, S: 4.55, TE: 4.68, LB: 4.72, QB: 4.75, EDGE: 4.68,
  FB: 4.85, DT: 5.05, RT: 5.25, LT: 5.25, RG: 5.3, LG: 5.3, C: 5.28, K: 4.95, P: 4.95,
};

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

  const base =
    CONSENSUS.CURRENT_WEIGHT * p.trueOvr +
    CONSENSUS.POTENTIAL_WEIGHT * p.potential;

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
  const ability = clamp((p.trueOvr - 40) / 55, 0, 1);
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
  const gap = p.potential - p.trueOvr;
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
  const graded = prospects.map(consensusGradeFor);
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
