import Link from 'next/link';
import { AccountBadge } from '@/components/auth/AccountBadge';
import { LeagueCheckForm } from '@/components/LeagueCheckForm';
import { FILE_LIMITS } from '@/lib/leagueFile';
import { costCeiling } from '@/lib/costLimit';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Check a League File · Dynasty GM Football',
  description: 'Run the real validator over a league file or its spreadsheets without creating anything.',
};

/**
 * THE WORKBENCH. An author iterating on a 1,700-row spreadsheet used to have
 * exactly one way to find out what was wrong with it: attempt a real import,
 * spend a league slot and an hour of founding budget, and read the refusal off
 * a failed founding. This page is the same refusal for free.
 *
 * It is a page rather than a panel on /import for the reason the import form
 * is: a refusal needs room. "teams[7].players[3].age is 900; it must be
 * between 18 and 45" has nowhere to go in a toast, and the whole value of this
 * endpoint is that the sentence arrives intact.
 *
 * THE LIMITS ARE PASSED DOWN, NOT RESTATED. FILE_LIMITS cannot be imported
 * into a client bundle — lib/leagueFile.ts reaches the database for export —
 * so the figures the form shows are read here, on the server, and handed over
 * as props. A literal in the client component would be a second copy of a
 * bound, which is the bug this whole workstream exists to remove.
 */
export default function LeagueCheckPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface/60 backdrop-blur">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-accent/15 border border-accent/30 flex items-center justify-center text-accent font-display font-bold">D</div>
            <span className="font-display font-bold tracking-wide uppercase text-lg">Dynasty GM</span>
          </Link>
          <AccountBadge />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        <section>
          <div className="label-sm text-accent">Custom Leagues</div>
          <h1 className="font-display font-extrabold uppercase tracking-wide leading-[0.95] mt-2 text-4xl sm:text-5xl">
            Check a File
          </h1>
          <p className="text-muted mt-4 max-w-2xl">
            The same validator the import runs, with nothing created at the end of it. A file that passes here
            imports; a file that is refused here is refused there, in the same words. Up to{' '}
            {costCeiling('VALIDATE').perOwner} checks an hour.
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            <Link href="/import" className="btn-secondary">← Import and export</Link>
            <Link href="/import/reference" className="btn-secondary">Every bound and legal value</Link>
          </div>
        </section>

        <LeagueCheckForm limits={{ maxBytes: FILE_LIMITS.MAX_BYTES, teamCount: FILE_LIMITS.TEAM_COUNT }} />
      </main>
    </div>
  );
}
