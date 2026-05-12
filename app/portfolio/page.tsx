import PortfolioTable from "@/components/PortfolioTable";

export const metadata = { title: "Portfolio · ClaudeStocks" };

export default function PortfolioPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Claude Portfolio
        </h1>
        <p className="text-gray-400 mt-2">
          Stocks Claude picked on January 1, 2024. Entry prices and theses are
          fixed; current prices and returns update live from Polygon.io.
        </p>
      </div>
      <PortfolioTable />
    </div>
  );
}
