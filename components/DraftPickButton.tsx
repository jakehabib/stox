'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { draftPlayerAction } from '@/app/actions/draft';

export function DraftPickButton({ leagueId, teamId, playerId }: { leagueId: string; teamId: string; playerId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <button
      className="btn-primary text-xs px-2.5 py-1"
      disabled={pending}
      onClick={() => startTransition(async () => { await draftPlayerAction(leagueId, playerId, teamId); router.refresh(); })}
    >
      {pending ? 'Drafting…' : 'Draft'}
    </button>
  );
}
