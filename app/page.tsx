import Link from 'next/link';
import { prisma } from '@/lib/db';
import { createLeagueAction, deleteLeagueAction } from './actions/league';
import { TEAM_SEEDS } from '@/lib/gen/names';
import { PHASE_LABELS } from '@/lib/season';
import { TeamLogo } from '@/components/TeamLogo';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const leagues = await prisma.league.findMany({ orderBy: { createdAt: 'desc' }, include: { teams: { where: { isUser: true } } } });

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface/60 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center text-accent font-bold">D</div>
            <span className="font-semibold tracking-tight text-lg">Dynasty GM Football</span>
          </div>
          <span className="label-sm">Front Office Simulator</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-10">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight mb-1">Your leagues</h1>
          <p className="text-muted text-sm mb-5">Pick up where you left off, or start a new franchise.</p>

          {leagues.length === 0 ? (
            <div className="card card-pad text-center py-12 text-muted">No leagues yet — create your first one below.</div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {leagues.map((l) => {
                const team = l.teams[0];
                return (
                  <div key={l.id} className="card card-pad flex flex-col gap-3 animate-fadeUp">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        {team && <TeamLogo seed={team.id} abbr={team.abbr} size={40} />}
                        <div>
                          <div className="font-semibold">{l.name}</div>
                          <div className="text-sm text-muted">{team ? `${team.city} ${team.nickname}` : 'No team'}</div>
                        </div>
                      </div>
                      <span className="pill border-accent2/30 text-accent2 bg-accent2/10">{PHASE_LABELS[l.phase] ?? l.phase}</span>
                    </div>
                    <div className="text-xs text-muted">
                      Season {l.seasonYear} · Week {l.week}
                      {team ? ` · ${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ''}` : ''}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Link href={`/league/${l.id}`} className="btn-primary flex-1">Continue</Link>
                      <form action={deleteLeagueAction.bind(null, l.id)}>
                        <button className="btn-ghost" title="Delete league">Delete</button>
                      </form>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="card card-pad max-w-2xl">
          <h2 className="text-lg font-semibold mb-1">Start a new league</h2>
          <p className="text-sm text-muted mb-5">32 teams, generated from scratch — no real NFL data. Playable immediately.</p>
          <form action={createLeagueAction} className="space-y-4">
            <div>
              <label className="label-sm block mb-1.5">League name</label>
              <input name="name" className="input w-full" placeholder="My League" defaultValue="Founders League" required />
            </div>
            <div>
              <label className="label-sm block mb-1.5">Your team</label>
              <select name="userTeamAbbr" className="input w-full">
                {TEAM_SEEDS.map((t) => (
                  <option key={t.abbr} value={t.abbr}>{t.city} {t.nickname} — {t.conference} {t.division}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label-sm block mb-1.5">Start type</label>
                <select name="leagueStart" className="input w-full">
                  <option value="RANDOM_ROSTERS">32 rosters, randomized</option>
                  <option value="FANTASY_DRAFT">Fantasy draft (blank rosters)</option>
                </select>
              </div>
              <div>
                <label className="label-sm block mb-1.5">Salary cap</label>
                <select name="capMode" className="input w-full">
                  <option value="REALISTIC">Realistic</option>
                  <option value="SIMPLIFIED">Simplified</option>
                  <option value="OFF">Off</option>
                </select>
              </div>
              <div>
                <label className="label-sm block mb-1.5">Difficulty</label>
                <select name="difficulty" className="input w-full">
                  <option value="ROOKIE">Rookie</option>
                  <option value="PRO">Pro</option>
                  <option value="ALL_PRO">All-Pro</option>
                  <option value="LEGEND">Legend</option>
                </select>
              </div>
            </div>
            <button type="submit" className="btn-primary w-full">Create League</button>
          </form>
        </section>
      </main>
    </div>
  );
}
