import { TeamLogo } from '../TeamLogo';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';

export interface MastheadFact {
  label: string;
  value: string;
  /** Short qualifier under the number — a baseline, a share, a count. */
  detail?: string;
  /** Tailwind text color for the value. Omit for default ink. */
  color?: string;
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
  const accent = teamId ? generateTeamLogoParams(teamId).primary : undefined;
  // The strip sizes itself to the number of facts. A fixed 5-column grid left
  // a sixth fact stranded alone on a second row (Depth Chart), which read as
  // a layout bug rather than as a sixth number.
  const FACT_COLS: Record<number, string> = {
    1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3',
    4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6', 7: 'lg:grid-cols-7',
  };
  const factCols = FACT_COLS[facts.length] ?? 'lg:grid-cols-5';

  return (
    <div
      className="relative overflow-hidden rounded-md border shadow-card"
      style={{
        ['--team-accent' as never]: accent,
        borderColor: accent ? 'var(--team-accent)' : undefined,
        background: accent
          ? 'radial-gradient(ellipse 120% 140% at 100% 0%, color-mix(in srgb, var(--team-accent) 16%, transparent), transparent 70%)'
          : undefined,
      }}
    >
      {/* Stadium-light hash texture — the same device the Draft Day and Cap
          heroes already use, so this reads as the same family. */}
      <div
        className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage: 'repeating-linear-gradient(115deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 14px)',
          color: accent ?? '#f4f6fa',
        }}
      />
      {teamId && teamAbbr && (
        <TeamLogo seed={teamId} abbr={teamAbbr} size={220} className="watermark-logo opacity-[0.06] -right-14 -top-14" />
      )}

      {/* Identity and the numbers share one band. They used to be two stacked
          blocks — a tall title block, then a separate bordered fact strip —
          which cost ~150px of furniture on every one of the 14 pages that
          import this before any of the page's own content began. The title
          keeps display scale; everything around it got its padding back. */}
      <div className="relative flex flex-wrap items-end justify-between gap-x-6 gap-y-2 px-5 pt-3 pb-2.5">
        <div className="min-w-0">
          {eyebrow && <div className="section-eyebrow leading-none">{eyebrow}</div>}
          <h1
            className={`font-display font-extrabold text-2xl uppercase tracking-wide leading-none mt-1${accent ? ' text-team' : ''}`}
          >
            {title}
          </h1>
          {subtitle && <p className="text-muted text-xs mt-1.5 max-w-2xl">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0 ml-auto">{action}</div>}
      </div>

      {facts.length > 0 && (
        /* Dividers, not five bordered boxes — same job, a quarter of the ink. */
        <div className={`relative border-t border-line/60 grid grid-cols-2 sm:grid-cols-3 ${factCols} divide-x divide-line/40 bg-ink/30`}>
          {facts.map((f) => (
            <div key={f.label} className="px-4 py-2">
              <div className="section-eyebrow leading-none">{f.label}</div>
              <div className={`stat-value text-stat-sm leading-none mt-1 ${f.color ?? ''}`}>{f.value}</div>
              {f.detail && <div className="text-[11px] text-muted leading-tight mt-0.5">{f.detail}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
