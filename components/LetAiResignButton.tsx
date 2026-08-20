'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { letAiResignAction } from '@/app/actions/resign';

export function LetAiResignButton({ leagueId }: { leagueId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ kept: number; released: number } | null>(null);
  const router = useRouter();

  const run = () => {
    startTransition(async () => {
      const r = await letAiResignAction(leagueId);
      setResult(r);
      setConfirming(false);
      router.refresh();
    });
  };

  if (result) {
    return (
      <div className="text-sm text-muted">
        AI handled it — kept {result.kept}, let {result.released} walk.
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted flex-1">Let the AI decide every pending re-sign on your roster?</span>
        <button disabled={pending} onClick={run} className="btn-primary text-xs px-3 py-1.5">
          {pending ? 'Deciding…' : 'Confirm'}
        </button>
        <button onClick={() => setConfirming(false)} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
      </div>
    );
  }

  return (
    <button onClick={() => setConfirming(true)} className="btn-secondary text-sm">
      Let the AI Pick
    </button>
  );
}
