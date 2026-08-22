import { BoxScore, DriveResult } from './types';

/**
 * ===========================================================================
 * GAME SHAPE — the silhouette of a game, derived from data already stored
 * ===========================================================================
 * Display-only derivation, in the same spirit as lib/analytics.ts: nothing
 * here feeds the simulation, the AI, or any stored value. It reads
 * `BoxScore.drives[]` — a chronological list of every possession with the
 * points it produced, written for every played game since the engine was
 * first built (lib/sim/engine.ts:176) and never once read back — and turns
 * it into the score differential over time.
 *
 * Why this exists: a 31-30 last-possession thriller and a 45-3 walkover are
 * currently rendered by identical markup at identical weight, while the
 * recap sentence stored beside them correctly says "it came down to the last
 * possession". The drama was always in the database; it was being discarded
 * at the render boundary.
 *
 * Honest about what the sim actually did (principle 6): the engine allocates
 * a fixed 11 drives per team, strictly alternating, so the path is more
 * regular than a real game's. It is not pretending to be a win-probability
 * chart — it is the literal score differential, which is exactly what the
 * engine produced.
 * ===========================================================================
 */

/** Mirrors lib/sim/engine.ts's own `const QUARTERS = 4`. */
const QUARTERS = 4;
/**
 * Mirrors SIM.DRIVES_PER_TEAM. Imported as a literal rather than from
 * lib/tuning.ts so this module stays a pure function of the box score it is
 * handed — and because a box score simulated under an older value still has
 * to draw correctly. `quarterOfDrive` derives the boundary from the drive
 * count actually present, so this is only the regulation-length hint used to
 * spot overtime.
 */
const REGULATION_DRIVES_PER_TEAM = 11;

export type Archetype =
  | 'Comeback' | 'Collapse'
  | 'See-saw'
  | 'Never in doubt'
  | 'Wire to wire' | 'Never led'
  | 'One score'
  | 'Pulled away' | 'Slipped away'
  | 'Stalemate';

/** Semantic tone, so callers never have to map words to colours themselves. */
export type ShapeTone = 'good' | 'bad' | 'warn' | 'info' | 'muted';

export interface ShapePoint {
  /** Index into `drives`, or -1 for the pre-kickoff zero. */
  drive: number;
  /** Score differential from the perspective team's point of view. */
  diff: number;
  /** 0-3 for regulation, 4 for overtime. */
  quarter: number;
}

export interface GameShape {
  /** One point per drive, plus a leading 0-0 point. Perspective team's view. */
  points: ShapePoint[];
  archetype: Archetype;
  tone: ShapeTone;
  /** A short true clause explaining the archetype, e.g. "trailed by 14". */
  note: string;
  leadChanges: number;
  /** Biggest lead the perspective team held (0 if they never led). */
  largestLead: number;
  /** Biggest deficit the perspective team faced, as a positive number. */
  largestDeficit: number;
  /** Signed, from the perspective team's view. */
  finalMargin: number;
  /** Signed differential as the third quarter ended. */
  marginAfterQ3: number;
  /** Index into `points` of the deepest hole, or null if never behind. */
  deepestIndex: number | null;
  /** Index into `points` where the eventual winner took the lead for keeps. */
  goAheadIndex: number | null;
  /** 0-100 swing index. See `dramaIndex` for exactly what it measures. */
  drama: number;
  overtime: boolean;
  /** `points` indices at which each new quarter begins (for the faint rules). */
  quarterStarts: number[];
}

/**
 * [TUNE] Margin at or above which a game reads as over. Deliberately NOT the
 * recap engine's BLOWOUT_MARGIN of 21: across 11,723 played games in a real
 * save, 28% of every game in this sim finishes by 21 or more, so a marker at
 * 21 would fire on more than a quarter of the schedule and stop meaning
 * anything. 28 was chosen as "the top ~15%"; re-measured on one league's 176
 * regular-season games only 9.1% finish there, so it is nearer the top tenth
 * than the top seventh. That is still the decile this marker is supposed to
 * be for, and 28 stays — but nothing user-facing quotes a blowout frequency,
 * because 176 games is a thin sample to publish a rate from.
 */
export const BLOWOUT_MARGIN = 28;
/** [TUNE] One possession. 35% of games finish inside it. */
export const ONE_SCORE_MARGIN = 8;
/** [TUNE] A deficit this big, erased, is a comeback rather than a wobble. */
const COMEBACK_DEFICIT = 10;
/** [TUNE] Lead changes at or above this read as a see-saw. */
const SEESAW_LEAD_CHANGES = 4;
/** [TUNE] Lead at the end of Q3 that makes a blowout "never in doubt". */
const NEVER_IN_DOUBT_Q3_LEAD = 14;

const TONE: Record<Archetype, ShapeTone> = {
  'Comeback': 'warn',
  'Collapse': 'bad',
  'See-saw': 'info',
  'Never in doubt': 'muted',
  'Wire to wire': 'good',
  'Never led': 'muted',
  'One score': 'warn',
  'Pulled away': 'good',
  'Slipped away': 'bad',
  'Stalemate': 'muted',
};

/**
 * Which quarter a drive index sits in. The engine runs `drivesPerTeam`
 * rounds of (away drive, home drive) and stamps the quarter as
 * `floor(round / drivesPerTeam * 4)` — so the boundary is derivable exactly
 * rather than estimated. Anything past regulation is overtime, which the
 * engine appends as extra drives (engine.ts:194).
 */
function quarterOfDrive(index: number, regulationDrives: number): number {
  if (index >= regulationDrives) return QUARTERS;
  const round = Math.floor(index / 2);
  const roundsPerTeam = Math.max(1, regulationDrives / 2);
  return Math.min(QUARTERS - 1, Math.floor((round / roundsPerTeam) * QUARTERS));
}

/**
 * A 0-100 swing index in the spirit of ESPN's Game Excitement Index, which
 * sums the absolute change in win probability across a game. This sim has no
 * per-play win probability, so it sums the absolute change in *score
 * differential* instead, weighting each swing by two things that actually
 * make a swing matter: how late it came, and how close the game was when it
 * happened. A 7-point swing from 35-3 to 35-10 is not drama; the same swing
 * at 21-20 in the fourth is.
 *
 * Stated plainly on screen wherever it is shown, because an unexplained
 * index is indistinguishable from an invented one.
 */
function dramaIndex(points: ShapePoint[], finalMargin: number): number {
  if (points.length < 2) return 0;
  const n = points.length - 1;
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    const delta = Math.abs(points[i].diff - points[i - 1].diff);
    if (delta === 0) continue;
    const lateness = 0.6 + (i / n) * 0.8;               // 0.6 early → 1.4 at the gun
    const closest = Math.min(Math.abs(points[i].diff), Math.abs(points[i - 1].diff));
    const proximity = 1 / (1 + closest / 7);            // halves by ~a touchdown out
    sum += delta * lateness * proximity;
  }
  // A one-score finish is drama by definition, however it got there.
  const finishBonus = Math.max(0, (ONE_SCORE_MARGIN + 1 - Math.abs(finalMargin))) * 1.6;
  return Math.max(0, Math.min(100, Math.round((sum + finishBonus) * 1.55)));
}

/**
 * Builds the shape from the perspective of one side. Returns null for a box
 * score with no drives — every game the engine has ever played writes them,
 * but a `{}` box score from a hand-edited or interrupted row must not throw.
 */
export function computeGameShape(box: BoxScore | null | undefined, perspective: 'home' | 'away'): GameShape | null {
  const drives: DriveResult[] | undefined = box?.drives;
  if (!drives || drives.length === 0) return null;

  // Regulation length is taken from the box score itself where possible, so
  // a save simulated under a different DRIVES_PER_TEAM still splits into the
  // right quarters. Overtime drives are the tail beyond that.
  const regulationDrives = Math.min(drives.length, REGULATION_DRIVES_PER_TEAM * 2);
  const overtime = drives.length > regulationDrives;

  const points: ShapePoint[] = [{ drive: -1, diff: 0, quarter: 0 }];
  let diff = 0;
  let largestLead = 0;
  let largestDeficit = 0;
  let leadChanges = 0;
  let deepestIndex: number | null = null;
  let marginAfterQ3 = 0;

  for (let i = 0; i < drives.length; i++) {
    const d = drives[i];
    const before = diff;
    diff += (d.team === perspective ? d.points : -d.points);
    const quarter = quarterOfDrive(i, regulationDrives);
    points.push({ drive: i, diff, quarter });

    if (diff > largestLead) largestLead = diff;
    if (-diff > largestDeficit) { largestDeficit = -diff; deepestIndex = points.length - 1; }
    // A lead change is crossing zero, not touching it — going from behind to
    // tied and back to behind is not two lead changes.
    if (before !== 0 && diff !== 0 && Math.sign(before) !== Math.sign(diff)) leadChanges++;
    if (quarter <= 2) marginAfterQ3 = diff;
  }

  const finalMargin = diff;

  // Where the winner took the lead for the last time. Read backwards: the
  // first point (scanning back) whose sign disagrees with the final result is
  // the drive before the decisive one.
  let goAheadIndex: number | null = null;
  if (finalMargin !== 0) {
    const winningSign = Math.sign(finalMargin);
    for (let i = points.length - 1; i >= 1; i--) {
      if (Math.sign(points[i - 1].diff) !== winningSign) { goAheadIndex = i; break; }
    }
  }

  const won = finalMargin > 0;
  const tied = finalMargin === 0;
  const absMargin = Math.abs(finalMargin);

  let archetype: Archetype;
  let note: string;
  if (tied) {
    archetype = 'Stalemate';
    note = `${leadChanges} lead change${leadChanges === 1 ? '' : 's'}, nobody separated`;
  } else if (won && largestDeficit >= COMEBACK_DEFICIT) {
    archetype = 'Comeback';
    note = `trailed by ${largestDeficit}`;
  } else if (!won && largestLead >= COMEBACK_DEFICIT) {
    archetype = 'Collapse';
    note = `led by ${largestLead}`;
  } else if (leadChanges >= SEESAW_LEAD_CHANGES) {
    archetype = 'See-saw';
    note = `${leadChanges} lead changes`;
  } else if (absMargin >= BLOWOUT_MARGIN && Math.abs(marginAfterQ3) >= NEVER_IN_DOUBT_Q3_LEAD) {
    archetype = 'Never in doubt';
    note = `${Math.abs(marginAfterQ3)} clear after three quarters`;
  } else if (absMargin <= ONE_SCORE_MARGIN) {
    // Checked ahead of wire-to-wire on purpose: a one-point win in which the
    // winner happened to lead throughout is a one-score game first and a
    // wire-to-wire second, and the tighter fact is the more useful headline.
    archetype = 'One score';
    note = `${absMargin}-point game`;
  } else if (won && largestDeficit === 0) {
    archetype = 'Wire to wire';
    note = 'never trailed';
  } else if (!won && largestLead === 0) {
    archetype = 'Never led';
    note = 'never in front';
  } else {
    archetype = won ? 'Pulled away' : 'Slipped away';
    note = `${absMargin}-point margin`;
  }

  const quarterStarts: number[] = [];
  let seen = -1;
  for (let i = 1; i < points.length; i++) {
    if (points[i].quarter !== seen) { quarterStarts.push(i); seen = points[i].quarter; }
  }

  return {
    points,
    archetype,
    tone: TONE[archetype],
    note,
    leadChanges,
    largestLead,
    largestDeficit,
    finalMargin,
    marginAfterQ3,
    deepestIndex,
    goAheadIndex,
    drama: dramaIndex(points, finalMargin),
    overtime,
    quarterStarts,
  };
}

/**
 * Did this game go to overtime? The engine appends extra drives past
 * regulation when it has to break a tie (engine.ts:194), so the drive count
 * is the record of it — there is no stored OT flag.
 */
export function wentToOvertime(box: BoxScore | null | undefined): boolean {
  const n = box?.drives?.length ?? 0;
  return n > REGULATION_DRIVES_PER_TEAM * 2;
}

/**
 * How heavily a result should read, from its margin alone. Used everywhere a
 * score is listed so a one-point loss stops looking like a 40-point one.
 * Adds a channel; removes nothing.
 */
export type ResultWeight = 'tight' | 'normal' | 'decisive';

export function resultWeight(margin: number): ResultWeight {
  const m = Math.abs(margin);
  if (m <= ONE_SCORE_MARGIN) return 'tight';
  if (m >= BLOWOUT_MARGIN) return 'decisive';
  return 'normal';
}

/** "by 1" / "by 28" / "tied". Never a sentence. */
export function marginPhrase(margin: number): string {
  const m = Math.abs(margin);
  if (m === 0) return 'tied';
  return `by ${m}`;
}
