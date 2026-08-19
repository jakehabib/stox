import { generateAvatarParams, AvatarParams, HairStyle, EyeStyle, EyebrowStyle, NoseStyle, MouthStyle, FaceShape } from '@/lib/gen/avatar';

interface Props {
  seed: string;
  age?: number;
  size?: number;
  teamColor?: string;
  className?: string;
}

/**
 * Renders the cartoon face described in lib/gen/avatar.ts as flat SVG shapes.
 * Pure function of (seed, age) — see avatar.ts for why nothing is stored.
 */
export function PlayerAvatar({ seed, age = 26, size = 56, teamColor = '#3a4356', className }: Props) {
  const p = generateAvatarParams(seed, age);
  const darkSkin = shade(p.skinTone, -0.25);

  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={className} role="img" aria-label="Player avatar">
      {/* jersey */}
      <path d="M18 122 L34 90 L60 100 L86 90 L102 122 Z" fill={teamColor} />
      <path d="M50 90 L60 100 L70 90 L64 84 L56 84 Z" fill={shade(teamColor, -0.2)} />
      {/* neck */}
      <rect x={49} y={78} width={22} height={20} fill={p.skinTone} />
      {/* ears */}
      <ellipse cx={26} cy={54} rx={6} ry={9} fill={p.skinTone} stroke={darkSkin} strokeWidth={0.75} />
      <ellipse cx={94} cy={54} rx={6} ry={9} fill={p.skinTone} stroke={darkSkin} strokeWidth={0.75} />
      {/* head */}
      <HeadShape shape={p.faceShape} skinTone={p.skinTone} stroke={darkSkin} />
      {/* hair behind (long style side growth) */}
      {p.hairStyle === 'long' && <LongHairBack color={p.hairColor} />}
      {/* facial hair (under hair-top, above mouth layer order handled visually fine either way) */}
      <FacialHairShape style={p.facialHair} color={p.hairColor} skinTone={p.skinTone} />
      {/* mouth */}
      <MouthShape style={p.mouthStyle} />
      {/* nose */}
      <NoseShape style={p.noseStyle} skinTone={darkSkin} />
      {/* eyes */}
      <EyeShape style={p.eyeStyle} />
      {/* eyebrows */}
      <EyebrowShape style={p.eyebrowStyle} color={p.hairColor} />
      {/* hair top */}
      <HairTop style={p.hairStyle} color={p.hairColor} />
    </svg>
  );
}

function HeadShape({ shape, skinTone, stroke }: { shape: FaceShape; skinTone: string; stroke: string }) {
  if (shape === 'square') return <rect x={30} y={20} width={60} height={62} rx={16} fill={skinTone} stroke={stroke} strokeWidth={0.75} />;
  if (shape === 'oval') return <ellipse cx={60} cy={52} rx={28} ry={36} fill={skinTone} stroke={stroke} strokeWidth={0.75} />;
  return <ellipse cx={60} cy={52} rx={32} ry={33} fill={skinTone} stroke={stroke} strokeWidth={0.75} />;
}

function HairTop({ style, color }: { style: HairStyle; color: string }) {
  switch (style) {
    case 'bald':
      return <ellipse cx={50} cy={30} rx={10} ry={5} fill="#fff" opacity={0.12} />;
    case 'buzz':
      return <path d="M28 30 Q60 8 92 30 Q92 20 60 16 Q28 20 28 30 Z" fill={color} />;
    case 'short':
      return <path d="M26 36 Q60 2 94 36 Q94 18 60 12 Q26 18 26 36 Z" fill={color} />;
    case 'part':
      return <path d="M26 36 Q46 4 96 32 Q88 16 58 12 Q28 16 26 36 Z" fill={color} />;
    case 'medium':
      return <path d="M24 52 Q18 6 60 8 Q102 6 96 52 Q92 24 60 22 Q28 24 24 52 Z" fill={color} />;
    case 'curly':
      return (
        <g fill={color}>
          <circle cx={34} cy={30} r={10} /><circle cx={48} cy={18} r={11} /><circle cx={64} cy={14} r={11} />
          <circle cx={80} cy={19} r={11} /><circle cx={92} cy={32} r={10} /><circle cx={60} cy={28} r={13} />
        </g>
      );
    case 'mohawk':
      return <path d="M50 38 Q46 10 60 6 Q74 10 70 38 Q60 30 50 38 Z" fill={color} />;
    case 'long':
      return <path d="M24 58 Q16 4 60 6 Q104 4 96 58 Q94 20 60 18 Q26 20 24 58 Z" fill={color} />;
    case 'ponytail':
      return (
        <>
          <path d="M28 32 Q60 4 92 32 Q92 16 60 10 Q28 16 28 32 Z" fill={color} />
          <path d="M84 22 Q100 26 98 48 Q97 62 90 70 L85 64 Q91 54 90 42 Q89 30 82 24 Z" fill={color} />
        </>
      );
    case 'flattop':
      return <path d="M28 32 L28 14 Q60 4 92 14 L92 32 Q60 24 28 32 Z" fill={color} />;
    case 'dreads':
      return (
        <g fill={color}>
          <path d="M26 34 Q60 2 94 34 Q94 20 60 14 Q26 20 26 34 Z" />
          {[30, 40, 50, 60, 70, 80, 90].map((x) => (
            <rect key={x} x={x - 3} y={26} width={6} height={30} rx={3} />
          ))}
        </g>
      );
    default:
      return null;
  }
}

function LongHairBack({ color }: { color: string }) {
  return (
    <>
      <path d="M18 50 Q14 90 24 108 L34 104 Q26 78 26 50 Z" fill={color} />
      <path d="M102 50 Q106 90 96 108 L86 104 Q94 78 94 50 Z" fill={color} />
    </>
  );
}

function EyebrowShape({ style, color }: { style: EyebrowStyle; color: string }) {
  const brow = (cx: number, mirror: boolean) => {
    const flip = mirror ? -1 : 1;
    if (style === 'angled') return <rect x={cx - 7} y={40} width={14} height={2.5} rx={1.25} fill={color} transform={`rotate(${8 * flip} ${cx} 41)`} />;
    if (style === 'raised') return <path d={`M${cx - 7} 42 Q${cx} 36 ${cx + 7} 42`} stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" />;
    return <rect x={cx - 7} y={40} width={14} height={2.5} rx={1.25} fill={color} />;
  };
  return <>{brow(46, true)}{brow(74, false)}</>;
}

function EyeShape({ style }: { style: EyeStyle }) {
  const eye = (cx: number) => {
    if (style === 'narrow') return <ellipse cx={cx} cy={50} rx={6} ry={1.8} fill="#20242c" />;
    if (style === 'wide') return <><circle cx={cx} cy={50} r={6.5} fill="#fff" stroke="#20242c" strokeWidth={0.75} /><circle cx={cx} cy={50} r={3.2} fill="#20242c" /></>;
    if (style === 'sleepy') return <path d={`M${cx - 6} 49 Q${cx} 54 ${cx + 6} 49 Q${cx} 51 ${cx - 6} 49 Z`} fill="#20242c" />;
    return <><circle cx={cx} cy={50} r={5} fill="#fff" stroke="#20242c" strokeWidth={0.75} /><circle cx={cx} cy={50} r={2.5} fill="#20242c" /></>;
  };
  return <>{eye(46)}{eye(74)}</>;
}

function NoseShape({ style, skinTone }: { style: NoseStyle; skinTone: string }) {
  if (style === 'small') return <line x1={60} y1={54} x2={60} y2={61} stroke={skinTone} strokeWidth={2} strokeLinecap="round" />;
  if (style === 'wide') return <path d="M55 53 L65 53 L68 62 Q60 66 52 62 Z" fill={skinTone} opacity={0.9} />;
  return <path d="M57 53 L63 53 L65 61 Q60 64 55 61 Z" fill={skinTone} opacity={0.9} />;
}

function MouthShape({ style }: { style: MouthStyle }) {
  if (style === 'smile') return <path d="M48 70 Q60 80 72 70" stroke="#7a3b3b" strokeWidth={2.5} fill="none" strokeLinecap="round" />;
  if (style === 'smirk') return <path d="M48 71 Q58 75 70 68" stroke="#7a3b3b" strokeWidth={2.5} fill="none" strokeLinecap="round" />;
  if (style === 'frown') return <path d="M48 74 Q60 66 72 74" stroke="#7a3b3b" strokeWidth={2.5} fill="none" strokeLinecap="round" />;
  return <line x1={49} y1={71} x2={71} y2={71} stroke="#7a3b3b" strokeWidth={2.5} strokeLinecap="round" />;
}

function FacialHairShape({ style, color, skinTone }: { style: string; color: string; skinTone: string }) {
  if (style === 'mustache') return <path d="M49 66 Q60 70 71 66 Q60 68 49 66 Z" fill={color} opacity={0.9} />;
  if (style === 'goatee') return <path d="M52 74 Q60 88 68 74 Q60 80 52 74 Z" fill={color} opacity={0.9} />;
  if (style === 'beard') return <path d="M30 56 Q28 84 60 90 Q92 84 90 56 Q92 74 78 82 Q60 88 42 82 Q28 74 30 56 Z" fill={color} opacity={0.92} />;
  return null;
}

/** Lighten/darken a hex color by `amt` (-1..1). */
function shade(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  const num = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = clamp8((num >> 16) + Math.round(255 * amt));
  const g = clamp8(((num >> 8) & 0xff) + Math.round(255 * amt));
  const b = clamp8((num & 0xff) + Math.round(255 * amt));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
function clamp8(n: number): number {
  return Math.min(255, Math.max(0, n));
}
