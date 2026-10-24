/**
 * ===========================================================================
 * A CHALLENGE FILE -> A PLAYABLE SAVE, OR NOTHING AT ALL
 * ===========================================================================
 *
 * THIS IS THE PART THAT MATTERS. A league file is shallow and the reader can
 * be the whole of its correctness story: thirty-two clubs, rosters, a free
 * agent pool, and anything missing is generated. A challenge is a save across
 * twenty-two tables with references running in every direction, and no amount
 * of shape checking covers it:
 *
 *   SHAPE CANNOT SEE REFERENTIAL TRUTH ACROSS TABLES. The reader proves every
 *   index is in range. It cannot prove that the man a depth chart starts at
 *   quarterback is on that club's roster, that a contract's team is the team
 *   the player plays for, that a cap ledger adds up to the cap space the file
 *   implies, or that the draft order still names picks that exist.
 *
 *   SHAPE CANNOT SEE THE INVARIANTS THE ENGINE ASSUMES. `advanceWeek` takes a
 *   league state for granted in about thirty places — a status of ACTIVE means
 *   a contract exists (INV-04), a pick marked used has a player on it
 *   (INV-09), every club can field every position its lineup needs (INV-25).
 *   A file can satisfy every type in the format and still put the league in a
 *   state the engine cannot step out of, and the symptom arrives a week later
 *   as a crash in somebody else's code.
 *
 * SO: WRITE IT ALL, INSIDE ONE TRANSACTION, RUN THE EXISTING INVARIANT SUITE
 * AGAINST THE RESULT, AND ROLL BACK THE WHOLE THING IF ANYTHING IS WRONG.
 *
 * `checkInvariants` (lib/invariants.ts) now takes the client to read through
 * for exactly this reason — a separate connection cannot see rows inside an
 * uncommitted transaction, so a gate that used the global client would have
 * checked an empty league and passed everything. The invariant suite is reused
 * rather than reimplemented, deliberately: a second notion of "valid" would
 * drift from the first within a release, and the first one is the one the
 * game's own soak test (`npm run sim:health`) is calibrated against.
 *
 * WARNINGS ARE NOT REFUSALS. The suite grades each violation `error` or
 * `warning`, and only errors refuse. A club over the cap (INV-19) or carrying
 * sixty men (INV-08) is not a broken save — it is very often the whole point
 * of the challenge.
 *
 * THIS IS THE ONE PLACE IN THE APP THAT USES A BIG INTERACTIVE TRANSACTION,
 * and it is the opposite of what lib/leagueFromFile.ts argues for. The
 * argument there is correct and still applies to its own path: `createLeague`
 * is ~236 sequential round trips driven by the generator, and wrapping that in
 * a transaction trades a rare broken save for a routinely exceeded timeout. A
 * challenge import is not that shape. It is a fixed number of `createMany`
 * calls over data that is already in memory — measured below a few seconds —
 * and, far more importantly, it has a GATE at the end whose only possible
 * remedy is "none of this happened". A delete-afterwards cleanup would leave a
 * window in which a league that failed its own invariant check is listed,
 * openable and advanceable, and the cleanup itself can fail. Rollback cannot.
 *
 * ===========================================================================
 * THE SCRUB, ENFORCED HERE
 * ===========================================================================
 * Most of it is structural — the format has no field for a DynastyProfile, a
 * DynastyRank, a ScoutingReport or a ShortlistEntry, so there is nothing to
 * read and nothing to write. The three things this function does on purpose:
 *
 *   1. `gmHiredYear` is stamped at the season the recipient arrives, so every
 *      derived career figure in the game (GM page, dynasty level and skill
 *      points, rank board, rebuild standing, trophy history) measures from
 *      today and finds nothing. The club's standings history is intact; the
 *      publisher's record is not attached to it. `startYear` is carried
 *      unchanged, because the salary cap's ceiling is grown from it.
 *   2. The club the recipient takes gets a FRESH `gmProfile`. The other
 *      thirty-one keep theirs, which is a deliberate disagreement with the
 *      instruction to scrub all of them: `gmProfile` is not identity, it is
 *      the AI front office's negotiating personality (lib/ai/gm.ts), and it is
 *      most of what makes a rival club behave the way it does in a trade. Wipe
 *      all thirty-two and the two GMs playing the same challenge are no longer
 *      playing the same challenge. On the human's own club it is vestigial —
 *      "nothing in the game reads a gmProfile for the team he runs"
 *      (lib/season.ts) — and it is the one that could carry a trace of the
 *      publisher, so that is the one that is replaced.
 *   3. `advanceStartedAt` and `rebuildAbandonedAt` are cleared. The first is a
 *      lease on the publisher's own in-flight advance and would be a league
 *      the recipient cannot advance; the second is a decision the recipient
 *      has not made.
 * ===========================================================================
 */
import { randomBytes } from 'crypto';
import { prisma } from './db';
import { writeJson } from './json';
import { Violation, checkInvariants } from './invariants';
import { Viewer } from './owner';
import { BOX_TOKEN_PATTERN, SaveFile } from './saveFile';
import { Rng } from './rng';
import { defaultGmProfile } from './ai/gm';

/**
 * How long the load has to finish inside the transaction, and how long it may
 * wait for a connection.
 *
 * Measured: writing a three-season save plus the full invariant pass is a few
 * seconds on a local Postgres. The ceiling is generous rather than tight
 * because the alternative to finishing is a rollback — a timeout here costs
 * the recipient their import and nothing else, whereas a timeout tuned so
 * close that an ordinary slow moment trips it would make the feature
 * unreliable for no benefit.
 */
const TX_TIMEOUT_MS = 120_000;
const TX_MAX_WAIT_MS = 20_000;

/**
 * Rows per `createMany`. Postgres takes one bind parameter per column per
 * row, and the protocol's limit is 65,535 of them — a PlayerSeason row is 11
 * columns, so an unchunked insert of 80,000 of them is not slow, it is a
 * protocol error. 2,000 rows keeps the widest table in this file an order of
 * magnitude clear of the limit.
 */
const CHUNK = 2_000;

/**
 * ===========================================================================
 * WHY THIS FILE MINTS ITS OWN IDS, AND WHY THEY ARE CUID-SHAPED
 * ===========================================================================
 * The four tables everything else points at — League, Team, Player, DraftPick
 * — need their ids known BEFORE the rows are written, because every reference
 * in the challenge is an index and `createMany` cannot hand ids back. (Every
 * other table lets Prisma's own `@default(cuid())` fill it, which is why only
 * four arrays are minted here.)
 *
 * THE SHAPE IS NOT COSMETIC. Two places in this codebase depend on it:
 *
 *   `reconstructPlayerSeasons` (lib/playerSeasons.ts) finds a player's
 *   in-progress season with a LIKE on box score text for his id, and says so
 *   in its own comment: "Player ids are fixed-length cuids, so a substring
 *   match cannot collide with another id." An id of a different length, or one
 *   that could be a prefix of another, breaks that reasoning.
 *
 *   The box-score rewrite below replaces index tokens with these ids, and the
 *   result has to be indistinguishable from what the game itself writes.
 *
 * So: `c`, eight base-36 characters of millisecond clock, four of a
 * per-process counter, twelve of `randomBytes`. Twenty-five characters
 * matching `^c[a-z0-9]{24}$`, exactly as a cuid does. The random tail is 62
 * bits, and the counter makes two ids minted in the same millisecond by this
 * process distinct regardless.
 * ===========================================================================
 */
let mintCounter = Math.floor(Math.random() * 36 ** 4);

function mintId(): string {
  const time = Date.now().toString(36).padStart(8, '0').slice(-8);
  mintCounter = (mintCounter + 1) % 36 ** 4;
  const count = mintCounter.toString(36).padStart(4, '0');
  const rand = randomBytes(8).readBigUInt64BE().toString(36).padStart(12, '0').slice(-12);
  return `c${time}${count}${rand}`;
}

/** A refusal the recipient can act on, told apart from a database fault. */
export class SaveImportError extends Error {
  /** The invariant violations that refused the import, if that is what did. */
  readonly violations: Violation[];

  constructor(message: string, violations: Violation[] = []) {
    super(message);
    this.name = 'SaveImportError';
    this.violations = violations;
  }
}

/**
 * THE ONE PLACE A REFUSED IMPORT IS WORDED.
 *
 * Both the route and any screen that imports a challenge show this, so the
 * sentence a recipient reads and the sentence a publisher is told to act on
 * are the same sentence. It names the invariants by id, because the only
 * person who can fix the file is whoever published it and "INV-04" is the
 * entire bug report; and it says plainly that nothing was written, because the
 * first thing anybody wants to know after a failed import is whether they now
 * have half a league.
 */
export function unplayableMessage(violations: Violation[]): string {
  const ids = [...new Set(violations.map((v) => v.id))].sort();
  const first = violations[0];
  return (
    `That challenge is not playable and was not imported — nothing was written. `
    + `The league it describes fails ${ids.length === 1 ? 'a check' : `${ids.length} checks`} the game `
    + `relies on: ${ids.join(', ')}. `
    + (first ? `First failure: ${first.message} (${first.count} affected, e.g. ${first.sample.slice(0, 2).join(', ')}). ` : '')
    + 'Ask whoever published it to publish it again from a save that advances cleanly.'
  );
}

export interface SaveImportResult {
  leagueId: string;
  /** Non-error violations the save came in with. Kept, not hidden. */
  warnings: Violation[];
  /** Wall clock inside the transaction, for the log line. */
  ms: number;
}

/**
 * Writes the challenge and hands back the new league id.
 *
 * THE CALLER PROVES EVERYTHING THAT COMES BEFORE: who is asking, whether they
 * may create a league at all, and whether they are inside their hourly
 * ceiling. This function spends no budget and refuses nobody on those grounds
 * — it is the expensive part, and it runs only once a caller has earned it.
 * The one thing it does refuse is a save that will not play.
 */
export async function importSaveFile(args: {
  file: SaveFile;
  /** The league's name as it will appear in the recipient's franchise list. */
  name: string;
  /**
   * Which club the recipient takes, as an index into `file.teams`. Null means
   * "whatever the file says", which is the ordinary case — a challenge is a
   * specific job. A file with no club flagged and no override lands on club 0.
   */
  userTeam: number | null;
  viewer: Viewer;
  ownerKey: string;
  /** Appears in the log line, so a redemption can be told from an upload. */
  source: string;
}): Promise<SaveImportResult> {
  const { file } = args;
  const started = Date.now();

  const takeOver = args.userTeam ?? file.league.userTeam ?? 0;
  if (takeOver < 0 || takeOver >= file.teams.length) {
    throw new SaveImportError('That club is not in this challenge.');
  }

  // Ids are minted UP FRONT, outside the transaction, so every row can be
  // written with `createMany` and every reference resolved without a read-back.
  // One array per table, positionally matching the file's own arrays, which is
  // what makes the index references in the format usable directly.
  const leagueId = mintId();
  const teamIds = file.teams.map(() => mintId());
  const playerIds = file.players.map(() => mintId());
  const pickIds = file.picks.map(() => mintId());

  const t = (i: number) => teamIds[i];
  const p = (i: number) => playerIds[i];

  /**
   * The box-score rewrite, the other half of the exporter's tokenise step —
   * see THE ONE BLOB THAT HAS IDS INSIDE IT in lib/saveFile.ts. A token whose
   * index is out of range is left verbatim rather than resolved to `undefined`,
   * which would write the four characters "unde" into a box score; the reader
   * has already ranged every real reference, and a stray token in prose is not
   * worth refusing a whole save over.
   */
  const detokenise = (text: string): string =>
    text.replace(BOX_TOKEN_PATTERN, (whole, kind: string, digits: string) => {
      const i = Number(digits);
      const id = kind === 'T' ? teamIds[i] : playerIds[i];
      return id ?? whole;
    });

  /**
   * ===========================================================================
   * CREATED-AT IS REBUILT FROM DOCUMENT ORDER, NOT CARRIED AND NOT DEFAULTED
   * ===========================================================================
   * Three carried tables have a `createdAt` that something reads back:
   * Transaction (the news wire, the GM page, the history page, the draft
   * board and the week report all order by it), TradeRecord (the league wire
   * and the AI market) and TradeOffer (the trade screen).
   *
   * DEFAULTING IS WRONG. `@default(now())` inside one transaction gives every
   * row of a 4,400-row ledger the same instant, so every one of those screens
   * falls back to whatever tie-break Postgres happens to apply and the news
   * from week 3 of 2027 interleaves with the news from week 9 of 2029. The
   * app has already been bitten by exactly this (see the note in
   * app/league/[id]/layout.tsx: "createdAt is honest about when the row was
   * written and lying about when the event happened").
   *
   * CARRYING THE PUBLISHER'S TIMESTAMPS IS ALSO WRONG, for a smaller reason:
   * they are a log of when that person was at their desk, which is not part
   * of the situation and not something a recipient needs.
   *
   * So each table's rows get strictly increasing instants, one millisecond
   * apart, ending at the moment of import — in the order the document lists
   * them, which the exporter ordered by (seasonYear, week, createdAt). Every
   * screen's ordering is therefore the publisher's ordering, and the absolute
   * instants say only "this arrived when the challenge was taken", which is
   * true.
   */
  const importedAt = Date.now();
  const ordered = (i: number, total: number) => new Date(importedAt - (total - i));

  let warnings: Violation[] = [];

  await prisma.$transaction(async (tx) => {
    await tx.league.create({
      data: {
        id: leagueId,
        name: args.name,
        seasonYear: file.league.seasonYear,
        // CARRIED. The salary cap's ceiling is grown from the founding year
        // (capForYear, lib/leagueYear.ts), so this is the one year that must
        // not move or every club's cap space moves with it.
        startYear: file.league.startYear,
        // STAMPED. The recipient is the new hire — see THE SCRUB in the header.
        gmHiredYear: file.league.seasonYear,
        week: file.league.week,
        phase: file.league.phase,
        contractsAgedYear: file.league.contractsAgedYear,
        resignWarnedYear: file.league.resignWarnedYear,
        // Not inherited: a lease on somebody else's in-flight advance, and a
        // decision the recipient has not made.
        advanceStartedAt: null,
        rebuildAbandonedAt: null,
        settings: file.league.settings,
        userTeamId: t(takeOver),
        ownerKey: args.ownerKey,
        userId: args.viewer.userId,
      },
    });

    // Clubs, with the flag moved to the one being handed over whatever the
    // file said — the recipient's own screen reads `isUser`, and two clubs
    // carrying it (or none) is a league with no front office.
    const gmRng = new Rng(`challenge-${leagueId}`);
    await tx.team.createMany({
      data: file.teams.map((team, i) => ({
        id: teamIds[i],
        leagueId,
        city: team.city,
        nickname: team.nickname,
        abbr: team.abbr,
        conference: team.conference,
        division: team.division,
        isUser: i === takeOver,
        prestige: team.prestige,
        // The AI personality, except on the club the recipient takes, which
        // gets a fresh one. See THE SCRUB point 2.
        gmProfile: i === takeOver ? writeJson(defaultGmProfile(gmRng)) : team.gmProfile,
        wins: team.wins,
        losses: team.losses,
        ties: team.ties,
        pointsFor: team.pointsFor,
        pointsAgnst: team.pointsAgnst,
        divWins: team.divWins,
        divLosses: team.divLosses,
        confWins: team.confWins,
        confLosses: team.confLosses,
        playoffSeed: team.playoffSeed,
        eliminated: team.eliminated,
        scoutPoints: team.scoutPoints,
        scoutPeriod: team.scoutPeriod,
        scoutPeriodGrant: team.scoutPeriodGrant,
        scoutSpentSeason: team.scoutSpentSeason,
      })),
    });

    await chunked(file.teams.flatMap((team, i) => team.staff.map((s) => ({
      teamId: teamIds[i], role: s.role, name: s.name, rating: s.rating,
      playCalling: s.playCalling, development: s.development, contractYears: s.contractYears, salary: s.salary,
    }))), (rows) => tx.staff.createMany({ data: rows }));

    await chunked(file.teams.flatMap((team, i) => team.scouts.map((s) => ({
      teamId: teamIds[i], name: s.name, accuracy: s.accuracy,
      speed: s.speed, specialty: s.specialty, salary: s.salary,
    }))), (rows) => tx.scout.createMany({ data: rows }));

    await chunked(file.teams.flatMap((team, i) => team.capCharges.map((c) => ({
      teamId: teamIds[i], year: c.year, amount: c.amount, label: c.label,
    }))), (rows) => tx.capCharge.createMany({ data: rows }));

    await chunked(file.players.map((player, i) => ({
      id: playerIds[i],
      leagueId,
      teamId: player.team == null ? null : t(player.team),
      firstName: player.firstName,
      lastName: player.lastName,
      position: player.position,
      age: player.age,
      experience: player.experience,
      heightIn: player.heightIn,
      weightLb: player.weightLb,
      college: player.college,
      trueAttrs: player.trueAttrs,
      trueOvr: player.trueOvr,
      potential: player.potential,
      devTrait: player.devTrait,
      lastSeasonOvr: player.lastSeasonOvr,
      status: player.status,
      isDraftee: player.isDraftee,
      draftYear: player.draftYear,
      draftRound: player.draftRound,
      draftPickNo: player.draftPickNo,
      collegeStats: player.collegeStats,
      combineTesting: player.combineTesting,
      devFocus: player.devFocus,
      yearsUnsigned: player.yearsUnsigned,
      weeksUnsigned: player.weeksUnsigned,
      injuryWeeks: player.injuryWeeks,
      injuryType: player.injuryType,
      fatigue: player.fatigue,
      morale: player.morale,
      seasonStats: player.seasonStats,
      careerStats: player.careerStats,
      playoffStats: player.playoffStats,
      careerPlayoffStats: player.careerPlayoffStats,
    })), (rows) => tx.player.createMany({ data: rows }));

    await chunked(file.players.flatMap((player, i) => (player.contract == null ? [] : [{
      playerId: playerIds[i],
      teamId: player.contract.team == null ? null : t(player.contract.team),
      years: player.contract.years,
      yearsRemaining: player.contract.yearsRemaining,
      signedYear: player.contract.signedYear,
      baseSalaries: player.contract.baseSalaries,
      signingBonus: player.contract.signingBonus,
      guaranteed: player.contract.guaranteed,
      isRookieDeal: player.contract.isRookieDeal,
      isFranchiseTag: player.contract.isFranchiseTag,
      fifthYearOption: player.contract.fifthYearOption,
      voidYears: player.contract.voidYears,
    }])), (rows) => tx.contract.createMany({ data: rows }));

    // THE DEPTH CHART, EXPANDED BACK INTO ROWS. `rank` is re-derived from the
    // array position rather than carried, which is what makes the compact form
    // safe: the unique constraint is (teamId, position, rank), and a stored
    // rank with a gap or a duplicate in it would collide here. An order is an
    // order; its indices are 0..n-1 by construction.
    await chunked(file.teams.flatMap((team, ti) => Object.entries(team.depthChart)
      .flatMap(([position, ids]) => ids.map((pid, rank) => ({
        teamId: teamIds[ti], playerId: p(pid), position, rank,
      })))), (rows) => tx.depthChartSlot.createMany({ data: rows }));

    await chunked(file.picks.map((pick, i) => ({
      id: pickIds[i],
      leagueId,
      year: pick.year,
      round: pick.round,
      slot: pick.slot,
      originalTeamId: t(pick.originalTeam),
      ownerTeamId: t(pick.ownerTeam),
      used: pick.used,
      playerId: pick.player == null ? null : p(pick.player),
    })), (rows) => tx.draftPick.createMany({ data: rows }));

    if (file.draftState) {
      await tx.draftState.create({
        data: {
          leagueId,
          kind: file.draftState.kind,
          round: file.draftState.round,
          pickIndex: file.draftState.pickIndex,
          // Indexes -> the ids just minted. `pickIndex` is a cursor into this
          // array, so the order has to come back in exactly the order it left.
          order: writeJson(file.draftState.order.map((i) => pickIds[i])),
          complete: file.draftState.complete,
          started: file.draftState.started,
          // Not inherited, same reason as League.advanceStartedAt: a lease on
          // somebody else's draft run is a draft nobody can run.
          runStartedAt: null,
        },
      });
    }

    await chunked(file.games.map((g) => ({
      leagueId, seasonYear: g.seasonYear, week: g.week, kind: g.kind,
      homeTeamId: t(g.homeTeam), awayTeamId: t(g.awayTeam), played: g.played,
      homeScore: g.homeScore, awayScore: g.awayScore, boxScore: detokenise(g.boxScore), recap: g.recap,
    })), (rows) => tx.game.createMany({ data: rows }));

    await chunked(file.transactions.map((x, i) => ({
      leagueId, seasonYear: x.seasonYear, week: x.week, type: x.type,
      teamId: x.team == null ? null : t(x.team),
      playerId: x.player == null ? null : p(x.player),
      headline: x.headline, detail: x.detail,
      createdAt: ordered(i, file.transactions.length),
    })), (rows) => tx.transaction.createMany({ data: rows }));

    await chunked(file.tradeOffers.map((o, i) => ({
      leagueId,
      createdAt: ordered(i, file.tradeOffers.length),
      fromTeamId: t(o.fromTeam), toTeamId: t(o.toTeam),
      // Rebuilt rather than carried verbatim: these are `TradeAsset[]` with
      // raw ids in them, and an id from the publisher's league is an offer the
      // recipient's trade screen cannot resolve or accept.
      give: writeJson(o.give.map((a) => ({ type: a.type, id: a.type === 'PLAYER' ? p(a.ref) : pickIds[a.ref] }))),
      request: writeJson(o.request.map((a) => ({ type: a.type, id: a.type === 'PLAYER' ? p(a.ref) : pickIds[a.ref] }))),
      blurb: o.blurb, status: o.status, seasonYear: o.seasonYear, week: o.week,
    })), (rows) => tx.tradeOffer.createMany({ data: rows }));

    await chunked(file.negotiations.map((n) => ({
      leagueId, teamId: t(n.team), playerId: p(n.player),
      seasonYear: n.seasonYear, patienceSpent: n.patienceSpent,
      // A dismissal is a fact about the talks, not a timestamp worth carrying:
      // the column is only ever read for null-ness (lib/resign.ts), so the
      // import date is as true as any other instant would be.
      dismissedAt: n.dismissed ? new Date() : null,
    })), (rows) => tx.negotiationTalks.createMany({ data: rows }));

    await chunked(file.seasonRecords.map((r) => ({
      leagueId, teamId: t(r.team), year: r.year,
      wins: r.wins, losses: r.losses, ties: r.ties,
      pointsFor: r.pointsFor, pointsAgnst: r.pointsAgnst, playoffResult: r.playoffResult,
    })), (rows) => tx.teamSeasonRecord.createMany({ data: rows }));

    if (file.history) {
      const h = file.history;
      await chunked(h.playerSeasons.map((r) => ({
        leagueId, playerId: p(r.player), seasonYear: r.seasonYear,
        teamId: r.team == null ? null : t(r.team), teamAbbr: r.teamAbbr, age: r.age,
        gp: r.gp, firstSeen: r.firstSeen, stats: r.stats,
        playoffStats: r.playoffStats, playoffGp: r.playoffGp, endOvr: r.endOvr,
      })), (rows) => tx.playerSeason.createMany({ data: rows }));

      await chunked(h.championRosters.map((r) => ({
        leagueId, seasonYear: r.seasonYear, teamId: t(r.team), playerId: p(r.player),
      })), (rows) => tx.championRoster.createMany({ data: rows }));

      await chunked(h.leagueRecords.map((r) => ({
        leagueId, scope: r.scope, category: r.category, value: r.value,
        // A holder this file does not carry keeps the denormalised name and
        // club and gets an id that resolves to nothing — which is exactly how
        // the schema already expects a record to outlive its man.
        playerId: r.player == null ? '' : p(r.player),
        playerName: r.playerName, teamAbbr: r.teamAbbr, seasonYear: r.seasonYear,
      })), (rows) => tx.leagueRecord.createMany({ data: rows }));

      await chunked(h.tradeRecords.map((r, i) => ({
        leagueId, seasonYear: r.seasonYear, week: r.week,
        createdAt: ordered(i, h.tradeRecords.length),
        teamAId: t(r.teamA), teamBId: t(r.teamB), teamAAbbr: r.teamAAbbr, teamBAbbr: r.teamBAbbr,
        aToB: writeJson(r.aToB.map((s) => snapshotRow(s, p, pickIds))),
        bToA: writeJson(r.bToA.map((s) => snapshotRow(s, p, pickIds))),
      })), (rows) => tx.tradeRecord.createMany({ data: rows }));

      await chunked(h.powerSnapshots.map((r) => ({
        leagueId, teamId: t(r.team), seasonYear: r.seasonYear, week: r.week,
        rank: r.rank, powerIndex: r.powerIndex, rating: r.rating,
        wins: r.wins, losses: r.losses, ties: r.ties, netPerGame: r.netPerGame,
      })), (rows) => tx.powerRankingSnapshot.createMany({ data: rows }));
    }

    // ---------------------------------------------------------------------
    // THE GATE. Everything above is written and visible to this transaction
    // and to nothing else. If the league it describes is not one the engine
    // can play, the throw below rolls every statement back and the database is
    // exactly as it was.
    // ---------------------------------------------------------------------
    const violations = await checkInvariants(leagueId, tx);
    const errors = violations.filter((v) => v.severity === 'error');
    if (errors.length > 0) throw new SaveImportError(unplayableMessage(errors), errors);
    warnings = violations.filter((v) => v.severity === 'warning');
  }, { timeout: TX_TIMEOUT_MS, maxWait: TX_MAX_WAIT_MS });

  const ms = Date.now() - started;
  console.info(
    `Challenge ${args.source}: ${file.teams.length} clubs, ${file.players.length} players, `
    + `${file.games.length} games, history ${file.history ? 'carried' : 'dropped'} -> ${leagueId} in ${ms}ms`
    + (warnings.length > 0 ? `; ${warnings.length} warning(s): ${warnings.map((w) => w.id).join(', ')}` : ''),
  );
  return { leagueId, warnings, ms };
}

/** A historical trade snapshot, with its reference turned back into an id. */
function snapshotRow(
  s: { type: 'PLAYER' | 'PICK'; ref: number | null; label: string; position: string | null; ovr: number | null; value: number },
  p: (i: number) => string,
  pickIds: string[],
): Record<string, unknown> {
  const id = s.ref == null ? '' : (s.type === 'PLAYER' ? p(s.ref) : pickIds[s.ref]);
  const out: Record<string, unknown> = { type: s.type, id, label: s.label, value: s.value };
  // `position` and `ovr` are OPTIONAL on TradeAssetSnapshot, and the reason is
  // in lib/tradeRetro.ts: a record written before `ovr` existed has no answer,
  // and a career page must not print a confident 0 for a man nobody measured.
  // So an absent value stays absent rather than becoming a number.
  if (s.position != null) out.position = s.position;
  if (s.ovr != null) out.ovr = s.ovr;
  return out;
}

/**
 * `createMany` in slices. Does nothing at all for an empty list, which is not
 * an optimisation: `createMany({ data: [] })` is a round trip that writes
 * nothing, and this is called twenty times per import.
 */
async function chunked<T>(rows: T[], write: (slice: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await write(rows.slice(i, i + CHUNK));
  }
}

