import { prisma } from './db';
import { POSITION_GROUPS, PositionGroup } from './positionGroups';
import { slotsInOrder, starterSlots, fieldedByPosition } from './lineup';
import { Position } from './tuning';

/**
 * A single number for how good a roster is, plus the units that produced it.
 *
 * Nothing in this project computed one before, which is why
 * `estimateWinProbability` — which takes `myOverall`/`oppOverall` — had no
 * caller that could supply them, and why the schedule page had to fall back
 * to showing an opponent's point differential instead of a real win chance.
 *
 * Three rules make the number honest:
 *
 * It averages only the players who actually take the field at each unit, not
 * the whole group. A team is not worse at receiver for carrying a seventh one,
 * and a group mean says it is.
 *
 * It averages the men the club ACTUALLY FIELDS — the depth chart's order, with
 * the unavailable dropped first — and not the best men on the roster. This
 * rule is new, and it is new because the sim changed underneath it. The engine
 * used to re-sort every position group by rating before it scored anything, so
 * "best available" and "who plays" were the same set and nothing on screen
 * could contradict anything else. `positionUnitRating` (lib/sim/units.ts) does
 * not re-sort any more: the man the GM names is the man the simulation uses.
 * A Team Rating still built from the best available would therefore describe a
 * lineup that never takes the field — which is this codebase's cardinal
 * defect, a number that disagrees with the simulation it claims to describe,
 * and it would have been introduced by fixing the engine rather than found.
 * Measured over all 9,536 clubs in the database at the moment this landed, the
 * old arithmetic and this one disagree for 44.5% of them, by up to 9.618
 * rating points; run through `buildLeagueRatings` on both sides over 1,280
 * clubs in 40 leagues, the printed integer changes for 24.8% of them, mean
 * -0.35 and worst -7, and it never goes UP — you cannot field your named
 * order and also field the best men. The ordering is not restated here:
 * `fieldedByPosition` in lib/lineup.ts calls the sim's own `isAvailable` and
 * `mergeUnnamed`.
 *
 * Units are weighted by how much they actually decide games. A quarterback is
 * not one twenty-second of a football team, and a flat average across the
 * roster produces a rating where an elite quarterback is worth the same as an
 * elite punter — which is exactly the sort of plausible-looking number this
 * project has shipped before and had to go back and fix.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS NUMBER IS STILL NOT, SAID PLAINLY
 * ---------------------------------------------------------------------------
 * It is not `computeUnits`'s `off`/`def`, and it cannot be. Those carry
 * coordinator and head-coach bonuses and SIM.OFFENSE_BASELINE, and they are
 * paid out against UNIT_DEPTH_WEIGHTS, which reaches further down a group than
 * the starting eleven does — four receivers, four edge rushers, three
 * linebackers. This rates the ELEVEN (`STARTERS_AT_POSITION`, 11 personnel and
 * nickel), on the 0-99 scale the player ratings printed beside it use.
 *
 * So the two are different SCOPES, and the honest claim is that they move
 * together rather than that they are equal. Measured by walking every club in
 * the database and giving each its own chart against a best-available one:
 *
 *   the engine responds to the chart          43.9% of clubs   (n=9,888)
 *   this number responds, unrounded           30.6%
 *   the PRINTED INTEGER responds               6.1%   — Math.round eats the rest
 *   engine responds, this stays flat          13.2%   — the slot-sample gap
 *   both respond and the signs agree      3,026 / 3,027        (n=10,080)
 *
 * The one club in ten thousand that moves the other way is understood and is
 * the fatigue line below: two quarterbacks tied at 75 `trueOvr`, one of them
 * carrying more fatigue, so the engine reads the club's named order as better
 * by 0.80 at quarterback while this file — reading `trueOvr` — sees a tie, and
 * a real one-point difference at WR3 decides the sign. That is the documented
 * trade being visible, not a defect.
 *
 * The 13.2% is every change at a slot below the starting eleven: the engine
 * weights a fourth receiver, a fourth edge rusher and a third linebacker and
 * the lineup does not. It is a difference in what the two are counting, stated
 * here rather than hidden — this says "your twenty-two average X" and that is
 * exactly true. Closing it would mean rating the club on UNIT_DEPTH_WEIGHTS,
 * which re-scales every rating in the app for every club including the ones
 * with no depth chart at all. See the matching note on `positionUnitRating`.
 */

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
 *
 * IT IS A FLOOR, AND A MAN CAN BE BELOW IT. Since injuries started reaching
 * this number, losing a player rated under 52 leaves an empty slot worth 52 and
 * the unit therefore reads very slightly BETTER with him hurt. Measured over
 * all 9,888 clubs in the database, that happens to 2 of them, by 0.09 and 0.045
 * rating points — against 2,420 clubs where an injury correctly costs them, a
 * mean of 0.903 points. It is left alone deliberately: the alternative is to
 * say a sub-replacement player is worth more than the man off the street, which
 * is a claim about football this file has no business making, and moving the
 * constant re-scales every rating in the app. Written down because it is the
 * kind of thing that reads as a bug when you find it in a save.
 */
const REPLACEMENT_LEVEL = 52;

function weightedSubset(byGroup: Map<PositionGroup, number>, groups: PositionGroup[]): number {
  const total = groups.reduce((s, g) => s + UNIT_WEIGHT[g], 0);
  if (total === 0) return 0;
  return groups.reduce((s, g) => s + (byGroup.get(g) ?? 0) * UNIT_WEIGHT[g], 0) / total;
}

/**
 * THE OVERALL, AS A PURE FUNCTION OF WHO IS ON THE ROSTER.
 *
 * Split out of buildLeagueRatings so the number can be computed BEFORE the
 * players exist in the database — lib/gen/league.ts needs it at generation
 * time, to confirm the club it is dealing a REBUILD save is genuinely the
 * worst in its league before it writes anything.
 *
 * It is a split, not a copy. `buildLeagueRatings` calls these two, so there is
 * exactly one definition of what a club's overall is; a generator checking a
 * rank against arithmetic that had drifted from the dashboard's would be
 * guaranteeing something nobody can see.
 */
export function unitAveragesFrom(
  orderedOvrsAt: (position: Position) => number[],
): Map<PositionGroup, number> {
  const byGroup = new Map<PositionGroup, number>();
  for (const g of POSITION_GROUPS) {
    const slots = slotsInOrder(orderedOvrsAt, g, REPLACEMENT_LEVEL);
    byGroup.set(g, slots.length === 0 ? 0 : slots.reduce((s, v) => s + v, 0) / slots.length);
  }
  return byGroup;
}

export function overallFromUnits(byGroup: Map<PositionGroup, number>): number {
  return POSITION_GROUPS.reduce((s, g) => s + (byGroup.get(g) ?? 0) * UNIT_WEIGHT[g], 0) / WEIGHT_TOTAL;
}

/**
 * The whole computation, from a roster's ratings to the number on the card —
 * BEST-FIRST, for the one caller that has no lineup to read.
 *
 * lib/gen/league.ts calls this while it is still deciding what rosters to
 * write, so there are no players in the database and no `DepthChartSlot` row
 * has ever existed for these clubs. "Who would this club field" has no answer
 * yet; "how good is this roster" does, and that is the question the rebuild
 * guarantee is actually asking. `starterSlots` is the same slice and the same
 * padding as `slotsInOrder` with a sort in front of it, so this is not a second
 * definition of the rating — it is the same one, handed the only order that
 * exists at generation time.
 */
export function teamOverallFrom(ovrsAt: (position: Position) => number[]): number {
  const byGroup = new Map<PositionGroup, number>();
  for (const g of POSITION_GROUPS) {
    const slots = starterSlots(ovrsAt, g, REPLACEMENT_LEVEL);
    byGroup.set(g, slots.length === 0 ? 0 : slots.reduce((s, v) => s + v, 0) / slots.length);
  }
  return overallFromUnits(byGroup);
}

/**
 * Rates every team in the league in one pass. Always league-wide, because a
 * rating without a rank is far less useful — "78 overall" means nothing until
 * you know it is 4th.
 */
export async function buildLeagueRatings(leagueId: string): Promise<Map<string, TeamRating>> {
  const [teams, players, slots] = await Promise.all([
    prisma.team.findMany({
      where: { leagueId },
      select: { id: true, abbr: true, conference: true, division: true },
    }),
    // `id`, `injuryWeeks` and `fatigue` are here because the lineup rules read
    // them: the id to match a depth-chart row, the other two to decide who can
    // play and where an unnamed man slots in. `trueAttrs` is deliberately NOT
    // selected — see `Fieldable` in lib/lineup.ts for why this query does not
    // pull a JSON blob per player on every dashboard render.
    prisma.player.findMany({
      where: { leagueId, teamId: { not: null }, status: 'ACTIVE' },
      select: { id: true, teamId: true, position: true, trueOvr: true, status: true, injuryWeeks: true, fatigue: true },
    }),
    // The order the GM named, exactly as lib/season.ts hands it to the engine:
    // rank-ascending rows, collected per team and position.
    prisma.depthChartSlot.findMany({
      where: { team: { leagueId } },
      orderBy: { rank: 'asc' },
      select: { teamId: true, position: true, playerId: true },
    }),
  ]);

  /**
   * Keyed by POSITION, not by group — and that is the whole correctness of
   * this function.
   *
   * It used to bucket straight into groups and take the best five of ten
   * offensive linemen, which rates a club with two good right tackles and a
   * poor left tackle EXACTLY the same as one with a tackle on each side. That
   * is not a rounding difference: it is the rating being blind to the specific
   * problem the app owner reported — *"if someone has two solid RT and a weak
   * LT, they can't swap the spare RT over"* — so the fix he asked for would
   * have moved no number on any screen, and the man on the field at left
   * tackle was never in the average at all.
   *
   * lib/lineup.ts has carried the per-position version (`slotsInOrder`, and
   * `starterSlots` in front of it) since the twelve-man-defence cleanup, and
   * its docstring names this file's group-level shortcut as the thing it
   * replaces. It is now actually replaced.
   *
   * AND THE ELEVEN ARE NOW THE SAME ELEVEN, which this comment claimed before
   * it was true. Keying by position fixed WHICH SLOTS get averaged; it did
   * nothing about WHICH MEN filled them, and the men were still whoever rated
   * highest. A GM who benched his best quarterback saw the depth chart obey him
   * and this number ignore him. `fieldedByPosition` below closes it.
   */
  const rosterByTeam = new Map<string, typeof players>();
  for (const p of players) (rosterByTeam.get(p.teamId!) ?? rosterByTeam.set(p.teamId!, []).get(p.teamId!)!).push(p);
  const chartByTeam = new Map<string, Record<string, string[]>>();
  for (const s of slots) {
    const d = chartByTeam.get(s.teamId) ?? chartByTeam.set(s.teamId, {}).get(s.teamId)!;
    (d[s.position] ??= []).push(s.playerId);
  }

  /**
   * The ratings of the men each club actually FIELDS, per position, in the
   * order it plays them — `fieldedByPosition` in lib/lineup.ts, which is the
   * sim's own `isAvailable` + `mergeUnnamed` and not a second opinion about
   * either. Every club is ordered once here and the number below is read off
   * that, so what this function averages and what `computeUnits` plays are the
   * same men in the same order.
   *
   * WHAT IS STILL AVERAGED IS `trueOvr`, NOT `effectiveRating`. The sim docks a
   * tired player up to four points and this does not, because every rating
   * beside this one on every screen is a `trueOvr` and a team number that
   * quietly included fatigue would not add up against the players it is drawn
   * from. It costs almost nothing to leave out: across 441,575 men in the
   * database, mean fatigue is 1.11 and the median is 0. Fatigue is a
   * within-game state, and this is a roster figure.
   */
  const fieldedByTeam = new Map<string, Record<string, typeof players>>();
  for (const t of teams) {
    fieldedByTeam.set(t.id, fieldedByPosition(rosterByTeam.get(t.id) ?? [], chartByTeam.get(t.id)));
  }

  const draft = teams.map((t) => {
    const fielded = fieldedByTeam.get(t.id) ?? {};
    const ovrsAt = (pos: Position) => (fielded[pos] ?? []).map((p) => p.trueOvr);
    const byGroup = unitAveragesFrom(ovrsAt);
    const overall = overallFromUnits(byGroup);
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
