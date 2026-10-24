/**
 * ===========================================================================
 * THE CSV AUTHORING PATH — spreadsheets in, league file out
 * ===========================================================================
 *
 * A league file (lib/leagueFile.ts) is JSON, and JSON is the right TRANSPORT
 * format: one document, versioned, checked end to end. It is the wrong
 * AUTHORING format. Recreating a real 32-team league is 1,700 players, and
 * hand-writing 1,700 JSON objects is a 40,000-line document that one missing
 * comma kills with a parse error pointing at a line number nobody can place.
 *
 * The authoring tool people actually have is a spreadsheet, and the thing a
 * spreadsheet does that nothing else here does is COLLABORATE: eight people
 * can split 32 teams across one shared sheet, each owning four tabs' worth of
 * rows, and nobody has to merge anything. So the authoring format is CSV, the
 * transport format is still JSON, and this module is the one-way door between
 * them.
 *
 * ---------------------------------------------------------------------------
 * THE FACT THAT MAKES THIS FEASIBLE AT ALL
 * ---------------------------------------------------------------------------
 * There are 36 attributes across 16 positions in this game, and AN AUTHOR DOES
 * NOT NEED THEM. Set `ovr`, leave every attribute column empty, and the
 * generator builds an attribute map around that overall — the same call a
 * from-scratch league uses. A complete, cap-realistic 32-team league is
 * therefore SIX COLUMNS:
 *
 *     team, name, position, age, ovr, contractApy, contractYears
 *
 * (seven, counting the team the man plays for) times 1,700 rows. Attribute
 * authorship is an optional refinement for the forty or fifty players anybody
 * actually has an opinion about.
 *
 * AND WHEN ATTRIBUTES ARE SUPPLIED, `ovr` IS IGNORED. That is deliberate and
 * it is not a quirk of the CSV layer: lib/leagueFile.ts recomputes the overall
 * from the attributes, because a stored overall that disagrees with the
 * attributes under it is the lying metric this codebase treats as its worst
 * bug class. A row with attributes and an `ovr` is not a conflict to resolve;
 * the attributes are the answer and the `ovr` was a hint that is no longer
 * needed.
 *
 * ---------------------------------------------------------------------------
 * ONE VALIDATOR, ROW-LEVEL REFUSALS
 * ---------------------------------------------------------------------------
 * This module does NOT validate a player. It shapes rows into a league file
 * document and hands that document to `parseLeagueFile`, which is the only
 * thing in this codebase that decides whether a league file is legal. A second
 * validator here would be a second set of bounds to drift.
 *
 * What it does do is keep a map from every document path it writes
 * (`teams[3].players[12]`) back to the row that produced it (`players.csv row
 * 418, Marcus Doyle`), and rewrite the refusal before it reaches the author.
 * A spreadsheet author cannot act on "teams[3].players[12].position"; they can
 * act on "players.csv row 418". The refusal is otherwise untouched — same
 * field, same offending value, same list of what would have been legal.
 *
 * The checks that belong HERE are the ones only the CSV layer can see: a
 * column that is not a column, a `team` that is not one of the 32, a cell that
 * is not a number at all. Those are refused with the same discipline — the
 * file, the row, the column, and what would have been legal.
 */

import { ATTRIBUTES, ATTRIBUTE_BY_KEY } from './ratings';
import { POSITIONS } from './tuning';
import { TEAM_SEEDS } from './gen/names';
import {
  FILE_LIMITS,
  FORMAT_VERSION,
  FILE_KIND,
  LeagueFile,
  LeagueFileError,
  parseLeagueFile,
  sanitiseDisplayName,
} from './leagueFile';

// ---------------------------------------------------------------------------
// Limits — the CSV layer's own, in one place, same as FILE_LIMITS
// ---------------------------------------------------------------------------

/**
 * What a CSV upload may cost before a single cell is read.
 *
 * MAX_ROWS is the largest legal players.csv plus headroom: 32 teams x 53 men
 * is 1,696, plus up to MAX_FREE_AGENTS unsigned, and the document that comes
 * out of it is bounded again by FILE_LIMITS on the way through
 * parseLeagueFile. MAX_COLUMNS is every fixed column plus every attribute plus
 * room for a few the author left in; a row with 10,000 cells is a denial of
 * service, not a mistake.
 */
export const CSV_LIMITS = {
  MAX_BYTES: FILE_LIMITS.MAX_BYTES,
  MAX_ROWS: FILE_LIMITS.TEAM_COUNT * FILE_LIMITS.MAX_PLAYERS_PER_TEAM + FILE_LIMITS.MAX_FREE_AGENTS + 64,
  MAX_COLUMNS: 96,
  /** A single cell. Long enough for any name, short enough to be absurd. */
  MAX_CELL: 200,
} as const;

/** Spelled the way a spreadsheet author would leave the cell. */
const FREE_AGENT_TEAM_WORDS = new Set(['', 'fa', 'free agent', 'free-agent', 'freeagent', 'none', '-']);

// ---------------------------------------------------------------------------
// Columns — derived from the code, never typed in twice
// ---------------------------------------------------------------------------

/**
 * Every column each file accepts, and whether a row must fill it.
 *
 * THESE LISTS ARE WHAT THE TEMPLATES ARE BUILT FROM. The download route
 * renders its header row straight out of here, so a template cannot offer a
 * column the parser does not accept or omit one it requires — the drift that
 * makes a downloadable template worse than no template.
 */
const TEAM_COLUMNS = ['city', 'nickname', 'abbr', 'conference', 'division'] as const;

const PLAYER_FIXED_COLUMNS = [
  'team', 'name', 'firstname', 'lastname', 'position', 'age', 'ovr',
  'contractapy', 'contractyears', 'contractyearsremaining',
  'experience', 'heightin', 'weightlb', 'college', 'potential', 'devtrait',
] as const;

const PROSPECT_FIXED_COLUMNS = [
  'name', 'firstname', 'lastname', 'position', 'age', 'ovr',
  'college', 'potential', 'devtrait',
  'combinevenue', 'forty', 'vertical', 'broad', 'threecone', 'shuttle', 'bench',
] as const;

/** The attribute columns, in catalogue order. Lower-cased for matching. */
const ATTR_COLUMNS = ATTRIBUTES.map((a) => a.key);

/**
 * The header row a template ships with, in the order an author wants to see
 * it: the six that matter, then the optional refinements, then the attributes.
 */
const PLAYERS_TEMPLATE_HEADER = [
  'team', 'name', 'position', 'age', 'ovr', 'contractApy', 'contractYears',
  'contractYearsRemaining', 'experience', 'heightIn', 'weightLb', 'college', 'potential', 'devTrait',
  ...ATTR_COLUMNS,
];

const PROSPECTS_TEMPLATE_HEADER = [
  'name', 'position', 'age', 'ovr', 'college', 'potential', 'devTrait',
  'combineVenue', 'forty', 'vertical', 'broad', 'threeCone', 'shuttle', 'bench',
  ...ATTR_COLUMNS,
];

export type TemplateName = 'teams.csv' | 'players.csv' | 'prospects.csv';

export const TEMPLATE_NAMES: TemplateName[] = ['teams.csv', 'players.csv', 'prospects.csv'];

/**
 * A downloadable template.
 *
 * teams.csv ships FILLED IN with the app's own 32 franchises. That is the one
 * place a prefilled template is strictly better than an empty one: the
 * conference and division of 32 rows is 64 cells of pure bookkeeping that has
 * to come out to exactly 2 x 4 x 4 or the file is refused, and an author
 * recreating a real league is renaming cities, not inventing a league shape.
 * Rename the cells; leave the conference/division columns alone, or rename
 * those too and every team moves with them.
 *
 * players.csv and prospects.csv ship as a HEADER ROW ONLY. An example row in a
 * file an author appends 1,700 rows to is an example row that ends up in
 * somebody's league as a 24-year-old named Example Player.
 */
export function csvTemplate(name: TemplateName): string {
  if (name === 'teams.csv') {
    return [
      TEAM_COLUMNS.join(','),
      ...TEAM_SEEDS.map((t) => [t.city, t.nickname, t.abbr, t.conference, t.division].map(csvCell).join(',')),
    ].join('\n') + '\n';
  }
  if (name === 'players.csv') return PLAYERS_TEMPLATE_HEADER.join(',') + '\n';
  return PROSPECTS_TEMPLATE_HEADER.join(',') + '\n';
}

/** Quote a cell only when it needs it, so a template reads as a table. */
function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

interface CsvRow {
  /** 1-based, counting the header as row 1 — the number the author's spreadsheet shows. */
  line: number;
  cells: string[];
}

interface CsvTable {
  /** Lower-cased, trimmed header names, in file order. */
  header: string[];
  rows: CsvRow[];
}

/**
 * RFC-4180 enough: quoted fields, doubled quotes inside them, CRLF or LF, and
 * a trailing newline that does not invent an empty row.
 *
 * Hostile first, as everywhere on this path. Bytes before characters, row
 * count before row contents, cell length before anything is kept. An
 * unterminated quote is refused by name rather than swallowing the rest of the
 * file into one cell, which is how a 1,700-row upload silently becomes one
 * player with a very long surname.
 */
function parseCsv(text: string, file: string): CsvTable {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > CSV_LIMITS.MAX_BYTES) {
    throw new LeagueFileError(
      `${file} is ${(bytes / 1_048_576).toFixed(1)}MB; the maximum is ${CSV_LIMITS.MAX_BYTES / 1_048_576}MB.`,
    );
  }

  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let any = false;

  const endCell = () => {
    if (cell.length > CSV_LIMITS.MAX_CELL) {
      throw new LeagueFileError(
        `${file} row ${line}, column ${cells.length + 1} holds ${cell.length} characters; ` +
          `the maximum for one cell is ${CSV_LIMITS.MAX_CELL}.`,
      );
    }
    cells.push(cell.trim());
    cell = '';
    if (cells.length > CSV_LIMITS.MAX_COLUMNS) {
      throw new LeagueFileError(
        `${file} row ${line} holds more than ${CSV_LIMITS.MAX_COLUMNS} columns. ` +
          'A league CSV has at most one column per attribute plus the fixed columns.',
      );
    }
  };
  const endRow = () => {
    endCell();
    // A row of nothing but empty cells is a blank line in a spreadsheet
    // export, not a player with no name.
    if (cells.some((c) => c.length > 0)) rows.push({ line, cells });
    cells = [];
    line++;
    if (rows.length > CSV_LIMITS.MAX_ROWS) {
      throw new LeagueFileError(
        `${file} holds more than ${CSV_LIMITS.MAX_ROWS} rows; that is more than a 32-team league can contain.`,
      );
    }
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    any = true;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell.length === 0) { quoted = true; continue; }
    if (ch === ',') { endCell(); continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { endRow(); continue; }
    cell += ch;
  }
  if (quoted) {
    throw new LeagueFileError(
      `${file} has an unclosed quotation mark starting somewhere at or before row ${line}. ` +
        'Every " that opens a cell must be closed by another one.',
    );
  }
  if (cell.length > 0 || cells.length > 0) endRow();

  if (!any || rows.length === 0) {
    throw new LeagueFileError(`${file} is empty. It needs a header row naming its columns, and at least one row under it.`);
  }

  const header = rows[0].cells.map((h) => h.toLowerCase());
  return { header, rows: rows.slice(1) };
}

/**
 * Check the header against what this file accepts, and refuse anything else.
 *
 * AN UNKNOWN COLUMN IS A REFUSAL, NOT A SHRUG. A column called `ovrl` that is
 * quietly ignored produces 1,700 players whose overall was generated at random
 * and an author who thinks they wrote a league — the worst outcome available
 * here, because nothing anywhere says so. A typo refused by name costs ten
 * seconds.
 */
function checkHeader(t: CsvTable, file: string, fixed: readonly string[], required: readonly string[][]): void {
  const allowed = new Set<string>([...fixed, ...ATTR_COLUMNS.map((a) => a.toLowerCase())]);
  const seen = new Set<string>();
  t.header.forEach((h, i) => {
    if (h.length === 0) {
      throw new LeagueFileError(`${file} column ${i + 1} has no name. Every column in the header row must be named.`);
    }
    if (!allowed.has(h)) {
      throw new LeagueFileError(
        `${file} has a column called "${h.slice(0, 40)}", which is not one of its columns. ` +
          `The fixed columns are: ${fixed.join(', ')}. Any attribute key may also be a column: ` +
          `${ATTR_COLUMNS.join(', ')}.`,
      );
    }
    if (seen.has(h)) {
      throw new LeagueFileError(`${file} has two columns called "${h}". Every column must appear once.`);
    }
    seen.add(h);
  });
  for (const group of required) {
    if (!group.some((g) => seen.has(g))) {
      throw new LeagueFileError(
        group.length === 1
          ? `${file} has no "${group[0]}" column, and every row needs one.`
          : `${file} needs a "${group[0]}" column, or ${group.slice(1).map((g) => `"${g}"`).join(' and ')} instead.`,
      );
    }
  }
}

/** Cell lookup by column name, empty string when the column is absent. */
function cellReader(t: CsvTable) {
  const index = new Map(t.header.map((h, i) => [h, i]));
  return (row: CsvRow, column: string): string => {
    const i = index.get(column);
    return i === undefined ? '' : (row.cells[i] ?? '');
  };
}

// ---------------------------------------------------------------------------
// Cell -> value
// ---------------------------------------------------------------------------

/**
 * A number out of a spreadsheet cell.
 *
 * Accepts the shapes a spreadsheet actually produces: `12500000`,
 * `12,500,000`, `$12,500,000` and `$12.5M`. It does NOT guess at a bare
 * `12.5` — that is twelve dollars fifty, it is refused by
 * FILE_LIMITS.CONTRACT_APY_MIN a moment later, and the refusal below says so
 * in the one place an author is likely to make exactly that mistake. Guessing
 * would mean a contract whose value is not the value that was written.
 */
function readCellNumber(raw: string, file: string, row: CsvRow, column: string): number {
  const cleaned = raw.replace(/[$,\s]/g, '');
  const millions = /^-?[\d.]+[Mm]$/.test(cleaned);
  const n = Number(millions ? cleaned.slice(0, -1) : cleaned);
  if (!Number.isFinite(n) || cleaned.length === 0) {
    throw new LeagueFileError(
      `${file} row ${row.line}: ${column} is "${raw.slice(0, 40)}", which is not a number. ` +
        'Write a plain figure — 24, 87, 12500000 — or, for money, $12.5M.',
    );
  }
  return millions ? Math.round(n * 1_000_000) : n;
}

/** The money hint, because this is the mistake that will actually be made. */
function readCellMoney(raw: string, file: string, row: CsvRow, column: string): number {
  const v = readCellNumber(raw, file, row, column);
  if (v > 0 && v < 1000) {
    throw new LeagueFileError(
      `${file} row ${row.line}: ${column} is ${raw.slice(0, 20)}, which is $${v} a year. ` +
        'Contract money is in dollars — write 12500000, or $12.5M.',
    );
  }
  return v;
}

/**
 * A row's player object, in league-file shape. Deliberately returns `unknown`
 * values rather than a typed FilePlayer: every one of them is about to be
 * checked by parseLeagueFile, and typing them here would mean asserting things
 * this function has not established.
 */
function playerFromRow(
  row: CsvRow,
  get: (row: CsvRow, column: string) => string,
  file: string,
  opts: { contracts: boolean; combine: boolean },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  // Name: one column or two. `name` splits on the LAST space, so "Jean-Luc
  // van Dijk" keeps the surname whole and a one-word name is refused by
  // parseLeagueFile's lastName check rather than silently halved.
  const whole = get(row, 'name');
  const first = get(row, 'firstname');
  const last = get(row, 'lastname');
  if (first || last) {
    out.firstName = first;
    out.lastName = last;
  } else {
    const cut = whole.lastIndexOf(' ');
    if (cut <= 0) {
      throw new LeagueFileError(
        `${file} row ${row.line}: name is "${whole.slice(0, 40)}", which has no surname in it. ` +
          'Write a first and a last name, or use separate firstName and lastName columns.',
      );
    }
    out.firstName = whole.slice(0, cut);
    out.lastName = whole.slice(cut + 1);
  }

  out.position = get(row, 'position');
  out.age = readCellNumber(get(row, 'age'), file, row, 'age');
  out.ovr = readCellNumber(get(row, 'ovr'), file, row, 'ovr');

  for (const col of ['experience', 'heightin', 'weightlb', 'potential'] as const) {
    const raw = get(row, col);
    if (!raw) continue;
    const key = col === 'heightin' ? 'heightIn' : col === 'weightlb' ? 'weightLb' : col;
    out[key] = readCellNumber(raw, file, row, col);
  }
  if (get(row, 'college')) out.college = get(row, 'college');
  if (get(row, 'devtrait')) out.devTrait = get(row, 'devtrait');

  // Attributes. An empty cell is NOT a zero — it is "generate this one",
  // which is the whole reason a six-column league works. Only cells with
  // something in them become attributes.
  const attrs: Record<string, unknown> = {};
  for (const key of ATTR_COLUMNS) {
    const raw = get(row, key.toLowerCase());
    if (!raw) continue;
    attrs[key] = readCellNumber(raw, file, row, key);
  }
  if (Object.keys(attrs).length > 0) out.attrs = attrs;

  if (opts.contracts) {
    const apy = get(row, 'contractapy');
    const years = get(row, 'contractyears');
    const remaining = get(row, 'contractyearsremaining');
    if (apy || years) {
      if (!apy || !years) {
        throw new LeagueFileError(
          `${file} row ${row.line}: a contract needs both contractApy and contractYears; ` +
            `this row has ${apy ? 'only contractApy' : 'only contractYears'}. ` +
            'Fill both, or leave both empty and the player is priced at market.',
        );
      }
      const contract: Record<string, unknown> = {
        apy: readCellMoney(apy, file, row, 'contractApy'),
        years: readCellNumber(years, file, row, 'contractYears'),
      };
      if (remaining) contract.yearsRemaining = readCellNumber(remaining, file, row, 'contractYearsRemaining');
      out.contract = contract;
    }
  }

  if (opts.combine) {
    const combine: Record<string, unknown> = {};
    const venue = get(row, 'combinevenue');
    if (venue) combine.venue = venue.toUpperCase().replace(/[\s-]/g, '_');
    const drills: [string, string][] = [
      ['forty', 'fortyYard'], ['vertical', 'vertical'], ['broad', 'broadJump'],
      ['threecone', 'threeCone'], ['shuttle', 'shuttle'],
    ];
    for (const [col, key] of drills) {
      const raw = get(row, col);
      if (raw) combine[key] = readCellNumber(raw, file, row, col);
    }
    const bench = get(row, 'bench');
    // "none" is a man who did not lift, which is not a man who lifted nothing.
    if (bench) combine.benchReps = /^(none|n\/a|-)$/i.test(bench) ? null : readCellNumber(bench, file, row, 'bench');
    if (Object.keys(combine).length > 0) out.combine = combine;
  }

  return out;
}

// ---------------------------------------------------------------------------
// CSV -> league file
// ---------------------------------------------------------------------------

export interface CsvBundle {
  /** Required: the 32 franchises. */
  teams: string;
  /** Optional. Omit it and every roster is generated. */
  players?: string;
  /** Optional. Omit it and the opening draft class is generated. */
  prospects?: string;
  /** The league's name, held to the same rules as a name inside the file. */
  name?: string;
  /** The draft class's label. See FileDraftClass.year — it is a label. */
  draftYear?: number;
  /** The draft class's across-the-board strength. See FileDraftClass.strength. */
  classStrength?: number;
}

/**
 * Three CSVs -> one validated league file.
 *
 * Returns the parsed file, so a caller holds the same object an uploaded JSON
 * document would have produced and nothing downstream can tell the difference.
 * Throws `LeagueFileError` with a message naming the FILE and the ROW, which
 * the import route and the converter route already answer 400 with and show
 * verbatim.
 */
export function leagueFileFromCsv(bundle: CsvBundle): LeagueFile {
  const teamTable = parseCsv(bundle.teams, 'teams.csv');
  checkHeader(teamTable, 'teams.csv', TEAM_COLUMNS, [['city'], ['nickname'], ['abbr'], ['conference'], ['division']]);
  const teamCell = cellReader(teamTable);

  /** document path -> the row it came from, for the refusal rewrite below. */
  const origin = new Map<string, string>();

  const teams = teamTable.rows.map((row, i) => {
    origin.set(`teams[${i}]`, `teams.csv row ${row.line}`);
    return {
      city: teamCell(row, 'city'),
      nickname: teamCell(row, 'nickname'),
      abbr: teamCell(row, 'abbr'),
      conference: teamCell(row, 'conference'),
      division: teamCell(row, 'division'),
      players: undefined as Record<string, unknown>[] | undefined,
    };
  });

  // The conference and division NAMES are the ones the sheet used — distinct
  // values, in the order they first appear, which is the order an author laid
  // their sheet out in. parseLeagueFile refuses anything that is not exactly
  // two of one and four of the other, with the arithmetic.
  const conferences = [...new Set(teams.map((t) => t.conference).filter(Boolean))];
  const divisions = [...new Set(teams.map((t) => t.division).filter(Boolean))];

  const byAbbr = new Map<string, typeof teams[number]>();
  const indexOfAbbr = new Map<string, number>();
  teams.forEach((t, i) => {
    const key = t.abbr.trim().toUpperCase();
    if (key && !byAbbr.has(key)) { byAbbr.set(key, t); indexOfAbbr.set(key, i); }
  });

  const freeAgents: Record<string, unknown>[] = [];

  if (bundle.players !== undefined) {
    const table = parseCsv(bundle.players, 'players.csv');
    checkHeader(table, 'players.csv', PLAYER_FIXED_COLUMNS, [
      ['team'], ['name', 'firstName', 'lastName'], ['position'], ['age'], ['ovr'],
    ]);
    const get = cellReader(table);

    for (const row of table.rows) {
      const player = playerFromRow(row, get, 'players.csv', { contracts: true, combine: false });
      const teamKey = get(row, 'team').trim().toUpperCase();
      if (FREE_AGENT_TEAM_WORDS.has(teamKey.toLowerCase())) {
        origin.set(`freeAgents[${freeAgents.length}]`, `players.csv row ${row.line}, ${nameOf(player)}`);
        freeAgents.push(player);
        continue;
      }
      const team = byAbbr.get(teamKey);
      if (!team) {
        throw new LeagueFileError(
          `players.csv row ${row.line}: team is "${get(row, 'team').slice(0, 20)}", which is not one of the ` +
            `${teams.length} abbreviations in teams.csv. Legal values are ` +
            `${[...byAbbr.keys()].slice(0, 8).join(', ')}${byAbbr.size > 8 ? ', …' : ''}, ` +
            'or leave the cell empty for a free agent.',
        );
      }
      if (!team.players) team.players = [];
      origin.set(
        `teams[${indexOfAbbr.get(teamKey)}].players[${team.players.length}]`,
        `players.csv row ${row.line}, ${nameOf(player)}`,
      );
      team.players.push(player);
    }
  }

  let draftClasses: Record<string, unknown>[] | undefined;
  if (bundle.prospects !== undefined) {
    const table = parseCsv(bundle.prospects, 'prospects.csv');
    checkHeader(table, 'prospects.csv', PROSPECT_FIXED_COLUMNS, [
      ['name', 'firstName', 'lastName'], ['position'], ['age'], ['ovr'],
    ]);
    const get = cellReader(table);
    const players = table.rows.map((row, i) => {
      const player = playerFromRow(row, get, 'prospects.csv', { contracts: false, combine: true });
      origin.set(`draftClasses[0].players[${i}]`, `prospects.csv row ${row.line}, ${nameOf(player)}`);
      return player;
    });
    const cls: Record<string, unknown> = {
      year: bundle.draftYear ?? new Date().getFullYear(),
      players,
    };
    if (bundle.classStrength !== undefined) cls.strength = bundle.classStrength;
    draftClasses = [cls];
  }

  const doc = {
    formatVersion: FORMAT_VERSION,
    kind: FILE_KIND,
    name: sanitiseDisplayName(bundle.name, FILE_LIMITS.MAX_LEAGUE_NAME) ?? 'Imported League',
    generator: 'Dynasty GM Football (CSV)',
    generatedAt: new Date().toISOString(),
    conferences,
    divisions,
    teams: teams.map((t) => (t.players ? t : { ...t, players: undefined })),
    // An absent players.csv means "generate every roster", and an absent
    // free-agent row means "generate a pool" — both of which are an ABSENT
    // key, not an empty array. An empty array is an author saying the league
    // has no free agents, which is a different and legitimate thing to say.
    freeAgents: bundle.players === undefined ? undefined : freeAgents,
    draftClasses,
  };

  // THE ONLY VALIDATOR. Anything this throws is rewritten to name the row.
  try {
    return parseLeagueFile(JSON.stringify(doc));
  } catch (err) {
    if (err instanceof LeagueFileError) throw new LeagueFileError(locate(err.message, origin));
    throw err;
  }
}

function nameOf(player: Record<string, unknown>): string {
  const first = typeof player.firstName === 'string' ? player.firstName : '';
  const last = typeof player.lastName === 'string' ? player.lastName : '';
  return `${first} ${last}`.trim().slice(0, 48) || 'unnamed';
}

/**
 * Rewrite a document path in a refusal into the row that wrote it.
 *
 * `teams[3].players[12].age is 900; it must be between 18 and 45`
 *   -> `players.csv row 418, Marcus Doyle: age is 900; it must be between 18 and 45`
 *
 * The longest matching path wins, so `teams[3].players[12]` is preferred over
 * `teams[3]` and a refusal about a team is not reported against one of its
 * players. A message with no path in it — a size or structure refusal, which
 * is about the whole file rather than a row — is passed through untouched,
 * because inventing a row number for it would be worse than having none.
 */
function locate(message: string, origin: Map<string, string>): string {
  let bestPath = '';
  for (const path of origin.keys()) {
    if (path.length > bestPath.length && message.includes(path)) bestPath = path;
  }
  if (!bestPath) return message;
  const where = origin.get(bestPath)!;
  const rest = message.slice(message.indexOf(bestPath) + bestPath.length).replace(/^\./, '');
  const prefix = message.slice(0, message.indexOf(bestPath));
  return `${where}: ${prefix}${rest}`.replace(/\s+/g, ' ').trim();
}

/** Every position a `position` cell may hold — quoted in the templates' docs. */
export const CSV_POSITIONS: readonly string[] = POSITIONS;
/** Every attribute column, for the same reason. */
export const CSV_ATTRIBUTES: readonly string[] = ATTR_COLUMNS;
/** Sanity: the catalogue is the catalogue. */
export const CSV_ATTRIBUTE_COUNT = Object.keys(ATTRIBUTE_BY_KEY).length;
