import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TeamLogo } from '@/components/TeamLogo';
import { GmCardReveal } from '@/components/GmCardReveal';
import { RebuildCard } from '@/components/ds/RebuildCard';
import { SectionHeading } from '@/components/ds/SectionHeading';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { loadRebuildRun, type RebuildSeasonLine } from '@/lib/rebuildRun';

export const dynamic = 'force-dynamic';

const RESULT_LABEL: Record<string, string> = {
  MISSED: 'Missed the playoffs',
  WILDCARD: 'Lost in the Wild Card round',
  DIVISIONAL: 'Lost in the Divisional round',
  CONFERENCE: 'Lost the Conference Championship',
  RUNNER_UP: 'Lost the Championship',
  CHAMPION: 'CHAMPIONS',
};

/**
 * ===========================================================================
 * THE REBUILD, FINISHED — the one editorial screen in the app
 * ===========================================================================
 * Everything else in this game is decluttered and quiet on purpose. This is
 * the exception that quiet exists to make room for: a GM took the worst roster
 * in football, was refused every setting that could have made it easier, and
 * won a championship anyway. It gets a full screen and a hero number.
 *
 * WHAT IT IS AND IS NOT. It is the RECORD of the run, permanently reachable,
 * not a moment that fires once — components/ds/TrophyMoment.tsx already owns
 * the full-screen interruption and its budget is exactly one per season, which
 * this deliberately does not spend a second one of. The championship advance
 * routes here; so does the Settings screen; and it is here tomorrow, and next
 * year, exactly as it is today.
 *
 * EVERY FIGURE COMES FROM lib/rebuildRun.ts AND NOTHING IS COMPUTED HERE. The
 * page and the pop-out card print the same object, so the two cannot disagree
 * — which matters more than usual, because the card is the half that leaves
 * the game.
 *
 * A 404 UNLESS THE RUN WAS ACTUALLY WON UNDER THE RULES. Not an empty state,
 * not a teaser: there is nothing honest for this page to show a run that has
 * not finished, and a save that ended its ironman rules did not do the thing
 * this page celebrates.
 * ===========================================================================
 */
export default async function RebuildPage({ params }: { params: { id: string } }) {
  const run = await loadRebuildRun(params.id);
  if (!run) notFound();

  const { club, standing, totals, final } = run;
  const accent = generateTeamLogoParams(club.abbr).primary;
  const seasons = standing.seasonsToTitle!;
  const maxWins = Math.max(...run.seasons.map((s) => s.wins), 1);

  return (
    <div className="space-y-6" style={{ ['--team-accent' as never]: accent }}>
      {/* ---- The banner ---------------------------------------------------- */}
      <div
        className="relative overflow-hidden rounded-lg border-2"
        style={{
          borderColor: accent,
          background: `radial-gradient(ellipse 120% 170% at 12% 0%, color-mix(in srgb, ${accent} 26%, transparent), transparent 66%)`,
        }}
      >
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage: 'repeating-linear-gradient(115deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 14px)',
            color: accent,
          }}
        />
        <TeamLogo seed={club.id} abbr={club.abbr} size={340} className="watermark-logo opacity-[0.06] -right-16 -top-10" aria-hidden />

        <div className="relative px-6 py-8 sm:px-10 sm:py-10">
          <div className="label-sm text-gold">The Rebuild · {standing.tenureStartYear}–{standing.firstTitleYear}</div>
          <h1 className="font-display font-extrabold text-4xl sm:text-6xl uppercase tracking-wide leading-[0.92] mt-2">
            {club.city} {club.nickname}
            <span className="block text-gold">Champions</span>
          </h1>

          <div className="flex flex-wrap items-end gap-x-10 gap-y-5 mt-7">
            <div>
              <div className="stat-value text-gold leading-[0.85] text-[4.5rem] sm:text-[5.5rem] tabular-nums">{seasons}</div>
              <div className="label-sm mt-1">{seasons === 1 ? 'Season' : 'Seasons'} to the title</div>
            </div>
            <div className="space-y-3 pb-2">
              <Fact label="Record over the run" value={`${totals.wins}-${totals.losses}${totals.ties ? `-${totals.ties}` : ''}`} />
              {final && <Fact label="The final" value={`${final.us}-${final.them}`} detail={`over the ${final.opponentName}`} gold />}
            </div>
          </div>

          <div className="mt-8">
            {/* The one thing on this page that leaves the game. */}
            <GmCardReveal label="Your Rebuild card ▸">
              <RebuildCard run={run} />
            </GmCardReveal>
          </div>
        </div>
      </div>

      {/* ---- Where it started ---------------------------------------------- */}
      {run.handover && (
        <div className="section">
          <SectionHeading eyebrow="Day one" title="What you were handed" />
          {/* The founding note VERBATIM. It was written the day the league was
              made, with that club's real opening cap space and dead money in
              it, so this cannot describe a starting hand different from the
              one that was dealt — it is not a re-derivation, it is the same
              sentence. */}
          <blockquote
            className="panel p-5 border-l-4 text-sm text-chalk/90 leading-relaxed max-w-3xl"
            style={{ borderLeftColor: accent }}
          >
            {run.handover}
          </blockquote>
        </div>
      )}

      {/* ---- The climb ------------------------------------------------------ */}
      <div className="section">
        <SectionHeading eyebrow="Season by season" title="The climb" />
        <div className="panel divide-y divide-line/60 overflow-hidden">
          {run.seasons.map((s) => (
            <SeasonRow key={s.year} s={s} maxWins={maxWins} accent={accent} />
          ))}
        </div>
      </div>

      {/* ---- The moves ------------------------------------------------------ */}
      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <div className="section">
          <SectionHeading eyebrow="Rounds one and two" title="The men you found" />
          {run.picks.length === 0 ? (
            <p className="text-sm text-muted">
              You did not make an early pick in these {seasons === 1 ? 'season' : 'seasons'} — every one of them was traded.
            </p>
          ) : (
            <div className="panel divide-y divide-line/60 overflow-hidden">
              {run.picks.map((p, i) => (
                <div key={`${p.year}-${p.round}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="w-14 shrink-0 text-xs text-muted tabular-nums">{p.year} R{p.round}</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-display font-bold uppercase tracking-wide truncate text-sm">{p.name}</div>
                    <div className="text-xs text-muted">{p.position}</div>
                  </div>
                  <div className="stat-value text-stat-sm text-accent shrink-0 tabular-nums">{p.ovr}</div>
                </div>
              ))}
            </div>
          )}
          {/* The rule, said out loud. A curated list that does not admit it is
              curated is the quiet kind of lying number. */}
          <p className="text-xs text-muted">
            Every pick you made in the first two rounds of the run, in order, rated as the player is today — not as he
            was drafted, and not filtered by how he turned out.
          </p>
        </div>

        <div className="section">
          <SectionHeading eyebrow="Every trade you made" title="The deals" />
          {run.trades.length === 0 ? (
            <p className="text-sm text-muted">You built it without making a single trade.</p>
          ) : (
            <div className="panel divide-y divide-line/60 overflow-hidden">
              {run.trades.map((t, i) => (
                <div key={i} className="px-4 py-2.5 text-sm">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-muted tabular-nums shrink-0">{t.year}</span>
                    <span className="font-display font-bold uppercase tracking-wide text-xs">with {t.partnerAbbr}</span>
                  </div>
                  <div className="text-xs mt-1 text-good">+ {t.got.join(', ') || 'nothing'}</div>
                  <div className="text-xs text-muted">− {t.gave.join(', ') || 'nothing'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/league/${params.id}/history`} className="btn-secondary text-sm">Franchise history →</Link>
        <Link href="/leaderboard?sort=REBUILD" className="btn-ghost text-sm">The Rebuild board →</Link>
      </div>
    </div>
  );
}

function Fact({ label, value, detail, gold }: { label: string; value: string; detail?: string; gold?: boolean }) {
  return (
    <div>
      <div className="label-sm">{label}</div>
      <div className={`stat-value text-stat-md leading-none tabular-nums ${gold ? 'text-gold' : ''}`}>{value}</div>
      {detail && <div className="text-xs text-muted mt-1">{detail}</div>}
    </div>
  );
}

/**
 * One season. The bar is the wins, scaled to the best season of the run — so
 * the shape of the row IS the shape of the climb, and the championship year is
 * the only gold thing on the page below the banner.
 */
function SeasonRow({ s, maxWins, accent }: { s: RebuildSeasonLine; maxWins: number; accent: string }) {
  const champ = s.playoffResult === 'CHAMPION';
  return (
    <div className={`flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3 border-l-2 ${champ ? 'border-l-gold bg-gold/[0.06]' : 'border-l-transparent'}`}>
      <div className="w-16 shrink-0">
        <div className="label-sm">Season {s.season}</div>
        <div className="text-xs text-muted tabular-nums">{s.year}</div>
      </div>
      <div className="w-20 shrink-0 stat-value text-stat-sm leading-none tabular-nums">
        {s.wins}-{s.losses}{s.ties ? `-${s.ties}` : ''}
      </div>
      <div className="flex-1 min-w-0">
        <div className="h-2.5 rounded-sm bg-raised overflow-hidden">
          <div
            className="h-full rounded-sm"
            style={{
              width: `${Math.max(3, (s.wins / maxWins) * 100)}%`,
              // #eab308 is the `gold` token in tailwind.config.ts; inline
              // because the width beside it is computed.
              background: champ ? '#eab308' : `color-mix(in srgb, ${accent} 60%, transparent)`,
            }}
          />
        </div>
        <div className={`text-xs mt-1 ${champ ? 'text-gold font-semibold' : 'text-muted'}`}>
          {RESULT_LABEL[s.playoffResult] ?? s.playoffResult}
        </div>
      </div>
      <div className="hidden sm:block shrink-0 text-right text-xs text-muted tabular-nums">
        {s.pointsFor}–{s.pointsAgnst}
        <div className="label-sm mt-0.5">Points</div>
      </div>
    </div>
  );
}
