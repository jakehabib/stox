'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { assertCanCreateLeague, assertLeagueOwner, currentViewer, ensureOwnerKey } from '@/lib/owner';
import { createLeague } from '@/lib/gen/league';
import { CAP_GROWTH_MODES, DEFAULT_SETTINGS, LeagueSettings, parseSettings, serializeSettings } from '@/lib/settings';
import { advanceWeek } from '@/lib/season';

/**
 * Whitelists for the three enum-ish fields. These arrive as raw FormData, and
 * a Server Action is a public POST endpoint — the form is not the only thing
 * that can call it. Casting an arbitrary string straight into the settings
 * JSON let a crafted request write a difficulty of "" or a capMode nothing in
 * the codebase handles, which then fails much later, somewhere else, in a
 * league that already exists.
 */
const LEAGUE_STARTS = ['RANDOM_ROSTERS', 'FANTASY_DRAFT'] as const;
const CAP_MODES = ['REALISTIC', 'SIMPLIFIED', 'OFF'] as const;
const DIFFICULTIES = ['EASY', 'NORMAL', 'HARD'] as const;
/** Read off the rung table itself, so a fourth rung cannot be added there and
 *  silently rejected here. */
const CAP_GROWTHS = Object.keys(CAP_GROWTH_MODES) as (keyof typeof CAP_GROWTH_MODES)[];

function pick<T extends string>(raw: FormDataEntryValue | null, allowed: readonly T[], fallback: T): T {
  const v = String(raw ?? '');
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** League names are shown in lists and page titles; an unbounded one is a
 *  layout problem in every one of them, and a free text column to fill. */
const MAX_LEAGUE_NAME = 60;

export async function createLeagueAction(formData: FormData) {
  // Mint the owner key FIRST. It used to be read after generation, purely to
  // stamp the finished league — which meant there was no identity to count
  // against until ~5,300 rows had already been written. The limit check needs
  // the key before any of that work starts, and stamping with the same value
  // afterwards keeps the count and the stamp in agreement.
  //
  // The cookie is minted even when signed in. It costs nothing, and it keeps
  // one invariant true everywhere: every league has an ownerKey, so signing
  // out never leaves a save with no route back to its creator.
  const ownerKey = ensureOwnerKey();
  const viewer = { ...(await currentViewer()), ownerKey };
  await assertCanCreateLeague(viewer);

  const rawName = String(formData.get('name') || '').trim();
  const name = (rawName || 'My League').slice(0, MAX_LEAGUE_NAME);
  const userTeamAbbr = String(formData.get('userTeamAbbr') || 'STL');
  const leagueStart = pick(formData.get('leagueStart'), LEAGUE_STARTS, 'RANDOM_ROSTERS');
  const capMode = pick(formData.get('capMode'), CAP_MODES, 'REALISTIC');
  const difficulty = pick(formData.get('difficulty'), DIFFICULTIES, 'NORMAL');
  // The founding decision about how fast the ceiling climbs. The create-league
  // screen does not offer the control yet (it belongs beside cap mode in
  // components/CreateLeagueForm.tsx); until it does, every new league is
  // founded on the default rung, which is what this fallback says.
  const capGrowth = pick(formData.get('capGrowth'), CAP_GROWTHS, DEFAULT_SETTINGS.capGrowth);

  const leagueId = await createLeague({
    name,
    userTeamAbbr,
    settings: { ...DEFAULT_SETTINGS, leagueStart, capMode, difficulty, capGrowth },
  });

  // Stamp the save the moment it exists, so it is never briefly visible to,
  // or deletable by, anyone else. `userId` goes on in the same write when
  // someone is signed in, so a league created by an account is account-owned
  // immediately rather than waiting for the next claim.
  await prisma.league.update({ where: { id: leagueId }, data: { ownerKey, userId: viewer.userId } });

  // Into the handover screen, not straight onto the dashboard. app/start/[id]
  // is the first moment a real team rating exists — it reads the league that
  // was just written with buildLeagueRatings — so it is where the club is
  // introduced with its actual overall, its actual league rank and its actual
  // division rivals. The dashboard is one click further on.
  redirect(`/start/${leagueId}`);
}

export async function deleteLeagueAction(leagueId: string) {
  await assertLeagueOwner(leagueId);
  await prisma.league.delete({ where: { id: leagueId } });
  revalidatePath('/');
}

export async function advanceWeekAction(leagueId: string) {
  await assertLeagueOwner(leagueId);
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
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings: LeagueSettings = JSON.parse(league.settings);
  return { phase: league.phase, week: league.week, seasonYear: league.seasonYear, seasonLength: settings.seasonLength };
}

export type AdvanceMode = 'week' | '3weeks' | 'midseason' | 'playoffs' | 'offseason' | 'nextstage';

export async function updateSettingsAction(leagueId: string, formData: FormData) {
  await assertLeagueOwner(leagueId);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const current: LeagueSettings = JSON.parse(league.settings);

  const next: LeagueSettings = {
    ...current,
    capMode: String(formData.get('capMode') || current.capMode) as LeagueSettings['capMode'],
    difficulty: String(formData.get('difficulty') || current.difficulty) as LeagueSettings['difficulty'],
    // Whitelisted rather than cast, unlike its two neighbours above: this one
    // indexes a table of RATES, and an unrecognised rung would compound the
    // whole league's ceiling at undefined. The fallback goes through
    // parseSettings rather than `current`, because `current` is a raw
    // JSON.parse: on a save written before this setting existed the key is
    // simply absent, and only parseSettings knows that absence means the 7%
    // the league has been played at all along.
    capGrowth: pick(formData.get('capGrowth'), CAP_GROWTHS, parseSettings(league.settings).capGrowth),
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
    // showAdvancedStats / autoAdvanceWeeks / confirmRiskyMoves are no longer
    // on the form — no system reads them, so the screen stopped offering
    // controls that do nothing. The `...current` spread above keeps whatever
    // an existing save already stored.
  };

  await prisma.league.update({ where: { id: leagueId }, data: { settings: serializeSettings(next) } });
  revalidatePath(`/league/${leagueId}/settings`);
}
