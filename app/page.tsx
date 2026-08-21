import Link from 'next/link';
import { currentViewer, listOwnedLeagues } from '@/lib/owner';
import { createLeagueAction, deleteLeagueAction } from './actions/league';
import { TEAM_SEEDS } from '@/lib/gen/names';
import { PHASE_LABELS } from '@/lib/season';
import { TeamLogo } from '@/components/TeamLogo';
import { generateTeamLogoParams } from '@/lib/gen/teamLogo';
import { CreateLeagueForm } from '@/components/CreateLeagueForm';
import { AccountBadge } from '@/components/auth/AccountBadge';

export const dynamic = 'force-dynamic';

export default async function HomePage({ searchParams }: { searchParams: { claimed?: string } }) {
  // Scoped to this viewer's saves — see lib/owner.ts. This used to be an
  // unfiltered findMany, which on any shared deployment listed every tester's
  // franchises to every other tester.
  const [viewer, leagues] = await Promise.all([currentViewer(), listOwnedLeagues()]);

  // Set by the sign-in/sign-up redirect. Parsed defensively — it is a query
  // string, so it is whatever anyone types, and the only thing it controls is
  // a sentence.
  const claimedRaw = Number(searchParams.claimed);
  const claimed = Number.isInteger(claimedRaw) && claimedRaw > 0 ? claimedRaw : 0;

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface/60 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-accent/15 border border-accent/30 flex items-center justify-center text-accent font-display font-bold">D</div>
            <span className="font-display font-bold tracking-wide uppercase text-lg">Dynasty GM</span>
          </div>
          <AccountBadge />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-10">
        {/* Masthead — the game's own identity, not a dashboard heading. The
            yard-line texture echoes the app background at higher contrast. */}
        <section className="relative overflow-hidden rounded-lg border border-line bg-card/40 px-8 py-12">
          <div
            className="absolute inset-0 opacity-[0.06] pointer-events-none"
            style={{ backgroundImage: 'repeating-linear-gradient(90deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 72px)', color: '#f4f6fa' }}
          />
          <div className="relative">
            <div className="label-sm text-accent">Front Office Simulator</div>
            <h1 className="font-display font-extrabold uppercase tracking-wide leading-[0.95] mt-2 text-5xl sm:text-6xl">
              Dynasty GM<br />Football
            </h1>
            <p className="text-muted mt-4 max-w-lg">Run the franchise. Build the dynasty.</p>
            <a href="#create" className="btn-primary inline-block mt-6">Create League →</a>
          </div>
        </section>

        {/* Proof, at the moment it happens. The pitch for making an account is
            "you won't lose these", so the claim says exactly how many moved
            rather than leaving the player to check. */}
        {claimed > 0 && (
          <div className="rounded-md border border-accent/40 bg-accent/10 px-5 py-4">
            <div className="label-sm text-accent">Saves secured</div>
            <p className="text-sm text-chalk/90 mt-1">
              {claimed === 1 ? 'One save on this browser is' : `${claimed} saves on this browser are`} now attached to{' '}
              <strong className="font-semibold">{viewer.username}</strong>. Clearing cookies won&apos;t lose{' '}
              {claimed === 1 ? 'it' : 'them'}, and you can sign in on another device to keep playing.
            </p>
          </div>
        )}

        {/* The invitation. Only shown when there is something to lose — telling
            somebody with no saves that their saves are at risk is noise, and a
            wall in front of a single-player game costs every tester who was
            only ever going to click once. */}
        {!viewer.userId && leagues.length > 0 && (
          <div className="rounded-md border border-warn/40 bg-warn/10 px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="label-sm text-warn">This browser is the only copy</div>
              <p className="text-sm text-chalk/90 mt-1 max-w-2xl">
                {leagues.length === 1 ? 'Your save lives' : 'Your saves live'} in a cookie on this browser.
                Clear it and {leagues.length === 1 ? 'it is' : 'they are'} gone. Make an account and{' '}
                {leagues.length === 1 ? 'it moves' : 'they move'} with you.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link href="/sign-up" className="btn-primary">Save my dynasty</Link>
              <Link href="/sign-in" className="btn-ghost text-sm">Sign in</Link>
            </div>
          </div>
        )}

        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Your Franchises</h2>
            {leagues.length > 0 && <span className="text-xs text-muted">{leagues.length} saved</span>}
          </div>

          {leagues.length === 0 ? (
            <div className="panel p-8 text-center text-muted text-sm">
              {viewer.userId
                ? 'No leagues on this account yet — start your first franchise below.'
                : 'No leagues yet — start your first franchise below.'}
              {!viewer.userId && (
                <span className="block mt-2">
                  Already have an account?{' '}
                  <Link href="/sign-in" className="text-accent2 hover:underline">Sign in</Link>{' '}
                  to load your saves.
                </span>
              )}
            </div>
          ) : (
            <div className="panel divide-y divide-line/60">
              {leagues.map((l) => {
                const team = l.teams[0];
                const accent = team ? generateTeamLogoParams(team.id).primary : undefined;
                return (
                  <div
                    key={l.id}
                    className="flex items-center gap-4 px-5 py-4 border-l-2"
                    style={{ borderLeftColor: accent ?? 'transparent' }}
                  >
                    {team
                      ? <TeamLogo seed={team.id} abbr={team.abbr} size={44} className="shrink-0" />
                      : <div className="w-11 h-11 rounded-full bg-raised shrink-0" />}
                    {/* League name leads: with several saves it's the only
                        thing that tells them apart (the franchise can repeat).
                        Team identity sits under it as the evocative line. */}
                    <div className="min-w-0 flex-1">
                      <div className="label-sm truncate">{l.name}</div>
                      <div className="font-display font-bold text-lg uppercase tracking-wide truncate mt-0.5">
                        {team ? `${team.city} ${team.nickname}` : 'No team'}
                      </div>
                      <div className="text-xs text-muted mt-0.5">
                        {l.seasonYear} · Week {l.week} · {PHASE_LABELS[l.phase] ?? l.phase}
                        {team && ` · ${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ''}`}
                      </div>
                    </div>
                    <Link href={`/league/${l.id}`} className="btn-primary shrink-0">Continue →</Link>
                    <form action={deleteLeagueAction.bind(null, l.id)} className="shrink-0">
                      <button className="btn-ghost text-xs" title="Delete league">Delete</button>
                    </form>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section id="create" className="section scroll-mt-6">
          <div className="section-head">
            <h2 className="section-title">Start a New League</h2>
          </div>
          <CreateLeagueForm seeds={TEAM_SEEDS} action={createLeagueAction} />
        </section>
      </main>
    </div>
  );
}
