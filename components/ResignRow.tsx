'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ExtendContractForm } from './ExtendContractForm';
import { PlayerAvatar } from './PlayerAvatar';
import { ratingColor } from '@/lib/ratings';
import { formatMoney } from '@/lib/cap';
import { CapMode } from '@/lib/types';
import { cutPlayerAction, applyFranchiseTagAction } from '@/app/actions/roster';

export function ResignRow({ leagueId, playerId, name, position, age, ovr, currentApy, availableSpace, capMode, yearsRemaining, canTag }: {
  leagueId: string; playerId: string; name: string; position: string; age: number; ovr: number;
  currentApy: number; availableSpace: number; capMode: CapMode; yearsRemaining: number; canTag?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [confirmingWalk, setConfirmingWalk] = useState(false);
  const [tagPending, setTagPending] = useState(false);
  const [tagMessage, setTagMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Still mid-deal (this is his walk year, but the season isn't over) —
  // there's nothing to "decide" yet, just extend early if you want to.
  const isTrulyExpiring = yearsRemaining === 0;

  const notResign = () => {
    startTransition(async () => {
      await cutPlayerAction(leagueId, playerId);
      router.refresh();
    });
  };

  const tag = () => {
    setTagPending(true);
    setTagMessage(null);
    startTransition(async () => {
      const result = await applyFranchiseTagAction(leagueId, playerId);
      setTagPending(false);
      setTagMessage(result.message);
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-raised transition-colors">
        <PlayerAvatar seed={playerId} age={age} size={30} />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{name}</div>
          <div className="text-xs text-muted">
            {position} · Age {age} · Current ~{formatMoney(currentApy)}/yr
            {!isTrulyExpiring && <span className="text-warn"> · final year, expires after this season</span>}
          </div>
        </div>
        <span className={`font-mono font-semibold ${ratingColor(ovr)}`}>{ovr}</span>
        <span className="pill border-line text-muted">{open ? 'Close' : 'Negotiate'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-line/60 space-y-3">
          <ExtendContractForm
            leagueId={leagueId} playerId={playerId} ovr={ovr} position={position} age={age}
            availableSpace={availableSpace} capMode={capMode} onDone={() => setOpen(false)}
          />
          {isTrulyExpiring && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              {confirmingWalk ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted flex-1">Let {name} walk to free agency?</span>
                  <button disabled={pending} onClick={notResign} className="btn-danger text-xs px-3 py-1.5">
                    {pending ? 'Releasing…' : 'Confirm — Not Re-sign'}
                  </button>
                  <button onClick={() => setConfirmingWalk(false)} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setConfirmingWalk(true)} className="text-xs text-bad hover:underline">
                  Not Re-sign — let him walk
                </button>
              )}
              {canTag && (
                <button disabled={tagPending} onClick={tag} className="pill border-gold/40 text-gold text-xs hover:bg-gold/10">
                  {tagPending ? 'Tagging…' : 'Franchise Tag'}
                </button>
              )}
            </div>
          )}
          {tagMessage && <p className={`text-xs ${tagMessage.startsWith('Tagged') ? 'text-accent' : 'text-bad'}`}>{tagMessage}</p>}
        </div>
      )}
    </div>
  );
}
