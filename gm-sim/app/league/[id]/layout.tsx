import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLeagueContext } from '@/lib/league-data';
import { AdvanceWeekButton } from '@/components/AdvanceWeekButton';
import { formatMoney } from '@/lib/cap';
import { teamCapSummary } from '@/lib/cap-summary';

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '', label: 'Dashboard' },
  { href: '/roster', label: 'Roster' },
  { href: '/depth-chart', label: 'Depth Chart' },
  { href: '/free-agency', label: 'Free Agency' },
  { href: '/trade', label: 'Trade' },
  { href: '/draft', label: 'Draft' },
  { href: '/cap', label: 'Cap' },
  { href: '/standings', label: 'Standings' },
  { href: '/schedule', label: 'Schedule' },
  { href: '/settings', label: 'Settings' },
];

export default async function LeagueLayout({ children, params }: { children: React.ReactNode; params: { id: string } }) {
  const ctx = await getLeagueContext(params.id).catch(() => null);
  if (!ctx || !ctx.userTeam) notFound();
  const { league, userTeam, phaseLabel } = ctx;

  const cap = ctx.settings.capMode === 'OFF' ? null : await teamCapSummary(userTeam.id, league.seasonYear, ctx.settings.capMode);

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center text-accent font-bold text-sm">G</div>
            <span className="font-semibold text-sm hidden sm:inline">Gridiron GM</span>
          </Link>
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right hidden md:block">
              <div className="text-sm font-semibold leading-tight">{userTeam.city} {userTeam.nickname}</div>
              <div className="text-xs text-muted leading-tight">{userTeam.wins}-{userTeam.losses}{userTeam.ties ? `-${userTeam.ties}` : ''} · {userTeam.conference} {userTeam.division}</div>
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
            <AdvanceWeekButton leagueId={league.id} />
          </div>
        </div>
        <nav className="max-w-7xl mx-auto px-6 pb-2 flex gap-1 overflow-x-auto">
          {NAV.map((item) => (
            <Link key={item.href} href={`/league/${league.id}${item.href}`} className="nav-link whitespace-nowrap">
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
