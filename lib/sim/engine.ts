import { Rng, clamp } from '../rng';
import { SIM } from '../tuning';
import { LeagueSettings, DIFFICULTY_MODS } from '../settings';
import { BoxScore, BoxLine, DriveResult, SeasonStats, TeamGameStats } from '../types';
import { computeUnits, SimPlayer, SimStaff, UnitRatings, effectiveRating, isAvailable } from './units';
import { readJson } from '../json';
import { AttrMap } from '../ratings';

/**
 * ===========================================================================
 * GAME RESOLUTION (design doc section 9)
 * ===========================================================================
 * The sim is DRIVE-BASED, not play-based. Each team gets ~11 possessions.
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
  injuries: { playerId: string; weeks: number }[];
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
      plays = rng.int(3, 7);
      a.turnovers += 1;
    } else if (roll < toProb + scoreProb) {
      const tdShare = clamp(SIM.TD_SHARE_BASE + edge * SIM.EDGE_TO_TD_SHARE, 0.22, 0.82);
      if (rng.bool(tdShare)) {
        result = 'TD';
        points = 6;
        yards = Math.round(rng.normal(66, 18));
        plays = rng.int(6, 13);
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
        plays = rng.int(5, 11);
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
      yards = Math.round(rng.normal(19, 15));
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

  // Sacks are a defensive stat derived from the opposing pass rush edge. [TUNE]
  acc.home.sacksTaken = Math.max(0, Math.round(rng.normal(2.3 + (awayUnits.byPosition.EDGE - homeUnits.byPosition.LT) * 0.04, 1.3)));
  acc.away.sacksTaken = Math.max(0, Math.round(rng.normal(2.3 + (homeUnits.byPosition.EDGE - awayUnits.byPosition.RT) * 0.04, 1.3)));

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
          injuries.push({ playerId: p.id, weeks });
          injuryDetails.push({ playerId: p.id, name: `${p.firstName} ${p.lastName}`, teamId: team.id, weeks });
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
      home: toTeamStats(acc.home, acc.away),
      away: toTeamStats(acc.away, acc.home),
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
}

function newAccumulator(): Accumulator {
  return { points: 0, yards: 0, plays: 0, turnovers: 0, td: 0, fgm: 0, fga: 0, xpm: 0, xpa: 0, punts: 0, sacksTaken: 0 };
}

function kickerRating(u: UnitRatings): number {
  return u.byPosition.K ?? 55;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Pass/run split by scheme. [TUNE] */
const SCHEME_PASS_RATE: Record<string, number> = {
  'Air Raid': 0.68, 'West Coast': 0.60, 'Spread Option': 0.55,
  'Power Run': 0.46, 'Balanced': 0.57,
};

/**
 * Turn team totals into individual stat lines. Deliberately top-down: the
 * team's yards are already decided by the drive sim, so the box score can never
 * disagree with the score. Distribution is by depth weight * rating share.
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
  const passYards = Math.round(totalYards * clamp(passRate + rng.normal(0, 0.06), 0.3, 0.82));
  const rushYards = totalYards - passYards;

  const passAtt = Math.max(12, Math.round(own.plays * passRate + rng.normal(0, 3)));
  const rushAtt = Math.max(8, own.plays - passAtt);

  // Touchdowns split between pass and rush. [TUNE] 62% through the air.
  const passTd = Math.round(own.td * clamp(0.62 + rng.normal(0, 0.12), 0.2, 0.9));
  const rushTd = Math.max(0, own.td - passTd);

  const push = (p: SimPlayer, stats: SeasonStats) => {
    lines.push({ playerId: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position, stats });
  };

  // --- Quarterback ---------------------------------------------------------
  const qb = units.depth.QB?.[0];
  if (qb) {
    const cmpRate = clamp(0.58 + (effectiveRating(qb) - 65) * 0.004 + rng.normal(0, 0.03), 0.42, 0.76);
    push(qb, {
      gp: 1,
      passAtt,
      passCmp: Math.round(passAtt * cmpRate),
      passYds: passYards,
      passTd,
      int: Math.round(own.turnovers * clamp(0.62 + rng.normal(0, 0.15), 0, 1)),
      rushAtt: rng.int(1, 5),
      rushYds: Math.round(rng.normal(10, 12)),
    });
  }

  // --- Running backs -------------------------------------------------------
  const rbs = (units.depth.RB ?? []).slice(0, 3);
  const rbWeights = shareWeights(rbs.map((p) => effectiveRating(p)), [0.62, 0.28, 0.10]);
  rbs.forEach((p, i) => {
    const att = Math.round(rushAtt * rbWeights[i]);
    push(p, {
      gp: 1,
      rushAtt: att,
      rushYds: Math.round(rushYards * rbWeights[i]),
      rushTd: i === 0 ? rushTd : 0,
      rec: Math.round(rng.int(0, 4) * rbWeights[i] * 2),
      recYds: Math.round(rng.int(0, 40) * rbWeights[i]),
    });
  });

  // --- Receivers & tight ends ----------------------------------------------
  const targets = [...(units.depth.WR ?? []).slice(0, 4), ...(units.depth.TE ?? []).slice(0, 2)];
  const recWeights = shareWeights(
    targets.map((p) => effectiveRating(p) * (p.position === 'TE' ? 0.6 : 1)),
    [0.30, 0.22, 0.14, 0.08, 0.18, 0.08],
  );
  let tdLeft = passTd;
  targets.forEach((p, i) => {
    const tgt = Math.round(passAtt * recWeights[i]);
    const rec = Math.round(tgt * clamp(0.62 + rng.normal(0, 0.08), 0.35, 0.85));
    const td = tdLeft > 0 && rng.bool(recWeights[i] * 2.2) ? 1 : 0;
    tdLeft -= td;
    push(p, { gp: 1, targets: tgt, rec, recYds: Math.round(passYards * recWeights[i]), recTd: td });
  });

  // --- Defense -------------------------------------------------------------
  const defenders = [
    ...(units.depth.LB ?? []).slice(0, 3),
    ...(units.depth.S ?? []).slice(0, 2),
    ...(units.depth.CB ?? []).slice(0, 3),
    ...(units.depth.EDGE ?? []).slice(0, 3),
    ...(units.depth.DT ?? []).slice(0, 3),
  ];
  const totalTackles = Math.round(rng.normal(62, 6));
  const tackleWeights = shareWeights(
    defenders.map((p) => effectiveRating(p) * tacklePositionBias(p.position)),
    defenders.map(() => 1),
  );
  let sacksLeft = opp.sacksTaken;
  let intsLeft = Math.max(0, opp.turnovers - Math.round(opp.turnovers * 0.35));
  defenders.forEach((p, i) => {
    const isRusher = p.position === 'EDGE' || p.position === 'DT';
    const isCover = p.position === 'CB' || p.position === 'S';
    let sacks = 0;
    if (isRusher && sacksLeft > 0 && rng.bool(0.45)) { sacks = 1; sacksLeft -= 1; }
    let defInt = 0;
    if (isCover && intsLeft > 0 && rng.bool(0.4)) { defInt = 1; intsLeft -= 1; }
    push(p, {
      gp: 1,
      tackles: Math.max(0, Math.round(totalTackles * tackleWeights[i])),
      sacks,
      defInt,
      pd: isCover && rng.bool(0.35) ? rng.int(1, 3) : 0,
      ff: rng.bool(0.06) ? 1 : 0,
    });
  });

  // --- Specialists ---------------------------------------------------------
  const k = units.depth.K?.[0];
  if (k) push(k, { gp: 1, fgm: own.fgm, fga: own.fga, xpm: own.xpm, xpa: own.xpa });
  const punter = units.depth.P?.[0];
  if (punter) push(punter, { gp: 1, punts: own.punts, puntYds: own.punts * rng.int(40, 50) });

  return lines;
}

function tacklePositionBias(pos: string): number {
  // Linebackers and safeties rack up tackles; corners and interior less so. [TUNE]
  return { LB: 1.6, S: 1.25, CB: 0.85, EDGE: 0.8, DT: 0.7 }[pos] ?? 1;
}

/** Blend a fixed depth-share prior with the players' actual rating share. */
function shareWeights(ratings: number[], prior: number[]): number[] {
  if (ratings.length === 0) return [];
  const ratingSum = ratings.reduce((a, b) => a + b, 0) || 1;
  const raw = ratings.map((r, i) => {
    const priorW = prior[i] ?? prior[prior.length - 1] ?? 0.1;
    // 65% prior / 35% talent — depth chart matters more than raw rating. [TUNE]
    return priorW * 0.65 + (r / ratingSum) * 0.35;
  });
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  return raw.map((r) => r / sum);
}

function toTeamStats(own: Accumulator, opp: Accumulator): TeamGameStats {
  const passShare = 0.6;
  return {
    totalYards: own.yards,
    passYards: Math.round(own.yards * passShare),
    rushYards: own.yards - Math.round(own.yards * passShare),
    firstDowns: Math.round(own.yards / 15),
    turnovers: own.turnovers,
    sacks: opp.sacksTaken,
    timeOfPossession: Math.round((own.plays / Math.max(1, own.plays + opp.plays)) * 3600),
    thirdDownConv: `${Math.round(own.plays / 6)}/${Math.round(own.plays / 4)}`,
    penalties: Math.round(own.plays / 12),
    penaltyYards: Math.round(own.plays / 12) * 9,
  };
}
