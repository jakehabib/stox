import { generateTeamLogoParams, LogoShape, LogoPattern } from '@/lib/gen/teamLogo';
import { teamMark } from './ds/teamMarks';

interface Props {
  seed: string;
  abbr: string;
  /**
   * Club nickname, when the caller has it. Only used to pick the crest's mark
   * (see components/ds/teamMarks.tsx). Omitting it is fine — the abbreviation
   * resolves the same mark for the 32 seeded clubs.
   */
  nickname?: string | null;
  size?: number;
  className?: string;
}

const SHAPE_PATH: Record<LogoShape, string> = {
  shield: 'M50 4 L90 16 L90 48 Q90 82 50 96 Q10 82 10 48 L10 16 Z',
  circle: 'M50 4 A46 46 0 1 1 49.99 4 Z',
  hexagon: 'M50 3 L92 26 L92 74 L50 97 L8 74 L8 26 Z',
  diamond: 'M50 2 L96 50 L50 98 L4 50 Z',
};

/**
 * Below this the crest renders exactly as it always has: abbreviation in a
 * dark box, dead centre. That is not a compromise, it is the point — at 20px
 * a drawing is mud and the three letters are the only thing that reads, and
 * every dense table in the app (standings, schedule, stats, trade) sits under
 * this line. The mark is an addition at header/watermark sizes, not a
 * replacement anywhere.
 */
const MARK_MIN_SIZE = 40;

/**
 * Crest geometry per shape. A diamond's usable area is its inscribed square,
 * which is far smaller than a hexagon's — drawing every mark at one scale is
 * what chops the corners off diamond crests, and hanging the nameplate at one
 * fixed height is what leaves it sticking out the bottom of one.
 *
 * `cy`/`scale` place the mark; `plateY`/`plateW` place the abbreviation, sized
 * so the plate stays inside the shape it is clipped to.
 */
const GEOM: Record<LogoShape, { cy: number; scale: number; plateY: number; plateW: number }> = {
  shield: { cy: 38, scale: 0.78, plateY: 66, plateW: 56 },
  circle: { cy: 40, scale: 0.8, plateY: 68, plateW: 60 },
  hexagon: { cy: 40, scale: 0.86, plateY: 67, plateW: 56 },
  diamond: { cy: 34, scale: 0.6, plateY: 58, plateW: 48 },
};

export function TeamLogo({ seed, abbr, nickname, size = 40, className }: Props) {
  const p = generateTeamLogoParams(seed);
  const clipId = `logo-clip-${seed}`;
  const path = SHAPE_PATH[p.shape];
  const letters = abbr.slice(0, 4).toUpperCase();
  // No mark for an unknown (custom) nickname — that crest keeps today's look.
  const mark = size >= MARK_MIN_SIZE ? teamMark(nickname, abbr) : null;
  const g = GEOM[p.shape];

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} role="img" aria-label={`${abbr} logo`}>
      <defs>
        <clipPath id={clipId}><path d={path} /></clipPath>
      </defs>
      <path d={path} fill={p.primary} stroke="rgba(0,0,0,0.25)" strokeWidth={1.5} />
      <g clipPath={`url(#${clipId})`}>
        <PatternOverlay pattern={p.pattern} color={p.accent} />
        {mark && (
          <g transform={`translate(50,${g.cy}) scale(${g.scale}) translate(-50,-41)`}>
            {/* A dark silhouette a touch larger than the mark, so the accent
                shape still separates where it crosses a stripe/chevron/ring
                overlay in that same accent colour. */}
            <g opacity={0.34} transform="translate(50,41) scale(1.07) translate(-50,-41)">
              {mark('#080a0d', '#080a0d')}
            </g>
            {mark(p.accent, p.primary)}
          </g>
        )}
        {/* Abbreviation demoted to a nameplate, not dropped: it is still how a
            franchise is identified, and the crest is often the only thing
            beside a score. Clipped with the rest so it can never hang off the
            bottom of a shield or a diamond. */}
        {mark && (
          <rect
            x={50 - g.plateW / 2} y={g.plateY} width={g.plateW} height={16} rx={3}
            fill="rgba(0,0,0,0.62)"
          />
        )}
      </g>
      <path d={path} fill="none" stroke={p.accent} strokeWidth={2} opacity={0.55} />
      {mark ? (
        <text
          x={50} y={g.plateY + 12} textAnchor="middle"
          fontSize={letters.length > 3 ? 11 : 12.5} fontWeight={800} fill="#f4f6fa"
          fontFamily="ui-sans-serif, system-ui, sans-serif" letterSpacing={1.4}
        >
          {letters}
        </text>
      ) : (
        <>
          <rect x={50 - abbr.length * 8.5} y={42} width={abbr.length * 17} height={20} rx={4} fill="rgba(0,0,0,0.38)" />
          <text
            x={50} y={57} textAnchor="middle"
            fontSize={abbr.length > 3 ? 15 : 18} fontWeight={800} fill="#f4f6fa"
            fontFamily="ui-sans-serif, system-ui, sans-serif" letterSpacing={0.5}
          >
            {letters}
          </text>
        </>
      )}
    </svg>
  );
}

function PatternOverlay({ pattern, color }: { pattern: LogoPattern; color: string }) {
  switch (pattern) {
    case 'stripe':
      return <rect x={0} y={38} width={100} height={20} fill={color} opacity={0.85} />;
    case 'chevron':
      return <path d="M0 70 L50 50 L100 70 L100 90 L50 70 L0 90 Z" fill={color} opacity={0.85} />;
    case 'split':
      return <path d="M50 0 L100 0 L100 100 L50 100 Z" fill={color} opacity={0.28} />;
    case 'ring':
      return <circle cx={50} cy={50} r={30} fill="none" stroke={color} strokeWidth={7} opacity={0.8} />;
    default:
      return null;
  }
}
