import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { readJson } from '@/lib/json';
import { SeasonStats } from '@/lib/types';
import { TeamLogo } from '@/components/TeamLogo';
import { Tooltip } from '@/components/Tooltip';
import { HorizontalBarChart } from '@/components/charts/HorizontalBarChart';
import { LineChart } from '@/components/charts/LineChart';
import { ScatterChart } from '@/components/charts/ScatterChart';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { MetricTiles } from '@/components/ds/MetricTiles';
import { buildPythagoreanTable, strengthOfSchedule, type PythagoreanRow } from '@/lib/analytics';

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

/** The real NFL passer rating formula — every component clamped to [0, 2.375] before averaging. */
function passerRating(s: SeasonStats): number | null {
  const att = s.passAtt ?? 0;
  if (att < 1) return null;
  const clamp = (v: number) => Math.max(0, Math.min(2.375, v));
  const a = clamp(((s.passCmp ?? 0) / att - 0.3) * 5);
  const b = clamp(((s.passYds ?? 0) / att - 3) * 0.25);
  const c = clamp(((s.passTd ?? 0) / att) * 20);
  const d = clamp(2.375 - ((s.int ?? 0) / att) * 25);
  return ((a + b + c + d) / 6) * 100;
}

/** Position-shaped nerdy per-player line — efficiency rates, not just volume, for the My Team deep-dive. */
function nerdyLine(position: string, s: SeasonStats): { label: string; value: string }[] {
  const pct = (num: number, den: number) => (den > 0 ? `${((num / den) * 100).toFixed(1)}%` : '—');
  const rate = (num: number, den: number, digits = 1) => (den > 0 ? (num / den).toFixed(digits) : '—');
  switch (position) {
    case 'QB': {
      const rating = passerRating(s);
      return [
        { label: 'Cmp %', value: pct(s.passCmp ?? 0, s.passAtt ?? 0) },
        { label: 'Y/A', value: rate(s.passYds ?? 0, s.passAtt ?? 0, 1) },
        { label: 'TD %', value: pct(s.passTd ?? 0, s.passAtt ?? 0) },
        { label: 'INT %', value: pct(s.int ?? 0, s.passAtt ?? 0) },
        { label: 'Rating', value: rating !== null ? rating.toFixed(1) : '—' },
      ];
    }
    case 'RB': case 'FB':
      return [
        { label: 'YPC', value: rate(s.rushYds ?? 0, s.rushAtt ?? 0, 1) },
        { label: 'Catch %', value: pct(s.rec ?? 0, s.targets ?? 0) },
        { label: 'Total Yds', value: String((s.rushYds ?? 0) + (s.recYds ?? 0)) },
        { label: 'TDs', value: String((s.rushTd ?? 0) + (s.recTd ?? 0)) },
      ];
    case 'WR': case 'TE':
      return [
        { label: 'Catch %', value: pct(s.rec ?? 0, s.targets ?? 0) },
        { label: 'Y/R', value: rate(s.recYds ?? 0, s.rec ?? 0, 1) },
        { label: 'Y/Target', value: rate(s.recYds ?? 0, s.targets ?? 0, 1) },
        { label: 'TDs', value: String(s.recTd ?? 0) },
      ];
    case 'EDGE': case 'DT': case 'LB':
      return [
        { label: 'Impact (Tkl+Sk)', value: String((s.tackles ?? 0) + (s.sacks ?? 0)) },
        { label: 'Sacks', value: String(s.sacks ?? 0) },
        { label: 'Forced Fum.', value: String(s.ff ?? 0) },
      ];
    case 'CB': case 'S':
      return [
        { label: 'Playmaker (INT+PD)', value: String((s.defInt ?? 0) + (s.pd ?? 0)) },
        { label: 'INT', value: String(s.defInt ?? 0) },
        { label: 'Passes Def.', value: String(s.pd ?? 0) },
      ];
    case 'K':
      return [{ label: 'FG %', value: pct(s.fgm ?? 0, s.fga ?? 0) }, { label: 'XP %', value: pct(s.xpm ?? 0, s.xpa ?? 0) }];
    case 'P':
      return [{ label: 'Avg', value: rate(s.puntYds ?? 0, s.punts ?? 0, 1) }];
    default:
      return [];
  }
}

export default async function StatsPage({ params, searchParams }: { params: { id: string }; searchParams: { view?: string; scope?: string } }) {
  const { league, userTeam } = await getLeagueContext(params.id);
  const advanced = searchParams.view === 'advanced';
  const myTeam = searchParams.scope === 'myteam';

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

  // --- Advanced-view data -----------------------------------------------
  let ratingBars: { label: string; value: number; displayValue: string; color: string }[] = [];
  let quadrantPoints: { id: string; x: number; y: number; label: string; color: string; detail?: string }[] = [];
  let quadrantAvgs: { x?: number; y?: number } = {};
  let weeklyTrend: { label: string; color: string; points: { x: string; y: number }[] }[] = [];
  let pythagorean: PythagoreanRow[] = [];
  let myPythag: PythagoreanRow | undefined;
  let mySos = { sos: 0, opponents: 0 };
  let sosRank = 0;

  const myPlayers = userTeam ? withStats.filter(({ p }) => p.teamId === userTeam.id) : [];

  if (advanced) {
    const ratingPool = myTeam ? myPlayers : withStats;
    ratingBars = ratingPool
      .map(({ p, stats }) => ({ p, rating: passerRating(stats) }))
      .filter((x): x is { p: typeof withStats[number]['p']; rating: number } => x.rating !== null)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 8)
      .map(({ p, rating }) => ({ label: `${p.firstName[0]}.${p.lastName}`, value: rating, displayValue: rating.toFixed(1), color: '#3987e5' }));

    const withGames = teams.map((t) => {
      const gp = t.wins + t.losses + t.ties;
      return { t, gp, ppg: gp > 0 ? t.pointsFor / gp : 0, papg: gp > 0 ? t.pointsAgnst / gp : 0 };
    }).filter((x) => x.gp > 0);
    const avgPpg = withGames.reduce((s, x) => s + x.ppg, 0) / Math.max(1, withGames.length);
    const avgPapg = withGames.reduce((s, x) => s + x.papg, 0) / Math.max(1, withGames.length);
    quadrantAvgs = { x: avgPapg, y: avgPpg };
    quadrantPoints = withGames.map(({ t, ppg, papg }) => ({
      id: t.id, x: papg, y: ppg, label: `${t.city} ${t.nickname}`,
      color: t.id === userTeam?.id ? '#3987e5' : '#5a5a63',
      detail: t.id === userTeam?.id ? 'Your team' : undefined,
    }));

    pythagorean = buildPythagoreanTable(teams, userTeam?.id);
    myPythag = pythagorean.find((r) => r.isUser);

    // Strength of schedule needs every played game in the league, not just
    // the user's — each team's SOS is computed the same way so the rank means
    // something.
    const allGames = await prisma.game.findMany({
      where: { leagueId: league.id, kind: 'REGULAR', played: true },
      select: { homeTeamId: true, awayTeamId: true, played: true, week: true, homeScore: true, awayScore: true },
      orderBy: { week: 'asc' },
    });
    const recordById = new Map(teams.map((t) => [t.id, { wins: t.wins, losses: t.losses, ties: t.ties }]));
    if (userTeam) {
      mySos = strengthOfSchedule(userTeam.id, allGames, recordById);
      const allSos = teams
        .map((t) => ({ id: t.id, sos: strengthOfSchedule(t.id, allGames, recordById).sos }))
        .sort((a, b) => b.sos - a.sos);
      sosRank = allSos.findIndex((s) => s.id === userTeam.id) + 1;

      const myGames = allGames.filter((g) => g.homeTeamId === userTeam.id || g.awayTeamId === userTeam.id);
      weeklyTrend = [
        { label: 'Points For', color: '#3987e5', points: myGames.map((g) => ({ x: `Wk ${g.week}`, y: g.homeTeamId === userTeam.id ? g.homeScore : g.awayScore })) },
        { label: 'Points Against', color: '#e66767', points: myGames.map((g) => ({ x: `Wk ${g.week}`, y: g.homeTeamId === userTeam.id ? g.awayScore : g.homeScore })) },
      ];
    }
  }

  return (
    <div className="space-y-6">
      <PageMasthead
        teamId={myTeam ? userTeam?.id : undefined}
        teamAbbr={myTeam ? userTeam?.abbr : undefined}
        eyebrow={`${league.seasonYear} · Week ${league.week}`}
        title={myTeam ? 'My Team Stats' : 'League Stats'}
        subtitle={myTeam ? 'Your full roster, every efficiency stat on the books.' : 'League leaders and team production, season-to-date.'}
        action={
          <div className="flex flex-col items-end gap-1.5">
          <div className="flex gap-1.5">
            <Link href={`/league/${league.id}/stats${advanced ? '?view=advanced' : ''}`} className={`pill ${!myTeam ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-chalk'}`}>League</Link>
            {userTeam && (
              <Link href={`/league/${league.id}/stats?scope=myteam${advanced ? '&view=advanced' : ''}`} className={`pill ${myTeam ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-chalk'}`}>My Team</Link>
            )}
          </div>
          <div className="flex gap-1.5">
            <Link href={`/league/${league.id}/stats${myTeam ? '?scope=myteam' : ''}`} className={`pill ${!advanced ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-chalk'}`}>Basic</Link>
            <Link href={`/league/${league.id}/stats?view=advanced${myTeam ? '&scope=myteam' : ''}`} className={`pill ${advanced ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-chalk'}`}>Advanced</Link>
          </div>
          </div>
        }
        facts={[
          { label: 'Scope', value: myTeam ? (userTeam?.abbr ?? 'Team') : 'League', detail: myTeam ? 'your roster only' : `all ${teams.length} teams` },
          { label: 'View', value: advanced ? 'Advanced' : 'Basic', detail: advanced ? 'efficiency and rate stats' : 'counting stats' },
          { label: 'Players Ranked', value: withStats.length.toLocaleString(), detail: 'with recorded stats' },
        ]}
      />

      {withStats.length === 0 ? (
        <div className="panel p-4 text-sm text-muted">No stats recorded yet this season — check back after Week 1.</div>
      ) : (
        <>
          {advanced && myPythag && (
            <MetricTiles
              metrics={[
                {
                  label: 'Pythagorean W-L',
                  value: `${myPythag.expectedWins.toFixed(1)}-${(myPythag.wins + myPythag.losses + myPythag.ties - myPythag.expectedWins).toFixed(1)}`,
                  detail: `actual ${myPythag.wins}-${myPythag.losses}${myPythag.ties ? `-${myPythag.ties}` : ''}`,
                  tip: "The record your point differential says you should have, using the football-tuned Pythagorean exponent (2.37). It ignores how the wins actually fell — a team far above it has been winning the close ones.",
                },
                {
                  label: 'Luck',
                  value: `${myPythag.luck >= 0 ? '+' : ''}${myPythag.luck.toFixed(1)}`,
                  detail: myPythag.luck >= 0 ? 'wins above what the scoring earned' : 'wins below what the scoring earned',
                  color: myPythag.luck >= 1 ? 'text-warn' : myPythag.luck <= -1 ? 'text-accent2' : undefined,
                  tip: "Actual wins minus Pythagorean wins. Positive means you're outperforming your point differential — historically that regresses. Negative means you've been better than the record looks.",
                },
                {
                  label: 'Point Differential',
                  value: `${myPythag.pointsFor - myPythag.pointsAgainst >= 0 ? '+' : ''}${myPythag.pointsFor - myPythag.pointsAgainst}`,
                  detail: `${myPythag.pointsFor} scored · ${myPythag.pointsAgainst} allowed`,
                  color: myPythag.pointsFor - myPythag.pointsAgainst >= 0 ? 'text-accent' : 'text-bad',
                  tip: 'Total points scored minus allowed. The single best one-number summary of team quality — it predicts future record better than the record itself does.',
                },
                {
                  label: 'Strength of Schedule',
                  value: mySos.opponents > 0 ? mySos.sos.toFixed(3).slice(1) : '—',
                  detail: sosRank > 0 ? `#${sosRank} hardest · ${mySos.opponents} games` : 'no games played',
                  tip: "Combined win rate of every opponent you've actually played. #1 is the hardest schedule in the league. Useful for reading whether a record was earned against real competition.",
                },
              ]}
            />
          )}

          {advanced && pythagorean.length > 0 && (
            <div className="panel overflow-hidden">
              <div className="px-4 py-3 border-b border-line/70">
                <div className="label-sm">Luck Table — Actual vs. Expected</div>
                <div className="text-xs text-muted mt-0.5">
                  Every team sorted by how far their record sits above or below what their scoring earned. Top of the list has been winning
                  close games; the bottom has been losing them.
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="table-clean">
                  <thead>
                    <tr><th>Team</th><th>Actual</th><th>Expected</th><th>Luck</th><th>PF</th><th>PA</th><th>Diff</th></tr>
                  </thead>
                  <tbody>
                    {pythagorean.map((r) => {
                      const diff = r.pointsFor - r.pointsAgainst;
                      return (
                        <tr key={r.teamId} className={r.isUser ? 'bg-raised/60' : ''}>
                          <td>
                            <span className="flex items-center gap-2">
                              <TeamLogo seed={r.teamId} abbr={r.abbr} size={20} className="shrink-0" />
                              <span className={`whitespace-nowrap ${r.isUser ? 'font-semibold' : ''}`}>{r.name}</span>
                            </span>
                          </td>
                          <td className="stat-value text-stat-sm">{r.wins}-{r.losses}{r.ties ? `-${r.ties}` : ''}</td>
                          <td className="font-mono text-muted">{r.expectedWins.toFixed(1)}-{(r.wins + r.losses + r.ties - r.expectedWins).toFixed(1)}</td>
                          <td className={`stat-value text-stat-sm ${r.luck >= 0 ? 'text-warn' : 'text-accent2'}`}>{r.luck >= 0 ? '+' : ''}{r.luck.toFixed(1)}</td>
                          <td className="font-mono text-muted">{r.pointsFor}</td>
                          <td className="font-mono text-muted">{r.pointsAgainst}</td>
                          <td className={`font-mono ${diff >= 0 ? 'text-accent' : 'text-bad'}`}>{diff >= 0 ? '+' : ''}{diff}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {advanced && (
            <div className="grid lg:grid-cols-2 gap-5">
              <div className="panel p-4">
                <h2 className="font-semibold mb-1 inline-flex items-center gap-1.5">
                  Passer Rating
                  <Tooltip text="The real NFL passer rating formula — completion %, yards/attempt, TD rate, and INT rate, each capped and blended into one number. 100 is a solid, unspectacular season; 158.3 is the mathematical maximum." />
                </h2>
                <p className="text-xs text-muted mb-3">Top qualifying passers, season-to-date.</p>
                {ratingBars.length > 0 ? <HorizontalBarChart bars={ratingBars} maxValue={158.3} /> : <p className="text-sm text-muted">No qualifying passers yet.</p>}
              </div>

              <div className="panel p-4">
                <h2 className="font-semibold mb-1 inline-flex items-center gap-1.5">
                  Offense vs. Defense
                  <Tooltip text="Every team by points scored per game (up) and points allowed per game (right, so lower/left is better defense). Dashed lines mark the league average on each axis — top-left is the most complete quadrant: score a lot, allow little." />
                </h2>
                <p className="text-xs text-muted mb-3">Points/game — your team highlighted, dashed lines are league average.</p>
                <ScatterChart
                  points={quadrantPoints}
                  xLabel="Points Allowed / Game" yLabel="Points Scored / Game"
                  formatX="decimal1" formatY="decimal1"
                  quadrantLines={quadrantAvgs}
                />
              </div>

              {weeklyTrend.length > 0 && weeklyTrend[0].points.length > 0 && (
                <div className="panel p-4 lg:col-span-2">
                  <h2 className="font-semibold mb-1">Your Team — Scoring Trend</h2>
                  <p className="text-xs text-muted mb-3">Points for/against by week, season-to-date.</p>
                  <LineChart series={weeklyTrend} formatY="integer" />
                </div>
              )}
            </div>
          )}

          {myTeam ? (
            <div className="panel overflow-hidden">
              <div className="px-4 py-3 border-b border-line/70 label-sm">Full Roster Stat Line</div>
              <div className="overflow-x-auto">
                <table className="table-clean">
                  <thead>
                    <tr><th>Player</th><th>Pos</th><th colSpan={5}>Efficiency</th></tr>
                  </thead>
                  <tbody>
                    {myPlayers.length === 0 && (
                      <tr><td colSpan={7} className="text-sm text-muted">No stats recorded yet this season.</td></tr>
                    )}
                    {myPlayers.map(({ p, stats }) => {
                      const line = nerdyLine(p.position, stats);
                      return (
                        <tr key={p.id}>
                          <td>
                            <Link href={`/league/${league.id}/player/${p.id}`} className="hover:text-accent2 flex items-center gap-2">
                              <span className="font-medium truncate">{p.firstName} {p.lastName}</span>
                            </Link>
                          </td>
                          <td><span className={`font-semibold text-xs ${positionBadgeClass(p.position)}`}>{p.position}</span></td>
                          {line.length === 0 ? (
                            <td colSpan={5} className="text-xs text-muted">—</td>
                          ) : (
                            line.map((m) => (
                              <td key={m.label} className="text-sm">
                                <span className="text-muted text-xs mr-1.5">{m.label}</span>{m.value}
                              </td>
                            ))
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-5">
            {CATEGORIES.map((cat) => {
              const leaders = [...withStats]
                .filter(({ stats }) => (stats[cat.primary.key] ?? 0) > 0)
                .sort((a, b) => (b.stats[cat.primary.key] ?? 0) - (a.stats[cat.primary.key] ?? 0))
                .slice(0, 10);
              return (
                <div key={cat.title} className="panel overflow-hidden">
                  <div className="px-4 py-3 border-b border-line/70 label-sm">{cat.title}</div>
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
                              <span className="font-medium truncate">{p.firstName} {p.lastName}</span>
                              <span className={`text-xs font-semibold shrink-0 ${positionBadgeClass(p.position)}`}>{p.position}</span>
                            </Link>
                          </td>
                          <td className="stat-value text-stat-sm text-right">{stats[cat.primary.key] ?? 0}</td>
                          {cat.extra.map((c) => <td key={c.key} className="text-muted text-right">{stats[c.key] ?? 0}</td>)}
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
        </>
      )}

      {!myTeam && (
        <div className="panel overflow-hidden">
          <div className="px-4 py-3 border-b border-line/70 label-sm">Team Stats</div>
          <table className="table-clean">
            <thead><tr><th>Team</th><th>Record</th><th>PF</th><th>PA</th><th>Diff</th><th>Off. Yards</th></tr></thead>
            <tbody>
              {teamRows.map(({ t, offYards, diff }) => (
                <tr key={t.id}>
                  <td>
                    <Link href={t.id === userTeam?.id ? `/league/${league.id}/roster` : `/league/${league.id}/history?team=${t.id}#franchise`} className="hover:text-accent2 flex items-center gap-2 font-medium">
                      <TeamLogo seed={t.id} abbr={t.abbr} size={22} /> {t.city} {t.nickname}
                    </Link>
                  </td>
                  <td className="font-mono text-muted">{t.wins}-{t.losses}{t.ties ? `-${t.ties}` : ''}</td>
                  <td className="font-mono">{t.pointsFor}</td>
                  <td className="font-mono text-muted">{t.pointsAgnst}</td>
                  <td className={`stat-value text-stat-sm ${diff >= 0 ? 'text-accent' : 'text-bad'}`}>{diff >= 0 ? '+' : ''}{diff}</td>
                  <td className="font-mono text-muted">{offYards.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
