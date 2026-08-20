import { TeamLogo } from '../TeamLogo';

/**
 * A compact incoming offer to move on the current pick — built for the
 * draft-day sidebar, where the decision needs to happen without leaving
 * the board. Real Accept/Counter/Decline, not a link to "review" elsewhere.
 */
export function PickTradeOffer({ teamId, abbr, teamName, summary, value }: {
  teamId: string; abbr: string; teamName: string; summary: string;
  /** e.g. "+$4.2M value" or "Fair trade" — the quick read on whether it's worth it. */
  value: string;
}) {
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2.5 mb-2">
        <TeamLogo seed={teamId} abbr={abbr} size={24} />
        <div className="text-sm flex-1"><span className="font-semibold">{teamName}</span> wants this pick</div>
      </div>
      <p className="text-xs text-muted mb-1">{summary}</p>
      <p className="text-xs text-accent font-medium mb-3">{value}</p>
      <div className="flex gap-2">
        <button className="btn-primary flex-1 text-xs">Accept</button>
        <button className="btn-secondary flex-1 text-xs">Counter</button>
      </div>
      <button className="btn-tertiary text-xs mt-1 w-full">Decline</button>
    </div>
  );
}
