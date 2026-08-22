/**
 * Display-only analytics for the Cap and Stats "Advanced" views.
 *
 * Nothing here feeds the simulation, the AI, or any stored value — these are
 * read-only derivations over data the game already produced, the same way a
 * real front office's analytics department works off the box score rather
 * than changing what happened on the field.
 */

import { POSITION_GROUPS, PositionGroup } from './positionGroups';

export interface PythagoreanRow {
  teamId: string;
  name: string;
  abbr: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Win% the point differential "should" have produced. */
  expectedWinPct: number;
  /** Expected wins over the games actually played. */
  expectedWins: number;
  /** actual wins − expected wins. Positive = winning more than the scoring says. */
  luck: number;
  isUser: boolean;
}

/**
 * Pythagorean expectation — the classic sports-analytics estimate of the
 * win rate a team's scoring "deserves", independent of how the wins actually
 * fell. The exponent is the football-tuned 2.37 (Football Outsiders' fit for
 * the NFL), not baseball's 2.
 *
 * A team well above its expectation has been winning close games; one below
 * has been losing them. Neither is predictive on its own — that's the point
 * of showing it next to the real record.
 */
export function pythagorean(pointsFor: number, pointsAgainst: number): number {
  const EXP = 2.37;
  if (pointsFor <= 0 && pointsAgainst <= 0) return 0.5;
  const pf = Math.pow(Math.max(0, pointsFor), EXP);
  const pa = Math.pow(Math.max(0, pointsAgainst), EXP);
  if (pf + pa === 0) return 0.5;
  return pf / (pf + pa);
}

export function buildPythagoreanTable(
  teams: { id: string; city: string; nickname: string; abbr: string; wins: number; losses: number; ties: number; pointsFor: number; pointsAgnst: number }[],
  userTeamId?: string,
): PythagoreanRow[] {
  return teams
    .map((t) => {
      const played = t.wins + t.losses + t.ties;
      const expectedWinPct = pythagorean(t.pointsFor, t.pointsAgnst);
      const expectedWins = expectedWinPct * played;
      // Ties count as half a win on both sides of the comparison so the
      // luck figure stays honest in a league that allows them.
      const actualWins = t.wins + t.ties * 0.5;
      return {
        teamId: t.id,
        name: `${t.city} ${t.nickname}`,
        abbr: t.abbr,
        wins: t.wins,
        losses: t.losses,
        ties: t.ties,
        pointsFor: t.pointsFor,
        pointsAgainst: t.pointsAgnst,
        expectedWinPct,
        expectedWins,
        luck: actualWins - expectedWins,
        isUser: t.id === userTeamId,
      };
    })
    .filter((r) => r.wins + r.losses + r.ties > 0)
    .sort((a, b) => b.luck - a.luck);
}

/**
 * Strength of schedule — the combined win rate of every opponent a team has
 * actually played, weighted by how often they played them. Uses opponents'
 * full-season records (the standard "opponent win %" definition), so it
 * reflects who you played, not when.
 */
export function strengthOfSchedule(
  teamId: string,
  games: { homeTeamId: string; awayTeamId: string; played: boolean }[],
  recordById: Map<string, { wins: number; losses: number; ties: number }>,
): { sos: number; opponents: number } {
  let total = 0;
  let count = 0;
  for (const g of games) {
    if (!g.played) continue;
    const oppId = g.homeTeamId === teamId ? g.awayTeamId : g.homeTeamId === teamId || g.awayTeamId === teamId ? g.homeTeamId : null;
    if (!oppId) continue;
    const rec = recordById.get(oppId);
    if (!rec) continue;
    const gp = rec.wins + rec.losses + rec.ties;
    if (gp === 0) continue;
    total += (rec.wins + rec.ties * 0.5) / gp;
    count++;
  }
  return { sos: count > 0 ? total / count : 0, opponents: count };
}

export interface CapHealth {
  /** Share of committed cap held by the five largest cap hits. */
  topFiveShare: number;
  /** Roster age weighted by cap dollars — "how old is the money", not the roster. */
  capWeightedAge: number;
  /** Plain unweighted average age, for contrast with the above. */
  rosterAvgAge: number;
  /** Dead money as a share of the total cap. */
  deadShare: number;
  /** Cap dollars committed to next season as a share of NEXT season's cap. */
  nextYearCommittedShare: number;
  /** Players under contract beyond this season. */
  playersUnderContractNextYear: number;
}

export function buildCapHealth(input: {
  rows: { age: number; hit: number; yearsRemaining: number; nextYearHit: number }[];
  capUsed: number;
  capTotal: number;
  /**
   * Next season's ceiling. The cap grows every year (CAP.CAP_GROWTH_PER_YEAR),
   * so measuring next year's commitments against THIS year's ceiling
   * overstates the squeeze by the growth rate. Optional so a caller that
   * genuinely only has the current figure still gets the old behaviour.
   */
  nextYearCapTotal?: number;
  deadMoney: number;
}): CapHealth {
  const { rows, capUsed, capTotal, deadMoney } = input;
  const nextYearCap = input.nextYearCapTotal ?? capTotal;
  const hits = rows.map((r) => r.hit).sort((a, b) => b - a);
  const topFive = hits.slice(0, 5).reduce((s, v) => s + v, 0);
  const totalHit = hits.reduce((s, v) => s + v, 0);
  const dollarWeighted = totalHit > 0
    ? rows.reduce((s, r) => s + r.age * r.hit, 0) / totalHit
    : 0;
  const nextYear = rows.reduce((s, r) => s + (r.yearsRemaining > 1 ? r.nextYearHit : 0), 0);

  return {
    topFiveShare: capUsed > 0 ? topFive / capUsed : 0,
    capWeightedAge: dollarWeighted,
    rosterAvgAge: rows.length > 0 ? rows.reduce((s, r) => s + r.age, 0) / rows.length : 0,
    deadShare: capTotal > 0 ? deadMoney / capTotal : 0,
    nextYearCommittedShare: nextYearCap > 0 ? nextYear / nextYearCap : 0,
    playersUnderContractNextYear: rows.filter((r) => r.yearsRemaining > 1).length,
  };
}

/**
 * A deviation only counts as a real bargain/overpay once it clears BOTH a
 * percentage-of-value bar and a flat dollar floor. Percentage alone would
 * flag a $15K miss on a $30M QB deal as an "overpay" — noise in a league
 * with a $255M cap (see CAP.BASE_CAP). Dollar-floor alone would flag a
 * minimum-salary punter for being paid double his going rate, which still
 * isn't a number that moves a roster. Requiring both means the threshold
 * scales with the player's own value while staying anchored to what
 * actually matters on a real cap sheet.
 */
export const CONTRACT_VALUE_MATERIAL_PCT = 0.12;
export const CONTRACT_VALUE_MATERIAL_FLOOR = 1_000_000;

export type ContractValueTier = 'bargain' | 'market' | 'overpay';

/** market − cap hit, classified against the material-deviation band above. */
export function classifyContractValue(surplus: number, marketValue: number): ContractValueTier {
  const threshold = Math.max(marketValue * CONTRACT_VALUE_MATERIAL_PCT, CONTRACT_VALUE_MATERIAL_FLOOR);
  if (surplus >= threshold) return 'bargain';
  if (surplus <= -threshold) return 'overpay';
  return 'market';
}

export interface SurplusRow {
  playerId: string;
  name: string;
  position: string;
  age: number;
  ovr: number;
  hit: number;
  marketValue: number;
  /** market − cap hit. Positive = paying under what the rating is worth. */
  surplus: number;
  tier: ContractValueTier;
}

/** Ranked contract value — the bargains and the overpays, by absolute dollars. Market-rate deals are excluded from both lists. */
export function rankContractValue(rows: SurplusRow[]): { bargains: SurplusRow[]; overpays: SurplusRow[] } {
  const sorted = [...rows].sort((a, b) => b.surplus - a.surplus);
  return {
    bargains: sorted.filter((r) => r.tier === 'bargain').slice(0, 6),
    overpays: sorted.filter((r) => r.tier === 'overpay').slice(-6).reverse(),
  };
}

// ===========================================================================
// THE ANALYTICS DEPARTMENT
// ===========================================================================
// Everything below serves app/league/[id]/analytics — the read-only screen
// described in docs/design-research/analytics/design.md. Same contract as the
// rest of this file: pure functions over rows the caller already loaded, no
// prisma, no writes, and nothing else in the game reads any of it.
//
// The reason it is pure rather than "just load it in the page" is that every
// figure here has a twin somewhere else in the app — a unit rating on the
// dashboard, a cap hit on the cap sheet, a starter on the depth chart — and a
// pure function that takes the SAME rows those screens take is the cheapest
// way to keep the two from drifting apart.
// ===========================================================================


/** Which side of the ball a unit plays on. Three slots, the validated scatter set. */
export type UnitSide = 'OFF' | 'DEF' | 'ST';

const OFFENSE_GROUPS: PositionGroup[] = ['QB', 'RB', 'WR', 'TE', 'OL'];
const DEFENSE_GROUPS: PositionGroup[] = ['DL', 'LB', 'DB'];

export function unitSide(g: PositionGroup): UnitSide {
  return OFFENSE_GROUPS.includes(g) ? 'OFF' : DEFENSE_GROUPS.includes(g) ? 'DEF' : 'ST';
}

export interface UnitSpendRow {
  group: PositionGroup;
  side: UnitSide;
  /** This club's cap dollars at the unit. */
  spend: number;
  /** Share of this club's own active salary. */
  share: number;
  /**
   * Mean share across ALL THIRTY-TWO clubs, this one included — the thing the
   * share is judged against. It said "the other 31" and it never was: the
   * average runs over `input.teamIds`, which is every club. The on-screen
   * wording says "league average", which is right for all 32; only this line
   * was wrong.
   */
  leagueMeanShare: number;
  /** share − leagueMeanShare, in share units (multiply by 100 for points). */
  shareDelta: number;
  /** buildLeagueRatings()'s number for the unit, verbatim. Never recomputed here. */
  rating: number;
  rank: number;
  /** Share of team quality the unit carries — UNIT_WEIGHT, normalised. */
  weight: number;
  leagueMeanRating: number;
  ratingDelta: number;
  /** Bodies on the roster at the group, and how many of them are on the field. */
  count: number;
  starterSlots: number;
  avgAge: number;
  /** Deals with one year or less left — the offseason's own to-do list. */
  expiring: number;
  topName: string;
  topOvr: number;
}

/**
 * The flagship panel's table: what each unit costs against what the league
 * spends there, and what it rates against what the league fields there.
 *
 * Both axes are DIFFERENCES from the league because neither raw number means
 * anything alone — "14.5% of the cap on the offensive line" is only high or
 * low once you know what everyone else does, and a raw unit rating of 82 is
 * unreadable without its mean beside it. This used to claim the league-wide
 * rating spread was "about seven points"; measured, per-unit spreads run
 * 18-40 (quarterback 53-93) and team overall 61-81. The argument for showing
 * differences survives the correction — it is stronger with the real numbers
 * — but the number itself was stale by a factor of three.
 */
export function buildUnitSpendTable(input: {
  /** Every club's cap dollars per group, keyed `${teamId}|${group}`. */
  spendByTeamGroup: Map<string, number>;
  /** Every club's total active salary, keyed by teamId. */
  spendByTeam: Map<string, number>;
  /** Every club's unit ratings, keyed by teamId — straight from buildLeagueRatings(). */
  unitRatingByTeam: Map<string, { group: PositionGroup; rating: number; rank: number; weight: number }[]>;
  teamIds: string[];
  myTeamId: string;
  /** The user's roster, already reduced to what this table needs. */
  roster: { group: PositionGroup; age: number; ovr: number; name: string; yearsRemaining: number }[];
  startersAtGroup: Record<PositionGroup, number>;
}): UnitSpendRow[] {
  const myTotal = input.spendByTeam.get(input.myTeamId) ?? 0;

  return POSITION_GROUPS.map((g) => {
    const spend = input.spendByTeamGroup.get(`${input.myTeamId}|${g}`) ?? 0;
    const share = myTotal > 0 ? spend / myTotal : 0;

    // A club with no cap spend at all (an OFF-cap league, or an empty roster)
    // contributes 0 rather than NaN — one bad divisor would poison the mean
    // for all 32 and there is no honest way to show that.
    const shares = input.teamIds.map((id) => {
      const total = input.spendByTeam.get(id) ?? 0;
      return total > 0 ? (input.spendByTeamGroup.get(`${id}|${g}`) ?? 0) / total : 0;
    });
    const leagueMeanShare = shares.reduce((a, b) => a + b, 0) / Math.max(1, shares.length);

    const unitRatings = input.teamIds
      .map((id) => input.unitRatingByTeam.get(id)?.find((u) => u.group === g)?.rating)
      .filter((v): v is number => typeof v === 'number');
    const leagueMeanRating = unitRatings.length
      ? unitRatings.reduce((a, b) => a + b, 0) / unitRatings.length
      : 0;

    const mine = input.unitRatingByTeam.get(input.myTeamId)?.find((u) => u.group === g);
    const atGroup = input.roster.filter((r) => r.group === g);
    const best = [...atGroup].sort((a, b) => b.ovr - a.ovr)[0];

    return {
      group: g,
      side: unitSide(g),
      spend,
      share,
      leagueMeanShare,
      shareDelta: share - leagueMeanShare,
      rating: mine?.rating ?? 0,
      rank: mine?.rank ?? 0,
      weight: mine?.weight ?? 0,
      leagueMeanRating,
      ratingDelta: (mine?.rating ?? 0) - leagueMeanRating,
      count: atGroup.length,
      starterSlots: input.startersAtGroup[g] ?? 0,
      avgAge: atGroup.length ? atGroup.reduce((a, r) => a + r.age, 0) / atGroup.length : 0,
      expiring: atGroup.filter((r) => r.yearsRemaining <= 1).length,
      topName: best?.name ?? '—',
      topOvr: best?.ovr ?? 0,
    };
  });
}

export interface LuckSeasonRow {
  year: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  played: number;
  /** Wins the scoring deserved, over the games actually played. */
  expectedWins: number;
  /** Ties count half, on both sides, so the gap stays honest. */
  actualWins: number;
  luck: number;
  playoffResult: string;
  /** True once the user is the general manager — the generated backstory is not. */
  tenure: boolean;
}

/**
 * Wins against the wins the scoring deserved, one row per completed season.
 *
 * The season IN PROGRESS is deliberately not a row here: a part-season plotted
 * on a wins axis reads as a collapse. The masthead carries it as a rate instead.
 */
export function buildLuckLedger(
  records: { year: number; wins: number; losses: number; ties: number; pointsFor: number; pointsAgnst: number; playoffResult: string }[],
  tenureStartYear: number,
): LuckSeasonRow[] {
  return records
    .filter((r) => r.wins + r.losses + r.ties > 0)
    .map((r) => {
      const played = r.wins + r.losses + r.ties;
      const expectedWins = pythagorean(r.pointsFor, r.pointsAgnst) * played;
      const actualWins = r.wins + r.ties * 0.5;
      return {
        year: r.year,
        wins: r.wins,
        losses: r.losses,
        ties: r.ties,
        pointsFor: r.pointsFor,
        pointsAgainst: r.pointsAgnst,
        played,
        expectedWins,
        actualWins,
        luck: actualWins - expectedWins,
        playoffResult: r.playoffResult,
        tenure: r.year >= tenureStartYear,
      };
    })
    .sort((a, b) => a.year - b.year);
}

export interface MarginGame {
  week: number;
  home: boolean;
  us: number;
  them: number;
  margin: number;
  oppAbbr: string;
  /** computeGameShape()'s reading, or null for a game with no stored drive log. */
  archetype: string | null;
  note: string | null;
  leadChanges: number;
  largestLead: number;
  largestDeficit: number;
}

export interface MarginProfile {
  oneScoreWins: number;
  oneScoreLosses: number;
  blowoutWins: number;
  blowoutLosses: number;
  averageMargin: number;
  /** Games lost after leading by ten or more — the drive log's own answer. */
  blownLeads: MarginGame[];
  /** Losses inside the one-score band, and the biggest of them. */
  narrowLosses: MarginGame[];
  /** One row per archetype computeGameShape() actually produced. Empty ones are not invented. */
  shapes: { archetype: string; games: number; wins: number; detail: string }[];
}

/** A LEAD this big, surrendered, is the thing the panel is looking for. */
export const BLOWN_LEAD_MARGIN = 10;

export function buildMarginProfile(
  games: MarginGame[],
  thresholds: { oneScore: number; blowout: number },
): MarginProfile {
  const shapes = new Map<string, { games: number; wins: number; detail: string[] }>();
  for (const g of games) {
    // A game whose box score predates the drive log has no archetype, and it
    // is filed as exactly that rather than being dropped or guessed at.
    const key = g.archetype ?? 'Not on record';
    const e = shapes.get(key) ?? { games: 0, wins: 0, detail: [] };
    e.games++;
    if (g.margin > 0) e.wins++;
    e.detail.push(`${g.home ? '' : '@'}${g.oppAbbr} ${g.margin >= 0 ? '+' : '−'}${Math.abs(g.margin)}`);
    shapes.set(key, e);
  }

  return {
    oneScoreWins: games.filter((g) => g.margin > 0 && g.margin <= thresholds.oneScore).length,
    oneScoreLosses: games.filter((g) => g.margin < 0 && g.margin >= -thresholds.oneScore).length,
    blowoutWins: games.filter((g) => g.margin >= thresholds.blowout).length,
    blowoutLosses: games.filter((g) => g.margin <= -thresholds.blowout).length,
    averageMargin: games.length ? games.reduce((a, g) => a + g.margin, 0) / games.length : 0,
    blownLeads: games.filter((g) => g.margin < 0 && g.largestLead >= BLOWN_LEAD_MARGIN),
    narrowLosses: games
      .filter((g) => g.margin < 0 && g.margin >= -thresholds.oneScore)
      .sort((a, b) => b.margin - a.margin),
    shapes: [...shapes.entries()]
      .map(([archetype, v]) => ({ archetype, games: v.games, wins: v.wins, detail: v.detail.join(', ') }))
      .sort((a, b) => b.games - a.games || a.archetype.localeCompare(b.archetype)),
  };
}

export interface AgeBandRow {
  band: string;
  players: number;
  /** First-teamers in the band — lib/lineup.ts's definition, passed in. */
  starters: number;
  spend: number;
  avgOvr: number;
}

export interface AgeCliff {
  startersOver30: number;
  startersOver30InTwo: number;
  starterSpendOver30InTwo: number;
  startersSignedPastTwo: number;
  rosterSignedPastTwo: number;
  starterCount: number;
}

/** [TUNE] The bands. Five is the most a 53-man roster splits into legibly. */
const AGE_BANDS = ['21-23', '24-26', '27-29', '30-32', '33+'] as const;
const bandOf = (a: number) => (a <= 23 ? '21-23' : a <= 26 ? '24-26' : a <= 29 ? '27-29' : a <= 32 ? '30-32' : '33+');
/** [TUNE] The age a starter's decline is worth planning around. */
const CLIFF_AGE = 30;

export function buildAgeProfile(
  rows: { age: number; hit: number; ovr: number; yearsRemaining: number; starter: boolean }[],
): { bands: AgeBandRow[]; cliff: AgeCliff } {
  const bands = AGE_BANDS.map((band) => {
    const inBand = rows.filter((r) => bandOf(r.age) === band);
    return {
      band,
      players: inBand.length,
      starters: inBand.filter((r) => r.starter).length,
      spend: inBand.reduce((a, r) => a + r.hit, 0),
      avgOvr: inBand.length ? inBand.reduce((a, r) => a + r.ovr, 0) / inBand.length : 0,
    };
  });

  const starters = rows.filter((r) => r.starter);
  return {
    bands,
    cliff: {
      startersOver30: starters.filter((r) => r.age >= CLIFF_AGE).length,
      startersOver30InTwo: starters.filter((r) => r.age + 2 >= CLIFF_AGE).length,
      starterSpendOver30InTwo: starters.filter((r) => r.age + 2 >= CLIFF_AGE).reduce((a, r) => a + r.hit, 0),
      startersSignedPastTwo: starters.filter((r) => r.yearsRemaining > 2).length,
      rosterSignedPastTwo: rows.filter((r) => r.yearsRemaining > 2).length,
      starterCount: starters.length,
    },
  };
}

export interface DraftPickRow {
  year: number;
  round: number;
  slot: number;
  playerId: string;
  name: string;
  position: string;
  ovr: number;
  age: number;
  /** Still on this club's roster. A pick who left is a real category, not a hidden one. */
  stillHere: boolean;
  starter: boolean;
}

export interface DraftRoundBand {
  round: number;
  picks: DraftPickRow[];
  /** Null for a round this front office has never picked in — drawn as a gap, not a zero. */
  meanOvr: number | null;
  starters: number;
}

export function buildDraftReturn(picks: DraftPickRow[], rounds: number): DraftRoundBand[] {
  return Array.from({ length: rounds }, (_, i) => i + 1).map((round) => {
    const inRound = picks.filter((p) => p.round === round);
    return {
      round,
      picks: inRound,
      meanOvr: inRound.length ? inRound.reduce((a, p) => a + p.ovr, 0) / inRound.length : null,
      starters: inRound.filter((p) => p.starter).length,
    };
  });
}

// ---------------------------------------------------------------------------
// THE ADVANCED VIEW — drive efficiency and per-play efficiency
// ---------------------------------------------------------------------------
// Everything below is computed from what the sim already stores: DriveResult
// rows inside Game.boxScore, and the per-player BoxLine stats those same box
// scores carry.
//
// WHAT IS DELIBERATELY ABSENT. A stored drive is
// `{ team, result, points, plays, yards }` — there is no down, no distance and
// no field position. So expected points added, success rate, red-zone
// efficiency and third-and-long conversion are not computable, and nothing
// here is named after them or approximated in their place. Drive `yards` is
// what the drive GAINED, not where it started, so "scoring rate by starting
// field position" is not computable either. Points per drive, scoring rate,
// three-and-out rate and the rest below are the real front-office measures
// this data does support.
// ---------------------------------------------------------------------------

/** One club's drives, both the ones it ran and the ones it faced. */
export interface DriveAgg {
  /** Drives that had a chance to score — END_HALF excluded, see below. */
  drives: number;
  points: number;
  tds: number;
  fgs: number;
  puntsOrDowns: number;
  turnovers: number;
  /** Drives the clock ended. Counted, never used as a denominator. */
  clockOuts: number;
  yards: number;
  plays: number;
  /** A punt or a turnover on downs inside three plays. */
  threeAndOuts: number;
}

export function blankDriveAgg(): DriveAgg {
  return { drives: 0, points: 0, tds: 0, fgs: 0, puntsOrDowns: 0, turnovers: 0, clockOuts: 0, yards: 0, plays: 0, threeAndOuts: 0 };
}

/**
 * Fold one stored drive into a club's aggregate.
 *
 * A drive the clock ended is counted separately and kept out of every
 * denominator: it never had the chance to score, so including it would drag
 * every club's scoring rate down by however many halves ended on their
 * possession — an artefact of the clock, not of the offence.
 */
export function addDrive(agg: DriveAgg, d: { result: string; points: number; plays: number; yards: number }): void {
  if (d.result === 'END_HALF') {
    agg.clockOuts++;
    return;
  }
  agg.drives++;
  agg.points += d.points;
  agg.yards += d.yards;
  agg.plays += d.plays;
  if (d.result === 'TD') agg.tds++;
  else if (d.result === 'FG') agg.fgs++;
  else if (d.result === 'TURNOVER') agg.turnovers++;
  else agg.puntsOrDowns++;
  // Three plays and out. The sim gives no down or distance, so this is the
  // literal reading: the possession ended without a score inside three plays.
  if ((d.result === 'PUNT' || d.result === 'DOWNS') && d.plays <= 3) agg.threeAndOuts++;
}

export interface LeagueMetric {
  key: string;
  label: string;
  /** Suffix printed after the number — "/drive", "%", "" … */
  unit: string;
  decimals: number;
  better: 'high' | 'low';
  /** One sentence saying exactly what the number counts. Rendered as the tooltip. */
  definition: string;
  value: number;
  rank: number;
  clubs: number;
  leagueMean: number;
  leagueMin: number;
  leagueMax: number;
  /** Every club's value, for the distribution strip behind the marker. */
  all: number[];
}

const safeDiv = (a: number, b: number) => (b > 0 ? a / b : 0);

/**
 * Ten drive-level measures, each ranked across every club that has played.
 *
 * A rank with no spread behind it is a lying metric — "17th of 32" says
 * nothing until you can see that the whole league sits inside a tenth of a
 * point per drive. So every measure carries the full distribution.
 */
export function buildDriveMetrics(
  offense: Map<string, DriveAgg>,
  defense: Map<string, DriveAgg>,
  teamId: string,
): LeagueMetric[] {
  const ids = [...offense.keys()].filter((id) => (offense.get(id)?.drives ?? 0) > 0);
  if (!ids.includes(teamId)) return [];

  const defs: { key: string; label: string; unit: string; decimals: number; better: 'high' | 'low'; definition: string; of: (o: DriveAgg, d: DriveAgg) => number }[] = [
    { key: 'ppd', label: 'Points per drive', unit: '', decimals: 2, better: 'high', definition: 'Points scored divided by drives run, excluding drives the clock ended.', of: (o) => safeDiv(o.points, o.drives) },
    { key: 'ppdAllowed', label: 'Points per drive allowed', unit: '', decimals: 2, better: 'low', definition: 'Points the defence gave up divided by the drives it faced.', of: (_o, d) => safeDiv(d.points, d.drives) },
    { key: 'ppdNet', label: 'Net points per drive', unit: '', decimals: 2, better: 'high', definition: 'Points per drive minus points per drive allowed — the whole club in one number.', of: (o, d) => safeDiv(o.points, o.drives) - safeDiv(d.points, d.drives) },
    { key: 'scoreRate', label: 'Drives ending in points', unit: '%', decimals: 1, better: 'high', definition: 'Share of drives that finished with a touchdown or a field goal.', of: (o) => 100 * safeDiv(o.tds + o.fgs, o.drives) },
    { key: 'tdRate', label: 'Touchdown rate per drive', unit: '%', decimals: 1, better: 'high', definition: 'Share of drives that finished in the end zone.', of: (o) => 100 * safeDiv(o.tds, o.drives) },
    { key: 'threeOut', label: 'Three-and-out rate', unit: '%', decimals: 1, better: 'low', definition: 'Share of drives that ended in a punt or on downs inside three plays.', of: (o) => 100 * safeDiv(o.threeAndOuts, o.drives) },
    { key: 'toRate', label: 'Turnovers per drive', unit: '%', decimals: 1, better: 'low', definition: 'Share of drives that ended in a turnover.', of: (o) => 100 * safeDiv(o.turnovers, o.drives) },
    { key: 'ypd', label: 'Yards per drive', unit: '', decimals: 1, better: 'high', definition: 'Yards gained divided by drives run.', of: (o) => safeDiv(o.yards, o.drives) },
    { key: 'ypp', label: 'Yards per play', unit: '', decimals: 2, better: 'high', definition: 'Drive yards divided by drive plays — the sim counts both on every possession.', of: (o) => safeDiv(o.yards, o.plays) },
    { key: 'stopRate', label: 'Drives stopped without points', unit: '%', decimals: 1, better: 'high', definition: 'Share of the drives this defence faced that ended without a score.', of: (_o, d) => 100 * safeDiv(d.drives - d.tds - d.fgs, d.drives) },
  ];

  return defs.map((m) => {
    const vals = ids.map((id) => ({ id, v: m.of(offense.get(id) ?? blankDriveAgg(), defense.get(id) ?? blankDriveAgg()) }));
    const sorted = [...vals].sort((a, b) => (m.better === 'high' ? b.v - a.v : a.v - b.v));
    const mine = vals.find((v) => v.id === teamId)!;
    return {
      key: m.key, label: m.label, unit: m.unit, decimals: m.decimals, better: m.better, definition: m.definition,
      value: mine.v,
      rank: sorted.findIndex((v) => v.id === teamId) + 1,
      clubs: ids.length,
      leagueMean: vals.reduce((a, v) => a + v.v, 0) / vals.length,
      leagueMin: Math.min(...vals.map((v) => v.v)),
      leagueMax: Math.max(...vals.map((v) => v.v)),
      all: vals.map((v) => v.v),
    };
  });
}

// --- Per-play efficiency ----------------------------------------------------

/**
 * The NFL passer rating, exactly as the league defines it. Included because it
 * is a real, published formula with fixed constants — not a weighting invented
 * for this screen.
 */
export function passerRating(s: { passAtt?: number; passCmp?: number; passYds?: number; passTd?: number; int?: number }): number | null {
  const att = s.passAtt ?? 0;
  if (att <= 0) return null;
  const cl = (v: number) => Math.max(0, Math.min(2.375, v));
  const a = cl(((s.passCmp ?? 0) / att - 0.3) * 5);
  const b = cl(((s.passYds ?? 0) / att - 3) * 0.25);
  const c = cl(((s.passTd ?? 0) / att) * 20);
  const d = cl(2.375 - ((s.int ?? 0) / att) * 25);
  return ((a + b + c + d) / 6) * 100;
}

export interface PlayerRate {
  playerId: string;
  name: string;
  position: string;
  teamId: string | null;
  teamAbbr: string;
  gp: number;
  /** The measured rate. */
  value: number;
  /** The volume it was measured over — the reason a qualifier exists at all. */
  volume: number;
  /** 0-100 among every qualifying player at the same position. */
  percentile: number;
  rank: number;
  qualified: number;
}

export interface RateBoard {
  key: string;
  label: string;
  unit: string;
  decimals: number;
  better: 'high' | 'low';
  /** Which positions it is measured over, and what qualifies. */
  scope: string;
  definition: string;
  /** Every qualifying player league-wide, for the distribution behind the marks. */
  league: number[];
  /** This club's qualifying players at the measure, best first. */
  mine: PlayerRate[];
  /** The league leader, so the club's number has somebody to be compared to. */
  leader: PlayerRate | null;
  leagueMean: number;
}

/**
 * Per-play efficiency, from the stat lines the box score already writes.
 *
 * These are RATES, so they need a volume qualifier or the leaderboard fills up
 * with a receiver who caught his only target. The qualifier scales with how
 * much of the season has been played, so week 4 does not need a full year's
 * attempts, and it is stated on the page rather than hidden in here.
 */
export function buildRateBoards(
  players: {
    playerId: string; name: string; position: string; teamId: string | null; teamAbbr: string;
    gp: number; stats: { passAtt?: number; passCmp?: number; passYds?: number; passTd?: number; int?: number; rushAtt?: number; rushYds?: number; rec?: number; recYds?: number; targets?: number };
  }[],
  myTeamId: string,
  /** Games the average club has played — what the volume qualifier scales on. */
  gamesPlayed: number,
  seasonLength: number,
): RateBoard[] {
  // [TUNE] Volume needed over a full season, scaled down to the games actually
  // played. The floors keep a two-week sample from producing a leaderboard.
  const scale = Math.max(0.15, Math.min(1, gamesPlayed / Math.max(1, seasonLength)));
  const minPass = Math.max(20, Math.round(150 * scale));
  const minRush = Math.max(12, Math.round(60 * scale));
  const minTgt = Math.max(8, Math.round(40 * scale));

  const defs: {
    key: string; label: string; unit: string; decimals: number; better: 'high' | 'low';
    scope: string; definition: string;
    minVolume: number;
    volume: (s: PlayerLike) => number;
    positions: (p: string) => boolean;
    of: (s: PlayerLike) => number | null;
  }[] = [
    {
      key: 'ya', label: 'Yards per attempt', unit: '', decimals: 2, better: 'high',
      scope: `quarterbacks, ${minPass}+ attempts`, definition: 'Passing yards divided by pass attempts. The single most predictive passing rate there is.',
      minVolume: minPass, volume: (s) => s.passAtt ?? 0, positions: (p) => p === 'QB',
      of: (s) => ((s.passAtt ?? 0) > 0 ? (s.passYds ?? 0) / (s.passAtt ?? 1) : null),
    },
    {
      key: 'cmpPct', label: 'Completion rate', unit: '%', decimals: 1, better: 'high',
      scope: `quarterbacks, ${minPass}+ attempts`, definition: 'Completions divided by attempts.',
      minVolume: minPass, volume: (s) => s.passAtt ?? 0, positions: (p) => p === 'QB',
      of: (s) => ((s.passAtt ?? 0) > 0 ? (100 * (s.passCmp ?? 0)) / (s.passAtt ?? 1) : null),
    },
    {
      key: 'rating', label: 'Passer rating', unit: '', decimals: 1, better: 'high',
      scope: `quarterbacks, ${minPass}+ attempts`, definition: 'The NFL passer rating formula, unchanged — completions, yards, touchdowns and interceptions per attempt.',
      minVolume: minPass, volume: (s) => s.passAtt ?? 0, positions: (p) => p === 'QB',
      of: (s) => passerRating(s),
    },
    {
      key: 'tdPct', label: 'Touchdown rate', unit: '%', decimals: 1, better: 'high',
      scope: `quarterbacks, ${minPass}+ attempts`, definition: 'Touchdown passes as a share of attempts.',
      minVolume: minPass, volume: (s) => s.passAtt ?? 0, positions: (p) => p === 'QB',
      of: (s) => ((s.passAtt ?? 0) > 0 ? (100 * (s.passTd ?? 0)) / (s.passAtt ?? 1) : null),
    },
    {
      key: 'intPct', label: 'Interception rate', unit: '%', decimals: 1, better: 'low',
      scope: `quarterbacks, ${minPass}+ attempts`, definition: 'Interceptions as a share of attempts. Lower is better.',
      minVolume: minPass, volume: (s) => s.passAtt ?? 0, positions: (p) => p === 'QB',
      of: (s) => ((s.passAtt ?? 0) > 0 ? (100 * (s.int ?? 0)) / (s.passAtt ?? 1) : null),
    },
    {
      key: 'ypc', label: 'Yards per carry', unit: '', decimals: 2, better: 'high',
      scope: `running backs, ${minRush}+ carries`, definition: 'Rushing yards divided by carries.',
      minVolume: minRush, volume: (s) => s.rushAtt ?? 0, positions: (p) => p === 'RB',
      of: (s) => ((s.rushAtt ?? 0) > 0 ? (s.rushYds ?? 0) / (s.rushAtt ?? 1) : null),
    },
    {
      key: 'ypt', label: 'Yards per touch', unit: '', decimals: 2, better: 'high',
      scope: `running backs, ${minRush}+ touches`, definition: 'Rushing and receiving yards divided by carries plus catches — the whole workload, not just the handoffs.',
      minVolume: minRush, volume: (s) => (s.rushAtt ?? 0) + (s.rec ?? 0), positions: (p) => p === 'RB',
      of: (s) => {
        const touches = (s.rushAtt ?? 0) + (s.rec ?? 0);
        return touches > 0 ? ((s.rushYds ?? 0) + (s.recYds ?? 0)) / touches : null;
      },
    },
    {
      key: 'catchRate', label: 'Catch rate', unit: '%', decimals: 1, better: 'high',
      scope: `receivers and tight ends, ${minTgt}+ targets`, definition: 'Receptions divided by targets.',
      minVolume: minTgt, volume: (s) => s.targets ?? 0, positions: (p) => p === 'WR' || p === 'TE',
      of: (s) => ((s.targets ?? 0) > 0 ? (100 * (s.rec ?? 0)) / (s.targets ?? 1) : null),
    },
    {
      key: 'ypr', label: 'Yards per reception', unit: '', decimals: 2, better: 'high',
      scope: `receivers and tight ends, ${minTgt}+ targets`, definition: 'Receiving yards divided by catches — how far the ball travels when it is caught.',
      minVolume: minTgt, volume: (s) => s.targets ?? 0, positions: (p) => p === 'WR' || p === 'TE',
      of: (s) => ((s.rec ?? 0) > 0 ? (s.recYds ?? 0) / (s.rec ?? 1) : null),
    },
    {
      key: 'ypTgt', label: 'Yards per target', unit: '', decimals: 2, better: 'high',
      scope: `receivers and tight ends, ${minTgt}+ targets`, definition: 'Receiving yards divided by targets — catch rate and yards per catch in one number.',
      minVolume: minTgt, volume: (s) => s.targets ?? 0, positions: (p) => p === 'WR' || p === 'TE',
      of: (s) => ((s.targets ?? 0) > 0 ? (s.recYds ?? 0) / (s.targets ?? 1) : null),
    },
  ];

  return defs.map((m) => {
    const pool = players
      .filter((p) => m.positions(p.position))
      .map((p) => ({ p, volume: m.volume(p.stats), value: m.of(p.stats) }))
      .filter((r): r is { p: (typeof players)[number]; volume: number; value: number } => r.value !== null && r.volume >= m.minVolume);

    const sorted = [...pool].sort((a, b) => (m.better === 'high' ? b.value - a.value : a.value - b.value));
    const toRate = (r: (typeof pool)[number]): PlayerRate => {
      const rank = sorted.findIndex((x) => x.p.playerId === r.p.playerId) + 1;
      return {
        playerId: r.p.playerId, name: r.p.name, position: r.p.position,
        teamId: r.p.teamId, teamAbbr: r.p.teamAbbr, gp: r.p.gp,
        value: r.value, volume: r.volume,
        percentile: sorted.length > 1 ? (100 * (sorted.length - rank)) / (sorted.length - 1) : 100,
        rank, qualified: sorted.length,
      };
    };

    const mine = sorted.filter((r) => r.p.teamId === myTeamId).map(toRate);
    return {
      key: m.key, label: m.label, unit: m.unit, decimals: m.decimals, better: m.better,
      scope: m.scope, definition: m.definition,
      league: sorted.map((r) => r.value),
      mine,
      leader: sorted.length ? toRate(sorted[0]) : null,
      leagueMean: sorted.length ? sorted.reduce((a, r) => a + r.value, 0) / sorted.length : 0,
    };
  });
}

type PlayerLike = { passAtt?: number; passCmp?: number; passYds?: number; passTd?: number; int?: number; rushAtt?: number; rushYds?: number; rec?: number; recYds?: number; targets?: number };
