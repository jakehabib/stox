'use client';

import { useState } from 'react';
import { ExtendContractForm } from './ExtendContractForm';
import { PlayerAvatar } from './PlayerAvatar';
import { ratingColor } from '@/lib/ratings';
import { formatMoney } from '@/lib/cap';
import { CapMode } from '@/lib/types';

export function ResignRow({ leagueId, playerId, name, position, age, ovr, currentApy, availableSpace, capMode }: {
  leagueId: string; playerId: string; name: string; position: string; age: number; ovr: number;
  currentApy: number; availableSpace: number; capMode: CapMode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-raised transition-colors">
        <PlayerAvatar seed={playerId} age={age} size={30} />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{name}</div>
          <div className="text-xs text-muted">{position} · Age {age} · Current ~{formatMoney(currentApy)}/yr</div>
        </div>
        <span className={`font-mono font-semibold ${ratingColor(ovr)}`}>{ovr}</span>
        <span className="pill border-line text-muted">{open ? 'Close' : 'Negotiate'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-line/60">
          <ExtendContractForm
            leagueId={leagueId} playerId={playerId} ovr={ovr} position={position} age={age}
            availableSpace={availableSpace} capMode={capMode} onDone={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
