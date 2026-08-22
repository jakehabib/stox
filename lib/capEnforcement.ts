import { prisma } from './db';
import { CapMode } from './types';
import { CAP, Position } from './tuning';
import { readJson, writeJson } from './json';
import {
  capHit,
  capSavingsOnCut,
  deadMoneyOnCut,
  formatMoney,
  marketValue,
  restructureContract as computeRestructure,
  tradeCapEffect,
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
  // `path` means "cuts that, taken together, clear the shortfall". When no
  // combination of cuts can (dead money alone can exceed the ceiling), it
  // walked the whole roster and handed back a route that does not arrive —
  // and callers presented it as one, telling a permanently stuck user to make
  // a cut that cannot fix anything. An empty path is the honest answer, and
  // every caller already renders that case as "a trade is the way back".
  const fixable = maxCutRelief >= shortfall;

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
    fixable,
    relief,
    path: fixable ? path : [],
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
    // One derivation, in lib/cap.ts, shared with the trade screen's live
    // "space after" readout — so what the builder shows and what this gate
    // enforces cannot drift apart.
    const effect = tradeCapEffect(contract, capMode);
    // Seller drops the live hit and immediately books the accelerated bonus;
    // buyer takes on what actually travels.
    out.push({ teamId: fromTeam, delta: -effect.frees });
    out.push({ teamId: toTeam, delta: effect.takesOn });
  }
  return out;
}

/**
 * Free up room on an AI team for a transaction it cannot decline — right
 * now that means a rookie contract out of the draft, where refusing to sign
 * the pick isn't an option the way passing on a free agent is.
 *
 * A real front office facing the same problem cuts veterans to fit the rookie
 * pool, so that's what this does — the AI pays a real roster cost for its cap
 * mismanagement instead of being handed an exemption the user doesn't get.
 *
 * WHICH veterans is the whole question, and the first answer here was
 * "biggest cap saving first, fewest releases". That is a sentence about
 * arithmetic, and in football it means: waive your best player. The
 * highest-paid man on a roster is normally its star, so a club that came up a
 * few hundred thousand short of a fourth-round contract released him. Measured
 * on one simulated draft, all four clubs that hit this path did exactly that —
 * bills of $0.73M, $0.99M, $1.28M and $2.57M paid by releasing a 92 WR ($12.7M
 * freed), a 24-year-old 95 DT ($12.6M), an 83 QB ($14.7M) and an 82 QB ($8.6M).
 *
 * Nothing about that is a football decision, and it is the only signing path
 * in the game where nobody ever reconsiders: the draft is the last step before
 * the new league year, free agency has already closed, and no wave will ever
 * run on the men it dumps. Across three pre-fix leagues the post-draft pool
 * held nine free agents rated 90+ — a 97 LT, a 97 EDGE, a 97 QB — none of whom
 * had reached the market by any route a GM could name. (Good players reaching
 * free agency is not itself wrong; the re-sign window puts real names on the
 * wire every year and the wave signs them. This was a club choosing its 95 DT
 * over a $3M backup to cover a $0.99M bill.)
 *
 * So the bill is paid with the least football the club can spend, in two
 * branches that are the same instinct at different depths:
 *
 *   SOMEBODY COVERS IT ALONE. Release the man of least worth who does — worth
 *     being `marketValue`, the same open-market price the rest of the game
 *     signs and trades on, not his cap number. A club short $1M waives the
 *     $3M backup nobody would miss, not the $13M star. Ties go to the smaller
 *     saving: no reason to torch $12M of room to clear $1M of bill.
 *   NOBODY DOES. Then it takes more than one release, and the order is cap
 *     relief per dollar of worth — the worst contracts first. That is the same
 *     decision a real front office makes when it has to clear real money: the
 *     overpaid go before the underpaid, whatever the raw salary says.
 *
 * Note what is NOT protected: nothing here refuses to cut a good player, and
 * it is not trying to hold the free-agent pool down to scraps. A club that has
 * genuinely written itself into a corner still loses somebody real — measured
 * after the change, clubs in cap trouble waived an 87 LG, an 86 RB and an 85 P,
 * mostly at the positions the market prices cheapest. What went away is the
 * $1M bill paid with a $13M player: across five leagues run through the same
 * offseason, no club released a 90+ player to fit a rookie deal.
 *
 * Deterministic by construction — worth, then saving, then id. No RNG.
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
    .sort((a, b) => b.savings - a.savings || a.p.trueOvr - b.p.trueOvr || a.p.id.localeCompare(b.p.id));

  const cut = new Set<string>();
  for (const pick of candidates) {
    if (remaining <= 0) break;
    await cutPlayer({
      leagueId: opts.leagueId,
      playerId: pick.p.id,
      capMode: opts.capMode,
      seasonYear: opts.seasonYear,
      week: opts.week,
    });
    cut.add(pick.p.id);
    released.push({ name: `${pick.p.firstName} ${pick.p.lastName}`, freed: pick.savings });
    remaining -= pick.savings;
  }
  return released;
}
