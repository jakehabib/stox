/**
 * ===========================================================================
 * SIMULATION HEALTH HARNESS
 * ===========================================================================
 * Generates N leagues, advances each one M seasons deep, and runs the full
 * GAME_INVARIANTS.md check after every step. Reports every violation found,
 * grouped by rule.
 *
 * Nobody plays these leagues. All thirty-two clubs are run by the AI, the
 * user's included — see NOBODY OWNS A CLUB IN A HARNESS LEAGUE below, which is
 * both the reason this file used to stall and the reason it does not now.
 *
 * Usage:
 *   npm run sim:health -- [leagues] [seasons]
 *   npm run sim:health -- 5 5        # 5 leagues, 5 seasons each (default)
 *   npm run sim:health -- 20 10      # scale up once the small run is clean
 *
 * Exits non-zero if any error-severity violation was found, or if any league
 * failed to finish, so this is CI-friendly.
 * ===========================================================================
 */
import { prisma } from '../lib/db';
import { createLeague } from '../lib/gen/league';
import type { LeagueStart } from '../lib/types';
import { advanceWeek } from '../lib/season';
import { runAiPicksUntilUser, currentPick } from '../lib/draft';
import { Rng } from '../lib/rng';
import { readJson } from '../lib/json';
import { parseSettings } from '../lib/settings';
import { LEAGUE } from '../lib/tuning';
import { checkInvariants, snapshotStatTotals, checkStatRollup, Violation } from '../lib/invariants';

const LEAGUES = Number(process.argv[2] ?? 5);
const SEASONS = Number(process.argv[3] ?? 5);
// No real team ever has this id, so runAiPicksUntilUser drains every pick
// instead of stopping to wait for input.
const NO_USER_SENTINEL = 'sim-health-no-user';
/**
 * The step budget, and it has NOT been raised to make this file pass.
 *
 * Measured on this build: a randomized league spends 24 steps on its first
 * season and 30 on each one after — 54 steps for two seasons against a budget
 * of 90 — and a fantasy league spends 29 on its first and the same 30
 * thereafter. The five
 * extra are all at league creation and all real work: `runAiPicksUntilUser`
 * makes at most 500 picks per call and a fantasy draft is
 * TEAM_COUNT x ROSTER_MAX = 1,696 of them, so it takes four passes to drain
 * (500/500/500/196) plus the advance that moves the league out of
 * FANTASY_DRAFT. A rookie draft is 224 picks and drains in one.
 *
 * So 45 per season is roughly a 50% margin over the worst start type, and a
 * league that runs out of it is stuck, not slow. That was worth writing down,
 * because raising this number was the tempting way to make the stall below go
 * green and it would have converted a dead league into a slow one.
 */
const MAX_STEPS_PER_LEAGUE = SEASONS * 45;

/**
 * How many refusals in a row mean STUCK rather than "press it again".
 *
 * `advanceWeek` can legitimately answer "no" once and then proceed — the
 * re-sign warning is exactly that shape ("Advance again to let them go"), and
 * it clears itself by writing League.resignWarnedYear. Two refusals in a row
 * with nothing in between to answer them is a league that will never move.
 *
 * This is a DIAGNOSTIC threshold, not a budget: the run fails either way. It
 * only decides whether the failure is named on step 30 or on step 90, and a
 * stall named where it happens is worth 60 steps of nothing.
 */
const STALL_AFTER_REFUSALS = 2;

interface TaggedViolation extends Violation {
  leagueIdx: number;
  seasonYear: number;
  week: number;
  phase: string;
}

interface LeagueResult {
  violations: TaggedViolation[];
  seasonsCompleted: number;
  steps: number;
  /** Null when the league finished. Otherwise a sentence naming where it stopped and why. */
  stall: string | null;
}

/**
 * WHICH KIND OF LEAGUE EACH RUN BUILDS.
 *
 * Every run used to be RANDOM_ROSTERS, which is half of what this game
 * offers — and the half that was never exercised shipped a real bug: the
 * fantasy branch of `draftPlayer` handed out 1,696 players and wrote not one
 * contract. INV-04 already calls an ACTIVE player with no contract an ERROR,
 * so the harness would have caught it on day one had it ever built such a
 * league. It could not, so it did not.
 *
 * Every third league is a fantasy draft now. Not every other one: the
 * randomized path is the one most saves use and most rules are written
 * against, and it should stay the bulk of the sample. One in three is enough
 * that any run of three or more leagues covers both start types, and a
 * single-league run still gets the common case.
 */
function startTypeFor(idx: number): LeagueStart {
  return idx % 3 === 2 ? 'FANTASY_DRAFT' : 'RANDOM_ROSTERS';
}

function kindLabel(idx: number): string {
  return startTypeFor(idx) === 'FANTASY_DRAFT' ? 'fantasy' : 'randomized';
}

/**
 * ===========================================================================
 * NOBODY OWNS A CLUB IN A HARNESS LEAGUE, AND THE LEAGUE HAS TO SAY SO
 * ===========================================================================
 * `createLeague` always flags one team `isUser`, because every real save has a
 * human behind exactly one club. This file's header has claimed since it was
 * written that the harness leaves that club to the AI "exactly like any other
 * franchise". That was never true. Six league-wide passes read `isUser` and
 * deliberately skip it, every one of them for a good reason:
 *
 *   runAiResignWave           its expiring class walks in full, every year
 *   runAiFreeAgencyWave       it never signs anybody
 *   fillTeamsToRosterMinimum  it is never brought back to a legal roster
 *   trimRostersToLimit        it is never cut to the limit — the ADVANCE IS
 *                             BLOCKED instead, and the human cuts
 *   capComplianceBlock        over the cap, the clock stops until he fixes it
 *   the RESIGN warning        stops the clock once a year to warn him
 *
 * So the harness's "user" club only ever ADDED players — it drafts, because
 * `runAiPicksUntilUser` is handed a sentinel id no team can match — and only
 * ever LOST them. Both halves of that were measured on `sim:health 3 2` before
 * this change, and between them they are every violation the run reported.
 *
 * IN A RANDOMIZED LEAGUE IT BLED OUT. Its expiring class walked with nobody
 * re-signing and nobody replacing them: 32 men against a 46-man minimum by the
 * first free agency, and it never came back. 108 INV-20 warnings across the
 * run, with exactly one team named on every single one of them.
 *
 * IN A FANTASY LEAGUE IT JAMMED. A fantasy draft fills every roster to exactly
 * rosterMax, so this club came out of it on 53 and was still on 53 a year
 * later — and then seven rookie picks made it 60 against a 53-man ceiling.
 * Cut-down day refuses to cut for a human, so `advanceWeek` answered
 *
 *   "Can't advance — the ATL are carrying 60 players against a 53-man limit.
 *    Release 7 players and the new league year opens. Every other roster in
 *    the league has already made its final cuts."
 *
 * for the remaining 56 steps of the budget — 56 INV-08 warnings and 56 INV-18
 * errors, the same one club read 56 times, and the STALL.
 *
 * THE FIX IS NOT FOR THE HARNESS TO PLAY GM. Re-signing, free agency, roster
 * filling and cut-down day are four AI subsystems; a harness that reimplements
 * them is checking its own policy against the game's. It is for the league to
 * have no human in it at all, which is what a headless league IS. Every club
 * is then run by the same code, and the paragraph at the top of this file is
 * finally true.
 *
 * WHAT THIS GIVES UP, deliberately: `maybeMakeAiTradeOffer` (offers addressed
 * to the user), the coached-development bonus keyed off `League.userTeamId`,
 * and the three human-gated blocks listed above. Not one of them can move a
 * player or a dollar without a human answering it, so not one of them can
 * violate a rule in GAME_INVARIANTS.md — whereas leaving one club of 32
 * unmanaged corrupts the standings, the draft order and the cap sheet of every
 * league built here. Every read of `isUser` in the simulation path is null-safe
 * already; `AdvanceResult.report`'s own doc comment names "a league with no
 * user team" as a supported case.
 */
async function makeHeadless(leagueId: string) {
  await prisma.team.updateMany({ where: { leagueId }, data: { isUser: false } });
  // Cleared alongside the flag, not instead of it: lib/development.ts reads
  // `League.userTeamId` for the coached-team bonus and would otherwise keep
  // treating one club as the human's while nothing else did.
  await prisma.league.update({ where: { id: leagueId }, data: { userTeamId: null } });
}

/**
 * `CapCharge` used to be keyed on `teamId` alone — no `leagueId`, and no
 * foreign key to anything — so deleting a league left its dead-money rows
 * behind pointing at teams that no longer existed. Every throwaway league in
 * `scripts/` contributed, this harness worst of all: it books cut-down dead
 * money in every league it builds, and for a long time it deleted only the
 * league. Measured on the dev database before it was fixed, 18,247 orphans
 * against 22,203 rows — five of every six cap charges in it belonged to a
 * league nobody could open.
 *
 * THE SCHEMA IS THE FIX, NOT THIS FUNCTION. `CapCharge.teamId` is a real
 * foreign key with `onDelete: Cascade` now (migration
 * 20260823124600_cap_charge_team_cascade), and Team already cascades from
 * League, so the delete below takes the charges with it whoever calls it —
 * this harness, `deleteLeagueAction`, a probe, or somebody in psql. A sweep
 * here would only have covered this one file.
 * scripts/pruneOrphanCapCharges.ts cleared the rows that predate the
 * constraint.
 */
async function destroyLeague(leagueId: string) {
  // deleteMany, not delete: this also runs against a league `createLeague`
  // only half-built before throwing, and a missing row there is the normal
  // case rather than a second failure to report on top of the first.
  await prisma.league.deleteMany({ where: { id: leagueId } });
}

/**
 * WHERE IT STOPPED, IN A SENTENCE SOMEBODY CAN ACT ON.
 *
 * This used to read, in full: "At least one league did not reach the target
 * season count within its step budget." It named neither the league, nor its
 * start type, nor the phase, nor the week, nor — when the answer was a draft —
 * which pick the clock was sitting on. Finding that out cost a whole session.
 */
async function describeStall(idx: number, leagueId: string, reason: string): Promise<string> {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  let where = `${league.phase} year ${league.seasonYear} week ${league.week}`;

  if (league.phase === 'DRAFT' || league.phase === 'FANTASY_DRAFT') {
    const state = await prisma.draftState.findUnique({ where: { leagueId } });
    if (!state) {
      where += ', with no DraftState row at all';
    } else {
      const settings = parseSettings(league.settings);
      const totalPicks = state.kind === 'FANTASY'
        ? readJson<string[]>(state.order, []).length
        : settings.draftRounds * LEAGUE.TEAM_COUNT;
      // Resolved through the same function the draft itself uses, so the club
      // named here is the club the engine believes is on the clock — including
      // "nobody", which is itself the answer on a rookie draft whose
      // (round, slot) has no DraftPick row.
      const onClock = await currentPick(leagueId);
      const club = onClock
        ? await prisma.team.findUnique({ where: { id: onClock.teamId }, select: { abbr: true } })
        : null;
      where += `, ${state.kind === 'FANTASY' ? 'fantasy' : 'rookie'} draft round ${state.round}`
        + `, pick ${state.pickIndex + 1} of ${totalPicks}`
        + ` (complete=${state.complete}, started=${state.started}, on the clock: ${club?.abbr ?? 'nobody'})`;
    }
  }

  return `league ${idx + 1} (${kindLabel(idx)}) stopped in ${where}. ${reason}`;
}

async function runOneLeague(idx: number): Promise<LeagueResult> {
  const seed = `sim-health-${idx}-${LEAGUES}-${SEASONS}`;
  const leagueStart = startTypeFor(idx);

  const violations: TaggedViolation[] = [];
  const tag = (v: Violation, ctx: { seasonYear: number; week: number; phase: string }) =>
    violations.push({ ...v, leagueIdx: idx, ...ctx });

  const seasonYearsSeen = new Set<number>();
  let steps = 0;
  let stall: string | null = null;
  // Captured through createLeague's own callback rather than its return value,
  // so a league that throws PART WAY through generation is still cleaned up.
  // That callback exists for exactly this; see its doc comment.
  const created: string[] = [];

  try {
    const leagueId = await createLeague({
      name: `SimHealth ${idx}`,
      // Deliberately invalid, so createLeague falls back to teams[0]. Which
      // team it lands on stops mattering one line later, where makeHeadless
      // clears the flag off all thirty-two.
      userTeamAbbr: 'ZZZ',
      seed,
      settings: { leagueStart },
      onLeagueCreated: (id) => { created.push(id); },
    });
    await makeHeadless(leagueId);

    // Consecutive steps that moved nothing — a refused advance, or a draft
    // drain that made no picks. Reset by anything that actually happens.
    let refusals = 0;

    while (steps < MAX_STEPS_PER_LEAGUE) {
      steps++;
      const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
      seasonYearsSeen.add(league.seasonYear);
      if (seasonYearsSeen.size > SEASONS) break;

      if (league.phase === 'DRAFT' || league.phase === 'FANTASY_DRAFT') {
        const state = await prisma.draftState.findUnique({ where: { leagueId } });
        if (!state?.complete) {
          // A rookie draft is now created with the clock stopped, waiting on the
          // GM to open it (DraftState.started — see beginRookieDraftAction). This
          // league has no GM, so the sim is its own commissioner: same
          // compare-and-set, no picks until it has run.
          if (state && !state.started) {
            await prisma.draftState.updateMany({ where: { leagueId, started: false }, data: { started: true } });
          }
          const picks = await runAiPicksUntilUser(leagueId, NO_USER_SENTINEL, new Rng(`${seed}-draft-${steps}`), league.seasonYear);
          // A drain that makes no picks while the draft says it is not finished
          // is the draft's own way of being stuck: nobody on the clock, or
          // nobody left on the board. Either way the next pass will do exactly
          // as much, so there is nothing to wait for.
          refusals = picks === 0 ? refusals + 1 : 0;
          if (refusals >= STALL_AFTER_REFUSALS) {
            stall = await describeStall(idx, leagueId, `Draining AI picks made none, ${refusals} passes running.`);
            break;
          }
          continue; // check invariants once the phase actually changes, not on every partial drain
        }
        // draft is done — fall through to advanceWeek so it transitions phase (INV-18)
      }

      // INV-T1 is checked across the advance that carries RESET_STANDINGS, which
      // is the one that rolls season stats into career. That is now the FIRST
      // offseason advance — OFFSEASON_ADVANCES in lib/season.ts groups PROGRESS,
      // RESET_STANDINGS and AGE_CONTRACTS into it — so the snapshot is taken at
      // week 1. Left at week 2 this check would simply never fire again: a
      // league on this build goes 1 -> 4 and never sits on 2.
      const statsBefore = (league.phase === 'OFFSEASON' && league.week === 1) ? await snapshotStatTotals(leagueId) : null;

      /*
       * THE ANSWER `advanceWeek` GIVES BACK IS PART OF THE TEST.
       *
       * This call used to discard its return value. `advanceWeek` can refuse —
       * it returns `{ blocked: true, summary }` when the clock must not move —
       * and a refusal thrown away is indistinguishable from a week that
       * happened. That is how a league that was being told "Can't advance —
       * the ATL are carrying 60 players against a 53-man limit" on every one
       * of 56 consecutive steps reported nothing at all except a step budget
       * quietly running out.
       *
       * Every block in the game is gated on there being a human to answer it,
       * and makeHeadless above removes the human, so nothing here should ever
       * refuse. If something does, it is either a new block or a bug, and
       * either way the run says which and stops.
       */
      const result = await advanceWeek(leagueId);
      if (result.blocked) {
        refusals += 1;
        if (refusals >= STALL_AFTER_REFUSALS) {
          stall = await describeStall(idx, leagueId, `advanceWeek refused ${refusals} times running: "${result.summary}"`);
          break;
        }
      } else {
        refusals = 0;
      }

      if (statsBefore) {
        const statsAfter = await snapshotStatTotals(leagueId);
        for (const v of checkStatRollup(statsBefore, statsAfter)) tag(v, { seasonYear: league.seasonYear, week: league.week, phase: league.phase });
      }

      const after = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
      for (const v of await checkInvariants(leagueId)) tag(v, { seasonYear: after.seasonYear, week: after.week, phase: after.phase });
    }

    // Ran out of budget without ever being caught red-handed above. Rarer than
    // a refusal loop and worth a different sentence, because "it is moving, it
    // is just slow" and "it is not moving" are different problems.
    if (!stall && seasonYearsSeen.size <= SEASONS) {
      stall = await describeStall(idx, leagueId,
        `Spent all ${MAX_STEPS_PER_LEAGUE} steps and reached ${seasonYearsSeen.size - 1} of ${SEASONS} season(s) — it was still moving, just not fast enough.`);
    }
  } finally {
    // In a finally so a thrown invariant check or a crashed advance does not
    // leave a half-simulated league (and its cap charges) in the database.
    for (const id of created) await destroyLeague(id);
  }

  return { violations, seasonsCompleted: seasonYearsSeen.size - 1, steps, stall };
}

async function main() {
  console.log(`Simulation health run: ${LEAGUES} league(s) x ${SEASONS} season(s)\n`);

  const allViolations: TaggedViolation[] = [];
  const stalls: string[] = [];

  for (let i = 0; i < LEAGUES; i++) {
    process.stdout.write(`League ${i + 1}/${LEAGUES} (${kindLabel(i)})... `);
    const result = await runOneLeague(i);
    allViolations.push(...result.violations);
    if (result.stall) stalls.push(result.stall);
    console.log(`${result.seasonsCompleted} season(s), ${result.steps} steps, ${result.violations.length} violation(s)${result.stall ? ' — STALLED' : ''}`);
    if (result.stall) console.log(`  ${result.stall}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  if (allViolations.length === 0 && stalls.length === 0) {
    console.log('No invariant violations found. All leagues completed on schedule.');
  } else {
    const byRule = new Map<string, TaggedViolation[]>();
    for (const v of allViolations) (byRule.get(v.id) ?? byRule.set(v.id, []).get(v.id)!).push(v);

    for (const [rule, vs] of [...byRule.entries()].sort()) {
      const severity = vs[0].severity.toUpperCase();
      const totalCount = vs.reduce((sum, v) => sum + v.count, 0);
      console.log(`\n[${severity}] ${rule} — hit ${vs.length} time(s) across the run, ${totalCount} row(s) total`);
      console.log(`  ${vs[0].message}`);
      const example = vs[0];
      console.log(`  e.g. league ${example.leagueIdx}, ${example.phase} year ${example.seasonYear} wk ${example.week}: ${example.sample.join(', ')}`);
    }

    for (const s of stalls) console.log(`\n[ERROR] STALLED — ${s}`);
  }

  const errorCount = allViolations.filter((v) => v.severity === 'error').length;
  console.log('\n' + '='.repeat(70));
  console.log(`${allViolations.length} total violation(s) (${errorCount} error, ${allViolations.length - errorCount} warning) across ${LEAGUES} league(s).`);

  process.exit(errorCount > 0 || stalls.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
