import { prisma } from './db';
import { CapMode } from './types';
import { capForYear, capHit } from './cap';
import { CAP } from './tuning';

export interface CapSummary {
  capTotal: number;
  activeSalary: number;
  deadMoney: number;
  capUsed: number;
  capSpace: number;
  rosterSize: number;
}

export async function teamCapSummary(teamId: string, seasonYear: number, mode: CapMode): Promise<CapSummary> {
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { leagueId: true } });
  const league = await prisma.league.findUniqueOrThrow({ where: { id: team.leagueId }, select: { seasonYear: true } });

  const players = await prisma.player.findMany({
    where: { teamId, status: 'ACTIVE' },
    include: { contract: true },
  });
  const deadRows = await prisma.capCharge.findMany({ where: { teamId, year: seasonYear } });

  const capTotal = mode === 'OFF' ? 0 : capForYear(seasonYear, league.seasonYear);
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
  };
}
