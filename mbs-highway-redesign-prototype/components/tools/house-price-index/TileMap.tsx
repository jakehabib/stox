'use client';

import { useState } from 'react';
import { binEdges, binIndex } from '@/lib/calculations/hpi';
import { pct } from '@/lib/format';

/** Square tile-grid cartogram of the 50 states + DC: [code, col, row]. */
const TILES: [string, number, number][] = [
  ['AK', 0, 0], ['ME', 10, 0],
  ['WI', 5, 1], ['VT', 9, 1], ['NH', 10, 1],
  ['WA', 0, 2], ['ID', 1, 2], ['MT', 2, 2], ['ND', 3, 2], ['MN', 4, 2], ['IL', 5, 2], ['MI', 6, 2], ['NY', 8, 2], ['MA', 9, 2],
  ['OR', 0, 3], ['NV', 1, 3], ['WY', 2, 3], ['SD', 3, 3], ['IA', 4, 3], ['IN', 5, 3], ['OH', 6, 3], ['PA', 7, 3], ['NJ', 8, 3], ['CT', 9, 3], ['RI', 10, 3],
  ['CA', 0, 4], ['UT', 1, 4], ['CO', 2, 4], ['NE', 3, 4], ['MO', 4, 4], ['KY', 5, 4], ['WV', 6, 4], ['VA', 7, 4], ['MD', 8, 4], ['DE', 9, 4],
  ['AZ', 1, 5], ['NM', 2, 5], ['KS', 3, 5], ['AR', 4, 5], ['TN', 5, 5], ['NC', 6, 5], ['SC', 7, 5], ['DC', 8, 5],
  ['OK', 3, 6], ['LA', 4, 6], ['MS', 5, 6], ['AL', 6, 6], ['GA', 7, 6],
  ['HI', 0, 7], ['TX', 3, 7], ['FL', 8, 7],
];

/** Sequential single-hue ramp (light → dark), validated blue steps 100…700. */
export const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

const CELL = 52;
const GAP = 4;

export function TileMap({
  values,
  selected,
  onSelect,
  tooltip,
  highlightGroup,
}: {
  values: Record<string, number>;
  selected?: string | null;
  onSelect?: (code: string) => void;
  tooltip?: (code: string) => string;
  /** Codes to outline together (e.g. all states in the selected division). */
  highlightGroup?: string[];
}) {
  const [hover, setHover] = useState<string | null>(null);
  const vals = Object.values(values).filter(Number.isFinite);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const edges = binEdges(min, max, RAMP.length);
  const W = 11 * CELL;
  const H = 8 * CELL;
  const hoverTile = hover ? TILES.find((t) => t[0] === hover) : null;

  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Map of states colored by house price change">
          {TILES.map(([code, c, r]) => {
            const v = values[code];
            const bin = binIndex(v, min, max, RAMP.length);
            const isSel = selected === code;
            const inGroup = highlightGroup?.includes(code);
            const dark = bin >= 3;
            return (
              <g
                key={code}
                transform={`translate(${c * CELL + GAP / 2}, ${r * CELL + GAP / 2})`}
                onClick={() => onSelect?.(code)}
                onMouseEnter={() => setHover(code)}
                onMouseLeave={() => setHover(null)}
                className="cursor-pointer"
                role="button"
                aria-label={tooltip ? tooltip(code) : `${code} ${pct(v, 2)}`}
                tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect?.(code)}
              >
                <rect
                  width={CELL - GAP}
                  height={CELL - GAP}
                  rx={6}
                  fill={RAMP[bin]}
                  stroke={isSel ? '#0b0b0b' : inGroup ? '#52514e' : hover === code ? '#52514e' : 'none'}
                  strokeWidth={isSel ? 3 : inGroup || hover === code ? 1.5 : 0}
                />
                <g className="hidden sm:inline">
                  <text x={(CELL - GAP) / 2} y={19} textAnchor="middle" fontSize={13} fontWeight={700} fill={dark ? '#ffffff' : '#0b0b0b'}>
                    {code}
                  </text>
                  <text x={(CELL - GAP) / 2} y={36} textAnchor="middle" fontSize={11} fill={dark ? '#ffffff' : '#27325c'}>
                    {Number.isFinite(v) ? `${v.toFixed(Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2)}` : '—'}
                  </text>
                </g>
                <text className="sm:hidden" x={(CELL - GAP) / 2} y={(CELL - GAP) / 2 + 6} textAnchor="middle" fontSize={17} fontWeight={700} fill={dark ? '#ffffff' : '#0b0b0b'}>
                  {code}
                </text>
              </g>
            );
          })}
        </svg>
        {hoverTile && tooltip && (
          <div
            className="pointer-events-none absolute z-10 hidden -translate-x-1/2 -translate-y-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lift sm:block"
            style={{ left: `${((hoverTile[1] + 0.5) / 11) * 100}%`, top: `${(hoverTile[2] / 8) * 100}%` }}
          >
            <span className="whitespace-nowrap font-medium text-slate-900">{tooltip(hoverTile[0])}</span>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <div className="inline-flex items-start gap-2">
        <span>Lower</span>
        <div className="flex">
          {RAMP.map((c, i) => (
            <div key={c} className="flex flex-col items-center">
              <span className="h-2.5 w-7 sm:w-10" style={{ background: c }} />
              <span className="mt-0.5 tabular-nums">{i === 0 ? pct(edges[0], 1, { trim: false }) : i === RAMP.length - 1 ? pct(edges[RAMP.length], 1, { trim: false }) : ''}</span>
            </div>
          ))}
        </div>
        <span>Higher</span>
        </div>
        <span className="sm:ml-auto">Values in % change</span>
      </div>
    </div>
  );
}
