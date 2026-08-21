import { POSITIONS, Position } from './tuning';
import { POSITION_GROUPS, PositionGroup, positionGroup } from './positionGroups';

/**
 * ===========================================================================
 * THE STARTING LINEUP — ONE DEFINITION, KEYED BY POSITION
 * ===========================================================================
 * Who is on the field. Everything in the app that says the word "starter"
 * must read it from here.
 *
 * It is written down in one file because it used to be written down in three,
 * and one of the three was wrong. `lib/teamRating.ts` and `lib/rosterShape.ts`
 * each carried an identical private table keyed by position GROUP —
 * `DL 4, LB 3, DB 5` — which is twelve men on defence. A defence fields
 * eleven. Two copies of a table is exactly how a wrong number survives: there
 * was no single place where somebody would ever add the column up. Meanwhile
 * the depth chart used a third rule entirely (the top player at each of the
 * seventeen positions), so its "Starter OVR" averaged seventeen players and
 * its "Injured Starters" counted across seventeen slots. Three definitions,
 * none of them eleven.
 *
 * Keyed by POSITION, not group, because the depth chart has to say *three*
 * receivers start and *one* tight end does, and a group table cannot tell it
 * that. Group counts are DERIVED below rather than typed out a second time.
 *
 * ---------------------------------------------------------------------------
 * OFFENSE — 11 PERSONNEL (1 RB, 1 TE, 3 WR)
 * ---------------------------------------------------------------------------
 * The base offense of the modern game and the app owner's explicit call. The
 * fullback is not in it — he is not in the game at all any more, for the same
 * reason: a roster spot is better spent on a fourth receiver.
 *
 * ---------------------------------------------------------------------------
 * DEFENSE — NICKEL (2 EDGE, 2 DT, 2 LB, 3 CB, 2 S)
 * ---------------------------------------------------------------------------
 * Nickel rather than a 4-3 base, deliberately, for three reasons that agree:
 *
 *   1. It is the honest answer to our own offense. If eleven personnel is the
 *      base — three receivers on the field — then the defence that answers it
 *      has a fifth defensive back, not a third linebacker. Defining the
 *      offense as 3 WR and the defence as 2 CB would be the two halves of
 *      this file disagreeing with each other.
 *   2. It is the de facto base of the real sport: nickel is roughly 60-70% of
 *      defensive snaps, well clear of any other personnel grouping.
 *   3. THE CODEBASE ALREADY ASSUMED IT. `UNIT_WEIGHT` in lib/teamRating.ts
 *      weights DB at 0.17 against LB at 0.09 — nearly two to one. That ratio
 *      is only defensible if there are five defensive backs on the field and
 *      two linebackers. The weights were nickel weights sitting on top of a
 *      base-defence starter table, which is part of why the sum came out at
 *      twelve. `ROSTER_TARGETS` says the same thing: 5 CB + 4 S ideal is a
 *      roster built to play with five defensive backs.
 *
 * It is also the smaller correction of the two available. Against the old
 * (broken) group table, nickel leaves DL at 4 and DB at 5 exactly as they
 * were and moves LB from 3 to 2 — the twelfth man comes off, and nothing else
 * about the defence is relitigated.
 * ===========================================================================
 */

/**
 * How many players at each position are on the field. THE definition.
 *
 * Sums are asserted at module load — see the check below. A wrong constant
 * here is invisible until somebody adds a column up by hand, which is how the
 * twelve-man defence shipped in the first place.
 */
export const STARTERS_AT_POSITION: Record<Position, number> = {
  // Offense — 11 personnel
  QB: 1,
  RB: 1,
  WR: 3,
  TE: 1,
  LT: 1, LG: 1, C: 1, RG: 1, RT: 1,
  // Defense — nickel
  EDGE: 2, DT: 2,
  LB: 2,
  CB: 3, S: 2,
  // Specialists — on the field, but not part of either eleven
  K: 1, P: 1,
};

/** The side of the ball a position plays on. */
export type LineupUnit = 'OFFENSE' | 'DEFENSE' | 'SPECIAL';

const UNIT_BY_POSITION: Record<Position, LineupUnit> = {
  QB: 'OFFENSE', RB: 'OFFENSE', WR: 'OFFENSE', TE: 'OFFENSE',
  LT: 'OFFENSE', LG: 'OFFENSE', C: 'OFFENSE', RG: 'OFFENSE', RT: 'OFFENSE',
  EDGE: 'DEFENSE', DT: 'DEFENSE', LB: 'DEFENSE', CB: 'DEFENSE', S: 'DEFENSE',
  K: 'SPECIAL', P: 'SPECIAL',
};

/**
 * Positions in each unit, in the order a lineup card lists them — skill then
 * line on offense, front then back on defense. Used by the depth chart so the
 * eleven read top-to-bottom the way a coach would say them.
 */
export const OFFENSE_POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT'];
export const DEFENSE_POSITIONS: Position[] = ['EDGE', 'DT', 'LB', 'CB', 'S'];
export const SPECIAL_POSITIONS: Position[] = ['K', 'P'];

export function lineupUnit(position: string): LineupUnit {
  return UNIT_BY_POSITION[position as Position] ?? 'OFFENSE';
}

/**
 * How many start at a position. Takes a plain string and returns 0 for
 * anything it does not recognise, deliberately: positions arrive here from
 * the database, and a save written before a position was retired (the
 * fullback) must read as "starts nobody" rather than crash or, worse, index
 * to `undefined` and quietly produce NaN in an average.
 */
export function startersAt(position: string): number {
  return STARTERS_AT_POSITION[position as Position] ?? 0;
}

function sumOver(positions: Position[]): number {
  return positions.reduce((n, p) => n + STARTERS_AT_POSITION[p], 0);
}

export const OFFENSE_STARTERS = sumOver(OFFENSE_POSITIONS);
export const DEFENSE_STARTERS = sumOver(DEFENSE_POSITIONS);
export const SPECIAL_STARTERS = sumOver(SPECIAL_POSITIONS);

/**
 * The arithmetic, checked by the machine rather than by eye.
 *
 * This runs at import, so a future edit that makes either side of the ball
 * add up to something other than eleven fails loudly at the first page render
 * instead of shipping a lineup nobody counted. This is the guard the original
 * duplicated tables did not have.
 */
if (OFFENSE_STARTERS !== 11 || DEFENSE_STARTERS !== 11) {
  throw new Error(
    `lib/lineup.ts: a side of the ball does not field eleven players — ` +
    `offense ${OFFENSE_STARTERS}, defense ${DEFENSE_STARTERS}. ` +
    `Fix STARTERS_AT_POSITION.`,
  );
}

/** Every position must be assigned to exactly one unit, or the sums above lie. */
if (OFFENSE_POSITIONS.length + DEFENSE_POSITIONS.length + SPECIAL_POSITIONS.length !== POSITIONS.length) {
  throw new Error(
    `lib/lineup.ts: ${POSITIONS.length} positions exist but ` +
    `${OFFENSE_POSITIONS.length + DEFENSE_POSITIONS.length + SPECIAL_POSITIONS.length} are assigned to a unit.`,
  );
}

/**
 * Starter counts per position GROUP, DERIVED from the table above rather than
 * typed out again. `lib/teamRating.ts` and `lib/rosterShape.ts` import this;
 * deriving it is the whole point, because two hand-maintained tables are what
 * drifted. (For a long time this comment claimed they already did, while both
 * still carried `LB: 3` — twelve men on defence. A comment asserting a cleanup
 * that never landed is as wrong as a number that lies, and it hid this for
 * months. If you are reading this because you are about to copy the table
 * again: don't.)
 *
 * Comes out as QB 1, RB 1, WR 3, TE 1, OL 5 (offense = 11) and
 * DL 4, LB 2, DB 5 (defense = 11), with ST 2.
 */
export const STARTERS_AT_GROUP: Record<PositionGroup, number> = (() => {
  const out = Object.fromEntries(POSITION_GROUPS.map((g) => [g, 0])) as Record<PositionGroup, number>;
  for (const pos of POSITIONS) out[positionGroup(pos)] += STARTERS_AT_POSITION[pos];
  return out;
})();

/** The positions that feed a group, in lineup order. */
export function positionsInGroup(group: PositionGroup): Position[] {
  return POSITIONS.filter((p) => positionGroup(p) === group);
}

/**
 * The ratings occupying the starting slots at a group, one entry per slot.
 *
 * This is the sample every "how good is this unit" number in the app is
 * supposed to average, and it is per-POSITION on purpose. Taking the best
 * five of ten offensive linemen — which is what the old group-level version
 * did — rates a team with five good guards and no left tackle as though it
 * had a line, and it means the eleven the depth chart names and the eleven
 * the rating averages are two different sets of players. That is the same
 * class of bug as the twelve-man defence: the app disagreeing with itself
 * about who starts.
 *
 * `replacement` decides what an unfilled slot is worth. Team ratings pass a
 * replacement level, because a team two linemen short really is worse than
 * one with exactly five and averaging only who is present hides that. Roster
 * shape passes nothing, because it reports what a group actually is and a
 * group with nobody in it should read as absent, not as bad.
 */
export function starterSlots(
  ovrsByPosition: (position: Position) => number[],
  group: PositionGroup,
  replacement?: number,
): number[] {
  const slots: number[] = [];
  for (const pos of positionsInGroup(group)) {
    const n = STARTERS_AT_POSITION[pos];
    if (n === 0) continue;
    const top = [...ovrsByPosition(pos)].sort((a, b) => b - a).slice(0, n);
    if (replacement !== undefined) while (top.length < n) top.push(replacement);
    slots.push(...top);
  }
  return slots;
}

/**
 * Mean rating of the starters at a group. Returns 0 for a group with nobody
 * in it and no replacement level supplied — callers treat that as "unmanned"
 * rather than as a rating of zero.
 */
export function starterAverageAtGroup(
  ovrsByPosition: (position: Position) => number[],
  group: PositionGroup,
  replacement?: number,
): number {
  const slots = starterSlots(ovrsByPosition, group, replacement);
  if (slots.length === 0) return 0;
  return slots.reduce((s, v) => s + v, 0) / slots.length;
}

/**
 * Splits an ordered depth chart into the men who start and the men behind
 * them. The depth chart's own convention — order within a position is the
 * order they play — is preserved exactly; this only says where the line falls.
 */
export function splitStarters<T>(position: string, ordered: T[]): { starters: T[]; backups: T[] } {
  const n = startersAt(position);
  return { starters: ordered.slice(0, n), backups: ordered.slice(n) };
}
