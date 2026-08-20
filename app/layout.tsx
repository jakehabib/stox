import type { Metadata } from 'next';
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
  title: 'Dynasty GM Football',
  description: 'A single-player American football front-office simulator.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={display.variable}>
      <body>{children}</body>
    </html>
  );
}
