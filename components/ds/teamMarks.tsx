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

  // Miami Watermen — crossed oars over water
  watermen: (c) => (
    <>
      {[-40, 40].map((a) => (
        <g key={a} transform={`rotate(${a} 50 44)`}>
          <path d="M50 2 Q62 14 60 30 Q50 39 40 30 Q38 14 50 2 Z" fill={c} />
          <path d="M45 30 h10 v46 h-10 z" fill={c} />
        </g>
      ))}
      <path d="M10 68 Q24 60 38 68 Q50 75 62 68 Q76 60 90 68 L90 78 Q76 70 62 78 Q50 85 38 78 Q24 70 10 78 Z" fill={c} />
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

  // Cleveland Gales — wind
  gales: (c) => (
    <g fill="none" stroke={c} strokeWidth={9} strokeLinecap="round">
      <path d="M16 24 H56 A11 11 0 1 0 45 13" />
      <path d="M16 44 H66 A12 12 0 1 1 54 56" />
      <path d="M20 64 H50 A10 10 0 1 0 40 54" />
    </g>
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

  // Houston Stingrays — ray
  stingrays: (c, bg) => (
    <>
      <path d="M50 12 C64 12 80 30 86 48 C72 44 60 46 50 50 C40 46 28 44 14 48 C20 30 36 12 50 12 Z" fill={c} />
      <path d="M46 46 q3 24 -8 34 l9 -3 q6 -14 6 -31 z" fill={c} />
      <circle cx={42} cy={26} r={3.5} fill={bg} />
      <circle cx={58} cy={26} r={3.5} fill={bg} />
    </>
  ),

  // Nashville Ramblers — the open road
  ramblers: (c, bg) => (
    <>
      <path d="M24 74 L42 16 L58 16 L76 74 Z" fill={c} />
      <rect x={47} y={22} width={6} height={10} fill={bg} />
      <rect x={46} y={40} width={8} height={12} fill={bg} />
      <rect x={45} y={60} width={10} height={14} fill={bg} />
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

  // Jacksonville Coilers — coiled serpent
  coilers: (c) => (
    <>
      <g fill="none" stroke={c} strokeWidth={10} strokeLinecap="round">
        <path d="M74 50 A24 24 0 1 1 50 26 A14 14 0 1 0 36 40" />
      </g>
      <path d="M74 50 L88 42 L86 58 Z" fill={c} />
      <path d="M74 12 L82 22 L74 24 Z" fill={c} />
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
      <path d="M30 40 Q30 28 44 26 L48 12 L54 24 L66 18 L60 30 Q74 34 74 46 L88 34 L80 54 L64 58 L56 74 L48 62 L40 74 L36 58 Q30 52 30 40 Z" fill={c} />
      <circle cx={44} cy={34} r={3.5} fill={bg} />
      <path d="M8 40 h16 v6 h-16 z M6 54 h14 v6 h-14 z" fill={c} />
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

  // Dallas Wildcatters — gusher off a derrick
  wildcatters: (c) => (
    <>
      <path d="M50 4 Q64 14 60 26 Q56 34 50 36 Q44 34 40 26 Q36 14 50 4 Z" fill={c} />
      <path d="M24 74 L40 30 h20 L76 74 h-11 L53 38 h-6 L35 74 Z" fill={c} />
      <rect x={38} y={46} width={24} height={6} fill={c} />
      <rect x={32} y={60} width={36} height={6} fill={c} />
    </>
  ),

  // New Jersey Highlanders — thistle
  highlanders: (c, bg) => (
    <>
      <path d="M50 30 L42 8 L47 22 L50 4 L53 22 L58 8 Z" fill={c} />
      <path d="M34 12 L44 26 L38 28 Z M66 12 L56 26 L62 28 Z" fill={c} />
      <path d="M50 28 C63 28 70 38 70 48 C70 60 61 68 50 68 C39 68 30 60 30 48 C30 38 37 28 50 28 Z" fill={c} />
      <path d="M38 40 L62 56 M62 40 L38 56" stroke={bg} strokeWidth={4} />
      <path d="M28 62 L10 72 L28 74 Z M72 62 L90 72 L72 74 Z" fill={c} />
    </>
  ),

  // Chicago Ironwolves — wolf head
  ironwolves: (c, bg) => (
    <>
      <path d="M50 76 L24 48 L18 14 L38 30 Q50 24 62 30 L82 14 L76 48 Z" fill={c} />
      <path d="M32 40 L44 44 L36 50 Z M68 40 L56 44 L64 50 Z" fill={bg} />
      <path d="M46 58 h8 l-4 6 z" fill={bg} />
    </>
  ),

  // Milwaukee Loggers — axe in a log
  loggers: (c, bg) => (
    <>
      <path d="M56 6 L70 10 Q86 22 80 40 Q68 30 56 34 Z" fill={c} />
      <path d="M52 26 L62 34 L34 70 L24 62 Z" fill={c} />
      <path d="M14 62 h60 a9 9 0 0 1 0 18 h-60 a9 9 0 0 1 0 -18 z" fill={c} />
      <circle cx={74} cy={71} r={5} fill={bg} />
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
      <path d="M26 8 L34 22 L42 10 L48 22 L56 8 L62 22 L70 10 L76 24 L24 24 Z" fill={c} />
      <path d="M14 30 Q50 20 86 30 Q86 56 66 66 Q55 71 50 60 Q45 71 34 66 Q14 56 14 30 Z" fill={c} />
      <ellipse cx={34} cy={42} rx={10} ry={7} fill={bg} />
      <ellipse cx={66} cy={42} rx={10} ry={7} fill={bg} />
    </>
  ),

  // Tampa Corsairs — crossed cutlasses
  corsairs: (c) => (
    <>
      {[1, -1].map((s) => (
        <g key={s} transform={s === 1 ? undefined : 'translate(100,0) scale(-1,1)'}>
          <path d="M16 72 Q40 46 76 22 L84 32 Q50 52 26 78 Z" fill={c} />
          <path d="M14 60 L30 76 L22 84 L6 68 Z" fill={c} />
        </g>
      ))}
    </>
  ),

  // Atlanta Blaze — flame
  blaze: (c) => (
    <path
      d="M50 6 Q61 26 59 37 Q68 33 68 24 Q81 42 74 57 Q67 74 50 76 Q33 74 26 57 Q19 42 32 24 Q32 33 41 37 Q39 26 50 6 Z"
      fill={c}
    />
  ),

  // Charlotte Pumas — big cat head
  pumas: (c, bg) => (
    <>
      <path d="M18 26 L36 34 Q50 26 64 34 L82 26 L78 46 Q86 56 74 64 Q62 74 50 74 Q38 74 26 64 Q14 56 22 46 Z" fill={c} />
      <path d="M34 44 L46 48 L34 54 Z M66 44 L54 48 L66 54 Z" fill={bg} />
      <path d="M44 60 h12 l-6 8 z" fill={bg} />
    </>
  ),

  // San Francisco Prospect — panning for gold
  prospect: (c) => (
    <>
      <path d="M12 34 Q12 72 50 72 Q88 72 88 34" fill="none" stroke={c} strokeWidth={9} strokeLinecap="round" />
      <circle cx={38} cy={50} r={8} fill={c} />
      <circle cx={56} cy={56} r={7} fill={c} />
      <circle cx={64} cy={42} r={6} fill={c} />
      <path d="M24 8 L28 18 L38 22 L28 26 L24 36 L20 26 L10 22 L20 18 Z" fill={c} />
    </>
  ),

  // Los Angeles Stars — star
  stars: (c) => (
    <path d="M50 8 L58.4 29 L80.9 30 L63.2 44 L69.1 66 L50 53.4 L30.9 66 L36.8 44 L19.1 30 L41.6 29 Z" fill={c} />
  ),

  // Seattle Cascades — waterfall
  cascades: (c, bg) => (
    <>
      <path d="M14 12 h72 v12 h-72 z" fill={c} />
      <path d="M22 24 h16 q0 22 -8 34 q-8 -12 -8 -34 z" fill={c} />
      <path d="M42 24 h16 q0 26 -8 40 q-8 -14 -8 -40 z" fill={c} />
      <path d="M62 24 h16 q0 22 -8 34 q-8 -12 -8 -34 z" fill={c} />
      <path d="M12 64 Q26 56 40 64 Q54 72 68 64 Q80 57 90 64 L90 74 Q80 67 68 74 Q54 82 40 74 Q26 66 12 74 Z" fill={c} />
      <path d="M30 30 v18 M50 30 v22 M70 30 v18" stroke={bg} strokeWidth={4} />
    </>
  ),

  // San Diego Privateers — cannon
  privateers: (c, bg) => (
    <>
      <path d="M18 30 h48 v18 h-48 z" fill={c} />
      <path d="M66 26 h12 v26 h-12 z" fill={c} />
      <path d="M14 48 L34 48 L18 70 L6 66 Z" fill={c} />
      <circle cx={44} cy={62} r={13} fill={c} />
      <circle cx={44} cy={62} r={4} fill={bg} />
      <circle cx={84} cy={64} r={9} fill={c} />
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
