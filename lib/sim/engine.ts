import { Rng, clamp } from '../rng';
import { SIM } from '../tuning';
import { LeagueSettings, DIFFICULTY_MODS } from '../settings';
import { BoxScore, BoxLine, DriveResult, SeasonStats, TeamGameStats } from '../types';
import { computeUnits, SimPlayer, SimStaff, UnitRatings, effectiveRating, isAvailable, REPLACEMENT_LEVEL } from './units';
import { passTendency, PASS_TENDENCY, roleTendency } from './tendency';
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
  /**
   * The share of play calls this club passes on, this season. Supplied by the
   * caller because it depends on the league year, which the engine has no
   * other way to know; `passTendency(team.id)` is the fallback and returns the
   * club's centre with no particular season attached. See lib/sim/tendency.ts.
   */
  passRate?: number;
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

  const homeUnits = computeUnits(home.players, home.staff, home.depthOrder);
  const awayUnits = computeUnits(away.players, away.staff, away.depthOrder);

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

  /**
   * -------------------------------------------------------------------------
   * THE ONE PLACE PUNTING IS ALLOWED TO TOUCH THE GAME
   * -------------------------------------------------------------------------
   * How much the possession a team is ABOUT to start has been made worse by
   * the punt that handed it to them. Set by the punting side, read and cleared
   * by the receiving side, and it is the receiving side's key that gets
   * written — see the PUNT branch below, which is the only line in this file
   * where getting the sides the wrong way round would be invisible in the
   * aggregate (every club both punts and receives, so a sign error still
   * balances league-wide and only reverses who benefits).
   *
   * WHY THIS ENGINE CANNOT DO IT ANY OTHER WAY. There is no field position
   * here at all. A drive is a number of yards and a number of points, never a
   * place on a field, so "he pinned them on their own 8" has nowhere to land:
   * nothing tracks where a possession starts. The light abstraction is to skip
   * the geometry and write down what the geometry is FOR — a good punter makes
   * the other team's next possession less likely to end in points.
   *
   * WHY SCORING PROBABILITY AND NOT DRIVE YARDAGE. Two reasons, one of them
   * about football and one about this file.
   *   - Drive yardage here is measured from the line of scrimmage, and being
   *     backed up does not shorten what you gain; if anything a team starting
   *     on its own 8 has MORE room to gain yards before it punts. Field
   *     position is a fact about how far you must go to score, which is what
   *     scoring probability is.
   *   - The five yardage-and-plays constants in the branches below had just
   *     been calibrated against real per-drive figures when this was written
   *     (137a1e2 took total yards from 408.8 to 344.6 against a real ~330).
   *     Reaching into them for a special-teams nudge would be re-opening that
   *     with no way to tell the two effects apart. Outcome MIX moves; the
   *     shape of each outcome does not. Measured after: 344.6 -> 344.7.
   *
   * Cleared on read, so an unconsumed pin — the last punt of the game, whose
   * receiving team never takes the field again — expires instead of leaking
   * into a later possession. That costs the HOME punter about a tenth of his
   * effect and it is left alone: the loop runs away-then-home, so the home
   * side's tenth-drive punt is the only one with no possession behind it.
   * Measured over 150,000 paired games, a 99 punter is worth 0.300 points a
   * game at home and 0.337 away, and 0.300/0.337 is 0.89 — nine tenths, which
   * is the artifact stating itself. Real football does the same thing for the
   * same reason: the last punt of an afternoon is usually followed by a kneel.
   */
  const pinned = { home: 0, away: 0 };

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
    // Whatever the last punt did to this possession, spent here and only here.
    const pin = pinned[side];
    pinned[side] = 0;
    const scoreProb = clamp(
      SIM.SCORING_DRIVE_BASE + edge * SIM.EDGE_TO_SCORE_PROB + noise * 0.05 - pin,
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
      // THE SIDES, EXPLICITLY. `side` is punting. The pin is written against
      // the OTHER key, and it is read off `side`'s OWN punter — this team's
      // specialist making the other team's next possession worse, which is the
      // whole claim. Written long-hand rather than as a ternary inside the
      // index because a sign or a side error here balances out league-wide and
      // would never show up in an aggregate.
      const punter = punterRating(side === 'home' ? homeUnits : awayUnits);
      const receiving = side === 'home' ? 'away' : 'home';
      pinned[receiving] = (punter - SIM.PUNTER_BASELINE) * SIM.PUNT_PIN_PER_RATING;
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

/**
 * The man kicking this team's punts, as a rating.
 *
 * `byPosition.P` is `positionUnitRating` over a depth weight of [1.0], so it
 * is exactly the starter's fatigue-adjusted rating, and computeUnits writes
 * the key for every team whether or not one is on the roster — the fallback is
 * belt-and-braces rather than a live path. It falls back to REPLACEMENT_LEVEL
 * and not to kickerRating's 55, because a club with no punter fields the guy
 * off the street and that is what the rest of this engine already prices him
 * at.
 */
function punterRating(u: UnitRatings): number {
  return u.byPosition.P ?? REPLACEMENT_LEVEL;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

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

/** What share of a club's yardage goes through the air, given its pass rate. */
function passYardShareFor(rate: number): number {
  return (rate * YARDS_PER_PASS) / (rate * YARDS_PER_PASS + (1 - rate) * YARDS_PER_RUSH);
}

/**
 * The league-average share of yardage that goes through the air, DERIVED from
 * PASS_TENDENCY.LEAGUE_MEAN rather than written down, so that retuning the
 * league's play-call rate cannot silently move the pass/run touchdown split off
 * PASS_TD_SHARE. See TD_SPLIT_SCHEME_SLOPE for what it anchors.
 *
 * This used to be the mean of `passYardShareFor` across the five scheme rates,
 * which came to 0.6602; anchored on the league mean it is 0.6624. The gap is
 * Jensen's inequality — `passYardShareFor` is concave, so the mean of the
 * function over a spread of rates sits below the function of the mean. Computed
 * exactly over the tendency distribution it would be 0.6617, a further 0.0007
 * away, which is immaterial against a per-game noise term of sd 0.06 and is not
 * worth an integral in a hot path.
 */
const LEAGUE_PASS_YARD_SHARE = passYardShareFor(PASS_TENDENCY.LEAGUE_MEAN);

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

/** [TUNE] League-wide share of touchdowns scored through the air. */
const PASS_TD_SHARE = 0.62;

/**
 * ---------------------------------------------------------------------------
 * A TEAM'S TOUCHDOWNS FOLLOW ITS YARDS, WHICH FOLLOW HOW OFTEN IT RUNS
 * ---------------------------------------------------------------------------
 * The pass/run touchdown split used to be a flat PASS_TD_SHARE for every club
 * in the league, while the pass/run YARDAGE split ten lines above it already
 * moved with how often the club threw it. Two halves of one box score
 * disagreeing about whether a team runs the ball.
 *
 * Measured over 120 league-seasons, that is what a lead back's touchdown column
 * looked like. These rows are labelled with the five named schemes the game
 * carried at the time, since deleted — read them as five points on the
 * play-call-rate axis that lib/sim/tendency.ts now supplies continuously:
 *
 *   (pass rate)     team rush att/g   his rush yds   his rush TD   yds per TD
 *   0.46                       32.3           1349           8.3          163
 *   0.55                       27.1           1072           8.5          126
 *   0.57                       25.7            990           8.1          122
 *   0.60                       24.0            926           8.6          108
 *   0.68                       19.3            689           8.6           80
 *
 * The yardage column doubles and the touchdown column does not move at all: a
 * back's rushing touchdowns were independent of how much his team ran the ball,
 * and the yards-per-touchdown column therefore ran BACKWARDS — the club that
 * ran it 32 times a game needed twice as many yards per score as the one that
 * ran it 19 times. Real football is emphatically not like that. In 2023 the
 * most run-heavy NFL club scored 24 rushing touchdowns and the most pass-heavy
 * one scored 10, a 2.4x spread at team level and about 1.9x once the
 * quarterbacks are taken out of both. This engine's spread was 0.97x. The
 * visible symptom is a back who scores fourteen times on 653 yards, one every
 * 47: each number individually defensible, the pair of them reading as broken.
 *
 * So the touchdown split slides with the yardage split, anchored on
 * LEAGUE_PASS_YARD_SHARE so the LEAGUE-wide share stays PASS_TD_SHARE. This
 * moves touchdowns between the run and the pass WITHIN a club; it does not
 * create or destroy any, and a club's POINTS are decided upstream in the drive
 * loop and never see this at all. Measured across 120 league-seasons on
 * identical seeds, the league's share of touchdowns through the air is 62.7 /
 * 62.8 / 62.8% before and 62.8 / 62.5 / 62.8% after, on three seed-sets.
 *
 * 0.8, OFF A SWEEP, AND THE COLUMN THAT CHOSE IT IS THE PASSING ONE. Every
 * touchdown this takes off a pass-heavy club's running back is handed to that
 * club's quarterback, so the price of the fix is paid in the passing record
 * book. Over the same 120 league-seasons (the two TD columns are the most
 * run-heavy and most pass-heavy of the five rates tabulated above):
 *
 *   slope    run-hvy TD  pass-hvy TD  ratio  rush TD leader  pass TD leader  13TD&<700yd
 *   0.0           8.3         8.6  0.97x            15.4            42.5           17
 *   0.4           9.3         7.7  1.21x            15.7            42.8            3
 *   0.6           9.8         7.3  1.34x            16.0            43.2            1
 *   0.8          10.4         6.7  1.55x            16.4            43.7            0
 *   1.0          10.9         6.3  1.73x            16.8            44.7            0
 *   1.5          12.0         5.2  2.31x            18.2            46.3            0
 *
 * The last column is the shape that started this: lead-back seasons pairing 13
 * or more rushing touchdowns with under 700 rushing yards, of 3,840. It is gone
 * by 0.8 without a cap being placed on either number — the pairing simply stops
 * being a thing the arithmetic can produce often.
 *
 * 1.0 and above are rejected on the passing side, not the rushing one. A
 * league-year's leading passer already throws 42.5 touchdowns here against a
 * real 38-40, and at 1.0 the best of 120 league-seasons reaches 60 and at 1.5
 * it reaches 63 — past the real all-time 55, and past the top of the record
 * band lib/gen/leagueHistory.ts seeds a brand-new league with (53-58), which
 * makes the seeded record beatable in year one. At 0.8 the best of 120 is 58,
 * exactly where the unchanged engine's own tail already sits on a second
 * seed-set, so the tail is not made worse than it was. 0.4 and 0.6 are rejected
 * from the other end: they leave the run-heavy-to-pass-heavy spread at
 * 1.21-1.34x against a real ~1.9x and still leave the 13-touchdown-on-650-yards
 * season on the table.
 *
 * 0.8's 1.55x is deliberately short of the real ~1.9x. That last stretch costs
 * more in the passing record book than it buys in the rushing one, and the two
 * cannot be bought separately — they are the same touchdown.
 * [TUNE]
 */
const TD_SPLIT_SCHEME_SLOPE = 0.8;
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

/**
 * Share of a team's CARRIES, by backfield slot. [TUNE]
 *
 * Carries only. It used to be carries and rushing yards both, off this one
 * vector, which is what made yards per carry a fact about a backfield rather
 * than about a back — see RB_YPC_TILT.
 *
 * Three entries against a ROSTER_TARGETS.RB of {min 3, ideal 4, max 5}, and
 * `allocateStats` slices the depth chart to three before this is applied, so
 * nothing renormalises across a variable count, and a fourth back takes no
 * carries at all. That is a defensible way to describe a gameday scratch and is
 * left alone deliberately — a fourth slot here also lands him a share of
 * TARGET_SHARE.RB's receiving work, which he should not have, and that is a
 * separate change with its own measurement to do.
 *
 * THIS IS THE LEAGUE'S PRIOR AND NO LONGER EVERY CLUB'S. It used to be both,
 * and the lead back's realised share of his backfield's carries was 57.3% for
 * every club in the league, give or take how good he was. Real clubs run
 * anywhere from a 40% committee to an 88% workhorse; `roleTendency`'s
 * `carryFocus` is the exponent that puts that spread back, and `shapePrior`
 * below is where it is applied. The league-wide mean is unchanged.
 */
const CARRY_SHARE = [0.55, 0.31, 0.14];

/**
 * ---------------------------------------------------------------------------
 * A REAL LEAGUE HAS WORKHORSES; THIS ONE HAD NONE
 * ---------------------------------------------------------------------------
 * TARGET_SHARE and CARRY_SHARE above are the LEAGUE's priors, and until this
 * landed they were also every individual club's. Tilted by rating and by
 * nothing else, that made the leading rusher in any league-year simply "the
 * best club's starting back", and it showed in the one place a league's stat
 * page looks at — the spread of the leader board. Measured over 24 replayed
 * league-seasons:
 *
 *   leader                 median    p90     max     real NFL
 *   rush attempts             260    266     272     300-380
 *   rushing yards           1,373  1,505   1,515     1,700-2,000
 *   receptions                126    128     130     110-135
 *   TE receiving yards        749    823     824     1,000-1,200
 *
 * Twelve yards separate the median league-year's leading rusher from the best
 * of twenty-four. Real leader boards have long tails because real clubs choose
 * very different offences with the same personnel: in 2022 Josh Jacobs carried
 * 340 times for 1,653 yards, 82% of his club's rushing yardage, and the flat
 * vector's best case is a back on 57% of his own backfield's carries. The
 * level cannot be fixed without the spread — raising the league-wide share far
 * enough to reach an 82% workhorse would make every club in the league one, and
 * would delete the second and third backs from the box score entirely.
 *
 * So the prior is shaped per club per season by lib/sim/tendency.ts's
 * `roleTendency`, which is `passTendency`'s opposite number: that one says how
 * often a club throws it, this one says who it throws it to. `carryFocus` is an
 * EXPONENT on the backfield prior — above 1 concentrates on the starter, below
 * 1 flattens towards a committee, and it cannot reorder the depth chart —
 * and `teEmphasis` is a multiplier on the tight ends' slice of the receiving
 * prior. Both are renormalised afterwards by `shareWeights`, so this moves work
 * BETWEEN teammates and never creates a carry or a target: the club's plays are
 * decided upstream in the drive loop and never see this at all. Measured over
 * 12 replayed league-seasons, every score in the league is BIT-IDENTICAL before
 * and after, which is the property that separation is supposed to have.
 *
 * There is deliberately no equivalent axis for the number one receiver; see
 * lib/sim/tendency.ts for the sweep that rejected it.
 */
function shapePrior(prior: number[], focus: number): number[] {
  return prior.map((w) => Math.pow(Math.max(0, w), focus));
}

/**
 * ---------------------------------------------------------------------------
 * YARDS PER CATCH IS A FACT ABOUT THE RECEIVER
 * ---------------------------------------------------------------------------
 * The receiving half of the defect RB_YPC_TILT above fixed for the run, and it
 * survived that pass untouched because it lives in a different line of code.
 * A receiver's yards were `passYards * recWeights[i]` and his catches were
 * `passAtt * recWeights[i] * catchRate` — one weight vector for both — so every
 * man on a club averaged the same yards per reception, to the hundredth,
 * exactly as the three backs used to average the same yards per carry.
 * Measured over 12 replayed league-seasons, per-game means:
 *
 *   slot   rec/g   recYds/g   yards per catch
 *   WR1     6.37       68.9        10.81
 *   WR2     4.16       45.0        10.80
 *   WR3     2.47       26.7        10.80
 *   TE1     3.12       33.7        10.79
 *   RB1     2.54       27.4        10.78
 *
 * A checkdown to the third-down back was worth the same as a go route. Real
 * football is nothing like that and the gap is not subtle: NFL receivers run
 * about 12.9 yards a catch, tight ends 10.8 and running backs 7.6. That flat
 * column is also what capped the receiving record book — the leading receiver's
 * total is his catches times this number, so with the volume already right at
 * 120 catches there was nowhere for 1,700 yards to come from.
 *
 * The prior below is those three real figures as ratios. It is applied to each
 * man's ACTUAL receptions and then renormalised against the reception-weighted
 * mean, exactly as RB_YPC_TILT is renormalised against the carry-weighted one,
 * so the club's passing yardage is conserved to the yard and this is a
 * redistribution and cannot be anything else. A back gaining less per catch is
 * a receiver gaining more, on the same throw.
 *
 * [TUNE] Real yards per reception by position, as a ratio to a wide receiver's.
 */
const REC_YPC_PRIOR: Record<string, number> = { WR: 1.00, TE: 0.90, RB: 0.59 };

/**
 * [TUNE] How hard a receiver's rating bends his yards per catch away from his
 * teammates'. Deliberately gentler than RB_YPC_TILT's 0.9: the positional
 * spread above is doing most of the separating here, where the backfield had
 * no positional axis at all and the rating was the only thing available.
 * Floored at 0.45 for the same reason — a replacement-level fill-in gains less
 * per catch, he does not go backwards.
 */
const REC_YPC_TILT = 0.5;

/**
 * ---------------------------------------------------------------------------
 * YARDS PER CARRY IS A FACT ABOUT THE BACK
 * ---------------------------------------------------------------------------
 * [TUNE] How hard a back's rating bends his yards per carry away from the rest
 * of his backfield's.
 *
 * A back's carries and his rushing yards used to come off one weight vector —
 * `const rbWeights = rushTdWeights; // carries and rushing yards share one
 * prior` — and the arithmetic consequence of that is that every back on a club
 * averages the SAME yards per carry, exactly, every afternoon. Measured over
 * 120 league-seasons the first, second and third backs in the league all
 * averaged 4.52, to the hundredth, and a back's rating against his own yards
 * per carry ran r = 0.233 with a top-quartile-over-bottom-quartile ratio of
 * 1.069x. What little correlation there was came from team quality — good
 * clubs gain more on the ground and their backs are better — and none at all
 * from the back. A 90 OVR starter and the 58 OVR third-stringer behind him
 * produced identical efficiency; only volume separated them.
 *
 * That is the same defect the linebacker's tackle count had (r = 0.082, fixed
 * to 0.659) and the punter's average had (r = -0.027, fixed to 0.672), in the
 * one column a player page prints as a back's headline efficiency stat.
 *
 * THIS IS A REDISTRIBUTION AND CANNOT BE ANYTHING ELSE. The team's rushing
 * yardage is decided upstream by the drive sim, so a good back can only gain
 * more than the men behind him, never more than his club gained — and his club
 * already gained more for having him, because the backfield feeds the offensive
 * unit rating (OFFENSE_UNIT_WEIGHTS.RB). The multiplier is normalised against
 * the CARRY-WEIGHTED mean rating of the same three backs, which makes the
 * weighted multiplier exactly 1 and the total exactly conserved.
 *
 * 0.9, CHOSEN OFF A SWEEP, NOT OFF A FEELING. Measured over 120 league-seasons
 * on identical rosters and seeds, with the first, second and third backs' yards
 * per carry, the league-wide spread of qualifying seasons (>= 100 carries), and
 * a back's rating against his own average:
 *
 *   tilt   RB1 / RB2 / RB3 ypc      sd      r     top-q/bot-q   league leader
 *   0.0    4.52 / 4.52 / 4.52    0.460   0.233      1.069x           1,574
 *   0.5    4.62 / 4.43 / 4.28    0.471   0.363      1.107x           1,615
 *   0.9    4.69 / 4.35 / 4.09    0.499   0.445      1.138x           1,649
 *   1.4    4.79 / 4.26 / 3.85    0.555   0.516      1.178x           1,691
 *
 * 1.4 was rejected even though it lands the league-wide spread nearest a real
 * qualifying field's: it buys that spread by putting 0.94 yards a carry between
 * a starter and his club's third back, where real depth charts run about half
 * to two-thirds of that. 0.9 puts 0.60 between them and still lands the spread
 * at sd 0.499 against a real field's ~0.48-0.55, which is the number that chose
 * it. 0.5 was rejected as too timid to be worth the change: it moves the
 * correlation less than half as far for a third of the separation.
 *
 * r = 0.445 IS THE HONEST CEILING HERE AND IS NOT THE 0.659 THE LINEBACKER PASS
 * REACHED. Two reasons, both real. The club's rushing total is fixed upstream,
 * so a back can only out-gain his own teammates, never his own offensive line;
 * and yards per carry is the noisiest, most line-and-scheme-dependent number in
 * football, which is why real backs' averages swing a full yard year to year on
 * unchanged ability. A rating that explained most of it would be the lie in the
 * other direction.
 *
 * The league's leading rusher moving 1,574 -> 1,649 against a real ~1,700 is a
 * side-effect and not a target: not one extra yard is rushed for anywhere, the
 * best back in a league-year simply keeps more of what his club already gained.
 * Floored at 0.45 for the same reason `shareWeights` floors its own tilt: a
 * replacement-level fill-in gains less, he does not go backwards.
 */
const RB_YPC_TILT = 0.9;

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
  const passRate = team.passRate ?? passTendency(team.id);
  const totalYards = Math.max(120, own.yards);
  // Yards follow yards-per-attempt, not the play-call rate. See above.
  const passYardShare = (passRate * YARDS_PER_PASS)
    / (passRate * YARDS_PER_PASS + (1 - passRate) * YARDS_PER_RUSH);
  const passYards = Math.round(totalYards * clamp(passYardShare + rng.normal(0, 0.06), 0.35, 0.86));
  const rushYards = totalYards - passYards;

  const passAtt = Math.max(12, Math.round(own.plays * passRate + rng.normal(0, 3)));
  const rushAtt = Math.max(8, own.plays - passAtt);

  // Touchdowns split between pass and rush, tracking the afternoon this club
  // actually had rather than a league-wide constant — see
  // TD_SPLIT_SCHEME_SLOPE. Read off the REALISED yardage split rather than off
  // `passYardShare`, so a game a team happened to run the ball in is a game it
  // happened to score on the ground in; the club's flat season pass rate was
  // the alternative and it throws that coupling away for nothing.
  const passTdShare = clamp(
    PASS_TD_SHARE + TD_SPLIT_SCHEME_SLOPE * (passYards / totalYards - LEAGUE_PASS_YARD_SHARE),
    0.2, 0.9,
  );
  const passTd = Math.round(own.td * clamp(passTdShare + rng.normal(0, 0.12), 0.2, 0.9));
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
  // What kind of offence this club is running this season — a workhorse
  // backfield or a committee, a tight-end offence or a wide receiver one.
  const roles = roleTendency(team.id, passRate);
  const nWr = Math.min(4, (units.depth.WR ?? []).length);
  const nTe = Math.min(2, (units.depth.TE ?? []).length);
  const recPrior = [
    ...TARGET_SHARE.WR.slice(0, nWr),
    ...TARGET_SHARE.TE.slice(0, nTe).map((w) => w * roles.teEmphasis),
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
  // Receptions first, because the yards follow them: a man's receiving total is
  // his catches times what a catch is worth to HIM, not a second independent
  // slice of the same pie. See REC_YPC_PRIOR.
  const recCounts = receivers.map((p, i) => {
    const tgt = Math.round(passAtt * recWeights[i]);
    return { tgt, rec: Math.round(tgt * clamp(0.62 + rng.normal(0, 0.08), 0.35, 0.85)) };
  });
  const recYpcMean = receivers.reduce((a, p, i) => a + effectiveRating(p) * recCounts[i].rec, 0)
    / Math.max(1, recCounts.reduce((a, c) => a + c.rec, 0)) || 1;
  const recYardRaw = receivers.map((p, i) => recCounts[i].rec
    * (REC_YPC_PRIOR[p.position] ?? 1)
    * Math.max(0.45, 1 + REC_YPC_TILT * (effectiveRating(p) / recYpcMean - 1)));
  const recYardSum = recYardRaw.reduce((a, b) => a + b, 0) || 1;
  const recLine = receivers.map((p, i) => ({
    p,
    stats: {
      targets: recCounts[i].tgt,
      rec: recCounts[i].rec,
      // A man who caught nothing gained nothing. The old form sliced the club's
      // passing yards by TARGET share, so the third back's 0.01 of the targets
      // rounded to no catches and still rounded to two yards, every game.
      recYds: Math.round(passYards * (recYardRaw[i] / recYardSum)),
      recTd: recTds[i],
    } as SeasonStats,
  }));

  // --- Quarterback ---------------------------------------------------------
  const qb = units.depth.QB?.[0];
  const rushTdWeights = shareWeights(
    rbs.map((p) => effectiveRating(p)),
    shapePrior(CARRY_SHARE.slice(0, rbs.length), roles.carryFocus),
  );
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
  // Carries are a depth-chart fact; yards per carry is a fact about the back.
  // They used to be one vector — see RB_YPC_TILT for the measurement that
  // separated them and for why the yard weights are renormalised rather than
  // scaled, which is what keeps the club's rushing total exactly where the
  // drive sim put it.
  const rbWeights = rushTdWeights;
  const carryMeanRating = rbs.reduce((a, p, i) => a + effectiveRating(p) * rbWeights[i], 0) || 1;
  const rbYardRaw = rbs.map((p, i) => rbWeights[i]
    * Math.max(0.45, 1 + RB_YPC_TILT * (effectiveRating(p) / carryMeanRating - 1)));
  const rbYardSum = rbYardRaw.reduce((a, b) => a + b, 0) || 1;
  const rbYardWeights = rbYardRaw.map((w) => w / rbYardSum);
  rbs.forEach((p, i) => {
    const rec = recLine[targets.length + i];
    push(p, {
      gp: 1,
      rushAtt: Math.round(backRushAtt * rbWeights[i]),
      rushYds: Math.round(backRushYds * rbYardWeights[i]),
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
  /**
   * A PUNTER'S AVERAGE IS NOW A FACT ABOUT THE PUNTER.
   *
   * This was `own.punts * rng.int(40, 50)` — one roll of a ten-sided die, on a
   * uniform whose mean is 45, multiplied across every punt of the afternoon.
   * Two things were wrong with it and only one of them was the rating. The
   * other is that a season of it never converged: every punt a man hit in a
   * given game travelled the same distance, so his season average was an
   * average of seventeen numbers rather than of sixty-eight, and his career
   * line stayed noisy forever. `puntAvg` is a column on his player page and
   * the only merit stat lib/performanceScore.ts scores him on, and it was
   * measuring nothing.
   *
   * Each punt is drawn on its own now, around a mean his rating sets. See
   * SIM.PUNT_GROSS_* for the anchors: 45.5 gross at a league-average starter
   * against a real league-wide 45.6, and a 9.5-yard spread on the single kick
   * because a shank and a 60-yarder are both ordinary.
   *
   * `effectiveRating` and not `units.byPosition.P`, though they are the same
   * number today (P's depth weight is [1.0]): this is HIS line, and it should
   * follow the man who kicked them if that weighting ever changes.
   */
  const punter = units.depth.P?.[0];
  if (punter) {
    const gross = SIM.PUNT_GROSS_BASE
      + (effectiveRating(punter) - SIM.PUNTER_BASELINE) * SIM.PUNT_GROSS_PER_RATING;
    let puntYds = 0;
    for (let i = 0; i < own.punts; i++) {
      // Clamped at three standard deviations, so it almost never fires: what
      // it rules out is a negative punt, which is not a thing.
      puntYds += Math.round(rng.normalClamped(gross, SIM.PUNT_GROSS_SD, 15, 75));
    }
    push(punter, { gp: 1, punts: own.punts, puntYds });
  }

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
