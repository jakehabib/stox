import { prisma } from './db';
import { Rng, clamp } from './rng';
import { readJson, writeJson } from './json';
import { observe } from './scouting';
import { draftIsStarted, liveDraftClassYear } from './draft';
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
 * A handful of slots against one college class. Each one is a big, discrete
 * reveal on exactly one prospect: your people fly him in, put him through
 * their own testing, run the medical, and sit in a room with him. You get
 * four or five of these against a class of hundreds, so the question is never
 * "should I work somebody out" — it is "which four".
 *
 * THE WINDOW IS THE WHOLE LIFE OF THE CLASS. A class is put together at the
 * start of the season and is not selected until the draft after it, so from
 * the first week of football to the moment the war room opens the board it is
 * a live concern and a slot can be spent on it. The window shuts on one event
 * and one only — that draft going on the clock. See workoutsOpen below; it is
 * gated on the draft's own state rather than on a list of phase names, which
 * is what let the whole regular season fall outside it.
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

/** Slots a GM gets against one college class: the baseline entitlement plus Scouting Network. Single source of truth — the action re-derives the cap from here. */
export function workoutMax(skills: SkillRanks): number {
  return WORKOUTS.BASE_SLOTS + rankOf(skills, 'SCOUTING_NETWORK') * WORKOUTS.SLOTS_PER_NETWORK_RANK;
}

/**
 * CAN A SLOT BE SPENT RIGHT NOW. The only test in the game — the server action
 * refuses on it (runWorkout) and every button, column and counter is drawn
 * from the same call through loadWorkoutSlots, so a control cannot appear over
 * a rule that would turn it away.
 *
 * A class is scoutable from the day it is generated, which is the first week
 * of the season before its draft. What ends that is the draft itself, so that
 * is what this reads: draftIsStarted() in lib/draft.ts, the same predicate
 * draftPlayer() enforces at the podium and the same one the war room's Start
 * button flips. Board set but nobody on the clock is still open — that is a
 * GM standing in his own war room the morning of, and it is the last honest
 * moment to fly a man in.
 *
 * WHAT THIS REPLACED, because the shape of the mistake is worth keeping: a
 * whitelist of phase names, RESIGN and FREE_AGENCY. It shut the window for the
 * entire regular season and playoffs — the months the class is actually in
 * front of the GM — and it did so for a class that had been on the board since
 * week one. It also shut it in the war room, where the Start button was at the
 * same time telling the GM there was "still time to fly somebody in".
 *
 * FANTASY_DRAFT is the one phase that closes the window without a college
 * draft running. That pool is the league's own veterans wearing isDraftee for
 * the length of the draft (lib/gen/league.ts); there is no class behind it,
 * and a private workout is for prospects.
 */
export function workoutsOpen(
  league: { phase: string },
  draft: { kind: string; started: boolean } | null,
): boolean {
  if (league.phase === 'FANTASY_DRAFT') return false;
  if (league.phase !== 'DRAFT') return true;
  return !draft || !draftIsStarted(draft);
}

/** The window in one sentence, open or shut. */
export function workoutWindowLabel(open: boolean, phase: string): string {
  if (open) return 'Workout window is open — it closes when the draft goes on the clock.';
  if (phase === 'FANTASY_DRAFT') return 'A fantasy draft is running. Workouts are for the college class, and there is not one yet.';
  return 'The draft is on the clock. Workouts are closed for this class.';
}

/** The same fact at the width of a stat tile. */
export function workoutWindowTag(open: boolean): string {
  return open ? 'open until the draft' : 'closed — a draft is running';
}

export interface WorkoutSlots extends LimitedUse {
  /** True when a workout can be scheduled right now. */
  open: boolean;
  windowLabel: string;
  windowTag: string;
  /**
   * The college class the slots are budgeted against, and the stamp on every
   * report a slot has been spent on. `Player.draftYear`, NOT the league year —
   * see liveDraftClassYear in lib/draft.ts for why the two disagree for half
   * of every class's life.
   */
  classYear: number;
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
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { seasonYear: true, phase: true } });
  const [draft, classYear, profile] = await Promise.all([
    prisma.draftState.findUnique({ where: { leagueId }, select: { kind: true, started: true } }),
    liveDraftClassYear(leagueId, league.seasonYear),
    loadWorkoutLedger(leagueId),
  ]);
  const max = workoutMax(parseSkills(profile.skills));
  /**
   * THE BUDGET IS PER CLASS, AND THAT IS WHAT MAKES THE OPEN WINDOW SAFE.
   *
   * A counter stamped with any other class is stale by definition — the same
   * self-healing rule lib/dynasty.ts's limitedUse() applies to Full Scout,
   * with the class year in place of the league year.
   *
   * It has to be the class year and not the league year, because those two
   * part company halfway through the class's life: RESET_STANDINGS moves
   * seasonYear in the middle of the offseason, while the men on the board do
   * not move at all. Budgeted per league year, a window this wide would have
   * handed out five slots during the season and five MORE after the turn of
   * the year, on the same four hundred prospects — ten workouts against a
   * class the design gives five, which would have quietly ended the "which
   * four" question this whole mechanic exists to ask.
   */
  const used = profile.workoutYear === classYear ? clamp(profile.workoutUsed, 0, max) : 0;
  const open = workoutsOpen(league, draft);
  return {
    unlocked: true,
    max,
    used,
    remaining: Math.max(0, max - used),
    open,
    windowLabel: workoutWindowLabel(open, league.phase),
    windowTag: workoutWindowTag(open),
    classYear,
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

/**
 * Spend one slot on one prospect.
 *
 * Every rule the UI advertises is enforced here and re-derived from the
 * database, so a client that lies about its remaining slots gets the same
 * answer as one that does not.
 */
export async function runWorkout(leagueId: string, teamId: string, playerId: string): Promise<WorkoutResult> {
  const [league, draft, player, team] = await Promise.all([
    prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { seasonYear: true, phase: true } }),
    prisma.draftState.findUnique({ where: { leagueId }, select: { kind: true, started: true } }),
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
  if (!workoutsOpen(league, draft)) {
    return { ok: false, message: workoutWindowLabel(false, league.phase) };
  }

  const [classYear, profile] = await Promise.all([
    liveDraftClassYear(leagueId, league.seasonYear),
    loadWorkoutLedger(leagueId),
  ]);
  const max = workoutMax(parseSkills(profile.skills));
  // Keyed on the class, exactly as loadWorkoutSlots is — see the paragraph
  // there. A screen counting one budget over an action spending another is how
  // five slots become ten.
  const used = profile.workoutYear === classYear ? clamp(profile.workoutUsed, 0, max) : 0;
  // The ledger EXACTLY as it was read, un-normalised. `used` is the count
  // after the stale-class rule and the clamp, so it cannot be the thing the
  // claim below compares against — the row still holds the raw pair.
  const profileYear = profile.workoutYear;
  const profileUsed = profile.workoutUsed;
  if (used >= max) {
    return { ok: false, message: `No workout slots left. All ${max} come back when next year's class lands on the board.`, remaining: 0, max };
  }

  const existing = await prisma.scoutingReport.findUnique({ where: { playerId_teamId: { playerId, teamId } } });
  if (existing?.fullyRevealed) {
    return { ok: false, message: 'You already have a complete file on him — a workout would tell you nothing new.', remaining: max - used, max };
  }
  // Stamped with the class too, so a man flown in during the season cannot be
  // flown in again after the new league year turns over. He is the same
  // prospect in the same class and there is nothing left to measure on him.
  if (existing?.workoutYear === classYear) {
    return { ok: false, message: 'You already worked him out.', remaining: max - used, max };
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

  // Deterministic per (team, player, class): re-running a workout that somehow
  // got repeated produces the identical file rather than a fresh set of dice.
  // The class year and not the league year, so the same man worked out in
  // November and in March would draw the same numbers — the window spans that
  // boundary now, and a seed that did not would make the date of the visit
  // worth something.
  const rng = new Rng(`workout-${leagueId}-${teamId}-${playerId}-${classYear}`);
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
    workoutYear: classYear,
    notes: workoutNote(player.devTrait, measurable.length),
  };

  /*
   * THE SLOT IS CLAIMED BEFORE THE REPORT IS WRITTEN.
   *
   * This was a read of the ledger, a decision, and then a write of `used + 1`
   * — with the counter's value taken from the read. Two workouts requested at
   * the same moment both read the same `used`, both decided a slot was free,
   * and both wrote the SAME number: measured against a five-slot allowance,
   * two prospects were flown in and `workoutUsed` came back 1.
   *
   * `updateMany` with the ledger we read in the WHERE is the claim — the same
   * compare-and-set `beginRookieDraftAction` uses on the draft and the Dynasty
   * charges now use on theirs. The second caller matches no row, is told the
   * slot went elsewhere, and writes nothing.
   *
   * The insert first is what gives a save that has never opened the Dynasty
   * screen a ledger row for the claim to match against — and it is a
   * `createMany ... skipDuplicates` (one `INSERT ... ON CONFLICT DO NOTHING`)
   * rather than an upsert, deliberately twice over: an upsert's UPDATE branch
   * would write the pair we READ back over the row, undoing a claim another
   * request had just won, and its read-then-insert shape can collide with a
   * concurrent create instead of yielding to it.
   */
  await prisma.dynastyProfile.createMany({
    data: [{ ownerKind: 'LEAGUE', ownerKey: leagueId, leagueId }],
    skipDuplicates: true,
  });
  const claimed = await prisma.dynastyProfile.updateMany({
    where: { leagueId, workoutYear: profileYear, workoutUsed: profileUsed },
    data: { workoutYear: classYear, workoutUsed: used + 1 },
  });
  if (claimed.count === 0) {
    return {
      ok: false,
      message: 'That slot was already being spent on somebody else. Reload the board to see who went.',
      remaining: Math.max(0, max - used),
      max,
    };
  }

  await prisma.scoutingReport.upsert({
    where: { playerId_teamId: { playerId, teamId } },
    create: { playerId, teamId, ...payload },
    update: payload,
  });

  const remaining = max - (used + 1);
  return {
    ok: true,
    message: `${player.firstName} ${player.lastName} worked out. ${remaining} of ${max} slot${max === 1 ? '' : 's'} left on this class.`,
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
// Class boundary
// ---------------------------------------------------------------------------

/**
 * Zero the slot counter onto a new college class.
 *
 * Called where a class is minted — the PRESEASON step in lib/season.ts — and
 * NOT at the turn of the league year, which is the middle of a class's life
 * and would refill the budget on prospects the GM has already been flying in
 * since September.
 *
 * Strictly speaking redundant either way: loadWorkoutSlots already treats a
 * counter stamped with any other class as zero, which is what makes the ledger
 * self-healing for saves that predate it. The hook exists so the number on
 * screen turns over the moment the new board does, instead of the first time
 * the user spends a slot. Idempotent: a profile already stamped with this
 * class is left alone.
 */
export async function resetWorkoutSlots(leagueId: string, classYear: number): Promise<void> {
  await prisma.dynastyProfile.updateMany({
    where: { leagueId, workoutYear: { not: classYear } },
    data: { workoutYear: classYear, workoutUsed: 0 },
  });
}
