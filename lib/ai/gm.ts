import { Rng, clamp } from '../rng';
import { AI, ROSTER_TARGETS, Position, POSITIONS, PICK_VALUE_CHART, LEAGUE } from '../tuning';
import { GmProfile } from '../types';
import { marketValue } from '../cap';
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
    const qualityNeed = clamp((72 - starter) / 30, 0, 1);

    // Depth need: second body matters more at high-snap positions. Positions
    // that only ever roster one player (K, P) never carry a "backup" — that's
    // not a hole, it's the position, so skip this term entirely for them.
    const backup = group[1]?.trueOvr ?? 40;
    const depthNeed = target.max > 1 ? clamp((62 - backup) / 30, 0, 1) * 0.4 : 0;

    needs[pos] = clamp(countNeed * 1.4 + qualityNeed * 0.75 + depthNeed, 0, 1);
  }
  return needs;
}

export interface ValueBreakdown {
  base: number;
  upside: number;
  ageMult: number;
  needMult: number;
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

/**
 * What a player is worth to THIS team, in abstract "value points" comparable
 * to draft pick chart value. Used by trades and FA alike. This is the
 * detailed form — it returns WHY, not just a number, so the trade screen can
 * say something like "Chicago values your 31-year-old WR less because
 * they're rebuilding" instead of just accepting or rejecting silently.
 */
export function playerValueDetailed(
  p: RosterPlayer,
  opts: {
    profile: GmProfile;
    needs?: Record<string, number>;
    /** 0..1 — 1 = full win-now, weights current rating over potential. */
    sharpness?: number;
    rng?: Rng;
  },
): ValueBreakdown {
  const { profile, needs } = opts;
  const sharpness = opts.sharpness ?? 1;
  const reasons: { text: string; weight: number }[] = [];

  // Base: exponential in overall so stars are worth far more than starters,
  // but gently enough that a great player reads as "worth several good
  // players," not 40-80x one — the previous curve made trade ratios feel
  // arbitrary since one asset would either trivially dominate or be
  // worthless regardless of everything else in the deal.
  // [FRAGILE PLACEHOLDER] tuned so a 90 OVR ~= a mid-first-round pick.
  const base = Math.pow(1.075, p.trueOvr - 55) * 22;
  if (p.trueOvr >= 90) {
    reasons.push({ text: 'He grades as one of the best players in the league — that alone drives a huge price.', weight: base * 0.6 });
  } else if (p.trueOvr >= 82) {
    reasons.push({ text: "He's a real difference-maker at his position.", weight: base * 0.3 });
  }

  // Potential weighting depends on whether the team is contending.
  const potentialWeight =
    AI.REBUILD_POTENTIAL_WEIGHT * (1 - profile.winNow) + AI.CONTENDER_POTENTIAL_WEIGHT * profile.winNow;
  const upside = Math.max(0, p.potential - p.trueOvr) * potentialWeight * 4;
  if (upside > base * 0.15) {
    reasons.push({
      text: profile.winNow < 0.4
        ? "We're rebuilding — his upside matters more to us than his current level."
        : 'There\'s real untapped ceiling here.',
      weight: upside,
    });
  }

  // Age curve: a 32-year-old at the same rating is worth much less.
  // [TUNE] value falls ~8%/yr past 28, rises slightly for under-25s.
  let ageMult = 1;
  if (p.age > 28) ageMult -= (p.age - 28) * 0.09;
  else if (p.age < 25) ageMult += (25 - p.age) * 0.04;
  ageMult = clamp(ageMult, 0.25, 1.3);
  const ageSwing = base * Math.abs(ageMult - 1);
  if (ageMult < 0.85) {
    reasons.push({
      text: profile.winNow < 0.4
        ? `We're rebuilding, so a ${p.age}-year-old holds less value for us than the league average.`
        : `At ${p.age}, there isn't much term left on this — we discount it.`,
      weight: ageSwing,
    });
  } else if (ageMult > 1.1) {
    reasons.push({ text: "He's young and still ascending — that's worth a premium to us.", weight: ageSwing });
  }

  const needVal = needs?.[p.position] ?? 0;
  const needMult = needs ? 1 + needVal * (AI.NEED_MULT - 1) : 1;
  const needSwing = base * (needMult - 1);
  if (needVal > 0.5) {
    reasons.push({ text: `This fills a real hole for us at ${p.position}.`, weight: needSwing });
  } else if (needs && needVal < 0.1) {
    // Genuinely low-impact by construction (needMult never drops below 1 —
    // lack of need can't devalue a player, only failing to bonus him), so
    // this gets a token weight and will only surface when nothing else
    // about the player is remarkable enough to say more.
    reasons.push({ text: `We're already deep at ${p.position}, so this doesn't move the needle much.`, weight: 0.5 });
  }

  let total = (base + upside) * ageMult * needMult;

  // Imperfect evaluation. Lower sharpness (easier difficulty) = noisier AI.
  let noiseMult = 1;
  if (opts.rng) {
    noiseMult = 1 + opts.rng.normal(0, 0.09 * (2 - sharpness));
    total *= noiseMult;
  }
  reasons.sort((a, b) => b.weight - a.weight);
  return { base, upside, ageMult, needMult, noiseMult, total: Math.max(1, total), reasons };
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
