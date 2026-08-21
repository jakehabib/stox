import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { POSITIONS } from '@/lib/tuning';
import { startersAt, splitStarters, OFFENSE_STARTERS, DEFENSE_STARTERS } from '@/lib/lineup';
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

  const byId = new Map(players.map((p) => [p.id, p]));

  /**
   * The men actually on the field at a position — the top `startersAt(pos)` of
   * its chart, not its top man. Every number on this masthead used to take the
   * first player at each position and call that the starter, which is right at
   * QB and wrong at WR, CB, EDGE, DT, LB and S. It counted 16 starters for a
   * lineup that fields 22.
   */
  const startersAtPosition = (pos: string) =>
    splitStarters(pos, orderByPosition[pos] ?? [])
      .starters.map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p);

  const groupCount = POSITIONS.filter((pos) => byPosition[pos].length > 0).length;
  const thinPositions = POSITIONS.filter((pos) => byPosition[pos].length === 1);

  // "Unmanned" means a starting slot with nobody in it, which is not the same
  // as a position group with nobody in it: two receivers at a position that
  // starts three is a hole in the lineup, and this tile used to read "every
  // spot covered" over exactly that.
  const shortPositions = POSITIONS.filter((pos) => startersAtPosition(pos).length < startersAt(pos));
  const openStarterSlots = POSITIONS.reduce(
    (n, pos) => n + Math.max(0, startersAt(pos) - startersAtPosition(pos).length), 0);

  // Average across the STARTERS — all 22 of them plus the specialists, each
  // counted once per slot he fills, so a three-deep receiver group weighs what
  // it does on the field.
  const starterOvrs = POSITIONS.flatMap((pos) => startersAtPosition(pos).map((p) => p.trueOvr));
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

  // Every starter, not every position's top man — an injured WR2 is an injured
  // starter, and this tile used to read zero with him on the field.
  const injuredStarters = POSITIONS.reduce(
    (n, pos) => n + startersAtPosition(pos).filter((p) => p.injuryWeeks > 0).length, 0);

  return (
    <div className="space-y-6">
      <PageMasthead
        teamId={team.id}
        teamAbbr={team.abbr}
        eyebrow="Depth Chart"
        title={`${team.city} ${team.nickname}`}
        subtitle={`Set who starts. The sim engine uses this order every game — ${OFFENSE_STARTERS} on offense, ${DEFENSE_STARTERS} on defense, highlighted below.`}
        action={<AutoSortButton teamId={team.id} />}
        facts={[
          // Colour stays off the group count itself — 16 groups isn't the
          // problem, an unmanned one is, and that gets its own tile below.
          { label: 'Position Groups', value: String(groupCount), detail: 'with at least one player' },
          {
            label: 'Open Starting Slots',
            value: String(openStarterSlots),
            detail: openStarterSlots > 0 ? shortPositions.join(', ') : 'every starting slot filled',
            color: openStarterSlots > 0 ? 'text-bad' : 'text-accent',
          },
          {
            label: 'Starter OVR',
            value: starterAvgOvr.toFixed(1),
            detail: `across all ${starterOvrs.length} starters`,
            color: undefined,
          },
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
            players={byPosition[pos].map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, ovr: p.trueOvr, age: p.age, injured: p.injuryWeeks > 0, weightLb: p.weightLb, heightIn: p.heightIn }))}
            order={orderByPosition[pos]}
          />
        ))}
      </div>
    </div>
  );
}
