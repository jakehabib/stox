import { Position, POSITIONS } from './tuning';

/**
 * Attribute catalogue. One flat namespace across all positions — a position
 * simply ignores the attributes it doesn't weight. Keeps generation, scouting,
 * progression and the sim engine all reading from one shape.
 */
export interface AttributeDef {
  key: string;
  label: string;
  /** Physical attributes are easier to scout than mental ones (section 6). */
  scoutDifficulty: number; // 0 = combine-measurable, 1 = pure film/interview
}

export const ATTRIBUTES: AttributeDef[] = [
  // Physical — a stopwatch measures these, so scouting error is small.
  { key: 'speed',        label: 'Speed',           scoutDifficulty: 0.1 },
  { key: 'acceleration', label: 'Acceleration',    scoutDifficulty: 0.15 },
  { key: 'agility',      label: 'Agility',         scoutDifficulty: 0.2 },
  { key: 'strength',     label: 'Strength',        scoutDifficulty: 0.15 },
  { key: 'durability',   label: 'Durability',      scoutDifficulty: 0.7 },
  { key: 'stamina',      label: 'Stamina',         scoutDifficulty: 0.4 },
  // Mental — the fog-of-war lives here.
  { key: 'awareness',    label: 'Awareness',       scoutDifficulty: 0.9 },
  { key: 'workEthic',    label: 'Work Ethic',      scoutDifficulty: 0.95 },
  { key: 'football_iq',  label: 'Football IQ',     scoutDifficulty: 0.85 },
  // QB
  { key: 'armStrength',  label: 'Arm Strength',    scoutDifficulty: 0.1 },
  { key: 'accuracy',     label: 'Short Accuracy',  scoutDifficulty: 0.35 },
  { key: 'deepAccuracy', label: 'Deep Accuracy',   scoutDifficulty: 0.4 },
  { key: 'pocket',       label: 'Pocket Presence', scoutDifficulty: 0.8 },
  { key: 'decision',     label: 'Decision Making', scoutDifficulty: 0.85 },
  // Ball carriers / receivers
  { key: 'carrying',     label: 'Ball Security',   scoutDifficulty: 0.5 },
  { key: 'elusiveness',  label: 'Elusiveness',     scoutDifficulty: 0.35 },
  { key: 'power',        label: 'Contact Balance', scoutDifficulty: 0.35 },
  { key: 'vision',       label: 'Vision',          scoutDifficulty: 0.75 },
  { key: 'catching',     label: 'Hands',           scoutDifficulty: 0.4 },
  { key: 'route',        label: 'Route Running',   scoutDifficulty: 0.6 },
  { key: 'release',      label: 'Release',         scoutDifficulty: 0.55 },
  { key: 'contested',    label: 'Contested Catch', scoutDifficulty: 0.45 },
  // Blocking
  { key: 'runBlock',     label: 'Run Blocking',    scoutDifficulty: 0.45 },
  { key: 'passBlock',    label: 'Pass Blocking',   scoutDifficulty: 0.5 },
  { key: 'footwork',     label: 'Footwork',        scoutDifficulty: 0.5 },
  // Front seven
  { key: 'passRush',     label: 'Pass Rush',       scoutDifficulty: 0.4 },
  { key: 'runStop',      label: 'Run Defense',     scoutDifficulty: 0.45 },
  { key: 'blockShed',    label: 'Block Shedding',  scoutDifficulty: 0.5 },
  { key: 'pursuit',      label: 'Pursuit',         scoutDifficulty: 0.4 },
  { key: 'tackling',     label: 'Tackling',        scoutDifficulty: 0.4 },
  // Secondary
  { key: 'coverage',     label: 'Man Coverage',    scoutDifficulty: 0.6 },
  { key: 'zone',         label: 'Zone Coverage',   scoutDifficulty: 0.7 },
  { key: 'press',        label: 'Press',           scoutDifficulty: 0.5 },
  { key: 'ballHawk',     label: 'Ball Skills',     scoutDifficulty: 0.65 },
  // Specialists
  { key: 'kickPower',    label: 'Kick Power',      scoutDifficulty: 0.1 },
  { key: 'kickAccuracy', label: 'Kick Accuracy',   scoutDifficulty: 0.3 },
];

export const ATTRIBUTE_BY_KEY: Record<string, AttributeDef> = Object.fromEntries(
  ATTRIBUTES.map((a) => [a.key, a]),
);

export type AttrMap = Record<string, number>;

/**
 * [FRAGILE — PLACEHOLDER] Position overall formulas. Weights within a position
 * are normalized at read time, so they don't have to sum to 1 here.
 * These are eyeballed to feel right, not fit to data.
 */
export const POSITION_WEIGHTS: Record<Position, AttrMap> = {
  QB: { armStrength: 0.14, accuracy: 0.20, deepAccuracy: 0.11, pocket: 0.12, decision: 0.18, awareness: 0.12, football_iq: 0.08, speed: 0.05 },
  RB: { speed: 0.18, acceleration: 0.14, elusiveness: 0.16, power: 0.14, vision: 0.16, carrying: 0.10, catching: 0.07, passBlock: 0.05 },
  WR: { speed: 0.18, route: 0.20, catching: 0.20, release: 0.12, contested: 0.13, acceleration: 0.10, agility: 0.07 },
  TE: { catching: 0.22, route: 0.17, runBlock: 0.16, passBlock: 0.10, strength: 0.11, speed: 0.12, contested: 0.12 },
  LT: { passBlock: 0.42, runBlock: 0.22, footwork: 0.18, strength: 0.12, awareness: 0.06 },
  LG: { runBlock: 0.34, passBlock: 0.30, strength: 0.22, footwork: 0.08, awareness: 0.06 },
  C:  { runBlock: 0.26, passBlock: 0.26, awareness: 0.20, football_iq: 0.14, strength: 0.14 },
  RG: { runBlock: 0.34, passBlock: 0.30, strength: 0.22, footwork: 0.08, awareness: 0.06 },
  RT: { passBlock: 0.36, runBlock: 0.26, strength: 0.16, footwork: 0.16, awareness: 0.06 },
  EDGE: { passRush: 0.36, blockShed: 0.16, speed: 0.14, strength: 0.12, runStop: 0.12, pursuit: 0.10 },
  DT: { runStop: 0.28, blockShed: 0.22, strength: 0.24, passRush: 0.18, pursuit: 0.08 },
  LB: { tackling: 0.20, pursuit: 0.16, coverage: 0.16, blockShed: 0.12, awareness: 0.14, speed: 0.12, football_iq: 0.10 },
  CB: { coverage: 0.26, speed: 0.20, press: 0.14, ballHawk: 0.14, zone: 0.14, agility: 0.08, tackling: 0.04 },
  S:  { zone: 0.22, coverage: 0.18, tackling: 0.16, awareness: 0.16, ballHawk: 0.14, speed: 0.14 },
  K:  { kickPower: 0.45, kickAccuracy: 0.55 },
  P:  { kickPower: 0.55, kickAccuracy: 0.45 },
};

/** Attributes actually shown / generated for a position. */
export function attrsForPosition(pos: Position): string[] {
  const core = Object.keys(POSITION_WEIGHTS[pos]);
  // Everyone carries the universal physical/mental block so trades and
  // position changes don't hit undefined values.
  const universal = ['speed', 'strength', 'agility', 'awareness', 'durability', 'stamina', 'workEthic'];
  return Array.from(new Set([...core, ...universal]));
}

/** Weighted overall from a true (or scouted) attribute map. */
export function computeOverall(pos: Position, attrs: AttrMap): number {
  const weights = POSITION_WEIGHTS[pos];
  let sum = 0;
  let wTotal = 0;
  for (const [key, w] of Object.entries(weights)) {
    const v = attrs[key];
    if (v == null) continue;
    sum += v * w;
    wTotal += w;
  }
  if (wTotal === 0) return 50;
  return Math.round(sum / wTotal);
}

/**
 * ===========================================================================
 * THE RATING LADDER — ONE SET OF BOUNDARIES FOR THE LABEL AND THE COLOUR
 * ===========================================================================
 * Boundaries chosen from the recalibrated distribution rather than from round
 * numbers; the rarity ladder they came from is in docs/rating-distribution.md.
 * Per team, on a 32-team league: 99 is 0.12, 95+ is 0.59 (fewer than one per
 * club, which is what makes it a real distinction), 90+ is 1.96, 85+ is 5.0.
 *
 * NO TIER IS NAMED AFTER AN HONOUR. This used to print "Pro Bowl" for anyone
 * rated 82-89 — asserting an achievement the player had not earned, which is
 * a lying metric under README section 6. A Pro Bowl / All-Star selection is
 * something a player is CHOSEN for out of his actual season statistics, and
 * it lives on CareerHonors, not on a rating band. These labels describe a
 * level of quality and nothing else.
 *
 * `mark` is the redundant non-colour channel README section 4 requires. The
 * top of this ramp cannot be separated by hue: measured with the dataviz
 * skill's validator, there is no sixth ink that a deuteranope can tell apart
 * from gold/green/blue/chalk/muted (fuchsia against our accent2 blue comes
 * out at OKLab dE 0.3 — the same colour). So the two reserved steps are
 * reserved by SHAPE: a mark, and for a 99 a filled plate.
 */
export const RATING_BANDS = { GENERATIONAL: 99, SUPERSTAR: 95, ELITE: 90, STAR: 85, QUALITY: 78, STARTER: 70, ROTATIONAL: 62 } as const;

export function ratingTier(ovr: number): { label: string; className: string; mark: string } {
  if (ovr >= RATING_BANDS.GENERATIONAL) return { label: 'Generational', className: 'text-gold', mark: '\u25c6' };
  if (ovr >= RATING_BANDS.SUPERSTAR)    return { label: 'Superstar', className: 'text-gold', mark: '\u2605' };
  if (ovr >= RATING_BANDS.ELITE)        return { label: 'Elite', className: 'text-gold', mark: '' };
  if (ovr >= RATING_BANDS.STAR)         return { label: 'Star', className: 'text-accent', mark: '' };
  if (ovr >= RATING_BANDS.QUALITY)      return { label: 'Quality Starter', className: 'text-accent2', mark: '' };
  if (ovr >= RATING_BANDS.STARTER)      return { label: 'Starter', className: 'text-chalk', mark: '' };
  if (ovr >= RATING_BANDS.ROTATIONAL)   return { label: 'Rotational', className: 'text-muted', mark: '' };
  return { label: 'Depth', className: 'text-muted', mark: '' };
}

/**
 * The mark that rides beside the number so the top two steps are legible
 * without colour vision. Empty for everyone else — a glyph on every row would
 * be noise (README section 5).
 */
export function ratingMark(ovr: number): string {
  return ratingTier(ovr).mark;
}

/**
 * A 99 is drawn as a filled gold PLATE (dark ink on gold) rather than gold
 * text. A solid chip is a different object from coloured text, so it reads at
 * a glance, and it survives colourblindness, greyscale and forced-colors mode
 * without spending a hue the ramp does not have. Contrast of ink on gold is
 * 10.32:1. At roughly 3.8 per league it will never become wallpaper.
 *
 * Deliberately NOT accompanied by a trophy: gold + a trophy already means
 * "won something" everywhere else in this app, and this is a rating.
 */
export function ratingPlateClass(ovr: number): string | null {
  return ovr >= RATING_BANDS.GENERATIONAL ? 'bg-gold text-ink px-1.5 rounded-sm font-bold' : null;
}

/**
 * Confidence bands the tag itself is gated on — deliberately the SAME
 * HIGH/MEDIUM/LOW split ScoutingRange already renders next to it (see
 * lib/scouting.ts confidenceLabel), so a "Franchise Prospect" tag and a
 * "Confidence: HIGH" readout never disagree about how sure the read is.
 */
const LABEL_CONFIDENCE_HIGH = 75;
const LABEL_CONFIDENCE_MEDIUM = 40;

function gradeTag(grade: number, unproven: boolean): { label: string; className: string } {
  // Same boundaries as ratingTier, so a tag and a colour can never disagree.
  if (grade >= RATING_BANDS.GENERATIONAL) return { label: 'Generational', className: 'text-gold' };
  if (grade >= RATING_BANDS.SUPERSTAR) return { label: unproven ? 'Franchise Prospect' : 'Superstar', className: 'text-gold' };
  if (grade >= RATING_BANDS.ELITE) return { label: unproven ? 'Blue-Chip Prospect' : 'Elite', className: 'text-gold' };
  if (grade >= RATING_BANDS.STAR) return { label: unproven ? 'Star Prospect' : 'Star', className: 'text-accent' };
  if (grade >= RATING_BANDS.QUALITY) return { label: unproven ? 'Day-One Starter' : 'Quality Starter', className: 'text-accent2' };
  if (grade >= RATING_BANDS.STARTER) return { label: unproven ? 'Rotational Prospect' : 'Starter', className: 'text-chalk' };
  if (grade >= RATING_BANDS.ROTATIONAL) return { label: unproven ? 'Late-Round Prospect' : 'Rotational', className: 'text-muted' };
  return { label: unproven ? 'Deep Sleeper' : 'Depth', className: 'text-muted' };
}

/**
 * A coarser, role-flavored label than ratingTier. For anyone unproven
 * (a draftee, or a rookie with 0 experience) the grade is drawn from
 * POTENTIAL rather than current overall — a rookie's present-day number
 * means almost nothing yet, the projected ceiling is the actual story —
 * and the whole thing reads from the same fogged scouted view as
 * everything else, so a label can flip as scouting narrows in on someone,
 * same as a real draft evaluation.
 *
 * `confidence` gates the reveal — this is potential/ovr distilled into the
 * single most legible signal in the game, so handing it out for free on an
 * unscouted prospect would make the entire scouting system pointless. Below
 * MEDIUM there simply isn't a book on the player yet, so the tag is hidden
 * behind an explicit "Unevaluated" rather than showing a grade nobody has
 * actually earned. Between MEDIUM and HIGH the read exists but hasn't
 * converged, so it's shown hedged (a trailing "?", muted) rather than with
 * the same certainty as a fully-scouted grade. A revealed view (own roster
 * unfogged, or revealTrueRatings) already reports confidence: 100 from
 * buildScoutedView, so it clears HIGH automatically — no separate "revealed"
 * flag needed here.
 */
export function playerLabel(opts: { ovr: number; potential: number; isDraftee?: boolean; experience?: number; confidence: number }): { label: string; className: string } {
  const { ovr, potential, isDraftee, experience, confidence } = opts;
  const unproven = isDraftee || (experience ?? 1) === 0;
  const grade = unproven ? potential : ovr;
  const tag = gradeTag(grade, unproven);

  if (confidence < LABEL_CONFIDENCE_MEDIUM) return { label: 'Unevaluated', className: 'text-muted' };
  if (confidence < LABEL_CONFIDENCE_HIGH) return { label: `${tag.label}?`, className: `${tag.className} italic` };
  return tag;
}

/**
 * Colour for a rating. Shares RATING_BANDS with ratingTier, which is the fix
 * for a live inconsistency: an 88 used to render gold while being labelled
 * something other than the gold tier.
 *
 * The ramp starts at 70 rather than the old 58, which moves it TOWARD README
 * section 3 ("meaningful above ~80 ... below that, stay neutral"). Validated
 * with the dataviz skill's validate_palette.js against the card surface:
 * worst adjacent pair accent-green vs gold at OKLab dE 8.7 under deuteranopia
 * (target 8.0) and 18.7 with normal vision. The two steps above gold are
 * separated by ratingMark/ratingPlateClass, not by hue — see ratingTier.
 */
export function ratingColor(v: number): string {
  if (v >= RATING_BANDS.ELITE) return 'text-gold';
  if (v >= RATING_BANDS.STAR) return 'text-accent';
  if (v >= RATING_BANDS.QUALITY) return 'text-accent2';
  if (v >= RATING_BANDS.STARTER) return 'text-chalk';
  return 'text-muted';
}

export const ALL_POSITIONS = POSITIONS;
