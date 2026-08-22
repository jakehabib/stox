import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { TradeBuilder } from '@/components/TradeBuilder';
import { PendingTradeOffers } from '@/components/PendingTradeOffers';
import { parseGmProfile, philosophySummary, rosterFit, type RosterPlayer } from '@/lib/ai/gm';
import { capHit, capSavingsOnCut, proration, formatMoney } from '@/lib/cap';
import { teamCapSummary } from '@/lib/cap-summary';
import { readJson } from '@/lib/json';
import { isTradeDeadlinePassed } from '@/lib/trade';
import { projectedDraftOrder, imminentDraftYear } from '@/lib/draft';
import { REPLACEMENT_LEVEL } from '@/lib/sim/units';
import type { TradeAsset } from '@/lib/trade';
import { buildTradeRetrospectives, type TradeAssetSnapshot } from '@/lib/tradeRetro';
import { TradeRetrospectives } from '@/components/TradeRetrospectives';
import { PageMasthead } from '@/components/ds/PageMasthead';
import type { TradeRecapAsset, TradeRecapData } from '@/components/ds/TradeRecapCard';

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

  // A pick that changed hands is a different object to one a club has always
  // held — which club it came from is half of what makes a stack of draft
  // capital interesting to read. Every club in the league is in the map,
  // including the user's own, since the partner may be holding YOUR pick.
  const clubById = new Map([team, ...otherTeams].map((t) => [t.id, { abbr: t.abbr, name: `${t.city} ${t.nickname}` }]));

  // Only the next draft that hasn't happened yet gets a live projection — a
  // further-future year has no standings to project from at all. This is
  // deliberately keyed off imminentDraftYear rather than league.seasonYear;
  // see lib/draft.ts for why the two aren't always the same thing.
  const toPickP = (p: (typeof myPicks)[number]) => ({
    id: p.id, year: p.year, round: p.round, slot: p.slot,
    projectedSlot: p.year === imminentYear ? projectedOrder.get(p.originalTeamId) : undefined,
    via: p.originalTeamId === p.ownerTeamId ? undefined : clubById.get(p.originalTeamId)?.abbr,
  });

  const lastTrade = await buildTradeRecap({
    leagueId: league.id, myTeamId: team.id, myRoster, seasonYear: league.seasonYear, clubById,
  });

  return (
    <div className="space-y-5">
      <PageMasthead
        teamId={team.id}
        teamAbbr={team.abbr}
        eyebrow={deadlinePassed ? `${league.seasonYear} · Deadline Passed` : `${league.seasonYear} Trade Market`}
        title="Trade Center"
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
        draftRounds={settings.draftRounds}
        imminentYear={imminentYear}
        lastTrade={lastTrade}
      />

      <TradeRetrospectives myAbbr={team.abbr} retrospectives={retrospectives} />
    </div>
  );
}

/**
 * THE TRADE THAT JUST HAPPENED, assembled where the numbers live.
 *
 * Every figure on the recap card has to be the one the system used, so none of
 * it is worked out in the component: the depth-chart consequence is
 * `rosterFit` — the same function that prices a trade for the AI — read
 * against the roster as it now stands, and the dead money is the CapCharge row
 * the executor actually wrote rather than a second calculation of what
 * accelerates. The two cap-space figures the card shows come from
 * `teamCapSummary` on either side of the deal (see TradeBuilder's capBefore).
 *
 * Read on every render, not only after a trade: the page has no idea one just
 * happened. The builder holds that fact — it compares this record's id with
 * the one that was on screen when it mounted — so an old deal can never
 * announce itself on a plain page load.
 */
async function buildTradeRecap(opts: {
  leagueId: string;
  myTeamId: string;
  myRoster: RosterPlayer[];
  seasonYear: number;
  clubById: Map<string, { abbr: string; name: string }>;
}): Promise<TradeRecapData | null> {
  const record = await prisma.tradeRecord.findFirst({
    where: { leagueId: opts.leagueId, OR: [{ teamAId: opts.myTeamId }, { teamBId: opts.myTeamId }] },
    orderBy: { createdAt: 'desc' },
  });
  if (!record) return null;

  const iAmA = record.teamAId === opts.myTeamId;
  const partnerId = iAmA ? record.teamBId : record.teamAId;
  const partner = opts.clubById.get(partnerId);

  const resolve = async (snapshots: TradeAssetSnapshot[]): Promise<TradeRecapAsset[]> => {
    const out: TradeRecapAsset[] = [];
    for (const s of snapshots) {
      if (s.type === 'PICK') {
        // Re-read rather than parsing the snapshot's label, so the recap says
        // "2028 R3" in exactly the pick board's terms.
        const pick = await prisma.draftPick.findUnique({ where: { id: s.id } });
        out.push({ kind: 'PICK', label: pick ? `${pick.year} R${pick.round}` : s.label, round: pick?.round });
        continue;
      }
      const p = await prisma.player.findUnique({ where: { id: s.id } });
      if (!p) {
        // He has left the league since (released, retired). The snapshot is
        // still the truth about what was traded.
        out.push({ kind: 'PLAYER', label: s.label, position: s.position });
        continue;
      }
      const fit = rosterFit(p as unknown as RosterPlayer, opts.myRoster);
      out.push({
        kind: 'PLAYER', label: `${p.firstName} ${p.lastName}`, position: p.position, ovr: p.trueOvr,
        depth: {
          starts: fit.starts,
          incumbent: Math.round(fit.incumbent),
          // At or under replacement there is nobody there — the sim fields a
          // replacement-level body, which is not a man the card can name.
          emptySlot: fit.incumbent <= REPLACEMENT_LEVEL,
          position: p.position,
        },
      });
    }
    return out;
  };

  const outgoing = await resolve(readJson<TradeAssetSnapshot[]>(iAmA ? record.aToB : record.bToA, []));
  const incoming = await resolve(readJson<TradeAssetSnapshot[]>(iAmA ? record.bToA : record.aToB, []));

  // executeTrade books accelerated bonus as a CapCharge labelled with the
  // player's name; matching on that label reads the charge the trade actually
  // created instead of recomputing acceleration a second time.
  const charges = await prisma.capCharge.findMany({
    where: {
      teamId: opts.myTeamId,
      year: record.seasonYear,
      label: { in: outgoing.filter((a) => a.kind === 'PLAYER').map((a) => `Traded away — ${a.label}`) },
    },
  });

  return {
    id: record.id,
    seasonYear: record.seasonYear,
    week: record.week,
    partnerId,
    partnerAbbr: iAmA ? record.teamBAbbr : record.teamAAbbr,
    partnerName: partner?.name ?? (iAmA ? record.teamBAbbr : record.teamAAbbr),
    incoming,
    outgoing,
    deadMoneyBooked: charges.reduce((sum, c) => sum + c.amount, 0),
  };
}
