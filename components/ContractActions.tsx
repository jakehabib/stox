'use client';

import { useState } from 'react';
import { ExtendContractForm } from './ExtendContractForm';
import { RestructureForm } from './RestructureForm';
import { CapMode } from '@/lib/types';

interface ContractShape {
  years: number; yearsRemaining: number; signedYear: number;
  baseSalaries: string; signingBonus: number; guaranteed: number; voidYears: number;
}

export function ContractActions({ leagueId, playerId, ovr, position, age, contract, availableSpaceForExtension, capMode }: {
  leagueId: string; playerId: string; ovr: number; position: string; age: number;
  contract: ContractShape; availableSpaceForExtension: number; capMode: CapMode;
}) {
  const [mode, setMode] = useState<'none' | 'extend' | 'restructure'>('none');

  if (mode === 'extend') {
    return (
      <div className="space-y-3">
        <button onClick={() => setMode('none')} className="text-xs text-muted hover:text-chalk">← Back</button>
        <ExtendContractForm
          leagueId={leagueId} playerId={playerId} ovr={ovr} position={position} age={age}
          availableSpace={availableSpaceForExtension} capMode={capMode} onDone={() => setMode('none')}
        />
      </div>
    );
  }

  if (mode === 'restructure') {
    return (
      <div className="space-y-3">
        <button onClick={() => setMode('none')} className="text-xs text-muted hover:text-chalk">← Back</button>
        <RestructureForm leagueId={leagueId} playerId={playerId} contract={contract} onDone={() => setMode('none')} />
      </div>
    );
  }

  return (
    <div className="flex gap-2 pt-1">
      <button onClick={() => setMode('extend')} className="btn-secondary text-xs px-2.5 py-1.5">Negotiate Extension</button>
      {capMode === 'REALISTIC' && (
        <button onClick={() => setMode('restructure')} className="btn-secondary text-xs px-2.5 py-1.5">Restructure</button>
      )}
    </div>
  );
}
