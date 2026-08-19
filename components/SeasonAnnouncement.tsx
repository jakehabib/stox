import Link from 'next/link';
import { TeamLogo } from './TeamLogo';

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
 */
export function SeasonAnnouncement({ leagueId, seasonYear, championName, championTeamId, championAbbr, isUserChampion, userTeamId, userTeamName, userRecord, userResult, awards }: {
  leagueId: string; seasonYear: number;
  championName: string; championTeamId: string; championAbbr: string; isUserChampion: boolean;
  userTeamId: string; userTeamName: string; userRecord: string; userResult: string;
  awards: AwardLine[];
}) {
  return (
    <div className={`card card-pad space-y-4 ${isUserChampion ? 'border-accent/50' : 'border-accent2/30'}`}>
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

      {awards.length > 0 && (
        <div>
          <div className="label-sm mb-2">Season Awards</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {awards.map((a) => (
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
