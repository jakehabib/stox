/**
 * ===========================================================================
 * SIMULATION HEALTH HARNESS
 * ===========================================================================
 * Generates N leagues, advances each one M seasons deep with every decision
 * left to the AI (including the "user" team, so it drafts/re-signs/advances
 * exactly like any other franchise), and runs the full GAME_INVARIANTS.md
 * check after every step. Reports every violation found, grouped by rule.
 *
 * Usage:
 *   npm run sim:health -- [leagues] [seasons]
 *   npm run sim:health -- 5 5        # 5 leagues, 5 seasons each (default)
 *   npm run sim:health -- 20 10      # scale up once the small run is clean
 *
 * Exits non-zero if any error-severity violation was found, so this is
 * CI-friendly.
 * ===========================================================================
 */
import { prisma } from '../lib/db';
import { createLeague } from '../lib/gen/league';
import type { LeagueStart } from '../lib/types';
import { advanceWeek } from '../lib/season';
import { runAiPicksUntilUser } from '../lib/draft';
import { Rng } from '../lib/rng';
import { checkInvariants, snapshotStatTotals, checkStatRollup, Violation } from '../lib/invariants';

const LEAGUES = Number(process.argv[2] ?? 5);
const SEASONS = Number(process.argv[3] ?? 5);
// No real user ever has this id, so runAiPicksUntilUser drains every pick,
// including the "user" team's, instead of stopping to wait for input.
const NO_USER_SENTINEL = 'sim-health-no-user';
const MAX_STEPS_PER_LEAGUE = SEASONS * 45; // ~30-35 steps/season in practice; generous safety margin

interface TaggedViolation extends Violation {
  leagueIdx: number;
  seasonYear: number;
  week: number;
  phase: string;
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

async function runOneLeague(idx: number): Promise<{ violations: TaggedViolation[]; seasonsCompleted: number; steps: number; stalled: boolean }> {
  const seed = `sim-health-${idx}-${LEAGUES}-${SEASONS}`;
  const leagueStart = startTypeFor(idx);
  const leagueId = await createLeague({
    name: `SimHealth ${idx}`,
    userTeamAbbr: 'ZZZ', // deliberately invalid -> falls back to teams[0]; nobody drives this team by hand
    seed,
    settings: { leagueStart },
  });

  const violations: TaggedViolation[] = [];
  const tag = (v: Violation, ctx: { seasonYear: number; week: number; phase: string }) =>
    violations.push({ ...v, leagueIdx: idx, ...ctx });

  const seasonYearsSeen = new Set<number>();
  let steps = 0;
  let stalled = false;

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
        await runAiPicksUntilUser(leagueId, NO_USER_SENTINEL, new Rng(`${seed}-draft-${steps}`), league.seasonYear);
        continue; // check invariants once the phase actually changes, not on every partial drain
      }
      // draft is done — fall through to advanceWeek so it transitions phase (INV-18)
    }

    const statsBefore = (league.phase === 'OFFSEASON' && league.week === 2) ? await snapshotStatTotals(leagueId) : null;
    await advanceWeek(leagueId);
    if (statsBefore) {
      const statsAfter = await snapshotStatTotals(leagueId);
      for (const v of checkStatRollup(statsBefore, statsAfter)) tag(v, { seasonYear: league.seasonYear, week: league.week, phase: league.phase });
    }

    const after = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
    for (const v of await checkInvariants(leagueId)) tag(v, { seasonYear: after.seasonYear, week: after.week, phase: after.phase });
  }

  if (seasonYearsSeen.size <= SEASONS) stalled = true; // hit the step budget without completing SEASONS+1 distinct years

  await prisma.league.delete({ where: { id: leagueId } });
  return { violations, seasonsCompleted: seasonYearsSeen.size - 1, steps, stalled };
}

async function main() {
  console.log(`Simulation health run: ${LEAGUES} league(s) x ${SEASONS} season(s)\n`);

  const allViolations: TaggedViolation[] = [];
  let anyStalled = false;

  for (let i = 0; i < LEAGUES; i++) {
    process.stdout.write(`League ${i + 1}/${LEAGUES} (${startTypeFor(i) === 'FANTASY_DRAFT' ? 'fantasy' : 'randomized'})... `);
    const result = await runOneLeague(i);
    allViolations.push(...result.violations);
    if (result.stalled) anyStalled = true;
    console.log(`${result.seasonsCompleted} season(s), ${result.steps} steps, ${result.violations.length} violation(s)${result.stalled ? ' — STALLED (hit step budget)' : ''}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  if (allViolations.length === 0 && !anyStalled) {
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

    if (anyStalled) console.log('\n[ERROR] At least one league did not reach the target season count within its step budget.');
  }

  const errorCount = allViolations.filter((v) => v.severity === 'error').length;
  console.log('\n' + '='.repeat(70));
  console.log(`${allViolations.length} total violation(s) (${errorCount} error, ${allViolations.length - errorCount} warning) across ${LEAGUES} league(s).`);

  process.exit(errorCount > 0 || anyStalled ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
