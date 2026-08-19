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
export type FacialHair = 'none' | 'mustache' | 'goatee' | 'beard';
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

const HAIR_STYLES: HairStyle[] = [
  'bald', 'buzz', 'short', 'part', 'medium', 'curly', 'mohawk', 'long',
  'ponytail', 'flattop', 'dreads',
];
const EYE_STYLES: EyeStyle[] = ['round', 'narrow', 'wide', 'sleepy'];
const EYEBROW_STYLES: EyebrowStyle[] = ['straight', 'angled', 'raised'];
const NOSE_STYLES: NoseStyle[] = ['small', 'medium', 'wide'];
const MOUTH_STYLES: MouthStyle[] = ['neutral', 'smile', 'smirk', 'frown'];
const FACE_SHAPES: FaceShape[] = ['round', 'oval', 'square'];

export function generateAvatarParams(seed: string, age = 26): AvatarParams {
  const rng = new Rng(`avatar-${seed}`);

  // Older players skew toward gray/white hair and are far more likely to
  // carry facial hair — both age-weighted rather than uniform. [TUNE]
  const isGraying = age >= 33 && rng.bool(Math.min(0.75, (age - 30) * 0.06));
  const hairColor = isGraying ? rng.pick(HAIR_COLORS_OLD) : rng.pick(HAIR_COLORS_YOUNG);

  const facialHairChance = age < 24 ? 0.12 : age < 29 ? 0.35 : age < 34 ? 0.5 : 0.6;
  const facialHair: FacialHair = rng.bool(facialHairChance)
    ? rng.pick(['mustache', 'goatee', 'beard'] as FacialHair[])
    : 'none';

  return {
    skinTone: rng.pick(SKIN_TONES),
    hairStyle: rng.pick(HAIR_STYLES),
    hairColor,
    faceShape: rng.pick(FACE_SHAPES),
    eyeStyle: rng.pick(EYE_STYLES),
    eyebrowStyle: rng.pick(EYEBROW_STYLES),
    noseStyle: rng.pick(NOSE_STYLES),
    mouthStyle: rng.pick(MOUTH_STYLES),
    facialHair,
  };
}
