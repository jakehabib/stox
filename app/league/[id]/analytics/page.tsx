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
import { loadPlayerSeasons, reconstructPlayerSeasons, withAges, ageBasisYear, SeasonLine } from '@/lib/playerSeasons';
import { leadColumnKey, statLabel } from '@/lib/statLabels';
import { canonicalPosition, Position } from '@/lib/tuning';
import { isRankablePosition } from '@/lib/performanceScore';
import { readJson } from '@/lib/json';
import { BoxScore } from '@/lib/types';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import {
  buildPythagoreanTable, buildLuckLedger, buildUnitSpendTable, buildMarginProfile,
  buildAgeProfile, buildDraftReturn, buildCapHealth, strengthOfSchedule,
  classifyContractValue, rankContractValue,
  type SurplusRow, type MarginGame, type DraftPickRow,
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

export default async function AnalyticsPage({ params }: { params: { id: string } }) {
  const startedAt = Date.now();
  const { league, settings, userTeam } = await getLeagueContext(params.id);

  if (!userTeam) {
    return (
      <div className="space-y-4">
        <h1 className="font-display font-extrabold text-3xl uppercase tracking-wide">Analytics Department</h1>
        <div className="panel p-4 text-muted text-sm">
          This save has no club assigned to you, so there is nothing for the department to analyse.
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
      select: { teamId: true, position: true, trueOvr: true, contract: true },
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
    .map((g) => {
      const home = g.homeTeamId === me.id;
      const oppId = home ? g.awayTeamId : g.homeTeamId;
      const opp = teamById.get(oppId)!;
      const oppRating = ratings.get(oppId)!;
      const est = estimateGameWinChance({
        me: myRating!,
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
  let syncedFromTable = true;
  const men: ProductionMan[] = await Promise.all(board.map(async (r) => {
    const pos = canonicalPosition(r.position);
    const key = isRankablePosition(r.position) ? (leadColumnKey(pos) ?? null) : null;

    let lines: SeasonLine[] | null = await loadPlayerSeasons(league.id, r.id);
    if (lines === null) {
      // The table has never been synced for this save. Replaying the box
      // scores gives the identical numbers with a slower read, which is the
      // right trade for a page that would otherwise show an empty panel.
      syncedFromTable = false;
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
      }
      : { label: 'The scoring says', value: '—', detail: 'no games played yet this season' },
    {
      label: 'Roster rating',
      value: String(myRating?.overall ?? '—'),
      detail: myRating ? `${ordinal(myRating.rank)} of ${teams.length} · off ${myRating.offense} · def ${myRating.defense}` : '',
      color: myRating && myRating.rank <= 8 ? 'text-accent' : undefined,
    },
    cap.capEnabled
      ? {
        label: 'Committed',
        value: formatMoney(cap.capUsed),
        detail: `${pct1(cap.capUsed / cap.capTotal)} of the ${formatMoney(cap.capTotal)} ceiling`,
      }
      : { label: 'Committed', value: '—', detail: 'cap mode is off in this league' },
    {
      label: 'Cap-weighted age',
      value: capHealth.capWeightedAge ? capHealth.capWeightedAge.toFixed(1) : '—',
      detail: `roster mean ${capHealth.rosterAvgAge.toFixed(1)} · top 5 hold ${pct1(capHealth.topFiveShare)}`,
    },
    {
      label: 'Projected finish',
      value: remaining.length ? `${projWins.toFixed(1)}-${(seasonLength - projWins).toFixed(1)}` : `${me.wins}-${me.losses}`,
      detail: remaining.length ? `${remaining.length} left, ${remaining.filter((r) => r.home).length} at home` : 'schedule complete',
    },
  ];

  const elapsedMs = Date.now() - startedAt;

  return (
    <div className="space-y-4" style={{ ['--team-accent' as never]: accent }}>
      <PageMasthead
        teamId={me.id}
        teamAbbr={me.abbr}
        eyebrow={`${league.seasonYear} · ${league.phase.toLowerCase()} · week ${league.week}`}
        title="Analytics Department"
        subtitle={
          <>
            Everything below is read-only arithmetic over what this save already produced — no projection the sim
            does not make, no number the game does not use. Nothing on this screen feeds the simulation back.
            {' '}<Link href={`/league/${league.id}/cap`} className="text-accent2 hover:underline">The cap sheet</Link> and
            {' '}<Link href={`/league/${league.id}/stats`} className="text-accent2 hover:underline">the stats page</Link> remain
            the places to act on any of it.
          </>
        }
        facts={facts}
      />

      <AnalyticsShell showEra={hasPreHistory}>
        <LuckLedgerPanel
          rows={ledger}
          tenureStartYear={startYear}
          seasonYear={league.seasonYear}
          seasonLength={seasonLength}
          teamAbbr={me.abbr}
          hasPreHistory={hasPreHistory}
          seasonOnLedger={seasonOnLedger}
          thisSeason={myLuck ? {
            wins: me.wins, losses: me.losses, ties: me.ties,
            expectedWins: myLuck.expectedWins, luck: myLuck.luck,
            unluckRank: pythLeague.length - myLuckIdx, clubs: pythLeague.length, played,
          } : null}
        />

        <SpendVsRatingPanel rows={groups} capEnabled={cap.capEnabled} />

        <MarginPanel
          games={marginGames}
          profile={marginProfile}
          thresholds={{ oneScore: ONE_SCORE_MARGIN, blowout: BLOWOUT_MARGIN }}
          teamRatingRank={myRating?.rank ?? 0}
          seasonYear={league.seasonYear}
          playoffGamesExcluded={myGames.filter((g) => g.played && g.kind !== 'REGULAR').length}
          seasonLabel="Regular season"
        />

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

        <ContractValuePanel
          bargains={withBody(value.bargains)}
          overpays={withBody(value.overpays)}
          leagueId={league.id}
          teamAccent={accent}
          capEnabled={cap.capEnabled}
          rosterSize={surplusRows.length}
        />

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

        <DraftReturnPanel
          bands={draftBands}
          picks={draftRows}
          leagueMeanOvr={leagueMeanOvr}
          years={draftRows.length ? { first: Math.min(...draftRows.map((d) => d.year)), last: Math.max(...draftRows.map((d) => d.year)) } : null}
        />

        <ProductionPanel
          men={men}
          leagueId={league.id}
          teamAccent={accent}
          teamAbbr={me.abbr}
          seasonYear={league.seasonYear}
          syncedFromTable={syncedFromTable}
        />
      </AnalyticsShell>

      <NotBuilt elapsedMs={elapsedMs} groups={groups} />
    </div>
  );
}

/**
 * What this department deliberately does not have, stated once at the bottom
 * rather than eight times in eight panels. A screen that quietly omits what it
 * cannot compute is worse than one that has nothing to say.
 */
function NotBuilt({ elapsedMs, groups }: { elapsedMs: number; groups: ReturnType<typeof buildUnitSpendTable> }) {
  const worst = [...groups].sort((a, b) => a.ratingDelta - b.ratingDelta)[0];
  return (
    <div className="panel p-4 mt-4 text-[11.5px] text-muted leading-relaxed">
      <div className="label-sm text-[10px] mb-2">What the department cannot tell you, and why</div>
      <p>
        <span className="text-chalk font-semibold">Unit strength over time.</span> The database stores no historical
        rating at unit granularity, and it is not reconstructable — ratings drift every offseason and nothing logs
        the change. So this screen can say {worst ? `${worst.group} rates ${worst.rating} today, ${ordinal(worst.rank)} of 32` : 'where each unit rates today'},
        and it cannot say whether that has been true for four years. Drawing that line would mean inventing it.
      </p>
      <p className="mt-2">
        <span className="text-chalk font-semibold">Snap counts and participation.</span> Nothing records who was on
        the field: a stat line only exists for a player who recorded a statistic, so an offensive lineman produces
        no row at all. That is why the production panel has men with no line.
      </p>
      <p className="mt-2">
        <span className="text-chalk font-semibold">Anything below the drive.</span> A stored drive keeps its result,
        points, plays and yards — no down, no distance, no field position. Expected points added, success rate,
        red-zone efficiency and third-and-long conversion are therefore not computable, and none of them is
        approximated here.
      </p>
      <p className="mt-2">
        <span className="text-chalk font-semibold">What the board believed at the pick.</span> Scouting reports are
        re-centred in place as confidence rises, so the projection that was actually made is gone by the time the
        player has a season behind him.
      </p>
      <p className="mt-3 pt-2 border-t border-line/60">
        Computed live from the database in <span className="tabular-nums text-chalk">{elapsedMs}ms</span>. Nothing on
        this page is cached, and nothing on it is stored.
      </p>
    </div>
  );
}
