import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { readJson } from '@/lib/json';
import { buildScoutedView } from '@/lib/scouting';
import { loadScoutMods } from '@/lib/dynasty';
import { ratingColor, playerLabel, positionMoves, relatedPositions, POSITION_WEIGHTS, ATTRIBUTE_BY_KEY, AttrMap } from '@/lib/ratings';
import { rankProspectCombine, ordinal, CombineMeasurable } from '@/lib/combineRank';
import { formatMoney, capHit, marketValue, proration, prorationYears, restructureContract } from '@/lib/cap';
import { classifyContractValue } from '@/lib/analytics';
import { generateScoutingReport } from '@/lib/scoutingProse';
import { teamCapSummary } from '@/lib/cap-summary';
import { sortStatEntries, statLabel, headlineColumns } from '@/lib/statLabels';
import { resolveStartYear } from '@/lib/leagueYear';
import type { Position } from '@/lib/tuning';
import {
  loadPlayerSeasons, reconstructPlayerSeasons, withAges, ageBasisYear, buildCareerTable,
} from '@/lib/playerSeasons';
import { CutButton } from '@/components/CutButton';
import { ContractActions } from '@/components/ContractActions';
import { ContractLedger } from '@/components/ds/ContractLedger';
import { FullScoutButton } from '@/components/FullScoutButton';
import { ShortlistStar } from '@/components/ShortlistStar';
import { WorkoutButton } from '@/components/ds/WorkoutButton';
import { SignOfferForm } from '@/components/SignOfferForm';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { TeamLogo } from '@/components/TeamLogo';
import { ScoutingRange } from '@/components/ds/ScoutingRange';
import { SectionHeading } from '@/components/ds/SectionHeading';
import { StatNumber } from '@/components/ds/StatNumber';
import { RatingBadge } from '@/components/ds/RatingBadge';
import { PlayerCardTabs } from '@/components/ds/PlayerCardTabs';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { loadWorkoutSlots } from '@/lib/workouts';
import {
  CollegeProfile, CombineTesting, aggregateCollegeGames, collegeWeeksElapsed,
  prospectBuzzNote, COLLEGE_WEEKS,
} from '@/lib/gen/prospectProfile';
import { CollegeStatLine } from '@/components/CollegeStatLine';
import { Tooltip } from '@/components/Tooltip';
import { tip } from '@/lib/glossary';
import { CareerHonors, HonorAward } from '@/components/ds/CareerHonors';
import { CareerStatTable } from '@/components/ds/CareerStatTable';
import { StatScopeToggle, STAT_SCOPE_PARAM, parseStatScope } from '@/components/ds/StatScopeToggle';
import { ringYearsFor } from '@/lib/gen/leagueHistory';
import { allStarYearsFor } from '@/lib/allStars';
import { startersAt } from '@/lib/lineup';
import { slotVerdict } from '@/components/ds/DepthCompare';
import { PositionChangeCard, PositionOption } from '@/components/PositionChangeCard';

/** Transaction types lib/season.ts writes one of per award, per season. */
const AWARD_LABEL: Record<string, string> = {
  AWARD_MVP: 'MVP', AWARD_OPOY: 'Offensive Player of the Year', AWARD_DPOY: 'Defensive Player of the Year',
  AWARD_ROTY: 'Rookie of the Year', AWARD_SBMVP: 'Championship MVP',
};

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: { id: string; playerId: string };
  searchParams: { split?: string };
}) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  // Which half of the year this card's stat sections are about. In the URL so
  // a reload and a shared link both keep it; regular season by absence.
  const statScope = parseStatScope(searchParams?.[STAT_SCOPE_PARAM]);
  const showPlayoffs = statScope === 'PLAYOFFS';
  // The fragment keeps the reader where they were: flipping the toggle is a
  // full navigation, and landing back at the top of a long player card reads
  // as "nothing happened".
  const scopeHref = (playoffs: boolean) =>
    `/league/${params.id}/player/${params.playerId}${playoffs ? `?${STAT_SCOPE_PARAM}=playoffs` : ''}`;
  const player = await prisma.player.findUnique({ where: { id: params.playerId }, include: { contract: true, team: true } });
  if (!player || player.leagueId !== league.id) notFound();

  const report = userTeam
    ? await prisma.scoutingReport.findUnique({ where: { playerId_teamId: { playerId: player.id, teamId: userTeam.id } } })
    : null;

  const isOwnRoster = player.teamId === userTeam?.id;
  // Scouting-branch skills narrow the bands this view reports. Without this the
  // GM buys a rank and sees no change on the one screen the rank is about.
  const scoutMods = await loadScoutMods(league.id);
  const view = buildScoutedView({
    // The card is the one route that serves BOTH populations, so the gate is
    // read straight off the record: a draft prospect keeps his ranges and his
    // workout/Full Scout affordances; a professional — yours, another club's,
    // or a free agent — shows his true ratings. Deliberate scope decision (see
    // the SCOPE block in lib/scouting.ts), not a fog bug to be restored.
    isProspect: player.isDraftee,
    position: player.position as any, trueAttrs: readJson(player.trueAttrs, {}), trueOvr: player.trueOvr, potential: player.potential,
    report, settings, isOwnRoster, isUserView: true, dynasty: scoutMods,
  });

  // Scouting a prospect is no longer something you buy per click. The two
  // affordances left are a star — which puts him in front of your staff every
  // week for nothing — and, in the pre-draft window, one of the year's handful
  // of private workouts.
  const prospectScouting = userTeam && player.isDraftee
    ? await Promise.all([
        loadWorkoutSlots(league.id),
        prisma.shortlistEntry.findUnique({ where: { playerId_teamId: { playerId: player.id, teamId: userTeam.id } } }),
      ])
    : null;
  const workoutSlots = prospectScouting?.[0] ?? null;
  const onShortlist = !!prospectScouting?.[1];
  const workedOutThisYear = !!workoutSlots && report?.workoutYear === workoutSlots.seasonYear;

  // Regular season and postseason are stored apart (see Player.seasonStats in
  // the schema) and are never added together here — the toggle picks one.
  const seasonStats = readJson<Record<string, number>>(player.seasonStats, {});
  const careerStats = readJson<Record<string, number>>(player.careerStats, {});
  const playoffStats = readJson<Record<string, number>>(player.playoffStats, {});
  const careerPlayoffStats = readJson<Record<string, number>>(player.careerPlayoffStats, {});
  const shownSeasonStats = showPlayoffs ? playoffStats : seasonStats;
  const shownCareerStats = showPlayoffs ? careerPlayoffStats : careerStats;
  const hit = capHit(player.contract, settings.capMode);
  const capSummary = userTeam && settings.capMode !== 'OFF'
    ? await teamCapSummary(userTeam.id, league.seasonYear, settings.capMode)
    : null;
  const capSpace = capSummary ? capSummary.capSpace : Number.MAX_SAFE_INTEGER;

  const jerseyColor = player.team ? generateTeamLogoParams(player.team.abbr).primary : undefined;
  const label = playerLabel({
    ovr: view.scoutedOvr,
    potential: view.potentialRevealed ? player.potential : (view.potLow + view.potHigh) / 2,
    isDraftee: player.isDraftee,
    experience: player.experience,
    confidence: view.confidence,
  });
  // Top few stat lines for the hero — the full breakdown still lives in the
  // Season/Career Stats sections below; this is a headline, not a replacement.
  const keyStats = sortStatEntries(seasonStats).slice(0, 3);

  // Older test data predates this feature — collegeStats/combineTesting
  // parse fine as "{}" (not a parse failure, so readJson's fallback never
  // kicks in) but with no real fields, so check for actual content.
  const collegeProfileRaw = player.isDraftee ? readJson<Partial<CollegeProfile>>(player.collegeStats, {}) : null;
  const collegeProfile = collegeProfileRaw?.games?.length ? (collegeProfileRaw as CollegeProfile) : null;
  const combineRaw = player.isDraftee ? readJson<Partial<CombineTesting>>(player.combineTesting, {}) : null;
  const combineTesting = combineRaw?.venue ? (combineRaw as CombineTesting) : null;
  // Testing numbers are PUBLIC — every team watches the same combine — so
  // this ranks against the whole position group in the class with no fog
  // gating, unlike the scouted attribute ranges above. draftYear scopes the
  // peer group to prospects generated in the same class, not every CB who's
  // ever passed through isDraftee:true.
  const combinePeers = combineTesting && player.draftYear != null
    ? await prisma.player.findMany({
        where: { leagueId: league.id, isDraftee: true, position: player.position, draftYear: player.draftYear },
        select: { combineTesting: true },
      })
    : [];
  const combineRanks = combineTesting
    ? rankProspectCombine(
        combineTesting,
        combinePeers
          .map((p) => readJson<Partial<CombineTesting>>(p.combineTesting, {}))
          .filter((c): c is CombineTesting => !!c.venue),
      )
    : {};
  const weeksElapsed = collegeWeeksElapsed(league.week);
  const collegeToDate = collegeProfile ? aggregateCollegeGames(collegeProfile.games, weeksElapsed) : null;
  const buzzNote = collegeProfile
    ? prospectBuzzNote(player.trueOvr, player.potential, view.scoutedOvr, view.confidence, collegeProfile.competitionGrade)
    : null;
  const GRADE_CLASS: Record<string, string> = { A: 'text-gold', B: 'text-accent', C: 'text-chalk', D: 'text-warn', F: 'text-bad' };

  // --- Year-by-year stat lines --------------------------------------------
  // The season rows come from played box scores, which is the only place the
  // club-he-played-for-THAT-year actually exists: seasonStats and careerStats
  // are merged blobs with no season and no team on them. Whatever careerStats
  // carries beyond what the box scores account for is history this league
  // never recorded — it becomes one honestly-labelled "Before <year>" row and
  // is never split into invented seasons. See lib/playerSeasons.ts.
  //
  // A draftee has never played a down here, so he gets the College Profile
  // above instead and this doesn't run at all.
  const careerTable = player.isDraftee ? null : await (async () => {
    const [persisted, startYear] = await Promise.all([
      loadPlayerSeasons(league.id, player.id),
      resolveStartYear(league),
    ]);
    const basis = ageBasisYear(league);
    const common = {
      position: player.position,
      liveInProgress: league.phase === 'REGULAR' || league.phase === 'PLAYOFFS',
      careerStats,
      careerPlayoffStats,
      startYear,
      scope: statScope,
    };

    // The season in progress never comes from PlayerSeason — its rows aren't
    // written until the rollover — so it is always replayed from this year's
    // box scores. That is also what lets the CURRENT year split a mid-season
    // trade correctly instead of filing the whole year under whichever jersey
    // he happens to be wearing today.
    if (persisted) {
      const live = withAges(
        await reconstructPlayerSeasons(league.id, player.id, league.seasonYear), player, basis,
      );
      return buildCareerTable({
        ...common,
        seasons: persisted.filter((l) => l.seasonYear < league.seasonYear),
        live,
      });
    }

    // No rows for this league yet — a save that hasn't rolled over since the
    // table landed. Replay everything instead of showing an empty table; the
    // numbers are identical, it just isn't indexed.
    const aged = withAges(await reconstructPlayerSeasons(league.id, player.id), player, basis);
    return buildCareerTable({
      ...common,
      seasons: aged.filter((l) => l.seasonYear < league.seasonYear),
      live: aged.filter((l) => l.seasonYear === league.seasonYear),
    });
  })();

  // Your team's current depth at this player's position — the point is
  // answering "do I need a replacement here" without leaving the card,
  // whether you're looking at your own player, a free agent, or a trade
  // target on another roster.
  const depthChart = userTeam
    ? await prisma.depthChartSlot.findMany({
        where: { teamId: userTeam.id, position: player.position },
        orderBy: { rank: 'asc' },
        include: { player: true },
      })
    : [];

  /**
   * ===========================================================================
   * WHERE ELSE COULD HE PLAY?
   * ===========================================================================
   * The app owner's hole — *"if someone has two solid RT and a weak LT, they
   * can't swap the spare RT over"* — and his own fix: change the man's
   * position here, on his card.
   *
   * Two things are computed per destination and NEITHER of them is invented
   * here:
   *
   *   WHAT HE WOULD RATE comes from `positionMove` (lib/ratings.ts), which
   *   re-weights his attributes through the destination's own formula. It is
   *   the SAME call `changePositionAction` makes when the button is pressed,
   *   so the preview cannot differ from the commit (README principle 6).
   *
   *   WHERE HE WOULD LAND comes from `slotVerdict`
   *   (components/ds/DepthCompare.tsx), which is what the free-agency screen
   *   already uses to answer "would he start", built on lib/lineup.ts's one
   *   definition of the eleven. A position change and a signing are the same
   *   question asked twice — a new man arriving at a position group — so they
   *   get the same answer from the same function. Writing a second one here
   *   is how this codebase once ended up with three starting lineups.
   *
   * Own roster only, and never a draftee: a prospect's position is what your
   * scouts filed him under, and moving it would be editing a report rather
   * than making a coaching decision. The server action re-checks both.
   */
  const positionTargets = isOwnRoster && !player.isDraftee ? relatedPositions(player.position) : [];
  const moveDepthSlots = positionTargets.length > 0 && userTeam
    ? await prisma.depthChartSlot.findMany({
        where: { teamId: userTeam.id, position: { in: positionTargets } },
        orderBy: { rank: 'asc' },
        include: { player: { select: { id: true, firstName: true, lastName: true, trueOvr: true, age: true } } },
      })
    : [];
  const moveOptions: PositionOption[] = positionTargets.length === 0 ? [] : positionMoves({
    position: player.position,
    trueOvr: player.trueOvr,
    trueAttrs: readJson<AttrMap>(player.trueAttrs, {}),
  }).map((mv) => {
    // In depth-chart order, not rating order — the order IS who plays, and a
    // GM who benched a 90 for a rookie meant it.
    const depth = moveDepthSlots
      .filter((sl) => sl.position === mv.position)
      .map((sl) => ({
        playerId: sl.player.id,
        name: `${sl.player.firstName} ${sl.player.lastName}`,
        ovr: sl.player.trueOvr,
        age: sl.player.age,
      }));
    const v = slotVerdict(mv.position, depth, { ovrLow: mv.ovr, ovrHigh: mv.ovr, revealed: true });
    return {
      position: mv.position,
      ovr: mv.ovr,
      delta: mv.delta,
      // Attribute LABELS, not keys: "Block Shedding" is a football word and
      // `blockShed` is a column name.
      learned: mv.learned.map((k) => ATTRIBUTE_BY_KEY[k]?.label ?? k),
      starterCount: v.starterCount,
      starts: v.outcome === 'OPEN' || v.outcome === 'STARTER',
      slotOpen: v.outcome === 'OPEN',
      displaces: v.displaces ? { id: v.displaces.playerId, name: v.displaces.name, ovr: v.displaces.ovr, age: v.displaces.age } : null,
      threshold: v.threshold,
      incumbentBest: depth[0] ? { name: depth[0].name, ovr: depth[0].ovr } : null,
    };
  })
    /**
     * MOVES THAT CHANGE THE LINEUP COME FIRST, then by what he would rate.
     *
     * `positionMoves` sorts by rating alone, because it is pure and knows
     * nothing about this club. Rating alone buried the decision: a spare right
     * tackle rates a point higher at guard than at left tackle, so "LG 79,
     * behind your 87" sat above "LT 78, starts over your 67" — the two rows a
     * GM does not care about, on top of the one he opened the card for.
     *
     * Sorting by "would he be on the field" is not a second opinion about who
     * starts; it is `slotVerdict`'s answer, computed once above and reused as
     * a sort key. Ties still fall to the higher rating, so the ordering inside
     * each half is the same one lib/ratings.ts produced.
     */
    .sort((a, b) => Number(b.starts || b.slotOpen) - Number(a.starts || a.slotOpen) || b.ovr - a.ovr);

  // Contract facts get their own strip under the hero — the money questions
  // ("what does he cost, what's he worth, what would walking away cost")
  // answered together instead of scattered down the page. A draftee has no
  // contract yet, so his strip is his college production instead.
  // A draftee has no NFL season yet, so his headline numbers are college
  // production instead — the same "three numbers that matter" treatment,
  // sourced from the profile that's already revealed week by week.
  const COLLEGE_HEADLINE: Record<string, [keyof NonNullable<typeof collegeToDate>, string][]> = {
    QB: [['passYds', 'Pass Yds'], ['passTd', 'Pass TD'], ['passInt', 'INT']],
    RB: [['rushYds', 'Rush Yds'], ['rushTd', 'Rush TD'], ['rushAtt', 'Carries']],
    FB: [['rushYds', 'Rush Yds'], ['rushTd', 'Rush TD'], ['rec', 'Rec']],
    WR: [['recYds', 'Rec Yds'], ['rec', 'Rec'], ['recTd', 'Rec TD']],
    TE: [['recYds', 'Rec Yds'], ['rec', 'Rec'], ['recTd', 'Rec TD']],
    EDGE: [['sacks', 'Sacks'], ['tkl', 'Tackles'], ['tfl', 'TFL']],
    DT: [['sacks', 'Sacks'], ['tkl', 'Tackles'], ['tfl', 'TFL']],
    LB: [['tkl', 'Tackles'], ['sacks', 'Sacks'], ['tfl', 'TFL']],
    CB: [['ints', 'INT'], ['pd', 'Pass Def'], ['tkl', 'Tackles']],
    S: [['tkl', 'Tackles'], ['ints', 'INT'], ['pd', 'Pass Def']],
    LT: [['pancakes', 'Pancakes'], ['sacksAllowed', 'Sacks All.']],
    RT: [['pancakes', 'Pancakes'], ['sacksAllowed', 'Sacks All.']],
    LG: [['pancakes', 'Pancakes'], ['sacksAllowed', 'Sacks All.']],
    RG: [['pancakes', 'Pancakes'], ['sacksAllowed', 'Sacks All.']],
    C: [['pancakes', 'Pancakes'], ['sacksAllowed', 'Sacks All.']],
    K: [['fgMade', 'FG Made'], ['fgAtt', 'FG Att'], ['xpMade', 'XP Made']],
    P: [['punts', 'Punts'], ['puntYds', 'Punt Yds']],
  };
  const collegeHeadline = collegeToDate
    ? (COLLEGE_HEADLINE[player.position] ?? [])
        .map(([key, lbl]) => [lbl, collegeToDate[key] ?? 0] as const)
        .filter(([, v]) => v > 0)
    : [];

  // --- Career honors -------------------------------------------------------
  // Awards are matched by name because Transaction has no player relation —
  // safe here because lib/gen/names.ts's NameRegistry guarantees no two
  // players in a league ever share one. Rings can't be looked up at all:
  // nothing records which roster a generated veteran was on eight years ago,
  // so lib/gen/leagueHistory.ts derives them deterministically from his own
  // id, his club's actual title years, and his calibre. Both queries return
  // nothing for a save created before any of this existed, and the block
  // simply doesn't render.
  const careerStartYear = league.seasonYear - player.experience;
  const [awardTxs, titleSeasons, allStarYears] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        leagueId: league.id, type: { in: Object.keys(AWARD_LABEL) },
        headline: { startsWith: `${player.firstName} ${player.lastName} (` },
      },
      orderBy: { seasonYear: 'asc' },
    }),
    player.teamId
      ? prisma.teamSeasonRecord.findMany({
          where: { teamId: player.teamId, playoffResult: 'CHAMPION' },
          select: { year: true }, orderBy: { year: 'asc' },
        })
      : Promise.resolve([]),
    // Read back rather than listed among the awards above: a selection is not
    // a trophy with a name, it is a season he was one of the best at his
    // position, and CareerHonors counts them ("4x All-Star") instead of
    // printing four identical rows. Matched by name, like the awards, because
    // Transaction has no player relation — see lib/allStars.ts.
    allStarYearsFor(league.id, player.firstName, player.lastName),
  ]);
  const honorAwards: HonorAward[] = awardTxs.map((t) => ({
    year: t.seasonYear, label: AWARD_LABEL[t.type] ?? t.type, statLine: t.detail,
  }));
  const ringYears = player.isDraftee ? [] : ringYearsFor({
    playerId: player.id, trueOvr: player.trueOvr, careerStartYear,
    currentYear: league.seasonYear, titleYears: titleSeasons.map((s) => s.year),
  });
  const market = marketValue({ ovr: view.scoutedOvr, position: player.position as any, age: player.age, potential: player.potential });
  const capTotal = capSummary?.capTotal ?? 0;
  const valueTier = player.contract ? classifyContractValue(market - hit, market) : 'market';

  const scoutingReport = generateScoutingReport({
    playerId: player.id,
    position: player.position as any,
    age: player.age,
    experience: player.experience,
    isDraftee: player.isDraftee,
    view,
  });
  /**
   * ===========================================================================
   * THE BAND UNDER THE HERO — TWO FIGURES, THEN THE WAY THROUGH
   * ===========================================================================
   * This strip used to carry five money cells: cap hit, market value, years
   * left, guaranteed and release cost. Three of them were already printed by
   * the contract ledger further down the same page, and the app owner's read
   * of the card that resulted was that the contract arrived too early and too
   * often. So the band now carries the two figures a GM checks in passing —
   * what he costs this season, and how long he is under contract — and the
   * whole deal lives one click away on the Contract tab, which owns the same
   * band. Nothing is lost: market value moved into that tab's terms row, and
   * guaranteed and dead-money-if-cut were always the ledger's own columns.
   *
   * A draft prospect has no contract to summarise, so his band stays what it
   * was: the five scouting facts that decide where he goes in the draft.
   */
  const bandFacts: { label: string; value: string; detail?: string; color?: string; tip?: string }[] = player.isDraftee
    ? [
        { label: 'Draft Class', value: String(league.seasonYear), detail: player.college },
        { label: 'Projection', value: label.label, detail: 'role this profile suggests', color: label.className, tip: tip('prospectProjection') },
        ...(combineTesting ? [{ label: '40-Yard', value: `${combineTesting.fortyYard.toFixed(2)}s`, detail: combineTesting.venue === 'COMBINE' ? 'NFL Combine' : 'Pro Day', tip: tip('combineForty') }] : []),
        ...(collegeProfile ? [{ label: 'Competition', value: `${collegeProfile.competitionGrade}-tier`, detail: 'strength of schedule faced', color: GRADE_CLASS[collegeProfile.competitionGrade], tip: tip('competitionGrade') }] : []),
        { label: 'Measurables', value: `${Math.floor(player.heightIn / 12)}'${player.heightIn % 12}"`, detail: `${player.weightLb} lb` },
      ]
    : [
        // With the cap off there is no cap hit to quote — the ledger says so in
        // words — and a man with no contract has no charge either. Both of
        // those cases lead with what the rating is worth instead, which is the
        // figure this strip carried for them before.
        settings.capMode !== 'OFF' && player.contract
          ? {
              label: `Cap Hit ${league.seasonYear}`,
              value: formatMoney(hit),
              detail: capTotal > 0 ? `${((hit / capTotal) * 100).toFixed(1)}% of cap` : undefined,
              tip: tip('capHit'),
            }
          : {
              label: 'Market Value',
              value: `${formatMoney(market)}/yr`,
              detail: 'what the rating is worth',
              tip: tip('marketValue'),
            },
        {
          label: 'Years Left',
          value: player.contract ? String(player.contract.yearsRemaining) : '—',
          detail: player.contract ? `expires after ${league.seasonYear + Math.max(0, player.contract.yearsRemaining - 1)}` : 'no contract',
          tip: tip('expiringContract'),
        },
      ];

  // --- The deal as signed --------------------------------------------------
  // Everything below comes out of lib/cap.ts against the stored contract — the
  // same functions the sim charges. The ledger owns cap hit, remaining value,
  // guaranteed and dead money; this row owns the terms, and the two never
  // print the same figure twice.
  const contractBases = player.contract ? readJson<number[]>(player.contract.baseSalaries, []) : [];
  const contractTotal = player.contract
    ? contractBases.reduce((a, b) => a + b, 0) + player.contract.signingBonus
    : 0;
  const bonusPerYear = player.contract ? proration(player.contract) : 0;
  const bonusThrough = player.contract ? player.contract.signedYear + prorationYears(player.contract) - 1 : 0;

  /**
   * What the Restructure button would actually do, from the function the
   * restructure screen itself calls: convert as much of this year's base as
   * the rules allow and re-prorate what that creates. Quoted only where the
   * button is really offered — his own roster, realistic cap, and not in the
   * last year of the deal, which is the same gate ContractActions applies.
   */
  const restructureFrees = (() => {
    const c = player.contract;
    if (!c || !isOwnRoster || settings.capMode !== 'REALISTIC' || c.yearsRemaining <= 1) return 0;
    const next = restructureContract(c, Number.MAX_SAFE_INTEGER, { nowYear: league.seasonYear });
    return hit - capHit({ ...next, baseSalaries: JSON.stringify(next.baseSalaries) }, settings.capMode);
  })();

  /**
   * ATTRIBUTES, ORDERED BY WHAT THEY DECIDE.
   *
   * The share is the weight `computeOverall` actually applies — normalised
   * across the weights present, exactly as that function normalises them — so
   * the column adds to 100% and can never claim a weight the engine does not
   * use. It matters that this is computed and not written down: LB's weights
   * deliberately sum to 1.18 so that adding run defence to the position did
   * not move every existing linebacker's rating, and a hand-written percentage
   * table would have been wrong for that position the day it landed.
   *
   * The VALUES stay whatever the scouted view handed over. A man the club has
   * not had in its own building never reaches this code with his true numbers
   * in hand — `buildScoutedView` is the only source, and the fogged branch
   * below prints its band, never `actual`.
   */
  const positionWeights: AttrMap = POSITION_WEIGHTS[player.position as Position] ?? {};
  const attrWeightTotal = view.attrs.reduce((a, at) => a + (positionWeights[at.key] ?? 0), 0);
  const attrRows = view.attrs
    .map((a) => ({ ...a, share: attrWeightTotal > 0 ? (positionWeights[a.key] ?? 0) / attrWeightTotal : 0 }))
    .sort((a, b) => b.share - a.share);

  const hero = (
    <div className="flex flex-wrap items-start gap-6 p-6">
      <div className="relative shrink-0 rounded-lg p-3" style={{ background: jerseyColor ? `color-mix(in srgb, ${jerseyColor} 14%, transparent)` : undefined }}>
        <PlayerAvatar seed={player.id} age={player.age} size={128} teamColor={jerseyColor} weightLb={player.weightLb} heightIn={player.heightIn} position={player.position} />
      </div>

      <div className="flex-1 min-w-[280px]">
        {/* Everything identifying him on one quiet meta line, so the name
            below it has the page to itself. */}
        <div className="label-sm flex items-center gap-2 flex-wrap">
          <span className={`font-semibold ${positionBadgeClass(player.position)}`}>{player.position}</span>
          <span>·</span><span>Age {player.age}</span>
          <span>·</span><span>{player.experience > 0 ? `Year ${player.experience}` : 'Rookie'}</span>
          <span>·</span>
          {player.team ? (
            <span className="flex items-center gap-1.5"><TeamLogo seed={player.team.id} abbr={player.team.abbr} size={14} />{player.team.city} {player.team.nickname}</span>
          ) : (
            <span>{player.status === 'FREE_AGENT' ? (player.isDraftee ? 'Draft Prospect' : 'Free Agent') : player.status}</span>
          )}
          <span className={`pill text-[10px] border-current ${label.className}`}>{label.label}</span>
          {/* Availability is the first thing a GM checks about a player, so it
              sits in the hero with the rest of his identity rather than in a
              panel below. */}
          {player.injuryWeeks > 0 && (
            <span className="pill text-[10px] border-bad/50 text-bad bg-bad/10">
              {player.injuryType ?? 'Injured'} · out {player.injuryWeeks} wk{player.injuryWeeks === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {/* Split name — given name reads as a kicker over the surname, which
            is the part that carries on a jersey. */}
        <div className="mt-2">
          <div className="font-display font-bold text-xl uppercase tracking-[0.18em] text-muted leading-none">{player.firstName}</div>
          <div className="font-display font-extrabold text-5xl uppercase tracking-wide leading-[0.95] mt-1">{player.lastName}</div>
        </div>

        <div className="text-xs text-muted mt-2">
          {Math.floor(player.heightIn / 12)}&apos;{player.heightIn % 12}&quot; · {player.weightLb} lb · {player.college}
        </div>

        {/* What he has won, beside his name — counts and the most recent year
            only. The full list stays in Career &amp; Honors below. */}
        {(ringYears.length > 0 || honorAwards.length > 0 || allStarYears.length > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {ringYears.length > 0 && (
              <span className="pill border-warn/40 text-warn bg-warn/10 gap-1.5">
                {ringYears.length}× Champion
                <span className="text-muted font-normal">{ringYears[ringYears.length - 1]}</span>
              </span>
            )}
            {honorAwards.length > 0 && (
              <span className="pill border-accent2/40 text-accent2 bg-accent2/10 gap-1.5">
                {honorAwards.length === 1 ? honorAwards[0].label : `${honorAwards.length}× Award winner`}
                <span className="text-muted font-normal">{honorAwards[honorAwards.length - 1].year}</span>
              </span>
            )}
            {allStarYears.length > 0 && (
              <span className="pill border-line text-chalk gap-1.5">
                {allStarYears.length}× All-Star
                <span className="text-muted font-normal">{allStarYears[allStarYears.length - 1]}</span>
              </span>
            )}
          </div>
        )}

        {collegeHeadline.length > 0 ? (
          <div className="mt-5 border-t border-line/50 pt-4">
            <div className="label-sm text-accent2 mb-2">College — through week {weeksElapsed} of {COLLEGE_WEEKS}</div>
            <div className="flex items-stretch gap-6 flex-wrap">
              {collegeHeadline.map(([lbl, v]) => (
                <div key={lbl} className="pr-6 border-r border-line/40 last:border-r-0 last:pr-0">
                  <div className="label-sm">{lbl}</div>
                  <div className="stat-value text-stat-md leading-none mt-1">{v.toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        ) : keyStats.length > 0 ? (
          /* Regular season, always — the hero is the player's headline number
             and the postseason has its own view below. Said out loud rather
             than assumed, because an unlabelled total that quietly means one
             of two things is this codebase's most repeated bug. */
          <div className="flex items-stretch gap-6 mt-5 border-t border-line/50 pt-4 flex-wrap">
            <div className="pr-6 border-r border-line/40 self-center">
              <div className="label-sm">{league.seasonYear}</div>
              <div className="text-xs text-muted mt-1">Regular season</div>
            </div>
            {keyStats.map(([k, v]) => (
              <div key={k} className="pr-6 border-r border-line/40 last:border-r-0 last:pr-0">
                <div className="label-sm">{statLabel(k)}</div>
                <div className="stat-value text-stat-md leading-none mt-1">{v}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col items-center gap-3 shrink-0 w-[200px]">
        {view.revealed ? (
          /* The design system's own rating shape — the notched chip, which
             carries the tier colour, the 95+ mark and the 99 plate itself. */
          <RatingBadge value={view.scoutedOvr} label="Overall" size="lg" filled />
        ) : (
          <div className="panel p-3 w-full">
            <ScoutingRange low={view.ovrLow} high={view.ovrHigh} confidence={view.confidence} label="Scouted OVR" tip={tip('scoutedRange')} className="w-full" />
          </div>
        )}
        {/* Potential follows the same rule as Overall: a certain number is said
            plainly and only a real range gets the band widget. */}
        <div className="panel p-3 w-full text-center">
          {view.potentialRevealed ? (
            <>
              <div className="label-sm inline-flex items-center gap-1.5">
                Potential
                <Tooltip text={tip('potential')} />
              </div>
              <div className={`stat-value text-stat-md leading-none mt-1 ${ratingColor(player.potential)}`}>{player.potential}</div>
            </>
          ) : view.revealed ? (
            /* An established pro on somebody else's books: his rating is exact
               and his ceiling is not. A ScoutingRange here would put
               "Confidence: HIGH" under it and invite the reader to think the
               band narrows with work — it does not, ever. */
            <>
              <div className="label-sm inline-flex items-center gap-1.5">
                Potential
                <Tooltip text={tip('potential')} />
              </div>
              <div className={`stat-value text-stat-md leading-none mt-1 ${ratingColor((view.potLow + view.potHigh) / 2)}`}>
                {view.potLow}–{view.potHigh}
              </div>
              <div className="text-[11px] text-muted mt-1">You would have to coach him to know exactly.</div>
            </>
          ) : (
            <ScoutingRange low={view.potLow} high={view.potHigh} confidence={view.confidence} label="Potential" tip={tip('potential')} className="w-full" />
          )}
        </div>
      </div>
    </div>
  );

  const bandCells = bandFacts.map((f) => (
    <div key={f.label} className="px-5 py-4">
      <div className="label-sm inline-flex items-center gap-1.5">
        {f.label}
        {f.tip && <Tooltip text={f.tip} />}
      </div>
      <div className={`stat-value text-stat-sm leading-none mt-1.5 ${f.color ?? ''}`}>{f.value}</div>
      {f.detail && <div className="text-[11px] text-muted mt-1">{f.detail}</div>}
    </div>
  ));

  const statsPane = (
    <div className="space-y-6">
      {/* One row per season the league has actually played, plus at most one
          "Before <year>" row and the career total. */}
      {careerTable && (
        <div className="section" id="stat-line">
          <SectionHeading
            eyebrow="Year by year"
            title={showPlayoffs ? 'Career Stat Line — Postseason' : 'Career Stat Line'}
            action={
              <StatScopeToggle
                scope={statScope}
                regularHref={scopeHref(false)}
                playoffHref={scopeHref(true)}
              />
            }
          />
          <div className="panel overflow-hidden">
            <CareerStatTable position={player.position} table={careerTable} />
          </div>
        </div>
      )}

      {/* A prospect's production is his college tape, and it leads his card the
          way a professional's season line leads his. */}
      {collegeProfile && collegeToDate && combineTesting && (
        <div className="section">
          <SectionHeading
            title={`College Profile — ${player.college}`}
            action={<span className={`text-xs font-medium ${GRADE_CLASS[collegeProfile.competitionGrade]}`}>Competition: {collegeProfile.competitionGrade}-tier</span>}
          />
          <div className="panel overflow-hidden">
            {/* Testing gets its own full-width band of equal tiles — six
                measurements read as one workout, not a cramped 3x2 grid. */}
            <div className="px-5 pt-4 pb-3 border-b border-line/60">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div className="label-sm inline-flex items-center gap-1.5">
                  {combineTesting.venue === 'COMBINE' ? 'NFL Combine' : 'Pro Day'} Testing
                  {/* Downward, every one of these: the testing band is the FIRST
                      thing in a `panel overflow-hidden`, so an upward bubble
                      opens straight out of the top of the card and is cut. */}
                  <Tooltip placement="bottom" text={combineTesting.venue === 'COMBINE' ? tip('combineTesting') : tip('proDay')} />
                </div>
                <div className="text-xs text-muted">
                  {combineTesting.venue === 'COMBINE'
                    ? 'Measured under standard conditions at the league combine.'
                    : 'Self-hosted pro day — conditions favor the prospect, so times tend to run a touch fast.'}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 divide-x divide-line/40 border-b border-line/60">
              {([
                // Every drill carries its own tip: the whole band is jargon to
                // anyone who has not sat through a combine broadcast.
                { label: '40-Yard', value: `${combineTesting.fortyYard.toFixed(2)}s`, key: 'fortyYard', tip: tip('combineForty') },
                { label: 'Vertical', value: `${combineTesting.vertical}"`, key: 'vertical', tip: tip('combineVertical') },
                { label: 'Broad', value: `${combineTesting.broadJump}"`, key: 'broadJump', tip: tip('combineBroad') },
                { label: '3-Cone', value: `${combineTesting.threeCone.toFixed(2)}s`, key: 'threeCone', tip: tip('combineThreeCone') },
                { label: 'Shuttle', value: `${combineTesting.shuttle.toFixed(2)}s`, key: 'shuttle', tip: tip('combineShuttle') },
                { label: 'Bench', value: combineTesting.benchReps !== null ? `${combineTesting.benchReps}` : '—', key: 'benchReps', tip: tip('combineBench') },
              ] as { label: string; value: string; key: CombineMeasurable; tip: string }[]).map((m, i, all) => {
                const rank = combineRanks[m.key];
                return (
                  <div key={m.label} className="px-3 py-3 text-center">
                    <div className="label-sm inline-flex items-center gap-1">
                      {m.label}
                      {/* The end tiles open INWARD — a centred bubble on the
                          first or last of six is half outside the panel. */}
                      <Tooltip
                        placement="bottom"
                        align={i === 0 ? 'start' : i === all.length - 1 ? 'end' : 'center'}
                        text={m.tip}
                      />
                    </div>
                    <div className="stat-value text-stat-sm leading-none mt-1.5">{m.value}</div>
                    {/* Public combine data — never fogged, so this shows for
                        every prospect regardless of scouting confidence. */}
                    <div className="text-[10px] text-muted mt-1">
                      {rank ? `${ordinal(rank.rank)} of ${rank.outOf}` : ' '}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-5">
              <div className="label-sm mb-2">College Season — through week {weeksElapsed} of {COLLEGE_WEEKS}</div>
              <CollegeStatLine position={player.position} stats={collegeToDate} />
            </div>

            {buzzNote && (
              <p className="text-xs text-accent2 italic px-5 pb-4 -mt-1">{buzzNote}</p>
            )}
          </div>
        </div>
      )}

      {/* The affordances that buy information sit with the numbers they
          sharpen, rather than in a band of their own further down. */}
      {!view.revealed && (
        <div className="panel border-l-2 border-l-accent2 p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-[16rem] flex-1">
            <div className="text-sm font-medium inline-flex items-center gap-1.5">
              Scouting confidence: {Math.round(view.confidence)}%
              <Tooltip text={tip('scoutingConfidence')} />
            </div>
            <p className="text-xs text-muted mt-1 max-w-lg">{view.notes}</p>
          </div>
          {userTeam && (
            // `min-w-0` rather than `shrink-0`: this column holds prose, and a
            // column that refuses to shrink hands its children an unbounded
            // width to overflow into.
            <div className="flex flex-wrap items-center justify-end gap-2 min-w-0">
              {workoutSlots && (
                <>
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    <ShortlistStar leagueId={league.id} teamId={userTeam.id} playerId={player.id} initial={onShortlist} />
                    {onShortlist ? 'Worked every week' : 'Star to have him watched'}
                  </span>
                  <WorkoutButton
                    leagueId={league.id}
                    teamId={userTeam.id}
                    playerId={player.id}
                    name={`${player.firstName} ${player.lastName}`}
                    meta={`${player.position} · ${player.college}`}
                    avatar={<PlayerAvatar seed={player.id} age={player.age} size={40} weightLb={player.weightLb} heightIn={player.heightIn} position={player.position} />}
                    remaining={workoutSlots.remaining}
                    max={workoutSlots.max}
                    open={workoutSlots.open}
                    windowLabel={workoutSlots.windowLabel}
                    done={workedOutThisYear}
                    potLow={view.potLow}
                    potHigh={view.potHigh}
                    confidence={view.confidence}
                  />
                </>
              )}
              {/* The full-reveal charge belongs beside the free affordances, so
                  what it costs is compared against what nothing costs. */}
              <FullScoutButton leagueId={league.id} teamId={userTeam.id} playerId={player.id} compact />
            </div>
          )}
        </div>
      )}

      <div className="section">
        <SectionHeading
          title="Scouting Report"
          tip={tip('scoutingConfidence')}
          action={<span className="text-xs text-muted">{Math.round(view.confidence)}% confidence</span>}
        />
        {/* Hedging in this prose is driven by each attribute's own displayed
            band width, not one aggregate number — so it can never assert more
            precision than the fog above is already showing. */}
        <div className="panel p-5">
          <p className="text-sm leading-relaxed text-chalk/90">{scoutingReport}</p>
        </div>
      </div>

      <div className="section">
        <SectionHeading
          eyebrow="What his grade is built on"
          title="Attributes"
          tip={!view.revealed ? tip('scoutedRange') : undefined}
          action={
            !view.revealed
              ? <span className="text-xs text-muted">Scouted range shown — true values hidden</span>
              : <span className={`text-xs font-semibold ${positionBadgeClass(player.position)}`}>{player.position} grade</span>
          }
        />
        {/* Down one column and then down the next, rather than across: the
            order is the information here, and a row-major grid zig-zags it. */}
        <div className="panel p-5 grid sm:grid-cols-2 gap-x-8">
          {[attrRows.slice(0, Math.ceil(attrRows.length / 2)), attrRows.slice(Math.ceil(attrRows.length / 2))].map((col, i) => (
            <div key={i} className="space-y-3">
              {col.map((a) => {
                // A Full Evaluation pins one attribute to its true value; that
                // one is a number, not a band of zero width, for the same
                // reason a known potential is not drawn as a range.
                const exact = view.revealed || a.locked;
                return (
                  <div key={a.key} className="flex items-center gap-3">
                    <span className="text-sm text-muted w-32 shrink-0">{a.label}</span>
                    <div className="flex-1 h-2 bg-raised rounded-full overflow-hidden relative">
                      {exact ? (
                        <div
                          className={`absolute h-full rounded-full ${a.share > 0 ? 'bg-accent2/70' : 'bg-line'}`}
                          style={{ width: `${a.actual ?? a.observed}%` }}
                        />
                      ) : (
                        <>
                          <div
                            className="absolute h-full bg-line rounded-full"
                            style={{ left: `${a.low}%`, width: `${Math.max(2, a.high - a.low)}%` }}
                          />
                          <div className="absolute h-full w-0.5 bg-accent2" style={{ left: `${a.observed}%` }} />
                        </>
                      )}
                    </div>
                    <span className={`text-sm font-mono w-14 text-right ${ratingColor(a.observed)}`}>
                      {exact ? a.actual : `${a.low}-${a.high}`}
                    </span>
                    <span className="text-xs font-mono w-9 text-right text-muted">
                      {a.share > 0 ? `${Math.round(a.share * 100)}%` : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  /**
   * THE CONTRACT TAB. A draft prospect gets none — he cannot be signed, so
   * rather than a tab onto an empty box he has no tab at all.
   */
  const contractPane = player.isDraftee ? undefined : (
    <div className="section">
      <SectionHeading
        eyebrow={player.contract ? `Signed ${player.contract.signedYear}` : undefined}
        title="Contract"
        action={
          <div className="flex items-center gap-2">
            {player.contract?.isRookieDeal && (
              <span className="pill border-accent2/30 text-accent2 bg-accent2/10 gap-1.5">
                Rookie Deal<Tooltip text={tip('rookieDeal')} />
              </span>
            )}
            {player.contract?.isFranchiseTag && (
              <span className="pill border-warn/30 text-warn bg-warn/10 gap-1.5">
                Franchise Tag<Tooltip text={tip('franchiseTag')} />
              </span>
            )}
            {player.contract && (
              <span className="text-xs text-muted">
                {player.contract.years} year{player.contract.years === 1 ? '' : 's'} · through{' '}
                {player.contract.signedYear + player.contract.years - 1}
              </span>
            )}
          </div>
        }
      />
      {player.contract ? (
        <div className="space-y-4">
          {/* THE DEAL AS SIGNED. Only what the ledger below does not carry, and
              only what this cap mode actually charges: with the simplified cap
              there is no bonus proration, so there is no bonus line to quote,
              and with the cap off there are no cap figures at all. */}
          {settings.capMode !== 'OFF' && (
            <div className="panel p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <StatNumber value={formatMoney(contractTotal)} label="Total value" size="md" tip={tip('apy')} />
                <div className="text-[11px] text-muted mt-1">
                  {formatMoney(Math.round(contractTotal / Math.max(1, player.contract.years)))} a year across the deal
                </div>
              </div>
              {settings.capMode === 'REALISTIC' && (
                <div>
                  <StatNumber value={formatMoney(player.contract.signingBonus)} label="Signing bonus" size="md" tip={tip('proration')} />
                  <div className="text-[11px] text-muted mt-1">
                    {formatMoney(bonusPerYear)} a year on the cap through {bonusThrough}
                  </div>
                </div>
              )}
              <div>
                <StatNumber
                  value={`${formatMoney(market)}/yr`}
                  label="Market value"
                  size="md"
                  tip={tip('marketValue')}
                  // Market-rate stays the default ink — only a deviation big
                  // enough to matter earns green or red.
                  color={valueTier === 'bargain' ? 'text-accent' : valueTier === 'overpay' ? 'text-bad' : 'text-chalk'}
                />
                <div className="text-[11px] text-muted mt-1">
                  {valueTier === 'market'
                    ? 'paid at market rate'
                    : `${valueTier === 'bargain' ? 'surplus +' : 'over by '}${formatMoney(Math.abs(market - hit))}`}
                </div>
              </div>
            </div>
          )}

          <div className="panel p-5 space-y-4">
            {/* The question this box answers is "what does he cost me for the
                rest of the deal, and what does it cost to get out" — and that
                is a per-year table. The dead-money column is what turns it
                from a statement into a decision. */}
            <ContractLedger
              contract={player.contract}
              capMode={settings.capMode}
              seasonYear={league.seasonYear}
            />

            {isOwnRoster && userTeam && (
              <div className="pt-3 space-y-3 border-t border-line/60">
                <ContractActions
                  leagueId={league.id} playerId={player.id} ovr={view.scoutedOvr} position={player.position} age={player.age}
                  contract={{
                    years: player.contract.years, yearsRemaining: player.contract.yearsRemaining, signedYear: player.contract.signedYear,
                    baseSalaries: player.contract.baseSalaries, signingBonus: player.contract.signingBonus,
                    guaranteed: player.contract.guaranteed, voidYears: player.contract.voidYears,
                  }}
                  availableSpaceForExtension={capSpace + hit} capSpace={capSpace} capMode={settings.capMode}
                />
                {restructureFrees > 0 && (
                  <p className="text-sm text-muted">
                    A maximum restructure takes {formatMoney(restructureFrees)} off {league.seasonYear} and moves it into the
                    {player.contract.yearsRemaining > 2 ? ' years' : ' year'} after it.
                  </p>
                )}
                <CutButton leagueId={league.id} playerId={player.id} />
              </div>
            )}
          </div>
        </div>
      ) : player.status === 'FREE_AGENT' && userTeam ? (
        <div className="panel p-5">
          <SignOfferForm leagueId={league.id} teamId={userTeam.id} playerId={player.id} ovr={view.scoutedOvr} position={player.position} age={player.age} capSpace={capSpace} capMode={settings.capMode} />
        </div>
      ) : (
        <div className="panel p-5">
          <p className="text-sm text-muted">No contract on file.</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6 max-w-5xl">
      {/* ONE CARD, TWO FACES. The hero, the money line and the pane the tabs
          switch between are a single object; what sits under the card is the
          context you read it against — what he has won, and who is in front of
          him on your own depth chart. */}
      <PlayerCardTabs
        teamColor={jerseyColor}
        hero={hero}
        summary={bandCells}
        stats={statsPane}
        contract={contractPane}
      />

      {!player.isDraftee && (
        <CareerHonors
          position={player.position}
          ringYears={ringYears}
          awards={honorAwards}
          allStarYears={allStarYears}
          seasons={player.experience}
        />
      )}

      <div className="grid sm:grid-cols-2 gap-6">
        {userTeam && (
          <div className="section">
            <SectionHeading title={`Your Depth at ${player.position}`} tip={tip('depthChart')} />
            <div className="panel p-4">
              {depthChart.length === 0 ? (
                <p className="text-sm text-muted">Nobody rostered at {player.position} right now — a clear need.</p>
              ) : (
                <div className="space-y-1">
                  {/* `startersAt` is THE definition of who takes the field;
                      nothing here gets its own. */}
                  {depthChart.map((slot, i) => {
                    const isThisPlayer = slot.playerId === player.id;
                    const starterCount = startersAt(player.position);
                    const starts = i < starterCount;
                    return (
                      // Keyed on the FRAGMENT, not only on the children inside
                      // it: a bare <> in a map is an unkeyed list child, which
                      // React warns about on every render of this panel.
                      <Fragment key={slot.id}>
                      {i === starterCount && starterCount > 0 && (
                        <div className="flex items-center gap-2 pt-1.5 pb-1">
                          <span className="label-sm text-[10px]">Bench</span>
                          <span className="h-px flex-1 bg-line/70" />
                        </div>
                      )}
                      <Link
                        href={`/league/${league.id}/player/${slot.playerId}`}
                        className={`flex items-center gap-3 px-2 py-1.5 -mx-2 rounded-lg text-sm border-l-2 ${
                          starts ? 'bg-chalk/[0.05] border-accent2/70' : 'border-transparent opacity-80'
                        } ${isThisPlayer ? 'ring-1 ring-accent/40 bg-accent/10' : 'hover:bg-raised'}`}
                      >
                        <span className={`label-sm w-8 shrink-0 ${starts ? 'text-chalk' : ''}`}>
                          {starts ? `ST${starterCount > 1 ? i + 1 : ''}` : `#${i + 1}`}
                        </span>
                        <PlayerAvatar seed={slot.playerId} age={slot.player.age} size={22} weightLb={slot.player.weightLb} heightIn={slot.player.heightIn} position={slot.player.position} />
                        <span className={`flex-1 truncate ${isThisPlayer || starts ? 'font-semibold' : ''}`}>{slot.player.firstName} {slot.player.lastName}{isThisPlayer ? ' (this player)' : ''}</span>
                        <span className={`font-mono text-xs ${ratingColor(slot.player.trueOvr)}`}>{slot.player.trueOvr}</span>
                      </Link>
                      </Fragment>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Directly under the depth panel, deliberately: that list is the
            evidence this decision is made against — "your left tackle is a 61"
            is half of "move the spare right tackle over". */}
        {isOwnRoster && !player.isDraftee && (
          <div className="section">
            <SectionHeading
              eyebrow="Coaching decision"
              title="Position"
              tip={tip('overall')}
            />
            <PositionChangeCard
              leagueId={league.id}
              playerId={player.id}
              playerName={`${player.firstName} ${player.lastName}`}
              currentPosition={player.position}
              currentOvr={player.trueOvr}
              options={moveOptions}
            />
          </div>
        )}
      </div>
    </div>
  );
}
