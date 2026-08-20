import { TeamLogo } from '../TeamLogo';

interface Row { teamId: string; abbr: string; city: string; wins: number; losses: number; ties?: number; isUser?: boolean }

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
                    <TeamLogo seed={r.teamId} abbr={r.abbr} size={20} />
                    <span className={r.isUser ? 'font-semibold' : ''}>{r.city}</span>
                  </span>
                </td>
                <td className="font-mono text-right">{r.wins}-{r.losses}{r.ties ? `-${r.ties}` : ''}</td>
                <td className="font-mono text-muted text-right w-14">{pct.toFixed(3).slice(1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
