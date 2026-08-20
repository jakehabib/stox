import { TeamLogo } from '../TeamLogo';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { StatNumber } from './StatNumber';

export function TeamHeader({
  teamId, abbr, city, nickname, wins, losses, ties, standing, phaseLabel, weekLabel, capSpace, rosterCount, rosterMax = 53,
}: {
  teamId: string; abbr: string; city: string; nickname: string;
  wins: number; losses: number; ties: number; standing: string;
  phaseLabel: string; weekLabel?: string;
  capSpace: string; rosterCount: number; rosterMax?: number;
}) {
  const { primary, accent } = generateTeamLogoParams(teamId);

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-line/70 bg-card border-l-[3px]"
      style={{ ['--team-accent' as never]: primary, ['--team-accent-2' as never]: accent, borderLeftColor: primary }}
    >
      {/* Large low-opacity watermark — the one place the team crest gets to be big. */}
      <TeamLogo seed={teamId} abbr={abbr} size={280} className="watermark-logo -right-16 -top-16" />
      {/* Two-tone ribbon edge in the team's actual color pair — subtle
          identity, not a full recolor of the panel. */}
      <div className="h-[3px] w-full flex">
        <div className="flex-[5]" style={{ background: 'var(--team-accent)' }} />
        <div className="flex-1" style={{ background: 'var(--team-accent-2)' }} />
      </div>

      <div className="relative px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-full ring-2 ring-offset-2 ring-offset-card" style={{ ['--tw-ring-color' as never]: 'var(--team-accent-2)' }}>
            <TeamLogo seed={teamId} abbr={abbr} size={52} />
          </div>
          <div>
            <div className="font-display font-bold text-xl uppercase tracking-wide leading-none">{city} {nickname}</div>
            <div className="text-xs text-muted mt-1.5">{standing}</div>
          </div>
        </div>

        <StatNumber
          value={`${wins}-${losses}${ties ? `-${ties}` : ''}`}
          label="Record" size="md" labelPosition="inline"
          color="text-[color:var(--team-accent)]"
        />

        <div>
          <div className="label-sm">{phaseLabel}</div>
          {weekLabel && <div className="text-sm font-medium mt-0.5">{weekLabel}</div>}
        </div>

        <div className="ml-auto flex items-center gap-6">
          <StatNumber value={capSpace} label="Cap Space" size="md" color="text-accent" />
          <StatNumber value={`${rosterCount}/${rosterMax}`} label="Roster" size="md" />
        </div>
      </div>
    </div>
  );
}
