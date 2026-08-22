import { TeamLogo } from '../TeamLogo';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { StatNumber } from './StatNumber';
import { ratingColor } from '@/lib/ratings';
import { Tooltip } from '../Tooltip';
import { tip } from '@/lib/glossary';

interface NextGame {
  teamId: string; abbr: string; city: string; wins: number; losses: number;
  winProb: number; home: boolean;
  /** The biggest drivers behind winProb, so the badge can justify itself. */
  why?: { label: string; points: number; detail: string }[];
}
interface StatTile { value: string; label: string; color?: string }
/** One unit's strength and where it sits among the 32 clubs. */
interface RatingTile { label: string; value: number; rank: number; outOf: number }

export function TeamHeader({
  teamId, abbr, city, nickname, wins, losses, ties, standing, tenureLabel, scenarioTag, stats, ratings, nextGame,
}: {
  teamId: string; abbr: string; city: string; nickname: string;
  wins: number; losses: number; ties: number; standing: string;
  /** "Year 4 of your tenure" — the franchise's context, not just this season's. */
  tenureLabel?: string;
  /** A clinch/elimination scenario worth flagging, e.g. "Clinched the division." */
  scenarioTag?: { label: string; tone: 'good' | 'bad' };
  stats: StatTile[];
  /**
   * Team strength, with league rank. The record says what has happened; this
   * says what you are holding. It used to appear on the dashboard only as
   * small print inside the win-probability reasoning ("76 overall vs 74"),
   * which is the one place a GM would never look for it.
   */
  ratings?: RatingTile[];
  /** The next matchup, embedded directly rather than a separate card — one hero, one read. */
  nextGame?: NextGame;
}) {
  const { primary, accent } = generateTeamLogoParams(abbr);

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-line/70 bg-card border-l-[3px]"
      style={{ ['--team-accent' as never]: primary, ['--team-accent-2' as never]: accent, borderLeftColor: primary }}
    >
      <TeamLogo seed={teamId} abbr={abbr} size={280} className="watermark-logo -right-16 -top-16" />
      <div className="h-[3px] w-full flex">
        <div className="flex-[5]" style={{ background: 'var(--team-accent)' }} />
        <div className="flex-1" style={{ background: 'var(--team-accent-2)' }} />
      </div>

      <div className="relative px-5 pt-4 pb-3 flex flex-wrap items-start justify-between gap-y-4 gap-x-8">
        <div className="flex items-center gap-3">
          <div className="rounded-full ring-2 ring-offset-2 ring-offset-card" style={{ ['--tw-ring-color' as never]: 'var(--team-accent-2)' }}>
            <TeamLogo seed={teamId} abbr={abbr} size={56} />
          </div>
          <div>
            <div className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none">{city} {nickname}</div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="stat-value text-stat-sm text-team">{wins}-{losses}{ties ? `-${ties}` : ''}</span>
              <span className="text-xs text-muted">{standing}{tenureLabel ? ` · ${tenureLabel}` : ''}</span>
            </div>
            {scenarioTag && (
              <span className={`pill mt-2 inline-block ${scenarioTag.tone === 'good' ? 'border-gold/40 text-gold' : 'border-bad/40 text-bad'}`}>
                {scenarioTag.label}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-6">
          {stats.map((s) => (
            <StatNumber key={s.label} value={s.value} label={s.label} size="md" color={s.color ?? 'text-chalk'} />
          ))}
        </div>
      </div>

      {ratings && ratings.length > 0 && (
        // Its own band rather than more tiles in the row above: those are
        // inventory (money, bodies, picks) and these are quality, and the two
        // read as one undifferentiated wall of numbers when mixed. Ranks are
        // among the 32 clubs in this league, and the rank under each number is
        // the rank OF that number — offense and defense are ranked on the same
        // composite they display, not on the overall.
        <div className="relative border-t border-line/60 bg-ink/30 grid grid-cols-2 sm:grid-cols-4 divide-x divide-line/40">
          {ratings.map((r) => (
            <div key={r.label} className="px-5 py-2.5">
              {/* Upward, into the header body: this band sits inside the card's
                  `overflow-hidden`, so downward would open past the bottom
                  edge and be clipped away. */}
              <div className="label-sm inline-flex items-center gap-1.5">
                {r.label}
                <Tooltip text={r.label === 'Team Overall' ? tip('teamOverall') : tip('unitRating')} />
              </div>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className={`stat-value text-stat-sm ${ratingColor(r.value)}`}>{r.value}</span>
                <span className="text-[11px] text-muted">{ordinal(r.rank)} of {r.outOf}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {nextGame && (
        // bg-ink/40 so this row stays legible over the watermark crest,
        // which extends down behind it — the pill nearly disappeared into
        // the crest silhouette without it (caught in screenshot review).
        <div className="relative border-t border-line/60 px-5 py-3 flex items-center gap-3 bg-ink/40">
          <span className="label-sm shrink-0">{nextGame.home ? 'Home vs' : 'At'}</span>
          <TeamLogo seed={nextGame.teamId} abbr={nextGame.abbr} size={24} />
          <span className="text-sm font-semibold flex-1 min-w-0 truncate">
            {nextGame.city} <span className="text-muted font-normal">{nextGame.wins}-{nextGame.losses}</span>
          </span>
          <span
            className="pill border shrink-0 text-team"
            style={{ borderColor: 'var(--team-accent)', background: 'color-mix(in srgb, var(--team-accent) 22%, transparent)' }}
          >
            {nextGame.winProb}% Win
          </span>
          <Tooltip className="shrink-0" text={tip('winProbability')} />
        </div>
      )}
      {nextGame && nextGame.why && nextGame.why.length > 0 && (
        // A bare percentage is something to accept; the reasoning makes it
        // something to argue with, and a wrong number obvious rather than
        // merely surprising.
        <div className="relative px-5 pb-3 -mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 bg-ink/40">
          {nextGame.why.map((f) => (
            <span key={f.label} className="text-[11px] text-muted">
              <span className={f.points >= 0 ? 'text-accent' : 'text-bad'}>
                {f.points >= 0 ? '+' : ''}{Math.round(f.points)}%
              </span>{' '}
              {f.label.toLowerCase()} — {f.detail}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** 1 -> "1st". Local because the dashboard's own ordinal is not exported. */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
