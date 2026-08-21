import Link from 'next/link';
import { signOutAction } from '@/app/actions/auth';
import { currentViewer } from '@/lib/owner';

/**
 * The signed-in indicator, with sign-out, for a page header.
 *
 * Signed out it is an invitation and not a wall: two quiet links, no modal, no
 * interstitial. The game is single-player and anyone who has to make an
 * account before they can look at it will simply not look at it.
 *
 * Signed in it carries a monogram rather than only a name, for the same reason
 * every player and franchise in this app carries a mark — an identity should
 * read as an identity, not as a row key.
 *
 * `compact` drops the label text for the league header, which is already
 * carrying a club crest, a cap figure and a phase tile.
 */
export async function AccountBadge({ compact = false }: { compact?: boolean }) {
  const viewer = await currentViewer();

  if (!viewer.userId || !viewer.username) {
    return (
      <div className="flex items-center gap-1">
        <Link href="/sign-in" className="btn-ghost text-xs">Sign in</Link>
        <Link href="/sign-up" className="btn-secondary text-xs">Sign up</Link>
      </div>
    );
  }

  const monogram = viewer.username.slice(0, 1).toUpperCase();

  return (
    <div className="flex items-center gap-2">
      <div
        className="w-8 h-8 rounded-full bg-accent2/15 border border-accent2/30 flex items-center justify-center text-accent2 font-display font-bold shrink-0"
        aria-hidden
      >
        {monogram}
      </div>
      {!compact && (
        <div className="min-w-0 hidden sm:block">
          <div className="label-sm leading-tight">Signed in</div>
          <div className="font-display font-bold uppercase tracking-wide leading-tight truncate max-w-[10rem]">
            {viewer.username}
          </div>
        </div>
      )}
      {/* A plain form posting a Server Action — no client component needed, and
          sign-out therefore works with JavaScript disabled. */}
      <form action={signOutAction}>
        <button className="btn-ghost text-xs" title={`Sign out of ${viewer.username}`}>
          Sign out
        </button>
      </form>
    </div>
  );
}
