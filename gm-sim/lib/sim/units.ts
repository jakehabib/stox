import {
  SIM, OFFENSE_UNIT_WEIGHTS, DEFENSE_UNIT_WEIGHTS, UNIT_DEPTH_WEIGHTS,
  SCHEME_EMPHASIS, Position,
} from '../tuning';
import { readJson } from '../json';
import { AttrMap } from '../ratings';
import { clamp } from '../rng';

export interface SimPlayer {
  id: string;
  firstName: string;
  lastName: string;
  position: string;
  trueOvr: number;
  trueAttrs: string;
  status: string;
  injuryWeeks: number;
  fatigue: number;
}

export interface SimStaff {
  role: string;
  playCalling: number;
  rating: number;
  scheme: string;
}

export interface UnitRatings {
  off: number;
  def: number;
  special: number;
  byPosition: Record<string, number>;
  /** Who is actually on the field, in depth order, per position. */
  depth: Record<string, SimPlayer[]>;
  schemeFitOff: number;
  schemeFitDef: number;
}

export function isAvailable(p: SimPlayer): boolean {
  return p.status !== 'RETIRED' && p.injuryWeeks <= 0;
}

/** Effective rating after fatigue. [TUNE] fatigue costs up to ~4 rating points. */
export function effectiveRating(p: SimPlayer): number {
  const fatiguePenalty = (p.fatigue / 100) * 4;
  return Math.max(20, p.trueOvr - fatiguePenalty);
}

/**
 * Weighted positional unit rating: the starter carries most of the weight, but
 * depth matters (see UNIT_DEPTH_WEIGHTS). If a team is short-handed at a
 * position, the missing slots are filled with a replacement-level value so a
 * roster hole actually hurts.
 */
const REPLACEMENT_LEVEL = 48; // [TUNE] rating of "guy off the street"

export function positionUnitRating(players: SimPlayer[], position: Position): number {
  const weights = UNIT_DEPTH_WEIGHTS[position] ?? [1];
  const sorted = [...players].sort((a, b) => effectiveRating(b) - effectiveRating(a));
  let sum = 0;
  let wTotal = 0;
  for (let i = 0; i < weights.length; i++) {
    const rating = sorted[i] ? effectiveRating(sorted[i]) : REPLACEMENT_LEVEL;
    sum += rating * weights[i];
    wTotal += weights[i];
  }
  return wTotal > 0 ? sum / wTotal : REPLACEMENT_LEVEL;
}

/** 0..1 measure of how well the roster matches the chosen scheme. */
export function schemeFit(depth: Record<string, SimPlayer[]>, scheme: string): number {
  const emphasis = SCHEME_EMPHASIS[scheme] ?? [];
  if (emphasis.length === 0) return 0.5; // Balanced schemes are never a bad fit.
  let total = 0;
  for (const e of emphasis) {
    const starter = depth[e.pos]?.[0];
    if (!starter) { total += 0.35; continue; }
    const attrs = readJson<AttrMap>(starter.trueAttrs, {});
    const v = attrs[e.attr] ?? 60;
    // 60 is a neutral fit, 90 is a perfect fit. [TUNE]
    total += clamp((v - 55) / 35, 0, 1);
  }
  return total / emphasis.length;
}

export function computeUnits(
  players: SimPlayer[],
  staff: SimStaff[],
  offScheme: string,
  defScheme: string,
  /**
   * User-set depth chart: position -> ordered player ids. Any player not named
   * in the override falls in behind, sorted by rating. Injured players are
   * skipped regardless of where the chart puts them.
   */
  depthOrder?: Record<string, string[]>,
): UnitRatings {
  const available = players.filter(isAvailable);
  const depth: Record<string, SimPlayer[]> = {};
  for (const p of available) {
    (depth[p.position] ??= []).push(p);
  }
  for (const key of Object.keys(depth)) {
    const override = depthOrder?.[key];
    if (override && override.length > 0) {
      const rank = new Map(override.map((id, i) => [id, i]));
      depth[key].sort((a, b) => {
        const ra = rank.has(a.id) ? rank.get(a.id)! : 1000 + (99 - effectiveRating(a));
        const rb = rank.has(b.id) ? rank.get(b.id)! : 1000 + (99 - effectiveRating(b));
        return ra - rb;
      });
    } else {
      depth[key].sort((a, b) => effectiveRating(b) - effectiveRating(a));
    }
  }

  const byPosition: Record<string, number> = {};
  for (const pos of Object.keys({ ...OFFENSE_UNIT_WEIGHTS, ...DEFENSE_UNIT_WEIGHTS, K: 1, P: 1 })) {
    byPosition[pos] = positionUnitRating(depth[pos] ?? [], pos as Position);
  }

  const weightedSum = (weights: Partial<Record<Position, number>>) => {
    let sum = 0;
    let wTotal = 0;
    for (const [pos, w] of Object.entries(weights)) {
      sum += (byPosition[pos] ?? REPLACEMENT_LEVEL) * (w as number);
      wTotal += w as number;
    }
    return wTotal > 0 ? sum / wTotal : REPLACEMENT_LEVEL;
  };

  const oc = staff.find((s) => s.role === 'OC');
  const dc = staff.find((s) => s.role === 'DC');
  const hc = staff.find((s) => s.role === 'HC');

  // Coordinator contribution: play-calling above/below the 50 baseline, plus a
  // smaller head-coach term applied to both sides of the ball. [TUNE]
  const coordBonus = (s?: SimStaff) => (s ? ((s.playCalling - 50) / 10) * SIM.COORD_WEIGHT : 0);
  const hcBonus = hc ? ((hc.rating - 50) / 10) * SIM.COORD_WEIGHT * 0.5 : 0;

  const fitOff = schemeFit(depth, offScheme);
  const fitDef = schemeFit(depth, defScheme);

  return {
    off: weightedSum(OFFENSE_UNIT_WEIGHTS) + coordBonus(oc) + hcBonus + (fitOff - 0.5) * 2 * SIM.SCHEME_FIT_MAX,
    def: weightedSum(DEFENSE_UNIT_WEIGHTS) + coordBonus(dc) + hcBonus + (fitDef - 0.5) * 2 * SIM.SCHEME_FIT_MAX,
    special: (byPosition.K ?? REPLACEMENT_LEVEL) * 0.6 + (byPosition.P ?? REPLACEMENT_LEVEL) * 0.4,
    byPosition,
    depth,
    schemeFitOff: fitOff,
    schemeFitDef: fitDef,
  };
}
