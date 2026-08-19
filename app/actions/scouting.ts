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
  const [league, player, scouts] = await Promise.all([
    prisma.league.findUniqueOrThrow({ where: { id: leagueId } }),
    prisma.player.findUniqueOrThrow({ where: { id: playerId } }),
    prisma.scout.findMany({ where: { teamId } }),
  ]);
  const bestScout = scouts.sort((a, b) => b.accuracy - a.accuracy)[0] ?? { accuracy: 50, specialty: 'ALL' };
  const specialtyMatch = specialtyMatches(bestScout.specialty, player.position as any);

  // Composite so week 1 of a later season never collides with week 1 of an
  // earlier one (the week counter resets every season).
  const currentWeekStamp = league.seasonYear * 100 + league.week;

  const existing = await prisma.scoutingReport.findUnique({ where: { playerId_teamId: { playerId, teamId } } });
  // One scouting pass per player per week — otherwise the weekly budget the
  // settings screen advertises is fiction: you could spam the button and hit
  // 100% confidence on everyone in a single sitting.
  if (existing && existing.lastWeek === currentWeekStamp) {
    return { ok: false as const, confidence: Math.round(existing.confidence), message: 'Already scouted this player this week. Advance the week to send scouts out again.' };
  }
  const currentConfidence = existing?.confidence ?? 0;
  const gained = confidenceGain(points, bestScout.accuracy, specialtyMatch);
  const nextConfidence = Math.min(100, currentConfidence + gained);

  const rng = new Rng(`scout-${playerId}-${teamId}-${Date.now()}`);
  const trueAttrs = readJson<AttrMap>(player.trueAttrs, {});
  const observed = observe(rng, player.position as any, trueAttrs, nextConfidence, bestScout.accuracy, specialtyMatch ? SCOUTING.SPECIALTY_BONUS : 0, player.potential);

  await prisma.scoutingReport.upsert({
    where: { playerId_teamId: { playerId, teamId } },
    update: { confidence: nextConfidence, observed: writeJson(observed), lastWeek: currentWeekStamp },
    create: { playerId, teamId, confidence: nextConfidence, observed: writeJson(observed), lastWeek: currentWeekStamp },
  });

  revalidatePath(`/league/${leagueId}`, 'layout');
  return { ok: true as const, confidence: Math.round(nextConfidence) };
}
