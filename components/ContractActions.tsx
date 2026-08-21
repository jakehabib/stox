'use client';

import { useState } from 'react';
import Link from 'next/link';
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
 *
 * TWO THINGS CHANGED HERE, BOTH FROM THE OWNER USING IT.
 *
 * 1. REFUSE AT THE ENTRANCE. Extending a man whose deal is expiring is a
 *    re-sign, and the server has always said so — but it said so on SUBMIT.
 *    He dragged four sliders, watched a ledger compute a four-year $92.4M
 *    deal, pressed the button and only then got "his deal is up — that's a
 *    re-sign". A whole negotiation's work refused by a screen that was never
 *    going to accept it, in wording that reads as a rejection of the offer
 *    rather than of the screen. So the button is not offered for him at all
 *    now: the card explains why and points at the window that does negotiate
 *    him. The server guard stays exactly where it is — a Server Action is a
 *    POST and a hidden button protects nothing.
 *
 * 2. LEGIBILITY. *"Everything in that box should be more visible 'negotiate
 *    extension' for example is so small"*. These were `text-xs px-2.5 py-1.5`
 *    — a button rendered at footnote size on the screen where you commit tens
 *    of millions of dollars. They are ordinary buttons at ordinary button
 *    size now, with the extension as the primary action, which is all that
 *    was ever wrong with them.
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
        <button onClick={() => setMode('none')} className="btn-ghost text-sm px-0">← Back</button>
        <ExtendContractForm
          leagueId={leagueId} playerId={playerId} ovr={ovr} position={position} age={age}
          availableSpace={availableSpaceForExtension} capMode={capMode}
          contract={contract} onDone={done}
        />
      </div>
    );
  }

  if (mode === 'restructure') {
    return (
      <div className="space-y-3">
        <button onClick={() => setMode('none')} className="btn-ghost text-sm px-0">← Back</button>
        <RestructureForm leagueId={leagueId} playerId={playerId} contract={contract} capSpace={capSpace} onDone={done} />
      </div>
    );
  }

  // His deal is up. That is the Re-sign window's negotiation, not this
  // screen's — signposted, not errored, and explained so the missing button
  // does not read as something broken.
  const expiring = contract.yearsRemaining <= 1;

  return (
    <div className="space-y-3 pt-1">
      {expiring ? (
        <div className="space-y-2">
          <Link href={`/league/${leagueId}/resign`} className="btn-primary w-full sm:w-auto">
            Re-sign him in the Re-sign Window
          </Link>
          <p className="text-sm text-muted">
            {contract.yearsRemaining === 0
              ? 'His contract has expired, so this is a re-sign rather than an extension'
              : 'This is his final contract year, so keeping him is a re-sign rather than an extension'}
            {' '}— he negotiates it, with a hometown discount that shrinks as the window closes, in the Re-sign Window.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setMode('extend')} className="btn-primary">Negotiate Extension</button>
          {capMode === 'REALISTIC' && (
            <button onClick={() => setMode('restructure')} className="btn-secondary">Restructure</button>
          )}
        </div>
      )}
      {/* Present only in the couple of seconds after a move actually changed
          the number. It states the change; the cap page still states the
          state. Renders nothing at all otherwise, so the resting layout of
          this section is exactly what it was. */}
      {cap.delta !== null && (
        <div className="flex items-center gap-2">
          <span className="label-sm">Cap space</span>
          <span className={`stat-value text-stat-md ${deltaTint(cap.delta)}`}>{formatMoney(capSpace)}</span>
          <DeltaChip delta={cap.delta} format={formatMoney} />
        </div>
      )}
    </div>
  );
}
