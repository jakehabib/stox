'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { Rng } from '@/lib/rng';
import { readJson, writeJson } from '@/lib/json';
import { AttrMap } from '@/lib/ratings';
import { observe, confidenceGain, specialtyMatches } from '@/lib/scouting';
import { SCOUTING } from '@/lib/tuning';

/**
 * Spend the team's weekly scouting budget on a chosen player. A simple,
 * direct "assign points to this guy" flow rather than a full scout-by-scout
 * scheduling UI — matches the "reasonable placeholder" mandate for section 6.
 */
export async function scoutPlayerAction(leagueId: string, teamId: string, playerId: string, points: number) {
  const [player, scouts] = await Promise.all([
    prisma.player.findUniqueOrThrow({ where: { id: playerId } }),
    prisma.scout.findMany({ where: { teamId } }),
  ]);
  const bestScout = scouts.sort((a, b) => b.accuracy - a.accuracy)[0] ?? { accuracy: 50, specialty: 'ALL' };
  const specialtyMatch = specialtyMatches(bestScout.specialty, player.position as any);

  const existing = await prisma.scoutingReport.findUnique({ where: { playerId_teamId: { playerId, teamId } } });
  const currentConfidence = existing?.confidence ?? 0;
  const gained = confidenceGain(points, bestScout.accuracy, specialtyMatch);
  const nextConfidence = Math.min(100, currentConfidence + gained);

  const rng = new Rng(`scout-${playerId}-${teamId}-${Date.now()}`);
  const trueAttrs = readJson<AttrMap>(player.trueAttrs, {});
  const observed = observe(rng, player.position as any, trueAttrs, nextConfidence, bestScout.accuracy, specialtyMatch ? SCOUTING.SPECIALTY_BONUS : 0);

  await prisma.scoutingReport.upsert({
    where: { playerId_teamId: { playerId, teamId } },
    update: { confidence: nextConfidence, observed: writeJson(observed) },
    create: { playerId, teamId, confidence: nextConfidence, observed: writeJson(observed) },
  });

  revalidatePath(`/league/${leagueId}`, 'layout');
  return { confidence: Math.round(nextConfidence) };
}
