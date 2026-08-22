import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { TradeBuilder } from '@/components/TradeBuilder';
import { PendingTradeOffers } from '@/components/PendingTradeOffers';
import { parseGmProfile, philosophySummary } from '@/lib/ai/gm';
import { capHit, capSavingsOnCut, proration, formatMoney } from '@/lib/cap';
import { teamCapSummary } from '@/lib/cap-summary';
import { readJson } from '@/lib/json';
import { isTradeDeadlinePassed } from '@/lib/trade';
import { projectedDraftOrder, imminentDraftYear } from '@/lib/draft';
import type { TradeAsset } from '@/lib/trade';
import { buildTradeRetrospectives } from '@/lib/tradeRetro';
import { TradeRetrospectives } from '@/components/TradeRetrospectives';
import { PageMasthead } from '@/components/ds/PageMasthead';

export default async function TradePage({ params, searchParams }: { params: { id: string }; searchParams: { with?: string; reviewOffer?: string; pos?: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

  const otherTeams = await prisma.team.findMany({ where: { leagueId: league.id, isUser: false }, orderBy: { city: 'asc' } });

  // Reviewing a specific incoming offer pre-selects exactly what was
  // proposed — "you send" = what the offer asks of the user (request),
  // "you receive" = what the AI is putting up (give) — so it lands in the
  // trade meter as the AI's own offer, not backwards.
  let initialGive: string[] = [];
  let initialGet: string[] = [];
  let reviewPartnerId: string | undefined;
  if (searchParams.reviewOffer) {
    const offer = await prisma.tradeOffer.findUnique({ where: { id: searchParams.reviewOffer } });
    if (offer && offer.toTeamId === team.id && offer.status === 'PENDING') {
      initialGive = readJson<TradeAsset[]>(offer.request, []).map((a) => a.id);
      initialGet = readJson<TradeAsset[]>(offer.give, []).map((a) => a.id);
      reviewPartnerId = offer.fromTeamId;
    }
  }

  const partnerId = searchParams.with || reviewPartnerId || otherTeams[0]?.id;

  const deadlinePassed = settings.tradeDeadlineEnabled && isTradeDeadlinePassed(league.phase, league.week, settings.tradeDeadlineWeek);
  const [projectedOrder, imminentYear] = await Promise.all([projectedDraftOrder(league.id), imminentDraftYear(league.id)]);

  const [myRoster, myPicks, partnerRoster, partnerPicks, pendingOffers, capSummary, retrospectives] = await Promise.all([
    prisma.player.findMany({ where: { teamId: team.id }, include: { contract: true }, orderBy: { trueOvr: 'desc' } }),
    prisma.draftPick.findMany({ where: { ownerTeamId: team.id, used: false }, orderBy: [{ year: 'asc' }, { round: 'asc' }] }),
    partnerId ? prisma.player.findMany({ where: { teamId: partnerId }, include: { contract: true }, orderBy: { trueOvr: 'desc' } }) : Promise.resolve([]),
    partnerId ? prisma.draftPick.findMany({ where: { ownerTeamId: partnerId, used: false }, orderBy: [{ year: 'asc' }, { round: 'asc' }] }) : Promise.resolve([]),
    prisma.tradeOffer.findMany({ where: { leagueId: league.id, toTeamId: team.id, status: 'PENDING' }, include: { fromTeam: true }, orderBy: { createdAt: 'desc' } }),
    settings.capMode === 'OFF' ? Promise.resolve(null) : teamCapSummary(team.id, league.seasonYear, settings.capMode),
    buildTradeRetrospectives(league.id, team.id, settings.capMode, league.seasonYear),
  ]);

  // Trading a player accelerates his remaining bonus onto the team giving him
  // up (see executeTrade), so the two sides of a swap are NOT symmetric:
  // sending him away frees his hit minus the dead money you keep, while
  // receiving him only adds his base salary. Both figures are computed here
  // so the builder's live cap readout matches what actually happens.
  const toRosterP = (p: (typeof myRoster)[number]) => {
    const off = settings.capMode === 'OFF';
    return {
      id: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position, ovr: p.trueOvr, age: p.age,
      weightLb: p.weightLb, heightIn: p.heightIn,
      capHit: off ? 0 : capHit(p.contract, settings.capMode),
      freedIfSent: off ? 0 : capSavingsOnCut(p.contract, settings.capMode),
      addedIfAcquired: off ? 0 : capHit(p.contract, settings.capMode) - (settings.capMode === 'REALISTIC' && p.contract ? proration(p.contract) : 0),
      yearsRemaining: p.contract?.yearsRemaining ?? 0,
      // Regular season only, like every other production line in the app.
      seasonStats: readJson<Record<string, number>>(p.seasonStats, {}),
    };
  };

  // Only the next draft that hasn't happened yet gets a live projection — a
  // further-future year has no standings to project from at all. This is
  // deliberately keyed off imminentDraftYear rather than league.seasonYear;
  // see lib/draft.ts for why the two aren't always the same thing.
  const toPickP = (p: (typeof myPicks)[number]) => ({
    id: p.id, year: p.year, round: p.round, slot: p.slot,
    projectedSlot: p.year === imminentYear ? projectedOrder.get(p.originalTeamId) : undefined,
  });

  return (
    <div className="space-y-5">
      <PageMasthead
        teamId={team.id}
        teamAbbr={team.abbr}
        eyebrow={deadlinePassed ? `${league.seasonYear} · Deadline Passed` : `${league.seasonYear} Trade Market`}
        title="Trade Center"
        subtitle="Build an offer. The AI values players and picks the same way it does everywhere else — no free lunches."
        facts={[
          {
            label: 'Pending Offers',
            value: String(pendingOffers.length),
            detail: pendingOffers.length > 0 ? 'waiting on you' : 'nothing incoming',
            color: pendingOffers.length > 0 ? 'text-accent2' : undefined,
          },
          { label: 'Tradeable Picks', value: String(myPicks.length), detail: 'across all future years' },
          ...(capSummary ? [{
            label: 'Cap Space',
            value: formatMoney(capSummary.capSpace),
            detail: 'before any deal',
            color: capSummary.capSpace >= 0 ? 'text-accent' : 'text-bad',
          }] : []),
          {
            label: 'Deadline',
            value: deadlinePassed ? 'Passed' : settings.tradeDeadlineEnabled ? `Week ${settings.tradeDeadlineWeek}` : 'None',
            detail: deadlinePassed ? 'reopens in free agency' : settings.tradeDeadlineEnabled ? 'trades close after this' : 'trade year-round',
            color: deadlinePassed ? 'text-bad' : undefined,
          },
          { label: 'Trades Made', value: String(retrospectives.length), detail: 'graded below' },
        ]}
      />

      <PendingTradeOffers
        leagueId={league.id}
        offers={pendingOffers.map((o) => ({ id: o.id, fromTeamId: o.fromTeamId, fromTeamAbbr: o.fromTeam.abbr, fromTeamName: `${o.fromTeam.city} ${o.fromTeam.nickname}`, blurb: o.blurb, week: o.week }))}
      />

      <TradeBuilder
        leagueId={league.id}
        myTeam={{ id: team.id, name: `${team.city} ${team.nickname}`, abbr: team.abbr }}
        partners={otherTeams.map((t) => ({ id: t.id, name: `${t.city} ${t.nickname}`, abbr: t.abbr, philosophy: philosophySummary(parseGmProfile(t.gmProfile)) }))}
        partnerId={partnerId ?? ''}
        initialPartnerPos={searchParams.pos}
        myRoster={myRoster.map(toRosterP)}
        myPicks={myPicks.map(toPickP)}
        partnerRoster={partnerRoster.map(toRosterP)}
        partnerPicks={partnerPicks.map(toPickP)}
        initialGive={initialGive}
        initialGet={initialGet}
        capSpace={capSummary?.capSpace ?? Number.MAX_SAFE_INTEGER}
        capMode={settings.capMode}
        deadlinePassed={deadlinePassed}
        tradeDeadlineWeek={settings.tradeDeadlineWeek}
      />

      <TradeRetrospectives myAbbr={team.abbr} retrospectives={retrospectives} />
    </div>
  );
}
