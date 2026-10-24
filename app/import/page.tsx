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
            A league file is a single JSON document describing 32 franchises and, if you want, every player on
            them and the college class they will draft from. Build one from spreadsheets, or export a league you
            already have and send it to a friend. Everything in it is checked before anything is written.
          </p>
          <Link href="/" className="btn-ghost text-sm mt-4 inline-block">← Back to your franchises</Link>
        </section>

        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Import</h2>
          </div>
          <LeagueImportForm />
        </section>

        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Build one in a spreadsheet</h2>
          </div>
          <div className="panel p-5 space-y-4 text-sm">
            <p className="text-muted">
              A real league is around 1,700 players, and hand-writing that as JSON is a 40,000-line document that
              one missing comma destroys. Author it in a spreadsheet instead — three sheets, exported as CSV. The
              work splits: thirty-two teams across eight people in one shared sheet, four teams each.
            </p>
            <p className="text-muted">
              <span className="text-chalk">A complete league is six columns.</span> There are{' '}
              {CSV_ATTRIBUTE_COUNT} attributes across {CSV_POSITIONS.length} positions and you do not need them.
              Fill in <code className="text-accent2">ovr</code>, leave every attribute column empty, and the
              attributes are generated around that overall — so a cap-realistic league is{' '}
              <code className="text-accent2">team, name, position, age, ovr, contractApy, contractYears</code>{' '}
              times 1,700 rows. Attributes are an optional refinement for the players you have an opinion about.
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
              teams.csv arrives filled in with thirty-two franchises — rename the cities and nicknames, or rename
              the conference and division columns too and the whole league moves with them. players.csv and
              prospects.csv arrive as a header row. Positions are{' '}
              {CSV_POSITIONS.join(', ')}.
            </p>
            <form action="/api/league/csv" method="post" encType="multipart/form-data" className="space-y-3 pt-2 border-t border-line/60">
              <div className="label-sm">Convert to a league file</div>
              <div className="grid sm:grid-cols-3 gap-3">
                <CsvField name="teams" label="teams.csv" required />
                <CsvField name="players" label="players.csv" />
                <CsvField name="prospects" label="prospects.csv" />
              </div>
              <button type="submit" className="btn-primary">Convert ↓</button>
              <p className="text-muted text-xs">
                Returns the league file as a download. Nothing is created — upload that file above to play it. A
                refusal names the file, the row and what would have been legal.
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
          <div className="panel p-5 grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <Rule k="Teams" v={`exactly ${FILE_LIMITS.TEAM_COUNT}, as ${FILE_LIMITS.CONFERENCE_COUNT} conferences × ${FILE_LIMITS.DIVISION_COUNT} divisions × ${FILE_LIMITS.TEAMS_PER_DIVISION} teams`} />
            <Rule k="Conference and division names" v={`yours, up to ${FILE_LIMITS.MAX_CONFERENCE_NAME} characters; omit them for AFC/NFC and East/North/South/West`} />
            <Rule k="Draft class" v={`one, up to ${FILE_LIMITS.MAX_PROSPECTS_PER_CLASS} prospects; omitted means a generated class`} />
            <Rule k="Players per team" v={`up to ${FILE_LIMITS.MAX_PLAYERS_PER_TEAM}; omit them and a roster is generated`} />
            <Rule k="Free agents" v={`up to ${FILE_LIMITS.MAX_FREE_AGENTS}; omitted means a generated pool`} />
            <Rule k="File size" v={`up to ${FILE_LIMITS.MAX_BYTES / 1_048_576}MB`} />
            <Rule k="Ratings" v={`${FILE_LIMITS.RATING_MIN}–${FILE_LIMITS.RATING_MAX}`} />
            <Rule k="Ages" v={`${FILE_LIMITS.AGE_MIN}–${FILE_LIMITS.AGE_MAX}`} />
            <Rule k="Contracts" v={`$${(FILE_LIMITS.CONTRACT_APY_MIN / 1e6).toFixed(1)}M–$${(FILE_LIMITS.CONTRACT_APY_MAX / 1e6).toFixed(0)}M per year, 1–${FILE_LIMITS.CONTRACT_YEARS_MAX} years`} />
            <Rule k="Names" v={`up to ${FILE_LIMITS.MAX_PERSON_NAME} characters, letters and ordinary punctuation`} />
          </div>
          <p className="text-muted text-xs">
            Names you write are shown to anyone you send the file to and to you inside the game. This is a
            friends-and-family beta with no public gallery — nothing you import is published anywhere — but
            please keep team and player names to things you would put on a jersey.
          </p>
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

function Rule({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/40 pb-2">
      <span className="label-sm shrink-0">{k}</span>
      <span className="text-chalk/90 text-right">{v}</span>
    </div>
  );
}
