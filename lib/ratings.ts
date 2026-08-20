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
  FB: { power: 0.28, runBlock: 0.30, strength: 0.18, catching: 0.12, carrying: 0.12 },
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

/** Human label for a rating band — used all over the UI. */
export function ratingTier(ovr: number): { label: string; className: string } {
  if (ovr >= 90) return { label: 'Elite', className: 'text-gold' };
  if (ovr >= 82) return { label: 'Pro Bowl', className: 'text-accent' };
  if (ovr >= 74) return { label: 'Starter', className: 'text-accent2' };
  if (ovr >= 66) return { label: 'Rotational', className: 'text-chalk' };
  if (ovr >= 58) return { label: 'Depth', className: 'text-muted' };
  return { label: 'Camp Body', className: 'text-bad' };
}

/**
 * A coarser, role-flavored label than ratingTier. For anyone unproven
 * (a draftee, or a rookie with 0 experience) the grade is drawn from
 * POTENTIAL rather than current overall — a rookie's present-day number
 * means almost nothing yet, the projected ceiling is the actual story —
 * and the whole thing reads from the same fogged scouted view as
 * everything else, so a label can flip as scouting narrows in on someone,
 * same as a real draft evaluation.
 */
export function playerLabel(opts: { ovr: number; potential: number; isDraftee?: boolean; experience?: number }): { label: string; className: string } {
  const { ovr, potential, isDraftee, experience } = opts;
  const unproven = isDraftee || (experience ?? 1) === 0;
  const grade = unproven ? potential : ovr;

  if (grade >= 97) return { label: 'Generational', className: 'text-gold' };
  if (grade >= 90) return { label: unproven ? 'Franchise Prospect' : 'Franchise', className: 'text-gold' };
  if (grade >= 82) return { label: unproven ? 'Star Prospect' : 'Star', className: 'text-accent' };
  if (grade >= 74) return { label: unproven ? 'Starter Prospect' : 'Starter', className: 'text-accent2' };
  if (grade >= 66) return { label: unproven ? 'Depth Prospect' : 'Rotational', className: 'text-chalk' };
  if (grade >= 58) return { label: unproven ? 'Late-Round Prospect' : 'Backup', className: 'text-muted' };
  return { label: unproven ? 'Deep Sleeper' : 'Camp Body', className: 'text-bad' };
}

export function ratingColor(v: number): string {
  if (v >= 88) return 'text-gold';
  if (v >= 78) return 'text-accent';
  if (v >= 68) return 'text-accent2';
  if (v >= 58) return 'text-chalk';
  return 'text-muted';
}

export const ALL_POSITIONS = POSITIONS;
