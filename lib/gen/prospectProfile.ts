import { Rng, clamp } from '../rng';
import { Position } from '../tuning';
import { AttrMap } from '../ratings';

/**
 * ===========================================================================
 * COLLEGE PROFILE (draft scouting depth)
 * ===========================================================================
 * There's no simulated college season underneath this — these are procedural
 * college-style box scores and combine/pro-day testing numbers, generated
 * once at class creation and revealed progressively as the NFL season
 * plays out (see collegeWeeksElapsed). Deliberately tuned to COLLEGE norms,
 * not NFL ones: a 13-game season, higher pass-volume/completion%/yards-per-
 * attempt than the pros (spread/RPO systems), and the real NCAA passer
 * efficiency formula (different weights than the NFL's). [TUNE] throughout —
 * these are plausible ranges, not fitted to real CFB data.
 * ===========================================================================
 */

export const COLLEGE_WEEKS = 13;

export const COMPETITION_GRADES = ['A', 'B', 'C', 'D', 'F'] as const;
export type CompetitionGrade = (typeof COMPETITION_GRADES)[number];

export interface CollegeGameLine {
  passAtt?: number; passCmp?: number; passYds?: number; passTd?: number; passInt?: number;
  rushAtt?: number; rushYds?: number; rushTd?: number;
  targets?: number; rec?: number; recYds?: number; recTd?: number;
  tkl?: number; sacks?: number; tfl?: number; ints?: number; pd?: number; ff?: number;
  sacksAllowed?: number; pancakes?: number;
  fgMade?: number; fgAtt?: number; xpMade?: number;
  punts?: number; puntYds?: number;
}

export interface CollegeProfile {
  games: CollegeGameLine[]; // COLLEGE_WEEKS entries, one per game
  competitionGrade: CompetitionGrade;
}

export interface CombineTesting {
  venue: 'COMBINE' | 'PRO_DAY';
  fortyYard: number;   // seconds
  vertical: number;    // inches
  broadJump: number;   // inches
  threeCone: number;   // seconds
  shuttle: number;     // seconds
  benchReps: number | null;
}

/** Real NCAA passer efficiency rating — very different weighting from the NFL's formula. */
export function ncaaPasserRating(cmp: number, att: number, yds: number, td: number, int: number): number {
  if (att < 1) return 0;
  return Math.max(0, ((8.4 * yds) + (330 * td) + (100 * cmp) - (200 * int)) / att);
}

/** Sum every game's stat line up to (and including) `throughWeek` games. */
export function aggregateCollegeGames(games: CollegeGameLine[], throughWeek: number): CollegeGameLine {
  const slice = games.slice(0, clamp(throughWeek, 0, games.length));
  const totals: CollegeGameLine = {};
  for (const g of slice) {
    for (const key of Object.keys(g) as (keyof CollegeGameLine)[]) {
      totals[key] = (totals[key] ?? 0) + (g[key] ?? 0);
    }
  }
  return totals;
}

/** Maps the NFL calendar onto a college season so stats reveal progressively through the year instead of all at once. */
export function collegeWeeksElapsed(leagueWeek: number): number {
  return clamp(Math.round((leagueWeek * COLLEGE_WEEKS) / 17), 1, COLLEGE_WEEKS);
}

function normGame(rng: Rng, mean: number, sd: number, min = 0): number {
  return Math.max(min, Math.round(rng.normal(mean, sd)));
}

/** Generates one full college season's worth of per-game stat lines, shaped by position and true attributes. [TUNE] */
export function generateCollegeProfile(rng: Rng, position: Position, trueAttrs: AttrMap, trueOvr: number): CollegeProfile {
  // 0..1 quality dial from true overall — drives every stat mean below.
  const q = clamp((trueOvr - 40) / 55, 0, 1);
  const games: CollegeGameLine[] = [];

  for (let w = 0; w < COLLEGE_WEEKS; w++) {
    const g: CollegeGameLine = {};
    switch (position) {
      case 'QB': {
        const att = normGame(rng, 30, 5);
        const cmpPct = clamp(0.55 + q * 0.15 + rng.float(-0.05, 0.05), 0.45, 0.78);
        const cmp = Math.min(att, Math.round(att * cmpPct));
        const ypa = clamp(6.8 + q * 3.2 + rng.float(-0.8, 0.8), 4.5, 12);
        g.passAtt = att; g.passCmp = cmp; g.passYds = Math.round(att * ypa);
        g.passTd = normGame(rng, 1.3 + q * 1.4, 1.1);
        g.passInt = normGame(rng, Math.max(0.15, 1.1 - q * 0.8), 0.7);
        g.rushYds = normGame(rng, 10 + (trueAttrs.speed ?? 50) / 4, 15, -10);
        g.rushTd = rng.bool(0.15 + q * 0.1) ? 1 : 0;
        break;
      }
      case 'RB': {
        const att = normGame(rng, 14, 5);
        const ypc = clamp(4.4 + q * 2.0 + rng.float(-0.6, 0.6), 2.5, 8);
        g.rushAtt = att; g.rushYds = Math.round(att * ypc);
        g.rushTd = normGame(rng, 0.4 + q * 0.6, 0.6);
        g.targets = normGame(rng, 2 + q * 2, 1.5);
        g.rec = Math.min(g.targets, normGame(rng, (g.targets ?? 0) * 0.7, 1));
        g.recYds = Math.round((g.rec ?? 0) * clamp(7 + q * 3, 5, 13));
        break;
      }
      case 'FB': {
        g.rushAtt = normGame(rng, 3, 1.5); g.rushYds = Math.round((g.rushAtt ?? 0) * 3.8);
        g.rec = normGame(rng, 1, 1); g.recYds = Math.round((g.rec ?? 0) * 8);
        break;
      }
      case 'WR': {
        const targets = normGame(rng, 5 + q * 4, 2.5);
        g.targets = targets;
        g.rec = Math.min(targets, normGame(rng, targets * (0.55 + q * 0.1), 1.5));
        g.recYds = Math.round((g.rec ?? 0) * clamp(11 + q * 6, 8, 20));
        g.recTd = rng.bool(0.12 + q * 0.18) ? 1 : 0;
        break;
      }
      case 'TE': {
        const targets = normGame(rng, 3 + q * 2.5, 2);
        g.targets = targets;
        g.rec = Math.min(targets, normGame(rng, targets * 0.6, 1));
        g.recYds = Math.round((g.rec ?? 0) * clamp(9 + q * 4, 6, 15));
        g.recTd = rng.bool(0.1 + q * 0.12) ? 1 : 0;
        break;
      }
      case 'LT': case 'LG': case 'C': case 'RG': case 'RT': {
        g.sacksAllowed = rng.bool(clamp(0.18 - q * 0.13, 0.01, 0.2)) ? 1 : 0;
        g.pancakes = normGame(rng, 1.5 + q * 2.5, 1.3);
        break;
      }
      case 'EDGE': case 'DT': {
        g.tkl = normGame(rng, 2.5 + q * 2, 1.3);
        g.sacks = Math.max(0, Number((rng.normal(0.2 + q * 0.5, 0.35)).toFixed(1)));
        g.tfl = normGame(rng, 0.6 + q * 0.8, 0.6);
        g.ff = rng.bool(0.04 + q * 0.05) ? 1 : 0;
        break;
      }
      case 'LB': {
        g.tkl = normGame(rng, 4 + q * 3, 1.8);
        g.sacks = Math.max(0, Number((rng.normal(0.1 + q * 0.2, 0.2)).toFixed(1)));
        g.tfl = normGame(rng, 0.5 + q * 0.6, 0.5);
        g.ints = rng.bool(0.03 + q * 0.05) ? 1 : 0;
        break;
      }
      case 'CB': case 'S': {
        g.tkl = normGame(rng, 3 + q * 1.5, 1.3);
        g.ints = rng.bool(0.06 + q * 0.08) ? 1 : 0;
        g.pd = normGame(rng, 0.4 + q * 0.7, 0.6);
        g.ff = rng.bool(0.02 + q * 0.03) ? 1 : 0;
        break;
      }
      case 'K': {
        g.fgAtt = normGame(rng, 1.3, 0.9);
        const pct = clamp(0.65 + q * 0.3 + rng.float(-0.1, 0.1), 0.4, 1);
        g.fgMade = Math.min(g.fgAtt, Math.round((g.fgAtt ?? 0) * pct));
        g.xpMade = normGame(rng, 3, 1.2);
        break;
      }
      case 'P': {
        g.punts = normGame(rng, 4.5, 1.5);
        const avg = clamp(38 + q * 8 + rng.float(-3, 3), 32, 52);
        g.puntYds = Math.round((g.punts ?? 0) * avg);
        break;
      }
    }
    games.push(g);
  }

  // Competition strength loosely tracks talent (better prospects tend to play
  // at bigger programs) but overlaps heavily on purpose — a chunk of A-tier
  // talent tests against F-tier competition (small-school hidden gems) and
  // vice versa (system products at big programs whose stats don't hold up).
  const gradeRoll = clamp(q + rng.float(-0.45, 0.45), 0, 1);
  const competitionGrade = COMPETITION_GRADES[clamp(Math.floor((1 - gradeRoll) * COMPETITION_GRADES.length), 0, COMPETITION_GRADES.length - 1)];

  return { games, competitionGrade };
}

const SKIPS_BENCH: Position[] = ['QB', 'WR', 'CB', 'S', 'K', 'P'];

/** Combine or pro-day testing numbers — always public knowledge, unlike scouted attribute ranges. [TUNE] */
export function generateCombineTesting(rng: Rng, position: Position, trueAttrs: AttrMap, trueOvr: number): CombineTesting {
  const speed = trueAttrs.speed ?? 50;
  const accel = trueAttrs.acceleration ?? 50;
  const agility = trueAttrs.agility ?? 50;
  const strength = trueAttrs.strength ?? 50;

  const BASE_40: Partial<Record<Position, number>> = {
    WR: 4.48, CB: 4.47, RB: 4.52, S: 4.55, TE: 4.68, LB: 4.72, QB: 4.75, EDGE: 4.68,
    FB: 4.85, DT: 5.05, RT: 5.25, LT: 5.25, RG: 5.3, LG: 5.3, C: 5.28, K: 4.95, P: 4.95,
  };
  const base40 = BASE_40[position] ?? 4.9;
  const fortyYard = clamp(base40 - (speed - 50) / 220 - (accel - 50) / 400 + rng.float(-0.06, 0.06), 4.22, 5.9);

  const explosive = (speed + strength) / 2;
  const vertical = clamp(28 + (explosive - 50) / 3.2 + rng.float(-2, 2), 18, 46);
  const broadJump = clamp(100 + (explosive - 50) / 2.3 + rng.float(-4, 4), 84, 145);

  const agilityBase = 7.0 - (agility - 50) / 55;
  const threeCone = clamp(agilityBase + rng.float(-0.15, 0.15), 6.3, 8.2);
  const shuttle = clamp(threeCone - 2.7 + rng.float(-0.1, 0.1), 3.8, 5.3);

  const benchReps = SKIPS_BENCH.includes(position)
    ? null
    : clamp(Math.round(14 + (strength - 50) / 3.5 + rng.float(-3, 3)), 2, 44);

  // Higher-rated prospects test at the combine more consistently; the rest
  // more often only get a pro day.
  const combineOdds = clamp(0.35 + (trueOvr - 50) / 90, 0.15, 0.92);
  const venue: CombineTesting['venue'] = rng.bool(combineOdds) ? 'COMBINE' : 'PRO_DAY';

  return { venue, fortyYard: Number(fortyYard.toFixed(2)), vertical: Math.round(vertical), broadJump: Math.round(broadJump), threeCone: Number(threeCone.toFixed(2)), shuttle: Number(shuttle.toFixed(2)), benchReps };
}

/**
 * Position-weighted "public perception" score for ranking the board —
 * distinct from the raw scouted grade, the same way real big boards value
 * a QB or edge rusher over a similarly-graded guard. A small deterministic
 * wobble (reseeded every couple weeks, not every render) gives risers and
 * fallers across the season without touching anyone's true rating.
 */
export function bigBoardScore(scoutedOvr: number, position: Position, playerId: string, leagueWeek: number, posValue: number): number {
  const buzzRng = new Rng(`${playerId}-buzz-${Math.floor(leagueWeek / 2)}`);
  const buzz = buzzRng.float(-3, 3);
  return scoutedOvr * posValue + buzz;
}

/**
 * Scouting-note flavor text hinting at hidden-gem / bust-risk archetypes —
 * never states the true rating, just teases the gap between it and the
 * scouted number once there's enough confidence to notice a pattern at all.
 */
export function prospectBuzzNote(trueOvr: number, potential: number, scoutedOvr: number, confidence: number, grade: CompetitionGrade): string | null {
  if (confidence < 25) return null;
  const gap = trueOvr - scoutedOvr;
  if (gap >= 10 && (grade === 'A' || grade === 'B')) return 'Produced against real competition — some evaluators think this grade is light.';
  if (gap >= 10) return 'A few scouts are quietly higher on him than the consensus grade suggests.';
  if (gap <= -10 && (grade === 'D' || grade === 'F')) return 'Gaudy numbers, soft competition — buyer beware translating this to Sundays.';
  if (gap <= -10) return 'Tape doesn\'t match the box score for some evaluators.';
  if (potential >= 92 && confidence < 55) return 'Ceiling nobody has fully seen yet.';
  return null;
}
