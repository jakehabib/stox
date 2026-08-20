interface Need {
  position: string;
  /** 0..1 raw need score — same scale as lib/ai/gm.ts teamNeeds(), drives the bar width directly. */
  value: number;
  /** Severity label + color, e.g. from lib/ai/gm.ts needSeverity(). */
  label: string;
  className: string;
}

const BAR_COLOR: Record<string, string> = {
  'text-bad': 'bg-bad', 'text-warn': 'bg-warn', 'text-accent2': 'bg-accent2', 'text-muted': 'bg-line',
};

export function RosterNeeds({ needs }: { needs: Need[] }) {
  return (
    <div className="space-y-2.5">
      {needs.map((n) => (
        <div key={n.position} className="flex items-center gap-3">
          <span className="label-sm w-10 shrink-0">{n.position}</span>
          <div className="flex-1 h-1.5 rounded-full bg-raised overflow-hidden">
            <div className={`h-full rounded-full ${BAR_COLOR[n.className] ?? 'bg-line'}`} style={{ width: `${Math.round(n.value * 100)}%` }} />
          </div>
          <span className={`text-xs w-16 text-right font-medium ${n.className}`}>{n.label}</span>
        </div>
      ))}
    </div>
  );
}
