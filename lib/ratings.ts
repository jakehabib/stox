import { Position, POSITIONS, canonicalPosition } from './tuning';

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
 * POSITION CHANGES — A MAN LEARNS A NEW JOB, AND THE ENGINE PRICES IT
 * ===========================================================================
 * The app owner's hole: *"in the real NFL - often lineman can change
 * positions with each other. our game doesn't allow it so if someone has two
 * solid RT and a weak LT, they can't swap the spare RT over."* And the same
 * for edge/linebacker, corner/safety.
 *
 * THERE IS NO PENALTY TABLE HERE, AND THERE MUST NOT BE ONE. The cost of
 * playing a man out of his natural spot is already computed by
 * `computeOverall` above, because an overall IS a position's weighting of a
 * man's attributes. Move him and you re-weight him:
 *
 *   - RT -> LT re-weights pass blocking from 0.36 to 0.42 and run blocking
 *     from 0.26 to 0.22. A right tackle barely moves, which is exactly right:
 *     it is a cheap, sensible move and should feel like one. A pass-first
 *     right tackle may even gain a point, and that is the engine's honest
 *     opinion — left tackle is the pass-protection job.
 *   - EDGE -> LB starts weighting tackling, coverage and football IQ, which is
 *     not what a pass rusher was built out of, and his overall falls about
 *     seven points on its own. A corner asked to play linebacker has to go via
 *     safety (see RELATED_POSITIONS) and pays twice — measured at nine.
 *
 * A hand-written cost matrix would be a SECOND opinion about the same thing,
 * and every worst bug in this codebase is a second opinion disagreeing with
 * the first (three definitions of the starting lineup, one of which fielded
 * twelve men). `attrsForPosition` has anticipated this since it was written —
 * *"so trades and position changes don't hit undefined values."*
 *
 * ---------------------------------------------------------------------------
 * THE ONE THING THE ENGINE CANNOT DO ON ITS OWN
 * ---------------------------------------------------------------------------
 * `generateAttributes` only ever rolls `attrsForPosition(pos)`, so a corner
 * genuinely has no `blockShed` value stored at all — the key is absent, not
 * low. And `computeOverall` SKIPS absent keys and renormalises over the
 * weights it did find. Left alone, a corner converted to linebacker would be
 * graded on tackling, coverage, awareness and speed only — 0.62 of the
 * linebacker weight vector, and the 0.62 that happens to be a corner's
 * strengths. He would come out FLATTERED by the move, and worse, he would be
 * graded by a different formula than the linebacker lined up beside him.
 * That is a lying metric (README principle 6) twice over.
 *
 * So a conversion MATERIALISES the attributes the new job asks for and he has
 * never been asked for. It does not invent a number to do it: it reuses the
 * generator's own statement about what a player is at something his position
 * never coached — `targetOvr * 0.85` (see generateAttributes in
 * lib/gen/players.ts, the `isWeighted ? ... : targetOvr * 0.85` branch).
 *
 * Deterministic, with no `Rng` noise on top, for three reasons that agree:
 * the preview on the player card must be the number the commit produces
 * (principle 6); a re-roll on every conversion would let a GM farm a good
 * `blockShed` by flipping a man back and forth; and an existing attribute is
 * never overwritten, only an absent one filled, so a conversion cannot raise
 * an attribute a player already has.
 *
 * Those two facts together are what make the move REVERSIBLE AT NO COST: the
 * attributes his old position weights are untouched by any number of moves, so
 * `computeOverall(oldPosition, attrs)` returns the same number forever. Flip a
 * man twenty times and bring him home and he is exactly the player he was.
 * That is not a nicety — it is what stops a GM ratcheting a rating by
 * flipping, and it is why no cooldown or once-per-season gate is needed on top
 * of the rating drop.
 * ===========================================================================
 */

/**
 * [TUNE] What a player is at something nobody has ever coached him to do,
 * as a fraction of his overall. NOT a free parameter — it is the same 0.85
 * lib/gen/players.ts uses for an attribute a position does not weight, and
 * changing it here without changing it there would make a converted player
 * and a generated one two different kinds of object.
 */
export const UNCOACHED_ATTR_FRACTION = 0.85;

/**
 * [TUNE] The same question asked about a CONVERSION rather than a generated
 * player, and answered differently on purpose: 1.0, so an allowed move costs
 * nothing.
 *
 * The owner's call — *"maybe the best option is to not penalize"* — after
 * noting that a linebacker and an edge rusher are different jobs. Measured,
 * they are not different jobs to this model at all, and the split is worth
 * writing down because it is the opposite of what everyone assumed. Mean
 * rating change over 600 synthetic players per pair, decomposed:
 *
 *                      re-weighting alone   with the 0.85 fill
 *     LT -> RT                   -0.0               -0.0
 *     EDGE -> DT                  0.0                0.0
 *     CB -> S                     0.0                0.0
 *     S  -> CB                   -0.0               -1.7
 *     LB -> EDGE                 -0.2               -5.9
 *     EDGE -> LB                 +0.1               -5.5
 *
 * Re-weighting — grading him by the new job's priorities instead of the old
 * one's — costs essentially NOTHING on every move this menu offers. The entire
 * apparent penalty was the fill: EDGE weights `passRush` and `runStop`, which
 * a linebacker has never been graded on, and CB weights `press`, which a
 * safety has never been graded on. Nothing else differs. So the six points
 * were never a judgement about a linebacker's ability to rush the passer; they
 * were the arbitrary assumption that a man is at 85% of himself at anything
 * nobody has measured him doing.
 *
 * At 1.0 every allowed move lands within 0.1 of level. That is the honest
 * reading of the model rather than a thumb on the scale: these positions
 * weight the same traits, so a pro asked to do the adjacent job is the player
 * his traits say he is.
 *
 * It stays SEPARATE from UNCOACHED_ATTR_FRACTION above rather than replacing
 * it, because they answer different questions. Generation is describing a man
 * at something his position never asks of him and which does not count toward
 * his grade; this is describing a man taking on a job that now does. Setting
 * generation to 1.0 too would flatten every player in the league toward his
 * own overall.
 *
 * ---------------------------------------------------------------------------
 * THE INVARIANT THIS CREATES, ASSERTED BELOW
 * ---------------------------------------------------------------------------
 * A free conversion between two positions on DIFFERENT trade-value tiers is an
 * arbitrage: buy the cheap label, convert, sell the dear one. That was already
 * live at 5.5x before the tiers were grouped. So any two positions this menu
 * connects must price the same, and `assertConversionTiersAgree` fails the
 * build if they ever drift apart.
 */
export const CONVERSION_ATTR_FRACTION = 1.0;

/**
 * Which positions a player may be moved to. A menu, deliberately NOT a cost
 * model — there is not a number in it, because the numbers come from
 * POSITION_WEIGHTS and nowhere else.
 *
 * It exists because "offer all sixteen" is worse in both directions. A list
 * with `P` on a quarterback's card is noise, not freedom (principle 5). And
 * the re-weighting is only self-punishing where the two jobs share a
 * vocabulary: a quarterback has no `kickPower` at all, so converting him to
 * kicker would materialise one at 0.85 of his overall and hand a 99 passer an
 * 84 kicker — the engine cannot price a move between positions that share no
 * attributes, so those moves are not offered.
 *
 * Symmetric by construction (checked at module load). The pairs:
 *
 *   OL — all five interchangeable, which is the owner's case. They share
 *        every weighted attribute, so a slide along the line materialises
 *        nothing whatsoever and is pure re-weighting. Guard and centre are
 *        the one exception: `C` weights `football_iq` and no other lineman
 *        does, so moving to centre charges for the calls automatically.
 *   EDGE <-> DT — the big end who reduces inside on passing downs.
 *   EDGE <-> LB — the 3-4 outside backer.
 *   CB <-> S — the third case.
 *
 * ADJACENT ONLY, and the owner drew the line himself: *"lets only allow
 * position changes in adjacent spots.... O lineman to O line. Linebackers to
 * only edge. safeties and CBs"*. So LB <-> S, WR <-> TE and WR <-> RB are
 * gone. They were defensible on football grounds — the big-nickel box safety
 * and the big slot are real jobs — but a menu that offers every plausible
 * cross-training turns a depth chart into a set of interchangeable parts, and
 * the point of positions is that they are not.
 *
 * EVERY move this menu offers is free — see CONVERSION_ATTR_FRACTION for the
 * measurement showing the cost was never a judgement about football, and the
 * owner's ruling that it should not be charged. That makes the menu itself the
 * only thing standing between a GM and an arbitrage, so what it connects has
 * to price identically. assertConversionTiersAgree() below is the check;
 * it is called from wherever TRADE_VALUE_TIER is consumed (this file cannot
 * import it — lib/tuning.ts is upstream of here and the cycle would break the
 * build).
 *
 * DT <-> LB is deliberately absent even though EDGE bridges them: a 320-lb
 * nose tackle is not a linebacker, the weight vectors overlap enough that the
 * engine would only charge him about nine points for it, and this game does
 * not model body type in a rating. Where the engine cannot see the objection,
 * the menu makes it. QB, K, P, RB, WR and TE have no relatives at all.
 */
export const RELATED_POSITIONS: Partial<Record<Position, Position[]>> = {
  LT: ['RT', 'LG', 'RG', 'C'],
  RT: ['LT', 'LG', 'RG', 'C'],
  LG: ['RG', 'C', 'LT', 'RT'],
  RG: ['LG', 'C', 'LT', 'RT'],
  C:  ['LG', 'RG', 'LT', 'RT'],
  EDGE: ['DT', 'LB'],
  DT: ['EDGE'],
  LB: ['EDGE'],
  S: ['CB'],
  CB: ['S'],
};

/**
 * Asymmetry would be a bug rather than a design choice — a move you can make
 * and not unmake is a trap, and the whole point of the emergent-cost model is
 * that going back restores exactly what you had. Checked at import, like the
 * eleven-man sums in lib/lineup.ts, because a hand-maintained adjacency list
 * is precisely the sort of table that drifts silently.
 */
for (const [from, tos] of Object.entries(RELATED_POSITIONS)) {
  for (const to of tos ?? []) {
    if (!RELATED_POSITIONS[to]?.includes(from as Position)) {
      throw new Error(`lib/ratings.ts: RELATED_POSITIONS is asymmetric — ${from} -> ${to} has no return leg.`);
    }
  }
}

/**
 * A CONVERSION MAY NOT CHANGE WHAT A MAN IS WORTH.
 *
 * Conversions are free (CONVERSION_ATTR_FRACTION) and reversible, so if two
 * positions this menu connects price differently, the difference is money for
 * nothing: buy the cheap label, convert, sell the dear one. It was live and
 * measured at 5.5x — the same 84-rated man was 46 points as a right tackle and
 * 251 as a left tackle, for a move costing 0.0 rating.
 *
 * Checked rather than trusted, like the eleven-man lineup sums in
 * lib/lineup.ts and the symmetry check above, because it couples two tables in
 * two files that nobody edits together. Adding one adjacency, or re-tiering one
 * position, is all it would take.
 */
export function assertConversionTiersAgree(tierOf: (p: Position) => string): void {
  for (const [from, tos] of Object.entries(RELATED_POSITIONS)) {
    for (const to of tos ?? []) {
      if (tierOf(from as Position) !== tierOf(to)) {
        throw new Error(
          `lib/ratings.ts: ${from} and ${to} can be converted between at no cost but price on different `
          + `trade tiers (${tierOf(from as Position)} vs ${tierOf(to)}) — that is a free arbitrage. `
          + `Put them on the same TRADE_VALUE_TIER, or remove the adjacency.`,
        );
      }
    }
  }
}

/** Positions this man may be moved to. Empty for QB, K and P, and for junk. */
export function relatedPositions(position: string): Position[] {
  return RELATED_POSITIONS[canonicalPosition(position)] ?? [];
}

/** Whether a move is one the game offers at all. */
export function canChangePositionTo(from: string, to: string): boolean {
  return relatedPositions(from).includes(canonicalPosition(to));
}

/**
 * The attribute map he would carry at `to`.
 *
 * Nothing is ever removed and nothing existing is ever changed — only the
 * keys the new job weights and he has never had are filled in, at
 * CONVERSION_ATTR_FRACTION of his overall. Keeping the old position's
 * attributes is what makes the move reversible at no cost, and they are not
 * dead weight: `computeOverall` simply does not weight them any more, and if
 * he moves back they are still exactly where he left them.
 */
export function convertedAttributes(
  attrs: AttrMap,
  to: Position,
  trueOvr: number,
): { attrs: AttrMap; learned: string[] } {
  const out: AttrMap = { ...attrs };
  const learned: string[] = [];
  const seed = Math.max(20, Math.min(99, Math.round(trueOvr * CONVERSION_ATTR_FRACTION)));
  for (const key of attrsForPosition(to)) {
    if (out[key] != null) continue;
    out[key] = seed;
    learned.push(key);
  }
  return { attrs: out, learned };
}

/** One destination, priced. `delta` is signed: negative is what it costs him. */
export interface PositionMove {
  position: Position;
  /** What he would rate there — the number the commit actually writes. */
  ovr: number;
  /** ovr - his current overall. */
  delta: number;
  /** Attributes this job asks for that he has never been coached in. */
  learned: string[];
  /** His attribute map at the new position, ready to persist. */
  attrs: AttrMap;
}

/**
 * What he would rate at `to`. THE one function every preview, every AI
 * decision and the commit itself calls, so the number on the card is by
 * construction the number written to the database.
 */
export function positionMove(
  player: { position: string; trueOvr: number; trueAttrs: AttrMap },
  to: Position,
): PositionMove {
  const { attrs, learned } = convertedAttributes(player.trueAttrs, to, player.trueOvr);
  const ovr = computeOverall(to, attrs);
  return { position: to, ovr, delta: ovr - player.trueOvr, learned, attrs };
}

/**
 * Every move on offer, best first. Ordering by what he would RATE rather than
 * by some fixed position order is the whole decision on one axis — a GM
 * scanning this list is asking "where is this man worth most", and the answer
 * should be the top row.
 */
export function positionMoves(
  player: { position: string; trueOvr: number; trueAttrs: AttrMap },
): PositionMove[] {
  return relatedPositions(player.position)
    .map((to) => positionMove(player, to))
    .sort((a, b) => b.ovr - a.ovr);
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
