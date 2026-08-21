'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * Scoped to one league, so the league chrome (header, nav, cap figure) stays
 * on screen and a failed page is recoverable without leaving the save — the
 * root boundary would replace the whole shell.
 */
export default function LeagueError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Unhandled league page error', error);
  }, [error]);

  return (
    <div className="panel p-8 text-center">
      <div className="label-sm text-bad">Something broke</div>
      <h1 className="font-display font-extrabold uppercase tracking-wide text-xl mt-2">This screen didn&apos;t load</h1>
      <p className="text-muted text-sm mt-3 max-w-md mx-auto">
        The rest of your league is unaffected — use the nav above, or try this page again.
      </p>
      {error.digest && <p className="text-xs text-muted font-mono mt-3">ref {error.digest}</p>}
      <div className="flex items-center justify-center gap-2 mt-6">
        <button onClick={reset} className="btn-primary">Try again</button>
        <Link href="/" className="btn-secondary">Your franchises</Link>
      </div>
    </div>
  );
}
