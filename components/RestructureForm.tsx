'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { restructureContractAction } from '@/app/actions/roster';
import { formatMoney, proration, capHit, capHitSchedule, deadMoneyOnCut, restructureContract as computeRestructure } from '@/lib/cap';

interface ContractShape {
  years: number; yearsRemaining: number; signedYear: number;
  baseSalaries: string; signingBonus: number; guaranteed: number; voidYears: number;
}

/**
 * Convert part of THIS year's base salary into signing bonus for immediate
 * cap relief — the classic real-NFL restructure. Shows the trade-off
 * explicitly: lower this-year hit, higher future hits, more dead money if
 * cut later, since that's exactly the tension that makes it a real decision.
 */
export function RestructureForm({ leagueId, playerId, contract, capSpace, onDone }: {
  leagueId: string; playerId: string; contract: ContractShape; capSpace: number; onDone?: () => void;
}) {
  const bases: number[] = JSON.parse(contract.baseSalaries);
  const yearIdx = Math.max(0, contract.years - contract.yearsRemaining);
  const currentBase = bases[yearIdx] ?? 0;
  const maxConvert = Math.max(0, currentBase - 1_000_000);

  const [convert, setConvert] = useState(Math.round(maxConvert / 2 / 100_000) * 100_000);
  const [addVoidYears, setAddVoidYears] = useState(0);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  // The current season, derived from the deal itself: yearsRemaining ticks
  // down one per league year, so signedYear + years-elapsed IS this year.
  // (The component deliberately takes no seasonYear prop — every call site
  // already passes `contract` and nothing else needs changing.)
  const nowYear = contract.signedYear + yearIdx;

  const preview = useMemo(() => {
    const next = computeRestructure(contract, convert, { addVoidYears, nowYear });
    const nextShaped = { ...next, baseSalaries: JSON.stringify(next.baseSalaries) };
    const oldHit = (bases[yearIdx] ?? 0) + proration(contract);
    const newHit = capHit(nextShaped, 'REALISTIC');
    // The whole point of the warning below: what the deal looks like in
    // EVERY year left, not just this one. capHitSchedule slices from the
    // year already elapsed, so index 0 is this season for both shapes.
    const oldSchedule = capHitSchedule(contract, 'REALISTIC');
    const newSchedule = capHitSchedule(nextShaped, 'REALISTIC');
    return {
      oldHit,
      newHit,
      oldDead: deadMoneyOnCut(contract, 'REALISTIC'),
      newDead: deadMoneyOnCut(nextShaped, 'REALISTIC'),
      capFreed: oldHit - newHit,
      oldSchedule,
      newSchedule,
      /** Extra cap charged in future years to buy this year's relief. */
      futureCost: newSchedule.slice(1).reduce((a, b) => a + b, 0) - oldSchedule.slice(1).reduce((a, b) => a + b, 0),
    };
  }, [convert, addVoidYears]);

  const submit = () => {
    startTransition(async () => {
      const result = await restructureContractAction(leagueId, playerId, convert, addVoidYears);
      setMsg({ ok: result.ok, text: result.message });
      if (result.ok) { router.refresh(); onDone?.(); }
    });
  };

  if (maxConvert < 100_000) {
    return <p className="text-sm text-muted">This contract's base salary is already at the minimum — nothing left to convert.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="label-sm">Convert to signing bonus</label>
          <span className="text-xs font-mono">{formatMoney(convert)} of {formatMoney(currentBase)}</span>
        </div>
        <input type="range" min={0} max={maxConvert} step={100000} value={convert} onChange={(e) => setConvert(Number(e.target.value))} className="w-full accent-accent" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="label-sm">Add void years</label>
          <span className="text-xs font-mono">{addVoidYears === 0 ? 'None' : `+${addVoidYears}`}</span>
        </div>
        <input type="range" min={0} max={3} step={1} value={addVoidYears} onChange={(e) => setAddVoidYears(Number(e.target.value))} className="w-full accent-warn" />
        <p className="text-[11px] text-muted mt-1">More void years spread the new bonus thinner (more relief now), but every bit of it hits as dead money at once when the real deal ends.</p>
      </div>

      <div className="card-pad !p-3 rounded-lg bg-raised space-y-1.5 text-sm">
        <div className="flex justify-between"><span className="text-muted">This year's cap hit</span><span className="font-mono">{formatMoney(preview.oldHit)} → <span className="text-accent font-semibold">{formatMoney(preview.newHit)}</span></span></div>
        <div className="flex justify-between"><span className="text-muted">Cap space freed up</span><span className={`font-mono font-semibold ${preview.capFreed >= 0 ? 'text-accent' : 'text-bad'}`}>{formatMoney(preview.capFreed)}</span></div>
        <div className="flex justify-between pt-1 border-t border-line/60"><span className="text-muted">Your cap space after</span><span className="font-mono font-semibold text-accent">{formatMoney(capSpace + preview.capFreed)}</span></div>
        <div className="flex justify-between"><span className="text-muted">Dead money if cut</span><span className="font-mono">{formatMoney(preview.oldDead)} → <span className="text-bad font-semibold">{formatMoney(preview.newDead)}</span></span></div>
      </div>

      {preview.newSchedule.length > 1 && (
        <div className="panel p-3 space-y-1.5">
          <div className="label-sm">Every year left on the deal</div>
          <div className="flex gap-1.5">
            {preview.newSchedule.map((hit, i) => {
              const was = preview.oldSchedule[i] ?? 0;
              const worse = hit > was;
              return (
                <div key={i} className="flex-1 min-w-0 text-center">
                  <div className="label-sm !text-[10px]">{nowYear + i}</div>
                  <div className={`stat-value text-stat-sm ${worse ? 'text-bad' : 'text-accent'}`}>{formatMoney(hit)}</div>
                  <div className="text-[10px] text-muted font-mono truncate">was {formatMoney(was)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {preview.futureCost > 0 && (
        <p className="text-xs text-warn">
          You are borrowing {formatMoney(preview.capFreed)} from this season and paying back {formatMoney(preview.futureCost)}
          {' '}across the later years of the deal. That money does not disappear — it just moves.
        </p>
      )}

      <p className="text-xs text-bad">
        The trap: restructure now and cut him later and you pay for BOTH. His dead money rises from{' '}
        {formatMoney(preview.oldDead)} to {formatMoney(preview.newDead)} — release him after this and{' '}
        {formatMoney(preview.newDead)} lands on your cap for a player who is no longer on the roster.
        Only restructure a player you intend to keep.
      </p>

      <p className="text-xs text-muted">Future years absorb the rest — this only moves WHEN the money hits the cap, not how much you owe overall.</p>

      <button disabled={pending || convert <= 0} onClick={submit} className="btn-primary w-full disabled:opacity-40">
        {pending ? 'Restructuring…' : 'Restructure Contract'}
      </button>
      {msg && <p className={`text-xs ${msg.ok ? 'text-accent' : 'text-accent2'}`}>{msg.text}</p>}
    </div>
  );
}
