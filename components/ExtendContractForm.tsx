'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { openExtensionNegotiationAction, submitExtensionOfferAction } from '@/app/actions/extension';
import { type ContractLike } from '@/lib/cap';
import { DEFAULT_CONVERT_PCT, type DealStructure, type NegotiationSession } from '@/lib/negotiation';
import { CapMode } from '@/lib/types';
import { NegotiationPanel } from './NegotiationPanel';
import { DealStructureControls, DEFAULT_ESCALATION } from './DealStructureControls';
import { ContractLedger } from './ds/ContractLedger';

/**
 * Where a fresh deal opens. Reset terms returns the shape here.
 *
 * IT OPENS ON THE FULL CONVERSION of this season's owed salary into the new
 * signing bonus, which is what an extension IS in real football. Opening at 0
 * was the alternative and it is the shipped bug: the tester extended a man and
 * watched his cap hit go UP, measured at +$1.58M in the median case across 400
 * real contracts. The GM drags it down when he would rather keep the later
 * years clean — the control is inside the panel, beside the cap figures it
 * moves.
 *
 * `DEFAULT_CONVERT_PCT`, not a literal 1: the meter and the Server Action
 * resolve an unset `convertPct` through that same constant, and a screen
 * opening on a different figure from the one the write would apply is the
 * whole class of bug this panel keeps closing.
 */
const OPENING_STRUCTURE: DealStructure = { escalation: DEFAULT_ESCALATION, voidYears: 0, convertPct: DEFAULT_CONVERT_PCT };

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
 *
 * WHICH IS WHY THE PARAGRAPH THAT SAID SO IS GONE. This form opened with four
 * lines explaining that the extension adds years on top, that the years he is
 * already owed keep their salaries, what his current deal charges the cap this
 * season, and that the two lots of dead money combine. Counted against the
 * panel underneath it, on the same screen at the same moment: the term control
 * reads "+4 → 7 yrs", the cap-hit row is captioned "the whole contract, old
 * years and new" and followed by a sentence naming exactly which years he was
 * already owed, the guarantee control prints the combined dead money live, and
 * the season's current charge is on the player card's own hero above. Four
 * claims, every one of them made again in a place where it moves as you drag.
 *
 * The one thing the paragraph had that nothing else did is what is being torn
 * up, year by year — and that was always the `details` below it, which is the
 * sentence with the figures attached rather than the sentence.
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
      /* The conversion control lives inside the panel, beside the cap figures
         it moves, but the structure is this screen's state — same arrangement
         `structureSlot` already uses for the deal-shape controls. */
      onStructure={setStructure}
      onOffer={(offer, str, fingerprint) =>
        submitExtensionOfferAction(leagueId, playerId, offer, str, fingerprint)}
      banner={
        /* Exactly what he is on now, year by year, with the dead money each of
           those years would cost. On screen before anything is agreed rather
           than discoverable afterwards — and closed by default, because it is
           the answer to a question you ask once, not a fact you need beside
           every drag of the salary slider.

           The suitor is NOT passed any more: a club that would come for him if
           he ever got out is a fact about the negotiation, not about this
           screen, and the panel draws it on all three tables now. */
        <details className="rounded-lg border border-line bg-raised/40 px-3 py-2">
          <summary className="text-sm cursor-pointer select-none">
            The deal he is on now, before anything is added
          </summary>
          <ContractLedger contract={contract} capMode={capMode} seasonYear={session.ctx.seasonYear} className="pt-3" />
        </details>
      }
      structureSlot={
        (years) => <DealStructureControls capMode={capMode} contractYears={years} structure={structure} onChange={setStructure} />
      }
    />
  );
}
