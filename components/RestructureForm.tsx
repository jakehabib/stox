'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { restructureContractAction } from '@/app/actions/roster';
import { formatMoney, proration, capHit, deadMoneyOnCut, restructureContract as computeRestructure } from '@/lib/cap';

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
export function RestructureForm({ leagueId, playerId, contract, onDone }: {
  leagueId: string; playerId: string; contract: ContractShape; onDone?: () => void;
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

  const preview = useMemo(() => {
    const next = computeRestructure(contract, convert, { addVoidYears, nowYear: contract.signedYear });
    const nextShaped = { ...next, baseSalaries: JSON.stringify(next.baseSalaries) };
    const oldHit = (bases[yearIdx] ?? 0) + proration(contract);
    const newHit = capHit(nextShaped, 'REALISTIC');
    return {
      oldHit,
      newHit,
      oldDead: deadMoneyOnCut(contract, 'REALISTIC'),
      newDead: deadMoneyOnCut(nextShaped, 'REALISTIC'),
      capFreed: oldHit - newHit,
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
        <div className="flex justify-between pt-1 border-t border-line/60"><span className="text-muted">Dead money if cut</span><span className="font-mono">{formatMoney(preview.oldDead)} → <span className="text-bad font-semibold">{formatMoney(preview.newDead)}</span></span></div>
      </div>

      <p className="text-xs text-muted">Future years absorb the rest — this only moves WHEN the money hits the cap, not how much you owe overall.</p>

      <button disabled={pending || convert <= 0} onClick={submit} className="btn-primary w-full disabled:opacity-40">
        {pending ? 'Restructuring…' : 'Restructure Contract'}
      </button>
      {msg && <p className={`text-xs ${msg.ok ? 'text-accent' : 'text-accent2'}`}>{msg.text}</p>}
    </div>
  );
}
