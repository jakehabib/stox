import { prisma } from './db';
import { readJson } from './json';
import { capHit } from './cap';
import { parseSettings } from './settings';
import { PHASE_LABELS } from './season';
import { SeasonStats } from './types';
import { ContractLike } from './cap';

/**
 * ===========================================================================
 * GAME INVARIANTS — mechanical checks for GAME_INVARIANTS.md
 * ===========================================================================
 * Every check here corresponds to a numbered rule in that document by ID.
 * Keep the two in sync: a check added here without a rule in the doc is
 * undocumented, and a rule in the doc without a check here is unverified.
 * ===========================================================================
 */

export interface Violation {
  id: string;
  severity: 'error' | 'warning';
  message: string;
  count: number;
  sample: string[];
}

const ACTIVE_STATUSES = new Set(['ACTIVE', 'FREE_AGENT', 'RETIRED']);
const VALID_PHASES = new Set(Object.keys(PHASE_LABELS));

function violation(id: string, severity: 'error' | 'warning', message: string, ids: string[]): Violation | null {
  if (ids.length === 0) return null;
  return { id, severity, message, count: ids.length, sample: ids.slice(0, 5) };
}

/** Full snapshot check — everything checkable from one point-in-time read of a league. */
export async function checkInvariants(leagueId: string): Promise<Violation[]> {
  const [league, players, contracts, picks, games, draftState] = await Promise.all([
    prisma.league.findUniqueOrThrow({ where: { id: leagueId } }),
    prisma.player.findMany({ where: { leagueId } }),
    prisma.contract.findMany({ where: { player: { leagueId } } }),
    prisma.draftPick.findMany({ where: { leagueId } }),
    prisma.game.findMany({ where: { leagueId, played: true } }),
    prisma.draftState.findUnique({ where: { leagueId } }),
  ]);
  const settings = parseSettings(league.settings);
  const contractByPlayerId = new Map(contracts.map((c) => [c.playerId, c]));

  const out: Violation[] = [];
  const push = (v: Violation | null) => { if (v) out.push(v); };

  // --- INV-01/02/03: status <-> teamId ---
  push(violation('INV-01', 'error', "status 'ACTIVE' with no team",
    players.filter((p) => p.status === 'ACTIVE' && p.teamId == null).map((p) => p.id)));
  push(violation('INV-02', 'error', "status 'FREE_AGENT'/'RETIRED' but still attached to a team",
    players.filter((p) => (p.status === 'FREE_AGENT' || p.status === 'RETIRED') && p.teamId != null).map((p) => p.id)));
  push(violation('INV-03', 'warning', 'status outside the {ACTIVE, FREE_AGENT, RETIRED} set actually used by the codebase',
    players.filter((p) => !ACTIVE_STATUSES.has(p.status)).map((p) => p.id)));

  // --- INV-04/05: ACTIVE <-> exactly one contract, owned by the right team ---
  push(violation('INV-04', 'error', 'ACTIVE player missing a contract, or contract team mismatched with roster team',
    players.filter((p) => {
      if (p.status !== 'ACTIVE') return false;
      const c = contractByPlayerId.get(p.id);
      return !c || c.teamId !== p.teamId;
    }).map((p) => p.id)));
  push(violation('INV-05', 'error', 'Non-active player still has a contract on file',
    players.filter((p) => p.status !== 'ACTIVE' && contractByPlayerId.has(p.id)).map((p) => p.id)));

  // --- INV-06/07: draftee eligibility ---
  push(violation('INV-06', 'error', 'isDraftee player is rostered to a team',
    players.filter((p) => p.isDraftee && p.teamId != null).map((p) => p.id)));
  push(violation('INV-07', 'error', 'isDraftee player has fallen behind the current season year — stale/undrafted prospect never re-entered free agency',
    players.filter((p) => p.isDraftee && p.draftYear != null && p.draftYear < league.seasonYear).map((p) => p.id)));

  // --- INV-08: roster size ceiling ---
  const activeByTeam = new Map<string, number>();
  for (const p of players) {
    if (p.status !== 'ACTIVE' || !p.teamId) continue;
    activeByTeam.set(p.teamId, (activeByTeam.get(p.teamId) ?? 0) + 1);
  }
  push(violation('INV-08', 'warning', `Team roster exceeds settings.rosterMax (${settings.rosterMax})`,
    [...activeByTeam.entries()].filter(([, n]) => n > settings.rosterMax).map(([teamId, n]) => `${teamId} (${n})`)));

  // --- INV-09/10: pick used <-> playerId ---
  push(violation('INV-09', 'error', 'DraftPick marked used with no player attached',
    picks.filter((p) => p.used && p.playerId == null).map((p) => p.id)));
  push(violation('INV-10', 'error', 'DraftPick has a player attached but is not marked used',
    picks.filter((p) => !p.used && p.playerId != null).map((p) => p.id)));

  // --- INV-11: duplicate pick slots ---
  const slotCounts = new Map<string, string[]>();
  for (const p of picks) {
    const key = `${p.year}-${p.round}-${p.slot}-${p.originalTeamId}`;
    (slotCounts.get(key) ?? slotCounts.set(key, []).get(key)!).push(p.id);
  }
  push(violation('INV-11', 'error', 'Duplicate DraftPick for the same (year, round, slot, originalTeam)',
    [...slotCounts.values()].filter((ids) => ids.length > 1).flat()));

  // --- INV-12: a completed rookie draft leaves no unused picks for that year ---
  if (draftState?.complete && draftState.kind === 'ROOKIE') {
    push(violation('INV-12', 'error', 'Rookie draft marked complete but unused picks remain for the current season year',
      picks.filter((p) => p.year === league.seasonYear && !p.used).map((p) => p.id)));
  }

  // --- INV-13: contract years bounds ---
  push(violation('INV-13', 'error', 'Contract.yearsRemaining outside [0, years]',
    contracts.filter((c) => c.yearsRemaining < 0 || c.yearsRemaining > c.years).map((c) => c.id)));

  // --- INV-14: cap hit never negative ---
  const negativeCapHits: string[] = [];
  for (const c of contracts) {
    for (const mode of ['REALISTIC', 'SIMPLIFIED'] as const) {
      if (capHit(c as ContractLike, mode) < 0) { negativeCapHits.push(`${c.id}(${mode})`); break; }
    }
  }
  push(violation('INV-14', 'error', 'capHit() returned a negative number for a contract', negativeCapHits));

  // --- INV-15: completed games have sane scores + a real box score ---
  push(violation('INV-15', 'error', 'Completed game has a negative score or an empty/unparseable box score',
    games.filter((g) => {
      if (g.homeScore < 0 || g.awayScore < 0) return true;
      const box = readJson<Record<string, unknown> | null>(g.boxScore, null);
      return !box || Object.keys(box).length === 0;
    }).map((g) => g.id)));

  // --- INV-16/17: phase/week sanity ---
  if (!VALID_PHASES.has(league.phase)) {
    out.push({ id: 'INV-16', severity: 'error', message: `League.phase '${league.phase}' is not a recognized phase`, count: 1, sample: [league.id] });
  }
  if (league.phase === 'REGULAR' && (league.week < 1 || league.week > settings.seasonLength)) {
    out.push({ id: 'INV-17', severity: 'error', message: `League.week ${league.week} out of range for REGULAR phase (1..${settings.seasonLength})`, count: 1, sample: [league.id] });
  }
  if (draftState?.complete && (league.phase === 'DRAFT' || league.phase === 'FANTASY_DRAFT')) {
    out.push({ id: 'INV-18', severity: 'error', message: `Draft is complete but League.phase is still '${league.phase}' — the league is stuck`, count: 1, sample: [league.id] });
  }

  return out;
}

/** Sum every numeric field across a batch of SeasonStats JSON strings. */
function sumStats(rows: string[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const raw of rows) {
    const s = readJson<SeasonStats>(raw, {});
    for (const [k, v] of Object.entries(s)) {
      if (typeof v !== 'number') continue;
      total[k] = (total[k] ?? 0) + v;
    }
  }
  return total;
}

/** Snapshot of league-wide season+career stat totals — call before and after a step to check INV-T1. */
export async function snapshotStatTotals(leagueId: string): Promise<{ season: Record<string, number>; career: Record<string, number> }> {
  const players = await prisma.player.findMany({ where: { leagueId }, select: { seasonStats: true, careerStats: true } });
  return {
    season: sumStats(players.map((p) => p.seasonStats)),
    career: sumStats(players.map((p) => p.careerStats)),
  };
}

/** INV-T1: after a season roll, nothing should be lost or double-counted moving season -> career. */
export function checkStatRollup(before: Awaited<ReturnType<typeof snapshotStatTotals>>, after: Awaited<ReturnType<typeof snapshotStatTotals>>): Violation[] {
  const out: Violation[] = [];
  const keys = new Set([...Object.keys(before.season), ...Object.keys(before.career), ...Object.keys(after.career)]);
  const bad: string[] = [];
  for (const k of keys) {
    const expectedCareer = (before.career[k] ?? 0) + (before.season[k] ?? 0);
    const actualCareer = after.career[k] ?? 0;
    // Allow tiny float drift; these are all whole-number counting stats in practice.
    if (Math.abs(expectedCareer - actualCareer) > 1) bad.push(`${k}: expected ${expectedCareer}, got ${actualCareer}`);
  }
  if (bad.length > 0) out.push({ id: 'INV-T1', severity: 'error', message: 'Season stats did not fully roll into career stats', count: bad.length, sample: bad.slice(0, 5) });
  return out;
}
