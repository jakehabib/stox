import { Rng } from '../rng';

/**
 * ===========================================================================
 * PROCEDURAL TEAM LOGOS
 * ===========================================================================
 * Same "derive, never store" approach as lib/gen/avatar.ts — a logo is a
 * pure function of the team's id, so it needs no schema field and renders
 * identically everywhere without ever being generated or saved explicitly.
 *
 * Colors are picked as curated (primary, accent) PAIRS rather than two
 * independent random colors — freely-random pairings produce a lot of ugly
 * combinations, and a sports crest only needs to look "designed," not truly
 * random. [PLACEHOLDER palette] — swap/extend this list freely.
 * ===========================================================================
 */

export type LogoShape = 'shield' | 'circle' | 'hexagon';
export type LogoPattern = 'plain' | 'stripe' | 'chevron' | 'split';

export interface TeamLogoParams {
  primary: string;
  accent: string;
  shape: LogoShape;
  pattern: LogoPattern;
}

const COLOR_PAIRS: [string, string][] = [
  ['#8b1e2e', '#e8c766'], // crimson / gold
  ['#1e3a5f', '#c7ced9'], // navy / silver
  ['#1e5f3a', '#e8c766'], // forest / gold
  ['#4a1e5f', '#c7ced9'], // purple / silver
  ['#0f6b6b', '#f2f2ea'], // teal / bone
  ['#5f2e1e', '#e8a94c'], // rust / amber
  ['#2e2e33', '#c92f3d'], // charcoal / scarlet
  ['#1e2a5f', '#e8a94c'], // steel blue / amber
  ['#5f1e3a', '#e8c766'], // maroon / gold
  ['#28331f', '#c7ced9'], // olive drab / silver
  ['#1e3a3a', '#e0763a'], // slate teal / burnt orange
  ['#3a1e5f', '#4cc9c7'], // violet / cyan
];

const SHAPES: LogoShape[] = ['shield', 'circle', 'hexagon'];
const PATTERNS: LogoPattern[] = ['plain', 'stripe', 'chevron', 'split'];

export function generateTeamLogoParams(seed: string): TeamLogoParams {
  const rng = new Rng(`logo-${seed}`);
  const [primary, accent] = rng.pick(COLOR_PAIRS);
  return {
    primary,
    accent,
    shape: rng.pick(SHAPES),
    pattern: rng.pick(PATTERNS),
  };
}
