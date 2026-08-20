export type NeedLevel = 'Severe' | 'High' | 'Moderate' | 'Low';

const LEVEL: Record<NeedLevel, { color: string; pct: number }> = {
  Severe: { color: 'bg-bad', pct: 90 },
  High: { color: 'bg-warn', pct: 68 },
  Moderate: { color: 'bg-accent2', pct: 42 },
  Low: { color: 'bg-line', pct: 18 },
};

export function RosterNeeds({ needs }: { needs: { position: string; level: NeedLevel }[] }) {
  return (
    <div className="space-y-2.5">
      {needs.map((n) => (
        <div key={n.position} className="flex items-center gap-3">
          <span className="label-sm w-10 shrink-0">{n.position}</span>
          <div className="flex-1 h-1.5 rounded-full bg-raised overflow-hidden">
            <div className={`h-full rounded-full ${LEVEL[n.level].color}`} style={{ width: `${LEVEL[n.level].pct}%` }} />
          </div>
          <span className="text-xs text-muted w-16 text-right">{n.level}</span>
        </div>
      ))}
    </div>
  );
}
