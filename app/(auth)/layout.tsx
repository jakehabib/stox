import { SiteHeader } from '@/components/ds/SiteHeader';

/**
 * The frame around sign-in and sign-up. Shares SiteHeader with the landing
 * page, team select and the start screen, so an account is one more step of
 * the same flow rather than an authentication product bolted onto the side of
 * the game. The header's right-hand side is a label rather than the usual
 * account badge — offering "Sign in / Sign up" on the sign-in page is noise.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <SiteHeader right={<span className="label-sm">Front Office Simulator</span>} />
      <main className="max-w-md mx-auto px-6 py-10 sm:py-12">{children}</main>
    </div>
  );
}
