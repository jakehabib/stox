import { generateAvatarParams, HairStyle, EyeStyle, EyebrowStyle, NoseStyle, MouthStyle, FaceShape } from '@/lib/gen/avatar';

interface Props {
  seed: string;
  age?: number;
  size?: number;
  teamColor?: string;
  className?: string;
}

/**
 * Renders the face described in lib/gen/avatar.ts as layered SVG. Pure
 * function of (seed, age) — see avatar.ts for why nothing is stored.
 *
 * Styled as a portrait rather than a sticker: the bust sits in a tinted
 * frame with shoulder pads filling the base, the head is proportioned closer
 * to life than to a bobblehead, and the face carries real shading (jaw, brow,
 * neck shadow) instead of reading flat. Detail is deliberately kept bold —
 * this is drawn at 20px in roster tables as often as at 128px on a player
 * card, so silhouette has to survive when the fine strokes vanish.
 */
export function PlayerAvatar({ seed, age = 26, size = 56, teamColor = '#3a4356', className }: Props) {
  const p = generateAvatarParams(seed, age);
  const shadow = shade(p.skinTone, -0.16);
  const deep = shade(p.skinTone, -0.3);
  const uid = seed.replace(/[^a-zA-Z0-9]/g, '').slice(-10);

  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={className} role="img" aria-label="Player portrait">
      <defs>
        <clipPath id={`pa-clip-${uid}`}>
          <rect x={0} y={0} width={120} height={120} rx={14} />
        </clipPath>
        {/* Portrait backdrop — a soft team-tinted wash, like a media-day
            photo bay, so the head reads against something instead of the
            page background. */}
        <linearGradient id={`pa-bg-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={shade(teamColor, 0.12)} />
          <stop offset="100%" stopColor={shade(teamColor, -0.42)} />
        </linearGradient>
        <linearGradient id={`pa-jersey-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={shade(teamColor, 0.06)} />
          <stop offset="100%" stopColor={shade(teamColor, -0.24)} />
        </linearGradient>
      </defs>

      <g clipPath={`url(#pa-clip-${uid})`}>
        <rect x={0} y={0} width={120} height={120} fill={`url(#pa-bg-${uid})`} />
        {/* Vignette floor so the bust doesn't float. */}
        <ellipse cx={60} cy={124} rx={62} ry={26} fill="#000" opacity={0.22} />

        {/* --- Bust: shoulder pads, not a thin jersey V ------------------- */}
        <path d="M12 120 Q14 96 32 88 L48 82 Q60 92 72 82 L88 88 Q106 96 108 120 Z" fill={`url(#pa-jersey-${uid})`} />
        {/* Pad seam + collar give the jersey structure at a glance. */}
        <path d="M32 88 Q60 100 88 88" stroke={shade(teamColor, -0.4)} strokeWidth={1.5} fill="none" opacity={0.7} />
        <path d="M48 82 Q60 94 72 82 L68 78 Q60 84 52 78 Z" fill={shade(teamColor, -0.42)} />

        {/* --- Neck, set behind the jaw with a cast shadow ---------------- */}
        <path d="M50 66 L50 86 Q60 92 70 86 L70 66 Z" fill={shadow} />
        <path d="M50 66 L50 74 Q60 82 70 74 L70 66 Z" fill={deep} opacity={0.55} />

        {/* --- Ears ------------------------------------------------------- */}
        <ellipse cx={28} cy={52} rx={5.5} ry={8.5} fill={p.skinTone} stroke={deep} strokeWidth={0.8} />
        <ellipse cx={92} cy={52} rx={5.5} ry={8.5} fill={p.skinTone} stroke={deep} strokeWidth={0.8} />

        {/* --- Head ------------------------------------------------------- */}
        <HeadShape shape={p.faceShape} skinTone={p.skinTone} stroke={deep} />
        {/* Jaw/cheek shading — the single thing that stops it reading flat. */}
        <HeadShade shape={p.faceShape} color={shadow} />

        {p.hairStyle === 'long' && <LongHairBack color={p.hairColor} />}
        <FacialHairShape style={p.facialHair} color={p.hairColor} />
        <MouthShape style={p.mouthStyle} />
        <NoseShape style={p.noseStyle} shadow={shadow} deep={deep} />
        <EyeShape style={p.eyeStyle} />
        <EyebrowShape style={p.eyebrowStyle} color={p.hairColor} />
        <HairTop style={p.hairStyle} color={p.hairColor} />
      </g>
    </svg>
  );
}

function HeadShape({ shape, skinTone, stroke }: { shape: FaceShape; skinTone: string; stroke: string }) {
  if (shape === 'square') return <path d="M31 40 Q31 20 60 20 Q89 20 89 40 L89 56 Q89 78 60 82 Q31 78 31 56 Z" fill={skinTone} stroke={stroke} strokeWidth={0.8} />;
  if (shape === 'oval') return <ellipse cx={60} cy={50} rx={27} ry={32} fill={skinTone} stroke={stroke} strokeWidth={0.8} />;
  return <path d="M31 46 Q31 21 60 21 Q89 21 89 46 Q89 72 60 81 Q31 72 31 46 Z" fill={skinTone} stroke={stroke} strokeWidth={0.8} />;
}

/** Cheekbone + jaw shadow, shaped to the head so it never spills outside it. */
function HeadShade({ shape, color }: { shape: FaceShape; color: string }) {
  if (shape === 'square') {
    return (
      <>
        <path d="M31 56 Q31 78 60 82 Q60 74 55 68 Q40 64 31 56 Z" fill={color} opacity={0.35} />
        <path d="M89 56 Q89 78 60 82 Q60 74 65 68 Q80 64 89 56 Z" fill={color} opacity={0.35} />
      </>
    );
  }
  if (shape === 'oval') {
    return (
      <>
        <path d="M33 58 Q38 76 60 82 Q58 74 54 68 Q41 64 33 58 Z" fill={color} opacity={0.35} />
        <path d="M87 58 Q82 76 60 82 Q62 74 66 68 Q79 64 87 58 Z" fill={color} opacity={0.35} />
      </>
    );
  }
  return (
    <>
      <path d="M32 54 Q35 73 60 81 Q58 73 54 67 Q40 62 32 54 Z" fill={color} opacity={0.35} />
      <path d="M88 54 Q85 73 60 81 Q62 73 66 67 Q80 62 88 54 Z" fill={color} opacity={0.35} />
    </>
  );
}

function HairTop({ style, color }: { style: HairStyle; color: string }) {
  const hi = shade(color, 0.16);
  switch (style) {
    case 'bald':
      // Scalp highlight instead of a flat white blob.
      return <ellipse cx={52} cy={30} rx={13} ry={7} fill="#fff" opacity={0.1} />;
    case 'buzz':
      return (
        <g>
          <path d="M30 32 Q60 12 90 32 Q90 20 60 17 Q30 20 30 32 Z" fill={color} />
          <path d="M40 24 Q60 16 80 24 Q60 19 40 24 Z" fill={hi} opacity={0.5} />
        </g>
      );
    case 'short':
      return (
        <g>
          <path d="M29 38 Q60 8 91 38 Q91 20 60 15 Q29 20 29 38 Z" fill={color} />
          <path d="M40 25 Q60 17 80 25 Q60 20 40 25 Z" fill={hi} opacity={0.45} />
        </g>
      );
    case 'part':
      return (
        <g>
          <path d="M29 38 Q47 10 92 34 Q85 18 58 15 Q31 19 29 38 Z" fill={color} />
          <path d="M46 22 Q64 18 80 26 Q62 19 46 22 Z" fill={hi} opacity={0.45} />
        </g>
      );
    case 'medium':
      return (
        <g>
          <path d="M27 52 Q22 12 60 13 Q98 12 93 52 Q89 26 60 24 Q31 26 27 52 Z" fill={color} />
          <path d="M42 24 Q60 18 78 24 Q60 20 42 24 Z" fill={hi} opacity={0.4} />
        </g>
      );
    case 'curly':
      return (
        <g fill={color}>
          <circle cx={36} cy={32} r={10} /><circle cx={49} cy={20} r={11} /><circle cx={64} cy={16} r={11} />
          <circle cx={79} cy={21} r={11} /><circle cx={90} cy={33} r={10} /><circle cx={60} cy={29} r={13} />
          <circle cx={54} cy={20} r={4} fill={hi} opacity={0.45} />
        </g>
      );
    case 'mohawk':
      return (
        <g>
          <path d="M51 38 Q47 12 60 8 Q73 12 69 38 Q60 31 51 38 Z" fill={color} />
          <path d="M58 14 Q62 14 62 30 Q60 26 58 30 Z" fill={hi} opacity={0.5} />
        </g>
      );
    case 'long':
      return (
        <g>
          <path d="M27 56 Q20 10 60 11 Q100 10 93 56 Q90 24 60 22 Q30 24 27 56 Z" fill={color} />
          <path d="M42 24 Q60 18 78 24 Q60 20 42 24 Z" fill={hi} opacity={0.4} />
        </g>
      );
    case 'ponytail':
      return (
        <g>
          <path d="M30 34 Q60 10 90 34 Q90 18 60 14 Q30 18 30 34 Z" fill={color} />
          <path d="M83 24 Q98 28 96 48 Q95 60 89 68 L84 62 Q90 53 89 42 Q88 31 81 26 Z" fill={color} />
          <path d="M44 24 Q60 19 76 24 Q60 20 44 24 Z" fill={hi} opacity={0.45} />
        </g>
      );
    case 'flattop':
      return (
        <g>
          <path d="M30 34 L30 17 Q60 8 90 17 L90 34 Q60 26 30 34 Z" fill={color} />
          <path d="M36 18 Q60 12 84 18 Q60 15 36 18 Z" fill={hi} opacity={0.45} />
        </g>
      );
    case 'dreads':
      return (
        <g fill={color}>
          <path d="M29 36 Q60 8 91 36 Q91 20 60 16 Q29 20 29 36 Z" />
          {[33, 42, 51, 60, 69, 78, 87].map((x, i) => (
            <rect key={x} x={x - 3} y={28} width={6} height={i % 2 === 0 ? 30 : 24} rx={3} />
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
      <path d="M22 50 Q17 88 27 106 L37 102 Q29 78 29 50 Z" fill={color} />
      <path d="M98 50 Q103 88 93 106 L83 102 Q91 78 91 50 Z" fill={color} />
    </>
  );
}

function EyebrowShape({ style, color }: { style: EyebrowStyle; color: string }) {
  const brow = (cx: number, mirror: boolean) => {
    const flip = mirror ? -1 : 1;
    if (style === 'angled') return <path d={`M${cx - 8} 41 L${cx + 8} 39`} stroke={color} strokeWidth={3} strokeLinecap="round" transform={`rotate(${6 * flip} ${cx} 40)`} />;
    if (style === 'raised') return <path d={`M${cx - 8} 41 Q${cx} 35 ${cx + 8} 41`} stroke={color} strokeWidth={3} fill="none" strokeLinecap="round" />;
    return <path d={`M${cx - 8} 40 Q${cx} 38.5 ${cx + 8} 40`} stroke={color} strokeWidth={3} fill="none" strokeLinecap="round" />;
  };
  return <>{brow(46, true)}{brow(74, false)}</>;
}

/**
 * Almond eyes with a real upper lid, rather than a white circle with a dot —
 * the lid is what keeps a face from reading startled at every size.
 */
function EyeShape({ style }: { style: EyeStyle }) {
  const eye = (cx: number) => {
    if (style === 'narrow') {
      return (
        <g>
          <path d={`M${cx - 7} 50 Q${cx} 45.5 ${cx + 7} 50 Q${cx} 53 ${cx - 7} 50 Z`} fill="#fdfdfd" />
          <circle cx={cx} cy={49.5} r={2.6} fill="#2a2118" />
          <path d={`M${cx - 7} 50 Q${cx} 45.5 ${cx + 7} 50`} stroke="#241f1a" strokeWidth={1.6} fill="none" strokeLinecap="round" />
        </g>
      );
    }
    if (style === 'wide') {
      return (
        <g>
          <ellipse cx={cx} cy={50} rx={7} ry={5.4} fill="#fdfdfd" />
          <circle cx={cx} cy={50} r={3.4} fill="#2a2118" />
          <circle cx={cx + 1.2} cy={48.6} r={1.1} fill="#fff" opacity={0.85} />
          <path d={`M${cx - 7} 49.6 Q${cx} 43.6 ${cx + 7} 49.6`} stroke="#241f1a" strokeWidth={1.8} fill="none" strokeLinecap="round" />
        </g>
      );
    }
    if (style === 'sleepy') {
      return (
        <g>
          <path d={`M${cx - 6.5} 50.5 Q${cx} 47 ${cx + 6.5} 50.5 Q${cx} 53.5 ${cx - 6.5} 50.5 Z`} fill="#fdfdfd" />
          <circle cx={cx} cy={50.4} r={2.5} fill="#2a2118" />
          <path d={`M${cx - 7} 50 Q${cx} 47 ${cx + 7} 50`} stroke="#241f1a" strokeWidth={2.2} fill="none" strokeLinecap="round" />
        </g>
      );
    }
    return (
      <g>
        <ellipse cx={cx} cy={50} rx={6.4} ry={4.6} fill="#fdfdfd" />
        <circle cx={cx} cy={50} r={2.9} fill="#2a2118" />
        <circle cx={cx + 1} cy={48.8} r={0.95} fill="#fff" opacity={0.8} />
        <path d={`M${cx - 6.6} 49.4 Q${cx} 44.6 ${cx + 6.6} 49.4`} stroke="#241f1a" strokeWidth={1.7} fill="none" strokeLinecap="round" />
      </g>
    );
  };
  return <>{eye(46)}{eye(74)}</>;
}

/** Nose as a shaded plane + nostril shadow, not an outlined wedge. */
function NoseShape({ style, shadow, deep }: { style: NoseStyle; shadow: string; deep: string }) {
  if (style === 'small') {
    return (
      <g>
        <path d="M58 55 Q60 61 63 62" stroke={shadow} strokeWidth={2} fill="none" strokeLinecap="round" />
        <ellipse cx={60} cy={63} rx={3.6} ry={1.5} fill={deep} opacity={0.5} />
      </g>
    );
  }
  if (style === 'wide') {
    return (
      <g>
        <path d="M56 54 Q54 62 60 65 Q66 62 64 54 Z" fill={shadow} opacity={0.75} />
        <ellipse cx={55.5} cy={63.5} rx={2.4} ry={1.5} fill={deep} opacity={0.6} />
        <ellipse cx={64.5} cy={63.5} rx={2.4} ry={1.5} fill={deep} opacity={0.6} />
      </g>
    );
  }
  return (
    <g>
      <path d="M57.5 54 Q56 62 60 64.5 Q64 62 62.5 54 Z" fill={shadow} opacity={0.72} />
      <ellipse cx={57} cy={63} rx={2} ry={1.3} fill={deep} opacity={0.55} />
      <ellipse cx={63} cy={63} rx={2} ry={1.3} fill={deep} opacity={0.55} />
    </g>
  );
}

function MouthShape({ style }: { style: MouthStyle }) {
  if (style === 'smile') {
    return (
      <g>
        <path d="M49 70 Q60 79 71 70 Q60 74 49 70 Z" fill="#5e2b2b" />
        <path d="M51 70.8 Q60 73.5 69 70.8 Q60 72 51 70.8 Z" fill="#fff" opacity={0.75} />
      </g>
    );
  }
  if (style === 'smirk') return <path d="M49 71.5 Q59 75 70 68.5" stroke="#5e2b2b" strokeWidth={2.6} fill="none" strokeLinecap="round" />;
  if (style === 'frown') return <path d="M49 74 Q60 67 71 74" stroke="#5e2b2b" strokeWidth={2.6} fill="none" strokeLinecap="round" />;
  return <path d="M50 71 Q60 72.4 70 71" stroke="#5e2b2b" strokeWidth={2.6} fill="none" strokeLinecap="round" />;
}

function FacialHairShape({ style, color }: { style: string; color: string }) {
  if (style === 'mustache') return <path d="M49 66.5 Q54 63.5 60 66 Q66 63.5 71 66.5 Q60 70 49 66.5 Z" fill={color} opacity={0.92} />;
  if (style === 'goatee') {
    return (
      <g fill={color} opacity={0.92}>
        <path d="M49 66.5 Q54 63.5 60 66 Q66 63.5 71 66.5 Q60 70 49 66.5 Z" />
        <path d="M53 75 Q60 88 67 75 Q60 80 53 75 Z" />
      </g>
    );
  }
  if (style === 'beard') {
    return (
      <g>
        <path d="M32 52 Q30 76 60 84 Q90 76 88 52 Q90 70 76 79 Q60 85 44 79 Q30 70 32 52 Z" fill={color} opacity={0.93} />
        <path d="M49 66.5 Q54 63.5 60 66 Q66 63.5 71 66.5 Q60 70 49 66.5 Z" fill={color} />
      </g>
    );
  }
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
