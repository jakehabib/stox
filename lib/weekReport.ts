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
import { projectedDraftOrder, draftSlotAmong } from './draft';
import { statScore } from './news';
import { generateStorylines } from './storyline';
import { careerColumns, formatColumn, isDerived } from './statLabels';
import { buildSeasonLines, SeasonLine } from './playerSeasons';
import { DEFENSIVE_POSITIONS, offensiveScore, defensiveScore } from './awards';
import { resolveStartYear } from './leagueYear';

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
 * It is rendered by components/ds/TrophyMoment.tsx after a single advance and
 * by components/ds/SeasonEndCard.tsx when the same press also carried a
 * stretch of weeks — one payload, two screens, still never both at once.
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
  /**
   * Mathematically out of the playoff picture — not "unlikely", the same
   * adversarial projection lib/clinchScenario.ts uses to say "clinched".
   *
   * WHY THE BAND NEEDS THIS AS A FLAG AND NOT JUST A LABEL. Once this is
   * true, "Playoff position: 12th → 12th · 4.0 GB" is not a quiet week, it
   * is a row describing a race that has finished. It gets replaced by the
   * board below, which is the number still moving.
   */
  playoffsOut: boolean;
  /**
   * Where this club would pick if the season ended on these standings, before
   * and after the week — the real worst-first rule (draftSlotAmong), not a
   * reordering of the standings table.
   *
   * Always computed, only rendered once `playoffsOut`. A club still in the
   * race does not want to be told it is climbing the draft board; a club
   * that is out has nothing else that moved.
   */
  draftSlotBefore: number;
  draftSlotAfter: number;
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
  /**
   * He is in the last year of his deal.
   *
   * The one piece of front-office context that changes what a good afternoon
   * MEANS, and it costs one already-joined column. It matters most in the
   * weeks this report was thinnest: a season that is mathematically over still
   * has men auditioning in it, and "who is playing for a contract" is a real
   * answer to "what was that Sunday for".
   */
  contractYear: boolean;
}

/**
 * ===========================================================================
 * COACH'S COMMENTS — the raw material, not the prose
 * ===========================================================================
 * The report ships the NUMBERS for the expandable Coach's Comments section
 * and nothing else: no grades, no ranking, no sentences. Three reasons, and
 * they are all the same reason.
 *
 * 1. LATENCY. This section is collapsed by default, so the work that turns
 *    these rows into comments must not happen on the path to the report
 *    painting. Assembling it here is one already-needed database read and a
 *    handful of array copies; ranking and phrasing happen in
 *    components/ds/CoachComments.tsx, and only when a user opens it.
 * 2. THE SPAN. AdvanceWeekButton collects every week of a multi-week advance
 *    and shows ONE report. Seven weeks of finished prose cannot be merged
 *    into a summary of the stretch, but seven weeks of stat lines can — the
 *    same player's seven rows add up, and only then does "who carried the
 *    stretch" have an answer.
 * 3. Grading is position-relative — lib/performanceScore.ts, the same ranker
 *    All-Star selection uses — against a yardstick lib/coachRoom.ts bakes in
 *    as constants, so doing it on the client costs a database nothing.
 * ===========================================================================
 */

export interface CoachLine {
  playerId: string;
  name: string;
  position: string;
  /** This game's line, exactly as the box score stored it. */
  stats: SeasonStats;
  /** Portrait inputs — the avatar is identity, so it travels with the row. */
  age: number;
  heightIn: number;
  weightLb: number;
  /** Completed pro seasons. 0 is a rookie, and that is worth a sentence. */
  experience: number;
}

/**
 * Team-level truth for the week, and a deliberately short list of it.
 *
 * Everything here is either a real accumulator off the sim or summed from the
 * player lines. What is NOT here is what lib/sim/engine.ts's toTeamStats()
 * derives rather than counts: `thirdDownConv` is `plays/6` over `plays/4`, a
 * flat ~67% for every team in every game ever played; `penalties` is
 * `plays/12`; and the team `passYards`/`rushYards` are a fixed 60/40 split of
 * total yards while the player lines carry the real one. Shipping those would
 * let the comments say "we were unstoppable on third down" on a week when the
 * offence never converted anything, which is the exact failure this project
 * calls a lying metric. The split below is summed off the lines instead.
 */
export interface CoachTeamContext {
  points: number;
  oppPoints: number;
  totalYards: number;
  oppTotalYards: number;
  /** Summed from the player lines, not the box's 60/40 estimate. */
  rushYards: number;
  rushAtt: number;
  passYards: number;
  passAtt: number;
  turnovers: number;
  oppTurnovers: number;
  /** Sacks this defence recorded, and sacks this offence gave up. */
  sacksFor: number;
  sacksAgainst: number;
  /** Share of the game's plays, 0..1. */
  possession: number;
  drives: number;
  scoringDrives: number;
  /** Possessions that ended in a punt, a turnover or on downs. */
  emptyDrives: number;
}

export interface CoachPayload {
  weekLabel: string;
  /** null when the user's club was not on the slate that week. */
  gameId: string | null;
  outcome: 'W' | 'L' | 'T' | null;
  margin: number;
  oppAbbr: string | null;
  lines: CoachLine[];
  team: CoachTeamContext | null;
  shape: GameShape | null;
  injuries: ReportInjury[];
}

export interface ReportInjury {
  /**
   * Carried so the room can link a name to the man. It was already on the
   * Coach's Comments copy of this row and missing from the one the panel
   * renders, which is why the report could name your starting quarterback and
   * give you no way to go and look at him.
   */
  playerId: string;
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
  /** Raw material for the collapsed Coach's Comments section. */
  coach: CoachPayload | null;
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
  oppTeamId: string;
  atHome: boolean;
  won: boolean;
}

/**
 * One man's contribution, already formatted. The numbers are the ones
 * lib/statLabels.ts says define his position (`careerColumns`, lead columns
 * only) so the trophy screen cannot headline a stat the player page's own
 * table doesn't carry, or rank it differently.
 */
export interface TrophyPlayerLine {
  playerId: string;
  name: string;
  position: string;
  /** Portrait inputs. Null when the Player row can't be resolved — the face is then skipped, not guessed. */
  age: number | null;
  weightLb: number | null;
  heightIn: number | null;
  stats: { label: string; value: string }[];
  /** Postseason games this line covers. Absent on the MVP, whose line is one game. */
  games?: number;
}

/** The championship game itself — the linescore and the silhouette, both stored. */
export interface TrophyFinal {
  quarters: { home: number[]; away: number[] };
  home: { teamId: string; abbr: string; score: number };
  away: { teamId: string; abbr: string; score: number };
  overtime: boolean;
  /** Always from the user's point of view, win or lose. */
  shape: GameShape | null;
}

/**
 * What this result is worth to the franchise, counted rather than asserted.
 *
 * Two different clocks, never mixed: TeamSeasonRecord holds every season the
 * club has on the books INCLUDING the two decades of backstory league
 * creation seeds, while the GM was hired in `gmHiredIn` (lib/gmCareer.ts's
 * rule, and the reason it exists — a title won in 2011 is the franchise's,
 * not his). Both are printed, each under its own label.
 */
export interface TrophyHistory {
  /** CHAMPION rows for this club, this season's included — the snapshot is already written when this runs. */
  franchiseTitles: number;
  /** The most recent title BEFORE this season, or null if there wasn't one. */
  previousTitleYear: number | null;
  /** How many seasons the club has on the books at all, so "first ever" can say how long a wait it was. */
  seasonsOnRecord: number;
  /** Titles won since the GM was hired, this one included. */
  gmTitles: number;
  gmHiredIn: number;
  /** Seasons served, this one included. */
  gmSeasons: number;
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
  /** True only when the bracket actually gave them one — a top-two seed with no wild card game. */
  bye: boolean;
  /** Postseason games won on the way here. */
  roundsWon: number;
  record: string;
  seed: number | null;
  pointDiff: number;
  final: TrophyFinal | null;
  /** The AWARD_SBMVP transaction, resolved back to a man. Champions only. */
  mvp: TrophyPlayerLine | null;
  /** The stat line recordSeasonAwards stored for him, verbatim. */
  mvpAward: string | null;
  /** Who produced across the WHOLE run, not just the last game. */
  runLeaders: TrophyPlayerLine[];
  history: TrophyHistory;
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
    coach: null,
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

      const statusBefore = computeClinchStatus(userTeam.id, confBefore as unknown as StandingsTeam[]);
      const statusAfter = computeClinchStatus(userTeam.id, confAfter as unknown as StandingsTeam[]);
      const clinchBefore = clinchScenarioTag(statusBefore);
      const clinchAfter = clinchScenarioTag(statusAfter);

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
        // THE ROW A DEAD SEASON STILL MOVES.
        //
        // Measured on a losing week 7: most of this band reported no change,
        // and the one row that was guaranteed never to change again — playoff
        // position, for a club that is mathematically out — kept printing a
        // seed and a games-back figure as if the race were live. A season that
        // has stopped moving does not stop having a number in it; the number
        // is the draft board, and it moves every single week from here to the
        // end. Both slots come from the standings already in hand, over the
        // exact rule that seeds the real draft.
        playoffsOut: statusAfter.playoffEliminated,
        draftSlotBefore: draftSlotAmong(userTeam.id, before.teams),
        draftSlotAfter: draftSlotAmong(userTeam.id, afterTeams),
      };
    }
  }

  // --- Bands 3-4: the game ball, the room, and the coach's raw material ----
  //
  // ONE player lookup serves all three. It used to be two — a findUnique for
  // the game ball and a findMany for the injured — so adding Coach's Comments
  // on top of them without merging would have made it three round trips on
  // the path to the report painting, which is the one thing this section is
  // not allowed to cost. Merged, it is a single indexed `id IN (...)` over
  // roughly two dozen rows, and the report is measurably no slower than it
  // was before any of this existed.
  const userIsHome = game ? game.homeTeamId === userTeam.id : false;
  const myLines: BoxLine[] = box ? (userIsHome ? (box.lines?.home ?? []) : (box.lines?.away ?? [])) : [];
  const myInjuries = (box?.injuries ?? []).filter((i) => i.teamId === userTeam.id);

  const wantedIds = Array.from(new Set([
    ...myLines.map((l) => l.playerId),
    ...myInjuries.map((i) => i.playerId),
  ]));
  const roster = wantedIds.length
    ? await prisma.player.findMany({
        where: { id: { in: wantedIds } },
        select: {
          id: true, age: true, heightIn: true, weightLb: true, position: true, experience: true,
          // One extra column on a query that was already being made, not a
          // fourth round trip. See ReportGameBall.contractYear.
          contract: { select: { yearsRemaining: true } },
        },
      })
    : [];
  const byId = new Map(roster.map((p) => [p.id, p]));

  // --- Band 3: the game ball ----------------------------------------------
  if (box) {
    // Exactly one, every week, no exceptions — a predictable section rather
    // than a lottery. Ranked by the same statScore lib/news.ts uses to pick
    // which performances become headlines, so the two never disagree.
    //
    // Deliberately NOT re-pointed at lib/performanceScore.ts. The game ball
    // is the league's answer to "who had the loudest afternoon", the same
    // question the wire answers, and the two agreeing is the point of it.
    // Coach's Comments below asks a different question — "who beat what is
    // normal for his job" — and gets a different, position-diverse answer.
    const best = [...myLines].sort((a, b) => statScore(b) - statScore(a))[0];
    if (best && statScore(best) > 0) {
      const player = byId.get(best.playerId);
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
        // Absent contract row means an unsigned body on the roster, which is
        // not the same claim as "expiring" — so it stays false rather than
        // guessing.
        contractYear: (player?.contract?.yearsRemaining ?? 0) === 1,
      };
    }
  }

  // --- Band 4: the room ----------------------------------------------------
  base.injuries = myInjuries.map((i) => ({
    playerId: i.playerId, name: i.name, position: byId.get(i.playerId)?.position ?? '', weeks: i.weeks, type: i.type,
  }));

  // --- Coach's Comments: numbers only -------------------------------------
  if (box && game) {
    const opp = userIsHome ? box.teamStats.away : box.teamStats.home;
    const own = userIsHome ? box.teamStats.home : box.teamStats.away;
    const mineScore = userIsHome ? game.homeScore : game.awayScore;
    const theirScore = userIsHome ? game.awayScore : game.homeScore;
    const side = userIsHome ? 'home' : 'away';
    const myDrives = (box.drives ?? []).filter((d) => d.team === side);
    const plays = own.timeOfPossession > 0 ? own.timeOfPossession / 3600 : 0.5;

    base.coach = {
      weekLabel: opts.weekLabel,
      gameId: game.id,
      outcome: mineScore > theirScore ? 'W' : mineScore < theirScore ? 'L' : 'T',
      margin: mineScore - theirScore,
      oppAbbr: userIsHome ? game.awayTeam.abbr : game.homeTeam.abbr,
      lines: myLines.map((l) => {
        const p = byId.get(l.playerId);
        return {
          playerId: l.playerId,
          name: l.name,
          position: String(l.position),
          stats: l.stats,
          age: p?.age ?? 26,
          heightIn: p?.heightIn ?? 73,
          weightLb: p?.weightLb ?? 220,
          experience: p?.experience ?? 1,
        };
      }),
      team: {
        points: mineScore,
        oppPoints: theirScore,
        totalYards: own.totalYards,
        oppTotalYards: opp.totalYards,
        // Summed off the lines. See CoachTeamContext's header for why the
        // box score's own pass/rush split is not usable.
        rushYards: myLines.reduce((n, l) => n + (l.stats.rushYds ?? 0), 0),
        rushAtt: myLines.reduce((n, l) => n + (l.stats.rushAtt ?? 0), 0),
        passYards: myLines.reduce((n, l) => n + (l.stats.passYds ?? 0), 0),
        passAtt: myLines.reduce((n, l) => n + (l.stats.passAtt ?? 0), 0),
        turnovers: own.turnovers,
        oppTurnovers: opp.turnovers,
        sacksFor: own.sacks,
        sacksAgainst: opp.sacks,
        possession: plays,
        drives: myDrives.length,
        scoringDrives: myDrives.filter((d) => d.points > 0).length,
        emptyDrives: myDrives.filter((d) => d.result === 'PUNT' || d.result === 'TURNOVER' || d.result === 'DOWNS').length,
      },
      shape: base.result?.shape ?? null,
      injuries: myInjuries.map((i) => ({
        playerId: i.playerId,
        name: i.name,
        position: byId.get(i.playerId)?.position ?? '',
        weeks: i.weeks,
        type: i.type,
      })),
    };
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
      stakes: await stakesLine(
        leagueId, userTeam.id, opp.id, league.seasonYear, afterTeams,
        // Only the regular season has a "your season is over but theirs isn't"
        // state. A playoff round has no standings band, so there is no honest
        // elimination flag to read here and the old ordering stands.
        opts.trackStandings && (base.changed?.playoffsOut ?? false),
      ),
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
 *
 * ONE EXCEPTION, AND IT IS THE WHOLE POINT OF THE DEAD WEEKS. When YOUR season
 * is mathematically over and theirs is not, the head-to-head is trivia and the
 * live fact is that the men across the field still have something to lose. A
 * club playing out the string is the most dangerous fixture on anyone's
 * schedule, and that is the one thing worth knowing about a week 14 game a
 * spreadsheet says is meaningless. So it goes first, and only then.
 */
async function stakesLine(
  leagueId: string,
  teamId: string,
  oppId: string,
  seasonYear: number,
  rows: TeamStandingRow[],
  myPlayoffsOut: boolean,
): Promise<string | null> {
  if (myPlayoffsOut) {
    const oppRow = rows.find((t) => t.id === oppId);
    if (oppRow) {
      const oppConf = rows.filter((t) => t.conference === oppRow.conference);
      const oppStatus = computeClinchStatus(oppId, oppConf as unknown as StandingsTeam[]);
      if (!oppStatus.playoffEliminated) {
        const gb = gamesBackOfCutLine(oppId, oppConf);
        if (gb === null) {
          const seed = conferenceSeedOrder(oppConf).findIndex((t) => t.id === oppId) + 1;
          return `They are holding the ${ordinal(seed)} seed. You can take it off them.`;
        }
        return gb === 0
          ? 'They are level with the last playoff spot. This one decides something for them.'
          : `They are ${gb.toFixed(1)} games out of the last playoff spot and still alive.`;
      }
    }
  }
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
      oppTeamId: atHome ? g.awayTeamId : g.homeTeamId,
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

  // A bye is a real thing the bracket handed them, not an absence: the wild
  // card round happened and they weren't in it (createWildcardRound rests the
  // top two seeds). Asserted only when both halves are true, so a team that
  // simply missed the postseason can never read as having been rested.
  const bye = playoffGames.some((g) => g.kind === 'WILDCARD') && !mine.some((g) => g.kind === 'WILDCARD');

  // The last game itself — linescore and silhouette, both already stored on
  // every played Game since the engine was built.
  const lastBox = readJson<BoxScore | null>(last.boxScore, null);
  const userIsHome = last.homeTeamId === userTeam.id;
  const final: TrophyFinal | null = lastBox?.quarters
    ? {
      quarters: lastBox.quarters,
      home: { teamId: last.homeTeamId, abbr: last.homeTeam.abbr, score: last.homeScore },
      away: { teamId: last.awayTeamId, abbr: last.awayTeam.abbr, score: last.awayScore },
      overtime: wentToOvertime(lastBox),
      shape: computeGameShape(lastBox, userIsHome ? 'home' : 'away'),
    }
    : null;

  let mvp: TrophyPlayerLine | null = null;
  let mvpAward: string | null = null;
  if (wonTheFinal) {
    const award = await prisma.transaction.findFirst({
      where: { leagueId, seasonYear, type: 'AWARD_SBMVP' },
      orderBy: { createdAt: 'desc' },
    });
    if (award) {
      // The transaction is the authority on WHO — recomputing the winner here
      // could name a different man than the one on the wire, the history page
      // and the GM's honours list.
      //
      // AND IT NOW SAYS WHO. This used to read the name back out of the
      // headline and hunt the championship box score for a line matching that
      // string, purely to recover a portrait — the exact failure the doc on
      // Transaction.playerId names. The row carries the man. The name match
      // survives only for a row that has no id (a save written before the
      // column was filled in), and a miss still costs the portrait and the
      // stat columns, never the name.
      const m = award.headline.match(/^(.*)\s+\(([^)]+)\)$/);
      const name = m?.[1] ?? award.headline;
      const position = m?.[2] ?? '';
      mvpAward = award.detail || null;
      const winnerLines = (userIsHome ? lastBox?.lines?.home : lastBox?.lines?.away) ?? [];
      const line = award.playerId
        ? winnerLines.find((l) => l.playerId === award.playerId)
        : winnerLines.find((l) => l.name === name);
      const playerId = award.playerId ?? line?.playerId ?? '';
      mvp = {
        ...(await portraitFor(playerId || null)),
        playerId,
        name,
        position: line ? String(line.position) : position,
        stats: line ? statCells(String(line.position), line.stats) : [],
      };
    }
  }

  // Who actually carried the run. Postseason production is its own bucket
  // (Game.kind has always been stored), so this is the whole postseason, not
  // the last sixty minutes of it — and it is read through the same replay the
  // player page's year-by-year table uses rather than off a JSON column.
  const runLeaders = await buildRunLeaders(leagueId, userTeam.id, mine);

  // "You pick Nth" is only printed when the draft order genuinely exists —
  // reseedDraftOrder runs later in the offseason, so on the night the season
  // ends there is usually nothing true to say here yet.
  let nextPick: string | null = null;
  /*
   * THE SLOT ON A FUTURE PICK IS NOT A DRAFT POSITION.
   *
   * This read DraftPick.slot and printed it as "You pick 7th in the 2028
   * draft", guarded only by `slot > 0`. But future picks are created with
   * `slot: i + 1` — the team's index in the creation loop — so that guard is
   * always true and the number was a placeholder wearing an ordinal.
   * reseedDraftOrder does not replace it until the last week of free agency
   * (FREE_AGENCY.WEEKS), months of game time after this sentence is written.
   *
   * The season has just ended and the standings columns are still populated
   * (RESET_STANDINGS has not run yet), so the real answer is available right
   * here: projectedDraftOrder ranks the clubs by the record they just posted.
   * Whether a pick was traded is honoured too — we look up the slot of the
   * club whose record sets it, which is `originalTeamId`.
   */
  const pick = await prisma.draftPick.findFirst({
    where: { leagueId, year: seasonYear + 1, round: 1, ownerTeamId: userTeam.id },
    select: { originalTeamId: true },
  });
  if (pick) {
    const order = await projectedDraftOrder(leagueId);
    const slot = order.get(pick.originalTeamId);
    if (slot) {
      nextPick = pick.originalTeamId === userTeam.id
        ? `You pick ${ordinal(slot)} in the ${seasonYear + 1} draft.`
        : `You hold the ${ordinal(slot)} pick in the ${seasonYear + 1} draft.`;
    }
  }

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
    bye,
    roundsWon: road.filter((l) => l.won).length,
    record: recordString(userTeam),
    seed: userTeam.playoffSeed ?? null,
    pointDiff: userTeam.pointsFor - userTeam.pointsAgnst,
    final,
    mvp,
    mvpAward,
    runLeaders,
    history: await buildTrophyHistory(leagueId, userTeam.id, seasonYear),
    nextPick,
  };
}

/**
 * The two-to-three numbers that define a position, formatted the one way this
 * codebase formats them. Reading the lead columns out of lib/statLabels.ts
 * rather than listing stats here is what stops the trophy screen headlining a
 * running back's carries when every other surface headlines his yards.
 */
function statCells(position: string, stats: SeasonStats): { label: string; value: string }[] {
  return careerColumns(position)
    .filter((c) => c.lead != null && !isDerived(c))
    .sort((a, b) => a.lead! - b.lead!)
    .map((c) => ({ label: c.short, value: formatColumn(c, stats) ?? '—' }))
    .filter((c) => c.value !== '—');
}

/** Portrait inputs, or nulls when the row has gone. Never guessed. */
async function portraitFor(playerId: string | null): Promise<{ age: number | null; weightLb: number | null; heightIn: number | null }> {
  if (!playerId) return { age: null, weightLb: null, heightIn: null };
  const p = await prisma.player.findUnique({ where: { id: playerId }, select: { age: true, weightLb: true, heightIn: true } });
  return { age: p?.age ?? null, weightLb: p?.weightLb ?? null, heightIn: p?.heightIn ?? null };
}

/**
 * The three biggest postseason contributors on the user's own roster, ranked
 * by the SAME scorer that hands out the league's awards (lib/awards.ts) so
 * "who carried the run" and "who won MVP" cannot be settled by two different
 * yardsticks.
 *
 * The lines come from buildSeasonLines() — the box-score replay behind the
 * player page's year-by-year table — so this is exactly the postseason bucket
 * shown there, for the same games, and not a second opinion assembled by hand.
 */
async function buildRunLeaders(
  leagueId: string,
  teamId: string,
  games: { seasonYear: number; week: number; kind: string; homeTeamId: string; awayTeamId: string; boxScore: string }[],
): Promise<TrophyPlayerLine[]> {
  // buildSeasonLines walks BOTH sides of every box score, so the opponents in
  // these games come back too — hence the teamId filter, not a trust in the
  // input.
  const byPlayer = buildSeasonLines(games, new Map([[teamId, '']]));
  const mine: { playerId: string; line: SeasonLine }[] = [];
  for (const [playerId, lines] of byPlayer) {
    for (const line of lines) {
      if (line.teamId === teamId && line.playoffGp > 0) mine.push({ playerId, line });
    }
  }
  if (mine.length === 0) return [];

  const players = await prisma.player.findMany({
    where: { id: { in: mine.map((s) => s.playerId) } },
    select: { id: true, firstName: true, lastName: true, position: true, age: true, weightLb: true, heightIn: true },
  });
  const byId = new Map(players.map((p) => [p.id, p]));

  const ranked = mine
    .map((s) => {
      const p = byId.get(s.playerId);
      const defensive = p ? DEFENSIVE_POSITIONS.has(p.position) : false;
      return { ...s, p, score: defensive ? defensiveScore(s.line.playoffStats) : offensiveScore(s.line.playoffStats) };
    })
    .filter((s) => s.p != null && s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return ranked.map((s) => ({
    playerId: s.playerId,
    name: `${s.p!.firstName} ${s.p!.lastName}`,
    position: s.p!.position,
    age: s.p!.age,
    weightLb: s.p!.weightLb,
    heightIn: s.p!.heightIn,
    stats: statCells(s.p!.position, s.line.playoffStats),
    games: s.line.playoffGp,
  }));
}

/**
 * Counted, never asserted. Every figure the moment prints about franchise
 * history is a row in TeamSeasonRecord — the same table the Ring of Honor and
 * the dynasty leaderboard read — and the GM's own share of it is bounded on
 * the hire year exactly as lib/gmCareer.ts bounds everything else.
 */
async function buildTrophyHistory(leagueId: string, teamId: string, seasonYear: number): Promise<TrophyHistory> {
  const league = await prisma.league.findUniqueOrThrow({
    where: { id: leagueId },
    select: { id: true, seasonYear: true, startYear: true },
  });
  const gmHiredIn = await resolveStartYear(league);
  const records = await prisma.teamSeasonRecord.findMany({
    where: { leagueId, teamId },
    select: { year: true, playoffResult: true },
    orderBy: { year: 'asc' },
  });

  const titleYears = records.filter((r) => r.playoffResult === 'CHAMPION').map((r) => r.year);
  const before = titleYears.filter((y) => y < seasonYear);
  return {
    franchiseTitles: titleYears.length,
    previousTitleYear: before.length > 0 ? Math.max(...before) : null,
    seasonsOnRecord: records.length,
    gmTitles: titleYears.filter((y) => y >= gmHiredIn).length,
    gmHiredIn,
    gmSeasons: Math.max(1, seasonYear - gmHiredIn + 1),
  };
}
