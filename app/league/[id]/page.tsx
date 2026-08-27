import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { loadRebuildStanding } from '@/lib/rebuildState';
import { teamCapSummary } from '@/lib/cap-summary';
import { formatMoney } from '@/lib/cap';
import { readJson } from '@/lib/json';
import { shortResult } from '@/lib/sim/recap';
import { teamNeeds, needSeverity } from '@/lib/ai/gm';
import { startersAt } from '@/lib/lineup';
import { buildFrontOfficeBrief } from '@/lib/frontOffice';
import { buildGmCareerSummary } from '@/lib/gmCareer';
import { buildLeagueRatings, estimateGameWinChance } from '@/lib/teamRating';
import { buildPowerRankings } from '@/lib/powerRankings';
import { transactionCategory } from '@/lib/newsCategory';
import { rankWire } from '@/lib/wireRank';
import { computeClinchStatus, clinchScenarioTag } from '@/lib/clinchScenario';
import { computeRankDeltas } from '@/lib/standingsTrend';
import { SeasonAnnouncement, AwardLine } from '@/components/SeasonAnnouncement';
import { SeasonReview } from '@/components/ds/SeasonReview';
import { buildSeasonReview } from '@/lib/seasonReview';
import { OffseasonRoadmap } from '@/components/OffseasonRoadmap';
import { TeamHeader } from '@/components/ds/TeamHeader';
import { FrontOfficeBrief } from '@/components/ds/FrontOfficeBrief';
import { RosterNeeds } from '@/components/ds/RosterNeeds';
import { NewsRow, NewsCategory } from '@/components/ds/NewsRow';
import { StandingsTable } from '@/components/ds/StandingsTable';
import { SectionHeading } from '@/components/ds/SectionHeading';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { generateStorylines } from '@/lib/storyline';
import { StorylineFeed } from '@/components/ds/StorylineFeed';
import { InjuryReport, InjuryEntry } from '@/components/ds/InjuryReport';
import { TeamLeaders, LeaderEntry } from '@/components/ds/TeamLeaders';
import { SeasonStats } from '@/lib/types';
import { AllStarHonorRoll, AllStarHonor } from '@/components/ds/AllStarHonorRoll';
import { ALL_STAR_TYPE, allStarSnubFor } from '@/lib/allStars';
import { tip } from '@/lib/glossary';
import { AWARD_TYPES, AWARD_LABEL, AWARD_CODE } from '@/lib/awardTypes';

/**
 * The season's trophies, in announcement order, built off the one shared list
 * in lib/awardTypes.ts rather than a fourth hand-written copy of it. Retired
 * types are included deliberately: this reads a REAL season's rows, and a
 * save part-played before the rookie award was split still has an
 * 'AWARD_ROTY' row to announce.
 */
const AWARD_META: { type: string; code: string; label: string }[] =
  AWARD_TYPES.map((type) => ({ type, code: AWARD_CODE[type], label: AWARD_LABEL[type] }));

const ORDINAL = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export default async function TeamDashboard({ params }: { params: { id: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  // Where this save stands in the Rebuild state machine. Cheap on every other
  // save — loadRebuildStanding reads the league once and returns before it
  // touches history unless `leagueStart` is REBUILD.
  const rebuildStanding = await loadRebuildStanding(params.id);
  const team = userTeam!;

  const [roster, upcomingGames, recentGames, picks, transactions, divisionTeams, conferenceTeams] = await Promise.all([
    prisma.player.findMany({ where: { teamId: team.id }, orderBy: { trueOvr: 'desc' } }),
    prisma.game.findMany({ where: { leagueId: league.id, OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }], played: false }, orderBy: { week: 'asc' }, take: 1, include: { homeTeam: true, awayTeam: true } }),
    prisma.game.findMany({ where: { leagueId: league.id, OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }], played: true }, orderBy: { week: 'desc' }, take: 3, include: { homeTeam: true, awayTeam: true } }),
    prisma.draftPick.count({ where: { ownerTeamId: team.id, used: false } }),
    // Deliberately wide: the wire is RANKED, not taken by recency (see
    // lib/wireRank.ts). Fetching six most-recent rows and ranking them
    // would rank six injury reports against each other. 90% of this pool is
    // injuries, so the window has to be wide enough to reach real news.
    // seasonYear floor: league creation seeds ~two decades of fictional
    // backstory (a champion and five awards per year), all written at
    // creation time, so `createdAt desc` put every one of them ahead of
    // anything that has happened in the save. Ranking cannot recover from
    // that on its own — createdAt is honest about when the row was written
    // and silent about when the event happened.
    prisma.transaction.findMany({
      where: {
        leagueId: league.id,
        OR: [{ teamId: team.id }, { teamId: null }],
        seasonYear: { gte: league.seasonYear - 1 },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    prisma.team.findMany({ where: { leagueId: league.id, conference: team.conference, division: team.division } }),
    // Only the clinch-scenario math needs the full conference (wildcard
    // race spans every division) — the standings panel itself stays
    // division-only.
    league.phase === 'REGULAR'
      ? prisma.team.findMany({ where: { leagueId: league.id, conference: team.conference }, select: { id: true, division: true, wins: true, losses: true, ties: true, pointsFor: true, pointsAgnst: true } })
      : Promise.resolve([]),
  ]);

  // --- WHICH SEASON THIS PAGE IS STILL TALKING ABOUT ----------------------
  // League.seasonYear moves INSIDE the offseason, not at the end of it.
  // RESET_STANDINGS — the step at OFFSEASON week 2 — is the single line in the
  // phase machine that increments it, so through weeks 1-2 seasonYear still
  // names the season that just finished and from week 3 on it names the one
  // about to start. Both windows are handled rather than only the first, so
  // the season just played keeps its panels for the whole offseason roll —
  // which is exactly when a GM is deciding who to keep. (A league on this
  // build only ever renders at week 1 and week 4 of the offseason: one Advance
  // carries the first three steps, so the week jumps. The test is on the step
  // index, which is what makes it right on both sides of that jump and on
  // saves stranded between.)
  //
  // Everything below that means "the season just played" reads this rather
  // than League.seasonYear — the championship announcement, the review, the
  // All-Star roll. Null outside OFFSEASON, which is also what gates all three:
  // they go away on their own when the phase moves to RESIGN, which is the
  // moment last year stops being the thing on his desk.
  const reviewYear = league.phase === 'OFFSEASON'
    ? (league.week <= 2 ? league.seasonYear : league.seasonYear - 1)
    : null;

  // --- Season announcement — the ring and the six trophies his players just
  // won, the biggest single moment in the game. Up for the whole offseason,
  // both presses of it, which is what `reviewYear` buys and why this does not
  // query on League.seasonYear: keyed on that, the announcement arrived at
  // week 1 and was gone by week 4, because RESET_STANDINGS had moved the year
  // out from under the query halfway through the first press. The panel
  // prints the year it is announcing (see SeasonAnnouncement), so the year it
  // is handed has to be the trophies' year rather than the league's — hence
  // carrying it on the object instead of re-deriving it at the render.
  let seasonAnnouncement: { seasonYear: number; championName: string; championTeamId: string; championAbbr: string; awards: AwardLine[] } | null = null;
  if (reviewYear !== null) {
    const [championTx, awardTxs] = await Promise.all([
      prisma.transaction.findFirst({ where: { leagueId: league.id, seasonYear: reviewYear, type: 'CHAMPION' } }),
      prisma.transaction.findMany({ where: { leagueId: league.id, seasonYear: reviewYear, type: { in: AWARD_TYPES } } }),
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
          seasonYear: reviewYear,
          championName: `${champTeam.city} ${champTeam.nickname}`,
          championTeamId: champTeam.id,
          championAbbr: champTeam.abbr,
          awards: awardTxs.map((t) => {
            const meta = AWARD_META.find((a) => a.type === t.type)!;
            return { code: meta.code, label: meta.label, name: t.headline.replace(/\s*\([^)]+\)\s*$/, ''), teamAbbr: t.teamId ? (teamById.get(t.teamId)?.abbr ?? 'FA') : 'FA', detail: t.detail };
          }),
        };
      }
    }
  }
  // His own line in the announcement. The season row is the only place the
  // finished record survives — Team.wins is back to 0-0 the moment
  // RESET_STANDINGS has run — so it is read for the announced year, not the
  // league's. Every club gets a row when the season wraps (snapshotSeasonHistory).
  const userSeasonRecord = seasonAnnouncement
    ? await prisma.teamSeasonRecord.findUnique({ where: { teamId_year: { teamId: team.id, year: seasonAnnouncement.seasonYear } } })
    : null;

  // --- The season in review — narrative reads on YOUR OWN players' years,
  // computed at read time from the games that were played (see
  // lib/seasonReview.ts). Same window and same year as the announcement above.
  const seasonReview = reviewYear !== null
    ? await buildSeasonReview(league.id, team.id, reviewYear)
    : null;

  // --- Your All-Stars ------------------------------------------------------
  // Rosters are named the week the regular season ends (lib/allStars.ts), so
  // this appears the moment the user advances into the playoffs and stays up
  // through the offseason, then goes away on its own when there are no rows
  // for the year being read. Read back from the Transaction rows selection
  // already wrote — nothing is re-decided here, so a refresh cannot change
  // who made it.
  //
  // `reviewYear` for the same reason the two panels above take it: these are
  // last season's honours, and the league year rolls halfway through the
  // first press of the offseason. Outside OFFSEASON it is null and the live
  // league year is the right one — that is the window this panel is named in.
  const allStarYear = reviewYear ?? league.seasonYear;
  const allStarRows = await prisma.transaction.findMany({
    where: { leagueId: league.id, seasonYear: allStarYear, type: ALL_STAR_TYPE, teamId: team.id },
    orderBy: { headline: 'asc' },
    select: { headline: true, detail: true },
  });
  const myAllStars: AllStarHonor[] = allStarRows.map((t) => {
    const m = /^(.*) \(([^)]+)\)$/.exec(t.headline);
    return { name: m?.[1] ?? t.headline, position: m?.[2] ?? '', statLine: t.detail };
  });
  // The near-miss is READ, never re-ranked. It was frozen into its own row at
  // selection time, and stays frozen: seasonStats is cleared at the rollover
  // and the candidate pool churns, so recomputing it here would let the page
  // change its mind a year later about who was snubbed. See
  // ALL_STAR_SNUB_TYPE.
  const snub = myAllStars.length === 0 ? await allStarSnubFor(league.id, team.id, allStarYear) : null;

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
  const teamColor = generateTeamLogoParams(team.abbr).primary;

  // --- Next matchup + a display-only win probability read (see lib/winProbability.ts) ---
  // League-wide ratings: one query set, reused by the matchup read below and
  // by anything else on this page that needs to know how good a team is.
  const leagueRatings = await buildLeagueRatings(league.id);

  // WHERE YOU STAND, as the big number on the hero rather than a page away.
  // The rating band below says how good the roster is; this says where that
  // and the season so far put you against the other 31, which is the question
  // a GM actually asks. Costs ~19ms and reuses the same ratings underneath.
  const powerBoard = await buildPowerRankings(league.id);
  const myPower = powerBoard.rows.find((r) => r.teamId === team.id) ?? null;
  const myRating = leagueRatings.get(team.id);

  let nextGame: {
    teamId: string; abbr: string; city: string; wins: number; losses: number;
    winProb: number; home: boolean; why: { label: string; points: number; detail: string }[];
  } | undefined;
  if (next) {
    const oppTeam = next.homeTeamId === team.id ? next.awayTeam : next.homeTeam;
    const oppRating = leagueRatings.get(oppTeam.id);
    const home = next.homeTeamId === team.id;

    // Previously this took a flat mean of the opponent's whole roster, which
    // is the measure lib/teamRating.ts exists to avoid: it rates a team down
    // for carrying depth and treats an elite quarterback as worth the same as
    // an elite punter. The weighted starter rating is the honest input.
    const estimate = myRating && oppRating
      ? estimateGameWinChance({
          me: myRating, opp: oppRating, atHome: home,
          myRecord: team, oppRecord: oppTeam,
        })
      : null;

    nextGame = {
      teamId: oppTeam.id, abbr: oppTeam.abbr, city: oppTeam.city,
      wins: oppTeam.wins, losses: oppTeam.losses,
      winProb: estimate?.percent ?? 50,
      home,
      // The two biggest movers, so the badge can say why instead of just
      // asserting a number the user has to take on faith.
      why: (estimate?.factors ?? [])
        .filter((f) => Math.abs(f.points) >= 1)
        .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
        .slice(0, 2),
    };
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

  // Ongoing threads, distinct from the League Wire's log of finished events.
  // Read-only and derived from rows that already exist — see lib/storyline.ts.
  const storylines = await generateStorylines(league.id, team.id, { limit: 5 });

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
  const { items: rankedTx, collapsedInjuries } = rankWire(transactions, {
    userTeamId: team.id,
    currentSeasonYear: league.seasonYear,
    currentWeek: league.week,
    limit: 6,
  });

  const txTeamIds = Array.from(new Set(rankedTx.map((t) => t.teamId).filter((id): id is string => !!id)));
  const wireTeams = txTeamIds.length > 0
    ? await prisma.team.findMany({ where: { id: { in: txTeamIds } }, select: { id: true, abbr: true } })
    : [];
  const wireTeamAbbr = new Map(wireTeams.map((t) => [t.id, t.abbr]));

  interface WireEntry { key: string; seasonYear: number; week: number; render: (featured: boolean) => React.ReactNode }
  const wireFromTx: WireEntry[] = rankedTx.map((t) => ({
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
          href={`/league/${league.id}/game/${g.id}`}
        />
      ),
    };
  });
  // Games first so a real result outranks same-week trivia news on a tie —
  // "what happened last week" belongs above "who's pacing the league."
  // --- Right-rail widgets -----------------------------------------------
  // Both read the roster that's already loaded above, so neither costs a
  // query. The rail was carrying two short widgets against a left column
  // three times its height, leaving most of the page's right half blank.

  // "54 (3 inj)" in the header names nobody. A starter here is whoever tops
  // their position group on raw rating — the depth chart can override that,
  // but this page doesn't load it and the approximation is right in the case
  // that matters (your best player at a spot going down).
  const bestAtPosition = new Map<string, string>();
  for (const p of roster) {
    if (!bestAtPosition.has(p.position)) bestAtPosition.set(p.position, p.id);
  }
  const injuries: InjuryEntry[] = roster
    .filter((p) => p.injuryWeeks > 0)
    .map((p) => ({
      id: p.id,
      name: `${p.firstName} ${p.lastName}`,
      position: p.position,
      ovr: p.trueOvr,
      weeks: p.injuryWeeks,
      type: p.injuryType,
      isStarter: bestAtPosition.get(p.position) === p.id,
    }))
    .sort((a, b) => Number(b.isStarter) - Number(a.isStarter) || b.weeks - a.weeks || b.ovr - a.ovr)
    .slice(0, 6);

  const statsById = new Map(roster.map((p) => [p.id, readJson<SeasonStats>(p.seasonStats, {})]));
  // One name per phase of the game — the Stats page owns the deep tables, so
  // anything more here would just duplicate it.
  const LEADER_CATEGORIES: { category: string; pick: (s: SeasonStats) => number; line: (s: SeasonStats) => string }[] = [
    { category: 'Passing', pick: (s) => s.passYds ?? 0, line: (s) => `${(s.passYds ?? 0).toLocaleString()} yds · ${s.passTd ?? 0} TD` },
    { category: 'Rushing', pick: (s) => s.rushYds ?? 0, line: (s) => `${(s.rushYds ?? 0).toLocaleString()} yds · ${s.rushTd ?? 0} TD` },
    { category: 'Receiving', pick: (s) => s.recYds ?? 0, line: (s) => `${s.rec ?? 0} rec · ${(s.recYds ?? 0).toLocaleString()} yds` },
    { category: 'Pass Rush', pick: (s) => s.sacks ?? 0, line: (s) => `${s.sacks ?? 0} sacks · ${s.tackles ?? 0} tkl` },
  ];
  const leaders: LeaderEntry[] = LEADER_CATEGORIES.flatMap(({ category, pick, line }) => {
    let best: (typeof roster)[number] | null = null;
    let bestVal = 0;
    for (const p of roster) {
      const v = pick(statsById.get(p.id) ?? {});
      if (v > bestVal) { bestVal = v; best = p; }
    }
    // A category nobody has produced in yet is omitted rather than shown as a
    // zero — an empty leader board reads as broken, a shorter one doesn't.
    if (!best || bestVal <= 0) return [];
    return [{
      category,
      id: best.id,
      name: `${best.firstName} ${best.lastName}`,
      position: best.position,
      line: line(statsById.get(best.id) ?? {}),
    }];
  });

  // Your own results lead, then transactions in RELEVANCE order — not
  // re-sorted by week, which would undo the ranking and push a title or a
  // trade below whatever happened most recently.
  const injuryRow: WireEntry[] = collapsedInjuries
    ? [{
        key: 'injuries-collapsed',
        seasonYear: league.seasonYear,
        week: collapsedInjuries.representative.week,
        render: () => (
          <NewsRow
            key="injuries-collapsed"
            category="INJURY"
            headline={`${collapsedInjuries.count} injury report${collapsedInjuries.count === 1 ? '' : 's'} around the league`}
            detail="Your own injuries are in the Injury Report on the right; these belong to other clubs."
            meta={`WK ${collapsedInjuries.representative.week}`}
          />
        ),
      }]
    : [];

  const wire = [...wireFromGames, ...wireFromTx, ...injuryRow]
    .slice(0, 7)
    .map((w, i) => w.render(i === 0));

  return (
    <div className="space-y-8">
      {seasonAnnouncement && (
        <SeasonAnnouncement
          leagueId={league.id}
          seasonYear={seasonAnnouncement.seasonYear}
          championName={seasonAnnouncement.championName}
          championTeamId={seasonAnnouncement.championTeamId}
          championAbbr={seasonAnnouncement.championAbbr}
          isUserChampion={seasonAnnouncement.championTeamId === team.id}
          userTeamId={team.id}
          userTeamName={`${team.city} ${team.nickname}`}
          userRecord={`${userSeasonRecord?.wins ?? team.wins}-${userSeasonRecord?.losses ?? team.losses}${(userSeasonRecord?.ties ?? team.ties) ? `-${userSeasonRecord?.ties ?? team.ties}` : ''}`}
          userResult={userSeasonRecord?.playoffResult ?? 'MISSED'}
          awards={seasonAnnouncement.awards}
          /* Only when the title being announced IS the one that ended the
             rebuild. A second championship is a championship, not a climb. */
          rebuildSeasons={
            rebuildStanding.state === 'WON' && rebuildStanding.firstTitleYear === seasonAnnouncement.seasonYear
              ? rebuildStanding.seasonsToTitle
              : null
          }
        />
      )}
      {seasonReview && (
        <SeasonReview review={seasonReview} leagueId={league.id} teamColor={teamColor} />
      )}
      <AllStarHonorRoll
        seasonYear={allStarYear}
        leagueId={league.id}
        teamAbbr={team.abbr}
        honors={myAllStars}
        nearMiss={snub}
      />
      <OffseasonRoadmap
        leagueId={league.id}
        currentPhase={league.phase}
        week={league.week}
        // Suppresses itself on the FIRST preseason of a save — a five-stage
        // checklist of an offseason that happened before the GM arrived, sitting
        // above the two live decisions in his brief. See the note there.
        seasonYear={league.seasonYear}
        startYear={league.startYear}
      />
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
            myPower
              ? {
                  value: `#${myPower.rank}`,
                  label: powerRankLabel(myPower),
                  // Top of the league should LOOK like it. Gold is reserved for
                  // first — the same gold the championship rows use — then the
                  // top five, then the top ten; outside that it is an ordinary
                  // number and gets ordinary ink, because colouring all 32
                  // would make the colour mean nothing.
                  color: myPower.rank === 1 ? 'text-gold'
                    : myPower.rank <= 5 ? 'text-accent'
                    : myPower.rank <= 10 ? 'text-accent2'
                    : 'text-chalk',
                }
              : { value: '—', label: 'Power Rank' },
          ]}
          ratings={myRating ? [
            { label: 'Team Overall', value: myRating.overall, rank: myRating.rank, outOf: leagueRatings.size },
            { label: 'Offense', value: myRating.offense, rank: compositeRank(leagueRatings, team.id, 'offense'), outOf: leagueRatings.size },
            { label: 'Defense', value: myRating.defense, rank: compositeRank(leagueRatings, team.id, 'defense'), outOf: leagueRatings.size },
            { label: 'Special Teams', value: myRating.specialTeams, rank: compositeRank(leagueRatings, team.id, 'specialTeams'), outOf: leagueRatings.size },
          ] : undefined}
          nextGame={nextGame}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {brief.length > 0 && (
            <div className="section">
              <FrontOfficeBrief items={brief.map((b) => ({ ...b, href: `/league/${league.id}${b.href}` }))} weekLabel={`Week ${league.week}`} />
            </div>
          )}

          {storylines.length > 0 && (
            <div className="section">
              <SectionHeading
                title="Storylines"
                action={<span className="text-xs text-muted">This season's threads</span>}
              />
              <StorylineFeed leagueId={league.id} storylines={storylines} />
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="section">
            <SectionHeading title="Roster Needs" tip={tip('rosterNeed')} action={<Link href={`/league/${league.id}/free-agency`} className="text-xs text-accent2 hover:underline">Browse →</Link>} />
            <div className="panel p-4">
              {topNeeds.length === 0 ? (
                <p className="text-sm text-muted">No glaring holes right now — nice work.</p>
              ) : (
                <RosterNeeds
                  needs={topNeeds.map(([pos, val]) => ({
                    position: pos,
                    value: val,
                    ...needSeverity(val),
                    // WHAT THE SEVERITY WORD COULD NOT SAY. Measured on a live
                    // dashboard all five rows read "Moderate" — `needSeverity`'s
                    // middle band is wide enough to swallow a whole normal
                    // roster's top five. Bodies against starters differ on every
                    // line and are the reason the score is what it is.
                    // `startersAt` is lib/lineup.ts's, so this cannot disagree
                    // with the depth chart or the sim about who starts.
                    detail: `${roster.filter((p) => p.position === pos).length} rostered · ${startersAt(pos)} start`,
                    href: `/league/${league.id}/free-agency?pos=${pos}`,
                  }))}
                />
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

          <div className="section">
            <SectionHeading title="Injury Report" tip={tip('injuryStatus')} action={<Link href={`/league/${league.id}/depth-chart`} className="text-xs text-accent2 hover:underline">Depth chart →</Link>} />
            <InjuryReport leagueId={league.id} entries={injuries} />
          </div>

          <div className="section">
            <SectionHeading title="Season Leaders" action={<Link href={`/league/${league.id}/stats`} className="text-xs text-accent2 hover:underline">All stats →</Link>} />
            <TeamLeaders leagueId={league.id} leaders={leaders} />
          </div>
        </div>
      </div>

      {/* Full width rather than in the left column: the wire is the longest
          block on the page, and stacking it under the brief pushed the left
          column to roughly three times the rail's height with the right half
          of the page left blank. */}
      <div className="section">
        <SectionHeading title="League Wire" action={<Link href={`/league/${league.id}/news`} className="text-xs text-accent2 hover:underline">View all →</Link>} />
        <div className="panel px-4 divide-y divide-line/60">
          {wire.length > 0 ? wire : <p className="text-sm text-muted py-3">No news yet.</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * "Power Rank", plus the week-over-week move when there is one written down.
 * The move is the story — a #12 that was #19 last week is a different club
 * from a #12 sliding out of the top ten — and it is read from the stored
 * snapshot, never recomputed, so it cannot disagree with the Power Rankings
 * page.
 */
function powerRankLabel(row: { rank: number; move: { delta: number } | null }): string {
  const d = row.move?.delta ?? 0;
  if (d === 0) return 'Power Rank';
  return `Power Rank ${d > 0 ? '\u25B2' : '\u25BC'}${Math.abs(d)}`;
}

/**
 * League rank for one of the composite ratings. TeamRating carries a rank for
 * the OVERALL and for each individual unit, but not for offense, defense or
 * special teams — so ranking them here, off the same map that produced the
 * number, is the only way the rank under a figure is the rank OF that figure.
 * Same reasoning, and same shape, as offDefRankDetail on the handover screen.
 */
function compositeRank(
  ratings: Map<string, { teamId: string; offense: number; defense: number; specialTeams: number }>,
  teamId: string,
  key: 'offense' | 'defense' | 'specialTeams',
): number {
  const all = [...ratings.values()].sort((a, b) => b[key] - a[key]);
  return all.findIndex((t) => t.teamId === teamId) + 1;
}
