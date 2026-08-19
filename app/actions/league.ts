'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { createLeague } from '@/lib/gen/league';
import { DEFAULT_SETTINGS, LeagueSettings, serializeSettings } from '@/lib/settings';
import { advanceWeek } from '@/lib/season';

export async function createLeagueAction(formData: FormData) {
  const name = String(formData.get('name') || 'My League');
  const userTeamAbbr = String(formData.get('userTeamAbbr') || 'STL');
  const leagueStart = String(formData.get('leagueStart') || 'RANDOM_ROSTERS') as LeagueSettings['leagueStart'];
  const capMode = String(formData.get('capMode') || 'REALISTIC') as LeagueSettings['capMode'];
  const difficulty = String(formData.get('difficulty') || 'PRO') as LeagueSettings['difficulty'];

  const leagueId = await createLeague({
    name,
    userTeamAbbr,
    settings: { ...DEFAULT_SETTINGS, leagueStart, capMode, difficulty },
  });

  redirect(`/league/${leagueId}`);
}

export async function deleteLeagueAction(leagueId: string) {
  await prisma.league.delete({ where: { id: leagueId } });
  revalidatePath('/');
}

export async function advanceWeekAction(leagueId: string) {
  const result = await advanceWeek(leagueId);
  revalidatePath(`/league/${leagueId}`, 'layout');
  return result;
}

export type AdvanceMode = 'week' | '3weeks' | 'midseason' | 'playoffs' | 'offseason';

/**
 * Phases that need the user to actually do something before the sim should
 * keep going — never blow past these no matter what multi-week target was
 * requested.
 */
const GATE_PHASES = new Set(['RESIGN', 'DRAFT', 'FANTASY_DRAFT']);
const MAX_ITERATIONS = 60; // safety backstop, not a real target

export async function advanceMultipleAction(leagueId: string, mode: AdvanceMode) {
  const league0 = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings: LeagueSettings = JSON.parse(league0.settings);
  const startPhase = league0.phase;
  const midseasonWeek = Math.ceil(settings.seasonLength / 2);

  let summary = '';
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    const before = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
    if (GATE_PHASES.has(before.phase)) break;
    if (mode === 'midseason' && before.phase === 'REGULAR' && before.week >= midseasonWeek) break;
    if (mode === 'playoffs' && before.phase === 'PLAYOFFS') break;
    if (mode === 'offseason' && before.phase === 'OFFSEASON') break;

    const result = await advanceWeek(leagueId);
    summary = result.summary;
    iterations++;
    if (mode === 'week') break;

    const after = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
    if (GATE_PHASES.has(after.phase)) break;
    if (mode === '3weeks' && (iterations >= 3 || after.phase !== startPhase)) break;
    if (mode === 'midseason' && (after.phase !== 'REGULAR' || after.week >= midseasonWeek)) break;
    if (mode === 'playoffs' && after.phase !== 'REGULAR' && after.phase !== 'PRESEASON') break;
    if (mode === 'offseason' && after.phase === 'OFFSEASON') break;
  }

  revalidatePath(`/league/${leagueId}`, 'layout');
  return { summary, weeksAdvanced: iterations };
}

export async function updateSettingsAction(leagueId: string, formData: FormData) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const current: LeagueSettings = JSON.parse(league.settings);

  const next: LeagueSettings = {
    ...current,
    capMode: String(formData.get('capMode') || current.capMode) as LeagueSettings['capMode'],
    difficulty: String(formData.get('difficulty') || current.difficulty) as LeagueSettings['difficulty'],
    scoutingEnabled: formData.get('scoutingEnabled') === 'on',
    revealTrueRatings: formData.get('revealTrueRatings') === 'on',
    fogOnOwnRoster: formData.get('fogOnOwnRoster') === 'on',
    scoutingBudgetPerWeek: Number(formData.get('scoutingBudgetPerWeek') || current.scoutingBudgetPerWeek),
    progressionSpeed: Number(formData.get('progressionSpeed') || current.progressionSpeed),
    injuriesEnabled: formData.get('injuriesEnabled') === 'on',
    injurySeverity: Number(formData.get('injurySeverity') || current.injurySeverity),
    retirementEnabled: formData.get('retirementEnabled') === 'on',
    tradesEnabled: formData.get('tradesEnabled') === 'on',
    aiTradeFrequency: Number(formData.get('aiTradeFrequency') || current.aiTradeFrequency),
    franchiseTagEnabled: formData.get('franchiseTagEnabled') === 'on',
    aiAcceptsLopsided: formData.get('aiAcceptsLopsided') === 'on',
    simVariance: Number(formData.get('simVariance') || current.simVariance),
    homeFieldAdvantage: formData.get('homeFieldAdvantage') === 'on',
    recapVerbosity: String(formData.get('recapVerbosity') || current.recapVerbosity) as LeagueSettings['recapVerbosity'],
    showAdvancedStats: formData.get('showAdvancedStats') === 'on',
    autoAdvanceWeeks: formData.get('autoAdvanceWeeks') === 'on',
    confirmRiskyMoves: formData.get('confirmRiskyMoves') === 'on',
  };

  await prisma.league.update({ where: { id: leagueId }, data: { settings: serializeSettings(next) } });
  revalidatePath(`/league/${leagueId}/settings`);
}
