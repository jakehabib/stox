import { prisma } from './db';
import { CapMode } from './types';
import { CAP } from './tuning';
import { readJson, writeJson } from './json';
import {
  capHit,
  capSavingsOnCut,
  deadMoneyOnCut,
  formatMoney,
  proration,
  restructureContract as computeRestructure,
  ContractLike,
} from './cap';
import { teamCapSummary } from './cap-summary';

/**
 * ===========================================================================
 * SALARY CAP ENFORCEMENT
 * ===========================================================================
 * The cap is the central constraint of the genre, so every transaction that
 * adds money to a team's CURRENT-season books runs through the single
 * `assertCapRoom()` gate below instead of each call site re-deriving the
 * "is there room?" condition (which is how signings ended up being the only
 * enforced path in the first place).
 *
 * This module — not lib/cap.ts — is where the gate lives because the check
 * needs the database (a team's live cap sheet), and lib/cap.ts is imported
 * by CLIENT components (RestructureForm, SignOfferForm, ExtendContractForm,
 * TradeBuilder). Pulling prisma into that module's import graph would drag
 * the Prisma client into the browser bundle. lib/cap.ts keeps the pure
 * math; this file owns the rules that need to read the league.
 *
 * capMode contract (the full union lives in lib/types.ts):
 *   REALISTIC  — full enforcement + advancement compliance block.
 *   SIMPLIFIED — transactions still enforced (a flat-APY cap is still a cap),
 *                but no dead money exists, so cuts always fully clear a hit.
 *   OFF        — every function here is a no-op. Never enforce past the
 *                user's own setting.
 * ===========================================================================
 */

/** Rounding slack, matching the pre-existing signFreeAgent check. */
const TOLERANCE = 1;

/** How many relief suggestions an error message / panel carries. */
const SUGGESTION_COUNT = 3;

export interface CapChargeDelta {
  teamId: string;
  /**
   * Net dollars this move adds to that team's CURRENT-season cap.
   * Negative frees room (e.g. the side of a trade sending salary away).
   */
  delta: number;
  /**
   * Room that becomes available as part of the same move — the old contract
   * being torn up by an extension/tag, which stops counting the instant the
   * new one is signed. Added on top of live cap space before comparing.
   */
  creditBack?: number;
}

export interface TeamShortfall {
  teamId: string;
  teamAbbr: string;
  teamName: string;
  /** Dollars the move adds to this team. */
  added: number;
  /** Dollars this team had available for it. */
  available: number;
  /** How far short they are — always > 0 for a row that appears here. */
  shortfall: number;
}

export interface ReliefOption {
  kind: 'CUT' | 'RESTRUCTURE';
  playerId: string;
  name: string;
  position: string;
  /** Cap dollars this move frees THIS season. */
  frees: number;
  /** Dead money the move leaves behind (cuts) or would leave if cut later (restructures). */
  deadMoney: number;
}

/**
 * Thrown by `assertCapRoom`. Carries the structured shortfall so a Server
 * Action can surface a specific, actionable message instead of a bare
 * "something went wrong" — and so the UI can render the way out.
 */
export class CapViolationError extends Error {
  readonly shortfalls: TeamShortfall[];
  readonly relief: ReliefOption[];
  constructor(message: string, shortfalls: TeamShortfall[], relief: ReliefOption[]) {
    super(message);
    this.name = 'CapViolationError';
    this.shortfalls = shortfalls;
    this.relief = relief;
  }
}

function reliefSentence(relief: ReliefOption[]): string {
  if (relief.length === 0) return ' No cut or restructure on this roster clears enough on its own — a trade that sends salary out is the way back.';
  const parts = relief.map((r) =>
    r.kind === 'CUT'
      ? `cut ${r.name} (${r.position}) to free ${formatMoney(r.frees)}`
      : `restructure ${r.name} (${r.position}) to free ${formatMoney(r.frees)}`,
  );
  return ` Ways out: ${parts.join('; ')}.`;
}

/**
 * THE cap gate. Every player-initiated transaction that adds current-season
 * money — signing, extension, franchise tag, restructure, trade, rookie deal
 * — calls this before it writes anything.
 *
 * Checks EVERY team the move touches, which is what makes trades correct:
 * a deal can be comfortably legal for the side shedding salary and illegal
 * for the side taking it on, and only checking the initiator would let the
 * user hand an AI team a cap violation (or take one on themselves without
 * noticing).
 *
 * @throws {CapViolationError} naming each team, the exact shortfall, and the
 *         specific moves that would fix it.
 */
export async function assertCapRoom(opts: {
  /** Verb for the message — 'Signing', 'Extension', 'Trade', 'Rookie deal', … */
  action: string;
  seasonYear: number;
  capMode: CapMode;
  charges: CapChargeDelta[];
}): Promise<void> {
  if (opts.capMode === 'OFF') return; // user turned the cap off — never enforce past that

  // Fold repeated entries for the same team (a trade can move several
  // players in both directions) into one net position per team.
  const byTeam = new Map<string, { delta: number; creditBack: number }>();
  for (const c of opts.charges) {
    const cur = byTeam.get(c.teamId) ?? { delta: 0, creditBack: 0 };
    cur.delta += c.delta;
    cur.creditBack += c.creditBack ?? 0;
    byTeam.set(c.teamId, cur);
  }

  const shortfalls: TeamShortfall[] = [];
  for (const [teamId, { delta, creditBack }] of byTeam) {
    if (delta <= 0) continue; // frees room (or neutral) — nothing to clear
    const [summary, team] = await Promise.all([
      teamCapSummary(teamId, opts.seasonYear, opts.capMode),
      prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { abbr: true, city: true, nickname: true } }),
    ]);
    const available = summary.capSpace + creditBack;
    if (delta > available + TOLERANCE) {
      shortfalls.push({
        teamId,
        teamAbbr: team.abbr,
        teamName: `${team.city} ${team.nickname}`,
        added: delta,
        available,
        shortfall: delta - available,
      });
    }
  }
  if (shortfalls.length === 0) return;

  const worst = shortfalls.reduce((a, b) => (b.shortfall > a.shortfall ? b : a));
  const relief = await capReliefOptions(worst.teamId, opts.seasonYear, opts.capMode, SUGGESTION_COUNT);
  const teamsPart = shortfalls
    .map((s) => `${s.teamName} would be ${formatMoney(s.shortfall)} over (adds ${formatMoney(s.added)} against ${formatMoney(s.available)} of room)`)
    .join('; ');
  const message = `${opts.action} blocked by the salary cap — ${teamsPart}.${reliefSentence(relief)}`;
  throw new CapViolationError(message, shortfalls, relief);
}

/**
 * Concrete moves that would put a team back under the cap, best first —
 * the "route to fix" every block and warning points at. Built from the
 * capSavingsOnCut / deadMoneyOnCut math that already existed in lib/cap.ts.
 */
export async function capReliefOptions(
  teamId: string,
  seasonYear: number,
  capMode: CapMode,
  limit = SUGGESTION_COUNT,
): Promise<ReliefOption[]> {
  if (capMode === 'OFF') return [];
  const roster = await prisma.player.findMany({
    where: { teamId, status: 'ACTIVE', contract: { isNot: null } },
    include: { contract: true },
  });

  const cuts: ReliefOption[] = [];
  const restructures: ReliefOption[] = [];
  for (const p of roster) {
    if (!p.contract) continue;
    const savings = capSavingsOnCut(p.contract, capMode);
    if (savings > 0) {
      cuts.push({
        kind: 'CUT',
        playerId: p.id,
        name: `${p.firstName} ${p.lastName}`,
        position: p.position,
        frees: savings,
        deadMoney: deadMoneyOnCut(p.contract, capMode),
      });
    }
    const r = maxRestructureRelief(p.contract, capMode, seasonYear);
    if (r.frees > 0) {
      restructures.push({
        kind: 'RESTRUCTURE',
        playerId: p.id,
        name: `${p.firstName} ${p.lastName}`,
        position: p.position,
        frees: r.frees,
        deadMoney: r.deadMoney,
      });
    }
  }
  cuts.sort((a, b) => b.frees - a.frees || a.playerId.localeCompare(b.playerId));
  restructures.sort((a, b) => b.frees - a.frees || a.playerId.localeCompare(b.playerId));

  // Interleave so the list isn't three variations of the same idea: a
  // restructure keeps the player, a cut doesn't — the user wants both shapes.
  const out: ReliefOption[] = [];
  for (let i = 0; out.length < limit && (i < cuts.length || i < restructures.length); i++) {
    if (i < cuts.length && out.length < limit) out.push(cuts[i]);
    if (i < restructures.length && out.length < limit) out.push(restructures[i]);
  }
  return out;
}

/**
 * Most current-year relief a full restructure of this deal can produce:
 * convert every dollar of this year's base above the league minimum into
 * signing bonus, no added void years. Only meaningful in REALISTIC — with a
 * flat-APY cap there's no proration to reshape.
 */
export function maxRestructureRelief(
  contract: ContractLike,
  capMode: CapMode,
  seasonYear: number,
): { frees: number; deadMoney: number; convertible: number } {
  if (capMode !== 'REALISTIC') return { frees: 0, deadMoney: 0, convertible: 0 };
  const bases = readJson<number[]>(contract.baseSalaries, []);
  const yearIdx = Math.max(0, contract.years - contract.yearsRemaining);
  const currentBase = bases[yearIdx] ?? 0;
  const convertible = Math.max(0, currentBase - CAP.MIN_SALARY);
  if (convertible <= 0) return { frees: 0, deadMoney: 0, convertible: 0 };

  const next = computeRestructure(contract, convertible, { nowYear: seasonYear });
  const shaped = { ...next, baseSalaries: writeJson(next.baseSalaries) };
  const frees = capHit(contract, capMode) - capHit(shaped, capMode);
  return { frees: Math.max(0, frees), deadMoney: deadMoneyOnCut(shaped, capMode), convertible };
}

export interface CapComplianceReport {
  teamId: string;
  teamAbbr: string;
  teamName: string;
  capMode: CapMode;
  /** False only when capMode is OFF — the single flag UI should branch on. */
  capEnabled: boolean;
  compliant: boolean;
  capSpace: number;
  capUsed: number;
  capTotal: number;
  deadMoney: number;
  rosterSize: number;
  /** Dollars over the ceiling — 0 when compliant. */
  shortfall: number;
  /** Every dollar of relief available from cuts alone, summed. */
  maxCutRelief: number;
  /** Whether cuts alone could still get this team compliant. */
  fixable: boolean;
  relief: ReliefOption[];
  /** The shortest sequence of cuts that clears the shortfall, biggest saver first. */
  path: ReliefOption[];
}

/**
 * A team's live compliance position plus the concrete route back under the
 * ceiling. Used by the advancement block, the persistent over-cap banner and
 * the Cap page panel, so all three tell the user exactly the same story.
 */
export async function capComplianceReport(
  teamId: string,
  seasonYear: number,
  capMode: CapMode,
  /**
   * Build the relief lists even for a compliant team. Off by default because
   * this runs on every page load via the layout banner, and a compliant team
   * has nothing to suggest — the extra roster scan would be pure waste.
   */
  opts: { alwaysRelief?: boolean } = {},
): Promise<CapComplianceReport> {
  const team = await prisma.team.findUniqueOrThrow({
    where: { id: teamId },
    select: { abbr: true, city: true, nickname: true },
  });
  const base = {
    teamId,
    teamAbbr: team.abbr,
    teamName: `${team.city} ${team.nickname}`,
    capMode,
    capEnabled: capMode !== 'OFF',
  };

  if (capMode === 'OFF') {
    return {
      ...base,
      compliant: true,
      capSpace: 0, capUsed: 0, capTotal: 0, deadMoney: 0, rosterSize: 0,
      shortfall: 0, maxCutRelief: 0, fixable: true, relief: [], path: [],
    };
  }

  const summary = await teamCapSummary(teamId, seasonYear, capMode);
  const shortfall = Math.max(0, -summary.capSpace);
  const compliant = summary.capSpace >= 0;
  if (compliant && !opts.alwaysRelief) {
    return {
      ...base,
      compliant: true,
      capSpace: summary.capSpace, capUsed: summary.capUsed, capTotal: summary.capTotal,
      deadMoney: summary.deadMoney, rosterSize: summary.rosterSize,
      shortfall: 0, maxCutRelief: 0, fixable: true, relief: [], path: [],
    };
  }
  const relief = await capReliefOptions(teamId, seasonYear, capMode, 6);

  // maxCutRelief and the escape path have to be computed over the WHOLE
  // roster, not the truncated suggestion list — they decide whether the
  // compliance block is escapable at all, and getting that wrong would
  // strand a user permanently.
  const roster = await prisma.player.findMany({
    where: { teamId, status: 'ACTIVE', contract: { isNot: null } },
    include: { contract: true },
  });
  const everyCut: ReliefOption[] = roster
    .filter((p) => p.contract && capSavingsOnCut(p.contract, capMode) > 0)
    .map((p) => ({
      kind: 'CUT' as const,
      playerId: p.id,
      name: `${p.firstName} ${p.lastName}`,
      position: p.position,
      frees: capSavingsOnCut(p.contract!, capMode),
      deadMoney: deadMoneyOnCut(p.contract!, capMode),
    }))
    .sort((a, b) => b.frees - a.frees || a.playerId.localeCompare(b.playerId));
  const maxCutRelief = everyCut.reduce((a, b) => a + b.frees, 0);

  const path: ReliefOption[] = [];
  let cleared = 0;
  for (const c of everyCut) {
    if (cleared >= shortfall) break;
    path.push(c);
    cleared += c.frees;
  }

  return {
    ...base,
    compliant,
    capSpace: summary.capSpace,
    capUsed: summary.capUsed,
    capTotal: summary.capTotal,
    deadMoney: summary.deadMoney,
    rosterSize: summary.rosterSize,
    shortfall,
    maxCutRelief,
    fixable: maxCutRelief >= shortfall,
    relief,
    path,
  };
}

/**
 * Cap deltas a trade produces, for BOTH sides, matching exactly what
 * executeTrade() actually writes (see lib/trade.ts): in REALISTIC the
 * signing bonus does NOT travel — the team giving the player up eats the
 * whole remaining proration as an immediate dead-money charge, and the team
 * acquiring him inherits base salary only. Any change to that rule has to
 * change here too or the check stops matching reality.
 */
export async function tradeCapDeltas(
  assets: { type: 'PLAYER' | 'PICK'; id: string }[],
  fromTeam: string,
  toTeam: string,
  capMode: CapMode,
): Promise<CapChargeDelta[]> {
  if (capMode === 'OFF') return [];
  const out: CapChargeDelta[] = [];
  for (const a of assets) {
    if (a.type !== 'PLAYER') continue; // picks carry no cap weight
    const contract = await prisma.contract.findUnique({ where: { playerId: a.id } });
    if (!contract) continue;
    const currentHit = capHit(contract, capMode);
    if (capMode === 'REALISTIC') {
      const accelerated = deadMoneyOnCut(contract, capMode);
      const inheritedBase = currentHit - proration(contract);
      // Seller: drops the live hit, immediately books the accelerated bonus.
      out.push({ teamId: fromTeam, delta: accelerated - currentHit });
      out.push({ teamId: toTeam, delta: inheritedBase });
    } else {
      // SIMPLIFIED: the flat-APY contract travels intact, nothing accelerates.
      out.push({ teamId: fromTeam, delta: -currentHit });
      out.push({ teamId: toTeam, delta: currentHit });
    }
  }
  return out;
}

/**
 * Free up room on an AI team for a transaction it cannot decline — right
 * now that means a rookie contract out of the draft, where refusing to sign
 * the pick isn't an option the way passing on a free agent is.
 *
 * A real front office facing the same problem cuts veterans to fit the
 * rookie pool, so that's what this does: release the FEWEST players that
 * clear the shortfall (biggest cap saving first), so the AI pays a real
 * roster cost for its cap mismanagement instead of being handed an
 * exemption the user doesn't get.
 *
 * Deterministic by construction — ordered by cap savings, then overall,
 * then id. No RNG.
 * Returns the players actually released.
 */
export async function autoClearCapRoom(opts: {
  leagueId: string;
  teamId: string;
  needed: number;
  seasonYear: number;
  capMode: CapMode;
  week: number;
}): Promise<{ name: string; freed: number }[]> {
  if (opts.capMode === 'OFF' || opts.needed <= 0) return [];
  const { cutPlayer } = await import('./freeagency');

  const released: { name: string; freed: number }[] = [];
  let remaining = opts.needed;
  const roster = await prisma.player.findMany({
    where: { teamId: opts.teamId, status: 'ACTIVE', contract: { isNot: null } },
    include: { contract: true },
  });
  const candidates = roster
    .map((p) => ({ p, savings: p.contract ? capSavingsOnCut(p.contract, opts.capMode) : 0 }))
    .filter((c) => c.savings > 0)
    // Fewest releases that clear the bill: biggest saving first, ties broken
    // toward the lesser player, then id so the order is fully determined.
    .sort((a, b) => b.savings - a.savings || a.p.trueOvr - b.p.trueOvr || a.p.id.localeCompare(b.p.id));

  for (const c of candidates) {
    if (remaining <= 0) break;
    await cutPlayer({
      leagueId: opts.leagueId,
      playerId: c.p.id,
      capMode: opts.capMode,
      seasonYear: opts.seasonYear,
      week: opts.week,
    });
    released.push({ name: `${c.p.firstName} ${c.p.lastName}`, freed: c.savings });
    remaining -= c.savings;
  }
  return released;
}
