/**
 * ===========================================================================
 * A CHALLENGE FILE — the whole situation, not a starting point
 * ===========================================================================
 *
 * WHY THIS IS NOT lib/leagueFile.ts WITH A FLAG.
 *
 * A LEAGUE FILE is a starting-state document: thirty-two franchises, their
 * rosters, a free-agent pool and maybe a college class. It is shallow by
 * construction and it is AUTHORED — somebody types it, or builds it in a
 * spreadsheet, so every field in it is optional, every omission is filled in
 * by the generator, and the reader's job is to be forgiving. It carries no
 * season year, no phase, no standings, no draft picks, no cap ledger and no
 * history, because none of those things exist yet.
 *
 * A CHALLENGE FILE is a save. It is MACHINE-WRITTEN, it is deep, and every
 * field in it is load-bearing: a week number that is wrong puts the league in
 * a state the engine cannot advance out of, a cap charge that is missing is
 * money that vanishes, a draft pick that points at nothing is a round that
 * never finishes. The reader's job here is the opposite of forgiving.
 *
 * Those two readers want opposite defaults, so they are two readers. One file
 * type with a `mode` flag would mean every field in the union is conditionally
 * required, which is the shape every validator gets wrong, and it would mean
 * one byte ceiling and one per-account cap across two things that differ by a
 * factor of twenty in size. So: a separate `kind`, a separate version line, a
 * separate set of bounds, a separate validator. Nothing in this module imports
 * the league-file reader and nothing in that one imports this.
 *
 * WHAT A CHALLENGE IS, IN THE GAME'S OWN TERMS. Not "here is my half-played
 * dynasty". A situation: you are 2-9, you have no cap room, you traded the
 * first-rounder, fix it. Two GMs can take the same job and compare what they
 * did with it. That is why the publisher's own career does NOT travel with the
 * file (see THE SCRUB below) — the recipient is the new hire, not the tourist.
 *
 * ===========================================================================
 * THE FOUR GROUPS, AND WHICH SIDE OF THE LINE EACH MODEL IS ON
 * ===========================================================================
 *
 * ACCOUNT — never written, never read, not representable in this format.
 *   User, Session, AuthAttempt, PublishedLeague. There is no field for any of
 *   them and no code path that could put one here.
 *
 * THE SITUATION — always carried. League, Team, Player, Contract, CapCharge,
 *   DraftPick, DraftState, Staff, Scout, TeamSeasonRecord, Game, Transaction,
 *   TradeOffer, NegotiationTalks. This is the thing being shared.
 *
 * HISTORY — `history` is null or present, one toggle. PlayerSeason,
 *   ChampionRoster, LeagueRecord, TradeRecord, PowerRankingSnapshot. All five
 *   are retrospective: nothing in the engine's forward step reads them, so a
 *   save without them advances identically and simply has nothing to show on
 *   the record books, the career-stat tables and the power-ranking chart.
 *   PlayerSeason is also the single largest table in a save (6.9MB of 24MB
 *   measured), so this toggle is most of the size difference too.
 *
 * THE PUBLISHER'S OWN KNOWLEDGE — dropped. ScoutingReport and ShortlistEntry
 *   are one front office's fog of war: what THEY have paid to find out about
 *   which prospects, and which ones they are watching. Handing that over would
 *   be handing over the answers, and the recipient's scouting department is
 *   their own. DepthChartSlot is COMPACTED rather than dropped — see below.
 *
 * IDENTITY — scrubbed. DynastyProfile (the perk tree and the per-year ability
 *   ledgers) and DynastyRank (the rank board) are simply absent from the
 *   format. `Team.gmProfile` is carried for the thirty-one AI clubs and reset
 *   for the one the recipient is taking; see THE SCRUB.
 *
 * ===========================================================================
 * THE DEPTH CHART IS A DECISION, NOT DERIVED DATA
 * ===========================================================================
 * `DepthChartSlot` is one row per player per position bucket — 5.0MB of a
 * 24MB save, second only to PlayerSeason. It is also the single most
 * deliberate thing in a save: who starts is the GM's call, and a save that
 * imported with a regenerated depth chart would have quietly undone every
 * lineup decision the publisher made, which is most of what a football GM
 * actually does.
 *
 * So it travels, as `position -> ordered player indexes` — exactly the shape
 * `SimTeamInput.depthOrder` already consumes (lib/sim/engine.ts, lib/lineup.ts)
 * and exactly the shape lib/season.ts already builds from those rows before
 * every game. One array per bucket instead of a row per slot, which is the
 * same information in about one per cent of the bytes, and the importer
 * expands it back into rows because the rest of the app reads rows.
 *
 * ===========================================================================
 * REFERENCES ARE INDEXES, NOT IDS
 * ===========================================================================
 * Every id in this schema is a cuid, and a cuid is 25 characters. A save names
 * players about 80,000 times (every depth slot, every pick, every transaction,
 * every player-season row), so carrying cuids would cost roughly 2MB in
 * pointers alone — and every one of them would be a foreign key into a league
 * that no longer exists once the file is imported, so the importer has to
 * remap all of them anyway.
 *
 * Instead: `teams` and `players` are arrays, and everything else refers to a
 * team or a player by its INDEX into those arrays. That is smaller, it makes
 * the referential check a range test rather than a hash lookup, and it makes
 * the file independent of the database it came out of. `null` is a real value
 * for a nullable reference (a free agent's team, a transaction with no player).
 *
 * ===========================================================================
 * VERSIONS, AND HOW THE NEXT ONE IS ADDED
 * ===========================================================================
 * League files got away with a flat `SUPPORTED_VERSIONS = [1, 2]` because
 * every v2 addition was OPTIONAL — a v1 file is a legal v2 file with fields
 * missing, and the reader's defaults cover it. That will not hold here: these
 * fields are required, so a v1 save read by a v5 build is not "a v5 save with
 * gaps", it is a different document.
 *
 * So this module reads ONE version — `SAVE_FORMAT_VERSION` — and gets there
 * through a migration chain:
 *
 *   1. The envelope (`kind`, `formatVersion`) is read first and nothing else
 *      is trusted until it is.
 *   2. `migrateSaveDocument` walks `SAVE_MIGRATIONS` from the file's version
 *      up to the current one, applying each step in order. A missing link is a
 *      refusal that names the gap rather than a silent partial upgrade.
 *   3. Only then is the document validated, once, against the current shape.
 *
 * TO ADD VERSION N+1, three edits and no new concepts:
 *   a. Bump `SAVE_FORMAT_VERSION` to N+1 and change the writer to emit it.
 *   b. Push `{ from: N, to: N + 1, note: '...', up(doc) { ... } }` onto
 *      `SAVE_MIGRATIONS`. `up` takes the raw N-shaped document and returns an
 *      (N+1)-shaped one: it may add a field with a default, rename one, or
 *      recompute one, and it must not throw for any document the version-N
 *      validator would have accepted.
 *   c. Extend the validator for the new shape.
 * Nothing else. The chain is checked for contiguity at module load, so a step
 * pushed with the wrong `from` fails on the first import rather than on the
 * first old file.
 *
 * ===========================================================================
 * THE SCRUB — what the recipient does NOT inherit, and where it is enforced
 * ===========================================================================
 * Half of this is "the field is not in the format", which is the only kind of
 * guarantee that cannot drift: there is no `dynastyProfile`, no `dynastyRank`,
 * no `scoutingReports`, no `shortlist` anywhere below, so no exporter can
 * start writing one by accident and no importer can read one.
 *
 * The other half is the ONE field that makes a career in this codebase, and it
 * is not a table. Every career figure the game shows a GM — tenure, record,
 * championships, badges, dynasty XP, skill points, rank-board standing — is
 * DERIVED on read from `TeamSeasonRecord` and `Transaction` rows bounded below
 * by the GM's hire year (lib/gmCareer.ts, lib/dynasty.ts, lib/leaderboard.ts,
 * lib/rebuildState.ts, lib/weekReport.ts). Those rows are the situation and
 * must travel. So the scrub is the BOUND, not the rows: a challenge records
 * `league.startYear` (which the salary cap's own ceiling is measured from and
 * which therefore must not move) and the importer stamps
 * `League.gmHiredYear` at the season the recipient arrives. Everything career
 * reads the new bound through `resolveTenureStartYear` and finds nothing
 * before it. The club's history is intact; nobody else's résumé is attached
 * to it.
 * ===========================================================================
 */
import { LEAGUE } from './tuning';
import { PHASE_LABELS } from './season';

/** What a challenge file is. Not `dynastygm.league`, and never both. */
export const SAVE_FILE_KIND = 'dynastygm.save';

/** The one version this build writes and, after migration, the one it reads. */
export const SAVE_FORMAT_VERSION = 1;

/**
 * The oldest version the chain below can still climb out of. Stated separately
 * from the chain so a refusal can say "this build dropped v1" in one sentence
 * rather than inferring it from a missing step.
 */
export const MIN_READABLE_SAVE_VERSION = 1;

/**
 * ===========================================================================
 * BOUNDS — a save's own, measured against a save
 * ===========================================================================
 * These are NOT FILE_LIMITS. A league file is 0.6-1.1MB against an 8MB
 * ceiling; a three-season save measures 24MB in Postgres, of which this format
 * carries about two thirds (PlayerSeason and Game box scores are most of it,
 * ScoutingReport is dropped and DepthChartSlot is compacted to roughly one per
 * cent of its row count).
 *
 * MAX_BYTES is the UNCOMPRESSED JSON ceiling and it is the number every screen
 * and every cap quotes, so it is stated once here. Compression is not optional
 * on this path — the stored form is gzipped, as lib/publication.ts already
 * does for league files — but the ceiling is in uncompressed bytes for the
 * reason lib/publication.ts gives about its own byte cap: it is the same unit
 * the reader enforces and it cannot be gamed by a payload that happens to
 * compress well.
 *
 * The counts matter more than the bytes. What an accepted file costs is the
 * ROWS it causes to be written, and each of these bounds the one table that
 * could otherwise be asked for millions of them.
 */
export const SAVE_LIMITS = {
  /**
   * 48MB. A measured three-season save serialises to about 14MB, so this is
   * roughly three times the largest thing this build writes — the same shape
   * of headroom FILE_LIMITS.MAX_BYTES keeps — and it leaves room for the
   * ten-season dynasty somebody will eventually publish. Past this the honest
   * answer is that a challenge is not the right vehicle.
   */
  MAX_BYTES: 48 * 1024 * 1024,

  /** A schedule only exists for this shape — see `readLeague`. */
  TEAM_COUNT: LEAGUE.TEAM_COUNT,

  /**
   * Every player row the league holds: rosters, free agents, the draft pool
   * and everyone who has retired and is still on the books as a record
   * holder. 32 x 53 is 1,696 rostered; a measured three-season save carries
   * about 2,900 all in, and retirements accumulate with every season played.
   */
  MAX_PLAYERS: 12_000,
  MAX_PLAYERS_PER_TEAM: LEAGUE.ROSTER_MAX,

  /** 7 rounds x 32 clubs x the three future years the game seeds, with slack. */
  MAX_PICKS: 2_000,
  /** 272 regular-season games plus playoffs, per season. */
  MAX_GAMES: 6_000,
  MAX_TRANSACTIONS: 60_000,
  MAX_TRADE_OFFERS: 500,
  MAX_NEGOTIATIONS: 2_000,
  /** 32 clubs x every season on the books, invented backstory included. */
  MAX_SEASON_RECORDS: 2_000,
  MAX_STAFF_PER_TEAM: 12,
  MAX_SCOUTS_PER_TEAM: 12,
  /** Dead money is booked years ahead; a club accrues a handful a season. */
  MAX_CAP_CHARGES_PER_TEAM: 400,
  /** Depth buckets a club can have, and how deep one can be. */
  MAX_DEPTH_BUCKETS: 64,
  MAX_DEPTH_PER_BUCKET: LEAGUE.ROSTER_MAX,

  /** History, when it is carried. One row per player per season per club. */
  MAX_PLAYER_SEASONS: 120_000,
  MAX_CHAMPION_ROSTERS: 6_000,
  MAX_LEAGUE_RECORDS: 400,
  MAX_TRADE_RECORDS: 6_000,
  MAX_POWER_SNAPSHOTS: 40_000,

  /**
   * The JSON blobs the schema stores as strings. Each is carried VERBATIM —
   * re-encoding a box score or an attribute map would be a second opinion
   * about what the game wrote — so each needs a length ceiling of its own.
   */
  MAX_BLOB: 64 * 1024,
  /** A box score is the biggest string this schema holds. */
  MAX_BOX_SCORE: 512 * 1024,

  MAX_LEAGUE_NAME: 60,
  MAX_PERSON_NAME: 32,
  MAX_CITY: 24,
  MAX_NICKNAME: 24,
  MAX_COLLEGE: 32,
  MAX_LABEL: 120,
  MAX_HEADLINE: 240,
  MAX_DETAIL: 2_000,
  MAX_BLURB: 1_000,
  MAX_RECAP: 8_000,
  MAX_NOTE: 500,
  ABBR_MIN: 2,
  ABBR_MAX: 4,

  /** The framing a publisher writes on the card. */
  MAX_CHALLENGE_TITLE: 70,
  MAX_CHALLENGE_BRIEF: 500,

  /** Years. A label on a season, not a game year — wide on purpose. */
  YEAR_MIN: 1900,
  YEAR_MAX: 2200,
  AGE_MIN: 18,
  AGE_MAX: 60,
  RATING_MIN: 0,
  RATING_MAX: 99,
  /** Well above any deal the game writes, well below what breaks an Int. */
  MONEY_MAX: 2_000_000_000,
  MONEY_MIN: -2_000_000_000,
  CONTRACT_YEARS_MAX: 12,
  WEEK_MAX: 40,
} as const;

/**
 * ===========================================================================
 * THE ONE BLOB THAT HAS IDS INSIDE IT
 * ===========================================================================
 * Every stored JSON column in this schema was checked against a real
 * three-season save, and exactly one of them embeds row ids: `Game.boxScore`.
 * It carries `homeTeam.id`, `awayTeam.id` and a `playerId` on every line of
 * every statistical table. Nothing else does — not `trueAttrs`, not
 * `seasonStats`, not `careerStats`, not `PlayerSeason.stats`, not `settings`,
 * not `gmProfile`, not `baseSalaries`, not a recap.
 *
 * That matters more than it looks, because lib/playerSeasons.ts
 * (`reconstructPlayerSeasons`) finds a player's in-progress season by a LIKE
 * on the box score text for his id. A box score carried verbatim would still
 * name the PUBLISHER'S player ids, so after import every box score in the save
 * would belong to men who do not exist: the player page's current-season table
 * would silently come back empty, and that is the exact shape of bug this
 * codebase keeps paying for — a screen deriving a figure from a second source
 * that nobody noticed had gone stale.
 *
 * So box scores travel with their ids replaced by INDEX TOKENS, in the same
 * index space as every other reference in the format, and the importer turns
 * them back into the ids it has just minted. The token form is deliberately
 * not id-shaped — a run of `~T7~` cannot be mistaken for a cuid by the
 * fixed-length-id assumption above or by anything else.
 *
 * Replacement is EXACT-MATCH, not pattern-match: only an id that is actually
 * in the export's own map is rewritten, so a 25-character token that merely
 * looks like a cuid is left exactly as it was found.
 * ===========================================================================
 */
/** A stored cuid, as every id column in this schema holds one: `c` + 24. */
export const STORED_ID_PATTERN = /c[a-z0-9]{24}/g;
/** A club, inside a carried box score. */
export const teamToken = (i: number): string => `~T${i}~`;
/** A player, inside a carried box score. */
export const playerToken = (i: number): string => `~P${i}~`;
/** Matches either, for the import-side rewrite. */
export const BOX_TOKEN_PATTERN = /~([TP])(\d{1,7})~/g;

/** The phases a league may be in. Read from the engine, never retyped. */
const VALID_PHASES: readonly string[] = Object.keys(PHASE_LABELS);
const PLAYER_STATUSES = ['ACTIVE', 'INJURED', 'FREE_AGENT', 'RETIRED', 'ROOKIE_POOL'] as const;
const DEV_TRAITS = ['Slow', 'Normal', 'Star', 'Superstar'] as const;
const OFFER_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED'] as const;
const DRAFT_KINDS = ['ROOKIE', 'FANTASY'] as const;
const RECORD_SCOPES = ['SEASON', 'CAREER'] as const;
const PLAYOFF_RESULTS = ['MISSED', 'WILDCARD', 'DIVISIONAL', 'CONFERENCE', 'RUNNER_UP', 'CHAMPION'] as const;

// ---------------------------------------------------------------------------
// THE DOCUMENT
// ---------------------------------------------------------------------------

/** A player index into `SaveFile.players`, or null where the column is nullable. */
export type PlayerRef = number;
/** A team index into `SaveFile.teams`. */
export type TeamRef = number;

export interface SaveContract {
  years: number;
  yearsRemaining: number;
  signedYear: number;
  /** Verbatim JSON string, exactly as `Contract.baseSalaries` holds it. */
  baseSalaries: string;
  signingBonus: number;
  guaranteed: number;
  isRookieDeal: boolean;
  isFranchiseTag: boolean;
  fifthYearOption: string | null;
  voidYears: number;
  /**
   * `Contract.teamId` is a plain column with no foreign key, and INV-04
   * compares it with the player's roster team. Carried as its own reference so
   * a mismatch the publisher's save already had is reproduced faithfully and
   * caught by the invariant gate rather than papered over here.
   */
  team: TeamRef | null;
}

export interface SavePlayer {
  team: TeamRef | null;
  firstName: string;
  lastName: string;
  position: string;
  age: number;
  experience: number;
  heightIn: number;
  weightLb: number;
  college: string;
  trueAttrs: string;
  trueOvr: number;
  potential: number;
  devTrait: string;
  lastSeasonOvr: number | null;
  status: string;
  isDraftee: boolean;
  draftYear: number | null;
  draftRound: number | null;
  draftPickNo: number | null;
  collegeStats: string;
  combineTesting: string;
  devFocus: number;
  yearsUnsigned: number;
  weeksUnsigned: number;
  injuryWeeks: number;
  injuryType: string | null;
  fatigue: number;
  morale: number;
  seasonStats: string;
  careerStats: string;
  playoffStats: string;
  careerPlayoffStats: string;
  contract: SaveContract | null;
}

export interface SaveStaff {
  role: string;
  name: string;
  rating: number;
  playCalling: number;
  development: number;
  contractYears: number;
  salary: number;
}

export interface SaveScout {
  name: string;
  accuracy: number;
  speed: number;
  specialty: string;
  salary: number;
}

export interface SaveCapCharge {
  year: number;
  amount: number;
  label: string;
}

export interface SaveTeam {
  city: string;
  nickname: string;
  abbr: string;
  conference: string;
  division: string;
  isUser: boolean;
  prestige: number;
  /**
   * The AI front office's personality. Carried for the clubs the recipient
   * will be negotiating against, and replaced for the club they are taking —
   * see THE SCRUB in the header, and `importSaveFile`.
   */
  gmProfile: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgnst: number;
  divWins: number;
  divLosses: number;
  confWins: number;
  confLosses: number;
  playoffSeed: number | null;
  eliminated: boolean;
  scoutPoints: number;
  scoutPeriod: number;
  scoutPeriodGrant: number;
  scoutSpentSeason: number;
  staff: SaveStaff[];
  scouts: SaveScout[];
  capCharges: SaveCapCharge[];
  /** Depth bucket -> ordered player indexes. See the header. */
  depthChart: Record<string, PlayerRef[]>;
}

export interface SavePick {
  year: number;
  round: number;
  slot: number;
  originalTeam: TeamRef;
  ownerTeam: TeamRef;
  used: boolean;
  player: PlayerRef | null;
}

export interface SaveDraftState {
  kind: string;
  round: number;
  pickIndex: number;
  /**
   * The full pick order, as INDEXES into `SaveFile.picks`.
   *
   * `DraftState.order` is a JSON array of DraftPick CUIDS, and it is the one
   * stored blob that cannot travel verbatim: every id in it belongs to a
   * league that will not exist after import, and `pickIndex` is a cursor into
   * this array, so a stale order is a draft that picks for nobody and never
   * finishes (INV-18). Carried as indexes and rebuilt into ids by the
   * importer.
   */
  order: number[];
  complete: boolean;
  started: boolean;
}

/**
 * A player or a pick, named by its index. The remapped form of `TradeAsset`
 * (lib/trade.ts), which stores a raw cuid for the same reason `DraftState
 * .order` does and with the same consequence: a pending offer whose assets
 * point into the publisher's league is an offer the recipient cannot accept.
 */
export interface SaveAssetRef {
  type: 'PLAYER' | 'PICK';
  ref: number;
}

export interface SaveGame {
  seasonYear: number;
  week: number;
  kind: string;
  homeTeam: TeamRef;
  awayTeam: TeamRef;
  played: boolean;
  homeScore: number;
  awayScore: number;
  boxScore: string;
  recap: string;
}

export interface SaveTransaction {
  seasonYear: number;
  week: number;
  type: string;
  team: TeamRef | null;
  player: PlayerRef | null;
  headline: string;
  detail: string;
}

export interface SaveTradeOffer {
  fromTeam: TeamRef;
  toTeam: TeamRef;
  give: SaveAssetRef[];
  request: SaveAssetRef[];
  blurb: string;
  status: string;
  seasonYear: number;
  week: number;
}

export interface SaveNegotiation {
  team: TeamRef;
  player: PlayerRef;
  seasonYear: number;
  patienceSpent: number;
  dismissed: boolean;
}

export interface SaveSeasonRecord {
  team: TeamRef;
  year: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgnst: number;
  playoffResult: string;
}

export interface SavePlayerSeason {
  player: PlayerRef;
  seasonYear: number;
  team: TeamRef | null;
  teamAbbr: string;
  age: number | null;
  gp: number;
  firstSeen: number;
  stats: string;
  playoffStats: string;
  playoffGp: number;
  endOvr: number | null;
}

export interface SaveChampionRoster {
  seasonYear: number;
  team: TeamRef;
  player: PlayerRef;
}

export interface SaveLeagueRecord {
  scope: string;
  category: string;
  value: number;
  /**
   * Null when the record holder is not a player this file carries. The column
   * is a plain String with no foreign key and the row denormalises the name
   * and club for exactly that reason, so the record survives either way.
   */
  player: PlayerRef | null;
  playerName: string;
  teamAbbr: string;
  seasonYear: number;
}

/**
 * One side of a historical trade. The remapped form of `TradeAssetSnapshot`
 * (lib/tradeRetro.ts): the denormalised label, position, rating and value are
 * carried verbatim because the record exists to say what the clubs thought
 * they were trading, and the id becomes a nullable index because the asset may
 * no longer be anything this file carries. lib/tradeRetro.ts already looks
 * these up with a nullable `findUnique` and renders the label when nothing
 * comes back, so a null ref degrades to exactly the display an old record
 * written before the field existed gets.
 */
export interface SaveTradeSnapshot {
  type: 'PLAYER' | 'PICK';
  ref: number | null;
  label: string;
  position: string | null;
  ovr: number | null;
  value: number;
}

export interface SaveTradeRecord {
  seasonYear: number;
  week: number;
  teamA: TeamRef;
  teamB: TeamRef;
  teamAAbbr: string;
  teamBAbbr: string;
  aToB: SaveTradeSnapshot[];
  bToA: SaveTradeSnapshot[];
}

export interface SavePowerSnapshot {
  team: TeamRef;
  seasonYear: number;
  week: number;
  rank: number;
  powerIndex: number;
  rating: number;
  wins: number;
  losses: number;
  ties: number;
  netPerGame: number;
}

/** The retrospective tables. Null when the publisher left history behind. */
export interface SaveHistory {
  playerSeasons: SavePlayerSeason[];
  championRosters: SaveChampionRoster[];
  leagueRecords: SaveLeagueRecord[];
  tradeRecords: SaveTradeRecord[];
  powerSnapshots: SavePowerSnapshot[];
}

export interface SaveLeagueState {
  name: string;
  seasonYear: number;
  /**
   * The founding season. CARRIED, deliberately: `capForYear` grows the ceiling
   * from it (lib/leagueYear.ts), so moving it would move every club's cap
   * space and the situation would not be the situation. The GM's hire year is
   * a separate stamp the importer writes — see THE SCRUB.
   */
  startYear: number;
  week: number;
  phase: string;
  contractsAgedYear: number | null;
  resignWarnedYear: number | null;
  /** Verbatim JSON settings string, as `League.settings` holds it. */
  settings: string;
  /** Which club the challenge hands over. An index, so it cannot be ambiguous. */
  userTeam: TeamRef | null;
}

/** What the publisher writes on the card. The framing, in their own words. */
export interface SaveChallenge {
  title: string;
  brief: string;
}

export interface SaveFile {
  kind: typeof SAVE_FILE_KIND;
  formatVersion: number;
  /** ISO 8601. Informational; nothing branches on it. */
  exportedAt: string;
  challenge: SaveChallenge;
  league: SaveLeagueState;
  teams: SaveTeam[];
  players: SavePlayer[];
  picks: SavePick[];
  draftState: SaveDraftState | null;
  games: SaveGame[];
  transactions: SaveTransaction[];
  tradeOffers: SaveTradeOffer[];
  negotiations: SaveNegotiation[];
  seasonRecords: SaveSeasonRecord[];
  history: SaveHistory | null;
}

// ---------------------------------------------------------------------------
// REFUSALS
// ---------------------------------------------------------------------------

/**
 * A refusal a person can act on, distinct from a database fault for the reason
 * lib/actionError.ts gives: these sentences are written to be read, and a
 * Prisma message is not.
 *
 * The `path` is the JSON pointer of the offending field, because the only
 * person who can fix a bad challenge file is whoever exported it and "teams[7]
 * .capCharges[2].amount" is the entire bug report.
 */
export class SaveFileError extends Error {
  readonly path: string;

  constructor(message: string, path = '') {
    super(path ? `${path}: ${message}` : message);
    this.name = 'SaveFileError';
    this.path = path;
  }
}

const fail = (path: string, msg: string): never => {
  throw new SaveFileError(msg, path);
};

const describe = (v: unknown): string => {
  if (v === undefined) return 'nothing';
  if (v === null) return 'null';
  if (typeof v === 'string') return `a string${v.length > 40 ? ` of ${v.length} characters` : ` "${v}"`}`;
  if (Array.isArray(v)) return `an array of ${v.length}`;
  return `${typeof v} ${String(v).slice(0, 40)}`;
};

// ---------------------------------------------------------------------------
// READERS — strict, because every field here is load-bearing
// ---------------------------------------------------------------------------
//
// Unlike the league-file reader these do NOT default. A missing week is not
// "week 1", it is a file that cannot be trusted about anything else either.
// The one exception is an explicitly nullable column, which has its own reader.

function obj(v: unknown, path: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    fail(path, `expected an object, found ${describe(v)}.`);
  }
  return v as Record<string, unknown>;
}

function arr(v: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(v)) fail(path, `expected an array, found ${describe(v)}.`);
  const a = v as unknown[];
  if (a.length > max) fail(path, `holds ${a.length} entries; this build reads at most ${max}.`);
  return a;
}

function str(v: unknown, path: string, max: number): string {
  if (typeof v !== 'string') fail(path, `expected a string, found ${describe(v)}.`);
  const s = v as string;
  if (s.length > max) fail(path, `is ${s.length} characters; the maximum is ${max}.`);
  return s;
}

function nullableStr(v: unknown, path: string, max: number): string | null {
  return v == null ? null : str(v, path, max);
}

function int(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    fail(path, `expected a finite number, found ${describe(v)}.`);
  }
  const n = v as number;
  if (!Number.isInteger(n)) fail(path, `is ${n}; a whole number is required.`);
  if (n < min || n > max) fail(path, `is ${n}, outside the legal range ${min}..${max}.`);
  return n;
}

function nullableInt(v: unknown, path: string, min: number, max: number): number | null {
  return v == null ? null : int(v, path, min, max);
}

function num(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    fail(path, `expected a finite number, found ${describe(v)}.`);
  }
  const n = v as number;
  if (n < min || n > max) fail(path, `is ${n}, outside the legal range ${min}..${max}.`);
  return n;
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') fail(path, `expected true or false, found ${describe(v)}.`);
  return v as boolean;
}

function oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    fail(path, `is ${describe(v)}; expected one of ${allowed.join(', ')}.`);
  }
  return v as T;
}

/**
 * A JSON blob carried verbatim. Checked for LENGTH and for PARSEABILITY, and
 * then kept as the original string.
 *
 * It is not re-encoded, and that is the point: these columns are what the
 * engine wrote and what the engine will read, and a round trip through
 * JSON.parse/stringify is a second opinion about key order and number
 * formatting that nothing asked for. It IS parsed, though, because a column
 * the game will later `readJson` on is a column that must parse — INV-15 makes
 * exactly this check on box scores, and a file that smuggles in an unparseable
 * one would be well-formed by every other test here and broken in play.
 */
function blob(v: unknown, path: string, max: number): string {
  const s = str(v, path, max);
  if (s.length === 0) fail(path, 'is empty; a stored JSON blob is at least "{}".');
  try {
    JSON.parse(s);
  } catch {
    fail(path, `is not parseable JSON (${s.length} characters).`);
  }
  return s;
}

/** An index into an array of `count`. The whole referential check, in one line. */
function ref(v: unknown, path: string, count: number): number {
  const n = int(v, path, 0, Math.max(0, count - 1));
  return n;
}

function nullableRef(v: unknown, path: string, count: number): number | null {
  return v == null ? null : ref(v, path, count);
}

// ---------------------------------------------------------------------------
// THE MIGRATION CHAIN
// ---------------------------------------------------------------------------

/**
 * One step up the version ladder. `up` takes the document as the `from`
 * version's writer produced it and returns it in the `to` version's shape.
 *
 * It operates on the RAW document, before validation, because that is the only
 * point at which an old shape still exists — once the validator has run, the
 * document is current-shaped by definition. A step may therefore assume only
 * what the `from` version's validator guaranteed, and must not throw for any
 * document that version would have accepted; anything it cannot repair is left
 * for the current validator to refuse with a proper path.
 */
export interface SaveMigration {
  from: number;
  to: number;
  /** One line, shown in the log when a file is upgraded. */
  note: string;
  up(doc: Record<string, unknown>): Record<string, unknown>;
}

/**
 * THE CHAIN. Empty today because there is exactly one version, and that is
 * precisely why it exists now: the shape of the upgrade path is the expensive
 * thing to retrofit, not the first step itself. See TO ADD VERSION N+1 in the
 * header.
 *
 * Steps are listed in ascending order and must be contiguous —
 * `assertMigrationChain` below proves both at module load.
 */
export const SAVE_MIGRATIONS: SaveMigration[] = [];

/**
 * Proves the chain climbs from `MIN_READABLE_SAVE_VERSION` to
 * `SAVE_FORMAT_VERSION` in single steps with no gap and no overlap.
 *
 * Run at module load, so a step added with the wrong `from` fails on the next
 * request rather than on the first old file somebody uploads a year later —
 * which is the failure this whole design exists to avoid.
 */
export function assertMigrationChain(
  chain: readonly SaveMigration[] = SAVE_MIGRATIONS,
  min = MIN_READABLE_SAVE_VERSION,
  current = SAVE_FORMAT_VERSION,
): void {
  let at = min;
  for (const step of chain) {
    if (step.from !== at) {
      throw new Error(`Save migration chain is broken: expected a step from ${at}, found ${step.from} -> ${step.to}.`);
    }
    if (step.to !== step.from + 1) {
      throw new Error(`Save migration ${step.from} -> ${step.to} is not a single step.`);
    }
    at = step.to;
  }
  if (at !== current) {
    throw new Error(
      `Save migration chain ends at version ${at} but this build writes ${current}. `
      + `Add the missing step(s) to SAVE_MIGRATIONS.`,
    );
  }
}

assertMigrationChain();

/**
 * Walks a raw document from `version` to the current one.
 *
 * Exported with the chain as a parameter so the mechanism can be exercised
 * against a chain with real links in it while the shipped chain still has
 * none. A verification probe that could only test the empty chain would be
 * testing nothing — the same objection this codebase makes to a gate nobody
 * has proven can fail.
 */
export function applyMigrationChain(
  doc: Record<string, unknown>,
  version: number,
  chain: readonly SaveMigration[] = SAVE_MIGRATIONS,
  current = SAVE_FORMAT_VERSION,
): { doc: Record<string, unknown>; applied: string[] } {
  let at = version;
  let out = doc;
  const applied: string[] = [];
  // Bounded by the chain's own length: a malformed chain cannot spin here.
  for (let guard = 0; at < current && guard <= chain.length; guard += 1) {
    const step = chain.find((s) => s.from === at);
    if (!step) {
      throw new SaveFileError(
        `This challenge was written in format version ${version} and this build reads version ${current}, `
        + `but there is no upgrade step from version ${at}. Ask whoever published it to publish it again.`,
      );
    }
    out = step.up(out);
    applied.push(`${step.from}->${step.to} (${step.note})`);
    at = step.to;
  }
  if (at !== current) {
    throw new SaveFileError(
      `This challenge could not be brought up from format version ${version} to ${current}.`,
    );
  }
  return { doc: out, applied };
}

// ---------------------------------------------------------------------------
// THE READER
// ---------------------------------------------------------------------------

/**
 * Text -> a validated, current-version challenge.
 *
 * ORDER MATTERS AND IS NOT NEGOTIABLE:
 *   1. BYTES, before the parse. A 400MB string must be refused by its length,
 *      not by what `JSON.parse` does to the heap first.
 *   2. The ENVELOPE — `kind` and `formatVersion` — before anything else is
 *      read, so a league file, a screenshot or a half-downloaded save is
 *      refused as the wrong document rather than as a missing field.
 *   3. MIGRATION, which is the only point where an old shape still exists.
 *   4. VALIDATION, once, against the current shape.
 *
 * It is PURE. Nothing here touches the database, nothing here writes, and the
 * returned object is a new document rather than the parsed input, so no
 * unvalidated field can ride along into the importer.
 */
export function parseSaveFile(text: string): SaveFile {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > SAVE_LIMITS.MAX_BYTES) {
    fail('', `this file is ${(bytes / 1_048_576).toFixed(1)}MB, over the `
      + `${SAVE_LIMITS.MAX_BYTES / 1_048_576}MB a challenge may be.`);
  }
  if (bytes === 0) fail('', 'this file is empty.');

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    fail('', `this file is not JSON (${err instanceof Error ? err.message : 'unreadable'}).`);
  }
  const root = obj(raw, '');

  // --- the envelope ---
  if (root.kind !== SAVE_FILE_KIND) {
    fail('kind', `must be "${SAVE_FILE_KIND}" (found ${describe(root.kind)}). `
      + (root.kind === 'dynastygm.league'
        ? 'That is a league file — a starting point rather than a situation. Import it from the league import screen.'
        : 'This does not look like a challenge file.'));
  }
  const version = root.formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    fail('formatVersion', `must be a whole version number (found ${describe(version)}).`);
  }
  const v = version as number;
  if (v < MIN_READABLE_SAVE_VERSION) {
    fail('formatVersion', `is ${v}; this build no longer reads challenges older than version `
      + `${MIN_READABLE_SAVE_VERSION}.`);
  }
  if (v > SAVE_FORMAT_VERSION) {
    fail('formatVersion', `is ${v} and this build reads version ${SAVE_FORMAT_VERSION}. `
      + 'Update the app, or ask whoever published it for an export from this version.');
  }

  // --- the chain ---
  const { doc } = applyMigrationChain(root, v);

  // --- the shape ---
  return readSaveDocument(doc);
}

/**
 * The current-shape validator. Separated from `parseSaveFile` so the migration
 * chain has something to hand its output to, and so a probe can validate a
 * document it built in memory without serialising it first.
 */
export function readSaveDocument(doc: Record<string, unknown>): SaveFile {
  const teamsRaw = arr(doc.teams, 'teams', SAVE_LIMITS.TEAM_COUNT + 1);
  if (teamsRaw.length !== SAVE_LIMITS.TEAM_COUNT) {
    fail('teams', `holds ${teamsRaw.length} clubs; a league is exactly ${SAVE_LIMITS.TEAM_COUNT}. `
      + 'The schedule is built from conferences of divisions of four and cannot be produced from any other count.');
  }
  const playersRaw = arr(doc.players, 'players', SAVE_LIMITS.MAX_PLAYERS);
  const nTeams = teamsRaw.length;
  const nPlayers = playersRaw.length;

  const players: SavePlayer[] = playersRaw.map((p, i) => readPlayer(p, `players[${i}]`, nTeams));
  const teams: SaveTeam[] = teamsRaw.map((t, i) => readTeam(t, `teams[${i}]`, nPlayers));

  // Abbreviations are how a person reads the rest of the file and how the
  // denormalised columns (TeamSeasonRecord has none, but LeagueRecord and
  // PlayerSeason carry teamAbbr) resolve back to a club. Two clubs sharing one
  // is not something the game can produce and not something it can display.
  const seen = new Map<string, number>();
  teams.forEach((t, i) => {
    const prior = seen.get(t.abbr);
    if (prior != null) fail(`teams[${i}].abbr`, `"${t.abbr}" is already used by teams[${prior}].`);
    seen.set(t.abbr, i);
  });

  const league = readLeague(doc.league, 'league', nTeams);

  // One player cannot be two men. Every depth chart, pick and history row
  // points at an index, so a duplicate index inside one bucket is the one
  // reference error a range check cannot catch.
  teams.forEach((t, ti) => {
    for (const [bucket, ids] of Object.entries(t.depthChart)) {
      const dup = new Set<number>();
      ids.forEach((id, j) => {
        if (dup.has(id)) fail(`teams[${ti}].depthChart.${bucket}[${j}]`, `names players[${id}] twice.`);
        dup.add(id);
      });
    }
  });

  const picks = arr(doc.picks, 'picks', SAVE_LIMITS.MAX_PICKS)
    .map((p, i) => readPick(p, `picks[${i}]`, nTeams, nPlayers));
  const nPicks = picks.length;
  const games = arr(doc.games, 'games', SAVE_LIMITS.MAX_GAMES)
    .map((g, i) => readGame(g, `games[${i}]`, nTeams));
  const transactions = arr(doc.transactions, 'transactions', SAVE_LIMITS.MAX_TRANSACTIONS)
    .map((t, i) => readTransaction(t, `transactions[${i}]`, nTeams, nPlayers));
  const tradeOffers = arr(doc.tradeOffers, 'tradeOffers', SAVE_LIMITS.MAX_TRADE_OFFERS)
    .map((o, i) => readTradeOffer(o, `tradeOffers[${i}]`, nTeams, nPlayers, nPicks));
  const negotiations = arr(doc.negotiations, 'negotiations', SAVE_LIMITS.MAX_NEGOTIATIONS)
    .map((n, i) => readNegotiation(n, `negotiations[${i}]`, nTeams, nPlayers));
  const seasonRecords = arr(doc.seasonRecords, 'seasonRecords', SAVE_LIMITS.MAX_SEASON_RECORDS)
    .map((r, i) => readSeasonRecord(r, `seasonRecords[${i}]`, nTeams));

  return {
    kind: SAVE_FILE_KIND,
    formatVersion: SAVE_FORMAT_VERSION,
    exportedAt: str(doc.exportedAt, 'exportedAt', 40),
    challenge: readChallenge(doc.challenge, 'challenge'),
    league,
    teams,
    players,
    picks,
    draftState: doc.draftState == null ? null : readDraftState(doc.draftState, 'draftState', nPicks),
    games,
    transactions,
    tradeOffers,
    negotiations,
    seasonRecords,
    history: doc.history == null ? null : readHistory(doc.history, 'history', nTeams, nPlayers, nPicks),
  };
}

function readChallenge(v: unknown, path: string): SaveChallenge {
  const c = obj(v, path);
  return {
    title: str(c.title, `${path}.title`, SAVE_LIMITS.MAX_CHALLENGE_TITLE),
    brief: str(c.brief, `${path}.brief`, SAVE_LIMITS.MAX_CHALLENGE_BRIEF),
  };
}

function readLeague(v: unknown, path: string, nTeams: number): SaveLeagueState {
  const l = obj(v, path);
  const seasonYear = int(l.seasonYear, `${path}.seasonYear`, SAVE_LIMITS.YEAR_MIN, SAVE_LIMITS.YEAR_MAX);
  const startYear = int(l.startYear, `${path}.startYear`, SAVE_LIMITS.YEAR_MIN, SAVE_LIMITS.YEAR_MAX);
  // A league cannot have been founded after the season it is playing. This is
  // not pedantry: `capForYear` grows the ceiling by (seasonYear - startYear),
  // so a negative elapsed count shrinks every club's cap below the base.
  if (startYear > seasonYear) {
    fail(`${path}.startYear`, `is ${startYear}, after the season being played (${seasonYear}).`);
  }
  return {
    name: str(l.name, `${path}.name`, SAVE_LIMITS.MAX_LEAGUE_NAME),
    seasonYear,
    startYear,
    week: int(l.week, `${path}.week`, 1, SAVE_LIMITS.WEEK_MAX),
    phase: oneOf(l.phase, `${path}.phase`, VALID_PHASES),
    contractsAgedYear: nullableInt(l.contractsAgedYear, `${path}.contractsAgedYear`, SAVE_LIMITS.YEAR_MIN, SAVE_LIMITS.YEAR_MAX),
    resignWarnedYear: nullableInt(l.resignWarnedYear, `${path}.resignWarnedYear`, SAVE_LIMITS.YEAR_MIN, SAVE_LIMITS.YEAR_MAX),
    settings: blob(l.settings, `${path}.settings`, SAVE_LIMITS.MAX_BLOB),
    userTeam: nullableRef(l.userTeam, `${path}.userTeam`, nTeams),
  };
}

function readPlayer(v: unknown, path: string, nTeams: number): SavePlayer {
  const p = obj(v, path);
  return {
    team: nullableRef(p.team, `${path}.team`, nTeams),
    firstName: str(p.firstName, `${path}.firstName`, SAVE_LIMITS.MAX_PERSON_NAME),
    lastName: str(p.lastName, `${path}.lastName`, SAVE_LIMITS.MAX_PERSON_NAME),
    position: str(p.position, `${path}.position`, 8),
    age: int(p.age, `${path}.age`, SAVE_LIMITS.AGE_MIN, SAVE_LIMITS.AGE_MAX),
    experience: int(p.experience, `${path}.experience`, 0, 40),
    heightIn: int(p.heightIn, `${path}.heightIn`, 50, 100),
    weightLb: int(p.weightLb, `${path}.weightLb`, 100, 500),
    college: str(p.college, `${path}.college`, SAVE_LIMITS.MAX_COLLEGE),
    trueAttrs: blob(p.trueAttrs, `${path}.trueAttrs`, SAVE_LIMITS.MAX_BLOB),
    trueOvr: int(p.trueOvr, `${path}.trueOvr`, SAVE_LIMITS.RATING_MIN, SAVE_LIMITS.RATING_MAX),
    potential: int(p.potential, `${path}.potential`, SAVE_LIMITS.RATING_MIN, SAVE_LIMITS.RATING_MAX),
    devTrait: oneOf(p.devTrait, `${path}.devTrait`, DEV_TRAITS),
    lastSeasonOvr: nullableInt(p.lastSeasonOvr, `${path}.lastSeasonOvr`, SAVE_LIMITS.RATING_MIN, SAVE_LIMITS.RATING_MAX),
    status: oneOf(p.status, `${path}.status`, PLAYER_STATUSES),
    isDraftee: bool(p.isDraftee, `${path}.isDraftee`),
    draftYear: nullableInt(p.draftYear, `${path}.draftYear`, SAVE_LIMITS.YEAR_MIN, SAVE_LIMITS.YEAR_MAX),
    draftRound: nullableInt(p.draftRound, `${path}.draftRound`, 1, 20),
    draftPickNo: nullableInt(p.draftPickNo, `${path}.draftPickNo`, 1, 1_000),
    collegeStats: blob(p.collegeStats, `${path}.collegeStats`, SAVE_LIMITS.MAX_BLOB),
    combineTesting: blob(p.combineTesting, `${path}.combineTesting`, SAVE_LIMITS.MAX_BLOB),
    devFocus: int(p.devFocus, `${path}.devFocus`, 0, 1_000),
    yearsUnsigned: int(p.yearsUnsigned, `${path}.yearsUnsigned`, 0, 100),
    weeksUnsigned: int(p.weeksUnsigned, `${path}.weeksUnsigned`, 0, 1_000),
    injuryWeeks: int(p.injuryWeeks, `${path}.injuryWeeks`, 0, 200),
    injuryType: nullableStr(p.injuryType, `${path}.injuryType`, SAVE_LIMITS.MAX_LABEL),
    fatigue: int(p.fatigue, `${path}.fatigue`, 0, 100),
    morale: int(p.morale, `${path}.morale`, 0, 100),
    seasonStats: blob(p.seasonStats, `${path}.seasonStats`, SAVE_LIMITS.MAX_BLOB),
    careerStats: blob(p.careerStats, `${path}.careerStats`, SAVE_LIMITS.MAX_BLOB),
    playoffStats: blob(p.playoffStats, `${path}.playoffStats`, SAVE_LIMITS.MAX_BLOB),
    careerPlayoffStats: blob(p.careerPlayoffStats, `${path}.careerPlayoffStats`, SAVE_LIMITS.MAX_BLOB),
    contract: p.contract == null ? null : readContract(p.contract, `${path}.contract`, nTeams),
  };
}

function readContract(v: unknown, path: string, nTeams: number): SaveContract {
  const c = obj(v, path);
  const years = int(c.years, `${path}.years`, 0, SAVE_LIMITS.CONTRACT_YEARS_MAX);
  return {
    years,
    // NOT bounded by `years` here — INV-13 is the authority on that, and it
    // runs against the imported league inside the transaction. Duplicating the
    // rule would make two places that could disagree about it.
    yearsRemaining: int(c.yearsRemaining, `${path}.yearsRemaining`, 0, SAVE_LIMITS.CONTRACT_YEARS_MAX),
    signedYear: int(c.signedYear, `${path}.signedYear`, SAVE_LIMITS.YEAR_MIN, SAVE_LIMITS.YEAR_MAX),
    baseSalaries: blob(c.baseSalaries, `${path}.baseSalaries`, SAVE_LIMITS.MAX_BLOB),
    signingBonus: int(c.signingBonus, `${path}.signingBonus`, 0, SAVE_LIMITS.MONEY_MAX),
    guaranteed: int(c.guaranteed, `${path}.guaranteed`, 0, SAVE_LIMITS.MONEY_MAX),
    isRookieDeal: bool(c.isRookieDeal, `${path}.isRookieDeal`),
    isFranchiseTag: bool(c.isFranchiseTag, `${path}.isFranchiseTag`),
    fifthYearOption: nullableStr(c.fifthYearOption, `${path}.fifthYearOption`, SAVE_LIMITS.MAX_LABEL),
    voidYears: int(c.voidYears, `${path}.voidYears`, 0, SAVE_LIMITS.CONTRACT_YEARS_MAX),
    team: nullableRef(c.team, `${path}.team`, nTeams),
  };
}

function readTeam(v: unknown, path: string, nPlayers: number): SaveTeam {
  const t = obj(v, path);
  const abbr = str(t.abbr, `${path}.abbr`, SAVE_LIMITS.ABBR_MAX);
  if (abbr.length < SAVE_LIMITS.ABBR_MIN || !/^[A-Z0-9]+$/.test(abbr)) {
    fail(`${path}.abbr`, `is "${abbr}"; an abbreviation is ${SAVE_LIMITS.ABBR_MIN}-${SAVE_LIMITS.ABBR_MAX} `
      + 'upper-case letters or digits.');
  }

  const depthRaw = obj(t.depthChart, `${path}.depthChart`);
  const buckets = Object.keys(depthRaw);
  if (buckets.length > SAVE_LIMITS.MAX_DEPTH_BUCKETS) {
    fail(`${path}.depthChart`, `holds ${buckets.length} buckets; the maximum is ${SAVE_LIMITS.MAX_DEPTH_BUCKETS}.`);
  }
  const depthChart: Record<string, number[]> = {};
  for (const bucket of buckets) {
    if (!/^[A-Z0-9_]{1,16}$/.test(bucket)) {
      fail(`${path}.depthChart`, `has a bucket named "${bucket.slice(0, 24)}", which is not a position bucket.`);
    }
    depthChart[bucket] = arr(depthRaw[bucket], `${path}.depthChart.${bucket}`, SAVE_LIMITS.MAX_DEPTH_PER_BUCKET)
      .map((id, i) => ref(id, `${path}.depthChart.${bucket}[${i}]`, nPlayers));
  }

  return {
    city: str(t.city, `${path}.city`, SAVE_LIMITS.MAX_CITY),
    nickname: str(t.nickname, `${path}.nickname`, SAVE_LIMITS.MAX_NICKNAME),
    abbr,
    conference: str(t.conference, `${path}.conference`, 24),
    division: str(t.division, `${path}.division`, 24),
    isUser: bool(t.isUser, `${path}.isUser`),
    prestige: int(t.prestige, `${path}.prestige`, 0, 100),
    gmProfile: blob(t.gmProfile, `${path}.gmProfile`, SAVE_LIMITS.MAX_BLOB),
    wins: int(t.wins, `${path}.wins`, 0, 100),
    losses: int(t.losses, `${path}.losses`, 0, 100),
    ties: int(t.ties, `${path}.ties`, 0, 100),
    pointsFor: int(t.pointsFor, `${path}.pointsFor`, 0, 10_000),
    pointsAgnst: int(t.pointsAgnst, `${path}.pointsAgnst`, 0, 10_000),
    divWins: int(t.divWins, `${path}.divWins`, 0, 100),
    divLosses: int(t.divLosses, `${path}.divLosses`, 0, 100),
    confWins: int(t.confWins, `${path}.confWins`, 0, 100),
    confLosses: int(t.confLosses, `${path}.confLosses`, 0, 100),
    playoffSeed: nullableInt(t.playoffSeed, `${path}.playoffSeed`, 1, 32),
    eliminated: bool(t.eliminated, `${path}.eliminated`),
    scoutPoints: int(t.scoutPoints, `${path}.scoutPoints`, 0, 1_000_000),
    scoutPeriod: int(t.scoutPeriod, `${path}.scoutPeriod`, 0, 10_000),
    scoutPeriodGrant: int(t.scoutPeriodGrant, `${path}.scoutPeriodGrant`, 0, 1_000_000),
    scoutSpentSeason: int(t.scoutSpentSeason, `${path}.scoutSpentSeason`, 0, 1_000_000),
    staff: arr(t.staff, `${path}.staff`, SAVE_LIMITS.MAX_STAFF_PER_TEAM).map((s, i) => {
      const o = obj(s, `${path}.staff[${i}]`);
      return {
        role: str(o.role, `${path}.staff[${i}].role`, 8),
        name: str(o.name, `${path}.staff[${i}].name`, SAVE_LIMITS.MAX_PERSON_NAME * 2),
        rating: int(o.rating, `${path}.staff[${i}].rating`, 0, 100),
        playCalling: int(o.playCalling, `${path}.staff[${i}].playCalling`, 0, 100),
        development: int(o.development, `${path}.staff[${i}].development`, 0, 100),
        contractYears: int(o.contractYears, `${path}.staff[${i}].contractYears`, 0, 20),
        salary: int(o.salary, `${path}.staff[${i}].salary`, 0, SAVE_LIMITS.MONEY_MAX),
      };
    }),
    scouts: arr(t.scouts, `${path}.scouts`, SAVE_LIMITS.MAX_SCOUTS_PER_TEAM).map((s, i) => {
      const o = obj(s, `${path}.scouts[${i}]`);
      return {
        name: str(o.name, `${path}.scouts[${i}].name`, SAVE_LIMITS.MAX_PERSON_NAME * 2),
        accuracy: int(o.accuracy, `${path}.scouts[${i}].accuracy`, 0, 100),
        speed: int(o.speed, `${path}.scouts[${i}].speed`, 0, 100),
        specialty: str(o.specialty, `${path}.scouts[${i}].specialty`, 16),
        salary: int(o.salary, `${path}.scouts[${i}].salary`, 0, SAVE_LIMITS.MONEY_MAX),
      };
    }),
    capCharges: arr(t.capCharges, `${path}.capCharges`, SAVE_LIMITS.MAX_CAP_CHARGES_PER_TEAM).map((c, i) => {
      const o = obj(c, `${path}.capCharges[${i}]`);
      return {
        year: int(o.year, `${path}.capCharges[${i}].year`, SAVE_LIMITS.YEAR_MIN, SAVE_LIMITS.YEAR_MAX),
        // NEGATIVE IS LEGAL and must stay legal: a cap credit is a real row the
        // game writes. INV-26 is the authority on which of these numbers may
        // be negative, and it runs on the imported league.
        amount: int(o.amount, `${path}.capCharges[${i}].amount`, SAVE_LIMITS.MONEY_MIN, SAVE_LIMITS.MONEY_MAX),
        label: str(o.label, `${path}.capCharges[${i}].label`, SAVE_LIMITS.MAX_LABEL),
      };
    }),
    depthChart,
  };
}

function readPick(v: unknown, path: string, nTeams: number, nPlayers: number): SavePick {
  const p = obj(v, path);
  return {
    year: int(p.year, `${path}.year`, SAVE_LIMITS.YEAR_MIN, SAVE_LIMITS.YEAR_MAX),
    round: int(p.round, `${path}.round`, 1, 20),
    slot: int(p.slot, `${path}.slot`, 1, 64),
    originalTeam: ref(p.originalTeam, `${path}.originalTeam`, nTeams),
    ownerTeam: ref(p.ownerTeam, `${path}.ownerTeam`, nTeams),
    used: bool(p.used, `${path}.used`),
    player: nullableRef(p.player, `${path}.player`, nPlayers),
  };
}

function readDraftState(v: unknown, path: string, nPicks: number): SaveDraftState {
  const d = obj(v, path);
  const order = arr(d.order, `${path}.order`, SAVE_LIMITS.MAX_PICKS)
    .map((p, i) => ref(p, `${path}.order[${i}]`, nPicks));
  const dup = new Set<number>();
  order.forEach((p, i) => {
    if (dup.has(p)) fail(`${path}.order[${i}]`, `names picks[${p}] twice; a draft cannot make the same selection twice.`);
    dup.add(p);
  });
  const pickIndex = int(d.pickIndex, `${path}.pickIndex`, 0, SAVE_LIMITS.MAX_PICKS);
  const complete = bool(d.complete, `${path}.complete`);
  /*
   * THE CURSOR IS ONLY BOUNDED WHILE THE DRAFT IS LIVE, and that is what a
   * real save looks like rather than what one would guess.
   *
   * Measured on a league three seasons deep: a FINISHED rookie draft is stored
   * as `{ round: 7, pickIndex: 224, order: [], complete: true }`. The order is
   * emptied when the draft closes and the cursor is left where it stopped, so
   * the obvious check — a cursor no further than one past the end of the order
   * — refuses every save that has ever completed a draft, which is every save
   * worth publishing. (It did. This is why the bound is conditional.)
   *
   * While the draft is NOT complete the cursor matters: `currentPick` reads
   * `order[pickIndex]` (lib/draft.ts), so a cursor past the end is a draft
   * with nobody on the clock that can never finish — INV-18's failure mode.
   */
  if (!complete && pickIndex > order.length) {
    fail(`${path}.pickIndex`, `is ${pickIndex} but the unfinished draft's order holds ${order.length} picks; `
      + 'nobody would be on the clock.');
  }
  return {
    kind: oneOf(d.kind, `${path}.kind`, DRAFT_KINDS),
    round: int(d.round, `${path}.round`, 1, 20),
    pickIndex,
    order,
    complete,
    started: bool(d.started, `${path}.started`),
  };
}

/** `{ type, ref }`, with the ref ranged against the right array. */
function readAssetRef(v: unknown, path: string, nPlayers: number, nPicks: number): SaveAssetRef {
  const a = obj(v, path);
  const type = oneOf(a.type, `${path}.type`, ['PLAYER', 'PICK'] as const);
  return { type, ref: ref(a.ref, `${path}.ref`, type === 'PLAYER' ? nPlayers : nPicks) };
}

function readGame(v: unknown, path: string, nTeams: number): SaveGame {
  const g = obj(v, path);
  return {
    seasonYear: int(g.seasonYear, `${path}.seasonYear`, SAVE_LIMITS.YEAR_MIN, SAVE_LIMITS.YEAR_MAX),
    week: int(g.week, `${path}.week`, 0, SAVE_LIMITS.WEEK_MAX),
    kind: str(g.kind, `${path}.kind`, 24),
    homeTeam: ref(g.homeTeam, `${path}.homeTeam`, nTeams),
    awayTeam: ref(g.awayTeam, `${path}.awayTeam`, nTeams),
    played: bool(g.played, `${path}.played`),
    homeScore: int(g.homeScore, `${path}.homeScore`, 0, 500),
    awayScore: int(g.awayScore, `${path}.awayScore`, 0, 500),
    boxScore: blob(g.boxScore, `${path}.boxScore`, SAVE_LIMITS.MAX_BOX_SCORE),
    recap: str(g.recap, `${path}.recap`, SAVE_LIMITS.MAX_RECAP),
  };
}

function readTransaction(v: unknown, path: string, nTeams: number, nPlayers: number): SaveTransaction {
  const t = obj(v, path);
  return {
    seasonYear: int(t.seasonYear, `${path}.seasonYear`, SAVE_LIMITS.YEAR_MIN, SAVE_LIMITS.YEAR_MAX),
    week: int(t.week, `${path}.week`, 0, SAVE_LIMITS.WEEK_MAX),
    type: str(t.type, `${path}.type`, 32),
    team: nullableRef(t.team, `${path}.team`, nTeams),
    player: nullableRef(t.player, `${path}.player`, nPlayers),
    headline: str(t.headline, `${path}.headline`, SAVE_LIMITS.MAX_HEADLINE),
    detail: str(t.detail, `${path}.detail`, SAVE_LIMITS.MAX_DETAIL),
  };
}

/** The ceiling lib/owner.ts puts on a trade proposal, applied to a stored one. */
const MAX_OFFER_ASSETS = 40;

function readTradeOffer(v: unknown, path: string, nTeams: number, nPlayers: number, nPicks: number): SaveTradeOffer {
  const o = obj(v, path);
  return {
    fromTeam: ref(o.fromTeam, `${path}.fromTeam`, nTeams),
    toTeam: ref(o.toTeam, `${path}.toTeam`, nTeams),
    give: arr(o.give, `${path}.give`, MAX_OFFER_ASSETS)
      .map((a, i) => readAssetRef(a, `${path}.give[${i}]`, nPlayers, nPicks)),
    request: arr(o.request, `${path}.request`, MAX_OFFER_ASSETS)
      .map((a, i) => readAssetRef(a, `${path}.request[${i}]`, nPlayers, nPicks)),
    blurb: str(o.blurb, `${path}.blurb`, SAVE_LIMITS.MAX_BLURB),
    status: oneOf(o.status, `${path}.status`, OFFER_STATUSES),
    seasonYear: int(o.seasonYear, `${path}.seasonYear`, SAVE_LIMITS.YEAR_MIN, SAVE_LIMITS.YEAR_MAX),
    week: int(o.week, `${path}.week`, 0, SAVE_LIMITS.WEEK_MAX),
  };
}

function readNegotiation(v: unknown, path: string, nTeams: number, nPlayers: number): SaveNegotiation {
  const n = obj(v, path);
  return {
    team: ref(n.team, `${path}.team`, nTeams),
    player: ref(n.player, `${path}.player`, nPlayers),
    seasonYear: int(n.seasonYear, `${path}.seasonYear`, SAVE_LIMITS.YEAR_MIN, SAVE_LIMITS.YEAR_MAX),
    patienceSpent: int(n.patienceSpent, `${path}.patienceSpent`, 0, 1_000),
    dismissed: bool(n.dismissed, `${path}.dismissed`),
  };
}

function readSeasonRecord(v: unknown, path: string, nTeams: number): SaveSeasonRecord {
  const r = obj(v, path);
  return {
    team: ref(r.team, `${path}.team`, nTeams),
    year: int(r.year, `${path}.year`, SAVE_LIMITS.YEAR_MIN, SAVE_LIMITS.YEAR_MAX),
    wins: int(r.wins, `${path}.wins`, 0, 100),
    losses: int(r.losses, `${path}.losses`, 0, 100),
    ties: int(r.ties, `${path}.ties`, 0, 100),
    pointsFor: int(r.pointsFor, `${path}.pointsFor`, 0, 10_000),
    pointsAgnst: int(r.pointsAgnst, `${path}.pointsAgnst`, 0, 10_000),
    playoffResult: oneOf(r.playoffResult, `${path}.playoffResult`, PLAYOFF_RESULTS),
  };
}

function readTradeSnapshots(v: unknown, path: string, nPlayers: number, nPicks: number): SaveTradeSnapshot[] {
  return arr(v, path, MAX_OFFER_ASSETS).map((s, i) => {
    const o = obj(s, `${path}[${i}]`);
    const p = `${path}[${i}]`;
    const type = oneOf(o.type, `${p}.type`, ['PLAYER', 'PICK'] as const);
    return {
      type,
      ref: nullableRef(o.ref, `${p}.ref`, type === 'PLAYER' ? nPlayers : nPicks),
      label: str(o.label, `${p}.label`, SAVE_LIMITS.MAX_LABEL),
      position: nullableStr(o.position, `${p}.position`, 8),
      ovr: nullableInt(o.ovr, `${p}.ovr`, SAVE_LIMITS.RATING_MIN, SAVE_LIMITS.RATING_MAX),
      value: int(o.value, `${p}.value`, SAVE_LIMITS.MONEY_MIN, SAVE_LIMITS.MONEY_MAX),
    };
  });
}

function readHistory(v: unknown, path: string, nTeams: number, nPlayers: number, nPicks: number): SaveHistory {
  const h = obj(v, path);
  return {
    playerSeasons: arr(h.playerSeasons, `${path}.playerSeasons`, SAVE_LIMITS.MAX_PLAYER_SEASONS).map((r, i) => {
      const o = obj(r, `${path}.playerSeasons[${i}]`);
      const p = `${path}.playerSeasons[${i}]`;
      return {
        player: ref(o.player, `${p}.player`, nPlayers),
        seasonYear: int(o.seasonYear, `${p}.seasonYear`, SAVE_LIMITS.YEAR_MIN, SAVE_LIMITS.YEAR_MAX),
        team: nullableRef(o.team, `${p}.team`, nTeams),
        teamAbbr: str(o.teamAbbr, `${p}.teamAbbr`, SAVE_LIMITS.ABBR_MAX),
        age: nullableInt(o.age, `${p}.age`, 0, SAVE_LIMITS.AGE_MAX),
        gp: int(o.gp, `${p}.gp`, 0, 100),
        firstSeen: int(o.firstSeen, `${p}.firstSeen`, 0, SAVE_LIMITS.YEAR_MAX),
        stats: blob(o.stats, `${p}.stats`, SAVE_LIMITS.MAX_BLOB),
        playoffStats: blob(o.playoffStats, `${p}.playoffStats`, SAVE_LIMITS.MAX_BLOB),
        playoffGp: int(o.playoffGp, `${p}.playoffGp`, 0, 100),
        endOvr: nullableInt(o.endOvr, `${p}.endOvr`, SAVE_LIMITS.RATING_MIN, SAVE_LIMITS.RATING_MAX),
      };
    }),
    championRosters: arr(h.championRosters, `${path}.championRosters`, SAVE_LIMITS.MAX_CHAMPION_ROSTERS).map((r, i) => {
      const o = obj(r, `${path}.championRosters[${i}]`);
      const p = `${path}.championRosters[${i}]`;
      return {
        seasonYear: int(o.seasonYear, `${p}.seasonYear`, SAVE_LIMITS.YEAR_MIN, SAVE_LIMITS.YEAR_MAX),
        team: ref(o.team, `${p}.team`, nTeams),
        player: ref(o.player, `${p}.player`, nPlayers),
      };
    }),
    leagueRecords: arr(h.leagueRecords, `${path}.leagueRecords`, SAVE_LIMITS.MAX_LEAGUE_RECORDS).map((r, i) => {
      const o = obj(r, `${path}.leagueRecords[${i}]`);
      const p = `${path}.leagueRecords[${i}]`;
      return {
        scope: oneOf(o.scope, `${p}.scope`, RECORD_SCOPES),
        category: str(o.category, `${p}.category`, 48),
        value: int(o.value, `${p}.value`, SAVE_LIMITS.MONEY_MIN, SAVE_LIMITS.MONEY_MAX),
        player: nullableRef(o.player, `${p}.player`, nPlayers),
        playerName: str(o.playerName, `${p}.playerName`, SAVE_LIMITS.MAX_PERSON_NAME * 2 + 1),
        teamAbbr: str(o.teamAbbr, `${p}.teamAbbr`, SAVE_LIMITS.ABBR_MAX),
        seasonYear: int(o.seasonYear, `${p}.seasonYear`, SAVE_LIMITS.YEAR_MIN, SAVE_LIMITS.YEAR_MAX),
      };
    }),
    tradeRecords: arr(h.tradeRecords, `${path}.tradeRecords`, SAVE_LIMITS.MAX_TRADE_RECORDS).map((r, i) => {
      const o = obj(r, `${path}.tradeRecords[${i}]`);
      const p = `${path}.tradeRecords[${i}]`;
      return {
        seasonYear: int(o.seasonYear, `${p}.seasonYear`, SAVE_LIMITS.YEAR_MIN, SAVE_LIMITS.YEAR_MAX),
        week: int(o.week, `${p}.week`, 0, SAVE_LIMITS.WEEK_MAX),
        teamA: ref(o.teamA, `${p}.teamA`, nTeams),
        teamB: ref(o.teamB, `${p}.teamB`, nTeams),
        teamAAbbr: str(o.teamAAbbr, `${p}.teamAAbbr`, SAVE_LIMITS.ABBR_MAX),
        teamBAbbr: str(o.teamBAbbr, `${p}.teamBAbbr`, SAVE_LIMITS.ABBR_MAX),
        aToB: readTradeSnapshots(o.aToB, `${p}.aToB`, nPlayers, nPicks),
        bToA: readTradeSnapshots(o.bToA, `${p}.bToA`, nPlayers, nPicks),
      };
    }),
    powerSnapshots: arr(h.powerSnapshots, `${path}.powerSnapshots`, SAVE_LIMITS.MAX_POWER_SNAPSHOTS).map((r, i) => {
      const o = obj(r, `${path}.powerSnapshots[${i}]`);
      const p = `${path}.powerSnapshots[${i}]`;
      return {
        team: ref(o.team, `${p}.team`, nTeams),
        seasonYear: int(o.seasonYear, `${p}.seasonYear`, SAVE_LIMITS.YEAR_MIN, SAVE_LIMITS.YEAR_MAX),
        week: int(o.week, `${p}.week`, 0, SAVE_LIMITS.WEEK_MAX),
        rank: int(o.rank, `${p}.rank`, 1, SAVE_LIMITS.TEAM_COUNT),
        powerIndex: num(o.powerIndex, `${p}.powerIndex`, -1_000, 1_000),
        rating: int(o.rating, `${p}.rating`, SAVE_LIMITS.RATING_MIN, SAVE_LIMITS.RATING_MAX),
        wins: int(o.wins, `${p}.wins`, 0, 100),
        losses: int(o.losses, `${p}.losses`, 0, 100),
        ties: int(o.ties, `${p}.ties`, 0, 100),
        netPerGame: num(o.netPerGame, `${p}.netPerGame`, -1_000, 1_000),
      };
    }),
  };
}

/**
 * The document as bytes. No pretty-printing: a challenge is read by the
 * importer, not by a person, and indentation is a third of the file.
 */
export function serializeSaveFile(file: SaveFile): string {
  return JSON.stringify(file);
}

/**
 * THE ONE PLACE A CHALLENGE'S HEADLINE FACTS ARE COUNTED.
 *
 * Both the publish path (which stores them on the row, so a preview card is
 * one indexed read) and any screen describing a file in hand call this. Pure,
 * counted off the document rather than off the database, because the document
 * is the thing being described — so the record on the recipient's card is the
 * record in the file they are about to play.
 */
export interface SaveSummary {
  leagueName: string;
  seasonYear: number;
  phase: string;
  week: number;
  teamCount: number;
  /** The club being handed over, and the state it is in. */
  teamAbbr: string | null;
  teamName: string | null;
  record: string | null;
  rosteredPlayers: number;
  freeAgents: number;
  hasDraftClass: boolean;
  carriesHistory: boolean;
  challengeTitle: string;
  challengeBrief: string;
}

/**
 * THE ONE PLACE A SITUATION IS PUT INTO WORDS: "CLE 0-9 · week 10 of the
 * Regular Season, 2029".
 *
 * Four screens say this — the save picker on the challenge section, the
 * publisher's list of their own codes, the recipient's card, and the log line
 * — and they are reading it out of three different places: a League row, a
 * PublishedLeague row, and a parsed file. One function, so the sentence a
 * publisher chose a save by is the sentence the recipient is offered.
 *
 * The phase LABEL comes from the engine's own map, never from a second table
 * of prettier names.
 */
export function describeSituation(s: {
  teamAbbr: string | null;
  record: string | null;
  phase: string;
  week: number;
  seasonYear: number;
}): string {
  const club = s.teamAbbr != null && s.record != null ? `${s.teamAbbr} ${s.record} · ` : '';
  const phase = PHASE_LABELS[s.phase] ?? s.phase;
  // Only the phases that actually run a clock have a meaningful week. The
  // offseason windows are one step each, and "week 1 of Free Agency" reads as
  // a fact about the game's internals rather than about the situation.
  const weekly = s.phase === 'REGULAR' || s.phase === 'PLAYOFFS';
  return weekly
    ? `${club}week ${s.week} of the ${phase}, ${s.seasonYear}`
    : `${club}${phase}, ${s.seasonYear}`;
}

export function summarizeSaveFile(file: SaveFile): SaveSummary {
  const idx = file.league.userTeam;
  const club = idx == null ? null : file.teams[idx] ?? null;
  return {
    leagueName: file.league.name,
    seasonYear: file.league.seasonYear,
    phase: file.league.phase,
    week: file.league.week,
    teamCount: file.teams.length,
    teamAbbr: club ? club.abbr : null,
    teamName: club ? `${club.city} ${club.nickname}` : null,
    record: club ? `${club.wins}-${club.losses}${club.ties > 0 ? `-${club.ties}` : ''}` : null,
    rosteredPlayers: file.players.filter((p) => p.team != null && !p.isDraftee).length,
    freeAgents: file.players.filter((p) => p.status === 'FREE_AGENT').length,
    hasDraftClass: file.players.some((p) => p.isDraftee),
    carriesHistory: file.history != null,
    challengeTitle: file.challenge.title,
    challengeBrief: file.challenge.brief,
  };
}
