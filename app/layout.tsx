import type { Metadata } from "next";
import Link from "next/link";
import TickerTape from "@/components/TickerTape";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClaudeStocks",
  description: "AI-powered stock research and portfolio tracking.",
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/scanner", label: "Scanner" },
  { href: "/earnings", label: "Earnings" },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-bg text-white">
        <TickerTape />
        <header className="border-b border-border">
          <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
            <Link href="/" className="font-semibold tracking-tight">
              ClaudeStocks
            </Link>
            <nav className="flex gap-1 text-sm">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="px-3 py-1.5 rounded text-gray-300 hover:text-white hover:bg-white/5"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
