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
