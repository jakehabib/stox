'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cutPlayerAction } from '@/app/actions/roster';

export function CutButton({ leagueId, playerId }: { leagueId: string; playerId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!confirming) {
    return <button onClick={() => setConfirming(true)} className="btn-danger w-full">Release Player</button>;
  }

  return (
    <div className="flex gap-2">
      <button
        disabled={pending}
        onClick={() => startTransition(async () => { await cutPlayerAction(leagueId, playerId); router.push(`/league/${leagueId}/roster`); })}
        className="btn-danger flex-1"
      >
        {pending ? 'Releasing…' : 'Confirm Release'}
      </button>
      <button onClick={() => setConfirming(false)} className="btn-ghost">Cancel</button>
    </div>
  );
}
