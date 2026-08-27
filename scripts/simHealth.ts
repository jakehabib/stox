/**
 * ===========================================================================
 * SIMULATION HEALTH HARNESS — THE SOAK TEST
 * ===========================================================================
 * Generates N leagues ACROSS A SETTINGS MATRIX, advances each one M seasons
 * deep, and runs the full GAME_INVARIANTS.md check after every step. Reports
 * every violation found, grouped by rule; then reports the things that are not
 * violations of anything but still have to be looked at — where the trophies
 * went, what a starter is rated, how old the league is, how many men retired.
 *
 * Nobody plays these leagues. All thirty-two clubs are run by the AI, the
 * user's included — see NOBODY OWNS A CLUB IN A HARNESS LEAGUE below, which is
 * both the reason this file used to stall and the reason it does not now.
 *
 * Usage:
 *   npm run sim:health -- [leagues] [seasons] [flags]
 *   npm run sim:health -- 6 10                  # 6 leagues, 10 seasons each
 *   npm run sim:health -- 6 10 --shard=0/3      # this process runs 1 of 3
 *   npm run sim:health -- 6 10 --out=run0.json  # dump the census as JSON
 *   npm run sim:health -- --merge=./census      # print the combined report
 *
 * SHARDING IS HOW A DEEP RUN FINISHES TODAY. One league-season costs roughly
 * ninety seconds of wall clock, almost all of it inside the game rather than
 * inside this file, so a 6 x 10 run is about ninety minutes in one process and
 * about thirty across three. `--shard=i/n` takes every league whose index is
 * congruent to i mod n, so the n processes together cover exactly the same set
 * one process would, with the same seeds and therefore the same leagues.
 *
 * Exits non-zero if any error-severity violation was found, or if any league
 * failed to finish, so this is CI-friendly.
 * ===========================================================================
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../lib/db';
import { createLeague } from '../lib/gen/league';
import type { LeagueStart } from '../lib/types';
import { advanceWeek } from '../lib/season';
import { runAiPicksUntilUser, currentPick } from '../lib/draft';
import { Rng } from '../lib/rng';
import { readJson } from '../lib/json';
import { parseSettings, LeagueSettings } from '../lib/settings';
import { LEAGUE } from '../lib/tuning';
import { STARTERS_AT_POSITION } from '../lib/lineup';
import { AWARD_TYPES } from '../lib/awardTypes';
import { checkInvariants, checkOrphans, snapshotStatTotals, checkStatRollup, Violation } from '../lib/invariants';

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const flag = (name: string): string | null => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : '';
};

const LEAGUES = Number(positional[0] ?? 5);
const SEASONS = Number(positional[1] ?? 5);
const MERGE_DIR = flag('merge');
const OUT_FILE = flag('out');
const SHARD = (() => {
  const raw = flag('shard');
  if (!raw) return null;
  const [i, n] = raw.split('/').map(Number);
  if (!Number.isInteger(i) || !Integerish(n) || n < 1 || i < 0 || i >= n) {
    throw new Error(`--shard wants i/n with 0 <= i < n, got "${raw}"`);
  }
  return { i, n };
})();
function Integerish(n: number) { return Number.isInteger(n); }

// No real team ever has this id, so runAiPicksUntilUser drains every pick
// instead of stopping to wait for input.
const NO_USER_SENTINEL = 'sim-health-no-user';

/**
 * ===========================================================================
 * THE SETTINGS MATRIX
 * ===========================================================================
 * Every league this harness used to build was played under DEFAULT_SETTINGS
 * with one bit flipped (fantasy start or not). That is one cell of a table
 * with a lot of cells, and the cells nobody visits are exactly where the bugs
 * live: the fantasy branch of `draftPlayer` handed out 1,696 players and wrote
 * not one contract, and INV-04 would have caught it on day one had any league
 * here ever taken that branch.
 *
 * So the rungs a player can actually choose are rungs this harness plays on.
 * Six configurations, chosen to cover every rung of every setting that CHANGES
 * WHAT THE SIMULATION DOES at least once, rather than to enumerate a product
 * of options nobody would pick:
 *
 *   capMode        OFF, SIMPLIFIED and REALISTIC all appear
 *   capGrowth      FLAT, SLOW and FAST all appear
 *   difficulty     EASY, NORMAL and HARD all appear
 *   leagueStart    RANDOM_ROSTERS, FANTASY_DRAFT and REBUILD (ironman) all appear
 *   seasonLength   short, default and long
 *   draftRounds    3, 5 and 7
 *   rosterMax      the default and a smaller one, which moves the roster
 *                  MINIMUM with it (rosterMinFor) and therefore moves what
 *                  INV-20 and INV-25 are checking against
 *   injuries/retirement/trades  each switched off in one cell, because "off"
 *                  is a code path too and the retirement one governs the age
 *                  curve this run is measuring
 *
 * A league takes its configuration from its index, so `--shard` splits a run
 * without splitting the coverage unevenly as long as the shard count and the
 * matrix length are coprime or the run is a multiple of both. With six
 * configurations and three shards each shard gets two whole configurations,
 * which is the reason six is the length rather than five.
 *
 * IRONMAN IS NOT A SETTING, IT IS A START. `leagueStart: 'REBUILD'` makes
 * createLeague apply REBUILD_PINS (lib/rebuild.ts) — NORMAL difficulty, no
 * forced trades, a FLAT ceiling, REALISTIC cap — over whatever is asked for
 * here, which is why this cell asks for nothing else. Anything it asked for
 * would be silently overwritten, and a matrix cell that lies about what it is
 * testing is worse than no cell.
 */
interface MatrixCell {
  name: string;
  settings: Partial<LeagueSettings>;
}

const MATRIX: MatrixCell[] = [
  {
    name: 'default',
    settings: {},
  },
  {
    name: 'cap-off-easy-fantasy',
    settings: {
      capMode: 'OFF', capGrowth: 'FLAT', difficulty: 'EASY',
      leagueStart: 'FANTASY_DRAFT', draftRounds: 5,
    },
  },
  {
    name: 'simplified-hard-short',
    settings: {
      capMode: 'SIMPLIFIED', capGrowth: 'FAST', difficulty: 'HARD',
      seasonLength: 12, draftRounds: 3, rosterMax: 46,
    },
  },
  {
    name: 'ironman',
    settings: { leagueStart: 'REBUILD' },
  },
  {
    name: 'no-injuries-no-retirement',
    settings: {
      injuriesEnabled: false, retirementEnabled: false, tradesEnabled: false,
      capGrowth: 'FLAT', difficulty: 'HARD',
    },
  },
  {
    name: 'long-season-fantasy',
    settings: {
      leagueStart: 'FANTASY_DRAFT', seasonLength: 20, draftRounds: 7,
      capMode: 'REALISTIC', capGrowth: 'SLOW', difficulty: 'EASY',
      progressionSpeed: 1.5,
    },
  },
];

function cellFor(idx: number): MatrixCell {
  return MATRIX[idx % MATRIX.length];
}

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
 *
 * THE MATRIX DOES NOT MOVE IT. A 20-week season is 20 REGULAR steps against a
 * 17-week season's 17, so the longest cell spends 33 steps a season rather
 * than 30 — still a third clear of the budget. A cell that needed the budget
 * raised would be a cell whose season does not end, which is the thing this
 * number exists to catch.
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
  config: string;
  seasonYear: number;
  week: number;
  phase: string;
  /**
   * WHICH STEP OF THIS LEAGUE'S LIFE, which is the only thing that orders
   * these correctly. (seasonYear, week) does not: PLAYOFFS runs at week 1 and
   * the regular season it follows ran to week 17, so sorting by week puts
   * January BEFORE the previous September and "first seen" names the wrong
   * moment. Measured on a real run, it reported a violation first seen in the
   * playoffs when the phase histogram beside it showed a PRESEASON reading.
   */
  step: number;
}

/**
 * ===========================================================================
 * THE CENSUS — WHAT A CLEAN RUN STILL HAS TO BE LOOKED AT FOR
 * ===========================================================================
 * An invariant answers yes or no. Most of what goes wrong with a simulation
 * over ten seasons answers neither: the league does not break, it DRIFTS —
 * every rating creeps up, or every trophy goes to the same position, or the
 * average age walks off a cliff because retirement and the draft class are not
 * in balance. Nothing in GAME_INVARIANTS.md is violated and the game is still
 * wrong.
 *
 * So the run also counts things. Nothing here fails a build; it is printed so
 * a human can see the shape and say whether it is football.
 *
 * SAMPLED BLIND, DELIBERATELY. Every number below is computed from a read of
 * an ENTIRE league — every player, every award row — and narrowed in memory.
 * Not one of them is `orderBy: { trueOvr: 'desc' }, take: N`, which answers a
 * question about the top of a distribution and gets quoted as a fact about the
 * distribution.
 * ===========================================================================
 */
interface SeasonCensus {
  /** 1 for the founding season, 2 for the next, and so on. */
  seasonIndex: number;
  config: string;
  starterOvrMean: number;
  starterOvrSd: number;
  starterCount: number;
  ageMean: number;
  ageSd: number;
  retiredTotal: number;
  freeAgents: number;
  activePlayers: number;
}

interface RunCensus {
  seasons: SeasonCensus[];
  /** award type -> position -> count */
  awards: Record<string, Record<string, number>>;
  leagues: number;
  leagueSeasons: number;
  configsSeen: string[];
}

const emptyCensus = (): RunCensus => ({ seasons: [], awards: {}, leagues: 0, leagueSeasons: 0, configsSeen: [] });

interface LeagueResult {
  violations: TaggedViolation[];
  seasonsCompleted: number;
  steps: number;
  /** Null when the league finished. Otherwise a sentence naming where it stopped and why. */
  stall: string | null;
  census: SeasonCensus[];
  awards: Record<string, Record<string, number>>;
}

function kindLabel(idx: number): string {
  return cellFor(idx).name;
}

function startTypeFor(idx: number): LeagueStart {
  return (cellFor(idx).settings.leagueStart ?? 'RANDOM_ROSTERS') as LeagueStart;
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
 *
 * BY ID, NEVER BY NAME. This database is shared — with other agents' probes
 * and with the owner's own saves — and two runs of this file at once both
 * build a league called "SimHealth 0". Deleting by name prefix would have each
 * run tearing down the other's league mid-simulation. Every id deleted here
 * came out of `createLeague`'s own callback in this process.
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

/**
 * One season's shape, read off the whole league rather than off its top end.
 *
 * A STARTER IS THE BEST MAN HIS CLUB HAS AT HIS POSITION, as many of him as
 * STARTERS_AT_POSITION says are on the field — resolved per club and per
 * position, in memory, from every active player in the league. That is a
 * different question from "the best players in the league", and the difference
 * is the whole point: the league's ninety-ninth percentile can hold steady
 * while every club's third receiver rots, and only one of those two numbers
 * would notice.
 */
async function takeSeasonCensus(leagueId: string, seasonIndex: number, config: string): Promise<SeasonCensus> {
  const players = await prisma.player.findMany({
    where: { leagueId },
    select: { status: true, teamId: true, position: true, trueOvr: true, age: true },
  });

  const byTeamPos = new Map<string, number[]>();
  const activeAges: number[] = [];
  let retired = 0;
  let freeAgents = 0;
  let active = 0;
  for (const p of players) {
    if (p.status === 'RETIRED') { retired++; continue; }
    if (p.status === 'FREE_AGENT') { freeAgents++; continue; }
    if (p.status !== 'ACTIVE' || !p.teamId) continue;
    active++;
    activeAges.push(p.age);
    const key = `${p.teamId}|${p.position}`;
    (byTeamPos.get(key) ?? byTeamPos.set(key, []).get(key)!).push(p.trueOvr);
  }

  const starters: number[] = [];
  for (const [key, ovrs] of byTeamPos) {
    const position = key.slice(key.indexOf('|') + 1) as keyof typeof STARTERS_AT_POSITION;
    const n = STARTERS_AT_POSITION[position] ?? 0;
    if (n === 0) continue;
    starters.push(...ovrs.sort((a, b) => b - a).slice(0, n));
  }

  const stat = (xs: number[]) => {
    if (xs.length === 0) return { mean: 0, sd: 0 };
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    return { mean, sd };
  };
  const s = stat(starters);
  const a = stat(activeAges);
  return {
    seasonIndex, config,
    starterOvrMean: Number(s.mean.toFixed(2)), starterOvrSd: Number(s.sd.toFixed(2)), starterCount: starters.length,
    ageMean: Number(a.mean.toFixed(2)), ageSd: Number(a.sd.toFixed(2)),
    retiredTotal: retired, freeAgents, activePlayers: active,
  };
}

/**
 * Every trophy this league handed out, by position.
 *
 * READ OFF THE TRANSACTION ROW'S OWN HEADLINE, which `recordSeasonAwards`
 * writes as `${name} (${position})` and every reader in the app already parses
 * the same way. The alternative — joining back to `Player.position` — answers a
 * different question: a man who won it at receiver and has since been listed
 * elsewhere would be counted at the position he holds TODAY, not the one he
 * won it at.
 */
async function collectAwards(leagueId: string, startYear: number): Promise<Record<string, Record<string, number>>> {
  const rows = await prisma.transaction.findMany({
    where: { leagueId, seasonYear: { gte: startYear }, type: { in: AWARD_TYPES } },
    select: { type: true, headline: true },
  });
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const pos = r.headline.match(/\(([^)]+)\)\s*$/)?.[1] ?? 'UNKNOWN';
    (out[r.type] ??= {})[pos] = ((out[r.type] ?? {})[pos] ?? 0) + 1;
  }
  return out;
}

async function runOneLeague(idx: number): Promise<LeagueResult> {
  const cell = cellFor(idx);
  const seed = `sim-health-${idx}-${SEASONS}-${cell.name}`;

  const violations: TaggedViolation[] = [];
  const tag = (v: Violation, ctx: { seasonYear: number; week: number; phase: string; step: number }) =>
    violations.push({ ...v, leagueIdx: idx, config: cell.name, ...ctx });

  const census: SeasonCensus[] = [];
  let awards: Record<string, Record<string, number>> = {};
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
      settings: cell.settings,
      onLeagueCreated: (id) => { created.push(id); },
    });
    await makeHeadless(leagueId);
    const founded = (await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { seasonYear: true } })).seasonYear;

    // Consecutive steps that moved nothing — a refused advance, or a draft
    // drain that made no picks. Reset by anything that actually happens.
    let refusals = 0;
    // Season indexes the census has already been taken for, so it is taken
    // once a season rather than once a step.
    const censused = new Set<number>();

    while (steps < MAX_STEPS_PER_LEAGUE) {
      steps++;
      const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
      seasonYearsSeen.add(league.seasonYear);
      if (seasonYearsSeen.size > SEASONS) break;

      // Once a season, standing in the regular season, where every roster has
      // been filled, cut to the limit and settled. Taking it in the offseason
      // would measure a league mid-teardown — see ROSTER_FLOOR_EXEMPT_PHASES.
      if (league.phase === 'REGULAR' && league.week === 1 && !censused.has(league.seasonYear)) {
        censused.add(league.seasonYear);
        census.push(await takeSeasonCensus(leagueId, league.seasonYear - founded + 1, cell.name));
      }

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
        for (const v of checkStatRollup(statsBefore, statsAfter)) tag(v, { seasonYear: league.seasonYear, week: league.week, phase: league.phase, step: steps });
      }

      const after = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
      for (const v of await checkInvariants(leagueId)) tag(v, { seasonYear: after.seasonYear, week: after.week, phase: after.phase, step: steps });
    }

    // Read while the league is still standing. Everything below this line is
    // teardown, and a census taken after the delete is a census of nothing.
    awards = await collectAwards(leagueId, founded);

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

  return { violations, seasonsCompleted: seasonYearsSeen.size - 1, steps, stall, census, awards };
}

/**
 * ===========================================================================
 * THE CANARIES — DOES THIS HARNESS MEASURE ANYTHING AT ALL
 * ===========================================================================
 * A probe in this repo once read `l.stats.receptions`, where the field is
 * called `rec`, and reported 28,534 samples of 0.0000. It ran, it printed a
 * number, it was believed, and it was measuring nothing. Every number this file
 * prints has the same failure mode available to it.
 *
 * So the run opens by proving three things about itself, and REFUSES TO RUN if
 * any of them comes out wrong:
 *
 *   A  an assertion at a claim known to be FALSE must fail
 *   B  a read of a deliberately MISSPELLED field must come back undefined
 *   C  a read that is real must pass
 *
 * These are run against a throwaway in-memory shape rather than the database,
 * on purpose: they are checking that the ASSERTION MACHINERY below is wired up,
 * and a canary that needs a working database to fail is a canary that goes
 * quiet exactly when the database is the problem.
 * ===========================================================================
 */
function runCanaries(): string[] {
  const lines: string[] = [];
  const sample = { id: 'x', trueOvr: 71, position: 'WR' as string };

  const a = (sample as Record<string, unknown>).trueOvr === 99;
  lines.push(`  A  false claim ("this 71-rated player is rated 99"): ${a ? 'PASSED — THE HARNESS IS MEASURING NOTHING' : 'failed, as required'}`);

  const b = (sample as Record<string, unknown>).trueOverall;
  lines.push(`  B  misspelled field read (trueOverall, not trueOvr): ${b === undefined ? 'undefined, as required' : `RETURNED ${String(b)} — THE HARNESS IS MEASURING NOTHING`}`);

  const c = sample.trueOvr === 71 && sample.position === 'WR';
  lines.push(`  C  real read: ${c ? 'passed, as required' : 'FAILED — THE HARNESS CANNOT READ ITS OWN DATA'}`);

  if (a || b !== undefined || !c) {
    lines.push('  CANARIES FAILED — refusing to run. Nothing this file printed afterwards would mean anything.');
  }
  return lines;
}
function canariesPassed(): boolean {
  const sample = { id: 'x', trueOvr: 71, position: 'WR' as string };
  return !((sample as Record<string, unknown>).trueOvr === 99)
    && (sample as Record<string, unknown>).trueOverall === undefined
    && sample.trueOvr === 71;
}

function mergeAwards(into: Record<string, Record<string, number>>, from: Record<string, Record<string, number>>) {
  for (const [type, byPos] of Object.entries(from)) {
    for (const [pos, n] of Object.entries(byPos)) {
      (into[type] ??= {})[pos] = ((into[type] ?? {})[pos] ?? 0) + n;
    }
  }
}

function printCensus(c: RunCensus) {
  console.log('\n' + '='.repeat(70));
  console.log('CENSUS — not pass/fail, but the shape a human has to look at');
  console.log('='.repeat(70));
  console.log(`${c.leagues} league(s), ${c.leagueSeasons} league-season(s), configurations: ${c.configsSeen.join(', ')}`);

  console.log('\n--- award winners by position ---');
  for (const type of AWARD_TYPES) {
    const byPos = c.awards[type];
    if (!byPos) continue;
    const total = Object.values(byPos).reduce((a, b) => a + b, 0);
    const line = Object.entries(byPos).sort((a, b) => b[1] - a[1])
      .map(([p, n]) => `${p} ${(100 * n / total).toFixed(1)}%`).join('  ');
    console.log(`  ${type.padEnd(13)} n=${String(total).padStart(4)}  ${line}`);
  }

  console.log('\n--- starter rating and age, by season index (1 = founding season) ---');
  console.log('  season   starterOVR mean(sd)   age mean(sd)   active   FA pool   retired');
  const byIndex = new Map<number, SeasonCensus[]>();
  for (const s of c.seasons) (byIndex.get(s.seasonIndex) ?? byIndex.set(s.seasonIndex, []).get(s.seasonIndex)!).push(s);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  for (const [idx, rows] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(
      `  ${String(idx).padStart(6)}   ${avg(rows.map((r) => r.starterOvrMean)).toFixed(2).padStart(6)} (${avg(rows.map((r) => r.starterOvrSd)).toFixed(2)})`
      + `        ${avg(rows.map((r) => r.ageMean)).toFixed(2).padStart(5)} (${avg(rows.map((r) => r.ageSd)).toFixed(2)})`
      + `   ${Math.round(avg(rows.map((r) => r.activePlayers))).toString().padStart(6)}`
      + `   ${Math.round(avg(rows.map((r) => r.freeAgents))).toString().padStart(7)}`
      + `   ${Math.round(avg(rows.map((r) => r.retiredTotal))).toString().padStart(7)}`
      + `   [${rows.length} league(s)]`,
    );
  }

  console.log('\n--- the same, split by configuration (drift is a per-ruleset question) ---');
  const byConfig = new Map<string, SeasonCensus[]>();
  for (const s of c.seasons) (byConfig.get(s.config) ?? byConfig.set(s.config, []).get(s.config)!).push(s);
  for (const [config, rows] of [...byConfig.entries()].sort()) {
    const first = rows.filter((r) => r.seasonIndex === 1);
    const last = rows.filter((r) => r.seasonIndex === Math.max(...rows.map((x) => x.seasonIndex)));
    if (first.length === 0 || last.length === 0) continue;
    console.log(`  ${config.padEnd(26)} season 1 starterOVR ${avg(first.map((r) => r.starterOvrMean)).toFixed(2)}`
      + ` -> season ${last[0].seasonIndex} ${avg(last.map((r) => r.starterOvrMean)).toFixed(2)}`
      + `   age ${avg(first.map((r) => r.ageMean)).toFixed(2)} -> ${avg(last.map((r) => r.ageMean)).toFixed(2)}`);
  }
}

async function main() {
  console.log('CANARIES');
  for (const line of runCanaries()) console.log(line);
  if (!canariesPassed()) process.exit(1);

  if (MERGE_DIR) {
    const merged = emptyCensus();
    const files = readdirSync(MERGE_DIR).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const part = JSON.parse(readFileSync(join(MERGE_DIR, f), 'utf8')) as RunCensus;
      merged.seasons.push(...part.seasons);
      mergeAwards(merged.awards, part.awards);
      merged.leagues += part.leagues;
      merged.leagueSeasons += part.leagueSeasons;
      for (const c of part.configsSeen) if (!merged.configsSeen.includes(c)) merged.configsSeen.push(c);
    }
    console.log(`\nMerged ${files.length} census file(s) from ${MERGE_DIR}`);
    printCensus(merged);
    process.exit(0);
  }

  const indexes = Array.from({ length: LEAGUES }, (_, i) => i).filter((i) => !SHARD || i % SHARD.n === SHARD.i);
  console.log(`\nSimulation health run: ${indexes.length} league(s) x ${SEASONS} season(s)`
    + (SHARD ? ` — shard ${SHARD.i + 1} of ${SHARD.n} (indexes ${indexes.join(', ')})` : '')
    + `\nSettings matrix: ${MATRIX.map((m) => m.name).join(', ')}\n`);

  /**
   * THE ORPHAN READING IS A DIFFERENCE, NOT A TOTAL. This database is shared,
   * and it already holds orphans that other runs left behind. What this run is
   * answerable for is what it ADDED, so the total is taken before and after and
   * only the delta is reported as a violation. See checkOrphans().
   */
  const orphansBefore = await checkOrphans();
  console.log(`Orphan rows already on this database before the run: ${orphansBefore.length === 0 ? 'none' : orphansBefore[0].sample.join(', ')}\n`);

  const allViolations: TaggedViolation[] = [];
  const stalls: string[] = [];
  const census = emptyCensus();
  const startedAt = Date.now();

  for (const i of indexes) {
    process.stdout.write(`League ${i} (${kindLabel(i)}, ${startTypeFor(i)})... `);
    const at = Date.now();
    const result = await runOneLeague(i);
    allViolations.push(...result.violations);
    if (result.stall) stalls.push(result.stall);
    census.seasons.push(...result.census);
    mergeAwards(census.awards, result.awards);
    census.leagues += 1;
    census.leagueSeasons += result.seasonsCompleted;
    if (!census.configsSeen.includes(kindLabel(i))) census.configsSeen.push(kindLabel(i));
    console.log(`${result.seasonsCompleted} season(s), ${result.steps} steps, ${result.violations.length} violation(s), ${((Date.now() - at) / 1000).toFixed(0)}s${result.stall ? ' — STALLED' : ''}`);
    if (result.stall) console.log(`  ${result.stall}`);
  }

  const orphansAfter = await checkOrphans();
  const orphanDelta = diffOrphans(orphansBefore, orphansAfter);

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  if (allViolations.length === 0 && stalls.length === 0 && orphanDelta.length === 0) {
    console.log('No invariant violations found. All leagues completed on schedule, and no orphaned rows were left behind.');
  } else {
    const byRule = new Map<string, TaggedViolation[]>();
    for (const v of allViolations) (byRule.get(v.id) ?? byRule.set(v.id, []).get(v.id)!).push(v);

    for (const [rule, vs] of [...byRule.entries()].sort()) {
      const severity = vs[0].severity.toUpperCase();
      const totalCount = vs.reduce((sum, v) => sum + v.count, 0);
      const configs = [...new Set(vs.map((v) => v.config))].sort();
      console.log(`\n[${severity}] ${rule} — hit ${vs.length} time(s) across the run, ${totalCount} row(s) total`);
      console.log(`  ${vs[0].message}`);
      console.log(`  configurations affected: ${configs.join(', ')}`);
      /**
       * WHERE IN THE YEAR IT HAPPENS, not just that it happens. A rule that
       * fires in PRESEASON and a rule that fires in REGULAR week 12 have
       * different causes even when they are the same rule, and the single
       * example this used to print could not tell them apart — which is
       * exactly the question "why is this club a body short" turns on.
       */
      const byPhase = new Map<string, number>();
      for (const v of vs) byPhase.set(v.phase, (byPhase.get(v.phase) ?? 0) + 1);
      console.log(`  phases: ${[...byPhase.entries()].sort((a, b) => b[1] - a[1]).map(([ph, n]) => `${ph} x${n}`).join(', ')}`);
      const earliest = vs.reduce((a, b) => (a.leagueIdx < b.leagueIdx || (a.leagueIdx === b.leagueIdx && a.step <= b.step) ? a : b));
      console.log(`  first seen: league ${earliest.leagueIdx} (${earliest.config}), ${earliest.phase} year ${earliest.seasonYear} wk ${earliest.week}: ${earliest.sample.join(', ')}`);
      const example = vs[vs.length - 1];
      console.log(`  last seen:  league ${example.leagueIdx} (${example.config}), ${example.phase} year ${example.seasonYear} wk ${example.week}: ${example.sample.join(', ')}`);
    }

    for (const s of stalls) console.log(`\n[ERROR] STALLED — ${s}`);
    for (const o of orphanDelta) console.log(`\n[ERROR] INV-30 ORPHANS CREATED BY THIS RUN — ${o}`);
  }

  printCensus(census);

  if (OUT_FILE) {
    writeFileSync(OUT_FILE, JSON.stringify(census, null, 2));
    console.log(`\nCensus written to ${OUT_FILE}`);
  }

  const errorCount = allViolations.filter((v) => v.severity === 'error').length;
  console.log('\n' + '='.repeat(70));
  console.log(`${allViolations.length} total violation(s) (${errorCount} error, ${allViolations.length - errorCount} warning) across ${indexes.length} league(s) in ${((Date.now() - startedAt) / 60000).toFixed(1)} minutes.`);

  process.exit(errorCount > 0 || stalls.length > 0 || orphanDelta.length > 0 ? 1 : 0);
}

/** What the run added, edge by edge — see the note at the call site. */
function diffOrphans(before: Violation[], after: Violation[]): string[] {
  const parse = (vs: Violation[]) => new Map(vs.flatMap((v) => v.sample).map((line) => {
    const idx = line.lastIndexOf(': ');
    return [line.slice(0, idx), Number(line.slice(idx + 2))] as [string, number];
  }));
  const b = parse(before);
  const out: string[] = [];
  for (const [edge, n] of parse(after)) {
    const was = b.get(edge) ?? 0;
    if (n > was) out.push(`${edge}: ${n - was} new (${was} -> ${n})`);
  }
  return out;
}

main().catch((e) => { console.error(e); process.exit(1); });
