import Link from 'next/link';
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
import { draftOrderContext, pickNumbers, projectionAppliesTo, draftIsStarted, rookieCapOutlook } from '@/lib/draft';
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
import { RosterNeeds } from '@/components/ds/RosterNeeds';
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
import { DraftViewToggle } from '@/components/draft/DraftViewToggle';
import { RookieCapWarning } from '@/components/draft/RookieCapWarning';
import { ProspectSearch } from '@/components/draft/ProspectSearch';
import type { AvailableRow } from '@/components/draft/BestAvailable';
import { positionBadgeClass } from '@/components/ds/positionColor';
import { Tooltip } from '@/components/Tooltip';
import { define, tip } from '@/lib/glossary';

type SortKey = 'consensus' | 'ours' | 'pos' | 'ovr' | 'age' | 'potential';

/** How many selections back the run detector looks. [TUNE] */
const RUN_WINDOW = 12;
/** Clubs shown in the hero's order-of-selection strip. */
const UPCOMING_SLOTS = 20;

export default async function DraftPage({ params, searchParams }: { params: { id: string }; searchParams: { pos?: string; sort?: string; dir?: string; shortlist?: string; q?: string } }) {
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
  // The context also carries which draft's stored slots are real and which
  // standings any projection is off, so this page and the trade screen put the
  // same number on the same pick.
  const draftOrder = await draftOrderContext(league.id);
  const upcomingDraftYear = draftOrder.imminentYear;

  const shortlistEntries = await prisma.shortlistEntry.findMany({ where: { teamId: team.id }, select: { playerId: true } });
  const shortlistIds = new Set(shortlistEntries.map((s) => s.playerId));
  const shortlistOnly = searchParams.shortlist === '1';

  // THE NAME SEARCH. The app owner: *"we should be able to search by name for
  // prospects in the draft board"*. Capped in length because it is echoed back
  // into the empty state, and every token has to match a first or a last name
  // so that "smith" finds him, "john smith" finds him, and "smith john" does
  // too — a GM typing a name he half-remembers is not required to know which
  // half he is typing.
  const query = (searchParams.q ?? '').trim().slice(0, 40);
  const queryTokens = query.split(/\s+/).filter(Boolean);

  // During a live draft, only the top of the board matters pick-to-pick.
  // Off the clock, this is the whole-class scouting hub — show a lot more
  // of it (the class is ~400 deep now that a real UDFA share exists).
  const where: any = { leagueId: league.id, teamId: null, status: 'FREE_AGENT', isDraftee: true };
  if (searchParams.pos) where.position = searchParams.pos;
  if (shortlistOnly) where.id = { in: Array.from(shortlistIds) };
  if (queryTokens.length > 0) {
    where.AND = queryTokens.map((t) => ({
      OR: [
        { firstName: { contains: t, mode: 'insensitive' } },
        { lastName: { contains: t, mode: 'insensitive' } },
      ],
    }));
  }
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
    //
    // A NAME SEARCH LIFTS THE CAP, like the shortlist does and for the same
    // reason: it is already a narrow question. Capped, "find me Okafor" would
    // have searched the top eighty men by rating and reported that a sixth-
    // round name does not exist — which is the one search a GM actually needs
    // on the clock.
    prisma.player.findMany({ where, orderBy: { trueOvr: 'desc' }, take: shortlistOnly || queryTokens.length > 0 ? undefined : (draftLive && draftStarted ? 80 : 300) }),
    prisma.player.count({ where: classWhere }),
  ]);
  const reports = await prisma.scoutingReport.findMany({ where: { teamId: team.id, playerId: { in: pool.map((p) => p.id) } } });
  const reportMap = new Map(reports.map((r) => [r.playerId, r]));
  // THE PILLS DESCRIBE THE CLASS, NOT THE SLICE IN FRONT OF YOU. Built from
  // `pool`, every filter ate the row of pills that was supposed to undo it:
  // clicking QB left "All" and "QB" as the only positions on the page, and a
  // name search would have cut it to whatever the matches happened to play.
  // Distinct over the unfiltered class, the pills are the same every time, so
  // a filter is always one click from being changed rather than only cleared.
  const positions = (await prisma.player.findMany({ where: classWhere, select: { position: true }, distinct: ['position'] }))
    .map((p) => p.position)
    .sort((a, b) => positionSortKey(a) - positionSortKey(b));

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

  /**
   * EVERY LINK ON THIS BOARD IS THE WHOLE BOARD, MINUS ONE THING.
   *
   * One builder rather than three string recipes, because the filters have to
   * compose: a position pill has to keep the search, the search has to keep
   * the shortlist, and a column header has to keep both. Three hand-rolled
   * suffixes were already dropping things across each other — the sort links
   * carried position and shortlist, the shortlist link dropped nothing but
   * would have silently dropped a search the moment one existed. Pass what
   * changes; everything else rides along.
   *
   * EVERY ONE OF THEM IS FOLLOWED SOFTLY — `next/link`, `scroll={false}`, and
   * that is now load-bearing rather than a nicety. A plain `<a>` reloads the
   * document, and a reload throws away the view the GM is standing in: the
   * BOARD/ROOM choice is client state (see DraftViewToggle), so filtering by
   * position from the board used to drop him back into the broadcast, at the
   * top of the page, holding a filter he could no longer see. A soft
   * navigation re-renders the server half and leaves the client half alone,
   * so the rows change under him and nothing else moves.
   */
  const boardHref = (patch: { pos?: string | null; shortlist?: boolean; sort?: SortKey; dir?: 'asc' | 'desc'; q?: string } = {}) => {
    const p = new URLSearchParams();
    const pos = patch.pos !== undefined ? patch.pos : searchParams.pos;
    const short = patch.shortlist !== undefined ? patch.shortlist : shortlistOnly;
    const q = patch.q !== undefined ? patch.q : query;
    if (pos) p.set('pos', pos);
    if (short) p.set('shortlist', '1');
    if (q) p.set('q', q);
    p.set('sort', patch.sort ?? sortKey);
    p.set('dir', patch.dir ?? (dir === -1 ? 'desc' : 'asc'));
    return `/league/${league.id}/draft?${p.toString()}`;
  };
  const sortHref = (key: SortKey) => boardHref({ sort: key, dir: sortKey === key && dir === -1 ? 'asc' : 'desc' });
  const posHref = (pos?: string) => boardHref({ pos: pos ?? null });
  const shortlistHref = () => boardHref({ shortlist: !shortlistOnly });

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
  // What that count is a count OF. Normally the board is the top N of the
  // class by rating, so "of the top 80 shown" is exact — but a search or a
  // filter makes the slice a set of MATCHES instead, where "of the top 3"
  // would misdescribe both the rows and the ranking they came from.
  const boardFiltered = !!query || shortlistOnly || !!searchParams.pos;
  const scoutedScope = pool.length === 0
    ? 'nobody yet'
    : boardFiltered ? `of the ${pool.length} shown` : `of the top ${pool.length} shown`;

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
  // next draft's picks carry a projection instead, off the ORIGINAL club's
  // record, and a further-future year gets no number at all because there are
  // no standings to project it from. Every one of those calls is pickNumbers'
  // (lib/draft.ts), not this page's.
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
  // The one year whose order has actually been reseeded: see seededDraftYear
  // in lib/draft.ts, which walks the phase machine and says why the phase —
  // not the year, and not DraftState — is the honest test.
  const settledYear = draftOrder.seededYear;

  const capitalYears = new Map<number, DraftCapitalYear>();
  const yearBucket = (year: number) => {
    let y = capitalYears.get(year);
    if (!y) {
      const settled = year === settledYear;
      // A PROJECTION IS FOR THE NEXT DRAFT THAT HAS NO ORDER YET. Nothing more.
      //
      // This used to add `year === league.seasonYear + 1`, and that clause is
      // what put a bare row of numberless chips in front of the app owner:
      // *"it still doesnt show my projected draft picks too"*. RESET_STANDINGS
      // bumps seasonYear partway through the offseason, so from the re-sign
      // window on, the upcoming draft's year EQUALS seasonYear and the whole
      // conjunction went false — exactly the trap imminentDraftYear documents.
      // It also required live wins on the team rows, which that same step
      // zeroes, so it was asking about a season nobody was playing.
      //
      // projectionAppliesTo answers both properly, off real state: is there a
      // ranking on file, and is it the season that will actually seed THIS
      // draft (see lib/draft.ts). It is also the exact test pickNumbers runs
      // per pick, so a year can never be headed "off the 2028 finish" over a
      // column of blanks, or "order set when the draft opens" over a column of
      // numbers. And settled and projected can never both fire — `!settled` —
      // while for the imminent draft they are only both silent when the season
      // that sets its order has genuinely not been played.
      const projected = !settled && projectionAppliesTo(year, draftOrder);
      y = {
        year,
        settled,
        projected,
        // Which standings the projection is off, so the year heading can say
        // "off the 2028 finish" instead of asking a GM in the re-sign window
        // to imagine a season he has already played ending today.
        projectedFrom: projected && draftOrder.projection
          ? { season: draftOrder.projection.season, live: draftOrder.projection.live }
          : undefined,
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
      // One call decides which number this pick may wear, here and on the
      // trade screen both. Never the club's rank stamped on every round.
      const numbers = pickNumbers(p, draftOrder);
      const origin = p.originalTeamId === team.id ? undefined : teamById.get(p.originalTeamId);
      // Selections between the pick on the clock and this one. Only a rookie
      // draft has DraftPick rows to be on the clock with.
      const away = draftLive && !isFantasy && p.year === league.seasonYear && !p.used && numbers.overall !== undefined
        ? numbers.overall - 1 - state!.pickIndex
        : undefined;
      const pick: DraftCapitalPick = {
        id: p.id,
        year: p.year,
        round: p.round,
        overall: numbers.overall,
        projectedSlot: numbers.projectedSlot,
        projectedOverall: numbers.projectedOverall,
        projectedFrom: numbers.projectedFrom,
        roundSize,
        from: origin ? { teamId: origin.id, abbr: origin.abbr } : undefined,
        picksAway: away !== undefined && away >= 0 ? away : undefined,
        spentOn,
      };
      bucket.picks.push(pick);
    } else if (p.originalTeamId === team.id) {
      const holder = teamById.get(p.ownerTeamId);
      // Same call, and it reads THIS club's own record because it is this
      // club's pick — which is exactly what makes it worth showing: a first
      // traded away in August is a different asset in November.
      const numbers = pickNumbers(p, draftOrder);
      const forfeit: DraftCapitalForfeit = {
        id: p.id,
        year: p.year,
        round: p.round,
        overall: numbers.overall,
        projectedOverall: numbers.projectedOverall,
        to: { teamId: holder?.id ?? p.ownerTeamId, abbr: holder?.abbr ?? '???' },
        spentOn,
      };
      bucket.forfeited.push(forfeit);
    }
  }

  // The club's own place in the projected order, which every projected number
  // on the panel is derived from: slot + (round - 1) * 32. Shown only when a
  // year on the panel is actually carrying that projection.
  const projection = draftOrder.projection;
  const ownProjectedSlot = projection?.order.get(team.id);
  const capitalList = [...capitalYears.values()].sort((a, b) => a.year - b.year);
  for (const y of capitalList) {
    y.picks.sort((a, b) => a.round - b.round || (a.overall ?? a.projectedOverall ?? 0) - (b.overall ?? b.projectedOverall ?? 0));
    y.forfeited.sort((a, b) => a.round - b.round);
  }
  // The clubs whose records are setting every projected number on the panel:
  // this one, plus whoever a projected pick was acquired from. Each slot is
  // the one the projection returned — the same map the numbers above were
  // built from, never a second computation of it.
  const projectedYears = capitalList.filter((y) => y.projected);
  // THE RECORD BESIDE A CLUB MUST BE THE RECORD THE RANKING CAME FROM. Once
  // RESET_STANDINGS has wiped the live rows every club reads 0-0-0, so during
  // the offseason the standings on this row are read out of TeamSeasonRecord
  // for the season the projection actually ranked — the same rows
  // reseedDraftOrder will use.
  const orderRecords = projection && !projection.live && projectedYears.length > 0
    ? new Map((await prisma.teamSeasonRecord.findMany({
        where: { leagueId: league.id, year: projection.season },
        select: { teamId: true, wins: true, losses: true, ties: true },
      })).map((r) => [r.teamId, r]))
    : null;
  const liveOrderTeamIds = [
    ...new Set([
      ...(ownProjectedSlot !== undefined ? [team.id] : []),
      ...projectedYears.flatMap((y) => y.picks.map((p) => p.from?.teamId).filter((id): id is string => !!id)),
    ]),
  ];
  const capitalLiveOrder = projectedYears.length === 0 || !projection ? undefined : liveOrderTeamIds
    .map((id) => {
      const club = teamById.get(id);
      const slot = projection.order.get(id);
      if (!club || slot === undefined) return null;
      const frozen = orderRecords?.get(id);
      return {
        teamId: id,
        abbr: club.abbr,
        slot,
        outOf: projection.order.size,
        record: frozen ? `${frozen.wins}-${frozen.losses}-${frozen.ties}` : `${club.wins}-${club.losses}-${club.ties}`,
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
  /**
   * AND ONLY UNTIL THE NEXT CLASS IS ON THE BOARD.
   *
   * `lastDraftRow` on its own is just "the most recent draft that ever
   * happened", so a recap moved in and stayed: the app owner, in the 2029
   * re-sign window, looking at a 2028 DRAFT RECAP — *"im also in the 2029
   * draft and its still showing last year's stuff. that should be cleared when
   * the new class comes in"*. That is the real-football rule, and it is a rule
   * about the class, not about the calendar.
   *
   * So the test is the class itself. A class generated during season S is
   * drafted in the draft of S + 1 (addDraftClass stamps `draftYear: seasonYear`
   * at week 1 of the season so it can be scouted all year) — the same
   * off-by-one the leftovers query above works around — so the class for the
   * next draft is `upcomingDraftYear - 1`, and if any of it is still flagged
   * isDraftee it is on the board waiting to be picked.
   *
   * Why the rows and not the step: ADD_DRAFT_CLASS is where the GM is TOLD the
   * board is there, but the players were minted a season earlier at PRESEASON.
   * Reading the rows means the answer is the same on both sides of that step —
   * and the same at every step of the offseason, so a save stranded mid-
   * offseason by an older one-step-per-press build reads exactly what a save
   * advancing under this one reads, with no window where a stale recap slips
   * back in.
   *
   * And it cannot swallow the recap that matters. The advance out of DRAFT
   * clears every isDraftee flag in the league (see lib/season.ts), so from the
   * last selection until the coming preseason mints the next class nothing
   * matches here and the draft that just finished is on screen — which is the
   * one window the recap is the whole reason to be on this page. The new class
   * arriving is what retires it.
   */
  const nextClassOnBoard = upcomingDraftYear !== null && (await prisma.player.count({
    where: { leagueId: league.id, isDraftee: true, draftYear: upcomingDraftYear - 1 },
  })) > 0;
  const recapYear = lastDraftRow
    && !(draftLive && lastDraftRow.year === league.seasonYear)
    && !nextClassOnBoard
    ? lastDraftRow.year
    : null;
  const recapPickRows = recapYear === null ? [] : await prisma.draftPick.findMany({
    where: { leagueId: league.id, year: recapYear, used: true, playerId: { not: null } },
    include: {
      player: {
        select: {
          id: true, firstName: true, lastName: true, position: true, age: true,
          college: true, heightIn: true, weightLb: true,
          // The ratings the recap is allowed to REASON from, never to print
          // directly. Everything a number on that panel is built out of goes
          // through recapViewOf below, which decides per player whether we may
          // see him at all — see the block above it.
          trueOvr: true, potential: true, trueAttrs: true, teamId: true, experience: true,
        },
      },
    },
    orderBy: [{ round: 'asc' }, { slot: 'asc' }],
  });
  // Our files on THAT class. `reportMap` above covers the class currently on
  // the board, which is a different cohort entirely once a season has turned
  // over — without this a recap of last spring would quote our scouts as
  // having said nothing about anybody. Merged into the same map so the shared
  // viewOf() reads them, and merging this late cannot stale the memo above it:
  // an id from a PAST class has had no view built for it yet, and an id from
  // THIS one already had its report folded in by classReports, so what this
  // adds for it is the identical row.
  const recapReports = recapPickRows.length === 0 ? [] : await prisma.scoutingReport.findMany({
    where: { teamId: team.id, playerId: { in: recapPickRows.map((p) => p.playerId!) } },
  });
  for (const r of recapReports) reportMap.set(r.playerId, r);
  // That draft's board, over that draft's class: everyone it took, plus
  // everyone it left. The leftovers keep the draftYear their class was
  // generated under, which is one BELOW the year they were drafted in — the
  // same off-by-one the big board above has to work around.
  const recapClass = recapYear === null ? [] : await prisma.player.findMany({
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
      // Identity only, and only so the men NOBODY called can be named. No
      // rating of theirs is printed — an undrafted prospect is still a
      // prospect, and the fog over him never lifted.
      firstName: true, lastName: true,
    },
  });
  const recapBoard = recapYear === null ? null : consensusBoardMap(
    recapClass,
    { teams: LEAGUE.TEAM_COUNT, rounds: settings.draftRounds },
  );

  /**
   * THE FOG LINE, DRAWN ONE MAN AT A TIME.
   *
   * A draft recap is the one screen where both sides of it are on display at
   * once, so the rule has to be per player rather than per panel:
   *
   *   HE IS OURS NOW      exact overall, exact ceiling. He signed, he is in
   *                       the building, and this is the same call the roster
   *                       page makes about the same man (no `isProspect`, so
   *                       buildScoutedView's scope gate returns the truth).
   *                       Anything less would be a front office claiming not
   *                       to know what its own coaches see every morning.
   *   ANYBODY ELSE'S      viewOf, which hardcodes `isProspect: true`. Drafting
   *                       a man CLEARS Player.isDraftee, so passing the flag
   *                       off the record here would print another club's
   *                       rookie's true overall the instant he came off the
   *                       board — the worst number this page could show. What
   *                       we knew about him at the podium is what we knew.
   *
   * Keyed on where he is NOW, not on whose pick it was: a man we drafted and
   * have since traded away is somebody else's, and stops being exact the day
   * he stops being ours.
   */
  const recapViewOf = (p: {
    id: string; position: string; trueAttrs: string; trueOvr: number; potential: number; teamId: string | null;
  }): ScoutedPlayerView =>
    p.teamId === team.id
      ? buildScoutedView({
          position: p.position as any, trueAttrs: readJson(p.trueAttrs, {}), trueOvr: p.trueOvr, potential: p.potential,
          report: reportMap.get(p.id), settings, isOwnRoster: true, isUserView: true, dynasty: scoutMods,
        })
      : viewOf(p);

  const recapSelections: RecapSelection[] = recapPickRows
    .filter((p) => p.ownerTeamId === team.id && p.player)
    .map((p) => {
      const read = recapBoard?.get(p.player!.id);
      const origin = p.originalTeamId === team.id ? undefined : teamById.get(p.originalTeamId);
      const view = recapViewOf(p.player!);
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
        ovr: view.scoutedOvr,
        ovrLow: view.ovrLow,
        ovrHigh: view.ovrHigh,
        revealed: view.revealed,
        potLow: view.potLow,
        potHigh: view.potHigh,
        potentialRevealed: view.potentialRevealed,
        // `potentialRevealed`, not `revealed` — the ceiling is the stricter
        // question, and the midpoint of a band is what a label may read when
        // the exact number is not ours to have.
        projection: playerLabel({
          ovr: view.scoutedOvr,
          potential: view.potentialRevealed ? p.player!.potential : (view.potLow + view.potHigh) / 2,
          experience: p.player!.experience,
          confidence: view.confidence,
        }),
        // Only where we can see him exactly. ownGradeFor blends a current
        // rating with a ceiling; feeding it the midpoint of a fogged band
        // would print a decimal-point opinion we do not actually hold.
        ourGrade: view.revealed && view.potentialRevealed ? ownGradeFor(view) : undefined,
        // Our line where our book and the room's differ enough to argue about,
        // the room's own line where they do not — the same fallback, from the
        // same two functions, that his row on the big board used the night he
        // was taken, so the recap does not invent a second voice.
        note: read ? (disagreementNote(read, view) ?? read.headline) : undefined,
        boardRank: read?.rank,
        boardGrade: read?.grade,
        bandLabel: read?.bandLabel,
        from: origin ? { teamId: origin.id, abbr: origin.abbr } : undefined,
      };
    });

  // One name off the board, anybody's. The only rating on these rows is the
  // PUBLIC grade — free, identical for every club, and not an overall. Our own
  // range rides along only where the department filed a real report, using Our
  // Board's own threshold so this page cannot quote a read it would refuse to
  // rank; and `!revealed` keeps our seven out of it, since they are covered in
  // full directly above.
  const recapLeaguePick = (p: (typeof recapPickRows)[number]): RecapLeaguePick => {
    const club = teamById.get(p.ownerTeamId);
    const read = recapBoard?.get(p.player!.id);
    const view = recapViewOf(p.player!);
    return {
      overall: overallOf(p.round, p.slot),
      round: p.round,
      teamId: club?.id ?? p.ownerTeamId,
      teamAbbr: club?.abbr ?? '???',
      isUser: p.ownerTeamId === team.id,
      firstName: p.player!.firstName,
      lastName: p.player!.lastName,
      position: p.player!.position,
      college: p.player!.college,
      boardRank: read?.rank,
      boardGrade: read?.grade,
      ourFile: !view.revealed && view.confidence >= FILE_MIN ? { low: view.ovrLow, high: view.ovrHigh } : undefined,
      shortlisted: shortlistIds.has(p.player!.id),
    };
  };
  const recapRoundOne: RecapLeaguePick[] = recapPickRows.filter((p) => p.round === 1 && p.player).map(recapLeaguePick);
  // Everything after round one — 192 rows in a standard draft, which is why
  // the panel that renders it scrolls inside a cap instead of standing the
  // page back up as a document.
  const recapLater: RecapLeaguePick[] = recapPickRows.filter((p) => p.round > 1 && p.player).map(recapLeaguePick);

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
    // The best grade nobody called. He is a name on the phone list tonight and
    // on somebody's wire tomorrow, which is the one thing a class of leftovers
    // is actually good for — and it is his board rank, not a rating: the fog
    // over a man who never got drafted never lifted.
    const takenIds = new Set(recapPickRows.map((p) => p.playerId!));
    const bestLeft = recapClass
      .filter((pl) => !takenIds.has(pl.id))
      .map((pl) => ({ pl, read: recapBoard?.get(pl.id) }))
      .filter((x) => x.read !== undefined)
      .sort((a, b) => a.read!.rank - b.read!.rank)[0];
    if (bestLeft) {
      recapNotes.push({
        label: 'Best Undrafted',
        value: `${bestLeft.pl.firstName} ${bestLeft.pl.lastName}`,
        detail: `${bestLeft.pl.position} · board #${bestLeft.read!.rank}, never called`,
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
      later={recapLater}
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

  // WHAT HIS OWN CLASS COSTS, PRICED OFF THE SCALE THE DRAFT REALLY CHARGES.
  // Read only in the war room: draftPlayer blocks the user at the podium and
  // this is the last screen before it, so this is where he can still do
  // something about it. Null whenever there is nothing to say — no picks, the
  // cap switched off, or a club with room to spare (see rookieCapOutlook).
  const rookieCap = warRoom
    ? await rookieCapOutlook({ leagueId: league.id, teamId: team.id, seasonYear: league.seasonYear, capMode: settings.capMode })
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
  /**
   * EVERY CARD IS IN AND THE LEAGUE HAS NOT MOVED ON YET.
   *
   * The state this page spends the longest in after a draft — the GM presses
   * Advance when he is ready, not when the seventh round ends — and the state
   * it was longest in: 4,971px, five screens, against 1,882px for the same
   * save mid-draft. It gets its own half of nearly every decision below,
   * because a running draft and a finished one want different pages.
   */
  const draftClosed = broadcast && bcastComplete;
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

  // ===========================================================================
  // THE TWO VIEWS
  // ===========================================================================
  // Read top to bottom, this page used to be: class outlook, the club on the
  // clock, the pick on screen, the feed, the run watch, the war room panel,
  // off the board, best available, your picks — and THEN the board. Everything
  // above the board is something a GM reads; the board is the only thing he
  // acts on, so the one object he needs was furthest from him at the exact
  // moment he needed it. The app owner: *"theres a lot going on. the money
  // item is the actual draft itself and its buried at the bottom of the
  // screen. Can we maybe clean it up? or toggle 1 or 2 views?"*
  //
  // Each panel below is built once, here, and handed to whichever view it
  // belongs to. Nothing is built twice: THE BOARD gets the big board and the
  // club's draft capital, THE ROOM gets the broadcast, and the clock stands
  // above both because whose pick it is is never behind a tab.
  //
  // THE SAME TWO LANES SURVIVE THE LAST PICK, because the two jobs do. When
  // the draft closes the recap lands on top of a broadcast that nobody
  // switched off, and the page — which exists to not be one long document —
  // became five screens of one. The lanes are renamed for the moment: THE
  // CLASS is the room's record of what it did, WHAT'S LEFT is the men nobody
  // called plus next spring's capital. What does NOT survive is the furniture
  // of a running draft, which is dropped rather than moved: see `draftClosed`
  // on each node below for what goes and why.

  // The scouts' one-paragraph verdict on the class. It belongs to THE ROOM
  // during a draft: it is the same sentence it was in September, and on the
  // clock it is a banner between a GM and his board. After the draft it heads
  // THE CLASS, where the recap underneath it is the answer to what it
  // predicted.
  const classOutlookNode = (
    <>
      {classOutlook && (
        <div className="panel px-4 py-3 flex items-start gap-3">
          <span className="label-sm text-accent2 shrink-0 mt-0.5">Class Outlook</span>
          <p className="text-sm text-chalk/90">{classOutlook.detail}</p>
        </div>
      )}
    </>
  );

  // Where the board's early talent went, position by position. During a draft
  // it is part of the broadcast; once every pick is in it is the shape of the
  // pool free agency is about to be worked from, so it moves to WHAT'S LEFT
  // and stands beside the men themselves. Built once — the two states it
  // appears in are mutually exclusive.
  const depletionNode = stock.length > 0
    ? <BoardDepletion stock={stock} tierLabel={bcastComplete ? 'the whole class' : 'day-two grade or better'} />
    : null;

  const broadcastBodyNode = (
    <>
      {/*
        THE BROADCAST BODY — a draft that is still running, and nothing else.

        THE FEED IS A TICKER, NOT A DOCUMENT. It is capped to the viewport and
        scrolls inside its own rail, so the height of this view is a constant
        rather than a function of how many picks have been made — at pick 200
        an uncapped column would have run for thousands of pixels beside a left
        column that stopped one screen in. Pinned below the sticky header, too:
        it is the thing you keep half an eye on while reading anything else.

        NONE OF IT OUTLIVES THE LAST CARD. The pick on screen is the clock's
        final frame held up after the clock has gone; the feed is a third
        reading of the same 224 selections, after the recap has already given
        them in pick order with the grade, the board rank and our own file on
        each; and the war room's ledger reads 0 picks left, 0 starred men still
        on the board. What the finished draft keeps out of this block is How It
        Closed and the needs — see `closingNode`.
      */}
      {broadcast && !bcastComplete && (
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

            {depletionNode}
          </div>

          <div className="xl:col-span-4">
            <div className="xl:sticky xl:top-[11rem]">
              <SelectionFeed rows={feed} made={madePicks.length} total={bcastPicks.length} leagueId={league.id} />
            </div>
          </div>
        </div>
      )}
    </>
  );

  // Both best-available columns — the room's board and ours, side by side.
  //
  // WHILE THERE IS A PICK TO MAKE, and not one second after. The two columns
  // are the top eight of a board you are about to choose from, and their whole
  // point is the disagreement between them at the moment it costs something.
  // With the draft over they are the first eight rows of the table directly
  // below them, re-laid-out — two readings of a board nobody is picking from.
  const bestAvailableNode = (
    <>
      {broadcast && !bcastComplete && <BestAvailable leagueId={league.id} ours={ourBest} room={roomBest} verdict={bcastVerdict} />}
    </>
  );

  /**
   * THE MORNING AFTER, IN TWO PANELS.
   *
   * What a GM reads once the drafting is done is not the broadcast with the
   * clock removed. It is: how did it end, and what did it not fix. The first
   * is Run Watch's own closing form, which already exists and is the one thing
   * in the broadcast written for this moment rather than surviving into it.
   *
   * The second is the needs bars, and they were the page's own quiet lie. The
   * war room panel headed them "What We Came Here To Fix" — the pre-draft plan
   * — while computing them off `bcastRoster`, which is this club's roster as
   * it stands NOW, rookies included. So the numbers were always the day-after
   * answer wearing the day-before label. Read straight, they are the most
   * forward-looking thing on this page: seven picks in, here is what is still
   * open, and the men in the other tab are who is left to close it.
   */
  const closingNode = (
    <>
      {/* items-start, not stretch: the needs are five bars against a run chart
          with a twelve-pick strip under it, and stretched to match they left a
          hand's width of empty panel under the last bar. */}
      {draftClosed && madePicks.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          <RunWatch entries={runEntries} windowSize={runWindow.length || RUN_WINDOW} order={windowPositions} complete />
          {needList.length > 0 && (
            <div className="panel p-4">
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <h2 className="section-title">What The Draft Didn&rsquo;t Fix</h2>
                <span className="text-[11px] font-mono text-muted">after {settings.draftRounds} rounds</span>
              </div>
              <RosterNeeds needs={needList} />
              <p className="text-[11px] text-muted mt-3 pt-2.5 border-t border-line/50">
                The men nobody called go on the wire when the league moves on.
              </p>
            </div>
          )}
        </div>
      )}
    </>
  );

  // Every pick this club holds, in every scheduled draft. It sits UNDER the
  // big board in THE BOARD view rather than over it: the point of the view is
  // that the men are the first thing on it, and the hero above already says
  // which selection is yours and how many names are in front of it.
  const capitalPanelNode = (
    <>
      {capitalList.length > 0 && (
        <DraftCapitalPanel
          years={capitalList}
          nextUp={nextUp}
          liveOrder={capitalLiveOrder}
          orderFrom={projection ? { season: projection.season, live: projection.live } : undefined}
        />
      )}
    </>
  );

  const upcomingStripNode = (
    <>
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
    </>
  );

  /**
   * WHEN THE BOARD COMES BACK EMPTY.
   *
   * A table with a header and no rows says "broken" far more readily than it
   * says "no matches", and with three filters now able to compose — position,
   * shortlist, and a name — the useful thing to say is which of them is doing
   * it, with the undo for each one attached. It also names the one thing a
   * search cannot explain by itself: during a live draft this board is the men
   * still available, so a prospect who has already been called is not missing,
   * he is in the feed on the other view.
   */
  const boardEmptyState = (() => {
    const posLabel = searchParams.pos ? `${searchParams.pos} ` : '';
    const headline = query
      ? `No ${posLabel}prospect${shortlistOnly ? ' on your shortlist' : ''} matching “${query}”.`
      : shortlistOnly
        ? `Nothing on your shortlist is ${posLabel ? `a ${searchParams.pos} still on the board` : 'still on the board'}.`
        : searchParams.pos
          ? `No ${searchParams.pos}s left on this board.`
          : 'Nobody is on this board.';
    const undo: { href: string; label: string }[] = [];
    if (query) undo.push({ href: boardHref({ q: '' }), label: 'Clear the search' });
    if (searchParams.pos) undo.push({ href: boardHref({ pos: null }), label: 'Every position' });
    if (shortlistOnly) undo.push({ href: boardHref({ shortlist: false }), label: 'The whole class' });
    return (
      <tr>
        <td colSpan={workoutSlots.open ? 12 : 11} className="px-3 py-10 text-center">
          <p className="text-sm text-chalk/90">{headline}</p>
          {query && broadcast && !bcastComplete && (
            <p className="text-xs text-muted mt-1.5">
              This board is the men still available — if his name has been called, he is in the feed in The Room.
            </p>
          )}
          {undo.length > 0 && (
            <div className="flex items-center justify-center gap-4 mt-3">
              {undo.map((u) => (
                <Link key={u.label} href={u.href} scroll={false} prefetch={false} className="text-xs text-accent2 hover:text-accent">{u.label}</Link>
              ))}
            </div>
          )}
        </td>
      </tr>
    );
  })();

  const boardSectionNode = (
    <>
      {/* `id` so the rest of the app can link straight at the men — and so a
          screenshot run can prove where the first row lands. */}
      <div className="section" id="big-board">
        <SectionHeading
          // "Still on the board" is a thing you say while there is a board.
          // Once the seventh round is over these men are simply the undrafted,
          // which is also what the masthead calls them and what they become the
          // moment the league moves on.
          title={draftClosed ? 'Undrafted' : broadcast ? 'Still On The Board' : 'Big Board'}
          tip={tip('consensusBoard')}
          action={
            <div className="flex gap-2 flex-wrap items-center justify-end">
              {/* THE SEARCH SITS WITH THE FILTERS BECAUSE IT IS ONE. It carries
                  the position pill and the shortlist with it (see boardHref),
                  so typing narrows whatever is already on screen instead of
                  quietly resetting it. */}
              <ProspectSearch initial={query} baseHref={boardHref({ q: '' })} matches={sorted.length} />
              <Link href={posHref()} scroll={false} prefetch={false} className={`pill ${!searchParams.pos ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted'}`}>All</Link>
              {positions.map((pos) => (
                <Link key={pos} href={posHref(pos)} scroll={false} prefetch={false} className={`pill ${searchParams.pos === pos ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted'}`}>{pos}</Link>
              ))}
              <Link href={shortlistHref()} scroll={false} prefetch={false} className={`pill ${shortlistOnly ? 'border-gold text-gold bg-gold/10' : 'border-line text-muted'}`}>
                ★ Shortlist {shortlistIds.size > 0 && `(${shortlistIds.size})`}
              </Link>
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
            itself on the one screen where the point is urgency.

            AND NOT ONCE THE DRAFT IS OVER. "5 of 5 left · workouts closed for
            this class" is a budget nobody can spend on men nobody can fly in,
            reported above a table of men who have already gone undrafted. The
            row control is gone with the window (see `workoutSlots.open` on the
            column), so by then the line explains the absence of something the
            reader never saw. */}
        {!warRoom && !draftClosed && (
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

        {/* Capped and scrolled, in every state. The scouting hub shows three
            hundred men and ran to twenty-one thousand pixels of one table;
            during a draft the slice is eighty, or every man whose name matches
            a search. Nothing is dropped either way — the rows scroll inside
            the box, and `.table-clean th` is already sticky, so it pins to
            this container instead of the viewport and the column names stay
            over the numbers.

            THE CAP IS ALSO WHY THE BOARD VIEW IS ONE SCREEN. Under the toggle
            this table is the first thing on the page after the clock, and a
            forty-four-rem box means the rows a GM is choosing between are
            above the fold rather than somewhere down an eighty-row document
            that the page grows and shrinks with. */}
        <div className="panel max-h-[44rem] overflow-y-auto">
          <table className="table-clean">
            <thead>
              <tr>
                <th></th>
                <th className="text-right">
                  <span className="inline-flex items-center gap-1">
                    <Link href={sortHref('ours')} scroll={false} prefetch={false} className="hover:text-chalk">Ours{sortKey === 'ours' && (dir === -1 ? ' ▾' : ' ▴')}</Link>
                    <Tooltip placement="bottom" align="start" text="Where this club's own scouts have him, ranked by our grade on the same blend of present and ceiling the room uses. Only men we have a real file on are on it." />
                  </span>
                </th>
                <th className="text-right"><Link href={sortHref('consensus')} scroll={false} prefetch={false} className="hover:text-chalk">Board{sortKey === 'consensus' && (dir === -1 ? ' ▾' : ' ▴')}</Link></th>
                <th><Link href={sortHref('pos')} scroll={false} prefetch={false} className="hover:text-chalk">Pos{sortKey === 'pos' && (dir === -1 ? ' ▾' : ' ▴')}</Link></th>
                <th>Name</th>
                <th><Link href={sortHref('age')} scroll={false} prefetch={false} className="hover:text-chalk">Age{sortKey === 'age' && (dir === -1 ? ' ▾' : ' ▴')}</Link></th>
                <th>
                  <span className="inline-flex items-center gap-1">
                    <Link href={sortHref('ovr')} scroll={false} prefetch={false} className="hover:text-chalk">{settings.scoutingEnabled ? 'Scouted' : 'OVR'}{sortKey === 'ovr' && (dir === -1 ? ' ▾' : ' ▴')}</Link>
                    <Tooltip placement="bottom" text={settings.scoutingEnabled ? tip('scoutedRange') : tip('overall')} />
                  </span>
                </th>
                <th>
                  <span className="inline-flex items-center gap-1">
                    <Link href={sortHref('potential')} scroll={false} prefetch={false} className="hover:text-chalk">Potential{sortKey === 'potential' && (dir === -1 ? ' ▾' : ' ▴')}</Link>
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
              {sorted.length === 0 && boardEmptyState}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );

  /**
   * WHICH STATES GET A TOGGLE, AND WHY THE REST DO NOT.
   *
   * A rookie draft that has been sent to the podium — running OR finished.
   * Both are states where two whole readings of the same draft want the same
   * screen, which is the problem the toggle solves; the difference is only
   * what the two readings are.
   *
   *   RUNNING (`broadcastHero`) — reading and acting compete under a clock.
   *     THE BOARD is the men, THE ROOM is the broadcast. That condition is
   *     used rather than `broadcast` on purpose: it also guarantees a club on
   *     the clock to head both views with, so neither view can ever be a draft
   *     page that cannot say whose pick it is.
   *   FINISHED (`draftClosed`) — the clock is gone and the recap has arrived
   *     on top of a broadcast that nobody switched off. THE CLASS is the
   *     recap; WHAT'S LEFT is the undrafted, the shape of what remains by
   *     position, and next spring's picks. This used to be excluded — "there
   *     is nothing left to act on, so the page becomes one document" — and the
   *     document ran to five screens, which is the one thing the toggle exists
   *     to prevent. The men nobody called ARE something to act on, a week from
   *     now on the wire; they are simply not the first thing to read.
   *
   *   THE WAR ROOM (board set, clock stopped) — no toggle. Nothing can be
   *     taken yet; the panel that starts the draft IS the page, and a "watch
   *     the broadcast" view of a draft that has not begun would be an empty
   *     room. The board is already the next thing under it.
   *   PRE-DRAFT SCOUTING (no draft running) — no toggle. There is no
   *     broadcast to split off: the page is a masthead, your picks and the
   *     class. It is all board already.
   *   AFTER THE PHASE MOVES ON — no toggle, and none needed. Advancing out of
   *     DRAFT clears every isDraftee flag in the league, so the board empties
   *     and the page is a masthead over the recap until the next class is
   *     minted (see `recapYear`). One thing to read, one column to read it in.
   *   A FANTASY DRAFT — no toggle. It has no DraftPick rows and therefore no
   *     broadcast at all, so its board is already second on the page.
   */
  const twoViews = broadcastHero || draftClosed;

  /**
   * IS IT ABOUT TO BE YOUR TURN? The one input the situational default takes.
   * One name away counts as your turn: the point is to be ALREADY looking at
   * the board when the room turns to you, not to start scrolling once it has.
   *
   * A FINISHED DRAFT IS NEVER URGENT AND CANNOT BECOME URGENT — no state, no
   * next selection — so THE CLASS leads, on the first visit and on the tenth.
   * That is the right default in both: the recap is why this page is open, and
   * it does not go stale the way the leftovers do.
   */
  const boardUrgent = twoViews && (isUserOnClock || (bcastYourNext?.picksAway ?? Infinity) <= 1);
  const urgentNote = !boardUrgent
    ? undefined
    : isUserOnClock || bcastYourNext?.picksAway === 0
      ? 'You are on the clock.'
      : 'One name to go.';

  return (
    // The selection card is raised from inside the board but must outlive it:
    // the pick action revalidates this route, and the row that raised it is
    // gone from the board a moment later. The provider sits above all of that.
    <DraftMomentProvider>
    <div className="space-y-6">
      {/* In the two-view states this banner rides with the broadcast; see
          classOutlookNode. */}
      {!twoViews && classOutlookNode}

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
          // WHAT STANDS WHERE LAST YEAR'S RECAP USED TO. Once the new class is
          // on the board the page is about the draft that has NOT happened
          // yet, and it already holds the two things that answers: the class
          // itself, and Your Picks — which now carries a real selection number
          // for every pick (see the capital panel above). This line points at
          // them, and changes when the draft stops being a thing next season
          // and becomes the next thing on the calendar.
          subtitle={state || draftJustFinished
            ? undefined
            : upcomingDraftYear !== null && upcomingDraftYear === league.seasonYear
            ? 'The season is in the books and the class is graded — your selections and where they land are below. The draft opens when free agency closes.'
            : 'The incoming class is browsable all season — scout them now, the draft opens after free agency.'}
          facts={[
            {
              label: draftJustFinished ? 'Undrafted' : 'Prospects',
              value: String(classSize),
              detail: [searchParams.pos ? `filtered to ${searchParams.pos}` : null, query ? `searching “${query}”` : null]
                .filter(Boolean)
                .join(' · ') || (draftJustFinished ? 'nobody called their name' : 'in the class'),
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
              detail: scoutedScope,
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
                <div className="text-[11px] text-muted mt-1">{scoutedScope}</div>
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

            {/* And what the class itself costs. Above the button, never inside
                its confirm: the workout confirm is one question asked once and
                vanishes when there are none left, this is the state of the
                books and is true whether he clicks anything or not. */}
            {rookieCap && <RookieCapWarning leagueId={league.id} outlook={rookieCap} />}

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

      {/* The recap leads a finished draft — but under the toggle it IS the
          leading pane, so above it as well would be the same document twice.
          This line is what a FANTASY draft's recap still comes out of. */}
      {draftJustFinished && !twoViews && recap}

      {twoViews ? (
        <DraftViewToggle
          urgent={boardUrgent}
          urgentNote={urgentNote}
          panes={draftClosed
            ? [
                {
                  id: 'room',
                  label: 'The Class',
                  hint: `${madePicks.length} selections in`,
                  body: <>{classOutlookNode}{recap}{closingNode}</>,
                },
                {
                  id: 'board',
                  label: "What's Left",
                  hint: `${stillOnBoard.length} undrafted`,
                  body: <>{boardSectionNode}{depletionNode}{capitalPanelNode}</>,
                },
              ]
            : [
                {
                  id: 'board',
                  label: 'The Board',
                  hint: `${stillOnBoard.length} still available`,
                  body: <>{boardSectionNode}{capitalPanelNode}</>,
                },
                {
                  id: 'room',
                  label: 'The Room',
                  hint: `pick ${bcastIndex + 1} of ${bcastPicks.length}`,
                  body: <>{classOutlookNode}{broadcastBodyNode}{bestAvailableNode}</>,
                },
              ]}
        />
      ) : (
        <>
          {broadcastBodyNode}
          {bestAvailableNode}
          {capitalPanelNode}
          {upcomingStripNode}
          {boardSectionNode}
        </>
      )}

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
