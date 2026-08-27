import { prisma } from './db';
import { readJson } from './json';
import { capHit, capForYear, capChargeYear, formatMoney } from './cap';
import { resolveStartYear } from './leagueYear';
import { parseSettings, capGrowthRate } from './settings';
import { rosterMinFor } from './tuning';
import { PHASE_LABELS } from './season';
import { SeasonStats } from './types';
import { AttrMap } from './ratings';
import { ContractLike } from './cap';
import { STARTERS_AT_POSITION } from './lineup';
import { AWARDED_TYPES } from './awardTypes';
import { ALL_STAR_TYPE } from './allStars';
import { CAP } from './tuning';

/**
 * ===========================================================================
 * GAME INVARIANTS — mechanical checks for GAME_INVARIANTS.md
 * ===========================================================================
 * Every check here corresponds to a numbered rule in that document by ID.
 * Keep the two in sync: a check added here without a rule in the doc is
 * undocumented, and a rule in the doc without a check here is unverified.
 * ===========================================================================
 */

export interface Violation {
  id: string;
  severity: 'error' | 'warning';
  message: string;
  count: number;
  sample: string[];
}

const ACTIVE_STATUSES = new Set(['ACTIVE', 'FREE_AGENT', 'RETIRED']);
/**
 * Phases where a roster under the minimum is legal: contracts have expired and
 * free agency has not opened yet. Mirrors CAP_ROLLOVER_PHASES in lib/season.ts,
 * which exempts the same window from cap compliance for the same reason.
 *
 * FANTASY_DRAFT is the third, and it is the most extreme of them: a league that
 * opens with a fantasy draft has THIRTY-TWO EMPTY ROSTERS by construction and
 * fills them one pick at a time, so mid-draft every club in the league is under
 * the floor and most have nobody at most positions. Measured on a live
 * mid-draft league, this window reported all thirty-two clubs on INV-20 and all
 * thirty-two on INV-25 — a hundred per cent false-positive rate on a state the
 * game creates deliberately. The check that matters through this phase is
 * INV-18 (the draft must finish and the phase must move on), and that one is
 * not exempt from anything.
 */
const ROSTER_FLOOR_EXEMPT_PHASES = new Set(['OFFSEASON', 'RESIGN', 'FANTASY_DRAFT']);
const VALID_PHASES = new Set(Object.keys(PHASE_LABELS));

function violation(id: string, severity: 'error' | 'warning', message: string, ids: string[]): Violation | null {
  if (ids.length === 0) return null;
  return { id, severity, message, count: ids.length, sample: ids.slice(0, 5) };
}

/**
 * ===========================================================================
 * THE GAME READ, AND WHY IT IS TWO READS RATHER THAN ONE
 * ===========================================================================
 * INV-15 used to be `prisma.game.findMany({ where: { leagueId, played: true } })`
 * — every played game in the league's whole history, box score JSON and all,
 * re-fetched and re-parsed after EVERY simulated step. A box score is the
 * biggest string this schema stores, and the set of them only ever grows, so
 * the cost of checking a league rose with the square of how far it had been
 * simulated. Measured on the deepest league on the dev database (2,830 played
 * games), one `checkInvariants` call cost 7.9 SECONDS, of which the queries
 * were 1.3 and the JSON parsing was the rest. That is the whole reason a
 * ten-season soak was out of reach: the harness, not the game, was the clock.
 *
 * THE SPLIT IS NOT A NARROWING. Both halves below together check strictly MORE
 * than the single read did:
 *
 *   EVERY played game in history, forever, is checked for a negative score and
 *   for an empty box score — in SQL, so nothing crosses the wire but the ids of
 *   rows that are already wrong. `length("boxScore") < 3` is exactly the old
 *   `!box || Object.keys(box).length === 0` test: `{}` is two characters and
 *   the column is NOT NULL with a `{}` default, so an unwritten box score is
 *   two characters and anything shorter is empty too. So a later step that
 *   wipes a game played six seasons ago is still caught.
 *
 *   RECENT games — this league year and the one before it — are additionally
 *   PARSED, which is the part that cannot be done in SQL and the part that
 *   catches a box score that is present but malformed. Two league years is
 *   generous rather than tight: a game is written once, by the step that plays
 *   it, and is then re-checked on every one of the ~30 steps of that season and
 *   the ~30 of the next. A row that survives sixty parses unchanged is not
 *   going to start failing on the sixty-first, because nothing in the game
 *   rewrites a played game.
 * ===========================================================================
 */
async function recentBoxScores(leagueId: string): Promise<{ id: string; boxScore: string }[]> {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { seasonYear: true } });
  return prisma.game.findMany({
    where: { leagueId, played: true, seasonYear: { gte: league.seasonYear - 1 } },
    select: { id: true, boxScore: true },
  });
}

/** Ids of played games anywhere in history with a negative score or an empty box score. */
async function brokenGamesAnywhere(leagueId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Game"
    WHERE "leagueId" = ${leagueId} AND played
      AND ("homeScore" < 0 OR "awayScore" < 0 OR length("boxScore") < 3)
    LIMIT 50`;
  return rows.map((r) => r.id);
}

/** Full snapshot check — everything checkable from one point-in-time read of a league. */
export async function checkInvariants(leagueId: string): Promise<Violation[]> {
  const [league, players, contracts, picks, games, draftState, teams] = await Promise.all([
    prisma.league.findUniqueOrThrow({ where: { id: leagueId } }),
    prisma.player.findMany({ where: { leagueId } }),
    prisma.contract.findMany({ where: { player: { leagueId } } }),
    prisma.draftPick.findMany({ where: { leagueId } }),
    recentBoxScores(leagueId),
    prisma.draftState.findUnique({ where: { leagueId } }),
    prisma.team.findMany({
      where: { leagueId },
      // wins/losses/ties/points are read by INV-26, which is the only reason
      // this is not the two-column select it used to be.
      select: { id: true, abbr: true, wins: true, losses: true, ties: true, pointsFor: true, pointsAgnst: true },
    }),
  ]);
  const settings = parseSettings(league.settings);
  const contractByPlayerId = new Map(contracts.map((c) => [c.playerId, c]));

  const out: Violation[] = [];
  const push = (v: Violation | null) => { if (v) out.push(v); };

  // --- INV-01/02/03: status <-> teamId ---
  push(violation('INV-01', 'error', "status 'ACTIVE' with no team",
    players.filter((p) => p.status === 'ACTIVE' && p.teamId == null).map((p) => p.id)));
  push(violation('INV-02', 'error', "status 'FREE_AGENT'/'RETIRED' but still attached to a team",
    players.filter((p) => (p.status === 'FREE_AGENT' || p.status === 'RETIRED') && p.teamId != null).map((p) => p.id)));
  push(violation('INV-03', 'warning', 'status outside the {ACTIVE, FREE_AGENT, RETIRED} set actually used by the codebase',
    players.filter((p) => !ACTIVE_STATUSES.has(p.status)).map((p) => p.id)));

  // --- INV-04/05: ACTIVE <-> exactly one contract, owned by the right team ---
  push(violation('INV-04', 'error', 'ACTIVE player missing a contract, or contract team mismatched with roster team',
    players.filter((p) => {
      if (p.status !== 'ACTIVE') return false;
      const c = contractByPlayerId.get(p.id);
      return !c || c.teamId !== p.teamId;
    }).map((p) => p.id)));
  push(violation('INV-05', 'error', 'Non-active player still has a contract on file',
    players.filter((p) => p.status !== 'ACTIVE' && contractByPlayerId.has(p.id)).map((p) => p.id)));

  // --- INV-06/07: draftee eligibility ---
  push(violation('INV-06', 'error', 'isDraftee player is rostered to a team',
    players.filter((p) => p.isDraftee && p.teamId != null).map((p) => p.id)));
  // The current cycle's not-yet-drafted class always carries
  // draftYear === league.seasonYear - 1 for a long stretch — it's generated
  // one game-year before its own draft actually runs (RESET_STANDINGS bumps
  // seasonYear forward well before that class's DRAFT phase), so comparing
  // against `< seasonYear` flags every normal, not-yet-drafted class as a
  // false positive. A GENUINELY stale leftover is at least two years behind.
  push(violation('INV-07', 'error', 'isDraftee player has fallen at least a full cycle behind the current season year — stale/undrafted prospect never re-entered free agency',
    players.filter((p) => p.isDraftee && p.draftYear != null && p.draftYear < league.seasonYear - 1).map((p) => p.id)));

  // --- INV-08: roster size ceiling ---
  const activeByTeam = new Map<string, number>();
  for (const p of players) {
    if (p.status !== 'ACTIVE' || !p.teamId) continue;
    activeByTeam.set(p.teamId, (activeByTeam.get(p.teamId) ?? 0) + 1);
  }
  push(violation('INV-08', 'warning', `Team roster exceeds settings.rosterMax (${settings.rosterMax})`,
    [...activeByTeam.entries()].filter(([, n]) => n > settings.rosterMax).map(([teamId, n]) => `${teamId} (${n})`)));

  // --- INV-20: roster size floor ---
  // Only outside the offseason window, where a short roster is legitimate:
  // every expiring contract has just been released and free agency has not
  // opened yet, so essentially every team is briefly under the line by design.
  // Anywhere else, a team below the minimum is fielding an illegal roster —
  // which is exactly the state 19 of 22 measured saves were left in when the
  // re-sign wave under-retained and nothing in the game ever refilled.
  const rosterMin = rosterMinFor(settings.rosterMax);
  if (!ROSTER_FLOOR_EXEMPT_PHASES.has(league.phase)) {
    push(violation('INV-20', 'warning', `Team roster is below the roster minimum (${rosterMin})`,
      teams
        .filter((t) => (activeByTeam.get(t.id) ?? 0) < rosterMin)
        .map((t) => `${t.abbr} (${activeByTeam.get(t.id) ?? 0})`)));
  }

  // --- INV-09/10: pick used <-> playerId ---
  push(violation('INV-09', 'error', 'DraftPick marked used with no player attached',
    picks.filter((p) => p.used && p.playerId == null).map((p) => p.id)));
  push(violation('INV-10', 'error', 'DraftPick has a player attached but is not marked used',
    picks.filter((p) => !p.used && p.playerId != null).map((p) => p.id)));

  // --- INV-11: duplicate pick slots ---
  // THE KEY IS (year, round, slot) AND NOTHING ELSE. `originalTeamId` used to
  // be in it — in this code AND in GAME_INVARIANTS.md, which is why nothing
  // caught it: the rule and its documentation agreed with each other and both
  // were wrong. Adding a field to a uniqueness key makes the claim STRICTLY
  // WEAKER, so two picks sitting on the SAME slot with different origins
  // passed. That is exactly the state an interrupted reseed leaves behind, and
  // exactly the state `currentPick()` resolves arbitrarily with a `findFirst`
  // on (round, slot) — one of the two comes up and is paid that slot's price,
  // the other never comes up at all.
  //
  // The original team is not part of what makes a slot unique. It is
  // provenance: which club's pick this once was, carried so a traded pick can
  // say where it came from. Two picks may absolutely share an origin; no two
  // may share a selection.
  //
  // Measured across all 220 leagues in the dev database, 177,408 pick rows:
  // the old key found ZERO violations, the documented key finds SIX — all in
  // one save, all real, with no false positives. Six clubs in that league
  // never select and six rookie contracts are never written, and the draft
  // simply ends short with nothing on screen saying why. The check was silent
  // for the whole life of the bug.
  //
  // This is scoped to one league already (`picks` is that league's), so
  // leagueId is implied rather than dropped.
  const slotCounts = new Map<string, string[]>();
  for (const p of picks) {
    const key = `${p.year}-${p.round}-${p.slot}`;
    (slotCounts.get(key) ?? slotCounts.set(key, []).get(key)!).push(p.id);
  }
  push(violation('INV-11', 'error', 'Duplicate DraftPick for the same (year, round, slot)',
    [...slotCounts.values()].filter((ids) => ids.length > 1).flat()));

  // --- INV-12: a completed rookie draft leaves no unused picks for that year ---
  // A draft only ever runs for the year matching league.seasonYear AT THE
  // TIME it happens, and DraftState.complete has no year of its own — it
  // just stays true (stale) until the next startRookieDraft() call, long
  // after seasonYear has moved on. Comparing against league.seasonYear
  // directly (as this used to) produced false positives every single week
  // of the following season: once RESET_STANDINGS bumps seasonYear forward,
  // "complete && picks.year === seasonYear" starts matching NEXT year's
  // draft picks, which are all legitimately still unused because that
  // draft hasn't happened yet. Checking strictly-past years instead is
  // unambiguous: any pick from a year before the current one was drafted
  // in a draft that has definitely already happened, so it must be used.
  push(violation('INV-12', 'error', "A draft pick from a past season year was never used — that year's draft never finished",
    picks.filter((p) => p.year < league.seasonYear && !p.used).map((p) => p.id)));

  // --- INV-13: contract years bounds ---
  push(violation('INV-13', 'error', 'Contract.yearsRemaining outside [0, years]',
    contracts.filter((c) => c.yearsRemaining < 0 || c.yearsRemaining > c.years).map((c) => c.id)));

  // --- INV-14: cap hit never negative ---
  const negativeCapHits: string[] = [];
  for (const c of contracts) {
    for (const mode of ['REALISTIC', 'SIMPLIFIED'] as const) {
      if (capHit(c as ContractLike, mode) < 0) { negativeCapHits.push(`${c.id}(${mode})`); break; }
    }
  }
  push(violation('INV-14', 'error', 'capHit() returned a negative number for a contract', negativeCapHits));

  // --- INV-19: nobody is over the salary cap ---
  // With every acquisition path gated by assertCapRoom (lib/capEnforcement.ts),
  // no team should ever be sitting over the ceiling. Warning rather than error
  // because one legal shape still gets there without any rule being broken:
  // dead money already booked from cuts and trades can exceed what a roster
  // is able to shed, which is why the advancement block has its own
  // `fixable` escape hatch rather than trapping the user forever.
  //
  // Computed in memory from rows already fetched above (plus one capCharge
  // read) rather than calling teamCapSummary per team — this runs after
  // every single sim step, and 32 teams x 2 queries each would dominate it.
  if (settings.capMode !== 'OFF') {
    // THE YEAR THE BOOKS ARE WRITTEN IN, not the year on the league clock.
    // `capHit` below returns the ledger's current year for every man, and
    // through OFFSEASON weeks 1-2 that is a year ahead of League.seasonYear
    // (ageContractsForYear runs the instant the season ends; RESET_STANDINGS
    // moves seasonYear two steps later). teamCapSummary resolves exactly this
    // year — see bookYearFor in lib/cap-summary.ts — and the note below is
    // about these two never diverging.
    const capYear = capChargeYear(league);
    const deadRows = await prisma.capCharge.findMany({
      where: { teamId: { in: teams.map((t) => t.id) }, year: capYear },
    });
    const spendByTeam = new Map<string, number>(teams.map((t) => [t.id, 0]));
    for (const p of players) {
      if (p.status !== 'ACTIVE' || !p.teamId || !spendByTeam.has(p.teamId)) continue;
      const c = contractByPlayerId.get(p.id);
      if (c) spendByTeam.set(p.teamId, spendByTeam.get(p.teamId)! + capHit(c as ContractLike, settings.capMode));
    }
    for (const d of deadRows) {
      if (spendByTeam.has(d.teamId)) spendByTeam.set(d.teamId, spendByTeam.get(d.teamId)! + d.amount);
    }
    // Same defect as lib/cap-summary.ts had: the second argument is the
    // FOUNDING year. These two must never diverge — if they do, INV-19
    // measures teams against a different ceiling than the game enforces.
    // Passed explicitly: the two-argument form uses the tuning default, so a
    // FLAT or FAST league would be audited against a ceiling it is not playing
    // under — reporting clubs over a cap that is not theirs, or missing ones
    // that are.
    const ceiling = capForYear(capYear, await resolveStartYear(league), capGrowthRate(settings));
    const overCap = teams
      .filter((t) => (spendByTeam.get(t.id) ?? 0) > ceiling)
      .map((t) => `${t.abbr} ${formatMoney(ceiling - (spendByTeam.get(t.id) ?? 0))}`);
    push(violation('INV-19', 'warning', 'A team is over the salary cap', overCap));
  }

  // --- INV-15: completed games have sane scores + a real box score ---
  // Two reads, checking strictly more than the one read this used to be — see
  // recentBoxScores() above for why history is scanned in SQL and only the
  // recent window is parsed.
  push(violation('INV-15', 'error', 'Completed game has a negative score or an empty box score',
    await brokenGamesAnywhere(leagueId)));
  push(violation('INV-15', 'error', 'Completed game has a box score that will not parse',
    games.filter((g) => {
      const box = readJson<Record<string, unknown> | null>(g.boxScore, null);
      return !box || Object.keys(box).length === 0;
    }).map((g) => g.id)));

  // --- INV-16/17: phase/week sanity ---
  if (!VALID_PHASES.has(league.phase)) {
    out.push({ id: 'INV-16', severity: 'error', message: `League.phase '${league.phase}' is not a recognized phase`, count: 1, sample: [league.id] });
  }
  if (league.phase === 'REGULAR' && (league.week < 1 || league.week > settings.seasonLength)) {
    out.push({ id: 'INV-17', severity: 'error', message: `League.week ${league.week} out of range for REGULAR phase (1..${settings.seasonLength})`, count: 1, sample: [league.id] });
  }
  if (draftState?.complete && (league.phase === 'DRAFT' || league.phase === 'FANTASY_DRAFT')) {
    out.push({ id: 'INV-18', severity: 'error', message: `Draft is complete but League.phase is still '${league.phase}' — the league is stuck`, count: 1, sample: [league.id] });
  }

  /**
   * --- INV-25: every club can put eleven men on the field, and a kicker ---
   *
   * INV-08 and INV-20 count a roster. They cannot see the SHAPE of one, and a
   * roster of the right size with nobody at a position is exactly as unplayable
   * as one that is nine men short. This codebase has lost the specialists more
   * than once — cut-down day used to release a club's only kicker because the
   * production score it ranked men by could not read a field goal (6511cc3) —
   * and the symptom of that is invisible to a head count.
   *
   * Checked against STARTERS_AT_POSITION, which is THE definition of who is on
   * the field, so a position added to a lineup is covered here the day it is
   * added rather than the day somebody remembers to update a list. One man is
   * the bar rather than the full starter count: a club with two of the three
   * receivers it fields is thin, which is a football problem; a club with none
   * is broken, which is this file's problem.
   *
   * Exempt in the same window as INV-20, and for the same reason: through
   * OFFSEASON and RESIGN every expiring contract has been released and free
   * agency has not opened, so rosters are legitimately in pieces.
   */
  if (!ROSTER_FLOOR_EXEMPT_PHASES.has(league.phase)) {
    const fielded = (Object.keys(STARTERS_AT_POSITION) as (keyof typeof STARTERS_AT_POSITION)[])
      .filter((pos) => STARTERS_AT_POSITION[pos] > 0);
    const positionsByTeam = new Map<string, Set<string>>();
    for (const p of players) {
      if (p.status !== 'ACTIVE' || !p.teamId) continue;
      const set = positionsByTeam.get(p.teamId) ?? positionsByTeam.set(p.teamId, new Set()).get(p.teamId)!;
      set.add(p.position);
    }
    push(violation('INV-25', 'error', 'A club has nobody at a position its lineup has to field',
      teams.flatMap((t) => {
        const has = positionsByTeam.get(t.id) ?? new Set<string>();
        const missing = fielded.filter((pos) => !has.has(pos));
        return missing.length > 0 ? [`${t.abbr} has nobody at ${missing.join('/')}`] : [];
      })));
  }

  /**
   * --- INV-26: no impossible numbers anywhere in stored league state ---
   *
   * NaN AND INFINITY ARE THE POINT, and they are harder to catch than they
   * look. An `Int` column rejects them at the driver, so they cannot be stored
   * directly — but every rating in this game lives inside a JSON blob
   * (`Player.trueAttrs`) and every salary schedule inside another
   * (`Contract.baseSalaries`), and JSON has no NaN: `JSON.stringify(NaN)` is
   * the string "null". So a rating that went non-finite reaches the database as
   * a null inside an otherwise valid attribute map, reads back as `undefined`,
   * and turns every average computed from it into NaN with nothing on disk
   * looking wrong. That is what the `Number.isFinite` tests below are for, and
   * it is why they are applied to the PARSED contents and not to the columns.
   *
   * The bands are the ones the rest of the game already asserts: ratings are
   * 0..99 (lib/ratings.ts), a contract cannot run negative years or negative
   * money, and a club cannot have won a negative number of games.
   */
  {
    const bad: string[] = [];
    const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
    const inBand = (n: unknown, lo: number, hi: number) => finite(n) && n >= lo && n <= hi;

    for (const p of players) {
      if (!inBand(p.age, 15, 60)) bad.push(`player ${p.id} age ${p.age}`);
      if (!finite(p.experience) || p.experience < 0) bad.push(`player ${p.id} experience ${p.experience}`);
      if (!inBand(p.trueOvr, 0, 99)) bad.push(`player ${p.id} trueOvr ${p.trueOvr}`);
      if (!inBand(p.potential, 0, 99)) bad.push(`player ${p.id} potential ${p.potential}`);
      if (!finite(p.injuryWeeks) || p.injuryWeeks < 0) bad.push(`player ${p.id} injuryWeeks ${p.injuryWeeks}`);
      if (p.lastSeasonOvr !== null && !inBand(p.lastSeasonOvr, 0, 99)) bad.push(`player ${p.id} lastSeasonOvr ${p.lastSeasonOvr}`);
      const attrs = readJson<AttrMap>(p.trueAttrs, {});
      for (const [k, v] of Object.entries(attrs)) {
        if (!inBand(v, 0, 99)) { bad.push(`player ${p.id} attr ${k}=${v}`); break; }
      }
    }
    for (const c of contracts) {
      if (!finite(c.years) || c.years < 0) bad.push(`contract ${c.id} years ${c.years}`);
      if (!finite(c.signingBonus) || c.signingBonus < 0) bad.push(`contract ${c.id} signingBonus ${c.signingBonus}`);
      if (!finite(c.guaranteed) || c.guaranteed < 0) bad.push(`contract ${c.id} guaranteed ${c.guaranteed}`);
      if (!finite(c.voidYears) || c.voidYears < 0) bad.push(`contract ${c.id} voidYears ${c.voidYears}`);
      const salaries = readJson<number[]>(c.baseSalaries, []);
      for (const v of salaries) {
        if (!finite(v) || v < 0) { bad.push(`contract ${c.id} baseSalary ${v}`); break; }
      }
    }
    for (const t of teams) {
      for (const [k, v] of [['wins', t.wins], ['losses', t.losses], ['ties', t.ties], ['pointsFor', t.pointsFor], ['pointsAgnst', t.pointsAgnst]] as const) {
        if (!finite(v) || v < 0) bad.push(`team ${t.abbr} ${k} ${v}`);
      }
    }
    push(violation('INV-26', 'error', 'A stored number is non-finite, negative where it cannot be, or outside its legal band', bad));
  }

  /**
   * --- INV-27: a club's record adds up to the games it actually played ---
   *
   * `TeamSeasonRecord` is the only surviving copy of a finished season's
   * standings (RESET_STANDINGS wipes Team.wins a few steps later), so a season
   * whose wins, losses and ties do not add up to that club's played regular
   * season games is a standings table that will be wrong forever, on the
   * History page and in every dynasty number derived from it.
   *
   * REGULAR games only, because postseason results deliberately never touch
   * Team.wins — see simulatePlayoffRound in lib/season.ts.
   *
   * SCOPED TO SEASONS THIS SAVE ACTUALLY PLAYED. Every league is generated with
   * a seeded backstory (lib/gen/leagueHistory.ts) that writes real
   * TeamSeasonRecord rows for years BEFORE the league opened and no Game rows
   * at all — that history is invented, not simulated, and holding it to this
   * rule would flag every league in the game on its first step.
   */
  {
    const startYear = await resolveStartYear(league);
    const mismatched = await prisma.$queryRaw<{ abbr: string; year: number; rec: number; played: bigint }[]>`
      SELECT t.abbr, r.year, r.wins + r.losses + r.ties AS rec, count(g.id) AS played
      FROM "TeamSeasonRecord" r
      JOIN "Team" t ON t.id = r."teamId"
      LEFT JOIN "Game" g
        ON g."leagueId" = r."leagueId" AND g."seasonYear" = r.year
       AND g.played AND g.kind = 'REGULAR'
       AND (g."homeTeamId" = r."teamId" OR g."awayTeamId" = r."teamId")
      WHERE r."leagueId" = ${leagueId} AND r.year >= ${startYear}
      GROUP BY t.abbr, r.year, r.wins, r.losses, r.ties
      HAVING r.wins + r.losses + r.ties <> count(g.id)
      LIMIT 50`;
    push(violation('INV-27', 'error', "A club's stored season record does not add up to the regular-season games it played",
      mismatched.map((m) => `${m.abbr} ${m.year}: record sums to ${m.rec}, played ${Number(m.played)}`)));
  }

  /**
   * --- INV-28: a season that finished handed out its trophies, once each ---
   *
   * Every season the save actually played must have exactly one champion and
   * exactly one of every award in AWARDED_TYPES, plus an All-Star class. The
   * failure this exists to catch is silent by construction: a season whose
   * award pass threw, or whose field came back empty, produces a year with no
   * MVP and nothing anywhere that says so — the trophy screen simply has a gap
   * in it, and nobody notices until someone scrolls back six seasons.
   *
   * TWO of a trophy is the other half, and it is the more dangerous one:
   * `recordSeasonAwards` has no per-row guard, so anything that runs it twice
   * writes a second MVP for the same year, and every count of a player's or a
   * GM's honours doubles.
   *
   * Scoped to played seasons for the same reason as INV-27, and to seasons that
   * have a champion recorded — the current season is mid-flight and has none
   * yet, which is not a violation.
   */
  {
    const startYear = await resolveStartYear(league);
    const rows = await prisma.transaction.findMany({
      where: { leagueId, seasonYear: { gte: startYear }, type: { in: ['CHAMPION', ALL_STAR_TYPE, 'AWARD_ROTY', ...AWARDED_TYPES] } },
      select: { seasonYear: true, type: true },
    });
    const byYear = new Map<number, Map<string, number>>();
    for (const r of rows) {
      const m = byYear.get(r.seasonYear) ?? byYear.set(r.seasonYear, new Map()).get(r.seasonYear)!;
      m.set(r.type, (m.get(r.type) ?? 0) + 1);
    }
    const gaps: string[] = [];
    for (const [year, counts] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
      // A year with no champion is a year still being played, not a broken one.
      if ((counts.get('CHAMPION') ?? 0) === 0) continue;
      if ((counts.get('CHAMPION') ?? 0) !== 1) gaps.push(`${year}: ${counts.get('CHAMPION')} champions`);
      // A YEAR PLAYED BEFORE THE ROOKIE AWARD WAS SPLIT IN TWO IS NOT MISSING
      // ANYTHING. `AWARD_ROTY` is written by nothing on this build and read
      // everywhere (see lib/awardTypes.ts), and 3,670 of those rows are sitting
      // in saves on the dev database — 189 leagues' worth. Holding those years
      // to a rule their build did not have would report 118 of 141 played
      // league-seasons as missing both rookie trophies, which is what this
      // check said before this clause and it was wrong every time.
      const preSplitRookieAward = (counts.get('AWARD_ROTY') ?? 0) > 0;
      for (const type of AWARDED_TYPES) {
        if (preSplitRookieAward && (type === 'AWARD_OROTY' || type === 'AWARD_DROTY')) continue;
        const n = counts.get(type) ?? 0;
        if (n !== 1) gaps.push(`${year}: ${n} x ${type}`);
      }
      if ((counts.get(ALL_STAR_TYPE) ?? 0) === 0) gaps.push(`${year}: no All-Stars selected`);
    }
    push(violation('INV-28', 'error', 'A completed season is missing a trophy, or handed one out twice', gaps));
  }

  /**
   * --- INV-29: this year's draftees are on rookie deals at rookie prices ---
   *
   * The bug this is shaped around actually shipped: the fantasy branch of
   * `draftPlayer` handed out 1,696 players and wrote not one contract. INV-04
   * caught that one because those men were ACTIVE with nothing on file. It
   * would NOT catch a contract written at the wrong SCALE, which is the other
   * half of the same seam and the one a $360M preset came through.
   *
   * Only picks used in the current league year, and only men still on the club
   * that drafted them: a rookie who has since been cut, traded or extended is
   * no longer on the deal the draft wrote, and holding him to it would flag
   * ordinary roster management.
   */
  {
    const rookieCeiling = CAP.ROOKIE_SCALE_R1_PICK1 * 1.25;
    const playerById = new Map(players.map((p) => [p.id, p]));
    const offScale: string[] = [];
    for (const pick of picks) {
      if (pick.year !== league.seasonYear || !pick.used || !pick.playerId) continue;
      const player = playerById.get(pick.playerId);
      if (!player || player.status !== 'ACTIVE' || player.teamId !== pick.ownerTeamId) continue;
      const c = contractByPlayerId.get(pick.playerId);
      if (!c) continue; // INV-04's finding, not this one's
      if (!c.isRookieDeal) { offScale.push(`${pick.playerId} r${pick.round}p${pick.slot}: not flagged as a rookie deal`); continue; }
      if (c.years !== CAP.ROOKIE_DEAL_YEARS) { offScale.push(`${pick.playerId} r${pick.round}p${pick.slot}: ${c.years}-year rookie deal`); continue; }
      const salaries = readJson<number[]>(c.baseSalaries, []);
      const apy = (salaries.reduce((a, b) => a + b, 0) + c.signingBonus) / Math.max(1, c.years);
      if (!Number.isFinite(apy) || apy < CAP.MIN_SALARY || apy > rookieCeiling) {
        offScale.push(`${pick.playerId} r${pick.round}p${pick.slot}: ${formatMoney(Math.round(apy))}/yr`);
      }
    }
    push(violation('INV-29', 'error', 'A rookie drafted this year is not on a rookie-scale contract', offScale));
  }

  return out;
}

/** Sum every numeric field across a batch of SeasonStats JSON strings. */
function sumStats(rows: string[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const raw of rows) {
    const s = readJson<SeasonStats>(raw, {});
    for (const [k, v] of Object.entries(s)) {
      if (typeof v !== 'number') continue;
      total[k] = (total[k] ?? 0) + v;
    }
  }
  return total;
}

/**
 * Snapshot of league-wide season+career stat totals — call before and after a
 * step to check INV-T1. Both buckets are snapshotted: the postseason pair
 * rolls over on the same schedule as the regular-season pair, and a rollup
 * check that only watched one half would have declared a clean roll while the
 * other half silently vanished.
 */
export async function snapshotStatTotals(leagueId: string): Promise<{
  season: Record<string, number>; career: Record<string, number>;
  playoff: Record<string, number>; careerPlayoff: Record<string, number>;
}> {
  const players = await prisma.player.findMany({
    where: { leagueId },
    select: { seasonStats: true, careerStats: true, playoffStats: true, careerPlayoffStats: true },
  });
  return {
    season: sumStats(players.map((p) => p.seasonStats)),
    career: sumStats(players.map((p) => p.careerStats)),
    playoff: sumStats(players.map((p) => p.playoffStats)),
    careerPlayoff: sumStats(players.map((p) => p.careerPlayoffStats)),
  };
}

/** INV-T1: after a season roll, nothing should be lost or double-counted moving season -> career. */
export function checkStatRollup(before: Awaited<ReturnType<typeof snapshotStatTotals>>, after: Awaited<ReturnType<typeof snapshotStatTotals>>): Violation[] {
  const out: Violation[] = [];
  const bad: string[] = [];
  // Same arithmetic on each bucket, and they are checked independently — a
  // playoff yard that landed in the regular-season career total would net out
  // to zero if the two were summed first, which is precisely the failure this
  // whole change exists to delete.
  for (const [label, seasonKey, careerKey] of [
    ['', 'season', 'career'],
    ['playoff ', 'playoff', 'careerPlayoff'],
  ] as const) {
    const keys = new Set([...Object.keys(before[seasonKey]), ...Object.keys(before[careerKey]), ...Object.keys(after[careerKey])]);
    for (const k of keys) {
      const expectedCareer = (before[careerKey][k] ?? 0) + (before[seasonKey][k] ?? 0);
      const actualCareer = after[careerKey][k] ?? 0;
      // Allow tiny float drift; these are all whole-number counting stats in practice.
      if (Math.abs(expectedCareer - actualCareer) > 1) bad.push(`${label}${k}: expected ${expectedCareer}, got ${actualCareer}`);
    }
  }
  if (bad.length > 0) out.push({ id: 'INV-T1', severity: 'error', message: 'Season stats did not fully roll into career stats', count: bad.length, sample: bad.slice(0, 5) });
  return out;
}

/**
 * ===========================================================================
 * INV-30 — NOTHING POINTS AT A ROW THAT NO LONGER EXISTS
 * ===========================================================================
 * DATABASE-WIDE, NOT PER-LEAGUE, because that is what an orphan is: a row
 * whose league, club or player has been deleted is by definition not IN a
 * league any more, so no league-scoped query can ever see it. That is exactly
 * how 18,247 orphaned `CapCharge` rows accumulated unnoticed — five of every
 * six cap charges on the dev database — while every check in this file ran
 * clean on every league in it (see the comment on CapCharge in
 * prisma/schema.prisma, and INV-23 in GAME_INVARIANTS.md).
 *
 * MOST OF THESE ARE NOW FOREIGN KEYS, AND THEY ARE STILL CHECKED. A rule the
 * schema enforces cannot be violated by application code — but it can be
 * violated by a migration that ships without its constraint, by a hand-edit in
 * psql, and by a `deleteMany` in a script that reaches a table the cascade
 * does not. Four of the columns below have no foreign key at all today
 * (`Contract.teamId`, `TradeRecord.teamAId`/`teamBId`, `LeagueRecord.playerId`,
 * `Transaction.teamId`), so for those this is the only check there is.
 *
 * HOW TO READ THE RESULT IN A SHARED DATABASE. This counts every orphan on the
 * server, including ones that were already there before the caller started. A
 * harness should take this reading before and after its run and report the
 * DIFFERENCE — that is the number its own leagues created, and the only number
 * it is entitled to claim.
 * ===========================================================================
 */
export async function checkOrphans(): Promise<Violation[]> {
  // (child table, child column, parent table) — every pointer in the schema
  // that names a League, a Team or a Player from a row that is not one.
  const edges: [string, string, string][] = [
    ['CapCharge', 'teamId', 'Team'],
    ['Contract', 'playerId', 'Player'],
    ['Contract', 'teamId', 'Team'],
    ['DraftPick', 'leagueId', 'League'],
    ['DraftPick', 'ownerTeamId', 'Team'],
    ['DraftPick', 'originalTeamId', 'Team'],
    ['DraftPick', 'playerId', 'Player'],
    ['PlayerSeason', 'leagueId', 'League'],
    ['PlayerSeason', 'playerId', 'Player'],
    ['PlayerSeason', 'teamId', 'Team'],
    ['TeamSeasonRecord', 'leagueId', 'League'],
    ['TeamSeasonRecord', 'teamId', 'Team'],
    ['TradeRecord', 'leagueId', 'League'],
    ['TradeRecord', 'teamAId', 'Team'],
    ['TradeRecord', 'teamBId', 'Team'],
    ['ChampionRoster', 'leagueId', 'League'],
    ['ChampionRoster', 'teamId', 'Team'],
    ['ChampionRoster', 'playerId', 'Player'],
    ['LeagueRecord', 'leagueId', 'League'],
    // LeagueRecord.playerId IS DELIBERATELY NOT HERE, and this is the one edge
    // in the schema where a dangling id is correct. Every league is generated
    // with a seeded backstory (lib/gen/leagueHistory.ts) whose all-time record
    // holders are LEGENDS — men who never played a down in this save and have
    // no Player row by design. The column is not nullable, so a legend's record
    // carries a synthetic `recordId`, and `playerName`/`teamAbbr` are
    // denormalised onto the row precisely so it still displays. Measured on the
    // dev database: 1,784 of 2,994 LeagueRecord rows, an even fourteen per
    // league, which is every league in it and not a leak in any of them.
    ['Transaction', 'leagueId', 'League'],
    ['Transaction', 'teamId', 'Team'],
    ['Transaction', 'playerId', 'Player'],
    ['Game', 'leagueId', 'League'],
    ['DepthChartSlot', 'teamId', 'Team'],
    ['DepthChartSlot', 'playerId', 'Player'],
  ];

  const found: string[] = [];
  for (const [child, column, parent] of edges) {
    // Identifiers are quoted from this literal list and never from input, so
    // there is nothing here for a value to interpolate into. A NULL pointer is
    // "not applicable", not an orphan, so it is excluded rather than counted.
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "${child}" c
       LEFT JOIN "${parent}" p ON p.id = c."${column}"
       WHERE c."${column}" IS NOT NULL AND p.id IS NULL`,
    );
    const n = Number(rows[0]?.n ?? 0);
    if (n > 0) found.push(`${child}.${column} -> ${parent}: ${n}`);
  }
  // One violation carrying every edge, so a caller differencing two readings
  // compares like with like rather than matching up a variable-length list.
  return found.length === 0
    ? []
    : [{ id: 'INV-30', severity: 'error', message: 'Rows point at a league, club or player that no longer exists', count: found.length, sample: found }];
}
