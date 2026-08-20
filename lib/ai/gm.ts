import { Rng, clamp } from '../rng';
import { AI, ROSTER_TARGETS, ROSTER_NEED_QUALITY_WEIGHT, Position, POSITIONS, PICK_VALUE_CHART, LEAGUE, TRADE_VALUE, TRADE_VALUE_TIER } from '../tuning';
import { GmProfile } from '../types';
import { marketValue, remainingValue, ContractLike } from '../cap';
import { CapMode } from '../types';
import { readJson } from '../json';

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
export function needSeverity(score: number): { label: string; className: string } {
  if (score >= 0.6) return { label: 'Urgent', className: 'text-bad' };
  if (score >= 0.35) return { label: 'High', className: 'text-warn' };
  if (score >= 0.15) return { label: 'Moderate', className: 'text-warn' };
  return { label: 'Notable', className: 'text-muted' };
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
  needMult: number;
  contractMult: number;
  scarcityMult: number;
  noiseMult: number;
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
  },
): ValueBreakdown {
  const { profile, needs } = opts;
  const sharpness = opts.sharpness ?? 1;
  const capMode = opts.capMode ?? 'REALISTIC';
  const reasons: { text: string; weight: number }[] = [];

  const tier = TRADE_VALUE_TIER[p.position as Position] ?? 'MID';
  const curve = TRADE_VALUE.TIER_CURVE[tier];
  const base = tierCurveValue(p.trueOvr, curve);

  if (tier === 'QB' && p.trueOvr >= 82) {
    reasons.push({ text: 'Quarterbacks at this level are extremely difficult to replace — that alone drives a huge price.', weight: base * 0.6 });
  } else if (tier === 'PREMIUM' && p.trueOvr >= 85) {
    reasons.push({ text: "He's a premium-position difference-maker — the market pays up for that.", weight: base * 0.4 });
  } else if (tier === 'MINIMAL' && p.trueOvr >= 88) {
    reasons.push({ text: `He grades as one of the best at his position, but that position carries limited trade-market value no matter how well he plays it.`, weight: base * 0.1 });
  } else if (tier === 'LOW' && p.trueOvr >= 85) {
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

  // Age curve — position-specific arc (RB earliest/fastest decline, OL/QB
  // longest, K/P barely age at all).
  const ageCurve = TRADE_VALUE.AGE_CURVE[tier];
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

  // Team-need multiplier — bounded on both ends (real front offices actively
  // discount a redundant asset, not just withhold a bonus; and even
  // desperate need never overrides positional economics enough to make a
  // punter cost a premium pick).
  const needVal = needs?.[p.position] ?? 0;
  const needMult = needs
    ? TRADE_VALUE.NEED_MULT_MIN + needVal * (TRADE_VALUE.NEED_MULT_MAX - TRADE_VALUE.NEED_MULT_MIN)
    : 1;
  const needSwing = base * Math.abs(needMult - 1);
  if (needVal > 0.55) {
    reasons.push({ text: `This fills a real hole for us at ${p.position}.`, weight: needSwing });
  } else if (needs && needVal < 0.15) {
    reasons.push({ text: `We're already strong at ${p.position}, so this doesn't move the needle much.`, weight: needSwing });
  }

  // League scarcity — modest by design (see TRADE_VALUE.SCARCITY_MULT_*).
  const scarcityVal = opts.scarcity?.[p.position];
  const scarcityMult = scarcityVal !== undefined
    ? TRADE_VALUE.SCARCITY_MULT_MIN + scarcityVal * (TRADE_VALUE.SCARCITY_MULT_MAX - TRADE_VALUE.SCARCITY_MULT_MIN)
    : 1;

  let total = (base + upside) * ageMult * contractMult * needMult * scarcityMult;

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
  return { base, upside, ageMult, needMult, contractMult, scarcityMult, noiseMult, total: Math.max(1, total), reasons };
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
