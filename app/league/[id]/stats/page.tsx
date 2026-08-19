import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { readJson } from '@/lib/json';
import { SeasonStats } from '@/lib/types';
import { TeamLogo } from '@/components/TeamLogo';
import { PlayerAvatar } from '@/components/PlayerAvatar';

interface LeaderCol { key: keyof SeasonStats; label: string; format?: (n: number) => string }
interface LeaderCategory { title: string; primary: LeaderCol; extra: LeaderCol[] }

const CATEGORIES: LeaderCategory[] = [
  { title: 'Passing Yards', primary: { key: 'passYds', label: 'Yds' }, extra: [{ key: 'passTd', label: 'TD' }, { key: 'int', label: 'INT' }] },
  { title: 'Passing TDs', primary: { key: 'passTd', label: 'TD' }, extra: [{ key: 'passYds', label: 'Yds' }, { key: 'int', label: 'INT' }] },
  { title: 'Rushing Yards', primary: { key: 'rushYds', label: 'Yds' }, extra: [{ key: 'rushTd', label: 'TD' }, { key: 'rushAtt', label: 'Att' }] },
  { title: 'Receiving Yards', primary: { key: 'recYds', label: 'Yds' }, extra: [{ key: 'recTd', label: 'TD' }, { key: 'rec', label: 'Rec' }] },
  { title: 'Tackles', primary: { key: 'tackles', label: 'Tkl' }, extra: [{ key: 'sacks', label: 'Sacks' }, { key: 'defInt', label: 'INT' }] },
  { title: 'Sacks', primary: { key: 'sacks', label: 'Sacks' }, extra: [{ key: 'tackles', label: 'Tkl' }, { key: 'ff', label: 'FF' }] },
  { title: 'Interceptions', primary: { key: 'defInt', label: 'INT' }, extra: [{ key: 'pd', label: 'PD' }, { key: 'tackles', label: 'Tkl' }] },
];

export default async function StatsPage({ params }: { params: { id: string } }) {
  const { league } = await getLeagueContext(params.id);

  const [players, teams] = await Promise.all([
    prisma.player.findMany({ where: { leagueId: league.id, seasonStats: { not: '{}' } }, include: { team: true } }),
    prisma.team.findMany({ where: { leagueId: league.id } }),
  ]);

  const withStats = players.map((p) => ({ p, stats: readJson<SeasonStats>(p.seasonStats, {}) }));

  const teamOffYards = new Map<string, number>();
  for (const { p, stats } of withStats) {
    if (!p.teamId) continue;
    const yards = (stats.passYds ?? 0) + (stats.rushYds ?? 0);
    teamOffYards.set(p.teamId, (teamOffYards.get(p.teamId) ?? 0) + yards);
  }
  const teamRows = teams
    .map((t) => ({ t, offYards: teamOffYards.get(t.id) ?? 0, diff: t.pointsFor - t.pointsAgnst }))
    .sort((a, b) => b.t.wins - a.t.wins || b.diff - a.diff);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">League Stats — {league.seasonYear}</h1>
        <p className="text-muted text-sm mt-1">League leaders and team production, season-to-date.</p>
      </div>

      {withStats.length === 0 ? (
        <div className="card card-pad text-sm text-muted">No stats recorded yet this season — check back after Week 1.</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          {CATEGORIES.map((cat) => {
            const leaders = [...withStats]
              .filter(({ stats }) => (stats[cat.primary.key] ?? 0) > 0)
              .sort((a, b) => (b.stats[cat.primary.key] ?? 0) - (a.stats[cat.primary.key] ?? 0))
              .slice(0, 10);
            return (
              <div key={cat.title} className="card overflow-hidden">
                <div className="px-4 py-3 border-b border-line font-semibold text-sm">{cat.title}</div>
                <table className="table-clean">
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>{cat.primary.label}</th>
                      {cat.extra.map((c) => <th key={c.key}>{c.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {leaders.map(({ p, stats }, i) => (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/league/${league.id}/player/${p.id}`} className="hover:text-accent2 flex items-center gap-2">
                            <span className="text-xs text-muted w-4 shrink-0">{i + 1}</span>
                            <PlayerAvatar seed={p.id} age={p.age} size={22} />
                            <span className="font-medium truncate">{p.firstName} {p.lastName}</span>
                            <span className="text-xs text-muted font-mono shrink-0">{p.position}</span>
                          </Link>
                        </td>
                        <td className="font-mono font-semibold">{stats[cat.primary.key] ?? 0}</td>
                        {cat.extra.map((c) => <td key={c.key} className="font-mono text-muted">{stats[c.key] ?? 0}</td>)}
                      </tr>
                    ))}
                    {leaders.length === 0 && (
                      <tr><td colSpan={2 + cat.extra.length} className="text-sm text-muted">No qualifying players yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-line font-semibold text-sm">Team Stats</div>
        <table className="table-clean">
          <thead><tr><th>Team</th><th>Record</th><th>PF</th><th>PA</th><th>Diff</th><th>Off. Yards</th></tr></thead>
          <tbody>
            {teamRows.map(({ t, offYards, diff }) => (
              <tr key={t.id}>
                <td>
                  <Link href={`/league/${league.id}/standings`} className="hover:text-accent2 flex items-center gap-2 font-medium">
                    <TeamLogo seed={t.id} abbr={t.abbr} size={22} /> {t.city} {t.nickname}
                  </Link>
                </td>
                <td className="font-mono text-muted">{t.wins}-{t.losses}{t.ties ? `-${t.ties}` : ''}</td>
                <td className="font-mono">{t.pointsFor}</td>
                <td className="font-mono text-muted">{t.pointsAgnst}</td>
                <td className={`font-mono ${diff >= 0 ? 'text-accent' : 'text-bad'}`}>{diff >= 0 ? '+' : ''}{diff}</td>
                <td className="font-mono text-muted">{offYards.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
