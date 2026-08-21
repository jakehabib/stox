import type { SeasonStats } from './types';
import { careerColumns } from './statLabels';
import { canonicalPosition } from './tuning';
import { positionRelativeScore, isRankablePosition, PositionDistribution } from './performanceScore';

/**
 * ===========================================================================
 * THE COACH ROOM — who gets mentioned, who gets called out, how it is read
 * ===========================================================================
 * This file does NOT rank players. lib/performanceScore.ts does, and it is the
 * only thing in this project that does: All-Star selection ranks a season with
 * it and the Week Report's Coach's Comments ranks a week with it, and the two
 * are not allowed to disagree about who is good. Everything here is the part
 * that ranker deliberately leaves to its caller.
 *
 * ---------------------------------------------------------------------------
 * 1. THE YARDSTICK (`NORMS`)
 * ---------------------------------------------------------------------------
 * `positionRelativeScore` takes the distribution as a parameter, on purpose:
 * 4,800 passing yards is an extraordinary season and an impossible afternoon.
 * A season caller builds it from season totals. This is the WEEK caller, so
 * the population is single-game outings — and not this week's thirty-two, but
 * every game the simulation has ever played, because a week contains one
 * quarterback per club and a distribution of one is not a distribution.
 *
 * Measured, not guessed: every played game in this Postgres, the 1,515,626
 * box lines among them that cleared `playedEnough` below, mean and standard
 * deviation of every stat `scoredStats` scores. Baked as literals so grading the report
 * costs no round trip and no measurable time — the Week Report must paint no
 * slower than it did before this section existed. Regenerate with
 * `scripts/_coachNorms.ts` if the engine's stat allocation ever changes; a
 * stale yardstick makes the grades wrong, not merely imprecise.
 *
 * The population is gated to men who actually played. Ungated, the mean back
 * is a third-stringer with two carries and every starter looks historic.
 *
 * ---------------------------------------------------------------------------
 * 2. THE READABLE UNIT (`COMPOSITE_LADDER`)
 * ---------------------------------------------------------------------------
 * The ranker's output is standard deviations, which is the right unit for
 * comparing two men and the wrong one to print. Worse, it is not equally hard
 * to earn everywhere. Measured, the 90th percentile of a receiver's afternoon
 * is +1.13 standard deviations and a corner's is +0.59, because a receiver's
 * line has four moving numbers and a corner's has two coin flips. A flat bar
 * across that is not a position-relative standard; it is the old bias wearing
 * a new coat.
 *
 * So each position's composite is passed through its OWN measured percentile
 * ladder. After that, one number means exactly one thing everywhere: "better
 * than N% of games played at this position". A bar of 78 is then the same
 * demand of a corner as of a quarterback. This is a calibration of the shared
 * ranker's output, not a second opinion about it — the ordering inside a
 * position is the ranker's, untouched.
 *
 * The flat-run rule in `ladderPercentile` is the trick that makes it honest.
 * The engine deals a defender's whole afternoon in integers between four and
 * seven, so half of a linebacker's ladder is the same number repeated. A plain
 * interpolation would call one ordinary five-tackle game 50th percentile and
 * an identical one 95th, purely from where the ladder was sampled. Landing on
 * a run returns the MIDDLE of it — the mid-rank percentile, the answer a full
 * sort of all 179,940 linebacker lines gives.
 *
 * ---------------------------------------------------------------------------
 * 3. HONESTY LIMITS
 * ---------------------------------------------------------------------------
 * Read off lib/sim/engine.ts's allocateStats() and enforced here rather than
 * papered over, because the standing rule against lying metrics applies to
 * prose as hard as it applies to a table:
 *  - There are no fumbles. `fum` is never written by the engine, so nothing
 *    may say a player put the ball on the ground.
 *  - `teamStats.thirdDownConv` is `plays/6` over `plays/4` — a constant ~67%
 *    for every team in every game ever simulated. It is not a conversion rate
 *    and is never quoted.
 *  - `teamStats.penalties` is `plays/12`. Also not real, also never quoted,
 *    and never attributed to a player.
 *  - `teamStats.passYards`/`rushYards` are a flat 60/40 split of total yards;
 *    the player lines carry the real split, so unit yardage is summed from
 *    the lines.
 *  - A punter's yards are `punts * rng.int(40, 50)` — pure dice, with no input
 *    from his rating. Praising a punt average would be praising a coin flip,
 *    so P is left out of `UNIT_OF` and can never be mentioned.
 *  - Offensive linemen get no box line at all, which is exactly why
 *    CAREER_COLUMNS gives them no columns. They cannot be graded and are not.
 * ===========================================================================
 */

// ---------------------------------------------------------------------------
// The measured yardstick
// ---------------------------------------------------------------------------

/** The percentile each slot of a ladder stands for. */
const LEVELS = [1, 2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 98, 99] as const;

const NORMS: Record<string, PositionDistribution> = {
  QB: {
    position: 'QB', n: 59978,
    mean: { gp: 1, passCmp: 27.743, passYds: 236.308, passTd: 1.841, int: -0.719, rushYds: 9.944 },
    sd:   { gp: 0, passCmp: 6.017, passYds: 66.902, passTd: 1.137, int: 0.708, rushYds: 11.994 },
  },
  RB: {
    position: 'RB', n: 160278,
    mean: { gp: 1, rushYds: 64.846, rushTd: 0.408, rec: 1.416, recYds: 7.326 },
    sd:   { gp: 0, rushYds: 37.602, rushTd: 0.734, rec: 1.278, recYds: 5.89 },
  },
  WR: {
    position: 'WR', n: 239920,
    mean: { gp: 1, rec: 5.064, recYds: 44.62, recTd: 0.297 },
    sd:   { gp: 0, rec: 2.086, recYds: 19.583, recTd: 0.457 },
  },
  TE: {
    position: 'TE', n: 117007,
    mean: { gp: 1, rec: 3.466, recYds: 30.419, recTd: 0.105 },
    sd:   { gp: 0, rec: 1.298, recYds: 12.215, recTd: 0.307 },
  },
  EDGE: {
    position: 'EDGE', n: 175162,
    mean: { gp: 1, tackles: 4.485, sacks: 0.351, ff: 0.06 },
    sd:   { gp: 0, tackles: 0.588, sacks: 0.477, ff: 0.237 },
  },
  DT: {
    position: 'DT', n: 175544,
    mean: { gp: 1, tackles: 4.478, sacks: 0.21, ff: 0.059 },
    sd:   { gp: 0, tackles: 0.594, sacks: 0.408, ff: 0.236 },
  },
  LB: {
    position: 'LB', n: 177670,
    mean: { gp: 1, tackles: 4.638, ff: 0.06 },
    sd:   { gp: 0, tackles: 0.633, ff: 0.237 },
  },
  CB: {
    position: 'CB', n: 179066,
    mean: { gp: 1, tackles: 4.501, defInt: 0.081, pd: 0.699, ff: 0.06 },
    sd:   { gp: 0, tackles: 0.603, defInt: 0.273, pd: 1.07, ff: 0.238 },
  },
  S: {
    position: 'S', n: 120243,
    mean: { gp: 1, tackles: 4.588, defInt: 0.222, pd: 0.704, ff: 0.06 },
    sd:   { gp: 0, tackles: 0.62, defInt: 0.415, pd: 1.072, ff: 0.237 },
  },
  K: {
    position: 'K', n: 54309,
    mean: { gp: 1, fgm: 1.587, xpm: 2.833, fgPct: 0.805 },
    sd:   { gp: 0, fgm: 1.151, xpm: 1.61, fgPct: 0.304 },
  },
};

const COMPOSITE_LADDER: Record<string, number[]> = {
  QB: [-1.3398390620812184, -1.2242889407037683, -1.0178371543746743, -0.8310952874700033, -0.6936597283444598, -0.5819916029220273, -0.48173165564050424, -0.39032746498358406, -0.3034699605971898, -0.21706348866691558, -0.133856649547468, -0.050056007383780875, 0.03651436060832969, 0.1257193483577375, 0.21888654277677488, 0.3201715914484962, 0.429966169643881, 0.5549984632040803, 0.709233055671103, 0.8951913788884873, 1.1871448237250015, 1.530047956808456, 1.7630601163079944], // n=60747
  RB: [-0.870028869136381, -0.8373005355949205, -0.788057313214039, -0.7318043177111537, -0.6832906172155614, -0.6347822495221342, -0.5865486619552617, -0.5302956664523762, -0.47112458340833535, -0.40638677260637257, -0.33800135237796525, -0.26523346803565934, -0.18326724491548266, -0.08141863645816057, 0.061643120839699646, 0.2586106596141646, 0.4655007441965187, 0.6651009247812544, 0.8733445869823763, 1.1250954118848184, 1.4890774656133714, 1.9304318362339545, 2.263354702202575], // n=162471
  WR: [-1.2500276171535722, -1.1793226493439728, -1.0614810363279739, -0.9375458557229723, -0.8257978102959759, -0.7254309522941742, -0.6372512294703776, -0.5482655588937708, -0.44261108105577673, -0.34224422305397506, -0.24187736505217353, -0.12403575203617455, -0.006194139020175558, 0.11224105264507386, 0.23617623325007525, 0.37758616886927404, 0.5305896610172274, 0.6955679192396259, 0.8847080787144747, 1.1250853459334145, 1.4625349563692747, 1.8518152531984762, 2.122447989258869], // n=243000
  TE: [-1.144217443583806, -1.0960891841010711, -0.9827354890854851, -0.8693817940698991, -0.7938126640595082, -0.7078998395715781, -0.6048898390335314, -0.5189770145456013, -0.4434078845352106, -0.33005418951962445, -0.25448505950923367, -0.14113136449364752, -0.017433975000522035, 0.09591972001506412, 0.23671428555830626, 0.3604116750514317, 0.5115499350722132, 0.6730318895705341, 0.8516110201189717, 1.078318410150144, 1.4012823191467854, 1.7787124666118157, 2.016179053707451], // n=118486
  EDGE: [-0.6323648601106039, -0.6323648601106039, -0.6323648601106039, -0.6323648601106039, -0.6323648601106039, -0.6323648601106039, -0.6323648601106039, -0.6323648601106039, -0.109078622538652, -0.109078622538652, -0.109078622538652, -0.109078622538652, -0.109078622538652, -0.109078622538652, 0.33522101313564673, 0.33522101313564673, 0.33522101313564673, 0.41420761503329984, 0.8585072507075986, 0.8585072507075986, 0.8585072507075986, 0.9843609027818656, 1.5076471403538174], // n=177426
  DT: [-1.041622865152277, -0.5236223471517588, -0.5236223471517588, -0.5236223471517588, -0.5236223471517588, -0.5236223471517588, -0.5236223471517588, -0.5236223471517588, -0.5236223471517588, -0.005621829151240825, -0.005621829151240825, -0.005621829151240825, -0.005621829151240825, -0.005621829151240825, -0.005621829151240825, -0.005621829151240825, 0.12826813524719818, 0.6075993723052548, 0.6075993723052548, 1.125599890305773, 1.125599890305773, 1.125599890305773, 1.643600408306291], // n=177796
  LB: [-0.6418228720706373, -0.6418228720706373, -0.6418228720706373, -0.6418228720706373, -0.6418228720706373, -0.6418228720706373, -0.6418228720706373, -0.6418228720706373, -0.6418228720706373, 0.21987467209136186, 0.21987467209136186, 0.21987467209136186, 0.21987467209136186, 0.21987467209136186, 0.21987467209136186, 0.21987467209136186, 0.21987467209136186, 0.21987467209136186, 0.21987467209136186, 0.8925077761840615, 1.0815722162533612, 1.7542053203460606, 1.7542053203460606], // n=179940
  CB: [-0.45050687678528606, -0.45050687678528606, -0.45050687678528606, -0.45050687678528606, -0.45050687678528606, -0.45050687678528606, -0.45050687678528606, -0.21359619211340738, -0.21359619211340738, -0.21359619211340738, -0.21359619211340738, -0.21359619211340738, -0.18348417985604712, -0.1533721675986868, 0.05342650481583159, 0.0835385170731919, 0.26022517723035005, 0.3505612140024308, 0.3505612140024308, 0.5874718986743096, 1.3562625206024481, 1.6533972297890476, 1.9204199267182864], // n=181380
  S: [-0.6711913578266187, -0.6711913578266187, -0.6711913578266187, -0.6711913578266187, -0.6711913578266187, -0.6711913578266187, -0.5379290976986869, -0.36980498049087424, -0.10328046023501071, 0.017276800521057796, 0.020052881804717742, 0.020052881804717742, 0.020052881804717742, 0.020052881804717742, 0.020052881804717742, 0.1533151419326495, 0.2865774020605813, 0.41983966218851304, 0.7085210401523943, 0.7085210401523943, 0.9750455604082578, 1.1083078205361896, 1.3997652797837308], // n=121783
  K: [-1.6263023193944868, -1.5307457020987392, -1.3396324675072435, -0.8961503154756658, -0.7581240904929191, -0.6236837211422042, -0.48207164052742574, -0.22835257228263411, -0.1495602738107018, -0.11761084664827709, -0.02205422935252938, 0.07350238794321834, 0.09226502522283522, 0.18782164251858297, 0.2833782598143307, 0.36017223983046154, 0.3789348771100784, 0.49325413168544296, 0.6224441636214704, 0.7799239835726861, 0.9784839402377231, 1.1809130900352938, 1.3907889619064062], // n=55005
};

/**
 * Where a value sits in its ladder, 0-100. See the header's flat-run note —
 * that rule is why a linebacker's five tackles reads as the ordinary game it
 * is instead of whichever percentile the sampling happened to land on.
 */
function ladderPercentile(ladder: number[] | undefined, value: number): number | null {
  if (!ladder || ladder.length === 0) return null;
  if (value <= ladder[0]) return value < ladder[0] ? 0 : LEVELS[0];
  if (value >= ladder[ladder.length - 1]) return value > ladder[ladder.length - 1] ? 100 : LEVELS[LEVELS.length - 1];
  let first = -1;
  let last = -1;
  for (let i = 0; i < ladder.length; i++) {
    if (ladder[i] === value) { if (first < 0) first = i; last = i; }
  }
  if (first >= 0) return (LEVELS[first] + LEVELS[last]) / 2;
  for (let i = 0; i < ladder.length - 1; i++) {
    if (value > ladder[i] && value < ladder[i + 1]) {
      const t = (value - ladder[i]) / (ladder[i + 1] - ladder[i]);
      return LEVELS[i] + t * (LEVELS[i + 1] - LEVELS[i]);
    }
  }
  return 50;
}

export interface Grade {
  /**
   * 0-100, and it means one thing only: the share of games at this position
   * that were worse than this one. 85 is a top-15% game for a corner and a
   * top-15% game for a quarterback.
   */
  score: number;
  /** The shared ranker's own output, in standard deviations. Kept for ties. */
  z: number;
}

/**
 * Grade ONE game, through lib/performanceScore.ts.
 *
 * For a multi-week span the caller grades each week separately and averages.
 * The yardstick is a per-game distribution, so handing it a seven-game total
 * would put every starter several standard deviations clear of a normal
 * afternoon and mean nothing at all.
 */
export function gradeLine(position: string, stats: SeasonStats): Grade | null {
  const pos = canonicalPosition(position);
  const dist = NORMS[pos];
  if (!dist || !isRankablePosition(pos)) return null;
  const z = positionRelativeScore(pos, stats, dist);
  const score = ladderPercentile(COMPOSITE_LADDER[pos], z);
  if (score === null) return null;
  return { score, z };
}

// ---------------------------------------------------------------------------
// Units — how the comments stay position-diverse BY CONSTRUCTION
// ---------------------------------------------------------------------------

export type UnitKey = 'QB' | 'BACKS' | 'RECEIVERS' | 'PASS_RUSH' | 'BACK_SEVEN' | 'KICKING';

export const UNIT_OF: Record<string, UnitKey> = {
  QB: 'QB',
  RB: 'BACKS',
  WR: 'RECEIVERS', TE: 'RECEIVERS',
  EDGE: 'PASS_RUSH', DT: 'PASS_RUSH',
  LB: 'BACK_SEVEN', CB: 'BACK_SEVEN', S: 'BACK_SEVEN',
  K: 'KICKING',
};

/**
 * Coach-room order. The list is ordered by UNIT rather than by grade, and
 * takes one man from each before it takes a second from any: that is what
 * makes the mix position-diverse by construction instead of by luck. The
 * grades are genuinely comparable across positions — that is the whole point
 * of calibrating through each position's own ladder — but a list SORTED by
 * them would still read as a leaderboard, and a coach does not walk the room
 * in leaderboard order.
 */
export const UNIT_ORDER: UnitKey[] = ['QB', 'BACKS', 'RECEIVERS', 'PASS_RUSH', 'BACK_SEVEN', 'KICKING'];

export const UNIT_LABEL: Record<UnitKey, string> = {
  QB: 'Under center',
  BACKS: 'Backfield',
  RECEIVERS: 'Receivers',
  PASS_RUSH: 'Front',
  BACK_SEVEN: 'Back seven',
  KICKING: 'Kicking',
};

/**
 * [TUNE] A unit earns a mention only when its best man cleared this percentile
 * FOR HIS POSITION. A mention manufactured to fill a slot is exactly the noise
 * this section exists to avoid, so some weeks name three men and some name
 * one.
 */
export const MENTION_BAR = 78;
/**
 * [TUNE] A second man from the same unit has to be this good to take a slot
 * off another unit — two receivers only both appear when they both had a
 * genuinely rare afternoon.
 */
export const SECOND_FROM_UNIT_BAR = 92;
/** [TUNE] Never more than this many, however good the week was. */
export const MAX_MENTIONS = 5;

/**
 * The same bar, asked of a STRETCH rather than an afternoon.
 *
 * A span mention is the average of a man's weekly percentiles, and an average
 * is a much quieter number than any of the games in it: percentiles are
 * uniform by construction, so seven of them average out with a standard error
 * of 28.9/sqrt(7) — about 11 points instead of 29. Holding the flat bar of 78
 * against that demanded a two-and-a-half-sigma stretch, and a seven-week
 * advance answered "who carried this" with "nobody" nearly every time. It was
 * not that nobody carried it; it was that the bar had quietly become three
 * times harder without anybody choosing to make it so.
 *
 * Dividing the DISTANCE from the middle by sqrt(weeks) tracks that standard
 * error exactly, so the bar goes on meaning one thing however long the stretch
 * is: "further above ordinary than chance would put a man". Identical at one
 * week, by construction.
 */
export function mentionBar(weeks: number, bar = MENTION_BAR): number {
  return 50 + (bar - 50) / Math.sqrt(Math.max(1, weeks));
}

/**
 * A defender may not be singled out on tackle count alone.
 *
 * Not a ranking rule — a truthfulness rule, and it is about this simulation
 * rather than about football. `allocateStats` hands every front-seven player
 * an integer between four and seven tackles off a flat roll, so the difference
 * between a five-tackle afternoon and a seven-tackle one is dice, not play.
 * Any honest ranker will still put the seven on top, and printing "seven
 * tackles — that's the tape we show the room" would be praising a coin flip in
 * a coach's voice. A sack, a takeaway, a forced fumble or a multi-breakup
 * afternoon are events the engine only writes when something actually
 * happened, so those are the only things a defender can be mentioned for.
 */
export function hasDistinguishingEvent(position: string, stats: SeasonStats): boolean {
  const unit = UNIT_OF[canonicalPosition(position)];
  if (unit !== 'PASS_RUSH' && unit !== 'BACK_SEVEN') return true;
  return (stats.sacks ?? 0) > 0
    || (stats.defInt ?? 0) > 0
    || (stats.ff ?? 0) > 0
    || (stats.pd ?? 0) >= 2;
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/**
 * Minimum workload, per game, before a line may be graded at all.
 *
 * The third-string tight end who ran four routes is not a top performer and is
 * emphatically not a worst performer; he is a man who did not play. Defenders
 * carry no gate because the engine writes a box line only for the defenders
 * who were actually on the field.
 */
const TOUCH_GATE: Record<string, (s: SeasonStats, games: number) => boolean> = {
  QB: (s, g) => (s.passAtt ?? 0) >= 12 * g,
  RB: (s, g) => (s.rushAtt ?? 0) + (s.rec ?? 0) >= 5 * g,
  WR: (s, g) => (s.targets ?? 0) >= 3 * g,
  TE: (s, g) => (s.targets ?? 0) >= 3 * g,
  K: (s, g) => (s.fga ?? 0) + (s.xpa ?? 0) >= 2 * g,
};

export function playedEnough(position: string, stats: SeasonStats, games = 1): boolean {
  const gate = TOUCH_GATE[canonicalPosition(position)];
  return gate ? gate(stats, Math.max(1, games)) : true;
}

// ---------------------------------------------------------------------------
// Stat-line rendering
// ---------------------------------------------------------------------------

/** Stats that are worse the higher they go. Mirrors performanceScore's set. */
const NEGATIVE = new Set(['int', 'fum']);

/** Numerator/denominator pairs a box score prints as one figure. */
const RATIOS: [string, string, string][] = [
  ['passCmp', 'passAtt', ''],
  ['fgm', 'fga', ' FG'],
  ['xpm', 'xpa', ' XP'],
];

/**
 * Reading units for the spoken line — "288 yd", not "288 Yds". Keyed by
 * position first, because the same column means a different thing in a
 * different line: `rushYds` is THE number on a running back's line and a
 * footnote on a quarterback's, and only one of them needs the word "rush".
 */
const UNIT_WORD: Record<string, string> = {
  passYds: 'yd', rushYds: 'yd', recYds: 'yd', passTd: 'TD', rushTd: 'TD', recTd: 'TD',
  int: 'INT', tackles: 'tkl', sacks: 'sk', defInt: 'INT', pd: 'PD', ff: 'FF',
  rec: 'rec', rushAtt: 'car', targets: 'tgt', fgm: 'FG', xpm: 'XP',
  punts: 'punts', puntYds: 'punt yd',
};
const UNIT_WORD_BY_POS: Record<string, Record<string, string>> = {
  QB: { rushYds: 'rush yd' },
  RB: { recYds: 'rec yd' },
};

/**
 * The stat line as a coach would read it aloud, built by walking
 * CAREER_COLUMNS for the position. Nothing here decides which numbers matter;
 * lib/statLabels.ts already did, and reusing it is what stops this line and
 * the player page's career table ever disagreeing about a position.
 */
export function statLine(position: string, stats: SeasonStats): string {
  const pos = canonicalPosition(position);
  const cols = careerColumns(pos);
  const s = stats as Record<string, number | undefined>;
  const used = new Set<string>(['gp']);
  const parts: string[] = [];

  for (const [num, den, suffix] of RATIOS) {
    if (!cols.some((c) => c.key === num) || !cols.some((c) => c.key === den)) continue;
    if ((s[den] ?? 0) === 0) continue;
    used.add(num); used.add(den);
    parts.push(`${s[num] ?? 0}/${s[den]}${suffix}`);
  }
  // Receptions and targets stay two figures rather than a ratio: the catch
  // rate is the point, and "10 rec (15 tgt)" is how it is read out loud.
  if (cols.some((c) => c.key === 'rec') && cols.some((c) => c.key === 'targets') && (s.targets ?? 0) > 0) {
    used.add('rec'); used.add('targets');
    parts.push(`${s.rec ?? 0} rec (${s.targets} tgt)`);
  }

  for (const c of cols) {
    if (used.has(c.key)) continue;
    const v = s[c.key] ?? 0;
    // A zero is worth printing only where its absence would be the point — a
    // clean sheet at quarterback is news, a tight end's zero forced fumbles
    // is not.
    const keepZero = NEGATIVE.has(c.key) && (s.passAtt ?? 0) > 0;
    if (v === 0 && !keepZero) continue;
    parts.push(`${v} ${UNIT_WORD_BY_POS[pos]?.[c.key] ?? UNIT_WORD[c.key] ?? c.short}`);
  }
  return parts.join(' · ') || 'took the field';
}

// ---------------------------------------------------------------------------
// Concerns — the careful half
// ---------------------------------------------------------------------------

export type ConcernKind = 'TURNOVERS' | 'ACCURACY' | 'EFFICIENCY' | 'HANDS' | 'KICKING';

export interface Concern {
  kind: ConcernKind;
  /** The literal number the mention rests on. No adjective without one. */
  fact: string;
  severity: number;
}

/**
 * [TUNE] The line below which a rate is genuinely bad, per position — each one
 * the 10th-percentile figure among players who cleared the same volume gate
 * the rule uses, measured over every played game in the database. Not numbers
 * picked because they sounded low: "worse than nine games in ten at this
 * position, on this much work".
 *
 * The catch rate is compared STRICTLY below rather than at-or-below, and alone
 * among these it matters: the engine's receptions and targets are small
 * integers, so an exact 0.500 (four of eight, five of ten) is the single
 * commonest value at the position and sits precisely on the 10th-percentile
 * line. At-or-below swept all of them in and called out men with a touchdown
 * on the same sheet that praised them. Strictly below leaves 4.4% of receiver
 * games and 4.8% of tight end games, which is what "worse than nine in ten"
 * was supposed to mean.
 */
const BAD_CMP_PCT = 0.577;
/**
 * Kicking, where the honest threshold depends on how much kicking is in the
 * sample. Per game the 10th-percentile field-goal day is one made in two;
 * across a seven-game stretch (n=822 real stretches in this database) the
 * 10th-percentile rate is 64.7% and the 10th-percentile extra-point rate is
 * 85.2%. The league kicks 79.6% from the field and 93.3% on extra points.
 */
const GAME_BAD_FG_PCT = 0.5;
const SPAN_BAD_FG_PCT = 0.647;
const SPAN_BAD_XP_PCT = 0.852;
const BAD_YPA = 4.0;
const BAD_YPC = 3.824;
const BAD_CATCH_RATE = 0.5;

/**
 * What actually went wrong, and nothing else.
 *
 * Every rule here has two halves: a VOLUME gate and a BAD OUTCOME. A quiet
 * game is not a bad game, and a backup's four snaps are not a game at all —
 * naming a third-string receiver for catching nothing is noise at best and,
 * since a real person is managing that roster, a small unfairness at worst. So
 * nothing appears in this list for what a player failed to accumulate, only
 * for something that measurably cost the team, on a workload big enough for
 * the rate to mean anything.
 *
 * There is no fumble rule because the engine never writes a fumble, and no
 * penalty rule because the penalty figure is `plays/12`.
 */
export function findConcerns(position: string, stats: SeasonStats, games = 1): Concern[] {
  const pos = canonicalPosition(position);
  const s = stats;
  const g = Math.max(1, games);
  const out: Concern[] = [];

  if (pos === 'QB') {
    const att = s.passAtt ?? 0;
    const ints = s.int ?? 0;
    // Two in a game is a bad afternoon by any standard, and the sample agrees:
    // 2 sits at the 90th percentile of interceptions thrown.
    if (ints >= 2 * g) {
      out.push({ kind: 'TURNOVERS', fact: `${ints} interception${ints === 1 ? '' : 's'}`, severity: 60 + ints * 12 });
    }
    if (att >= 25 * g) {
      const cmpPct = (s.passCmp ?? 0) / att;
      if (cmpPct <= BAD_CMP_PCT) {
        out.push({
          kind: 'ACCURACY',
          fact: `${s.passCmp ?? 0} of ${att}, ${(cmpPct * 100).toFixed(0)}%`,
          severity: 40 + (BAD_CMP_PCT - cmpPct) * 200,
        });
      }
      const ypa = (s.passYds ?? 0) / att;
      if (ypa <= BAD_YPA) {
        out.push({
          kind: 'EFFICIENCY',
          fact: `${s.passYds ?? 0} yards on ${att} throws, ${ypa.toFixed(1)} a drop-back`,
          severity: 40 + (BAD_YPA - ypa) * 15,
        });
      }
    }
  }

  if (pos === 'RB' && (s.rushAtt ?? 0) >= 12 * g) {
    const att = s.rushAtt ?? 0;
    const ypc = (s.rushYds ?? 0) / att;
    if (ypc <= BAD_YPC) {
      out.push({
        kind: 'EFFICIENCY',
        fact: `${att} carries for ${s.rushYds ?? 0}, ${ypc.toFixed(1)} a pop`,
        severity: 35 + (BAD_YPC - ypc) * 18,
      });
    }
  }

  if ((pos === 'WR' || pos === 'TE') && (s.targets ?? 0) >= 7 * g) {
    const tgt = s.targets ?? 0;
    const rate = (s.rec ?? 0) / tgt;
    if (rate < BAD_CATCH_RATE) {
      out.push({
        kind: 'HANDS',
        fact: `${s.rec ?? 0} of ${tgt} thrown his way`,
        severity: 35 + (BAD_CATCH_RATE - rate) * 120,
      });
    }
  }

  // A kicker is the one place a rule has to be written twice, because his
  // mistakes are COUNTS and everybody else's are rates. One missed extra point
  // is a bad afternoon and a real point off the board; one missed extra point
  // across seven games is a 91% stretch, which is ordinary, and calling a man
  // out for it — as this did, on a kicker who had also gone 11 of 12 from the
  // field — is exactly the unfairness the list exists to refuse. So a span is
  // judged on the rate over the stretch instead.
  if (pos === 'K') {
    const fga = s.fga ?? 0;
    const fgm = s.fgm ?? 0;
    const xpa = s.xpa ?? 0;
    const xpm = s.xpm ?? 0;
    const missedFg = fga - fgm;
    const missedXp = xpa - xpm;
    const badFg = g > 1 ? SPAN_BAD_FG_PCT : GAME_BAD_FG_PCT;
    if (fga >= 2 * g && (fgm / fga <= badFg || (g === 1 && missedFg >= 2))) {
      out.push({ kind: 'KICKING', fact: `${fgm} of ${fga} from the field`, severity: 45 + missedFg * 15 });
    }
    if (g === 1 && missedXp >= 1) {
      out.push({ kind: 'KICKING', fact: `${missedXp} extra point${missedXp === 1 ? '' : 's'} missed`, severity: 38 + missedXp * 14 });
    } else if (g > 1 && xpa >= 2 * g && xpm / xpa <= SPAN_BAD_XP_PCT) {
      out.push({ kind: 'KICKING', fact: `${xpm} of ${xpa} on extra points`, severity: 38 + missedXp * 6 });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Aggregation across a span
// ---------------------------------------------------------------------------

/** Sum two per-game lines. Used for DISPLAY and for gating across a span. */
export function addStats(a: SeasonStats, b: SeasonStats): SeasonStats {
  const out: Record<string, number> = { ...(a as Record<string, number>) };
  for (const [k, v] of Object.entries(b as Record<string, number>)) {
    if (typeof v !== 'number') continue;
    out[k] = (out[k] ?? 0) + v;
  }
  return out as SeasonStats;
}
