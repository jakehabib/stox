'use client';

import { useState } from 'react';
import { formatMoney } from '@/lib/cap';

interface Series {
  label: string;
  color: string;
  points: { x: string; y: number }[];
}

const FORMATTERS: Record<string, (v: number) => string> = {
  money: formatMoney,
  integer: (v) => String(Math.round(v)),
};

/**
 * Trend-over-time line chart with a hover readout — one series is the
 * common case (a single line), an optional baseline renders as a dashed-
 * free hairline (real threshold, e.g. the cap limit) rather than a second
 * data series sharing the axis. Hit targets are per-x-index, covering the
 * full column height, so the pointer only has to be close, not pixel-exact.
 *
 * `formatY` is a named format kind, not a function — Server Components
 * can't pass functions as props to Client Components like this one.
 */
export function LineChart({ series, baseline, height = 220, formatY }: {
  series: Series[];
  baseline?: { y: number; label: string };
  height?: number;
  formatY: keyof typeof FORMATTERS;
}) {
  const format = FORMATTERS[formatY];
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const width = 640;
  const padL = 8, padR = 8, padT = 16, padB = 24;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const xLabels = series[0]?.points.map((p) => p.x) ?? [];
  const allY = series.flatMap((s) => s.points.map((p) => p.y)).concat(baseline ? [baseline.y] : []);
  const maxY = Math.max(1, ...allY) * 1.08;
  const minY = Math.min(0, ...allY);
  const yToPx = (y: number) => padT + plotH - ((y - minY) / (maxY - minY || 1)) * plotH;
  const xToPx = (i: number) => padL + (xLabels.length <= 1 ? plotW / 2 : (i / (xLabels.length - 1)) * plotW);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
        {/* gridlines */}
        {[0, 0.5, 1].map((t) => (
          <line key={t} x1={padL} x2={width - padR} y1={padT + plotH * t} y2={padT + plotH * t} stroke="#2d2d32" strokeWidth={1} />
        ))}

        {baseline && (
          <>
            <line x1={padL} x2={width - padR} y1={yToPx(baseline.y)} y2={yToPx(baseline.y)} stroke="#93939c" strokeWidth={1} strokeDasharray="3,3" />
            <text x={width - padR} y={yToPx(baseline.y) - 4} textAnchor="end" fontSize={10} fill="#93939c">{baseline.label}</text>
          </>
        )}

        {series.map((s) => {
          const path = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xToPx(i)} ${yToPx(p.y)}`).join(' ');
          return (
            <g key={s.label}>
              <path d={path} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {s.points.map((p, i) => (
                <circle key={i} cx={xToPx(i)} cy={yToPx(p.y)} r={hoverIdx === i ? 5 : 4} fill={s.color} stroke="#18181b" strokeWidth={2} />
              ))}
            </g>
          );
        })}

        {/* hit targets */}
        {xLabels.map((x, i) => (
          <rect
            key={x}
            x={xToPx(i) - plotW / Math.max(1, xLabels.length) / 2}
            y={padT}
            width={plotW / Math.max(1, xLabels.length)}
            height={plotH}
            fill="transparent"
            onPointerEnter={() => setHoverIdx(i)}
            onPointerLeave={() => setHoverIdx((cur) => (cur === i ? null : cur))}
          />
        ))}

        {hoverIdx !== null && (
          <line x1={xToPx(hoverIdx)} x2={xToPx(hoverIdx)} y1={padT} y2={padT + plotH} stroke="#93939c" strokeWidth={1} />
        )}

        {/* x-axis labels: first, last, and hovered */}
        {xLabels.map((x, i) => (
          (i === 0 || i === xLabels.length - 1 || i === hoverIdx) && (
            <text key={x} x={xToPx(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'} fontSize={10} fill="#93939c">{x}</text>
          )
        ))}
      </svg>

      {hoverIdx !== null && (
        <div
          className="absolute top-1 pointer-events-none rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-card"
          style={{ left: `${(xToPx(hoverIdx) / width) * 100}%`, transform: 'translateX(-50%)' }}
        >
          <div className="text-muted mb-1">{xLabels[hoverIdx]}</div>
          {series.map((s) => (
            <div key={s.label} className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-0.5" style={{ backgroundColor: s.color }} />
              <span className="text-muted">{s.label}</span>
              <span className="font-mono font-semibold ml-auto">{format(s.points[hoverIdx].y)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
