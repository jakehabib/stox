'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { draftPlayer, runAiPicksUntilUser } from '@/lib/draft';
import { Rng } from '@/lib/rng';

export async function draftPlayerAction(leagueId: string, playerId: string, teamId: string) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  await draftPlayer({ leagueId, playerId, teamId, seasonYear: league.seasonYear });

  const rng = new Rng(`draft-${leagueId}-${Date.now()}`);
  await runAiPicksUntilUser(leagueId, teamId, rng, league.seasonYear);

  revalidatePath(`/league/${leagueId}`, 'layout');
}

/**
 * Simulate every AI pick up to the user's next turn — needed the moment a
 * draft starts and the user isn't on the clock first, since previously the
 * only trigger for AI picks was the user making their OWN pick, leaving the
 * draft completely stuck with no way to advance past someone else's turn.
 */
export async function advanceToUserPickAction(leagueId: string, userTeamId: string) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const rng = new Rng(`draft-skip-${leagueId}-${Date.now()}`);
  const picksMade = await runAiPicksUntilUser(leagueId, userTeamId, rng, league.seasonYear);
  revalidatePath(`/league/${leagueId}`, 'layout');
  return { picksMade };
}
