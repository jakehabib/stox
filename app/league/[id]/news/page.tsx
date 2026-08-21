import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import Link from 'next/link';
import { TeamLogo } from '@/components/TeamLogo';
import { PageMasthead } from '@/components/ds/PageMasthead';

const TYPE_LABELS: Record<string, string> = {
  ALL: 'All', NEWS: 'Performances', TRADE: 'Trades', SIGN: 'Signings', CUT: 'Releases',
  DRAFT: 'Draft', INJURY: 'Injuries', RESIGN: 'Re-signs', TAG: 'Tags', CHAMPION: 'Championships', FIRE: 'Firings',
  AWARD_MVP: 'MVP', AWARD_OPOY: 'OPOY', AWARD_DPOY: 'DPOY', AWARD_ROTY: 'ROTY', AWARD_SBMVP: 'SB MVP',
  DEV_MILESTONE: 'Development',
};
const FILTERS = ['ALL', 'NEWS', 'TRADE', 'SIGN', 'CUT', 'DRAFT', 'INJURY', 'CHAMPION', 'FIRE', 'DEV_MILESTONE'];

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
  AWARD_SBMVP: 'border-gold/40 text-gold bg-gold/10',
  DEV_MILESTONE: 'border-accent2/30 text-accent2 bg-accent2/10',
};

/**
 * Not every headline is worth the same amount of a reader's attention. A
 * championship, a firing or a blockbuster trade is the story of its week; an
 * injury report is a line item. Ranking them lets the page give the big ones
 * a heavier treatment instead of rendering 80 identical rows.
 */
const TYPE_WEIGHT: Record<string, number> = {
  CHAMPION: 3, AWARD_MVP: 3, AWARD_SBMVP: 3, AWARD_OPOY: 2, AWARD_DPOY: 2, AWARD_ROTY: 2,
  FIRE: 2, TRADE: 2, DRAFT: 2,
  SIGN: 1, RESIGN: 1, TAG: 1, CUT: 1,
  NEWS: 0, INJURY: 0, DEV_MILESTONE: 0,
};

export default async function NewsPage({ params, searchParams }: { params: { id: string }; searchParams: { type?: string; page?: string } }) {
  const { league } = await getLeagueContext(params.id);
  const type = FILTERS.includes(searchParams.type ?? '') ? searchParams.type! : 'ALL';

  // Paged rather than a flat 80. Unfiltered, the wire is dominated by
  // per-game injury and performance rows, and dumping every one of them
  // produced a seven-thousand-pixel column with no way to reach last month.
  const PAGE = 60;
  const page = Math.max(0, Number(searchParams.page) || 0);
  const where = { leagueId: league.id, ...(type === 'ALL' ? {} : { type }) };
  const [items, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: [{ seasonYear: 'desc' }, { week: 'desc' }, { createdAt: 'desc' }],
      skip: page * PAGE,
      take: PAGE,
    }),
    prisma.transaction.count({ where }),
  ]);
  const teamIds = Array.from(new Set(items.map((i) => i.teamId).filter(Boolean))) as string[];
  const teams = await prisma.team.findMany({ where: { id: { in: teamIds } } });
  const teamById = new Map(teams.map((t) => [t.id, t]));

  // Group into weeks. Without a break the wire is one undifferentiated
  // column and there's no sense of when anything happened.
  const byWeek = new Map<string, typeof items>();
  for (const item of items) {
    const key = `${item.seasonYear}|${item.week}`;
    const arr = byWeek.get(key) ?? [];
    arr.push(item);
    byWeek.set(key, arr);
  }

  const hrefFor = (opts: { type?: string; page?: number }) => {
    const params = new URLSearchParams();
    const t = opts.type ?? type;
    if (t !== 'ALL') params.set('type', t);
    if (opts.page) params.set('page', String(opts.page));
    const q = params.toString();
    return `/league/${league.id}/news${q ? `?${q}` : ''}`;
  };

  const shown = page * PAGE + items.length;

  return (
    <div className="space-y-5">
      <PageMasthead
        eyebrow={`${league.seasonYear} · Week ${league.week}`}
        title="League News"
        subtitle="Everything the league's transaction wire has picked up, newest first."
        facts={[
          { label: 'Filter', value: TYPE_LABELS[type] ?? type, detail: type === 'ALL' ? 'every category' : 'one category' },
          { label: 'Stories', value: total.toLocaleString(), detail: 'matching this filter' },
          { label: 'Showing', value: `${page * PAGE + 1}–${shown}`, detail: `page ${page + 1} of ${Math.max(1, Math.ceil(total / PAGE))}` },
        ]}
      />

      <div className="flex gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <a
            key={f}
            href={hrefFor({ type: f, page: 0 })}
            className={`pill ${type === f ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-chalk'}`}
          >
            {TYPE_LABELS[f]}
          </a>
        ))}
      </div>

      {items.length === 0 && <div className="panel p-4 text-sm text-muted">Nothing here yet.</div>}

      {Array.from(byWeek.entries()).map(([key, weekItems]) => {
        const [year, week] = key.split('|');
        return (
          <div key={key} className="section">
            <div className="section-head">
              <h2 className="section-title">{year} · Week {week}</h2>
              <span className="label-sm">{weekItems.length} {weekItems.length === 1 ? 'story' : 'stories'}</span>
            </div>
            <div className="panel divide-y divide-line/60">
              {weekItems.map((item) => {
                const team = item.teamId ? teamById.get(item.teamId) : null;
                const weight = TYPE_WEIGHT[item.type] ?? 0;
                return (
                  <div
                    key={item.id}
                    className={`px-4 flex items-start gap-3 ${weight >= 2 ? 'py-4 bg-raised/25' : 'py-2.5'}`}
                  >
                    {team
                      ? <TeamLogo seed={team.id} abbr={team.abbr} size={weight >= 2 ? 32 : 24} className="mt-0.5 shrink-0" />
                      : <div className={`${weight >= 2 ? 'w-8 h-8' : 'w-6 h-6'} rounded-full bg-raised shrink-0 mt-0.5`} />}
                    <div className="flex-1 min-w-0">
                      <div className={`label-sm ${TYPE_STYLE[item.type] ? TYPE_STYLE[item.type].split(' ')[1] : 'text-muted'}`}>{TYPE_LABELS[item.type] ?? item.type}</div>
                      <div className={`font-display font-bold mt-0.5 ${weight >= 2 ? 'text-base' : 'text-sm'}`}>{item.headline}</div>
                      {item.detail && <div className="text-xs text-muted mt-0.5">{item.detail}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {total > PAGE && (
        <div className="flex items-center justify-between gap-3 pt-1">
          {page > 0
            ? <Link href={hrefFor({ page: page - 1 })} className="btn-secondary">← Newer</Link>
            : <span />}
          <span className="text-xs text-muted">
            {(page * PAGE + 1).toLocaleString()}–{shown.toLocaleString()} of {total.toLocaleString()}
          </span>
          {shown < total
            ? <Link href={hrefFor({ page: page + 1 })} className="btn-secondary">Older →</Link>
            : <span />}
        </div>
      )}
    </div>
  );
}
