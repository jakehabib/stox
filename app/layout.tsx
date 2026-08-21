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

export const metadata: Metadata = {
  // Template rather than a bare title so a league page can name the club and
  // still be identifiable in a wall of browser tabs.
  title: { default: 'Dynasty GM Football', template: '%s · Dynasty GM' },
  description: 'A single-player American football front-office simulator. Run the franchise, build the dynasty.',
  // app/icon.svg supplies the tab icon; without it every page requested
  // /favicon.ico and took a 404 on each load.
  applicationName: 'Dynasty GM Football',
  openGraph: {
    title: 'Dynasty GM Football',
    description: 'Run the franchise. Build the dynasty.',
    type: 'website',
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
