'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertLeagueOwner } from '@/lib/owner';
import { draftPlayer, runAiPicksUntilUser, draftOneAiPick } from '@/lib/draft';
import { Rng } from '@/lib/rng';

/**
 * Make the user's pick. The rookie contract is real cap money, so this can
 * be refused by the salary cap (see draftPlayer in lib/draft.ts) — a
 * foreseeable, user-recoverable outcome that must come back as a message
 * rather than an uncaught throw, which in Next blanks the draft screen
 * instead of saying what happened.
 */
export async function draftPlayerAction(leagueId: string, playerId: string, teamId: string) {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  try {
    await draftPlayer({ leagueId, playerId, teamId, seasonYear: league.seasonYear });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'That pick could not be made.' };
  }

  const rng = new Rng(`draft-${leagueId}-${Date.now()}`);
  await runAiPicksUntilUser(leagueId, teamId, rng, league.seasonYear);

  revalidatePath(`/league/${leagueId}`, 'layout');
  return { ok: true, message: 'Pick is in.' };
}

/**
 * Simulate every AI pick up to the user's next turn — needed the moment a
 * draft starts and the user isn't on the clock first, since previously the
 * only trigger for AI picks was the user making their OWN pick, leaving the
 * draft completely stuck with no way to advance past someone else's turn.
 */
export async function advanceToUserPickAction(leagueId: string, userTeamId: string) {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const rng = new Rng(`draft-skip-${leagueId}-${Date.now()}`);
  const picksMade = await runAiPicksUntilUser(leagueId, userTeamId, rng, league.seasonYear);
  revalidatePath(`/league/${leagueId}`, 'layout');
  return { picksMade };
}

/**
 * One visible AI pick at a time, for a paced/live draft-day feed the client
 * calls on a timer — a no-op returning null once the user is on the clock.
 */
export async function draftOneAiPickAction(leagueId: string, userTeamId: string) {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const rng = new Rng(`draft-tick-${leagueId}-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
  const result = await draftOneAiPick(leagueId, userTeamId, rng, league.seasonYear);
  revalidatePath(`/league/${leagueId}`, 'layout');
  return result;
}

export async function toggleShortlistAction(leagueId: string, teamId: string, playerId: string) {
  await assertLeagueOwner(leagueId);
  const existing = await prisma.shortlistEntry.findUnique({ where: { playerId_teamId: { playerId, teamId } } });
  if (existing) {
    await prisma.shortlistEntry.delete({ where: { id: existing.id } });
  } else {
    await prisma.shortlistEntry.create({ data: { playerId, teamId } });
  }
  revalidatePath(`/league/${leagueId}/draft`);
  return { shortlisted: !existing };
}
