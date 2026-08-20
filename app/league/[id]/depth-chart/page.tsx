import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { POSITIONS } from '@/lib/tuning';
import { DepthChartGroup } from '@/components/DepthChartGroup';
import { AutoSortButton } from '@/components/AutoSortButton';
import { TeamLogo } from '@/components/TeamLogo';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';

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

  const teamColor = generateTeamLogoParams(team.id).primary;
  const groupCount = POSITIONS.filter((pos) => byPosition[pos].length > 0).length;
  const thinGroups = POSITIONS.filter((pos) => byPosition[pos].length === 1).length;

  return (
    <div className="space-y-6">
      <div
        className="relative overflow-hidden rounded-lg border-2 shadow-elevated"
        style={{
          ['--team-accent' as never]: teamColor,
          borderColor: 'var(--team-accent)',
          background: 'radial-gradient(ellipse 120% 140% at 100% 0%, color-mix(in srgb, var(--team-accent) 16%, transparent), transparent 70%)',
        }}
      >
        <div
          className="absolute inset-0 opacity-[0.05] pointer-events-none"
          style={{ backgroundImage: 'repeating-linear-gradient(115deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 14px)', color: 'var(--team-accent)' }}
        />
        <TeamLogo seed={team.id} abbr={team.abbr} size={220} className="watermark-logo opacity-[0.06] -right-14 -top-14" />

        <div className="relative flex flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div>
            <div className="label-sm">Depth Chart · {groupCount} Groups</div>
            <div className="font-display font-extrabold text-2xl uppercase tracking-wide leading-none mt-1" style={{ color: 'var(--team-text)' }}>
              {team.city} {team.nickname}
            </div>
            <p className="text-muted text-sm mt-1.5">
              Set who starts. Sim engine uses this order every game.
              {thinGroups > 0 && <span className="text-warn"> {thinGroups} position{thinGroups > 1 ? 's' : ''} with no backup.</span>}
            </p>
          </div>
          <AutoSortButton teamId={team.id} />
        </div>
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
