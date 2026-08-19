'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { extendContractAction } from '@/app/actions/roster';
import { marketValue, suggestedYears, formatMoney, buildContract, capHitSchedule } from '@/lib/cap';
import { CapMode } from '@/lib/types';

/**
 * Extension negotiation for a player already on the roster — the real-NFL
 * structuring the SignOfferForm (free agency) intentionally keeps simple.
 * The whole point here is showing the FULL per-year schedule, since
 * front-loading vs back-loading only means anything across multiple years.
 */
export function ExtendContractForm({ leagueId, playerId, ovr, position, age, availableSpace, capMode, onDone }: {
  leagueId: string; playerId: string; ovr: number; position: string; age: number;
  availableSpace: number; capMode: CapMode; onDone?: () => void;
}) {
  const suggested = marketValue({ ovr, position: position as any, age });
  const [apy, setApy] = useState(Math.round(suggested / 100_000) * 100_000);
  const [years, setYears] = useState(suggestedYears(ovr, age));
  const [structure, setStructure] = useState(1.0); // <1 front-loaded, 1 flat, >1 back-loaded
  const [voidYears, setVoidYears] = useState(0);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  const preview = useMemo(() => {
    const c = buildContract({ apy, years, signedYear: 0, escalation: structure });
    const schedule = capHitSchedule({ ...c, baseSalaries: JSON.stringify(c.baseSalaries), voidYears }, capMode);
    const total = c.baseSalaries.reduce((a, b) => a + b, 0) + c.signingBonus;
    return { schedule, total, guaranteed: c.guaranteed };
  }, [apy, years, structure, voidYears, capMode]);

  const year1 = preview.schedule[0] ?? 0;
  const overCap = capMode !== 'OFF' && year1 > availableSpace;

  const submit = () => {
    startTransition(async () => {
      const result = await extendContractAction(leagueId, playerId, apy, years, structure, voidYears);
      setMsg({ ok: result.ok, text: result.message });
      if (result.ok) { router.refresh(); onDone?.(); }
    });
  };

  const setApyPct = (pct: number) => setApy(Math.round((suggested * pct) / 100_000) * 100_000);
  const structureLabel = structure < 0.95 ? 'Front-loaded' : structure > 1.05 ? 'Back-loaded' : 'Balanced';

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="label-sm">Annual salary</label>
          <span className="text-xs text-muted">Market est. ~{formatMoney(suggested)}/yr</span>
        </div>
        <input type="number" step={100000} min={1_000_000} className="input w-full font-mono" value={apy} onChange={(e) => setApy(Math.max(0, Number(e.target.value)))} />
        <div className="flex gap-1.5 mt-1.5">
          <button type="button" onClick={() => setApyPct(85)} className="pill border-line text-muted hover:text-chalk">85%</button>
          <button type="button" onClick={() => setApyPct(100)} className="pill border-line text-muted hover:text-chalk">Match Market</button>
          <button type="button" onClick={() => setApyPct(115)} className="pill border-line text-muted hover:text-chalk">115%</button>
          <button type="button" onClick={() => setApyPct(130)} className="pill border-line text-muted hover:text-chalk">130%</button>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="label-sm">Contract length</label>
          <span className="text-xs font-mono">{years} yr{years === 1 ? '' : 's'}</span>
        </div>
        <input type="range" min={1} max={7} step={1} value={years} onChange={(e) => setYears(Number(e.target.value))} className="w-full accent-accent" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="label-sm">Structure</label>
          <span className="text-xs font-mono">{structureLabel}</span>
        </div>
        <input type="range" min={0.85} max={1.25} step={0.01} value={structure} onChange={(e) => setStructure(Number(e.target.value))} className="w-full accent-accent2" />
        <div className="flex justify-between text-[10px] text-muted mt-0.5"><span>Front-load (pay now)</span><span>Back-load (defer cap)</span></div>
      </div>

      {capMode === 'REALISTIC' && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="label-sm">Void years</label>
            <span className="text-xs font-mono">{voidYears === 0 ? 'None' : `+${voidYears}`}</span>
          </div>
          <input type="range" min={0} max={3} step={1} value={voidYears} onChange={(e) => setVoidYears(Number(e.target.value))} className="w-full accent-warn" />
          <p className="text-[11px] text-muted mt-1">Spreads bonus proration further to lower every real year's cap hit — but all of it accelerates as dead money the moment this deal ends.</p>
        </div>
      )}

      <div className="card-pad !p-3 rounded-lg bg-raised space-y-1.5 text-sm">
        <div className="flex justify-between"><span className="text-muted">Total value</span><span className="font-mono">{formatMoney(preview.total)}</span></div>
        <div className="flex justify-between"><span className="text-muted">Guaranteed (est.)</span><span className="font-mono">{formatMoney(preview.guaranteed)}</span></div>
        {capMode !== 'OFF' && (
          <div className="pt-2 border-t border-line/60">
            <div className="text-xs text-muted mb-1">Cap hit by year</div>
            <div className="flex flex-wrap gap-2">
              {preview.schedule.map((hit, i) => (
                <div key={i} className={`pill ${i === 0 && overCap ? 'border-bad/40 text-bad' : 'border-line text-chalk'}`}>
                  Yr{i + 1}: {formatMoney(hit)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {overCap && <p className="text-xs text-bad">Year 1's cap hit exceeds your available space — lower the salary, front-load less, or clear room elsewhere.</p>}

      <button disabled={pending || overCap} onClick={submit} className="btn-primary w-full disabled:opacity-40">
        {pending ? 'Negotiating…' : overCap ? 'Not Enough Cap Space' : 'Sign Extension'}
      </button>
      {msg && <p className={`text-xs ${msg.ok ? 'text-accent' : 'text-accent2'}`}>{msg.text}</p>}
    </div>
  );
}
