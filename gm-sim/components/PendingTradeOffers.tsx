'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { respondToTradeOfferAction } from '@/app/actions/trade';
import { TeamLogo } from './TeamLogo';

export interface PendingOffer {
  id: string;
  fromTeamId: string;
  fromTeamAbbr: string;
  fromTeamName: string;
  blurb: string;
  week: number;
}

/**
 * Unsolicited AI trade offers — surfaced here rather than requiring the user
 * to initiate every transaction, per the brief's explicit ask for CPU teams
 * to approach the player instead of the other way around.
 */
export function PendingTradeOffers({ leagueId, offers }: { leagueId: string; offers: PendingOffer[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (offers.length === 0) return null;

  const respond = (offerId: string, accept: boolean) => {
    startTransition(async () => {
      await respondToTradeOfferAction(leagueId, offerId, accept);
      router.refresh();
    });
  };

  return (
    <div className="card card-pad space-y-3 border-accent2/30">
      <h3 className="font-semibold text-sm flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-accent2 animate-pulse" />
        Trade Offers ({offers.length})
      </h3>
      <div className="space-y-2">
        {offers.map((o) => (
          <div key={o.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-raised">
            <TeamLogo seed={o.fromTeamId} abbr={o.fromTeamAbbr} size={30} />
            <p className="text-sm flex-1">{o.blurb}</p>
            <button disabled={pending} onClick={() => respond(o.id, false)} className="btn-secondary text-xs px-2.5 py-1">Decline</button>
            <button disabled={pending} onClick={() => respond(o.id, true)} className="btn-primary text-xs px-2.5 py-1">Accept</button>
          </div>
        ))}
      </div>
    </div>
  );
}
