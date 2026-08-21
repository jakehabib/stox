import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { POSITIONS } from '@/lib/tuning';
import { DepthChartGroup } from '@/components/DepthChartGroup';
import { AutoSortButton } from '@/components/AutoSortButton';
import { PageMasthead } from '@/components/ds/PageMasthead';

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

  const groupCount = POSITIONS.filter((pos) => byPosition[pos].length > 0).length;
  const thinGroups = POSITIONS.filter((pos) => byPosition[pos].length === 1).length;
  const emptyGroups = POSITIONS.filter((pos) => byPosition[pos].length === 0).length;
  // Average rating of whoever currently sits atop each group — the closest
  // single number to "how good is the lineup this page actually sets."
  const starterOvrs = POSITIONS
    .map((pos) => orderByPosition[pos]?.[0])
    .filter((id): id is string => !!id)
    .map((id) => players.find((p) => p.id === id)?.trueOvr)
    .filter((v): v is number => typeof v === 'number');
  const starterAvgOvr = starterOvrs.length > 0
    ? starterOvrs.reduce((s, v) => s + v, 0) / starterOvrs.length
    : 0;
  const injuredStarters = POSITIONS.filter((pos) => {
    const topId = orderByPosition[pos]?.[0];
    if (!topId) return false;
    const starter = players.find((p) => p.id === topId);
    return (starter?.injuryWeeks ?? 0) > 0;
  }).length;

  return (
    <div className="space-y-6">
      <PageMasthead
        teamId={team.id}
        teamAbbr={team.abbr}
        eyebrow="Depth Chart"
        title={`${team.city} ${team.nickname}`}
        subtitle="Set who starts. The sim engine uses this order every game."
        action={<AutoSortButton teamId={team.id} />}
        facts={[
          // Colour stays off the group count itself — 16 groups isn't the
          // problem, an unmanned one is, and that gets its own tile below.
          { label: 'Position Groups', value: String(groupCount), detail: 'with at least one player' },
          {
            label: 'Unmanned',
            value: String(emptyGroups),
            detail: emptyGroups > 0 ? 'nobody rostered there' : 'every spot covered',
            color: emptyGroups > 0 ? 'text-bad' : 'text-accent',
          },
          { label: 'Starter OVR', value: starterAvgOvr.toFixed(1), detail: 'average across the ones', color: undefined },
          { label: 'No Backup', value: String(thinGroups), detail: thinGroups > 0 ? 'one injury from a hole' : 'depth everywhere', color: thinGroups > 0 ? 'text-warn' : 'text-accent' },
          { label: 'Injured Starters', value: String(injuredStarters), detail: injuredStarters > 0 ? 'reorder before kickoff' : 'none', color: injuredStarters > 0 ? 'text-bad' : 'text-accent' },
        ]}
      />

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
