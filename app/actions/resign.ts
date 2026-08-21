'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertLeagueOwner } from '@/lib/owner';
import { parseSettings } from '@/lib/settings';
import { resignDecisionsForTeam } from '@/lib/season';
import { Rng } from '@/lib/rng';

/** Delegate every pending re-sign decision on the user's own team — expired and walk-year alike — to the same AI logic that runs each AI team's offseason. */
export async function letAiResignAction(leagueId: string) {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = parseSettings(league.settings);
  const team = await prisma.team.findFirstOrThrow({ where: { leagueId, isUser: true } });
  const rng = new Rng(`resign-delegate-${leagueId}-${league.seasonYear}-${league.week}`);
  const result = await resignDecisionsForTeam(leagueId, team.id, league.seasonYear, league.week, settings.capMode, rng);
  revalidatePath(`/league/${leagueId}`, 'layout');
  return result;
}
