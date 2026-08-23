import type { WeekReport } from './weekReport';

/**
 * ===========================================================================
 * THE SEASON-END CARD — the fold
 * ===========================================================================
 * WHY THIS EXISTS AT ALL.
 *
 * `finish()` in components/AdvanceWeekButton.tsx used to return early on a
 * Tier-0 moment and call setReport(null) on the way past. So the player who
 * missed the playoffs and pressed "Advance to Offseason" got the whole span
 * strip — every score, both records, every injury — and the player who WON
 * THE TITLE on the same press got the ring and lost all twenty-two weeks
 * behind it. The season you would most want the record of was the one that
 * threw it away.
 *
 * The obvious repair is to queue the trophy and then the span behind it. That
 * was rejected, and it deserved to be: the interruption budget's rule is that
 * the Tier-0 moment supersedes both and only ever ONE of them is on screen at
 * a time, and two artifacts in a row is that rule with the corner filed off.
 *
 * So the intersection gets its own artifact instead. "You watched a long
 * stretch of season go past in one press AND it ended in the postseason" is
 * not two events that collided, it is one event — and one screen. This module
 * is the arithmetic behind that screen: it takes the stretch of week reports
 * that was being thrown away and folds it into the facts a GM actually wants
 * about a year he watched go by in one press. The Tier-0 payload is not an
 * input here — the card renders that half straight off it.
 *
 * NOTHING HERE INVENTS A NUMBER. Every field is read off a WeekReport the sim
 * already built. No RNG, no database, no prisma import — this is pure so the
 * client can run it on state it is already holding, in the same tick as the
 * press.
 * ===========================================================================
 */

/** One week of the stretch, exactly as its own report described it. */
export interface SeasonEndWeek {
  /** "Week 7", "Wild Card Round". */
  label: string;
  /** "7" for a numbered week, the full label otherwise — the ribbon is tight. */
  short: string;
  outcome: 'W' | 'L' | 'T' | '—';
  mine: number | null;
  theirs: number | null;
  oppAbbr: string | null;
  atHome: boolean | null;
  /**
   * The estimate the user was shown BEFORE kickoff, never recomputed after.
   * The sim's own `upset` flag is deliberately not carried alongside it: the
   * card prints this number on the one game it singles out and nowhere else,
   * so a second, coarser version of the same fact would have no reader.
   */
  winChancePre: number | null;
  /** Null on a bye. Carried so the one week worth reopening can be reopened. */
  gameId: string | null;
}

/**
 * The one week the year swung on.
 *
 * Two candidates, and the preference between them is the whole point. A run
 * of wins is the thing a season is actually remembered by, so the FIRST win
 * of the longest winning streak wins the argument — but only if the streak is
 * at least three long (two is a fortnight, not a run) and only if it did not
 * start on the first game of the stretch, because the opening game of a span
 * is where it began, not where it turned. Failing that, the single most
 * improbable win: the one the club's own pre-game estimate had them losing.
 * When neither is true there is no honest answer and this is null, and the
 * card simply does not print the section.
 *
 * Only regular-season weeks are candidates. Every postseason game is already
 * printed in full on the card's road strip, so promoting one of them here
 * would be the same game twice on one screen.
 */
export interface SeasonEndTurn {
  kind: 'streak' | 'upset';
  week: SeasonEndWeek;
  /** Wins in the streak this game opened. 0 when `kind` is 'upset'. */
  streakLength: number;
  margin: number;
}

/** A man who went down, and the week he went down in. */
export interface SeasonEndInjury {
  playerId: string;
  name: string;
  position: string;
  weeks: number;
  weekLabel: string;
  /** He got hurt during the run, which is a different sentence entirely. */
  postseason: boolean;
}

export interface SeasonEndSummary {
  /** Regular-season weeks of the stretch, oldest first. */
  weeks: SeasonEndWeek[];
  /** How many advances this covers, postseason rounds included. */
  advances: number;
  /** Postseason rounds that fell inside the stretch. */
  roundsInSpan: number;
  /** "Weeks 1–17, then the playoffs". */
  label: string;
  recordFrom: string | null;
  recordTo: string | null;
  longestWinStreak: number;
  turn: SeasonEndTurn | null;
  /** The longest absences first, and anything from the postseason ahead of those. */
  injuries: SeasonEndInjury[];
  /** Distinct men, not reports — a man is counted once however often he is named. */
  injuredMen: number;
}

const REGULAR = 'Regular Season';

function weekNumber(label: string): number | null {
  const m = /^Week (\d+)$/.exec(label);
  return m ? Number(m[1]) : null;
}

function toWeek(r: WeekReport): SeasonEndWeek {
  const n = weekNumber(r.weekLabel);
  const short = n === null ? r.weekLabel : String(n);
  if (!r.result) {
    // A bye is a real week of the season, not a gap in the record. It stays in
    // the ribbon so the line reads as a year rather than as a list of games.
    return { label: r.weekLabel, short, outcome: '—', mine: null, theirs: null, oppAbbr: null, atHome: null, winChancePre: null, gameId: null };
  }
  const me = r.result.userIsHome ? r.result.home : r.result.away;
  const them = r.result.userIsHome ? r.result.away : r.result.home;
  return {
    label: r.weekLabel,
    short,
    outcome: r.result.outcome,
    mine: me.score,
    theirs: them.score,
    oppAbbr: them.abbr,
    atHome: r.result.userIsHome,
    winChancePre: r.result.winChancePre,
    gameId: r.result.gameId,
  };
}

/**
 * The longest run of wins in the stretch, and where it started.
 *
 * Bye weeks do not break a streak and do not extend it — the club did not
 * lose, they did not play. Ties do break it, because a tie is not a win and
 * calling five wins around a tie "six straight" would be a lie on a screen
 * whose whole licence is that every number on it is true.
 */
function longestStreak(weeks: SeasonEndWeek[]): { length: number; startIndex: number } {
  let best = { length: 0, startIndex: -1 };
  let run = 0;
  let start = -1;
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    if (w.outcome === '—') continue;
    if (w.outcome === 'W') {
      if (run === 0) start = i;
      run++;
      if (run > best.length) best = { length: run, startIndex: start };
    } else {
      run = 0;
      start = -1;
    }
  }
  return best;
}

function pickTurn(weeks: SeasonEndWeek[]): SeasonEndTurn | null {
  const streak = longestStreak(weeks);
  const played = weeks.findIndex((w) => w.outcome !== '—');
  if (streak.length >= 3 && streak.startIndex > played) {
    const w = weeks[streak.startIndex];
    return { kind: 'streak', week: w, streakLength: streak.length, margin: (w.mine ?? 0) - (w.theirs ?? 0) };
  }
  // The most improbable win of the stretch. Ranked on the estimate the user
  // was actually shown before kickoff, so this can never be a number that was
  // computed backwards from a result it already knew.
  let best: SeasonEndWeek | null = null;
  for (const w of weeks) {
    if (w.outcome !== 'W' || w.winChancePre === null || w.winChancePre >= 50) continue;
    if (!best || w.winChancePre < (best.winChancePre ?? 100)) best = w;
  }
  if (!best) return null;
  return { kind: 'upset', week: best, streakLength: 0, margin: (best.mine ?? 0) - (best.theirs ?? 0) };
}

/**
 * Every man the club lost across the stretch, best row per man.
 *
 * Deduped on playerId and NOT summed: the same hamstring can be named in two
 * consecutive weekly reports, and adding those together would invent an
 * eight-week absence out of one four-week one. First mention wins, because
 * that is the week he actually went down.
 */
function foldInjuries(reports: WeekReport[]): SeasonEndInjury[] {
  const seen = new Map<string, SeasonEndInjury>();
  for (const r of reports) {
    const postseason = r.phaseLabel !== REGULAR;
    for (const inj of r.injuries) {
      const key = inj.playerId || `${inj.name}|${inj.type}`;
      if (seen.has(key)) continue;
      seen.set(key, {
        playerId: inj.playerId,
        name: inj.name,
        position: inj.position,
        weeks: inj.weeks,
        weekLabel: r.weekLabel,
        postseason,
      });
    }
  }
  // A man lost in January is the story; after that, length of absence. The
  // card only has room for a handful, so the order decides what survives.
  return [...seen.values()].sort((a, b) => {
    if (a.postseason !== b.postseason) return a.postseason ? -1 : 1;
    return b.weeks - a.weeks;
  });
}

function spanLabel(weeks: SeasonEndWeek[], rounds: number): string {
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  const roundWord = rounds === 1 ? '1 playoff round' : `${rounds} playoff rounds`;
  if (!first) return roundWord;
  const a = weekNumber(first.label);
  const b = weekNumber(last.label);
  const regular = a !== null && b !== null
    ? (a === b ? `Week ${a}` : `Weeks ${a}–${b}`)
    : `${first.label} – ${last.label}`;
  return rounds > 0 ? `${regular}, then ${roundWord}` : regular;
}

/**
 * Fold a stretch of week reports into the season-end card's facts.
 *
 * The Tier-0 payload is deliberately NOT an input. Everything it owns — the
 * final, the MVP, the road, the franchise history — the card renders straight
 * off it, and folding those in here would give two different objects an
 * opinion about the same number. This function only answers the questions the
 * trophy cannot: what the stretch itself was.
 */
export function foldSeasonEnd(reports: WeekReport[]): SeasonEndSummary {
  const regular = reports.filter((r) => r.phaseLabel === REGULAR);
  const weeks = regular.map(toWeek);
  const roundsInSpan = reports.length - regular.length;

  // The stretch's own win/loss count is deliberately NOT folded here. The club
  // record on the Tier-0 payload is the whole season's, standings are not reset
  // until later in the offseason, and a second record built from the span alone
  // would sit next to it on the same card disagreeing with it.
  const withChange = regular.filter((r) => r.changed);
  const injuries = foldInjuries(reports);

  return {
    weeks,
    advances: reports.length,
    roundsInSpan,
    label: spanLabel(weeks, roundsInSpan),
    recordFrom: withChange[0]?.changed?.recordBefore ?? null,
    recordTo: withChange[withChange.length - 1]?.changed?.recordAfter ?? null,
    longestWinStreak: longestStreak(weeks).length,
    turn: pickTurn(weeks),
    injuries,
    injuredMen: injuries.length,
  };
}
