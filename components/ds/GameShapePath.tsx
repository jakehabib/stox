import type { GameShape, ShapeTone } from '@/lib/gameShape';

/**
 * The silhouette of a game: score differential across every drive, from one
 * team's point of view, with the zero line drawn.
 *
 * It is not a chart — there are no axes and no gridlines. It is a shape you
 * read pre-attentively, the same device ESPN's win-probability graph has used
 * since 2016. A flat line, a cliff, a see-saw and a late spike are four
 * different stories recognised before a single number is read.
 *
 * Every point comes from `BoxScore.drives[]`, which has been written for
 * every played game since the engine was built and never read back. No new
 * data, no RNG, no external assets — inline SVG only.
 */

/** Values lifted from tailwind.config.ts. Kept as literals because SVG
 *  stroke/fill cannot take a Tailwind class the way a text colour can, and a
 *  template-built class name would be purged from the build. */
const TONE_HEX: Record<ShapeTone, string> = {
  good: '#4ade80',
  bad: '#f87171',
  warn: '#fbbf24',
  info: '#38bdf8',
  muted: '#93939c',
};

const LINE = '#2d2d32';
const ZERO = '#4a4a52';
const MUTED = '#93939c';

interface Props {
  shape: GameShape;
  /** Defaults to the archetype's own tone. Pass a team primary to override. */
  color?: string;
  width?: number;
  height?: number;
  /** `spark` is the 120x36 list treatment; `full` is the game-page one. */
  variant?: 'spark' | 'full';
  className?: string;
  /** Draws the line on once. Silent under prefers-reduced-motion. */
  animate?: boolean;
}

export function GameShapePath({
  shape, color, width = 120, height = 36, variant = 'spark', className, animate = false,
}: Props) {
  const stroke = color ?? TONE_HEX[shape.tone];
  const padY = variant === 'full' ? 18 : 4;
  const padX = variant === 'full' ? 10 : 2;
  const mid = height / 2;

  const maxAbs = Math.max(7, ...shape.points.map((p) => Math.abs(p.diff)));
  const n = shape.points.length - 1;
  const x = (i: number) => padX + (i / Math.max(1, n)) * (width - padX * 2);
  const y = (diff: number) => mid - (diff / maxAbs) * (mid - padY);

  const pts = shape.points.map((p, i) => `${x(i).toFixed(1)},${y(p.diff).toFixed(1)}`).join(' ');
  // Two clipped copies of the same closed polygon: the part above the zero
  // line is filled in the team/tone colour, the part below in grey. The eye
  // reads "ahead" and "behind" as areas without needing a legend.
  const area = `${pts} ${x(n).toFixed(1)},${mid} ${x(0).toFixed(1)},${mid}`;
  const uid = `shape-${Math.abs(hash(pts))}`;

  const deepest = shape.deepestIndex;
  const goAhead = shape.goAheadIndex;
  const showMarkers = variant === 'full';

  return (
    <>
      {animate && (
        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes shape-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
          .shape-draw { stroke-dasharray: 1; stroke-dashoffset: 0;
            animation: shape-draw .7s ease-out both; }
          @media (prefers-reduced-motion: reduce) { .shape-draw { animation: none; } }
        ` }} />
      )}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        className={className}
        role="img"
        aria-label={ariaLabel(shape)}
      >
        <defs>
          <clipPath id={`${uid}-above`}><rect x="0" y="0" width={width} height={mid} /></clipPath>
          <clipPath id={`${uid}-below`}><rect x="0" y={mid} width={width} height={height - mid} /></clipPath>
        </defs>

        {variant === 'full' && shape.quarterStarts.slice(1).map((i, k) => (
          <line
            key={i}
            x1={x(i)} x2={x(i)} y1={padY - 8} y2={height - padY + 8}
            stroke={k === 1 ? '#3a3a41' : LINE}
            strokeWidth={k === 1 ? 1.5 : 1}
            strokeDasharray={k === 1 ? '3 3' : undefined}
          />
        ))}

        <polygon points={area} fill={stroke} fillOpacity={0.18} clipPath={`url(#${uid}-above)`} />
        <polygon points={area} fill={MUTED} fillOpacity={0.14} clipPath={`url(#${uid}-below)`} />

        <line x1={0} x2={width} y1={mid} y2={mid} stroke={ZERO} strokeWidth={variant === 'full' ? 1 : 0.8} />

        <polyline
          points={pts}
          fill="none"
          stroke={stroke}
          strokeWidth={variant === 'full' ? 2.5 : 2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          pathLength={1}
          className={animate ? 'shape-draw' : undefined}
        />

        {showMarkers && deepest !== null && shape.largestDeficit > 0 && (
          <circle cx={x(deepest)} cy={y(shape.points[deepest].diff)} r={3.5} fill={TONE_HEX.bad} />
        )}
        {showMarkers && goAhead !== null && shape.goAheadIndex !== null && (
          <circle cx={x(goAhead)} cy={y(shape.points[goAhead].diff)} r={4} fill={TONE_HEX.good} />
        )}
      </svg>
    </>
  );
}

/**
 * The whole point of a silhouette is that it is read visually, so the
 * screen-reader path has to carry the same story in words rather than being
 * left as decoration.
 */
function ariaLabel(shape: GameShape): string {
  const bits = [`${shape.archetype}: ${shape.note}`];
  if (shape.leadChanges > 0) bits.push(`${shape.leadChanges} lead change${shape.leadChanges === 1 ? '' : 's'}`);
  bits.push(shape.finalMargin === 0
    ? 'finished level'
    : shape.finalMargin > 0 ? `won by ${shape.finalMargin}` : `lost by ${-shape.finalMargin}`);
  return `Score differential across ${shape.points.length - 1} drives. ${bits.join(', ')}.`;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** The archetype word, in its own tone. One word, never a sentence. */
export function ArchetypeTag({ shape, className = '' }: { shape: GameShape; className?: string }) {
  return (
    <span
      className={`font-display font-extrabold uppercase tracking-[0.13em] text-[11px] ${className}`}
      style={{ color: TONE_HEX[shape.tone] }}
    >
      {shape.archetype}
    </span>
  );
}

export { TONE_HEX };
