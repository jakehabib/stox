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

export function generateAvatarParams(seed: string, age = 26): AvatarParams {
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

  return {
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
}
