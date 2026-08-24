import { TeamLogo } from '../TeamLogo';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import type { RebuildRun } from '@/lib/rebuildRun';

/**
 * ===========================================================================
 * THE REBUILD CARD
 * ===========================================================================
 * The artefact of a finished rebuild — the thing that leaves the game and ends
 * up in a group chat. It is deliberately the SAME OBJECT as components/ds/
 * GmCard.tsx: 380x560 at trading-card proportions, the team-tinted ground with
 * the crest watermark and the stadium-light hash, .stat-value figures,
 * .label-sm labels, the wordmark along the bottom. Somebody who has seen his
 * GM card should recognise this one on sight and know it came from the same
 * shelf.
 *
 * WHAT MAKES IT A DIFFERENT CARD IS THE HERO. The GM card leads with a career
 * record; this leads with ONE NUMBER — how many seasons it took — because that
 * is the entire claim the mode makes and the only figure the leaderboard
 * ranks. Everything under it exists to give that number its denominator: where
 * he started, what the record was, and the night it ended.
 *
 * EVERY FIGURE IS PASSED IN, NONE IS DERIVED HERE. The whole `RebuildRun`
 * arrives as one object, assembled by lib/rebuildRun.ts from stored rows, and
 * the page behind this card prints its sections from the same object. A card
 * that disagreed with the page behind it would be worse than no card at all.
 * The one exception is the win total, summed from the same `seasons` array the
 * page lists — one expression, in one place, below.
 *
 * IT IS A CARD, NOT A UI. No control, no hint, no sentence explaining the
 * artefact to itself lives inside this rectangle.
 * ===========================================================================
 */
export function RebuildCard({ run }: { run: RebuildRun }) {
  const { club, standing, totals, final } = run;
  const accent = generateTeamLogoParams(club.abbr).primary;
  const seasons = standing.seasonsToTitle ?? totals.seasons;

  // The best man he drafted in the run, by the rating he carries today. Not a
  // judgement — the highest number in a list the page prints in full.
  const bestPick = run.picks.reduce<typeof run.picks[number] | null>(
    (best, p) => (best === null || p.ovr > best.ovr ? p : best), null,
  );
  const worstYear = run.seasons.reduce((w, s) => (s.wins < w.wins ? s : w), run.seasons[0]);
  const maxWins = Math.max(...run.seasons.map((s) => s.wins), 1);

  return (
    <div
      className="relative flex flex-col w-[380px] min-h-[560px] max-w-[calc(100vw-1.5rem)] rounded-lg border-2 shadow-elevated overflow-hidden bg-card"
      style={{
        ['--team-accent' as never]: accent,
        borderColor: 'var(--team-accent)',
        background: `linear-gradient(175deg, color-mix(in srgb, ${accent} 24%, #101012), #0d0d0f 46%, #0a0a0b)`,
      }}
    >
      <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: 'repeating-linear-gradient(115deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 14px)',
            color: accent,
          }}
        />
        <TeamLogo seed={club.id} abbr={club.abbr} size={300} className="watermark-logo opacity-[0.05] -right-24 top-28" />
      </div>

      {/* ---- Identity ------------------------------------------------------ */}
      <div
        className="relative px-5 pt-4 pb-3 border-b"
        style={{ borderColor: 'color-mix(in srgb, var(--team-accent) 45%, transparent)' }}
      >
        <div className="flex items-center gap-3">
          <TeamLogo seed={club.id} abbr={club.abbr} size={44} className="shrink-0" />
          <div className="min-w-0">
            <div className="label-sm text-gold">The Rebuild · Complete</div>
            <div className="font-display font-extrabold uppercase tracking-wide leading-none text-lg truncate">
              {club.city} {club.nickname}
            </div>
            <div className="text-[11px] text-muted truncate mt-0.5">
              {run.gmName ? `${run.gmName} · ` : ''}{run.leagueName}
            </div>
          </div>
        </div>
      </div>

      {/* ---- The number ---------------------------------------------------- */}
      <div className="relative px-5 pt-5 pb-4 text-center">
        <div className="stat-value text-gold leading-[0.85] text-[4.2rem] tabular-nums">{seasons}</div>
        <div className="label-sm mt-2">
          {seasons === 1 ? 'Season to the title' : 'Seasons to the title'}
        </div>
        <div className="text-[11px] text-muted mt-1">
          worst roster in football, {standing.tenureStartYear} — champions, {standing.firstTitleYear}
        </div>
      </div>

      {/* ---- The denominator ----------------------------------------------- */}
      <div
        className="relative mx-5 grid grid-cols-3 gap-px rounded-md overflow-hidden border"
        style={{ borderColor: 'color-mix(in srgb, var(--team-accent) 30%, transparent)' }}
      >
        <Cell label="Record" value={`${totals.wins}-${totals.losses}${totals.ties ? `-${totals.ties}` : ''}`} />
        <Cell label="Worst year" value={`${worstYear.wins}-${worstYear.losses}`} detail={String(worstYear.year)} />
        <Cell
          label="The final"
          value={final ? `${final.us}-${final.them}` : '—'}
          detail={final ? `vs ${final.opponentAbbr}` : undefined}
          gold
        />
      </div>

      {/* ---- The climb, as a shape ----------------------------------------- */}
      {/* THE BARS NEED A DEFINITE HEIGHT TO SIZE AGAINST. A percentage height
          resolves against nothing when its parent is auto, so the first
          version of this rendered the win totals with no bars under them at
          all — invisible in code review and obvious in a screenshot. The row
          takes its height from `flex-1` on a card that has one, and each
          column stretches to it, so the percentages have something to be a
          percentage OF. */}
      <div className="relative px-5 pt-4 pb-2 flex-1 flex flex-col min-h-0">
        <div className="label-sm mb-2">Wins, season by season</div>
        <div className="flex items-stretch gap-1.5 flex-1 min-h-[72px]">
          {run.seasons.map((s) => {
            const champ = s.playoffResult === 'CHAMPION';
            return (
              <div key={s.year} className="flex-1 flex flex-col justify-end items-center gap-1 min-w-0">
                <span className={`text-[11px] tabular-nums ${champ ? 'text-gold font-bold' : 'text-muted'}`}>{s.wins}</span>
                <div
                  className="w-full rounded-sm"
                  style={{
                    height: `${Math.max(8, (s.wins / maxWins) * 100)}%`,
                    // #eab308 is the `gold` token in tailwind.config.ts; inline
                    // because the height beside it is computed.
                    background: champ ? '#eab308' : accent,
                  }}
                />
                <span className="text-[9px] text-muted tabular-nums">&rsquo;{String(s.year).slice(2)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ---- The man he found, when there is one ---------------------------- */}
      <div className="relative px-5 pb-3">
        {bestPick && (
          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0">
              <div className="label-sm">Best pick of the run</div>
              <div className="font-display font-bold uppercase tracking-wide truncate">{bestPick.name}</div>
              <div className="text-[11px] text-muted">
                {bestPick.position} · Round {bestPick.round}, {bestPick.year}
              </div>
            </div>
            <div className="stat-value text-stat-sm text-accent shrink-0 tabular-nums">{bestPick.ovr}</div>
          </div>
        )}
      </div>

      <div
        className="relative px-5 py-2 border-t text-[10px] uppercase tracking-[0.18em] text-muted flex items-center justify-between"
        style={{ borderColor: 'color-mix(in srgb, var(--team-accent) 30%, transparent)' }}
      >
        <span>Dynasty GM</span>
        <span className="text-gold">Ironman</span>
      </div>
    </div>
  );
}

function Cell({ label, value, detail, gold }: { label: string; value: string; detail?: string; gold?: boolean }) {
  return (
    <div className="bg-ink/40 px-2 py-2.5 text-center">
      <div className={`stat-value text-stat-sm leading-none tabular-nums ${gold ? 'text-gold' : ''}`}>{value}</div>
      <div className="label-sm mt-1 text-[9px]">{label}</div>
      {detail && <div className="text-[10px] text-muted mt-0.5">{detail}</div>}
    </div>
  );
}
