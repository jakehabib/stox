import { prisma } from './db';
import { CapMode } from './types';
import { capForYear, capHit } from './cap';
import { CAP } from './tuning';
import { resolveStartYear } from './leagueYear';

export interface CapSummary {
  capTotal: number;
  activeSalary: number;
  deadMoney: number;
  capUsed: number;
  /**
   * Room left under the ceiling. In OFF mode this is deliberately
   * `Number.POSITIVE_INFINITY`, NOT 0 — the AI's offer sizing (maxOffer,
   * runAiFreeAgencyWave, fillRosterForTeam) budgets against it, and a 0
   * would silently stop every CPU team from signing anyone in a league
   * with the cap switched off.
   *
   * That makes it unsafe to render directly: formatMoney(Infinity) prints
   * "$InfinityM". Branch on `capEnabled` before displaying any figure from
   * this summary.
   */
  capSpace: number;
  rosterSize: number;
  /** False only when capMode is OFF. The single flag UI should branch on. */
  capEnabled: boolean;
}

export async function teamCapSummary(teamId: string, seasonYear: number, mode: CapMode): Promise<CapSummary> {
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { leagueId: true } });
  const league = await prisma.league.findUniqueOrThrow({
    where: { id: team.leagueId },
    select: { id: true, seasonYear: true, startYear: true },
  });

  const players = await prisma.player.findMany({
    where: { teamId, status: 'ACTIVE' },
    include: { contract: true },
  });
  const deadRows = await prisma.capCharge.findMany({ where: { teamId, year: seasonYear } });

  // The SECOND argument is the league's FOUNDING year, not the current one.
  // Passing the current season here made `elapsed` zero every time, which
  // pinned the ceiling at CAP.BASE_CAP for the life of every league.
  const capTotal = mode === 'OFF' ? 0 : capForYear(seasonYear, await resolveStartYear(league));
  const activeSalary = players.reduce((sum, p) => sum + capHit(p.contract, mode), 0);
  const deadMoney = mode === 'OFF' ? 0 : deadRows.reduce((s, r) => s + r.amount, 0);
  const capUsed = activeSalary + deadMoney;

  return {
    capTotal,
    activeSalary,
    deadMoney,
    capUsed,
    capSpace: mode === 'OFF' ? Number.POSITIVE_INFINITY : capTotal - capUsed,
    rosterSize: players.length,
    capEnabled: mode !== 'OFF',
  };
}
