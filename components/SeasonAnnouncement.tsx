import Link from 'next/link';
import { TeamLogo } from './TeamLogo';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';

const RESULT_LABEL: Record<string, string> = {
  MISSED: 'Missed the playoffs',
  WILDCARD: 'Lost in the Wild Card round',
  DIVISIONAL: 'Lost in the Divisional round',
  CONFERENCE: 'Lost in the Conference Championship',
  RUNNER_UP: 'Lost in the Championship',
  CHAMPION: 'Won the Championship',
};

export interface AwardLine { code: string; label: string; name: string; teamAbbr: string; detail: string }

/**
 * The proactive "you just won the league" moment — surfaced at the very top
 * of the dashboard right after the championship game, instead of being
 * something you'd only ever discover by clicking into History.
 *
 * This is the RECORD, not the event: components/ds/TrophyMoment.tsx is the
 * Tier-0 full-screen moment that fires once, on the Advance that ended the
 * season, and this panel is what is still here tomorrow. So it repeats none
 * of the moment's drama and all of its facts.
 *
 * The Championship MVP is pulled out of the award grid when the user's own
 * club won it. He is the one award that belongs to the title rather than to
 * the season, and ranking him fifth in a 2x3 grid of equal tiles — under
 * Rookie of the Year — was the reason he was easy to miss entirely. Every
 * other award keeps its place below, unchanged.
 */
export function SeasonAnnouncement({ leagueId, seasonYear, championName, championTeamId, championAbbr, isUserChampion, userTeamId, userTeamName, userRecord, userResult, awards }: {
  leagueId: string; seasonYear: number;
  championName: string; championTeamId: string; championAbbr: string; isUserChampion: boolean;
  userTeamId: string; userTeamName: string; userRecord: string; userResult: string;
  awards: AwardLine[];
}) {
  const sbMvp = awards.find((a) => a.code === 'SB MVP');
  // Promoted only for the club that actually won it — another team's
  // championship MVP is a league result, and stays a league-result tile.
  const heroMvp = isUserChampion ? sbMvp : undefined;
  const rest = heroMvp ? awards.filter((a) => a !== heroMvp) : awards;
  const accent = generateTeamLogoParams(championAbbr).primary;

  return (
    <div
      className={`card card-pad space-y-4 ${isUserChampion ? 'border-accent/50' : 'border-accent2/30'}`}
      style={isUserChampion ? {
        ['--team-accent' as never]: accent,
        background: `linear-gradient(100deg, color-mix(in srgb, ${accent} 12%, transparent), transparent 55%)`,
      } : undefined}
    >
      <div className="flex items-center gap-4">
        <TeamLogo seed={championTeamId} abbr={championAbbr} size={48} />
        <div>
          <div className="text-xs text-muted uppercase tracking-wider">{seasonYear} Season Complete</div>
          <h2 className="text-xl font-semibold tracking-tight">
            {isUserChampion ? 'You won the championship!' : `${championName} are your ${seasonYear} champions`}
          </h2>
        </div>
      </div>

      <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-raised text-sm">
        <TeamLogo seed={userTeamId} abbr={userTeamName.slice(0, 3).toUpperCase()} size={24} />
        <span className="flex-1">Your season: <span className="font-semibold">{userTeamName}</span> finished <span className="font-mono">{userRecord}</span> — {RESULT_LABEL[userResult] ?? userResult}</span>
      </div>

      {heroMvp && (
        <div
          className="panel px-4 py-3 flex flex-wrap items-baseline gap-x-3 gap-y-1"
          style={{ borderColor: 'color-mix(in srgb, var(--team-accent) 45%, transparent)' }}
        >
          <span className="label-sm">{heroMvp.label}</span>
          <span className="font-display font-bold uppercase tracking-wide text-lg">{heroMvp.name}</span>
          <span className="text-muted text-sm">({heroMvp.teamAbbr})</span>
          <span className="font-mono text-xs text-muted ml-auto">{heroMvp.detail}</span>
        </div>
      )}

      {rest.length > 0 && (
        <div>
          <div className="label-sm mb-2">Season Awards</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {rest.map((a) => (
              <div key={a.code} className="px-3 py-2 rounded-lg bg-raised text-sm">
                <div className="text-xs text-muted">{a.label}</div>
                <div className="font-medium">{a.name} <span className="text-muted font-normal">({a.teamAbbr})</span></div>
                <div className="text-xs text-muted mt-0.5">{a.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Link href={`/league/${leagueId}/history`} className="text-xs text-accent2 hover:underline">View full franchise history →</Link>
    </div>
  );
}
