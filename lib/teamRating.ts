import { prisma } from './db';
import { POSITION_GROUPS, PositionGroup, positionGroup } from './positionGroups';
import { STARTERS_AT_GROUP } from './lineup';

/**
 * A single number for how good a roster is, plus the units that produced it.
 *
 * Nothing in this project computed one before, which is why
 * `estimateWinProbability` — which takes `myOverall`/`oppOverall` — had no
 * caller that could supply them, and why the schedule page had to fall back
 * to showing an opponent's point differential instead of a real win chance.
 *
 * Two rules make the number honest:
 *
 * It averages only the players who actually take the field at each unit, not
 * the whole group. A team is not worse at receiver for carrying a seventh one,
 * and a group mean says it is.
 *
 * Units are weighted by how much they actually decide games. A quarterback is
 * not one twenty-second of a football team, and a flat average across the
 * roster produces a rating where an elite quarterback is worth the same as an
 * elite punter — which is exactly the sort of plausible-looking number this
 * project has shipped before and had to go back and fix.
 */

/**
 * How many at each unit are on the field — IMPORTED, not typed out again.
 *
 * This file kept its own copy, and the copy had drifted: `DL 4, LB 3, DB 5`
 * is TWELVE men on defence. lib/lineup.ts derives the real answer from the
 * per-position starting eleven (`DL 4, LB 2, DB 5`), and its own docstring
 * already claimed this duplicate had been removed in favour of it — a comment
 * describing a cleanup that never landed, which is the same defect class as a
 * wrong number on screen. So every unit rating in the app was averaging the
 * top THREE linebackers when two start, flattering deep linebacker groups and
 * punishing thin ones, on every screen that reads a team rating.
 */
const STARTERS_AT: Record<PositionGroup, number> = STARTERS_AT_GROUP;

/**
 * [TUNE] Share of team quality each unit carries. Normalised at load, so
 * these can be edited freely without having to make them sum to exactly 1.
 * Quarterback dominance is deliberate and matches how the sport actually
 * works; special teams is small but non-zero because a kicker genuinely
 * decides a couple of games a year.
 */
const UNIT_WEIGHT: Record<PositionGroup, number> = {
  QB: 0.20, RB: 0.05, WR: 0.09, TE: 0.03, OL: 0.13,
  DL: 0.18, LB: 0.09, DB: 0.17,
  ST: 0.06,
};

const OFFENSE: PositionGroup[] = ['QB', 'RB', 'WR', 'TE', 'OL'];
const DEFENSE: PositionGroup[] = ['DL', 'LB', 'DB'];

const WEIGHT_TOTAL = POSITION_GROUPS.reduce((s, g) => s + UNIT_WEIGHT[g], 0);

export interface UnitRating {
  group: PositionGroup;
  /** Starter-average rating at this unit, 0-99. */
  rating: number;
  /** Share of the team rating this unit carries, 0..1. */
  weight: number;
  /** 1-32 across the league at this unit. */
  rank: number;
}

export interface TeamRating {
  teamId: string;
  abbr: string;
  /** 0-99, weighted across every unit. */
  overall: number;
  offense: number;
  defense: number;
  specialTeams: number;
  units: UnitRating[];
  /** 1-32 league-wide. */
  rank: number;
  /** 1-N inside the team's own conference. */
  confRank: number;
  /** 1-4 inside the team's own division. */
  divRank: number;
  conference: string;
  division: string;
}

/**
 * [TUNE] What an unmanned unit rates. A team with no kicker does not field
 * nobody — it hands the job to a position player who is bad at it. Scoring an
 * empty unit as 0 made a roster gutted by cap cuts read as 58 overall with
 * special teams at literally zero, which is not what a team without a kicker
 * looks like. This is roughly practice-squad level.
 */
const REPLACEMENT_LEVEL = 52;

/**
 * Averages the top N at a unit, where N is how many actually play — a team is
 * not worse at receiver for carrying a seventh one, and a group mean says it
 * is. A unit thinner than its starter count is padded with replacement-level
 * bodies rather than averaging only who is there, so being two linemen short
 * is correctly worse than having exactly five.
 */
function starterAverage(ovrs: number[], group: PositionGroup): number {
  const n = STARTERS_AT[group] ?? 1;
  const top = [...ovrs].sort((a, b) => b - a).slice(0, n);
  while (top.length < n) top.push(REPLACEMENT_LEVEL);
  return top.reduce((s, v) => s + v, 0) / top.length;
}

function weightedSubset(byGroup: Map<PositionGroup, number>, groups: PositionGroup[]): number {
  const total = groups.reduce((s, g) => s + UNIT_WEIGHT[g], 0);
  if (total === 0) return 0;
  return groups.reduce((s, g) => s + (byGroup.get(g) ?? 0) * UNIT_WEIGHT[g], 0) / total;
}

/**
 * Rates every team in the league in one pass. Always league-wide, because a
 * rating without a rank is far less useful — "78 overall" means nothing until
 * you know it is 4th.
 */
export async function buildLeagueRatings(leagueId: string): Promise<Map<string, TeamRating>> {
  const [teams, players] = await Promise.all([
    prisma.team.findMany({
      where: { leagueId },
      select: { id: true, abbr: true, conference: true, division: true },
    }),
    prisma.player.findMany({
      where: { leagueId, teamId: { not: null }, status: 'ACTIVE' },
      select: { teamId: true, position: true, trueOvr: true },
    }),
  ]);

  const ovrsByTeamGroup = new Map<string, number[]>();
  for (const p of players) {
    const key = `${p.teamId}|${positionGroup(p.position)}`;
    const arr = ovrsByTeamGroup.get(key) ?? [];
    arr.push(p.trueOvr);
    ovrsByTeamGroup.set(key, arr);
  }

  const draft = teams.map((t) => {
    const byGroup = new Map<PositionGroup, number>();
    for (const g of POSITION_GROUPS) {
      byGroup.set(g, starterAverage(ovrsByTeamGroup.get(`${t.id}|${g}`) ?? [], g));
    }
    const overall = POSITION_GROUPS.reduce((s, g) => s + (byGroup.get(g) ?? 0) * UNIT_WEIGHT[g], 0) / WEIGHT_TOTAL;
    return {
      team: t,
      byGroup,
      overall,
      offense: weightedSubset(byGroup, OFFENSE),
      defense: weightedSubset(byGroup, DEFENSE),
      specialTeams: byGroup.get('ST') ?? 0,
    };
  });

  // Ranks are computed on the unrounded values, then the display value is
  // rounded — otherwise two teams that round to the same number get an
  // arbitrary ordering and the table looks broken.
  const byOverall = [...draft].sort((a, b) => b.overall - a.overall);
  const unitOrder = new Map<PositionGroup, string[]>();
  for (const g of POSITION_GROUPS) {
    unitOrder.set(g, [...draft].sort((a, b) => (b.byGroup.get(g) ?? 0) - (a.byGroup.get(g) ?? 0)).map((d) => d.team.id));
  }

  const out = new Map<string, TeamRating>();
  for (const d of draft) {
    const conf = byOverall.filter((x) => x.team.conference === d.team.conference);
    const div = conf.filter((x) => x.team.division === d.team.division);
    out.set(d.team.id, {
      teamId: d.team.id,
      abbr: d.team.abbr,
      overall: Math.round(d.overall),
      offense: Math.round(d.offense),
      defense: Math.round(d.defense),
      specialTeams: Math.round(d.specialTeams),
      units: POSITION_GROUPS.map((g) => ({
        group: g,
        rating: Math.round(d.byGroup.get(g) ?? 0),
        weight: UNIT_WEIGHT[g] / WEIGHT_TOTAL,
        rank: (unitOrder.get(g) ?? []).indexOf(d.team.id) + 1,
      })),
      rank: byOverall.findIndex((x) => x.team.id === d.team.id) + 1,
      confRank: conf.findIndex((x) => x.team.id === d.team.id) + 1,
      divRank: div.findIndex((x) => x.team.id === d.team.id) + 1,
      conference: d.team.conference,
      division: d.team.division,
    });
  }
  return out;
}

// --- Win probability, with its reasoning attached ---------------------------

export interface WinFactor {
  label: string;
  /** Percentage points this factor contributes. Signed. */
  points: number;
  detail: string;
}

export interface WinEstimate {
  /** 0-100. */
  percent: number;
  factors: WinFactor[];
}

/**
 * [TUNE] A rating point is worth this many percentage points of win
 * probability. Roughly calibrated so a 10-point roster gap makes a team a
 * ~2:1 favourite, which is about right for the sport.
 */
const POINTS_PER_RATING = 2.2;
/** [TUNE] Home advantage, in percentage points. ~2.5 rating points' worth. */
const HOME_FIELD = 5.5;
/** [TUNE] How much current form moves it, on top of the roster gap. */
const FORM_WEIGHT = 12;

/**
 * A win chance the user can argue with.
 *
 * The old estimate returned a bare number with no way to see where it came
 * from, so "32% Win" was something to accept rather than something to
 * understand. Returning the factors lets the UI justify itself — and makes a
 * wrong number obvious instead of merely surprising.
 */
export function estimateGameWinChance(opts: {
  me: TeamRating;
  opp: TeamRating;
  atHome: boolean;
  myRecord: { wins: number; losses: number; ties: number };
  oppRecord: { wins: number; losses: number; ties: number };
}): WinEstimate {
  const factors: WinFactor[] = [];

  const ratingGap = opts.me.overall - opts.opp.overall;
  factors.push({
    label: 'Roster',
    points: ratingGap * POINTS_PER_RATING,
    detail: `${opts.me.overall} overall vs ${opts.opp.overall}`,
  });

  // Broken out separately from the overall gap because "we're better but our
  // defence is the problem" is the most useful thing this panel can tell you,
  // and it is invisible in a single number.
  const offGap = opts.me.offense - opts.opp.defense;
  const defGap = opts.me.defense - opts.opp.offense;
  factors.push({
    label: 'Your offense vs their defense',
    points: offGap * POINTS_PER_RATING * 0.35,
    detail: `${opts.me.offense} against ${opts.opp.defense}`,
  });
  factors.push({
    label: 'Your defense vs their offense',
    points: defGap * POINTS_PER_RATING * 0.35,
    detail: `${opts.me.defense} against ${opts.opp.offense}`,
  });

  const pct = (r: { wins: number; losses: number; ties: number }) => {
    const played = r.wins + r.losses + r.ties;
    return played === 0 ? 0.5 : (r.wins + r.ties * 0.5) / played;
  };
  const formGap = pct(opts.myRecord) - pct(opts.oppRecord);
  const played = opts.myRecord.wins + opts.myRecord.losses + opts.myRecord.ties;
  if (played > 0) {
    factors.push({
      label: 'Form',
      points: formGap * FORM_WEIGHT,
      detail: `${opts.myRecord.wins}-${opts.myRecord.losses} against ${opts.oppRecord.wins}-${opts.oppRecord.losses}`,
    });
  }

  factors.push({
    label: opts.atHome ? 'Home field' : 'On the road',
    points: opts.atHome ? HOME_FIELD : -HOME_FIELD,
    detail: opts.atHome ? 'Playing at home' : 'Playing away',
  });

  const raw = 50 + factors.reduce((s, f) => s + f.points, 0);
  // Clamped: football does not produce 99% certainties, and a number that
  // reads 3% invites the user to skip a game the sim might well flip.
  const percent = Math.round(Math.min(92, Math.max(8, raw)));

  return { percent, factors };
}
