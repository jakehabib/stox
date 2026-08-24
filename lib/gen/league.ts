import { prisma } from '../db';
import { Rng, clamp } from '../rng';
import { LEAGUE, CAP, Position, POSITIONS, ROSTER_TARGETS, SCOUTING, GENERATION, FREE_AGENCY } from '../tuning';
import type { LeagueStart } from '../types';
import { LeagueSettings, serializeSettings, DEFAULT_SETTINGS, capGrowthRate } from '../settings';
import {
  ageRebuildRoster,
  applyRebuildPins,
  chooseAlbatrosses,
  dealLastPlaceRoster,
  describeForfeits,
  drawForfeitedPicks,
  rebuildCapRoom,
  rebuildDeadMoney,
  rebuildDeadTailShare,
  rebuildHandoverNote,
  rebuildTeamStrength,
  type Albatross,
} from '../rebuild';
import { TEAM_SEEDS, COACH_FIRST, COACH_LAST, FIRST_NAMES, LAST_NAMES, NameRegistry } from './names';
import { generateRoster, generatePlayer, toPlayerCreate, GeneratedPlayer } from './players';
import { teamOverallFrom } from '../teamRating';
import { generateLeagueHistory } from './leagueHistory';
import { buildSchedule } from '../schedule';
import { buildContract, capForYear, capHit, formatMoney, marketValue, suggestedYears } from '../cap';
import { defaultGmProfile, parseGmProfile } from '../ai/gm';
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
 * [TUNE] WHAT A CLUB HAS COMMITTED DEPENDS ON WHAT IT IS TRYING TO DO — the
 * share of the salary cap a club's books are built to sit at, from its GM
 * profile's `winNow`.
 *
 * This was one flat 0.88 for all thirty-two, so every club's books were the
 * same shape and cap room was pure noise — the rebuild/contend axis predicted
 * nothing. In real football it is the strongest predictor there is: a club
 * going for it has its money out and sits against the ceiling, and a club
 * tearing down has shed its veterans and is carrying room it has not spent
 * yet.
 *
 * 0.68 at a full teardown to 0.94 all-in — about $79M of room at one end and
 * $15M at the other, against a $255M cap.
 *
 * It only ever scales DOWN, which is why this reads as "a rebuilder is
 * cheaper" rather than "a contender is dearer": a club already under its
 * target keeps the payroll its roster earns. Scaling a contender's salaries UP
 * to hit a number would pay men above their own market value, and every screen
 * in the game that compares the two would then be telling the truth about a
 * contract the generator had invented.
 *
 * EXPORTED BECAUSE THERE ARE TWO WAYS TO FILL THIRTY-TWO ROSTERS FROM NOTHING
 * and they must not disagree about what a club can afford. This one prices a
 * randomized league in a single pass; lib/draft.ts prices a fantasy draft one
 * pick at a time against the same target. Two copies of this band would be two
 * different leagues wearing the same salary cap.
 */
export function rosterCapTarget(winNow: number): number {
  return 0.68 + 0.26 * clamp(winNow, 0, 1);
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
  const requested: LeagueSettings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const seed = opts.seed || requested.simSeed || `${Date.now()}`;
  const rng = new Rng(seed);
  const seasonYear = new Date().getFullYear();

  // An imported plan always arrives with full rosters (lib/leagueFile.ts fills
  // any team the file left empty), so a fantasy draft over the top of it would
  // be drafting players who already have teams. Import is always a
  // randomized-rosters start; the import UI says so.
  const fantasy = requested.leagueStart === 'FANTASY_DRAFT' && !opts.plan;
  const rebuild = requested.leagueStart === 'REBUILD' && !opts.plan;

  /**
   * THE SAVE RECORDS THE START IT ACTUALLY GOT.
   *
   * An imported file arrives with its own rosters, so there is no hand to
   * deal — and a save stamped REBUILD without one would have its rules locked
   * (see IRONMAN in lib/rebuild.ts) over a league that was never made hard.
   * The setting is written down as what happened, not as what was asked for.
   */
  const leagueStart: LeagueStart =
    requested.leagueStart === 'REBUILD' && !rebuild ? 'RANDOM_ROSTERS' : requested.leagueStart;

  // A REBUILD save is played under pinned rules from its very first row rather
  // than from the first time somebody opens the Settings screen — see
  // REBUILD_PINS. Applied here, so a league created by a script or a test is
  // dealt the same rules as one created from the form.
  const settings: LeagueSettings = rebuild
    ? applyRebuildPins({ ...requested, leagueStart }, 'LOCKED')
    : { ...requested, leagueStart };

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
  /*
   * STRENGTH IS ROLLED HERE, BEFORE ANYTHING ELSE ABOUT THE CLUB.
   *
   * It used to be rolled deep in the roster loop below, long after the GM
   * profile had already been written from an unrelated draw — so a club's
   * declared window, its payroll and the roster it actually got were three
   * independent dice. Measured across a league: clubs flagged REBUILDING
   * averaged $37M of room and clubs flagged WIN-NOW averaged $50M, which is
   * backwards, and it is the reason the quarterback market felt dead. The
   * clubs that needed a passer were the ones that could not pay for him, and
   * the clubs with the room already had one.
   *
   * Rolling it first lets the window and the books both be consistent with
   * the team. [TUNE] spread: about -6..+6 rating points around the mean.
   */
  /**
   * WHICH CLUB IS THE USER'S, DECIDED ONCE.
   *
   * This used to be answered twice with two different fallbacks: `isUser`
   * below matched `opts.userTeamAbbr` against TEAM_SEEDS, and the resolution
   * further down fell back to `teams[0]` — which is read back ordered by
   * ABBR. An abbr matching no club therefore flagged nobody and handed the
   * player the alphabetically first club, and those are two different answers.
   * Harmless while both were only fallbacks; not harmless at all once the
   * REBUILD hand has to be dealt to the club the player is actually given, and
   * it is how the first measured REBUILD league handed its wreck to a club
   * nobody was running.
   */
  const userAbbr = teamSeeds.some((t) => t.abbr === opts.userTeamAbbr)
    ? opts.userTeamAbbr
    : teamSeeds.map((t) => t.abbr).sort()[0];

  const strengthByAbbr = new Map<string, number>(teamSeeds.map((t) => [t.abbr, rng.normal(0, 4)]));

  /**
   * THE REBUILD HAND, PART ONE: ONE CLUB IS GENERATED TO BE THE WORST.
   *
   * Drawn from the same seeded Rng as the other thirty-one, immediately after
   * them, so a REBUILD league still reproduces exactly from its seed — and
   * rolled HERE, with the rest, so the club's declared window, its books and
   * the roster it gets stay the one consistent picture the comment above is
   * about. The GM profile that follows reads this and correctly describes the
   * club as a teardown, because it is one.
   *
   * It is handed every OTHER club's roll because the hand is defined partly in
   * relation to them — "the worst roster in the league" is a claim about this
   * league, not about a number. See rebuildTeamStrength.
   */
  const rebuildAbbr = rebuild ? userAbbr : null;
  if (rebuildAbbr !== null) {
    const others = [...strengthByAbbr].filter(([abbr]) => abbr !== rebuildAbbr).map(([, v]) => v);
    strengthByAbbr.set(rebuildAbbr, rebuildTeamStrength(rng, others));
  }
  const teamRows = teamSeeds.map((t) => ({
    leagueId: league.id,
    city: t.city,
    nickname: t.nickname,
    abbr: t.abbr,
    conference: t.conference,
    division: t.division,
    isUser: t.abbr === userAbbr,
    prestige: rng.int(30, 80),
    gmProfile: writeJson(defaultGmProfile(rng, strengthByAbbr.get(t.abbr))),
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
    // A coordinator no longer carries a scheme string. It was a copy of his
    // club's `offScheme`/`defScheme`, it was read only by the deleted
    // `schemeFit`, and it was never rendered on any screen.
    const roles: { role: string }[] = [
      { role: 'HC' }, { role: 'OC' }, { role: 'DC' }, { role: 'ST' },
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
    // A file names its own rosters and its own free agents; what it does not
    // get to do is hand the league a market too thin to be a market. Topped
    // up to the same floor as a generated league, with the same fringe
    // population and the same "only if short" rule — a file that already
    // lists 260+ unsigned players gets nobody added.
    for (const p of generateFringeFreeAgents(rng, fringeShortfall(opts.plan.freeAgents.length), opts.plan.names)) {
      registerPlayer(p, { status: 'FREE_AGENT', teamId: null }, false);
    }
  } else if (fantasy) {
    // Fantasy draft: everyone starts empty and one giant pool is drafted.
    // Pool = enough players for every team to fill a roster, plus the men
    // nobody takes — who are the league's opening free-agent market, so the
    // slack is FREE_AGENCY.POOL_FLOOR rather than the 120 it used to be.
    // A fantasy league measured with the old number opened its first free
    // agency with a market of ZERO and kept it at zero for every season of
    // its life: 130 players went undrafted and every one of them was
    // stranded behind isDraftee (see the FANTASY_DRAFT case in lib/season.ts).
    //
    // THIS POOL IS RICHER THAN THE LEAGUE IT FILLS, and it is the one thing
    // about a fantasy start that still does not match a randomized one. These
    // are undifferentiated `generatePlayer` draws — a median 77 OVR with no
    // camp-body tail — where the 32 rosters built below run a median 73 and
    // carry the depth a real 53-man roster carries. Priced at market, the
    // 1,696 men who get drafted are worth 167% of a 32-club salary cap; the
    // men on randomized rosters are worth 99% of it. Nothing breaks — every
    // fantasy club still drafts to its own cap target (see WHAT A FANTASY PICK
    // IS PAID in lib/draft.ts) — but it does so by signing the whole league at
    // roughly half of market, so the best quarterback in a fantasy league is on
    // $23.8M where the best in a randomized league is on $37.8M. The fix is
    // here, giving the pool `generateRoster`'s shape plus a fringe tail, not a
    // cleverer curve in the draft.
    const poolSize = LEAGUE.TEAM_COUNT * LEAGUE.ROSTER_MAX + FREE_AGENCY.POOL_FLOOR;
    for (let i = 0; i < poolSize; i++) {
      const p = generatePlayer(rng, { names });
      registerPlayer(p, { status: 'FREE_AGENT', isDraftee: true, teamId: null }, false);
    }
  } else {
    /**
     * =====================================================================
     * THE REBUILD HAND, PART TWO: THE RANK IS A GUARANTEE, SO IT IS CHECKED
     * =====================================================================
     * The app owner asked for the worst roster in the league *every* time. A
     * strength margin cannot deliver that, and this is measured rather than
     * argued: strength is the mean a roster's ratings are drawn AROUND, and
     * fifty individual rolls move the finished club two or three points on
     * their own. Widened to 2.2 — far past the point of doing damage — the
     * club still came out 31st in one league of six, while the leagues it DID
     * win the race in opened 10 to 15 points clear of the field, won 1.3 games
     * and, because a cheaper roster spends less, carried $71.0M of cap room.
     * A bigger margin buys a worse guarantee AND a worse game.
     *
     * So the rank is not sampled and hoped for, it is CONDITIONED ON. Roll the
     * roster; if it is not the worst in this league, roll it again a notch
     * lower. The first draw that clears the field is the one that is kept, so
     * the club lands just below 31st rather than a canyon below it — the
     * guarantee is exact and the hand stays playable, which the brute-force
     * version could not manage at the same time.
     *
     * It terminates: every rejected attempt lowers the strength by
     * RANK_STEP, so the proposal walks down until it cannot lose. In practice
     * it accepts on the first or second try.
     *
     * THE COMPARISON USES THE DASHBOARD'S OWN ARITHMETIC — `teamOverallFrom`
     * is the function `buildLeagueRatings` computes its Team Overall with, not
     * a second implementation. Guaranteeing a rank against a formula that had
     * drifted from the one on screen would guarantee nothing anybody can see.
     */
    const ovrsAtFor = (roster: GeneratedPlayer[]) => (pos: Position) =>
      roster.filter((p) => p.position === pos).map((p) => p.trueOvr);

    const rosterByAbbr = new Map<string, GeneratedPlayer[]>();
    for (const team of teams) {
      if (team.abbr === rebuildAbbr) continue;
      // Rolled up front with the club's window — see strengthByAbbr above.
      const strength = strengthByAbbr.get(team.abbr) ?? rng.normal(0, 4);
      // Topped up to a legal roster before it is written — see topUpRoster.
      rosterByAbbr.set(team.abbr, topUpRoster(rng, generateRoster(rng, strength, names), strength, names));
    }

    if (rebuildAbbr !== null) {
      const floor = Math.min(...[...rosterByAbbr.values()].map((r) => teamOverallFrom(ovrsAtFor(r))));
      // The guarantee itself lives in lib/rebuild.ts — it returns a roster
      // strictly below the field or it throws, so a league that could not show
      // the club last is never written. See dealLastPlaceRoster.
      const dealt = dealLastPlaceRoster(rng, {
        startStrength: strengthByAbbr.get(rebuildAbbr) ?? 0,
        floorOverall: floor,
        build: (strength) => topUpRoster(rng, generateRoster(rng, strength, names), strength, names),
        overallOf: (roster) => teamOverallFrom(ovrsAtFor(roster)),
      });
      strengthByAbbr.set(rebuildAbbr, dealt.strength);
      // THE REBUILD HAND, PART THREE: the men at the top of this depth chart
      // are the last regime's, and older than they look. Ratings untouched, so
      // this cannot disturb the rank just settled — see ageRebuildRoster.
      rosterByAbbr.set(rebuildAbbr, ageRebuildRoster(rng, dealt.roster));
    }

    for (const team of teams) {
      for (const p of rosterByAbbr.get(team.abbr) ?? []) {
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

  // What the REBUILD club's cap sheet actually opened at, carried out of the
  // contract block so the founding note quotes the figures that were written
  // rather than a second set computed from the same intentions.
  let rebuildBooks: { capSpace: number; deadMoney: number; albatrosses: number } | null = null;
  let rebuildForfeits: { yearOffset: number; round: number }[] = [];


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
    }

    /**
     * THE REBUILD HAND, PART THREE: THE CONTRACTS YOU INHERITED.
     *
     * A handful of the club's veterans are on the deal they earned three or
     * four years ago and are nowhere near worth now, with two or three years
     * still to run and a fat signing bonus so cutting one costs real dead
     * money rather than being free. Chosen and priced in lib/rebuild.ts —
     * `marketValue` at the player he WAS, which is why the numbers are large
     * without anything being invented. Applied here, before the totals, so
     * everything downstream — the club's payroll, its cap sheet, the trade
     * screen's valuation of these men — is computed from the deal he actually
     * has.
     *
     * NOTE WHAT THIS DOES **NOT** DO: it does not touch the other forty-odd
     * contracts on the roster. They are at market, exactly like every other
     * club's. A rebuild is a few ruinous deals and a bad roster, not fifty men
     * all quietly overpaid, and the difference is what makes the ruinous ones
     * findable on the cap page.
     */
    /**
     * THE REBUILD CLUB'S BOOKS ARE SOLVED BACKWARDS FROM THE ROOM.
     *
     * The room is drawn first and is strictly positive by construction (see
     * rebuildCapRoom); the dead money is drawn next; and the payroll target is
     * whatever is left. `chooseAlbatrosses` then signs the last regime's
     * mistakes until the books reach it. The count is the outcome, so a very
     * cheap wreck takes more of them and a costlier roll takes fewer — which
     * is the only arrangement that can promise a tight cap whatever the roster
     * rolled, and the fix for a guaranteed-last roster opening on $55.2M.
     */
    const rebuildPlan = rebuildAbbr === null ? null : (() => {
      const capTotal = capForYear(seasonYear, seasonYear, capGrowthRate(settings));
      const room = rebuildCapRoom(rng, capTotal);
      const dead = rebuildDeadMoney(rng, capTotal);
      return { capTotal, room, dead, targetActive: Math.max(0, capTotal - room - dead) };
    })();

    const albatrosses = rebuildPlan === null
      ? new Map<string, Albatross>()
      : chooseAlbatrosses(
        rng,
        rostered
          .filter((p) => p.teamId === userTeam.id)
          .map((p) => ({
            id: p.id,
            age: p.age,
            position: p.position as Position,
            trueOvr: p.trueOvr,
            potential: p.potential,
            marketValue: nominalByPlayer.get(p.id) ?? 0,
          })),
        rebuildPlan.targetActive,
      );
    for (const [playerId, alb] of albatrosses) nominalByPlayer.set(playerId, alb.apy);

    for (const p of rostered) {
      nominalByTeam.set(p.teamId!, (nominalByTeam.get(p.teamId!) ?? 0) + nominalByPlayer.get(p.id)!);
    }
    // How much of the ceiling this club means to spend — see rosterCapTarget.
    const winNowByTeam = new Map(teams.map((t) => [t.id, parseGmProfile(t.gmProfile).winNow]));
    const scaleByTeam = new Map<string, number>();
    for (const [teamId, total] of nominalByTeam) {
      // THE REBUILD CLUB IS NOT SCALED. Every man on it is paid what he is
      // worth (bar the inherited deals above, which are the point), and the
      // gap between that and a real cap sheet is booked as dead money rather
      // than by inventing a payroll — see rebuildDeadMoney for why that is the
      // honest instrument and a uniform scale-up is not.
      if (teamId === userTeam.id && rebuildAbbr !== null) { scaleByTeam.set(teamId, 1); continue; }
      const target = CAP.BASE_CAP * rosterCapTarget(winNowByTeam.get(teamId) ?? 0.5);
      scaleByTeam.set(teamId, total > target ? target / total : 1);
    }

    /**
     * ONE RNG PASS FOR THE SHAPE OF EVERY DEAL, THEN A PURE FUNCTION FOR ITS
     * PRICE.
     *
     * The two used to be one `.map`, which was fine while every club's scale
     * was known before pricing began. The REBUILD club's is not: its scale is
     * whatever lands its cap sheet on the share of the ceiling the mode
     * promises, and that can only be known by MEASURING what the deals
     * actually cost — an APY is not a cap hit, and a plan that assumes it is
     * has invented the one number the whole mode rests on. Splitting the pass
     * lets the price be recomputed as many times as it takes without drawing
     * a single extra random number, so terms, stagger and rookie flags are
     * identical whatever the club ends up paying, and a league still
     * reproduces exactly from its seed.
     */
    const shapes = rostered.map((p) => {
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
      const alb = albatrosses.get(p.id);
      const isRookieDeal = !override && !alb && p.experience <= CAP.ROOKIE_EXPERIENCE_MAX;
      // An inherited deal is written as a longer contract already part-served,
      // so what is LEFT is what lib/rebuild.ts asked for. That matters: the
      // signing bonus prorates over the whole term, so the years already gone
      // are years of proration the club has paid for and has nothing to show
      // for — which is exactly why cutting him now still costs.
      const albRun = alb?.yearsServed ?? 0;
      const years = override?.years
        ?? (alb ? alb.yearsRemaining + albRun : isRookieDeal ? CAP.ROOKIE_DEAL_YEARS : suggestedYears(p.trueOvr, p.age));
      // Stagger how far into each deal we are so contracts expire on a curve.
      // A rookie's stagger isn't random — it's his experience. An imported
      // deal's stagger is whatever the file said is left to run.
      const elapsed = override
        ? Math.max(0, Math.min(override.years - override.yearsRemaining, years - 1))
        : alb
          ? albRun
          : isRookieDeal
            ? Math.min(p.experience, years - 1)
            : rng.int(0, Math.max(0, years - 1));
      // A bigger bonus share on an inherited deal, and it is the whole reason
      // one is hard to escape: proration is what accelerates as dead money the
      // day you cut him, so a 0.15 deal is a mistake you can walk away from and
      // a 0.30 deal is one you have to plan around.
      return { playerId: p.id, teamId: p.teamId!, nominal: nominalByPlayer.get(p.id)!, years, elapsed, isRookieDeal, bonusPct: alb ? 0.30 : 0.15 };
    });

    // Flat escalation on all of them: these contracts are being dropped
    // straight into a random mid-deal year, not signed fresh, so a backloaded
    // structure would land players in their single most expensive year with
    // none of the cap-friendly early years ever having applied — see
    // buildContract's `escalation` doc comment.
    type Shape = (typeof shapes)[number];
    const rowFor = (sh: Shape, scale: number) => {
      const apy = Math.max(CAP.MIN_SALARY, Math.round((sh.nominal * scale) / 100_000) * 100_000);
      const c = buildContract({
        apy, years: sh.years, signedYear: seasonYear - sh.elapsed, escalation: 1.0, bonusPct: sh.bonusPct,
      });
      return {
        playerId: sh.playerId,
        teamId: sh.teamId,
        years: c.years,
        yearsRemaining: Math.max(1, c.years - sh.elapsed),
        signedYear: c.signedYear,
        baseSalaries: writeJson(c.baseSalaries),
        signingBonus: c.signingBonus,
        guaranteed: c.guaranteed,
        isRookieDeal: sh.isRookieDeal,
      };
    };

    /**
     * =====================================================================
     * THE REBUILD HAND, PART FOUR: TRIMMING ONTO THE TARGET
     * =====================================================================
     * The inherited contracts have already carried the payroll up to its
     * target in APY terms. This is the reconciliation, and it exists because
     * AN APY IS NOT A CAP HIT — the 100K rounding and the league-minimum floor
     * move the real figure a little, and the real figure is the one the cap
     * page, the compliance gate and INV-19 all read.
     *
     * IT ONLY EVER SCALES DOWN. `Math.min(1, ...)` is the same bound the loop
     * above applies to all thirty-two clubs, and here it is also the safety
     * property: the payroll can land under its target but never over it, so
     * the club's room can only ever be LARGER than the room that was drawn.
     * Larger is a slightly easier hand; smaller could be a save that cannot
     * advance out of week one, and that asymmetry is deliberate.
     */
    if (rebuildPlan !== null) {
      const mine = shapes.filter((sh) => sh.teamId === userTeam.id);
      const measure = (scale: number) =>
        mine.reduce((sum, sh) => sum + capHit(rowFor(sh, scale), settings.capMode), 0);

      let scale = 1;
      for (let step = 0; step < 6; step++) {
        const at = measure(scale);
        if (at <= rebuildPlan.targetActive || at <= 0) break;
        const next = Math.min(1, scale * (rebuildPlan.targetActive / at));
        if (Math.abs(next - scale) < 1e-9) break;
        scale = next;
      }
      scaleByTeam.set(userTeam.id, scale);
    }

    const contractRows = shapes.map((sh) => rowFor(sh, scaleByTeam.get(sh.teamId) ?? 1));
    for (let i = 0; i < contractRows.length; i += CHUNK) {
      await prisma.contract.createMany({ data: contractRows.slice(i, i + CHUNK) });
    }

    /**
     * ...AND WHAT THE LAST REGIME LEFT BEHIND.
     *
     * A drawn share of the ceiling, bounded by a bend rather than a clamp. It
     * is no longer the plug that closes the cap — the inherited contracts are
     * — because dead money grows without limit as the roster gets cheaper, and
     * the version that used it this way booked $131.7M against a $107.1M
     * payroll: legal, conserving and describing a club that cannot exist.
     *
     * The bill runs out in two seasons: the whole charge this year, a
     * shrinking tail next year, nothing after that. That is "rough but not
     * impossible" expressed as a date — you cannot spend your way clear in one
     * offseason and you can see the end of it from the first.
     */
    if (rebuildPlan !== null) {
      const activeSalary = contractRows
        .filter((r) => r.teamId === userTeam.id)
        .reduce((sum, r) => sum + capHit(r, settings.capMode), 0);

      const deadThisYear = rebuildPlan.dead;
      const deadNextYear = Math.round(deadThisYear * rebuildDeadTailShare(rng));

      const charges = [
        { teamId: userTeam.id, year: seasonYear, amount: deadThisYear, label: 'Previous regime — released contracts' },
        { teamId: userTeam.id, year: seasonYear + 1, amount: deadNextYear, label: 'Previous regime — released contracts' },
      ].filter((c) => c.amount > 0);
      if (charges.length > 0) await prisma.capCharge.createMany({ data: charges });

      rebuildBooks = {
        capSpace: rebuildPlan.capTotal - activeSalary - deadThisYear,
        deadMoney: deadThisYear,
        albatrosses: albatrosses.size,
      };
    }
  }

  // --- Draft picks -----------------------------------------------------------
  // FOUR years, because the first of them is the draft that is about to run.
  // Three were generated before, and the moment that first draft was over the
  // trade hub had only two years of capital left to deal in — see the note in
  // addFutureDraftPicks (lib/season.ts), which keeps it at three from there on.
  const pickRows: any[] = [];
  for (let yearOffset = 0; yearOffset < 4; yearOffset++) {
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
  /**
   * THE REBUILD HAND, PART FIVE: THE PICKS THE LAST REGIME TRADED AWAY.
   *
   * Applied to the rows BEFORE they are written, so the league is simply born
   * with those picks belonging to somebody else. They are reassigned rather
   * than deleted — every round still has thirty-two picks in it, nothing in
   * the draft machinery has to learn about a hole, and the draft screen
   * already renders a pick whose original club is you and whose owner is not
   * as "traded away" to the club that has it. The player is told he was dealt
   * this instead of discovering a gap.
   *
   * `originalTeamId` is left pointing at the user's club on purpose: that is
   * what makes it HIS forfeited first-rounder on the screen rather than an
   * anonymous extra pick of somebody else's, and it is what the pick's
   * projected slot is computed from.
   */
  if (rebuildAbbr !== null) {
    const forfeits = drawForfeitedPicks(rng, settings.draftRounds);
    const others = teams.filter((t) => t.id !== userTeam.id);
    for (const f of forfeits) {
      const year = seasonYear + 1 + f.yearOffset;
      const row = pickRows.find((r) =>
        r.originalTeamId === userTeam.id && r.year === year && r.round === f.round);
      if (row) row.ownerTeamId = rng.pick(others).id;
    }
    rebuildForfeits = forfeits;
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
      detail: rebuildBooks
        ? rebuildHandoverNote({
          clubName: `${userTeam.city} ${userTeam.nickname}`,
          deadMoney: formatMoney(rebuildBooks.deadMoney),
          capSpace: formatMoney(rebuildBooks.capSpace),
          albatrosses: rebuildBooks.albatrosses,
          // The first draft this GM will run is next year's — see the pick
          // rows above, which start at seasonYear + 1.
          forfeits: describeForfeits(rebuildForfeits, seasonYear + 1),
        })
        : `You are the GM of the ${userTeam.city} ${userTeam.nickname}. ${
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
 * ===========================================================================
 * DROP CHART ROWS NAMING MEN WHO ARE NOT ON THE ROSTER ANY MORE
 * ===========================================================================
 * `reconcileDepthChart` already does this, and every path that moves ONE
 * player calls it — a trade, a signing, a cut, a draft pick. The paths that
 * move a hundred at once do not: retirement (`progressAllPlayers`), contracts
 * expiring into free agency (`releaseUnresignedExpiringContracts`) and
 * cut-down day all set `Player.teamId = null` in bulk and leave the slot
 * behind. Measured on the dev database, 533 of 8,836 chart rows in
 * nine-season saves (6.0%) and 2,118 of 96,774 at one season old name a man
 * his club no longer employs.
 *
 * IT IS NOT COSMETIC ON THE USER'S OWN SCREEN. app/league/[id]/depth-chart
 * takes the first `startersAt(pos)` ids off the chart and then filters out the
 * ones it cannot resolve to a player, so an orphan sitting at rank 0 does not
 * shuffle the man behind him up — it reports the club a starter SHORT at that
 * position, with a real receiver two rows down. Measured across every save on
 * the dev database: 608 orphan rows are sitting inside a STARTING slot, on
 * 333 clubs. The sim is unaffected — `mergeUnnamed` never sees an id that is
 * not on the roster — which is exactly why this survived: the game played on
 * correctly while the screen describing it was wrong.
 *
 * DELETE-ONLY, ON PURPOSE, so it is safe to run on the user's club as well as
 * the AI's. It removes rows and reorders nothing, so the order he set stands
 * exactly as he set it, minus the men who are gone. Ranks are left
 * non-contiguous — every reader treats rank as relative (`orderBy: rank`),
 * and the alternative, renumbering, is a write per surviving row to change
 * nothing anybody can observe.
 *
 * Rejected: calling `reconcileDepthChart` once per club instead. Same effect
 * on the data, 32 clubs x 2 reads + a rewrite of every chart that changed,
 * against one statement here.
 */
export async function dropOrphanDepthChartSlots(leagueId: string): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM "DepthChartSlot" d
    USING "Team" t
    WHERE t.id = d."teamId"
      AND t."leagueId" = ${leagueId}
      AND NOT EXISTS (
        SELECT 1 FROM "Player" p WHERE p.id = d."playerId" AND p."teamId" = d."teamId"
      )
  `;
}

/**
 * ===========================================================================
 * RE-SORT EVERY *AI* CLUB'S DEPTH CHART BY RATING — NEVER THE USER'S
 * ===========================================================================
 * WHAT WAS ACTUALLY BROKEN. Not arrivals: `reconcileDepthChart` below slots a
 * new man in on merit, so a club that signs a 90 in March does NOT play him
 * last. What nothing in the game did was re-sort a chart when the RATINGS
 * under it moved. Progression is a bulk `UPDATE "Player" SET "trueOvr"`
 * (lib/development.ts, both the in-season checkpoints and the offseason
 * PROGRESS step) and it touches no depth chart at all, so a chart written in
 * 2026 still ranks men by what they were worth in 2026. Measured across 6,752
 * clubs in 117 real saves (scripts/_dc_gap.ts), the distance between the
 * lineup a club FIELDS and the best lineup its roster could field grows with
 * the age of the save:
 *
 *     league age   0     1     2     3     4     6     9
 *     mean gap   1.12  2.28  3.32  6.74 10.27 11.56 11.33   rating points
 *     clubs >=5   8%   17%   25%   45%   59%   75%   58%
 *
 * WHAT THAT COSTS, AND IT IS WINS NOW. This paragraph used to open "It is NOT
 * wins, and it is now not wins at all", on the grounds that
 * `positionUnitRating` in lib/sim/units.ts re-sorted its input by rating and
 * every unit-weighted term the engine scored a game with was therefore
 * order-INVARIANT. THAT SORT IS GONE. The engine plays the man the chart
 * names, at every slot UNIT_DEPTH_WEIGHTS pays out to — so a stale AI chart is
 * now a worse football team and not merely a wrong box score, which is exactly
 * why this sweep matters more than it did when it was written.
 *
 * Measured across all 8,576 clubs in the 271 saves on this machine at the
 * moment the sort came out: honouring the order moves a club's engine rating
 * for 50.6% of them, by a mean of -0.065 rating points (p05 -0.292, worst
 * -3.010). AI clubs move -0.0650 and user clubs -0.0718 — the sweep below is
 * doing its job, and the human is handed no edge by the change.
 *
 * The BOX SCORE cost it always had is unchanged and still real: `allocateStats`
 * hands targets, carries, tackles and the passing line to `units.depth[pos]`
 * in chart order, and on 1,216 clubs 5.9% were about to give their passing
 * line to a quarterback who was not their best, 15.1% their WR1 targets to the
 * wrong receiver, 13.5% their CB1 snaps to the wrong corner. Awards,
 * leaderboards and career lines are all downstream. The difference is that the
 * scoreboard is downstream of it now too.
 *
 * WHY THE USER'S CLUB IS EXEMPT, AND THAT IS NOT A HALF-FIX. His order is a
 * decision. `autoDepthChart` used to run on every draft pick and threw away
 * his hand-set order every time he made one (see lib/draft.ts); the whole
 * reason `reconcileDepthChart` exists is that a roster move must never
 * relitigate what he ranked. An AI club has no such decision to protect — it
 * has never expressed an order in its life — so re-sorting it destroys no
 * information. He keeps Auto-Sort, which is the same call, on his own button.
 *
 * ONE PASS, FOUR QUERIES, whatever the league size, and it writes only the
 * clubs whose order actually changed. The obvious shape —
 * `for (const t of teams) await autoDepthChart(t.id)`, which is what
 * `autoDepthChartAll` does — is two round trips per club before it writes
 * anything, and it rewrites all of them unconditionally. Measured on a
 * nine-season 32-club league (scripts/_dc_cost.ts): 182-184ms for the loop,
 * 92-159ms batched from a fully stale chart, and 15-21ms batched once the
 * league is already sorted. The steady-state number is the one that decided
 * it, because that is the case that runs four or five times a season.
 */
export async function autoDepthChartAiClubs(leagueId: string): Promise<{ clubs: number; rewritten: number }> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userTeamId: true } });
  const teams = await prisma.team.findMany({
    where: { leagueId, ...(league?.userTeamId ? { id: { not: league.userTeamId } } : {}) },
    select: { id: true },
  });
  const teamIds = teams.map((t) => t.id);
  if (teamIds.length === 0) return { clubs: 0, rewritten: 0 };

  const [players, slots] = await Promise.all([
    prisma.player.findMany({
      where: { teamId: { in: teamIds } },
      select: { id: true, teamId: true, position: true, trueOvr: true },
    }),
    prisma.depthChartSlot.findMany({ where: { teamId: { in: teamIds } }, orderBy: { rank: 'asc' } }),
  ]);

  const byTeam = new Map<string, { id: string; position: string; trueOvr: number }[]>();
  for (const p of players) (byTeam.get(p.teamId!) ?? byTeam.set(p.teamId!, []).get(p.teamId!)!).push(p);
  const slotsByTeam = new Map<string, typeof slots>();
  for (const s of slots) (slotsByTeam.get(s.teamId) ?? slotsByTeam.set(s.teamId, []).get(s.teamId)!).push(s);

  const changed: string[] = [];
  const rows: { teamId: string; playerId: string; position: string; rank: number }[] = [];
  for (const teamId of teamIds) {
    const roster = byTeam.get(teamId) ?? [];
    const byPos: Record<string, { id: string; trueOvr: number }[]> = {};
    for (const p of roster) (byPos[p.position] ??= []).push(p);
    const want: { teamId: string; playerId: string; position: string; rank: number }[] = [];
    for (const [position, group] of Object.entries(byPos)) {
      // Tie-break on id. Postgres hands rows back in no guaranteed order, so
      // two equal ratings would otherwise swap places between runs and mark a
      // club "changed" forever — a write every week that alters nothing.
      group.sort((a, b) => b.trueOvr - a.trueOvr || a.id.localeCompare(b.id));
      group.forEach((p, rank) => want.push({ teamId, playerId: p.id, position, rank }));
    }
    const have = slotsByTeam.get(teamId) ?? [];
    const key = (r: { position: string; rank: number }) => `${r.position}#${r.rank}`;
    const existing = new Map(have.map((s) => [key(s), s.playerId]));
    const same = want.length === have.length && want.every((r) => existing.get(key(r)) === r.playerId);
    if (same) continue;
    changed.push(teamId);
    rows.push(...want);
  }
  if (changed.length === 0) return { clubs: teamIds.length, rewritten: 0 };

  // Delete-then-insert per the same reasoning as reconcileDepthChart:
  // `@@unique([teamId, position, rank])` makes an in-place shuffle a minefield
  // of transient collisions. Both statements in one transaction so a club is
  // never left with no chart at all if the second one fails.
  await prisma.$transaction([
    prisma.depthChartSlot.deleteMany({ where: { teamId: { in: changed } } }),
    prisma.depthChartSlot.createMany({ data: rows }),
  ]);
  return { clubs: teamIds.length, rewritten: changed.length };
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
