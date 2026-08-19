import { prisma } from '../db';
import { Rng, clamp } from '../rng';
import { LEAGUE, CAP, OFF_SCHEMES, DEF_SCHEMES, Position, SCOUTING } from '../tuning';
import { LeagueSettings, serializeSettings, DEFAULT_SETTINGS } from '../settings';
import { TEAM_SEEDS, COACH_FIRST, COACH_LAST, FIRST_NAMES, LAST_NAMES } from './names';
import { generateRoster, generatePlayer, toPlayerCreate, GeneratedPlayer } from './players';
import { buildSchedule } from '../schedule';
import { buildContract, marketValue, suggestedYears } from '../cap';
import { defaultGmProfile } from '../ai/gm';
import { observe } from '../scouting';
import { writeJson } from '../json';
import { AttrMap } from '../ratings';

/**
 * Creates a complete, playable league from nothing:
 * 32 fictional franchises, staff, scouts, rosters (or a fantasy-draft pool),
 * contracts, a free agent pool, three years of draft picks, a full schedule,
 * depth charts, and the user's initial scouting book.
 */
export async function createLeague(opts: {
  name: string;
  userTeamAbbr: string;
  settings?: Partial<LeagueSettings>;
  seed?: string;
}): Promise<string> {
  const settings: LeagueSettings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const seed = opts.seed || settings.simSeed || `${Date.now()}`;
  const rng = new Rng(seed);
  const seasonYear = new Date().getFullYear();

  const fantasy = settings.leagueStart === 'FANTASY_DRAFT';

  const league = await prisma.league.create({
    data: {
      name: opts.name,
      seasonYear,
      week: 1,
      phase: fantasy ? 'FANTASY_DRAFT' : 'PRESEASON',
      settings: serializeSettings({ ...settings, simSeed: seed }),
    },
  });

  // --- Teams ----------------------------------------------------------------
  const teamRows = TEAM_SEEDS.map((t) => ({
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

  if (fantasy) {
    // Fantasy draft: everyone starts empty and one giant pool is drafted.
    // Pool = enough players for every team to fill a roster, plus slack.
    const poolSize = LEAGUE.TEAM_COUNT * LEAGUE.ROSTER_MAX + 120;
    for (let i = 0; i < poolSize; i++) {
      const p = generatePlayer(rng, {});
      registerPlayer(p, { status: 'FREE_AGENT', isDraftee: true, teamId: null }, false);
    }
  } else {
    for (const team of teams) {
      // [TUNE] team strength spread: -6 .. +6 rating points around league mean.
      const strength = rng.normal(0, 4);
      for (const p of generateRoster(rng, strength)) {
        registerPlayer(p, { teamId: team.id, status: 'ACTIVE' }, true);
      }
    }
    // Free agent pool — leftovers, mostly replacement level with a few real
    // players still unsigned. [TUNE] 140 free agents at league start.
    for (let i = 0; i < 140; i++) {
      const p = generatePlayer(rng, { ovrTarget: rng.normalClamped(58, 8, 38, 84) });
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
    const contractRows = rostered.map((p) => {
      const apy = marketValue({
        ovr: p.trueOvr, position: p.position as Position, age: p.age, potential: p.potential,
      });
      const years = suggestedYears(p.trueOvr, p.age);
      // Stagger how far into each deal we are so contracts expire on a curve.
      const elapsed = rng.int(0, Math.max(0, years - 1));
      const c = buildContract({ apy, years, signedYear: seasonYear - elapsed });
      return {
        playerId: p.id,
        teamId: p.teamId,
        years: c.years,
        yearsRemaining: Math.max(1, c.years - elapsed),
        signedYear: c.signedYear,
        baseSalaries: writeJson(c.baseSalaries),
        signingBonus: c.signingBonus,
        guaranteed: c.guaranteed,
        isRookieDeal: p.experience <= 3 && rng.bool(0.5),
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
    select: { id: true, teamId: true, position: true, trueAttrs: true, trueOvr: true, isDraftee: true, experience: true },
  });

  const rows: any[] = [];
  for (const p of players) {
    let confidence: number;
    if (p.teamId === teamId) confidence = SCOUTING.OWN_ROSTER_CONFIDENCE;
    else if (p.isDraftee) confidence = SCOUTING.ROOKIE_BASE_CONFIDENCE;
    else if (p.experience > 0) confidence = clamp(rng.normal(SCOUTING.LEAGUE_VETERAN_CONFIDENCE, 8), 30, 95);
    else confidence = SCOUTING.ROOKIE_BASE_CONFIDENCE;

    const trueAttrs = JSON.parse(p.trueAttrs) as AttrMap;
    const observed = observe(rng, p.position as Position, trueAttrs, confidence);
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
