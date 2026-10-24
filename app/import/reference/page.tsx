import Link from 'next/link';
import { AccountBadge } from '@/components/auth/AccountBadge';
import { LeagueFileReference } from '@/components/LeagueFileReference';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'League File Reference · Dynasty GM Football',
  description: 'Every bound the league file parser enforces, read out of the parser itself.',
};

/**
 * The generated reference. Everything with a figure in it lives in
 * components/LeagueFileReference.tsx — see the note at the top of that file for
 * why it is separate: this page reads the signed-in viewer through
 * AccountBadge and is therefore async, and the reference itself has to stay
 * synchronous and pure so a probe can render it and assert every figure
 * against the constant it came from.
 */
export default function LeagueFileReferencePage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface/60 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-accent/15 border border-accent/30 flex items-center justify-center text-accent font-display font-bold">D</div>
            <span className="font-display font-bold tracking-wide uppercase text-lg">Dynasty GM</span>
          </Link>
          <AccountBadge />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-10">
        <section>
          <div className="label-sm text-accent">Custom Leagues</div>
          <h1 className="font-display font-extrabold uppercase tracking-wide leading-[0.95] mt-2 text-4xl sm:text-5xl">
            League File Reference
          </h1>
          <p className="text-muted mt-4 max-w-2xl">
            Every bound the parser enforces, read out of the parser. The figures below are rendered from the
            same constants <code className="text-accent2">lib/leagueFile.ts</code> checks a file against, so a
            bound that changes changes this page in the same deploy. Nothing here is a number transcribed by
            hand.
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            <Link href="/import" className="btn-secondary">← Import and export</Link>
            <Link href="/import/check" className="btn-secondary">Check a file</Link>
          </div>
        </section>

        <LeagueFileReference />

        <section>
          <p className="text-muted text-sm max-w-2xl">
            The prose — why each of these rules exists, what is derived rather than authored, what export
            leaves out, how a round trip loses crest colours, how to author a league in a spreadsheet — is in{' '}
            <code className="text-chalk">docs/custom-leagues.md</code>. It states no bounds of its own; they
            are all here.
          </p>
        </section>
      </main>
    </div>
  );
}
