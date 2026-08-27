'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { assertCanCreateLeague, assertLeagueOwner, currentViewer, ensureOwnerKey } from '@/lib/owner';
import { createLeague } from '@/lib/gen/league';
import { CAP_GROWTH_MODES, DEFAULT_SETTINGS, LeagueSettings, parseSettings, serializeSettings } from '@/lib/settings';
import { advanceWeek } from '@/lib/season';
import { loadRebuildStanding } from '@/lib/rebuildState';
// A plain string, so it CANNOT live in this file: a 'use server' module may
// only export async functions, and Next throws at request time — not at build
// and not under tsc — the moment one exports anything else. Caught by a
// scripted page load, which is the only thing that can catch it.
import { IRONMAN_REFUSAL } from '@/lib/rebuild';

/**
 * Whitelists for the enum-ish fields. These arrive as raw FormData, and a
 * Server Action is a public POST endpoint — the form is not the only thing
 * that can call it. Casting an arbitrary string straight into the settings
 * JSON let a crafted request write a difficulty of "" or a capMode nothing in
 * the codebase handles, which then fails much later, somewhere else, in a
 * league that already exists.
 *
 * That paragraph was true of league CREATION and only two thirds true of
 * `updateSettingsAction`, which cast capMode, difficulty and recapVerbosity
 * for as long as it existed. All of them go through `pick` now, and the
 * numbers beside them go through `num`.
 */
const LEAGUE_STARTS = ['RANDOM_ROSTERS', 'FANTASY_DRAFT', 'REBUILD'] as const;
const CAP_MODES = ['REALISTIC', 'SIMPLIFIED', 'OFF'] as const;
const DIFFICULTIES = ['EASY', 'NORMAL', 'HARD'] as const;
/** Read off the rung table itself, so a fourth rung cannot be added there and
 *  silently rejected here. */
const CAP_GROWTHS = Object.keys(CAP_GROWTH_MODES) as (keyof typeof CAP_GROWTH_MODES)[];

const RECAP_VERBOSITIES = ['SHORT', 'NORMAL', 'DETAILED'] as const;

function pick<T extends string>(raw: FormDataEntryValue | null, allowed: readonly T[], fallback: T): T {
  const v = String(raw ?? '');
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/**
 * ===========================================================================
 * THE NUMBERS ON THE SETTINGS FORM, KEPT INSIDE THEIR OWN RANGE
 * ===========================================================================
 * Every numeric setting was read as `Number(formData.get(k) || current[k])`
 * and written straight into the league's settings JSON. That has no floor, no
 * ceiling and no test that the result is even a number, and the form's inputs
 * carry no `min`/`max` — so this is not only a crafted-request problem, it is
 * what a player gets for typing into the box on the Settings screen:
 *
 *   "abc"      -> NaN      -> JSON.stringify writes `null`
 *   Infinity   -> Infinity -> JSON.stringify writes `null`
 *   -40        -> stored, and a negative trade-deadline week means the
 *                 deadline has ALWAYS passed: trading is off for the rest of
 *                 that save with no setting on the screen that says so.
 *   1e308      -> stored, and every rate built on it saturates.
 *
 * A `null` is worse than a wrong number, because `parseSettings` spreads the
 * stored blob over the defaults and `null` is a present key — so the default
 * does not come back and the value arrives at the sim as null.
 *
 * Clamped rather than refused, deliberately. A settings save that throws away
 * eleven correct fields because the twelfth was typed wrong is friction on the
 * common path to defend the rare one; the range is the rule, and a value
 * outside it lands on the nearest end of it. Blank still means "leave it as it
 * was", which is what the old `|| current` did and the only behaviour the
 * screen has ever had for an emptied box.
 * ===========================================================================
 */
function num(
  raw: FormDataEntryValue | null,
  current: number,
  min: number,
  max: number,
  opts?: { integer?: boolean },
): number {
  const text = String(raw ?? '').trim();
  if (text === '') return current;
  const n = Number(text);
  // Not a number at all, or NaN/Infinity: keep what the save already had
  // rather than storing a hole where a rate should be.
  if (!Number.isFinite(n)) return Number.isFinite(current) ? current : min;
  const clamped = Math.min(max, Math.max(min, n));
  return opts?.integer ? Math.round(clamped) : clamped;
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

/**
 * ===========================================================================
 * THE ONE-WAY DOOR OUT OF A REBUILD RUN
 * ===========================================================================
 * Always available while the run is live, and it costs the leaderboard entry
 * permanently — see the state machine in lib/rebuild.ts for why that is the
 * strict answer rather than a harsh one.
 *
 * A no-op in every state but LOCKED, and that is deliberate in both
 * directions. A save that has already WON is already unlocked, so stamping it
 * here would forfeit an entry it earned; a save already abandoned is already
 * through the door. `updateMany` gated on `rebuildAbandonedAt: null` makes it
 * idempotent against a double click and against two tabs at once — the second
 * write matches no row rather than moving the timestamp.
 */
export async function abandonRebuildAction(leagueId: string) {
  await assertLeagueOwner(leagueId);
  const standing = await loadRebuildStanding(leagueId);
  if (standing.state !== 'LOCKED') return;

  await prisma.league.updateMany({
    where: { id: leagueId, rebuildAbandonedAt: null },
    data: { rebuildAbandonedAt: new Date() },
  });
  revalidatePath(`/league/${leagueId}`, 'layout');
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
 *
 * That shape is also what makes the run interruptible. There is a seam between
 * every week where the client is holding the loop and nothing is mid-write, so
 * AdvanceWeekButton's Stop is checked there and the batch simply does not ask
 * for the next week. An opaque server loop would have had nowhere to put it
 * short of tearing up a half-written week — advanceWeek commits results,
 * progression, injuries, contracts and cap charges together, and none of the
 * rest of this codebase is written to read half of that.
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

  /**
   * THE IRONMAN LOCK, AND IT LIVES HERE RATHER THAN ON THE SCREEN.
   *
   * A Server Action is a public POST endpoint — the form is not the only thing
   * that can call it, which is the same reason the three enum whitelists above
   * exist. The Settings screen renders no controls for a locked run, and that
   * is presentation; THIS is the rule. The authority is a database read
   * (loadRebuildStanding), never anything the request carried.
   *
   * It refuses the WHOLE write, not the three pinned fields, because the owner
   * asked for an ironman mode with no changeable settings rather than three
   * locked ones — and a partial refusal would silently save the rest, which is
   * the worst of both answers.
   */
  const standing = await loadRebuildStanding(leagueId);
  if (standing.ironman) throw new Error(IRONMAN_REFUSAL);

  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const current: LeagueSettings = JSON.parse(league.settings);

  // `current` is a raw JSON.parse of whatever is stored, so its own values are
  // not trustworthy as fallbacks — a save already carrying a null or an
  // unrecognised enum would keep it forever. `safe` is the healed version, and
  // it is what every fallback below falls back TO.
  const safe = parseSettings(league.settings);

  const next: LeagueSettings = {
    ...current,
    // WHITELISTED, NOT CAST — and this is the file whose own header says why.
    // These two were the exception the comment above `LEAGUE_STARTS` did not
    // know it had: `String(...) as LeagueSettings['capMode']` accepted
    // anything, and a POST setting capMode to "BANANA" was stored, survived
    // parseSettings (which heals difficulty and capGrowth and never healed
    // this one), and left a save whose restructure tool answered "Restructuring
    // only applies in Realistic cap mode" on a league the Settings screen no
    // longer had a name for. A comment describing a rule two of its three
    // fields did not follow is the same bug as a wrong number.
    capMode: pick(formData.get('capMode'), CAP_MODES, safe.capMode),
    difficulty: pick(formData.get('difficulty'), DIFFICULTIES, safe.difficulty),
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
    // 0 is a legal answer — it means scouting runs on carry-over alone.
    scoutingBudgetPerWeek: num(formData.get('scoutingBudgetPerWeek'), safe.scoutingBudgetPerWeek, 0, 10_000, { integer: true }),
    // A multiplier, so 0 freezes development and 5 is already extreme. It may
    // not go negative: a negative speed inverts every growth roll into decline.
    progressionSpeed: num(formData.get('progressionSpeed'), safe.progressionSpeed, 0, 5),
    injuriesEnabled: formData.get('injuriesEnabled') === 'on',
    injurySeverity: num(formData.get('injurySeverity'), safe.injurySeverity, 0, 5),
    retirementEnabled: formData.get('retirementEnabled') === 'on',
    tradesEnabled: formData.get('tradesEnabled') === 'on',
    // Documented on the form as 0-1, and it is a probability; anything else
    // is not a rarer or commoner offer, it is a broken comparison.
    aiTradeFrequency: num(formData.get('aiTradeFrequency'), safe.aiTradeFrequency, 0, 1),
    tradeDeadlineEnabled: formData.get('tradeDeadlineEnabled') === 'on',
    // Inside the season it divides. Week 0 or a negative one is not "an early
    // deadline", it is a deadline that has passed on the first day of every
    // league year — trading switched off for the life of the save, with the
    // Settings screen still showing it as enabled.
    tradeDeadlineWeek: num(formData.get('tradeDeadlineWeek'), safe.tradeDeadlineWeek, 1, Math.max(1, safe.seasonLength), { integer: true }),
    franchiseTagEnabled: formData.get('franchiseTagEnabled') === 'on',
    aiAcceptsLopsided: formData.get('aiAcceptsLopsided') === 'on',
    forceTradeEnabled: formData.get('forceTradeEnabled') === 'on',
    simVariance: num(formData.get('simVariance'), safe.simVariance, 0, 5),
    homeFieldAdvantage: formData.get('homeFieldAdvantage') === 'on',
    recapVerbosity: pick(formData.get('recapVerbosity'), RECAP_VERBOSITIES, safe.recapVerbosity),
    // showAdvancedStats / autoAdvanceWeeks / confirmRiskyMoves are no longer
    // on the form — no system reads them, so the screen stopped offering
    // controls that do nothing. The `...current` spread above keeps whatever
    // an existing save already stored.
    //
    // AND NOTE WHAT IS NOT IN THIS OBJECT: `leagueStart`. It is carried by the
    // `...current` spread and never taken from `formData`, on any path, which
    // is what makes "a save that was not founded as a Rebuild can never become
    // one" a property of the code rather than a promise. Adding it here would
    // open a door the mode is designed not to have.
  };

  await prisma.league.update({ where: { id: leagueId }, data: { settings: serializeSettings(next) } });
  revalidatePath(`/league/${leagueId}/settings`);
}
