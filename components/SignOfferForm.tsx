'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { offerContractAction, checkCompetingBidAction } from '@/app/actions/roster';
import { marketValue, suggestedYears, formatMoney, buildContract, capHitSchedule } from '@/lib/cap';
import { CapMode } from '@/lib/types';
import { MoneyInput } from './MoneyInput';

/**
 * Free-agency negotiation. Carries the same real structuring the extension
 * form has (front/back-loading, void years, a full per-year cap schedule) —
 * signing an outside free agent is the same cap decision as extending your
 * own guy, so it gets the same tools — plus the one thing unique to the open
 * market: a live read on who else is bidding.
 */
export function SignOfferForm({ leagueId, teamId, playerId, ovr, position, age, capSpace, capMode }: {
  leagueId: string; teamId: string; playerId: string; ovr: number; position: string; age: number;
  capSpace: number; capMode: CapMode;
}) {
  const suggested = marketValue({ ovr, position: position as any, age });
  const [apy, setApy] = useState(Math.round(suggested / 100_000) * 100_000);
  const [years, setYears] = useState(suggestedYears(ovr, age));
  const [structure, setStructure] = useState(1.0); // <1 front-loaded, 1 flat, >1 back-loaded
  const [voidYears, setVoidYears] = useState(0);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [competing, setCompeting] = useState<{ teamName: string; apy: number } | null | undefined>(undefined);
  const router = useRouter();

  // Free agency frenzy — show what the leading rival offer actually is
  // before the user commits, the way real open bidding works. undefined =
  // still checking, null = nobody else is interested.
  useEffect(() => {
    let cancelled = false;
    checkCompetingBidAction(leagueId, playerId, teamId).then((res) => { if (!cancelled) setCompeting(res); });
    return () => { cancelled = true; };
  }, [leagueId, playerId, teamId]);

  // Mirrors exactly what signFreeAgent builds server-side, so this preview is
  // never wrong about what's about to happen.
  const preview = useMemo(() => {
    const c = buildContract({ apy, years, signedYear: 0, escalation: structure });
    const schedule = capHitSchedule({ ...c, baseSalaries: JSON.stringify(c.baseSalaries), voidYears }, capMode);
    const total = c.baseSalaries.reduce((a, b) => a + b, 0) + c.signingBonus;
    // What void years push past the end of the deal — charged as dead money
    // the season it expires (see releaseUnresignedExpiringContracts).
    const prorated = Math.min(years + voidYears, 5);
    const stranded = voidYears > 0 ? Math.max(0, c.signingBonus - Math.round(c.signingBonus / prorated) * years) : 0;
    return { schedule, total, guaranteed: c.guaranteed, stranded };
  }, [apy, years, structure, voidYears, capMode]);

  const year1 = preview.schedule[0] ?? 0;
  const overCap = capMode !== 'OFF' && year1 > capSpace;
  const remainingAfter = capSpace - year1;

  const submit = () => {
    startTransition(async () => {
      const result = await offerContractAction(leagueId, playerId, teamId, apy, years, structure, voidYears);
      setMsg({ ok: result.ok, text: result.message });
      if (result.ok) router.refresh();
    });
  };

  const setApyPct = (pct: number) => setApy(Math.round((suggested * pct) / 100 / 100_000) * 100_000);
  const beingOutbid = !!competing && apy < competing.apy;
  const structureLabel = structure < 0.95 ? 'Front-loaded' : structure > 1.05 ? 'Back-loaded' : 'Balanced';

  return (
    <div className="space-y-4">
      {competing !== undefined && (
        <div className={`text-xs px-3 py-2 rounded-lg border ${competing ? (beingOutbid ? 'border-bad/30 bg-bad/10 text-bad' : 'border-accent/30 bg-accent/10 text-accent') : 'border-line bg-raised text-muted'}`}>
          {competing
            ? `${competing.teamName} is in the mix at ~${formatMoney(competing.apy)}/yr${beingOutbid ? ' — you need to beat that.' : ' — your offer currently leads.'}`
            : 'No other teams appear to be bidding on him right now.'}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="label-sm">Annual salary</label>
          <span className="text-xs text-muted">Market est. ~{formatMoney(suggested)}/yr</span>
        </div>
        <MoneyInput value={apy} onChange={setApy} min={1_000_000} />
        <div className="flex gap-1.5 mt-1.5 flex-wrap">
          <button type="button" onClick={() => setApyPct(85)} className="pill border-line text-muted hover:text-chalk">85%</button>
          <button type="button" onClick={() => setApyPct(100)} className="pill border-line text-muted hover:text-chalk">Match Market</button>
          <button type="button" onClick={() => setApyPct(115)} className="pill border-line text-muted hover:text-chalk">115%</button>
          <button type="button" onClick={() => setApyPct(130)} className="pill border-line text-muted hover:text-chalk">130%</button>
          {beingOutbid && competing && (
            <button
              type="button"
              onClick={() => setApy(Math.round((competing.apy * 1.03) / 100_000) * 100_000)}
              className="pill border-bad/40 text-bad hover:bg-bad/10"
            >
              Beat {competing.teamName.split(' ').pop()}'s Offer
            </button>
          )}
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
          <p className="text-[11px] text-muted mt-1">
            Spreads bonus proration further to lower every real year's cap hit — but the remainder lands as dead money the season this deal ends.
          </p>
        </div>
      )}

      <div className="panel p-3 space-y-1.5 text-sm">
        <div className="flex justify-between"><span className="text-muted">Total value</span><span className="font-mono">{formatMoney(preview.total)}</span></div>
        <div className="flex justify-between"><span className="text-muted">Guaranteed (est.)</span><span className="font-mono">{formatMoney(preview.guaranteed)}</span></div>
        {capMode !== 'OFF' && (
          <>
            <div className="flex justify-between pt-2 border-t border-line/60">
              <span className="text-muted">Cap space after signing</span>
              <span className={`stat-value text-stat-sm ${remainingAfter < 0 ? 'text-bad' : 'text-accent'}`}>{formatMoney(remainingAfter)}</span>
            </div>
            <div>
              <div className="text-xs text-muted mb-1">Cap hit by year</div>
              <div className="flex flex-wrap gap-2">
                {preview.schedule.map((hit, i) => (
                  <div key={i} className={`pill ${i === 0 && overCap ? 'border-bad/40 text-bad' : 'border-line text-chalk'}`}>
                    Yr{i + 1}: {formatMoney(hit)}
                  </div>
                ))}
                {preview.stranded > 0 && (
                  <div className="pill border-warn/40 text-warn" title="Bonus proration pushed past the end of the deal by void years — charged as dead money the season it expires.">
                    Void: {formatMoney(preview.stranded)}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {overCap && (
        <p className="text-xs text-bad">This offer's year-1 cap hit exceeds your available space — lower the salary, front-load less, or clear room elsewhere first.</p>
      )}

      <button disabled={pending || overCap} onClick={submit} className={`w-full disabled:opacity-40 ${beingOutbid ? 'btn-danger' : 'btn-primary'}`}>
        {pending ? 'Negotiating…' : overCap ? 'Not Enough Cap Space' : beingOutbid ? 'Offer Contract (Currently Losing)' : 'Offer Contract'}
      </button>
      {msg && <p className={`text-xs ${msg.ok ? 'text-accent' : 'text-accent2'}`}>{msg.text}</p>}
    </div>
  );
}
