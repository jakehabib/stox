'use client';

import { useState } from 'react';
import { ExtendContractForm } from './ExtendContractForm';
import { RestructureForm } from './RestructureForm';
import { CapMode } from '@/lib/types';
import { DeltaChip, deltaTint, useDeltaWatch } from './ds/DeltaChip';
import { formatMoney } from '@/lib/cap';

interface ContractShape {
  years: number; yearsRemaining: number; signedYear: number;
  baseSalaries: string; signingBonus: number; guaranteed: number; voidYears: number;
}

/**
 * Extend or restructure, and — new — say what it did to the cap.
 *
 * A restructure moves several million dollars of cap space and the only
 * acknowledgement was the form closing. The masthead figure updated silently
 * and the user was left to remember what it used to say. This watches the
 * capSpace prop the page already hands down (revalidatePath delivers the new
 * one; this component is not remounted by router.refresh(), so the previous
 * value survives in a ref) and states the difference beside the new number.
 *
 * It is armed at the moment a form reports success, so it can only ever fire
 * as the consequence of something the user just did — never on a navigation
 * or an unrelated re-render. Nothing optimistic: React is 18.3 here, and a cap
 * figure guessed on the client and then corrected by the server would be a
 * lying metric, which this codebase treats as a bug class rather than a
 * trade-off.
 */
export function ContractActions({ leagueId, playerId, ovr, position, age, contract, availableSpaceForExtension, capSpace, capMode }: {
  leagueId: string; playerId: string; ovr: number; position: string; age: number;
  contract: ContractShape; availableSpaceForExtension: number; capSpace: number; capMode: CapMode;
}) {
  const [mode, setMode] = useState<'none' | 'extend' | 'restructure'>('none');
  const cap = useDeltaWatch(capSpace);
  const done = () => { cap.arm(); setMode('none'); };

  if (mode === 'extend') {
    return (
      <div className="space-y-3">
        <button onClick={() => setMode('none')} className="text-xs text-muted hover:text-chalk">← Back</button>
        <ExtendContractForm
          leagueId={leagueId} playerId={playerId} ovr={ovr} position={position} age={age}
          availableSpace={availableSpaceForExtension} capMode={capMode} onDone={done}
        />
      </div>
    );
  }

  if (mode === 'restructure') {
    return (
      <div className="space-y-3">
        <button onClick={() => setMode('none')} className="text-xs text-muted hover:text-chalk">← Back</button>
        <RestructureForm leagueId={leagueId} playerId={playerId} contract={contract} capSpace={capSpace} onDone={done} />
      </div>
    );
  }

  return (
    <div className="space-y-2 pt-1">
      <div className="flex gap-2">
        <button onClick={() => setMode('extend')} className="btn-secondary text-xs px-2.5 py-1.5">Negotiate Extension</button>
        {capMode === 'REALISTIC' && (
          <button onClick={() => setMode('restructure')} className="btn-secondary text-xs px-2.5 py-1.5">Restructure</button>
        )}
      </div>
      {/* Present only in the couple of seconds after a move actually changed
          the number. It states the change; the cap page still states the
          state. Renders nothing at all otherwise, so the resting layout of
          this section is exactly what it was. */}
      {cap.delta !== null && (
        <div className="flex items-center gap-2 text-xs">
          <span className="label-sm">Cap space</span>
          <span className={`stat-value text-stat-sm ${deltaTint(cap.delta)}`}>{formatMoney(capSpace)}</span>
          <DeltaChip delta={cap.delta} format={formatMoney} />
        </div>
      )}
    </div>
  );
}
