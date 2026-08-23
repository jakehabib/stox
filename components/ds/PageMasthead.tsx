import Link from 'next/link';
import { TeamLogo } from '../TeamLogo';
import { Tooltip } from '../Tooltip';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';

export interface MastheadFact {
  label: string;
  value: string;
  /** Short qualifier under the number — a baseline, a share, a count. */
  detail?: string;
  /**
   * Glossary text for the label. Use `tip('capSpace')` — never a hand-written
   * string, or the same term ends up explained two ways on two screens.
   */
  tip?: string;
  /** Tailwind text color for the value. Omit for default ink. */
  color?: string;
  /**
   * WHERE THIS NUMBER IS ACTED ON.
   *
   * A fact strip is where a screen names its own problems — "Open Starting
   * Slots: 2 — LT, K", "Expiring: 7". Every one of those was a bare div, so
   * the tile that knew the position and the severity was the one thing on the
   * page you could not click. Set this and the tile becomes the door.
   *
   * Only set it when the destination is somewhere ELSE. A tile that links to
   * the page it is sitting on is worse than an inert one: it promises a move
   * and delivers a reload. Leave it undefined and the tile renders exactly as
   * it always has.
   */
  href?: string;
}

/**
 * The standard page header for a front-office screen: a team-tinted band
 * carrying the page's identity at display scale, with an optional strip of
 * the numbers that page is actually about running along its base.
 *
 * This exists so every screen introduces itself the same way. The pattern was
 * built ad hoc on the Cap, Depth Chart and Free Agency pages first and then
 * duplicated; pulling it into one component is what makes the Team, Market
 * and Draft tabs feel like one product rather than a set of similar pages.
 */
export function PageMasthead({ teamId, teamAbbr, eyebrow, title, subtitle, action, facts = [] }: {
  /** Tints the band and supplies the watermark. Omit on a page with no single team in scope. */
  teamId?: string;
  teamAbbr?: string;
  eyebrow?: string;
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  facts?: MastheadFact[];
}) {
  const accent = teamId ? generateTeamLogoParams(teamAbbr ?? teamId).primary : undefined;

  return (
    <div
      className="relative rounded-lg border-2 shadow-elevated"
      style={{
        ['--team-accent' as never]: accent,
        borderColor: accent ? 'var(--team-accent)' : undefined,
        background: accent
          ? 'radial-gradient(ellipse 120% 140% at 100% 0%, color-mix(in srgb, var(--team-accent) 16%, transparent), transparent 70%)'
          : undefined,
      }}
    >
      {/* THE CLIP LIVES ON THE DECORATIONS, NOT ON THE CARD.
          The watermark crest hangs off the top-right corner and the hash
          texture runs to the edges, so both have to be cut to the rounded
          rect — but putting `overflow-hidden` on the card itself also cut the
          fact strip's tooltips, which open upward out of a band that has only
          ~100px of masthead above it. Same pixels, one layer lower. */}
      <div className="absolute inset-0 overflow-hidden rounded-lg pointer-events-none">
        {/* Stadium-light hash texture — the same device the Draft Day and Cap
            heroes already use, so this reads as the same family. */}
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: 'repeating-linear-gradient(115deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 14px)',
            color: accent ?? '#f4f6fa',
          }}
        />
        {teamId && teamAbbr && (
          <TeamLogo seed={teamId} abbr={teamAbbr} size={220} className="watermark-logo opacity-[0.06] -right-14 -top-14" />
        )}
      </div>

      <div className="relative flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div className="min-w-0">
          {eyebrow && <div className="label-sm">{eyebrow}</div>}
          <h1
            className={`font-display font-extrabold text-3xl uppercase tracking-wide leading-none mt-1${accent ? ' text-team' : ''}`}
          >
            {title}
          </h1>
          {subtitle && <p className="text-muted text-sm mt-2 max-w-2xl">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      {/* The fact strip is sized to the number of facts, not a fixed five.
          The Depth Chart passes six, which stranded the last one alone on a
          second row beside four empty cells. Tailwind needs whole class names
          to survive its scan, so this is a lookup rather than a template. */}
      {facts.length > 0 && (
        <div className={`relative border-t border-line/60 grid grid-cols-2 sm:grid-cols-3 divide-x divide-line/40 bg-ink/30 ${
          ({ 1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6' } as Record<number, string>)[facts.length] ?? 'lg:grid-cols-5'
        }`}>
          {facts.map((f) => {
            const body = (
              <>
                {/* Opens UPWARD, and must: this whole band sits inside the
                    masthead's `overflow-hidden`, so a bubble opening downward
                    off the bottom edge is clipped away to nothing. Above the
                    label there is always masthead to open into. */}
                <div className="label-sm inline-flex items-center gap-1.5">
                  {f.label}
                  {f.tip && <Tooltip text={f.tip} />}
                </div>
                <div className={`stat-value text-stat-sm leading-none mt-1 ${f.color ?? ''}`}>{f.value}</div>
                {f.detail && <div className="text-[11px] text-muted mt-1">{f.detail}</div>}
              </>
            );
            // No href, no Link — same markup, same padding, same everything an
            // unwired tile rendered before this existed. The hover tint is the
            // only signal that a tile is clickable, and it only appears where
            // there is genuinely somewhere to go.
            return f.href ? (
              <Link key={f.label} href={f.href} className="px-4 py-3 block hover:bg-raised/50 transition-colors">
                {body}
              </Link>
            ) : (
              <div key={f.label} className="px-4 py-3">{body}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
