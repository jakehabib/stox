import { prisma } from './db';
import { readJson } from './json';
import { BoxScore, BoxLine, SeasonStats } from './types';
import { computeGameShape, GameShape, wentToOvertime } from './gameShape';
import {
  StandingsRow, conferenceSeedOrder, gamesBackOfCutLine, ordinal, rankAmong, recordString,
} from './standingsOrder';
import { computeClinchStatus, clinchScenarioTag, StandingsTeam } from './clinchScenario';
import { generateTeamLogoParams } from './gen/teamLogo';
import { buildLeagueRatings, estimateGameWinChance, TeamRating } from './teamRating';
import { rankWire } from './wireRank';
import { statScore } from './news';
import { generateStorylines } from './storyline';

/**
 * ===========================================================================
 * THE WEEK REPORT
 * ===========================================================================
 * Everything the user needs to know about the week that just happened,
 * assembled from rows the simulation already wrote. No new schema, no new
 * math, no RNG of its own: every figure here is either read straight off a
 * Game/Team/Transaction row or computed by the exact function the rest of the
 * game uses for that number (`standingsCompare` seeds the real bracket,
 * `computeClinchStatus` is the real clinch math, `estimateGameWinChance` is
 * the same estimate the dashboard shows).
 *
 * lib/storyline.ts's header names `advanceWeek`'s REGULAR/PLAYOFFS branches
 * as an intended integration point for exactly this. This is that wiring.
 *
 * INTERRUPTION BUDGET. This is a Tier-1 payload: it fires once per Advance,
 * because pressing Advance *is* a request to be told what happened. It is
 * never mandatory — the panel that renders it closes on Escape, on a click
 * outside, and on any navigation — and a multi-week advance shows ONE report
 * covering the whole span (see components/AdvanceWeekButton.tsx), never one
 * per week. The Tier-0 payload below it (`TrophyMoment`) is the only
 * full-screen interruption in the game and can fire at most once per season.
 * ===========================================================================
 */

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export interface ReportSide {
  teamId: string;
  abbr: string;
  city: string;
  nickname: string;
  score: number;
  /** Record AFTER this game, as it now stands. */
  record: string;
  /** The team's own curated primary, for the crest tint and the score colour. */
  color: string;
  won: boolean;
}

export interface ReportResult {
  gameId: string;
  home: ReportSide;
  away: ReportSide;
  userIsHome: boolean;
  outcome: 'W' | 'L' | 'T';
  /** Signed from the user's point of view. */
  margin: number;
  overtime: boolean;
  recap: string;
  shape: GameShape | null;
  quarters: { home: number[]; away: number[] } | null;
  /**
   * The win chance shown BEFORE this game was played, computed from the
   * standings and rosters as they stood then — not recomputed afterwards
   * against a record that already includes the result.
   */
  winChancePre: number | null;
  /** True only when the user won a game the same estimate had them losing badly. */
  upset: boolean;
}

export interface ReportChange {
  recordBefore: string;
  recordAfter: string;
  divisionLabel: string;
  divRankBefore: number;
  divRankAfter: number;
  /** Position in the conference seeding order (1..16), the real one. */
  seedBefore: number;
  seedAfter: number;
  /** Games back of the last playoff spot, or null when already inside it. */
  gamesBack: number | null;
  streakBefore: string | null;
  streakAfter: string | null;
  pointDiffBefore: number;
  pointDiff: number;
  clinch: { label: string; tone: 'good' | 'bad' } | null;
  /** The clinch line only shouts on the week it actually flips. */
  clinchFlipped: boolean;
}

export interface ReportGameBall {
  playerId: string;
  name: string;
  position: string;
  line: string;
  teamAbbr: string;
  /** Portrait inputs — the avatar is identity, so it travels with the payload. */
  age: number;
  heightIn: number;
  weightLb: number;
  teamColor: string;
}

export interface ReportInjury {
  name: string;
  position: string;
  weeks: number;
  type: string;
}

export interface ReportHeadline {
  headline: string;
  detail: string;
  type: string;
  /** True when it is the user's own club. */
  mine: boolean;
}

export interface ReportNext {
  gameId: string;
  oppId: string;
  oppAbbr: string;
  oppCity: string;
  oppNickname: string;
  oppRecord: string;
  atHome: boolean;
  winChance: number | null;
  stakes: string | null;
}

export interface WeekReport {
  seasonYear: number;
  /** "Week 8", "Wild Card", "The Final". */
  weekLabel: string;
  /** "Regular Season" / "Playoffs". */
  phaseLabel: string;
  gamesPlayed: number;
  teamId: string | null;
  teamAbbr: string | null;
  teamColor: string | null;
  result: ReportResult | null;
  changed: ReportChange | null;
  gameBall: ReportGameBall | null;
  injuries: ReportInjury[];
  /** Everyone else's training room, collapsed the way the wire already does. */
  otherInjuryCount: number;
  headlines: ReportHeadline[];
  next: ReportNext | null;
  /** Used when there is no next game — "Season over", "Playoffs are set". */
  nextNote: string | null;
  /** The plain sentence this replaces; still the accessible fallback. */
  summary: string;
}

export interface TrophyLeg {
  round: string;
  myScore: number;
  theirScore: number;
  oppAbbr: string;
  atHome: boolean;
  won: boolean;
}

export interface TrophyMoment {
  kind: 'CHAMPION' | 'SEASON_OVER';
  seasonYear: number;
  teamId: string;
  city: string;
  nickname: string;
  abbr: string;
  color: string;
  /** The round the season ended in — "The Final", "Divisional Round". */
  roundLabel: string;
  finalScore: { mine: number; theirs: number; oppAbbr: string; oppCity: string; oppNickname: string } | null;
  road: TrophyLeg[];
  record: string;
  seed: number | null;
  pointDiff: number;
  mvp: { name: string; position: string; statLine: string } | null;
  /** Only for SEASON_OVER, and only when the draft order actually exists yet. */
  nextPick: string | null;
}

// ---------------------------------------------------------------------------
// Pre-advance snapshot
// ---------------------------------------------------------------------------

/**
 * What the world looked like BEFORE the week was simulated.
 *
 * Taken as an actual snapshot rather than reconstructed afterwards by
 * subtracting the result back out. Reconstruction is what
 * lib/standingsTrend.ts has to do (it runs on a page load, long after the
 * fact) and it can only recover win/loss — point differential, the standings
 * tiebreaker, is unrecoverable. Here we are standing right next to the
 * moment, so we just look.
 */
export interface PreAdvanceSnapshot {
  userTeamId: string | null;
  teams: (StandingsRow & { division: string; conference: string })[];
  streak: string | null;
  /** The user's game this week, and the estimate as it stood before kickoff. */
  gameId: string | null;
  winChance: number | null;
}

type TeamStandingRow = StandingsRow & { division: string; conference: string };

async function loadStandingRows(leagueId: string): Promise<TeamStandingRow[]> {
  const teams = await prisma.team.findMany({
    where: { leagueId },
    select: { id: true, wins: true, losses: true, ties: true, pointsFor: true, pointsAgnst: true, division: true, conference: true },
  });
  return teams;
}

/** "W4" / "L2" / null when nothing has been played yet. */
async function trailingStreakLabel(leagueId: string, teamId: string, seasonYear: number, excludeGameId?: string | null): Promise<string | null> {
  const games = await prisma.game.findMany({
    where: {
      leagueId, seasonYear, played: true, kind: 'REGULAR',
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
    },
    orderBy: { week: 'asc' },
    select: { id: true, homeTeamId: true, homeScore: true, awayScore: true },
  });
  const usable = games.filter((g) => g.id !== excludeGameId);
  let label: 'W' | 'L' | null = null;
  let count = 0;
  for (let i = usable.length - 1; i >= 0; i--) {
    const g = usable[i];
    const isHome = g.homeTeamId === teamId;
    const mine = isHome ? g.homeScore : g.awayScore;
    const theirs = isHome ? g.awayScore : g.homeScore;
    if (mine === theirs) break;
    const r: 'W' | 'L' = mine > theirs ? 'W' : 'L';
    if (label === null) { label = r; count = 1; continue; }
    if (r !== label) break;
    count++;
  }
  return label ? `${label}${count}` : null;
}

export async function snapshotBeforeAdvance(leagueId: string, week: number, kind: 'REGULAR' | 'PLAYOFF'): Promise<PreAdvanceSnapshot> {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const userTeam = await prisma.team.findFirst({ where: { leagueId, isUser: true } });
  const teams = await loadStandingRows(leagueId);
  if (!userTeam) return { userTeamId: null, teams, streak: null, gameId: null, winChance: null };

  const game = await prisma.game.findFirst({
    where: {
      leagueId, seasonYear: league.seasonYear, played: false,
      ...(kind === 'REGULAR' ? { week, kind: 'REGULAR' } : { kind: { not: 'REGULAR' } }),
      OR: [{ homeTeamId: userTeam.id }, { awayTeamId: userTeam.id }],
    },
    select: { id: true, homeTeamId: true, awayTeamId: true },
  });

  const streak = await trailingStreakLabel(leagueId, userTeam.id, league.seasonYear);

  let winChance: number | null = null;
  if (game) {
    const oppId = game.homeTeamId === userTeam.id ? game.awayTeamId : game.homeTeamId;
    winChance = await estimateFor(leagueId, userTeam.id, oppId, game.homeTeamId === userTeam.id, teams);
  }

  return { userTeamId: userTeam.id, teams, streak, gameId: game?.id ?? null, winChance };
}

/**
 * The same win estimate the dashboard hero shows — `estimateGameWinChance`,
 * not the older `lib/winProbability.ts` heuristic, which has no caller
 * anywhere in the app. Showing a different number here than the one the user
 * read on the dashboard yesterday would be the ledger-vs-tile bug again.
 */
async function estimateFor(
  leagueId: string, myId: string, oppId: string, atHome: boolean,
  standings: TeamStandingRow[],
  ratingsIn?: Map<string, TeamRating>,
): Promise<number | null> {
  const ratings = ratingsIn ?? await buildLeagueRatings(leagueId);
  const me = ratings.get(myId);
  const opp = ratings.get(oppId);
  if (!me || !opp) return null;
  const myRow = standings.find((t) => t.id === myId);
  const oppRow = standings.find((t) => t.id === oppId);
  if (!myRow || !oppRow) return null;
  return estimateGameWinChance({
    me, opp, atHome,
    myRecord: { wins: myRow.wins, losses: myRow.losses, ties: myRow.ties },
    oppRecord: { wins: oppRow.wins, losses: oppRow.losses, ties: oppRow.ties },
  }).percent;
}

/** [TUNE] Below this pre-game estimate, a win is an upset worth marking. */
const UPSET_THRESHOLD = 35;

// ---------------------------------------------------------------------------
// Line formatting
// ---------------------------------------------------------------------------

/** "24/33 · 288 yd · 3 TD · 0 INT". Position-shaped, same figures as the box. */
export function describeLine(s: SeasonStats): string {
  const parts: string[] = [];
  if ((s.passAtt ?? 0) > 0) {
    parts.push(`${s.passCmp ?? 0}/${s.passAtt} · ${s.passYds ?? 0} yd · ${s.passTd ?? 0} TD · ${s.int ?? 0} INT`);
  }
  if ((s.rushAtt ?? 0) > 0) parts.push(`${s.rushAtt} car · ${s.rushYds ?? 0} yd${(s.rushTd ?? 0) > 0 ? ` · ${s.rushTd} TD` : ''}`);
  if ((s.rec ?? 0) > 0) parts.push(`${s.rec} rec · ${s.recYds ?? 0} yd${(s.recTd ?? 0) > 0 ? ` · ${s.recTd} TD` : ''}`);
  if ((s.tackles ?? 0) > 0) parts.push(`${s.tackles} tkl`);
  if ((s.sacks ?? 0) > 0) parts.push(`${s.sacks} sk`);
  if ((s.defInt ?? 0) > 0) parts.push(`${s.defInt} INT`);
  if ((s.pd ?? 0) > 0) parts.push(`${s.pd} PD`);
  if ((s.fgm ?? 0) > 0) parts.push(`${s.fgm}/${s.fga ?? 0} FG`);
  return parts.join(' · ') || 'took the field';
}

const ROUND_LABEL: Record<string, string> = {
  REGULAR: 'Regular Season',
  WILDCARD: 'Wild Card Round',
  DIVISIONAL: 'Divisional Round',
  CONFERENCE: 'Conference Championship',
  FINAL: 'The Final',
};

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface BuildWeekReportOptions {
  before: PreAdvanceSnapshot;
  /** Regular-season week number that was just played, or the playoff round kind. */
  weekLabel: string;
  phaseLabel: string;
  gamesPlayed: number;
  summary: string;
  /** REGULAR weeks move the standings; playoff rounds deliberately do not. */
  trackStandings: boolean;
  /**
   * The week the games that were just played are stamped with. The wire is
   * filtered to it: without that, "42 other injury reports" was counting the
   * whole season and this week's report was quoting a cut from five weeks
   * ago as news.
   */
  wireWeek: number;
  /**
   * Playoff Game rows are numbered week 1-4, which COLLIDES with regular
   * season weeks 1-4 in the same season year (lib/rivalry.ts documents the
   * same trap). So a postseason round cannot filter its wire by week — it
   * takes the newest rows instead, which during the playoffs are exactly the
   * rows the round just wrote.
   */
  wireScope: 'WEEK' | 'LATEST';
}

export async function buildWeekReport(leagueId: string, opts: BuildWeekReportOptions): Promise<WeekReport | null> {
  const before = opts.before;
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const userTeamId = before.userTeamId;
  if (!userTeamId) return null;

  const userTeam = await prisma.team.findUnique({ where: { id: userTeamId } });
  if (!userTeam) return null;
  const teamColor = generateTeamLogoParams(userTeam.abbr).primary;

  const base: WeekReport = {
    seasonYear: league.seasonYear,
    weekLabel: opts.weekLabel,
    phaseLabel: opts.phaseLabel,
    gamesPlayed: opts.gamesPlayed,
    teamId: userTeam.id,
    teamAbbr: userTeam.abbr,
    teamColor,
    result: null,
    changed: null,
    gameBall: null,
    injuries: [],
    otherInjuryCount: 0,
    headlines: [],
    next: null,
    nextNote: null,
    summary: opts.summary,
  };

  const afterTeams = await loadStandingRows(leagueId);

  // --- Band 1: your result -------------------------------------------------
  const game = before.gameId
    ? await prisma.game.findUnique({ where: { id: before.gameId }, include: { homeTeam: true, awayTeam: true } })
    : null;

  let box: BoxScore | null = null;
  if (game && game.played) {
    box = readJson<BoxScore>(game.boxScore, null as any);
    const userIsHome = game.homeTeamId === userTeam.id;
    const mine = userIsHome ? game.homeScore : game.awayScore;
    const theirs = userIsHome ? game.awayScore : game.homeScore;
    const margin = mine - theirs;
    const homeAfter = afterTeams.find((t) => t.id === game.homeTeamId);
    const awayAfter = afterTeams.find((t) => t.id === game.awayTeamId);

    base.result = {
      gameId: game.id,
      userIsHome,
      outcome: margin > 0 ? 'W' : margin < 0 ? 'L' : 'T',
      margin,
      overtime: wentToOvertime(box),
      recap: game.recap,
      shape: computeGameShape(box, userIsHome ? 'home' : 'away'),
      quarters: box?.quarters ?? null,
      winChancePre: before.winChance,
      upset: margin > 0 && before.winChance !== null && before.winChance < UPSET_THRESHOLD,
      home: {
        teamId: game.homeTeam.id, abbr: game.homeTeam.abbr, city: game.homeTeam.city, nickname: game.homeTeam.nickname,
        score: game.homeScore, record: homeAfter ? recordString(homeAfter) : '', won: game.homeScore > game.awayScore,
        color: generateTeamLogoParams(game.homeTeam.abbr).primary,
      },
      away: {
        teamId: game.awayTeam.id, abbr: game.awayTeam.abbr, city: game.awayTeam.city, nickname: game.awayTeam.nickname,
        score: game.awayScore, record: awayAfter ? recordString(awayAfter) : '', won: game.awayScore > game.homeScore,
        color: generateTeamLogoParams(game.awayTeam.abbr).primary,
      },
    };
  }

  // --- Band 2: what it changed --------------------------------------------
  if (opts.trackStandings) {
    const beforeRow = before.teams.find((t) => t.id === userTeam.id);
    const afterRow = afterTeams.find((t) => t.id === userTeam.id);
    if (beforeRow && afterRow) {
      const divBefore = before.teams.filter((t) => t.division === beforeRow.division && t.conference === beforeRow.conference);
      const divAfter = afterTeams.filter((t) => t.division === afterRow.division && t.conference === afterRow.conference);
      const confBefore = before.teams.filter((t) => t.conference === beforeRow.conference);
      const confAfter = afterTeams.filter((t) => t.conference === afterRow.conference);

      // The real seeding order — division winners first, then the rest —
      // which is exactly what seedPlayoffs() builds the bracket from.
      const seedIndex = (rows: TeamStandingRow[]) => conferenceSeedOrder(rows).findIndex((t) => t.id === userTeam.id) + 1;

      const clinchBefore = clinchScenarioTag(computeClinchStatus(userTeam.id, confBefore as unknown as StandingsTeam[]));
      const clinchAfter = clinchScenarioTag(computeClinchStatus(userTeam.id, confAfter as unknown as StandingsTeam[]));

      base.changed = {
        recordBefore: recordString(beforeRow),
        recordAfter: recordString(afterRow),
        divisionLabel: `${userTeam.conference} ${userTeam.division}`,
        divRankBefore: rankAmong(userTeam.id, divBefore),
        divRankAfter: rankAmong(userTeam.id, divAfter),
        seedBefore: seedIndex(confBefore),
        seedAfter: seedIndex(confAfter),
        gamesBack: gamesBackOfCutLine(userTeam.id, confAfter),
        streakBefore: before.streak,
        streakAfter: await trailingStreakLabel(leagueId, userTeam.id, league.seasonYear),
        pointDiffBefore: beforeRow.pointsFor - beforeRow.pointsAgnst,
        pointDiff: afterRow.pointsFor - afterRow.pointsAgnst,
        clinch: clinchAfter,
        clinchFlipped: (clinchAfter?.label ?? null) !== (clinchBefore?.label ?? null),
      };
    }
  }

  // --- Band 3: the game ball ----------------------------------------------
  if (box) {
    const userIsHome = game!.homeTeamId === userTeam.id;
    const myLines: BoxLine[] = userIsHome ? (box.lines?.home ?? []) : (box.lines?.away ?? []);
    // Exactly one, every week, no exceptions — a predictable section rather
    // than a lottery. Ranked by the same statScore lib/news.ts uses to pick
    // which performances become headlines, so the two never disagree.
    const best = [...myLines].sort((a, b) => statScore(b) - statScore(a))[0];
    if (best && statScore(best) > 0) {
      const player = await prisma.player.findUnique({
        where: { id: best.playerId },
        select: { age: true, heightIn: true, weightLb: true, position: true },
      });
      base.gameBall = {
        playerId: best.playerId,
        name: best.name,
        position: String(best.position),
        line: describeLine(best.stats),
        teamAbbr: userTeam.abbr,
        age: player?.age ?? 26,
        heightIn: player?.heightIn ?? 73,
        weightLb: player?.weightLb ?? 220,
        teamColor,
      };
    }
  }

  // --- Band 4: the room ----------------------------------------------------
  if (box?.injuries?.length) {
    const mine = box.injuries.filter((i) => i.teamId === userTeam.id);
    const positions = await prisma.player.findMany({
      where: { id: { in: mine.map((i) => i.playerId) } },
      select: { id: true, position: true },
    });
    const posById = new Map(positions.map((p) => [p.id, p.position]));
    base.injuries = mine.map((i) => ({
      name: i.name, position: posById.get(i.playerId) ?? '', weeks: i.weeks, type: i.type,
    }));
  }

  const wireRows = await prisma.transaction.findMany({
    where: opts.wireScope === 'WEEK'
      ? { leagueId, seasonYear: league.seasonYear, week: opts.wireWeek }
      : { leagueId, seasonYear: league.seasonYear },
    orderBy: { createdAt: 'desc' },
    take: opts.wireScope === 'WEEK' ? 120 : 24,
    select: { id: true, type: true, headline: true, detail: true, teamId: true, seasonYear: true, week: true, createdAt: true },
  });
  const ranked = rankWire(wireRows, {
    userTeamId: userTeam.id,
    currentSeasonYear: league.seasonYear,
    currentWeek: opts.wireWeek,
    limit: 3,
  });
  base.otherInjuryCount = ranked.collapsedInjuries?.count ?? 0;
  base.headlines = ranked.items.slice(0, 2).map((t) => ({
    headline: t.headline, detail: t.detail, type: t.type, mine: t.teamId === userTeam.id,
  }));

  // --- Band 5: what's next -------------------------------------------------
  const nextGame = await prisma.game.findFirst({
    where: {
      leagueId, seasonYear: league.seasonYear, played: false,
      OR: [{ homeTeamId: userTeam.id }, { awayTeamId: userTeam.id }],
    },
    orderBy: [{ kind: 'asc' }, { week: 'asc' }],
    include: { homeTeam: true, awayTeam: true },
  });

  if (nextGame) {
    const atHome = nextGame.homeTeamId === userTeam.id;
    const opp = atHome ? nextGame.awayTeam : nextGame.homeTeam;
    const oppRow = afterTeams.find((t) => t.id === opp.id);
    const winChance = await estimateFor(leagueId, userTeam.id, opp.id, atHome, afterTeams);
    base.next = {
      gameId: nextGame.id,
      oppId: opp.id, oppAbbr: opp.abbr, oppCity: opp.city, oppNickname: opp.nickname,
      oppRecord: oppRow ? recordString(oppRow) : '',
      atHome, winChance,
      stakes: await stakesLine(leagueId, userTeam.id, opp.id, league.seasonYear),
    };
  } else if (!opts.trackStandings) {
    // No next game and this was a postseason round: either they were knocked
    // out (find the round it happened in — `Team.eliminated` only marks teams
    // that missed the bracket entirely, so it cannot answer this) or they
    // never made it.
    // Ordered by ROUND, not by week: createNextPlayoffRound stamps both the
    // divisional and the conference round as week 2, so `orderBy week desc`
    // picks between them arbitrarily and can report the wrong last game.
    const played = await prisma.game.findMany({
      where: {
        leagueId, seasonYear: league.seasonYear, played: true, kind: { not: 'REGULAR' },
        OR: [{ homeTeamId: userTeam.id }, { awayTeamId: userTeam.id }],
      },
      select: { kind: true, homeTeamId: true, homeScore: true, awayScore: true },
    });
    const ROUND_ORDER = ['WILDCARD', 'DIVISIONAL', 'CONFERENCE', 'FINAL'];
    const lost = [...played].sort((a, b) => ROUND_ORDER.indexOf(a.kind) - ROUND_ORDER.indexOf(b.kind)).pop();
    if (lost) {
      const atHome = lost.homeTeamId === userTeam.id;
      const mine = atHome ? lost.homeScore : lost.awayScore;
      const theirs = atHome ? lost.awayScore : lost.homeScore;
      base.nextNote = mine < theirs
        ? `Your season ended in the ${ROUND_LABEL[lost.kind] ?? lost.kind}.`
        : 'Waiting on the rest of the bracket.';
    } else {
      base.nextNote = 'You are not in this bracket. Next season starts in the offseason.';
    }
  } else if (opts.trackStandings) {
    base.nextNote = 'Regular season complete.';
  }

  return base;
}

/**
 * One true line about the game you are about to play.
 *
 * First choice is the head-to-head this season, which is a fact sitting in a
 * Game row and is unambiguously *about this matchup* — "they beat you by 16
 * in week 3" is the line a GM actually wants under a next-up strip.
 *
 * Fallback is the storyline engine's STREAK beat, which is about current
 * form and therefore still reads forward. The other categories are
 * deliberately not used here: RIVALRY frames the upcoming matchup from the
 * PRE-game head-to-head state (lib/storyline.ts's header says so) and this
 * runs after the week is simulated; STAKES is the clinch tag, which the
 * "what it changed" band already prints; MILESTONE and PLAYER_ARC are about
 * a player's season, not about Sunday, and reading one under "Next up" is a
 * non-sequitur.
 */
async function stakesLine(leagueId: string, teamId: string, oppId: string, seasonYear: number): Promise<string | null> {
  const met = await prisma.game.findFirst({
    where: {
      leagueId, seasonYear, played: true,
      OR: [
        { homeTeamId: teamId, awayTeamId: oppId },
        { homeTeamId: oppId, awayTeamId: teamId },
      ],
    },
    orderBy: { week: 'desc' },
    select: { week: true, homeTeamId: true, homeScore: true, awayScore: true },
  });
  if (met) {
    const atHome = met.homeTeamId === teamId;
    const mine = atHome ? met.homeScore : met.awayScore;
    const theirs = atHome ? met.awayScore : met.homeScore;
    if (mine === theirs) return `You tied them ${mine}-${theirs} in week ${met.week}.`;
    return mine > theirs
      ? `You beat them ${mine}-${theirs} in week ${met.week}.`
      : `They beat you ${theirs}-${mine} in week ${met.week}.`;
  }
  try {
    const lines = await generateStorylines(leagueId, teamId, { limit: 6 });
    const streak = lines.find((s) => s.category === 'STREAK');
    return streak ? streak.headline : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The Trophy Moment (Tier 0)
// ---------------------------------------------------------------------------

/**
 * The one full-screen moment in the game, and its mirror.
 *
 * Fires only for the user's own team (`Team.isUser`) and only on a
 * season-ending playoff outcome: winning the title, or losing the postseason
 * game that ends your year. Another club winning it all is a Tier-3 wire
 * story, which `wireRank` already weights at 100 — correctly.
 *
 * `roundKind` is the round that was just played. It is required, and it is
 * the guard that keeps this Tier-0: without it, a user knocked out in the
 * wild card round would get the SEASON OVER screen again after the
 * divisional round, again after the conference round and again after the
 * final — four full-screen interruptions for one elimination. The moment
 * fires only on the step where the season actually ended.
 */
export async function buildTrophyMoment(leagueId: string, seasonYear: number, roundKind: string): Promise<TrophyMoment | null> {
  const userTeam = await prisma.team.findFirst({ where: { leagueId, isUser: true } });
  if (!userTeam) return null;

  const playoffGames = await prisma.game.findMany({
    where: { leagueId, seasonYear, kind: { not: 'REGULAR' }, played: true },
    include: { homeTeam: true, awayTeam: true },
  });
  const KIND_ORDER = ['WILDCARD', 'DIVISIONAL', 'CONFERENCE', 'FINAL'];
  const mine = playoffGames
    .filter((g) => g.homeTeamId === userTeam.id || g.awayTeamId === userTeam.id)
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  if (mine.length === 0) return null;

  const road: TrophyLeg[] = mine.map((g) => {
    const atHome = g.homeTeamId === userTeam.id;
    const myScore = atHome ? g.homeScore : g.awayScore;
    const theirScore = atHome ? g.awayScore : g.homeScore;
    return {
      round: ROUND_LABEL[g.kind] ?? g.kind,
      myScore, theirScore, atHome,
      oppAbbr: atHome ? g.awayTeam.abbr : g.homeTeam.abbr,
      won: myScore > theirScore,
    };
  });

  const last = mine[mine.length - 1];
  const lastLeg = road[road.length - 1];
  // Their last postseason game has to be the one that was just played.
  if (last.kind !== roundKind) return null;
  const lostLast = !lastLeg.won;
  const wonTheFinal = last.kind === 'FINAL' && lastLeg.won;

  // Still alive: they won a round that is not the final. No moment — a
  // divisional-round win is a Tier-1 line, not a Tier-0 screen.
  if (!lostLast && !wonTheFinal) return null;

  const opp = last.homeTeamId === userTeam.id ? last.awayTeam : last.homeTeam;

  let mvp: TrophyMoment['mvp'] = null;
  if (wonTheFinal) {
    const award = await prisma.transaction.findFirst({
      where: { leagueId, seasonYear, type: 'AWARD_SBMVP' },
      orderBy: { createdAt: 'desc' },
    });
    if (award) {
      const m = award.headline.match(/^(.*)\s+\(([^)]+)\)$/);
      mvp = { name: m?.[1] ?? award.headline, position: m?.[2] ?? '', statLine: award.detail };
    }
  }

  // "You pick Nth" is only printed when the draft order genuinely exists —
  // reseedDraftOrder runs later in the offseason, so on the night the season
  // ends there is usually nothing true to say here yet.
  let nextPick: string | null = null;
  const pick = await prisma.draftPick.findFirst({
    where: { leagueId, year: seasonYear + 1, round: 1, ownerTeamId: userTeam.id },
    select: { slot: true },
  });
  if (pick && pick.slot > 0) nextPick = `You pick ${ordinal(pick.slot)} in the ${seasonYear + 1} draft.`;

  return {
    kind: wonTheFinal ? 'CHAMPION' : 'SEASON_OVER',
    seasonYear,
    teamId: userTeam.id,
    city: userTeam.city,
    nickname: userTeam.nickname,
    abbr: userTeam.abbr,
    color: generateTeamLogoParams(userTeam.abbr).primary,
    roundLabel: ROUND_LABEL[last.kind] ?? last.kind,
    finalScore: {
      mine: lastLeg.myScore, theirs: lastLeg.theirScore,
      oppAbbr: opp.abbr, oppCity: opp.city, oppNickname: opp.nickname,
    },
    road,
    record: recordString(userTeam),
    seed: userTeam.playoffSeed ?? null,
    pointDiff: userTeam.pointsFor - userTeam.pointsAgnst,
    mvp,
    nextPick,
  };
}
