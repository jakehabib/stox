import { TeamLogo } from '../TeamLogo';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { StatNumber } from './StatNumber';

interface NextGame { teamId: string; abbr: string; city: string; wins: number; losses: number; winProb: number; home: boolean }
interface StatTile { value: string; label: string; color?: string }

export function TeamHeader({
  teamId, abbr, city, nickname, wins, losses, ties, standing, tenureLabel, scenarioTag, stats, nextGame,
}: {
  teamId: string; abbr: string; city: string; nickname: string;
  wins: number; losses: number; ties: number; standing: string;
  /** "Year 4 of your tenure" — the franchise's context, not just this season's. */
  tenureLabel?: string;
  /** A live playoff/record-chase scenario worth flagging, e.g. "Clinch scenario: live at Week 12." */
  scenarioTag?: string;
  stats: StatTile[];
  /** The next matchup, embedded directly rather than a separate card — one hero, one read. */
  nextGame?: NextGame;
}) {
  const { primary, accent } = generateTeamLogoParams(teamId);

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
              <span className="stat-value text-stat-sm" style={{ color: 'var(--team-text)' }}>{wins}-{losses}{ties ? `-${ties}` : ''}</span>
              <span className="text-xs text-muted">{standing}{tenureLabel ? ` · ${tenureLabel}` : ''}</span>
            </div>
            {scenarioTag && (
              <span className="pill border-gold/40 text-gold mt-2 inline-block">{scenarioTag}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-6">
          {stats.map((s) => (
            <StatNumber key={s.label} value={s.value} label={s.label} size="md" color={s.color ?? 'text-chalk'} />
          ))}
        </div>
      </div>

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
            className="pill border shrink-0"
            style={{ borderColor: 'var(--team-accent)', color: 'var(--team-text)', background: 'color-mix(in srgb, var(--team-accent) 22%, transparent)' }}
          >
            {nextGame.winProb}% Win
          </span>
        </div>
      )}
    </div>
  );
}
