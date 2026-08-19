'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { scoutPlayerAction } from '@/app/actions/scouting';

export function ScoutButton({ leagueId, teamId, playerId }: { leagueId: string; teamId: string; playerId: string }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  const spend = (points: number) => {
    startTransition(async () => {
      const result = await scoutPlayerAction(leagueId, teamId, playerId, points);
      setMsg(`Confidence now ${result.confidence}%`);
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2 shrink-0">
      {msg && <span className="text-xs text-accent">{msg}</span>}
      <button disabled={pending} onClick={() => spend(40)} className="btn-secondary">Assign Scout (40 pts)</button>
      <button disabled={pending} onClick={() => spend(100)} className="btn-primary">Focus Report (100 pts)</button>
    </div>
  );
}
