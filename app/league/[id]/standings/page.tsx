import Link from 'next/link';
import { getLeagueContext } from '@/lib/league-data';
import { TeamLogo } from '@/components/TeamLogo';
import { computeRankDeltas } from '@/lib/standingsTrend';
import { buildStandingsBoard, StandingsRow } from '@/lib/standingsBoard';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { prisma } from '@/lib/db';
import { PlayoffBracket, BracketGame } from '@/components/ds/PlayoffBracket';
import { LEAGUE } from '@/lib/tuning';
import { buildPowerRankings, ensurePowerSnapshot, PowerRow } from '@/lib/powerRankings';
import { PowerRankingsCapsule } from '@/components/ds/PowerRankingsTable';
import { tip } from '@/lib/glossary';

/**
 * A team's own roster page only ever shows the user's team, so linking all 32
 * rows there sent 31 of them somewhere misleading. Franchise history is the
 * one screen that renders any team in the league, so that's where a rival's
 * name goes; the user's own row still leads to their roster.
 */
function teamHref(leagueId: string, t: StandingsRow): string {
  return t.isUser ? `/league/${leagueId}/roster` : `/league/${leagueId}/history?team=${t.id}#franchise`;
}

function TeamCell({ leagueId, t }: { leagueId: string; t: StandingsRow }) {
  return (
    <Link href={teamHref(leagueId, t)} className="flex items-center gap-2 hover:text-accent2 min-w-0">
      <TeamLogo seed={t.id} abbr={t.abbr} size={22} />
      <span className={`truncate ${t.isUser ? 'font-semibold' : ''}`}>{t.city} {t.nickname}</span>
      {t.isUser && <span className="pill border-accent/40 text-accent text-[10px] shrink-0">You</span>}
    </Link>
  );
}

/**
 * Team strength beside the record — the half of the ask this column answers
 * directly. The figure is buildLeagueRatings()'s overall with
 * buildLeagueRatings()'s rank, the same pair the dashboard hero and the
 * handover screen print, never a second opinion computed here.
 *
 * The power rank is deliberately NOT a second column in here. Ten columns did
 * not fit the two-up division panels — the last one was being clipped at the
 * panel edge, which is worse than not showing it — and the capsule above the
 * tables already carries the ranking, with the whole 32 one click away. The
 * cell links there.
 */
function StrengthCells({ leagueId, row }: { leagueId: string; row: PowerRow | undefined }) {
  if (!row) return <td className="text-right px-1.5 hidden sm:table-cell text-muted">—</td>;
  return (
    <td className="text-right px-1.5 hidden sm:table-cell whitespace-nowrap">
      <Link
        href={`/league/${leagueId}/power-rankings`}
        className="hover:text-accent2"
        title={`${row.rating} overall, ${row.ratingRank} of 32 — ${row.rank}th in this week's power ranking`}
      >
        <span className="stat-value text-stat-sm">{row.rating}</span>
        <span className="text-[10px] text-muted ml-1">#{row.ratingRank}</span>
      </Link>
    </td>
  );
}

function StreakChip({ streak }: { streak: string | null }) {
  if (!streak) return <span className="text-muted">—</span>;
  const hot = streak.startsWith('W') && Number(streak.slice(1)) >= 2;
  const cold = streak.startsWith('L') && Number(streak.slice(1)) >= 2;
  return (
    <span className={`font-mono text-xs ${hot ? 'text-accent' : cold ? 'text-bad' : 'text-muted'}`}>{streak}</span>
  );
}

export default async function StandingsPage({ params }: { params: { id: string } }) {
  const { league, phaseLabel } = await getLeagueContext(params.id);

  // Rank movement only means anything once games have been played.
  const board = await buildStandingsBoard(league.id, { withStreaks: true });
  const allTeams = board.flatMap((c) => c.divisions.flatMap((d) => d.teams));

  // The other half of "who is actually good". The standings say who is
  // winning; these columns say how good the roster is and where the weekly
  // ranking puts them, and the distance between the two is the most
  // interesting thing on the page — a 5-2 club sitting 14th in the power
  // ranking is a story the record column cannot tell.
  const power = await buildPowerRankings(league.id);
  await ensurePowerSnapshot(league.id, { board: power, league }).catch(() => {});
  const powerByTeam = new Map<string, PowerRow>(power.rows.map((r) => [r.teamId, r]));

  const deltas = league.phase === 'REGULAR'
    ? new Map(
        (await Promise.all(
          board.flatMap((c) => c.divisions).map(async (d) => Array.from((await computeRankDeltas(league.id, d.teams)).entries())),
        )).flat(),
      )
    : new Map<string, number>();

  // The postseason had no interface at all beyond "#1"-"#6" tags on the table
  // below, and the header reads "Wk 1" for all four rounds — so a player could
  // not tell which round was being played, let alone see the bracket.
  const playoffGames = await prisma.game.findMany({
    where: { leagueId: league.id, seasonYear: league.seasonYear, kind: { not: 'REGULAR' } },
    include: { homeTeam: true, awayTeam: true },
    orderBy: { week: 'asc' },
  });
  const seedOf = new Map(allTeams.map((t) => [t.id, t.seed]));
  const bracket: BracketGame[] = playoffGames.map((g) => {
    const homeWon = g.played && g.homeScore > g.awayScore;
    const awayWon = g.played && g.awayScore > g.homeScore;
    return {
      id: g.id,
      kind: g.kind,
      played: g.played,
      home: {
        teamId: g.homeTeam.id, abbr: g.homeTeam.abbr, city: g.homeTeam.city,
        seed: seedOf.get(g.homeTeam.id) ?? null, score: g.played ? g.homeScore : null,
        isUser: g.homeTeam.isUser, won: homeWon,
      },
      away: {
        teamId: g.awayTeam.id, abbr: g.awayTeam.abbr, city: g.awayTeam.city,
        seed: seedOf.get(g.awayTeam.id) ?? null, score: g.played ? g.awayScore : null,
        isUser: g.awayTeam.isUser, won: awayWon,
      },
    };
  });

  const userRow = allTeams.find((t) => t.isUser);
  const userConf = board.find((c) => c.conference === userRow?.conference);
  const playedWeeks = userRow ? userRow.wins + userRow.losses + userRow.ties : 0;
  const seedsPerConf = LEAGUE.PLAYOFF_TEAMS_PER_CONF;

  const facts = userRow
    ? [
        { label: 'Your Record', value: `${userRow.wins}-${userRow.losses}${userRow.ties ? `-${userRow.ties}` : ''}`, detail: `${(userRow.pct * 100).toFixed(0)}% · week ${Math.min(playedWeeks + 1, LEAGUE.REGULAR_SEASON_WEEKS)}` },
        {
          label: 'Playoff Position',
          tip: tip('divisionSeeding'),
          value: userRow.seed ? `#${userRow.seed} seed` : 'Outside',
          detail: userRow.seed ? (userRow.divisionLeader ? 'Leading the division' : 'Wild card') : `${userRow.gamesBack.toFixed(1)} games back`,
          color: userRow.seed ? 'text-accent' : 'text-bad',
        },
        { label: 'Point Diff', value: `${userRow.diff >= 0 ? '+' : ''}${userRow.diff}`, detail: `${userRow.pointsFor} for · ${userRow.pointsAgnst} against`, tip: tip('pointDifferential'), color: userRow.diff >= 0 ? 'text-accent' : 'text-bad' },
        { label: 'Division', value: `${userRow.divWins}-${userRow.divLosses}`, detail: `${userRow.conference} ${userRow.division}` },
        { label: 'Streak', value: userRow.streak ?? '—', detail: 'Last decided games' },
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageMasthead
        teamId={userRow?.id}
        teamAbbr={userRow?.abbr}
        eyebrow={`${league.seasonYear} · ${phaseLabel}`}
        title="Standings"
        subtitle={`Division winners are seeded above every wild card, so a division lead is worth more than a better record. Top ${seedsPerConf} per conference make the field; the top two get a bye.`}
        facts={facts}
      />

      {/* Once the bracket exists it replaces the projection — a projected
          field is only interesting while the field is still undecided. */}
      {bracket.length > 0 && (
        <PlayoffBracket leagueId={league.id} games={bracket} seasonYear={league.seasonYear} />
      )}

      {bracket.length === 0 && userConf && (userConf.inField.length > 0 || userConf.inHunt.length > 0) && (
        <PlayoffPicture leagueId={league.id} conf={userConf} />
      )}

      <PowerRankingsCapsule leagueId={league.id} board={power} />

      {board.map((conf) => (
        <div key={conf.conference} className="section">
          <div className="section-head">
            <h2 className="section-title text-base">{conf.conference}</h2>
            <span className="label-sm">{conf.divisions.length} divisions</span>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {conf.divisions.map((d) => (
              <div key={`${d.conference}-${d.division}`} className="panel overflow-hidden">
                <div className="px-4 py-2.5 border-b border-line/70 flex items-center justify-between">
                  <span className="label-sm">{d.conference} {d.division}</span>
                  <span className="text-[11px] text-muted">{d.teams[0]?.abbr} leads</span>
                </div>
                <table className="table-clean">
                  <thead>
                    <tr>
                      <th className="w-7 px-1.5"></th><th className="w-full">Team</th>
                      <th className="text-right w-8 px-1.5">W</th><th className="text-right w-8 px-1.5">L</th>
                      <th className="text-right w-8 px-1.5">T</th><th className="text-right w-12 px-1.5">PCT</th>
                      <th className="text-right w-12 px-1.5">DIFF</th><th className="text-right w-10 px-1.5">STRK</th>
                      <th className="text-right w-14 px-1.5 hidden sm:table-cell" title="Team rating from the roster, with its rank across the league">OVR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.teams.map((t) => {
                      const delta = deltas.get(t.id);
                      return (
                        <tr key={t.id} className={t.isUser ? 'bg-accent/[0.06]' : ''}>
                          <td className="w-7 px-1.5">
                            {t.seed ? (
                              <span
                                className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${
                                  t.divisionLeader ? 'bg-accent/20 text-accent' : 'bg-accent2/15 text-accent2'
                                }`}
                                title={t.divisionLeader ? `Division leader — #${t.seed} seed` : `Wild card — #${t.seed} seed`}
                              >
                                {t.seed}
                              </span>
                            ) : (
                              <span className="text-[10px] text-muted/60">—</span>
                            )}
                          </td>
                          <td>
                            <span className="flex items-center gap-2">
                              <TeamCell leagueId={league.id} t={t} />
                              {delta ? (
                                <span className={`text-[10px] font-mono shrink-0 ${delta > 0 ? 'text-accent' : 'text-bad'}`}>
                                  {delta > 0 ? '▲' : '▼'}{Math.abs(delta)}
                                </span>
                              ) : null}
                            </span>
                          </td>
                          <td className="stat-value text-stat-sm text-right px-1.5">{t.wins}</td>
                          <td className="stat-value text-stat-sm text-right text-muted px-1.5">{t.losses}</td>
                          <td className="stat-value text-stat-sm text-right text-muted px-1.5">{t.ties}</td>
                          <td className="font-mono text-xs text-right px-1.5">{t.pct.toFixed(3).replace(/^0/, '')}</td>
                          <td className={`font-mono text-xs text-right px-1.5 ${t.diff > 0 ? 'text-accent' : t.diff < 0 ? 'text-bad' : 'text-muted'}`}>
                            {t.diff >= 0 ? '+' : ''}{t.diff}
                          </td>
                          <td className="text-right px-1.5"><StreakChip streak={t.streak} /></td>
                          <StrengthCells leagueId={league.id} row={powerByTeam.get(t.id)} />
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The bracket as it stands right now for the user's own conference — seeds in
 * order with the bye line and the cut line drawn in, then the teams close
 * enough to still take someone's spot. This is the screen a GM checks in
 * week 14, so it goes above the division tables rather than below them.
 */
function PlayoffPicture({ leagueId, conf }: { leagueId: string; conf: Awaited<ReturnType<typeof buildStandingsBoard>>[number] }) {
  const byes = 2;
  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-line/70 flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="label-sm">{conf.conference} Playoff Picture</div>
          <div className="text-xs text-muted mt-0.5">Projected from today's records using the same seeding rules the season finale runs.</div>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-gold/50" />Bye</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-accent/40" />Division</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-accent2/30" />Wild card</span>
        </div>
      </div>
      <div className="divide-y divide-line/50">
        {conf.inField.map((t, i) => (
          <div
            key={t.id}
            className={`flex items-center gap-3 px-4 py-2 ${t.isUser ? 'bg-accent/[0.06]' : ''} ${i < byes ? 'bg-gold/[0.04]' : ''}`}
          >
            <span className={`stat-value text-stat-sm w-7 shrink-0 ${i < byes ? 'text-gold' : t.divisionLeader ? 'text-accent' : 'text-accent2'}`}>
              {t.seed}
            </span>
            <div className="flex-1 min-w-0"><TeamCell leagueId={leagueId} t={t} /></div>
            <span className="font-mono text-xs text-muted shrink-0">
              {t.wins}-{t.losses}{t.ties ? `-${t.ties}` : ''}
            </span>
            <span className="text-[11px] text-muted w-24 text-right shrink-0 hidden sm:block">
              {i < byes ? 'First-round bye' : t.divisionLeader ? `${t.division} leader` : 'Wild card'}
            </span>
            <span className="w-10 text-right shrink-0"><StreakChip streak={t.streak} /></span>
          </div>
        ))}
        {conf.inHunt.length > 0 && (
          <>
            <div className="px-4 py-1.5 bg-ink/40 text-[10px] uppercase tracking-widest text-bad/70 font-semibold">
              Cut line
            </div>
            {conf.inHunt.map((t) => (
              <div key={t.id} className={`flex items-center gap-3 px-4 py-2 opacity-70 ${t.isUser ? 'bg-accent/[0.06] opacity-100' : ''}`}>
                <span className="w-7 shrink-0 text-center text-[10px] text-muted">—</span>
                <div className="flex-1 min-w-0"><TeamCell leagueId={leagueId} t={t} /></div>
                <span className="font-mono text-xs text-muted shrink-0">
                  {t.wins}-{t.losses}{t.ties ? `-${t.ties}` : ''}
                </span>
                <span className="text-[11px] text-muted w-24 text-right shrink-0 hidden sm:block">
                  {t.gamesBack > 0 ? `${t.gamesBack.toFixed(1)} GB` : 'Tied'}
                </span>
                <span className="w-10 text-right shrink-0"><StreakChip streak={t.streak} /></span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
