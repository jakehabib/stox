/**
 * Shared drawing vocabulary for the Analytics Department.
 *
 * Colours are the app's own `viz*` tokens (tailwind.config.ts). Every set used
 * on this screen was run through the dataviz skill's checker against the card
 * surface `#18181b`; the verbatim output is in
 * docs/design-research/analytics/palette-validation.txt. Nothing here invents
 * a hue, and nothing here assigns one by rank — colour carries the entity
 * (side of the ball, win or loss, first team or depth) so that filtering the
 * screen greys the excluded units rather than repainting the survivors.
 *
 * The hex values are duplicated from tailwind.config.ts on purpose: an SVG
 * `fill` attribute cannot read a Tailwind colour name, and `fill-viz1`-style
 * utilities do not exist for every element these charts draw (gradients,
 * stroke-only rings, computed opacities). They are the same six strings the
 * validator was run against.
 */
export const VIZ = {
  card: '#18181b',
  line: '#2d2d32',
  muted: '#93939c',
  chalk: '#f3f2ec',
  accent: '#4ade80',
  gold: '#eab308',
  /** Side of the ball — the three-slot scatter set, all-pairs validated. */
  off: '#3987e5',
  def: '#d95926',
  st: '#199e70',
  /** The diverging poles. Blue ↔ red with a neutral grey midpoint. */
  good: '#3987e5',
  bad: '#e66767',
  neutral: '#4a4a52',
  /** Two-series stacks (first team / depth) and the second line on the ledger. */
  seriesA: '#3987e5',
  seriesB: '#d95926',
  depth: '#199e70',
  /** A split archetype — won some, lost some. Not a status colour. */
  mixed: '#c98500',
} as const;

export const SIDE_COLOR: Record<string, string> = { OFF: VIZ.off, DEF: VIZ.def, ST: VIZ.st };

/** `+2.9` / `−0.8`, with a real minus sign rather than a hyphen. */
export function signed(n: number, dp = 1): string {
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(dp)}`;
}

export function pct1(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** `.455` — a win rate the way a standings table writes one. */
export function rate3(n: number): string {
  return `.${String(Math.round(n * 1000)).padStart(3, '0')}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Tailwind class strings for SVG text. Kept here rather than inline so every
 * chart's axis, label and annotation type is the same size and colour — the
 * mockup's `.ax` / `.lbl` / `.axt` / `.quad`, translated.
 */
export const TXT = {
  /** Axis ticks and small captions. */
  ax: 'text-[9.5px] fill-muted uppercase tracking-[0.06em]',
  /** Axis titles — quieter and wider than the ticks. */
  axt: 'text-[9px] fill-muted uppercase tracking-[0.11em]',
  /** A value the reader is meant to read off the chart directly. */
  lbl: 'text-[11px] fill-chalk font-semibold tabular-nums',
  /** Quadrant names and other framing text. Deliberately near-invisible. */
  quad: 'text-[8.5px] fill-muted uppercase tracking-[0.1em] opacity-60',
  /** A label riding on top of a filled mark. */
  onMark: 'text-[10.5px] fill-white font-bold pointer-events-none',
} as const;
