import type { ReactNode } from 'react';

/**
 * ===========================================================================
 * TEAM MARKS — one hand-drawn glyph per league nickname
 * ===========================================================================
 * `lib/gen/teamLogo.ts` derives a crest (colour pair, shape, pattern) from the
 * team id. That is identity, but it is not *meaning*: the Minneapolis Norsemen
 * got a random hexagon exactly like everyone else. This table adds the missing
 * half — the thing inside the crest that says which club it is.
 *
 * Because `TEAM_SEEDS` is a fixed set of 32 nicknames, the right answer is not
 * a cleverer generator, it is 32 drawings. Each mark is:
 *
 *   - a pure function of the nickname (derive, never store — no schema change,
 *     retroactive for every league that already exists),
 *   - flat inline SVG in the 100x100 crest viewBox, no gradients, no images,
 *   - drawn inside a safe area of roughly x 14..86 / y 8..72, which is above
 *     the abbreviation banner and survives every pattern overlay,
 *   - drawn for the SMALL end first. `TeamLogo` renders at 20-56px far more
 *     often than at 220px, so these are silhouettes: few paths, nothing
 *     thinner than ~4 units, detail only where it survives being 30px wide.
 *
 * A mark takes (accent, primary): `accent` is the crest's existing accent
 * colour and does all the drawing; `primary` is the crest field colour, used
 * only to knock holes back out of a shape (an eye, a bell crack, road
 * markings). No mark introduces a colour of its own.
 *
 * Unknown nickname -> `teamMark()` returns null and `TeamLogo` renders exactly
 * what it rendered before this file existed. Custom team names must never get
 * a blank crest.
 * ===========================================================================
 */

export type TeamMarkFn = (accent: string, primary: string) => ReactNode;

// ---------------------------------------------------------------------------
// The marks
// ---------------------------------------------------------------------------

const MARKS: Record<string, TeamMarkFn> = {
  // Boston Minutemen — tricorn hat
  minutemen: (c, bg) => (
    <>
      <path d="M50 8 Q72 8 76 40 Q50 50 24 40 Q28 8 50 8 Z" fill={c} />
      <path d="M8 44 Q50 30 92 44 Q78 68 50 68 Q22 68 8 44 Z" fill={c} />
      <path d="M26 38 Q50 46 74 38 L75 44 Q50 53 25 44 Z" fill={bg} />
    </>
  ),

  // New York Aviators — propeller
  aviators: (c, bg) => (
    <>
      {[0, 120, 240].map((a) => (
        <path key={a} d="M43 40 L46 8 Q50 2 54 8 L57 40 Z" fill={c} transform={`rotate(${a} 50 42)`} />
      ))}
      <circle cx={50} cy={42} r={13} fill={c} />
      <circle cx={50} cy={42} r={5} fill={bg} />
    </>
  ),

  // Miami Watermen — crossed oars
  //
  // The blades have to be flat paddles: draw them as tapered ovals and the
  // pair reads as a sprouting seedling, not a pair of oars.
  watermen: (c) => (
    <>
      {[-42, 42].map((a) => (
        <g key={a} transform={`rotate(${a} 50 44)`}>
          <path d="M36 4 h28 a5 5 0 0 1 5 5 v24 a5 5 0 0 1 -5 5 h-28 a5 5 0 0 1 -5 -5 v-24 a5 5 0 0 1 5 -5 z" fill={c} />
          <path d="M44 34 h12 v44 h-12 z" fill={c} />
        </g>
      ))}
      <g fill="none" stroke={c} strokeWidth={6} strokeLinecap="round">
        <path d="M14 76 Q26 68 38 76 Q50 84 62 76 Q74 68 86 76" />
      </g>
    </>
  ),

  // Buffalo Ironsides — armoured gauntlet
  ironsides: (c, bg) => (
    <>
      <path d="M28 34 Q28 24 40 24 L64 24 Q80 24 80 40 L80 54 Q80 68 64 68 L36 68 Q28 68 28 58 Z" fill={c} />
      <circle cx={38} cy={30} r={8} fill={c} />
      <circle cx={52} cy={26} r={9} fill={c} />
      <circle cx={66} cy={28} r={8} fill={c} />
      <path d="M12 34 L28 28 L28 62 L12 56 Z" fill={c} />
      <rect x={44} y={38} width={4} height={16} fill={bg} />
      <rect x={58} y={38} width={4} height={16} fill={bg} />
    </>
  ),

  // Pittsburgh Forgers — anvil under sparks
  forgers: (c) => (
    <>
      <path d="M20 40 L70 40 L86 48 L70 52 L62 52 L62 58 L70 66 L70 72 L30 72 L30 66 L38 58 L38 52 L20 50 Z" fill={c} />
      <path d="M50 8 L56 20 L50 26 L44 20 Z" fill={c} />
      <path d="M26 16 L31 25 L26 30 L21 25 Z" fill={c} />
      <path d="M74 16 L79 25 L74 30 L69 25 Z" fill={c} />
    </>
  ),

  // Cleveland Gales — funnel
  //
  // Wind is the hardest of the 32 to draw: three streaked lines read as
  // scribble, and a spiral reads as the Aviators' propeller. A funnel cloud is
  // a silhouette, which is what survives at 40px.
  gales: (c, bg) => (
    <>
      <path d="M6 8 C30 0 70 0 94 8 C86 26 68 34 62 48 C56 62 56 76 60 90 L48 82 C44 68 46 56 40 46 C32 32 14 24 6 8 Z" fill={c} />
      <g stroke={bg} strokeWidth={5} fill="none" strokeLinecap="round">
        <path d="M18 18 Q50 26 80 18" />
        <path d="M34 36 Q50 42 66 34" />
      </g>
    </>
  ),

  // Cincinnati Aeronauts — hot air balloon
  aeronauts: (c, bg) => (
    <>
      <path d="M50 6 C72 6 84 24 78 42 C74 52 62 58 50 64 C38 58 26 52 22 42 C16 24 28 6 50 6 Z" fill={c} />
      <path d="M46 8 q-8 26 4 54 h-2 q-14 -28 -6 -54 z" fill={bg} />
      <path d="M60 12 q6 24 -6 50 h-2 q12 -26 6 -50 z" fill={bg} />
      <path d="M40 66 h20 l-3 10 h-14 z" fill={c} />
    </>
  ),

  // Baltimore Clippers — clipper under sail
  clippers: (c) => (
    <>
      <path d="M53 8 L78 56 L53 56 Z" fill={c} />
      <path d="M47 16 L26 56 L47 56 Z" fill={c} />
      <path d="M14 60 L86 60 L74 76 L26 76 Z" fill={c} />
    </>
  ),

  // Houston Stingrays — manta gliding
  //
  // Two passes drew this as one continuous dome and both read as a mushroom.
  // The wings have to be separate swept panels with the tips *below* the body
  // and a notch between wing and body.
  stingrays: (c, bg) => (
    <>
      <path d="M46 18 C30 22 14 38 2 62 C18 54 32 48 44 50 Z" fill={c} />
      <path d="M54 18 C70 22 86 38 98 62 C82 54 68 48 56 50 Z" fill={c} />
      <path d="M50 10 C58 10 64 24 64 40 C64 54 58 64 50 66 C42 64 36 54 36 40 C36 24 42 10 50 10 Z" fill={c} />
      <path d="M47 62 L46 92 L50 84 L54 92 L53 62 Z" fill={c} />
      <circle cx={44} cy={26} r={3.4} fill={bg} />
      <circle cx={56} cy={26} r={3.4} fill={bg} />
    </>
  ),

  // Nashville Ramblers — the open road
  //
  // First pass drew this in perspective (a trapezoid narrowing to a horizon)
  // and it read as a capital A at every size. A winding road cannot be
  // mistaken for a letter.
  ramblers: (c, bg) => (
    <>
      <path
        d="M34 76 C34 58 68 56 68 42 C68 28 46 26 46 8"
        fill="none" stroke={c} strokeWidth={26} strokeLinecap="round"
      />
      <path
        d="M34 76 C34 58 68 56 68 42 C68 28 46 26 46 8"
        fill="none" stroke={bg} strokeWidth={5} strokeDasharray="9 10" strokeLinecap="butt"
      />
    </>
  ),

  // Indianapolis Defenders — rampart
  defenders: (c, bg) => (
    <>
      <path d="M16 32 h68 v40 h-68 z" fill={c} />
      <path d="M16 20 h14 v12 h-14 z M40 20 h20 v12 h-20 z M70 20 h14 v12 h-14 z" fill={c} />
      <path d="M46 42 h8 v14 h-8 z" fill={bg} />
      <circle cx={50} cy={42} r={5} fill={bg} />
    </>
  ),

  // Jacksonville Coilers — rearing serpent
  coilers: (c, bg) => (
    <>
      <path
        d="M28 74 Q64 72 64 58 Q64 47 44 44 Q26 41 28 30 Q30 18 46 17"
        fill="none" stroke={c} strokeWidth={12} strokeLinecap="round"
      />
      <path d="M44 8 L72 17 L44 26 Z" fill={c} />
      <path d="M72 17 L88 12 L80 17 L88 22 Z" fill={c} />
      <circle cx={54} cy={15} r={2.6} fill={bg} />
    </>
  ),

  // Denver Summit — peak and flag
  summit: (c, bg) => (
    <>
      <path d="M12 72 L36 34 L48 50 L62 20 L88 72 Z" fill={c} />
      <path d="M62 20 L53 39 L58 36 L63 42 L68 36 L73 39 Z" fill={bg} />
      <rect x={60} y={6} width={4} height={18} fill={c} />
      <path d="M64 7 L80 12 L64 17 Z" fill={c} />
    </>
  ),

  // Las Vegas Prospectors — pickaxe
  prospectors: (c) => (
    <>
      <path d="M12 36 Q50 6 88 36 Q50 22 12 36 Z" fill={c} />
      <rect x={45} y={26} width={10} height={48} fill={c} />
    </>
  ),

  // Phoenix Roadrunners — running bird
  roadrunners: (c, bg) => (
    <>
      {/* tail, body, head, beak, crest — the four things that say "roadrunner" */}
      <path d="M34 44 L6 20 L14 38 L4 44 L32 54 Z" fill={c} />
      <path d="M28 44 C28 33 40 27 52 29 C62 31 66 37 66 44 C66 52 56 58 44 58 C34 58 28 52 28 44 Z" fill={c} />
      <circle cx={68} cy={26} r={11} fill={c} />
      <path d="M76 22 L96 27 L76 32 Z" fill={c} />
      <path d="M64 16 L58 2 L68 12 L72 0 L76 14 Z" fill={c} />
      <circle cx={71} cy={24} r={3} fill={bg} />
      <g stroke={c} strokeWidth={6} strokeLinecap="round" fill="none">
        <path d="M44 56 L38 72 L26 74" />
        <path d="M56 55 L58 72 L70 74" />
      </g>
    </>
  ),

  // Kansas City Riverboats — paddlewheel
  riverboats: (c, bg) => (
    <>
      <circle cx={50} cy={36} r={22} fill={c} />
      <circle cx={50} cy={36} r={7} fill={bg} />
      {[0, 45, 90, 135].map((a) => (
        <rect key={a} x={20} y={33} width={60} height={6} fill={bg} transform={`rotate(${a} 50 36)`} />
      ))}
      <path d="M14 62 Q26 54 38 62 Q50 70 62 62 Q74 54 86 62 L86 72 Q74 64 62 72 Q50 80 38 72 Q26 64 14 72 Z" fill={c} />
    </>
  ),

  // Philadelphia Bells — liberty bell
  bells: (c, bg) => (
    <>
      <path d="M42 10 h16 v7 q17 11 19 37 h-54 q2 -26 19 -37 z" fill={c} />
      <rect x={18} y={56} width={64} height={9} rx={2} fill={c} />
      <circle cx={50} cy={72} r={6} fill={c} />
      <path d="M48 22 l6 8 l-6 8 l6 8 l-5 8 h-4 l5 -8 l-6 -8 l6 -8 l-6 -8 z" fill={bg} />
    </>
  ),

  // Washington Sentinels — watchtower
  sentinels: (c, bg) => (
    <>
      <path d="M32 72 L38 32 h24 l6 40 Z" fill={c} />
      <path d="M26 20 h48 v12 h-48 z" fill={c} />
      <path d="M26 12 h10 v8 h-10 z M45 12 h10 v8 h-10 z M64 12 h10 v8 h-10 z" fill={c} />
      <path d="M44 40 h12 v14 h-12 z" fill={bg} />
      <path d="M6 22 l16 4 l-16 4 z M94 22 l-16 4 l16 4 z" fill={c} />
    </>
  ),

  // Dallas Wildcatters — a well coming in
  //
  // A derrick drawn tall is a capital A at any size, crossbars or not. Keep it
  // squat and braced, and let the gusher — asymmetric, off to one side — be
  // the silhouette that carries the mark.
  wildcatters: (c) => (
    <>
      <path d="M30 78 L38 44 L46 44 L40 78 Z M70 78 L62 44 L54 44 L60 78 Z" fill={c} />
      <path d="M38 50 L62 68 L58 74 L34 56 Z M62 50 L38 68 L42 74 L66 56 Z" fill={c} opacity={0.9} />
      <rect x={36} y={40} width={28} height={7} fill={c} />
      <path d="M44 42 C40 24 50 10 60 14 C66 2 84 4 84 18 C84 28 76 32 70 30 C68 22 58 22 54 42 Z" fill={c} />
      <circle cx={90} cy={26} r={5} fill={c} />
      <circle cx={80} cy={38} r={3.5} fill={c} />
    </>
  ),

  // New Jersey Highlanders — thistle
  //
  // Anything knocked out of the bulb (crosshatch, sepals) turns it into a
  // face. The bulb stays solid.
  highlanders: (c) => (
    <>
      <path d="M34 34 L28 10 L40 28 L44 4 L50 26 L56 4 L60 28 L72 10 L66 34 Z" fill={c} />
      <path d="M50 30 C63 30 71 40 71 51 C71 63 62 71 50 71 C38 71 29 63 29 51 C29 40 37 30 50 30 Z" fill={c} />
      <path d="M28 62 L8 70 L26 74 Z M72 62 L92 70 L74 74 Z" fill={c} />
    </>
  ),

  // Chicago Ironwolves — wolf head, long-snouted and narrow
  ironwolves: (c, bg) => (
    <>
      <path d="M50 80 L28 50 L22 10 L40 28 Q50 22 60 28 L78 10 L72 50 Z" fill={c} />
      <path d="M32 38 L45 43 L36 49 Z M68 38 L55 43 L64 49 Z" fill={bg} />
      <path d="M44 56 L56 56 L50 64 Z" fill={bg} />
      <path d="M40 66 L44 72 L50 68 L56 72 L60 66 L50 76 Z" fill={bg} />
    </>
  ),

  // Milwaukee Loggers — felling axe
  loggers: (c) => (
    <>
      <path d="M44 10 L62 4 Q88 16 84 46 Q68 32 48 36 Z" fill={c} />
      <path d="M40 28 L54 36 L30 80 L16 72 Z" fill={c} />
    </>
  ),

  // Detroit Ignition — spark
  ignition: (c) => (
    <>
      <path d="M58 6 L28 46 L44 46 L38 78 L72 34 L54 34 Z" fill={c} />
      <path d="M14 18 L28 30 L14 32 Z M86 20 L72 32 L86 34 Z M10 56 L24 58 L12 68 Z M90 56 L76 58 L88 68 Z" fill={c} />
    </>
  ),

  // Minneapolis Norsemen — horned helm
  norsemen: (c, bg) => (
    <>
      <path d="M22 44 C22 22 34 10 50 10 C66 10 78 22 78 44 L78 58 L22 58 Z" fill={c} />
      <path d="M46 40 h8 v30 h-8 z" fill={c} />
      <rect x={26} y={38} width={16} height={9} rx={2} fill={bg} />
      <rect x={58} y={38} width={16} height={9} rx={2} fill={bg} />
      <path d="M22 42 C8 36 4 20 10 8 C16 22 24 28 30 32 Z" fill={c} />
      <path d="M78 42 C92 36 96 20 90 8 C84 22 76 28 70 32 Z" fill={c} />
    </>
  ),

  // New Orleans Krewe — carnival mask
  krewe: (c, bg) => (
    <>
      <path d="M20 30 L24 8 L34 26 Z M44 26 L50 2 L56 26 Z M66 26 L76 8 L80 30 Z" fill={c} />
      <circle cx={24} cy={7} r={4} fill={c} />
      <circle cx={50} cy={3} r={4} fill={c} />
      <circle cx={76} cy={7} r={4} fill={c} />
      <path d="M8 34 Q50 22 92 34 Q90 56 70 64 Q57 69 50 58 Q43 69 30 64 Q10 56 8 34 Z" fill={c} />
      <path d="M20 40 Q30 32 42 40 Q30 48 20 40 Z" fill={bg} />
      <path d="M80 40 Q70 32 58 40 Q70 48 80 40 Z" fill={bg} />
    </>
  ),

  // Tampa Corsairs — crossed cutlasses
  corsairs: (c) => (
    <g transform="translate(50,41) scale(0.88) translate(-50,-41)">
      {[1, -1].map((s2) => (
        <g key={s2} transform={s2 === 1 ? undefined : 'translate(100,0) scale(-1,1)'}>
          {/* curved blade, hilt guard, pommel — the guard has to sit low or the
              two blades read as a V rather than a cross */}
          <path d="M30 58 C44 44 62 28 80 4 L90 12 C70 32 52 48 40 66 Z" fill={c} />
          <path d="M18 56 L34 72 L26 80 L10 64 Z" fill={c} />
          <circle cx={17} cy={76} r={6} fill={c} />
        </g>
      ))}
    </g>
  ),

  // Atlanta Blaze — flame
  blaze: (c) => (
    <path
      d="M50 6 Q61 26 59 37 Q68 33 68 24 Q81 42 74 57 Q67 74 50 76 Q33 74 26 57 Q19 42 32 24 Q32 33 41 37 Q39 26 50 6 Z"
      fill={c}
    />
  ),

  // Charlotte Pumas — big cat head, broad and rounded (the Ironwolves' head is
  // the narrow angular one; these two must not be the same animal at 40px)
  pumas: (c, bg) => (
    <>
      <path d="M14 24 L34 34 Q50 27 66 34 L86 24 L80 44 Q90 56 76 66 Q64 76 50 76 Q36 76 24 66 Q10 56 20 44 Z" fill={c} />
      <path d="M30 46 Q38 41 46 46 Q38 52 30 46 Z M70 46 Q62 41 54 46 Q62 52 70 46 Z" fill={bg} />
      <path d="M43 58 h14 l-7 7 z" fill={bg} />
      <g stroke={bg} strokeWidth={4} strokeLinecap="round">
        <path d="M40 64 L18 60 M40 68 L20 70 M60 64 L82 60 M60 68 L80 70" />
      </g>
    </>
  ),

  // San Francisco Prospect — a gold strike
  //
  // The first pass drew the pan itself, and a shallow bowl with three nuggets
  // in it reads as a smiling face. The nugget reads as gold on its own.
  prospect: (c, bg) => (
    <>
      <path d="M22 46 L32 26 L52 18 L72 26 L80 48 L70 66 L46 74 L26 64 Z" fill={c} />
      <g stroke={bg} strokeWidth={5} fill="none" strokeLinejoin="round">
        <path d="M32 26 L48 44 L72 26" />
        <path d="M48 44 L46 74" />
      </g>
      <path d="M80 4 L84 16 L96 20 L84 24 L80 36 L76 24 L64 20 L76 16 Z" fill={c} />
      <path d="M16 12 L19 20 L27 23 L19 26 L16 34 L13 26 L5 23 L13 20 Z" fill={c} />
    </>
  ),

  // Los Angeles Stars — star
  stars: (c) => (
    <path d="M50 8 L58.4 29 L80.9 30 L63.2 44 L69.1 66 L50 53.4 L30.9 66 L36.8 44 L19.1 30 L41.6 29 Z" fill={c} />
  ),

  // Seattle Cascades — falls over a ledge
  cascades: (c) => (
    <>
      <path d="M16 8 h68 v13 h-68 z" fill={c} />
      <path d="M20 21 h20 q-1 22 -10 36 q-9 -14 -10 -36 z" fill={c} />
      <path d="M41 21 h18 q-1 28 -9 44 q-8 -16 -9 -44 z" fill={c} />
      <path d="M60 21 h20 q-1 22 -10 36 q-9 -14 -10 -36 z" fill={c} />
      <path d="M8 66 Q24 57 40 66 Q54 74 68 66 Q81 58 92 66 L92 78 Q81 70 68 78 Q54 86 40 78 Q24 69 8 78 Z" fill={c} />
    </>
  ),

  // San Diego Privateers — cannon
  privateers: (c, bg) => (
    <>
      <g transform="rotate(-14 50 44)">
        <path d="M14 32 L64 30 L64 52 L14 50 Z" fill={c} />
        <path d="M62 26 L76 24 L76 58 L62 56 Z" fill={c} />
      </g>
      <path d="M10 52 L36 48 L24 74 L8 70 Z" fill={c} />
      <circle cx={40} cy={62} r={14} fill={c} />
      <circle cx={40} cy={62} r={4.5} fill={bg} />
      <circle cx={88} cy={16} r={8} fill={c} />
    </>
  ),
};

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Abbreviation -> nickname for the 32 seeded clubs, used only when a caller
 * has an abbreviation but no nickname to hand (which is every `TeamLogo` call
 * site that renders from a table row). Kept local rather than imported from
 * `lib/gen/names.ts` on purpose: `TeamLogo` renders inside client components,
 * and importing the seed module would drag the entire first/last-name corpus
 * and `NameRegistry` into the client bundle to read 32 strings.
 *
 * If `TEAM_SEEDS` ever changes, update this map — but nothing breaks if it
 * drifts, an unmatched abbreviation just falls back to the old letters-only
 * crest.
 */
const ABBR_TO_NICKNAME: Record<string, string> = {
  BOS: 'minutemen', NYA: 'aviators', MIA: 'watermen', BUF: 'ironsides',
  PIT: 'forgers', CLE: 'gales', CIN: 'aeronauts', BAL: 'clippers',
  HOU: 'stingrays', NSH: 'ramblers', IND: 'defenders', JAX: 'coilers',
  DEN: 'summit', LAS: 'prospectors', PHX: 'roadrunners', KCR: 'riverboats',
  PHI: 'bells', WAS: 'sentinels', DAL: 'wildcatters', NJH: 'highlanders',
  CHI: 'ironwolves', MIL: 'loggers', DET: 'ignition', MIN: 'norsemen',
  NOR: 'krewe', TAM: 'corsairs', ATL: 'blaze', CLT: 'pumas',
  SFO: 'prospect', LAX: 'stars', SEA: 'cascades', SDG: 'privateers',
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/**
 * Resolve a mark. Nickname wins; the abbreviation is the fallback for the many
 * call sites that only carry three letters. Returns null for anything unknown
 * — a custom club keeps today's crest rather than getting a wrong or empty one.
 */
export function teamMark(nickname?: string | null, abbr?: string | null): TeamMarkFn | null {
  if (nickname) {
    const hit = MARKS[norm(nickname)];
    if (hit) return hit;
  }
  if (abbr) {
    const key = ABBR_TO_NICKNAME[abbr.trim().toUpperCase()];
    if (key) return MARKS[key] ?? null;
  }
  return null;
}

/** Every nickname that has a mark — used by the crest contact sheet. */
export const MARKED_NICKNAMES = Object.keys(MARKS);
