import { prisma } from '@/lib/db';
import { getLeagueContext, positionSortKey } from '@/lib/league-data';
import { readJson } from '@/lib/json';
import { buildScoutedView } from '@/lib/scouting';
import type { ScoutedPlayerView } from '@/lib/scouting';
import { loadScoutMods } from '@/lib/dynasty';
import { playerLabel } from '@/lib/ratings';
import { LEAGUE } from '@/lib/tuning';
import { bandCutoffs, consensusBoardMap, ownGradeFor, disagreementNote } from '@/lib/consensus';
import { draftIsStarted, imminentDraftYear } from '@/lib/draft';
import { needSeverity, teamNeeds } from '@/lib/ai/gm';
import { DraftMomentProvider } from '@/components/DraftMoment';
import { BroadcastHero } from '@/components/draft/BroadcastHero';
import type { UpcomingSlot } from '@/components/draft/BroadcastHero';
import { DraftClock } from '@/components/draft/DraftClock';
import { TheSelection } from '@/components/draft/TheSelection';
import type { SelectionCardData } from '@/components/draft/TheSelection';
import { SelectionFeed } from '@/components/draft/SelectionFeed';
import type { FeedRow } from '@/components/draft/SelectionFeed';
import { BoardDepletion, RunWatch, WarRoomPanel } from '@/components/draft/DraftIntel';
import type { PositionStock, RunEntry, WarRoomPick } from '@/components/draft/DraftIntel';
import { BestAvailable } from '@/components/draft/BestAvailable';
import type { AvailableRow } from '@/components/draft/BestAvailable';
import { ProspectBoard } from '@/components/draft/ProspectBoard';
import type { BoardRow, BoardSortKey } from '@/components/draft/ProspectBoard';

/**
 * ===========================================================================
 * DRAFT DAY, AS A BROADCAST
 * ===========================================================================
 * The draft page is a scouting hub with a banner on it, and it is a good
 * scouting hub — the fogged board, the ranges, the room's grade against ours,
 * the projection language. None of that is thrown away here; it is the bottom
 * half of this page, with one column added.
 *
 * What this route adds is the half the draft page has never had: the part you
 * WATCH. Draft day is the one day of the football year that is televised, and
 * the things a broadcast gives you are things no table can — the pick that
 * just landed, in the club's own colours; the names coming off in order with
 * what each one did to your plan; the run that means the eighth-best receiver
 * is about to go at a first-round price; the clock walking toward your slot.
 *
 * THE FOG IS NOT RELAXED ANYWHERE ON THIS PAGE. Every number a prospect
 * carries here comes out of buildScoutedView, and every view is built with
 * `isProspect: true` — including for men who have just been drafted, whose
 * Player.isDraftee flag is cleared by the selection itself. Reading that flag
 * back off the record would print a true overall the instant a man came off
 * the board, on the one screen that exists to celebrate not knowing yet.
 * ===========================================================================
 */

/** How many selections back the run detector looks. [TUNE] */
const RUN_WINDOW = 12;
/** Rows of the board rendered at once. The whole class stays browsable on /draft. */
const BOARD_ROWS = 80;
/** Selections shown in the order-of-selection strip. */
const UPCOMING_SLOTS = 20;

type Search = { pos?: string; sort?: string; dir?: string; shortlist?: string };

export default async function DraftBroadcastPage({ params, searchParams }: { params: { id: string }; searchParams: Search }) {
  const { league, settings, userTeam } = await getLeagueContext(params.id);
  const team = userTeam!;

  const stateRow = await prisma.draftState.findUnique({ where: { leagueId: league.id } });
  const draftYear = league.phase === 'DRAFT'
    ? league.seasonYear
    : (await imminentDraftYear(league.id)) ?? league.seasonYear;

  const allPicks = await prisma.draftPick.findMany({
    where: { leagueId: league.id, year: draftYear },
    include: {
      player: {
        select: { id: true, firstName: true, lastName: true, position: true, college: true, age: true, heightIn: true, weightLb: true },
      },
    },
    orderBy: [{ round: 'asc' }, { slot: 'asc' }],
  });

  // A fantasy draft has no DraftPick rows at all, and out of the draft phase
  // there is no room to broadcast from. Say so and point at the place where
  // the class is genuinely browsable, rather than an empty scoreboard.
  if (allPicks.length === 0) {
    return (
      <div className="section">
        <div className="panel p-6">
          <h1 className="font-display font-extrabold text-2xl uppercase tracking-wide">No Draft In Session</h1>
          <p className="text-sm text-muted mt-2 max-w-xl">
            The room is dark. The incoming class is scoutable all year on the draft board — this screen
            lights up when the clock starts.
          </p>
          <a href={`/league/${league.id}/draft`} className="btn-secondary mt-4">To The Draft Board</a>
        </div>
      </div>
    );
  }

  const roundSize = LEAGUE.TEAM_COUNT;
  const overallOf = (round: number, slot: number) => (round - 1) * roundSize + slot;
  const madePicks = allPicks.filter((p) => p.used && p.player);
  const complete = stateRow ? stateRow.complete : madePicks.length >= allPicks.length;
  const started = stateRow ? draftIsStarted(stateRow) : madePicks.length > 0;
  const pickIndex = stateRow && !stateRow.complete ? stateRow.pickIndex : madePicks.length;
  const onClockPick = complete ? undefined : allPicks[pickIndex];

  const teams = await prisma.team.findMany({ where: { leagueId: league.id } });
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const onClockTeam = onClockPick ? teamById.get(onClockPick.ownerTeamId) : undefined;
  const isUserOnClock = !!onClockPick && onClockPick.ownerTeamId === team.id;

  // -------------------------------------------------------------------------
  // THE CLASS, AND THE TWO BOARDS OVER IT
  // -------------------------------------------------------------------------
  // Same pool the draft page ranks against: everyone still in the class plus
  // everyone this draft has already taken out of it. A rank that moves because
  // somebody else got picked is a lie, so the ranking pool never narrows.
  const classYearRow = await prisma.player.findFirst({
    where: { leagueId: league.id, isDraftee: true },
    orderBy: { draftYear: 'desc' },
    select: { draftYear: true },
  });
  const classYear = classYearRow?.draftYear ?? league.seasonYear;
  const draftedIds = madePicks.map((p) => p.playerId!).filter(Boolean);
  const classPlayers = await prisma.player.findMany({
    where: {
      leagueId: league.id,
      OR: [{ draftYear: classYear, isDraftee: true }, { id: { in: draftedIds } }],
    },
    select: {
      id: true, firstName: true, lastName: true, position: true, age: true, college: true,
      heightIn: true, weightLb: true, trueOvr: true, potential: true, trueAttrs: true,
      collegeStats: true, combineTesting: true, injuryWeeks: true, isDraftee: true, teamId: true,
    },
  });
  const classById = new Map(classPlayers.map((p) => [p.id, p]));

  const consensus = consensusBoardMap(classPlayers, { teams: LEAGUE.TEAM_COUNT, rounds: settings.draftRounds });
  const cuts = bandCutoffs({ teams: LEAGUE.TEAM_COUNT, rounds: settings.draftRounds });

  const [scoutMods, reports, shortlistEntries] = await Promise.all([
    loadScoutMods(league.id),
    prisma.scoutingReport.findMany({ where: { teamId: team.id, playerId: { in: classPlayers.map((p) => p.id) } } }),
    prisma.shortlistEntry.findMany({ where: { teamId: team.id }, select: { playerId: true } }),
  ]);
  const reportMap = new Map(reports.map((r) => [r.playerId, r]));
  const shortlistIds = new Set(shortlistEntries.map((s) => s.playerId));

  // `isProspect: true`, hardcoded, for every man in this class — see the fog
  // paragraph at the top of the file. This is the only correct reading on a
  // draft-day page: the file we have is the file we had, and selection does
  // not retroactively hand us knowledge we never bought.
  const viewOf = new Map<string, ScoutedPlayerView>();
  for (const p of classPlayers) {
    viewOf.set(p.id, buildScoutedView({
      isProspect: true,
      position: p.position as never,
      trueAttrs: readJson(p.trueAttrs, {}),
      trueOvr: p.trueOvr,
      potential: p.potential,
      report: reportMap.get(p.id),
      settings,
      isOwnRoster: false,
      isUserView: true,
      dynasty: scoutMods,
    }));
  }

  // OUR BOARD. The same blend of present and ceiling the room grades on, run
  // over our own scouted read instead of the public signals — which is the
  // only way the two numbers are comparable at all (see ownGradeFor).
  //
  // Only men the department has an actual file on are on it. A rank derived
  // from a baseline report nobody has looked at is not an opinion, and putting
  // one on the board would bury the men we really do have a read on. The
  // threshold is disagreementNote's own floor, so one screen cannot claim a
  // disagreement the other refuses to explain.
  const FILE_MIN = 25;
  const ourGradeOf = new Map<string, number>();
  for (const p of classPlayers) {
    const view = viewOf.get(p.id)!;
    if (view.confidence >= FILE_MIN) ourGradeOf.set(p.id, ownGradeFor(view));
  }
  const ourRank = new Map<string, number>();
  [...ourGradeOf.entries()]
    .sort((a, b) => b[1] - a[1] || (consensus.get(a[0])?.rank ?? 9e9) - (consensus.get(b[0])?.rank ?? 9e9))
    .forEach(([id], i) => ourRank.set(id, i + 1));

  // -------------------------------------------------------------------------
  // WHAT THIS CLUB CAME HERE TO FIX
  // -------------------------------------------------------------------------
  const roster = await prisma.player.findMany({
    where: { teamId: team.id },
    select: { id: true, position: true, trueOvr: true, age: true, potential: true },
  });
  const needScores = teamNeeds(roster);
  const needList = Object.entries(needScores)
    .filter(([, v]) => v >= 0.15)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([position, value]) => ({ position, value, ...needSeverity(value) }));
  // "A hole", for the purposes of a chip on a feed row, is a real one — the
  // top of the list, not the fifth-most-mild thing on a good roster.
  const holes = new Set(needList.filter((n) => n.value >= 0.35).map((n) => n.position));

  // -------------------------------------------------------------------------
  // THE FEED
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // THE PICK ON SCREEN
  // -------------------------------------------------------------------------
  const lastPick = madePicks[madePicks.length - 1];
  let selection: SelectionCardData | undefined;
  if (lastPick?.player) {
    const p = lastPick.player;
    const club = teamById.get(lastPick.ownerTeamId);
    const read = consensus.get(p.id);
    const view = viewOf.get(p.id);
    const gone = positionGone.get(p.position) ?? 0;
    const potentialForLabel = view ? (view.potentialRevealed ? classById.get(p.id)!.potential : (view.potLow + view.potHigh) / 2) : 0;
    const label = view
      ? playerLabel({ ovr: view.scoutedOvr, potential: potentialForLabel, isDraftee: true, experience: 0, confidence: view.confidence })
      : undefined;
    const notes: string[] = [];
    if (gone >= 3) notes.push(`${gone} ${p.position}s gone now.`);
    if (holes.has(p.position)) notes.push(`${p.position} is a hole on this roster.`);
    if (notes.length === 0 && read) notes.push(read.headline);
    selection = {
      pickId: lastPick.id,
      leagueId: league.id,
      year: draftYear,
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

  // -------------------------------------------------------------------------
  // RUN WATCH AND THE STATE OF THE BOARD
  // -------------------------------------------------------------------------
  const available = classPlayers.filter((p) => p.isDraftee && p.teamId === null);
  const availableIds = new Set(available.map((p) => p.id));
  const window = madePicks.slice(-RUN_WINDOW);
  const windowPositions = window.map((p) => p.player!.position);
  const runEntries: RunEntry[] = [...new Set(windowPositions)]
    .map((position) => ({
      position,
      inWindow: windowPositions.filter((x) => x === position).length,
      hits: windowPositions.map((x) => x === position),
      totalGone: positionGone.get(position) ?? 0,
      leftOnBoard: available.filter((p) => p.position === position && (consensus.get(p.id)?.rank ?? 9e9) <= cuts.DAY_TWO).length,
      atOurNeed: holes.has(position),
    }))
    .sort((a, b) => b.inWindow - a.inWindow || a.position.localeCompare(b.position))
    .slice(0, 4);

  // Measured against the board's own day-two line while the draft is running:
  // "forty tackles are still in the class" answers nothing, and "two tackles
  // left with a day-two grade and four rounds to go" is what makes a GM move.
  // Once every pick is in, that tier is by definition empty and the panel would
  // be sixteen zeroes — so the scope widens to the whole class, which is
  // exactly the list priority free agency is about to be worked from.
  const stockCut = complete ? Infinity : cuts.DAY_TWO;
  const stockByPosition = new Map<string, PositionStock>();
  for (const p of classPlayers) {
    const rank = consensus.get(p.id)?.rank;
    if (rank === undefined || rank > stockCut) continue;
    let row = stockByPosition.get(p.position);
    if (!row) {
      row = { position: p.position, gone: 0, left: 0, atOurNeed: holes.has(p.position) };
      stockByPosition.set(p.position, row);
    }
    if (availableIds.has(p.id)) row.left += 1;
    else row.gone += 1;
  }
  const stock = [...stockByPosition.values()].sort((a, b) => positionSortKey(a.position) - positionSortKey(b.position));

  // -------------------------------------------------------------------------
  // BEST AVAILABLE — ours and theirs
  // -------------------------------------------------------------------------
  const toAvailableRow = (p: (typeof classPlayers)[number]): AvailableRow => {
    const view = viewOf.get(p.id)!;
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
  const roomBest = [...available]
    .sort((a, b) => (consensus.get(a.id)?.rank ?? 9e9) - (consensus.get(b.id)?.rank ?? 9e9))
    .slice(0, 8)
    .map(toAvailableRow);
  const ourBest = available
    .filter((p) => ourRank.has(p.id))
    .sort((a, b) => ourRank.get(a.id)! - ourRank.get(b.id)!)
    .slice(0, 8)
    .map(toAvailableRow);

  // The sharpest live disagreement: a man we have inside our own top forty who
  // the room has a long way further down. That gap is the entire return on a
  // season of scouting, so it gets stated in words rather than left to be
  // spotted by comparing two columns.
  const edge = available
    .filter((p) => (ourRank.get(p.id) ?? 9e9) <= 40 && consensus.get(p.id))
    .map((p) => ({ p, gap: consensus.get(p.id)!.rank - ourRank.get(p.id)! }))
    .sort((a, b) => b.gap - a.gap)[0];
  const verdict = edge && edge.gap >= 12
    ? `${edge.p.firstName} ${edge.p.lastName} is our #${ourRank.get(edge.p.id)} and the room's #${consensus.get(edge.p.id)!.rank}. `
      + (disagreementNote(consensus.get(edge.p.id)!, viewOf.get(edge.p.id)!) ?? 'Nobody else in the league is looking at him this way.')
    : ourBest.length === 0
      ? 'Both columns would be the same board if we had one of our own.'
      : undefined;

  // -------------------------------------------------------------------------
  // THE BOARD
  // -------------------------------------------------------------------------
  const shortlistOnly = searchParams.shortlist === '1';
  const activePos = searchParams.pos;
  const SORTS: BoardSortKey[] = ['consensus', 'ours', 'pos', 'ovr', 'age', 'potential'];
  const defaultSort: BoardSortKey = ourRank.size >= 20 ? 'ours' : 'consensus';
  const sortKey: BoardSortKey = SORTS.includes(searchParams.sort as BoardSortKey)
    ? (searchParams.sort as BoardSortKey)
    : defaultSort;
  const dir = searchParams.dir === 'asc' ? 1 : -1;

  const filtered = available.filter((p) => {
    if (activePos && p.position !== activePos) return false;
    if (shortlistOnly && !shortlistIds.has(p.id)) return false;
    return true;
  });
  const sorted = [...filtered].sort((a, b) => {
    const va = viewOf.get(a.id)!;
    const vb = viewOf.get(b.id)!;
    switch (sortKey) {
      // Rank 1 is the BEST, so "best first" is ascending rank — the opposite
      // direction from every other column, where higher is better.
      case 'consensus':
        return ((consensus.get(a.id)?.rank ?? Infinity) - (consensus.get(b.id)?.rank ?? Infinity)) * -dir;
      case 'ours':
        return ((ourRank.get(a.id) ?? Infinity) - (ourRank.get(b.id) ?? Infinity)) * -dir;
      case 'ovr':
        return (va.scoutedOvr - vb.scoutedOvr) * dir;
      case 'age':
        return (a.age - b.age) * dir;
      case 'potential': {
        const pa = va.potentialRevealed ? a.potential : (va.potLow + va.potHigh) / 2;
        const pb = vb.potentialRevealed ? b.potential : (vb.potLow + vb.potHigh) / 2;
        return (pa - pb) * dir;
      }
      default:
        return (positionSortKey(a.position) - positionSortKey(b.position)) * dir
          || (consensus.get(a.id)?.rank ?? 9e9) - (consensus.get(b.id)?.rank ?? 9e9);
    }
  });

  const rankBadge = (playerId: string) => {
    const read = consensus.get(playerId);
    if (!read) return undefined;
    if (read.rank === 1) return { label: '#1 Board', className: 'text-gold' };
    if (read.band === 'BLUE_CHIP') return { label: 'Blue chip', className: 'text-gold' };
    if (read.band === 'FIRST_ROUND') return { label: 'R1 grade', className: 'text-accent' };
    if (read.band === 'DAY_TWO') return { label: 'Day 2', className: 'text-accent2' };
    return undefined;
  };

  const boardRows: BoardRow[] = sorted.slice(0, BOARD_ROWS).map((p) => {
    const view = viewOf.get(p.id)!;
    const read = consensus.get(p.id);
    const potentialForLabel = view.potentialRevealed ? p.potential : (view.potLow + view.potHigh) / 2;
    const label = playerLabel({ ovr: view.scoutedOvr, potential: potentialForLabel, isDraftee: true, experience: 0, confidence: view.confidence });
    return {
      playerId: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      position: p.position,
      college: p.college,
      age: p.age,
      heightIn: p.heightIn,
      weightLb: p.weightLb,
      boardRank: read?.rank,
      boardGrade: read?.grade,
      bandLabel: read?.bandLabel,
      boardNote: read ? (disagreementNote(read, view) ?? read.headline) : undefined,
      rankBadge: rankBadge(p.id),
      ourRank: ourRank.get(p.id),
      ourGrade: ourGradeOf.get(p.id),
      ovrLow: view.ovrLow,
      ovrHigh: view.ovrHigh,
      revealed: view.revealed,
      scoutedOvr: view.scoutedOvr,
      potLow: view.potLow,
      potHigh: view.potHigh,
      potentialRevealed: view.potentialRevealed,
      potential: p.potential,
      confidence: view.confidence,
      label: label.label,
      labelClass: label.className,
      shortlisted: shortlistIds.has(p.id),
    };
  });

  const positions = [...new Set(available.map((p) => p.position))].sort((a, b) => positionSortKey(a) - positionSortKey(b));
  const base = `/league/${league.id}/draft/broadcast`;
  const dirWord = dir === -1 ? 'desc' : 'asc';
  const query = (over: Partial<Record<'pos' | 'sort' | 'dir' | 'shortlist', string | undefined>>) => {
    const merged: Record<string, string | undefined> = {
      pos: activePos, sort: sortKey, dir: dirWord, shortlist: shortlistOnly ? '1' : undefined, ...over,
    };
    const qs = Object.entries(merged).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${v}`).join('&');
    return qs ? `${base}?${qs}` : base;
  };

  // -------------------------------------------------------------------------
  // THE ROOM'S OWN SIDE OF THE BOARD
  // -------------------------------------------------------------------------
  const myPicks = allPicks.filter((p) => p.ownerTeamId === team.id);
  const warRoomPicks: WarRoomPick[] = myPicks.map((p) => ({
    round: p.round,
    overall: overallOf(p.round, p.slot),
    picksAway: p.used ? undefined : Math.max(0, overallOf(p.round, p.slot) - 1 - pickIndex),
    spentOn: p.used && p.player ? `${p.player.firstName} ${p.player.lastName}` : undefined,
  }));
  const nextMine = myPicks.find((p) => !p.used);
  const yourNext = nextMine && !complete
    ? {
        round: nextMine.round,
        overall: overallOf(nextMine.round, nextMine.slot),
        picksAway: Math.max(0, overallOf(nextMine.round, nextMine.slot) - 1 - pickIndex),
      }
    : undefined;

  const upcoming: UpcomingSlot[] = complete ? [] : allPicks.slice(pickIndex, pickIndex + UPCOMING_SLOTS).map((p) => {
    const club = teamById.get(p.ownerTeamId);
    return {
      overall: overallOf(p.round, p.slot),
      round: p.round,
      teamId: club?.id ?? p.ownerTeamId,
      abbr: club?.abbr ?? '???',
      isUser: p.ownerTeamId === team.id,
      isOnClock: overallOf(p.round, p.slot) === pickIndex + 1,
    };
  });

  const eyebrow = complete
    ? `Rookie Draft · ${draftYear}`
    : `Round ${onClockPick?.round ?? 1} · Pick ${pickIndex + 1} of ${allPicks.length}`;
  const headline = complete
    ? `${draftYear} Draft Complete`
    : !started
      ? `${draftYear} Draft · Board Set`
      : isUserOnClock
        ? 'You Are On The Clock'
        : `${onClockTeam?.city ?? 'The Club'} On The Clock`;

  return (
    <DraftMomentProvider>
      <div className="space-y-6">
        <BroadcastHero
          eyebrow={eyebrow}
          headline={headline}
          team={onClockTeam ? { id: onClockTeam.id, abbr: onClockTeam.abbr, city: onClockTeam.city, nickname: onClockTeam.nickname } : undefined}
          complete={complete}
          yourNext={yourNext}
          upcoming={upcoming}
          yourClass={complete
            ? myPicks.filter((p) => p.player).map((p) => ({
                overall: overallOf(p.round, p.slot),
                round: p.round,
                name: `${p.player!.firstName} ${p.player!.lastName}`,
                position: p.player!.position,
              }))
            : undefined}
          clock={
            <DraftClock
              leagueId={league.id}
              userTeamId={team.id}
              isUserOnClock={isUserOnClock}
              complete={complete}
              started={started}
            />
          }
        />

        {/* The feed is the spine of the broadcast and gets a full column of its
            own: it stretches to whatever height the analysis beside it takes,
            so neither side of this row ever ends in a stranded empty panel. */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          <div className="xl:col-span-8 space-y-5">
            {selection ? (
              <TheSelection data={selection} />
            ) : (
              <div className="panel p-6">
                <h2 className="section-title">Nobody Is Off The Board Yet</h2>
                <p className="text-sm text-muted mt-2 max-w-xl">
                  The first name in the {draftYear} draft goes in as soon as the clock starts. Until then the
                  board below is the whole class, exactly as your department left it.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
              <RunWatch entries={runEntries} windowSize={window.length || RUN_WINDOW} order={windowPositions} complete={complete} />
              <WarRoomPanel
                picks={warRoomPicks}
                needs={needList}
                filed={ourRank.size}
                classSize={classPlayers.length}
                shortlistLeft={[...shortlistIds].filter((id) => availableIds.has(id)).length}
              />
            </div>

            <BoardDepletion stock={stock} tierLabel={complete ? 'the whole class' : 'day-two grade or better'} />
          </div>

          {/* Pinned below the sticky page header: the feed is the thing you
              keep half an eye on while reading anything else on the screen. */}
          <div className="xl:col-span-4">
            <div className="xl:sticky xl:top-[11rem]">
              <SelectionFeed rows={feed} made={madePicks.length} total={allPicks.length} leagueId={league.id} />
            </div>
          </div>
        </div>

        <BestAvailable leagueId={league.id} ours={ourBest} room={roomBest} verdict={verdict} />

        <ProspectBoard
          leagueId={league.id}
          teamId={team.id}
          rows={boardRows}
          positions={positions}
          activePos={activePos}
          shortlistOnly={shortlistOnly}
          shortlistCount={shortlistIds.size}
          sortKey={sortKey}
          dir={dir}
          sortHref={(key) => query({ sort: key, dir: sortKey === key && dir === -1 ? 'asc' : 'desc' })}
          posHref={(pos) => query({ pos })}
          shortlistHref={() => query({ shortlist: shortlistOnly ? undefined : '1' })}
          availableCount={filtered.length}
          scoutingEnabled={settings.scoutingEnabled}
          onClock={isUserOnClock && onClockPick && onClockTeam
            ? {
                year: draftYear,
                round: onClockPick.round,
                overall: pickIndex + 1,
                team: { id: onClockTeam.id, abbr: onClockTeam.abbr, city: onClockTeam.city, nickname: onClockTeam.nickname },
              }
            : undefined}
        />
      </div>
    </DraftMomentProvider>
  );
}
