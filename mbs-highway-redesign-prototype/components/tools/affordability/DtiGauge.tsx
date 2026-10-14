'use client';

import type { DtiZone } from '@/lib/calculations/affordability';
import { pct } from '@/lib/format';

export const ZONE_COLORS: Record<DtiZone, { fill: string; tint: string; tone: 'green' | 'amber' | 'red' }> = {
  Comfortable: { fill: '#10b981', tint: '#ecfdf5', tone: 'green' },
  Stretch: { fill: '#f59e0b', tint: '#fffbeb', tone: 'amber' },
  Aggressive: { fill: '#ef4444', tint: '#fef2f2', tone: 'red' },
};

const MAX = 60;
const CX = 110;
const CY = 105;
const R = 82;

function pt(v: number, r = R) {
  const t = Math.PI * (1 - Math.min(MAX, Math.max(0, v)) / MAX);
  return [CX + r * Math.cos(t), CY - r * Math.sin(t)] as const;
}
function arc(a: number, b: number) {
  const [x1, y1] = pt(a);
  const [x2, y2] = pt(b);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** Semicircle DTI meter: Comfortable ≤36%, Stretch ≤43%, Aggressive >43%. */
export function DtiGauge({ dti, zone, empty }: { dti: number; zone: DtiZone; empty?: boolean }) {
  const [nx, ny] = pt(dti, R - 18);
  const segs: [number, number, DtiZone][] = [
    [0, 36, 'Comfortable'],
    [36, 43, 'Stretch'],
    [43, MAX, 'Aggressive'],
  ];
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 220 128" className="w-full max-w-[280px]" role="img" aria-label={empty ? 'DTI unavailable' : `Debt-to-income ${pct(dti, 1)}, ${zone}`}>
        {segs.map(([a, b, z]) => (
          <path key={z} d={arc(a + (a ? 0.5 : 0), b - (b < MAX ? 0.5 : 0))} stroke={ZONE_COLORS[z].fill} strokeOpacity={empty || z === zone ? 1 : 0.28} strokeWidth={16} fill="none" strokeLinecap="butt" />
        ))}
        {[0, 36, 43, MAX].map((t) => {
          const [x, y] = pt(t, R + 16);
          return (
            <text key={t} x={x} y={y + 3} textAnchor="middle" fontSize="9" fill="#64748b">
              {t}%
            </text>
          );
        })}
        {!empty && (
          <>
            <line x1={CX} y1={CY} x2={nx} y2={ny} stroke="#0f172a" strokeWidth={3} strokeLinecap="round" />
            <circle cx={CX} cy={CY} r={6} fill="#0f172a" stroke="#fff" strokeWidth={2} />
          </>
        )}
      </svg>
      <div className="-mt-1 text-center">
        <div className="text-3xl font-bold tabular-nums text-slate-900">{empty ? '—' : pct(dti, 1)}</div>
        <div className="text-xs font-medium text-slate-500">{empty ? 'Add annual income to see DTI' : `Back-end DTI · ${zone}`}</div>
      </div>
    </div>
  );
}
