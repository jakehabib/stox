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
 * true ratings. NOTHING ELSE MAY DO THAT: for every fogged player, at every
 * confidence level and every skill rank, potential comes back as a genuine
 * range (see DYNASTY.MIN_BAND_HALF_WIDTH, the floor that guarantees it).
 *
 * ---------------------------------------------------------------------------
 * SCOPE: FOG APPLIES TO DRAFT PROSPECTS ONLY.  <-- deliberate, not a regression
 * ---------------------------------------------------------------------------
 * Fog is a COST. It is paid on every screen it touches, in readability: a
 * column of "71-79" is harder to read, sort and trust than a column of
 * numbers. It only earns that cost where "we didn't know" is a real football
 * story — and that is the draft, and only the draft. A free agent with five
 * seasons of production behind him is not a mystery; you can watch the tape.
 * Your own left tackle is not a mystery to you at all. Uncertainty about men
 * who have never played a professional down IS the drama; uncertainty about
 * men whose careers are on film is just a worse spreadsheet.
 *
 * So `isProspect` gates the whole system, and it DEFAULTS TO FALSE. A call
 * site that says nothing gets true ratings. The draft-facing call sites pass
 * `isProspect: player.isDraftee` and keep every range they had.
 *
 * THE THREE TIERS, in full. Potential is the one thing that is not simply
 * on or off, because a ceiling is a forecast even for a man with tape:
 *
 *   YOUR OWN ROSTER   current: exact   potential: exact
 *   OTHER PROS        current: exact   potential: +/-5, flat and permanent
 *   DRAFT PROSPECTS   current: fogged  potential: fogged, narrows with work
 *
 * The middle row is the app owner's, verbatim: *"Exact for your current team
 * members, +/- 5 point ranges for other pros not on your team and we just
 * leave it at that."* Read the last clause literally — POT_FLAT_HALF_BAND
 * does not move with confidence, with a scouting report, with a Dynasty rank
 * or with the calendar. It is not fog; it is the honest statement that you
 * know your own players' ceilings because you coach them every day and you do
 * not know another club's because you do not. Threading confidence into it
 * would be re-introducing exactly the machinery this change removed.
 *
 * The machinery below is untouched and still exact — this is one boolean at
 * the top of one function, so pointing it at another surface later is a
 * one-line change rather than an archaeology project.
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
  /**
   * True when the ATTRIBUTES and OVR shown are the true values. Says nothing
   * about potential — an established pro on another roster is `revealed` and
   * still carries a potential band. Read `potentialRevealed` for that.
   */
  revealed: boolean;
  /**
   * True only when potLow === potHigh === his real ceiling. That is your own
   * roster, a Full Scout, or a league with the fog switched off — nothing
   * else. Every potential-rendering site branches on THIS, not on `revealed`;
   * using `revealed` there is what would print another club's exact ceiling.
   */
  potentialRevealed: boolean;
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
 * [TUNE] Half-width of the flat potential band shown for an established
 * professional who is not on your roster. Ten points wide, always.
 */
export const POT_FLAT_HALF_BAND = 5;
/** The scale a displayed potential band is allowed to live on. */
const POT_SCALE_MIN = 40;
const POT_SCALE_MAX = 99;

/**
 * The +/-5 band for another club's player, made boundary-safe.
 *
 * The naive `[p-5, p+5]` clamped to the scale LEAKS at both ends: a ceiling of
 * 99 would render 94-99, and a six-point band where every other player shows
 * ten tells the reader he is at the very top — the one thing the band exists
 * to avoid saying. So the window SHIFTS instead of truncating. Its width is
 * constant at 2 * POT_FLAT_HALF_BAND, and near the ends several different
 * ceilings map to the same band (a 94 and a 99 both read 89-99), which is
 * strictly more ambiguity than the middle of the scale, never less.
 */
export function flatPotentialBand(potential: number, currentOvr?: number): { low: number; high: number } {
  const width = POT_FLAT_HALF_BAND * 2;
  const truth = clamp(Math.round(potential), POT_SCALE_MIN, POT_SCALE_MAX);
  const low = clamp(truth - POT_FLAT_HALF_BAND, POT_SCALE_MIN, POT_SCALE_MAX - width);

  /*
   * A CEILING CANNOT SIT BELOW WHERE THE MAN ALREADY IS.
   *
   * The app owner, looking at a 94-rated free agent quoted "POTENTIAL 89-99":
   * *"see how the potential is lower than his current overall, is that
   * intentional?"* It was not. The band was centred on his true ceiling and
   * clamped only to the rating scale, never against his own current overall —
   * so a man whose ceiling IS 94 was shown a range that opens five points
   * below the 94 printed directly above it. Two numbers on one card, one of
   * them impossible.
   *
   * Flooring at his current overall is not a cosmetic tidy-up, it is the
   * honest read: you are looking at an exact, revealed rating (this branch
   * only runs for a player whose overall is fully known), so whatever you do
   * not know about his ceiling is entirely on the upside. The band narrows
   * rather than shifting up, because that is what the extra knowledge really
   * buys — and at the top of the scale there is nowhere to shift to anyway.
   *
   * `currentOvr` is optional so the one prospect-side caller, where the
   * overall is itself a fogged range and cannot floor anything, is unaffected.
   */
  if (currentOvr == null) return { low, high: low + width };
  const floor = clamp(Math.round(currentOvr), POT_SCALE_MIN, POT_SCALE_MAX);
  const flooredLow = Math.max(low, floor);
  return { low: flooredLow, high: Math.max(flooredLow, low + width) };
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
  /**
   * THE SCOPE GATE. True only for a draft prospect (Player.isDraftee).
   *
   * Defaults to false, which returns the player's TRUE ratings — established
   * professionals are not fogged anywhere in this game (see the SCOPE block at
   * the top of this file). This is a deliberate design decision, not an
   * oversight: do not "fix" a screen that stopped showing ranges by flipping
   * this on for it.
   */
  isProspect?: boolean;
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
  // `!args.isProspect` is the scope gate, and it sits FIRST because it is the
  // cheapest and the most common answer: almost everybody this function is
  // asked about is an established pro, and established pros are never fogged.
  const notAProspect = !args.isProspect;
  const fullyRevealed =
    fullScouted ||
    notAProspect ||
    settings.revealTrueRatings ||
    !settings.scoutingEnabled ||
    (args.isOwnRoster && !settings.fogOnOwnRoster);

  if (fullyRevealed) {
    // POTENTIAL IS THE ONE THING STILL WITHHELD FROM A REVEALED PLAYER.
    // You know your own men's ceilings — you coach them. A rival's ceiling is
    // a forecast you are not in the building for, so it comes back as a flat
    // ten-point band. Own roster, a Full Scout, or fog switched off league-
    // wide are the three ways to see it exactly.
    const ownCeiling =
      fullScouted || settings.revealTrueRatings || !settings.scoutingEnabled || args.isOwnRoster === true;
    // Still a range in the degenerate case rather than a second return shape:
    // the invariant every caller relies on is "potLow/potHigh always exist",
    // and it has been broken twice by code paths that returned something else.
    const pot = ownCeiling
      ? { low: args.potential, high: args.potential }
      : flatPotentialBand(args.potential, trueOvr);
    return {
      scoutedOvr: trueOvr,
      ovrLow: trueOvr,
      ovrHigh: trueOvr,
      potLow: pot.low,
      potHigh: pot.high,
      confidence: 100,
      revealed: true,
      potentialRevealed: ownCeiling,
      notes: fullScouted
        ? 'Full Scout: your staff dropped everything and put a complete, exact file together on this player.'
        : notAProspect
          // He has played. There is film, there are snap counts, there are
          // five years of Sundays — nobody in this building is guessing.
          ? 'Established professional — his tape and his production speak for themselves. No projection required.'
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
      const truth = clamp(Math.round(trueAttrs[key] ?? 68), 20, 99);
      return { key, label: def?.label ?? key, observed: truth, low: truth, high: truth, certainty: 1, actual: truth, locked: true };
    }
    // Film Room stacks on top of Better Evaluations, but only for the traits
    // the base model calls hard to scout — instincts and awareness, not a
    // stopwatch time.
    const mult = attrMult * (diff >= hardDiff ? hardMult : 1);
    const band = tighten(errorBand(confidence, diff, penalty), mult);
    // If we have no observation yet, fall back to a blurred league-average read
    // rather than leaking the true value.
    const center = observed[key] ?? 68;
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
    potLow: clamp(Math.round(potCenter - potBand), POT_SCALE_MIN, POT_SCALE_MAX),
    potHigh: clamp(Math.round(potCenter + potBand), POT_SCALE_MIN, POT_SCALE_MAX),
    confidence,
    revealed: false,
    // A prospect's ceiling is the hardest number in the game to know and is
    // never exact — not at 99 confidence, not with every Dynasty rank bought.
    // Only Full Scout collapses it, and that takes the branch above.
    potentialRevealed: false,
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
