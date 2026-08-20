'use client';

import { useState } from 'react';
import { formatMoney } from '@/lib/cap';

interface Point {
  id: string;
  x: number;
  y: number;
  label: string;
  color: string;
  detail?: string;
}

const FORMATTERS: Record<string, (v: number) => string> = {
  money: formatMoney,
  integer: (v) => String(Math.round(v)),
  decimal1: (v) => v.toFixed(1),
};

/**
 * Two-measure comparison, one dot per entity (cap hit vs value, completion%
 * vs yards/attempt, etc). Too many entities to direct-label individually, so
 * every dot gets its own hover/focus tooltip with a hit area larger than the
 * painted mark, per the dataviz skill's scatter interaction spec.
 *
 * `formatX`/`formatY` are named format kinds, not functions — Server
 * Components can't pass functions as props to Client Components like this one.
 */
export function ScatterChart({ points, xLabel, yLabel, formatX, formatY, quadrantLines }: {
  points: Point[];
  xLabel: string; yLabel: string;
  formatX: keyof typeof FORMATTERS; formatY: keyof typeof FORMATTERS;
  /** Optional reference lines (e.g. league-average X and Y) splitting the plot into quadrants. */
  quadrantLines?: { x?: number; y?: number };
}) {
  const fmtX = FORMATTERS[formatX];
  const fmtY = FORMATTERS[formatY];
  const [hoverId, setHoverId] = useState<string | null>(null);
  const width = 640, height = 340;
  const padL = 44, padR = 16, padT = 16, padB = 32;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs, quadrantLines?.x ?? Infinity);
  const xMax = Math.max(...xs, quadrantLines?.x ?? -Infinity);
  const yMin = Math.min(...ys, quadrantLines?.y ?? Infinity);
  const yMax = Math.max(...ys, quadrantLines?.y ?? -Infinity);
  const xPad = (xMax - xMin || 1) * 0.08;
  const yPad = (yMax - yMin || 1) * 0.08;
  const xToPx = (x: number) => padL + ((x - (xMin - xPad)) / ((xMax + xPad) - (xMin - xPad) || 1)) * plotW;
  const yToPx = (y: number) => padT + plotH - ((y - (yMin - yPad)) / ((yMax + yPad) - (yMin - yPad) || 1)) * plotH;

  const hovered = points.find((p) => p.id === hoverId);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
        <line x1={padL} x2={width - padR} y1={padT + plotH} y2={padT + plotH} stroke="#383835" strokeWidth={1} />
        <line x1={padL} x2={padL} y1={padT} y2={padT + plotH} stroke="#383835" strokeWidth={1} />
        <text x={padL + plotW / 2} y={height - 6} textAnchor="middle" fontSize={10} fill="#93939c">{xLabel}</text>
        <text x={12} y={padT + plotH / 2} textAnchor="middle" fontSize={10} fill="#93939c" transform={`rotate(-90 12 ${padT + plotH / 2})`}>{yLabel}</text>

        {quadrantLines?.x !== undefined && (
          <line x1={xToPx(quadrantLines.x)} x2={xToPx(quadrantLines.x)} y1={padT} y2={padT + plotH} stroke="#2d2d32" strokeWidth={1} strokeDasharray="3,3" />
        )}
        {quadrantLines?.y !== undefined && (
          <line x1={padL} x2={width - padR} y1={yToPx(quadrantLines.y)} y2={yToPx(quadrantLines.y)} stroke="#2d2d32" strokeWidth={1} strokeDasharray="3,3" />
        )}

        {points.map((p) => (
          <g key={p.id}>
            <circle
              cx={xToPx(p.x)} cy={yToPx(p.y)} r={14} fill="transparent"
              onPointerEnter={() => setHoverId(p.id)} onPointerLeave={() => setHoverId((c) => (c === p.id ? null : c))}
            />
            <circle
              cx={xToPx(p.x)} cy={yToPx(p.y)} r={hoverId === p.id ? 6 : 4.5}
              fill={p.color} stroke="#18181b" strokeWidth={2} style={{ transition: 'r 100ms' }} pointerEvents="none"
            />
          </g>
        ))}
      </svg>

      {hovered && (
        <div
          className="absolute pointer-events-none rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-card z-10"
          style={{
            left: `${(xToPx(hovered.x) / width) * 100}%`, top: `${(yToPx(hovered.y) / height) * 100}%`,
            transform: 'translate(-50%, -120%)',
          }}
        >
          <div className="font-semibold mb-0.5">{hovered.label}</div>
          <div className="text-muted">{xLabel}: <span className="font-mono text-chalk">{fmtX(hovered.x)}</span></div>
          <div className="text-muted">{yLabel}: <span className="font-mono text-chalk">{fmtY(hovered.y)}</span></div>
          {hovered.detail && <div className="text-muted mt-0.5">{hovered.detail}</div>}
        </div>
      )}
    </div>
  );
}
