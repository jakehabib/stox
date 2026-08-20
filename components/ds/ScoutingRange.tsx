function confidenceLabel(confidence: number): { text: string; color: string } {
  if (confidence >= 75) return { text: 'HIGH', color: 'text-accent' };
  if (confidence >= 40) return { text: 'MEDIUM', color: 'text-warn' };
  return { text: 'LOW', color: 'text-muted' };
}

/**
 * A scouted range reads as uncertainty communicated on purpose — a filled
 * track segment between low/high on a 40-99 scale, not a raw progress bar
 * or a "confidence: 62%" debug readout.
 */
export function ScoutingRange({ low, high, confidence, label = 'OVR', className = 'w-40' }: {
  low: number; high: number; confidence: number; label?: string;
  /** Width utility — narrower (e.g. "w-28") for dense rows like a draft board. */
  className?: string;
}) {
  const c = confidenceLabel(confidence);
  const SCALE_MIN = 40, SCALE_MAX = 99;
  const pct = (v: number) => ((v - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="label-sm">{label}</span>
        <span className="stat-value text-stat-sm text-chalk">{low}–{high}</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-raised overflow-hidden">
        <div
          className="absolute inset-y-0 bg-accent2/70 rounded-full"
          style={{ left: `${pct(low)}%`, width: `${Math.max(3, pct(high) - pct(low))}%` }}
        />
      </div>
      <div className={`text-[11px] mt-1 font-medium ${c.color}`}>Confidence: {c.text}</div>
    </div>
  );
}
