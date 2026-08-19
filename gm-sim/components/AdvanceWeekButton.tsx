'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { advanceWeekAction } from '@/app/actions/league';

export function AdvanceWeekButton({ leagueId }: { leagueId: string }) {
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const router = useRouter();

  const onClick = () => {
    startTransition(async () => {
      const result = await advanceWeekAction(leagueId);
      setToast(result.summary);
      router.refresh();
      setTimeout(() => setToast(null), 6000);
    });
  };

  return (
    <div className="relative">
      <button onClick={onClick} disabled={pending} className="btn-primary">
        {pending ? 'Simulating…' : 'Advance ▸'}
      </button>
      {toast && (
        <div className="absolute right-0 top-full mt-2 w-80 card card-pad text-sm z-30 animate-fadeUp shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
