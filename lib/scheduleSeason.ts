import { prisma } from './db';
import { Rng } from './rng';
import { buildSchedule } from './schedule';

/**
 * Writes a regular-season schedule for one league year.
 *
 * This exists because buildSchedule() had exactly one caller — createLeague()
 * — and the offseason pipeline had no schedule step at all. A league was born
 * with 272 games in the table and never got another one, so every season after
 * the first played zero football: the Advance button stayed green, the toast
 * read "Week 1 complete: 0 games played," and the only tell on the dashboard
 * was the next-opponent strip quietly failing to render. Verified across a
 * whole database of saves before the fix: one league sat in 2028 regular
 * season week 4 with no 2028 games at all, and another in 2029 had games only
 * for 2026 plus four playoff fixtures per later year.
 *
 * Idempotent by design. It returns 0 rather than duplicating if a schedule for
 * this year already exists, so the caller can invoke it defensively on every
 * pass through the preseason without needing to know whether the league was
 * just created (where createLeague already wrote one) or has rolled over.
 */
export async function ensureSeasonSchedule(
  leagueId: string,
  seasonYear: number,
  rng: Rng,
  weeks: number,
): Promise<number> {
  const existing = await prisma.game.count({ where: { leagueId, seasonYear, kind: 'REGULAR' } });
  if (existing > 0) return 0;

  // Ordered so the index buildSchedule() works in maps back to a stable team.
  // The scheduler is index-based and conference/division aware, so the only
  // thing that has to be consistent is the mapping we hand back to it.
  const teams = await prisma.team.findMany({
    where: { leagueId },
    orderBy: [{ conference: 'asc' }, { division: 'asc' }, { abbr: 'asc' }],
    select: { id: true, conference: true, division: true },
  });
  if (teams.length === 0) return 0;

  const scheduled = buildSchedule(
    teams.map((t, idx) => ({ idx, conference: t.conference, division: t.division })),
    rng,
    weeks,
  );

  const rows = scheduled.map((g) => ({
    leagueId,
    seasonYear,
    week: g.week,
    kind: 'REGULAR',
    homeTeamId: teams[g.homeIdx].id,
    awayTeamId: teams[g.awayIdx].id,
  }));

  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.game.createMany({ data: rows.slice(i, i + CHUNK) });
  }
  return rows.length;
}
