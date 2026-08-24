import type { Position } from './tuning';

export interface SeasonStats {
  gp?: number;
  // Passing
  passAtt?: number; passCmp?: number; passYds?: number; passTd?: number; int?: number;
  // Rushing
  rushAtt?: number; rushYds?: number; rushTd?: number; fum?: number;
  // Receiving
  targets?: number; rec?: number; recYds?: number; recTd?: number;
  // Defense
  tackles?: number; sacks?: number; defInt?: number; pd?: number; ff?: number;
  // Kicking
  fgm?: number; fga?: number; xpm?: number; xpa?: number; punts?: number; puntYds?: number;
}

export interface BoxLine {
  playerId: string;
  name: string;
  position: Position | string;
  stats: SeasonStats;
}

export interface DriveResult {
  team: 'home' | 'away';
  result: 'TD' | 'FG' | 'PUNT' | 'TURNOVER' | 'DOWNS' | 'END_HALF';
  points: number;
  plays: number;
  yards: number;
}

export interface BoxScore {
  homeTeam: { id: string; abbr: string; name: string };
  awayTeam: { id: string; abbr: string; name: string };
  quarters: { home: number[]; away: number[] };
  finalHome: number;
  finalAway: number;
  teamStats: {
    home: TeamGameStats;
    away: TeamGameStats;
  };
  lines: { home: BoxLine[]; away: BoxLine[] };
  drives: DriveResult[];
  /** Unit ratings that fed the sim — surfaced so the recap can explain itself. */
  units: {
    home: { off: number; def: number };
    away: { off: number; def: number };
  };
  injuries: { playerId: string; name: string; teamId: string; weeks: number; type: string }[];
}

export interface TeamGameStats {
  totalYards: number;
  passYards: number;
  rushYards: number;
  firstDowns: number;
  turnovers: number;
  sacks: number;
  timeOfPossession: number; // seconds
  thirdDownConv: string;
  penalties: number;
  penaltyYards: number;
}

export interface GmProfile {
  /** 0..1 — how likely to make aggressive trades / big FA splashes. */
  aggression: number;
  /** 0..1 — 1 = all-in win-now, 0 = full rebuild. Recomputed each offseason. */
  winNow: number;
  /** 0..1 — how much extra it charges for draft picks. */
  valuePicks: number;
  /** 0..1 — bias toward drafting best-player-available vs need. */
  bpaBias: number;
}

export type CapMode = 'REALISTIC' | 'SIMPLIFIED' | 'OFF';
export type Difficulty = 'EASY' | 'NORMAL' | 'HARD';
/**
 * How a league is dealt on day one.
 *
 * RANDOM_ROSTERS  every club opens with a full, ready-made roster.
 * FANTASY_DRAFT   all 32 rosters are emptied into one pool and drafted from
 *                 scratch (a one-time pre-PRESEASON phase — see lib/season.ts).
 * REBUILD         RANDOM_ROSTERS with one club — yours — dealt the worst
 *                 roster in the league and a cap sheet to match, and the
 *                 league's rules locked until you win something. It is the
 *                 same generator and the same season machine throughout; see
 *                 lib/rebuild.ts for the starting hand and the ironman rules.
 *
 * THIS FIELD IS THE ONLY RECORD OF WHICH ONE A SAVE CHOSE, and it is written
 * once, at creation. Nothing in the app writes it afterwards, which is what
 * makes "a normal save can never become a REBUILD" a property of the code
 * rather than a promise.
 */
export type LeagueStart = 'RANDOM_ROSTERS' | 'FANTASY_DRAFT' | 'REBUILD';
