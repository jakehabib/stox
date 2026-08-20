'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { fillRosterAction } from '@/app/actions/roster';

export function FillRosterButton({ leagueId, teamId }: { leagueId: string; teamId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ signed: { name: string; position: string; apy: number }[] } | null>(null);

  const router = useRouter();

  const run = () => {
    startTransition(async () => {
      const r = await fillRosterAction(leagueId, teamId);
      setResult(r);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button onClick={run} disabled={pending} className="btn-secondary text-sm">
        {pending ? 'Signing…' : 'Fill Roster'}
      </button>
      {result && (
        <div className="text-xs text-muted text-right max-w-xs">
          {result.signed.length === 0
            ? 'No signings — no notable needs, no cap room, or no bodies available at your needed positions.'
            : `Signed ${result.signed.length}: ${result.signed.map((s) => `${s.name} (${s.position})`).join(', ')}`}
        </div>
      )}
    </div>
  );
}
