'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * Last-resort boundary. Without this file an uncaught render error shows
 * Next's own error page in development and a bare "Application error" in
 * production — no way back, and no indication the save survived.
 *
 * It did survive: every mutation in this app is a server action that either
 * committed or didn't before the render was attempted, so a render failure
 * never leaves a half-written league. Saying so is the most useful thing
 * this screen can do.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Server-side digest only; the message itself is withheld from the client
    // in production, which is why the digest is worth surfacing at all.
    console.error('Unhandled error', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="panel p-8 max-w-md text-center">
        <div className="label-sm text-bad">Something broke</div>
        <h1 className="font-display font-extrabold uppercase tracking-wide text-2xl mt-2">That page didn&apos;t load</h1>
        <p className="text-muted text-sm mt-3">
          Your league is fine — nothing is saved by rendering a page, so whatever you did last either
          finished or never started.
        </p>
        {error.digest && <p className="text-xs text-muted font-mono mt-3">ref {error.digest}</p>}
        <div className="flex items-center justify-center gap-2 mt-6">
          <button onClick={reset} className="btn-primary">Try again</button>
          <Link href="/" className="btn-secondary">Your franchises</Link>
        </div>
      </div>
    </div>
  );
}
