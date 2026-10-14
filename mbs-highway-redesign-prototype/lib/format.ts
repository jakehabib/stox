/** Formatting helpers. All UI number output goes through here so NaN never reaches the screen. */

const safe = (n: number) => (Number.isFinite(n) ? n : 0);

/** $1,234 (no cents by default). */
export function usd(n: number, opts: { cents?: boolean; sign?: boolean } = {}): string {
  const v = safe(n);
  const s = Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  });
  const neg = Math.round(v * (opts.cents ? 100 : 1)) < 0;
  if (neg) return `-$${s}`;
  return `${opts.sign ? '+' : ''}$${s}`;
}

/** Compact currency: $940.9K, $1.2M */
export function usdCompact(n: number): string {
  const v = safe(n);
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(a >= 100_000 ? 0 : 1)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

/** Percent from a percent number (6.5 -> "6.5%"). */
export function pct(n: number, digits = 2, opts: { sign?: boolean; trim?: boolean } = {}): string {
  const v = safe(n);
  let s = v.toFixed(digits);
  if (opts.trim !== false && s.includes('.')) s = s.replace(/\.?0+$/, '');
  if (s === '-0') s = '0';
  return `${opts.sign && v > 0 ? '+' : ''}${s}%`;
}

/** Plain number with thousands separators. */
export function num(n: number, digits = 0): string {
  return safe(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function compactNum(n: number): string {
  const v = safe(n);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
}

export function date(d: Date | string, style: 'short' | 'long' | 'medium' = 'medium'): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  if (style === 'short') return x.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
  if (style === 'long') return x.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "9y 1m" */
export function yearsMonths(months: number): string {
  const m = Math.max(0, Math.round(safe(months)));
  return `${Math.floor(m / 12)}y ${m % 12}m`;
}

/** Basis points from a decimal change in percent units (0.035 -> "+3.5bp"). */
export function bp(changePct: number): string {
  const v = safe(changePct) * 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}bp`;
}
