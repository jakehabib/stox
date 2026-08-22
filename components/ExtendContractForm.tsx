'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { openExtensionNegotiationAction, submitExtensionOfferAction } from '@/app/actions/extension';
import { capHit, formatMoney, type ContractLike } from '@/lib/cap';
import type { DealStructure, NegotiationSession } from '@/lib/negotiation';
import { CapMode } from '@/lib/types';
import { NegotiationPanel } from './NegotiationPanel';
import { DealStructureControls, DEFAULT_ESCALATION } from './DealStructureControls';
import { SuitorRumour } from './ds/SuitorRumour';
import { ContractLedger } from './ds/ContractLedger';

/** Where a fresh deal opens. Reset terms returns the shape here. */
const OPENING_STRUCTURE: DealStructure = { escalation: DEFAULT_ESCALATION, voidYears: 0 };

/**
 * Extending a player who is still under contract — the third contract screen,
 * and the last one to get the negotiation.
 *
 * It used to be a form of its own: a salary box, four percent-of-market
 * presets, a length slider, and a Sign Extension button that the server
 * honoured. No meter, no patience, no refusal worth the name — the "they
 * accept everything" behaviour the minigame was written to remove, still
 * alive on the screen a GM spends most of his time on. The app owner found it
 * from the outside: *"Also the player interest slider is missing for the
 * player profile negotiate extension"*.
 *
 * So this is `NegotiationPanel` now, like the other two, and the decision is
 * `decideOffer`, like the other two. Everything that makes an extension
 * different is resolved server-side in the session (see
 * app/actions/extension.ts): nobody may bid on a man under contract, and the
 * years you still control are the leverage that replaces the rival.
 *
 * IT ADDS YEARS ON TOP. The owner's ruling — *"it should add a year on top, as
 * it does it real life"* — so the years he is already owed survive at the
 * salaries he was already promised and the new years go on the end. Which
 * makes "new money" the number he negotiates and the full contract a longer,
 * cheaper-per-year thing: both are on screen, under their own names, because
 * quoting either as the other is the lying metric this flow invites.
 */
export function ExtendContractForm({ leagueId, playerId, capMode, contract, onDone }: {
  leagueId: string; playerId: string; capMode: CapMode;
  /**
   * The deal this extension would REPLACE. Display only — the session resolves
   * its own cap room and its own leverage server-side. It is here so the
   * screen can show what is being torn up, in full, before anything is signed.
   */
  contract: ContractLike & { guaranteed: number; voidYears?: number };
  onDone?: () => void;
  /** Accepted from the old call site; the live figures all come from the session now. */
  ovr?: number; position?: string; age?: number; availableSpace?: number;
}) {
  const [session, setSession] = useState<NegotiationSession | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [structure, setStructure] = useState<DealStructure>(OPENING_STRUCTURE);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    openExtensionNegotiationAction(leagueId, playerId)
      .then((s) => { if (!cancelled) setSession(s); })
      .catch((e) => { if (!cancelled) { setSession(null); setError(e instanceof Error ? e.message : 'Could not open talks.'); } });
    return () => { cancelled = true; };
  }, [leagueId, playerId]);

  if (session === undefined) {
    return <div className="panel p-4 text-sm text-muted">Getting his agent on the phone…</div>;
  }
  if (!session) {
    return <div className="panel p-4 text-sm text-bad">{error ?? 'Could not open extension talks with this player.'}</div>;
  }

  return (
    <NegotiationPanel
      title="Extension Talks"
      initialSession={session}
      structure={structure}
      onSigned={() => { router.refresh(); onDone?.(); }}
      onReset={() => setStructure(OPENING_STRUCTURE)}
      onCancel={onDone}
      onOffer={(offer, str, fingerprint) =>
        submitExtensionOfferAction(leagueId, playerId, offer, str, fingerprint)}
      banner={
        <>
          {/* The sentence the old form never said. An extension is a
              replacement, and the years already on the books go away with it. */}
          <div className="text-sm px-3 py-2.5 rounded-lg border border-accent2/30 bg-accent2/10 text-accent2">
            This <span className="font-semibold">adds years on top</span> of his current deal. The{' '}
            {contract.yearsRemaining} year{contract.yearsRemaining === 1 ? '' : 's'} he is already owed keep
            their salaries — {formatMoney(capHit(contract, capMode))} against this year&apos;s cap right now —
            and the new money goes on the end. Whatever bonus he has left carries into the extended deal,
            so the dead money if you ever cut him is both put together.
          </div>

          {/* And here is exactly what is being torn up, year by year, with the
              dead money each of those years would have cost. "It replaces his
              deal" is a sentence; this is the sentence with the figures
              attached, on screen before anything is agreed rather than
              discoverable afterwards. */}
          <details className="rounded-lg border border-line bg-raised/40 px-3 py-2">
            <summary className="text-sm cursor-pointer select-none">
              The deal he is on now, before anything is added
            </summary>
            <ContractLedger contract={contract} capMode={capMode} seasonYear={session.ctx.seasonYear} className="pt-3" />
          </details>

          {/* He cannot be bid on — but the club that would want him if he ever
              got out is a real one, and it hardens what he asks for. Same
              evidence the re-sign window shows, for the same reason. */}
          {session.suitor && <SuitorRumour session={session} />}
        </>
      }
      structureSlot={
        (years) => <DealStructureControls capMode={capMode} contractYears={years} structure={structure} onChange={setStructure} />
      }
    />
  );
}
