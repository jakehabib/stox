'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { autoSortDepthChartAction } from '@/app/actions/roster';

export function AutoSortButton({ teamId }: { teamId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <button
      className="btn-secondary"
      disabled={pending}
      onClick={() => startTransition(async () => { await autoSortDepthChartAction(teamId); router.refresh(); })}
    >
      {pending ? 'Sorting…' : 'Auto-Sort by Rating'}
    </button>
  );
}
