import { TeamLogo } from '../TeamLogo';

interface Row {
  teamId: string; abbr: string; city: string; wins: number; losses: number; ties?: number; isUser?: boolean;
  /** Rank change since last week — positive is up. Omit for "no change." */
  delta?: number;
  /** Last five results, most recent last — 'W' | 'L' | 'T'. */
  lastFive?: ('W' | 'L' | 'T')[];
}

export function StandingsTable({ label, rows }: { label: string; rows: Row[] }) {
  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line/70 label-sm">{label}</div>
      <table className="table-clean">
        <tbody>
          {rows.map((r, i) => {
            const pct = r.wins + r.losses > 0 ? r.wins / (r.wins + r.losses) : 0;
            return (
              <tr key={r.teamId} className={r.isUser ? 'bg-raised/60' : ''}>
                <td className="text-muted w-6">{i + 1}</td>
                <td>
                  <span className="flex items-center gap-2">
                    <TeamLogo seed={r.teamId} abbr={r.abbr} size={20} className="shrink-0" />
                    <span className={`whitespace-nowrap ${r.isUser ? 'font-semibold' : ''}`}>{r.city}</span>
                  </span>
                </td>
                <td className="font-mono text-right">{r.wins}-{r.losses}{r.ties ? `-${r.ties}` : ''}</td>
                {/* replace(/^0/) not slice(1): an undefeated team is "1.000",
                    and slice(1) turns that into ".000" — the one team whose
                    record most deserves to read correctly was displayed as
                    winless. */}
                <td className="font-mono text-muted text-right w-14">{pct.toFixed(3).replace(/^0/, '')}</td>
                <td className="w-10 text-right">
                  {r.delta ? (
                    <span className={`text-xs font-mono ${r.delta > 0 ? 'text-accent' : 'text-bad'}`}>
                      {r.delta > 0 ? '▲' : '▼'}{Math.abs(r.delta)}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                </td>
                {r.lastFive && (
                  <td className="w-16">
                    <div className="flex gap-0.5 justify-end">
                      {r.lastFive.map((res, gi) => (
                        <span
                          key={gi}
                          className={`w-2 h-4 rounded-sm ${res === 'W' ? 'bg-accent' : res === 'L' ? 'bg-bad' : 'bg-line'}`}
                          title={res === 'W' ? 'Win' : res === 'L' ? 'Loss' : 'Tie'}
                        />
                      ))}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
