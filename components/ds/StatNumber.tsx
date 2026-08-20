const SIZE_CLASS = {
  sm: 'text-stat-sm',
  md: 'text-stat-md',
  lg: 'text-stat-lg',
  xl: 'text-stat-xl',
} as const;

/**
 * The reusable treatment for a number that matters — record, cap space,
 * OVR, round/pick, career totals. Big, bold, tabular, display face — the
 * thing the brief means by "87 / OVERALL" carrying more weight than
 * "OVR: 87". Label sits under or beside it, always visually secondary.
 */
export function StatNumber({
  value, label, size = 'md', color = 'text-chalk', labelPosition = 'below', className,
}: {
  value: React.ReactNode; label?: string; size?: keyof typeof SIZE_CLASS; color?: string;
  labelPosition?: 'below' | 'inline'; className?: string;
}) {
  if (labelPosition === 'inline') {
    return (
      <div className={`flex items-baseline gap-2 ${className ?? ''}`}>
        <span className={`stat-value ${SIZE_CLASS[size]} ${color}`}>{value}</span>
        {label && <span className="label-sm">{label}</span>}
      </div>
    );
  }
  return (
    <div className={className}>
      <div className={`stat-value ${SIZE_CLASS[size]} ${color}`}>{value}</div>
      {label && <div className="label-sm mt-0.5">{label}</div>}
    </div>
  );
}
