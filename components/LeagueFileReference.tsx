import {
  COMBINE_VENUES,
  DEFAULT_CONFERENCES,
  DEFAULT_DIVISIONS,
  DEV_TRAITS,
  FILE_KIND,
  FILE_LIMITS,
  FORMAT_VERSION,
  FREE_AGENT_DEFAULT,
  FREE_AGENT_FLOOR,
  POSITION_MINIMUM_TOTAL,
  SUPPORTED_VERSIONS,
  parseLeagueFile,
} from '@/lib/leagueFile';
import { ATTRIBUTES } from '@/lib/ratings';
import { POSITIONS, ROSTER_TARGETS } from '@/lib/tuning';
import { costCeiling } from '@/lib/costLimit';
import { maxLeaguesPerOwner } from '@/lib/owner';

/**
 * ===========================================================================
 * THE LEAGUE FILE REFERENCE — generated, never typed
 * ===========================================================================
 *
 * NOT ONE FIGURE IN THIS COMPONENT IS A NUMBER SOMEBODY WROTE HERE. Every
 * bound is read out of `FILE_LIMITS`, every position out of `POSITIONS`, every
 * dev trait out of the array `readEnum` is handed, every attribute key out of
 * the catalogue in lib/ratings.ts, every hourly ceiling out of
 * `costCeiling`, and the example refusals at the foot are produced by running
 * `parseLeagueFile` over deliberately broken documents at render time, so they
 * are the sentences the parser actually emits.
 *
 * WHY IT IS A PAGE AND NOT A TABLE IN THE DOCS. docs/custom-leagues.md §7 used
 * to hand-write that table — 8 MB, exactly 32, 53, 400, −12 to +12 — and not
 * one of those figures was read from the code that enforces them. The first
 * change to any bound would have left the documentation telling authors a file
 * was legal that the parser refuses, which is this codebase's most expensive
 * recurring bug: a displayed number that is not the number the system used.
 * The doc keeps all of its prose and its reasoning and points here for the
 * values. There is exactly one copy of each figure, and it is the code's.
 *
 * SYNCHRONOUS, PURE, AND SEPARATE FROM THE PAGE ON PURPOSE. The page around it
 * reads the signed-in viewer, which makes it async and unrenderable outside a
 * request; this does not touch the database or the clock, so a probe under
 * scripts/_* can render it to HTML and assert every rendered figure against
 * the live constant. The real test is stronger than a comparison: perturb a
 * constant and the rendered page MUST change, which is only true while nothing
 * on it is typed by hand.
 */
export function LeagueFileReference() {
  const L = FILE_LIMITS;
  const mb = (bytes: number) => `${Math.round((bytes / 1_048_576) * 100) / 100}MB`;
  const n = (v: number) => v.toLocaleString('en-US');
  const money = (v: number) => `$${(v / 1_000_000).toFixed(1)}M`;
  const range = (lo: number, hi: number, unit = '') => `${n(lo)}–${n(hi)}${unit}`;
  const secs = (v: number) => v.toFixed(2);

  const minimums = POSITIONS.map((p) => `${p} ${ROSTER_TARGETS[p].min}`);

  return (
    <>
        {/* ---------------------------------------------------------------- */}
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Shape</h2>
          </div>
          <div className="panel p-5 space-y-4 text-sm">
            <Grid>
              <Row k="Teams" v={`exactly ${n(L.TEAM_COUNT)}`} />
              <Row k="Conferences" v={`exactly ${n(L.CONFERENCE_COUNT)}`} />
              <Row k="Divisions" v={`exactly ${n(L.DIVISION_COUNT)}, inside every conference`} />
              <Row k="Teams per division" v={`exactly ${n(L.TEAMS_PER_DIVISION)}`} />
              <Row k="Default conference names" v={DEFAULT_CONFERENCES.join(', ')} />
              <Row k="Default division names" v={DEFAULT_DIVISIONS.join(', ')} />
            </Grid>
            <p className="text-muted">
              {L.CONFERENCE_COUNT} × {L.DIVISION_COUNT} × {L.TEAMS_PER_DIVISION} = {n(L.TEAM_COUNT)} is the only
              arrangement <code className="text-chalk">lib/schedule.ts</code> can build a season from, so the
              counts are structural and refused rather than adjusted. The names are yours from format version{' '}
              {FORMAT_VERSION}: supply <code className="text-accent2">conferences</code> and{' '}
              <code className="text-accent2">divisions</code> and every team&rsquo;s own labels are checked
              against the two and four you listed.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Identity and version</h2>
          </div>
          <div className="panel p-5 text-sm">
            <Grid>
              <Row k="kind" v={FILE_KIND} mono />
              <Row k="Current formatVersion" v={String(FORMAT_VERSION)} mono />
              <Row k="Versions this build reads" v={SUPPORTED_VERSIONS.join(', ')} mono />
            </Grid>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Size and counts</h2>
          </div>
          <div className="panel p-5 text-sm">
            <Grid>
              <Row k="File size" v={`${mb(L.MAX_BYTES)} (${n(L.MAX_BYTES)} bytes)`} />
              <Row k="Players per team" v={`up to ${n(L.MAX_PLAYERS_PER_TEAM)}`} />
              <Row k="Free agents" v={`up to ${n(L.MAX_FREE_AGENTS)}`} />
              <Row k="Draft classes" v={`exactly ${n(L.MAX_DRAFT_CLASSES)}, or none`} />
              <Row k="Prospects in a class" v={`up to ${n(L.MAX_PROSPECTS_PER_CLASS)}`} />
              <Row k="Attribute keys per player" v={`up to ${n(L.MAX_ATTRS_PER_PLAYER)}`} />
              <Row k="Saved leagues per person" v={`${n(maxLeaguesPerOwner())}, shared with normal league creation`} />
            </Grid>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Text</h2>
          </div>
          <div className="panel p-5 text-sm">
            <Grid>
              <Row k="League name" v={`up to ${n(L.MAX_LEAGUE_NAME)} characters`} />
              <Row k="Conference name" v={`up to ${n(L.MAX_CONFERENCE_NAME)} characters`} />
              <Row k="Division name" v={`up to ${n(L.MAX_DIVISION_NAME)} characters`} />
              <Row k="City" v={`up to ${n(L.MAX_CITY)} characters`} />
              <Row k="Nickname" v={`up to ${n(L.MAX_NICKNAME)} characters`} />
              <Row k="First and last name" v={`up to ${n(L.MAX_PERSON_NAME)} characters each`} />
              <Row k="College" v={`up to ${n(L.MAX_COLLEGE)} characters`} />
              <Row k="Abbreviation" v={`${n(L.ABBR_MIN)}–${n(L.ABBR_MAX)} characters, A–Z and 0–9, unique`} />
            </Grid>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Players</h2>
          </div>
          <div className="panel p-5 text-sm">
            <Grid>
              <Row k="Age" v={range(L.AGE_MIN, L.AGE_MAX)} />
              <Row k="Experience" v={`0–${n(L.EXPERIENCE_MAX)} seasons, never more than age − ${n(L.AGE_MIN)}`} />
              <Row k="Height" v={range(L.HEIGHT_MIN, L.HEIGHT_MAX, ' inches')} />
              <Row k="Weight" v={range(L.WEIGHT_MIN, L.WEIGHT_MAX, ' lb')} />
              <Row k="Overall, potential, every attribute" v={range(L.RATING_MIN, L.RATING_MAX)} />
              <Row k="Contract, per year" v={`${money(L.CONTRACT_APY_MIN)}–${money(L.CONTRACT_APY_MAX)}`} />
              <Row k="Contract length" v={`1–${n(L.CONTRACT_YEARS_MAX)} years`} />
            </Grid>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Positions</h2>
            <span className="text-xs text-muted">{POSITIONS.length} legal values</span>
          </div>
          <div className="panel p-5 space-y-4 text-sm">
            <div className="flex flex-wrap gap-1.5">
              {POSITIONS.map((p) => (
                <span key={p} className="font-mono text-xs bg-raised border border-line rounded px-2 py-1 text-chalk">{p}</span>
              ))}
            </div>
            <p className="text-muted">
              A roster has to be able to reach every position&rsquo;s minimum without going over the{' '}
              {n(L.MAX_PLAYERS_PER_TEAM)}-man limit, which is {POSITION_MINIMUM_TOTAL} players in all —{' '}
              {minimums.join(', ')}. A team naming {n(L.MAX_PLAYERS_PER_TEAM)} players and no kicker is refused
              rather than quietly cut down to make room for one.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Attribute keys</h2>
            <span className="text-xs text-muted">{ATTRIBUTES.length} in the catalogue</span>
          </div>
          <div className="panel p-5 space-y-4 text-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
              {ATTRIBUTES.map((a) => (
                <div key={a.key} className="flex items-baseline justify-between gap-3 border-b border-line/40 py-1 min-w-0">
                  <code className="text-accent2 text-xs truncate">{a.key}</code>
                  <span className="text-muted text-xs text-right truncate">{a.label}</span>
                </div>
              ))}
            </div>
            <p className="text-muted">
              Supply as few as you like; anything left out is generated. Keys that do not apply to the
              player&rsquo;s position, and keys this build does not recognise, are ignored rather than refused,
              so a file written against a later version still loads. Whatever you supply, the stored overall is
              recomputed from the attributes — a stored overall that disagrees with the attributes under it is a
              number this game will not show you.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Closed enums</h2>
          </div>
          <div className="panel p-5 text-sm">
            <Grid>
              <Row k="devTrait" v={DEV_TRAITS.join(', ')} mono />
              <Row k="combine.venue" v={COMBINE_VENUES.join(', ')} mono />
            </Grid>
            <p className="text-muted mt-4">
              Matched case-insensitively, and a value outside the list is refused with the list in the message.
              <code className="text-chalk ml-1">combine</code> is legal only inside a{' '}
              <code className="text-accent2">draftClasses</code> entry.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Draft class</h2>
          </div>
          <div className="panel p-5 text-sm">
            <Grid>
              <Row k="strength" v={`${n(L.CLASS_STRENGTH_MIN)} to +${n(L.CLASS_STRENGTH_MAX)}`} />
              <Row k="year" v={`${n(L.DRAFT_YEAR_MIN)}–${n(L.DRAFT_YEAR_MAX)}, and a label: the class is stamped with the importing league’s season`} />
              <Row k="40-yard dash" v={`${secs(L.FORTY_MIN)}–${secs(L.FORTY_MAX)} seconds`} />
              <Row k="Vertical jump" v={range(L.VERTICAL_MIN, L.VERTICAL_MAX, ' inches')} />
              <Row k="Broad jump" v={range(L.BROAD_MIN, L.BROAD_MAX, ' inches')} />
              <Row k="Three cone" v={`${secs(L.CONE_MIN)}–${secs(L.CONE_MAX)} seconds`} />
              <Row k="Shuttle" v={`${secs(L.SHUTTLE_MIN)}–${secs(L.SHUTTLE_MAX)} seconds`} />
              <Row k="Bench reps" v={`${range(L.BENCH_MIN, L.BENCH_MAX)}, or none`} />
            </Grid>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">What import generates when the file is silent</h2>
          </div>
          <div className="panel p-5 text-sm">
            <Grid>
              <Row k="No players on a team" v="a full generated roster, the same call a new league makes" />
              <Row k="Some players on a team" v={`every one of them, plus generated players only where a position sits below its minimum (${POSITION_MINIMUM_TOTAL} in all)`} />
              <Row k="No freeAgents" v={`a pool of ${n(FREE_AGENT_DEFAULT)}`} />
              <Row k="Some freeAgents" v={`those, topped up to ${n(FREE_AGENT_FLOOR)}`} />
              <Row k="No draftClasses" v="the opening class is generated at preseason, as always" />
              <Row k="A partial draftClass" v="those prospects, topped up to a full board — seven rounds of picks have to find somebody to call" />
            </Grid>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">How often you may use the file endpoints</h2>
          </div>
          <div className="panel p-5 text-sm">
            <Grid>
              <Row k="Checking a file" v={`${n(costCeiling('VALIDATE').perOwner)} an hour`} />
              <Row k="Converting spreadsheets" v={`${n(costCeiling('CSV_CONVERT').perOwner)} an hour`} />
              <Row k="Exporting a league" v={`${n(costCeiling('EXPORT').perOwner)} an hour`} />
              <Row k="Founding or importing a league" v={`${n(costCeiling('CREATE').perOwner)} an hour`} />
            </Grid>
            <p className="text-muted mt-4">
              Hourly, per account, counted the moment a request is accepted. Checking a file is the loop the
              authoring path exists to serve, which is why it is the loosest of the four.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">What a refusal reads like</h2>
          </div>
          <div className="panel p-5 space-y-3 text-sm">
            <p className="text-muted">
              Produced by running the parser over broken documents as this page rendered. Out of range is
              refused, not quietly clamped: a rating in the thousands is not the two-digit one you meant, and
              repairing it silently would hand you back a league that does not match what you wrote while
              telling you nothing.
            </p>
            <ul className="space-y-2">
              {exampleRefusals().map((r) => (
                <li key={r.label} className="border-l-2 border-bad/50 pl-3">
                  <div className="label-sm">{r.label}</div>
                  <p className="text-chalk/90 mt-0.5 break-words font-mono text-xs leading-relaxed">{r.message}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

    </>
  );
}

/**
 * The real refusals, generated at render time.
 *
 * The documentation used to quote four of these as literal text, which made
 * them the same stale-figure risk as the table: a reworded refusal left the
 * doc quoting a sentence the parser no longer emits. These are produced by
 * handing `parseLeagueFile` a document that is broken in one specific way and
 * printing what comes back, so the page cannot quote a message that does not
 * exist. `parseLeagueFile` is pure — no database, no clock, no randomness —
 * and these documents are a few hundred bytes each.
 *
 * A document that FAILS TO FAIL says so rather than rendering an empty row.
 */
function exampleRefusals(): { label: string; message: string }[] {
  const team = (i: number, over: Record<string, unknown> = {}) => ({
    city: `City ${i}`,
    nickname: `Nicks ${i}`,
    abbr: `T${String(i).padStart(2, '0')}`,
    conference: DEFAULT_CONFERENCES[i % DEFAULT_CONFERENCES.length],
    division: DEFAULT_DIVISIONS[Math.floor(i / DEFAULT_CONFERENCES.length) % DEFAULT_DIVISIONS.length],
    ...over,
  });
  const base = (over: Record<string, unknown> = {}) => ({
    formatVersion: FORMAT_VERSION,
    kind: FILE_KIND,
    name: 'Reference',
    teams: Array.from({ length: FILE_LIMITS.TEAM_COUNT }, (_, i) => team(i)),
    ...over,
  });

  const cases: { label: string; doc: unknown }[] = [
    {
      label: 'A player out of range',
      doc: base({
        teams: Array.from({ length: FILE_LIMITS.TEAM_COUNT }, (_, i) =>
          i === 7
            ? team(i, { players: [{ firstName: 'Old', lastName: 'Man', position: 'QB', age: 900, ovr: 70 }] })
            : team(i)),
      }),
    },
    {
      label: 'A position that is not a position',
      doc: base({
        teams: Array.from({ length: FILE_LIMITS.TEAM_COUNT }, (_, i) =>
          i === 0
            ? team(i, { players: [{ firstName: 'Marcus', lastName: 'Doyle', position: 'FB', age: 24, ovr: 70 }] })
            : team(i)),
      }),
    },
    {
      label: 'The wrong number of teams',
      doc: base({ teams: Array.from({ length: FILE_LIMITS.TEAM_COUNT - 1 }, (_, i) => team(i)) }),
    },
    {
      label: 'A repeated abbreviation',
      doc: base({
        teams: Array.from({ length: FILE_LIMITS.TEAM_COUNT }, (_, i) =>
          team(i, i === FILE_LIMITS.TEAM_COUNT - 1 ? { abbr: 'T00' } : {})),
      }),
    },
    {
      label: 'A division of the wrong size',
      doc: base({
        teams: Array.from({ length: FILE_LIMITS.TEAM_COUNT }, (_, i) =>
          team(i, i === 0 ? { division: DEFAULT_DIVISIONS[1] } : {})),
      }),
    },
    {
      label: 'A version that does not match the fields',
      doc: base({ formatVersion: 1, conferences: [...DEFAULT_CONFERENCES] }),
    },
  ];

  return cases.map(({ label, doc }) => {
    try {
      parseLeagueFile(JSON.stringify(doc));
      return { label, message: 'This document was accepted — the example no longer demonstrates a refusal.' };
    } catch (err) {
      return { label, message: err instanceof Error ? err.message : String(err) };
    }
  });
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">{children}</div>;
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/40 pb-2 min-w-0">
      <span className="label-sm shrink-0">{k}</span>
      <span className={`text-chalk/90 text-right min-w-0 break-words ${mono ? 'font-mono text-xs' : ''}`}>{v}</span>
    </div>
  );
}
