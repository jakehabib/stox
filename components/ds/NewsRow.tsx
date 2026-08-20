import { TeamLogo } from '../TeamLogo';

/**
 * A wire row, not a database log line — team mark first, headline carries
 * the visual weight, metadata stays small and secondary.
 */
export function NewsRow({ teamId, abbr, headline, detail, meta }: {
  teamId?: string; abbr?: string; headline: string; detail?: string; meta: string;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="w-8 pt-0.5 shrink-0">
        {teamId && abbr ? <TeamLogo seed={teamId} abbr={abbr} size={28} /> : <div className="w-7 h-7 rounded-full bg-raised" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold leading-snug">{headline}</div>
        {detail && <div className="text-xs text-muted mt-0.5">{detail}</div>}
      </div>
      <div className="text-[11px] text-muted shrink-0 pt-0.5 font-mono">{meta}</div>
    </div>
  );
}
