'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { advanceToUserPickAction } from '@/app/actions/draft';

export function SkipToMyPickButton({ leagueId, teamId }: { leagueId: string; teamId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <button
      className="btn-secondary text-xs px-2.5 py-1.5"
      disabled={pending}
      onClick={() => startTransition(async () => { await advanceToUserPickAction(leagueId, teamId); router.refresh(); })}
    >
      {pending ? 'Simulating…' : 'Skip to My Pick'}
    </button>
  );
}
