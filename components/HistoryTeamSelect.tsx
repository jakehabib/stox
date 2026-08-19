'use client';

interface TeamOption { id: string; label: string }

export function HistoryTeamSelect({ leagueId, teamId, options }: { leagueId: string; teamId?: string; options: TeamOption[] }) {
  return (
    <select
      className="input"
      value={teamId}
      onChange={(e) => { window.location.href = `/league/${leagueId}/history?team=${e.target.value}`; }}
    >
      {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );
}
