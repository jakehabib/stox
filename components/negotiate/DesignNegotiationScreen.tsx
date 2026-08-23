'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_ESCALATION } from '../DealStructureControls';
import { submitOfferAction } from '@/app/actions/roster';
import { submitResignOfferAction } from '@/app/actions/resign';
import { submitExtensionOfferAction } from '@/app/actions/extension';
import type { DealStructure, NegotiationSession, Offer } from '@/lib/negotiation';
import { CapMode } from '@/lib/types';
import { negotiationFrame, type NegotiationSubject } from './frame';
import { useNegotiation } from './useNegotiation';
import { DirectionTable } from './DirectionTable';
import { DirectionTermSheet } from './DirectionTermSheet';
import { DirectionRoom } from './DirectionRoom';

/** Where a fresh deal opens: cap-friendly year 1, no void years. Reset returns here. */
const OPENING_STRUCTURE: DealStructure = { escalation: DEFAULT_ESCALATION, voidYears: 0 };

export type DirectionKey = 'table' | 'sheet' | 'room';

/**
 * The wiring the three mockup directions share.
 *
 * THE OFFERS ARE REAL. This route is a design mockup and the negotiation
 * inside it is not: the session was resolved by the same
 * `resolveNegotiationSession` the live screens use, and the submit goes to the
 * same Server Action, against the same database, charging the same patience.
 * A mockup that faked the submit would be judged on numbers nothing enforces,
 * which is the one thing that would make it worthless — the whole question
 * here is whether the real figures read well.
 *
 * Which action depends only on where the man is, and that is the same three-way
 * split the live app makes: an outside free agent goes through free agency's
 * action, your own expiring man through the re-sign window's, and a man with
 * years left through the extension's. Each of them re-checks eligibility
 * server-side, so nothing here can route a negotiation somewhere it does not
 * belong.
 */
export function DesignNegotiationScreen({ leagueId, direction, session, subject, capMode, returnTo }: {
  leagueId: string;
  direction: DirectionKey;
  session: NegotiationSession;
  subject: NegotiationSubject;
  capMode: CapMode;
  returnTo?: { href: string; label: string };
}) {
  const router = useRouter();
  const [structure, setStructure] = useState<DealStructure>(OPENING_STRUCTURE);
  const mode = session.ctx.mode;

  const onOffer = (offer: Offer, str: DealStructure, fingerprint: string) => {
    if (mode === 'FREE_AGENT') {
      return submitOfferAction(leagueId, subject.playerId, subject.team.id, offer, str, fingerprint);
    }
    if (mode === 'RESIGN') {
      return submitResignOfferAction(leagueId, subject.playerId, offer, str, fingerprint);
    }
    return submitExtensionOfferAction(leagueId, subject.playerId, offer, str, fingerprint);
  };

  const view = useNegotiation({
    initialSession: session,
    structure,
    onOffer,
    onSigned: () => router.refresh(),
    onReset: () => setStructure(OPENING_STRUCTURE),
    returnTo,
  });
  const frame = negotiationFrame(view.session);

  const shared = {
    view, frame, subject, session: view.session, capMode, structure,
    onStructure: setStructure,
  };

  if (direction === 'sheet') return <DirectionTermSheet {...shared} />;
  if (direction === 'room') return <DirectionRoom {...shared} />;
  return <DirectionTable {...shared} />;
}
