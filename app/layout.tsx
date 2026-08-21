import type { Metadata, Viewport } from 'next';
import { Barlow_Condensed } from 'next/font/google';
import './globals.css';

// A bold condensed display face for headings and nav — the one typographic
// move that does the most to read as "broadcast sports graphics" instead of
// "generic dark SaaS dashboard." Body copy and data-dense tables stay on the
// system sans stack for maximum legibility at small sizes.
const display = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-display',
  display: 'swap',
});

/**
 * The live origin. Set NEXT_PUBLIC_SITE_URL in any environment that is not
 * dynastygm.gg — a Vercel preview deploy, or a local run — so share cards
 * and canonical links point at the deployment they were generated on rather
 * than at production.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://dynastygm.gg';

export const metadata: Metadata = {
  // metadataBase is what makes every relative URL below absolute. Without it
  // Next resolves the share image against localhost at build time, so a link
  // pasted into a chat renders with no card at all.
  metadataBase: new URL(SITE_URL),
  // Template rather than a bare title so a league page can name the club and
  // still be identifiable in a wall of browser tabs.
  title: { default: 'Dynasty GM Football', template: '%s · Dynasty GM' },
  description: 'A single-player American football front-office simulator. Run the franchise, build the dynasty.',
  // app/icon.svg supplies the tab icon; without it every page requested
  // /favicon.ico and took a 404 on each load.
  applicationName: 'Dynasty GM Football',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Dynasty GM Football',
    description: 'Run the franchise. Build the dynasty.',
    url: SITE_URL,
    siteName: 'Dynasty GM',
    type: 'website',
  },
  // Testers will share this link in chat apps, which is the only place the
  // game gets a first impression before someone clicks.
  twitter: {
    card: 'summary_large_image',
    title: 'Dynasty GM Football',
    description: 'Run the franchise. Build the dynasty.',
  },
};

export const viewport: Viewport = {
  themeColor: '#0d1117',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={display.variable}>
      <body>{children}</body>
    </html>
  );
}
