import Link from 'next/link';
import { TeamLogo } from '../TeamLogo';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';

export interface FranchiseSeed {
  city: string;
  nickname: string;
  abbr: string;
  conference: string;
  division: string;
}

/**
 * The crest seed used everywhere a franchise is shown BEFORE a league exists.
 *
 * A real crest is a pure function of the team's database id (see
 * lib/gen/teamLogo.ts), and that id is a cuid minted during generation — so
 * nothing outside a league can reproduce it. This gives the pre-league
 * screens one stable seed instead of several, so the landing wall, the picker
 * and the setup panel all draw the SAME crest for a given club.
 *
 * The seed IS the abbreviation, which is what makes this a preview rather
 * than a guess. Crest colour and shape used to derive from the team row's
 * cuid, minted during league generation — so the club you picked was drawn
 * in one colour here and a different one in the league, and no pre-league
 * screen could have known. A franchise has colours; it does not re-roll them
 * every time somebody starts a save. See components/TeamLogo.tsx.
 */
export function previewCrestSeed(abbr: string): string {
  return abbr;
}

/** The colour a pre-league franchise is drawn in. Same seed as its crest. */
export function previewAccent(abbr: string): string {
  return generateTeamLogoParams(previewCrestSeed(abbr)).primary;
}

/**
 * All 32 crests as one board.
 *
 * This is the landing page's argument. Nothing else on the screen says "this
 * is a league" as fast as thirty-two hand-drawn marks sitting together, and
 * every tile is a live entry into team select rather than decoration — click
 * the Norsemen on the front door and you arrive at the picker with the
 * Norsemen already chosen.
 */
export function FranchiseWall({
  seeds,
  hrefFor,
  size = 54,
}: {
  seeds: FranchiseSeed[];
  /** Where a tile goes. Omit for a static, non-interactive wall. */
  hrefFor?: (s: FranchiseSeed) => string;
  size?: number;
}) {
  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-x-2 gap-y-3">
      {seeds.map((s, i) => {
        const inner = (
          <>
            <TeamLogo
              seed={previewCrestSeed(s.abbr)}
              abbr={s.abbr}
              nickname={s.nickname}
              size={size}
              className="shrink-0 drop-shadow"
            />
            <div className="min-w-0 w-full text-center">
              <div className="text-[10px] uppercase tracking-wider text-muted truncate leading-tight">{s.city}</div>
              <div className="font-display font-bold uppercase tracking-wide text-xs truncate leading-tight text-chalk/90">
                {s.nickname}
              </div>
            </div>
          </>
        );

        // Staggered entrance, motion-safe only: `motion-safe:` drops the
        // animation entirely for a reduced-motion viewer, so the delay below
        // never leaves a tile invisible.
        const style = { animationDelay: `${Math.min(i, 32) * 18}ms` } as React.CSSProperties;

        return hrefFor ? (
          <Link
            key={s.abbr}
            href={hrefFor(s)}
            style={style}
            className="group flex flex-col items-center gap-1.5 rounded-md px-1 py-2 transition-colors hover:bg-raised/60 motion-safe:animate-fadeUp"
            title={`${s.city} ${s.nickname} — ${s.conference} ${s.division}`}
          >
            {inner}
          </Link>
        ) : (
          <div key={s.abbr} style={style} className="flex flex-col items-center gap-1.5 px-1 py-2 motion-safe:animate-fadeUp">
            {inner}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A single quiet row of crests. Used on the sign-in / sign-up screens, whose
 * whole job is to not read as a bare authentication form dropped into the
 * middle of a game. Decorative and non-interactive on purpose — the one thing
 * these screens must not do is offer a second place to click.
 */
export function CrestRibbon({ seeds, size = 34 }: { seeds: FranchiseSeed[]; size?: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5 flex-wrap opacity-70" aria-hidden>
      {seeds.map((s) => (
        <TeamLogo key={s.abbr} seed={previewCrestSeed(s.abbr)} abbr={s.abbr} nickname={s.nickname} size={size} />
      ))}
    </div>
  );
}

/**
 * A drift of crests for the right-hand half of the landing hero.
 *
 * The hero was a column of type against 700px of nothing, which is the exact
 * failure the standing design principles name: a screen carrying no identity
 * has failed however well it reads. This fills it with the one asset the app
 * has that nobody else has — the hand-drawn marks — set back behind a fade so
 * it stays a backdrop and never competes with the headline.
 *
 * Decorative and inert: `aria-hidden`, no links, `pointer-events-none`. The
 * live, clickable board of all 32 is the section directly below the hero.
 * Which nine appear is a fixed slice, not a random draw — a front page that
 * reshuffles itself on every load reads as broken rather than as varied.
 */
// Read in grid order (3 columns). The LEFT column sits under the heaviest
// part of the fade, so it is the dimmest — giving it a high opacity there
// produced smudges behind the headline rather than depth.
const DRIFT_OPACITY = [
  'opacity-40', 'opacity-70', 'opacity-90',
  'opacity-30', 'opacity-60', 'opacity-80',
  'opacity-25', 'opacity-70', 'opacity-90',
];

export function CrestDrift({ seeds }: { seeds: FranchiseSeed[] }) {
  const nine = seeds.filter((_, i) => i % 3 === 1).slice(0, 9);
  return (
    <div className="hidden lg:block absolute right-0 top-0 bottom-0 w-[48%] pointer-events-none" aria-hidden>
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0 grid grid-cols-3 place-items-center gap-4 p-6"
          style={{ transform: 'rotate(-9deg) scale(1.18)' }}
        >
          {nine.map((s, i) => (
            <div key={s.abbr} className={DRIFT_OPACITY[i]}>
              <TeamLogo seed={previewCrestSeed(s.abbr)} abbr={s.abbr} nickname={s.nickname} size={104} className="drop-shadow" />
            </div>
          ))}
        </div>
      </div>
      {/* Fades into the copy column so the headline never sits on a crest. */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(90deg, var(--c-ink) 0%, color-mix(in srgb, var(--c-ink) 96%, transparent) 28%, color-mix(in srgb, var(--c-ink) 30%, transparent) 68%, color-mix(in srgb, var(--c-ink) 5%, transparent) 100%)' }}
      />
    </div>
  );
}
