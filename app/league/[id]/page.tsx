import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { teamCapSummary } from '@/lib/cap-summary';
import { formatMoney } from '@/lib/cap';
import { readJson } from '@/lib/json';
import { shortResult } from '@/lib/sim/recap';
import { teamNeeds, needSeverity } from '@/lib/ai/gm';
import { buildFrontOfficeBrief } from '@/lib/frontOffice';
import { buildGmCareerSummary } from '@/lib/gmCareer';
import { estimateWinProbability } from '@/lib/winProbability';
import { transactionCategory } from '@/lib/newsCategory';
import { computeClinchStatus, clinchScenarioTag } from '@/lib/clinchScenario';
import { computeRankDeltas } from '@/lib/standingsTrend';
import { SeasonAnnouncement, AwardLine } from '@/components/SeasonAnnouncement';
import { OffseasonRoadmap } from '@/components/OffseasonRoadmap';
import { TeamHeader } from '@/components/ds/TeamHeader';
import { FrontOfficeBrief } from '@/components/ds/FrontOfficeBrief';
import { RosterNeeds } from '@/components/ds/RosterNeeds';
import { NewsRow, NewsCategory } from '@/components/ds/NewsRow';
import { StandingsTable } from '@/components/ds/StandingsTable';
import { SectionHeading } from '@/components/ds/SectionHeading';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';

const AWARD_TYPES: { type: string; code: string; label: string }[] = [
  { type: 'AWARD_MVP', code: 'MVP', label: 'MVP' },
  { type: 'AWARD_OPOY', code: 'OPOY', label: 'Offensive Player of the Year' },
  { type: 'AWARD_DPOY', code: 'DPOY', label: 'Defensive Player of the Year' },
  { type: 'AWARD_ROTY', code: 'ROTY', label: 'Rookie of the Year' },
  { type: 'AWARD_SBMVP', code: 'SB MVP', label: 'Championship MVP' },
];

const ORDINAL = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export default async function TeamDashboard({ params }: { params: { id: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

  const [roster, upcomingGames, recentGames, picks, transactions, divisionTeams, conferenceTeams] = await Promise.all([
    prisma.player.findMany({ where: { teamId: team.id }, orderBy: { trueOvr: 'desc' } }),
    prisma.game.findMany({ where: { leagueId: league.id, OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }], played: false }, orderBy: { week: 'asc' }, take: 1, include: { homeTeam: true, awayTeam: true } }),
    prisma.game.findMany({ where: { leagueId: league.id, OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }], played: true }, orderBy: { week: 'desc' }, take: 3, include: { homeTeam: true, awayTeam: true } }),
    prisma.draftPick.count({ where: { ownerTeamId: team.id, used: false } }),
    prisma.transaction.findMany({ where: { leagueId: league.id, OR: [{ teamId: team.id }, { teamId: null }] }, orderBy: { createdAt: 'desc' }, take: 6 }),
    prisma.team.findMany({ where: { leagueId: league.id, conference: team.conference, division: team.division } }),
    // Only the clinch-scenario math needs the full conference (wildcard
    // race spans every division) — the standings panel itself stays
    // division-only.
    league.phase === 'REGULAR'
      ? prisma.team.findMany({ where: { leagueId: league.id, conference: team.conference }, select: { id: true, division: true, wins: true, losses: true, ties: true, pointsFor: true, pointsAgnst: true } })
      : Promise.resolve([]),
  ]);

  // --- Season announcement (unchanged from the prior page — a proactive
  // "you just won the league" moment, not part of this visual pass) --------
  let seasonAnnouncement: { championName: string; championTeamId: string; championAbbr: string; awards: AwardLine[] } | null = null;
  if (league.phase === 'OFFSEASON') {
    const [championTx, awardTxs] = await Promise.all([
      prisma.transaction.findFirst({ where: { leagueId: league.id, seasonYear: league.seasonYear, type: 'CHAMPION' } }),
      prisma.transaction.findMany({ where: { leagueId: league.id, seasonYear: league.seasonYear, type: { in: AWARD_TYPES.map((a) => a.type) } } }),
    ]);
    if (championTx?.teamId) {
      const awardTeamIds = Array.from(new Set(awardTxs.map((t) => t.teamId).filter(Boolean))) as string[];
      const [champTeam, awardTeams] = await Promise.all([
        prisma.team.findUnique({ where: { id: championTx.teamId } }),
        prisma.team.findMany({ where: { id: { in: awardTeamIds } } }),
      ]);
      const teamById = new Map(awardTeams.map((t) => [t.id, t]));
      if (champTeam) {
        seasonAnnouncement = {
          championName: `${champTeam.city} ${champTeam.nickname}`,
          championTeamId: champTeam.id,
          championAbbr: champTeam.abbr,
          awards: awardTxs.map((t) => {
            const meta = AWARD_TYPES.find((a) => a.type === t.type)!;
            return { code: meta.code, label: meta.label, name: t.headline.replace(/\s*\([^)]+\)\s*$/, ''), teamAbbr: t.teamId ? (teamById.get(t.teamId)?.abbr ?? 'FA') : 'FA', detail: t.detail };
          }),
        };
      }
    }
  }
  const userSeasonRecord = seasonAnnouncement ? await prisma.teamSeasonRecord.findUnique({ where: { teamId_year: { teamId: team.id, year: league.seasonYear } } }) : null;

  const expiringCount = league.phase === 'RESIGN'
    ? await prisma.player.count({ where: { teamId: team.id, status: 'ACTIVE', contract: { yearsRemaining: 0 } } })
    : 0;

  const cap = settings.capMode === 'OFF' ? null : await teamCapSummary(team.id, league.seasonYear, settings.capMode);
  const brief = await buildFrontOfficeBrief(league.id, team.id, league.seasonYear, settings.capMode);
  const overall = Math.round(roster.reduce((s, p) => s + p.trueOvr, 0) / Math.max(1, roster.length));
  const needs = teamNeeds(roster.map((p) => ({ id: p.id, position: p.position, trueOvr: p.trueOvr, age: p.age, potential: p.potential })));
  const topNeeds = Object.entries(needs).sort((a, b) => b[1] - a[1]).slice(0, 5).filter(([, v]) => v > 0.1);
  const injured = roster.filter((p) => p.injuryWeeks > 0);
  const next = upcomingGames[0];
  const tenure = await buildGmCareerSummary(league.id, team, league.seasonYear);
  const teamColor = generateTeamLogoParams(team.id).primary;

  // --- Next matchup + a display-only win probability read (see lib/winProbability.ts) ---
  let nextGame: { teamId: string; abbr: string; city: string; wins: number; losses: number; winProb: number; home: boolean } | undefined;
  if (next) {
    const oppTeam = next.homeTeamId === team.id ? next.awayTeam : next.homeTeam;
    const oppRoster = await prisma.player.findMany({ where: { teamId: oppTeam.id }, select: { trueOvr: true } });
    const oppOverall = Math.round(oppRoster.reduce((s, p) => s + p.trueOvr, 0) / Math.max(1, oppRoster.length));
    const winProb = estimateWinProbability({
      myOverall: overall, oppOverall,
      myWins: team.wins, myLosses: team.losses, oppWins: oppTeam.wins, oppLosses: oppTeam.losses,
    });
    nextGame = { teamId: oppTeam.id, abbr: oppTeam.abbr, city: oppTeam.city, wins: oppTeam.wins, losses: oppTeam.losses, winProb, home: next.homeTeamId === team.id };
  }

  // --- Division standings + a real "last five" form guide (existing Game
  // results only — no new tracked state) --------------------------------
  const divisionSorted = [...divisionTeams].sort((a, b) => {
    const pctA = (a.wins + a.ties * 0.5) / Math.max(1, a.wins + a.losses + a.ties);
    const pctB = (b.wins + b.ties * 0.5) / Math.max(1, b.wins + b.losses + b.ties);
    return pctB - pctA;
  });
  const divisionRank = divisionSorted.findIndex((t) => t.id === team.id) + 1;
  const lastFiveByTeam = await Promise.all(divisionSorted.map(async (t) => {
    const games = await prisma.game.findMany({
      where: { leagueId: league.id, OR: [{ homeTeamId: t.id }, { awayTeamId: t.id }], played: true },
      orderBy: { week: 'desc' }, take: 5, select: { homeTeamId: true, homeScore: true, awayScore: true },
    });
    const results = games.reverse().map((g): 'W' | 'L' | 'T' => {
      const my = g.homeTeamId === t.id ? g.homeScore : g.awayScore;
      const opp = g.homeTeamId === t.id ? g.awayScore : g.homeScore;
      return my === opp ? 'T' : my > opp ? 'W' : 'L';
    });
    return { teamId: t.id, results };
  }));
  const lastFiveMap = new Map(lastFiveByTeam.map((r) => [r.teamId, r.results]));
  const rankDeltas = await computeRankDeltas(league.id, divisionSorted);

  // --- Clinch scenario — real mathematical clinch/elimination, computed by
  // running the same seeding algorithm lib/season.ts uses (see
  // lib/clinchScenario.ts). Only meaningful mid-season. ---------------------
  const scenarioTag = league.phase === 'REGULAR' && conferenceTeams.length > 0
    ? clinchScenarioTag(computeClinchStatus(team.id, conferenceTeams))
    : null;

  // --- League Wire — real transactions and real recent-game recaps,
  // combined and sorted by recency. No new schema; both already existed.
  // A transaction's team can be anyone in the league, not just this
  // division, so resolve abbrs from exactly the teams referenced here. ---
  const txTeamIds = Array.from(new Set(transactions.map((t) => t.teamId).filter((id): id is string => !!id)));
  const wireTeams = txTeamIds.length > 0
    ? await prisma.team.findMany({ where: { id: { in: txTeamIds } }, select: { id: true, abbr: true } })
    : [];
  const wireTeamAbbr = new Map(wireTeams.map((t) => [t.id, t.abbr]));

  interface WireEntry { key: string; seasonYear: number; week: number; render: (featured: boolean) => React.ReactNode }
  const wireFromTx: WireEntry[] = transactions.map((t) => ({
    key: t.id, seasonYear: t.seasonYear, week: t.week,
    render: (featured) => (
      <NewsRow
        key={t.id} featured={featured}
        category={transactionCategory(t.type, t.headline) as NewsCategory}
        teamId={t.teamId ?? undefined} abbr={t.teamId ? wireTeamAbbr.get(t.teamId) : undefined}
        headline={t.headline} detail={t.detail || undefined} meta={`WK ${t.week}`}
      />
    ),
  }));
  const wireFromGames: WireEntry[] = recentGames.map((g) => {
    const box = readJson<any>(g.boxScore, null);
    const oppTeam = g.homeTeamId === team.id ? g.awayTeam : g.homeTeam;
    const won = (g.homeTeamId === team.id ? g.homeScore : g.awayScore) > (g.homeTeamId === team.id ? g.awayScore : g.homeScore);
    return {
      key: g.id, seasonYear: league.seasonYear, week: g.week,
      render: (featured) => (
        <NewsRow
          key={g.id} featured={featured}
          category="GAME"
          teamId={team.id} abbr={team.abbr}
          headline={`${team.city} ${won ? 'beat' : 'lost to'} ${oppTeam.city}`}
          detail={g.recap || undefined}
          meta={`WK ${g.week}`}
          metric={box ? shortResult(box) : `${g.homeScore}-${g.awayScore}`}
        />
      ),
    };
  });
  // Games first so a real result outranks same-week trivia news on a tie —
  // "what happened last week" belongs above "who's pacing the league."
  const wire = [...wireFromGames, ...wireFromTx]
    .sort((a, b) => b.seasonYear - a.seasonYear || b.week - a.week)
    .slice(0, 6)
    .map((w, i) => w.render(i === 0));

  return (
    <div className="space-y-8">
      {seasonAnnouncement && (
        <SeasonAnnouncement
          leagueId={league.id}
          seasonYear={league.seasonYear}
          championName={seasonAnnouncement.championName}
          championTeamId={seasonAnnouncement.championTeamId}
          championAbbr={seasonAnnouncement.championAbbr}
          isUserChampion={seasonAnnouncement.championTeamId === team.id}
          userTeamId={team.id}
          userTeamName={`${team.city} ${team.nickname}`}
          userRecord={`${userSeasonRecord?.wins ?? team.wins}-${userSeasonRecord?.losses ?? team.losses}${(userSeasonRecord?.ties ?? team.ties) ? `-${userSeasonRecord?.ties ?? team.ties}` : ''}`}
          userResult={userSeasonRecord?.playoffResult ?? 'MISSED'}
          awards={seasonAnnouncement.awards}
        />
      )}
      <OffseasonRoadmap currentPhase={league.phase} />
      {league.phase === 'RESIGN' && (
        <Link href={`/league/${league.id}/resign`} className="card card-pad flex items-center justify-between gap-4 border-warn/40 hover:bg-raised transition-colors">
          <div>
            <div className="text-xs text-warn uppercase tracking-wider mb-1">Re-sign Window Open</div>
            <div className="font-semibold">
              {expiringCount > 0 ? `${expiringCount} player${expiringCount === 1 ? '' : 's'} on your roster ${expiringCount === 1 ? 'is' : 'are'} about to hit free agency.` : 'No expiring contracts this offseason.'}
            </div>
          </div>
          <span className="text-xs text-accent2">Go to Re-sign →</span>
        </Link>
      )}

      <div style={{ ['--team-accent' as never]: teamColor }}>
        <TeamHeader
          teamId={team.id} abbr={team.abbr} city={team.city} nickname={team.nickname}
          wins={team.wins} losses={team.losses} ties={team.ties}
          standing={`${ORDINAL(divisionRank)} · ${team.conference} ${team.division}`}
          tenureLabel={tenure.tenureYears <= 1 ? 'Your first season' : `Year ${tenure.tenureYears} of your tenure`}
          scenarioTag={scenarioTag ?? undefined}
          stats={[
            cap
              ? { value: formatMoney(cap.capSpace), label: 'Cap Space', color: cap.capSpace >= 0 ? 'text-accent' : 'text-bad' }
              : { value: 'Off', label: 'Cap Space' },
            { value: `${roster.length}${injured.length ? ` (${injured.length} inj)` : ''}`, label: 'Roster' },
            { value: `${picks}`, label: 'Picks Owned' },
          ]}
          nextGame={nextGame}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {brief.length > 0 && (
            <div className="section">
              <FrontOfficeBrief items={brief.map((b) => ({ ...b, href: `/league/${league.id}${b.href}` }))} weekLabel={`Week ${league.week}`} />
            </div>
          )}

          <div className="section">
            <SectionHeading title="League Wire" action={<Link href={`/league/${league.id}/news`} className="text-xs text-accent2 hover:underline">View all →</Link>} />
            <div className="panel px-4 divide-y divide-line/60">
              {wire.length > 0 ? wire : <p className="text-sm text-muted py-3">No news yet.</p>}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="section">
            <SectionHeading title="Roster Needs" action={<Link href={`/league/${league.id}/free-agency`} className="text-xs text-accent2 hover:underline">Browse →</Link>} />
            <div className="panel p-4">
              {topNeeds.length === 0 ? (
                <p className="text-sm text-muted">No glaring holes right now — nice work.</p>
              ) : (
                <RosterNeeds needs={topNeeds.map(([pos, val]) => ({ position: pos, value: val, ...needSeverity(val) }))} />
              )}
            </div>
          </div>

          <div className="section">
            <SectionHeading title={`${team.conference} ${team.division}`} />
            <StandingsTable
              label="Standings"
              rows={divisionSorted.map((t) => ({
                teamId: t.id, abbr: t.abbr, city: t.city, wins: t.wins, losses: t.losses, ties: t.ties,
                isUser: t.id === team.id, lastFive: lastFiveMap.get(t.id), delta: rankDeltas.get(t.id),
              }))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
