import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { POSITIONS } from '@/lib/tuning';
import { DepthChartGroup } from '@/components/DepthChartGroup';
import { AutoSortButton } from '@/components/AutoSortButton';

export default async function DepthChartPage({ params }: { params: { id: string } }) {
  const { userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

  const [players, slots] = await Promise.all([
    prisma.player.findMany({ where: { teamId: team.id }, orderBy: { trueOvr: 'desc' } }),
    prisma.depthChartSlot.findMany({ where: { teamId: team.id }, orderBy: { rank: 'asc' } }),
  ]);

  const byPosition: Record<string, typeof players> = {};
  for (const pos of POSITIONS) byPosition[pos] = [];
  for (const p of players) (byPosition[p.position] ??= []).push(p);

  const orderByPosition: Record<string, string[]> = {};
  for (const pos of POSITIONS) {
    const ranked = slots.filter((s) => s.position === pos).sort((a, b) => a.rank - b.rank).map((s) => s.playerId);
    const rest = byPosition[pos].filter((p) => !ranked.includes(p.id)).map((p) => p.id);
    orderByPosition[pos] = [...ranked, ...rest];
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Depth Chart</h1>
          <p className="text-muted text-sm mt-1">Set who starts. Sim engine uses this order every game.</p>
        </div>
        <AutoSortButton teamId={team.id} />
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {POSITIONS.filter((pos) => byPosition[pos].length > 0).map((pos) => (
          <DepthChartGroup
            key={pos}
            teamId={team.id}
            position={pos}
            players={byPosition[pos].map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, ovr: p.trueOvr, age: p.age, injured: p.injuryWeeks > 0 }))}
            order={orderByPosition[pos]}
          />
        ))}
      </div>
    </div>
  );
}
