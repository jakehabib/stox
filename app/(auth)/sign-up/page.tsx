import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth/AuthForm';
import { signUpAction } from '@/app/actions/auth';
import { currentViewer } from '@/lib/owner';
import { countClaimableLeagues } from '@/lib/auth';
import { CrestRibbon } from '@/components/ds/FranchiseWall';
import { TEAM_SEEDS } from '@/lib/gen/names';

export const dynamic = 'force-dynamic';

// noindex: a sign-in form is not a landing page, and a search result for
// "dynasty gm sign in" ahead of the game itself helps nobody.
export const metadata: Metadata = {
  title: 'Create Account',
  robots: { index: false, follow: true },
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const viewer = await currentViewer();
  // Already signed in: there is nothing to do here, and a second account is
  // not what someone who clicked a stale link wants.
  if (viewer.userId) redirect('/');

  // How many saves this browser is holding that signing up would attach. Said
  // out loud, with the real number, because "you won't lose your saves" is the
  // entire pitch and a vague version of it is not persuasive.
  const claimable = await countClaimableLeagues(viewer.ownerKey);

  // Same allowlist shape as safeNext() in app/actions/auth.ts: a `next` off
  // the query string is attacker-controlled, and this one becomes an href.
  const rawNext = searchParams.next ?? '/';
  const guestHref = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-lg border border-line bg-card/40 px-6 py-8">
        <div
          className="absolute inset-0 opacity-[0.06] pointer-events-none"
          style={{ backgroundImage: 'repeating-linear-gradient(90deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 72px)', color: '#f4f6fa' }}
        />
        <div className="relative">
          <div className="label-sm text-accent">Create Account</div>
          <h1 className="font-display font-extrabold uppercase tracking-wide leading-[0.95] mt-2 text-4xl">
            Keep Your<br />Dynasty
          </h1>
          <p className="text-muted mt-4 text-sm leading-relaxed">
            {claimable > 0
              ? `An account means this browser stops being the only place your saves exist. Sign up and the ${claimable === 1 ? 'save' : `${claimable} saves`} on this browser ${claimable === 1 ? 'moves' : 'move'} onto it — clearing cookies or switching devices no longer loses ${claimable === 1 ? 'it' : 'them'}.`
              : 'An account means your saves stop living in a cookie. They survive a cleared browser and follow you to a second device.'}
          </p>
        </div>
      </div>

      <div className="panel p-6">
        <AuthForm mode="signup" action={signUpAction} next={searchParams.next ?? '/'} />
      </div>

      <CrestRibbon seeds={TEAM_SEEDS.slice(16, 23)} />

      {/* The escape hatch, and it points back at whatever the player was
          doing rather than always at the home page. Somebody who reached this
          screen from team select wants to go back to team select, not to the
          front door — sending them to `/` is what makes an optional account
          feel like a detour they lost their place in. */}
      <p className="text-xs text-muted text-center leading-relaxed">
        You don&apos;t have to sign up to play.{' '}
        <Link href={guestHref} className="text-accent2 hover:underline">
          {guestHref === '/new' ? 'Go straight to picking a franchise' : 'Go straight to the game'}
        </Link>{' '}
        — saves stay on this browser until you make an account.
      </p>
    </div>
  );
}
