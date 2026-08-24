import { POSITIONS, Position, UNIT_DEPTH_WEIGHTS } from './tuning';
import { POSITION_GROUPS, PositionGroup, positionGroup } from './positionGroups';
import { isAvailable, mergeUnnamed, effectiveRating, SimPlayer } from './sim/units';

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
export function slotsInOrder(
  orderedOvrsByPosition: (position: Position) => number[],
  group: PositionGroup,
  replacement?: number,
): number[] {
  const slots: number[] = [];
  for (const pos of positionsInGroup(group)) {
    const n = STARTERS_AT_POSITION[pos];
    if (n === 0) continue;
    const top = orderedOvrsByPosition(pos).slice(0, n);
    if (replacement !== undefined) while (top.length < n) top.push(replacement);
    slots.push(...top);
  }
  return slots;
}

/**
 * The same slots, filled BEST-FIRST — "what could this roster field", not
 * "what does this club field". Two callers still want exactly that and are
 * right to: `lib/rosterShape.ts` describes a group's talent rather than a
 * lineup, and `teamOverallFrom` is called by lib/gen/league.ts at generation
 * time, where the players do not exist in the database yet and no depth chart
 * has ever been written. It is the SAME slice and the SAME padding as
 * `slotsInOrder` — a sort in front of it, not a second rule behind it.
 */
export function starterSlots(
  ovrsByPosition: (position: Position) => number[],
  group: PositionGroup,
  replacement?: number,
): number[] {
  return slotsInOrder((pos) => [...ovrsByPosition(pos)].sort((a, b) => b - a), group, replacement);
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
 * ===========================================================================
 * WHO IS ACTUALLY ON THE FIELD — ONE RULE, THE SIM'S OWN
 * ===========================================================================
 * Order a whole roster into per-position lineups the way `computeUnits`
 * (lib/sim/units.ts) does, so a screen that reports how good a club is and the
 * engine that plays its games cannot name two different sets of men.
 *
 * IT DELEGATES RATHER THAN RESTATING. `isAvailable` and `mergeUnnamed` are
 * imported from the sim and called here; the three lines below are the same
 * three lines `computeUnits` runs, in the same order, and nothing about the
 * policy is written down twice:
 *
 *   1. drop the unavailable FIRST, so an injured starter is simply not in the
 *      list and the next healthy man is at index 0 for as long as he is out —
 *      and the chart, never rewritten, puts him back the week he is fit;
 *   2. apply the club's named order through `mergeUnnamed`, which slots a man
 *      the chart does not mention in on merit rather than dumping him last;
 *   3. with no chart at all, or none at a position, fall back to best-first.
 *
 * A MAN THE CHART NAMED CAN BE OUT-RATED BY A MAN IT DID NOT, because
 * `mergeUnnamed` holds explicit intent above rating on purpose. So when that
 * named man is hurt, the better unnamed player moves up and the club reads
 * BETTER for the injury. That is right — the chart was costing them and the
 * injury undid it — and it is worth knowing before you read it as a bug:
 * across 9,888 clubs it happens 63 times, against 2,420 where an injury
 * correctly costs the club.
 *
 * WHY THIS EXISTS AT ALL. `buildLeagueRatings` used to average the best men at
 * each position and call that the team — `[...ovrs].sort((a,b) => b-a)` — which
 * was harmless only for as long as the engine did the same thing. It stopped
 * doing it (see `positionUnitRating` in lib/sim/units.ts): the sim now fields
 * the man the GM named, so a Team Rating built from the best available was
 * describing a lineup that never takes the field. Measured over all 9,536 clubs
 * in the database at the moment this landed, the two disagreed for 44.5% of
 * them, by up to 9.618 rating points. That is this codebase's cardinal defect —
 * a number that disagrees with the simulation it claims to describe — and it
 * was created by fixing the engine, which is why it is closed here.
 *
 * WHY `Fieldable` AND NOT `SimPlayer`. `isAvailable` and `mergeUnnamed` read
 * six fields and no others: id, position, trueOvr, status, injuryWeeks and
 * fatigue. `SimPlayer` is a superset that also carries firstName, lastName and
 * `trueAttrs` — a JSON blob per player. `buildLeagueRatings` runs on the
 * dashboard, the roster page, analytics, standings and the power rankings, and
 * loading an attribute blob for every one of ~1,700 men on every one of those
 * renders, to decide a sort order that never looks at it, is a cost with
 * nothing on the other side of it. The guard below is a compile-time proof that
 * `SimPlayer` really is a superset, so this narrows to the sim's own type and
 * cannot drift away from it silently.
 * ===========================================================================
 */
export interface Fieldable {
  id: string;
  position: string;
  trueOvr: number;
  status: string;
  injuryWeeks: number;
  fatigue: number;
}

/**
 * Compile-time only: every `SimPlayer` is a `Fieldable`. If the sim ever adds a
 * field these rules depend on, or renames one of the six, this stops building
 * and the next person finds out here instead of on a screen.
 */
const _simPlayerIsFieldable: (p: SimPlayer) => Fieldable = (p) => p;
void _simPlayerIsFieldable;

/**
 * Every position's lineup, in the order the club actually plays it.
 *
 * `depthOrder` is position -> ordered player ids, exactly the shape
 * `computeUnits` takes and exactly the shape `DepthChartSlot` rows produce.
 * Positions with nobody available come back as empty arrays; the caller decides
 * what an unmanned slot is worth (see `slotsInOrder`'s `replacement`).
 */
export function fieldedByPosition<T extends Fieldable>(
  players: T[],
  depthOrder?: Record<string, string[]>,
): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const p of players) if (isAvailable(p as unknown as SimPlayer)) (out[p.position] ??= []).push(p);
  for (const key of Object.keys(out)) {
    const override = depthOrder?.[key];
    if (override && override.length > 0) {
      out[key] = mergeUnnamed(out[key] as unknown as SimPlayer[], override) as unknown as T[];
    } else {
      out[key].sort((a, b) => effectiveRating(b as unknown as SimPlayer) - effectiveRating(a as unknown as SimPlayer));
    }
  }
  return out;
}

/**
 * ===========================================================================
 * WHAT TO CALL EACH RUNG OF A POSITION GROUP — WR1, WR2, CB3, EDGE4
 * ===========================================================================
 * The depth chart used to label its highlighted rows `ST`, or `ST1`/`ST2`/
 * `ST3` where more than one man starts, and everything below them `#4`, `#5`.
 * "ST2" is not a thing anybody says about a football team, and it told a GM
 * nothing about what the second slot at that position is actually for. The
 * app owner's call: *"we should label the, for example, WR1, WR2 instead of
 * saying ST."*
 *
 * HOW MANY RUNGS GET A NAME IS NOT A DESIGN CHOICE — IT IS READ OFF THE
 * ENGINE. `UNIT_DEPTH_WEIGHTS` (lib/tuning.ts) is the list of slots
 * `positionUnitRating` in lib/sim/units.ts actually pays out against, and now
 * that the engine plays the order it is handed rather than re-sorting it,
 * those weights are exactly the rungs where naming a different man changes
 * the football:
 *
 *     QB [1.0]                       RB [0.62, 0.28, 0.10]
 *     WR [0.42, 0.31, 0.19, 0.08]    TE [0.7, 0.3]
 *     EDGE [0.38, 0.32, 0.18, 0.12]  DT  [0.4, 0.33, 0.17, 0.10]
 *     LB [0.45, 0.33, 0.22]          CB  [0.4, 0.32, 0.19, 0.09]
 *     S  [0.55, 0.35, 0.10]          LT/LG/C/RG/RT/K/P [1.0]
 *
 * So four receivers get a name and the fifth does not, three backs and not the
 * fourth, one quarterback and one of each offensive line spot. BEYOND THE
 * WEIGHTED SLOTS THERE IS NO DISTINCTION — the engine reads nobody past the
 * end of that array, so a fifth receiver and a sixth are worth precisely the
 * same to it, and inventing "WR5" would be this codebase's own recurring
 * defect: a label asserting a difference the system does not make. Those rows
 * keep the bare `#n` they already had, which claims only a position in a list.
 *
 * This deliberately does NOT match `STARTERS_AT_POSITION` above, and the two
 * are answering different questions. That table is who lines up in the base
 * formation — three receivers in eleven personnel — and it decides the tint
 * and the bench line on the chart. This one is how far down the engine counts.
 * WR4 is therefore a real name on a bench row: he is not on the field on first
 * down, and he is still worth 0.08 of what the receiver unit is rated at.
 * Reconciling them by picking one number would make one of those two true
 * things unsayable.
 */
export function weightedDepthSlots(position: string): number {
  return (UNIT_DEPTH_WEIGHTS[position as Position] ?? []).length;
}

/**
 * The name of one rung, or null for a rung the engine never reads.
 *
 * `index` is 0-based, the way the depth array is. Returns `WR1` for index 0 at
 * WR and `null` from index 4 on. An unrecognised position — a save written
 * before the fullback was retired — has no weights and therefore no named
 * rungs at all, which is the honest answer rather than a crash.
 */
export function depthSlotLabel(position: string, index: number): string | null {
  return index >= 0 && index < weightedDepthSlots(position) ? `${position}${index + 1}` : null;
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

/**
 * ===========================================================================
 * WHO IS MISSING FROM THE ELEVEN, COUNTING ONLY MEN WHO CAN PLAY
 * ===========================================================================
 * The depth-chart page already reports starting slots with nobody in them,
 * but it counts BODIES: a club with one quarterback reads as covered even
 * when that quarterback is hurt. The sim does not agree — it fields whoever
 * is available and fills what is left at REPLACEMENT_LEVEL (48), which wrecks
 * the unit — so a GM could walk into a week having lost his only passer and
 * be told nothing at all.
 *
 * `injuryWeeks > 0` is the same test the engine applies (isAvailable, in
 * lib/sim/units.ts). Asking the question a second way here would eventually
 * produce a screen that disagrees with the game it describes.
 * ===========================================================================
 */
export interface LineupGap {
  position: Position;
  /** How many of this position's starting slots have nobody healthy for them. */
  missing: number;
  /** True when NOBODY at the position can play — the worst version of it. */
  none: boolean;
}

export function lineupGaps(
  players: { position: string; injuryWeeks: number; status: string }[],
): LineupGap[] {
  const gaps: LineupGap[] = [];
  for (const pos of POSITIONS) {
    const needed = startersAt(pos);
    if (needed === 0) continue;
    const healthy = players.filter(
      (p) => p.position === pos && p.status !== 'RETIRED' && p.injuryWeeks <= 0,
    ).length;
    const missing = Math.max(0, needed - healthy);
    if (missing > 0) gaps.push({ position: pos as Position, missing, none: healthy === 0 });
  }
  // Worst first: a position with nobody at all outranks one that is a man
  // short, and more missing slots outrank fewer.
  return gaps.sort((a, b) => Number(b.none) - Number(a.none) || b.missing - a.missing);
}
