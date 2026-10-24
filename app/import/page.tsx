import Link from 'next/link';
import { listOwnedLeagues } from '@/lib/owner';
import { AccountBadge } from '@/components/auth/AccountBadge';
import { LeagueImportForm } from '@/components/LeagueImportForm';
import { FILE_LIMITS } from '@/lib/leagueFile';
import { CSV_ATTRIBUTE_COUNT, CSV_POSITIONS, TEMPLATE_NAMES } from '@/lib/leagueCsv';
import { TeamLogo } from '@/components/TeamLogo';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Custom Leagues · Dynasty GM Football',
  description: 'Import a league file to play someone else’s custom league, or export one of your own to share.',
};

/**
 * The custom-league page: import a file, or export one of your own.
 *
 * Both halves live here because they are one loop — you export a file in order
 * for someone else to import it — and because a rejection needs room to be
 * explained. Squeezed into a panel on the home page, a refusal like
 * "teams[7].players[3].age is 900; it must be between 18 and 45" has nowhere
 * to go but a truncated toast.
 *
 * TWO THINGS IT DELIBERATELY DOES NOT HOLD. The full table of bounds is at
 * /import/reference, which renders every figure from FILE_LIMITS and the real
 * position, dev-trait and attribute lists; this page used to carry a second
 * grid of the same values. And the validator is at /import/check. Both are
 * linked from here and from each other. The house rule is that length is not
 * clutter but duplication is: the same figure printed on two pages is two
 * places for it to be wrong.
 */
export default async function ImportPage() {
  const leagues = await listOwnedLeagues();

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface/60 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-accent/15 border border-accent/30 flex items-center justify-center text-accent font-display font-bold">D</div>
            <span className="font-display font-bold tracking-wide uppercase text-lg">Dynasty GM</span>
          </Link>
          <AccountBadge />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-10">
        <section>
          <div className="label-sm text-accent">Custom Leagues</div>
          <h1 className="font-display font-extrabold uppercase tracking-wide leading-[0.95] mt-2 text-4xl sm:text-5xl">
            Import a League
          </h1>
          <p className="text-muted mt-4 max-w-2xl">
            A league file is a single JSON document describing {FILE_LIMITS.TEAM_COUNT} franchises and, if you
            want, every player on them and the college class they will draft from. Build one from spreadsheets,
            or export a league you already have and send it to a friend. Everything in it is checked before
            anything is written.
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            <Link href="/import/check" className="btn-secondary">Check a file without importing it</Link>
            <Link href="/import/reference" className="btn-secondary">Every bound and legal value</Link>
          </div>
          <Link href="/" className="btn-ghost text-sm mt-3 inline-block">← Back to your franchises</Link>
        </section>

        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Import</h2>
          </div>
          <LeagueImportForm maxBytes={FILE_LIMITS.MAX_BYTES} maxLeagueName={FILE_LIMITS.MAX_LEAGUE_NAME} />
        </section>

        <section className="section">
          <div className="section-head">
            <h2 className="section-title">The shortest way in</h2>
          </div>
          <div className="panel p-5 text-sm space-y-3">
            <p className="text-muted">
              <span className="text-chalk">Export a league you already have, open the file, change the
              names.</span> An export is a complete {FILE_LIMITS.TEAM_COUNT}-team skeleton that already
              satisfies every structural rule — {FILE_LIMITS.CONFERENCE_COUNT} conferences of{' '}
              {FILE_LIMITS.DIVISION_COUNT} divisions of {FILE_LIMITS.TEAMS_PER_DIVISION}, every abbreviation
              distinct, every roster able to field a punter. Editing a known-good file beats starting from an
              empty one, and nothing in it has to be deleted first: change a city and a nickname and you have
              your own league.
            </p>
            <p className="text-muted">
              The export panel is further down this page, and{' '}
              <Link href="/import/check" className="text-accent2 hover:underline">the checker</Link> will tell
              you what your edits did before you spend a league slot on them.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Build one in a spreadsheet</h2>
          </div>
          <div className="panel p-5 space-y-4 text-sm">
            <p className="text-muted">
              A real league is {(FILE_LIMITS.TEAM_COUNT * FILE_LIMITS.MAX_PLAYERS_PER_TEAM).toLocaleString('en-US')}{' '}
              players at a full {FILE_LIMITS.MAX_PLAYERS_PER_TEAM} a side, and hand-writing that as JSON is a
              document one missing comma destroys. Author it in a spreadsheet instead — three sheets, exported
              as CSV. The work splits: {FILE_LIMITS.TEAM_COUNT} teams across eight people in one shared sheet,
              four teams each.
            </p>
            <p className="text-muted">
              <span className="text-chalk">A complete league is six columns.</span> There are{' '}
              {CSV_ATTRIBUTE_COUNT} attributes across {CSV_POSITIONS.length} positions and you do not need them.
              Fill in <code className="text-accent2">ovr</code>, leave every attribute column empty, and the
              attributes are generated around that overall — so a cap-realistic league is{' '}
              <code className="text-accent2">team, name, position, age, ovr, contractApy, contractYears</code>{' '}
              times every row. Attributes are an optional refinement for the players you have an opinion about.
              Supply them and the overall is recomputed from them: a stored overall that disagrees with the
              attributes under it is a number this game will not show you.
            </p>
            <div className="flex flex-wrap gap-2">
              {TEMPLATE_NAMES.map((t) => (
                <a key={t} href={`/api/league/templates/${t}`} className="btn-secondary" download>
                  {t} ↓
                </a>
              ))}
            </div>
            <p className="text-muted text-xs">
              teams.csv arrives filled in with {FILE_LIMITS.TEAM_COUNT} franchises — rename the cities and
              nicknames, or rename the conference and division columns too and the whole league moves with
              them. players.csv and prospects.csv arrive as a header row, and that header row is every column
              each file accepts. The legal positions, dev traits and attribute keys are on the{' '}
              <Link href="/import/reference" className="text-accent2 hover:underline">reference page</Link>.
            </p>
            <form action="/api/league/csv" method="post" encType="multipart/form-data" className="space-y-3 pt-2 border-t border-line/60">
              <div className="label-sm">Convert to a league file</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <CsvField name="teams" label="teams.csv" required />
                <CsvField name="players" label="players.csv" />
                <CsvField name="prospects" label="prospects.csv" />
              </div>
              <button type="submit" className="btn-primary">Convert ↓</button>
              <p className="text-muted text-xs">
                Returns the league file as a download. Nothing is created — upload that file above to play it. A
                refusal names the file, the row and what would have been legal. To get that refusal without a
                download, run the same sheets through{' '}
                <Link href="/import/check" className="text-accent2 hover:underline">the checker</Link>.
              </p>
            </form>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Export one of yours</h2>
            {leagues.length > 0 && <span className="text-xs text-muted">{leagues.length} saved</span>}
          </div>
          {leagues.length === 0 ? (
            <div className="panel p-8 text-center text-muted text-sm">
              No leagues to export yet. Start one from the{' '}
              <Link href="/" className="text-accent2 hover:underline">home page</Link>, then come back.
            </div>
          ) : (
            <div className="panel divide-y divide-line/60">
              {leagues.map((l) => {
                const team = l.teams[0];
                return (
                  <div key={l.id} className="flex items-center gap-4 px-5 py-4">
                    {team
                      ? <TeamLogo seed={team.id} abbr={team.abbr} nickname={team.nickname} size={40} className="shrink-0" />
                      : <div className="w-10 h-10 rounded-full bg-raised shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="label-sm truncate">{l.name}</div>
                      <div className="font-display font-bold uppercase tracking-wide truncate mt-0.5">
                        {team ? `${team.city} ${team.nickname}` : 'No team'}
                      </div>
                    </div>
                    <a href={`/api/league/export/${l.id}`} className="btn-secondary shrink-0" download>
                      Export ↓
                    </a>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="section">
          <div className="section-head">
            <h2 className="section-title">What a file may contain</h2>
          </div>
          <div className="panel p-5 space-y-3 text-sm">
            <p className="text-muted">
              Every bound the parser enforces — the size cap, the counts, the name lengths, the{' '}
              {CSV_POSITIONS.length} legal positions, the {CSV_ATTRIBUTE_COUNT} attribute keys, the dev traits,
              the combine ranges and what import generates when a file is silent — is listed on one page, and
              every figure on it is rendered from the constant the parser checks against rather than written
              out beside it.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href="/import/reference" className="btn-primary">League file reference ▸</Link>
              <Link href="/import/check" className="btn-secondary">Check a file</Link>
            </div>
            <p className="text-muted text-xs">
              Names you write are shown to anyone you send the file to and to you inside the game. This is a
              friends-and-family beta with no public gallery — nothing you import is published anywhere — but
              please keep team and player names to things you would put on a jersey.
            </p>
          </div>
        </section>

      </main>
    </div>
  );
}

/**
 * One file input. A plain multipart form rather than a client component: the
 * converter writes nothing and returns a download, which is exactly what a
 * browser form already does, and a Server Action would have to hand a 1MB
 * string back through React to produce the same file.
 */
function CsvField({ name, label, required }: { name: string; label: string; required?: boolean }) {
  return (
    <label className="block space-y-1">
      <span className="label-sm">{label}{required ? '' : ' — optional'}</span>
      <input
        type="file"
        name={name}
        accept=".csv,text/csv"
        required={required}
        className="block w-full text-xs text-muted file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-line file:bg-raised file:text-chalk file:text-xs"
      />
    </label>
  );
}
