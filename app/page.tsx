import Link from "next/link";
import PortfolioTable from "@/components/PortfolioTable";

export default function HomePage() {
  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">
          AI-powered stock research
        </h1>
        <p className="text-gray-400 mt-2 max-w-2xl">
          Live prices, a Claude-curated portfolio with real return tracking,
          AI stock scanning, and earnings analysis.
        </p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <FeatureCard
          href="/portfolio"
          title="Claude Portfolio"
          body="8 stocks hand-picked by Claude, with thesis and live returns."
        />
        <FeatureCard
          href="/scanner"
          title="Stock Scanner"
          body="Paste a ticker, pick focus areas, get an AI analyst take."
        />
        <FeatureCard
          href="/earnings"
          title="Earnings Feed"
          body="Recent quarterly reports for portfolio names with AI analysis on demand."
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Portfolio snapshot</h2>
        <PortfolioTable />
      </section>
    </div>
  );
}

function FeatureCard({
  href,
  title,
  body,
}: {
  href: string;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="border border-border rounded-md p-5 bg-panel hover:border-white/30 transition-colors block"
    >
      <div className="font-semibold">{title}</div>
      <div className="text-sm text-gray-400 mt-1">{body}</div>
    </Link>
  );
}
