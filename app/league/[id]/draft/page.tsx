import { prisma } from '@/lib/db';
import { getLeagueContext } from '@/lib/league-data';
import { readJson } from '@/lib/json';
import { buildScoutedView } from '@/lib/scouting';
import type { ScoutedPlayerView } from '@/lib/scouting';
import { loadScoutMods, buildDynastyState } from '@/lib/dynasty';
import { ratingColor, playerLabel } from '@/lib/ratings';
import { positionSortKey } from '@/lib/league-data';
import { LEAGUE } from '@/lib/tuning';
import { bandCutoffs, consensusBoardMap, ownGradeFor, disagreementNote } from '@/lib/consensus';
import { imminentDraftYear, projectedDraftOrder, draftIsStarted } from '@/lib/draft';
import { needSeverity, teamNeeds } from '@/lib/ai/gm';
import { loadWorkoutSlots } from '@/lib/workouts';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { DraftSelectionButton } from '@/components/DraftSelectionButton';
import { DraftMomentProvider } from '@/components/DraftMoment';
import { LiveDraftTicker } from '@/components/LiveDraftTicker';
import { StartDraftButton } from '@/components/StartDraftButton';
import { ShortlistStar } from '@/components/ShortlistStar';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { TeamLogo } from '@/components/TeamLogo';
import { SectionHeading } from '@/components/ds/SectionHeading';
import { PageMasthead } from '@/components/ds/PageMasthead';
import { WorkoutButton } from '@/components/ds/WorkoutButton';
import { DraftCapitalPanel } from '@/components/ds/DraftCapitalPanel';
import type { DraftCapitalPick, DraftCapitalForfeit, DraftCapitalYear } from '@/components/ds/DraftCapitalPanel';
import { DraftRecap } from '@/components/ds/DraftRecap';
import type { RecapSelection, RecapLeaguePick, RecapNote } from '@/components/ds/DraftRecap';
import { BroadcastHero } from '@/components/draft/BroadcastHero';
import type { UpcomingSlot } from '@/components/draft/BroadcastHero';
import { TheSelection } from '@/components/draft/TheSelection';
import type { SelectionCardData } from '@/components/draft/TheSelection';
import { SelectionFeed } from '@/components/draft/SelectionFeed';
import type { FeedRow } from '@/components/draft/SelectionFeed';
import { BoardDepletion, RunWatch, WarRoomPanel } from '@/components/draft/DraftIntel';
import type { PositionStock, RunEntry, WarRoomPick } from '@/components/draft/DraftIntel';
import { BestAvailable } from '@/components/draft/BestAvailable';
import type { AvailableRow } from '@/components/draft/BestAvailable';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { Tooltip } from '@/components/Tooltip';
import { define, tip } from '@/lib/glossary';

type SortKey = 'consensus' | 'ours' | 'pos' | 'ovr' | 'age' | 'potential';

/** How many selections back the run detector looks. [TUNE] */
const RUN_WINDOW = 12;
/** Clubs shown in the hero's order-of-selection strip. */
const UPCOMING_SLOTS = 20;

export default async function DraftPage({ params, searchParams }: { params: { id: string }; searchParams: { pos?: string; sort?: string; dir?: string; shortlist?: string } }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

  const stateRow = await prisma.draftState.findUnique({ where: { leagueId: league.id } });
  // The draft page doubles as a year-round scouting hub: the incoming class
  // is generated at week 1 of the season (see addDraftClass in season.ts),
  // long before DraftState exists — it only gets created once the DRAFT
  // phase actually opens, months later. `stateRow` also lingers as a stale,
  // already-complete row from last year's draft for most of the season
  // (startRookieDraft only replaces it once the next draft starts), so
  // "is a draft live right now" is its own check, not just "does state exist."
  const draftLive = !!stateRow && !stateRow.complete;
  const state = draftLive ? stateRow! : null;
  // Board set, clock stopped. startRookieDraft writes DraftState the moment
  // free agency closes; until the GM presses the button in the war room below,
  // nothing on this page may take a pick. See draftIsStarted() in lib/draft.ts
  // for why a fantasy draft is never in this state.
  const draftStarted = !state || draftIsStarted(state);

  const isFantasy = state?.kind === 'FANTASY';
  // Fantasy draft has no DraftPick rows — it's a plain snake of team turns,
  // so the stored order is the whole story there. A rookie draft resolves
  // the team on the clock from LIVE DraftPick ownership every round instead
  // of a turn-order array (see lib/draft.ts currentPick() for why a fixed
  // array silently ignores any trade involving a round-2+ pick).
  const order = state && isFantasy ? readJson<string[]>(state.order, []) : [];
  const roundSize = LEAGUE.TEAM_COUNT;
  const rookiePicks = state && !isFantasy
    ? await prisma.draftPick.findMany({ where: { leagueId: league.id, year: league.seasonYear }, orderBy: [{ round: 'asc' }, { slot: 'asc' }] })
    : [];
  const rookiePickByIndex = new Map(rookiePicks.map((p) => [(p.round - 1) * roundSize + (p.slot - 1), p]));

  const totalPicks = state ? (isFantasy ? order.length : roundSize * settings.draftRounds) : 0;
  const onClockTeamId = state
    ? (isFantasy ? (order.length > 0 ? order[state.pickIndex % order.length] : undefined) : rookiePickByIndex.get(state.pickIndex)?.ownerTeamId)
    : undefined;
  const onClockTeam = onClockTeamId ? await prisma.team.findUnique({ where: { id: onClockTeamId } }) : null;
  const isUserOnClock = !!state && onClockTeamId === team.id;

  // Every club, unconditionally: the picks panel below has to name whoever a
  // traded pick came from or went to, which is a question this page now asks
  // in every phase, not just during a live rookie draft.
  const allTeams = await prisma.team.findMany({ where: { leagueId: league.id } });
  const teamById = new Map(allTeams.map((t) => [t.id, t]));
  // Whether there is anything to project a draft order FROM. Every club sits
  // at 0-0-0 from RESET_STANDINGS until week 1 kicks off (see lib/season.ts),
  // and standingsOrder would then be ranking 32 identical records by nothing
  // at all — so no number is offered rather than a fabricated one.
  const standingsPlayed = allTeams.some((t) => t.wins + t.losses + t.ties > 0);
  const upcomingPicks = state && totalPicks > 0
    ? Array.from({ length: Math.min(32, totalPicks - state.pickIndex) }, (_, i) => {
        const idx = state.pickIndex + i;
        if (isFantasy) {
          const round = Math.floor(idx / order.length) + 1;
          return { idx, round, team: teamById.get(order[idx % order.length]) };
        }
        const p = rookiePickByIndex.get(idx);
        return { idx, round: p ? p.round : Math.floor(idx / roundSize) + 1, team: p ? teamById.get(p.ownerTeamId) : undefined };
      })
    : [];

  // Picks for the NEXT draft, not the current season year — once a draft has
  // happened, seasonYear and the upcoming draft year diverge (see lib/draft.ts).
  const upcomingDraftYear = await imminentDraftYear(league.id);

  const shortlistEntries = await prisma.shortlistEntry.findMany({ where: { teamId: team.id }, select: { playerId: true } });
  const shortlistIds = new Set(shortlistEntries.map((s) => s.playerId));
  const shortlistOnly = searchParams.shortlist === '1';

  // During a live draft, only the top of the board matters pick-to-pick.
  // Off the clock, this is the whole-class scouting hub — show a lot more
  // of it (the class is ~400 deep now that a real UDFA share exists).
  const where: any = { leagueId: league.id, teamId: null, status: 'FREE_AGENT', isDraftee: true };
  if (searchParams.pos) where.position = searchParams.pos;
  if (shortlistOnly) where.id = { in: Array.from(shortlistIds) };
  // Same rule as Free Agency: the headline count describes the whole class,
  // not the slice below it. Reporting slice.length claimed "300 prospects"
  // against a 400-deep class — and during a live draft the slice narrows to
  // 80, which would have made that claim off a sample of 80.
  const classWhere = { leagueId: league.id, teamId: null, status: 'FREE_AGENT', isDraftee: true } as const;
  const [pool, classSize] = await Promise.all([
    // The 80-row slice is for a draft in progress, where only the top of the
    // board matters pick to pick. A draft that has not started yet is the
    // opposite: it is the last full look at the class, so it gets the whole
    // scouting-hub depth.
    prisma.player.findMany({ where, orderBy: { trueOvr: 'desc' }, take: shortlistOnly ? undefined : (draftLive && draftStarted ? 80 : 300) }),
    prisma.player.count({ where: classWhere }),
  ]);
  const reports = await prisma.scoutingReport.findMany({ where: { teamId: team.id, playerId: { in: pool.map((p) => p.id) } } });
  const reportMap = new Map(reports.map((r) => [r.playerId, r]));
  const positions = Array.from(new Set(pool.map((p) => p.position))).sort((a, b) => positionSortKey(a) - positionSortKey(b));

  const recentPicks = await prisma.transaction.findMany({ where: { leagueId: league.id, type: 'DRAFT' }, orderBy: { createdAt: 'desc' }, take: 10 });
  const classOutlook = await prisma.transaction.findFirst({
    where: { leagueId: league.id, type: 'NEWS', headline: { contains: 'Draft Class Outlook' } },
    orderBy: { createdAt: 'desc' },
  });

  // Dynasty scouting upgrades tighten every range on this board (and a
  // prospect the GM spent a Full Scout on comes back fully revealed via his
  // report row). Omitting the argument means "no skills", so this is additive.
  const scoutMods = await loadScoutMods(league.id);

  /**
   * OUR FILE ON ONE PROSPECT, BUILT ONCE.
   *
   * `isProspect` is hardcoded true, and that is the whole point rather than a
   * shortcut. This page now shows men who have ALREADY BEEN DRAFTED — the
   * selection feed and the pick on screen — and drafting a player clears
   * Player.isDraftee, which is the scope gate buildScoutedView reads. Passing
   * the flag off the record would print a true overall the instant a man came
   * off the board, on the one screen that exists to celebrate not knowing yet.
   * What we knew about him at the podium is what we knew, and it does not
   * improve because somebody else called his name.
   *
   * Memoised because the board rows, the feed, the best-available columns and
   * the selection card all ask about overlapping sets of the same class.
   */
  const viewCache = new Map<string, ScoutedPlayerView>();
  const viewOf = (p: { id: string; position: string; trueAttrs: string; trueOvr: number; potential: number }): ScoutedPlayerView => {
    let v = viewCache.get(p.id);
    if (!v) {
      v = buildScoutedView({
        isProspect: true,
        position: p.position as any, trueAttrs: readJson(p.trueAttrs, {}), trueOvr: p.trueOvr, potential: p.potential,
        report: reportMap.get(p.id), settings, isOwnRoster: false, isUserView: true, dynasty: scoutMods,
      });
      viewCache.set(p.id, v);
    }
    return v;
  };

  // THE CONSENSUS BOARD. This rank is the public one — lib/consensus.ts grades
  // every prospect off nothing but public signals (testing, program, the gap
  // between what he is and what he could be, a medical flag) and ranks the
  // class by the boardScore it publishes on every row. It is identical for
  // every team in the league, which is what "consensus" has to mean.
  //
  // What it replaces was a rank computed from THIS team's own scoutedOvr — a
  // private board wearing the word consensus, where two teams saw different
  // "#1 overall" for the same player.
  //
  // Ranked over the WHOLE class, drafted prospects INCLUDED, so a prospect's
  // rank never moves because somebody else came off the board. Filters on this
  // page (position, shortlist) narrow the rows, never the ranking pool.
  //
  // THE POOL IS THE CLASS, WHICH `draftYear` ALONE CANNOT SAY. draftPlayer()
  // overwrites a prospect's draftYear with the year he was SELECTED in, which
  // is one higher than the year his class was generated under — so a plain
  // `draftYear: classYear` query is two different cohorts at once and misses
  // the one it means. Measured both ways on the same save (DCM 1):
  //
  //   live draft, 89 picks in : pool 311 of 400 — every man still on the board
  //                             had drifted up in rank as others were taken,
  //                             the exact thing the paragraph above forbids
  //   week 11, no draft running: pool 624 — the 400-man class PLUS the 224
  //                             rookies drafted out of the previous class, who
  //                             now carry this class's draftYear. The class's
  //                             real #7 showed as #16, and two blue chips
  //                             rendered in the first-round band instead.
  //
  // Still on the board plus already taken by this draft is the class itself,
  // in every phase, and it is 400 in both cases above.
  const classYearRow = await prisma.player.findFirst({
    where: { leagueId: league.id, isDraftee: true },
    orderBy: { draftYear: 'desc' },
    select: { draftYear: true },
  });
  const classYear = classYearRow?.draftYear ?? league.seasonYear;
  // WHICH DRAFT'S SELECTIONS COUNT AS "TAKEN OUT OF THIS CLASS".
  //
  // Not `upcomingDraftYear`. That is the smallest year with an UNUSED pick, so
  // the moment the last card goes in it rolls forward to next spring and
  // returns nothing — which dropped all 224 men this draft had just taken out
  // of the ranking pool and re-ranked the 176 leftovers as if they were the
  // whole class. In the DRAFT phase the draft on screen is this season's, and
  // everywhere else the next one to run is the right answer.
  const boardDraftYear = league.phase === 'DRAFT' ? league.seasonYear : upcomingDraftYear;
  const takenThisDraft = boardDraftYear === null ? [] : await prisma.draftPick.findMany({
    where: { leagueId: league.id, year: boardDraftYear, used: true, playerId: { not: null } },
    select: { playerId: true },
  });
  // The class as one object — still on the board plus already called. Carries
  // the identity fields too, because the broadcast below names men who are no
  // longer in `pool` at all: the feed, the pick on screen, and the run counts
  // are all about players this draft has removed from it.
  const classPool = await prisma.player.findMany({
    where: {
      leagueId: league.id,
      OR: [
        { draftYear: classYear, isDraftee: true },
        { id: { in: takenThisDraft.map((p) => p.playerId!) } },
      ],
    },
    select: {
      id: true, firstName: true, lastName: true, position: true, age: true, college: true,
      heightIn: true, weightLb: true, trueOvr: true, potential: true,
      trueAttrs: true, collegeStats: true, combineTesting: true, injuryWeeks: true,
      isDraftee: true, teamId: true,
    },
  });
  const consensus = consensusBoardMap(classPool, { teams: LEAGUE.TEAM_COUNT, rounds: settings.draftRounds });

  // Files on the rest of the class, folded into the same map the board rows
  // read from. `reports` above only covers the slice on screen; our own board
  // has to be ranked over everybody we have written up, drafted or not.
  const classReports = await prisma.scoutingReport.findMany({
    where: { teamId: team.id, playerId: { in: classPool.map((p) => p.id) } },
  });
  for (const r of classReports) reportMap.set(r.playerId, r);

  const rows = pool.map((p) => ({ p, view: viewOf(p) }));

  // -------------------------------------------------------------------------
  // OUR BOARD
  // -------------------------------------------------------------------------
  // The consensus is free and every club in the league has it. This is the one
  // that costs a season of scouting: the same blend of present and ceiling the
  // room grades on (ownGradeFor), run over our own scouted read.
  //
  // Only men the department has an actual file on are on it. A rank derived
  // from the baseline report every prospect carries is not an opinion, and
  // putting one on the board would bury the men we really do have a read on.
  // The threshold is disagreementNote's own floor, so this page cannot claim a
  // disagreement it then refuses to explain.
  const FILE_MIN = 25;
  const ourGrade = new Map<string, number>();
  for (const p of classPool) {
    const view = viewOf(p);
    if (view.confidence >= FILE_MIN) ourGrade.set(p.id, ownGradeFor(view));
  }
  const ourRank = new Map<string, number>();
  [...ourGrade.entries()]
    .sort((a, b) => b[1] - a[1] || (consensus.get(a[0])?.rank ?? 9e9) - (consensus.get(b[0])?.rank ?? 9e9))
    .forEach(([id], i) => ourRank.set(id, i + 1));

  const rankBadge = (playerId: string): { label: string; className: string } | null => {
    const read = consensus.get(playerId);
    if (!read) return null;
    if (read.rank === 1) return { label: '#1 Board', className: 'text-gold' };
    if (read.band === 'BLUE_CHIP') return { label: 'Blue chip', className: 'text-gold' };
    if (read.band === 'FIRST_ROUND') return { label: 'R1 grade', className: 'text-accent' };
    if (read.band === 'DAY_TWO') return { label: 'Day 2', className: 'text-accent2' };
    return null;
  };

  const sortKey: SortKey = (['consensus', 'ours', 'pos', 'ovr', 'age', 'potential'] as SortKey[]).includes(searchParams.sort as SortKey)
    ? (searchParams.sort as SortKey) : 'consensus';
  const dir = searchParams.dir === 'asc' ? 1 : -1;

  const sorted = [...rows].sort((a, b) => {
    switch (sortKey) {
      // Rank 1 is the BEST prospect, so "best first" (the default, dir=-1)
      // means ascending rank number — the opposite direction of every other
      // column here, where higher is better. Flip the sign to match.
      case 'consensus': return ((consensus.get(a.p.id)?.rank ?? Infinity) - (consensus.get(b.p.id)?.rank ?? Infinity)) * -dir;
      // Same direction rule as the consensus column, and men with no file of
      // our own sort to the bottom either way round rather than to the top.
      case 'ours': return ((ourRank.get(a.p.id) ?? Infinity) - (ourRank.get(b.p.id) ?? Infinity)) * -dir;
      case 'ovr': return (a.view.scoutedOvr - b.view.scoutedOvr) * dir;
      case 'age': return (a.p.age - b.p.age) * dir;
      case 'potential': {
        const av = a.view.potentialRevealed ? a.p.potential : (a.view.potLow + a.view.potHigh) / 2;
        const bv = b.view.potentialRevealed ? b.p.potential : (b.view.potLow + b.view.potHigh) / 2;
        return (av - bv) * dir;
      }
      default: return (positionSortKey(a.p.position) - positionSortKey(b.p.position)) * dir || b.p.trueOvr - a.p.trueOvr;
    }
  });

  const shortlistQuery = shortlistOnly ? 'shortlist=1&' : '';
  const posQuery = (searchParams.pos ? `pos=${searchParams.pos}&` : '') + shortlistQuery;
  const sortHref = (key: SortKey) => {
    const nextDir = sortKey === key && dir === -1 ? 'asc' : 'desc';
    return `/league/${league.id}/draft?${posQuery}sort=${key}&dir=${nextDir}`;
  };
  const posHref = (pos?: string) => {
    const suffix = `${shortlistQuery}sort=${sortKey}&dir=${dir === -1 ? 'desc' : 'asc'}`;
    return pos ? `/league/${league.id}/draft?pos=${pos}&${suffix}` : `/league/${league.id}/draft?${suffix}`;
  };
  const shortlistHref = () => {
    const posP = searchParams.pos ? `pos=${searchParams.pos}&` : '';
    const suffix = `sort=${sortKey}&dir=${dir === -1 ? 'desc' : 'asc'}`;
    return `/league/${league.id}/draft?${posP}${shortlistOnly ? '' : 'shortlist=1&'}${suffix}`;
  };

  const onClockColor = onClockTeam ? generateTeamLogoParams(onClockTeam.abbr).primary : undefined;

  // How much of this class you actually have a read on, and how much draft
  // capital you hold — the two things that decide whether the board in front
  // of you is useful yet.
  //
  // "Scouted" deliberately means HIGH confidence, not "confidence > 0": every
  // prospect carries a baseline report from league creation, so a >0 test
  // marked the entire class scouted and told you nothing. This matches the
  // threshold ScoutingRange itself labels HIGH.
  const scoutedCount = rows.filter(({ view }) => view.confidence >= 75).length;

  // -------------------------------------------------------------------------
  // YOUR PICKS
  // -------------------------------------------------------------------------
  // Every pick the club holds in every scheduled draft, every original pick of
  // its own that somebody else now holds, and — during a live draft — how far
  // away the next one is. This replaces a bare count, which named no round, no
  // selection number and no year, and so could not be planned from.
  //
  // A SELECTION NUMBER IS EITHER REAL OR PROJECTED, NEVER BOTH.
  // DraftPick.slot is the placeholder the row was created with (the club's
  // index in the team list) right up until reseedDraftOrder() rewrites it from
  // final standings on the way out of free agency — so it is a real selection
  // number only in the DRAFT phase, for that year's draft. Everywhere else the
  // current draft's picks carry a live "if the season ended today" projection
  // instead, off the ORIGINAL club's record, and a further-future year gets no
  // number at all because there are no standings to project it from.
  const projectedOrder = await projectedDraftOrder(league.id);
  const myPickRows = upcomingDraftYear === null ? [] : await prisma.draftPick.findMany({
    where: {
      leagueId: league.id,
      year: { gte: upcomingDraftYear },
      OR: [{ ownerTeamId: team.id }, { originalTeamId: team.id }],
    },
    include: { player: { select: { firstName: true, lastName: true, position: true } } },
    orderBy: [{ year: 'asc' }, { round: 'asc' }],
  });
  const overallOf = (round: number, slot: number) => (round - 1) * roundSize + slot;
  // The one year whose order has actually been reseeded: the draft that is
  // open right now. reseedDraftOrder(leagueId, seasonYear) runs immediately
  // before startRookieDraft, so DRAFT phase — and only DRAFT phase — means the
  // stored slots for league.seasonYear are the real running order.
  const settledYear = league.phase === 'DRAFT' ? league.seasonYear : null;

  const capitalYears = new Map<number, DraftCapitalYear>();
  const yearBucket = (year: number) => {
    let y = capitalYears.get(year);
    if (!y) {
      const settled = year === settledYear;
      // Three things have to be true before a projected number is honest: it
      // is the next draft, that draft is the one THIS season's standings will
      // seed (seasonYear rolls forward mid-offseason, so after RESET_STANDINGS
      // the imminent draft is already the one this table no longer describes),
      // and some football has actually been played.
      const projected = !settled
        && year === upcomingDraftYear
        && year === league.seasonYear + 1
        && standingsPlayed;
      y = {
        year,
        settled,
        projected,
        // The draft being planned for gets a row per pick whether or not it has
        // numbers yet — see DraftCapitalYear.upcoming.
        upcoming: year === upcomingDraftYear,
        // Draft year Y is seeded by the season played in Y-1 (the offseason
        // that runs the draft has already rolled seasonYear forward) — but
        // only while that season is still ahead of us. Between RESET_STANDINGS
        // and the draft actually opening, Y-1 is a season already in the books
        // and "order set after 2027" would be the page telling a GM to wait
        // for a year he has finished playing. Unset, the panel says the true
        // thing instead: the order lands when the draft opens.
        orderFromSeason: settled || projected || year - 1 < league.seasonYear ? undefined : year - 1,
        picks: [],
        forfeited: [],
      };
      capitalYears.set(year, y);
    }
    return y;
  };

  for (const p of myPickRows) {
    const bucket = yearBucket(p.year);
    const spentOn = p.used && p.player
      ? { name: `${p.player.firstName} ${p.player.lastName}`, position: p.player.position }
      : undefined;
    if (p.ownerTeamId === team.id) {
      const projSlot = bucket.projected ? projectedOrder.get(p.originalTeamId) : undefined;
      const origin = p.originalTeamId === team.id ? undefined : teamById.get(p.originalTeamId);
      // Selections between the pick on the clock and this one. Only a rookie
      // draft has DraftPick rows to be on the clock with.
      const away = draftLive && !isFantasy && p.year === league.seasonYear && !p.used && bucket.settled
        ? overallOf(p.round, p.slot) - 1 - state!.pickIndex
        : undefined;
      const pick: DraftCapitalPick = {
        id: p.id,
        year: p.year,
        round: p.round,
        overall: bucket.settled ? overallOf(p.round, p.slot) : undefined,
        projectedSlot: projSlot,
        projectedOverall: projSlot === undefined ? undefined : overallOf(p.round, projSlot),
        roundSize,
        from: origin ? { teamId: origin.id, abbr: origin.abbr } : undefined,
        picksAway: away !== undefined && away >= 0 ? away : undefined,
        spentOn,
      };
      bucket.picks.push(pick);
    } else if (p.originalTeamId === team.id) {
      const holder = teamById.get(p.ownerTeamId);
      // Projected off THIS club's own record, because it is this club's pick —
      // which is exactly what makes it worth showing: a first traded away in
      // August is a different asset in November.
      const projSlot = bucket.projected ? projectedOrder.get(p.originalTeamId) : undefined;
      const forfeit: DraftCapitalForfeit = {
        id: p.id,
        year: p.year,
        round: p.round,
        overall: bucket.settled ? overallOf(p.round, p.slot) : undefined,
        projectedOverall: projSlot === undefined ? undefined : overallOf(p.round, projSlot),
        to: { teamId: holder?.id ?? p.ownerTeamId, abbr: holder?.abbr ?? '???' },
        spentOn,
      };
      bucket.forfeited.push(forfeit);
    }
  }

  // The club's own place in the live order, which every projected number on
  // the panel is derived from: slot + (round - 1) * 32. Shown only when a year
  // on the panel is actually carrying that projection.
  const ownProjectedSlot = projectedOrder.get(team.id);
  const capitalList = [...capitalYears.values()].sort((a, b) => a.year - b.year);
  for (const y of capitalList) {
    y.picks.sort((a, b) => a.round - b.round || (a.overall ?? a.projectedOverall ?? 0) - (b.overall ?? b.projectedOverall ?? 0));
    y.forfeited.sort((a, b) => a.round - b.round);
  }
  // The clubs whose live records are setting every projected number on the
  // panel: this one, plus whoever a projected pick was acquired from. Each
  // slot is the one projectedDraftOrder() returned — the same map the numbers
  // above were built from, never a second computation of it.
  const projectedYears = capitalList.filter((y) => y.projected);
  const liveOrderTeamIds = [
    ...new Set([
      ...(ownProjectedSlot !== undefined ? [team.id] : []),
      ...projectedYears.flatMap((y) => y.picks.map((p) => p.from?.teamId).filter((id): id is string => !!id)),
    ]),
  ];
  const capitalLiveOrder = projectedYears.length === 0 ? undefined : liveOrderTeamIds
    .map((id) => {
      const club = teamById.get(id);
      const slot = projectedOrder.get(id);
      if (!club || slot === undefined) return null;
      return {
        teamId: id,
        abbr: club.abbr,
        slot,
        outOf: projectedOrder.size,
        record: `${club.wins}-${club.losses}-${club.ties}`,
        isMine: id === team.id,
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null)
    // A club that has hoarded picks from ten different teams does not need ten
    // rows of standings; the point is made by the first few.
    .slice(0, 5);
  const imminentPicks = capitalList.find((y) => y.year === upcomingDraftYear)?.picks.filter((p) => !p.spentOn) ?? [];
  const nextUpPick = imminentPicks
    .filter((p) => p.picksAway !== undefined)
    .sort((a, b) => a.picksAway! - b.picksAway!)[0];
  const nextUp = nextUpPick
    ? { picksAway: nextUpPick.picksAway!, round: nextUpPick.round, overall: nextUpPick.overall!, onTheClock: nextUpPick.picksAway === 0 }
    : undefined;
  const firstPick = imminentPicks[0];
  const pickTileDetail = nextUp
    ? (nextUp.onTheClock ? 'you are on the clock' : `next in ${nextUp.picksAway} selection${nextUp.picksAway === 1 ? '' : 's'}`)
    : firstPick?.overall !== undefined
    ? `first at #${firstPick.overall} overall`
    : firstPick?.projectedOverall !== undefined
    ? `first at proj. #${firstPick.projectedOverall}`
    : upcomingDraftYear !== null
    ? `owned in the ${upcomingDraftYear} draft`
    : 'unused picks owned';

  // -------------------------------------------------------------------------
  // DRAFT RECAP
  // -------------------------------------------------------------------------
  // The most recent draft that has actually finished. Held back while one is
  // running — a recap of a room still in session is a scoreboard at half time.
  const lastDraftRow = await prisma.draftPick.findFirst({
    where: { leagueId: league.id, used: true }, orderBy: { year: 'desc' }, select: { year: true },
  });
  const recapYear = lastDraftRow && !(draftLive && lastDraftRow.year === league.seasonYear) ? lastDraftRow.year : null;
  const recapPickRows = recapYear === null ? [] : await prisma.draftPick.findMany({
    where: { leagueId: league.id, year: recapYear, used: true, playerId: { not: null } },
    include: {
      player: {
        select: {
          id: true, firstName: true, lastName: true, position: true, age: true,
          college: true, heightIn: true, weightLb: true,
        },
      },
    },
    orderBy: [{ round: 'asc' }, { slot: 'asc' }],
  });
  // That draft's board, over that draft's class: everyone it took, plus
  // everyone it left. The leftovers keep the draftYear their class was
  // generated under, which is one BELOW the year they were drafted in — the
  // same off-by-one the big board above has to work around.
  const recapBoard = recapYear === null ? null : consensusBoardMap(
    await prisma.player.findMany({
      where: {
        leagueId: league.id,
        OR: [
          { id: { in: recapPickRows.map((p) => p.playerId!) } },
          { draftYear: recapYear - 1, draftRound: null },
        ],
      },
      select: {
        id: true, position: true, trueOvr: true, potential: true,
        trueAttrs: true, collegeStats: true, combineTesting: true, injuryWeeks: true,
      },
    }),
    { teams: LEAGUE.TEAM_COUNT, rounds: settings.draftRounds },
  );

  const recapSelections: RecapSelection[] = recapPickRows
    .filter((p) => p.ownerTeamId === team.id && p.player)
    .map((p) => {
      const read = recapBoard?.get(p.player!.id);
      const origin = p.originalTeamId === team.id ? undefined : teamById.get(p.originalTeamId);
      return {
        playerId: p.player!.id,
        overall: overallOf(p.round, p.slot),
        round: p.round,
        firstName: p.player!.firstName,
        lastName: p.player!.lastName,
        position: p.player!.position,
        age: p.player!.age,
        college: p.player!.college,
        heightIn: p.player!.heightIn,
        weightLb: p.player!.weightLb,
        boardRank: read?.rank,
        boardGrade: read?.grade,
        bandLabel: read?.bandLabel,
        from: origin ? { teamId: origin.id, abbr: origin.abbr } : undefined,
      };
    });

  const recapRoundOne: RecapLeaguePick[] = recapPickRows
    .filter((p) => p.round === 1 && p.player)
    .map((p) => {
      const club = teamById.get(p.ownerTeamId);
      return {
        overall: overallOf(p.round, p.slot),
        teamId: club?.id ?? p.ownerTeamId,
        teamAbbr: club?.abbr ?? '???',
        isUser: p.ownerTeamId === team.id,
        firstName: p.player!.firstName,
        lastName: p.player!.lastName,
        position: p.player!.position,
        boardRank: recapBoard?.get(p.player!.id)?.rank,
      };
    });

  // What was true in the room, and nothing about how any of it turns out —
  // that story belongs to the careers these men have not had yet.
  const recapNotes: RecapNote[] = [];
  if (recapYear !== null && recapPickRows.length > 0) {
    const acquiredCount = recapSelections.filter((s) => s.from).length;
    const forfeitedCount = recapPickRows.filter((p) => p.originalTeamId === team.id && p.ownerTeamId !== team.id).length;
    recapNotes.push({
      label: 'Your Class',
      value: `${recapSelections.length} selection${recapSelections.length === 1 ? '' : 's'}`,
      detail: [
        recapSelections[0] ? `first at #${recapSelections[0].overall}` : null,
        acquiredCount > 0 ? `${acquiredCount} acquired by trade` : null,
        forfeitedCount > 0 ? `${forfeitedCount} traded away` : null,
      ].filter(Boolean).join(' · ') || undefined,
      isUser: true,
    });

    const first = recapRoundOne[0];
    if (first) {
      recapNotes.push({
        label: 'First Off The Board',
        value: `${first.firstName} ${first.lastName}`,
        detail: `${first.position} · ${first.teamAbbr} · #1 overall`,
      });
    }
    const runCounts = new Map<string, number>();
    for (const p of recapRoundOne) runCounts.set(p.position, (runCounts.get(p.position) ?? 0) + 1);
    const topRun = [...runCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topRun && topRun[1] >= 3) {
      recapNotes.push({ label: 'Round One Run', value: `${topRun[1]} ${topRun[0]}`, detail: 'off the board in the first round' });
    }
    // Every pick set against where the public board had the man, which is the
    // one comparison the room could actually make on the night.
    const againstBoard = recapPickRows
      .filter((p) => p.player && recapBoard?.get(p.player.id))
      .map((p) => ({ p, rank: recapBoard!.get(p.player!.id)!.rank, overall: overallOf(p.round, p.slot) }));
    // Longest wait for a man the board had in its first round. Restricted to
    // first-round grades on purpose: a #250 board card taken at #224 is not a
    // slide, it is the seventh round doing what it does.
    const slide = againstBoard
      .filter((x) => x.rank <= roundSize)
      .sort((a, b) => (b.overall - b.rank) - (a.overall - a.rank))[0];
    if (slide && slide.overall > slide.rank) {
      const club = teamById.get(slide.p.ownerTeamId);
      recapNotes.push({
        label: 'Longest Slide',
        value: `${slide.p.player!.firstName} ${slide.p.player!.lastName}`,
        detail: `board #${slide.rank}, taken #${slide.overall} by ${club?.abbr ?? '???'}`,
      });
    }
    // And the other direction. Confined to the first two rounds, where a club
    // spending early capital well ahead of the board is the news; taking a man
    // a hundred places early in the seventh is what the seventh round is.
    const reach = againstBoard
      .filter((x) => x.overall <= roundSize * 2)
      .sort((a, b) => (b.rank - b.overall) - (a.rank - a.overall))[0];
    if (reach && reach.rank > reach.overall) {
      const club = teamById.get(reach.p.ownerTeamId);
      recapNotes.push({
        label: 'Earliest Call',
        value: `${reach.p.player!.firstName} ${reach.p.player!.lastName}`,
        detail: `board #${reach.rank}, taken #${reach.overall} by ${club?.abbr ?? '???'}`,
      });
    }
  }

  // The draft has just ended and the league has not moved on yet — the recap
  // is the whole reason to be on this page, so it leads.
  const draftJustFinished = league.phase === 'DRAFT' && !!stateRow?.complete;
  const recap = recapYear !== null && recapPickRows.length > 0 ? (
    <DraftRecap
      year={recapYear}
      teamId={team.id}
      teamAbbr={team.abbr}
      selections={recapSelections}
      roundOne={recapRoundOne}
      notes={recapNotes}
    />
  ) : null;

  // The pick the user is on the clock with, for the selection card. Round and
  // slot come off the DraftPick row that currentPick() itself resolves, so the
  // number on the card is the number the rookie deal is scaled from.
  const onClockRookiePick = state && !isFantasy ? rookiePickByIndex.get(state.pickIndex) : undefined;
  const onClockRound = onClockRookiePick?.round
    ?? (isFantasy && order.length > 0 ? Math.floor((state?.pickIndex ?? 0) / order.length) + 1 : state?.round ?? 1);

  // THE WAR ROOM: board set, clock stopped, nobody at the podium yet.
  //
  // The two scouting ledgers are read ONLY in this state. Private workouts die
  // when the draft opens (lib/workouts.ts — the window is RESIGN and FREE
  // AGENCY, and this is the last screen before it shuts), so a GM holding
  // unused ones has to be told before he starts rather than after. Full Scout
  // charges do not expire here; they are named alongside because the prospect
  // does — he comes off the board and is somebody else's.
  const warRoom = !!state && !draftStarted;
  // The workout ledger is read in EVERY state now, not just here. The board
  // below carries the control that spends a slot (the app owner: *"we should
  // be able to do workouts directly from the big board"*), so the count and
  // the window's own sentence have to be on this page whether or not the war
  // room is up. Full Scout charges stay a war-room-only read: they do not
  // expire at the podium, so they are only worth naming at the podium.
  const [workoutSlots, warRoomDynasty, workedOut] = await Promise.all([
    loadWorkoutSlots(league.id),
    warRoom ? buildDynastyState(league.id) : Promise.resolve(null),
    prisma.scoutingReport.findMany({
      where: { teamId: team.id, workoutYear: league.seasonYear },
      select: { playerId: true },
    }),
  ]);
  const workedOutIds = new Set(workedOut.map((w) => w.playerId));
  const firstSelection = firstPick?.overall !== undefined
    ? `Round ${firstPick.round}, #${firstPick.overall} overall`
    : null;

  // ===========================================================================
  // THE BROADCAST
  // ===========================================================================
  // Draft day is the one day of the football year that is televised, and until
  // now this page reported it as a table with a banner on top: every club's
  // pick arrived as a line of grey text at the bottom reading "Kansas City
  // selects...". Everything below builds the other half — the pick on screen
  // in the club's own colours, the names coming off in order with what each
  // one did to your plan, the run that means the eighth-best receiver is about
  // to go at a first-round price, and the clock walking toward your slot.
  //
  // It stands only for a ROOKIE draft that has actually been sent to the
  // podium. A fantasy draft has no DraftPick rows to broadcast from (see
  // currentPick in lib/draft.ts), and the war room deliberately holds this
  // whole section back until the GM opens the board.
  const broadcast = !!stateRow && stateRow.kind !== 'FANTASY' && league.phase === 'DRAFT' && draftStarted;
  const bcastPicks = broadcast
    ? await prisma.draftPick.findMany({
        where: { leagueId: league.id, year: league.seasonYear },
        include: {
          player: {
            select: { id: true, firstName: true, lastName: true, position: true, college: true, age: true, heightIn: true, weightLb: true },
          },
        },
        orderBy: [{ round: 'asc' }, { slot: 'asc' }],
      })
    : [];
  const madePicks = bcastPicks.filter((p) => p.used && p.player);
  const bcastComplete = !!stateRow?.complete;
  // Where the clock is. A complete draft has no "next", so it reads as the
  // count of selections made rather than an index into a pick that is not
  // coming — the same number, minus the off-by-one that would index past the
  // end of the array.
  const bcastIndex = stateRow && !stateRow.complete ? stateRow.pickIndex : madePicks.length;

  // What this club came here to fix. The same 0..1 scores the AI bids and
  // drafts on, so "a hole on our roster" means the same thing on both sides of
  // the table rather than being a second, friendlier model invented for the UI.
  const bcastRoster = broadcast
    ? await prisma.player.findMany({ where: { teamId: team.id }, select: { id: true, position: true, trueOvr: true, age: true, potential: true } })
    : [];
  const needScores = teamNeeds(bcastRoster);
  const needList = Object.entries(needScores)
    .filter(([, v]) => v >= 0.15)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([position, value]) => ({ position, value, ...needSeverity(value) }));
  // "A hole", for the purposes of a chip on a feed row, is a real one — the
  // top of that list, not the fifth-mildest thing on a good roster.
  const holes = new Set(needList.filter((n) => n.value >= 0.35).map((n) => n.position));

  const positionGone = new Map<string, number>();
  const feedRows: FeedRow[] = [];
  for (const pick of madePicks) {
    const p = pick.player!;
    const overall = overallOf(pick.round, pick.slot);
    const gone = (positionGone.get(p.position) ?? 0) + 1;
    positionGone.set(p.position, gone);
    const club = teamById.get(pick.ownerTeamId);
    const read = consensus.get(p.id);
    feedRows.push({
      pickId: pick.id,
      round: pick.round,
      overall,
      team: { id: club?.id ?? pick.ownerTeamId, abbr: club?.abbr ?? '???' },
      isUser: pick.ownerTeamId === team.id,
      player: { id: p.id, firstName: p.firstName, lastName: p.lastName, position: p.position, college: p.college },
      boardRank: read?.rank,
      ourRank: ourRank.get(p.id),
      shortlisted: shortlistIds.has(p.id),
      atOurNeed: holes.has(p.position) ? p.position : undefined,
      slide: read ? overall - read.rank : undefined,
      positionCount: gone,
    });
  }
  const feed = [...feedRows].reverse();

  // THE PICK THAT IS ON SCREEN RIGHT NOW.
  const lastPick = madePicks[madePicks.length - 1];
  let selection: SelectionCardData | undefined;
  if (broadcast && lastPick?.player) {
    const p = lastPick.player;
    const record = classPool.find((c) => c.id === p.id);
    const club = teamById.get(lastPick.ownerTeamId);
    const read = consensus.get(p.id);
    const view = record ? viewOf(record) : undefined;
    const gone = positionGone.get(p.position) ?? 0;
    const label = view && record
      ? playerLabel({
          ovr: view.scoutedOvr,
          potential: view.potentialRevealed ? record.potential : (view.potLow + view.potHigh) / 2,
          isDraftee: true, experience: 0, confidence: view.confidence,
        })
      : undefined;
    const notes: string[] = [];
    if (gone >= 3) notes.push(`${gone} ${p.position}s gone now.`);
    if (holes.has(p.position)) notes.push(`${p.position} is a hole on this roster.`);
    if (notes.length === 0 && read) notes.push(read.headline);
    selection = {
      pickId: lastPick.id,
      leagueId: league.id,
      year: league.seasonYear,
      round: lastPick.round,
      overall: overallOf(lastPick.round, lastPick.slot),
      team: {
        id: club?.id ?? lastPick.ownerTeamId,
        abbr: club?.abbr ?? '???',
        city: club?.city ?? 'The club',
        nickname: club?.nickname ?? '',
      },
      isUser: lastPick.ownerTeamId === team.id,
      player: {
        id: p.id, firstName: p.firstName, lastName: p.lastName, position: p.position,
        college: p.college, age: p.age, heightIn: p.heightIn, weightLb: p.weightLb,
      },
      board: read ? { rank: read.rank, grade: read.grade, bandLabel: read.bandLabel } : undefined,
      our: view && label
        ? {
            rank: ourRank.get(p.id),
            ovrLow: view.ovrLow, ovrHigh: view.ovrHigh,
            potLow: view.potLow, potHigh: view.potHigh,
            confidence: view.confidence,
            label: label.label, labelClass: label.className,
          }
        : undefined,
      shortlisted: shortlistIds.has(p.id),
      slide: read ? overallOf(lastPick.round, lastPick.slot) - read.rank : undefined,
      note: notes.join(' '),
    };
  }

  // RUN WATCH, and the state of the board by position.
  const cuts = bandCutoffs({ teams: LEAGUE.TEAM_COUNT, rounds: settings.draftRounds });
  const stillOnBoard = classPool.filter((p) => p.isDraftee && p.teamId === null);
  const stillOnBoardIds = new Set(stillOnBoard.map((p) => p.id));
  const runWindow = madePicks.slice(-RUN_WINDOW);
  const windowPositions = runWindow.map((p) => p.player!.position);
  const runEntries: RunEntry[] = [...new Set(windowPositions)]
    .map((position) => ({
      position,
      inWindow: windowPositions.filter((x) => x === position).length,
      hits: windowPositions.map((x) => x === position),
      totalGone: positionGone.get(position) ?? 0,
      leftOnBoard: stillOnBoard.filter((p) => p.position === position && (consensus.get(p.id)?.rank ?? 9e9) <= cuts.DAY_TWO).length,
      atOurNeed: holes.has(position),
    }))
    .sort((a, b) => b.inWindow - a.inWindow || a.position.localeCompare(b.position))
    .slice(0, 4);

  // Measured against the board's own day-two line while the draft is running:
  // "forty tackles are still in the class" answers nothing, and "two tackles
  // left with a day-two grade and four rounds to go" is what makes a GM move.
  // Once every pick is in that tier is empty by definition and the panel would
  // be sixteen zeroes — so the scope widens to the whole class, which is
  // exactly the list priority free agency is about to be worked from.
  const stockCut = bcastComplete ? Infinity : cuts.DAY_TWO;
  const stockByPosition = new Map<string, PositionStock>();
  if (broadcast) {
    for (const p of classPool) {
      const rank = consensus.get(p.id)?.rank;
      if (rank === undefined || rank > stockCut) continue;
      let row = stockByPosition.get(p.position);
      if (!row) {
        row = { position: p.position, gone: 0, left: 0, atOurNeed: holes.has(p.position) };
        stockByPosition.set(p.position, row);
      }
      if (stillOnBoardIds.has(p.id)) row.left += 1;
      else row.gone += 1;
    }
  }
  const stock = [...stockByPosition.values()].sort((a, b) => positionSortKey(a.position) - positionSortKey(b.position));

  // BEST AVAILABLE — ours and theirs.
  const toAvailableRow = (p: (typeof classPool)[number]): AvailableRow => {
    const view = viewOf(p);
    const read = consensus.get(p.id);
    return {
      playerId: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      position: p.position,
      college: p.college,
      ourRank: ourRank.get(p.id),
      boardRank: read?.rank,
      bandLabel: read?.bandLabel,
      ovrLow: view.ovrLow,
      ovrHigh: view.ovrHigh,
      revealed: view.revealed,
      confidence: view.confidence,
      shortlisted: shortlistIds.has(p.id),
    };
  };
  const roomBest = broadcast
    ? [...stillOnBoard].sort((a, b) => (consensus.get(a.id)?.rank ?? 9e9) - (consensus.get(b.id)?.rank ?? 9e9)).slice(0, 8).map(toAvailableRow)
    : [];
  const ourBest = broadcast
    ? stillOnBoard.filter((p) => ourRank.has(p.id)).sort((a, b) => ourRank.get(a.id)! - ourRank.get(b.id)!).slice(0, 8).map(toAvailableRow)
    : [];
  // The sharpest live disagreement: a man inside our own top forty who the
  // room has a long way further down. That gap is the entire return on a
  // season of scouting, so it is stated in words rather than left to be found
  // by comparing two columns.
  const edge = broadcast
    ? stillOnBoard
        .filter((p) => (ourRank.get(p.id) ?? 9e9) <= 40 && consensus.get(p.id))
        .map((p) => ({ p, gap: consensus.get(p.id)!.rank - ourRank.get(p.id)! }))
        .sort((a, b) => b.gap - a.gap)[0]
    : undefined;
  const bcastVerdict = edge && edge.gap >= 12
    ? `${edge.p.firstName} ${edge.p.lastName} is our #${ourRank.get(edge.p.id)} and the room's #${consensus.get(edge.p.id)!.rank}. `
      + (disagreementNote(consensus.get(edge.p.id)!, viewOf(edge.p)) ?? 'Nobody else in the league is looking at him this way.')
    : ourBest.length === 0
      ? 'Both columns would be the same board if we had one of our own.'
      : undefined;

  // The club's own side of the room.
  const bcastMyPicks = bcastPicks.filter((p) => p.ownerTeamId === team.id);
  const warRoomPicks: WarRoomPick[] = bcastMyPicks.map((p) => ({
    round: p.round,
    overall: overallOf(p.round, p.slot),
    picksAway: p.used ? undefined : Math.max(0, overallOf(p.round, p.slot) - 1 - bcastIndex),
    spentOn: p.used && p.player ? `${p.player.firstName} ${p.player.lastName}` : undefined,
  }));
  const bcastNextMine = bcastMyPicks.find((p) => !p.used);
  const bcastYourNext = bcastNextMine && !bcastComplete
    ? {
        round: bcastNextMine.round,
        overall: overallOf(bcastNextMine.round, bcastNextMine.slot),
        picksAway: Math.max(0, overallOf(bcastNextMine.round, bcastNextMine.slot) - 1 - bcastIndex),
      }
    : undefined;
  /** The club-coloured band replaces the plain on-clock hero for a live rookie draft. */
  const broadcastHero = broadcast && !bcastComplete && !!state && !!onClockTeam;
  const bcastUpcoming: UpcomingSlot[] = bcastComplete ? [] : bcastPicks.slice(bcastIndex, bcastIndex + UPCOMING_SLOTS).map((p) => {
    const club = teamById.get(p.ownerTeamId);
    return {
      overall: overallOf(p.round, p.slot),
      round: p.round,
      teamId: club?.id ?? p.ownerTeamId,
      abbr: club?.abbr ?? '???',
      isUser: p.ownerTeamId === team.id,
      isOnClock: overallOf(p.round, p.slot) === bcastIndex + 1,
    };
  });

  return (
    // The selection card is raised from inside the board but must outlive it:
    // the pick action revalidates this route, and the row that raised it is
    // gone from the board a moment later. The provider sits above all of that.
    <DraftMomentProvider>
    <div className="space-y-6">
      {classOutlook && (
        <div className="panel px-4 py-3 flex items-start gap-3">
          <span className="label-sm text-accent2 shrink-0 mt-0.5">Class Outlook</span>
          <p className="text-sm text-chalk/90">{classOutlook.detail}</p>
        </div>
      )}

      {!(state && onClockTeam) && (
        <PageMasthead
          teamId={team.id}
          teamAbbr={team.abbr}
          eyebrow={state
            ? (state.kind === 'FANTASY' ? 'Fantasy Draft' : `Rookie Draft · Round ${state.round}`)
            : draftJustFinished ? 'Rookie Draft' : 'Scouting Hub'}
          // Named for the draft these prospects are actually selected in, not
          // the season being played: they're generated during one season and
          // drafted in the offseason after it, so seasonYear runs a year early
          // and wouldn't match the picks you'd spend on them.
          //
          // EXCEPT in the window between the last selection and the phase
          // advancing. The class that just went through the draft is still
          // flagged isDraftee (the conversion runs on the way out of DRAFT,
          // see lib/season.ts), while upcomingDraftYear has already moved to
          // next year's picks — so the old title called 176 undrafted men
          // "the 2028 Draft Class", a class that will not be generated until
          // week 1 of the coming season.
          title={state
            ? `Pick ${state.pickIndex + 1} of ${totalPicks}`
            : draftJustFinished ? `${recapYear} Draft Complete` : `${upcomingDraftYear ?? league.seasonYear} Draft Class`}
          subtitle={state || draftJustFinished
            ? undefined
            : 'The incoming class is browsable all season — scout them now, the draft opens after free agency.'}
          facts={[
            {
              label: draftJustFinished ? 'Undrafted' : 'Prospects',
              value: String(classSize),
              detail: searchParams.pos ? `filtered to ${searchParams.pos}` : draftJustFinished ? 'nobody called their name' : 'in the class',
            },
            {
              label: 'Shortlisted',
              tip: tip('shortlist'),
              value: String(shortlistIds.size),
              detail: shortlistIds.size > 0 ? 'flagged to watch' : 'star anyone to track them',
              color: shortlistIds.size > 0 ? 'text-gold' : undefined,
            },
            { label: 'Your Picks', value: String(imminentPicks.length), detail: pickTileDetail, tip: tip('pickValue') },
            {
              label: 'Well Scouted',
              tip: tip('scoutingConfidence'),
              value: `${scoutedCount}`,
              detail: pool.length > 0 ? `of the top ${pool.length} shown` : 'nobody yet',
              color: scoutedCount === 0 ? 'text-warn' : undefined,
            },
          ]}
        />
      )}

      {/*
        THE WAR ROOM — the ten minutes before the commissioner walks out.
        Everything is ready and nothing has happened yet, which is exactly what
        this panel has to say. It stands in the on-clock hero's place (same
        card treatment, so it reads as the same object a moment later) until
        StartDraftButton flips DraftState.started.
      */}
      {warRoom && (
        <div
          className="relative overflow-hidden rounded-lg border-2 shadow-elevated"
          style={{
            ['--team-accent' as never]: generateTeamLogoParams(team.abbr).primary,
            borderColor: 'var(--team-accent)',
            background: 'radial-gradient(ellipse 120% 140% at 0% 50%, color-mix(in srgb, var(--team-accent) 18%, transparent), transparent 70%)',
          }}
        >
          <div
            className="absolute inset-0 opacity-[0.05] pointer-events-none"
            style={{ backgroundImage: 'repeating-linear-gradient(115deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 14px)', color: 'var(--team-accent)' }}
          />
          <TeamLogo seed={team.id} abbr={team.abbr} size={240} className="watermark-logo opacity-[0.06] -right-16 -top-16" />

          <div className="relative px-6 py-6 space-y-5">
            <div className="flex items-center gap-4">
              <TeamLogo seed={team.id} abbr={team.abbr} size={56} />
              <div>
                <div className="label-sm">{league.seasonYear} Rookie Draft · {settings.draftRounds} rounds · {totalPicks} selections</div>
                <div className="font-display font-extrabold text-3xl uppercase tracking-wide leading-none mt-1 text-team">
                  The War Room
                </div>
              </div>
            </div>

            <p className="text-sm text-chalk/90 leading-snug max-w-2xl">
              The class is graded and the order is set{onClockTeam ? `, with ${onClockTeam.city} first to the podium` : ''}.
              {' '}
              {imminentPicks.length === 0
                ? 'You hold no selections in this draft — you can still watch it, and the board comes to you if a deal happens.'
                : firstSelection
                ? `You hold ${imminentPicks.length} selection${imminentPicks.length === 1 ? '' : 's'}, the first at ${firstSelection}.`
                : `You hold ${imminentPicks.length} selection${imminentPicks.length === 1 ? '' : 's'}.`}
              {' '}
              Nothing goes on the clock until you send it.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
              <div>
                <div className="label-sm">Your Picks</div>
                <div className="stat-value text-stat-md text-chalk mt-1">{imminentPicks.length}</div>
                <div className="text-[11px] text-muted mt-1">{firstSelection ? `first at #${firstPick!.overall}` : 'none in this draft'}</div>
              </div>
              <div>
                <div className="label-sm">On the Board</div>
                <div className="stat-value text-stat-md text-chalk mt-1">{classSize}</div>
                <div className="text-[11px] text-muted mt-1">prospects in the class</div>
              </div>
              <div>
                <div className="label-sm">Shortlisted</div>
                <div className={`stat-value text-stat-md mt-1 ${shortlistIds.size > 0 ? 'text-gold' : 'text-chalk'}`}>{shortlistIds.size}</div>
                <div className="text-[11px] text-muted mt-1">{shortlistIds.size > 0 ? 'flagged to watch' : 'star anyone to track them'}</div>
              </div>
              <div>
                <div className="label-sm">Well Scouted</div>
                <div className={`stat-value text-stat-md mt-1 ${scoutedCount === 0 ? 'text-warn' : 'text-chalk'}`}>{scoutedCount}</div>
                <div className="text-[11px] text-muted mt-1">{pool.length > 0 ? `of the top ${pool.length} shown` : 'nobody yet'}</div>
              </div>
            </div>

            {/* The scouting department's unspent budget, stated before he
                spends the night regretting it rather than after. */}
            {(workoutSlots.remaining) > 0 && (
              <p className="text-sm text-warn/90 leading-snug">
                {workoutSlots.remaining} private workout{workoutSlots.remaining === 1 ? '' : 's'} unused —
                the window closes when this draft opens.
              </p>
            )}

            <div className="flex flex-wrap items-start gap-3">
              <StartDraftButton
                leagueId={league.id}
                unusedWorkouts={workoutSlots.remaining}
                fullScoutsLeft={warRoomDynasty?.fullScout.remaining ?? 0}
                scoutingHref={`/league/${league.id}/scouting`}
              />
            </div>

            <p className="text-[11px] text-muted leading-snug">
              Clubs go on a short clock once it starts. You can pause the board or fast-forward to your
              selection at any point, and every pick is announced as it is made.
            </p>
          </div>
        </div>
      )}

      {/* A live ROOKIE draft gets the broadcast band: the same club-coloured
          hero, plus the order of selection running out to your own pick. A
          fantasy draft keeps the plain band below it — it has no DraftPick
          rows, so there is no order to run out. */}
      {broadcastHero && (
        <BroadcastHero
          eyebrow={`Round ${state!.round} · Pick ${state!.pickIndex + 1} of ${totalPicks}`}
          headline={isUserOnClock ? 'You Are On The Clock' : `${onClockTeam!.city} On The Clock`}
          team={{ id: onClockTeam!.id, abbr: onClockTeam!.abbr, city: onClockTeam!.city, nickname: onClockTeam!.nickname }}
          yourNext={bcastYourNext}
          upcoming={bcastUpcoming}
          clock={
            <LiveDraftTicker leagueId={league.id} userTeamId={team.id} isUserOnClock={isUserOnClock} draftComplete={false} started={draftStarted} />
          }
        />
      )}

      {!broadcastHero && state && onClockTeam && draftStarted && (
        <div
          className="relative overflow-hidden rounded-lg border-2 shadow-elevated"
          style={{
            ['--team-accent' as never]: onClockColor,
            borderColor: 'var(--team-accent)',
            background: 'radial-gradient(ellipse 120% 140% at 0% 50%, color-mix(in srgb, var(--team-accent) 18%, transparent), transparent 70%)',
          }}
        >
          <div
            className="absolute inset-0 opacity-[0.05] pointer-events-none"
            style={{ backgroundImage: 'repeating-linear-gradient(115deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 14px)', color: 'var(--team-accent)' }}
          />
          <TeamLogo seed={onClockTeam.id} abbr={onClockTeam.abbr} size={240} className="watermark-logo opacity-[0.06] -right-16 -top-16" />

          <div className="relative flex flex-wrap items-center justify-between gap-4 px-6 py-6">
            <div className="flex items-center gap-4 min-w-[260px]">
              <TeamLogo seed={onClockTeam.id} abbr={onClockTeam.abbr} size={56} />
              <div>
                <div className="label-sm">
                  {state.kind === 'FANTASY' ? 'Fantasy Draft' : `Round ${state.round}`} · Pick {state.pickIndex + 1} of {totalPicks}
                </div>
                <div className="font-display font-extrabold text-3xl uppercase tracking-wide leading-none mt-1 text-team">
                  {isUserOnClock ? 'You Are On The Clock' : `${onClockTeam.city} On The Clock`}
                </div>
              </div>
            </div>
            <LiveDraftTicker leagueId={league.id} userTeamId={team.id} isUserOnClock={isUserOnClock} draftComplete={false} started={draftStarted} />
          </div>
        </div>
      )}

      {draftJustFinished && recap}

      {/*
        THE BROADCAST BODY.

        THE FEED IS A TICKER, NOT A DOCUMENT. It is capped to the viewport and
        scrolls inside its own rail, so the height of this page is a constant
        rather than a function of how many picks have been made — at pick 200
        an uncapped column would have run for thousands of pixels beside a left
        column that stopped one screen in. Pinned below the sticky header, too:
        it is the thing you keep half an eye on while reading anything else.
      */}
      {broadcast && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          <div className="xl:col-span-8 space-y-5">
            {/* Before the first card goes in there is no pick to put on screen
                and no run to detect, and the feed beside this says so already.
                Two panels apologising for an empty draft is one more than the
                moment deserves — the war room simply takes the width. */}
            {selection && <TheSelection data={selection} />}

            <div className={`grid grid-cols-1 gap-5 items-stretch ${madePicks.length > 0 ? 'lg:grid-cols-2' : ''}`}>
              {madePicks.length > 0 && (
                <RunWatch
                  entries={runEntries}
                  windowSize={runWindow.length || RUN_WINDOW}
                  order={windowPositions}
                  complete={bcastComplete}
                />
              )}
              <WarRoomPanel
                picks={warRoomPicks}
                needs={needList}
                filed={ourRank.size}
                classSize={classPool.length}
                shortlistLeft={[...shortlistIds].filter((id) => stillOnBoardIds.has(id)).length}
              />
            </div>

            {stock.length > 0 && (
              <BoardDepletion stock={stock} tierLabel={bcastComplete ? 'the whole class' : 'day-two grade or better'} />
            )}
          </div>

          <div className="xl:col-span-4">
            <div className="xl:sticky xl:top-[11rem]">
              <SelectionFeed rows={feed} made={madePicks.length} total={bcastPicks.length} leagueId={league.id} />
            </div>
          </div>
        </div>
      )}

      {broadcast && <BestAvailable leagueId={league.id} ours={ourBest} room={roomBest} verdict={bcastVerdict} />}

      {capitalList.length > 0 && (
        <DraftCapitalPanel years={capitalList} nextUp={nextUp} liveOrder={capitalLiveOrder} />
      )}

      {/* Not while the broadcast band is up — it carries the same running order
          inside the hero, alongside the count of names until your own pick. */}
      {!broadcastHero && upcomingPicks.length > 1 && (
        <div className="panel p-4">
          <h2 className="label-sm mb-2 inline-flex items-center gap-1.5">
            Upcoming Picks
            <Tooltip text={tip('onTheClock')} />
          </h2>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {upcomingPicks.map((p) => (
              <div
                key={p.idx}
                title={p.team ? `${p.team.city} ${p.team.nickname}` : ''}
                className={`shrink-0 flex flex-col items-center gap-1 px-2 py-1.5 rounded-lg border ${
                  p.idx === state!.pickIndex
                    ? 'border-accent bg-accent/10'
                    : p.team?.id === team.id
                    ? 'border-accent2/50 bg-accent2/10'
                    : 'border-line bg-raised'
                }`}
              >
                {p.team && <TeamLogo seed={p.team.id} abbr={p.team.abbr} size={20} />}
                <span className="text-[10px] font-mono font-semibold">{p.team?.abbr ?? '—'}</span>
                <span className="text-[9px] text-muted font-mono">Pick {p.idx + 1}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section">
        <SectionHeading
          title={broadcast ? 'Still On The Board' : 'Big Board'}
          tip={tip('consensusBoard')}
          action={
            <div className="flex gap-2 flex-wrap items-center">
              <a href={posHref()} className={`pill ${!searchParams.pos ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted'}`}>All</a>
              {positions.map((pos) => (
                <a key={pos} href={posHref(pos)} className={`pill ${searchParams.pos === pos ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted'}`}>{pos}</a>
              ))}
              <a href={shortlistHref()} className={`pill ${shortlistOnly ? 'border-gold text-gold bg-gold/10' : 'border-line text-muted'}`}>
                ★ Shortlist {shortlistIds.size > 0 && `(${shortlistIds.size})`}
              </a>
            </div>
          }
        />

        {/* THE WORKOUT LEDGER, ON THE BOARD ITSELF.
            The header has carried a "WORKOUTS 5/5" tile for a while and the
            board gave no sign that spending one was two clicks away, so the
            app owner read the whole mechanic as missing. The count and the
            window's own sentence now sit directly above the men a slot would
            be spent on, and the row control appears in the column on the
            right whenever the window is open. */}
        {/* Not in the war room. The panel above is already speaking about
            unspent workouts there, in its own words and at the moment they
            stop being spendable, and a second line under the board repeating
            the ledger in different language would be the page arguing with
            itself on the one screen where the point is urgency. */}
        {!warRoom && (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 -mt-1">
            <span className="label-sm">Private Workouts</span>
            <span className={`text-sm font-semibold ${workoutSlots.remaining === 0 ? 'text-muted' : 'text-gold'}`}>
              {workoutSlots.remaining} of {workoutSlots.max} left
            </span>
            <span className="text-xs text-muted">{workoutSlots.windowLabel}</span>
            {workoutSlots.open && workoutSlots.remaining > 0 && (
              <span className="text-xs text-muted">Fly a man in from his row.</span>
            )}
          </div>
        )}

        {/* Capped and scrolled. During a draft this table sits under a whole
            broadcast and eighty rows would push the page to four screens; out
            of it, the scouting hub shows three hundred and ran to twenty-one
            thousand pixels of one table. Nothing is dropped either way — the
            rows scroll inside the box, and `.table-clean th` is already
            sticky, so it pins to this container instead of the viewport and
            the column names stay over the numbers. */}
        <div className="panel max-h-[44rem] overflow-y-auto">
          <table className="table-clean">
            <thead>
              <tr>
                <th></th>
                <th className="text-right">
                  <span className="inline-flex items-center gap-1">
                    <a href={sortHref('ours')} className="hover:text-chalk">Ours{sortKey === 'ours' && (dir === -1 ? ' ▾' : ' ▴')}</a>
                    <Tooltip placement="bottom" align="start" text="Where this club's own scouts have him, ranked by our grade on the same blend of present and ceiling the room uses. Only men we have a real file on are on it." />
                  </span>
                </th>
                <th className="text-right"><a href={sortHref('consensus')} className="hover:text-chalk">Board{sortKey === 'consensus' && (dir === -1 ? ' ▾' : ' ▴')}</a></th>
                <th><a href={sortHref('pos')} className="hover:text-chalk">Pos{sortKey === 'pos' && (dir === -1 ? ' ▾' : ' ▴')}</a></th>
                <th>Name</th>
                <th><a href={sortHref('age')} className="hover:text-chalk">Age{sortKey === 'age' && (dir === -1 ? ' ▾' : ' ▴')}</a></th>
                <th>
                  <span className="inline-flex items-center gap-1">
                    <a href={sortHref('ovr')} className="hover:text-chalk">{settings.scoutingEnabled ? 'Scouted' : 'OVR'}{sortKey === 'ovr' && (dir === -1 ? ' ▾' : ' ▴')}</a>
                    <Tooltip placement="bottom" text={settings.scoutingEnabled ? tip('scoutedRange') : tip('overall')} />
                  </span>
                </th>
                <th>
                  <span className="inline-flex items-center gap-1">
                    <a href={sortHref('potential')} className="hover:text-chalk">Potential{sortKey === 'potential' && (dir === -1 ? ' ▾' : ' ▴')}</a>
                    {/* Downward: this table is wrapped in `panel
                        overflow-hidden`, which clips anything opening above
                        the header row. */}
                    <Tooltip placement="bottom" text={tip('potential')} />
                  </span>
                </th>
                <th>
                  <span className="inline-flex items-center gap-1">
                    Board Grade
                    {/* The cell carries the grade AND the band under it, so
                        the bubble covers both — two whole glossary strings
                        joined, never a slice of one: cutting a definition up
                        with a regex is how a rewrite over there silently
                        breaks the sentence over here. */}
                    <Tooltip placement="bottom" text={`${tip('boardGrade')} ${define('draftBand')}`} />
                  </span>
                </th>
                <th>
                  <span className="inline-flex items-center gap-1">
                    Projection
                    <Tooltip placement="bottom" text={tip('prospectProjection')} />
                  </span>
                </th>
                {/* Only while a slot can actually be spent. Eighty rows of
                    "Window closed" is not information, and the line above the
                    table says it once, plainly. */}
                {workoutSlots.open && (
                  <th>
                    <span className="inline-flex items-center gap-1">
                      Workout
                      <Tooltip placement="bottom" align="end" text={`${tip('privateWorkout')} ${workoutSlots.windowLabel}`} />
                    </span>
                  </th>
                )}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ p, view }) => {
                const potentialForLabel = view.potentialRevealed ? p.potential : (view.potLow + view.potHigh) / 2;
                const label = playerLabel({ ovr: view.scoutedOvr, potential: potentialForLabel, isDraftee: true, experience: 0, confidence: view.confidence });
                const read = consensus.get(p.id);
                // "Our file vs the board" goes through ownGradeFor, never a raw
                // scoutedOvr. The board grade blends current AND ceiling; a
                // scouted OVR is current only, so subtracting one from the
                // other would report us below the room on every prospect alive.
                const gap = read && view.confidence >= 25 ? ownGradeFor(view) - read.grade : 0;
                const note = read ? disagreementNote(read, view) : null;
                return (
                  <tr key={p.id}>
                    <td><ShortlistStar leagueId={league.id} teamId={team.id} playerId={p.id} initial={shortlistIds.has(p.id)} /></td>
                    {/* Our own board beside theirs. The disagreement is the
                        entire return on a season of scouting, and until now it
                        could only be read one row at a time out of the grade
                        column's "us NN". */}
                    <td className={`stat-value text-stat-sm text-right ${ourRank.has(p.id) ? 'text-accent2' : 'text-muted/50'}`}>
                      {ourRank.get(p.id) ?? '—'}
                    </td>
                    <td className="stat-value text-stat-sm text-muted text-right">{read?.rank ?? '—'}</td>
                    <td><span className={`font-semibold text-xs ${positionBadgeClass(p.position)}`}>{p.position}</span></td>
                    {/* Two deliberate lines rather than one wrapping one: with
                        the club's own board and the workout control now in the
                        row, a single flowing line of name + school + band
                        broke in a different place on every row and the column
                        read as rubble. */}
                    <td className="font-medium min-w-[13rem]">
                      <div className="flex items-center gap-2.5">
                        <a href={`/league/${league.id}/player/${p.id}`} className="shrink-0">
                          <PlayerAvatar seed={p.id} age={p.age} size={28} weightLb={p.weightLb} heightIn={p.heightIn} position={p.position} />
                        </a>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <a href={`/league/${league.id}/player/${p.id}`} className="hover:text-accent2 whitespace-nowrap">
                              {p.firstName} {p.lastName}
                            </a>
                            {rankBadge(p.id) && (
                              <span className={`pill text-[10px] px-1.5 py-0 border-current shrink-0 ${rankBadge(p.id)!.className}`}>{rankBadge(p.id)!.label}</span>
                            )}
                            {/* The workout column disappears with the window,
                                but the fact that we flew him in does not — it
                                is part of who he is to this club, and it is
                                most worth knowing on the clock. */}
                            {workedOutIds.has(p.id) && (
                              <span className="text-[10px] text-gold shrink-0" title="We flew him in for a private workout.">✓ worked out</span>
                            )}
                          </div>
                          <div className="text-xs text-muted truncate">{p.college}</div>
                        </div>
                      </div>
                    </td>
                    <td className="text-muted">{p.age}</td>
                    <td className={`stat-value text-stat-sm ${ratingColor(view.scoutedOvr)}`}>{view.revealed ? view.scoutedOvr : `${view.ovrLow}-${view.ovrHigh}`}</td>
                    <td className="text-muted font-mono">{view.potentialRevealed ? p.potential : `${view.potLow}-${view.potHigh}`}</td>
                    <td>
                      {read && (
                        <div className="flex items-baseline gap-1.5 whitespace-nowrap" title={note ?? read.headline}>
                          <span className="stat-value text-stat-sm text-chalk">{read.grade}</span>
                          {Math.abs(gap) >= 4 && (
                            <span className={`text-[11px] font-mono ${gap > 0 ? 'text-accent' : 'text-warn'}`}>
                              us {ownGradeFor(view)}
                            </span>
                          )}
                        </div>
                      )}
                      {read && <div className="text-[10px] text-muted leading-none mt-0.5">{read.bandLabel}</div>}
                    </td>
                    <td><span className={`text-xs font-medium ${label.className}`}>{label.label}</span></td>
                    {/* The column exists only while the window is open (see the
                        header). A man already worked out still renders here —
                        WorkoutButton refuses a second slot on him and says so —
                        and carries a ✓ beside his name in every other phase.
                        No `avatar` or `meta`: the row layout draws no
                        commitment card, and a second portrait per row for a
                        card that never appears is three hundred avatars of
                        wasted work. */}
                    {workoutSlots.open && (
                      <td>
                        <WorkoutButton
                          leagueId={league.id}
                          teamId={team.id}
                          playerId={p.id}
                          name={`${p.firstName} ${p.lastName}`}
                          remaining={workoutSlots.remaining}
                          max={workoutSlots.max}
                          open={workoutSlots.open}
                          windowLabel={workoutSlots.windowLabel}
                          done={workedOutIds.has(p.id)}
                          potLow={view.potLow}
                          potHigh={view.potHigh}
                          confidence={view.confidence}
                          layout="row"
                        />
                      </td>
                    )}
                    <td>
                      {/* Not while the war room is up: the GM is on the clock
                          for pick 1 only once he has actually opened the
                          draft. draftPlayer() refuses it server-side too. */}
                      {isUserOnClock && draftStarted && (
                        <DraftSelectionButton
                          leagueId={league.id}
                          teamId={team.id}
                          moment={{
                            team: { id: team.id, abbr: team.abbr, city: team.city, nickname: team.nickname },
                            pick: { year: league.seasonYear, round: onClockRound, overall: state!.pickIndex + 1 },
                            player: {
                              id: p.id,
                              firstName: p.firstName,
                              lastName: p.lastName,
                              position: p.position,
                              age: p.age,
                              college: p.college,
                              heightIn: p.heightIn,
                              weightLb: p.weightLb,
                              // The card carries the file this pick was MADE on.
                              // Drafting him clears Player.isDraftee, which is
                              // buildScoutedView's scope gate, so a view rebuilt
                              // a moment later would print his true rating on
                              // the one screen that exists to celebrate not
                              // knowing yet.
                              ovrLow: view.ovrLow,
                              ovrHigh: view.ovrHigh,
                              ovrExact: view.revealed ? view.scoutedOvr : undefined,
                              potLow: view.potLow,
                              potHigh: view.potHigh,
                              potExact: view.potentialRevealed ? p.potential : undefined,
                              confidence: view.confidence,
                              label: label.label,
                              labelClass: label.className,
                              boardRank: read?.rank,
                              boardGrade: read?.grade,
                              bandLabel: read?.bandLabel,
                              // The club's own line where its file differs
                              // from the room's, the room's line where it does
                              // not — the same two sentences this row already
                              // carries in its title attribute, said out loud
                              // at the moment they matter.
                              boardNote: note ?? read?.headline,
                            },
                          }}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {!draftJustFinished && recap}

      {/* The transaction headlines, for every state the selection feed does not
          cover — a fantasy draft, and the long stretch of the calendar when
          the last rookie draft is a memory. During the broadcast the feed says
          all of this and says what each pick meant, so the two together would
          be the same list twice. */}
      {!broadcast && (
        <div className="section">
          <SectionHeading title="Recent Picks" />
          <div className="panel px-4">
            {recentPicks.map((t) => (
              <div key={t.id} className="text-sm text-muted py-2 border-b border-line/60 last:border-0">{t.headline}</div>
            ))}
            {recentPicks.length === 0 && <p className="text-muted text-sm py-2">No picks yet.</p>}
          </div>
        </div>
      )}
    </div>
    </DraftMomentProvider>
  );
}
