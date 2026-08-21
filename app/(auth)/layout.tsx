import Link from 'next/link';

/**
 * The frame around sign-in and sign-up. Same header as the home page and the
 * same yard-line texture as its masthead, so these read as two more screens of
 * the game rather than an authentication product bolted onto the side of it.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface/60 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-accent/15 border border-accent/30 flex items-center justify-center text-accent font-display font-bold">D</div>
            <span className="font-display font-bold tracking-wide uppercase text-lg">Dynasty GM</span>
          </Link>
          <span className="label-sm">Front Office Simulator</span>
        </div>
      </header>

      <main className="max-w-md mx-auto px-6 py-12">{children}</main>
    </div>
  );
}
