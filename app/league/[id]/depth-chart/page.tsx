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
  const emptyPositions = POSITIONS.filter((pos) => byPosition[pos].length === 0);
  const emptyGroups = emptyPositions.length;
  const thinPositions = POSITIONS.filter((pos) => byPosition[pos].length === 1);
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
  // A depth chart that isn't sorted by rating is a legitimate choice, so this
  // reports rather than corrects — but a new signing appends to the bottom of
  // his group, so an 83 can end up behind two 69s without the user ever
  // deciding that. Injured players are excluded: benching someone who's hurt
  // is exactly right, and counting it would make the number meaningless.
  const misordered = POSITIONS.filter((pos) => {
    const order = orderByPosition[pos] ?? [];
    const healthy = order
      .map((id) => players.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => !!p && p.injuryWeeks === 0);
    return healthy.some((p, i) => healthy.slice(i + 1).some((q) => q.trueOvr > p.trueOvr));
  });

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
            detail: emptyGroups > 0 ? emptyPositions.join(', ') : 'every spot covered',
            color: emptyGroups > 0 ? 'text-bad' : 'text-accent',
          },
          { label: 'Starter OVR', value: starterAvgOvr.toFixed(1), detail: 'average across the ones', color: undefined },
          { label: 'No Backup', value: String(thinPositions.length), detail: thinPositions.length > 0 ? thinPositions.join(', ') : 'depth everywhere', color: thinPositions.length > 0 ? 'text-warn' : 'text-accent' },
          { label: 'Injured Starters', value: String(injuredStarters), detail: injuredStarters > 0 ? 'reorder before kickoff' : 'none', color: injuredStarters > 0 ? 'text-bad' : 'text-accent' },
          {
            label: 'Out Of Order',
            value: String(misordered.length),
            detail: misordered.length > 0 ? misordered.join(', ') : 'best man starts everywhere',
            color: misordered.length > 0 ? 'text-warn' : 'text-accent',
          },
        ]}
      />

      {/* Column flow, not a grid. A grid row is as tall as its tallest cell, so
          a two-deep QB card sat in a box sized for the seven-deep WR card
          beside it and the page ran close to half empty. Columns pack each
          card against the previous one instead. Reading order becomes
          top-to-bottom then across, which is fine here because every card
          names its own position. */}
      <div className="columns-1 md:columns-2 xl:columns-3 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
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
