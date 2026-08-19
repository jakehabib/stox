import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { TeamLogo } from '@/components/TeamLogo';

const TYPE_LABELS: Record<string, string> = {
  ALL: 'All', NEWS: 'Performances', TRADE: 'Trades', SIGN: 'Signings', CUT: 'Releases',
  DRAFT: 'Draft', INJURY: 'Injuries', RESIGN: 'Re-signs', TAG: 'Tags', CHAMPION: 'Championships', FIRE: 'Firings',
  AWARD_MVP: 'MVP', AWARD_OPOY: 'OPOY', AWARD_DPOY: 'DPOY', AWARD_ROTY: 'ROTY',
};
const FILTERS = ['ALL', 'NEWS', 'TRADE', 'SIGN', 'CUT', 'DRAFT', 'INJURY', 'CHAMPION', 'FIRE'];

const TYPE_STYLE: Record<string, string> = {
  NEWS: 'border-accent2/30 text-accent2 bg-accent2/10',
  TRADE: 'border-warn/30 text-warn bg-warn/10',
  SIGN: 'border-accent/30 text-accent bg-accent/10',
  CUT: 'border-bad/30 text-bad bg-bad/10',
  DRAFT: 'border-gold/30 text-gold bg-gold/10',
  INJURY: 'border-bad/30 text-bad bg-bad/10',
  CHAMPION: 'border-gold/40 text-gold bg-gold/10',
  FIRE: 'border-bad/30 text-bad bg-bad/10',
  RESIGN: 'border-accent/30 text-accent bg-accent/10',
  TAG: 'border-accent/30 text-accent bg-accent/10',
  AWARD_MVP: 'border-gold/40 text-gold bg-gold/10',
  AWARD_OPOY: 'border-gold/40 text-gold bg-gold/10',
  AWARD_DPOY: 'border-gold/40 text-gold bg-gold/10',
  AWARD_ROTY: 'border-gold/40 text-gold bg-gold/10',
};

export default async function NewsPage({ params, searchParams }: { params: { id: string }; searchParams: { type?: string } }) {
  const { league } = await getLeagueContext(params.id);
  const type = FILTERS.includes(searchParams.type ?? '') ? searchParams.type! : 'ALL';

  const items = await prisma.transaction.findMany({
    where: { leagueId: league.id, ...(type === 'ALL' ? {} : { type }) },
    orderBy: { createdAt: 'desc' },
    take: 80,
  });
  const teamIds = Array.from(new Set(items.map((i) => i.teamId).filter(Boolean))) as string[];
  const teams = await prisma.team.findMany({ where: { id: { in: teamIds } } });
  const teamById = new Map(teams.map((t) => [t.id, t]));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">League News</h1>
        <p className="text-muted text-sm mt-1">Everything the league's transaction wire has picked up.</p>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <a
            key={f}
            href={f === 'ALL' ? `/league/${league.id}/news` : `/league/${league.id}/news?type=${f}`}
            className={`pill ${type === f ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-chalk'}`}
          >
            {TYPE_LABELS[f]}
          </a>
        ))}
      </div>

      <div className="card divide-y divide-line/60">
        {items.length === 0 && <div className="card-pad text-sm text-muted">Nothing here yet.</div>}
        {items.map((item) => {
          const team = item.teamId ? teamById.get(item.teamId) : null;
          return (
            <div key={item.id} className="px-4 py-3 flex items-start gap-3">
              {team ? <TeamLogo seed={team.id} abbr={team.abbr} size={26} className="mt-0.5 shrink-0" /> : <div className="w-[26px] h-[26px] shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm">{item.headline}</div>
                {item.detail && <div className="text-xs text-muted mt-0.5">{item.detail}</div>}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className={`pill text-[10px] ${TYPE_STYLE[item.type] ?? 'border-line text-muted'}`}>{TYPE_LABELS[item.type] ?? item.type}</span>
                <span className="text-[10px] text-muted">Yr {item.seasonYear} Wk {item.week}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
