import Link from 'next/link';
import { listOwnedLeagues } from '@/lib/owner';
import { AccountBadge } from '@/components/auth/AccountBadge';
import { LeagueImportForm } from '@/components/LeagueImportForm';
import { FILE_LIMITS } from '@/lib/leagueFile';
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
            them. Build one by hand for your fantasy league, or export a league you already have and send it to
            a friend. Everything in it is checked before anything is written.
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
            <Rule k="Teams" v={`exactly ${FILE_LIMITS.TEAM_COUNT}, as 2 conferences × 4 divisions × ${FILE_LIMITS.TEAMS_PER_DIVISION} teams`} />
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

function Rule({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/40 pb-2">
      <span className="label-sm shrink-0">{k}</span>
      <span className="text-chalk/90 text-right">{v}</span>
    </div>
  );
}
