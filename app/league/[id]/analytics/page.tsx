import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { resolveStartYear } from '@/lib/leagueYear';
import { teamCapSummary } from '@/lib/cap-summary';
import { capForYear, capHit, formatMoney, marketValue } from '@/lib/cap';
import { buildLeagueRatings, estimateGameWinChance } from '@/lib/teamRating';
import { positionGroup } from '@/lib/positionGroups';
import { STARTERS_AT_GROUP, splitStarters } from '@/lib/lineup';
import { computeGameShape, BLOWOUT_MARGIN, ONE_SCORE_MARGIN } from '@/lib/gameShape';
import { loadPlayerSeasons, reconstructPlayerSeasons, withAges, ageBasisYear, buildSeasonLines, SeasonLine } from '@/lib/playerSeasons';
import { leadColumnKey, statLabel } from '@/lib/statLabels';
import { canonicalPosition, Position } from '@/lib/tuning';
import { isRankablePosition } from '@/lib/performanceScore';
import { readJson } from '@/lib/json';
import { tip } from '@/lib/glossary';
import { BoxScore } from '@/lib/types';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import {
  buildPythagoreanTable, buildLuckLedger, buildUnitSpendTable, buildMarginProfile,
  buildAgeProfile, buildDraftReturn, buildCapHealth, strengthOfSchedule,
  classifyContractValue, rankContractValue,
  blankDriveAgg, addDrive, buildDriveMetrics, buildRateBoards,
  type SurplusRow, type MarginGame, type DraftPickRow, type DriveAgg,
} from '@/lib/analytics';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { AnalyticsShell } from '@/components/analytics/AnalyticsShell';
import { LuckLedgerPanel } from '@/components/analytics/LuckLedgerPanel';
import { SpendVsRatingPanel } from '@/components/analytics/SpendVsRatingPanel';
import { MarginPanel } from '@/components/analytics/MarginPanel';
import { WhatIsLeftPanel, type RemainingGame } from '@/components/analytics/WhatIsLeftPanel';
import { ContractValuePanel, type ValueRow } from '@/components/analytics/ContractValuePanel';
import { CliffPanel } from '@/components/analytics/CliffPanel';
import { DraftReturnPanel } from '@/components/analytics/DraftReturnPanel';
import { ProductionPanel, type ProductionMan } from '@/components/analytics/ProductionPanel';
import { DriveBoardPanel } from '@/components/analytics/DriveBoardPanel';
import { PerPlayPanel } from '@/components/analytics/PerPlayPanel';
import { HeadlineRead, type ReadLine } from '@/components/analytics/HeadlineRead';
import { PanelBoundary } from '@/components/analytics/PanelBoundary';
import { ordinal, pct1, signed } from '@/components/analytics/viz';

/**
 * ===========================================================================
 * THE ANALYTICS DEPARTMENT
 * ===========================================================================
 * A read-only derivation layer over what the season already produced. Nothing
 * on this screen feeds the sim, the AI or any stored value, and nothing else
 * in the game reads from it — the same contract lib/analytics.ts has carried
 * since the Cap and Stats "Advanced" views.
 *
 * Every figure comes out of the module that already owns it: unit ratings and
 * win chances from lib/teamRating.ts, cap hits and market value from
 * lib/cap.ts, who starts from lib/lineup.ts, how a game was decided from
 * lib/gameShape.ts, and season stat lines from lib/playerSeasons.ts. Nothing
 * here recomputes a number the app states somewhere else, because two
 * computations of one number is how a screen ends up disagreeing with the
 * game it is describing.
 *
 * WHAT THIS PAGE CANNOT DO, and says so on the page rather than faking:
 *   - unit strength OVER TIME — no historical rating exists at unit
 *     granularity, and it cannot be reconstructed (see
 *     docs/design-research/analytics/data-inventory.md §2.1);
 *   - snap counts, so an offensive lineman has no production line at all;
 *   - what the scouting department believed at the moment of a pick;
 *   - anything below the drive: no down, distance or field position is stored.
 *
 * COST. The one expensive read available here — parsing every played game in
 * the league to rank team box-score stats — is deliberately NOT taken: that
 * panel was cut (see design.md, "Cut, or do not build"). The only box scores
 * parsed are this club's own games, for the drive-log shapes.
 * ===========================================================================
 */

export const dynamic = 'force-dynamic';

/** A league with a corrupt or zero season length still needs a divisor. */
const seasonLengthFor = (n: number) => n || 17;

export default async function AnalyticsPage({ params, searchParams }: {
  params: { id: string };
  searchParams: { view?: string };
}) {
  const { league, settings, userTeam, phaseLabel } = await getLeagueContext(params.id);
  // Same param, same vocabulary and same pills as the Cap and Stats screens —
  // ?view=advanced. Simple is the default because most of what a player wants
  // from this page is four questions, and the war room behind the switch is
  // where the density lives.
  const advanced = searchParams.view === 'advanced';

  if (!userTeam) {
    return (
      <div className="space-y-4">
        <h1 className="font-display font-extrabold text-3xl uppercase tracking-wide">Analytics Department</h1>
        <div className="panel p-4 text-muted text-sm">
          You are not running a club in this league, so there is nothing for us to look at.
        </div>
      </div>
    );
  }

  const me = userTeam;
  const capMode = settings.capMode;

  const [teams, ratings, roster, cap, leaguePlayers, history, myGames, allRegularGames, picks, startYear] = await Promise.all([
    prisma.team.findMany({ where: { leagueId: league.id } }),
    buildLeagueRatings(league.id),
    prisma.player.findMany({ where: { teamId: me.id, status: 'ACTIVE' }, include: { contract: true } }),
    teamCapSummary(me.id, league.seasonYear, capMode),
    // ACTIVE only, matching teamCapSummary's own definition of active salary —
    // so the nine unit spends below add up to exactly the "Committed" figure
    // in the masthead rather than to a number nothing else in the app states.
    prisma.player.findMany({
      where: { leagueId: league.id, teamId: { not: null }, status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, teamId: true, position: true, trueOvr: true, contract: true },
    }),
    prisma.teamSeasonRecord.findMany({ where: { teamId: me.id }, orderBy: { year: 'asc' } }),
    prisma.game.findMany({
      where: { leagueId: league.id, seasonYear: league.seasonYear, OR: [{ homeTeamId: me.id }, { awayTeamId: me.id }] },
      orderBy: [{ kind: 'asc' }, { week: 'asc' }],
    }),
    prisma.game.findMany({
      where: { leagueId: league.id, seasonYear: league.seasonYear, kind: 'REGULAR' },
      select: { homeTeamId: true, awayTeamId: true, played: true },
    }),
    prisma.draftPick.findMany({
      where: { leagueId: league.id, used: true, ownerTeamId: me.id },
      include: { player: { select: { id: true, firstName: true, lastName: true, position: true, trueOvr: true, age: true, teamId: true } } },
      orderBy: [{ year: 'asc' }, { round: 'asc' }, { slot: 'asc' }],
    }),
    resolveStartYear(league),
  ]);

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const myRating = ratings.get(me.id);
  const accent = generateTeamLogoParams(me.abbr).primary;

  // buildLeagueRatings() rates every club in the league, so a missing entry
  // means the user's club is not in this league — a corrupt save rather than
  // an empty one. Refuse the page with a sentence instead of throwing eight
  // panels' worth of null dereferences.
  if (!myRating) {
    return (
      <div className="space-y-4">
        <h1 className="font-display font-extrabold text-3xl uppercase tracking-wide">Analytics Department</h1>
        <div className="panel p-4 text-muted text-sm">
          We cannot rate your club against the rest of the league, so none of the comparisons on this page
          would mean anything.
        </div>
      </div>
    );
  }

  // --- who starts ----------------------------------------------------------
  // splitStarters() from lib/lineup.ts is THE definition of who is on the
  // field: eleven on offence, eleven on defence, two specialists, resolved per
  // POSITION rather than per group. Ordering inside a position is by true
  // rating, which is the same sample lib/teamRating.ts averages for the unit
  // ratings this page plots — so "first team" here and "unit rating" there
  // never describe two different sets of players.
  const starterIds = new Set<string>();
  for (const pos of new Set(roster.map((p) => p.position))) {
    const ordered = roster.filter((p) => p.position === pos).sort((a, b) => b.trueOvr - a.trueOvr);
    splitStarters(pos, ordered).starters.forEach((p) => starterIds.add(p.id));
  }

  const rosterRows = roster.map((p) => {
    const hit = capHit(p.contract, capMode);
    const market = marketValue({ ovr: p.trueOvr, position: p.position as Position, age: p.age, potential: p.potential });
    return {
      id: p.id,
      name: `${p.firstName} ${p.lastName}`,
      position: p.position,
      group: positionGroup(p.position),
      age: p.age,
      ovr: p.trueOvr,
      hit,
      market,
      surplus: market - hit,
      yearsRemaining: p.contract?.yearsRemaining ?? 0,
      weightLb: p.weightLb,
      heightIn: p.heightIn,
      starter: starterIds.has(p.id),
    };
  });

  // --- cap by unit, league-wide --------------------------------------------
  const spendByTeamGroup = new Map<string, number>();
  const spendByTeam = new Map<string, number>();
  for (const p of leaguePlayers) {
    const h = capHit(p.contract, capMode);
    const key = `${p.teamId}|${positionGroup(p.position)}`;
    spendByTeamGroup.set(key, (spendByTeamGroup.get(key) ?? 0) + h);
    spendByTeam.set(p.teamId!, (spendByTeam.get(p.teamId!) ?? 0) + h);
  }

  const unitRatingByTeam = new Map(
    [...ratings.entries()].map(([id, r]) => [id, r.units.map((u) => ({ group: u.group, rating: u.rating, rank: u.rank, weight: u.weight }))]),
  );

  const groups = buildUnitSpendTable({
    spendByTeamGroup,
    spendByTeam,
    unitRatingByTeam,
    teamIds: teams.map((t) => t.id),
    myTeamId: me.id,
    roster: rosterRows,
    startersAtGroup: STARTERS_AT_GROUP,
  });

  // --- luck, this season and every season on record -------------------------
  const pythLeague = buildPythagoreanTable(
    teams.map((t) => ({
      id: t.id, city: t.city, nickname: t.nickname, abbr: t.abbr,
      wins: t.wins, losses: t.losses, ties: t.ties, pointsFor: t.pointsFor, pointsAgnst: t.pointsAgnst,
    })),
    me.id,
  );
  const myLuckIdx = pythLeague.findIndex((r) => r.isUser);
  const myLuck = myLuckIdx >= 0 ? pythLeague[myLuckIdx] : null;
  const ledger = buildLuckLedger(history, startYear);

  // --- games ---------------------------------------------------------------
  const playedRegular = myGames.filter((g) => g.played && g.kind === 'REGULAR');
  const marginGames: MarginGame[] = playedRegular.map((g) => {
    const home = g.homeTeamId === me.id;
    const us = home ? g.homeScore : g.awayScore;
    const them = home ? g.awayScore : g.homeScore;
    const opp = teamById.get(home ? g.awayTeamId : g.homeTeamId);
    const shape = computeGameShape(readJson<BoxScore | null>(g.boxScore, null), home ? 'home' : 'away');
    return {
      week: g.week,
      home,
      us,
      them,
      margin: us - them,
      oppAbbr: opp?.abbr ?? '???',
      archetype: shape?.archetype ?? null,
      note: shape?.note ?? null,
      leadChanges: shape?.leadChanges ?? 0,
      largestLead: shape?.largestLead ?? 0,
      largestDeficit: shape?.largestDeficit ?? 0,
    };
  });
  const marginProfile = buildMarginProfile(marginGames, { oneScore: ONE_SCORE_MARGIN, blowout: BLOWOUT_MARGIN });

  const remaining: RemainingGame[] = myGames
    .filter((g) => !g.played && g.kind === 'REGULAR')
    // A fixture whose opponent row has been deleted cannot be rated, and a
    // forecast that silently drops it would still be summed into the projected
    // finish. Filtered before the map so it is absent from both.
    .filter((g) => {
      const oppId = g.homeTeamId === me.id ? g.awayTeamId : g.homeTeamId;
      return teamById.has(oppId) && ratings.has(oppId);
    })
    .map((g) => {
      const home = g.homeTeamId === me.id;
      const oppId = home ? g.awayTeamId : g.homeTeamId;
      const opp = teamById.get(oppId)!;
      const oppRating = ratings.get(oppId)!;
      const est = estimateGameWinChance({
        me: myRating,
        opp: oppRating,
        atHome: home,
        myRecord: { wins: me.wins, losses: me.losses, ties: me.ties },
        oppRecord: { wins: opp.wins, losses: opp.losses, ties: opp.ties },
      });
      return {
        week: g.week, home, oppId, oppAbbr: opp.abbr,
        oppName: `${opp.city} ${opp.nickname}`, oppNickname: opp.nickname,
        oppWins: opp.wins, oppLosses: opp.losses, oppTies: opp.ties,
        oppRating: oppRating.overall, oppRank: oppRating.rank,
        winPct: est.percent, factors: est.factors,
      };
    });

  const recordById = new Map(teams.map((t) => [t.id, { wins: t.wins, losses: t.losses, ties: t.ties }]));
  const sosPlayed = strengthOfSchedule(
    me.id,
    allRegularGames.filter((g) => g.homeTeamId === me.id || g.awayTeamId === me.id),
    recordById,
  );
  const remainingOppWinRate = remaining.length
    ? remaining.reduce((a, r) => {
      const gp = r.oppWins + r.oppLosses + r.oppTies;
      return a + (gp ? (r.oppWins + r.oppTies * 0.5) / gp : 0.5);
    }, 0) / remaining.length
    : null;

  const divisionTable = teams
    .filter((t) => t.conference === me.conference && t.division === me.division)
    .map((t) => ({
      teamId: t.id, abbr: t.abbr, name: `${t.city} ${t.nickname}`,
      wins: t.wins, losses: t.losses, ties: t.ties,
      pct: (t.wins + t.ties * 0.5) / Math.max(1, t.wins + t.losses + t.ties),
      isUser: t.id === me.id,
    }))
    .sort((a, b) => b.pct - a.pct || b.wins - a.wins);

  // --- contract value -------------------------------------------------------
  const surplusRows: SurplusRow[] = rosterRows
    .filter((r) => r.hit > 0)
    .map((r) => ({
      playerId: r.id, name: r.name, position: r.position, age: r.age, ovr: r.ovr,
      hit: r.hit, marketValue: r.market, surplus: r.surplus,
      tier: classifyContractValue(r.surplus, r.market),
    }));
  const value = rankContractValue(surplusRows);
  const withBody = (rows: SurplusRow[]): ValueRow[] => rows.map((r) => {
    const p = rosterRows.find((x) => x.id === r.playerId)!;
    return { ...r, weightLb: p.weightLb, heightIn: p.heightIn };
  });

  // --- age / cliff ----------------------------------------------------------
  const ageProfile = buildAgeProfile(rosterRows.map((r) => ({
    age: r.age, hit: r.hit, ovr: r.ovr, yearsRemaining: r.yearsRemaining, starter: r.starter,
  })));
  const capHealth = buildCapHealth({
    // nextYearHit is this year's hit: capHitSchedule() is the honest answer for
    // a single deal, but buildCapHealth wants one number per row and the cap
    // page passes the same thing. Stated as "committed", never as "next year's
    // exact hit".
    rows: rosterRows.map((r) => ({ age: r.age, hit: r.hit, yearsRemaining: r.yearsRemaining, nextYearHit: r.hit })),
    capUsed: cap.capUsed,
    capTotal: cap.capTotal,
    nextYearCapTotal: capForYear(league.seasonYear + 1, startYear),
    deadMoney: cap.deadMoney,
  });

  // --- draft return ---------------------------------------------------------
  const draftRows: DraftPickRow[] = picks
    .filter((p) => p.player)
    .map((p) => ({
      year: p.year, round: p.round, slot: p.slot,
      playerId: p.player!.id,
      name: `${p.player!.firstName} ${p.player!.lastName}`,
      position: p.player!.position,
      ovr: p.player!.trueOvr,
      age: p.player!.age,
      stillHere: p.player!.teamId === me.id,
      starter: starterIds.has(p.player!.id),
    }));
  const draftBands = buildDraftReturn(draftRows, settings.draftRounds || 7);
  const leagueMeanOvr = leaguePlayers.length
    ? leaguePlayers.reduce((a, p) => a + p.trueOvr, 0) / leaguePlayers.length
    : 0;

  // --- production, from PlayerSeason ---------------------------------------
  const byHit = [...rosterRows].sort((a, b) => b.hit - a.hit);
  const board = byHit.slice(0, 7);
  // The best-paid lineman is forced onto the board even when he is not a top
  // seven cap hit, because "the box score has never recorded anything he did"
  // is exactly the sort of thing this panel must not hide.
  const topOL = byHit.find((r) => r.group === 'OL');
  if (topOL && !board.includes(topOL)) board.push(topOL);

  const basisYear = ageBasisYear(league);
  const men: ProductionMan[] = await Promise.all(board.map(async (r) => {
    const pos = canonicalPosition(r.position);
    const key = isRankablePosition(r.position) ? (leadColumnKey(pos) ?? null) : null;

    let lines: SeasonLine[] | null = await loadPlayerSeasons(league.id, r.id);
    if (lines === null) {
      // No stored season rows for this league yet. Replaying gives the
      // identical numbers off a slower read, which is the right trade for a
      // page that would otherwise show an empty panel. Which of the two paths
      // served them used to be named in the panel's eyebrow; a player cannot
      // act on that, so it went and the flag went with it.
      lines = await reconstructPlayerSeasons(league.id, r.id);
    }
    const player = roster.find((p) => p.id === r.id)!;
    const aged = withAges(lines, { age: player.age, status: player.status, yearsUnsigned: player.yearsUnsigned }, basisYear);

    return {
      playerId: r.id, name: r.name, position: r.position, age: r.age,
      weightLb: r.weightLb, heightIn: r.heightIn, hit: r.hit,
      statKey: key,
      statLabel: key ? statLabel(key) : null,
      series: key
        ? aged
          // Completed seasons only: the year in progress is half a sample and
          // would read as a collapse on a season axis.
          .filter((l) => l.seasonYear < league.seasonYear && l.gp > 0)
          .map((l) => ({
            year: l.seasonYear, age: l.age, team: l.teamAbbr, gp: l.gp,
            value: (l.stats as Record<string, number | undefined>)[key] ?? 0,
          }))
        : [],
      reason: r === topOL && !byHit.slice(0, 7).includes(r) ? 'lineman' : 'cap',
    };
  }));

  // --- the war room, computed only when it is going to be rendered ---------
  // THE ONE EXPENSIVE READ ON THIS PAGE. Every team-level and per-play figure
  // in the sim lives inside Game.boxScore as JSON, so a league-wide rank means
  // selecting and parsing every played game of the season — 176 rows at week
  // 12, 272 by the end. It is paid ONLY on the Advanced view, and the Simple
  // view never touches it. One query serves both boards below.
  const driveOffense = new Map<string, DriveAgg>();
  const driveDefense = new Map<string, DriveAgg>();
  let rateBoards: ReturnType<typeof buildRateBoards> = [];
  let leagueGamesPlayed = 0;

  if (advanced) {
    const boxGames = await prisma.game.findMany({
      where: { leagueId: league.id, seasonYear: league.seasonYear, kind: 'REGULAR', played: true },
      select: { seasonYear: true, week: true, kind: true, homeTeamId: true, awayTeamId: true, boxScore: true },
    });
    leagueGamesPlayed = teams.length > 0 ? Math.round((boxGames.length * 2) / teams.length) : 0;

    for (const t of teams) {
      driveOffense.set(t.id, blankDriveAgg());
      driveDefense.set(t.id, blankDriveAgg());
    }
    for (const g of boxGames) {
      const box = readJson<BoxScore | null>(g.boxScore, null);
      if (!box?.drives) continue;
      for (const d of box.drives) {
        const owner = d.team === 'home' ? g.homeTeamId : g.awayTeamId;
        const facing = d.team === 'home' ? g.awayTeamId : g.homeTeamId;
        const off = driveOffense.get(owner);
        const def = driveDefense.get(facing);
        if (off) addDrive(off, d);
        if (def) addDrive(def, d);
      }
    }

    // Season stat lines come out of lib/playerSeasons.ts rather than being
    // re-derived here, so the regular/postseason split this page depends on is
    // the same split the player page and the stats screen use. Only REGULAR
    // games were selected above, so `stats` is exactly the regular season.
    const abbrByTeamId = new Map(teams.map((t) => [t.id, t.abbr]));
    const linesByPlayer = buildSeasonLines(boxGames, abbrByTeamId);
    const identity = new Map(leaguePlayers.map((p) => [p.id, p]));

    const pool = [...linesByPlayer.entries()]
      .map(([playerId, lines]) => {
        const who = identity.get(playerId);
        // No roster row means no position, and a rate cannot be placed on a
        // positional strip without one. Left out rather than guessed at.
        if (!who) return null;
        // Season totals: a man traded mid-year has a line per club, and the
        // convention every stat page uses is to add them and attribute the
        // row to where he plays now.
        const stats = lines.reduce((acc, l) => {
          for (const [k, v] of Object.entries(l.stats)) acc[k] = (acc[k] ?? 0) + (v ?? 0);
          return acc;
        }, {} as Record<string, number>);
        return {
          playerId,
          name: `${who.firstName} ${who.lastName}`,
          position: who.position,
          teamId: who.teamId,
          teamAbbr: who.teamId ? (abbrByTeamId.get(who.teamId) ?? '—') : '—',
          gp: lines.reduce((a, l) => a + l.gp, 0),
          stats,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    rateBoards = buildRateBoards(pool, me.id, leagueGamesPlayed, seasonLengthFor(settings.seasonLength));
  }

  const driveMetrics = advanced ? buildDriveMetrics(driveOffense, driveDefense, me.id) : [];
  const myDriveOffense = driveOffense.get(me.id) ?? blankDriveAgg();
  const myDriveDefense = driveDefense.get(me.id) ?? blankDriveAgg();

  // --- masthead -------------------------------------------------------------
  const played = me.wins + me.losses + me.ties;
  const divPos = divisionTable.findIndex((r) => r.isUser) + 1;
  const projectedExtra = remaining.reduce((a, r) => a + r.winPct / 100, 0);
  const projWins = me.wins + me.ties * 0.5 + projectedExtra;
  const seasonLength = settings.seasonLength || 17;
  const hasPreHistory = ledger.some((r) => !r.tenure);
  // The season is on the ledger once the rollover has written its
  // TeamSeasonRecord row. Until then the live Team record is the only source
  // for it, and the panel must not describe a finished year as "in progress".
  const seasonOnLedger = ledger.some((r) => r.year === league.seasonYear);
  // Counted the same way the nine-unit strip counts it, so the "19 of 53"
  // headline and the nine denominators under it can never disagree.
  const expiringCount = rosterRows.filter((r) => r.yearsRemaining <= 1).length;

  const facts = [
    {
      label: 'Record',
      value: `${me.wins}-${me.losses}${me.ties ? `-${me.ties}` : ''}`,
      detail: `${divPos ? `${ordinal(divPos)} in the ${me.conference} ${me.division} · ` : ''}${played} of ${seasonLength} played`,
    },
    myLuck
      ? {
        label: 'The scoring says',
        value: `${myLuck.expectedWins.toFixed(1)}-${(played - myLuck.expectedWins).toFixed(1)}`,
        detail: `Pythagorean · ${signed(myLuck.luck)} wins, ${ordinal(pythLeague.length - myLuckIdx)}-unluckiest of ${pythLeague.length}`,
        color: myLuck.luck < -0.5 ? 'text-bad' : myLuck.luck > 0.5 ? 'text-accent' : undefined,
        tip: tip('pythagoreanWins'),
      }
      : { label: 'The scoring says', value: '—', detail: 'no games played yet this season', tip: tip('pythagoreanWins') },
    {
      label: 'Roster rating',
      value: String(myRating?.overall ?? '—'),
      detail: myRating ? `${ordinal(myRating.rank)} of ${teams.length} · off ${myRating.offense} · def ${myRating.defense}` : '',
      color: myRating && myRating.rank <= 8 ? 'text-accent' : undefined,
      tip: tip('teamOverall'),
    },
    cap.capEnabled
      ? {
        label: 'Committed',
        value: formatMoney(cap.capUsed),
        detail: `${pct1(cap.capUsed / cap.capTotal)} of the ${formatMoney(cap.capTotal)} ceiling`,
        tip: tip('committedCap'),
      }
      : { label: 'Committed', value: '—', detail: 'cap mode is off in this league', tip: tip('committedCap') },
    {
      label: 'Cap-weighted age',
      value: capHealth.capWeightedAge ? capHealth.capWeightedAge.toFixed(1) : '—',
      detail: `roster mean ${capHealth.rosterAvgAge.toFixed(1)} · top 5 hold ${pct1(capHealth.topFiveShare)}`,
      tip: tip('capWeightedAge'),
    },
    {
      label: 'Projected finish',
      value: remaining.length ? `${projWins.toFixed(1)}-${(seasonLength - projWins).toFixed(1)}` : `${me.wins}-${me.losses}`,
      detail: remaining.length ? `${remaining.length} left, ${remaining.filter((r) => r.home).length} at home` : 'schedule complete',
      tip: tip('projectedFinish'),
    },
  ];

  // --- the read, in sentences ----------------------------------------------
  // Composed from the panels' own figures. Every clause is guarded on the data
  // existing, so a league in week one gets fewer sentences rather than a
  // sentence built out of zeroes.
  const worstUnit = [...groups].sort((a, b) => a.shareDelta - b.shareDelta)[0];
  const biggestOverpay = value.overpays[0];
  const overpayStory = biggestOverpay
    ? men.find((m) => m.playerId === biggestOverpay.playerId && m.series.length > 1)
    : undefined;
  const decliningStory = overpayStory && overpayStory.series[overpayStory.series.length - 1].value < overpayStory.series[0].value
    ? overpayStory
    : undefined;

  const readLines: ReadLine[] = [];
  readLines.push({
    topic: 'Where you stand',
    text: <>
      <b>{me.city} {me.nickname}</b> field the {ordinal(myRating.rank)}-rated roster of {teams.length} and sit
      {' '}<b>{me.wins}-{me.losses}{me.ties ? `-${me.ties}` : ''}</b>
      {myLuck && Math.abs(myLuck.luck) >= 0.5 ? (
        <>. The points say the record should be <b>{myLuck.expectedWins.toFixed(1)}-{(played - myLuck.expectedWins).toFixed(1)}</b>,
          {' '}so {myLuck.luck < 0 ? 'the scoreboard owes you' : 'you have banked'} {Math.abs(myLuck.luck).toFixed(1)} wins
          {' '}— {ordinal(pythLeague.length - myLuckIdx)}-unluckiest of {pythLeague.length}.</>
      ) : played > 0 ? <>, which is close to what the scoring deserved.</> : <> with nothing played yet.</>}
    </>,
  });
  if (cap.capEnabled && worstUnit) {
    readLines.push({
      topic: 'Where the money is not',
      text: <>
        The widest gap between what you spend and what the league spends is at <b>{worstUnit.group}</b>:
        {' '}<b>{pct1(worstUnit.share)}</b> of your active salary against a league average of {pct1(worstUnit.leagueMeanShare)},
        {' '}for a unit rated {worstUnit.rating} — {ordinal(worstUnit.rank)} of {teams.length}
        {worstUnit.ratingDelta < 0 ? ', below the league mean.' : ', still above the league mean.'}
      </>,
    });
  }
  if (marginGames.length > 0) {
    readLines.push({
      topic: 'How the games went',
      text: <>
        {marginGames.length} game{marginGames.length === 1 ? '' : 's'} in, you are
        {' '}<b>{marginProfile.oneScoreWins}-{marginProfile.oneScoreLosses}</b> when it comes down to one score
        {' '}and <b>{marginProfile.blowoutWins}-{marginProfile.blowoutLosses}</b> in games decided early
        {marginProfile.blownLeads.length > 0
          ? <>. {marginProfile.blownLeads.length} of those defeats came after leading by ten or more
            — {marginProfile.blownLeads.map((g) => g.oppAbbr).join(', ')}.</>
          : <>, and you have not surrendered a lead of ten.</>}
      </>,
    });
  }
  if (biggestOverpay) {
    readLines.push({
      topic: 'The contract to look at',
      text: <>
        <b>{biggestOverpay.name}</b> ({biggestOverpay.position}, {biggestOverpay.age}) carries {formatMoney(biggestOverpay.hit)}
        {' '}against a {formatMoney(biggestOverpay.marketValue)} market — the widest gap on the roster
        {decliningStory
          ? <>, and the numbers back it up: his {decliningStory.statLabel} have gone
            {' '}<b>{decliningStory.series[0].value} → {decliningStory.series[decliningStory.series.length - 1].value}</b>
            {' '}between {decliningStory.series[0].year} and {decliningStory.series[decliningStory.series.length - 1].year}.</>
          : <>.</>}
      </>,
    });
  }
  if (ageProfile.cliff.startersOver30InTwo > 0 && cap.capEnabled) {
    readLines.push({
      topic: 'Two years out',
      text: <>
        <b>{ageProfile.cliff.startersOver30InTwo}</b> of your {ageProfile.cliff.starterCount} first-teamers will be 30 or older
        {' '}in {league.seasonYear + 2}, and they hold <b>{formatMoney(ageProfile.cliff.starterSpendOver30InTwo)}</b> of the cap today.
      </>,
    });
  }

  // --- the sentence under each war-room board ------------------------------
  const ppd = driveMetrics.find((m) => m.key === 'ppd');
  const ppdAllowed = driveMetrics.find((m) => m.key === 'ppdAllowed');
  const threeOut = driveMetrics.find((m) => m.key === 'threeOut');
  const driveHeadline = ppd && ppdAllowed ? (
    <>
      <b>{me.abbr} score {ppd.value.toFixed(2)} points a drive and give up {ppdAllowed.value.toFixed(2)}.</b>{' '}
      That is {ordinal(ppd.rank)} of {ppd.clubs} with the ball and {ordinal(ppdAllowed.rank)} without it, over
      {' '}{myDriveOffense.drives} drives run and {myDriveDefense.drives} faced.
      {threeOut && <> {threeOut.value.toFixed(1)}% of your possessions end inside three plays, {ordinal(threeOut.rank)} of {threeOut.clubs}.</>}
      {' '}Points per drive is the number to argue about because it takes pace out of it: a club that runs
      twelve possessions a game and one that runs nine are finally comparable.
    </>
  ) : <>Not enough drives yet to rank this club against the league.</>;

  const bestRate = [...rateBoards]
    .filter((b) => b.mine.length > 0)
    .sort((a, b) => (b.mine[0]?.percentile ?? 0) - (a.mine[0]?.percentile ?? 0))[0];
  const worstRate = [...rateBoards]
    .filter((b) => b.mine.length > 0)
    .sort((a, b) => (a.mine[0]?.percentile ?? 0) - (b.mine[0]?.percentile ?? 0))[0];
  const sameMan = bestRate && worstRate && bestRate.mine[0]?.playerId === worstRate.mine[0]?.playerId;
  const rateHeadline = bestRate && worstRate ? (
    <>
      {sameMan && bestRate.key !== worstRate.key ? (
        <>
          <b>{bestRate.mine[0].name}</b> is both ends of this club&apos;s per-play board:
          {' '}{bestRate.label.toLowerCase()} of {bestRate.mine[0].value.toFixed(bestRate.decimals)}{bestRate.unit}
          {' '}({ordinal(bestRate.mine[0].rank)} of {bestRate.mine[0].qualified}) against
          {' '}{worstRate.label.toLowerCase()} of {worstRate.mine[0].value.toFixed(worstRate.decimals)}{worstRate.unit}
          {' '}({ordinal(worstRate.mine[0].rank)}). One man, two very different readings.
        </>
      ) : (
        <>
          <b>{bestRate.mine[0].name}</b> is this club&apos;s strongest per-play number:
          {' '}{bestRate.label.toLowerCase()} of {bestRate.mine[0].value.toFixed(bestRate.decimals)}{bestRate.unit},
          {' '}{ordinal(bestRate.mine[0].rank)} of {bestRate.mine[0].qualified} qualifiers.
          {bestRate.key !== worstRate.key && (
            <> The other end is {worstRate.label.toLowerCase()}: <b>{worstRate.mine[0].name}</b> at
              {' '}{worstRate.mine[0].value.toFixed(worstRate.decimals)}{worstRate.unit},
              {' '}{ordinal(worstRate.mine[0].rank)} of {worstRate.mine[0].qualified}.</>
          )}
        </>
      )}
      {' '}A rate is a claim about a player. The volume behind it is how much the claim is worth.
    </>
  ) : <>Nobody here has the attempts yet to be judged on a rate.</>;

  /** Every link rebuilds the whole query string, so no pill drops another's state. */
  const href = (wantAdvanced: boolean) =>
    `/league/${league.id}/analytics${wantAdvanced ? '?view=advanced' : ''}`;

  return (
    <div className="space-y-4" style={{ ['--team-accent' as never]: accent }}>
      <PageMasthead
        teamId={me.id}
        teamAbbr={me.abbr}
        eyebrow={`${league.seasonYear} · ${phaseLabel} · Week ${league.week}`}
        title="Analytics Department"
        // IN-WORLD VOICE. This said "Everything below is read-only arithmetic
        // over what this save already produced — no projection the sim does not
        // make... Nothing on this screen feeds the simulation back", which is
        // an engineer reassuring another engineer, on the screen a player opens
        // to feel like a front office. README principle 0: the point is a
        // universe you can get lost in, and nothing breaks that faster than the
        // game explaining its own implementation. Say what the room is for.
        subtitle={
          <>
            What the numbers say about this football team. Bring it to
            {' '}<Link href={`/league/${league.id}/cap`} className="text-accent2 hover:underline">the cap sheet</Link> or
            {' '}<Link href={`/league/${league.id}/stats`} className="text-accent2 hover:underline">the stats page</Link> when
            you want to act on it.
          </>
        }
        action={
          <div className="flex gap-1.5">
            <Link href={href(false)} className={`pill ${!advanced ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-chalk'}`}>Simple</Link>
            <Link href={href(true)} className={`pill ${advanced ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-chalk'}`}>Advanced</Link>
          </div>
        }
        facts={facts}
      />

      <AnalyticsShell showEra={hasPreHistory && advanced} showUnits={advanced}>
        <HeadlineRead lines={readLines} leagueId={league.id} teamName={`${me.city} ${me.nickname}`} />

        {/* SIMPLE — the four questions a GM asks out loud, at full width so each
            one has room to be read rather than scanned. */}
        <PanelBoundary span={12} title="Are You Paying For What You're Getting?">
          <SpendVsRatingPanel rows={groups} capEnabled={cap.capEnabled} />
        </PanelBoundary>

        <PanelBoundary span={advanced ? 7 : 12} title="How These Games Are Actually Being Decided">
          <MarginPanel
            span={advanced ? 7 : 12}
            games={marginGames}
            profile={marginProfile}
            thresholds={{ oneScore: ONE_SCORE_MARGIN, blowout: BLOWOUT_MARGIN }}
            teamRatingRank={myRating.rank}
            seasonYear={league.seasonYear}
            playoffGamesExcluded={myGames.filter((g) => g.played && g.kind !== 'REGULAR').length}
            seasonLabel="Regular season"
          />
        </PanelBoundary>

        {advanced && (
          <PanelBoundary span={5} title="What Is Left">
            <WhatIsLeftPanel
              remaining={remaining}
              sosPlayed={sosPlayed}
              remainingOppWinRate={remainingOppWinRate}
              record={{ wins: me.wins, losses: me.losses, ties: me.ties }}
              seasonLength={seasonLength}
              division={divisionTable}
              divisionLabel={`${me.conference} ${me.division}`}
              teamId={me.id}
            />
          </PanelBoundary>
        )}

        <PanelBoundary span={advanced ? 7 : 12} title="Who Outperforms The Deal, Who Is An Anchor">
          <ContractValuePanel
            span={advanced ? 7 : 12}
            bargains={withBody(value.bargains)}
            overpays={withBody(value.overpays)}
            leagueId={league.id}
            teamAccent={accent}
            capEnabled={cap.capEnabled}
            rosterSize={surplusRows.length}
          />
        </PanelBoundary>

        {advanced && (
          <PanelBoundary span={5} title="The Cliff, Two Years Out">
            <CliffPanel
              bands={ageProfile.bands}
              cliff={ageProfile.cliff}
              capHealth={capHealth}
              groups={groups}
              seasonYear={league.seasonYear}
              nextYearCap={capForYear(league.seasonYear + 1, startYear)}
              activeSalary={cap.activeSalary}
              contractCount={rosterRows.length}
              expiringCount={expiringCount}
              capEnabled={cap.capEnabled}
            />
          </PanelBoundary>
        )}

        <PanelBoundary span={12} title="The Luck Ledger">
          <LuckLedgerPanel
            rows={ledger}
            tenureStartYear={startYear}
            seasonYear={league.seasonYear}
            seasonLength={seasonLength}
            teamAbbr={me.abbr}
            hasPreHistory={hasPreHistory && advanced}
            seasonOnLedger={seasonOnLedger}
            thisSeason={myLuck ? {
              wins: me.wins, losses: me.losses, ties: me.ties,
              expectedWins: myLuck.expectedWins, luck: myLuck.luck,
              unluckRank: pythLeague.length - myLuckIdx, clubs: pythLeague.length, played,
            } : null}
          />
        </PanelBoundary>

        {/* ADVANCED — the war room. Everything below costs an extra read or an
            extra thirty seconds of study, and neither is charged to a player
            who only wanted to know whether he is getting value for money. */}
        {advanced && (
          <>
            <PanelBoundary span={12} title="The Drive Board">
              <DriveBoardPanel
                metrics={driveMetrics}
                offense={myDriveOffense}
                defense={myDriveDefense}
                teamAbbr={me.abbr}
                gamesPlayed={marginGames.length}
                headline={driveHeadline}
              />
            </PanelBoundary>

            <PanelBoundary span={12} title="The Efficiency Room">
              <PerPlayPanel
                boards={rateBoards}
                leagueId={league.id}
                teamAbbr={me.abbr}
                gamesPlayed={leagueGamesPlayed}
                missingPositions={rateBoards.filter((b) => b.league.length > 0 && b.mine.length === 0).map((b) => b.label.toLowerCase())}
                headline={rateHeadline}
              />
            </PanelBoundary>

            <PanelBoundary span={12} title="Draft Return By Round">
              <DraftReturnPanel
                bands={draftBands}
                picks={draftRows}
                leagueMeanOvr={leagueMeanOvr}
                years={draftRows.length ? { first: Math.min(...draftRows.map((d) => d.year)), last: Math.max(...draftRows.map((d) => d.year)) } : null}
              />
            </PanelBoundary>

            <PanelBoundary span={12} title="Is The Money Still Climbing?">
              <ProductionPanel
                men={men}
                leagueId={league.id}
                teamAccent={accent}
                teamAbbr={me.abbr}
                seasonYear={league.seasonYear}
              />
            </PanelBoundary>
          </>
        )}
      </AnalyticsShell>

      <NotBuilt advanced={advanced} />
    </div>
  );
}

/**
 * WHAT WE DON'T MEASURE — a short, in-world note, in Advanced only.
 *
 * This used to be six paragraphs headed "What the department cannot tell you,
 * and why", explaining the database to the player: "the database stores no
 * historical rating at unit granularity", "a stat line only exists for a
 * player who recorded a statistic", plus a render timing readout. All true,
 * all engineer-to-engineer, and all of it on a screen whose whole job is to
 * feel like a room in a football club. A real analytics department says "we
 * don't track that" and moves on; it does not apologise for its schema.
 *
 * Honesty is kept, because the alternative is a screen that quietly omits
 * what it cannot compute — see README principle 6. It is just said the way a
 * person would say it.
 */
function NotBuilt({ advanced }: { advanced: boolean }) {
  if (!advanced) return null;
  return (
    <div className="panel p-4 mt-4 text-[11.5px] text-muted leading-relaxed">
      <div className="label-sm text-[10px] mb-2">What we don&apos;t measure</div>
      <p>
        No snap counts, so a lineman&apos;s week leaves no trace and his page stays blank. No play-by-play, so
        nothing here is per-play in the modern sense — drives are the smallest unit we keep. And no archive of
        what a unit rated in past seasons, so every rating on this screen is today&apos;s.
      </p>
    </div>
  );
}
