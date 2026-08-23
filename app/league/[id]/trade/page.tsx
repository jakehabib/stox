import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { TradeBuilder } from '@/components/TradeBuilder';
import { PendingTradeOffers } from '@/components/PendingTradeOffers';
import { parseGmProfile, philosophySummary, rosterFit, type RosterPlayer } from '@/lib/ai/gm';
import { capHit, tradeCapEffect, formatMoney } from '@/lib/cap';
import { teamCapSummary } from '@/lib/cap-summary';
import { readJson } from '@/lib/json';
import { isTradeDeadlinePassed } from '@/lib/trade';
import { draftOrderContext, pickNumbers, type DraftOrderContext } from '@/lib/draft';
import { REPLACEMENT_LEVEL } from '@/lib/sim/units';
import type { TradeAsset } from '@/lib/trade';
import { buildTradeRetrospectives, type TradeAssetSnapshot } from '@/lib/tradeRetro';
import { TradeRetrospectives } from '@/components/TradeRetrospectives';
import { PageMasthead } from '@/components/ds/PageMasthead';
import Link from 'next/link';
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
  // Everything a pick chip needs to carry an honest number: which draft is
  // next, which draft's stored slots are the real running order, and the
  // standings behind any projection. One read, so the board, the deal sheet
  // and the recap cannot disagree about the same pick. See lib/draft.ts.
  const draftOrder = await draftOrderContext(league.id);
  const imminentYear = draftOrder.imminentYear;

  const [myRoster, myPicks, partnerRoster, partnerPicks, pendingOffers, capSummary, partnerCapSummary, retrospectives, tradesMade] = await Promise.all([
    prisma.player.findMany({ where: { teamId: team.id }, include: { contract: true }, orderBy: { trueOvr: 'desc' } }),
    prisma.draftPick.findMany({ where: { ownerTeamId: team.id, used: false }, orderBy: [{ year: 'asc' }, { round: 'asc' }] }),
    partnerId ? prisma.player.findMany({ where: { teamId: partnerId }, include: { contract: true }, orderBy: { trueOvr: 'desc' } }) : Promise.resolve([]),
    partnerId ? prisma.draftPick.findMany({ where: { ownerTeamId: partnerId, used: false }, orderBy: [{ year: 'asc' }, { round: 'asc' }] }) : Promise.resolve([]),
    prisma.tradeOffer.findMany({ where: { leagueId: league.id, toTeamId: team.id, status: 'PENDING' }, include: { fromTeam: true }, orderBy: { createdAt: 'desc' } }),
    settings.capMode === 'OFF' ? Promise.resolve(null) : teamCapSummary(team.id, league.seasonYear, settings.capMode),
    // The club you are dealing WITH has books of its own, and they decide
    // whether a trade is possible at all — the AI's refusal already quotes its
    // exact room ("it adds $6.60M against $2.00M"), so arriving at Propose is
    // far too late to learn it. Cap space is public in this game exactly as it
    // is in the sport; nothing else about the partner is exposed here.
    settings.capMode === 'OFF' || !partnerId ? Promise.resolve(null) : teamCapSummary(partnerId, league.seasonYear, settings.capMode),
    /**
     * ONLY THE CLUB YOU ARE SITTING ACROSS FROM.
     *
     * This screen used to fetch and render the whole graded history of every
     * deal this GM has ever made, underneath the deal sheet he was in the
     * middle of building. The app owner: *"It seems like a lot of noise to have
     * the trade retrospectives on the trade tab."* He is right about the
     * screen: building a trade and auditing your back catalogue are two
     * different jobs, and the full list now lives on the GM career page where
     * reading it is the reason you came.
     *
     * But a retrospective is NOT noise when it is about the club on the other
     * end of the phone — "the last time I dealt with these people I lost
     * badly" is exactly the context a GM wants before he offers again, and it
     * exists nowhere else on this page (the acceptance meter prices the deal
     * the way that club sees it TODAY; it has no memory). So the history stays,
     * scoped to the partner, and moves with the partner selector. Nothing is
     * fetched at all before a partner is chosen, and the grade only prices that
     * club's deals rather than the whole tenure — see buildTradeRetrospectives.
     */
    partnerId
      ? buildTradeRetrospectives(league.id, team.id, settings.capMode, league.seasonYear, { partnerTeamId: partnerId })
      : Promise.resolve([]),
    // The masthead's career trade count, which is a COUNT and does not need a
    // grade behind it. Kept separate from the graded rows above so the tile can
    // still say how many deals a GM has made without the page paying to price
    // every one of them.
    prisma.tradeRecord.count({ where: { leagueId: league.id, OR: [{ teamAId: team.id }, { teamBId: team.id }] } }),
  ]);

  // Trading a player accelerates his remaining bonus onto the team giving him
  // up (see executeTrade), so the two sides of a swap are NOT symmetric:
  // sending him away frees his hit minus the dead money you keep, while
  // receiving him only adds his base salary.
  //
  // Both halves come out of `tradeCapEffect` — the SAME function
  // `tradeCapDeltas` is built from, which is what the cap gate, the executor
  // and the AI's own cap refusal all run. The builder sums these per selected
  // asset, so its live "space after" is that function's arithmetic and not a
  // second opinion about it.
  const toRosterP = (p: (typeof myRoster)[number]) => {
    const effect = tradeCapEffect(p.contract, settings.capMode);
    return {
      id: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position, ovr: p.trueOvr, age: p.age,
      weightLb: p.weightLb, heightIn: p.heightIn,
      capHit: settings.capMode === 'OFF' ? 0 : capHit(p.contract, settings.capMode),
      freedIfSent: effect.frees,
      addedIfAcquired: effect.takesOn,
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

  // THE NUMBER ON A CHIP IS THE NUMBER THE DRAFT RUNS ON.
  //
  // This used to stamp the ORIGINAL club's standings rank onto every pick it
  // owned, in every round — so a club's R1, R4, R5 and R7 all read "#1", and
  // during a live draft, where RESET_STANDINGS has left every club 0-0-0 and
  // the sort degenerates to database row order, "#1" meant nothing whatsoever.
  // The app owner, mid-draft with the 32nd selection: *"it is pick 32 but
  // counting as #1 overall because its the current pick. these should be
  // locked to their value"*.
  //
  // pickNumbers gives each pick its OWN number, per round: the seeded slot
  // once the order exists (which is what currentPick() puts clubs on the clock
  // by), a per-pick projection before that, and nothing at all for a year with
  // no standings behind it. Nothing here decides any of that — one function
  // decides it for this page, the deal sheet, the recap and the AI's price.
  const toPickP = (p: (typeof myPicks)[number]) => ({
    id: p.id, year: p.year, round: p.round,
    ...pickNumbers(p, draftOrder),
    via: p.originalTeamId === p.ownerTeamId ? undefined : clubById.get(p.originalTeamId)?.abbr,
  });

  const partner = partnerId ? otherTeams.find((t) => t.id === partnerId) ?? null : null;

  const lastTrade = await buildTradeRecap({
    leagueId: league.id, myTeamId: team.id, myRoster, seasonYear: league.seasonYear, clubById,
    draftOrder,
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
            href: `/league/${league.id}/cap`,
          }] : []),
          {
            label: 'Deadline',
            value: deadlinePassed ? 'Passed' : settings.tradeDeadlineEnabled ? `Week ${settings.tradeDeadlineWeek}` : 'None',
            detail: deadlinePassed ? 'reopens in free agency' : settings.tradeDeadlineEnabled ? 'trades close after this' : 'trade year-round',
            color: deadlinePassed ? 'text-bad' : undefined,
          },
          // "graded below" was true only while the full history was rendered on
          // this page. It is on the GM career page now, and the tile says so
          // and goes there, rather than pointing at something that has moved.
          {
            label: 'Trades Made',
            value: String(tradesMade),
            detail: 'graded on your GM page',
            href: `/league/${league.id}/gm`,
          },
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
        partnerCapSpace={partnerCapSummary?.capSpace ?? null}
        capMode={settings.capMode}
        deadlinePassed={deadlinePassed}
        tradeDeadlineWeek={settings.tradeDeadlineWeek}
        draftRounds={settings.draftRounds}
        imminentYear={imminentYear}
        lastTrade={lastTrade}
      />

      {/* Only when there IS a shared history — an empty panel headed "your
          deals with CLE" over nothing is worse than no panel. */}
      {partner && retrospectives.length > 0 && (
        <TradeRetrospectives
          myAbbr={team.abbr}
          retrospectives={retrospectives}
          title={`Your History With ${partner.city} ${partner.nickname}`}
          lede={`The ${retrospectives.length} deal${retrospectives.length === 1 ? '' : 's'} you have made with ${partner.abbr}, graded by how the return has held up since.`}
          action={
            <Link href={`/league/${league.id}/gm`} className="text-xs text-accent2 hover:underline shrink-0">
              Every deal you have made →
            </Link>
          }
        />
      )}
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
  /** Exactly what the pick board is drawn from, so a pick reads the same in both places. */
  draftOrder: DraftOrderContext;
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
        // Re-read rather than parsing the snapshot's label, so the recap wears
        // exactly the pick board's chip — through the same pickNumbers call the
        // board uses, so a pick that reads "#32" on the board cannot read
        // anything else here a second later.
        const pick = await prisma.draftPick.findUnique({ where: { id: s.id } });
        const numbers = pick ? pickNumbers(pick, opts.draftOrder) : null;
        out.push({
          kind: 'PICK',
          label: pick ? `${pick.year} R${pick.round}` : s.label,
          round: pick?.round,
          year: pick?.year,
          overall: numbers?.overall,
          projectedOverall: numbers?.projectedOverall,
        });
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
          // Rating points over the man he displaces, in the SAME expression
          // the AI's own explanation uses (lib/ai/gm.ts, `overIncumbent`) —
          // deliberately not fit.gain, whose snap-weighted units are not a
          // number a GM can check against the depth chart in front of him.
          overIncumbent: Math.round(p.trueOvr - fit.incumbent),
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
