'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { openNegotiationAction, submitOfferAction } from '@/app/actions/roster';
import { contractEstimateAction, type ContractEstimate } from '@/app/actions/dynasty';
import { formatMoney } from '@/lib/cap';
import type { DealStructure, NegotiationSession } from '@/lib/negotiation';
import { CapMode } from '@/lib/types';
import { NegotiationPanel } from './NegotiationPanel';
import { DealStructureControls, DEFAULT_ESCALATION } from './DealStructureControls';
import { SuitorRumour } from './ds/SuitorRumour';

/** Where a fresh deal opens: cap-friendly year 1, no void years. Reset returns here. */
const OPENING_STRUCTURE: DealStructure = { escalation: DEFAULT_ESCALATION, voidYears: 0 };

/**
 * Free agency, the user's side of the table.
 *
 * This used to be a form: type a salary, pick a term, press Offer Contract,
 * and the server said yes to anything at or above 90% of market. The app
 * owner's note on it was blunt — *"the contract negotiations for re-sign and
 * free agency need to be more of a minigame instead of them accepting
 * everything"* — so the salary field is a slider now and the decision belongs
 * to `lib/negotiation.ts`, which is also what draws the meter.
 *
 * What this component still owns is everything AROUND the negotiation, all of
 * which is unchanged: the live read on who else is bidding (the one thing
 * unique to the open market), the Dynasty Market Knowledge band, and the real
 * cap structuring — front/back-loading and void years — that signing an
 * outside free agent shares with extending your own player. Those are cap
 * decisions on your side of the table; he does not judge them, so they move
 * the ledger and never the meter.
 *
 * Those structure controls are no longer written out here. They lived in this
 * file and only in this file, which is exactly why the re-sign window did not
 * have them; they are `DealStructureControls` now and all three contract
 * screens render the same component.
 */
export function SignOfferForm({ leagueId, teamId, playerId, capMode }: {
  leagueId: string; teamId: string; playerId: string;
  /** Kept for call-site compatibility — the live figures come from the session. */
  ovr?: number; position?: string; age?: number; capSpace?: number; capMode: CapMode;
}) {
  // undefined = still opening talks. The session carries the hidden half of
  // the negotiation and every resolved random draw; see openNegotiationAction.
  const [session, setSession] = useState<NegotiationSession | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [structure, setStructure] = useState<DealStructure>(OPENING_STRUCTURE);
  const [estimate, setEstimate] = useState<ContractEstimate | null>(null);
  // LEFT THE TABLE. Talks were a one-way door — once the panel was open the
  // only ways out were signing or navigating away, which is what made it feel
  // like a trap. Walking out closes the panel and NOTHING else: no server
  // call, no NegotiationTalks write, no pips handed back. Coming back re-opens
  // talks from the database, which is precisely why the pips are still gone.
  const [away, setAway] = useState(false);
  const [visit, setVisit] = useState(0);
  const router = useRouter();

  useEffect(() => {
    if (away) return;
    let cancelled = false;
    openNegotiationAction(leagueId, playerId, teamId)
      .then((s) => { if (!cancelled) setSession(s); })
      .catch((e) => { if (!cancelled) { setSession(null); setError(e instanceof Error ? e.message : 'Could not open talks.'); } });
    return () => { cancelled = true; };
  }, [leagueId, playerId, teamId, away, visit]);

  // Dynasty NEGOTIATION -> Market Knowledge. null means the GM has not bought
  // the skill, in which case nothing renders and this behaves as before.
  const years = session?.ctx.desiredYears ?? 0;
  useEffect(() => {
    if (!years) return;
    let cancelled = false;
    contractEstimateAction(leagueId, playerId, years).then((e) => { if (!cancelled) setEstimate(e); }).catch(() => {});
    return () => { cancelled = true; };
  }, [leagueId, playerId, years]);

  if (away) {
    return (
      <div className="panel p-4 space-y-3">
        <p className="text-sm text-muted">
          You walked away from the table. Nothing was undone by it — any patience you spent is still
          spent and he remembers every offer he has already turned down.
        </p>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => { setSession(undefined); setVisit((v) => v + 1); setAway(false); }}
        >
          Re-open talks
        </button>
      </div>
    );
  }

  if (session === undefined) {
    return <div className="panel p-4 text-sm text-muted">Getting his agent on the phone…</div>;
  }
  if (!session) {
    return <div className="panel p-4 text-sm text-bad">{error ?? 'Could not open talks with this player.'}</div>;
  }

  const { gate } = session;

  return (
    <NegotiationPanel
      initialSession={session}
      structure={structure}
      onSigned={() => router.refresh()}
      onReset={() => setStructure(OPENING_STRUCTURE)}
      onCancel={() => setAway(true)}
      onOffer={(offer, str, fingerprint) =>
        submitOfferAction(leagueId, playerId, teamId, offer, str, fingerprint)}
      banner={
        <>
          {/* Free agency frenzy — what the leading rival offer actually is,
              before the user commits, the way open bidding works. It is in the
              gate as well as on screen, so the meter refuses to promise a
              signing the auction would lose.

              IT NO LONGER SAYS "YOU HAVE TO BEAT THAT" ABOUT A NUMBER. That
              sentence was the visible half of the bug the app owner reported:
              it sat directly above an interest meter reading 95 · WILL SIGN,
              because the banner was quoting a salary while the meter was
              scoring a package and the two were computed by different code.
              The player scores the rival's whole offer now
              (lib/negotiation.ts, THE CONTEST), so this states the package and
              leaves the verdict to the one thing that decides it — the meter
              two inches below, which draws their score on its own track. */}
          <div className={`text-xs px-3 py-2 rounded-lg border ${gate.rival ? 'border-bad/30 bg-bad/10 text-bad' : 'border-line bg-raised text-muted'}`}>
            {gate.rival
              ? `${gate.rival.teamName} have ${formatMoney(gate.rival.offer.apy)}/yr over ${gate.rival.offer.years} year${gate.rival.offer.years === 1 ? '' : 's'}, ${Math.round(gate.rival.offer.guaranteePct * 100)}% guaranteed, on the table.`
              : 'No other teams appear to be bidding on him right now.'}
          </div>

          {/* The same rival, with the two figures his own GM bid on. It was
              always a real threat; it was just quoted as a name and a number,
              which is indistinguishable from a made-up name and number. The
              re-sign window needed the evidence shown, and there is no reason
              the open market should show less of it. */}
          {session.suitor && <SuitorRumour session={session} />}

          {/* The public market estimate is priced off what you can SEE of him;
              this is your staff's read on what he will actually put his name
              to. It is a band, and it is not centred perfectly — the skill
              informs, it does not solve. */}
          {estimate && (
            <div className="text-xs px-3 py-2 rounded-lg border border-accent2/30 bg-accent2/10 text-accent2">
              <span className="font-semibold">Market Knowledge:</span> our people think he signs somewhere around{' '}
              <span className="font-mono">{formatMoney(estimate.low)}–{formatMoney(estimate.high)}</span>/yr.
              {estimate.rank < 2 && <span className="text-muted"> Rank 2 tightens this.</span>}
            </div>
          )}
        </>
      }
      structureSlot={
        <DealStructureControls capMode={capMode} structure={structure} onChange={setStructure} />
      }
    />
  );
}
