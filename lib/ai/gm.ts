import { Rng, clamp } from '../rng';
import { AI, ROSTER_TARGETS, ROSTER_NEED_QUALITY_WEIGHT, Position, POSITIONS, PICK_VALUE_CHART, LEAGUE, TRADE_VALUE, TRADE_VALUE_TIER } from '../tuning';
import { GmProfile } from '../types';
import { marketValue, remainingValue, capHit, proration, capSavingsOnCut, formatMoney, ContractLike } from '../cap';
import { startersAt } from '../lineup';
import { REPLACEMENT_LEVEL } from '../sim/units';
import { CapMode } from '../types';
import { readJson } from '../json';
import { assertConversionTiersAgree, relatedPositions } from '../ratings';

/**
 * A POSITION CHANGE MAY NOT CHANGE WHAT A MAN IS WORTH.
 *
 * lib/ratings.ts makes every conversion its menu offers free and reversible,
 * so two positions that menu connects have to price on the same trade tier or
 * the difference is money for nothing — buy the cheap label, convert, sell the
 * dear one. It was live, at 5.5x: the same 84-rated man was 46 points as a
 * right tackle and 251 as a left tackle.
 *
 * This is the one module that reads TRADE_VALUE_TIER, so this is where the
 * check belongs. It runs at import rather than per-valuation because it is a
 * statement about two constant tables, and it throws rather than warns for the
 * same reason lib/lineup.ts throws on an eleven-man sum that isn't eleven: a
 * silent free arbitrage is worse than a failed boot. (lib/ratings.ts cannot
 * run it itself — lib/tuning.ts is upstream of it and the cycle would break
 * the build.)
 */
assertConversionTiersAgree((pos) => TRADE_VALUE_TIER[pos]);

// The age multiplier is part of a man's price too, so it is bound by the same
// rule and checked by the same assertion. Keying arcs per-position reopened
// this exact arbitrage at 2.49x — an old left tackle relabelled a guard
// escaped the receivers' decline curve and got 10% more valuable on average.
// Re-worded on the way out because the shared assertion can only name
// TRADE_VALUE_TIER, and a check that reports the wrong table is worse than no
// check: here the table to fix is AGE_ARC.
try {
  assertConversionTiersAgree((pos) => TRADE_VALUE.AGE_ARC[pos]);
} catch {
  const clash = POSITIONS.flatMap((from) =>
    relatedPositions(from).map((to) => [from, to] as const),
  ).find(([from, to]) => TRADE_VALUE.AGE_ARC[from] !== TRADE_VALUE.AGE_ARC[to]);
  throw new Error(
    `lib/tuning.ts: ${clash?.[0]} and ${clash?.[1]} can be converted between at no cost but age on `
    + `different curves (${clash && TRADE_VALUE.AGE_ARC[clash[0]]} vs ${clash && TRADE_VALUE.AGE_ARC[clash[1]]}) — `
    + `the age multiplier is part of a man's price, so that is a free arbitrage. Put them on the same `
    + `TRADE_VALUE.AGE_ARC, or remove the adjacency in lib/ratings.ts.`,
  );
}

/**
 * ===========================================================================
 * AI GENERAL MANAGER
 * ===========================================================================
 * One shared brain used by free agency, trades and the draft, so an AI team
 * behaves consistently across all three. Everything flows from two things:
 *
 *   NEED    — how thin is this roster at each position, right now
 *   PROFILE — this franchise's personality (win-now vs rebuilding, how much
 *             it loves picks, how aggressive it is)
 *
 * [TUNE] The AI is deliberately imperfect: valuations get a noise term and it
 * will occasionally reach in the draft. A perfectly rational AI is unbeatable
 * and boring.
 * ===========================================================================
 */

export interface RosterPlayer {
  id: string;
  position: string;
  trueOvr: number;
  age: number;
  potential: number;
  /** Optional — only trade-value pricing needs this. Free agents/rookie-pool players naturally have none. */
  contract?: ContractLike | null;
}

export function defaultGmProfile(rng: Rng): GmProfile {
  return {
    aggression: clamp(rng.normal(0.5, 0.18), 0.05, 0.95),
    winNow: clamp(rng.normal(0.5, 0.22), 0.05, 0.95),
    valuePicks: clamp(rng.normal(0.5, 0.2), 0.05, 0.95),
    bpaBias: clamp(rng.normal(0.55, 0.18), 0.05, 0.95),
  };
}

export function parseGmProfile(raw: string | null | undefined, fallbackRng?: Rng): GmProfile {
  const parsed = readJson<Partial<GmProfile>>(raw, {});
  const base = fallbackRng ? defaultGmProfile(fallbackRng) : { aggression: 0.5, winNow: 0.5, valuePicks: 0.5, bpaBias: 0.55 };
  return { ...base, ...parsed };
}

/**
 * Need score per position, 0 (stacked) .. 1 (desperate).
 * Combines "do we have enough bodies" with "is the starter any good".
 */
export function teamNeeds(players: RosterPlayer[]): Record<string, number> {
  const needs: Record<string, number> = {};
  for (const pos of POSITIONS) {
    const group = players
      .filter((p) => p.position === pos)
      .sort((a, b) => b.trueOvr - a.trueOvr);
    const target = ROSTER_TARGETS[pos];

    // Quantity need: below the minimum is an emergency.
    const countNeed = clamp((target.min - group.length) / Math.max(1, target.min), 0, 1);

    // Quality need: how far the starter is below a "fine starter" baseline.
    // [TUNE] 72 is treated as an acceptable starter.
    const starter = group[0]?.trueOvr ?? 40;
    const qualityWeight = ROSTER_NEED_QUALITY_WEIGHT[pos] ?? 1;
    const qualityNeed = clamp((72 - starter) / 30, 0, 1) * qualityWeight;

    // Depth need: second body matters more at high-snap positions. Positions
    // that only ever roster one player (K, P, FB) never carry a "backup" —
    // that's not a hole, it's the position, so skip this term entirely for
    // them.
    const backup = group[1]?.trueOvr ?? 40;
    const depthNeed = target.max > 1 ? clamp((62 - backup) / 30, 0, 1) * 0.4 : 0;

    needs[pos] = clamp(countNeed * 1.4 + qualityNeed * 0.75 + depthNeed, 0, 1);
  }
  return needs;
}

/**
 * Human read on a need score for display — a bare "44%" answers a question
 * nobody asked ("44% of what?"); a GM wants "how urgent is this," not a
 * fraction. [TUNE] thresholds chosen against teamNeeds' own scale.
 */
// Display-only: the label and Tailwind class a need renders with. Never
// feeds an AI decision — the raw 0..1 score does that. Each tier gets its
// own color; two tiers sharing one made the distinction invisible.
export function needSeverity(score: number): { label: string; className: string } {
  if (score >= 0.6) return { label: 'Urgent', className: 'text-bad' };
  if (score >= 0.35) return { label: 'High', className: 'text-warn' };
  if (score >= 0.15) return { label: 'Moderate', className: 'text-accent2' };
  return { label: 'Notable', className: 'text-muted' };
}

/**
 * ===========================================================================
 * UPGRADE OVER THE INCUMBENT — "IS HE BETTER THAN WHAT I ALREADY HAVE?"
 * ===========================================================================
 * `teamNeeds` above answers exactly one question — DO I HAVE A HOLE? — and it
 * answers it well. What it cannot answer, and was never shaped to, is the
 * question a real front office actually asks about a good player: is he
 * better than the man I would put on the field instead of him?
 *
 * Those are not the same question, and treating them as one produced the bug
 * this exists to fix. `teamNeeds`' quality term is `(72 - starter) / 30`,
 * which is flat zero for any starter at 72 or better — so a club with a 72
 * right tackle and a club with a 90 right tackle were indistinguishable, and
 * because `TRADE_VALUE.NEED_MULT_MIN` is 0.72, "no need" is not a shrug, it
 * is an active 28% DISCOUNT. An 88 offered to a club starting a 78 came back
 * priced at 72% of his worth. The club did not merely fail to want him; it
 * marked him down.
 *
 * The fix is a second, separate signal rather than a wider `teamNeeds`:
 *
 *   - `teamNeeds` stays single-purpose, so the position-flexibility work that
 *     also reads it (a club with three tackles and no guard) has a clean
 *     function to reason about, and so free agency and the draft board see
 *     exactly the numbers they see today.
 *   - This asks the OTHER question, off the same roster.
 *
 * They are blended at the point of use (see `playerValueDetailed`) by taking
 * the LARGER of the two, because they are two readings of one axis — "how
 * much does this man improve us" — and a club with nobody at a position both
 * has a hole and would be hugely upgraded. Taking the max keeps the existing
 * bounded multiplier exactly as wide as it already was: this fix stops the AI
 * DISCOUNTING obvious upgrades, it does not hand it a new way to overpay.
 *
 * WHO THE INCUMBENT IS. Not "the best man at the position" — the man who
 * actually loses the job. `startersAt` (lib/lineup.ts) is the single
 * definition of how many play at each spot, and it is read, not re-derived:
 * three receivers start, so an 88 arriving at a club with 90/85/80/75 is not
 * measured against the 90 or the 85, he is measured against the 80, because
 * the 80 is who comes off the field. That is also why a fourth receiver is a
 * smaller gain than a starter — he displaces nobody who plays.
 *
 * AND IT WORKS IN BOTH DIRECTIONS, which is the property that keeps the AI
 * honest about what it gives up. A player already on this roster is removed
 * from the group before the comparison, so the same arithmetic that asks
 * "how much better is he than our starter" of an incoming player asks "how
 * far do we drop if he leaves" of an outgoing one. Without that, a club
 * valuing its OWN starting tackle would have found him sitting behind
 * himself, called him a backup, and sold him cheap.
 * ===========================================================================
 */

/**
 * [TUNE] Shape of the upgrade curve. Deliberately saturating: a roster fields
 * ONE man at a slot, so the second ten points of an upgrade cannot be worth
 * what the first ten were — +25 lands at roughly 1.6x the score of +10, not
 * 2.5x. And the sharpness keeps small gains near nothing, so a club with an
 * 85 does not get talked into paying up for an 86.
 */
const UPGRADE = {
  /** Snap-weighted rating points that score half of everything this term can give. */
  HALF_GAIN: 10,
  /** >1 flattens the bottom of the curve — +1 must not read as a tenth of +10. */
  SHARPNESS: 1.6,
  /**
   * Share of the snaps the men BEHIND the starters actually take, first man
   * off the bench then second. A backup is worth something — starters get
   * hurt — but an order of magnitude less than the job itself, which is the
   * whole of "acquiring a starter is worth more than acquiring a fourth
   * receiver of the same rating". Past the second man a player is roster
   * insurance rather than a contributor and is not counted at all.
   *
   * Sized against reality rather than to taste: a swing tackle or a backup
   * corner plays on the order of a tenth of a team's snaps. An earlier draft
   * of this used 0.3 for the first bench slot and it was visibly too generous
   * — it made an 88 offered to a club starting an 89 (who would bench him)
   * score HIGHER than the same 88 offered to a club starting an 84 (who would
   * play him), because the deep backup he'd leapfrog was so much worse than
   * either starter.
   */
  DEPTH_SNAP_WEIGHTS: [0.12, 0.02],
};

/**
 * [TUNE] How a club's own cap position colours what a contract is worth TO
 * IT. See the cap block in `playerValueDetailed`.
 *
 * Deliberately asymmetric. Acquiring reaches much further down than shedding
 * reaches up, because "we cannot fit this contract" is a hard fact about a
 * club's sheet while "we would quite like the relief" is only ever a
 * preference — and because the hard version of the first is already enforced
 * at execution by assertCapRoom, so an unbounded discount here would just be
 * the same refusal charged twice.
 */
const CAP_FIT = {
  /** Room above which a club has no cap-driven reason to shed salary at all. */
  COMFORT_SPACE: 25_000_000,
  /** A contract inside this share of a club's room costs it nothing to think about. */
  FREE_SHARE: 0.25,
  /** At this share (i.e. it does not fit) the acquiring discount is at full strength. */
  FULL_SHARE: 1.25,
  ACQUIRE_MULT_MIN: 0.6,
  SHED_MULT_MIN: 0.88,
};

export interface RosterFit {
  /** 0..1 — the curved, position-weighted read of `gain`. This is what moves value. */
  score: number;
  /**
   * Snap-weighted rating points he adds to the club's depth chart at his
   * position: the whole ladder after he arrives minus the whole ladder
   * before, with each slot weighted by how much it actually plays. A pure
   * starting upgrade of +10 comes out at 10; the same man arriving as a
   * fourth receiver comes out at a fraction of it.
   */
  gain: number;
  /** The man whose job he takes — the last starter, or the man he'd back up. REPLACEMENT_LEVEL when the slot is empty. */
  incumbent: number;
  /** Whether the slot he'd occupy is a starting slot, per lib/lineup.ts. */
  starts: boolean;
  /** True when he is ALREADY on this roster, i.e. the question is what we lose, not what we gain. */
  onRoster: boolean;
}

/**
 * How much a player improves (or, for one of your own, how much he is holding
 * up) a specific roster at his position. See the block above.
 *
 * THE MEASURE IS THE WHOLE DEPTH CHART, not one slot. Signing an 88 to a club
 * starting an 84 does not only upgrade the starter by four — it also drops
 * the 84 into the swing role ahead of whatever was there. Scoring only the
 * slot he lands in got that wrong in a way that showed: an 88 offered to a
 * club with an 89 (who would bench him behind a strong starter) out-scored
 * the same 88 offered to a club with an 84 (who would play him), purely
 * because the deep backup he leapfrogged was worse. Summing the ladder both
 * ways fixes it by construction and needs no special case.
 *
 * `roster` is the club's whole roster; the player is matched out of it by id,
 * so callers pass the same list either way and never have to say which side
 * of a trade they are asking about.
 */
export function rosterFit(p: RosterPlayer, roster: RosterPlayer[]): RosterFit {
  const onRoster = roster.some((r) => r.id === p.id);
  const group = roster
    .filter((r) => r.position === p.position && r.id !== p.id)
    .map((r) => r.trueOvr)
    .sort((a, b) => b - a);
  const starters = startersAt(p.position);

  // The slots that play, and how much. Every starting slot counts fully;
  // bench slots count for the share of snaps a backup really takes. Positions
  // that only ever roster one man (K, P) carry no bench slots at all — the
  // same rule, off the same table, that teamNeeds uses to skip its depth term
  // for them, because for those a second body is not depth, it is a spare.
  const carriesDepth = (ROSTER_TARGETS[p.position as Position]?.max ?? 1) > 1;
  const weights = [
    ...Array<number>(starters).fill(1),
    ...(carriesDepth ? UPGRADE.DEPTH_SNAP_WEIGHTS : []),
  ];
  // An unfilled slot is scored at what the sim would actually field there
  // (lib/sim/units.ts REPLACEMENT_LEVEL), not at a second opinion about it.
  const ladder = (chart: number[]) =>
    weights.reduce((sum, w, i) => sum + w * (chart[i] ?? REPLACEMENT_LEVEL), 0);

  // Where he lands. Ties fall BEHIND the incumbent — a man who merely matches
  // what you already have does not take anybody's job.
  let slot = 0;
  while (slot < group.length && group[slot] >= p.trueOvr) slot++;
  const withHim = [...group.slice(0, slot), p.trueOvr, ...group.slice(slot)];
  const gain = ladder(withHim) - ladder(group);

  // Who the screen should name. If he cracks the lineup, the man who actually
  // comes off the field is the LAST starter, not the one immediately above
  // him — an 88 arriving as a club's WR2 pushes its WR3 to the bench, it does
  // not un-play its WR1.
  const starts = slot < starters;
  const incumbent = (starts ? group[starters - 1] : group[slot]) ?? REPLACEMENT_LEVEL;

  // Same table teamNeeds weights its quality term with, for the same reason:
  // ten points of kicker is not ten points of quarterback. The position's
  // TRADE economics are already in the tier curve this multiplies, so
  // weighting by those a second time would double-count them.
  const qualityWeight = ROSTER_NEED_QUALITY_WEIGHT[p.position as Position] ?? 1;
  const g = Math.max(0, gain);
  const curved = Math.pow(g, UPGRADE.SHARPNESS) / (Math.pow(g, UPGRADE.SHARPNESS) + Math.pow(UPGRADE.HALF_GAIN, UPGRADE.SHARPNESS));

  return { score: clamp(curved * qualityWeight, 0, 1), gain, incumbent, starts, onRoster };
}

/**
 * League-wide scarcity per position, 0 (plentiful good talent) .. 1
 * (barely any). Pure function over an already-fetched roster snapshot —
 * callers fetch the whole league's players ONCE per trade evaluation (not
 * per player, not per render) and reuse this across every asset in the
 * deal, per the "don't make this expensive" requirement. "Good" is a
 * simple, cheap threshold (75+ OVR); expected supply assumes roughly one
 * good player per team is normal, so scarcity only shows up when a
 * position is genuinely thin league-wide.
 */
export function leagueScarcity(allPlayers: { position: string; trueOvr: number }[]): Record<string, number> {
  const GOOD_THRESHOLD = 75;
  const counts: Record<string, number> = {};
  for (const p of allPlayers) {
    if (p.trueOvr < GOOD_THRESHOLD) continue;
    counts[p.position] = (counts[p.position] ?? 0) + 1;
  }
  const scarcity: Record<string, number> = {};
  for (const pos of POSITIONS) {
    const supply = counts[pos] ?? 0;
    scarcity[pos] = clamp(1 - supply / LEAGUE.TEAM_COUNT, 0, 1);
  }
  return scarcity;
}

export interface ValueBreakdown {
  base: number;
  upside: number;
  ageMult: number;
  /**
   * Roster-fit multiplier — what this man does to THIS club's depth chart,
   * blended from `teamNeeds` (do we have a hole) and `rosterFit` (is he
   * better than who we'd play instead). Named `fitMult` rather than
   * `needMult` because "need" was only ever half of what it now answers.
   */
  fitMult: number;
  /** What the deal does to THIS club's books — see the cap block in playerValueDetailed. 1 when no cap space was supplied. */
  capMult: number;
  contractMult: number;
  scarcityMult: number;
  noiseMult: number;
  /** The depth-chart read behind `fitMult`, or null when no roster was supplied. */
  fit: RosterFit | null;
  total: number;
  /**
   * Human-readable notes explaining the number, strongest driver first — NOT
   * insertion order. A trade screen showing "we're deep at WR" as if that
   * were why a blockbuster offer got rejected, when really the real driver
   * was a plain talent/value gap, is actively misleading. Every reason
   * carries the actual value-point swing it represents so the caller (see
   * assetValues in lib/trade.ts) can sort truth by magnitude.
   */
  reasons: { text: string; weight: number }[];
}

/** Tier curve evaluated at a given overall — pulled out so upside can reuse the exact same position-shaped curve as base, instead of a separate flat formula. */
function tierCurveValue(ovr: number, curve: { replacementLevel: number; steepness: number; scale: number; ceiling: number }): number {
  const surplus = Math.max(0, ovr - curve.replacementLevel);
  return Math.min(curve.ceiling, (Math.exp(surplus * curve.steepness) - 1) * curve.scale);
}

/**
 * What a player is worth to THIS team, in abstract "value points" comparable
 * to draft pick chart value (pickValue() below shares the same scale — a
 * mid/late Round 1 pick prices around 400-900). Used by trades and FA alike.
 * This is the detailed form — it returns WHY, not just a number, so the
 * trade screen can say something like "Chicago values your 31-year-old WR
 * less because they're rebuilding" instead of just accepting or rejecting
 * silently.
 *
 * Player QUALITY and TRADE-ASSET VALUE are not the same thing — a 99 OVR
 * punter is the best punter in football and still only a modest trade
 * asset, because the position itself has a low ceiling on how much a team
 * will pay for it. Position, age, and contract control interact with talent
 * rather than everything just multiplying one shared curve.
 */
export function playerValueDetailed(
  p: RosterPlayer,
  opts: {
    profile: GmProfile;
    needs?: Record<string, number>;
    /** 0..1 — 1 = full win-now, weights current rating over potential. */
    sharpness?: number;
    rng?: Rng;
    capMode?: CapMode;
    /** 0..1 per position — how thin the league-wide supply of good players there is. See leagueScarcity(). Omit to skip (defaults to neutral). */
    scarcity?: Record<string, number>;
    /**
     * The valuing club's whole roster, which turns on the depth-chart read:
     * where this man would actually line up and who he'd displace (or, if he
     * is already on it, who would replace him). Omit and the valuation falls
     * back to `needs` alone — which is exactly what the draft board and trade
     * retrospectives want, since neither is asking "what does he do to our
     * lineup", so neither is changed by this.
     */
    roster?: RosterPlayer[];
    /**
     * The valuing club's live cap space, in dollars. Omit to skip the cap
     * term entirely (capMult stays 1).
     */
    capSpace?: number;
  },
): ValueBreakdown {
  const { profile, needs } = opts;
  const sharpness = opts.sharpness ?? 1;
  const capMode = opts.capMode ?? 'REALISTIC';
  const reasons: { text: string; weight: number }[] = [];

  const tier = TRADE_VALUE_TIER[p.position as Position] ?? 'MID';
  const curve = TRADE_VALUE.TIER_CURVE[tier];
  const base = tierCurveValue(p.trueOvr, curve);

  if (tier === 'QB' && p.trueOvr >= 87) {
    reasons.push({ text: 'Quarterbacks at this level are extremely difficult to replace — that alone drives a huge price.', weight: base * 0.6 });
  } else if (tier === 'PREMIUM' && p.trueOvr >= 90) {
    reasons.push({ text: "He's a premium-position difference-maker — the market pays up for that.", weight: base * 0.4 });
  } else if (tier === 'MINIMAL' && p.trueOvr >= 93) {
    reasons.push({ text: `He grades as one of the best at his position, but that position carries limited trade-market value no matter how well he plays it.`, weight: base * 0.1 });
  } else if (tier === 'LOW' && p.trueOvr >= 90) {
    reasons.push({ text: `${p.position === 'RB' ? 'Running back' : 'This position'} has real value, but positional economics and the age curve cap how high it goes.`, weight: base * 0.15 });
  }

  // Potential weighting depends on whether the team is contending — reuses
  // the SAME tier curve as base (evaluated at the higher, upside-adjusted
  // overall) rather than a separate flat formula, so a QB's untapped
  // ceiling is worth far more than a kicker's in exactly the same way his
  // current level already is.
  const potentialWeight =
    AI.REBUILD_POTENTIAL_WEIGHT * (1 - profile.winNow) + AI.CONTENDER_POTENTIAL_WEIGHT * profile.winNow;
  const effectiveCeiling = p.trueOvr + Math.max(0, p.potential - p.trueOvr) * potentialWeight;
  const upside = Math.max(0, tierCurveValue(effectiveCeiling, curve) - base);
  if (upside > base * 0.15) {
    reasons.push({
      text: profile.winNow < 0.4
        ? "We're rebuilding — his upside matters more to us than his current level."
        : 'There\'s real untapped ceiling here.',
      weight: upside,
    });
  }

  // Age curve — position-specific arc (RB earliest/fastest decline, QB and
  // specialists longest). Keyed on the position's AGE_ARC, NOT on its trade
  // tier: how long a career lasts and what the position is worth are two
  // different questions, and tying them together meant re-tiering the
  // offensive line would have started ageing it like a wide receiver.
  const ageCurve = TRADE_VALUE.AGE_CURVE[TRADE_VALUE.AGE_ARC[p.position as Position] ?? 'STURDY'];
  let ageMult = 1;
  if (p.age > ageCurve.declineStart) ageMult -= (p.age - ageCurve.declineStart) * ageCurve.declinePerYear;
  else if (p.age < ageCurve.youthThreshold) ageMult += (ageCurve.youthThreshold - p.age) * ageCurve.youthPremiumPerYear;
  ageMult = clamp(ageMult, TRADE_VALUE.AGE_MULT_MIN, TRADE_VALUE.AGE_MULT_MAX);
  const ageSwing = base * Math.abs(ageMult - 1);
  if (ageMult < 0.85) {
    reasons.push({
      text: profile.winNow < 0.4
        ? `We're rebuilding, so a ${p.age}-year-old holds less value for us than the league average.`
        : `At age ${p.age}, his future value is beginning to decline — we discount it.`,
      weight: ageSwing,
    });
  } else if (ageMult > 1.1) {
    reasons.push({ text: "He's young and still ascending — that's worth a premium to us.", weight: ageSwing });
  }

  // Contract surplus: expectedMarketCost - actualControlledCost, scaled by
  // how many years of control are actually left (a one-year rental's
  // "surplus" doesn't compound the way a four-year team-friendly deal's
  // does) and clamped to a bounded range — a great contract can meaningfully
  // raise value, a bad one can meaningfully lower it, but neither can run
  // away unbounded.
  let contractMult = 1;
  if (capMode !== 'OFF' && p.contract) {
    const expectedApy = marketValue({ ovr: p.trueOvr, position: p.position as Position, age: p.age, potential: p.potential });
    const actualAnnual = remainingValue(p.contract, capMode) / Math.max(1, p.contract.yearsRemaining);
    const surplusFraction = clamp((expectedApy - actualAnnual) / Math.max(expectedApy, 1), -1.5, 1.5);
    const controlFactor = clamp(p.contract.yearsRemaining / TRADE_VALUE.CONTRACT_CONTROL_YEARS_FULL, 0.25, 1);
    contractMult = clamp(1 + surplusFraction * controlFactor * TRADE_VALUE.CONTRACT_SURPLUS_WEIGHT, TRADE_VALUE.CONTRACT_MULT_MIN, TRADE_VALUE.CONTRACT_MULT_MAX);
    const contractSwing = base * Math.abs(contractMult - 1);
    if (contractMult > 1.12) {
      reasons.push({
        text: p.contract.isRookieDeal
          ? "His rookie contract creates significant surplus value."
          : 'This contract pays well below market for his level — real surplus value.',
        weight: contractSwing,
      });
    } else if (contractMult < 0.9) {
      reasons.push({ text: 'The contract is expensive relative to expected production.', weight: contractSwing });
    }
  }

  // Roster fit — bounded on both ends (real front offices actively discount a
  // redundant asset, not just withhold a bonus; and even desperate need never
  // overrides positional economics enough to make a punter cost a premium
  // pick). Two readings of one axis, blended by taking the larger: `needs`
  // sees holes, `rosterFit` sees upgrades, and a club with nobody at a spot
  // registers on both. The BOUNDS are untouched by this change — the fix is
  // that an obvious upgrade now reaches the top of the existing range instead
  // of being pinned to the bottom of it.
  const needVal = needs?.[p.position] ?? 0;
  const fit = opts.roster ? rosterFit(p, opts.roster) : null;
  const fitVal = Math.max(needVal, fit?.score ?? 0);
  const fitMult = needs || fit
    ? TRADE_VALUE.NEED_MULT_MIN + fitVal * (TRADE_VALUE.NEED_MULT_MAX - TRADE_VALUE.NEED_MULT_MIN)
    : 1;
  const fitSwing = base * Math.abs(fitMult - 1);

  // The explanation has to read correctly from BOTH sides of a deal: the same
  // number is the price of acquiring him and the price of prising him loose,
  // and a screen that says "he'd start for us" about a man who already does
  // is explaining someone else's roster.
  // Stated in rating points over the man he displaces, not in `fit.gain`'s
  // snap-weighted units — "10 points better than the man he'd replace" is a
  // sentence a GM can check against the depth chart in front of him, and
  // "15.2" is not.
  const overIncumbent = fit ? Math.round(p.trueOvr - fit.incumbent) : 0;
  if (fit?.onRoster) {
    if (fit.starts && overIncumbent >= 3) {
      reasons.push({ text: `He starts for us at ${p.position} — replacing him from inside the building drops us ${overIncumbent} points at the spot.`, weight: fitSwing });
    } else if (!fit.starts) {
      reasons.push({ text: `He's depth for us at ${p.position}, not someone we're counting on.`, weight: fitSwing });
    }
  } else if (needVal > 0.55) {
    reasons.push({ text: `This fills a real hole for us at ${p.position}.`, weight: fitSwing });
  } else if (fit && fit.starts && overIncumbent >= 3) {
    reasons.push({
      text: fit.incumbent <= REPLACEMENT_LEVEL
        ? `He'd walk into an empty ${p.position} slot for us — we're playing nobody there.`
        : `He'd start at ${p.position} for us — ${overIncumbent} points a snap better than the man he'd replace.`,
      weight: fitSwing,
    });
  } else if (fit && !fit.starts) {
    reasons.push({ text: `He'd sit behind what we already have at ${p.position} — that's depth, not a starter, and we price it that way.`, weight: fitSwing });
  } else if (fitVal < 0.15) {
    reasons.push({ text: `We're already strong at ${p.position}, so this doesn't move the needle much.`, weight: fitSwing });
  }

  /**
   * WHAT THE DEAL DOES TO OUR BOOKS. Distinct from `contractMult` above,
   * which asks whether the contract is good VALUE in the abstract (cheap
   * relative to market). This asks whether this particular club can live with
   * it, which is a different question with a different answer for every club:
   * a $20M salary is a bargain to a team with $60M of room and an
   * impossibility to a team with $3M, at identical market value.
   *
   * Only base salary travels in a trade — the signing bonus accelerates onto
   * the club giving him up (see executeTrade / tradeCapDeltas) — so the number
   * an acquiring club's sheet has to absorb is the hit minus proration, not
   * the hit. Using the raw hit would overstate the bill on every
   * bonus-heavy contract in the league.
   *
   * And it runs the other way too: for a man already on the roster, the cap
   * he frees is a REASON TO TRADE HIM, but only for a club that is actually
   * under pressure. A club with room has no reason to shed salary, so the
   * term is inert there rather than quietly marking down every expensive
   * player in the league.
   */
  let capMult = 1;
  if (capMode !== 'OFF' && p.contract && opts.capSpace !== undefined) {
    const room = Math.max(0, opts.capSpace);
    if (fit?.onRoster) {
      const freed = capSavingsOnCut(p.contract, capMode);
      const pressure = clamp(1 - room / CAP_FIT.COMFORT_SPACE, 0, 1);
      const relief = clamp(freed / CAP_FIT.COMFORT_SPACE, 0, 1);
      capMult = 1 - pressure * relief * (1 - CAP_FIT.SHED_MULT_MIN);
      if (capMult < 0.97) {
        reasons.push({ text: `Moving his ${formatMoney(freed)} off our books is worth something on its own — we're tight against the cap.`, weight: base * (1 - capMult) });
      }
    } else {
      const added = capHit(p.contract, capMode) - (capMode === 'REALISTIC' ? proration(p.contract) : 0);
      const load = added / Math.max(room, 1);
      const strain = clamp((load - CAP_FIT.FREE_SHARE) / (CAP_FIT.FULL_SHARE - CAP_FIT.FREE_SHARE), 0, 1);
      capMult = 1 - strain * (1 - CAP_FIT.ACQUIRE_MULT_MIN);
      // Only stated once it's actually material. Every reason carries its own
      // value swing and the trade screen shows the strongest three, so a 2%
      // nudge that announces itself pushes a real driver off the list — the
      // exact "explaining a factor that isn't the reason" failure the
      // breakdown's sort order exists to prevent.
      if (capMult < 0.94) {
        reasons.push({
          text: load >= 1
            ? `We don't have the room — his ${formatMoney(added)} salary is more cap space than we have.`
            : `His ${formatMoney(added)} salary would eat ${Math.round(load * 100)}% of our cap room, and that's a real cost to us.`,
          weight: base * (1 - capMult),
        });
      }
    }
  }

  // League scarcity — modest by design (see TRADE_VALUE.SCARCITY_MULT_*).
  const scarcityVal = opts.scarcity?.[p.position];
  const scarcityMult = scarcityVal !== undefined
    ? TRADE_VALUE.SCARCITY_MULT_MIN + scarcityVal * (TRADE_VALUE.SCARCITY_MULT_MAX - TRADE_VALUE.SCARCITY_MULT_MIN)
    : 1;

  let total = (base + upside) * ageMult * contractMult * fitMult * scarcityMult * capMult;

  // Imperfect evaluation. Lower sharpness (easier difficulty) = noisier AI.
  let noiseMult = 1;
  if (opts.rng) {
    noiseMult = 1 + opts.rng.normal(0, 0.09 * (2 - sharpness));
    total *= noiseMult;
  }

  // Absolute sanity ceiling — applied to the FINAL total, after every
  // multiplier, so no stack of favorable modifiers (young + cheap + needed +
  // scarce) can push an ordinary player at a low-value position past what
  // that position can ever be worth. This is what actually guarantees "a
  // punter can never be worth a first-round pick," not just the base curve.
  total = Math.min(total, curve.ceiling);

  reasons.sort((a, b) => b.weight - a.weight);
  return { base, upside, ageMult, fitMult, capMult, contractMult, scarcityMult, noiseMult, fit, total: Math.max(1, total), reasons };
}

/** Convenience wrapper for callers that only need the number. */
export function playerValue(p: RosterPlayer, opts: Parameters<typeof playerValueDetailed>[1]): number {
  return playerValueDetailed(p, opts).total;
}

/** Value of a draft pick to this team, in the same units as playerValue. */
export function pickValue(round: number, slot: number, profile: GmProfile, year: number, currentYear: number): number {
  const overall = (round - 1) * LEAGUE.TEAM_COUNT + slot;
  // Chart value is on a 3000-point scale; scale it into playerValue units.
  // [FRAGILE PLACEHOLDER] 0.30 makes pick 1.1 ≈ a low-end star.
  const chart = PICK_VALUE_CHART(overall) * 0.30;

  // Rebuilding teams (low winNow) and pick-lovers pay a premium.
  const bias = 0.75 + profile.valuePicks * 0.5 + (1 - profile.winNow) * 0.35;

  // Future picks are discounted. [TUNE] 12% per year out.
  const yearsOut = Math.max(0, year - currentYear);
  const discount = Math.pow(0.88, yearsOut);

  return chart * bias * AI.PICK_VALUE_BIAS * discount;
}

/**
 * Whether the AI is in win-now or rebuild mode, recomputed each offseason from
 * last season's record and roster age.
 */
export function recomputeWinNow(wins: number, losses: number, avgStarterAge: number): number {
  const winPct = wins / Math.max(1, wins + losses);
  // [TUNE] 10+ wins pushes hard toward win-now; an old roster does too.
  const fromRecord = clamp((winPct - 0.4) / 0.4, 0, 1);
  const fromAge = clamp((avgStarterAge - 25) / 5, 0, 1);
  return clamp(fromRecord * 0.7 + fromAge * 0.3, 0.05, 0.95);
}

export interface PhilosophySummary {
  windowLabel: 'Rebuilding' | 'Retooling' | 'Win-Now Contender';
  tradeTendency: 'Conservative' | 'Measured' | 'Aggressive';
  pickPreference: 'Hoards picks' | 'Balanced on picks' | 'Trades picks for now';
}

/**
 * Human-readable team identity derived from the same gmProfile numbers that
 * drive every valuation. Surfaced in the trade UI so AI teams read as
 * distinct front offices instead of an invisible math function — per the
 * brief's complaint that "eventually every CPU franchise feels identical."
 */
export function philosophySummary(profile: GmProfile): PhilosophySummary {
  const windowLabel = profile.winNow >= 0.62 ? 'Win-Now Contender' : profile.winNow <= 0.38 ? 'Rebuilding' : 'Retooling';
  const tradeTendency = profile.aggression >= 0.62 ? 'Aggressive' : profile.aggression <= 0.38 ? 'Conservative' : 'Measured';
  const pickPreference = profile.valuePicks >= 0.62 ? 'Hoards picks' : profile.valuePicks <= 0.38 ? 'Trades picks for now' : 'Balanced on picks';
  return { windowLabel, tradeTendency, pickPreference };
}

/** Max APY the AI will offer a free agent. */
export function maxOffer(
  p: RosterPlayer,
  opts: { profile: GmProfile; needs: Record<string, number>; capSpace: number; rng: Rng },
): number {
  const market = marketValue({ ovr: p.trueOvr, position: p.position as Position, age: p.age, potential: p.potential });
  const need = opts.needs[p.position] ?? 0;

  // Aggression + need drive how far above market the AI will go.
  const overpay = 1 + (AI.FA_MAX_OVERPAY - 1) * (opts.profile.aggression * 0.6 + need * 0.4);
  const noise = 1 + opts.rng.normal(0, 0.08);
  const offer = market * overpay * noise;

  const usable = Math.max(0, opts.capSpace - AI.CAP_RESERVE);
  return Math.min(offer, usable);
}
