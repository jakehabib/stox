import { Position, POSITIONS, canonicalPosition, TRADE_VALUE, TRADE_VALUE_TIER } from './tuning';

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
  /*
   * LB CARRIED NO RUN-DEFENCE GRADE AT ALL, which is how the position-change
   * card ended up telling the owner that moving a linebacker to EDGE would
   * expose him at "run defense, which nobody has ever coached him in". Of
   * course somebody has — stopping the run is most of an off-ball
   * linebacker's job. The card was reading the model correctly; the model was
   * wrong.
   *
   * These deliberately sum to 1.18 rather than 1.00. computeOverall
   * normalises by the weights actually present, so a linebacker in an
   * existing save — who has no runStop attribute — renormalises over exactly
   * the seven weights he had before and grades out to the identical number.
   * Rebalancing to 1.00 instead would have shifted every linebacker's rating
   * in every live save to make the arithmetic tidy.
   */
  LB: { tackling: 0.20, pursuit: 0.16, coverage: 0.16, blockShed: 0.12, awareness: 0.14, speed: 0.12, football_iq: 0.10, runStop: 0.18 },
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
 * [TUNE] What a player is at something nobody has ever coached him to do,
 * when he CONVERTS to a job that asks for it. 0.85 — the same figure
 * lib/gen/players.ts uses for an unweighted attribute.
 *
 * THIS WAS BRIEFLY 1.0 AND THAT WAS MY MISTAKE. I measured that the apparent
 * cost of a conversion was almost entirely this fill rather than the
 * re-weighting (LB -> EDGE: -0.2 from re-weighting, -5.9 with the fill) and
 * concluded the penalty was an artifact. It was not. The fill was encoding
 * something true: EDGE weights `passRush` and `runStop`, a linebacker has
 * never been graded on either, and that is precisely WHY he is not worth edge
 * money. Removing it made every conversion free, which made the trade market
 * a money printer — the same 84-rated man priced 46 as a right tackle and 251
 * as a left tackle for a move costing nothing.
 *
 * The owner's call on seeing it: *"lets fix our Edge/LB issue by forcing the
 * LB to take an overall hit for switching"*. Restored.
 */
export const CONVERSION_ATTR_FRACTION = 0.85;


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
 * EVERY MOVE THIS MENU OFFERS IS PRICED, and how much lever the pricing has
 * varies enormously across the menu — which is the fact TRADE_VALUE_TIER has
 * to be read against. The charge is the uncoached-attribute fill
 * (CONVERSION_ATTR_FRACTION), so it only bites where the destination weights
 * something the origin has never been graded on:
 *
 *   LB -> EDGE      `passRush`, 0.36 of an edge rusher's overall. The biggest
 *                   lever on the menu, and the reason LB can price a tier
 *                   below EDGE without the move paying.
 *   EDGE -> LB      tackling, coverage and football IQ, 0.46 of 1.18.
 *   C  -> LT/RT     `footwork`, 0.18/0.16. Small.
 *   anything -> C   `football_iq`, 0.14. Small.
 *   S  -> CB        `press`, 0.14. Small.
 *   LT <-> RT <-> LG <-> RG, and EDGE <-> DT — NOTHING AT ALL. These weight
 *                   identical attribute sets, so at equal attributes the
 *                   engine cannot tell the two jobs apart and has no lever
 *                   whatsoever. Those pairs MUST price identically; there is
 *                   no conversion cost available to cover a gap.
 *
 * assertNoProfitableConversion() below is the check that this stays true;
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
  // Clubs really do this — a kicker handles punts and a punter handles
  // kickoffs, and on a short roster one man does both. Neither is graded on
  // anything the other needs, so the move prices itself the same way every
  // other conversion does.
  K: ['P'],
  P: ['K'],
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
 * NO CONVERSION MAY PAY FOR ITSELF.
 *
 * Conversions are reversible, so if moving a man to a position the market
 * pays more for makes him worth more, the game is a money printer: buy the
 * cheap label, convert, sell the dear one. It was live and measured at 5.5x.
 *
 * This used to assert that connected positions share a TIER, which was too
 * strong: LB and EDGE can price differently because the move genuinely costs
 * a linebacker about six points — he has never been graded on pass rush, and
 * that is exactly why he is not worth edge money. What actually matters is
 * the outcome, so that is what is asserted.
 *
 * The check is real arithmetic, not a table comparison: it converts a player
 * at every rating in the band the tier curves are calibrated over and confirms
 * he is worth no more afterwards. Positions whose attribute sets are IDENTICAL
 * (LT and RT weight the same five things) have no lever to charge with, so for
 * those the requirement collapses back to equal tiers — which the failure
 * message says, so nobody has to rediscover why.
 *
 * IT SWEEPS 60..99 RATHER THAN SAMPLING, and that is not belt-and-braces. The
 * moment LB was priced a tier below EDGE this stopped being a formality and
 * became the thing holding the split up, and a sampled check is exactly as
 * strong as its samples. Swept against every single-position retier of the
 * shipped table, the old four-rating sample ([72, 80, 88, 94]) reports a clean
 * bill on CB at the QB tier, which is in fact profitable at 73 (S -> CB, 28
 * points -> 29). 60..99 is the same band TRADE_VALUE.TIER_CURVE claims its
 * ordering over, it costs about a millisecond at import, and it means the
 * guard cannot be satisfied by luck.
 *
 * A NOTE FOR WHOEVER WEAKENS THIS NEXT. `convertedOvr` is wired to the real
 * `convertedAttributes`, which itself reads these curves and turns the fill
 * down until the move stops paying — so the check can only fail where that
 * fill runs out of room (it seeds a floor of 20, it does not reach zero).
 * That is a real limit and it is reached: LB at MID passes, LB at MINIMAL
 * throws at 88 OVR. Verify any change against BOTH of those, or you have
 * proved only that the code agrees with itself.
 */
export function assertNoProfitableConversion(
  valueAt: (position: Position, ovr: number) => number,
  convertedOvr: (from: Position, to: Position, ovr: number) => number,
): void {
  for (const [from, tos] of Object.entries(RELATED_POSITIONS)) {
    for (const to of tos ?? []) {
      for (let ovr = 60; ovr <= 99; ovr++) {
        const before = valueAt(from as Position, ovr);
        const after = valueAt(to, convertedOvr(from as Position, to, ovr));
        if (after > before + 0.5) {
          throw new Error(
            `lib/ratings.ts: converting ${from} -> ${to} at ${ovr} OVR RAISES trade value `
            + `(${before.toFixed(0)} -> ${after.toFixed(0)}) — that is free money. Either the two `
            + `positions must sit on the same TRADE_VALUE_TIER, or the conversion must cost enough `
            + `rating to cover the gap. Note ${from} and ${to} may weight identical attributes, in `
            + `which case there is nothing to charge and equal tiers is the only option.`,
          );
        }
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
/** Trade value of a player of this rating at this position, on the tier curves. */
function tierValue(position: Position, ovr: number): number {
  const c = (TRADE_VALUE.TIER_CURVE as Record<string, { replacementLevel: number; steepness: number; scale: number; ceiling: number }>)[
    TRADE_VALUE_TIER[position]
  ];
  if (!c) return 0;
  return Math.min(c.ceiling, (Math.exp(Math.max(0, ovr - c.replacementLevel) * c.steepness) - 1) * c.scale);
}

/**
 * THE RATING A CONVERSION MAY NOT EXCEED.
 *
 * A move to a position the market pays MORE for must not, by itself, make a
 * player worth more — or the game is a money printer: buy the cheap label,
 * convert, sell the dear one. That was live and measured at 5.5x (the same
 * 84-rated man priced 46 as a right tackle and 251 as a left tackle).
 *
 * So a converted player may be worth at most what he was worth before the
 * move. Derived from the tier curves rather than written down as a matrix of
 * penalties, because a hand-maintained matrix is a SECOND opinion about the
 * same thing and would drift the moment anybody retuned a curve — this reads
 * whatever TRADE_VALUE says today and stays correct by construction.
 *
 * Moving DOWN in positional value returns Infinity — no ceiling is needed,
 * because the move already costs him value and nobody arbitrages a loss.
 */
function maxOvrAfterConversion(from: Position, to: Position, fromOvr: number): number {
  const target = tierValue(from, fromOvr);
  if (tierValue(to, fromOvr) <= target) return Infinity;
  for (let ovr = Math.round(fromOvr); ovr > 20; ovr -= 1) {
    if (tierValue(to, ovr) <= target) return ovr;
  }
  return 20;
}

export function convertedAttributes(
  attrs: AttrMap,
  to: Position,
  trueOvr: number,
  from?: Position,
): { attrs: AttrMap; learned: string[] } {
  const learned: string[] = [];
  for (const key of attrsForPosition(to)) if (attrs[key] == null) learned.push(key);

  /*
   * A MOVE IS REVERSIBLE, ON PURPOSE.
   *
   * A version of this decayed the grades the old job valued and the new one
   * ignores, so a round trip cost about four points and compounded. It worked,
   * and it was the wrong call: the cost of playing a man out of position is
   * already real and already felt — he is eight points worse the whole time he
   * is there — and there is nothing to defend against, because
   * assertNoProfitableConversion guarantees no switch can raise what he is
   * worth. A permanent tax on top of that only punishes finding out.
   */
  const fill = (fraction: number): AttrMap => {
    const out: AttrMap = { ...attrs };
    const seed = Math.max(20, Math.min(99, Math.round(trueOvr * fraction)));
    for (const key of learned) out[key] = seed;
    return out;
  };

  /*
   * THE UNCOACHED FILL IS THE ONE KNOB, TURNED AS FAR AS THE MOVE REQUIRES.
   *
   * Two things have to be true of a conversion, and both are expressed here
   * rather than by bolting a penalty onto the result:
   *
   *   1. He is graded on what the new job asks of him, including the parts
   *      nobody has ever coached — CONVERSION_ATTR_FRACTION, the default.
   *   2. The move may not pay for itself in trade value alone.
   *
   * Turning the fill down is how (2) gets satisfied, because it is the same
   * lever (1) already uses: the attributes he has never been graded on are
   * exactly the ones the new job needs, so "he is worse at this than at his
   * old job" and "he is not worth more for having switched" are the same
   * statement about the same man. The alternative — computing a rating from
   * the attributes and then quietly subtracting from it — would leave the
   * card's rating disagreeing with the card's attributes, which is this
   * codebase's defining bug class.
   *
   * Measured on the restored default: LB -> EDGE costs 5.9, which already
   * clears the 4.4 the curves require. S -> CB costs only 1.7 against the
   * same 4.4, and this is what closes it.
   */
  let best = fill(CONVERSION_ATTR_FRACTION);
  if (from && learned.length > 0) {
    const ceiling = maxOvrAfterConversion(from, to, trueOvr);
    if (Number.isFinite(ceiling)) {
      for (let f = CONVERSION_ATTR_FRACTION; f >= 0; f -= 0.05) {
        best = fill(Math.max(0, f));
        if (computeOverall(to, best) <= ceiling) break;
      }
    }
  }
  return { attrs: best, learned };
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
  /**
   * His CEILING at the new position — present only when the caller supplied
   * one. See THE CEILING MOVES WITH THE FLOOR below for why it moves at all.
   */
  potential?: number;
  /** potential - his current ceiling. Signed, and equal to `delta` except at the 99 cap. */
  potentialDelta?: number;
}

/**
 * ===========================================================================
 * THE CEILING MOVES WITH THE FLOOR
 * ===========================================================================
 * `potential` used to be deliberately untouched by a conversion, on the
 * reading that it is "a ceiling on the man, not on the job". Measured, that
 * reading refunded most of the conversion:
 *
 *   The trade market does not price `trueOvr`. It prices
 *   `effectiveCeiling = trueOvr + (potential - trueOvr) * w` (playerValueDetailed,
 *   lib/ai/gm.ts), with w between 0.18 and 0.55 depending on the club's
 *   window. Charge a move to `trueOvr` and leave `potential` where it was and
 *   the gap between them WIDENS by exactly the charge, so only (1 - w) of it
 *   reaches the number anybody trades on — 63% refunded at a neutral club.
 *   Measured over the 22,600 rostered linebackers on this box, that alone
 *   took LB -> EDGE from 227 profitable conversions to 6,055 the moment LB
 *   priced a tier below EDGE, with 201 of them clearing +100 points — a
 *   third-round pick of free money, for a move that also drops his rating
 *   seven points. Moving the ceiling with him brings it back to 763, of
 *   which 7 clear +100.
 *
 * And progression refunded the rest of it: `progressPlayer` uses `potential`
 * as a per-attribute attractor over `attrsForPosition(position)` — the NEW
 * position's attributes after a move — so an untouched ceiling meant a
 * converted man simply grew back to it in the new job within a couple of
 * seasons. The cost was a loan, not a price.
 *
 * So the ceiling travels with the rating, by the same signed delta. Two
 * properties make that safe rather than a second penalty bolted on:
 *
 *   THE RUNWAY IS PRESERVED EXACTLY. potential - trueOvr is unchanged by the
 *   move, so a 24-year-old with seven points of growth left still has seven
 *   points of growth left. What changed is where those seven points start
 *   from, which is the same thing the rating change already said.
 *
 *   IT IS REVERSIBLE, like everything else about a conversion. Moving back
 *   restores the attribute map exactly, hence the overall exactly, hence a
 *   delta that is exactly the negative of the first — so the ceiling lands
 *   back where it began. (The one exception is the 99 cap on a move that
 *   RAISES a rating; a ceiling clipped at 99 does not come all the way back.)
 * ===========================================================================
 */
function convertedPotential(potential: number, delta: number): number {
  return Math.max(20, Math.min(99, potential + delta));
}

/**
 * What he would rate at `to`. THE one function every preview, every AI
 * decision and the commit itself calls, so the number on the card is by
 * construction the number written to the database.
 *
 * `potential` is optional because two of the callers genuinely have no
 * business with it — the import-time arbitrage guard in lib/ai/gm.ts builds a
 * synthetic man who has none, and the AI's depth-chart planner is asking only
 * "would he rate higher over there". Everything that WRITES passes it.
 */
export function positionMove(
  player: { position: string; trueOvr: number; trueAttrs: AttrMap; potential?: number },
  to: Position,
): PositionMove {
  const { attrs, learned } = convertedAttributes(player.trueAttrs, to, player.trueOvr, canonicalPosition(player.position));
  const ovr = computeOverall(to, attrs);
  const delta = ovr - player.trueOvr;
  const potential = player.potential === undefined ? undefined : convertedPotential(player.potential, delta);
  return {
    position: to,
    ovr,
    delta,
    learned,
    attrs,
    potential,
    potentialDelta: potential === undefined ? undefined : potential - player.potential!,
  };
}

/**
 * Every move on offer, best first. Ordering by what he would RATE rather than
 * by some fixed position order is the whole decision on one axis — a GM
 * scanning this list is asking "where is this man worth most", and the answer
 * should be the top row.
 */
export function positionMoves(
  player: { position: string; trueOvr: number; trueAttrs: AttrMap; potential?: number },
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
  if (grade >= RATING_BANDS.ELITE) return { label: unproven ? 'All-Star Prospect' : 'Elite', className: 'text-gold' };
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

  /*
   * A GENERATIONAL CEILING IS AN IDENTITY, NOT A DRAFT-WEEK BADGE.
   *
   * `grade` used to be `unproven ? potential : ovr`, flat, and that flip was
   * jarring exactly where it mattered most. A prospect is graded on his
   * ceiling, so a 99-potential man taken first overall reads "Generational" on
   * draft night — and then the moment he has one season of experience the
   * basis switches to his CURRENT overall, and the same player reads "Quality
   * Starter" because he is 77 today. Nothing about him changed; the question
   * being asked did.
   *
   * The tag now survives that switch: at the generational band, and ONLY
   * there, a proven player is graded on his ceiling too. Every other band is
   * exactly as it was, so a 90-potential man still becomes what he actually is
   * once he plays.
   *
   * It is not a permanent sticker either, and that is the point of putting it
   * on the ceiling rather than on a flag. Potential is a live number that can
   * now fall — see the ceiling-erosion work in lib/development.ts — so a man
   * who never delivers on a 99 loses the ceiling and loses the tag with it,
   * honestly and gradually, rather than keeping a title he has disproved.
   * `Math.max` because the ceiling is the higher of the two by construction
   * and a man who has actually REACHED 99 is generational by either reading.
   */
  const ceiling = Math.max(ovr, potential);
  const grade = unproven
    ? potential
    : ceiling >= RATING_BANDS.GENERATIONAL ? ceiling : ovr;
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

/**
 * Colour for a rating the reader is only ever given as a RANGE.
 *
 * The app owner, on the draft board: *"some players in the draft are blue,
 * green etc. doesnt that giveaway the overalls?"* It did. The cell printed
 * "78-96" — 25 points wide, the median across a real class — while its ink
 * came off `ratingColor(view.scoutedOvr)`, the fogged CENTRE the reader is
 * never shown. Measured over 63,470 fogged prospect views in the dev database
 * that ink landed in the band of the man's TRUE overall 80.2% of the time
 * (86.5% on the 400-man class the report was filed against, 83.8% on a
 * controlled re-run of one). The text said "we barely know"; the colour sorted
 * him into an eight-point tier and was right nearly nine times in ten.
 *
 * So the ink comes off the RANGE, and only where the range can be read one way
 * — both ends in the same band. A range that straddles a boundary gets no tier
 * at all, because the club does not have one to give. Nothing is claimed that
 * the printed number does not already say, which is the whole rule: a cell may
 * not advertise a precision the number it sits on does not have.
 *
 * THE COLUMN GOES QUIET, and that is the honest reading of today's band rather
 * than a design choice. A prospect's displayed range is 25 points wide cold and
 * 7 wide after a full season on the shortlist, and a rating tier is 5 to 8
 * points, so a tier colour survives on 0% of a cold class, 1.6% after a season
 * of work and 8.3% of men flown in for a workout. Ink is now something the
 * department earns. If that reads as too quiet, the number to argue with is the
 * BAND, not this function: the band contains the man's true overall 99.7% of the
 * time (measured), which is not a confidence interval, it is a guarantee — see
 * the aggregation note in lib/scouting.ts buildScoutedView.
 *
 * `low === high` — revealed, fog off, own roster — collapses to exactly
 * ratingColor(v), so an unfogged board is coloured precisely as it always was.
 * There the number really is his tier.
 */
export function ratingColorForRange(low: number, high: number): string {
  const ink = ratingColor(low);
  // The neutral is `text-muted`, the ink every other fogged range in the app
  // already prints in (the draft recap's ranges, the scouting lanes, The
  // Selection's "our file"). Grey against a hyphenated span reads as "no
  // claim", not as "depth" — a tier was never a span, and the span is right
  // there to be read.
  return ink === ratingColor(high) ? ink : 'text-muted';
}

export const ALL_POSITIONS = POSITIONS;
