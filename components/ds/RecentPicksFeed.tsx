import { TeamLogo } from '../TeamLogo';

interface Pick { round: number; slot: number; teamId: string; abbr: string; player: string; position: string; college: string }

export function RecentPicksFeed({ picks }: { picks: Pick[] }) {
  return (
    <div className="space-y-0 divide-y divide-line/60">
      {picks.map((p) => (
        <div key={`${p.round}-${p.slot}`} className="flex items-center gap-3 py-2">
          <span className="font-mono text-xs text-muted w-12 shrink-0 whitespace-nowrap">R{p.round}·P{p.slot}</span>
          <TeamLogo seed={p.teamId} abbr={p.abbr} size={22} className="shrink-0" />
          <span className="text-sm flex-1 min-w-0 truncate">
            <span className="font-semibold">{p.player}</span>
            <span className="text-muted"> · {p.position}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
