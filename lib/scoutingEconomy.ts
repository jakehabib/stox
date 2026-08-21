import { prisma } from './db';
import { Rng, clamp } from './rng';
import { SCOUT_ECONOMY, SCOUT_TIERS, ScoutTierKey, POSITION_GROUP } from './tuning';
import type { Position } from './tuning';
import { POSITION_WEIGHTS, attrsForPosition } from './ratings';
import { LeagueSettings } from './settings';

/**
 * ===========================================================================
 * DEPRECATED — THE FOCUS-POINT ECONOMY. DO NOT ADD A CALLER.
 * ===========================================================================
 * Focus points are being removed from the game. Everything below still works,
 * unchanged, for exactly one reason: two surfaces still read it
 * (app/league/[id]/layout.tsx's header tile and app/league/[id]/scouting/page.tsx)
 * and they belong to a UI workstream landing separately. Gutting the
 * functions would 500 those pages; deleting the file would fail to compile.
 * So it stays intact and inert-by-abandonment until the call sites listed in
 * docs/scouting-pivot.md are removed, and then it goes.
 *
 * WHAT REPLACED IT, AND WHY.
 *
 * The model below is coherent — a scarce pool, tiers, real diminishing
 * returns — and it was still the wrong game. Two problems, neither fixable by
 * tuning:
 *
 *   1. IT CHARGED FOR PUBLIC KNOWLEDGE. Every team in the real world knows
 *      who the consensus number one pick is, for free, from television. Making
 *      the GM pay to find that out taxed him for the least interesting
 *      information in the sport. lib/consensus.ts now gives every prospect a
 *      public grade, a public rank and a public reason, from day one, at no
 *      cost — and makes that opinion WRONG in named, learnable ways, so the
 *      GM's edge is spotting the error rather than buying the fact.
 *
 *   2. IT PRICED EVERY CLICK. A per-player button with a cost on it turns a
 *      draft class into a spreadsheet of micro-purchases, and the pool
 *      quietly punished anyone who advanced a week without visiting the
 *      screen. lib/shortlistAttention.ts replaces it with one standing
 *      decision and no clicks: your staff works whoever you have starred,
 *      every week, forever, splitting a fixed pool of attention across them.
 *      Star five and you learn a lot about five; star sixty and you learn a
 *      little about sixty. Nothing is spent and nothing runs out.
 *
 * The one genuinely scarce choice that survived is lib/workouts.ts — a handful
 * of private workouts in the run-up to the draft, each a big discrete reveal
 * on one prospect. Scarcity belongs at that single moment of commitment, not
 * spread across every row of a 400-man board.
 *
 * STILL LIVE FROM THIS FILE: nothing by design. `periodKey`/`periodLabel` are
 * the last plausibly-reusable pieces and both are only load-bearing for the
 * budget itself.
 *
 * ---------------------------------------------------------------------------
 * Original doc comment follows.
 * ---------------------------------------------------------------------------
 *
 * SCOUTING ECONOMY — focus points as a real, scarce resource
 *
 * Before this, "focus points" were a number the UI printed on a button and
 * nothing ever checked: the only limiter was a one-scout-per-player-per-week
 * lock, so a GM could reach 100% confidence on the entire draft class for
 * free. Every scouting decision was therefore free, and a free decision is
 * not a decision.
 *
 * The model here has four moving parts:
 *
 *   1. PERIOD GRANTS. The league year is a sequence of periods — one per
 *      in-season week, one per offseason step, and ONE for the whole
 *      pre-draft window (which gets a 6x lump: combine, pro days, visits).
 *      Each period the team's balance is topped up by what its scout staff
 *      can actually produce.
 *
 *   2. A CARRY-OVER CAP. Unspent focus above half of the incoming grant
 *      evaporates. Saving one partial week to afford a Deep Dive is a real
 *      play; banking a whole season into the draft is not. (Zero carry-over
 *      was the other candidate — rejected because it taxes the player for
 *      advancing weeks without visiting the scouting screen, which is a
 *      pacing punishment, not a strategic one.)
 *
 *   3. TIERS. Four things to buy at very different prices (see SCOUT_TIERS),
 *      so the question is never "scout or not" but "how much of my week is
 *      this guy worth".
 *
 *   4. DIMINISHING RETURNS, twice over. Every pass closes a fraction of the
 *      REMAINING uncertainty (so the fourth look is inherently worth less
 *      than the first), AND repeat passes on the same player cost more and
 *      reveal proportionally less. Hammering one prospect is a losing line.
 *
 * The pool is shared across draft prospects, free agents / other teams'
 * players, and your own roster's development, so the allocation tension is
 * automatic: a Deep Dive on a first-round prospect is a Development Focus
 * you did not spend on your own third-year receiver.
 * ===========================================================================
 */

/** Stable per-phase ordinal so a period key is unique and monotonic within a season. */
const PHASE_ORDINAL: Record<string, number> = {
  PRESEASON: 0, REGULAR: 1, PLAYOFFS: 2, OFFSEASON: 3,
  RESIGN: 4, FREE_AGENCY: 5, DRAFT: 6, FANTASY_DRAFT: 7,
};

export interface LeagueClock { seasonYear: number; week: number; phase: string }

/**
 * The identity of the current allowance window. Changes => the budget
 * replenishes. The DRAFT phase never ticks its week (picks advance instead),
 * so the whole pre-draft window is deliberately ONE period with ONE lump.
 */
export function periodKey(league: LeagueClock): number {
  return league.seasonYear * 1000 + (PHASE_ORDINAL[league.phase] ?? 9) * 100 + clamp(league.week, 0, 99);
}

export function periodLabel(league: LeagueClock): string {
  switch (league.phase) {
    case 'PRESEASON': return 'Preseason';
    case 'REGULAR': return `Week ${league.week}`;
    case 'PLAYOFFS': return `Playoffs, round ${league.week}`;
    case 'OFFSEASON': return 'Offseason';
    case 'RESIGN': return 'Re-sign window';
    case 'FREE_AGENCY': return `Free agency, week ${league.week}`;
    case 'DRAFT': return 'Pre-draft window';
    case 'FANTASY_DRAFT': return 'Pre-draft window';
    default: return league.phase;
  }
}

/** What the UI promises will happen next, stated before the player spends. */
export function replenishLabel(league: LeagueClock): string {
  switch (league.phase) {
    case 'REGULAR': return `Refills at the start of week ${league.week + 1}`;
    case 'FREE_AGENCY': return 'Refills each week of free agency';
    case 'DRAFT':
    case 'FANTASY_DRAFT': return 'No further refill until the new league year — this is the pre-draft allotment';
    case 'PLAYOFFS': return 'Refills each playoff round';
    default: return 'Refills when you advance';
  }
}

/**
 * Weekly focus a staff can generate. Each scout is worth STAFF_FLOOR..1.0 by
 * speed, and extra bodies are discounted geometrically — a fifth area scout
 * adds real but sharply reduced coverage.
 */
export function weeklyScoutingBudget(scouts: { speed: number }[], settings: LeagueSettings): number {
  const contributions = scouts
    .map((s) => SCOUT_ECONOMY.STAFF_FLOOR + (1 - SCOUT_ECONOMY.STAFF_FLOOR) * clamp(s.speed, 0, 100) / 100)
    .sort((a, b) => b - a);
  const staff = contributions.reduce(
    (acc, c, i) => acc + c * Math.pow(SCOUT_ECONOMY.STAFF_HEADCOUNT_DECAY, i),
    0,
  );
  return Math.max(
    1,
    Math.round(settings.scoutingBudgetPerWeek * (SCOUT_ECONOMY.BASE_SHARE + SCOUT_ECONOMY.STAFF_SHARE * staff)),
  );
}

/** The grant for one period of the given phase. */
export function periodGrant(scouts: { speed: number }[], settings: LeagueSettings, phase: string): number {
  const mult = SCOUT_ECONOMY.PHASE_GRANT_MULT[phase] ?? 1;
  return Math.max(1, Math.round(weeklyScoutingBudget(scouts, settings) * mult));
}

/**
 * Cost of the NEXT pass of `tier` on a player already scouted `passes` times.
 * Linear escalation: the third Deep Dive on one prospect costs 2.2x the first.
 */
export function scoutCost(tier: ScoutTierKey, passes: number): number {
  return Math.round(SCOUT_TIERS[tier].cost * (1 + SCOUT_ECONOMY.REPEAT_COST_STEP * Math.max(0, passes)));
}

/** Scout-quality multiplier on how much a pass actually teaches you. */
export function scoutQualityMult(accuracy: number, specialtyMatch: boolean): number {
  const acc = 0.7 + (clamp(accuracy, 0, 100) / 100) * 0.6; // 0.7 .. 1.3
  return acc * (specialtyMatch ? 1.15 : 1);
}

export function specialtyMatches(specialty: string, position: Position): boolean {
  if (specialty === 'ALL') return true;
  return POSITION_GROUP[position] === specialty;
}

export interface PassOutcome {
  confidence: number;
  potConfidence: number;
  /** Attribute keys newly locked to their true value by this pass. */
  newlyRevealed: string[];
  /** True if this pass surfaced the hidden development trait. */
  devRevealed: boolean;
  confidenceGained: number;
}

/**
 * The whole reveal model in one pure function. `passes` is how many passes
 * this team has already run on this player — it drives the decay, so the same
 * button is worth visibly less every time it's pressed.
 */
export function applyScoutingPass(args: {
  tier: ScoutTierKey;
  passes: number;
  confidence: number;
  potConfidence: number;
  alreadyRevealed: string[];
  position: Position;
  scoutAccuracy: number;
  specialtyMatch: boolean;
  devAlreadyRevealed: boolean;
  rng: Rng;
}): PassOutcome {
  const t = SCOUT_TIERS[args.tier];
  const decay = Math.pow(SCOUT_ECONOMY.REPEAT_REVEAL_DECAY, Math.max(0, args.passes));
  const quality = scoutQualityMult(args.scoutAccuracy, args.specialtyMatch);

  // Fraction of what is still UNKNOWN that this pass removes. Capped below 1
  // so no single action can ever finish the book on a player.
  const close = clamp(t.close * decay * quality, 0, 0.9);
  const confidence = clamp(args.confidence + (100 - args.confidence) * close, 0, 99);

  // Potential rides the general read, and only the deep tiers push it further.
  const potBase = Math.max(args.potConfidence, confidence);
  const potClose = clamp(t.potentialClose * decay * quality, 0, 0.9);
  const potConfidence = clamp(potBase + (100 - potBase) * potClose, 0, 99);

  // Which attributes get locked to truth. Weighted toward the ones that
  // actually move this position's overall, so an evaluation on a tackle tells
  // you about pass blocking before it tells you about stamina.
  const newlyRevealed: string[] = [];
  const positionAttrs = attrsForPosition(args.position);
  // Never lock the whole card: the displayed OVR must stay a range no matter
  // how much focus is poured into one player.
  const lockCeiling = Math.floor(positionAttrs.length * SCOUT_ECONOMY.MAX_LOCKED_FRACTION);
  const room = Math.max(0, lockCeiling - args.alreadyRevealed.length);
  const revealCount = Math.min(
    room,
    Math.max(0, args.passes === 0 ? t.revealAttrs : Math.round(t.revealAttrs * decay)),
  );
  const weights = POSITION_WEIGHTS[args.position] ?? {};
  const candidates = positionAttrs.filter((k) => !args.alreadyRevealed.includes(k));
  for (let i = 0; i < revealCount && candidates.length > 0; i++) {
    const pool: Record<string, number> = {};
    for (const k of candidates) pool[k] = (weights[k] ?? 0) + 0.04;
    const pick = args.rng.weighted(pool);
    newlyRevealed.push(pick);
    candidates.splice(candidates.indexOf(pick), 1);
  }

  // A deep pass surfaces the hidden development trait, but not reliably — the
  // odds fall away with repeat passes like everything else.
  const devRevealed = args.devAlreadyRevealed
    || (t.revealsDev && args.rng.bool(clamp(0.7 * decay * quality, 0.05, 0.95)));

  return {
    confidence: Math.round(confidence),
    potConfidence: Math.round(potConfidence),
    newlyRevealed,
    devRevealed,
    confidenceGained: Math.round(confidence - args.confidence),
  };
}

export interface ScoutingBudget {
  points: number;
  grant: number;
  spentThisPeriod: number;
  spentSeason: number;
  period: number;
  periodLabel: string;
  replenishLabel: string;
  carryCap: number;
}

function budgetFrom(team: { scoutPoints: number; scoutPeriodGrant: number; scoutSpentSeason: number; scoutPeriod: number }, league: LeagueClock): ScoutingBudget {
  return {
    points: team.scoutPoints,
    grant: team.scoutPeriodGrant,
    spentThisPeriod: Math.max(0, team.scoutPeriodGrant - team.scoutPoints),
    spentSeason: team.scoutSpentSeason,
    period: team.scoutPeriod,
    periodLabel: periodLabel(league),
    replenishLabel: replenishLabel(league),
    carryCap: Math.round(team.scoutPeriodGrant * SCOUT_ECONOMY.CARRY_CAP_FRACTION),
  };
}

/**
 * Lazily bring one team's allowance up to date, then return it. Safe to call
 * from anywhere and on any save: a team that has never been synced (period 0,
 * every league created before this system existed) simply gets its first
 * grant on the next read, so old leagues start the current period with a full
 * allowance rather than zero.
 */
export async function syncScoutingBudget(
  teamId: string,
  league: LeagueClock,
  settings: LeagueSettings,
): Promise<ScoutingBudget> {
  const team = await prisma.team.findUniqueOrThrow({
    where: { id: teamId },
    select: { id: true, scoutPoints: true, scoutPeriod: true, scoutPeriodGrant: true, scoutSpentSeason: true },
  });
  const key = periodKey(league);
  if (team.scoutPeriod === key) return budgetFrom(team, league);

  const scouts = await prisma.scout.findMany({ where: { teamId }, select: { speed: true } });
  const grant = periodGrant(scouts, settings, league.phase);
  const carryCap = Math.round(grant * SCOUT_ECONOMY.CARRY_CAP_FRACTION);
  const carried = Math.min(Math.max(0, team.scoutPoints), carryCap);
  // A new league year zeroes the season-spend counter the department UI shows.
  const newYear = Math.floor(team.scoutPeriod / 1000) !== league.seasonYear;

  const updated = await prisma.team.update({
    where: { id: teamId },
    data: {
      scoutPoints: carried + grant,
      scoutPeriod: key,
      scoutPeriodGrant: carried + grant,
      scoutSpentSeason: newYear ? 0 : team.scoutSpentSeason,
    },
    select: { scoutPoints: true, scoutPeriod: true, scoutPeriodGrant: true, scoutSpentSeason: true },
  });
  return budgetFrom(updated, league);
}

/** Replenish every team in a league — called once per phase/week advance. */
export async function replenishLeagueScoutingBudgets(
  leagueId: string,
  league: LeagueClock,
  settings: LeagueSettings,
): Promise<void> {
  const teams = await prisma.team.findMany({
    where: { leagueId },
    select: { id: true, scoutPoints: true, scoutPeriod: true, scoutSpentSeason: true, scouts: { select: { speed: true } } },
  });
  const key = periodKey(league);
  await Promise.all(teams
    .filter((t) => t.scoutPeriod !== key)
    .map((t) => {
      const grant = periodGrant(t.scouts, settings, league.phase);
      const carried = Math.min(Math.max(0, t.scoutPoints), Math.round(grant * SCOUT_ECONOMY.CARRY_CAP_FRACTION));
      const newYear = Math.floor(t.scoutPeriod / 1000) !== league.seasonYear;
      return prisma.team.update({
        where: { id: t.id },
        data: {
          scoutPoints: carried + grant,
          scoutPeriod: key,
          scoutPeriodGrant: carried + grant,
          scoutSpentSeason: newYear ? 0 : t.scoutSpentSeason,
        },
      });
    }));
}

/** Deterministic per-pass RNG. Never Math.random — a replayed league scouts identically. */
export function passRng(teamId: string, playerId: string, passes: number, seed: string): Rng {
  return new Rng(`scout-${seed}-${teamId}-${playerId}-${passes}`);
}

export { SCOUT_TIERS, SCOUT_ECONOMY };
export type { ScoutTierKey };
