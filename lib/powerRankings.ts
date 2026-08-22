import { prisma } from './db';
import { Rng } from './rng';
import { parseSettings } from './settings';
import { buildLeagueRatings, TeamRating } from './teamRating';
import { BLOWOUT_MARGIN, ONE_SCORE_MARGIN } from './gameShape';

/**
 * The weekly power ranking — a 1-32 ordering that is deliberately NOT the
 * standings re-sorted.
 *
 * The standings answer "who is winning". This answers "who is actually good",
 * and the two are allowed to disagree: a 5-2 club that has won three one-score
 * games against bad teams sits below a 4-3 club that has been battering
 * people. If this ordering were monotonic in win percentage it would be a
 * second standings table taking up a screen, so every component below is
 * chosen for the ways it can pull AGAINST the record:
 *
 *   SRS     — opponent-adjusted scoring margin (the Simple Rating System: a
 *             team's average margin plus the average strength of everyone it
 *             played, solved by iteration). Each game's margin is capped at
 *             ±MARGIN_CAP so one 45-point Sunday cannot carry a season. This
 *             is the piece that promotes the team that keeps winning big and
 *             demotes the one that keeps escaping.
 *   RESUME   — results credited against the quality of who produced them.
 *             Beating a +10 SRS side is worth three times beating a −10 one,
 *             and losing to that +10 side costs a quarter of what losing to
 *             the −10 side does. This is the piece that demotes a fat record
 *             built on a soft schedule.
 *
 *             (An earlier draft credited results against opponents' WIN
 *             PERCENTAGE, which turned out to be worthless in this sim: over
 *             the first six weeks every 5-1 team in a test league had an
 *             opponents' win rate of exactly .389, every 4-2 team exactly
 *             .444, every 3-3 exactly .500. Schedule strength was a pure
 *             function of your own record, so the component was the standings
 *             wearing a hat — 34% of the weight spent re-asserting what the
 *             record column already said. Opponent quality has to come from
 *             something the schedule cannot pin to your own record.)
 *   RATING  — buildLeagueRatings()'s team overall. Not a proxy for it, not a
 *             recomputation: the same number the dashboard, the handover
 *             screen and the standings column show. This is the forward-
 *             looking piece — talent that has not cashed in yet.
 *   FORM    — the last four games, exponentially weighted. This is the piece
 *             that moves week to week, and therefore the piece that makes the
 *             ranking worth republishing every week.
 *
 * Each component is turned into a z-score across the 32 teams before it is
 * weighted, because the four are measured in different units (a win share, a
 * point margin, a 0-99 rating). Mixing them raw would silently let point
 * differential — the widest-spread number — decide everything.
 *
 * Nothing here is random. `Rng` appears exactly once, seeded per league-week,
 * and only to choose between equally-true phrasings of a note; it never
 * touches an ordering. The same league in the same week renders the same
 * table every time.
 */

/**
 * [TUNE] Component weights, applied to z-scores. They sum to 1 and are the
 * whole personality of the ranking: raise RESUME and it converges on the
 * standings, raise RATING and it converges on the roster table.
 */
export const POWER_WEIGHTS = {
  resume: 0.28,
  srs: 0.28,
  rating: 0.24,
  form: 0.20,
} as const;

/**
 * [TUNE] Points of SRS worth one unit of win expectancy — i.e. how much better
 * than a coin flip a team is against an opponent this many points weaker.
 * Twenty points is about the whole span from best team to worst in this sim,
 * so a game against a side 10 points better is scored as a ~25% proposition.
 */
const SRS_TO_WIN_EXPECTANCY = 20;

/** [TUNE] Iterations of the SRS fixed point. It converges long before this. */
const SRS_PASSES = 8;

/**
 * [TUNE] A single game's margin counts for at most this much. Three scores.
 * Above this a game is already saying everything it can say about the winner,
 * and letting it say more just rewards running up a score on a bad team.
 */
const MARGIN_CAP = 21;

/**
 * [TUNE] Games needed before the results-based components carry their full
 * weight. Below it they are scaled down and the roster rating absorbs the
 * remainder — in week 2 the record is three coin flips and saying otherwise
 * is the lying-metric failure. At zero games this is purely a talent ranking,
 * which is exactly what a preseason power ranking is.
 */
const FULL_CONFIDENCE_GAMES = 6;

/** [TUNE] How many places a team must move to be worth a headline. */
const NEWSWORTHY_MOVE = 3;

/** Last-N games the form component looks at, most recent first. */
const FORM_WINDOW = 4;
/** [TUNE] Decay across that window, most recent game first. */
const FORM_DECAY = [1, 0.7, 0.5, 0.35];

export type GameResult = 'W' | 'L' | 'T';

export interface PowerRow {
  teamId: string;
  abbr: string;
  city: string;
  nickname: string;
  conference: string;
  division: string;
  isUser: boolean;

  /** 1-32 in THIS ordering. The number the row displays, and no other. */
  rank: number;
  /** Composite index, league average 50. Higher is better. */
  index: number;

  wins: number;
  losses: number;
  ties: number;
  played: number;
  pct: number;
  /**
   * 1-32 by record alone (win pct, then point differential) — the standings'
   * own order. NULL before a ball has been kicked: with every club 0-0 there
   * is no record to rank, and printing a position produced by a tiebreak on
   * nothing would be a lie in the one column that exists to be argued with.
   */
  recordRank: number | null;

  /** buildLeagueRatings().overall — the same figure every other screen shows. */
  rating: number;
  /** buildLeagueRatings().rank. */
  ratingRank: number;

  /** Raw point differential per game, for display. */
  netPerGame: number;
  /** Opponent-adjusted scoring margin, in points per game (SRS). */
  srs: number;
  /** Result credit against expectation per game, -1..1. */
  resume: number;
  /** Last four results, most recent LAST. */
  recentForm: GameResult[];
  streak: string | null;

  /** Wins decided by <= ONE_SCORE_MARGIN, and wins by >= BLOWOUT_MARGIN. */
  oneScoreWins: number;
  blowoutWins: number;
  /** Average SRS of everyone played so far, in points. Positive is a hard schedule. */
  scheduleStrength: number;

  /**
   * Movement against the most recent earlier snapshot. NULL means "we do not
   * know yet" — before any snapshot exists there is no last week, and a 0
   * would claim a stability nobody measured.
   */
  move: { delta: number; fromRank: number; fromWeek: number } | null;

  /** One line, derived from this team's own facts. Only the notable rows get one. */
  note: string | null;
}

export interface PowerRankingBoard {
  seasonYear: number;
  /** The week these rankings are published FOR (i.e. entering this week). */
  week: number;
  weekLabel: string;
  rows: PowerRow[];
  /** True once at least one row could be compared against a stored week. */
  hasMovement: boolean;
  /** The week movement is measured against, when there is one. */
  priorWeek: number | null;
  /** False when the snapshot table does not exist yet — the UI hides movement entirely. */
  snapshotsAvailable: boolean;
  /**
   * Whether this edition is one that gets written down. Only the regular
   * season and the postseason have a stable week to key on; a preseason or
   * offseason ranking is real but has no week, so it never becomes a
   * "last week" for anything.
   */
  storable: boolean;
}

// --- Snapshot storage -------------------------------------------------------
//
// Movement cannot be recomputed. A team rating depends on the roster as it is
// RIGHT NOW, so a club that signed a free agent on Tuesday would retroactively
// rewrite what it was ranked last Sunday. Last week's ranking therefore has to
// have been written down last week.
//
// The model this reads (PowerRankingSnapshot, see docs/power-rankings.md) is
// accessed through a feature check rather than the generated client type,
// because the migration that adds it lands separately from this file. Until it
// exists every read returns null, `move` stays null on every row, and the UI
// shows no arrows at all — not zeroes.

/**
 * The model is reached through a runtime check rather than assumed present.
 * It is fully typed — this is the generated delegate, not an `any` — but a
 * process running an older generated client (the dev server between a
 * migration and its restart, a deploy mid-roll) simply does not have the
 * property. Rather than 500 every league page, those processes get null here,
 * every row's `move` stays null, the MOV column is not rendered at all, and
 * the ticker emits nothing. No zeroes, no invented deltas.
 */
type SnapshotDelegate = typeof prisma.powerRankingSnapshot;

function snapshotStore(): SnapshotDelegate | null {
  const delegate: SnapshotDelegate | undefined = prisma.powerRankingSnapshot;
  return delegate && typeof delegate.findMany === 'function' ? delegate : null;
}

/** Whether weekly snapshots can be stored at all in this deployment. */
export function powerSnapshotsAvailable(): boolean {
  return snapshotStore() !== null;
}

// --- The maths --------------------------------------------------------------

function zScores(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  // Every team identical (week 1: nobody has played) — a z-score is undefined,
  // and 0 is the honest answer: this component separates nobody.
  if (sd < 1e-9) return values.map(() => 0);
  return values.map((v) => (v - mean) / sd);
}

const clampTo = (v: number, cap: number) => Math.max(-cap, Math.min(cap, v));

interface PlayedGame {
  week: number;
  oppId: string;
  margin: number;
  result: GameResult;
}

function resultValue(r: GameResult): number {
  return r === 'W' ? 1 : r === 'T' ? 0.5 : 0;
}

/**
 * What a coin-flip-free league would have expected this team to take from
 * this game, from the opponent's strength alone. Clamped away from 0 and 1
 * because no football game is a certainty, and an unclamped expectation would
 * hand out unbounded credit for beating the league's worst team.
 */
function expectedResult(oppSrs: number): number {
  return Math.max(0.1, Math.min(0.9, 0.5 - oppSrs / (2 * SRS_TO_WIN_EXPECTANCY)));
}

/**
 * Result credit against expectation. Beating a side you were expected to beat
 * banks a little; beating one you were not banks a lot; losing to a good team
 * costs less than losing to a bad one. Averages to zero for a team that has
 * done exactly what its schedule asked, so the number reads as "how much
 * better than par this résumé is".
 */
function resumeCredit(g: PlayedGame, oppSrs: number): number {
  return resultValue(g.result) - expectedResult(oppSrs);
}

/**
 * The Simple Rating System: average scoring margin, adjusted for the average
 * strength of the schedule that produced it, solved by iterating until the
 * two agree. A team's rating is (its mean capped margin) + (the mean rating of
 * everyone it played), recentred on zero each pass so the whole league cannot
 * drift upward together.
 *
 * This is the component that lets the ranking argue with the record: a 5-2
 * side that has squeaked past four bad teams and been beaten twice comes out
 * near zero, while a 4-3 side that has been battering people comes out well
 * above it.
 */
function solveSrs(teamIds: string[], logs: Map<string, PlayedGame[]>): Map<string, number> {
  const rating = new Map(teamIds.map((id) => [id, 0]));
  const ownMargin = new Map(
    teamIds.map((id) => {
      const log = logs.get(id) ?? [];
      const mean = log.length === 0 ? 0 : log.reduce((s, g) => s + clampTo(g.margin, MARGIN_CAP), 0) / log.length;
      return [id, mean];
    }),
  );

  for (let pass = 0; pass < SRS_PASSES; pass++) {
    const next = new Map<string, number>();
    for (const id of teamIds) {
      const log = logs.get(id) ?? [];
      if (log.length === 0) { next.set(id, 0); continue; }
      const sos = log.reduce((s, g) => s + (rating.get(g.oppId) ?? 0), 0) / log.length;
      next.set(id, (ownMargin.get(id) ?? 0) + sos);
    }
    const mean = teamIds.reduce((s, id) => s + (next.get(id) ?? 0), 0) / Math.max(1, teamIds.length);
    for (const id of teamIds) rating.set(id, (next.get(id) ?? 0) - mean);
  }
  return rating;
}

function formScore(games: PlayedGame[]): number {
  // Most recent first.
  const window = [...games].sort((a, b) => b.week - a.week).slice(0, FORM_WINDOW);
  if (window.length === 0) return 0;
  let total = 0;
  let weight = 0;
  window.forEach((g, i) => {
    const w = FORM_DECAY[i] ?? 0.25;
    const marginPart = clampTo(g.margin, MARGIN_CAP) / MARGIN_CAP;
    const resultPart = g.result === 'W' ? 1 : g.result === 'T' ? 0 : -1;
    total += w * (0.4 * resultPart + 0.6 * marginPart);
    weight += w;
  });
  return weight > 0 ? total / weight : 0;
}

// --- Notes ------------------------------------------------------------------

/**
 * The one-line reason, in the game's own voice. Every branch is a fact this
 * team actually produced — a streak, a margin, a rating that outstrips the
 * record — and the ordering is by how much the fact explains the row it sits
 * on. There is no generic fallback: a team with nothing interesting to say
 * gets no note rather than a sentence that could be about anyone.
 */
function noteFor(row: PowerRow, rng: Rng, used: Set<string>): string | null {
  const record = `${row.wins}-${row.losses}${row.ties ? `-${row.ties}` : ''}`;
  const net = `${row.netPerGame >= 0 ? '+' : ''}${row.netPerGame.toFixed(1)}`;
  const adj = `${row.srs >= 0 ? '+' : ''}${row.srs.toFixed(1)}`;
  const streakRun = row.streak ? Number(row.streak.slice(1)) : 0;

  /**
   * Picks a phrasing that has not already been used on this page, and returns
   * null when every phrasing of this fact is spent — which sends the caller on
   * to the next fact rather than printing the same sentence down four
   * consecutive rows. lib/wireRank.ts records what that looks like when it is
   * not guarded: one sentence, 28 times, in a single league's news table.
   */
  const say = (key: string, variants: string[]): string | null => {
    const free = variants.map((v, i) => ({ v, k: `${key}:${i}` })).filter((c) => !used.has(c.k));
    if (free.length === 0) return null;
    const chosen = free[Math.floor(rng.next() * free.length)];
    used.add(chosen.k);
    return chosen.v;
  };

  // Ordered by how much the fact explains the row it is sitting on. A ranking
  // far away from the record is the most interesting thing this table can say,
  // so it speaks first.
  // NOTHING HAS HAPPENED YET, SO THERE IS NOTHING TO SAY.
  //
  // Preseason rows used to carry a note explaining that the table was a
  // roster ranking and restating the club's rating and rank — both of which
  // the row already prints, in its own columns, a few pixels to the right.
  // The app owner asked for it gone. A note earns its line by saying
  // something the table cannot: that a club is ranked far above its record,
  // that a streak is carrying it, that the roster and the results disagree.
  // Before a ball is kicked none of those exist, and a sentence that only
  // re-reads the row is noise dressed as insight.
  if (row.played === 0) return null;

  const facts: (() => string | null)[] = [
    // Ranked well above its record. The evidence has to be whatever ACTUALLY
    // lifted them: the schedule-adjusted margin when that is positive, the
    // roster when it is not. Citing raw point differential here produced
    // "the results have not caught up with the football: -7.4 a game" — a
    // sentence that argues against itself, on a club whose case was that its
    // margin is respectable once you see who it played.
    () => {
      if (!(row.recordRank !== null && row.recordRank - row.rank >= 6 && row.played >= 3)) return null;
      if (row.srs > 0) {
        return say('over-margin', [
          `${ordinal(row.rank)} here and ${ordinal(row.recordRank)} on record: ${adj} a game once you account for who they have played.`,
          `${record} undersells it — ${adj} a game against this schedule, and the scoreboard has been unkind.`,
        ]);
      }
      return say('over-talent', [
        `${record} is not what this roster is: ${row.rating} overall, ${ordinal(row.ratingRank)} in the league.`,
        `The record says ${ordinal(row.recordRank)}, the roster says ${ordinal(row.ratingRank)}, and the truth is somewhere around ${ordinal(row.rank)}.`,
      ]);
    },
    () => {
      if (!(row.recordRank !== null && row.rank - row.recordRank >= 6 && row.played >= 3)) return null;
      const soft = row.scheduleStrength <= -2 ? ' against a schedule nobody is going to be impressed by' : '';
      return say('under', [
        `${record}, ${row.oneScoreWins} of those wins by a single score${soft} — this is the record of a team that has been living right.`,
        `The record flatters: ${adj} a game once you account for who they have played, and the margins keep saying it.`,
        `${ordinal(row.recordRank)} on record and ${ordinal(row.rank)} here, because ${net} a game is what they have actually been.`,
      ]);
    },
    () => (row.blowoutWins >= 2
      ? say('blowout', [
          `${row.blowoutWins} wins by ${BLOWOUT_MARGIN}-plus. Nobody is getting out of there with a story.`,
          `Beating teams by ${BLOWOUT_MARGIN} and up, ${row.blowoutWins} times over — that is not a hot streak, it is a gap.`,
          `${row.blowoutWins} of their wins were over before the fourth quarter, and it shows at ${net} a game.`,
        ])
      : null),
    () => (row.streak?.startsWith('W') && streakRun >= 3
      ? say('hot', [
          `${streakRun} straight, ${net} a game while doing it.`,
          `Won ${streakRun} on the bounce and the differential has gone with them: ${net} a night.`,
          `Nobody has beaten them in ${streakRun} weeks.`,
        ])
      : null),
    () => (row.streak?.startsWith('L') && streakRun >= 3
      ? say('cold', [
          `${streakRun} straight defeats. The ${ordinal(row.ratingRank)}-rated roster in football is not the problem.`,
          `Lost ${streakRun} in a row at ${net} a game — the talent is still ${row.rating} overall, the season is going anyway.`,
          `${streakRun} weeks without a win, and ${record} is now the honest description.`,
        ])
      : null),
    () => (row.rank <= 3 && row.ratingRank <= 6 && row.played >= 3
      ? say('elite', [
          `${row.rating} overall, ${ordinal(row.ratingRank)} in the league, ${record}. Everything lines up.`,
          `The roster is ${ordinal(row.ratingRank)}-rated and the results agree: ${record}, ${net} a game.`,
        ])
      : null),
    () => (row.move && Math.abs(row.move.delta) >= 4
      ? say('mover', [
          `Comes ${row.move.delta > 0 ? 'up' : 'down'} ${Math.abs(row.move.delta)} places off a ${net}-a-game month.`,
          `${Math.abs(row.move.delta)} places ${row.move.delta > 0 ? 'up' : 'down'} on the week — ${record}, ${net} a game.`,
        ])
      : null),
    () => (row.scheduleStrength >= 3 && row.played >= 4
      ? say('schedule', [
          `Has played the hard half of the league — opponents averaging ${row.scheduleStrength >= 0 ? '+' : ''}${row.scheduleStrength.toFixed(1)} a game — and is ${record} out of it.`,
          `Nobody has had it harder: opponents ${row.scheduleStrength >= 0 ? '+' : ''}${row.scheduleStrength.toFixed(1)} a game, and they are ${record}.`,
        ])
      : null),
    () => (row.oneScoreWins >= 3 && row.played >= 5
      ? say('close', [
          `${row.oneScoreWins} of their wins came by a single score. Living on the edge of the sword.`,
        ])
      : null),
  ];

  for (const fact of facts) {
    const line = fact();
    if (line) return line;
  }
  return null;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

// --- Build ------------------------------------------------------------------

/**
 * The week these rankings belong to. `League.week` is the week ABOUT to be
 * played, so a ranking published now is the one you take into it — which is
 * how power rankings are published in the sport.
 *
 * The postseason resets `League.week` to 1 for four rounds, so a playoff week
 * cannot share the regular season's numbering. Once the regular season is
 * over the standings are final, so everything from the playoffs onward maps to
 * one terminal week (seasonLength + 1): the final regular-season ranking, and
 * it stops moving because nothing behind it moves.
 */
function rankingWeek(phase: string, week: number, seasonLength: number): { week: number; label: string } | null {
  if (phase === 'REGULAR') return { week, label: `Week ${week}` };
  if (phase === 'PLAYOFFS') return { week: seasonLength + 1, label: 'Final' };
  return null;
}

/**
 * What this edition of the rankings is called. Every phase gets a name — a
 * preseason ranking is a real thing a league publishes, it just is not one
 * that can be stored against a week number.
 */
function editionLabel(phase: string, week: number, seasonYear: number): string {
  if (phase === 'REGULAR') return `Week ${week}`;
  if (phase === 'PLAYOFFS') return 'Final';
  if (phase === 'PRESEASON' || phase === 'FANTASY_DRAFT') return 'Preseason';
  return `${seasonYear} Offseason`;
}

export async function buildPowerRankings(leagueId: string): Promise<PowerRankingBoard> {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const seasonLength = settings.seasonLength || 17;
  const period = rankingWeek(league.phase, league.week, seasonLength);

  const [teams, ratings, games] = await Promise.all([
    prisma.team.findMany({
      where: { leagueId },
      // Deterministic in, deterministic out — Postgres is free to return rows
      // in any order it likes, and a power ranking that reshuffles its ties
      // between renders is worthless.
      orderBy: { abbr: 'asc' },
    }),
    buildLeagueRatings(leagueId),
    prisma.game.findMany({
      where: { leagueId, seasonYear: league.seasonYear, kind: 'REGULAR', played: true },
      orderBy: { week: 'asc' },
      select: { week: true, homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
    }),
  ]);

  const logByTeam = new Map<string, PlayedGame[]>();
  const push = (teamId: string, g: PlayedGame) => {
    const arr = logByTeam.get(teamId) ?? [];
    arr.push(g);
    logByTeam.set(teamId, arr);
  };
  for (const g of games) {
    const margin = g.homeScore - g.awayScore;
    const result: GameResult = margin === 0 ? 'T' : margin > 0 ? 'W' : 'L';
    push(g.homeTeamId, { week: g.week, oppId: g.awayTeamId, margin, result });
    push(g.awayTeamId, { week: g.week, oppId: g.homeTeamId, margin: -margin, result: result === 'T' ? 'T' : result === 'W' ? 'L' : 'W' });
  }

  const pctOf = (t: { wins: number; losses: number; ties: number }) =>
    (t.wins + t.ties * 0.5) / Math.max(1, t.wins + t.losses + t.ties);

  // Same comparator the standings and the playoff seeder use (byStanding in
  // lib/standingsBoard.ts): win pct, then point differential. Applied league-
  // wide here so "the standings say 12th" is a real, checkable number.
  const byRecord = [...teams].sort((a, b) => {
    const pa = pctOf(a);
    const pb = pctOf(b);
    if (pb !== pa) return pb - pa;
    return (b.pointsFor - b.pointsAgnst) - (a.pointsFor - a.pointsAgnst);
  });
  const anyGamesPlayed = games.length > 0;
  const recordRankById = new Map<string, number | null>(
    byRecord.map((t, i) => [t.id, anyGamesPlayed ? i + 1 : null]),
  );

  interface Draft {
    team: (typeof teams)[number];
    rating: TeamRating | undefined;
    log: PlayedGame[];
    resume: number;
    srs: number;
    form: number;
    netPerGame: number;
    scheduleStrength: number;
  }

  // Opponent strength first: both the margin component and the résumé
  // component are measured against it, so it has to be solved before either.
  const srsById = solveSrs(teams.map((t) => t.id), logByTeam);

  const draft: Draft[] = teams.map((t) => {
    const log = logByTeam.get(t.id) ?? [];
    const played = log.length;
    const resume = played === 0 ? 0 : log.reduce((s, g) => s + resumeCredit(g, srsById.get(g.oppId) ?? 0), 0) / played;
    const netPerGame = played === 0 ? 0 : log.reduce((s, g) => s + g.margin, 0) / played;
    const scheduleStrength = played === 0 ? 0 : log.reduce((s, g) => s + (srsById.get(g.oppId) ?? 0), 0) / played;
    return {
      team: t,
      rating: ratings.get(t.id),
      log,
      resume,
      srs: srsById.get(t.id) ?? 0,
      form: formScore(log),
      netPerGame,
      scheduleStrength,
    };
  });

  const zResume = zScores(draft.map((d) => d.resume));
  const zSrs = zScores(draft.map((d) => d.srs));
  const zRating = zScores(draft.map((d) => d.rating?.overall ?? 0));
  const zForm = zScores(draft.map((d) => d.form));

  // How much the season so far is allowed to speak. Everything it does not
  // claim goes to the roster rating, which is the only component that is
  // meaningful with no games played.
  const gamesPlayed = Math.max(...draft.map((d) => d.log.length), 0);
  const confidence = Math.min(1, gamesPlayed / FULL_CONFIDENCE_GAMES);
  const wResume = POWER_WEIGHTS.resume * confidence;
  const wSrs = POWER_WEIGHTS.srs * confidence;
  const wForm = POWER_WEIGHTS.form * confidence;
  const wRating = 1 - (wResume + wSrs + wForm);

  const scored = draft.map((d, i) => ({
    d,
    composite: wResume * zResume[i] + wSrs * zSrs[i] + wRating * zRating[i] + wForm * zForm[i],
  }));

  // Ties break on the RATING RANK, then the abbreviation, so the order is fully
  // determined by the data rather than by query order.
  //
  // The rank, not `rating.overall`, and that is the whole point. `overall` is
  // ROUNDED (lib/teamRating.ts rounds for display but ranks on the unrounded
  // value, deliberately and with a comment saying so), so every pair of clubs
  // landing on the same integer is exactly tied here — and before a ball is
  // kicked `wRating` is 1 and the composite IS the rounded rating, so the ties
  // are everywhere. The chain then fell through to alphabetical order, which
  // is how the #1 club came to carry the note "theirs is the 2nd-best roster"
  // while #2 said "1st in the league": both notes were true, the table was
  // sorted by a different key than the notes were written from. Measured
  // across 20 dev leagues: 11 had a preseason contradiction, one of them on
  // 23 of its 32 rows.
  scored.sort((a, b) =>
    b.composite - a.composite
    || (a.d.rating?.rank ?? Number.MAX_SAFE_INTEGER) - (b.d.rating?.rank ?? Number.MAX_SAFE_INTEGER)
    || a.d.team.abbr.localeCompare(b.d.team.abbr));

  // --- Movement, from what was written down, or nothing at all -------------
  const store = snapshotStore();
  let priorByTeam = new Map<string, { rank: number; week: number }>();
  let priorWeek: number | null = null;
  if (store && period) {
    const earlier = await store.findMany({
      where: { leagueId, seasonYear: league.seasonYear, week: { lt: period.week } },
      orderBy: { week: 'desc' },
      take: 64,
    });
    priorWeek = earlier[0]?.week ?? null;
    if (priorWeek !== null) {
      priorByTeam = new Map(earlier.filter((s) => s.week === priorWeek).map((s) => [s.teamId, { rank: s.rank, week: s.week }]));
    }
  }

  const noteRng = new Rng(`power:${leagueId}:${league.seasonYear}:${period?.week ?? 0}`);

  const rows: PowerRow[] = scored.map(({ d, composite }, i) => {
    const t = d.team;
    const log = d.log;
    const played = log.length;
    const recent = [...log].sort((a, b) => a.week - b.week).slice(-FORM_WINDOW).map((g) => g.result);
    const last = log.length ? [...log].sort((a, b) => a.week - b.week) : [];
    let streak: string | null = null;
    if (last.length) {
      const lastResult = last[last.length - 1].result;
      let run = 0;
      for (let k = last.length - 1; k >= 0 && last[k].result === lastResult; k--) run++;
      streak = `${lastResult}${run}`;
    }
    const prior = priorByTeam.get(t.id);
    const rank = i + 1;
    const row: PowerRow = {
      teamId: t.id,
      abbr: t.abbr,
      city: t.city,
      nickname: t.nickname,
      conference: t.conference,
      division: t.division,
      isUser: t.isUser,
      rank,
      index: 50 + composite * 8,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      played,
      pct: pctOf(t),
      recordRank: recordRankById.get(t.id) ?? null,
      rating: d.rating?.overall ?? 0,
      ratingRank: d.rating?.rank ?? 0,
      netPerGame: d.netPerGame,
      resume: d.resume,
      recentForm: recent,
      streak,
      oneScoreWins: log.filter((g) => g.result === 'W' && Math.abs(g.margin) <= ONE_SCORE_MARGIN).length,
      blowoutWins: log.filter((g) => g.result === 'W' && Math.abs(g.margin) >= BLOWOUT_MARGIN).length,
      srs: d.srs,
      scheduleStrength: d.scheduleStrength,
      move: prior ? { delta: prior.rank - rank, fromRank: prior.rank, fromWeek: prior.week } : null,
      note: null,
    };
    return row;
  });

  // Notes go to the rows a reader is actually looking at: the top of the
  // table, plus whoever moved most and the user's own club.
  const noteworthy = new Set<string>(rows.slice(0, 5).map((r) => r.teamId));
  // The two rows furthest from where their record would put them, in each
  // direction. These are the argument the page exists to make, so they are the
  // rows that most need to say why out loud.
  const swings = rows.filter((r) => r.recordRank !== null);
  const mostOverRated = [...swings].sort((a, b) => (b.recordRank! - b.rank) - (a.recordRank! - a.rank))[0];
  const mostUnderRated = [...swings].sort((a, b) => (a.recordRank! - a.rank) - (b.recordRank! - b.rank))[0];
  if (mostOverRated && mostOverRated.recordRank! - mostOverRated.rank >= 4) noteworthy.add(mostOverRated.teamId);
  if (mostUnderRated && mostUnderRated.rank - mostUnderRated.recordRank! >= 4) noteworthy.add(mostUnderRated.teamId);
  const biggestMover = [...rows].filter((r) => r.move).sort((a, b) => Math.abs(b.move!.delta) - Math.abs(a.move!.delta))[0];
  if (biggestMover) noteworthy.add(biggestMover.teamId);
  const user = rows.find((r) => r.isUser);
  if (user) noteworthy.add(user.teamId);
  const bottom = rows[rows.length - 1];
  if (bottom) noteworthy.add(bottom.teamId);
  const usedPhrasings = new Set<string>();
  for (const r of rows) {
    if (noteworthy.has(r.teamId)) r.note = noteFor(r, noteRng, usedPhrasings);
  }

  return {
    seasonYear: league.seasonYear,
    week: period?.week ?? league.week,
    weekLabel: editionLabel(league.phase, league.week, league.seasonYear),
    rows,
    hasMovement: rows.some((r) => r.move !== null),
    priorWeek,
    snapshotsAvailable: store !== null,
    storable: period !== null,
  };
}

/**
 * Writes this week's ranking down, once, if it has not been written already.
 *
 * Called from page renders rather than from the week tick, so a save that has
 * never opened the rankings screen still accumulates history the moment any
 * league page is opened in a new week. It is an upsert-shaped `createMany`
 * with `skipDuplicates` against a unique (league, year, week, team) key, so
 * two concurrent renders cannot write two versions of the same week, and a
 * week already on record is never rewritten — the whole point of the snapshot
 * is that it says what we thought THEN.
 */
export async function ensurePowerSnapshot(
  leagueId: string,
  opts: { board?: PowerRankingBoard; league?: LeagueClock } = {},
): Promise<void> {
  const store = snapshotStore();
  if (!store) return;

  // The caller usually has the league row already — this runs on every league
  // page — so re-reading it would be a query spent learning what was just
  // passed down.
  const league = opts.league ?? await prisma.league.findUniqueOrThrow({
    where: { id: leagueId },
    select: { seasonYear: true, week: true, phase: true, settings: true },
  });
  const seasonLength = parseSettings(league.settings).seasonLength || 17;
  const period = rankingWeek(league.phase, league.week, seasonLength);
  // Only the regular season and the postseason have a stable week to key on;
  // the offseason phases reuse week numbers across five different phases and
  // records are reset to 0-0 anyway.
  if (!period) return;

  const existing = await store.findMany({
    where: { leagueId, seasonYear: league.seasonYear, week: period.week },
    take: 1,
  });
  if (existing.length > 0) return;

  const data = opts.board ?? (await buildPowerRankings(leagueId));
  await store.createMany({
    data: data.rows.map((r) => ({
      leagueId,
      seasonYear: data.seasonYear,
      week: period.week,
      teamId: r.teamId,
      rank: r.rank,
      powerIndex: Math.round(r.index * 10) / 10,
      rating: r.rating,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      netPerGame: Math.round(r.netPerGame * 10) / 10,
    })),
    skipDuplicates: true,
  });
}

// --- Ticker -----------------------------------------------------------------

/** The parts of a League row that decide which ranking edition is current. */
export interface LeagueClock {
  seasonYear: number;
  week: number;
  phase: string;
  settings: string;
}

export interface PowerWireItem {
  category: 'LEAGUE';
  headline: string;
}

/**
 * Ticker headlines for the week's biggest movers.
 *
 * Reads the stored snapshots only — it never recomputes a ranking, so it is
 * two indexed queries on a layout that renders on every league page. It obeys
 * the ticker's three standing rules:
 *
 *   - CURRENT LEAGUE YEAR ONLY. Both snapshots are filtered to
 *     `league.seasonYear`, so a save in its fifth season cannot have a 2026
 *     ranking scroll past. This is the same failure mode as the seeded
 *     championships: an old row is not news.
 *   - NEVER PADDED. If nothing moved NEWSWORTHY_MOVE places, this returns an
 *     empty array and the strip is shorter this week. That is allowed.
 *   - CAPPED. At most two items, and the caller files them under one category
 *     so the layout's round-robin cannot let them displace a trade or a
 *     firing.
 */
export async function powerRankingWireItems(
  leagueId: string,
  league: LeagueClock,
  limit = 2,
): Promise<PowerWireItem[]> {
  const store = snapshotStore();
  if (!store) return [];
  const seasonLength = parseSettings(league.settings).seasonLength || 17;
  const period = rankingWeek(league.phase, league.week, seasonLength);
  if (!period) return [];
  // Once per week, and only while the ranking it describes is this week's
  // news. The postseason freezes on one final ranking that then cannot move,
  // so without this gate the same two headlines rode the strip through all
  // four rounds — a fortnight-old story, which is the exact failure the
  // seasonYear floor exists to prevent, just at a shorter range.
  const fresh = league.phase === 'REGULAR' || (league.phase === 'PLAYOFFS' && league.week === 1);
  if (!fresh) return [];

  const rows = await store.findMany({
    where: { leagueId, seasonYear: league.seasonYear, week: { lte: period.week } },
    orderBy: { week: 'desc' },
    take: 96,
  });
  if (rows.length === 0) return [];
  const currentWeek = rows[0].week;
  // Nothing to report until the current week has actually been written.
  if (currentWeek !== period.week) return [];
  const prevWeek = rows.find((r) => r.week < currentWeek)?.week;
  if (prevWeek === undefined) return [];

  const now = rows.filter((r) => r.week === currentWeek);
  const before = new Map(rows.filter((r) => r.week === prevWeek).map((r) => [r.teamId, r.rank]));

  const teams = await prisma.team.findMany({ where: { leagueId }, select: { id: true, city: true } });
  const cityById = new Map(teams.map((t) => [t.id, t.city]));

  const movers = now
    .map((r) => ({ teamId: r.teamId, rank: r.rank, delta: (before.get(r.teamId) ?? r.rank) - r.rank }))
    .filter((m) => Math.abs(m.delta) >= NEWSWORTHY_MOVE)
    // Biggest move first; a tie goes to the team that ended up higher, because
    // a jump into the top five is a bigger story than the same jump into 24th.
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.rank - b.rank)
    .slice(0, limit);

  return movers.map((m) => ({
    category: 'LEAGUE' as const,
    headline: `${(cityById.get(m.teamId) ?? 'A club').toUpperCase()} ${m.delta > 0 ? 'UP' : 'DOWN'} ${Math.abs(m.delta)} TO #${m.rank} IN THE ${period.label.toUpperCase()} POWER RANKINGS`,
  }));
}
