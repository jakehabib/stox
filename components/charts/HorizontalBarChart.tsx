/**
 * Part-to-whole / magnitude comparison across a handful of named categories
 * (e.g. cap allocation by position group). Every bar carries a direct label
 * and value, so nothing is gated behind hover — a plain, server-renderable
 * chart per the dataviz skill's "label selectively, but a small category
 * count can label all of them" guidance.
 */
export function HorizontalBarChart({ bars, maxValue }: {
  bars: { label: string; value: number; displayValue: string; color: string; sublabel?: string }[];
  maxValue?: number;
}) {
  const max = maxValue ?? Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="space-y-2.5">
      {bars.map((b) => {
        const pct = Math.max(0, Math.min(100, (b.value / max) * 100));
        return (
          <div key={b.label} className="flex items-center gap-3" title={`${b.label}: ${b.displayValue}`}>
            <span className="w-16 shrink-0 text-xs font-mono text-muted">{b.label}</span>
            <div className="flex-1 h-4 bg-raised rounded-sm overflow-hidden">
              <div className="h-full rounded-sm" style={{ width: `${pct}%`, backgroundColor: b.color }} />
            </div>
            <span className="w-20 shrink-0 text-xs font-mono text-right">{b.displayValue}</span>
          </div>
        );
      })}
    </div>
  );
}
