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
  // `result.blocked` means the salary-cap compliance gate refused to move
  // time (see capComplianceBlock in lib/season.ts). It is a normal, fully
  // explained outcome — not an error — so it comes back as data the button
  // can render, never as a throw that blanks the page.
  const result = await advanceWeek(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  revalidatePath(`/league/${leagueId}`, 'layout');
  return { ...result, phase: league.phase, week: league.week, seasonYear: league.seasonYear };
}

/**
 * Cheap phase/week peek so a multi-week advance can be driven step-by-step
 * from the client (one advanceWeekAction call per week, with real progress
 * shown between each) instead of one opaque server-side loop the UI can't
 * see inside of.
 */
export async function getLeaguePhaseAction(leagueId: string) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings: LeagueSettings = JSON.parse(league.settings);
  return { phase: league.phase, week: league.week, seasonYear: league.seasonYear, seasonLength: settings.seasonLength };
}

export type AdvanceMode = 'week' | '3weeks' | 'midseason' | 'playoffs' | 'offseason' | 'nextstage';

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
    tradeDeadlineEnabled: formData.get('tradeDeadlineEnabled') === 'on',
    tradeDeadlineWeek: Number(formData.get('tradeDeadlineWeek') || current.tradeDeadlineWeek),
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
