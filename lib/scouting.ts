import { Rng, clamp } from './rng';
import { SCOUTING } from './tuning';
import type { Position } from './tuning';
import { ATTRIBUTE_BY_KEY, AttrMap, attrsForPosition, computeOverall } from './ratings';
import { readJson } from './json';
import { LeagueSettings, DIFFICULTY_MODS } from './settings';
import type { DynastyScoutMods } from './dynasty';

/**
 * ===========================================================================
 * SCOUTING / FOG OF WAR (design doc section 6)
 * ===========================================================================
 * The user never sees a player's true attribute. They see:
 *   - an OBSERVED value: truth + noise, where noise shrinks as confidence rises
 *   - a RANGE around it: observed +/- error(confidence, attribute difficulty)
 *
 * Two separate things are modeled deliberately:
 *   1. Bias  — your observation may be centered wrong (you think he's a 78; he's a 71)
 *   2. Spread— how wide a range you're willing to quote
 * Both shrink with confidence, but bias never fully disappears at low
 * confidence, which is what makes draft busts possible.
 *
 * Attributes carry a scoutDifficulty (ratings.ts). A 4.4 forty is measurable;
 * "decision making" is not. So physical attributes converge fast and mental
 * ones stay foggy — that's the whole texture of the system.
 *
 * DYNASTY SKILLS (lib/dynasty.ts) plug in HERE and nowhere else. They pass an
 * optional `dynasty` bundle of multipliers that shrink the half-width of the
 * range this file already computes. They do not add a second ratings system,
 * do not touch confidence, and do not change the observation the report
 * stored — a better GM quotes a tighter range around the same read. Omitting
 * the argument reproduces today's numbers exactly, which is why every call
 * site that has not been taught about Dynasty still behaves correctly.
 *
 * The one sanctioned hole in the fog is ScoutingReport.fullyRevealed, set
 * only by the Dynasty "Full Scout" ability. That collapses a player to his
 * true ratings. NOTHING ELSE MAY DO THAT: for every other player, at every
 * confidence level and every skill rank, potential comes back as a genuine
 * range (see DYNASTY.MIN_BAND_HALF_WIDTH, the floor that guarantees it).
 * ===========================================================================
 */

export interface ScoutedAttr {
  key: string;
  label: string;
  observed: number;
  low: number;
  high: number;
  /** 0..1 — how tight this specific attribute is known. */
  certainty: number;
  /** Present only when the settings reveal truth (debug / scouting off), or when a Full Evaluation locked this one attribute. */
  actual?: number;
  /** True when an evaluation pinned this attribute to its true value. */
  locked?: boolean;
}

export interface ScoutedPlayerView {
  scoutedOvr: number;
  ovrLow: number;
  ovrHigh: number;
  /** Potential is the hardest thing to scout — this is always a range, never a raw "?", even fully unscouted. */
  potLow: number;
  potHigh: number;
  confidence: number;
  attrs: ScoutedAttr[];
  /** True when the numbers shown ARE the true values. */
  revealed: boolean;
  /** Scout's plain-language read. */
  notes: string;
}

/** Half-width of the displayed range for one attribute. */
export function errorBand(confidence: number, difficulty: number, extraPenalty = 0): number {
  const t = clamp(confidence / 100, 0, 1);
  // Difficulty widens the band and slows convergence. [TUNE]
  const max = SCOUTING.MAX_ERROR * (0.55 + difficulty);
  const min = SCOUTING.MIN_ERROR * (0.5 + difficulty);
  // Quadratic-ish convergence: the first 30 confidence buys the most clarity.
  return Math.max(0.5, (max - (max - min) * Math.pow(t, 0.65)) + extraPenalty);
}

/** SD of the observation error (how wrong your center point can be). */
export function observationSd(confidence: number, difficulty: number): number {
  const t = clamp(confidence / 100, 0, 1);
  const max = SCOUTING.OBSERVE_SD_MAX * (0.5 + difficulty);
  const min = SCOUTING.OBSERVE_SD_MIN * (0.5 + difficulty);
  return max - (max - min) * Math.pow(t, 0.7);
}

/**
 * Produce (or refresh) the noisy observations for a player at a confidence
 * level. Called when a report is created and every time confidence increases,
 * so a scouted player's numbers visibly drift toward truth as you invest.
 */
/** Synthetic AttrMap key holding the observed center for potential — not a real attribute, never rendered in the attribute list. */
const POTENTIAL_OBS_KEY = '_POTENTIAL';

export function observe(
  rng: Rng,
  position: Position,
  trueAttrs: AttrMap,
  confidence: number,
  scoutAccuracy = 50,
  specialtyBonus = 0,
  truePotential?: number,
): AttrMap {
  const out: AttrMap = {};
  // A better scout effectively raises confidence for observation purposes.
  const effective = clamp(confidence + (scoutAccuracy - 50) * 0.25 + specialtyBonus * 100, 0, 100);
  for (const key of attrsForPosition(position)) {
    const def = ATTRIBUTE_BY_KEY[key];
    const sd = observationSd(effective, def?.scoutDifficulty ?? 0.5);
    out[key] = clamp(Math.round(rng.normal(trueAttrs[key] ?? 50, sd)), 20, 99);
  }
  if (truePotential !== undefined) {
    const sd = observationSd(effective, SCOUTING.POTENTIAL_DIFFICULTY);
    out[POTENTIAL_OBS_KEY] = clamp(Math.round(rng.normal(truePotential, sd)), 40, 99);
  }
  return out;
}

/**
 * Build the view the UI renders. This is the ONE place that decides what the
 * user is allowed to see about a player.
 */
export function buildScoutedView(args: {
  position: Position;
  trueAttrs: AttrMap;
  trueOvr: number;
  /** True potential ceiling. Never returned directly when fogged — only feeds the scouted range's center via the report's stored observation. */
  potential: number;
  report?: {
    confidence: number;
    observed: string;
    notes?: string;
    /** Potential's own confidence track — only Deep Dives push it above `confidence`. */
    potConfidence?: number | null;
    /** JSON array of attribute keys an evaluation locked to their true value. */
    attrsRevealed?: string | null;
    /** Set only by Dynasty's Full Scout — the player's file is complete and exact. */
    fullyRevealed?: boolean | null;
  } | null;
  settings: LeagueSettings;
  /** True for players on the viewing team (they get a confidence floor). */
  isOwnRoster?: boolean;
  isUserView?: boolean;
  /**
   * Dynasty GM skill effects (lib/dynasty.ts scoutingModsFor). Optional on
   * purpose: undefined means "no skills", which is byte-identical to the
   * pre-Dynasty behaviour.
   */
  dynasty?: DynastyScoutMods;
}): ScoutedPlayerView {
  const { position, trueAttrs, trueOvr, settings } = args;

  const fullScouted = args.report?.fullyRevealed === true;
  const fullyRevealed =
    fullScouted ||
    settings.revealTrueRatings ||
    !settings.scoutingEnabled ||
    (args.isOwnRoster && !settings.fogOnOwnRoster);

  if (fullyRevealed) {
    return {
      scoutedOvr: trueOvr,
      ovrLow: trueOvr,
      ovrHigh: trueOvr,
      potLow: args.potential,
      potHigh: args.potential,
      confidence: 100,
      revealed: true,
      notes: fullScouted
        ? 'Full Scout: your staff dropped everything and put a complete, exact file together on this player.'
        : 'Full ratings visible (scouting fog disabled for this player).',
      attrs: attrsForPosition(position).map((key) => ({
        key,
        label: ATTRIBUTE_BY_KEY[key]?.label ?? key,
        observed: trueAttrs[key] ?? 50,
        low: trueAttrs[key] ?? 50,
        high: trueAttrs[key] ?? 50,
        certainty: 1,
        actual: trueAttrs[key],
      })),
    };
  }

  const confidence = args.report?.confidence ?? SCOUTING.ROOKIE_BASE_CONFIDENCE;
  const observed = readJson<AttrMap>(args.report?.observed ?? null, {});
  const penalty = args.isUserView ? DIFFICULTY_MODS[settings.difficulty].userScoutPenalty : 0;

  // Attributes a Full Evaluation / Deep Dive locked in. Those stop being a
  // range at all — you sent people to measure it and now you know.
  const locked = new Set(readJson<string[]>(args.report?.attrsRevealed ?? null, []));

  // Dynasty range multipliers. Applied to the half-width AFTER errorBand has
  // done its confidence/difficulty work, then floored so a range can never
  // collapse to a point no matter how many ranks are bought.
  const attrMult = args.dynasty?.attrBandMult ?? 1;
  const potMult = args.dynasty?.potBandMult ?? 1;
  const hardMult = args.dynasty?.hardAttrBandMult ?? 1;
  const hardDiff = args.dynasty?.hardAttrDifficulty ?? Infinity;
  const minHalf = args.dynasty?.minHalfWidth ?? 0.5;
  const tighten = (band: number, mult: number) => Math.max(minHalf, band * mult);

  const attrs: ScoutedAttr[] = attrsForPosition(position).map((key) => {
    const def = ATTRIBUTE_BY_KEY[key];
    const diff = def?.scoutDifficulty ?? 0.5;
    if (locked.has(key)) {
      const truth = clamp(Math.round(trueAttrs[key] ?? 62), 20, 99);
      return { key, label: def?.label ?? key, observed: truth, low: truth, high: truth, certainty: 1, actual: truth, locked: true };
    }
    // Film Room stacks on top of Better Evaluations, but only for the traits
    // the base model calls hard to scout — instincts and awareness, not a
    // stopwatch time.
    const mult = attrMult * (diff >= hardDiff ? hardMult : 1);
    const band = tighten(errorBand(confidence, diff, penalty), mult);
    // If we have no observation yet, fall back to a blurred league-average read
    // rather than leaking the true value.
    const center = observed[key] ?? 62;
    return {
      key,
      label: def?.label ?? key,
      observed: Math.round(center),
      low: clamp(Math.round(center - band), 20, 99),
      high: clamp(Math.round(center + band), 20, 99),
      certainty: clamp(confidence / 100, 0, 1),
    };
  });

  const centerMap: AttrMap = Object.fromEntries(attrs.map((a) => [a.key, a.observed]));
  const lowMap: AttrMap = Object.fromEntries(attrs.map((a) => [a.key, a.low]));
  const highMap: AttrMap = Object.fromEntries(attrs.map((a) => [a.key, a.high]));

  // Potential is always a range, never a bare "?" — it just starts very wide
  // (potential is inherently the hardest thing to project) and narrows the
  // same way every other scouted number does as confidence rises.
  // Potential rides the general read unless a Deep Dive bought it a tighter
  // one of its own. Never collapses to a point: errorBand's floor plus
  // POTENTIAL_DIFFICULTY keeps a several-point spread even at 99 confidence.
  const potConfidence = Math.max(confidence, args.report?.potConfidence ?? 0);
  const potBand = tighten(errorBand(potConfidence, SCOUTING.POTENTIAL_DIFFICULTY, penalty), potMult);
  const potCenter = observed[POTENTIAL_OBS_KEY] ?? SCOUTING.POTENTIAL_DEFAULT_CENTER;

  return {
    scoutedOvr: computeOverall(position, centerMap),
    ovrLow: computeOverall(position, lowMap),
    ovrHigh: computeOverall(position, highMap),
    potLow: clamp(Math.round(potCenter - potBand), 40, 99),
    potHigh: clamp(Math.round(potCenter + potBand), 40, 99),
    confidence,
    revealed: false,
    attrs,
    notes: args.report?.notes || scoutNote(confidence),
  };
}

/** [PLACEHOLDER copy] Confidence-tiered scout language. */
export function scoutNote(confidence: number): string {
  if (confidence >= 85) return 'We have a complete book on this player. Very little left to learn.';
  if (confidence >= 65) return 'Solid file. We know what he is; the ceiling is still an open question.';
  if (confidence >= 40) return 'Partial evaluation. Flashes on tape, but the sample is thin.';
  if (confidence >= 20) return 'Early look only. Treat these numbers as a rough sketch.';
  return 'Essentially unscouted. Anything we say right now is a guess.';
}

/*
 * There is no longer a point -> confidence conversion or a weekly budget to
 * convert. Confidence moves through observe() from exactly two places now:
 * lib/shortlistAttention.ts, once a week, for whoever the GM has starred, and
 * lib/workouts.ts, when one of the year's handful of slots is spent.
 */
