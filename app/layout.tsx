import type { Metadata, Viewport } from 'next';
import { Oswald, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
// The reactions that fire when an action succeeds — one stylesheet, no
// library, and every duration in it is a token declared in globals.css above.
// Kept separate so it can be read as one list of moments rather than found
// scattered through the design system.
import './moments.css';

// THE THREE FACES OF STADIUM NIGHT, all through next/font so each one is
// self-hosted, preloaded and size-adjusted against its fallback — a raw
// @import would cost a render-blocking round trip to a third party and a
// visible reflow on every navigation.
//
// Oswald is the display face: headings, nav, buttons and every stat number.
// It is narrower and flatter-shouldered than the Barlow Condensed it
// replaces, which is what makes an uppercase nav item read as stadium
// signage rather than as a webfont. It tops out at 700, where Barlow went to
// 800: Stadium Night sets stat numbers at 700 because Oswald is narrow enough
// that 800 closes its counters at the sizes a fact tile uses.
const display = Oswald({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});

// Body copy and data-dense tables move OFF the system sans stack. That stack
// was a different typeface on every platform, and Stadium Night sets body at
// 13px in tables of twenty columns — the one size at which "whatever the OS
// ships" is not good enough. IBM Plex Sans is a grotesque drawn for exactly
// this: dense technical reading, open apertures, unambiguous 1/l/I.
const body = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

// Its monospaced sibling, for money, ratings and every aligned figure. Same
// skeleton as the body face, so a cap number set in mono beside a label set
// in sans reads as one voice rather than two.
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
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
  // Tracks `ink` in tailwind.config.ts — this is the colour a mobile
  // browser paints its own chrome with, so a stale value shows as a seam
  // above the page.
  themeColor: '#070a0f',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
