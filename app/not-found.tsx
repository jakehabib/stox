import Link from 'next/link';

/**
 * Reached by notFound() — a league id that doesn't exist, a player id that
 * isn't in this league, or (in production) a save that belongs to another
 * browser. Those three are deliberately indistinguishable here: telling a
 * stranger which league ids are real is the thing lib/owner.ts exists to
 * avoid, and there is nothing the visitor can do differently either way.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="panel p-8 max-w-md text-center">
        <div className="label-sm text-accent">404</div>
        <h1 className="font-display font-extrabold uppercase tracking-wide text-2xl mt-2">Nothing here</h1>
        <p className="text-muted text-sm mt-3">
          That page doesn&apos;t exist, or the save it belongs to isn&apos;t one this browser can open.
        </p>
        <Link href="/" className="btn-primary inline-block mt-6">Back to your franchises</Link>
      </div>
    </div>
  );
}
