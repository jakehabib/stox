import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLeagueContext } from '@/lib/league-data';
import { AdvanceWeekButton } from '@/components/AdvanceWeekButton';
import { formatMoney } from '@/lib/cap';
import { teamCapSummary } from '@/lib/cap-summary';
import { TeamLogo } from '@/components/TeamLogo';
import { LeagueNav } from '@/components/LeagueNav';
import { LeagueWireTicker } from '@/components/ds/LeagueWireTicker';
import { transactionCategory } from '@/lib/newsCategory';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function LeagueLayout({ children, params }: { children: React.ReactNode; params: { id: string } }) {
  const ctx = await getLeagueContext(params.id).catch(() => null);
  if (!ctx || !ctx.userTeam) notFound();
  const { league, userTeam, phaseLabel } = ctx;

  // Ticker carries breaking news only — real events that happened around the
  // league. Deliberately excludes NEWS/DEV_MILESTONE stat-leader trivia:
  // it isn't breaking, and the Dashboard's League Wire already shows it, so
  // including it made the two read as duplicates of each other.
  const [cap, tickerTx] = await Promise.all([
    ctx.settings.capMode === 'OFF' ? Promise.resolve(null) : teamCapSummary(userTeam.id, league.seasonYear, ctx.settings.capMode),
    prisma.transaction.findMany({
      where: { leagueId: league.id, type: { in: ['TRADE', 'SIGN', 'RESIGN', 'CUT', 'TAG', 'INJURY', 'DRAFT', 'FIRE', 'CHAMPION', 'AWARD_MVP', 'AWARD_OPOY', 'AWARD_DPOY', 'AWARD_ROTY', 'AWARD_SBMVP'] } },
      orderBy: { createdAt: 'desc' },
      take: 120,
    }),
  ]);
  // Injuries outnumber every other event type by an order of magnitude, so a
  // straight "most recent 14" is a wall of identical injury lines. Round-robin
  // across categories instead — recency still orders within each category.
  const byCategory = new Map<string, typeof tickerTx>();
  for (const t of tickerTx) {
    const cat = transactionCategory(t.type, t.headline);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(t);
  }
  const tickerItems: { category: ReturnType<typeof transactionCategory>; headline: string }[] = [];
  for (let round = 0; tickerItems.length < 14; round++) {
    let added = false;
    for (const [cat, rows] of byCategory) {
      if (round >= rows.length || tickerItems.length >= 14) continue;
      tickerItems.push({ category: cat as ReturnType<typeof transactionCategory>, headline: rows[round].headline });
      added = true;
    }
    if (!added) break;
  }

  return (
    <div className="min-h-screen">
      <LeagueWireTicker items={tickerItems} />
      <header className="border-b border-line bg-surface/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 rounded-md bg-accent/15 border border-accent/30 flex items-center justify-center text-accent font-display font-bold text-sm">D</div>
            <span className="font-display font-bold text-base tracking-wide uppercase hidden sm:inline">Dynasty GM</span>
          </Link>
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <TeamLogo seed={userTeam.id} abbr={userTeam.abbr} size={32} className="hidden sm:block" />
              <div className="text-right hidden md:block">
                <div className="text-sm font-semibold leading-tight">{userTeam.city} {userTeam.nickname}</div>
                <div className="text-xs text-muted leading-tight">{userTeam.wins}-{userTeam.losses}{userTeam.ties ? `-${userTeam.ties}` : ''} · {userTeam.conference} {userTeam.division}</div>
              </div>
            </div>
            {cap && (
              <div className="stat-tile hidden lg:block text-right">
                <div className="label-sm">Cap Space</div>
                <div className={`text-sm font-mono font-semibold ${cap.capSpace >= 0 ? 'text-accent' : 'text-bad'}`}>{formatMoney(cap.capSpace)}</div>
              </div>
            )}
            <div className="stat-tile text-right">
              <div className="label-sm">{phaseLabel}</div>
              <div className="text-sm font-mono font-semibold">{league.seasonYear} · Wk {league.week}</div>
            </div>
            <AdvanceWeekButton leagueId={league.id} currentPhase={league.phase} />
          </div>
        </div>
        <LeagueNav leagueId={league.id} />
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
