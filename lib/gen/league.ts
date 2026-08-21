import { prisma } from '../db';
import { Rng, clamp } from '../rng';
import { LEAGUE, CAP, OFF_SCHEMES, DEF_SCHEMES, Position, POSITIONS, ROSTER_TARGETS, SCOUTING, GENERATION, FREE_AGENCY } from '../tuning';
import { LeagueSettings, serializeSettings, DEFAULT_SETTINGS } from '../settings';
import { TEAM_SEEDS, COACH_FIRST, COACH_LAST, FIRST_NAMES, LAST_NAMES, NameRegistry } from './names';
import { generateRoster, generatePlayer, toPlayerCreate, GeneratedPlayer } from './players';
import { generateLeagueHistory } from './leagueHistory';
import { buildSchedule } from '../schedule';
import { buildContract, marketValue, suggestedYears } from '../cap';
import { defaultGmProfile } from '../ai/gm';
import { observe } from '../scouting';
import { writeJson } from '../json';
import { AttrMap } from '../ratings';

/** A contract an imported file asked for, instead of a market-rate one. */
export interface PlannedContract {
  apy: number;
  years: number;
  yearsRemaining: number;
}

/** The team identity fields a plan may replace TEAM_SEEDS with. */
export interface PlannedTeam {
  city: string;
  nickname: string;
  abbr: string;
  conference: string;
  division: string;
}

/**
 * Everything an imported league file contributes to generation, already
 * validated and gap-filled by lib/leagueFile.ts.
 *
 * This exists so IMPORT AND CREATION ARE THE SAME CODE PATH. The alternative
 * — a parallel `createLeagueFromFile` that also writes teams, staff, scouts,
 * contracts, picks, a schedule, depth charts, history and a scouting book —
 * is a second 300-line procedure that starts identical and drifts, and every
 * fix to one of them silently misses the other. An imported league is built by
 * this function, so it is playable for exactly the same reasons a generated
 * one is.
 */
export interface LeagueImportPlan {
  teams: PlannedTeam[];
  /** abbr -> the full roster for that team. */
  rosters: Map<string, GeneratedPlayer[]>;
  freeAgents: GeneratedPlayer[];
  /** plannedContractKey(player) -> the deal the file asked for. */
  contracts: Map<string, PlannedContract>;
  /** Pre-seeded with every imported name, so fill-ins never collide. */
  names: NameRegistry;
}

/**
 * Contracts are matched back to players by name after the bulk insert, because
 * `createMany` does not return ids. Names are unique league-wide by
 * construction (NameRegistry on the generated side, explicit de-duplication on
 * the imported side), which is what makes this exact rather than approximate.
 */
export const plannedContractKey = (firstName: string, lastName: string) =>
  `${firstName} ${lastName}`.toLowerCase();

/**
 * ---------------------------------------------------------------------------
 * THE FRINGE POPULATION
 * ---------------------------------------------------------------------------
 * Camp bodies, recent cuts and career backups — the several hundred unsigned
 * men real football always has in it, and which this league had no source of.
 * See GENERATION.FRINGE_OVR_MEAN for why they exist and why they are capped
 * where they are.
 *
 * Deliberately NOT a talent faucet, enforced three ways rather than hoped for:
 * the overall roll tops out at GENERATION.FRINGE_OVR_MAX, the potential is
 * pinned within a few points of the overall he already has, and the
 * development trait is drawn from Slow/Normal only so none of them is a
 * hidden Superstar waiting for a coaching staff. A GM signing one of these is
 * signing depth, on purpose, and the market's real names still have to come
 * from contracts that actually expired.
 *
 * `rng` must be the caller's seeded Rng — this runs at league creation and at
 * every offseason, and both have to reproduce from the league seed.
 */
export function generateFringeFreeAgents(rng: Rng, count: number, names: NameRegistry): GeneratedPlayer[] {
  const out: GeneratedPlayer[] = [];
  for (let i = 0; i < count; i++) {
    // Two populations, not one bell curve: the wire is undrafted 23-year-olds
    // and 31-year-old special-teamers, and almost nobody in between — a man
    // in his prime who can play is on a roster.
    const young = rng.bool(GENERATION.FRINGE_YOUNG_SHARE);
    const age = young ? rng.int(22, 25) : rng.int(28, GENERATION.AGE_MAX);
    const p = generatePlayer(rng, {
      ovrTarget: rng.normalClamped(
        GENERATION.FRINGE_OVR_MEAN, GENERATION.FRINGE_OVR_SD,
        GENERATION.FRINGE_OVR_MIN, GENERATION.FRINGE_OVR_MAX,
      ),
      ageOverride: age,
      names,
    });
    const headroom = young ? GENERATION.FRINGE_POTENTIAL_BONUS_YOUNG : GENERATION.FRINGE_POTENTIAL_BONUS_OLD;
    out.push({
      ...p,
      // generatePlayer's own potential roll gives a 22-year-old up to +15.
      // That is right for a draft pick and wrong for a man nobody drafted.
      potential: Math.min(p.potential, p.trueOvr + headroom),
      devTrait: rng.weighted({ Slow: 0.55, Normal: 0.45 }),
    });
  }
  return out;
}

/**
 * How many fringe players the market is short of FREE_AGENCY.POOL_FLOOR.
 * Shared by league creation and by the offseason top-up in lib/season.ts so
 * the floor is one number in one place, and so neither can mint on a market
 * that is already full — from the second offseason on this returns 0.
 */
export function fringeShortfall(poolSize: number): number {
  return Math.max(0, FREE_AGENCY.POOL_FLOOR - poolSize);
}

/**
 * ---------------------------------------------------------------------------
 * WHY A GENERATED ROSTER NEEDS TOPPING UP
 * ---------------------------------------------------------------------------
 * `generateRoster` rolls `rng.int(min, ideal)` men per position, which sums to
 * a MEAN of 43 against a 46-man legal minimum — so 31 of 32 brand-new clubs
 * were born illegal. Nothing noticed until the first offseason, when
 * `fillTeamsToRosterMinimum` bought ~90 bodies to fix it and emptied the free
 * agent pool doing it. Both symptoms are this one shortfall.
 *
 * The depth-penalty maths is generateRoster's, repeated here rather than
 * shared because the extra men are appended to a roster that already exists:
 * each one is the NEXT man down his position's chart, so he takes the decay
 * for the slot he is actually filling and lands as ordinary depth rather than
 * as a surprise starter.
 */
function topUpRoster(rng: Rng, roster: GeneratedPlayer[], teamStrength: number, names: NameRegistry): GeneratedPlayer[] {
  const target = rng.int(GENERATION.INITIAL_ROSTER_MIN, GENERATION.INITIAL_ROSTER_MAX);
  const counts = new Map<Position, number>();
  for (const p of roster) counts.set(p.position, (counts.get(p.position) ?? 0) + 1);

  while (roster.length < target) {
    // Least-covered position first, measured against what the spec asks for.
    // POSITIONS order breaks ties, so this is deterministic.
    let pos: Position = POSITIONS[0];
    let worst = -Infinity;
    for (const candidate of POSITIONS) {
      const spec = ROSTER_TARGETS[candidate];
      const held = counts.get(candidate) ?? 0;
      if (held >= spec.max) continue; // never carry more of anyone than the spec allows
      const deficit = spec.ideal - held;
      if (deficit > worst) { worst = deficit; pos = candidate; }
    }
    if (worst === -Infinity) break; // every position is at its ceiling — nothing legal left to add

    const slot = counts.get(pos) ?? 0;
    const jitter = GENERATION.DEPTH_DECAY_JITTER;
    const depthPenalty = GENERATION.DEPTH_DECAY_MAX
      * (1 - Math.exp(-slot / GENERATION.DEPTH_DECAY_TAU))
      * rng.float(1 - jitter, 1 + jitter);
    const specialist = (pos === 'K' || pos === 'P') ? GENERATION.SPECIALIST_OVR_PENALTY : 0;
    const ovrTarget = clamp(
      Math.round(rng.normal(GENERATION.VETERAN_OVR_MEAN + teamStrength - depthPenalty - specialist, GENERATION.VETERAN_OVR_SD * 0.8)),
      GENERATION.ROSTER_OVR_FLOOR, 99,
    );
    roster.push(generatePlayer(rng, { position: pos, ovrTarget, names }));
    counts.set(pos, slot + 1);
  }
  return roster;
}

/**
 * Creates a complete, playable league from nothing:
 * 32 fictional franchises, staff, scouts, rosters (or a fantasy-draft pool),
 * contracts, a free agent pool, three years of draft picks, a full schedule,
 * depth charts, and the user's initial scouting book.
 *
 * Pass `plan` to build the league from an imported league file instead of from
 * TEAM_SEEDS and the generators — see LeagueImportPlan above.
 */
export async function createLeague(opts: {
  name: string;
  userTeamAbbr: string;
  settings?: Partial<LeagueSettings>;
  seed?: string;
  plan?: LeagueImportPlan;
  /**
   * Called with the league id the instant the League row exists, before any of
   * the ~5,300 dependent rows are written.
   *
   * This function is NOT transactional (documented in docs/deployment.md), so
   * a failure part way through leaves a half-written league that shows up on
   * the home page and breaks when opened. A caller that wants to clean up
   * after itself needs the id of the thing to clean up, and until now there
   * was no way to learn it except by succeeding. The import route uses this to
   * delete what it started; see app/api/league/import/route.ts.
   */
  onLeagueCreated?: (leagueId: string) => void;
}): Promise<string> {
  const settings: LeagueSettings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const seed = opts.seed || settings.simSeed || `${Date.now()}`;
  const rng = new Rng(seed);
  const seasonYear = new Date().getFullYear();

  // An imported plan always arrives with full rosters (lib/leagueFile.ts fills
  // any team the file left empty), so a fantasy draft over the top of it would
  // be drafting players who already have teams. Import is always a
  // randomized-rosters start; the import UI says so.
  const fantasy = settings.leagueStart === 'FANTASY_DRAFT' && !opts.plan;

  const league = await prisma.league.create({
    data: {
      name: opts.name,
      seasonYear,
      // The base year the salary cap grows from for the life of this league.
      // See lib/leagueYear.ts — older saves derive it instead.
      startYear: seasonYear,
      week: 1,
      phase: fantasy ? 'FANTASY_DRAFT' : 'PRESEASON',
      settings: serializeSettings({ ...settings, simSeed: seed }),
    },
  });
  // Hand the id over before anything else is written, so a caller can clean up
  // a partial league if any step below throws.
  opts.onLeagueCreated?.(league.id);

  // --- Teams ----------------------------------------------------------------
  const teamSeeds = opts.plan?.teams ?? TEAM_SEEDS;
  const teamRows = teamSeeds.map((t) => ({
    leagueId: league.id,
    city: t.city,
    nickname: t.nickname,
    abbr: t.abbr,
    conference: t.conference,
    division: t.division,
    isUser: t.abbr === opts.userTeamAbbr,
    prestige: rng.int(30, 80),
    offScheme: rng.pick(OFF_SCHEMES),
    defScheme: rng.pick(DEF_SCHEMES),
    gmProfile: writeJson(defaultGmProfile(rng)),
  }));
  await prisma.team.createMany({ data: teamRows });
  const teams = await prisma.team.findMany({ where: { leagueId: league.id }, orderBy: { abbr: 'asc' } });
  const userTeam = teams.find((t) => t.isUser) ?? teams[0];
  // If userTeamAbbr didn't match any generated team, the fallback above
  // still needs its row actually flagged — otherwise league.userTeamId
  // points at a team that isUser:false, and anything that queries "the
  // other 31 teams" via isUser:false (the trade screen's partner list,
  // for one) ends up including the user's own team as a valid partner.
  if (!userTeam.isUser) {
    await prisma.team.update({ where: { id: userTeam.id }, data: { isUser: true } });
  }
  await prisma.league.update({ where: { id: league.id }, data: { userTeamId: userTeam.id } });

  // --- Staff & scouts -------------------------------------------------------
  const staffRows: any[] = [];
  const scoutRows: any[] = [];
  for (const team of teams) {
    const roles: { role: string; scheme: string }[] = [
      { role: 'HC', scheme: 'Balanced' },
      { role: 'OC', scheme: team.offScheme },
      { role: 'DC', scheme: team.defScheme },
      { role: 'ST', scheme: 'Balanced' },
    ];
    for (const r of roles) {
      // [TUNE] staff ratings cluster around 55 with a long tail of good coaches.
      const rating = rng.normalClamped(55, 12, 25, 95);
      staffRows.push({
        teamId: team.id,
        role: r.role,
        name: `${rng.pick(COACH_FIRST)} ${rng.pick(COACH_LAST)}`,
        rating,
        playCalling: rng.normalClamped(rating, 8, 20, 99),
        development: rng.normalClamped(rating, 10, 20, 99),
        scheme: r.scheme,
        contractYears: rng.int(1, 5),
        salary: Math.round(rng.float(1.5, 9) * 1_000_000),
      });
    }
    const scoutCount = rng.int(2, 3);
    for (let i = 0; i < scoutCount; i++) {
      scoutRows.push({
        teamId: team.id,
        name: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`,
        accuracy: rng.normalClamped(55, 14, 20, 95),
        speed: rng.normalClamped(55, 14, 20, 95),
        specialty: rng.pick(['ALL', 'OL', 'SKILL', 'FRONT7', 'SECONDARY']),
        salary: Math.round(rng.float(0.2, 1.2) * 1_000_000),
      });
    }
  }
  await prisma.staff.createMany({ data: staffRows });
  await prisma.scout.createMany({ data: scoutRows });

  // --- Players --------------------------------------------------------------
  const playerCreates: any[] = [];
  const contractPlans: { key: string; apy: number; years: number }[] = [];

  const registerPlayer = (p: GeneratedPlayer, extra: Record<string, unknown>, wantContract: boolean) => {
    const key = `${playerCreates.length}`;
    playerCreates.push({ ...toPlayerCreate(p, league.id, extra), id: undefined, _key: key });
    if (wantContract) {
      const apy = marketValue({ ovr: p.trueOvr, position: p.position, age: p.age, potential: p.potential });
      contractPlans.push({ key, apy, years: suggestedYears(p.trueOvr, p.age) });
    }
  };

  // One ledger for the whole league, so no two players anywhere in it share
  // a name — not across rosters, not between a roster and the free agents.
  // An imported plan brings its own, already holding every name in the file.
  const names = opts.plan?.names ?? new NameRegistry();

  if (opts.plan) {
    // Imported: the plan has already decided every roster and the free agent
    // pool, generating whatever the file left out. Nothing is rolled here.
    for (const team of teams) {
      for (const p of opts.plan.rosters.get(team.abbr) ?? []) {
        registerPlayer(p, { teamId: team.id, status: 'ACTIVE' }, true);
      }
    }
    for (const p of opts.plan.freeAgents) {
      registerPlayer(p, { status: 'FREE_AGENT', teamId: null }, false);
    }
  } else if (fantasy) {
    // Fantasy draft: everyone starts empty and one giant pool is drafted.
    // Pool = enough players for every team to fill a roster, plus slack.
    const poolSize = LEAGUE.TEAM_COUNT * LEAGUE.ROSTER_MAX + 120;
    for (let i = 0; i < poolSize; i++) {
      const p = generatePlayer(rng, { names });
      registerPlayer(p, { status: 'FREE_AGENT', isDraftee: true, teamId: null }, false);
    }
  } else {
    for (const team of teams) {
      // [TUNE] team strength spread: -6 .. +6 rating points around league mean.
      const strength = rng.normal(0, 4);
      // Topped up to a legal roster before it is written — see topUpRoster.
      for (const p of topUpRoster(rng, generateRoster(rng, strength, names), strength, names)) {
        registerPlayer(p, { teamId: team.id, status: 'ACTIVE' }, true);
      }
    }
    // Free agent pool, in two layers that mean different things.
    //
    // LEFTOVERS: real unsigned football players — a 26-year-old the market
    // just hasn't got to, the occasional genuine starter still on the wire.
    // [TUNE] 140 of them, the number this league has always minted.
    const leftovers = 140;
    for (let i = 0; i < leftovers; i++) {
      const p = generatePlayer(rng, { ovrTarget: rng.normalClamped(GENERATION.FREE_AGENT_OVR_MEAN, GENERATION.FREE_AGENT_OVR_SD, GENERATION.FREE_AGENT_OVR_MIN, GENERATION.FREE_AGENT_OVR_MAX), names });
      registerPlayer(p, { status: 'FREE_AGENT', teamId: null }, false);
    }
    // FRINGE: the camp bodies and career backups underneath them, up to the
    // floor the market is never allowed to fall below. Same function, same
    // floor and the same "only if short" rule as the offseason top-up in
    // lib/season.ts, so a league is born with the market it will keep.
    for (const p of generateFringeFreeAgents(rng, fringeShortfall(leftovers), names)) {
      registerPlayer(p, { status: 'FREE_AGENT', teamId: null }, false);
    }
  }

  // Bulk-insert players, then read them back to attach contracts/reports.
  const CHUNK = 400;
  for (let i = 0; i < playerCreates.length; i += CHUNK) {
    await prisma.player.createMany({
      data: playerCreates.slice(i, i + CHUNK).map(({ _key, id, ...rest }) => rest),
    });
  }
  const players = await prisma.player.findMany({ where: { leagueId: league.id } });

  // Contracts: match players back up by (name, position, ovr) — unique enough
  // in practice, and this avoids 1,700 individual inserts.
  if (!fantasy) {
    const rostered = players.filter((p) => p.teamId);

    // A team's generated talent is pure RNG — occasionally a roster rolls
    // several 90+ players at once, which is a fine, fun outcome on its own
    // but is not something any fixed salary curve can make affordable at
    // market rate: real rosters can't simultaneously employ that much
    // top-end talent under a hard cap either, which is exactly why real
    // teams don't. So: price every player at market rate first, then if a
    // team's total exceeds a safe threshold, scale that team's contracts
    // down uniformly to fit — a below-market "hometown discount" league-wide,
    // rather than a promise this scaling should never need to trigger.
    //
    // An imported file may name its own price for a player, and when it does
    // that number is used INSTEAD of the market rate — but it still goes
    // through the same team-level scaling below. A file is free to say a
    // quarterback is worth $80M; it is not free to hand a team a payroll no
    // salary cap in the game can accommodate, because the result is a league
    // that refuses to advance out of preseason on day one. Which of the two
    // an author gets is stated in docs/custom-leagues.md.
    const planned = opts.plan?.contracts;
    const nominalByTeam = new Map<string, number>();
    const nominalByPlayer = new Map<string, number>();
    for (const p of rostered) {
      const override = planned?.get(plannedContractKey(p.firstName, p.lastName));
      const apy = override?.apy
        ?? marketValue({ ovr: p.trueOvr, position: p.position as Position, age: p.age, potential: p.potential });
      nominalByPlayer.set(p.id, apy);
      nominalByTeam.set(p.teamId!, (nominalByTeam.get(p.teamId!) ?? 0) + apy);
    }
    const CAP_TARGET_FRACTION = 0.88; // leave real headroom, not a knife's edge
    const target = CAP.BASE_CAP * CAP_TARGET_FRACTION;
    const scaleByTeam = new Map<string, number>();
    for (const [teamId, total] of nominalByTeam) {
      scaleByTeam.set(teamId, total > target ? target / total : 1);
    }

    const contractRows = rostered.map((p) => {
      const scale = scaleByTeam.get(p.teamId!) ?? 1;
      const apy = Math.max(CAP.MIN_SALARY, Math.round((nominalByPlayer.get(p.id)! * scale) / 100_000) * 100_000);
      // Young players are on real rookie deals, not veteran deals: full
      // CAP.ROOKIE_DEAL_YEARS term, and they are exactly as many years into
      // it as they have years of experience. This used to be
      // `isRookieDeal: p.experience <= 3 && rng.bool(0.5)` — a coin flip that
      // set the FLAG without ever granting the LENGTH, so ROOKIE_DEAL_YEARS
      // was never applied at generation and the youngest 40% of the league
      // contributed no long contracts at all.
      const override = planned?.get(plannedContractKey(p.firstName, p.lastName));
      // A deal written by hand is never relabelled as a rookie contract — the
      // author gave it a length and a remaining term, and isRookieDeal would
      // otherwise overwrite both.
      const isRookieDeal = !override && p.experience <= CAP.ROOKIE_EXPERIENCE_MAX;
      const years = override?.years ?? (isRookieDeal ? CAP.ROOKIE_DEAL_YEARS : suggestedYears(p.trueOvr, p.age));
      // Stagger how far into each deal we are so contracts expire on a curve.
      // A rookie's stagger isn't random — it's his experience. An imported
      // deal's stagger is whatever the file said is left to run.
      const elapsed = override
        ? Math.max(0, Math.min(override.years - override.yearsRemaining, years - 1))
        : isRookieDeal
          ? Math.min(p.experience, years - 1)
          : rng.int(0, Math.max(0, years - 1));
      // Flat escalation + a smaller bonus share: these contracts are being
      // dropped straight into a random mid-deal year, not signed fresh, so a
      // backloaded structure would land players in their single most
      // expensive year with none of the cap-friendly early years ever
      // having applied — see buildContract's `escalation` doc comment.
      const c = buildContract({ apy, years, signedYear: seasonYear - elapsed, escalation: 1.0, bonusPct: 0.15 });
      return {
        playerId: p.id,
        teamId: p.teamId,
        years: c.years,
        yearsRemaining: Math.max(1, c.years - elapsed),
        signedYear: c.signedYear,
        baseSalaries: writeJson(c.baseSalaries),
        signingBonus: c.signingBonus,
        guaranteed: c.guaranteed,
        isRookieDeal,
      };
    });
    for (let i = 0; i < contractRows.length; i += CHUNK) {
      await prisma.contract.createMany({ data: contractRows.slice(i, i + CHUNK) });
    }
  }

  // --- Draft picks (3 years out) -------------------------------------------
  const pickRows: any[] = [];
  for (let yearOffset = 0; yearOffset < 3; yearOffset++) {
    for (let round = 1; round <= settings.draftRounds; round++) {
      teams.forEach((team, i) => {
        pickRows.push({
          leagueId: league.id,
          year: seasonYear + yearOffset + (fantasy ? 1 : 1),
          round,
          slot: i + 1, // reseeded from standings at the end of each season
          originalTeamId: team.id,
          ownerTeamId: team.id,
        });
      });
    }
  }
  for (let i = 0; i < pickRows.length; i += CHUNK) {
    await prisma.draftPick.createMany({ data: pickRows.slice(i, i + CHUNK) });
  }

  // --- Schedule -------------------------------------------------------------
  const scheduleTeams = teams.map((t, idx) => ({ idx, conference: t.conference, division: t.division }));
  const scheduled = buildSchedule(scheduleTeams, rng, settings.seasonLength);
  const gameRows = scheduled.map((g) => ({
    leagueId: league.id,
    seasonYear,
    week: g.week,
    kind: 'REGULAR',
    homeTeamId: teams[g.homeIdx].id,
    awayTeamId: teams[g.awayIdx].id,
  }));
  for (let i = 0; i < gameRows.length; i += CHUNK) {
    await prisma.game.createMany({ data: gameRows.slice(i, i + CHUNK) });
  }

  // --- Depth charts ---------------------------------------------------------
  if (!fantasy) {
    await autoDepthChartAll(league.id);
  }

  // --- Backstory ------------------------------------------------------------
  // A league with no past has an empty Ring of Honor, an empty franchise
  // history, no award ever won and no record on the books — every long-arc
  // screen in the app pointing at an empty room on day one. Invent the
  // missing decades instead: see lib/gen/leagueHistory.ts. Runs AFTER depth
  // charts because the career lines it writes for veterans are shaped by
  // each player's depth rank, and after contracts because it deliberately
  // touches nothing but history.
  await generateLeagueHistory({
    leagueId: league.id,
    seasonYear,
    seasonLength: settings.seasonLength,
    teams: teams.map((t) => ({
      id: t.id, abbr: t.abbr, city: t.city, nickname: t.nickname,
      conference: t.conference, division: t.division,
    })),
    roster: players
      .filter((p) => p.teamId)
      .map((p) => ({
        id: p.id, firstName: p.firstName, lastName: p.lastName, position: p.position,
        age: p.age, experience: p.experience, trueOvr: p.trueOvr, teamId: p.teamId,
      })),
    rng,
    names,
  });

  // --- User's scouting book -------------------------------------------------
  await seedScoutingReports(league.id, userTeam.id, rng, settings);

  // --- Fantasy draft state --------------------------------------------------
  if (fantasy) {
    const order = buildSnakeOrder(rng.shuffle(teams.map((t) => t.id)), LEAGUE.ROSTER_MAX);
    await prisma.draftState.create({
      data: { leagueId: league.id, kind: 'FANTASY', round: 1, pickIndex: 0, order: writeJson(order) },
    });
  }

  await prisma.transaction.create({
    data: {
      leagueId: league.id,
      seasonYear,
      week: 0,
      type: 'SIGN',
      headline: `${league.name} founded`,
      detail: `You are the GM of the ${userTeam.city} ${userTeam.nickname}. ${
        fantasy ? 'A fantasy draft will fill every roster from scratch.' : 'Rosters have been randomized league-wide.'
      }`,
    },
  });

  return league.id;
}

/** Snake order: 1..32, 32..1, repeating for `rounds` rounds. */
export function buildSnakeOrder(teamIds: string[], rounds: number): string[] {
  const order: string[] = [];
  for (let r = 0; r < rounds; r++) {
    const round = r % 2 === 0 ? teamIds : [...teamIds].reverse();
    order.push(...round);
  }
  return order;
}

/**
 * Rebuild every team's depth chart by rating. Called at league creation and
 * any time a roster changes materially (signings, cuts, trades, draft).
 */
export async function autoDepthChartAll(leagueId: string) {
  const teams = await prisma.team.findMany({ where: { leagueId }, select: { id: true } });
  for (const t of teams) await autoDepthChart(t.id);
}

export async function autoDepthChart(teamId: string) {
  const players = await prisma.player.findMany({
    where: { teamId },
    select: { id: true, position: true, trueOvr: true },
  });
  const byPos: Record<string, { id: string; trueOvr: number }[]> = {};
  for (const p of players) (byPos[p.position] ??= []).push(p);

  await prisma.depthChartSlot.deleteMany({ where: { teamId } });
  const rows: any[] = [];
  for (const [position, group] of Object.entries(byPos)) {
    group.sort((a, b) => b.trueOvr - a.trueOvr);
    group.forEach((p, rank) => rows.push({ teamId, playerId: p.id, position, rank }));
  }
  if (rows.length) await prisma.depthChartSlot.createMany({ data: rows });
}

/** The subset of PrismaClient reconcileDepthChart uses — lets it run inside an interactive $transaction. */
type DepthChartClient = Pick<typeof prisma, 'player' | 'depthChartSlot'>;

/**
 * ===========================================================================
 * RECONCILE A DEPTH CHART WITH THE ROSTER IT IS SUPPOSED TO DESCRIBE
 * ===========================================================================
 * Every roster player gets a slot; every slot names a roster player. What it
 * does NOT do is re-sort — the order the user (or a previous auto-sort) put
 * the listed players in survives untouched.
 *
 * This exists because a depth chart was only ever written in two places:
 * league creation and `autoDepthChart` above. Nothing wrote one when a player
 * ARRIVED. A traded-for player was therefore on the roster and absent from the
 * chart, and lib/sim/units.ts ranks an unlisted man behind every listed one —
 * so a 97-overall receiver acquired at the deadline sat behind a 57 and
 * recorded nothing at all for his new club. No error, no warning: the trade
 * silently did nothing. Measured on a fresh league one offseason deep, 229
 * roster players were missing from their own depth chart and 31 of them
 * out-rated every man listed at their position.
 *
 * `autoDepthChart` cannot be the fix on its own, because it deletes the whole
 * chart and rebuilds it by rating: using it on every arrival would mean every
 * signing, every trade, and every draft pick wiped the user's hand-set order.
 * A GM who benched a 78-overall veteran for a 74-overall rookie he is
 * developing would find that undone by a waiver claim at another position.
 *
 * WHERE AN ARRIVING PLAYER GOES. Immediately behind the last listed player who
 * out-rates him, ahead of everyone he out-rates. That is the same rule
 * lib/sim/units.ts applies to an unlisted player, deliberately: the chart the
 * sim would have improvised is the chart that gets written down, so repairing
 * the data never changes who plays. It also means the acquisition is placed on
 * merit — a 90 does not land behind a 60 — while never leapfrogging a listed
 * player the GM deliberately ranked above better talent.
 *
 * Idempotent, so callers can run it after any roster move without checking
 * whether anything actually changed.
 */
export async function reconcileDepthChart(teamId: string, client: DepthChartClient = prisma) {
  const [players, slots] = await Promise.all([
    client.player.findMany({ where: { teamId }, select: { id: true, position: true, trueOvr: true } }),
    client.depthChartSlot.findMany({ where: { teamId }, orderBy: { rank: 'asc' } }),
  ]);
  const onRoster = new Map(players.map((p) => [p.id, p]));

  // Listed players who are still here, in the order the chart already has
  // them. A slot naming somebody who was traded, cut or retired is dropped —
  // otherwise it holds a rank forever against a man who is gone.
  const listed: Record<string, { id: string; trueOvr: number }[]> = {};
  const listedIds = new Set<string>();
  for (const slot of slots) {
    const p = onRoster.get(slot.playerId);
    // Trust the roster's position, not the slot's: a slot written before a
    // position change would otherwise file him under the old one.
    if (!p || p.position !== slot.position || listedIds.has(p.id)) continue;
    (listed[slot.position] ??= []).push(p);
    listedIds.add(p.id);
  }

  // Everyone the chart doesn't mention, best first, so that when several
  // arrive at once they land in rating order relative to each other too.
  const unlisted: Record<string, { id: string; trueOvr: number }[]> = {};
  for (const p of players) if (!listedIds.has(p.id)) (unlisted[p.position] ??= []).push(p);
  for (const group of Object.values(unlisted)) group.sort((a, b) => b.trueOvr - a.trueOvr);

  const rows: { teamId: string; playerId: string; position: string; rank: number }[] = [];
  for (const position of new Set([...Object.keys(listed), ...Object.keys(unlisted)])) {
    const order = [...(listed[position] ?? [])];
    for (const p of unlisted[position] ?? []) {
      // One past the last listed man who is better than he is.
      let at = 0;
      for (let i = 0; i < order.length; i++) if (order[i].trueOvr > p.trueOvr) at = i + 1;
      order.splice(at, 0, p);
    }
    order.forEach((p, rank) => rows.push({ teamId, playerId: p.id, position, rank }));
  }

  // Nothing to write is the common case — reconciling is cheap to call after
  // any roster move precisely because the no-op costs one comparison.
  const key = (r: { position: string; rank: number }) => `${r.position}#${r.rank}`;
  const existing = new Map(slots.map((s) => [key(s), s.playerId]));
  if (rows.length === slots.length && rows.every((r) => existing.get(key(r)) === r.playerId)) return;

  // Rewritten wholesale rather than patched: `@@unique([teamId, position,
  // rank])` makes any in-place shuffle a minefield of transient collisions.
  await client.depthChartSlot.deleteMany({ where: { teamId } });
  if (rows.length) await client.depthChartSlot.createMany({ data: rows });
}

/**
 * Give the user team a starting scouting book on every player in the league.
 * AI teams don't get rows — they evaluate on true ratings, which is a
 * deliberate simplification (documented in lib/ai/gm.ts) rather than storing
 * 60k+ report rows.
 */
export async function seedScoutingReports(
  leagueId: string,
  teamId: string,
  rng: Rng,
  settings: LeagueSettings,
) {
  const players = await prisma.player.findMany({
    where: { leagueId },
    select: { id: true, teamId: true, position: true, trueAttrs: true, trueOvr: true, isDraftee: true, experience: true, potential: true },
  });

  const rows: any[] = [];
  for (const p of players) {
    let confidence: number;
    if (p.teamId === teamId) confidence = SCOUTING.OWN_ROSTER_CONFIDENCE;
    else if (p.isDraftee) confidence = SCOUTING.ROOKIE_BASE_CONFIDENCE;
    else if (p.experience > 0) confidence = clamp(rng.normal(SCOUTING.LEAGUE_VETERAN_CONFIDENCE, 8), 30, 95);
    else confidence = SCOUTING.ROOKIE_BASE_CONFIDENCE;

    const trueAttrs = JSON.parse(p.trueAttrs) as AttrMap;
    // truePotential must be passed or observe() never sets the synthetic
    // potential-observation key, collapsing every unscouted player's
    // potential to the same flat SCOUTING.POTENTIAL_DEFAULT_CENTER.
    const observed = observe(rng, p.position as Position, trueAttrs, confidence, 50, 0, p.potential);
    rows.push({
      playerId: p.id,
      teamId,
      confidence: Math.round(confidence),
      observed: writeJson(observed),
      lastWeek: 0,
    });
  }

  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.scoutingReport.createMany({ data: rows.slice(i, i + CHUNK) });
  }
}
