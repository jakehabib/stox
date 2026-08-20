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
  const { primary } = generateTeamLogoParams(teamId);

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-line/70 bg-card"
      style={{ ['--team-accent' as never]: primary }}
    >
      {/* Large low-opacity watermark — the one place the team crest gets to be big. */}
      <TeamLogo seed={teamId} abbr={abbr} size={280} className="watermark-logo -right-16 -top-16" />
      {/* Thin top accent line in the team's primary color — subtle identity, not a full recolor. */}
      <div className="h-[3px] w-full" style={{ background: 'var(--team-accent)' }} />

      <div className="relative px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="flex items-center gap-3">
          <TeamLogo seed={teamId} abbr={abbr} size={52} />
          <div>
            <div className="font-display font-bold text-xl uppercase tracking-wide leading-none">{city} {nickname}</div>
            <div className="text-xs text-muted mt-1.5">{standing}</div>
          </div>
        </div>

        <StatNumber
          value={`${wins}-${losses}${ties ? `-${ties}` : ''}`}
          label="Record" size="md" labelPosition="inline"
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
