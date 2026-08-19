'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { offerContractAction, checkCompetingBidAction } from '@/app/actions/roster';
import { marketValue, suggestedYears, formatMoney, buildContract, capHit } from '@/lib/cap';
import { CapMode } from '@/lib/types';

export function SignOfferForm({ leagueId, teamId, playerId, ovr, position, age, capSpace, capMode }: {
  leagueId: string; teamId: string; playerId: string; ovr: number; position: string; age: number;
  capSpace: number; capMode: CapMode;
}) {
  const suggested = marketValue({ ovr, position: position as any, age });
  const [apy, setApy] = useState(Math.round(suggested / 100_000) * 100_000);
  const [years, setYears] = useState(suggestedYears(ovr, age));
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

  // Mirrors exactly what signFreeAgent will build server-side for a fresh
  // signing, so this preview is never wrong about what's about to happen —
  // including the crash this used to cause when it silently didn't match.
  const projected = useMemo(() => {
    const c = buildContract({ apy, years, signedYear: 0 });
    const hit = capHit({ years: c.years, yearsRemaining: c.years, signedYear: 0, baseSalaries: JSON.stringify(c.baseSalaries), signingBonus: c.signingBonus, guaranteed: c.guaranteed }, capMode);
    const total = c.baseSalaries.reduce((a, b) => a + b, 0) + c.signingBonus;
    return { hit, total, guaranteed: c.guaranteed };
  }, [apy, years, capMode]);

  const overCap = capMode !== 'OFF' && projected.hit > capSpace;
  const remainingAfter = capSpace - projected.hit;

  const submit = () => {
    startTransition(async () => {
      const result = await offerContractAction(leagueId, playerId, teamId, apy, years);
      setMsg({ ok: result.ok, text: result.message });
      if (result.ok) router.refresh();
    });
  };

  const setApyPct = (pct: number) => setApy(Math.round((suggested * pct) / 100 / 100_000) * 100_000);
  const beingOutbid = !!competing && apy < competing.apy;

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
        <input
          type="number" step={100000} min={1_000_000} className="input w-full font-mono"
          value={apy} onChange={(e) => setApy(Math.max(0, Number(e.target.value)))}
        />
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
        <input
          type="range" min={1} max={6} step={1} value={years}
          onChange={(e) => setYears(Number(e.target.value))}
          className="w-full accent-accent"
        />
      </div>

      <div className="card-pad !p-3 rounded-lg bg-raised space-y-1.5 text-sm">
        <div className="flex justify-between"><span className="text-muted">Total value</span><span className="font-mono">{formatMoney(projected.total)}</span></div>
        <div className="flex justify-between"><span className="text-muted">Guaranteed (est.)</span><span className="font-mono">{formatMoney(projected.guaranteed)}</span></div>
        {capMode !== 'OFF' && (
          <>
            <div className="flex justify-between"><span className="text-muted">Year 1 cap hit</span><span className={`font-mono ${overCap ? 'text-bad' : 'text-chalk'}`}>{formatMoney(projected.hit)}</span></div>
            <div className="flex justify-between pt-1 border-t border-line/60">
              <span className="text-muted">Cap space after signing</span>
              <span className={`font-mono font-semibold ${remainingAfter < 0 ? 'text-bad' : 'text-accent'}`}>{formatMoney(remainingAfter)}</span>
            </div>
          </>
        )}
      </div>

      {overCap && (
        <p className="text-xs text-bad">This offer's year-1 cap hit exceeds your available space — lower the salary, shorten the deal, or clear room elsewhere first.</p>
      )}

      <button disabled={pending || overCap} onClick={submit} className={`w-full disabled:opacity-40 ${beingOutbid ? 'btn-danger' : 'btn-primary'}`}>
        {pending ? 'Negotiating…' : overCap ? 'Not Enough Cap Space' : beingOutbid ? 'Offer Contract (Currently Losing)' : 'Offer Contract'}
      </button>
      {msg && <p className={`text-xs ${msg.ok ? 'text-accent' : 'text-accent2'}`}>{msg.text}</p>}
    </div>
  );
}
