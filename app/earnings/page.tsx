import EarningsFeed from "@/components/EarningsFeed";

export const metadata = { title: "Earnings · ClaudeStocks" };

export default function EarningsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Earnings Feed</h1>
        <p className="text-gray-400 mt-2">
          Recent quarterly reports for portfolio tickers. Click &quot;Run AI
          Analysis&quot; to get a Claude take.
        </p>
      </div>
      <EarningsFeed />
    </div>
  );
}
