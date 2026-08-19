import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { TradeBuilder } from '@/components/TradeBuilder';
import { PendingTradeOffers } from '@/components/PendingTradeOffers';
import { parseGmProfile, philosophySummary } from '@/lib/ai/gm';
import { capHit } from '@/lib/cap';

export default async function TradePage({ params, searchParams }: { params: { id: string }; searchParams: { with?: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

  const otherTeams = await prisma.team.findMany({ where: { leagueId: league.id, isUser: false }, orderBy: { city: 'asc' } });
  const partnerId = searchParams.with || otherTeams[0]?.id;

  const [myRoster, myPicks, partnerRoster, partnerPicks, pendingOffers] = await Promise.all([
    prisma.player.findMany({ where: { teamId: team.id }, include: { contract: true }, orderBy: { trueOvr: 'desc' } }),
    prisma.draftPick.findMany({ where: { ownerTeamId: team.id, used: false }, orderBy: [{ year: 'asc' }, { round: 'asc' }] }),
    partnerId ? prisma.player.findMany({ where: { teamId: partnerId }, include: { contract: true }, orderBy: { trueOvr: 'desc' } }) : Promise.resolve([]),
    partnerId ? prisma.draftPick.findMany({ where: { ownerTeamId: partnerId, used: false }, orderBy: [{ year: 'asc' }, { round: 'asc' }] }) : Promise.resolve([]),
    prisma.tradeOffer.findMany({ where: { leagueId: league.id, toTeamId: team.id, status: 'PENDING' }, include: { fromTeam: true }, orderBy: { createdAt: 'desc' } }),
  ]);

  const toRosterP = (p: (typeof myRoster)[number]) => ({
    id: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position, ovr: p.trueOvr, age: p.age,
    capHit: settings.capMode === 'OFF' ? 0 : capHit(p.contract, settings.capMode),
    yearsRemaining: p.contract?.yearsRemaining ?? 0,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Trade Center</h1>
        <p className="text-muted text-sm mt-1">Build an offer. The AI values players and picks the same way it does everywhere else — no free lunches.</p>
      </div>

      <PendingTradeOffers
        leagueId={league.id}
        offers={pendingOffers.map((o) => ({ id: o.id, fromTeamId: o.fromTeamId, fromTeamAbbr: o.fromTeam.abbr, fromTeamName: `${o.fromTeam.city} ${o.fromTeam.nickname}`, blurb: o.blurb, week: o.week }))}
      />

      <TradeBuilder
        leagueId={league.id}
        myTeam={{ id: team.id, name: `${team.city} ${team.nickname}`, abbr: team.abbr }}
        partners={otherTeams.map((t) => ({ id: t.id, name: `${t.city} ${t.nickname}`, abbr: t.abbr, philosophy: philosophySummary(parseGmProfile(t.gmProfile)) }))}
        partnerId={partnerId ?? ''}
        myRoster={myRoster.map(toRosterP)}
        myPicks={myPicks.map((p) => ({ id: p.id, year: p.year, round: p.round, slot: p.slot }))}
        partnerRoster={partnerRoster.map(toRosterP)}
        partnerPicks={partnerPicks.map((p) => ({ id: p.id, year: p.year, round: p.round, slot: p.slot }))}
      />
    </div>
  );
}
