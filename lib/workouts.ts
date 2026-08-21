import { prisma } from './db';
import { Rng, clamp } from './rng';
import { readJson, writeJson } from './json';
import { observe } from './scouting';
import { ATTRIBUTE_BY_KEY, attrsForPosition } from './ratings';
import type { AttrMap } from './ratings';
import { SCOUTING, WORKOUTS } from './tuning';
import type { Position } from './tuning';
import {
  loadDynastyProfile, parseSkills, rankOf,
  type LimitedUse, type SkillRanks,
} from './dynasty';

/**
 * ===========================================================================
 * PRIVATE WORKOUTS — the one deliberate, scarce choice in scouting
 * ===========================================================================
 * The consensus board is free and the shortlist costs nothing to work. That
 * is the point of both, but a system with no scarce decision in it anywhere
 * has no moment where the GM has to commit. Workouts are that moment, and
 * they are the only one.
 *
 * A handful of slots in the run-up to the draft. Each one is a big, discrete
 * reveal on exactly one prospect: your people fly him in, put him through
 * their own testing, run the medical, and sit in a room with him. You get
 * four or five of these a year against a class of hundreds, so the question
 * is never "should I work somebody out" — it is "which four".
 *
 * HOW THIS DIFFERS FROM FULL SCOUT, which already exists and already works.
 * They must not be two names for the same button:
 *
 *   FULL SCOUT (lib/dynasty.ts, fullScoutAction) is omniscience. Every
 *   attribute exact, potential exact, fog gone. It is a Dynasty entitlement,
 *   available in any phase, on anybody in the league — a veteran on another
 *   roster, a free agent, a prospect. Two a year.
 *
 *   A WORKOUT is a real event with real limits. It measures what can be
 *   measured — the combine-measurable traits come back exact — collapses the
 *   ceiling projection to something narrow, and gets you a character and
 *   development read from a day in the building. It tells you NOTHING exact
 *   about instincts, decision making or awareness, because a workout cannot:
 *   those stay ranges, and they are the traits that bust a pick. Prospects
 *   only, pre-draft only.
 *
 * So Full Scout answers "what is he", and a workout answers "how high is the
 * ceiling and what is he like". A workout NEVER sets fullyRevealed, never
 * locks the mental traits, and never collapses the potential range to a
 * point. The fog-of-war contract in lib/scouting.ts holds.
 *
 * TUNING lives in lib/tuning.ts's WORKOUTS block, with every other balance
 * number in the game.
 * ===========================================================================
 */

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/** Slots a GM gets this league year: the baseline entitlement plus Scouting Network. Single source of truth — the action re-derives the cap from here. */
export function workoutMax(skills: SkillRanks): number {
  return WORKOUTS.BASE_SLOTS + rankOf(skills, 'SCOUTING_NETWORK') * WORKOUTS.SLOTS_PER_NETWORK_RANK;
}

export function workoutsOpen(phase: string): boolean {
  return WORKOUTS.PHASES.includes(phase);
}

/** What the UI tells the user about the window, whether or not it is open right now. */
export function workoutWindowLabel(phase: string): string {
  if (phase === 'RESIGN') return 'Workout window is open — through the end of free agency.';
  if (phase === 'FREE_AGENCY') return 'Workout window is open — it closes when the draft goes on the clock.';
  if (phase === 'DRAFT' || phase === 'FANTASY_DRAFT') return 'The draft is on the clock. Workouts closed for this class.';
  return 'Workouts open after the season, once the class is set — through the re-sign window and free agency.';
}

export interface WorkoutSlots extends LimitedUse {
  /** True when the phase allows a workout to be scheduled right now. */
  open: boolean;
  windowLabel: string;
  seasonYear: number;
}

/**
 * The workout half of the Dynasty profile.
 *
 * Read separately from loadDynastyProfile rather than through it because
 * DynastyProfileRow — the shape that function promises — is declared in
 * lib/dynasty.ts, which this workstream does not own. Calling it first is
 * still load-bearing: it is what creates the row for a save that has never
 * opened the Dynasty screen, so the counters have somewhere to live.
 */
async function loadWorkoutLedger(leagueId: string): Promise<{ skills: string; workoutYear: number; workoutUsed: number }> {
  const profile = await loadDynastyProfile(leagueId);
  const ledger = await prisma.dynastyProfile
    .findUnique({ where: { leagueId }, select: { workoutYear: true, workoutUsed: true } })
    .catch(() => null);
  return { skills: profile.skills, workoutYear: ledger?.workoutYear ?? 0, workoutUsed: ledger?.workoutUsed ?? 0 };
}

/** Live slot count for a league. Cheap enough for any server component. */
export async function loadWorkoutSlots(leagueId: string): Promise<WorkoutSlots> {
  const [league, profile] = await Promise.all([
    prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { seasonYear: true, phase: true } }),
    loadWorkoutLedger(leagueId),
  ]);
  const max = workoutMax(parseSkills(profile.skills));
  // A counter stamped with a previous league year is stale by definition, the
  // same rule lib/dynasty.ts's limitedUse() applies to Full Scout.
  const used = profile.workoutYear === league.seasonYear ? clamp(profile.workoutUsed, 0, max) : 0;
  return {
    unlocked: true,
    max,
    used,
    remaining: Math.max(0, max - used),
    open: workoutsOpen(league.phase),
    windowLabel: workoutWindowLabel(league.phase),
    seasonYear: league.seasonYear,
  };
}

// ---------------------------------------------------------------------------
// Running one
// ---------------------------------------------------------------------------

export interface WorkoutResult {
  ok: boolean;
  message: string;
  remaining?: number;
  max?: number;
  /** Attribute keys this workout pinned to their true value. */
  measured?: string[];
  confidence?: number;
  /** The player's development trait, now that a day in the building surfaced it. */
  devTrait?: string | null;
}

function profileUpsert(leagueId: string, data: { workoutYear: number; workoutUsed: number }) {
  // Keyed on leagueId rather than the row id for the reason app/actions/dynasty.ts
  // documents: loadDynastyProfile can hand back an in-memory default with no id.
  return prisma.dynastyProfile.upsert({
    where: { leagueId },
    create: { ownerKind: 'LEAGUE', ownerKey: leagueId, leagueId, ...data },
    update: data,
  });
}

/**
 * Spend one slot on one prospect.
 *
 * Every rule the UI advertises is enforced here and re-derived from the
 * database, so a client that lies about its remaining slots gets the same
 * answer as one that does not.
 */
export async function runWorkout(leagueId: string, teamId: string, playerId: string): Promise<WorkoutResult> {
  const [league, player, team] = await Promise.all([
    prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { seasonYear: true, phase: true } }),
    prisma.player.findUnique({
      where: { id: playerId },
      select: {
        id: true, leagueId: true, firstName: true, lastName: true, position: true,
        trueAttrs: true, potential: true, devTrait: true, isDraftee: true,
      },
    }),
    prisma.team.findUnique({ where: { id: teamId }, select: { id: true, leagueId: true } }),
  ]);

  if (!player || player.leagueId !== leagueId) return { ok: false, message: 'That player is not in this league.' };
  if (!team || team.leagueId !== leagueId) return { ok: false, message: 'That team is not in this league.' };
  if (!player.isDraftee) {
    return { ok: false, message: 'Private workouts are for draft prospects. Players already in the league have tape.' };
  }
  if (!workoutsOpen(league.phase)) {
    return { ok: false, message: workoutWindowLabel(league.phase) };
  }

  const profile = await loadWorkoutLedger(leagueId);
  const max = workoutMax(parseSkills(profile.skills));
  const used = profile.workoutYear === league.seasonYear ? clamp(profile.workoutUsed, 0, max) : 0;
  if (used >= max) {
    return { ok: false, message: `No workout slots left. All ${max} reset when the new league year starts.`, remaining: 0, max };
  }

  const existing = await prisma.scoutingReport.findUnique({ where: { playerId_teamId: { playerId, teamId } } });
  if (existing?.fullyRevealed) {
    return { ok: false, message: 'You already have a complete file on him — a workout would tell you nothing new.', remaining: max - used, max };
  }
  if (existing?.workoutYear === league.seasonYear) {
    return { ok: false, message: 'You already worked him out this year.', remaining: max - used, max };
  }

  const position = player.position as Position;
  const trueAttrs = readJson<AttrMap>(player.trueAttrs, {});
  const positionAttrs = attrsForPosition(position);

  const before = existing?.confidence ?? SCOUTING.ROOKIE_BASE_CONFIDENCE;
  const floored = Math.max(before, WORKOUTS.CONFIDENCE_FLOOR);
  const confidence = Math.round(clamp(
    floored + (100 - floored) * WORKOUTS.CONFIDENCE_CLOSE,
    0,
    WORKOUTS.CONFIDENCE_CAP,
  ));
  const potConfidence = Math.max(existing?.potConfidence ?? 0, WORKOUTS.POT_CONFIDENCE);

  // What a facility can actually measure. Capped so the card never becomes
  // all-locked: a prospect whose file already has locked traits gets fewer
  // new ones, not a collapsed overall.
  const alreadyLocked = readJson<string[]>(existing?.attrsRevealed ?? null, []);
  const room = Math.max(0, Math.floor(positionAttrs.length * WORKOUTS.MAX_LOCKED_FRACTION) - alreadyLocked.length);
  const measurable = positionAttrs
    .filter((k) => !alreadyLocked.includes(k))
    .filter((k) => (ATTRIBUTE_BY_KEY[k]?.scoutDifficulty ?? 0.5) <= WORKOUTS.MEASURABLE_DIFFICULTY)
    // Easiest to measure first, so the cap trims the marginal ones rather
    // than whichever happened to be declared last in lib/ratings.ts.
    .sort((a, b) => (ATTRIBUTE_BY_KEY[a]?.scoutDifficulty ?? 1) - (ATTRIBUTE_BY_KEY[b]?.scoutDifficulty ?? 1))
    .slice(0, room);
  const locked = Array.from(new Set([...alreadyLocked, ...measurable]));

  // Deterministic per (team, player, year): re-running a workout that somehow
  // got repeated produces the identical file rather than a fresh set of dice.
  const rng = new Rng(`workout-${leagueId}-${teamId}-${playerId}-${league.seasonYear}`);
  const observed = observe(rng, position, trueAttrs, confidence, 85, SCOUTING.SPECIALTY_BONUS, player.potential);
  // Everything measured comes back exact — that is the whole promise of
  // flying him in. buildScoutedView reads attrsRevealed to render these as a
  // point rather than a band, and the stored observation has to agree with
  // that or the two disagree about the same number.
  for (const k of measurable) observed[k] = clamp(Math.round(trueAttrs[k] ?? 50), 20, 99);

  const payload = {
    confidence,
    potConfidence,
    observed: writeJson(observed),
    attrsRevealed: writeJson(locked),
    // The intangibles read. A day in the building is how a front office forms
    // an opinion on how hard somebody works, which is exactly what devTrait is.
    devRevealed: true,
    workoutYear: league.seasonYear,
    notes: workoutNote(player.devTrait, measurable.length),
  };

  await prisma.$transaction([
    prisma.scoutingReport.upsert({
      where: { playerId_teamId: { playerId, teamId } },
      create: { playerId, teamId, ...payload },
      update: payload,
    }),
    profileUpsert(leagueId, { workoutYear: league.seasonYear, workoutUsed: used + 1 }),
  ]);

  const remaining = max - (used + 1);
  return {
    ok: true,
    message: `${player.firstName} ${player.lastName} worked out. ${remaining} of ${max} slot${max === 1 ? '' : 's'} left this year.`,
    remaining,
    max,
    measured: measurable,
    confidence,
    devTrait: player.devTrait,
  };
}

/** [PLACEHOLDER copy] What the report reads after a workout. Says what is now known AND what still isn't. */
export function workoutNote(devTrait: string, measuredCount: number): string {
  return `Private workout. We ran our own testing — ${measuredCount} trait${measuredCount === 1 ? '' : 's'} `
    + `measured in-house and pinned down — sat with him for a full day, and came away with a firm read on his `
    + `development curve: ${devTrait}. The ceiling projection is as tight as we can get it without seeing him play a `
    + `real down. What a workout still can't tell us is how he processes a defense on third down.`;
}

// ---------------------------------------------------------------------------
// Season boundary
// ---------------------------------------------------------------------------

/**
 * Zero the slot counter onto a new league year.
 *
 * Strictly speaking redundant — loadWorkoutSlots already treats a counter
 * stamped with an older year as zero, which is what makes the ledger
 * self-healing for saves that predate it. The hook exists so the number on
 * screen turns over the moment the calendar does, instead of the first time
 * the user spends a slot. Idempotent: a profile already stamped with the new
 * year is left alone.
 */
export async function resetWorkoutSlots(leagueId: string, seasonYear: number): Promise<void> {
  await prisma.dynastyProfile.updateMany({
    where: { leagueId, workoutYear: { not: seasonYear } },
    data: { workoutYear: seasonYear, workoutUsed: 0 },
  });
}
