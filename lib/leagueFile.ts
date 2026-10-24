/**
 * ===========================================================================
 * THE LEAGUE FILE — a shareable, versioned description of a custom league
 * ===========================================================================
 *
 * One JSON document describing 32 franchises and, optionally, the players on
 * them. Someone exports their league, sends the file to a friend, the friend
 * imports it and plays it. That is the entire feature; there is no server, no
 * hosted link and no gallery (see docs/custom-leagues.md, "Not built").
 *
 * THREE RULES THIS MODULE IS BUILT AROUND
 *
 * 1. THE FILE IS HOSTILE. Every value that reaches this module came from a
 *    stranger's text editor. Nothing is trusted, nothing is coerced silently,
 *    and the shape checks run in an order that lets a 50MB file be refused
 *    before it is parsed and a 100,000-player file be refused before its
 *    players are read (an array's `.length` is free; walking it is not).
 *
 * 2. A REFUSAL EXPLAINS ITSELF. Every rejection names the field, its path in
 *    the document (`teams[7].players[3].age`) and what would have been legal.
 *    "Invalid file" is not an error message, it is a shrug.
 *
 * 3. OUT OF RANGE IS REFUSED, NOT QUIETLY CLAMPED. A rating of 9999 is not a
 *    99 the author meant; it is a file that is wrong, and silently repairing
 *    it hands back a league that does not match what the author wrote while
 *    telling them nothing. The narrow exceptions are values that are
 *    DERIVED rather than authored — `yearsRemaining` cannot exceed `years`,
 *    `potential` cannot sit below `ovr`, and `trueOvr` is always recomputed
 *    from the attributes rather than believed — and those are documented
 *    field by field below and in docs/custom-leagues.md.
 *
 * VERSIONING. `formatVersion` is the first field of the document and the
 * first thing checked. This reader accepts versions 1 and 2 and refuses
 * anything else by number, in both directions, with a message saying which
 * version the file is and which this build speaks. Adding a new OPTIONAL field
 * never bumps the version — an old reader ignores fields it does not know.
 * Removing a field, renaming one, or changing the MEANING of an existing one
 * bumps it.
 *
 * VERSION 2 bumped it for the third reason, and the bump is for the benefit of
 * OLD readers rather than this one. `conference` and `division` used to be
 * closed enums — two conference names and four division names, both baked in —
 * and they are now author-supplied strings, so a file whose teams play in the
 * "Big Ten" and the "SEC" is a file a version-1 reader must refuse by version
 * number rather than by eight confusing "must be one of AFC, NFC" errors. The
 * same bump carries `draftClasses`, the college prospects the format had no
 * way to describe at all.
 *
 * READING VERSION 1 NEEDS NO UPGRADE STEP, because every version-2 addition is
 * optional and defaults to what version 1 meant: no `conferences` is
 * LEAGUE.CONFERENCES, no `divisions` is LEAGUE.DIVISIONS, no `draftClasses` is
 * the generated class a league has always got. The one thing the reader IS
 * strict about is the other direction — a file that declares version 1 and
 * then uses a version-2 field is refused by name, so the version number never
 * becomes decoration.
 */

import { prisma } from './db';
import { Rng, clamp } from './rng';
import { GENERATION, LEAGUE, POSITIONS, Position, ROSTER_TARGETS, conferencesOf, divisionsOf } from './tuning';
import { ATTRIBUTE_BY_KEY, AttrMap, attrsForPosition, computeOverall } from './ratings';
import { GeneratedPlayer, generateDraftClass, generatePlayer, generateRoster } from './gen/players';
import { generateClassStrength, generateCollegeProfile } from './gen/prospectProfile';
import { NameRegistry } from './gen/names';
import { readJson } from './json';
import { LeagueImportPlan, PlannedContract, plannedContractKey } from './gen/league';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** Bumped only by a BREAKING change. New optional fields do not bump it. */
export const FORMAT_VERSION = 2;

/** Every version this build can read. */
export const SUPPORTED_VERSIONS = [1, 2];

/** The version-2 fields. A file declaring version 1 may not use them. */
const V2_FIELDS = ['conferences', 'divisions', 'draftClasses'] as const;

/**
 * A discriminator, so a JSON file that is merely *some other JSON file* is
 * refused by name instead of by a confusing cascade of missing-field errors.
 */
export const FILE_KIND = 'dynastygm.league';

// ---------------------------------------------------------------------------
// Limits — the whole cost story, in one object
// ---------------------------------------------------------------------------

/**
 * Everything that bounds the work an uploaded file can cause. These are
 * deliberately in one place: the import route quotes MAX_BYTES in its refusal,
 * the docs quote all of them, and a future change to any one of them is a
 * change to a single line rather than an archaeology exercise.
 *
 * MAX_BYTES is sized off a real full export, and the figure moved with
 * version 2. A 32-team league with complete rosters, every attribute and every
 * contract measures 0.6-1.1MB in this format, which is what 4MB was sized
 * against. A version-2 file may also carry a draft class, and a measured full
 * export of a league holding one came out at 0.64MB of rosters plus 0.18MB of
 * prospects — 0.82MB all in, so call it 0.8-1.5MB across the range of name
 * lengths the old measurement spanned.
 *
 * 8MB keeps roughly the five-fold headroom 4MB had over the largest thing the
 * app itself writes, while still being small enough that parsing one is not
 * itself a denial of service. The cost that actually matters on this path is
 * not bytes anyway: it is the ~2,100 rows an accepted file causes to be
 * WRITTEN, and that is bounded by the count limits below.
 */
export const FILE_LIMITS = {
  MAX_BYTES: 8 * 1024 * 1024,
  /** A schedule needs exactly this shape — see the structure check below. */
  TEAM_COUNT: LEAGUE.TEAM_COUNT,
  CONFERENCE_COUNT: LEAGUE.CONFERENCES.length,
  DIVISION_COUNT: LEAGUE.DIVISIONS.length,
  TEAMS_PER_DIVISION: 4,
  MAX_PLAYERS_PER_TEAM: LEAGUE.ROSTER_MAX,
  MAX_FREE_AGENTS: 400,
  MAX_ATTRS_PER_PLAYER: 64,
  MAX_LEAGUE_NAME: 60,
  MAX_CONFERENCE_NAME: 24,
  MAX_DIVISION_NAME: 24,
  MAX_CITY: 24,
  MAX_NICKNAME: 24,
  MAX_PERSON_NAME: 24,
  MAX_COLLEGE: 32,
  ABBR_MIN: 2,
  ABBR_MAX: 4,
  AGE_MIN: 18,
  AGE_MAX: 45,
  EXPERIENCE_MAX: 25,
  HEIGHT_MIN: 60,
  HEIGHT_MAX: 90,
  WEIGHT_MIN: 140,
  WEIGHT_MAX: 400,
  RATING_MIN: 1,
  RATING_MAX: 99,
  CONTRACT_APY_MIN: 500_000,
  /** Well above any sane deal, well below anything that breaks an Int column. */
  CONTRACT_APY_MAX: 100_000_000,
  CONTRACT_YEARS_MAX: 7,

  /**
   * DRAFT CLASSES. One class, because `Player.draftYear` is how the app
   * decides which class is on the clock and it takes the NEWEST one still
   * flagged `isDraftee` (liveDraftClassYear, lib/draft.ts) — so a second,
   * pre-authored class a year ahead would take over the draft board a year
   * early. The field is an ARRAY anyway, so the day the engine can hold more
   * than one is a change to this number and not to the format.
   */
  MAX_DRAFT_CLASSES: 1,
  /**
   * Exactly the size of a generated class: GENERATION.DRAFT_CLASS_SIZE (224,
   * which is 7 rounds x 32) plus DRAFT_CLASS_EXTRA_UDFA (176). Read from there
   * rather than typed in, so a retuned class size cannot leave an authored one
   * refused for being the size the generator now produces.
   */
  MAX_PROSPECTS_PER_CLASS: GENERATION.DRAFT_CLASS_SIZE + GENERATION.DRAFT_CLASS_EXTRA_UDFA,
  /**
   * How far a class's authored `strength` may push every position group. The
   * generated bias is N(0, 6) per group (generateClassStrength), so +/-12 is
   * two standard deviations of class personality applied across the board —
   * past that an author is not describing a strong class, they are asking for
   * a league of ninety-overall rookies.
   */
  CLASS_STRENGTH_MIN: -12,
  CLASS_STRENGTH_MAX: 12,
  /** A class year is a label, not a game year — see readDraftClass. */
  DRAFT_YEAR_MIN: 1900,
  DRAFT_YEAR_MAX: 2200,

  /**
   * COMBINE TESTING. Each bound is the position-anchor table's own range
   * (COMBINE_ANCHOR, lib/gen/prospectProfile.ts) opened out well past the
   * slowest and fastest man it can roll, so an authored number is refused only
   * when it is not a measurement at all. They are REFUSED rather than clamped
   * for the usual reason: a 40-yard dash of 0.4 is not a 4.0 the author meant.
   */
  FORTY_MIN: 3.8, FORTY_MAX: 7.5,
  VERTICAL_MIN: 10, VERTICAL_MAX: 50,
  BROAD_MIN: 60, BROAD_MAX: 160,
  CONE_MIN: 5.5, CONE_MAX: 10.5,
  SHUTTLE_MIN: 3.3, SHUTTLE_MAX: 7.0,
  BENCH_MIN: 1, BENCH_MAX: 60,
} as const;

/**
 * WHAT IMPORT GENERATES WHEN A FILE IS SILENT. Exported for the same reason
 * FILE_LIMITS is: the reference page at /import/reference prints these figures
 * and must print the ones the importer actually used. They are not an
 * independent copy anywhere.
 */
/** The free-agent pool is topped up to this so free agency is never dead. */
export const FREE_AGENT_FLOOR = 60;
/** Generated when a file supplies no free agents at all — parity with createLeague. */
export const FREE_AGENT_DEFAULT = 140;
/**
 * The smallest roster that can field every position group — the sum of
 * ROSTER_TARGETS' minimums. Import fills UP TO each position's minimum and
 * NOT ONE PLAYER FURTHER; see fillRoster.
 */
export const POSITION_MINIMUM_TOTAL = POSITIONS.reduce((n, pos) => n + ROSTER_TARGETS[pos].min, 0);

/**
 * The labels a file gets when it names none — which is every version-1 file
 * and every version-2 file that is happy with the defaults. The LISTS live in
 * lib/tuning.ts beside the structural counts they come with; there is no
 * second copy here, and there used to be.
 *
 * DEV_TRAITS and COMBINE_VENUES are exported because they are closed enums an
 * author has to spell exactly, and the only honest place to read the spelling
 * off is the array `readEnum` is handed. The reference page renders these
 * arrays; it does not restate them.
 */
export const DEFAULT_CONFERENCES: readonly string[] = LEAGUE.CONFERENCES;
export const DEFAULT_DIVISIONS: readonly string[] = LEAGUE.DIVISIONS;
export const DEV_TRAITS = ['Slow', 'Normal', 'Star', 'Superstar'] as const;
export const COMBINE_VENUES = ['COMBINE', 'PRO_DAY'] as const;

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export interface FileContract {
  /** Average per year, in whole dollars. */
  apy: number;
  years: number;
  /** Years still to run. Clamped into 1..years — it is derived, not authored. */
  yearsRemaining?: number;
}

export interface FilePlayer {
  firstName: string;
  lastName: string;
  position: Position;
  age: number;
  /** Completed pro seasons. Defaults to `age - 22`, floored at 0. */
  experience?: number;
  heightIn?: number;
  weightLb?: number;
  college?: string;
  /**
   * Overall rating. Used as the TARGET when `attrs` is absent; when `attrs`
   * IS present the real overall is recomputed from those attributes and this
   * field is ignored, because a stored overall that disagrees with the
   * attributes under it is exactly the lying metric the house rules forbid.
   */
  ovr: number;
  /** Ceiling. Raised to `ovr` if it sits below it. Defaults to a rolled bonus. */
  potential?: number;
  devTrait?: (typeof DEV_TRAITS)[number];
  /** Partial is fine: unspecified attributes are generated around `ovr`. */
  attrs?: AttrMap;
  contract?: FileContract;
  /**
   * Combine or pro-day numbers. ONLY legal inside a `draftClasses` entry —
   * nothing in the app shows testing for a man who is not in a draft class
   * (see the `isDraftee` guard on the player page), so accepting it on a
   * veteran and then dropping it would be a field that silently does nothing.
   * It is refused there by name instead.
   */
  combine?: FileCombine;
}

/**
 * Authored combine testing. Every drill is optional and any subset is legal.
 *
 * WHAT HAPPENS TO THESE NUMBERS IS THE WHOLE POINT. They do NOT become an
 * athletic rank, a grade or a percentile here. The import rolls the prospect
 * his full six-drill battery through generateCombineTesting — the same
 * derivation every generated prospect goes through, at his own percentile
 * within his own position group in this class — and then overlays whichever of
 * these the author wrote, exactly as `attrs` overlays a generated attribute
 * map. The Athletic Rank the draft board and the player card print is then
 * computed from the STORED six numbers at read time, by the one function both
 * screens call (classAthleticRanks, lib/combineRank.ts).
 *
 * So the rank cannot disagree with the times printed beside it: there is no
 * stored rank to disagree with. An authored 4.28 is ranked as a 4.28 among
 * whatever the rest of the class ran, and a prospect whose class has no
 * testing at all gets NO rank rather than a blank one — the column is absent,
 * which is the distinction the draft board already draws.
 */
export interface FileCombine {
  venue?: (typeof COMBINE_VENUES)[number];
  /** Seconds. */
  fortyYard?: number;
  /** Inches. */
  vertical?: number;
  /** Inches. */
  broadJump?: number;
  /** Seconds. */
  threeCone?: number;
  /** Seconds. */
  shuttle?: number;
  /** Reps at 225lb. `null` is "he did not lift", which is not the same as 0. */
  benchReps?: number | null;
}

export interface FileTeam {
  city: string;
  nickname: string;
  abbr: string;
  /** One of the file's own `conferences`. */
  conference: string;
  /** One of the file's own `divisions`. */
  division: string;
  /** Omit (or leave empty) and a full roster is generated for this team. */
  players?: FilePlayer[];
}

/**
 * One college draft class.
 *
 * `year` IS A LABEL, NOT A GAME YEAR. The class the import materialises is
 * stamped with the importing LEAGUE's season year, because `Player.draftYear`
 * is what the app uses to decide which class is on the clock and that has to
 * be the calendar of the league the class ends up in — a file authored for
 * 2026 and imported in 2028 still has to be the class the 2028 board picks
 * from. So this is derived-not-authored in the same documented sense as
 * `yearsRemaining`, and it is read for ordering and for naming the class in a
 * refusal.
 */
export interface FileDraftClass {
  year: number;
  /**
   * How good the class is across the board, in rating points, added to every
   * position group's own rolled bias (generateClassStrength). It moves the men
   * the import GENERATES to fill the class out, and nothing else — a prospect
   * whose `ovr` the file states keeps the overall the file stated, for the same
   * reason a rostered player does. A class that lists all
   * MAX_PROSPECTS_PER_CLASS men therefore generates nobody and this does
   * nothing, which is why a fully authored class publishes no class-strength
   * outlook rather than one describing numbers that were never applied.
   */
  strength?: number;
  players: FilePlayer[];
}

export interface LeagueFile {
  formatVersion: number;
  kind: typeof FILE_KIND;
  name: string;
  /** Informational only — never read back. */
  generatedAt?: string;
  generator?: string;
  /**
   * The two conference names and the four division names this league files its
   * teams under. ALWAYS PRESENT once parsed — a file that names none is given
   * the defaults here rather than leaving every reader to default for itself.
   */
  conferences: string[];
  divisions: string[];
  teams: FileTeam[];
  freeAgents?: FilePlayer[];
  draftClasses?: FileDraftClass[];
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/**
 * A refusal a human can act on. `message` is written to be shown verbatim in
 * the UI — it names the field, where it was, and what would have been legal.
 * Distinct from a generic Error so the import route can answer 400 (your file)
 * rather than 500 (our fault).
 */
export class LeagueFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeagueFileError';
  }
}

const fail = (msg: string): never => {
  throw new LeagueFileError(msg);
};

// ---------------------------------------------------------------------------
// Field readers. Every one of them takes the document path it is reading, so
// the refusal can say *where*.
// ---------------------------------------------------------------------------

/**
 * Characters allowed in any name rendered by the app: letters and digits in
 * any script, plus the punctuation real names actually use.
 *
 * This is NOT the XSS defence — React escapes every interpolated string, so
 * `<script>` in a nickname renders as the literal text `<script>` and always
 * did. This is a LAYOUT and LEGIBILITY defence: it removes control characters
 * and bidi overrides that can scramble a table row, and it strips emoji and
 * box-drawing runs that turn a standings row into a wall. Combined with the
 * length caps it means the worst a name can do is be silly.
 */
const DISALLOWED_NAME_CHARS = /[^\p{L}\p{N} '’.\-&/]/gu;

function readString(raw: unknown, path: string, max: number): string {
  if (typeof raw !== 'string') {
    return fail(`${path} must be a string (found ${describe(raw)}).`);
  }
  // `.length` is O(1). This check comes FIRST so a 100,000-character name is
  // refused without any regex ever touching it.
  if (raw.length > max) {
    return fail(`${path} is ${raw.length} characters; the maximum is ${max}.`);
  }
  const cleaned = raw.replace(DISALLOWED_NAME_CHARS, '').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) {
    return fail(
      `${path} contains no usable characters. Names may use letters, digits, spaces, ` +
        `apostrophes, periods, hyphens, ampersands and slashes.`,
    );
  }
  return cleaned;
}

/**
 * The same cleaning `readString` applies, for a display name that arrives
 * OUTSIDE the file — the league name someone types into the import form. It
 * is rendered in exactly the same places as a name from the file, so it is
 * held to exactly the same rules. Returns null when nothing usable survives,
 * which lets the caller fall back rather than store an empty title.
 */
export function sanitiseDisplayName(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string' || raw.length > max * 4) return null;
  const cleaned = raw.slice(0, max).replace(DISALLOWED_NAME_CHARS, '').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

function readInt(raw: unknown, path: string, lo: number, hi: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return fail(`${path} must be a number (found ${describe(raw)}).`);
  }
  if (!Number.isInteger(raw)) {
    return fail(`${path} must be a whole number (found ${raw}).`);
  }
  if (raw < lo || raw > hi) {
    return fail(`${path} is ${raw}; it must be between ${lo} and ${hi}.`);
  }
  return raw;
}

/**
 * A measured number, which is not an integer. Combine times carry hundredths
 * and `readInt` would refuse 4.42 outright, so this is the same contract —
 * finite, in range, refused rather than clamped — with a decimal budget. The
 * rounding is to the precision the game itself stores and prints (two places
 * for a stopwatch; see generateCombineTesting's `toFixed(2)`), so an author
 * who writes 4.4237 gets the 4.42 the card will show rather than a stored
 * number the display disagrees with.
 */
function readNumber(raw: unknown, path: string, lo: number, hi: number, dp: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return fail(`${path} must be a number (found ${describe(raw)}).`);
  }
  if (raw < lo || raw > hi) {
    return fail(`${path} is ${raw}; it must be between ${lo} and ${hi}.`);
  }
  return Number(raw.toFixed(dp));
}

function readEnum<T extends string>(raw: unknown, path: string, allowed: readonly T[]): T {
  if (typeof raw !== 'string') {
    return fail(`${path} must be one of ${allowed.join(', ')} (found ${describe(raw)}).`);
  }
  const hit = allowed.find((a) => a.toLowerCase() === raw.trim().toLowerCase());
  if (!hit) {
    return fail(`${path} is "${truncate(raw)}"; it must be one of: ${allowed.join(', ')}.`);
  }
  return hit;
}

function readArray(raw: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(raw)) return fail(`${path} must be an array (found ${describe(raw)}).`);
  // Length before contents: this is what makes 100,000 players cheap to refuse.
  if (raw.length > max) {
    return fail(`${path} holds ${raw.length} entries; the maximum is ${max}.`);
  }
  return raw;
}

function readObject(raw: unknown, path: string): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail(`${path} must be an object (found ${describe(raw)}).`);
  }
  return raw as Record<string, unknown>;
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'nothing';
  if (Array.isArray(v)) return 'an array';
  if (typeof v === 'string') return `the string "${truncate(v)}"`;
  if (typeof v === 'object') return 'an object';
  return String(v);
}

/** Never echo an attacker's whole string back into an error message. */
function truncate(s: string, n = 40): string {
  const flat = s.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, n);
  return s.length > n ? `${flat}…` : flat;
}

// ---------------------------------------------------------------------------
// PARSE + VALIDATE
// ---------------------------------------------------------------------------

/**
 * Turns raw uploaded text into a `LeagueFile` or throws a `LeagueFileError`
 * explaining why not. Pure: no database, no clock, no randomness — which is
 * what makes it testable against every hostile file without writing a row.
 *
 * The order of the checks is the security property. Size, then JSON, then
 * version, then shape, then contents; each stage is cheaper than the one after
 * it, so the expensive stages only ever see input that has already earned it.
 */
export function parseLeagueFile(text: string): LeagueFile {
  // --- 0. Size --------------------------------------------------------------
  // The route refuses on Content-Length before reading a body at all; this is
  // the same check applied to what actually arrived, because a header is a
  // claim and the body is the fact.
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > FILE_LIMITS.MAX_BYTES) {
    fail(
      `The file is ${(bytes / 1_048_576).toFixed(1)}MB; the maximum is ` +
        `${FILE_LIMITS.MAX_BYTES / 1_048_576}MB. A full 32-team league with complete rosters and a draft class is under 1.5MB.`,
    );
  }
  if (text.trim().length === 0) fail('The file is empty.');

  // --- 1. JSON --------------------------------------------------------------
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    // Catches both a syntax error (truncated file, not JSON at all) and the
    // RangeError V8 raises when a deeply nested document exhausts the stack
    // inside JSON.parse. Both are the same answer to the person uploading.
    const detail = err instanceof Error ? err.message : String(err);
    fail(`This is not valid JSON: ${truncate(detail, 120)}`);
  }
  const root = readObject(doc, 'The file');

  // --- 2. Version and kind --------------------------------------------------
  if (root.formatVersion === undefined) {
    fail(
      'The file has no "formatVersion". Every Dynasty GM league file starts with ' +
        `"formatVersion": ${FORMAT_VERSION} — this may not be a league file.`,
    );
  }
  const version = root.formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    fail(`"formatVersion" must be a whole number (found ${describe(version)}).`);
  }
  if (!SUPPORTED_VERSIONS.includes(version as number)) {
    const v = version as number;
    fail(
      v > FORMAT_VERSION
        ? `This file is format version ${v}, which was written by a newer version of Dynasty GM. ` +
            `This build reads version ${SUPPORTED_VERSIONS.join(' and ')}. Update the app, or ask for a version ${FORMAT_VERSION} export.`
        : `This file is format version ${v}, which this build no longer reads. ` +
            `Supported: ${SUPPORTED_VERSIONS.join(', ')}.`,
    );
  }
  if (root.kind !== FILE_KIND) {
    fail(`"kind" must be "${FILE_KIND}" (found ${describe(root.kind)}). This does not look like a league file.`);
  }
  // A version number that does not constrain the document is decoration. A
  // file declaring 1 and then using a version-2 field would load here and be
  // refused by every older build with eight "must be one of AFC, NFC" errors
  // instead of one sentence about the version.
  if (version === 1) {
    const used = V2_FIELDS.filter((f) => root[f] !== undefined);
    if (used.length > 0) {
      fail(
        `This file declares "formatVersion": 1 but uses ${used.map((f) => `"${f}"`).join(' and ')}, ` +
          `which ${used.length === 1 ? 'is' : 'are'} only available from format version ${FORMAT_VERSION}. ` +
          `Change "formatVersion" to ${FORMAT_VERSION}, or remove ${used.length === 1 ? 'that field' : 'those fields'}.`,
      );
    }
  }

  // --- 3. Shape -------------------------------------------------------------
  const name = readString(root.name ?? 'Imported League', 'name', FILE_LIMITS.MAX_LEAGUE_NAME);
  const conferences = readLabels(
    root.conferences, 'conferences', DEFAULT_CONFERENCES,
    FILE_LIMITS.CONFERENCE_COUNT, FILE_LIMITS.MAX_CONFERENCE_NAME,
  );
  const divisions = readLabels(
    root.divisions, 'divisions', DEFAULT_DIVISIONS,
    FILE_LIMITS.DIVISION_COUNT, FILE_LIMITS.MAX_DIVISION_NAME,
  );

  const rawTeams = readArray(root.teams, 'teams', FILE_LIMITS.TEAM_COUNT + 1);
  if (rawTeams.length !== FILE_LIMITS.TEAM_COUNT) {
    fail(
      `teams holds ${rawTeams.length} teams; a league needs exactly ${FILE_LIMITS.TEAM_COUNT}. ` +
        `The season schedule is built from ${conferences.length} conferences of ${divisions.length} divisions ` +
        `of ${FILE_LIMITS.TEAMS_PER_DIVISION} teams and cannot be produced from any other count.`,
    );
  }

  const teams: FileTeam[] = rawTeams.map((t, i) => readTeam(t, `teams[${i}]`, conferences, divisions));
  assertLeagueStructure(teams, conferences, divisions);

  const freeAgents = root.freeAgents === undefined
    ? undefined
    : readArray(root.freeAgents, 'freeAgents', FILE_LIMITS.MAX_FREE_AGENTS)
        .map((p, i) => readPlayer(p, `freeAgents[${i}]`));

  const draftClasses = root.draftClasses === undefined
    ? undefined
    : readArray(root.draftClasses, 'draftClasses', FILE_LIMITS.MAX_DRAFT_CLASSES + 1)
        .map((c, i) => readDraftClass(c, `draftClasses[${i}]`));
  if (draftClasses && draftClasses.length > FILE_LIMITS.MAX_DRAFT_CLASSES) {
    fail(
      `draftClasses holds ${draftClasses.length} classes; this build reads ${FILE_LIMITS.MAX_DRAFT_CLASSES}. ` +
        'A league has exactly one class on the clock — the newest one nobody has picked from — and a second ' +
        'class supplied up front would take over the draft board a year early. Next year\'s class is generated ' +
        'at the start of next preseason.',
    );
  }

  return {
    formatVersion: FORMAT_VERSION,
    kind: FILE_KIND,
    name,
    generatedAt: typeof root.generatedAt === 'string' ? truncate(root.generatedAt, 40) : undefined,
    generator: typeof root.generator === 'string' ? truncate(root.generator, 60) : undefined,
    conferences,
    divisions,
    teams,
    freeAgents,
    draftClasses,
  };
}

/**
 * The conference or division names, or the defaults.
 *
 * Held to the same rules as every other display name — the same alphabet, the
 * same length cap, the same sanitisation — because they are rendered in the
 * same standings panels and the same division headers as a nickname is.
 *
 * THE COUNT IS STRUCTURAL AND THE STRINGS ARE NOT. 2 x 4 x 4 = 32 is the only
 * arrangement lib/schedule.ts can build a season from (see
 * assertLeagueStructure), so a file offering three conferences is refused with
 * the arithmetic; what those two conferences are CALLED is the author's.
 *
 * Duplicates are refused rather than deduplicated, because a league with one
 * conference called "East" twice has four divisions of eight and cannot be
 * scheduled, and because `readEnum` matches case-insensitively — "East" and
 * "east" would otherwise be one bucket a team could land in by either name.
 */
function readLabels(
  raw: unknown,
  path: string,
  fallback: readonly string[],
  count: number,
  maxLen: number,
): string[] {
  if (raw === undefined) return [...fallback];
  const rows = readArray(raw, path, count + 1);
  if (rows.length !== count) {
    fail(
      `${path} holds ${rows.length} names; a league needs exactly ${count}. ` +
        `The season schedule is built from ${FILE_LIMITS.CONFERENCE_COUNT} conferences of ` +
        `${FILE_LIMITS.DIVISION_COUNT} divisions of ${FILE_LIMITS.TEAMS_PER_DIVISION} teams, ` +
        `which is the only arrangement that makes ${FILE_LIMITS.TEAM_COUNT}.`,
    );
  }
  const out = rows.map((v, i) => readString(v, `${path}[${i}]`, maxLen));
  const seen = new Map<string, number>();
  out.forEach((v, i) => {
    const key = v.toLowerCase();
    const prior = seen.get(key);
    if (prior !== undefined) {
      fail(`${path}[${i}] is "${v}", which ${path}[${prior}] already uses. Every name must be distinct.`);
    }
    seen.set(key, i);
  });
  return out;
}

/**
 * One draft class. The prospect count is checked before a single prospect is
 * read, for the same reason every other array's length is.
 */
function readDraftClass(raw: unknown, path: string): FileDraftClass {
  const c = readObject(raw, path);
  const year = readInt(c.year, `${path}.year`, FILE_LIMITS.DRAFT_YEAR_MIN, FILE_LIMITS.DRAFT_YEAR_MAX);
  const rows = readArray(c.players, `${path}.players`, FILE_LIMITS.MAX_PROSPECTS_PER_CLASS);
  const out: FileDraftClass = {
    year,
    players: rows.map((p, i) => readPlayer(p, `${path}.players[${i}]`, { prospect: true })),
  };
  if (c.strength !== undefined) {
    out.strength = readInt(
      c.strength, `${path}.strength`,
      FILE_LIMITS.CLASS_STRENGTH_MIN, FILE_LIMITS.CLASS_STRENGTH_MAX,
    );
  }
  return out;
}

function readTeam(
  raw: unknown,
  path: string,
  conferences: readonly string[],
  divisions: readonly string[],
): FileTeam {
  const t = readObject(raw, path);
  const team: FileTeam = {
    city: readString(t.city, `${path}.city`, FILE_LIMITS.MAX_CITY),
    nickname: readString(t.nickname, `${path}.nickname`, FILE_LIMITS.MAX_NICKNAME),
    abbr: readAbbr(t.abbr, `${path}.abbr`),
    // Still a whitelist, just a whitelist the FILE supplied: a team can only
    // be filed under a conference this file declared, so a typo is a refusal
    // naming the four legal answers rather than a ninth division of one.
    conference: readEnum(t.conference, `${path}.conference`, conferences),
    division: readEnum(t.division, `${path}.division`, divisions),
  };

  if (t.players !== undefined) {
    const rows = readArray(t.players, `${path}.players`, FILE_LIMITS.MAX_PLAYERS_PER_TEAM);
    team.players = rows.map((p, i) => readPlayer(p, `${path}.players[${i}]`));
    assertRosterIsFillable(team.players, path);
  }
  return team;
}

/**
 * A roster has to be able to reach every position's minimum without going over
 * the roster limit.
 *
 * The case this catches is narrow and nasty: 53 players and no kicker. The
 * roster is full, so there is no room to add the missing one, and the only
 * ways out are to silently cut somebody the author chose (mutating a file that
 * said exactly what it wanted) or to ship a team that cannot line up for a
 * field goal. Refusing it here, where the message can name the positions and
 * do the arithmetic, is better than either.
 */
function assertRosterIsFillable(players: FilePlayer[], path: string): void {
  const have = new Map<string, number>();
  for (const p of players) have.set(p.position, (have.get(p.position) ?? 0) + 1);

  const missing: string[] = [];
  let needed = 0;
  for (const pos of POSITIONS) {
    const short = ROSTER_TARGETS[pos].min - (have.get(pos) ?? 0);
    if (short > 0) {
      needed += short;
      missing.push(`${short} ${pos}`);
    }
  }
  if (players.length + needed > FILE_LIMITS.MAX_PLAYERS_PER_TEAM) {
    fail(
      `${path}.players holds ${players.length} players but still needs ${missing.join(', ')} to field every ` +
        `position, which would be ${players.length + needed} — over the ${FILE_LIMITS.MAX_PLAYERS_PER_TEAM}-man limit. ` +
        'Either add those players yourself or make room for them.',
    );
  }
}

/**
 * Abbreviations are a stricter alphabet than names: they are rendered inside
 * fixed-width crests and table columns across every screen, so anything but
 * 2-4 latin letters or digits is refused outright rather than stripped.
 */
function readAbbr(raw: unknown, path: string): string {
  if (typeof raw !== 'string') return fail(`${path} must be a string (found ${describe(raw)}).`);
  const up = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,4}$/.test(up)) {
    return fail(
      `${path} is "${truncate(raw)}"; an abbreviation must be ${FILE_LIMITS.ABBR_MIN}-${FILE_LIMITS.ABBR_MAX} ` +
        `letters or digits (A-Z, 0-9), like "BOS".`,
    );
  }
  return up;
}

/**
 * `prospect: true` is set for the men inside a `draftClasses` entry, and it
 * changes which fields are legal rather than which are kept. A prospect has
 * combine testing and has not played a professional season or signed a
 * professional contract, so those last two are refused BY NAME rather than
 * read and dropped — a field that silently does nothing is the quiet half of
 * the same failure as a number that silently disagrees with itself.
 */
function readPlayer(raw: unknown, path: string, opts: { prospect?: boolean } = {}): FilePlayer {
  const p = readObject(raw, path);

  const position = readEnum(p.position, `${path}.position`, POSITIONS) as Position;
  const firstName = readString(p.firstName, `${path}.firstName`, FILE_LIMITS.MAX_PERSON_NAME);
  const lastName = readString(p.lastName, `${path}.lastName`, FILE_LIMITS.MAX_PERSON_NAME);
  const age = readInt(p.age, `${path}.age`, FILE_LIMITS.AGE_MIN, FILE_LIMITS.AGE_MAX);
  const ovr = readInt(p.ovr, `${path}.ovr`, FILE_LIMITS.RATING_MIN, FILE_LIMITS.RATING_MAX);

  const out: FilePlayer = { firstName, lastName, position, age, ovr };

  if (p.experience !== undefined) {
    // Derived ceiling, not an authored one: nobody has more pro seasons than
    // years since they turned AGE_MIN, whatever the file says. The floor is
    // read from AGE_MIN rather than typed as 18 because it IS that bound — the
    // youngest a player in this league may be — and the reference page at
    // /import/reference states the rule in those terms.
    const exp = readInt(p.experience, `${path}.experience`, 0, FILE_LIMITS.EXPERIENCE_MAX);
    if (opts.prospect && exp > 0) {
      fail(
        `${path}.experience is ${exp}, and this player is a draft prospect — nobody in a draft class has ` +
          'played a professional season. Write 0, or remove the field.',
      );
    }
    out.experience = Math.min(exp, Math.max(0, age - FILE_LIMITS.AGE_MIN));
  }
  if (p.heightIn !== undefined) {
    out.heightIn = readInt(p.heightIn, `${path}.heightIn`, FILE_LIMITS.HEIGHT_MIN, FILE_LIMITS.HEIGHT_MAX);
  }
  if (p.weightLb !== undefined) {
    out.weightLb = readInt(p.weightLb, `${path}.weightLb`, FILE_LIMITS.WEIGHT_MIN, FILE_LIMITS.WEIGHT_MAX);
  }
  if (p.college !== undefined) {
    out.college = readString(p.college, `${path}.college`, FILE_LIMITS.MAX_COLLEGE);
  }
  if (p.potential !== undefined) {
    const pot = readInt(p.potential, `${path}.potential`, FILE_LIMITS.RATING_MIN, FILE_LIMITS.RATING_MAX);
    out.potential = Math.max(pot, ovr); // a ceiling below the floor is not a ceiling
  }
  if (p.devTrait !== undefined) {
    out.devTrait = readEnum(p.devTrait, `${path}.devTrait`, DEV_TRAITS);
  }
  if (p.attrs !== undefined) {
    out.attrs = readAttrs(p.attrs, `${path}.attrs`, position);
  }
  if (p.contract !== undefined) {
    if (opts.prospect) {
      fail(
        `${path}.contract is a professional contract, and this player is a draft prospect — nobody in a ` +
          'draft class is under contract yet. Remove the field; a drafted rookie is paid by the rookie scale.',
      );
    }
    out.contract = readContract(p.contract, `${path}.contract`);
  }
  if (p.combine !== undefined) {
    if (!opts.prospect) {
      fail(
        `${path}.combine is combine testing, which only a draft prospect has. Move this player into a ` +
          '"draftClasses" entry, or remove the field — nothing in the app shows testing for a player who ' +
          'is not in a draft class.',
      );
    }
    out.combine = readCombine(p.combine, `${path}.combine`);
  }
  return out;
}

/**
 * Authored combine numbers. Every drill optional, every one bounded, and the
 * venue a whitelist rather than a cast.
 *
 * `benchReps: null` IS A VALUE AND IS NOT THE SAME AS OMITTING IT. Null is
 * "he did not lift", which is what six positions do (SKIPS_BENCH), and it
 * survives into the stored row so the rank is taken over the drills he
 * actually ran. Omitting the field instead lets the derivation roll him one.
 */
function readCombine(raw: unknown, path: string): FileCombine {
  const c = readObject(raw, path);
  const out: FileCombine = {};
  if (c.venue !== undefined) out.venue = readEnum(c.venue, `${path}.venue`, COMBINE_VENUES);
  if (c.fortyYard !== undefined) {
    out.fortyYard = readNumber(c.fortyYard, `${path}.fortyYard`, FILE_LIMITS.FORTY_MIN, FILE_LIMITS.FORTY_MAX, 2);
  }
  if (c.threeCone !== undefined) {
    out.threeCone = readNumber(c.threeCone, `${path}.threeCone`, FILE_LIMITS.CONE_MIN, FILE_LIMITS.CONE_MAX, 2);
  }
  if (c.shuttle !== undefined) {
    out.shuttle = readNumber(c.shuttle, `${path}.shuttle`, FILE_LIMITS.SHUTTLE_MIN, FILE_LIMITS.SHUTTLE_MAX, 2);
  }
  if (c.vertical !== undefined) {
    out.vertical = readInt(c.vertical, `${path}.vertical`, FILE_LIMITS.VERTICAL_MIN, FILE_LIMITS.VERTICAL_MAX);
  }
  if (c.broadJump !== undefined) {
    out.broadJump = readInt(c.broadJump, `${path}.broadJump`, FILE_LIMITS.BROAD_MIN, FILE_LIMITS.BROAD_MAX);
  }
  if (c.benchReps !== undefined) {
    out.benchReps = c.benchReps === null
      ? null
      : readInt(c.benchReps, `${path}.benchReps`, FILE_LIMITS.BENCH_MIN, FILE_LIMITS.BENCH_MAX);
  }
  return out;
}

/**
 * Attributes are read against the catalogue in lib/ratings.ts. Unknown keys
 * are dropped rather than refused — a file written against a future build that
 * added an attribute should still load here, and an attribute this build does
 * not have is meaningless to it either way. Every value that IS kept must be a
 * legal rating.
 */
function readAttrs(raw: unknown, path: string, position: Position): AttrMap {
  const obj = readObject(raw, path);
  const keys = Object.keys(obj);
  if (keys.length > FILE_LIMITS.MAX_ATTRS_PER_PLAYER) {
    fail(`${path} holds ${keys.length} attributes; the maximum is ${FILE_LIMITS.MAX_ATTRS_PER_PLAYER}.`);
  }
  const wanted = new Set(attrsForPosition(position));
  const out: AttrMap = {};
  for (const key of keys) {
    if (!ATTRIBUTE_BY_KEY[key] || !wanted.has(key)) continue;
    out[key] = readInt(obj[key], `${path}.${key}`, FILE_LIMITS.RATING_MIN, FILE_LIMITS.RATING_MAX);
  }
  return out;
}

function readContract(raw: unknown, path: string): FileContract {
  const c = readObject(raw, path);
  const years = readInt(c.years, `${path}.years`, 1, FILE_LIMITS.CONTRACT_YEARS_MAX);
  const apy = readInt(c.apy, `${path}.apy`, FILE_LIMITS.CONTRACT_APY_MIN, FILE_LIMITS.CONTRACT_APY_MAX);
  const out: FileContract = { apy, years };
  if (c.yearsRemaining !== undefined) {
    const rem = readInt(c.yearsRemaining, `${path}.yearsRemaining`, 1, FILE_LIMITS.CONTRACT_YEARS_MAX);
    out.yearsRemaining = Math.min(rem, years); // derived, so clamped
  }
  return out;
}

/**
 * The structural check the scheduler actually depends on.
 *
 * lib/schedule.ts builds weeks 1-6 as a double round robin inside each
 * division and SKIPS any division that does not hold exactly four teams
 * (`if (group.length < 4) continue`), then draws perfect matchings over the
 * whole league for weeks 7-17 — which needs an even number of teams and enough
 * non-division opponents to go round. A league of 32 in 8 divisions of 4 is
 * the only arrangement that satisfies both, so anything else is refused HERE,
 * where the message can be useful, rather than silently producing a season
 * with missing weeks.
 */
function assertLeagueStructure(
  teams: FileTeam[],
  conferences: readonly string[],
  divisions: readonly string[],
): void {
  const seen = new Map<string, number>();
  teams.forEach((t, i) => {
    const prior = seen.get(t.abbr);
    if (prior !== undefined) {
      fail(`teams[${i}].abbr "${t.abbr}" is already used by teams[${prior}]. Every abbreviation must be unique.`);
    }
    seen.set(t.abbr, i);
  });

  // The key joins on NUL rather than a space, because both halves are now
  // author-supplied: conferences ["A", "A B"] with divisions ["B C", "C"] would
  // make "A B C" two different ways on a space, and two divisions sharing one
  // bucket is a league of 8 and 0 that this check would call 4 and 4.
  const SEP = '\u0000';
  const buckets = new Map<string, string[]>();
  for (const c of conferences) for (const d of divisions) buckets.set(`${c}${SEP}${d}`, []);
  for (const t of teams) buckets.get(`${t.conference}${SEP}${t.division}`)!.push(t.abbr);

  const wrong = [...buckets.entries()].filter(([, v]) => v.length !== FILE_LIMITS.TEAMS_PER_DIVISION);
  if (wrong.length > 0) {
    const detail = wrong
      .map(([k, v]) => `${k.replace(SEP, ' ')} has ${v.length}${v.length ? ` (${v.join(', ')})` : ''}`)
      .join('; ');
    fail(
      `Every division must hold exactly ${FILE_LIMITS.TEAMS_PER_DIVISION} teams, and ${wrong.length} do not: ${detail}. ` +
        'The season schedule is a division round robin and cannot be built otherwise.',
    );
  }
}

// ---------------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------------

/**
 * Reads an existing league back out as a file. Six queries, no per-player
 * round trips — this is a read path on a page someone is waiting on.
 *
 * Everything derived is left out: no ids, no schedule, no standings, no
 * scouting reports, no league history, no draft picks. A league file describes
 * a STARTING POINT, not a save game. Exporting a league in week 12 and
 * importing it gives you those franchises and those players in a fresh
 * preseason, which is the thing people actually want to share.
 *
 * THE COLLEGE CLASS IS AN EXCEPTION AND IT IS NOT A NEW ONE. Prospects were
 * always in this export — `status: FREE_AGENT` catches them, because that is
 * what an undrafted prospect's status is — they were just filed under
 * `freeAgents`, where up to 400 of them crowded out the real market the file
 * meant to describe and came back as veterans on the next import. Version 2
 * has somewhere to put them, so they go there: the newest class still flagged
 * `isDraftee`, which is the one the board is picking from, and the free agent
 * pool is once again the free agent pool. A fantasy league's pool is flagged
 * `isDraftee` with NO draftYear at all (lib/gen/league.ts) and those men are
 * the league's own veterans, so they stay in `freeAgents` where they belong.
 */
export async function exportLeagueFile(leagueId: string): Promise<LeagueFile> {
  const league = await prisma.league.findUniqueOrThrow({
    where: { id: leagueId },
    select: { id: true, name: true },
  });

  const [teams, players] = await Promise.all([
    prisma.team.findMany({
      where: { leagueId },
      orderBy: [{ conference: 'asc' }, { division: 'asc' }, { abbr: 'asc' }],
      select: { id: true, city: true, nickname: true, abbr: true, conference: true, division: true },
    }),
    prisma.player.findMany({
      where: { leagueId, status: { in: ['ACTIVE', 'INJURED', 'FREE_AGENT'] } },
      select: {
        teamId: true, firstName: true, lastName: true, position: true, age: true,
        experience: true, heightIn: true, weightLb: true, college: true,
        trueAttrs: true, trueOvr: true, potential: true, devTrait: true,
        isDraftee: true, draftYear: true, combineTesting: true,
        contract: { select: { years: true, yearsRemaining: true, baseSalaries: true, signingBonus: true } },
      },
    }),
  ]);

  // The class on the clock is the NEWEST one still flagged isDraftee — the
  // same derivation liveDraftClassYear (lib/draft.ts) uses, because a file
  // that disagreed with the draft board about which class is current would
  // export a class nobody is picking from.
  const classYear = players.reduce<number | null>(
    (best, p) => (p.isDraftee && p.draftYear != null && (best === null || p.draftYear > best) ? p.draftYear : best),
    null,
  );

  const byTeam = new Map<string, FilePlayer[]>();
  const freeAgents: FilePlayer[] = [];
  const prospects: FilePlayer[] = [];
  for (const p of players) {
    const isProspect = p.isDraftee && p.draftYear != null && p.draftYear === classYear;
    const row = toFilePlayer(p, isProspect);
    if (p.teamId) {
      if (!byTeam.has(p.teamId)) byTeam.set(p.teamId, []);
      byTeam.get(p.teamId)!.push(row);
    } else if (isProspect) {
      if (prospects.length < FILE_LIMITS.MAX_PROSPECTS_PER_CLASS) prospects.push(row);
    } else if (freeAgents.length < FILE_LIMITS.MAX_FREE_AGENTS) {
      freeAgents.push(row);
    }
  }

  return {
    formatVersion: FORMAT_VERSION,
    kind: FILE_KIND,
    name: league.name,
    generatedAt: new Date().toISOString(),
    generator: 'Dynasty GM Football',
    // The league's own labels, read off its own teams — an imported league may
    // be filed under any two names (see readLabels).
    conferences: conferencesOf(teams),
    divisions: divisionsOf(teams),
    teams: teams.map((t) => ({
      city: t.city,
      nickname: t.nickname,
      abbr: t.abbr,
      conference: t.conference,
      division: t.division,
      // A roster is capped on the way OUT too. A save that somehow carries 60
      // players cannot export a file its own importer would refuse.
      players: (byTeam.get(t.id) ?? [])
        .sort((a, b) => b.ovr - a.ovr)
        .slice(0, FILE_LIMITS.MAX_PLAYERS_PER_TEAM),
    })),
    freeAgents,
    // `year` is the label the class carried in the league it came out of; the
    // import stamps its own (see FileDraftClass). No `strength`: the bias that
    // shaped this class moved ratings that are now ON these men, and restating
    // it would shift a fully authored class a second time.
    draftClasses: classYear !== null && prospects.length > 0
      ? [{ year: classYear, players: prospects }]
      : undefined,
  };
}

type ExportedPlayer = {
  firstName: string; lastName: string; position: string; age: number; experience: number;
  heightIn: number; weightLb: number; college: string; trueAttrs: string; trueOvr: number;
  potential: number; devTrait: string; combineTesting: string;
  contract: { years: number; yearsRemaining: number; baseSalaries: string; signingBonus: number } | null;
};

function toFilePlayer(p: ExportedPlayer, withCombine = false): FilePlayer {
  const out: FilePlayer = {
    firstName: p.firstName,
    lastName: p.lastName,
    position: p.position as Position,
    age: p.age,
    experience: p.experience,
    heightIn: p.heightIn,
    weightLb: p.weightLb,
    college: p.college,
    ovr: p.trueOvr,
    potential: p.potential,
    devTrait: (DEV_TRAITS as readonly string[]).includes(p.devTrait)
      ? (p.devTrait as FilePlayer['devTrait'])
      : 'Normal',
    attrs: readJson<AttrMap>(p.trueAttrs, {}),
  };
  if (withCombine) {
    // Only the six numbers, and only when the venue is there — an older save
    // predates combine testing entirely and writes `{}`, and a venue-less blob
    // is what the player card already treats as "no testing on file".
    const t = readJson<Partial<FileCombine>>(p.combineTesting, {});
    if (t.venue) out.combine = t as FileCombine;
  }
  if (p.contract) {
    const bases = readJson<number[]>(p.contract.baseSalaries, []);
    const total = bases.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0) + p.contract.signingBonus;
    const years = Math.max(1, p.contract.years);
    out.contract = {
      apy: clamp(Math.round(total / years), FILE_LIMITS.CONTRACT_APY_MIN, FILE_LIMITS.CONTRACT_APY_MAX),
      years: Math.min(years, FILE_LIMITS.CONTRACT_YEARS_MAX),
      yearsRemaining: clamp(p.contract.yearsRemaining, 1, Math.min(years, FILE_LIMITS.CONTRACT_YEARS_MAX)),
    };
  }
  return out;
}

/**
 * Serialises a league file so a person can actually read it.
 *
 * `JSON.stringify(f, null, 2)` puts every attribute of every player on its own
 * line and turns a 1.4MB document into a 4MB one that scrolls for a week.
 * This keeps the structure indented — you can see the teams — but writes each
 * player as a single line, which is both a third of the size and far easier to
 * scan or diff. The output is ordinary JSON; nothing has to parse it specially.
 */
export function serializeLeagueFile(f: LeagueFile): string {
  const lines: string[] = ['{'];
  lines.push(`  "formatVersion": ${f.formatVersion},`);
  lines.push(`  "kind": ${JSON.stringify(f.kind)},`);
  lines.push(`  "name": ${JSON.stringify(f.name)},`);
  if (f.generatedAt) lines.push(`  "generatedAt": ${JSON.stringify(f.generatedAt)},`);
  if (f.generator) lines.push(`  "generator": ${JSON.stringify(f.generator)},`);
  lines.push(`  "conferences": ${JSON.stringify(f.conferences)},`);
  lines.push(`  "divisions": ${JSON.stringify(f.divisions)},`);

  lines.push('  "teams": [');
  f.teams.forEach((t, ti) => {
    lines.push('    {');
    lines.push(`      "city": ${JSON.stringify(t.city)},`);
    lines.push(`      "nickname": ${JSON.stringify(t.nickname)},`);
    lines.push(`      "abbr": ${JSON.stringify(t.abbr)},`);
    lines.push(`      "conference": ${JSON.stringify(t.conference)},`);
    lines.push(`      "division": ${JSON.stringify(t.division)}${t.players ? ',' : ''}`);
    if (t.players) {
      lines.push('      "players": [');
      t.players.forEach((p, pi) => {
        lines.push(`        ${JSON.stringify(p)}${pi < t.players!.length - 1 ? ',' : ''}`);
      });
      lines.push('      ]');
    }
    lines.push(`    }${ti < f.teams.length - 1 ? ',' : ''}`);
  });
  lines.push(f.freeAgents || f.draftClasses ? '  ],' : '  ]');

  if (f.freeAgents) {
    lines.push('  "freeAgents": [');
    f.freeAgents.forEach((p, i) => {
      lines.push(`    ${JSON.stringify(p)}${i < f.freeAgents!.length - 1 ? ',' : ''}`);
    });
    lines.push(f.draftClasses ? '  ],' : '  ]');
  }

  if (f.draftClasses) {
    lines.push('  "draftClasses": [');
    f.draftClasses.forEach((c, ci) => {
      lines.push('    {');
      lines.push(`      "year": ${c.year},`);
      if (c.strength !== undefined) lines.push(`      "strength": ${c.strength},`);
      lines.push('      "players": [');
      c.players.forEach((p, pi) => {
        lines.push(`        ${JSON.stringify(p)}${pi < c.players.length - 1 ? ',' : ''}`);
      });
      lines.push('      ]');
      lines.push(`    }${ci < f.draftClasses!.length - 1 ? ',' : ''}`);
    });
    lines.push('  ]');
  }
  lines.push('}');
  return lines.join('\n');
}

/** A filesystem-safe download name derived from the league's own name. */
export function leagueFileName(leagueName: string): string {
  const slug = leagueName.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40);
  return `${slug || 'league'}.dgm.json`;
}

// ---------------------------------------------------------------------------
// IMPORT — turning a validated file into something createLeague can build
// ---------------------------------------------------------------------------

/**
 * Fills the gaps.
 *
 * A shared file may be nothing but 32 names, and it still has to produce a
 * league that plays: rosters, a free agent pool, contracts, a schedule. This
 * is where "what the file said" and "what the generators produce" are merged,
 * using the SAME generators as a from-scratch league so an imported save is
 * not a second-class one.
 *
 * The rules, in order of precedence:
 *   - A team with no `players` gets a full generated roster — literally
 *     `generateRoster`, the same call createLeague makes.
 *   - A team WITH players keeps every one of them, and is topped up ONLY to
 *     each position's roster minimum — a team with no kicker cannot play, but
 *     a team with 41 players and every position covered is a team with 41
 *     players and is left alone.
 *   - Names are made unique league-wide. Two players called Marcus Whitfield
 *     is a bug the app already went out of its way to fix (see NameRegistry);
 *     an import must not reintroduce it, and contracts are matched back to
 *     players by name, so uniqueness is load-bearing here as well as cosmetic.
 *   - Attributes given in the file are kept and the overall is RECOMPUTED from
 *     them. Attributes not given are generated around the file's `ovr`.
 */
export function planFromLeagueFile(file: LeagueFile, rng: Rng): LeagueImportPlan {
  const names = new NameRegistry();
  const contracts = new Map<string, PlannedContract>();
  const rosters = new Map<string, GeneratedPlayer[]>();

  // PASS ONE: claim every name the FILE asked for, before a single player is
  // generated. Order matters and this used to be wrong: materialising a player
  // generates a throwaway base player first, and that base drew its own name
  // from this same registry — so roughly one imported player in seventy found
  // his own name already taken by the throwaway and came out as "Marcus
  // Aguirre Jr." Measured on the first round-trip test: 20 of 1,374 players
  // silently renamed. Claiming the file's names up front means an imported
  // name is only ever altered when THE FILE ITSELF contains a duplicate, which
  // is the only time altering it is the right answer.
  const resolved = new Map<FilePlayer, { firstName: string; lastName: string }>();
  const claim = (fp: FilePlayer) => resolved.set(fp, uniqueName(fp.firstName, fp.lastName, names));
  for (const team of file.teams) for (const fp of team.players ?? []) claim(fp);
  for (const fp of file.freeAgents ?? []) claim(fp);
  for (const cls of file.draftClasses ?? []) for (const fp of cls.players) claim(fp);

  // PASS TWO: build them, and generate whatever the file left out. Every
  // generated name is now drawn against a registry that already holds the
  // whole file, so a fill-in can never take an imported player's name either.
  for (const team of file.teams) {
    const supplied = team.players ?? [];
    let roster: GeneratedPlayer[];

    if (supplied.length === 0) {
      // [TUNE] parity with createLeague: teams vary around the league mean.
      roster = generateRoster(rng, rng.normal(0, 4), names);
    } else {
      roster = supplied.map((fp) => materialisePlayer(fp, resolved.get(fp)!, rng, contracts));
      fillRoster(roster, rng, names);
    }
    rosters.set(team.abbr, roster);
  }

  const freeAgents: GeneratedPlayer[] = (file.freeAgents ?? []).map((fp) =>
    materialisePlayer(fp, resolved.get(fp)!, rng, contracts),
  );
  const floor = file.freeAgents === undefined ? FREE_AGENT_DEFAULT : FREE_AGENT_FLOOR;
  while (freeAgents.length < floor) {
    freeAgents.push(generatePlayer(rng, { ovrTarget: rng.normalClamped(GENERATION.FREE_AGENT_OVR_MEAN, GENERATION.FREE_AGENT_OVR_SD, GENERATION.FREE_AGENT_OVR_MIN, GENERATION.FREE_AGENT_OVR_MAX), names }));
  }

  return {
    teams: file.teams.map((t) => ({
      city: t.city,
      nickname: t.nickname,
      abbr: t.abbr,
      conference: t.conference,
      division: t.division,
    })),
    rosters,
    freeAgents,
    contracts,
    names,
    prospects: file.draftClasses?.[0] ? planDraftClass(file.draftClasses[0], resolved, rng, names) : undefined,
  };
}

/**
 * One authored draft class -> the class the league opens with.
 *
 * THERE IS NO SECOND CLASS GENERATOR HERE, and that is the whole design. The
 * authored prospects are materialised exactly as a rostered player is — the
 * same materialisePlayer, so the same "attributes win, ovr is a target" rule
 * and the same complete-person guarantee — and are then handed to
 * `generateDraftClass` as the FRONT of the class, which:
 *
 *   - rolls the class-strength personality through generateClassStrength, with
 *     the authored `strength` as its across-the-board bias, so there is one
 *     such mechanism and not two;
 *   - generates only the REMAINDER, up to the size a generated class is, so a
 *     class of 60 named prospects is still a draftable 400 and a complete
 *     authored class generates nobody;
 *   - runs its combine pass over authored and generated men together, which is
 *     the only way a prospect's testing percentile can be his rank in the class
 *     he is actually in.
 *
 * A class is topped up for the same reason a roster is: seven rounds of
 * thirty-two picks have to find somebody to call, and a file is allowed to
 * name twelve prospects and mean it.
 */
function planDraftClass(
  cls: FileDraftClass,
  resolved: Map<FilePlayer, { firstName: string; lastName: string }>,
  rng: Rng,
  names: NameRegistry,
): NonNullable<LeagueImportPlan['prospects']> {
  const authored = cls.players.map((fp) => {
    const p = materialisePlayer(fp, resolved.get(fp)!, rng, new Map());
    // A prospect's card carries a college stat line as well as a workout, and
    // nothing in the file describes one. Generated from the attributes he
    // ended up with, by the same call generateDraftClass makes.
    p.collegeProfile = generateCollegeProfile(rng, p.position, p.trueAttrs, p.trueOvr);
    // Rookies: a prospect has no pro seasons, whatever his age.
    p.experience = 0;
    if (fp.combine) p.authoredCombine = fp.combine;
    return p;
  });
  const generatedCount = Math.max(0, FILE_LIMITS.MAX_PROSPECTS_PER_CLASS - authored.length);
  const { players, strengthByGroup } = generateDraftClass(rng, generatedCount, names, {
    authored,
    strengthByGroup: generateClassStrength(rng, cls.strength ?? 0),
  });
  return { players, strengthByGroup, generatedCount };
}

/**
 * One validated file player -> one generated player.
 *
 * Built by generating a player at the file's position and overall FIRST and
 * then overwriting what the file specified. That is deliberate: a generated
 * player is guaranteed to have every field the rest of the game reads
 * (a full attribute map for his position, a body, a college, a dev trait), so
 * a file that supplies four fields still produces a complete, playable person
 * rather than a row full of nulls waiting to break a screen.
 */
function materialisePlayer(
  fp: FilePlayer,
  name: { firstName: string; lastName: string },
  rng: Rng,
  contracts: Map<string, PlannedContract>,
): GeneratedPlayer {
  // No name registry: this player's name was decided in pass one, and letting
  // the throwaway base draw from the shared ledger is exactly the bug the
  // two-pass structure above exists to prevent.
  const base = generatePlayer(rng, {
    position: fp.position,
    ovrTarget: fp.ovr,
    ageOverride: fp.age,
  });

  const attrs = { ...base.trueAttrs, ...(fp.attrs ?? {}) };
  const { firstName, lastName } = name;

  const player: GeneratedPlayer = {
    ...base,
    firstName,
    lastName,
    position: fp.position,
    age: fp.age,
    experience: fp.experience ?? clamp(fp.age - 22, 0, 15),
    heightIn: fp.heightIn ?? base.heightIn,
    weightLb: fp.weightLb ?? base.weightLb,
    college: fp.college ?? base.college,
    trueAttrs: attrs,
    // Always recomputed. The file's `ovr` is a request, never a stored fact —
    // see the "no lying metrics" principle in the README.
    trueOvr: computeOverall(fp.position, attrs),
    devTrait: fp.devTrait ?? base.devTrait,
    potential: 0, // set below, once trueOvr is final
  };
  player.potential = clamp(fp.potential ?? base.potential, player.trueOvr, 99);

  if (fp.contract) {
    contracts.set(plannedContractKey(firstName, lastName), {
      apy: fp.contract.apy,
      years: fp.contract.years,
      yearsRemaining: fp.contract.yearsRemaining ?? fp.contract.years,
    });
  }
  return player;
}

/**
 * A file's name, made unique. Unlike pickUniqueName this must not re-roll —
 * the whole point is that the author's name is kept — so a collision gets a
 * generational suffix, the same way the generator's own fallback does.
 */
function uniqueName(firstName: string, lastName: string, names: NameRegistry) {
  if (!names.has(`${firstName} ${lastName}`)) {
    names.add(`${firstName} ${lastName}`);
    return { firstName, lastName };
  }
  for (const suffix of ['Jr.', 'II', 'III', 'IV', 'V']) {
    const candidate = `${lastName} ${suffix}`;
    if (!names.has(`${firstName} ${candidate}`)) {
      names.add(`${firstName} ${candidate}`);
      return { firstName, lastName: candidate };
    }
  }
  names.add(`${firstName} ${lastName}`);
  return { firstName, lastName };
}

/**
 * Fills the gaps in a partial roster, and nothing more.
 *
 * ONLY position minimums are filled. A team with no punter cannot produce a
 * depth chart, so one is generated; a team with 41 players and every position
 * covered is left at 41, because the file said 41 and the app's own generated
 * leagues routinely sit in the low forties themselves (generateRoster rolls
 * min..ideal per position, which averages ~43 of a possible 53). Padding an
 * imported roster out to some rounder number would mean a league exported and
 * re-imported quietly grew a hundred players it never had — measured, on the
 * first round trip, before this was cut back.
 *
 * A thin roster is a legitimate, playable state: the free agent pool exists,
 * and the app already nudges a team that sits under the roster minimum.
 *
 * Cannot overflow: parse-time validation (assertRosterIsFillable) has already
 * guaranteed there is room for every player this adds.
 */
function fillRoster(roster: GeneratedPlayer[], rng: Rng, names: NameRegistry): void {
  const countOf = (pos: Position) => roster.filter((p) => p.position === pos).length;

  for (const pos of POSITIONS) {
    while (countOf(pos) < ROSTER_TARGETS[pos].min) {
      roster.push(generatePlayer(rng, {
        position: pos,
        // [TUNE] a gap-filler is a depth signing, not a starter.
        ovrTarget: rng.normalClamped(GENERATION.VETERAN_OVR_MEAN - 8, GENERATION.VETERAN_OVR_SD, 40, 88),
        names,
      }));
    }
  }
}

/**
 * WHAT A LEGAL FILE WOULD PRODUCE — the answer /api/league/validate gives when
 * it has nothing to refuse.
 *
 * Every figure here is read back off the parsed document or off the importer's
 * own `estimateWriteCost`, so a validation reports the league the import would
 * build rather than a second guess at it. `bytes` is the document RE-SERIALISED
 * by `serializeLeagueFile` — the file this document would be written as, which
 * is the number that has to clear MAX_BYTES on the way back in. `receivedBytes`
 * is what actually arrived, and the two differ by whitespace on a pasted file
 * and by the whole conversion on a CSV bundle, which is why both are reported.
 *
 * Pure: no database, no clock. The route adds nothing to it.
 */
export function summariseLeagueFile(file: LeagueFile, receivedBytes: number) {
  const cost = estimateWriteCost(file);
  const body = serializeLeagueFile(file);
  const bytes = Buffer.byteLength(body, 'utf8');
  const rostered = file.teams.reduce((n, t) => n + (t.players?.length ?? 0), 0);
  const emptyRosters = file.teams.filter((t) => !t.players?.length).length;
  const classProspects = file.draftClasses?.[0]?.players.length;
  return {
    name: file.name,
    formatVersion: file.formatVersion,
    conferences: file.conferences ?? [...DEFAULT_CONFERENCES],
    divisions: file.divisions ?? [...DEFAULT_DIVISIONS],
    teams: file.teams.length,
    /** Players the FILE names, by where they are in it. */
    rostered,
    emptyRosters,
    freeAgents: file.freeAgents?.length,
    classProspects,
    classStrength: file.draftClasses?.[0]?.strength,
    /** Players the IMPORT would write, the file's own plus everything generated. */
    playersWritten: cost.players,
    teamsWritten: cost.teams,
    bytes,
    receivedBytes,
    maxBytes: FILE_LIMITS.MAX_BYTES,
  };
}

export type LeagueFileSummary = ReturnType<typeof summariseLeagueFile>;

/**
 * How many players an imported file will actually cause to be written. Used by
 * the import route to log the real cost of a request, and available to any
 * future rate limiting that wants to price a request before running it.
 */
export function estimateWriteCost(file: LeagueFile): { players: number; teams: number } {
  const perTeam = file.teams.map((t) =>
    t.players?.length ? Math.max(t.players.length, POSITION_MINIMUM_TOTAL) : 45);
  const fa = Math.max(file.freeAgents?.length ?? 0, file.freeAgents === undefined ? FREE_AGENT_DEFAULT : FREE_AGENT_FLOOR);
  // A supplied class is topped up to a full one, so it costs the same either
  // way: the cheapest class a file can ask for is as expensive as the most
  // expensive one. A file with no class costs nothing here — createLeague
  // writes none, and the PRESEASON step mints it later.
  const prospects = file.draftClasses?.length ? FILE_LIMITS.MAX_PROSPECTS_PER_CLASS : 0;
  return { teams: file.teams.length, players: perTeam.reduce((a, b) => a + b, 0) + fa + prospects };
}

