'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { offerContractAction } from '@/app/actions/roster';
import { marketValue, suggestedYears, formatMoney } from '@/lib/cap';

export function SignOfferForm({ leagueId, teamId, playerId, ovr, position, age }: {
  leagueId: string; teamId: string; playerId: string; ovr: number; position: string; age: number;
}) {
  const suggested = marketValue({ ovr, position: position as any, age });
  const [apy, setApy] = useState(Math.round(suggested / 100_000) * 100_000);
  const [years, setYears] = useState(suggestedYears(ovr, age));
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  const submit = () => {
    startTransition(async () => {
      const result = await offerContractAction(leagueId, playerId, teamId, apy, years);
      setMsg(result.message);
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Market estimate: ~{formatMoney(suggested)}/yr</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label-sm block mb-1">Annual salary</label>
          <input type="number" step={100000} className="input w-full" value={apy} onChange={(e) => setApy(Number(e.target.value))} />
        </div>
        <div>
          <label className="label-sm block mb-1">Years</label>
          <input type="number" min={1} max={6} className="input w-full" value={years} onChange={(e) => setYears(Number(e.target.value))} />
        </div>
      </div>
      <button disabled={pending} onClick={submit} className="btn-primary w-full">{pending ? 'Negotiating…' : 'Offer Contract'}</button>
      {msg && <p className="text-xs text-accent2">{msg}</p>}
    </div>
  );
}
