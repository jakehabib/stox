import { Rng, clamp } from '../rng';
import { SIM } from '../tuning';
import { LeagueSettings, DIFFICULTY_MODS } from '../settings';
import { BoxScore, BoxLine, DriveResult, SeasonStats, TeamGameStats } from '../types';
import { computeUnits, SimPlayer, SimStaff, UnitRatings, effectiveRating, isAvailable } from './units';
import { readJson } from '../json';
import { AttrMap } from '../ratings';

/** Injury flavor text, bucketed by how long it actually keeps someone out. [PLACEHOLDER copy] */
const INJURY_TYPES_SHORT = ['Bruised ribs', 'Ankle sprain', 'Concussion protocol', 'Shoulder stinger', 'Deep bruise'];
const INJURY_TYPES_MEDIUM = ['Hamstring strain', 'Groin strain', 'High ankle sprain', 'Fractured hand', 'MCL sprain'];
const INJURY_TYPES_LONG = ['Torn ACL', 'Achilles rupture', 'Fractured fibula', 'Torn labrum', 'Broken collarbone'];

function injuryTypesForSeverity(weeks: number): string[] {
  if (weeks <= 2) return INJURY_TYPES_SHORT;
  if (weeks <= 5) return INJURY_TYPES_MEDIUM;
  return INJURY_TYPES_LONG;
}

/**
 * ===========================================================================
 * GAME RESOLUTION (design doc section 9)
 * ===========================================================================
 * The sim is DRIVE-BASED, not play-based. Each team gets ~10 possessions —
 * see SIM.DRIVES_PER_TEAM for why that is ten and not the eleven a real team
 * takes the field for.
 * For every drive we roll an outcome from probabilities derived from the
 * matchup edge (this offense's unit score vs that defense's unit score),
 * then generate plays/yards consistent with the outcome so the box score adds
 * up. Individual stat lines are allocated from team totals by depth weight and
 * player rating.
 *
 * RNG enters at three levels, which is what keeps results football-shaped
 * rather than deterministic:
 *   1. GAME FORM   — one roll per team per game ("they came out flat")
 *   2. DRIVE NOISE — per-possession variance
 *   3. EVENT ROLLS — turnovers, TD-vs-FG, kick success, injuries
 *
 * settings.simVariance scales 1 and 2 together. At 0 the better team wins
 * almost every time; at 2 the league is chaos.
 * ===========================================================================
 */

export interface SimTeamInput {
  id: string;
  abbr: string;
  name: string;
  isUser: boolean;
  offScheme: string;
  defScheme: string;
  players: SimPlayer[];
  staff: SimStaff[];
  /** Optional user-set depth chart (position -> ordered player ids). */
  depthOrder?: Record<string, string[]>;
}

export interface GameResult {
  homeScore: number;
  awayScore: number;
  boxScore: BoxScore;
  injuries: { playerId: string; weeks: number; type: string }[];
  /** Fatigue delta to apply per player id. */
  fatigue: Record<string, number>;
}

const QUARTERS = 4;

export function simulateGame(
  home: SimTeamInput,
  away: SimTeamInput,
  settings: LeagueSettings,
  rng: Rng,
  opts: { neutralSite?: boolean; allowTie?: boolean } = {},
): GameResult {
  const variance = Math.max(0, settings.simVariance);
  const diff = DIFFICULTY_MODS[settings.difficulty];

  const homeUnits = computeUnits(home.players, home.staff, home.offScheme, home.defScheme, home.depthOrder);
  const awayUnits = computeUnits(away.players, away.staff, away.offScheme, away.defScheme, away.depthOrder);

  // Difficulty tilts every AI team, never the user's.
  const aiTilt = (t: SimTeamInput) => (t.isUser ? 0 : diff.aiUnitBonus);

  // (1) Game form — a single roll per team, applied to both of its units.
  const homeForm = rng.normal(0, SIM.GAME_FORM_SD * variance);
  const awayForm = rng.normal(0, SIM.GAME_FORM_SD * variance);

  const hfa = settings.homeFieldAdvantage && !opts.neutralSite ? SIM.HOME_FIELD_EDGE : 0;

  const homeOff = homeUnits.off + homeForm + hfa + aiTilt(home);
  const homeDef = homeUnits.def + homeForm + hfa * 0.5 + aiTilt(home);
  const awayOff = awayUnits.off + awayForm + aiTilt(away);
  const awayDef = awayUnits.def + awayForm + aiTilt(away);

  const drives: DriveResult[] = [];
  const quarters = { home: [0, 0, 0, 0], away: [0, 0, 0, 0] };
  const acc = {
    home: newAccumulator(),
    away: newAccumulator(),
  };

  const drivesPerTeam = SIM.DRIVES_PER_TEAM;
  for (let d = 0; d < drivesPerTeam; d++) {
    const quarter = clamp(Math.floor((d / drivesPerTeam) * QUARTERS), 0, QUARTERS - 1);
    // Away team receives the opening kickoff by convention.
    runDrive('away', awayOff, homeDef, quarter);
    runDrive('home', homeOff, awayDef, quarter);
  }

  function runDrive(side: 'home' | 'away', off: number, def: number, quarter: number) {
    const a = acc[side];
    const edge = off - def;

    // (2) Drive noise
    const noise = rng.normal(0, SIM.DRIVE_NOISE_SD * variance);
    const scoreProb = clamp(
      SIM.SCORING_DRIVE_BASE + edge * SIM.EDGE_TO_SCORE_PROB + noise * 0.05,
      0.04, 0.86,
    );
    const toProb = clamp(SIM.TURNOVER_RATE_BASE - edge * 0.0025, 0.02, 0.28);

    let result: DriveResult['result'];
    let points = 0;
    let yards: number;
    let plays: number;

    const roll = rng.next();
    if (roll < toProb) {
      result = 'TURNOVER';
      yards = Math.round(rng.normal(24, 16));
      // [TUNE] plays was rng.int(3, 7), a mean of 5. A drive that ends in a
      // giveaway is cut short by the giveaway — the pick or the strip is what
      // ends it, not a long grind — so it runs under the 5.6-play average
      // rather than over it. The 24-yard mean is right against a real ~26 and
      // is untouched.
      plays = rng.int(3, 6);
      a.turnovers += 1;
    } else if (roll < toProb + scoreProb) {
      const tdShare = clamp(SIM.TD_SHARE_BASE + edge * SIM.EDGE_TO_TD_SHARE, 0.22, 0.82);
      if (rng.bool(tdShare)) {
        result = 'TD';
        points = 6;
        yards = Math.round(rng.normal(66, 18));
        // [TUNE] plays was rng.int(6, 13), a mean of 9.5, on a drive that
        // really runs about seven snaps.
        //
        // THE CHECKABLE FIGURE IS THE TOTAL, not this line. An NFL team runs
        // about 62 offensive plays a game, of which ~2.3 are sacks this engine
        // counts separately and never puts in `own.plays` — so `own.plays`,
        // which is exactly passAtt + rushAtt, should come to about 60. It was
        // 75, and the surplus was spread across all five branches here. Over
        // this engine's 10 drives that is 6.0 a drive against the 6.8 it was
        // running; a touchdown drive is the longest kind and the most common
        // non-punt, so it carried the largest single share of it.
        //
        // The 66-yard mean beside it was already right and is untouched: a
        // drive starting at your own 28 has to cover that ground, and there is
        // no honest way to shorten a touchdown drive without moving the end
        // zone. That is why the yardage had to come off the punt branch below
        // and off the drive COUNT, not off this line.
        plays = rng.int(5, 10);
        a.td += 1;
        // Extra point (kicker accuracy nudges this). [TUNE] 96% baseline.
        const kicker = kickerRating(side === 'home' ? homeUnits : awayUnits);
        if (rng.bool(clamp(0.90 + (kicker - 60) * 0.0025, 0.85, 0.995))) {
          points += 1;
          a.xpm += 1;
        }
        a.xpa += 1;
      } else {
        result = 'FG';
        yards = Math.round(rng.normal(45, 16));
        // [TUNE] plays was rng.int(5, 11), a mean of 8. Same apportionment
        // as the touchdown branch above: a field-goal drive stops short of the
        // end zone by definition, so it is shorter in yards than a touchdown
        // drive and a little shorter in snaps. 6.5 against that branch's 7.5.
        plays = rng.int(4, 9);
        const kicker = kickerRating(side === 'home' ? homeUnits : awayUnits);
        a.fga += 1;
        // FG make probability by implied distance. [TUNE]
        if (rng.bool(clamp(0.72 + (kicker - 60) * 0.006, 0.55, 0.96))) {
          points = 3;
          a.fgm += 1;
        } else {
          result = 'DOWNS';
        }
      }
    } else if (rng.bool(0.12)) {
      result = 'DOWNS';
      yards = Math.round(rng.normal(34, 18));
      plays = rng.int(5, 10);
    } else {
      result = 'PUNT';
      // [TUNE] yards was rng.normal(19, 15). A punt drive is the one this
      // engine had badly wrong, and it is 41% of all drives so it carried the
      // surplus on its own. THE CHECKABLE FIGURE: an NFL team gains ~330 net
      // yards over ~11.2 drives, and once you subtract what its ~2.2 touchdown
      // drives (68 yards each) and ~1.6 field-goal drives (44) took, the ~4.5
      // drives it punts on are left with a little over a first down's worth of
      // ground apiece — about 13 yards. 12 rather than 13 because
      // `Math.max(-8, yards)` below clips the negative tail and lifts the
      // realised mean by roughly 0.7.
      yards = Math.round(rng.normal(12, 14));
      plays = rng.int(3, 7);
      a.punts += 1;
    }

    yards = Math.max(-8, yards);
    a.yards += yards;
    a.plays += plays;
    a.points += points;
    quarters[side][quarter] += points;
    drives.push({ team: side, result, points, plays, yards });
  }

  let homeScore = acc.home.points;
  let awayScore = acc.away.points;

  // Overtime: sudden-value drive-off. Ties are rare but possible.
  if (homeScore === awayScore) {
    if (!(opts.allowTie ?? true) || !rng.bool(SIM.OVERTIME_TIE_CHANCE)) {
      let guard = 0;
      while (homeScore === awayScore && guard++ < 6) {
        const homeOtValue = homeOff - awayDef + rng.normal(0, 6 * Math.max(0.2, variance));
        const awayOtValue = awayOff - homeDef + rng.normal(0, 6 * Math.max(0.2, variance));
        if (Math.abs(homeOtValue - awayOtValue) < 0.5) continue;
        const winner = homeOtValue > awayOtValue ? 'home' : 'away';
        const pts = rng.bool(0.55) ? 3 : 7;
        if (winner === 'home') { homeScore += pts; acc.home.points += pts; quarters.home[3] += pts; }
        else { awayScore += pts; acc.away.points += pts; quarters.away[3] += pts; }
        drives.push({ team: winner, result: pts === 7 ? 'TD' : 'FG', points: pts, plays: 8, yards: 55 });
      }
    }
  }

  // Sacks are a defensive stat derived from the opposing pass rush edge.
  acc.home.sacksTaken = Math.max(0, Math.round(rng.normal(SACKS_PER_GAME + (awayUnits.byPosition.EDGE - homeUnits.byPosition.LT) * 0.04, 1.3)));
  acc.away.sacksTaken = Math.max(0, Math.round(rng.normal(SACKS_PER_GAME + (homeUnits.byPosition.EDGE - awayUnits.byPosition.RT) * 0.04, 1.3)));

  // How many of each side's giveaways were thrown rather than fumbled. Rolled
  // once, here, so the passer's line and the secondary's lines are two views
  // of the same event rather than two independent guesses at it.
  acc.home.intsThrown = Math.round(acc.home.turnovers * clamp(INT_SHARE_OF_TURNOVERS + rng.normal(0, 0.12), 0, 1));
  acc.away.intsThrown = Math.round(acc.away.turnovers * clamp(INT_SHARE_OF_TURNOVERS + rng.normal(0, 0.12), 0, 1));

  // --- Stat allocation ------------------------------------------------------
  const homeLines = allocateStats(rng, home, homeUnits, acc.home, acc.away);
  const awayLines = allocateStats(rng, away, awayUnits, acc.away, acc.home);

  // --- Injuries -------------------------------------------------------------
  const injuries: GameResult['injuries'] = [];
  const injuryDetails: BoxScore['injuries'] = [];
  if (settings.injuriesEnabled) {
    for (const team of [home, away]) {
      for (const p of team.players.filter(isAvailable)) {
        // Durability is a real attribute — a brittle player gets hurt more. [TUNE]
        const durability = readJson<AttrMap>(p.trueAttrs, {}).durability ?? 60;
        const rate = SIM.INJURY_RATE_PER_GAME * (1 + (60 - durability) / 200);
        if (rng.bool(rate)) {
          const weeks = Math.max(1, Math.round(rng.normal(SIM.INJURY_WEEKS_MEAN, 1.8) * settings.injurySeverity));
          const type = rng.pick(injuryTypesForSeverity(weeks));
          injuries.push({ playerId: p.id, weeks, type });
          injuryDetails.push({ playerId: p.id, name: `${p.firstName} ${p.lastName}`, teamId: team.id, weeks, type });
        }
      }
    }
  }

  // --- Fatigue --------------------------------------------------------------
  const fatigue: Record<string, number> = {};
  for (const team of [home, away]) {
    for (const p of team.players) {
      if (!isAvailable(p)) continue;
      // Starters wear down more than the end of the bench. [TUNE]
      fatigue[p.id] = Math.round(SIM.FATIGUE_PER_GAME * (0.5 + rng.float(0, 0.8)));
    }
  }

  const boxScore: BoxScore = {
    homeTeam: { id: home.id, abbr: home.abbr, name: home.name },
    awayTeam: { id: away.id, abbr: away.abbr, name: away.name },
    quarters,
    finalHome: homeScore,
    finalAway: awayScore,
    teamStats: {
      home: toTeamStats(acc.home, acc.away, homeLines),
      away: toTeamStats(acc.away, acc.home, awayLines),
    },
    lines: { home: homeLines, away: awayLines },
    drives,
    units: {
      home: { off: round1(homeUnits.off), def: round1(homeUnits.def) },
      away: { off: round1(awayUnits.off), def: round1(awayUnits.def) },
    },
    injuries: injuryDetails,
  };

  return { homeScore, awayScore, boxScore, injuries, fatigue };
}

// ---------------------------------------------------------------------------
// Accumulators & stat allocation
// ---------------------------------------------------------------------------

interface Accumulator {
  points: number; yards: number; plays: number; turnovers: number;
  td: number; fgm: number; fga: number; xpm: number; xpa: number;
  punts: number; sacksTaken: number;
  /**
   * How many of this team's turnovers were thrown, not fumbled. Decided ONCE,
   * here, because two different places used to guess it separately: the
   * quarterback's line rolled `turnovers * ~0.62` and the opposing secondary
   * was handed `turnovers - round(turnovers * 0.35)`. Two rolls of the same
   * event, so the box score could say a passer threw three and the defence
   * that faced him caught two. One number, read by both sides.
   */
  intsThrown: number;
}

function newAccumulator(): Accumulator {
  return { points: 0, yards: 0, plays: 0, turnovers: 0, td: 0, fgm: 0, fga: 0, xpm: 0, xpa: 0, punts: 0, sacksTaken: 0, intsThrown: 0 };
}

function kickerRating(u: UnitRatings): number {
  return u.byPosition.K ?? 55;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Pass/run split by scheme, as a share of PLAY CALLS. [TUNE] */
const SCHEME_PASS_RATE: Record<string, number> = {
  'Air Raid': 0.68, 'West Coast': 0.60, 'Spread Option': 0.55,
  'Power Run': 0.46, 'Balanced': 0.57,
};

/**
 * ---------------------------------------------------------------------------
 * WHY YARDS ARE NOT SPLIT BY THE PLAY-CALL RATE
 * ---------------------------------------------------------------------------
 * A team's yards used to be split pass/run on `passRate` directly — the rate
 * at which it CALLS a pass. That silently assumes a run gains as much as a
 * pass, and it does not: across the NFL a pass attempt nets about 6.3 yards
 * and a carry about 4.3. Calling 57% passes therefore produces about 67% of
 * the yardage through the air, not 57%.
 *
 * Measured over 3,000 saved games this league ran 240 passing yards and 185
 * rushing yards a team a game — a 57/43 split where real football is 66/34 —
 * and the consequence landed squarely on the trophy shelf: across 107 saved
 * league-years the leading rusher gained 2,208 yards against the leading
 * receiver's 1,435. In the NFL those two numbers are level (about 1,700
 * each). A back who outgains every receiver by half then adds six points a
 * touchdown cannot be beaten to an offensive award, and he never was.
 *
 * [TUNE] These are net yards per attempt, sacks included on the passing side.
 */
const YARDS_PER_PASS = 6.3;
const YARDS_PER_RUSH = 4.3;

/**
 * [TUNE] How many tackles a game the fourteen defenders this sim actually
 * names record BETWEEN THEM. It was 62, which is roughly a real team's whole
 * combined total — but a real team spreads that over its nickel backs, its
 * rotational linemen and its coverage teams, none of whom appear in a box line
 * here. Handing all 62 to fourteen men inflated every one of them; the same
 * fourteen slots in the NFL record about 46 a game.
 */
const DEFENDER_TACKLES_PER_GAME = 46;

/**
 * [TUNE] Team sacks per game.
 *
 * THIS WAS BRIEFLY 2.6, ON A CLAIM THAT WOULD NOT CHECK OUT. The note that
 * raised it said 2.6 was "the real league average" and that 2.3 was low. It is
 * the other way round: the NFL has run between 1,240 and 1,300 sacks a season
 * for a decade, which over 32 clubs and 17 games is 2.28 to 2.39 a team a
 * game, and the `Math.max(0, Math.round(...))` below lifts the realised mean a
 * touch above whatever is set here. 2.3 was already the right number.
 *
 * What was actually starving the record book was never this constant. It was
 * the allocator underneath it, which walked the defenders rolling a coin and
 * could credit no man more than one sack in a game — so a fifth of the sacks
 * the team line claimed reached nobody at all, and no season could ever build
 * a tail. `allocateCounts` fixed that; raising this on top of it double-counted
 * the same complaint and put 2.6 x 17 = 44 sacks on a team that should record
 * about 39.
 */
const SACKS_PER_GAME = 2.3;
/** [TUNE] Share of a team's giveaways that are interceptions, not fumbles. */
const INT_SHARE_OF_TURNOVERS = 0.62;
/**
 * [TUNE] Passes defensed a game credited to the eleven named defensive backs
 * and front-seven players below. A real team records about 4.4, but the same
 * argument as DEFENDER_TACKLES_PER_GAME applies — a slice of those go to
 * nickel and dime bodies this sim never puts in a box line — and at 4.4 the
 * league's leading corner finished on 25 against a real leader's 20.
 */
const PASSES_DEFENSED_PER_GAME = 3.6;
/** [TUNE] Team forced fumbles per game — the real league runs ~0.55. */
const FORCED_FUMBLES_PER_GAME = 0.55;
/** [TUNE] Share of a team's rushing touchdowns scored by the quarterback. */
const QB_RUSH_TD_SHARE = 0.18;
/**
 * [TUNE] How much more concentrated scoring is than yardage. Red-zone looks go
 * to the men you trust, so a lead receiver's or a lead back's share of his
 * team's touchdowns runs above his share of its yards. Applied as an exponent
 * on the yardage weights, so it sharpens an ordering that already exists
 * rather than inventing a second one. Tuned down from 1.5, which put the
 * league's leading receiver on 23 touchdowns against a real leader's 15.
 */
const SCORING_CONCENTRATION = 1.2;

/**
 * WHO CATCHES THE BALL, as a share of the team's receiving yards. Real NFL
 * target distribution, backs included — and the backs are in this list on
 * purpose. They used to be handed `rng.int(0, 40)` receiving yards on top of
 * the receivers' full share of the passing total, which is why saved box
 * scores credit 260 receiving yards against 240 thrown. Yards a quarterback
 * did not throw cannot be caught. [TUNE]
 */
const TARGET_SHARE = {
  WR: [0.27, 0.19, 0.12, 0.05],
  TE: [0.16, 0.05],
  RB: [0.11, 0.04, 0.01],
};

/** Share of a team's carries and rushing yards, by backfield slot. [TUNE] */
const CARRY_SHARE = [0.55, 0.31, 0.14];

/**
 * ---------------------------------------------------------------------------
 * WHO RECORDS THE DEFENSIVE COUNTING STATS
 * ---------------------------------------------------------------------------
 * One table per stat, keyed by position and then by depth. Unnormalised — the
 * weights only have to be right relative to each other, `shareWeights`
 * divides through.
 *
 * This replaces a single `tacklePositionBias` whose docstring said
 * "linebackers and safeties rack up tackles; corners and interior less so"
 * and whose numbers never reached the box score, because the blend that
 * consumed it added a near-uniform 35% to everybody (see `shareWeights`).
 * The measured result across 107 saved league-years: the league's leading
 * linebacker finished with 84 tackles, its leading safety 83 and its leading
 * edge rusher 81 — a four per cent spread, in a sport where those numbers run
 * about 170, 125 and 60. Every defender in the league recorded the same
 * season, so the only thing left to separate them was the interception and
 * the pass breakup, which only a defensive back could get. That is the whole
 * reason a safety won Defensive Player of the Year in 95% of saved seasons
 * and an edge rusher never once did.
 *
 * The tackle row is real per-season counts for a STARTER at each slot divided
 * through by 75 — about 120 for a MIKE linebacker, 95 for a strong safety, 65
 * for a corner, 45 for an edge rusher and 40 inside, with the second and third
 * men at each spot scaled off their own snap counts. Starters, not leaders:
 * the league's leading tackler is the best of thirty-two and lands a third
 * above the average starter on his own, which is where the real leader values
 * (about 170 / 125 / 90 / 60 / 55) come back. [TUNE]
 */
const DEF_PRIORS: Record<string, Record<string, number[]>> = {
  //         starter, second, third — real per-season tackle counts / 75
  tackles: { LB: [1.60, 1.13, 0.73], S: [1.27, 0.93], CB: [0.87, 0.73, 0.51], EDGE: [0.60, 0.45, 0.29], DT: [0.53, 0.43, 0.29] },
  // A sack is the pass rush's stat, but off-ball linebackers get a few — Ray
  // Lewis had two the year he won it — so they are on the list rather than
  // structurally shut out of it.
  sacks:   { EDGE: [1.00, 0.72, 0.40], DT: [0.52, 0.38, 0.22], LB: [0.16, 0.10, 0.06], S: [0.05, 0.03], CB: [0.03, 0.02, 0.01] },
  // Corners first, and no ordering privilege for safeties. The old allocator
  // walked the defenders in the order LB, S, CB, ..., handing each cover man
  // in turn a 40% roll at the next available interception, so the safeties
  // always got first refusal and out-picked the corners 8 to 5 a season. Real
  // interception leaders are corners about as often as safeties.
  defInt:  { CB: [1.00, 0.85, 0.55], S: [0.90, 0.60], LB: [0.35, 0.25, 0.15], EDGE: [0.04, 0.03, 0.02], DT: [0.02, 0.02, 0.01] },
  pd:      { CB: [1.00, 0.80, 0.50], S: [0.55, 0.40], LB: [0.30, 0.20, 0.12], EDGE: [0.18, 0.12, 0.07], DT: [0.08, 0.06, 0.04] },
  ff:      { EDGE: [1.00, 0.70, 0.40], DT: [0.45, 0.32, 0.20], LB: [0.55, 0.38, 0.22], S: [0.45, 0.30], CB: [0.40, 0.30, 0.20] },
};

/** How many defenders at each position are on the field enough to record. */
const DEF_SLOTS: [string, number][] = [['LB', 3], ['S', 2], ['CB', 3], ['EDGE', 3], ['DT', 3]];

/**
 * Hand out `total` whole events across `weights`, all of them, to somebody.
 *
 * THIS IS THE FIX AT THE CENTRE OF EVERYTHING ELSE. Touchdowns, sacks and
 * interceptions used to be dealt out by walking the list and rolling a coin at
 * each name — `sacks = 1` if it came up heads and the pool was not empty, and
 * never more than one, ever. Two things fell out of that. First, the box score
 * did not add up: measured over 3,000 saved games, 23% of the passing
 * touchdowns thrown were caught by nobody and 22% of the sacks the team line
 * printed were credited to nobody. Second, and worse for the record book, no
 * player could ever have a three-touchdown afternoon or a three-sack one, so
 * the season-long leaders were pinned near one-a-game: 13 receiving
 * touchdowns and 11 sacks where the NFL's leaders reach 17 and 22. A tail
 * that cannot happen in a game cannot happen in a season, and an award that
 * needs one cannot be won.
 */
function allocateCounts(total: number, weights: number[], rng: Rng): number[] {
  const out = weights.map(() => 0);
  if (total <= 0 || weights.length === 0) return out;
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) { out[0] = total; return out; }
  for (let n = 0; n < total; n++) {
    let roll = rng.float(0, sum);
    let i = 0;
    while (i < weights.length - 1 && (roll -= weights[i]) > 0) i++;
    out[i] += 1;
  }
  return out;
}

/** Sharpen a weight vector towards its leaders without reordering it. */
function concentrate(weights: number[], power: number): number[] {
  return weights.map((w) => Math.pow(Math.max(0, w), power));
}

/**
 * Turn team totals into individual stat lines. Deliberately top-down: the
 * team's yards are already decided by the drive sim, so the box score can never
 * disagree with the score — and, since `allocateCounts` landed, neither can
 * its touchdowns, sacks or interceptions disagree with the team line above
 * them. Distribution is by depth-share prior tilted by rating.
 */
function allocateStats(
  rng: Rng,
  team: SimTeamInput,
  units: UnitRatings,
  own: Accumulator,
  opp: Accumulator,
): BoxLine[] {
  const lines: BoxLine[] = [];
  const passRate = SCHEME_PASS_RATE[team.offScheme] ?? 0.57;
  const totalYards = Math.max(120, own.yards);
  // Yards follow yards-per-attempt, not the play-call rate. See above.
  const passYardShare = (passRate * YARDS_PER_PASS)
    / (passRate * YARDS_PER_PASS + (1 - passRate) * YARDS_PER_RUSH);
  const passYards = Math.round(totalYards * clamp(passYardShare + rng.normal(0, 0.06), 0.35, 0.86));
  const rushYards = totalYards - passYards;

  const passAtt = Math.max(12, Math.round(own.plays * passRate + rng.normal(0, 3)));
  const rushAtt = Math.max(8, own.plays - passAtt);

  // Touchdowns split between pass and rush. [TUNE] 62% through the air.
  const passTd = Math.round(own.td * clamp(0.62 + rng.normal(0, 0.12), 0.2, 0.9));
  const rushTd = Math.max(0, own.td - passTd);

  const push = (p: SimPlayer, stats: SeasonStats) => {
    lines.push({ playerId: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position, stats });
  };

  // --- The passing game ----------------------------------------------------
  // Receivers, tight ends and backs share one pie, because they are sharing
  // one quarterback's yardage. Backs are last in the list so their prior lines
  // up with TARGET_SHARE.RB.
  const rbs = (units.depth.RB ?? []).slice(0, 3);
  const targets = [
    ...(units.depth.WR ?? []).slice(0, 4),
    ...(units.depth.TE ?? []).slice(0, 2),
  ];
  const receivers = [...targets, ...rbs];
  const recPrior = [
    ...TARGET_SHARE.WR.slice(0, Math.min(4, (units.depth.WR ?? []).length)),
    ...TARGET_SHARE.TE.slice(0, Math.min(2, (units.depth.TE ?? []).length)),
    ...TARGET_SHARE.RB.slice(0, rbs.length),
  ];
  // A tight end sees fewer targets than his rating alone would suggest; that
  // discount belongs on the talent tilt, not on the depth prior, which already
  // says how many balls the job gets.
  const recWeights = shareWeights(
    receivers.map((p) => effectiveRating(p) * (p.position === 'TE' ? 0.85 : 1)),
    recPrior,
  );
  const recTds = allocateCounts(passTd, concentrate(recWeights, SCORING_CONCENTRATION), rng);
  const recLine = receivers.map((p, i) => {
    const tgt = Math.round(passAtt * recWeights[i]);
    return {
      p,
      stats: {
        targets: tgt,
        rec: Math.round(tgt * clamp(0.62 + rng.normal(0, 0.08), 0.35, 0.85)),
        recYds: Math.round(passYards * recWeights[i]),
        recTd: recTds[i],
      } as SeasonStats,
    };
  });

  // --- Quarterback ---------------------------------------------------------
  const qb = units.depth.QB?.[0];
  const rushTdWeights = shareWeights(rbs.map((p) => effectiveRating(p)), CARRY_SHARE);
  // The quarterback is a goal-line runner too — he used to be structurally
  // incapable of scoring on the ground, which handed the lead back every
  // rushing touchdown his team scored and left him with 28 of them a season
  // against a real leader's 18.
  const goalLine = concentrate(rushTdWeights, SCORING_CONCENTRATION);
  const goalLineSum = goalLine.reduce((a, b) => a + b, 0) || 1;
  const groundTdWeights = [
    ...goalLine.map((w) => (w / goalLineSum) * (1 - QB_RUSH_TD_SHARE)),
    qb ? QB_RUSH_TD_SHARE : 0,
  ];
  const groundTds = allocateCounts(rushTd, groundTdWeights, rng);

  /*
   * THE QUARTERBACK'S CARRIES COME OUT OF THE TEAM'S RUSHING TOTAL.
   *
   * They used to be conjured beside it — `rushAtt: rng.int(1, 5)` for
   * `rushYds: rng.normal(10, 12)` — yards the drive sim never gained and which
   * nobody else's line was reduced by. Ten a game is 340 a club a season and
   * about 11,000 a league-year, and it is the reason the team rushing line and
   * the rushing lines beneath it could not both be right no matter which one
   * you chose to believe. He still scrambles for about the same; it is now the
   * backs who gained that much less, which is what actually happened.
   */
  const qbRushAtt = qb ? Math.max(0, Math.min(rushAtt - 3, rng.int(1, 5))) : 0;
  const qbRushYds = Math.round(rushYards * (qbRushAtt / Math.max(1, rushAtt)));
  const backRushAtt = rushAtt - qbRushAtt;
  const backRushYds = rushYards - qbRushYds;

  if (qb) {
    const cmpRate = clamp(0.58 + (effectiveRating(qb) - 65) * 0.004 + rng.normal(0, 0.03), 0.42, 0.76);
    push(qb, {
      gp: 1,
      passAtt,
      passCmp: Math.round(passAtt * cmpRate),
      passYds: passYards,
      passTd,
      int: own.intsThrown,
      rushAtt: qbRushAtt,
      rushYds: qbRushYds,
      rushTd: groundTds[groundTds.length - 1],
    });
  }

  // --- Running backs -------------------------------------------------------
  const rbWeights = rushTdWeights; // carries and rushing yards share one prior
  rbs.forEach((p, i) => {
    const rec = recLine[targets.length + i];
    push(p, {
      gp: 1,
      rushAtt: Math.round(backRushAtt * rbWeights[i]),
      rushYds: Math.round(backRushYds * rbWeights[i]),
      rushTd: groundTds[i],
      ...rec.stats,
    });
  });

  // --- Receivers & tight ends ----------------------------------------------
  targets.forEach((p, i) => push(p, { gp: 1, ...recLine[i].stats }));

  // --- Defense -------------------------------------------------------------
  const defenders: { p: SimPlayer; pos: string; slot: number }[] = [];
  for (const [pos, n] of DEF_SLOTS) {
    (units.depth[pos] ?? []).slice(0, n).forEach((p, slot) => defenders.push({ p, pos, slot }));
  }
  if (defenders.length > 0) {
    const ratings = defenders.map((d) => effectiveRating(d.p));
    const weightsFor = (stat: keyof typeof DEF_PRIORS) =>
      shareWeights(ratings, defenders.map((d) => DEF_PRIORS[stat][d.pos]?.[d.slot] ?? 0.01));

    const totalTackles = Math.round(rng.normal(DEFENDER_TACKLES_PER_GAME, 5));
    const tackleWeights = weightsFor('tackles');
    // Every sack the team line claims, every pick the opposing passer threw,
    // credited to a name. No coin flips, no leftovers.
    const sacks = allocateCounts(opp.sacksTaken, weightsFor('sacks'), rng);
    const ints = allocateCounts(opp.intsThrown, weightsFor('defInt'), rng);
    const pds = allocateCounts(
      Math.max(0, Math.round(rng.normal(PASSES_DEFENSED_PER_GAME, 1.4))), weightsFor('pd'), rng);
    // Drawn, not coin-flipped, for the same reason as everything else here: a
    // defence that strips the ball twice in an afternoon is a thing that
    // happens, and a hard cap of one would quietly delete it from the record.
    const ffs = allocateCounts(
      Math.max(0, Math.round(rng.normal(FORCED_FUMBLES_PER_GAME, 0.7))), weightsFor('ff'), rng);

    defenders.forEach((d, i) => push(d.p, {
      gp: 1,
      tackles: Math.max(0, Math.round(totalTackles * tackleWeights[i])),
      sacks: sacks[i],
      defInt: ints[i],
      pd: pds[i],
      ff: ffs[i],
    }));
  }

  // --- Specialists ---------------------------------------------------------
  const k = units.depth.K?.[0];
  if (k) push(k, { gp: 1, fgm: own.fgm, fga: own.fga, xpm: own.xpm, xpa: own.xpa });
  const punter = units.depth.P?.[0];
  if (punter) push(punter, { gp: 1, punts: own.punts, puntYds: own.punts * rng.int(40, 50) });

  return lines;
}

/**
 * [TUNE] How hard talent bends a depth-chart share. At 0 the depth chart
 * decides everything; at 1 a man rated a tenth above his group's mean sees
 * about a tenth more of the work.
 */
const TALENT_TILT = 0.9;

/**
 * Blend a fixed depth-share prior with the players' actual rating share.
 *
 * MULTIPLICATIVE, AND THAT IS THE POINT. This used to return
 * `prior * 0.65 + (rating / ratingSum) * 0.35`. The second term is very nearly
 * uniform — everyone at a position rates within a few points of everyone else,
 * so `rating / ratingSum` sits close to 1/n for all of them — and adding a
 * flat 35% to every name pulls the whole vector towards an even split. The
 * longer the list, the harder it pulls: over the fourteen defenders below it
 * turned a 1.60-to-0.55 spread of positional priors into a 7.3%-to-7.1% spread
 * of actual tackles. The prior was written and then thrown away, and the
 * docstring above it went on describing the intent for as long as it took
 * somebody to measure the box score.
 *
 * Multiplying preserves the prior's shape exactly when a group's ratings are
 * level and tilts it when they are not, which is what "depth chart matters
 * more than raw rating" was always supposed to mean.
 */
function shareWeights(ratings: number[], prior: number[]): number[] {
  if (ratings.length === 0) return [];
  const mean = ratings.reduce((a, b) => a + b, 0) / ratings.length || 1;
  const raw = ratings.map((r, i) => {
    const priorW = prior[i] ?? prior[prior.length - 1] ?? 0.1;
    // Floored so a replacement-level fill-in still takes some of the snaps he
    // is on the field for rather than vanishing from the box score.
    return priorW * Math.max(0.3, 1 + TALENT_TILT * (r / mean - 1));
  });
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  return raw.map((r) => r / sum);
}

/**
 * ---------------------------------------------------------------------------
 * THE TEAM COLUMN IS ADDED UP FROM THE PLAYER COLUMN, NOT GUESSED BESIDE IT
 * ---------------------------------------------------------------------------
 * `passYards` and `rushYards` here used to be a flat 60/40 split of the team's
 * total — a constant, unrelated to anything the men underneath it did. The
 * game screen prints both on one page: `app/league/[id]/game/[gameId]` shows
 * "Pass Yards" off this object and the passer's own line four rows below it,
 * and they disagreed. Measured over 240 league-seasons the gap ran 31 yards a
 * team a game before the allocator changed and 35 after, because the split the
 * lines are built on moved and this constant did not. Nobody ever had to
 * notice, since two different parts of the codebase had already given up on
 * it and started summing the lines themselves — lib/weekReport.ts does, and
 * lib/coachRoom.ts documents the wart rather than reading it.
 *
 * So it reads them. The sum is the box score's own arithmetic, and the only
 * way for it to disagree with the lines is for the lines to disagree with
 * themselves.
 *
 * `totalYards` follows the same rule and is therefore the 120-yard floor
 * `allocateStats` applies, not the raw drive total, on the rare afternoon a
 * club gains less than that. A team column that does not equal the players in
 * it is a worse lie than a floor.
 */
function toTeamStats(own: Accumulator, opp: Accumulator, lines: BoxLine[]): TeamGameStats {
  let passYards = 0, rushYards = 0;
  for (const l of lines) { passYards += l.stats.passYds ?? 0; rushYards += l.stats.rushYds ?? 0; }
  return {
    totalYards: passYards + rushYards,
    passYards,
    rushYards,
    firstDowns: Math.round(own.yards / 15),
    turnovers: own.turnovers,
    sacks: opp.sacksTaken,
    timeOfPossession: Math.round((own.plays / Math.max(1, own.plays + opp.plays)) * 3600),
    thirdDownConv: `${Math.round(own.plays / 6)}/${Math.round(own.plays / 4)}`,
    penalties: Math.round(own.plays / 12),
    penaltyYards: Math.round(own.plays / 12) * 9,
  };
}
