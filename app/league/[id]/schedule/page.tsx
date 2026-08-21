import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { MatchupCard } from '@/components/ds/MatchupCard';
import { TeamLogo } from '@/components/TeamLogo';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { readJson } from '@/lib/json';
import { BoxScore } from '@/lib/types';
import { computeGameShape } from '@/lib/gameShape';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { GameShapePath } from '@/components/ds/GameShapePath';
import { WeightedScore, MarginTag, ResultRule } from '@/components/ds/ResultWeight';

/**
 * The schedule used to render every week of every game in one flat column —
 * 272 matchups and roughly sixteen thousand pixels of page. Nobody scrolls
 * that. Two things a GM actually wants are separated out: their own season on
 * one line per game, and the league's slate for one chosen week.
 */
export default async function SchedulePage({
  params, searchParams,
}: { params: { id: string }; searchParams: { week?: string } }) {
  const { league, userTeam, phaseLabel } = await getLeagueContext(params.id);
  const games = await prisma.game.findMany({
    where: { leagueId: league.id, seasonYear: league.seasonYear },
    orderBy: [{ week: 'asc' }],
    include: { homeTeam: true, awayTeam: true },
  });

  const weeks = Array.from(new Set(games.map((g) => g.week))).sort((a, b) => a - b);
  const requested = Number(searchParams.week);
  // Default to the week being played, not week 1 — that's the slate the user
  // came to look at. Falls back to the last week that exists once the season
  // has run past the league clock (playoffs, offseason).
  const activeWeek = weeks.includes(requested)
    ? requested
    : weeks.includes(league.week) ? league.week : weeks[weeks.length - 1] ?? 1;

  const weekGames = games.filter((g) => g.week === activeWeek);
  const myGames = userTeam
    ? games.filter((g) => g.homeTeamId === userTeam.id || g.awayTeamId === userTeam.id)
    : [];

  const myPlayed = myGames.filter((g) => g.played);
  const myWins = myPlayed.filter((g) => {
    const mine = g.homeTeamId === userTeam?.id ? g.homeScore : g.awayScore;
    const theirs = g.homeTeamId === userTeam?.id ? g.awayScore : g.homeScore;
    return mine > theirs;
  }).length;
  const myLosses = myPlayed.filter((g) => {
    const mine = g.homeTeamId === userTeam?.id ? g.homeScore : g.awayScore;
    const theirs = g.homeTeamId === userTeam?.id ? g.awayScore : g.homeScore;
    return mine < theirs;
  }).length;

  // Box scores for the user's own played games only — 17 rows, not 272.
  // They carry `drives[]`, which is what the sparkline in the score column is
  // drawn from; nothing else on this page needs them, so nothing else loads
  // them.
  const myPlayedIds = myPlayed.map((g) => g.id);
  const myBoxes = myPlayedIds.length > 0
    ? await prisma.game.findMany({ where: { id: { in: myPlayedIds } }, select: { id: true, boxScore: true } })
    : [];
  const shapeByGame = new Map(
    myBoxes.map((b) => {
      const g = myPlayed.find((x) => x.id === b.id)!;
      const box = readJson<BoxScore>(b.boxScore, null as any);
      return [b.id, computeGameShape(box, g.homeTeamId === userTeam?.id ? 'home' : 'away')] as const;
    }),
  );

  const nextGame = myGames.find((g) => !g.played);
  const nextOpp = nextGame
    ? (nextGame.homeTeamId === userTeam?.id ? nextGame.awayTeam : nextGame.homeTeam)
    : null;

  // Strength of schedule: the mean win percentage of everyone still to play.
  const remaining = myGames.filter((g) => !g.played);
  const sos = remaining.length > 0
    ? remaining.reduce((sum, g) => {
        const opp = g.homeTeamId === userTeam?.id ? g.awayTeam : g.homeTeam;
        const played = Math.max(1, opp.wins + opp.losses + opp.ties);
        return sum + (opp.wins + opp.ties * 0.5) / played;
      }, 0) / remaining.length
    : null;

  return (
    <div className="space-y-6">
      <PageMasthead
        teamId={userTeam?.id}
        teamAbbr={userTeam?.abbr}
        eyebrow={`${league.seasonYear} · ${phaseLabel}`}
        title="Schedule"
        subtitle={userTeam
          ? 'Your season on top, the rest of the league by week below.'
          : 'The league slate, one week at a time.'}
        facts={userTeam ? [
          { label: 'Your Record', value: `${myWins}-${myLosses}`, detail: `${myPlayed.length} of ${myGames.length} played` },
          {
            label: 'Next Up',
            value: nextOpp ? nextOpp.abbr : '—',
            detail: nextGame ? `Week ${nextGame.week} · ${nextGame.homeTeamId === userTeam.id ? 'home' : 'away'}` : 'season complete',
          },
          {
            label: 'Games Left',
            value: String(remaining.length),
            detail: remaining.length > 0 ? 'still to play' : 'none',
          },
          {
            label: 'Remaining SOS',
            value: sos !== null ? sos.toFixed(3).replace(/^0/, '') : '—',
            detail: sos !== null ? (sos > 0.55 ? 'a hard run in' : sos < 0.45 ? 'a soft run in' : 'about average') : 'nothing left',
            color: sos !== null ? (sos > 0.55 ? 'text-bad' : sos < 0.45 ? 'text-accent' : undefined) : undefined,
          },
        ] : []}
      />

      {userTeam && myGames.length > 0 && (
        <div className="section">
          <div className="section-head">
            <h2 className="section-title">{userTeam.city} {userTeam.nickname}</h2>
            <span className="label-sm">{myGames.length} games</span>
          </div>
          <div
            className="panel divide-y divide-line/50"
            style={{ ['--team-accent' as never]: generateTeamLogoParams(userTeam.id).primary }}
          >
            {myGames.map((g) => {
              const home = g.homeTeamId === userTeam.id;
              const opp = home ? g.awayTeam : g.homeTeam;
              const mine = home ? g.homeScore : g.awayScore;
              const theirs = home ? g.awayScore : g.homeScore;
              const won = g.played && mine > theirs;
              const tied = g.played && mine === theirs;
              const isNext = !g.played && g.id === nextGame?.id;
              // For an upcoming game, the opponent's point differential is the
              // most honest one-number preview available here — the win
              // probability model needs team overall ratings, which this page
              // would have to load 32 rosters to compute.
              const oppDiff = opp.pointsFor - opp.pointsAgnst;
              const margin = mine - theirs;
              const shape = shapeByGame.get(g.id) ?? null;

              const row = (
                <div className={`flex items-center gap-3 pr-4 pl-2 py-2 ${isNext ? 'bg-accent/[0.06]' : ''} ${g.played ? '' : 'text-muted'}`}>
                  {/* Adds a channel, takes no space: an accent edge on a rout
                      of yours, a bad-toned one on a beating. Non-decisive
                      results get an invisible spacer of the same width so
                      every row still lines up exactly as before. */}
                  {g.played ? <ResultRule margin={margin} /> : <span aria-hidden className="w-[3px] shrink-0" />}
                  <span className="label-sm w-14 shrink-0">Wk {g.week}</span>
                  <span className="text-[11px] w-7 shrink-0 text-muted">{home ? 'vs' : '@'}</span>
                  <TeamLogo seed={opp.id} abbr={opp.abbr} size={20} />
                  <span className="flex-1 min-w-0 truncate text-sm text-chalk">{opp.city} {opp.nickname}</span>
                  <span className="font-mono text-[11px] text-muted w-14 text-right shrink-0">
                    {opp.wins}-{opp.losses}{opp.ties ? `-${opp.ties}` : ''}
                  </span>
                  {g.played ? (
                    <>
                      {shape && (
                        <span className="hidden sm:block w-[70px] shrink-0" title={`${shape.archetype} — ${shape.note}`}>
                          <GameShapePath shape={shape} width={70} height={22} variant="spark" />
                        </span>
                      )}
                      <span className={`text-[11px] font-bold w-4 shrink-0 ${won ? 'text-accent' : tied ? 'text-muted' : 'text-bad'}`}>
                        {won ? 'W' : tied ? 'T' : 'L'}
                      </span>
                      <MarginTag margin={margin} className="w-9 text-right shrink-0 hidden sm:inline" />
                      <span className="w-20 shrink-0 h-6 flex items-center justify-end">
                        <WeightedScore mine={mine} theirs={theirs} />
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="hidden sm:block w-[70px] shrink-0" />
                      <span className="w-4 shrink-0" />
                      <span className="w-9 shrink-0 hidden sm:inline" />
                      <span className={`w-20 text-right shrink-0 h-6 flex items-center justify-end text-[11px] font-mono ${oppDiff > 0 ? 'text-bad' : oppDiff < 0 ? 'text-accent' : ''}`}>
                        {opp.wins + opp.losses + opp.ties > 0 ? `${oppDiff >= 0 ? '+' : ''}${oppDiff} diff` : 'no games'}
                      </span>
                    </>
                  )}
                </div>
              );

              // Only a played game has a box score to open; an upcoming one
              // would be a link to nothing.
              return g.played
                ? <Link key={g.id} href={`/league/${league.id}/game/${g.id}`} className="block hover:bg-raised/40 transition-colors">{row}</Link>
                : <div key={g.id}>{row}</div>;
            })}
          </div>
        </div>
      )}

      {weeks.length > 0 && (
        <div className="section">
          <div className="section-head">
            <h2 className="section-title">Around The League</h2>
            <span className="label-sm">{weekGames.length} games · week {activeWeek}</span>
          </div>

          {/* One week at a time. Rendering all seventeen produced a page
              roughly sixteen thousand pixels tall that nobody scrolled. */}
          <div className="flex flex-wrap gap-1.5">
            {weeks.map((w) => {
              const label = games.find((g) => g.week === w)?.kind;
              return (
                <Link
                  key={w}
                  href={`/league/${league.id}/schedule?week=${w}`}
                  scroll={false}
                  className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                    w === activeWeek
                      ? 'bg-accent text-ink'
                      : w === league.week
                        ? 'bg-raised text-accent border border-accent/40'
                        : 'bg-raised text-muted hover:text-chalk border border-line'
                  }`}
                  title={label && label !== 'REGULAR' ? label : `Week ${w}`}
                >
                  {label && label !== 'REGULAR' ? label.slice(0, 4) : w}
                </Link>
              );
            })}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {weekGames.map((g) => (
              <Link
                key={g.id}
                href={g.played ? `/league/${league.id}/game/${g.id}` : '#'}
                className={g.played ? 'hover:opacity-90 transition-opacity' : 'opacity-70 pointer-events-none'}
              >
                <MatchupCard
                  away={{ teamId: g.awayTeam.id, abbr: g.awayTeam.abbr, city: g.awayTeam.city, wins: g.awayTeam.wins, losses: g.awayTeam.losses, ties: g.awayTeam.ties }}
                  home={{ teamId: g.homeTeam.id, abbr: g.homeTeam.abbr, city: g.homeTeam.city, wins: g.homeTeam.wins, losses: g.homeTeam.losses, ties: g.homeTeam.ties }}
                  weekLabel={g.played ? 'Final' : 'Upcoming'}
                  score={g.played ? { away: g.awayScore, home: g.homeScore } : undefined}
                />
                {/* Margin, under the card rather than inside it — the card is
                    shared with the dashboard and is not this change's to
                    restyle. Computed from the two scores already on the row. */}
                {g.played && (
                  <div className="flex items-center justify-center gap-2 pt-1.5">
                    <MarginTag margin={Math.abs(g.homeScore - g.awayScore)} />
                    <span className="text-[10px] text-muted uppercase tracking-wider">
                      {Math.abs(g.homeScore - g.awayScore) === 0 ? 'tie'
                        : Math.abs(g.homeScore - g.awayScore) <= 8 ? 'one score'
                        : Math.abs(g.homeScore - g.awayScore) >= 28 ? 'decisive' : 'margin'}
                    </span>
                  </div>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {games.length === 0 && <p className="text-sm text-muted">No games scheduled yet.</p>}
    </div>
  );
}
