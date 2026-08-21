import { generateAvatarParams, NEUTRAL_MASS, HairStyle, EyeStyle, EyebrowStyle, NoseStyle, MouthStyle, FaceShape, FacialHair } from '@/lib/gen/avatar';

interface Props {
  seed: string;
  age?: number;
  size?: number;
  teamColor?: string;
  className?: string;
  /**
   * The player's listed body. All optional and all silhouette-only — they
   * change the proportions the face is drawn at, never which face it is.
   * Omitting them lands on the neutral build the portrait has always used, so
   * a call site that passes nothing renders exactly what it rendered before
   * these existed. See lib/gen/avatar.ts for the positional norms.
   */
  weightLb?: number;
  heightIn?: number;
  position?: string;
}

/**
 * Renders the face described in lib/gen/avatar.ts as layered SVG. Pure
 * function of (seed, age, body) — see avatar.ts for why nothing is stored.
 *
 * Styled as a portrait rather than a sticker: the bust sits in a tinted
 * frame with shoulder pads filling the base, the head is proportioned closer
 * to life than to a bobblehead, and the face carries real shading (jaw, brow,
 * neck shadow) instead of reading flat. Detail is deliberately kept bold —
 * this is drawn at 20px in roster tables as often as at 128px on a player
 * card, so silhouette has to survive when the fine strokes vanish.
 *
 * Which is exactly why weight and age are spent on the silhouette and nothing
 * else. A 330 lb nose tackle and a 178 lb kicker used to get the same neck,
 * the same shoulders and the same jaw while the line of text beside them said
 * otherwise; now shoulder span, neck width and jaw width all scale off mass,
 * so the heavy man reads heavy in the first ten pixels — before a single
 * facial feature resolves. Everything above the jaw (eyes, brows, nose, mouth,
 * hair, beard, skin) is untouched and stays at fixed coordinates: the same
 * seed gets the same face it always got, re-proportioned.
 */
export function PlayerAvatar({ seed, age = 26, size = 56, teamColor = '#3a4356', className, weightLb, heightIn, position }: Props) {
  const p = generateAvatarParams(seed, age, { weightLb, heightIn, position });
  const shadow = shade(p.skinTone, -0.16);
  const deep = shade(p.skinTone, -0.3);
  const uid = seed.replace(/[^a-zA-Z0-9]/g, '').slice(-10);

  // Signed deviation from the build every fixed coordinate below was drawn
  // for. d === 0 reproduces the original geometry to the pixel, so this whole
  // block is a no-op for a call site that passes no body.
  const d = p.mass - NEUTRAL_MASS;
  const f = p.frame;
  const S = FACE_METRICS[p.faceShape];

  // Skull barely moves — heads don't grow much with bodyweight. The jaw does,
  // and asymmetrically: a heavy man's jaw is where the weight shows, while a
  // light man's chin must not narrow to the point it reads soft (that failure
  // mode is the reason every shape squares off at the chin — see FACE_METRICS).
  const sw = S.sw * (1 + 0.09 * d) - 0.7 * f;
  const jw = Math.max(12.5, S.jw * (1 + (d >= 0 ? 0.6 : 0.34) * d));
  const cy = S.cheekY;
  const ta = S.taperY;
  const chy = S.chinY;
  const ty = S.topY;

  // The four that carry the read at 22px, where no facial detail survives:
  // neck thickness, how far the pads reach into the corners of the frame, how
  // high they sit, and how far the shoulder drops away from the neck — a
  // heavy man's traps run almost straight out to the pad, a light one's
  // clavicle falls away from it.
  const nw = 16 + 8 * d;
  const ox = 8 - 11 * d;
  const sy = 84 - 12 * d + 2 * f;
  const rise = 4 - 4 * d;

  // How much the skull grew or shrank against its own baseline. Ears and hair
  // ride on it, so at d === 0 it is exactly 1 and they sit exactly where they
  // always did — for all three face shapes, not just the square one.
  const skullK = sw / S.sw;

  // Hairline recession is cut OUT of the hair with a mask rather than painted
  // over it in skin: a skin-coloured wedge only lines up with the hair on some
  // styles, and where it overhung it left a spur of skin sticking out of the
  // side of his head. Subtracting can't do that on any style, at any size.
  const receding = p.recede > 0.12 && RECEDING_STYLES.has(p.hairStyle);
  const templeW = 10 + 16 * p.recede;

  const showFolds = age >= 33;
  const showFeet = age >= 30;
  const showBrowLines = age >= 31;

  const head = `M${n(60 - sw)} ${ty + 20} Q${n(60 - sw)} ${ty} 60 ${ty} Q${n(60 + sw)} ${ty} ${n(60 + sw)} ${ty + 20}`
    + ` L${n(60 + sw)} ${ta} Q${n(60 + sw)} ${chy - 5} ${n(60 + jw)} ${chy}`
    + ` L${n(60 - jw)} ${chy} Q${n(60 - sw)} ${chy - 5} ${n(60 - sw)} ${ta} Z`;

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
        {receding && (
          <mask id={`pa-hair-${uid}`}>
            <rect x={0} y={0} width={120} height={120} fill="#fff" />
            <Temple side={-1} sw={sw} topY={ty} w={templeW} />
            <Temple side={1} sw={sw} topY={ty} w={templeW} />
          </mask>
        )}
      </defs>

      <g clipPath={`url(#pa-clip-${uid})`}>
        <rect x={0} y={0} width={120} height={120} fill={`url(#pa-bg-${uid})`} />
        {/* Vignette floor so the bust doesn't float. */}
        <ellipse cx={60} cy={124} rx={62} ry={26} fill="#000" opacity={0.22} />

        {/* --- Bust: broad, high shoulder pads — pro-athlete bulk, not a
            thin jersey V. Shoulder points sit high and wide so the frame
            reads as built even at 20px, before any facial detail lands.
            How far they reach (ox) and how high they sit (sy) are the two
            biggest mass cues in the whole portrait at table size. */}
        <path
          d={`M${n(ox)} 120 Q${n(ox + 2)} ${n(sy + 8)} ${n(ox + 20)} ${n(sy)} L${n(60 - nw)} ${n(sy - rise)} Q60 ${n(sy + 7)} ${n(60 + nw)} ${n(sy - rise)} L${n(100 - ox)} ${n(sy)} Q${n(118 - ox)} ${n(sy + 8)} ${n(120 - ox)} 120 Z`}
          fill={`url(#pa-jersey-${uid})`}
        />
        {/* Pad seam + collar give the jersey structure at a glance. */}
        <path d={`M${n(ox + 20)} ${n(sy)} Q60 ${n(sy + 14)} ${n(100 - ox)} ${n(sy)}`} stroke={shade(teamColor, -0.4)} strokeWidth={1.5} fill="none" opacity={0.7} />
        <path d={`M${n(60 - nw)} ${n(sy - rise)} Q60 ${n(sy + 8)} ${n(60 + nw)} ${n(sy - rise)} L${n(60 + nw - 5)} ${n(sy - rise - 4)} Q60 ${n(sy - 2)} ${n(60 - nw + 5)} ${n(sy - rise - 4)} Z`} fill={shade(teamColor, -0.42)} />

        {/* --- Neck, set behind the jaw with a cast shadow. Thick on
            purpose — a trained neck is one of the strongest masculinity
            cues and it has to survive down to a 20px roster row, and it is
            also the single clearest place a 330 lb man differs from a
            180 lb one at that size. ------------------------------------- */}
        <path d={`M${n(60 - nw)} 64 L${n(60 - nw)} ${n(sy + 2)} Q60 ${n(sy + 10)} ${n(60 + nw)} ${n(sy + 2)} L${n(60 + nw)} 64 Z`} fill={shadow} />
        <path d={`M${n(60 - nw)} 64 L${n(60 - nw)} 74 Q60 84 ${n(60 + nw)} 74 L${n(60 + nw)} 64 Z`} fill={deep} opacity={0.55} />

        {/* Long hair is drawn BEHIND the head, not over it. Painted on top it
            fell across the cheeks and framed the face, which read unmistakably
            feminine regardless of how heavy the jaw underneath was. Behind the
            skull only the part wider than the head shows, which is how hair out
            the back of a helmet actually looks. */}
        {p.hairStyle === 'long' && (
          <g transform={xScale(skullK)}>
            <LongHairBack color={p.hairColor} />
          </g>
        )}

        {/* --- Ears — offset from centre by the skull's own scale, so they
            move out with a heavy man's head instead of detaching from it. */}
        <ellipse cx={n(60 - 32 * skullK)} cy={52} rx={5.5} ry={8.5} fill={p.skinTone} stroke={deep} strokeWidth={0.8} />
        <ellipse cx={n(60 + 32 * skullK)} cy={52} rx={5.5} ry={8.5} fill={p.skinTone} stroke={deep} strokeWidth={0.8} />

        {/* --- Head ------------------------------------------------------- */}
        <path d={head} fill={p.skinTone} stroke={deep} strokeWidth={0.8} />
        {/* Jaw/cheek shading — the single thing that stops it reading flat. */}
        <HeadShade sw={sw} cy={cy} chy={chy} color={shadow} />
        <JawLine shape={p.faceShape} jw={jw} color={deep} />
        {/* Second chin ridge — only the genuinely huge interior men get it. */}
        {p.mass > 0.66 && (
          <path d={`M${n(60 - jw + 2)} ${chy - 4} Q60 ${chy + 3} ${n(60 + jw - 2)} ${chy - 4}`} stroke={deep} strokeWidth={2} fill="none" opacity={0.3} strokeLinecap="round" />
        )}
        <FacialHairShape style={p.facialHair} color={p.hairColor} sw={sw} jw={jw} cy={cy} chy={chy} />
        <MouthShape style={p.mouthStyle} />
        <NoseShape style={p.noseStyle} shadow={shadow} deep={deep} />
        {/* Ageing, and only ageing: lines the youngest men never get. Every
            one of these is faint and sits at a fixed coordinate, so it costs
            nothing at 22px (where it simply vanishes) and reads as mileage at
            128px. */}
        {showFolds && (
          <g stroke={deep} strokeWidth={1.2} fill="none" opacity={0.3} strokeLinecap="round">
            <path d="M55 62 Q52 69 51.5 74" />
            <path d="M65 62 Q68 69 68.5 74" />
          </g>
        )}
        {/* Brow ridge shadow sits under the eyebrows, not on top of them —
            it's what reads as bone structure instead of a drawn-on line. */}
        <BrowRidge color={shadow} />
        <EyeShape style={p.eyeStyle} />
        {showFeet && (
          <g stroke={deep} strokeWidth={1} opacity={age >= 34 ? 0.34 : 0.2} strokeLinecap="round" fill="none">
            <path d="M39 49.5 L35 47.5" /><path d="M39 51.5 L34.5 51.5" /><path d="M39 53.5 L35 55.5" />
            <path d="M81 49.5 L85 47.5" /><path d="M81 51.5 L85.5 51.5" /><path d="M81 53.5 L85 55.5" />
          </g>
        )}
        <EyebrowShape style={p.eyebrowStyle} color={p.hairColor} />
        {showBrowLines && (
          <g stroke={deep} strokeWidth={1.1} opacity={age >= 35 ? 0.3 : 0.18} fill="none" strokeLinecap="round">
            <path d="M44 34 Q60 31 76 34" />
            <path d="M46 39 Q60 36.5 74 39" />
          </g>
        )}
        <g mask={receding ? `url(#pa-hair-${uid})` : undefined}>
          <g transform={xScale(skullK)}>
            <HairTop style={p.hairStyle} color={p.hairColor} />
          </g>
        </g>
      </g>
    </svg>
  );
}

/** One decimal is plenty in a 120-unit viewBox, and it keeps the markup short. */
function n(v: number): string {
  return v.toFixed(1);
}

/** Horizontal-only scale about the portrait's centre line. */
function xScale(k: number): string {
  return `translate(${n(60 - 60 * k)} 0) scale(${k.toFixed(4)} 1)`;
}

/**
 * The three head outlines, as numbers rather than hand-written paths, so mass
 * can move the jaw without a separate drawing per build. These values
 * reproduce the original square outline exactly and the oval/round ones to
 * within a unit or two; the shapes still read as distinct bone structure.
 *
 * All three resolve to a flat, squared-off chin instead of a tapered point — a
 * pointed jaw is the single strongest "soft/androgynous" signal at silhouette
 * level, so it's gone from every shape, not just 'square'. Jaw width (jw)
 * relative to skull width (sw) is doing most of that work: an earlier pass
 * leaned on facial hair to read male, which left the clean-shaven seeds — and
 * every long-hair one — reading feminine. Keeping the chin nearly as wide as
 * the cheekbones means the face reads male on its own and hair/beard only add
 * to it, and it is also the reason the light end of the mass range is damped:
 * a 170 lb corner gets a narrower jaw, not a chisel.
 */
const FACE_METRICS: Record<FaceShape, { sw: number; jw: number; taperY: number; cheekY: number; chinY: number; topY: number }> = {
  // sw/jw: skull and jaw half-width. taperY: where the straight side gives way
  // to the jaw. cheekY: where cheek shading and a beard start, which is a lower
  // line than the taper on the two rounder shapes. chinY/topY: the extremes.
  square: { sw: 30, jw: 19, taperY: 58, cheekY: 58, chinY: 84, topY: 20 },
  oval: { sw: 28.5, jw: 14, taperY: 44, cheekY: 60, chinY: 82, topY: 19 },
  round: { sw: 30, jw: 17, taperY: 46, cheekY: 57, chinY: 80, topY: 21 },
};

/** Chin/jaw break — a hard edge under the mouth reads as bone rather than cheek. */
function JawLine({ shape, jw, color }: { shape: FaceShape; jw: number; color: string }) {
  const y = shape === 'square' ? 78 : shape === 'oval' ? 77 : 76;
  const half = Math.max(8, jw - 4);
  return <path d={`M${n(60 - half)} ${y - 4} Q60 ${y + 3} ${n(60 + half)} ${y - 4}`} stroke={color} strokeWidth={1.4} fill="none" opacity={0.28} strokeLinecap="round" />;
}

/** Cheekbone + jaw shadow, shaped to the head so it never spills outside it. */
function HeadShade({ sw, cy, chy, color }: { sw: number; cy: number; chy: number; color: string }) {
  const L = 60 - sw + 1;
  const R = 60 + sw - 1;
  return (
    <>
      <path d={`M${n(L)} ${cy - 3} Q${n(L + 2)} ${chy - 6} 60 ${chy - 1} Q58 ${chy - 9} 54 ${chy - 15} Q${n(L + 7)} ${cy + 5} ${n(L)} ${cy - 3} Z`} fill={color} opacity={0.35} />
      <path d={`M${n(R)} ${cy - 3} Q${n(R - 2)} ${chy - 6} 60 ${chy - 1} Q62 ${chy - 9} 66 ${chy - 15} Q${n(R - 7)} ${cy + 5} ${n(R)} ${cy - 3} Z`} fill={color} opacity={0.35} />
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
          {[33, 42, 51, 60, 69, 78, 87].map((hx, i) => (
            <rect key={hx} x={hx - 3} y={28} width={6} height={i % 2 === 0 ? 30 : 24} rx={3} />
          ))}
        </g>
      );
    default:
      return null;
  }
}

/**
 * Hairline recession — the temples go first, so this is the shape bitten out of
 * the hair at each corner: full height at the skull's edge, tapering inward and
 * down to the brow. It leaves the centre where it was, which is what makes it
 * read as a receding hairline rather than a smaller hat. Deliberately separate
 * from the `bald` style: a 34-year-old with a `short` cut gets a receding
 * `short` cut, not swapped for a different man.
 *
 * Only the tight cuts get it. On the styles with real volume down the sides
 * (medium, long, curly, dreads) a temple bite doesn't read as a hairline at
 * all — it reads as a chunk missing from the side of his head — and a man
 * keeping that much hair at 35 is not the one you'd draw receding anyway.
 */
const RECEDING_STYLES: ReadonlySet<HairStyle> = new Set<HairStyle>(['buzz', 'short', 'part', 'flattop', 'ponytail']);

function Temple({ side, sw, topY, w }: { side: -1 | 1; sw: number; topY: number; w: number }) {
  // `side` is -1 for the left temple; the bite runs from the skull's edge
  // inward, i.e. against `side`.
  const edge = 60 + side * (sw + 2);
  const base = 42;
  return (
    <path
      d={`M${n(edge)} ${base} L${n(edge)} ${topY} Q${n(edge - side * w * 0.5)} ${n(topY + (base - topY) * 0.3)} ${n(edge - side * w)} ${base} Z`}
      fill="#000"
    />
  );
}

/**
 * Long hair falls behind the head and outside the jawline rather than down
 * over the cheeks. Hair that hugs the face is the single strongest feminine
 * cue in a simple portrait, and plenty of real players wear long hair out the
 * back of a helmet — this reads as that instead of as curtains.
 *
 * Deliberately stops above the jawline. Hair that reaches the shoulders reads
 * as curtains framing the face — the one silhouette that stayed feminine
 * through several passes at heavier jaws, forced facial hair and behind-the-head
 * layering. Kept as a bulk mass tucked behind the skull (a tied-back look)
 * so the style survives in the pool without that failure mode.
 */
function LongHairBack({ color }: { color: string }) {
  return <path d="M27 36 Q19 56 23 72 L37 70 Q31 54 34 36 Q60 24 86 36 Q89 54 83 70 L97 72 Q101 56 93 36 Q60 20 27 36 Z" fill={color} />;
}

/** Soft shadow band standing in for a protruding brow — bone structure the
 *  eyebrow line alone can't sell, and it still reads at 20px as a face that
 *  isn't flat under the forehead. */
function BrowRidge({ color }: { color: string }) {
  return <path d="M36 45.5 Q47 40 60 41 Q73 40 84 45.5 L82 49.5 Q60 43.5 38 49.5 Z" fill={color} opacity={0.22} />;
}

/** Heavier, lower, straighter than a default brow — sitting closer to the
 *  eye is a bigger masculinity cue than thickness alone, so the baseline
 *  moved down toward the lid instead of just getting a fatter stroke. */
function EyebrowShape({ style, color }: { style: EyebrowStyle; color: string }) {
  const brow = (cx: number, mirror: boolean) => {
    const flip = mirror ? -1 : 1;
    if (style === 'angled') return <path d={`M${cx - 9} 44 L${cx + 9} 41`} stroke={color} strokeWidth={3.6} strokeLinecap="round" transform={`rotate(${7 * flip} ${cx} 42.5)`} />;
    if (style === 'raised') return <path d={`M${cx - 9} 44 Q${cx} 39 ${cx + 9} 44`} stroke={color} strokeWidth={3.6} fill="none" strokeLinecap="round" />;
    return <path d={`M${cx - 9} 43 Q${cx} 41.5 ${cx + 9} 43`} stroke={color} strokeWidth={3.6} fill="none" strokeLinecap="round" />;
  };
  return <>{brow(46, true)}{brow(74, false)}</>;
}

/**
 * Almond eyes with a real upper lid, rather than a white circle with a dot —
 * the lid is what keeps a face from reading startled at every size. Sized
 * down and dropped half a pixel below the old baseline so they sit under
 * the brow ridge instead of floating wide open in the middle of the face.
 */
function EyeShape({ style }: { style: EyeStyle }) {
  const eye = (cx: number) => {
    if (style === 'narrow') {
      return (
        <g>
          <path d={`M${cx - 6.3} 51 Q${cx} 47 ${cx + 6.3} 51 Q${cx} 53.3 ${cx - 6.3} 51 Z`} fill="#fdfdfd" />
          <circle cx={cx} cy={50.6} r={2.3} fill="#2a2118" />
          <path d={`M${cx - 6.3} 51 Q${cx} 47 ${cx + 6.3} 51`} stroke="#241f1a" strokeWidth={1.7} fill="none" strokeLinecap="round" />
        </g>
      );
    }
    if (style === 'wide') {
      return (
        <g>
          <ellipse cx={cx} cy={51} rx={6.2} ry={4.6} fill="#fdfdfd" />
          <circle cx={cx} cy={51} r={3} fill="#2a2118" />
          <circle cx={cx + 1} cy={49.7} r={0.95} fill="#fff" opacity={0.85} />
          <path d={`M${cx - 6.2} 50.6 Q${cx} 45.2 ${cx + 6.2} 50.6`} stroke="#241f1a" strokeWidth={1.9} fill="none" strokeLinecap="round" />
        </g>
      );
    }
    if (style === 'sleepy') {
      return (
        <g>
          <path d={`M${cx - 5.8} 51.3 Q${cx} 48.3 ${cx + 5.8} 51.3 Q${cx} 54 ${cx - 5.8} 51.3 Z`} fill="#fdfdfd" />
          <circle cx={cx} cy={51.2} r={2.2} fill="#2a2118" />
          <path d={`M${cx - 6.3} 50.8 Q${cx} 48.3 ${cx + 6.3} 50.8`} stroke="#241f1a" strokeWidth={2.3} fill="none" strokeLinecap="round" />
        </g>
      );
    }
    return (
      <g>
        <ellipse cx={cx} cy={51} rx={5.7} ry={4} fill="#fdfdfd" />
        <circle cx={cx} cy={51} r={2.6} fill="#2a2118" />
        <circle cx={cx + 0.9} cy={49.9} r={0.85} fill="#fff" opacity={0.8} />
        <path d={`M${cx - 5.9} 50.4 Q${cx} 46.2 ${cx + 5.9} 50.4`} stroke="#241f1a" strokeWidth={1.8} fill="none" strokeLinecap="round" />
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
        <path d="M55 54 Q53 62 60 65 Q67 62 65 54 Z" fill={shadow} opacity={0.8} />
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

/**
 * Beard and stubble follow the jaw they sit on. The moustache doesn't — it's
 * pinned to the mouth, which doesn't move — so a heavy man gets a wider beard,
 * not a wider moustache.
 */
function FacialHairShape({ style, color, sw, jw, cy, chy }: { style: FacialHair; color: string; sw: number; jw: number; cy: number; chy: number }) {
  const L = 60 - sw + 1;
  const R = 60 + sw - 1;
  const tache = 'M49 66.5 Q54 63.5 60 66 Q66 63.5 71 66.5 Q60 70 49 66.5 Z';
  // Five-o'clock shadow: a low-opacity wash over the jaw rather than
  // drawn hairs, which is the only facial-hair treatment that still reads
  // correctly once it's shrunk to a 20px roster row.
  if (style === 'stubble') {
    return (
      <path
        d={`M${n(L)} ${cy - 3} Q${n(L - 1)} ${chy - 6} 60 ${chy} Q${n(R + 1)} ${chy - 6} ${n(R)} ${cy - 3} Q${n(R)} ${chy - 13} ${n(60 + jw - 2)} ${chy - 6} Q60 ${chy - 1} ${n(60 - jw + 2)} ${chy - 6} Q${n(L)} ${chy - 13} ${n(L)} ${cy - 3} Z`}
        fill={color}
        opacity={0.3}
      />
    );
  }
  if (style === 'mustache') return <path d={tache} fill={color} opacity={0.92} />;
  if (style === 'goatee') {
    return (
      <g fill={color} opacity={0.92}>
        <path d={tache} />
        <path d={`M${n(60 - goateeHalf(jw))} ${chy - 9} Q60 ${chy + 4} ${n(60 + goateeHalf(jw))} ${chy - 9} Q60 ${chy - 4} ${n(60 - goateeHalf(jw))} ${chy - 9} Z`} />
      </g>
    );
  }
  if (style === 'beard') {
    return (
      <g>
        <path
          d={`M${n(L - 1)} ${cy - 6} Q${n(L - 2)} ${chy - 4} 60 ${chy + 2} Q${n(R + 2)} ${chy - 4} ${n(R + 1)} ${cy - 6} Q${n(R + 1)} ${chy - 11} ${n(60 + jw - 1)} ${chy - 3} Q60 ${chy + 2} ${n(60 - jw + 1)} ${chy - 3} Q${n(L - 1)} ${chy - 11} ${n(L - 1)} ${cy - 6} Z`}
          fill={color}
          opacity={0.93}
        />
        <path d={tache} fill={color} />
      </g>
    );
  }
  return null;
}

/** A goatee widens with the jaw, but only about half as fast — it's a patch of
 *  chin hair, not a jaw-liner, and coupling it 1:1 made it a needle on the
 *  narrow faces. 7 is the original half-width, at the original square jaw. */
function goateeHalf(jw: number): number {
  return Math.max(5, 7 + 0.5 * (jw - 19));
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
