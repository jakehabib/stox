import Link from 'next/link';
import { AccountBadge } from '../auth/AccountBadge';

/**
 * The bar above every screen outside a league — landing, team select, start,
 * sign in, sign up. It existed three times in three files with three slightly
 * different right-hand sides; this is the one copy, so the front door reads as
 * one place rather than four pages that happen to share a colour scheme.
 */
export function SiteHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="border-b border-line bg-surface/60 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5 shrink-0" aria-label="Dynasty GM Football — home">
          <span className="w-8 h-8 rounded-md bg-accent/15 border border-accent/30 flex items-center justify-center text-accent font-display font-bold">
            D
          </span>
          {/* Wordmark text drops below sm. At 390px the right-hand group (an
              account badge plus whatever nav other pages hang there) and a
              full wordmark do not both fit, and what actually happened was
              "Sign in" breaking across two lines. The D mark holds the brand
              in the bar; the hero underneath says the full name at 48px. */}
          <span className="font-display font-bold tracking-wide uppercase text-lg hidden sm:inline">Dynasty GM</span>
        </Link>
        {right ?? <AccountBadge />}
      </div>
    </header>
  );
}
