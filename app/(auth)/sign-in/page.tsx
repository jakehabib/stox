import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth/AuthForm';
import { signInAction } from '@/app/actions/auth';
import { currentViewer } from '@/lib/owner';

export const dynamic = 'force-dynamic';

// noindex: a sign-in form is not a landing page, and a search result for
// "dynasty gm sign in" ahead of the game itself helps nobody.
export const metadata: Metadata = {
  title: 'Sign In',
  robots: { index: false, follow: true },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const viewer = await currentViewer();
  if (viewer.userId) redirect('/');

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-lg border border-line bg-card/40 px-6 py-8">
        <div
          className="absolute inset-0 opacity-[0.06] pointer-events-none"
          style={{ backgroundImage: 'repeating-linear-gradient(90deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 72px)', color: '#f4f6fa' }}
        />
        <div className="relative">
          <div className="label-sm text-accent">Sign In</div>
          <h1 className="font-display font-extrabold uppercase tracking-wide leading-[0.95] mt-2 text-4xl">
            Welcome<br />Back
          </h1>
          <p className="text-muted mt-4 text-sm leading-relaxed">
            Sign in to pick up your franchises on this or any other device.
          </p>
        </div>
      </div>

      <div className="panel p-6">
        <AuthForm mode="signin" action={signInAction} next={searchParams.next ?? '/'} />
      </div>

      <p className="text-xs text-muted text-center leading-relaxed">
        Forgotten your password? There is no reset — we never asked for an email address.
        Message whoever sent you the link and they can set a new one for you.
      </p>
    </div>
  );
}
