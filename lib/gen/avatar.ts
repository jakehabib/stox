import { Rng } from '../rng';

/**
 * ===========================================================================
 * PROCEDURAL PLAYER AVATARS
 * ===========================================================================
 * Every player gets a deterministic cartoon face — same layered-feature idea
 * as a Bitmoji/Memoji generator, built from flat SVG shapes so no image
 * assets or AI-generated art are needed. "Deterministic" is the whole trick:
 * we never store these params. AvatarParams are re-derived on every render
 * from `seed` (the player's id), so the exact same face comes back every
 * time with zero schema/migration footprint — and it works retroactively for
 * every player already sitting in an existing league.
 *
 * It takes a body as well as a seed. `age` greys the hair and thins the
 * hairline; `weightLb`/`heightIn`/`position` set the proportions the face is
 * drawn at — shoulder span, neck, jaw. None of it is stored either, and all
 * of it is optional: with no body at all the numbers land on the neutral build
 * the portrait has always been drawn at, so an old call site is unchanged.
 * ===========================================================================
 */

export type HairStyle =
  | 'bald' | 'buzz' | 'short' | 'part' | 'medium' | 'curly' | 'mohawk' | 'long'
  | 'ponytail' | 'flattop' | 'dreads';
export type EyeStyle = 'round' | 'narrow' | 'wide' | 'sleepy';
export type EyebrowStyle = 'straight' | 'angled' | 'raised';
export type NoseStyle = 'small' | 'medium' | 'wide';
export type MouthStyle = 'neutral' | 'smile' | 'smirk' | 'frown';
export type FacialHair = 'none' | 'stubble' | 'mustache' | 'goatee' | 'beard';
export type FaceShape = 'round' | 'oval' | 'square';

export interface AvatarParams {
  skinTone: string;
  hairStyle: HairStyle;
  hairColor: string;
  faceShape: FaceShape;
  eyeStyle: EyeStyle;
  eyebrowStyle: EyebrowStyle;
  noseStyle: NoseStyle;
  mouthStyle: MouthStyle;
  facialHair: FacialHair;
  /**
   * 0-1 bulk, from weight measured against the player's own positional norm
   * blended with his absolute weight. Drives shoulder span, neck width, jaw
   * width and cheek fullness — the silhouette, never a facial feature.
   * `NEUTRAL_MASS` (0.45) is the build the portrait was always drawn at.
   */
  mass: number;
  /** -1 short .. +1 tall for his position. Deliberately a whisper next to mass. */
  frame: number;
  /** 0-1 hairline recession, rising from ~28 and only for some men. */
  recede: number;
}

/** [PLACEHOLDER palette] Flat, mid-saturation tones — reads clean at small sizes. */
const SKIN_TONES = ['#ffe0bd', '#ffcd94', '#f1b58a', '#eeb382', '#c68642', '#a86b3c', '#8d5524', '#5c3a2e'];
const HAIR_COLORS_YOUNG = ['#1c1815', '#3a2a1a', '#5b3a21', '#7a4a25', '#a8621f', '#c99a3e', '#8a2e1f'];
const HAIR_COLORS_OLD = ['#6b6b6b', '#9a9a9a', '#c7c7c7', '#e8e8e8', '#3a2a1a', '#1c1815'];

// Weighted rather than uniform picks below — a roster of pro football players
// should skew toward broad/square bone structure, tight athletic cuts, and
// heavier brows rather than a flat distribution across every stored style.
// The rarer styles stay in the pool (this is variety, not a purge) so seeds
// still land on a round-faced or long-haired guy now and then.

const FACE_SHAPE_WEIGHTS: Record<FaceShape, number> = { square: 0.42, oval: 0.34, round: 0.24 };
const EYE_STYLE_WEIGHTS: Record<EyeStyle, number> = { narrow: 0.34, sleepy: 0.26, round: 0.24, wide: 0.16 };
const EYEBROW_STYLE_WEIGHTS: Record<EyebrowStyle, number> = { angled: 0.42, straight: 0.40, raised: 0.18 };
const NOSE_STYLE_WEIGHTS: Record<NoseStyle, number> = { medium: 0.40, wide: 0.38, small: 0.22 };
const MOUTH_STYLES: MouthStyle[] = ['neutral', 'smile', 'smirk', 'frown'];

// Short/athletic cuts dominate; long, ponytail and curly are kept rare
// rather than cut, since real rosters do have a handful of outliers.
const HAIR_STYLE_WEIGHTS: Record<HairStyle, number> = {
  buzz: 0.20, short: 0.18, bald: 0.11, part: 0.10, flattop: 0.09, mohawk: 0.07,
  medium: 0.07, dreads: 0.06, curly: 0.05, long: 0.04, ponytail: 0.03,
};

type FacialHairPick = Exclude<FacialHair, 'none'>;
const FACIAL_HAIR_WEIGHTS: Record<FacialHairPick, number> = {
  stubble: 0.34, beard: 0.28, goatee: 0.24, mustache: 0.14,
};

// ---------------------------------------------------------------------------
// Body — mass, frame and age, pushed into the silhouette
// ---------------------------------------------------------------------------

/**
 * Positional body norms: mean height (in) / weight (lb) and the spread that
 * defines "heavy for his position". A 250 lb linebacker is a heavy linebacker;
 * a 250 lb tackle is a light tackle, and the portrait has to say so.
 *
 * These mirror `BODY` in lib/gen/players.ts, which is what actually rolls
 * heightIn/weightLb at league generation. Deliberately duplicated rather than
 * imported: players.ts drags the whole league generator (name tables, college
 * lists, prospect profiles) along with it, and this module is pulled into the
 * client bundle by every roster row. If BODY moves, move this with it.
 */
export const POSITION_BODY_NORM: Record<string, { h: number; hSd: number; w: number; wSd: number }> = {
  QB:  { h: 75, hSd: 1.6, w: 220, wSd: 12 },
  RB:  { h: 70, hSd: 1.6, w: 214, wSd: 14 },
  FB:  { h: 72, hSd: 1.3, w: 245, wSd: 12 },
  WR:  { h: 73, hSd: 2.1, w: 200, wSd: 15 },
  TE:  { h: 77, hSd: 1.4, w: 250, wSd: 13 },
  LT:  { h: 78, hSd: 1.3, w: 313, wSd: 14 },
  LG:  { h: 77, hSd: 1.3, w: 315, wSd: 14 },
  C:   { h: 76, hSd: 1.2, w: 305, wSd: 13 },
  RG:  { h: 77, hSd: 1.3, w: 315, wSd: 14 },
  RT:  { h: 78, hSd: 1.3, w: 315, wSd: 14 },
  EDGE:{ h: 76, hSd: 1.5, w: 262, wSd: 15 },
  DT:  { h: 75, hSd: 1.5, w: 305, wSd: 18 },
  LB:  { h: 74, hSd: 1.4, w: 238, wSd: 12 },
  CB:  { h: 71, hSd: 1.7, w: 192, wSd: 11 },
  S:   { h: 73, hSd: 1.4, w: 205, wSd: 11 },
  K:   { h: 72, hSd: 1.8, w: 195, wSd: 14 },
  P:   { h: 74, hSd: 1.8, w: 205, wSd: 14 },
};

/**
 * The stand-in norm when we're handed no position (or one this table doesn't
 * know — a scouting-board "OT", say). Its numbers are chosen so that a call
 * with no body data at all lands on `NEUTRAL_MASS` and `frame` 0 exactly,
 * which is the geometry the portrait has always been drawn at. A call site
 * that passes nothing new therefore renders precisely what it renders today.
 */
const DEFAULT_BODY_NORM = { h: 74, hSd: 2.5, w: 245, wSd: 45 };

/**
 * The build the fixed geometry was originally drawn at — roughly a 245 lb pro
 * athlete. Everything in PlayerAvatar is anchored here: mass 0.45 reproduces
 * the old drawing exactly, and players deviate from it in both directions.
 */
export const NEUTRAL_MASS = 0.45;

/** Body inputs. All optional — see DEFAULT_BODY_NORM for what absence means. */
export interface AvatarBody {
  weightLb?: number;
  heightIn?: number;
  /** One of lib/tuning POSITIONS. Unknown values fall back to the generic norm. */
  position?: string;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function generateAvatarParams(seed: string, age = 26, body: AvatarBody = {}): AvatarParams {
  const rng = new Rng(`avatar-${seed}`);

  // Older players skew toward gray/white hair and are far more likely to
  // carry facial hair — both age-weighted rather than uniform. [TUNE]
  const isGraying = age >= 33 && rng.bool(Math.min(0.75, (age - 30) * 0.06));
  const hairColor = isGraying ? rng.pick(HAIR_COLORS_OLD) : rng.pick(HAIR_COLORS_YOUNG);

  // A clean-shaven 22-year-old is the outlier on an NFL roster, not the
  // norm — bare-faced stays possible but stubble-or-heavier is the default
  // even for the youngest guys, and climbs hard with age from there.
  const facialHairChance = age < 24 ? 0.55 : age < 29 ? 0.72 : age < 34 ? 0.85 : 0.9;
  const hairStyle = rng.weighted<HairStyle>(HAIR_STYLE_WEIGHTS);

  // Shoulder-length hair on an otherwise clean-shaven, soft-featured face was
  // the one combination that still read feminine no matter how heavy the jaw
  // underneath got — and it's also just not how the look actually shows up on
  // a roster, where flowing hair almost always comes with a beard. Correlating
  // the two kills the androgynous outlier without removing long hair from the
  // pool, which would cost real variety.
  const flowingHair = hairStyle === 'long' || hairStyle === 'ponytail';
  const facialHair: FacialHair = flowingHair || rng.bool(facialHairChance)
    ? rng.weighted<FacialHairPick>(FACIAL_HAIR_WEIGHTS)
    : 'none';

  const face = {
    skinTone: rng.pick(SKIN_TONES),
    hairStyle,
    hairColor,
    faceShape: rng.weighted<FaceShape>(FACE_SHAPE_WEIGHTS),
    eyeStyle: rng.weighted<EyeStyle>(EYE_STYLE_WEIGHTS),
    eyebrowStyle: rng.weighted<EyebrowStyle>(EYEBROW_STYLE_WEIGHTS),
    noseStyle: rng.weighted<NoseStyle>(NOSE_STYLE_WEIGHTS),
    mouthStyle: rng.pick(MOUTH_STYLES),
    facialHair,
  };

  // ---- Body ---------------------------------------------------------------
  // Every draw above this line is untouched and in its original order, and the
  // one new draw below it comes last, so an existing seed keeps the exact face
  // it has always had. Only the proportions it is drawn at change.
  const norm = (body.position && POSITION_BODY_NORM[body.position]) || DEFAULT_BODY_NORM;
  const weightLb = body.weightLb ?? norm.w;

  // Two readings of the same pound. `rel` is how he sits inside his own
  // position (a 250 lb linebacker is a heavy linebacker); `abs` is how he sits
  // against the whole league (a 250 lb linebacker is still a smaller human
  // than a 310 lb guard). Weighted toward absolute, because that is what the
  // eye actually reads at 22px — but the positional term is what stops every
  // lineman looking identical and every corner looking frail.
  const rel = clamp01((weightLb - (norm.w - norm.wSd)) / (2 * norm.wSd));
  const abs = clamp01((weightLb - 170) / 175);
  const mass = clamp01(0.3 * rel + 0.7 * abs);

  const frame = body.heightIn === undefined
    ? 0
    : Math.max(-1, Math.min(1, (body.heightIn - norm.h) / (2 * norm.hSd)));

  // Recession starts creeping in around 28 and is nowhere near universal —
  // the coin flip is the last draw in the sequence precisely so it cannot
  // disturb anything above it.
  const recedeCurve = clamp01((age - 28) / 13);
  const recede = recedeCurve * (rng.bool(0.55) ? 1 : 0.25);

  return { ...face, mass, frame, recede };
}
