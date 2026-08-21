'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { openNegotiationAction, submitOfferAction } from '@/app/actions/roster';
import { contractEstimateAction, type ContractEstimate } from '@/app/actions/dynasty';
import { formatMoney } from '@/lib/cap';
import type { DealStructure, NegotiationSession } from '@/lib/negotiation';
import { CapMode } from '@/lib/types';
import { NegotiationPanel } from './NegotiationPanel';

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
  const [structure, setStructure] = useState<DealStructure>({ escalation: 1.12, voidYears: 0 });
  const [estimate, setEstimate] = useState<ContractEstimate | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    openNegotiationAction(leagueId, playerId, teamId)
      .then((s) => { if (!cancelled) setSession(s); })
      .catch((e) => { if (!cancelled) { setSession(null); setError(e instanceof Error ? e.message : 'Could not open talks.'); } });
    return () => { cancelled = true; };
  }, [leagueId, playerId, teamId]);

  // Dynasty NEGOTIATION -> Market Knowledge. null means the GM has not bought
  // the skill, in which case nothing renders and this behaves as before.
  const years = session?.ctx.desiredYears ?? 0;
  useEffect(() => {
    if (!years) return;
    let cancelled = false;
    contractEstimateAction(leagueId, playerId, years).then((e) => { if (!cancelled) setEstimate(e); }).catch(() => {});
    return () => { cancelled = true; };
  }, [leagueId, playerId, years]);

  if (session === undefined) {
    return <div className="panel p-4 text-sm text-muted">Getting his agent on the phone…</div>;
  }
  if (!session) {
    return <div className="panel p-4 text-sm text-bad">{error ?? 'Could not open talks with this player.'}</div>;
  }

  const { gate } = session;
  const structureLabel = structure.escalation < 0.95 ? 'Front-loaded' : structure.escalation > 1.05 ? 'Back-loaded' : 'Balanced';

  return (
    <NegotiationPanel
      initialSession={session}
      structure={structure}
      onSigned={() => router.refresh()}
      onOffer={(offer, str, patienceSpent, fingerprint) =>
        submitOfferAction(leagueId, playerId, teamId, offer, str, patienceSpent, fingerprint)}
      banner={
        <>
          {/* Free agency frenzy — what the leading rival offer actually is,
              before the user commits, the way open bidding works. It is in the
              gate as well as on screen, so the meter refuses to promise a
              signing the auction would lose. */}
          <div className={`text-xs px-3 py-2 rounded-lg border ${gate.competingApy > 0 ? 'border-bad/30 bg-bad/10 text-bad' : 'border-line bg-raised text-muted'}`}>
            {gate.competingApy > 0
              ? `${gate.competingTeam} is in the mix at ~${formatMoney(gate.competingApy)}/yr — you have to beat that.`
              : 'No other teams appear to be bidding on him right now.'}
          </div>

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
        capMode === 'OFF' ? null : (
          <div className="space-y-3.5 border-t border-line/50 pt-3.5">
            <div className="label-sm text-[10px]">Deal shape — your books, not his decision</div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="label-sm">Structure</label>
                <span className="text-xs font-mono">{structureLabel}</span>
              </div>
              <input
                type="range" min={0.85} max={1.25} step={0.01} value={structure.escalation}
                onChange={(e) => setStructure((s) => ({ ...s, escalation: Number(e.target.value) }))}
                className="w-full accent-accent2"
              />
              <div className="flex justify-between text-[10px] text-muted mt-0.5"><span>Front-load (pay now)</span><span>Back-load (defer cap)</span></div>
            </div>
            {capMode === 'REALISTIC' && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="label-sm">Void years</label>
                  <span className="text-xs font-mono">{structure.voidYears === 0 ? 'None' : `+${structure.voidYears}`}</span>
                </div>
                <input
                  type="range" min={0} max={3} step={1} value={structure.voidYears}
                  onChange={(e) => setStructure((s) => ({ ...s, voidYears: Number(e.target.value) }))}
                  className="w-full accent-warn"
                />
                <p className="text-[11px] text-muted mt-1">
                  Spreads bonus proration further to lower every real year's cap hit — but the remainder lands as dead money the season this deal ends.
                </p>
              </div>
            )}
          </div>
        )
      }
    />
  );
}
