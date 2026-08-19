import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Gridiron GM',
  description: 'A single-player American football front-office simulator.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
