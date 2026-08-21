import type { Metadata } from 'next';
import Link from 'next/link';
import { TEAM_SEEDS } from '@/lib/gen/names';
import { CreateLeagueForm } from '@/components/CreateLeagueForm';
import { SiteHeader } from '@/components/ds/SiteHeader';
import { createLeagueAction } from '@/app/actions/league';
import { prisma } from '@/lib/db';
import { currentViewer, maxLeaguesPerOwner } from '@/lib/owner';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'New Dynasty',
  description: 'Choose one of 32 franchises and start a new dynasty.',
};

/**
 * Beat three of the front door: team select.
 *
 * Its own route rather than a section of the home page, for two reasons. The
 * landing page is supposed to be one confident screen and a 32-club board is
 * not that; and a franchise chosen from a crest on the landing page arrives
 * here as `?team=`, so the click that expressed the choice is the click that
 * makes it.
 */
export default async function NewLeaguePage({ searchParams }: { searchParams: { team?: string } }) {
  const viewer = await currentViewer();

  // Counted exactly the way assertCanCreateLeague in lib/owner.ts counts, and
  // deliberately NOT off listOwnedLeagues(). The two differ: the visible list
  // also includes legacy fully-unowned saves in development, so counting rows
  // on screen would put this page behind a "slots full" wall while the server
  // action it guards would have accepted the request happily. A pre-check that
  // disagrees with the real check is worse than no pre-check.
  const mineWhere =
    viewer.userId != null
      ? { userId: viewer.userId }
      : viewer.ownerKey != null
        ? { userId: null, ownerKey: viewer.ownerKey }
        : { id: '__no_owner__' };
  const mine = await prisma.league.count({ where: mineWhere });

  // Whatever arrives in the query string is validated against the real seed
  // list before it reaches the client — it is a URL, so it is whatever anyone
  // types, and an unmatched value would silently post a userTeamAbbr the
  // generator falls back out of.
  const requested = typeof searchParams.team === 'string' ? searchParams.team.toUpperCase() : undefined;
  const initialAbbr = TEAM_SEEDS.some((s) => s.abbr === requested) ? requested : undefined;

  const limit = maxLeaguesPerOwner();
  const atLimit = mine >= limit;

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        {atLimit ? (
          <div className="panel p-8 text-center space-y-3">
            <div className="label-sm text-warn">Save slots full</div>
            <h1 className="font-display font-extrabold text-3xl uppercase tracking-wide">
              You already have {mine} dynasties
            </h1>
            <p className="text-muted text-sm max-w-lg mx-auto">
              {limit} is the limit. Delete one from your franchise list and the slot comes straight back — nothing else
              on the account is affected.
            </p>
            <Link href="/" className="btn-primary inline-flex mt-2">Back to my franchises</Link>
          </div>
        ) : (
          <>
            {/* The account invitation, in the flow and not in front of it. A
                signed-out player can complete this entire screen; all this
                does is tell them what happens to the save if they don't. */}
            {!viewer.userId && (
              <div className="rounded-md border border-line bg-card/50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted min-w-0">
                  Playing as a guest — this dynasty will live in this browser only.{' '}
                  <span className="text-chalk/90">An account keeps it if you clear cookies or switch device.</span>
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <Link href="/sign-up?next=/new" className="btn-secondary text-xs">Create account</Link>
                  <Link href="/sign-in?next=/new" className="btn-ghost text-xs">Sign in</Link>
                </div>
              </div>
            )}

            <CreateLeagueForm seeds={TEAM_SEEDS} action={createLeagueAction} initialAbbr={initialAbbr} />
          </>
        )}
      </main>
    </div>
  );
}
