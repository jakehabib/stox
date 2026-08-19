import { generateTeamLogoParams, LogoShape, LogoPattern } from '@/lib/gen/teamLogo';

interface Props {
  seed: string;
  abbr: string;
  size?: number;
  className?: string;
}

const SHAPE_PATH: Record<LogoShape, string> = {
  shield: 'M50 4 L90 16 L90 48 Q90 82 50 96 Q10 82 10 48 L10 16 Z',
  circle: 'M50 4 A46 46 0 1 1 49.99 4 Z',
  hexagon: 'M50 3 L92 26 L92 74 L50 97 L8 74 L8 26 Z',
};

export function TeamLogo({ seed, abbr, size = 40, className }: Props) {
  const p = generateTeamLogoParams(seed);
  const clipId = `logo-clip-${seed}`;
  const path = SHAPE_PATH[p.shape];

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} role="img" aria-label={`${abbr} logo`}>
      <defs>
        <clipPath id={clipId}><path d={path} /></clipPath>
      </defs>
      <path d={path} fill={p.primary} stroke="rgba(0,0,0,0.25)" strokeWidth={1.5} />
      <g clipPath={`url(#${clipId})`}>
        <PatternOverlay pattern={p.pattern} color={p.accent} />
      </g>
      <path d={path} fill="none" stroke={p.accent} strokeWidth={2} opacity={0.55} />
      <rect x={50 - abbr.length * 8.5} y={42} width={abbr.length * 17} height={20} rx={4} fill="rgba(0,0,0,0.38)" />
      <text
        x={50} y={57} textAnchor="middle"
        fontSize={abbr.length > 3 ? 15 : 18} fontWeight={800} fill="#f4f6fa"
        fontFamily="ui-sans-serif, system-ui, sans-serif" letterSpacing={0.5}
      >
        {abbr.slice(0, 4).toUpperCase()}
      </text>
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
    default:
      return null;
  }
}
