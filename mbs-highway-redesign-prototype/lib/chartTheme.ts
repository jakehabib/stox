/**
 * Chart tokens (Recharts). Categorical series colors follow a CVD-validated order —
 * assign by entity in this fixed order, never cycle or re-rank.
 */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'] as const;

export const CHART = {
  grid: '#e7e7e4',
  axis: '#8a8984',
  text: '#52514e',
  textStrong: '#0b0b0b',
  gain: '#0f9d6b',
  loss: '#d93a3a',
  brand: '#6a2ff2',
  neutral: '#a3a29b',
  fontSize: 12,
};

export const axisProps = {
  stroke: CHART.axis,
  tick: { fill: CHART.text, fontSize: CHART.fontSize },
  tickLine: false,
  axisLine: { stroke: CHART.grid },
} as const;

export const gridProps = { stroke: CHART.grid, strokeDasharray: '0', vertical: false } as const;

/** Compact $ for axes: $500K, $1.2M */
export function axisUsd(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1_000_000) return `${s}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${s}$${Math.round(a / 1_000)}K`;
  return `${s}$${Math.round(a)}`;
}
