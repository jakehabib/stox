'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toggleShortlistAction } from '@/app/actions/draft';

export function ShortlistStar({ leagueId, teamId, playerId, initial }: {
  leagueId: string; teamId: string; playerId: string; initial: boolean;
}) {
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      disabled={pending}
      onClick={(e) => {
        e.stopPropagation();
        setOn((v) => !v);
        startTransition(async () => {
          await toggleShortlistAction(leagueId, teamId, playerId);
          router.refresh();
        });
      }}
      title={on ? 'Remove from shortlist' : 'Add to shortlist'}
      className={`text-base leading-none ${on ? 'text-gold' : 'text-line hover:text-muted'}`}
    >
      {on ? '★' : '☆'}
    </button>
  );
}
