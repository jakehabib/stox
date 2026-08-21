'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { draftPlayerAction } from '@/app/actions/draft';

export function DraftPickButton({ leagueId, teamId, playerId }: { leagueId: string; teamId: string; playerId: string }) {
  const [pending, startTransition] = useTransition();
  // A pick can be refused by the salary cap — the rookie deal has to fit
  // under the ceiling like any other contract. Show why, right here, rather
  // than letting the throw blank the draft board.
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="space-y-1">
      <button
        className="btn-primary text-xs px-2.5 py-1"
        disabled={pending}
        onClick={() => startTransition(async () => {
          const res = await draftPlayerAction(leagueId, playerId, teamId);
          if (!res.ok) { setError(res.message); return; }
          setError(null);
          router.refresh();
        })}
      >
        {pending ? 'Drafting…' : 'Draft'}
      </button>
      {error && <p className="text-[11px] text-bad max-w-[16rem] leading-snug">{error}</p>}
    </div>
  );
}
