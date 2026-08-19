import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { readJson } from '@/lib/json';
import { buildScoutedView } from '@/lib/scouting';
import { ratingColor } from '@/lib/ratings';
import { marketValue, formatMoney } from '@/lib/cap';
import { positionSortKey } from '@/lib/league-data';
import { PlayerAvatar } from '@/components/PlayerAvatar';

export default async function FreeAgencyPage({ params, searchParams }: { params: { id: string }; searchParams: { pos?: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

  const where: any = { leagueId: league.id, status: 'FREE_AGENT', teamId: null, isDraftee: false };
  if (searchParams.pos) where.position = searchParams.pos;

  const freeAgents = await prisma.player.findMany({ where, orderBy: { trueOvr: 'desc' }, take: 100 });
  const reports = await prisma.scoutingReport.findMany({ where: { teamId: team.id, playerId: { in: freeAgents.map((p) => p.id) } } });
  const reportMap = new Map(reports.map((r) => [r.playerId, r]));

  const positions = Array.from(new Set(freeAgents.map((p) => p.position))).sort((a, b) => positionSortKey(a) - positionSortKey(b));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Free Agency</h1>
        <p className="text-muted text-sm mt-1">{freeAgents.length} available. Offer a contract to open negotiations.</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Link href={`/league/${league.id}/free-agency`} className={`pill ${!searchParams.pos ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted'}`}>All</Link>
        {positions.map((pos) => (
          <Link key={pos} href={`/league/${league.id}/free-agency?pos=${pos}`} className={`pill ${searchParams.pos === pos ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted'}`}>{pos}</Link>
        ))}
      </div>

      <div className="card overflow-hidden">
        <table className="table-clean">
          <thead><tr><th>Pos</th><th>Name</th><th>Age</th><th>{settings.scoutingEnabled ? 'Scouted' : 'OVR'}</th><th>Est. Market</th><th></th></tr></thead>
          <tbody>
            {freeAgents.map((p) => {
              const view = buildScoutedView({
                position: p.position as any, trueAttrs: readJson(p.trueAttrs, {}), trueOvr: p.trueOvr, potential: p.potential,
                report: reportMap.get(p.id), settings, isOwnRoster: false, isUserView: true,
              });
              const market = marketValue({ ovr: view.scoutedOvr, position: p.position as any, age: p.age });
              return (
                <tr key={p.id}>
                  <td className="font-mono text-xs text-muted">{p.position}</td>
                  <td><Link href={`/league/${league.id}/player/${p.id}`} className="hover:text-accent2 font-medium flex items-center gap-2"><PlayerAvatar seed={p.id} age={p.age} size={26} /> {p.firstName} {p.lastName}</Link></td>
                  <td className="text-muted">{p.age}</td>
                  <td className={`font-mono font-semibold ${ratingColor(view.scoutedOvr)}`}>{view.revealed ? view.scoutedOvr : `${view.ovrLow}-${view.ovrHigh}`}</td>
                  <td className="font-mono text-muted">{formatMoney(market)}/yr</td>
                  <td><Link href={`/league/${league.id}/player/${p.id}`} className="btn-secondary text-xs px-2.5 py-1">Negotiate</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
